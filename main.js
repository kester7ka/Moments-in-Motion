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
      resizeCanvasToDisplaySize();
    };
  })
  .catch(e => alert('Нет доступа к камере: ' + e));

// Retina canvas
function resizeCanvasToDisplaySize() {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(window.innerWidth);
  const height = Math.round(window.innerHeight);
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

// --- Agent (square) setup ---
const AGENT_SIZE = 10;
const AGENT_COUNT = 50;
const LINK_DIST = 80;
const AGENT_SPEED = 2000; // px/sec, очень быстро
const AGENT_REPEL_DIST = 18; // минимальное расстояние между агентами
const AGENT_REPEL_FORCE = 4000; // сила отталкивания
const MAX_AGENTS_PER_TARGET = 15;
const AGENT_SMOOTH_ALPHA = 0.13; // коэффициент плавности (0.1-0.2 — очень плавно)

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
    if (target) {
      const tx = target.x - AGENT_SIZE/2;
      const ty = target.y - AGENT_SIZE/2;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 1) {
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
      let fx = (Math.random() - 0.5) * 200;
      let fy = (Math.random() - 0.5) * 200;
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
            x: lm.x, // относительные координаты (0..1)
            y: lm.y
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

// Объединяем все цели
async function updateTargets() {
  if (detectToggle) {
    const cocoTargets = await detectObjects() || [];
    detectedTargets = cocoTargets;
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
  setInterval(updateTargets, 120); // чуть чаще для лучшего распознавания руки
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // object-fit: cover для видео
  const winW = window.innerWidth, winH = window.innerHeight;
  const {scale, offsetX, offsetY} = getCoverTransform(W, H, winW, winH);
  ctx.drawImage(video, 0, 0, W, H, offsetX, offsetY, W * scale, H * scale);
  // Линии
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
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
        if (dist < 60) {
          // Изогнутая линия (квадратичная кривая)
          const mx = (ca.x + cb.x) / 2;
          const my = (ca.y + cb.y) / 2;
          const perp = {x: -(cb.y - ca.y), y: cb.x - ca.x};
          const norm = Math.sqrt(perp.x*perp.x + perp.y*perp.y) || 1;
          const curveAmount = Math.min(16, dist/2.5);
          const cx = mx + (perp.x / norm) * curveAmount;
          const cy = my + (perp.y / norm) * curveAmount;
          ctx.moveTo(
            offsetX + ca.x * scale,
            offsetY + ca.y * scale
          );
          ctx.quadraticCurveTo(
            offsetX + cx * scale,
            offsetY + cy * scale,
            offsetX + cb.x * scale,
            offsetY + cb.y * scale
          );
        } else {
          ctx.moveTo(offsetX + ca.x * scale, offsetY + ca.y * scale);
          ctx.lineTo(offsetX + cb.x * scale, offsetY + cb.y * scale);
        }
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  // Квадраты
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 1;
  for (const agent of agents) {
    if (!agent.visible) continue;
    ctx.strokeRect(
      Math.round(offsetX + agent.x * scale) + 0.5,
      Math.round(offsetY + agent.y * scale) + 0.5,
      AGENT_SIZE * scale,
      AGENT_SIZE * scale
    );
  }
  ctx.restore();
  // Координаты
  ctx.save();
  ctx.font = `bold ${Math.round(10 * scale)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const agent of agents) {
    if (!agent.visible) continue;
    const cx = offsetX + (agent.x + AGENT_SIZE/2) * scale;
    const cy = offsetY + (agent.y + AGENT_SIZE) * scale + 2;
    const text = `${Math.round(agent.x)},${Math.round(agent.y)}`;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.globalAlpha = 0.7;
    ctx.fillText(text, cx+1, cy+1);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = 1;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }
  ctx.restore();
}

function animate() {
  let handLandmarks = (handsResults && handsResults.length >= 5)
    ? handsResults.map(lm => ({x: lm.x * W, y: lm.y * H}))
    : null;
  let now = performance.now();
  let targetFps = Math.max(30, Math.min(60, Math.round(measuredVideoFps)));
  let dt = 1 / targetFps;
  animate.lastTime = now;
  for (const agent of agents) agent.visible = false;
  let used = 0;
  if (handLandmarks && handLandmarks.length > 0) {
    let n = Math.min(handLandmarks.length, agents.length);
    for (let i = 0; i < n; i++, used++) {
      agents[used].moveSmart(handLandmarks[i], dt, agents);
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
        agents[used].moveSmart({x: tx, y: ty}, dt, agents);
        agents[used].visible = true;
      }
    }
  }
  // Если целей нет — все агенты хаотично двигаются
  if (used === 0) {
    for (let i = 0; i < agents.length; i++) {
      agents[i].moveSmart(null, dt, agents);
      agents[i].visible = true;
    }
  } else {
    for (; used < agents.length; used++) {
      agents[used].x = -1000;
      agents[used].y = -1000;
      agents[used].visible = false;
    }
  }
  draw();
  requestAnimationFrame(animate);
}
video.addEventListener('playing', () => {
  requestAnimationFrame(animate);
});

window.addEventListener('resize', resizeCanvasToDisplaySize);

// --- Object-fit: cover utils ---
function getCoverTransform(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  let scale, offsetX, offsetY;
  if (srcRatio > dstRatio) {
    // Источник шире — crop по ширине
    scale = dstH / srcH;
    offsetX = (dstW - srcW * scale) / 2;
    offsetY = 0;
  } else {
    // Источник выше — crop по высоте
    scale = dstW / srcW;
    offsetX = 0;
    offsetY = (dstH - srcH * scale) / 2;
  }
  return {scale, offsetX, offsetY};
} 
