const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W, H;

const video = document.createElement('video');
video.autoplay = true;
video.playsInline = true;
video.style.display = 'none';

navigator.mediaDevices.getUserMedia({video: { facingMode: 'environment' }, audio: false})
  .then(stream => {
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      W = video.videoWidth;
      H = video.videoHeight;
      canvas.width = W;
      canvas.height = H;
      // canvas.style.width = W + 'px';
      // canvas.style.height = H + 'px';
    };
  })
  .catch(e => alert('Нет доступа к камере: ' + e));

// --- Agent (square) setup ---
const AGENT_COUNT = 40;
const AGENT_SIZE = 22;
const LINK_DIST = 80;
const MAX_AGENTS_PER_TARGET = 15;

const agentsDiv = document.getElementById('agents');
let agentDivs = [];
function createAgentDivs() {
  agentsDiv.innerHTML = '';
  agentDivs = [];
  for (let i = 0; i < AGENT_COUNT; i++) {
    const d = document.createElement('div');
    d.className = 'agent';
    d.style.left = '-100px';
    d.style.top = '-100px';
    agentsDiv.appendChild(d);
    agentDivs.push(d);
  }
}
createAgentDivs();

class Agent {
  constructor(idx) {
    this.idx = idx;
    this.x = Math.random() * (canvas.width - AGENT_SIZE);
    this.y = Math.random() * (canvas.height - AGENT_SIZE);
    this.visible = true;
  }
  moveTo(target, speed, dt) {
    if (!target) return;
    const dx = target.x - (this.x + AGENT_SIZE/2);
    const dy = target.y - (this.y + AGENT_SIZE/2);
    const dist = Math.sqrt(dx*dx + dy*dy);
    const maxStep = speed * dt;
    if (dist < maxStep) {
      this.x = target.x - AGENT_SIZE/2;
      this.y = target.y - AGENT_SIZE/2;
    } else {
      this.x += (dx / dist) * maxStep;
      this.y += (dy / dist) * maxStep;
    }
  }
  updateDOM() {
    const d = agentDivs[this.idx];
    if (this.visible) {
      d.style.left = this.x + 'px';
      d.style.top = this.y + 'px';
      d.style.opacity = '0.95';
    } else {
      d.style.left = '-100px';
      d.style.top = '-100px';
      d.style.opacity = '0';
    }
  }
}
let agents = Array.from({length: AGENT_COUNT}, (_,i) => new Agent(i));

// --- Object detection (COCO-SSD) + MediaPipe Hands ---
let detectedTargets = [];
let cocoModel = null;
let hands = null;
let handsResults = [];
let detectToggle = true; // для чередования моделей

// MediaPipe Hands setup
function setupHands() {
  hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5
  });
  hands.onResults((results) => {
    handsResults = [];
    if (results.multiHandLandmarks) {
      for (const landmarks of results.multiHandLandmarks) {
        for (const lm of landmarks) {
          handsResults.push({
            x: lm.x * canvas.width,
            y: lm.y * canvas.height
          });
        }
      }
    }
  });
}
setupHands();

async function detectHands() {
  if (video.videoWidth && video.videoHeight && hands) {
    await hands.send({image: video});
  }
}

// --- YOLOv8 через onnxruntime-web ---
const YOLO_MODEL_URL = 'https://huggingface.co/onnx/models/resolve/main/yolov8n.onnx';
let yoloSession = null;
let yoloInputShape = [1, 3, 640, 640]; // [batch, channels, height, width]
let yoloClasses = [
  'person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'
];
let detectedBboxes = [];
let detectedBboxLabels = [];

async function loadYolo() {
  yoloSession = await ort.InferenceSession.create(YOLO_MODEL_URL);
}
loadYolo();

