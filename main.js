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

// Для bbox-целей (объекты) — распределяем агентов по периметру bbox
// Для этого нужно сохранять bbox из Coco-SSD
let detectedBboxes = [];
async function detectObjects() {
  if (!cocoModel || !video.videoWidth || !video.videoHeight) return;
  const predictions = await cocoModel.detect(video);
  detectedBboxes = predictions.map(obj => obj.bbox); // [x, y, w, h]
  return predictions.map(obj => ({
    x: obj.bbox[0] + obj.bbox[2]/2,
    y: obj.bbox[1] + obj.bbox[3]/2
  }));
}

// --- MoveNet Pose Detection ---
let poseDetector = null;
let detectedPoses = [];
async function setupPose() {
  poseDetector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: 'Lightning',
    enableSmoothing: true
  });
}
setupPose();
async function detectPose() {
  if (!poseDetector || !video.videoWidth || !video.videoHeight) return;
  const poses = await poseDetector.estimatePoses(video);
  detectedPoses = poses;
}

// В updateTargets чередуем: coco, hands, pose
let detectStep = 0;
async function updateTargets() {
  if (detectStep % 3 === 0) {
    const cocoTargets = await detectObjects() || [];
    detectedTargets = cocoTargets;
  } else if (detectStep % 3 === 1) {
    await detectHands();
    if (handsResults && handsResults.length > 0) {
      detectedTargets = handsResults;
    }
  } else {
    await detectPose();
  }
  detectStep++;
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
  // devicePixelRatio для чёткого сглаживания
  if (canvas.width !== W * window.devicePixelRatio || canvas.height !== H * window.devicePixelRatio) {
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, W, H);
  // Линии — тонкие, белые, сглаженные
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Прямые линии
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
  // Изогнутые линии (кривые Безье между некоторыми агентами)
  for (let i = 0; i < agents.length-2; i+=3) {
    if (!agents[i].visible || !agents[i+1].visible || !agents[i+2].visible) continue;
    const a = agents[i].center();
    const b = agents[i+1].center();
    const c = agents[i+2].center();
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.bezierCurveTo(b.x, b.y, b.x, b.y, c.x, c.y);
    ctx.stroke();
  }
  ctx.restore();
  // Квадраты — тонкие, белые, без тени, без градиента, без закругления
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const agent of agents) {
    if (!agent.visible) continue;
    ctx.globalAlpha = 1;
    ctx.strokeRect(agent.x, agent.y, AGENT_SIZE, AGENT_SIZE);
  }
  ctx.restore();
  // Визуализация bbox-ов (зелёные прямоугольники) только для предметов (не людей)
  ctx.save();
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 2;
  for (let i = 0; i < detectedBboxes.length; i++) {
    // Если есть поза и bbox пересекается с человеком — не рисуем
    let skip = false;
    for (const pose of detectedPoses) {
      if (pose.keypoints && pose.keypoints.length > 0) {
        for (const kp of pose.keypoints) {
          if (kp.x >= detectedBboxes[i][0] && kp.x <= detectedBboxes[i][0]+detectedBboxes[i][2] &&
              kp.y >= detectedBboxes[i][1] && kp.y <= detectedBboxes[i][1]+detectedBboxes[i][3]) {
            skip = true;
            break;
          }
        }
      }
    }
    if (!skip) ctx.strokeRect(detectedBboxes[i][0], detectedBboxes[i][1], detectedBboxes[i][2], detectedBboxes[i][3]);
  }
  ctx.restore();
  // Визуализация скелета человека (суставы и кости)
  ctx.save();
  ctx.strokeStyle = '#0ff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pose of detectedPoses) {
    if (pose.keypoints && pose.keypoints.length > 0) {
      // Кости (связи между суставами)
      const edges = [
        [0,1],[1,2],[2,3],[3,4], // правая рука
        [0,5],[5,6],[6,7],[7,8], // левая рука
        [5,11],[11,12],[12,6],   // туловище
        [11,13],[13,15],         // левая нога
        [12,14],[14,16]          // правая нога
      ];
      for (const [a,b] of edges) {
        if (pose.keypoints[a] && pose.keypoints[b] && pose.keypoints[a].score > 0.3 && pose.keypoints[b].score > 0.3) {
          ctx.beginPath();
          ctx.moveTo(pose.keypoints[a].x, pose.keypoints[a].y);
          ctx.lineTo(pose.keypoints[b].x, pose.keypoints[b].y);
          ctx.stroke();
        }
      }
      // Суставы
      for (const kp of pose.keypoints) {
        if (kp.score > 0.3) {
          ctx.beginPath();
          ctx.arc(kp.x, kp.y, 4, 0, 2*Math.PI);
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
      }
    }
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
