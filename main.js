const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W, H;

const video = document.createElement('video');
video.autoplay = true;
video.playsInline = true;
video.style.display = 'none';

navigator.mediaDevices.getUserMedia({video: { facingMode: { exact: 'environment' } }, audio: false})
  .then(stream => {
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      W = video.videoWidth;
      H = video.videoHeight;
      canvas.width = W;
      canvas.height = H;
    };
  })
  .catch(e => alert('Нет доступа к камере: ' + e));

// --- Agent (square) setup ---
const AGENT_SIZE = 10;
const AGENT_COUNT = 100;
const LINK_DIST = 80;
const AGENT_SPEED = 1000; // px/sec, очень быстро
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
    // Притяжение к цели
    if (target) {
      const tx = target.x - AGENT_SIZE/2;
      const ty = target.y - AGENT_SIZE/2;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 1) {
        fx += (dx / dist) * AGENT_SPEED;
        fy += (dy / dist) * AGENT_SPEED;
      }
    } else {
      // хаотичное движение
      fx += (Math.random() - 0.5) * 200;
      fy += (Math.random() - 0.5) * 200;
    }
    // Отталкивание от других агентов
    for (const other of agents) {
      if (other === this) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < AGENT_REPEL_DIST && dist > 0.1) {
        const force = AGENT_REPEL_FORCE / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
    }
    // Итоговое перемещение
    const len = Math.sqrt(fx*fx + fy*fy);
    if (len > AGENT_SPEED) {
      fx = fx / len * AGENT_SPEED;
      fy = fy / len * AGENT_SPEED;
    }
    this.x += fx * dt;
    this.y += fy * dt;
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

// COCO-SSD
async function detectObjects() {
  if (!cocoModel || !video.videoWidth || !video.videoHeight) return;
  const predictions = await cocoModel.detect(video);
  return predictions.map(obj => ({
    x: obj.bbox[0] + obj.bbox[2]/2,
    y: obj.bbox[1] + obj.bbox[3]/2
  }));
}

// Объединяем все цели
async function updateTargets() {
  const cocoTargets = await detectObjects() || [];
  await detectHands();
  detectedTargets = [...cocoTargets, ...handsResults];
}
cocoSsd.load().then(model => {
  cocoModel = model;
  setInterval(updateTargets, 120); // оптимальная частота
});

// Включаем WebGL backend для TensorFlow.js
if (window.tf && tf.setBackend) tf.setBackend('webgl');

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
  // Показываем все найденные цели (detectedTargets) красными кружками
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'red';
  for (const t of detectedTargets) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, 7, 0, 2*Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

function animate() {
  // Распределяем агентов по landmark-ам руки, если они есть
  let handLandmarks = (handsResults && handsResults.length >= 5) ? handsResults : null;
  let now = performance.now();
  let dt = (typeof animate.lastTime === 'number') ? (now - animate.lastTime) / 1000 : 0.016;
  animate.lastTime = now;

  // Скрываем всех агентов по умолчанию
  for (const agent of agents) agent.visible = false;

  let used = 0;
  if (handLandmarks && handLandmarks.length > 0) {
    // Landmark-ы руки: максимум по одному агенту на landmark
    let n = Math.min(handLandmarks.length, agents.length, MAX_AGENTS_PER_TARGET);
    for (let i = 0; i < n; i++, used++) {
      agents[used].moveSmart(handLandmarks[i], dt, agents);
      agents[used].visible = true;
    }
  } else if (detectedTargets.length > 0) {
    // Для bbox-целей (объекты) — вычисляем нужное число агентов по размеру bbox
    for (let t = 0; t < detectedTargets.length; t++) {
      // Для COCO-SSD bbox-ы не сохраняются, поэтому вычислим примерный размер по соседним целям
      // (или можно доработать детекцию, чтобы сохранять bbox)
      // Здесь просто используем фиксированный радиус
      let center = detectedTargets[t];
      let n = Math.min(MAX_AGENTS_PER_TARGET, agents.length - used);
      if (n <= 0) break;
      // Можно сделать n пропорциональным размеру объекта, если есть bbox
      let radius = 30;
      for (let k = 0; k < n; k++, used++) {
        let angle = (2 * Math.PI * k) / n;
        let tx = center.x + Math.cos(angle) * radius;
        let ty = center.y + Math.sin(angle) * radius;
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