function preprocessYoloInput(video) {
  // Resize video to 640x640, normalize, NCHW
  const off = document.createElement('canvas');
  off.width = 640; off.height = 640;
  const octx = off.getContext('2d');
  octx.drawImage(video, 0, 0, 640, 640);
  const imgData = octx.getImageData(0, 0, 640, 640).data;
  const input = new Float32Array(1 * 3 * 640 * 640);
  for (let i = 0; i < 640 * 640; i++) {
    input[i] = imgData[i * 4] / 255; // R
    input[i + 640 * 640] = imgData[i * 4 + 1] / 255; // G
    input[i + 2 * 640 * 640] = imgData[i * 4 + 2] / 255; // B
  }
  return new ort.Tensor('float32', input, yoloInputShape);
}

async function detectYoloObjects() {
  if (!yoloSession || !video.videoWidth || !video.videoHeight) return [];
  const inputTensor = preprocessYoloInput(video);
  const feeds = { images: inputTensor };
  const results = await yoloSession.run(feeds);
  // YOLOv8n.onnx output: 'output0' [1, N, 84] (x, y, w, h, conf, 80 class scores)
  const output = results[Object.keys(results)[0]].data;
  const numDet = output.length / 84;
  const bboxes = [];
  for (let i = 0; i < numDet; i++) {
    const conf = output[i * 84 + 4];
    if (conf < 0.2) continue; // порог ниже
    let maxClass = 0, maxScore = 0;
    for (let c = 0; c < 80; c++) {
      const score = output[i * 84 + 5 + c];
      if (score > maxScore) { maxScore = score; maxClass = c; }
    }
    if (maxScore * conf < 0.2) continue;
    // YOLOv8: x,y,w,h - center, scale 0..1 (relative to 640)
    let x = output[i * 84 + 0] * (video.videoWidth / 640);
    let y = output[i * 84 + 1] * (video.videoHeight / 640);
    let w = output[i * 84 + 2] * (video.videoWidth / 640);
    let h = output[i * 84 + 3] * (video.videoHeight / 640);
    bboxes.push({
      bbox: [x - w/2, y - h/2, w, h],
      class: yoloClasses[maxClass],
      conf: conf * maxScore,
      center: {x, y}
    });
  }
  detectedBboxes = bboxes.map(b => b.bbox);
  detectedBboxLabels = bboxes.map(b => ({bbox: b.bbox, label: b.class, conf: b.conf}));
  return bboxes.map(b => ({x: b.center.x, y: b.center.y}));
}

// Объединяем все цели
async function updateTargets() {
  if (detectToggle) {
    const yoloTargets = await detectYoloObjects() || [];
    detectedTargets = yoloTargets;
  } else {
    await detectHands();
    if (handsResults && handsResults.length > 0) {
      detectedTargets = handsResults;
    }
  }
  detectToggle = !detectToggle;
}
cocoSsd.load().then(model => {
  cocoModel = model;
  setInterval(updateTargets, 180); // оптимальная частота
});

// --- TensorFlow.js backend selection ---
(async () => {
  if (window.tf && tf.setBackend) {
    try {
      await tf.setBackend('webgl');
      await tf.ready();
      // Проверим, действительно ли webgl работает
      if (tf.getBackend() !== 'webgl') {
        await tf.setBackend('wasm');
        await tf.ready();
      }
    } catch (e) {
      await tf.setBackend('wasm');
      await tf.ready();
    }
  }
})();

// --- FPS sync ---
let lastVideoFrameTime = null;
let measuredVideoFps = 60;
let videoFrameCount = 0;
let fpsMeasureStart = null;

function measureVideoFps() {
  if (!fpsMeasureStart) fpsMeasureStart = performance.now();
  videoFrameCount++;
  const now = performance.now();
  if (now - fpsMeasureStart > 1000) {
    measuredVideoFps = videoFrameCount / ((now - fpsMeasureStart) / 1000);
    videoFrameCount = 0;
    fpsMeasureStart = now;
  }
}

// Для большинства браузеров нет onframe, используем requestAnimationFrame + video.currentTime
let lastVideoTime = 0;
function checkVideoFrame() {
  if (video.currentTime !== lastVideoTime) {
    measureVideoFps();
    lastVideoTime = video.currentTime;
  }
  requestAnimationFrame(checkVideoFrame);
}
video.addEventListener('play', () => {
  lastVideoTime = video.currentTime;
  requestAnimationFrame(checkVideoFrame);
});

