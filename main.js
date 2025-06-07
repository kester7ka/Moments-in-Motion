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
const AGENT_SIZE = 10;
const AGENT_COUNT = 50;
const LINK_DIST = 80;
const AGENT_SPEED = 400; // px/sec, плавно
const AGENT_REPEL_DIST = 18; // минимальное расстояние между агентами
const AGENT_REPEL_FORCE = 4000; // сила отталкивания
const MAX_AGENTS_PER_TARGET = 15;

class Agent {
  constructor() {
    this.x = Math.random() * (canvas.width - AGENT_SIZE);
    this.y = Math.random() * (canvas.height - AGENT_SIZE);
    this.vx = 0;
    this.vy = 0;
    this.target = null;
    this.visible = true;
  }
  moveSmart(target, dt, agents) {
    let fx = 0, fy = 0;
    // Притяжение к цели (плавно, без телепортации)
    if (target) {
      const tx = target.x - AGENT_SIZE/2;
      const ty = target.y - AGENT_SIZE/2;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 1) {
        // Плавное движение: ограничиваем максимальное перемещение за кадр
        const maxStep = AGENT_SPEED * dt;
        if (dist < maxStep) {
          this.x = tx;
          this.y = ty;
        } else {
          this.x += (dx / dist) * maxStep;
          this.y += (dy / dist) * maxStep;
        }
      }
    } else {
      // хаотичное движение
      fx += (Math.random() - 0.5) * 200;
      fy += (Math.random() - 0.5) * 200;
      const len = Math.sqrt(fx*fx + fy*fy);
      if (len > AGENT_SPEED) {
        fx = fx / len * AGENT_SPEED;
        fy = fy / len * AGENT_SPEED;
      }
      this.x += fx * dt;
      this.y += fy * dt;
    }
    // Отталкивание от других агентов
    for (const other of agents) {
      if (other === this) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < AGENT_REPEL_DIST && dist > 0.1) {
        const force = AGENT_REPEL_FORCE / (dist * dist);
        this.x += (dx / dist) * force * dt * 0.5;
        this.y += (dy / dist) * force * dt * 0.5;
      }
    }
    // Границы
    if (this.x < 0) this.x = 0;
    if (this.x > canvas.width - AGENT_SIZE) this.x = canvas.width - AGENT_SIZE;
    if (this.y < 0) this.y = 0;
    if (this.y > canvas.height - AGENT_SIZE) this.y = canvas.height - AGENT_SIZE;
  }
  center() {
    return {x: this.x + AGENT_SIZE/2, y: this.y + AGENT_SIZE/2};
  }
}
const agents = Array.from({length: AGENT_COUNT}, () => new Agent());

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
    if (conf < 0.35) continue;
    let maxClass = 0, maxScore = 0;
    for (let c = 0; c < 80; c++) {
      const score = output[i * 84 + 5 + c];
      if (score > maxScore) { maxScore = score; maxClass = c; }
    }
    if (maxScore * conf < 0.35) continue;
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

// --- Animation ---
function draw() {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Линии — ярко-белые
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < agents.length; i++) {
    if (!agents[i].visible) continue;
    const a = agents[i];
    const ca = a.center();
    for (let j = i+1; j < agents.length; j++) {
      if (!agents[j].visible) continue;
      const b = agents[j];
      const cb = b.center();
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
  // Квадраты — ярко-белые с glow
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 3;
  for (const agent of agents) {
    if (!agent.visible) continue;
    ctx.globalAlpha = 1;
    ctx.strokeRect(agent.x, agent.y, AGENT_SIZE, AGENT_SIZE);
  }
  ctx.restore();
  // Визуализация bbox-ов (зелёные прямоугольники)
  ctx.save();
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 2;
  for (const bbox of detectedBboxes) {
    ctx.strokeRect(bbox[0], bbox[1], bbox[2], bbox[3]);
  }
  ctx.restore();
}

function animate() {
  // Распределяем агентов по landmark-ам руки, если они есть
  let handLandmarks = (handsResults && handsResults.length >= 5) ? handsResults : null;
  let now = performance.now();
  let targetFps = Math.max(30, Math.min(60, Math.round(measuredVideoFps)));
  let dt = 1 / targetFps;
  animate.lastTime = now;

  // Скрываем всех агентов по умолчанию
  for (const agent of agents) agent.visible = false;

  let used = 0;
  if (handLandmarks && handLandmarks.length > 0) {
    // Landmark-ы руки: максимум по одному агенту на landmark
    let n = Math.min(handLandmarks.length, agents.length);
    for (let i = 0; i < n; i++, used++) {
      agents[used].moveSmart(handLandmarks[i], dt, agents);
      agents[used].visible = true;
    }
  } else if (detectedTargets.length > 0 && detectedBboxes.length === detectedTargets.length) {
    // Для bbox-целей (объекты) — агенты по периметру bbox
    for (let t = 0; t < detectedTargets.length; t++) {
      let bbox = detectedBboxes[t];
      let n = Math.min(MAX_AGENTS_PER_TARGET, agents.length - used);
      if (n <= 0) break;
      // Периметр прямоугольника
      let perim = 2 * (bbox[2] + bbox[3]);
      for (let k = 0; k < n; k++, used++) {
        let p = (perim * k) / n;
        let tx, ty;
        if (p < bbox[2]) { // верхняя грань
          tx = bbox[0] + p;
          ty = bbox[1];
        } else if (p < bbox[2] + bbox[3]) { // правая грань
          tx = bbox[0] + bbox[2];
          ty = bbox[1] + (p - bbox[2]);
        } else if (p < bbox[2] + bbox[3] + bbox[2]) { // нижняя грань
          tx = bbox[0] + bbox[2] - (p - bbox[2] - bbox[3]);
          ty = bbox[1] + bbox[3];
        } else { // левая грань
          tx = bbox[0];
          ty = bbox[1] + bbox[3] - (p - bbox[2] - bbox[3] - bbox[2]);
        }
        agents[used].moveSmart({x: tx, y: ty}, dt, agents);
        agents[used].visible = true;
      }
    }
  }
  // Остальные агенты скрываем (перемещаем за пределы canvas)
  for (; used < agents.length; used++) {
    agents[used].x = -1000;
    agents[used].y = -1000;
    agents[used].visible = false;
  }
  draw();
  requestAnimationFrame(animate);
}
video.addEventListener('playing', () => {
  requestAnimationFrame(animate);
}); 