// --- MediaPipe Pose ---
let pose = null;
let poseKeypoints = [];
function setupPose() {
  pose = new window.Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });
  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  pose.onResults((results) => {
    poseKeypoints = [];
    if (results.poseLandmarks) {
      for (const lm of results.poseLandmarks) {
        poseKeypoints.push({
          x: lm.x * canvas.width,
          y: lm.y * canvas.height
        });
      }
    }
  });
}
setupPose();
async function detectPose() {
  if (video.videoWidth && video.videoHeight && pose) {
    await pose.send({image: video});
  }
}
setInterval(detectPose, 120);

// --- Animation ---
function drawLines() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Линии между видимыми агентами
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.1;
  ctx.globalAlpha = 0.8;
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = true;
  let visibleAgents = agents.filter(a => a.visible);
  for (let i = 0; i < visibleAgents.length; i++) {
    const a = visibleAgents[i];
    const ca = {x: a.x + AGENT_SIZE/2, y: a.y + AGENT_SIZE/2};
    for (let j = i+1; j < visibleAgents.length; j++) {
      const b = visibleAgents[j];
      const cb = {x: b.x + AGENT_SIZE/2, y: b.y + AGENT_SIZE/2};
      const dx = ca.x - cb.x, dy = ca.y - cb.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < LINK_DIST) {
        ctx.beginPath();
        ctx.moveTo(ca.x, ca.y);
        ctx.lineTo(cb.x, cb.y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  // Визуализация bbox-ов (зелёные прямоугольники)
  ctx.save();
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 1.5;
  for (const bbox of detectedBboxes) {
    ctx.strokeRect(bbox[0], bbox[1], bbox[2], bbox[3]);
  }
  ctx.restore();
}

function animate() {
  let now = performance.now();
  let dt = 1/60;
  // Распределяем агентов по keypoints позы, если есть
  let used = 0;
  for (const a of agents) a.visible = false;
  if (poseKeypoints && poseKeypoints.length >= 10) {
    let n = Math.min(poseKeypoints.length, agents.length);
    for (let i = 0; i < n; i++, used++) {
      agents[used].moveTo(poseKeypoints[i], 1400, dt);
      agents[used].visible = true;
    }
  } else if (handsResults && handsResults.length > 0) {
    let n = Math.min(handsResults.length, agents.length);
    for (let i = 0; i < n; i++, used++) {
      agents[used].moveTo(handsResults[i], 1200, dt);
      agents[used].visible = true;
    }
  } else if (detectedTargets.length > 0 && detectedBboxes.length === detectedTargets.length) {
    for (let t = 0; t < detectedTargets.length; t++) {
      let bbox = detectedBboxes[t];
      let n = Math.min(MAX_AGENTS_PER_TARGET, agents.length - used);
      if (n <= 0) break;
      let perim = 2 * (bbox[2] + bbox[3]);
      for (let k = 0; k < n; k++, used++) {
        let p = (perim * k) / n;
        let tx, ty;
        if (p < bbox[2]) { tx = bbox[0] + p; ty = bbox[1]; }
        else if (p < bbox[2] + bbox[3]) { tx = bbox[0] + bbox[2]; ty = bbox[1] + (p - bbox[2]); }
        else if (p < bbox[2] + bbox[3] + bbox[2]) { tx = bbox[0] + bbox[2] - (p - bbox[2] - bbox[3]); ty = bbox[1] + bbox[3]; }
        else { tx = bbox[0]; ty = bbox[1] + bbox[3] - (p - bbox[2] - bbox[3] - bbox[2]); }
        agents[used].moveTo({x: tx, y: ty}, 1200, dt);
        agents[used].visible = true;
      }
    }
  }
  for (; used < agents.length; used++) {
    agents[used].visible = false;
  }
  for (const a of agents) a.updateDOM();
  drawLines();
  requestAnimationFrame(animate);
}
video.addEventListener('playing', () => {
  requestAnimationFrame(animate);
});
