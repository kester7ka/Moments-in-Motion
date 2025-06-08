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

// --- Color clustering and bbox by color ---
const GRID_SIZE = 20;
const COLOR_THRESHOLD = 40; // чем меньше, тем строже группировка по цвету
function colorDist(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}
function groupColorBoxes(grid) {
  const groups = [];
  for (const cell of grid) {
    let found = false;
    for (const group of groups) {
      if (colorDist(cell.rgb, group.rgb) < COLOR_THRESHOLD) {
        group.cells.push(cell);
        // обновим средний цвет группы
        group.rgb[0] = Math.round((group.rgb[0]*group.cells.length + cell.rgb[0])/(group.cells.length+1));
        group.rgb[1] = Math.round((group.rgb[1]*group.cells.length + cell.rgb[1])/(group.cells.length+1));
        group.rgb[2] = Math.round((group.rgb[2]*group.cells.length + cell.rgb[2])/(group.cells.length+1));
        found = true;
        break;
      }
    }
    if (!found) {
      groups.push({rgb: [...cell.rgb], color: cell.color, cells: [cell]});
    }
  }
  // Для каждой группы строим bbox
  for (const group of groups) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cell of group.cells) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
    group.bbox = [minX, minY, maxX-minX, maxY-minY];
  }
  return groups;
}

// --- Color grid analysis ---
function getColorGrid() {
  const w = canvas.width, h = canvas.height;
  const cellW = Math.floor(w / GRID_SIZE);
  const cellH = Math.floor(h / GRID_SIZE);
  const imgData = ctx.getImageData(0, 0, w, h).data;
  const grid = [];
  for (let gy = 0; gy < GRID_SIZE; gy++) {
    for (let gx = 0; gx < GRID_SIZE; gx++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let y = gy * cellH; y < (gy+1)*cellH; y++) {
        for (let x = gx * cellW; x < (gx+1)*cellW; x++) {
          const idx = (y * w + x) * 4;
          r += imgData[idx];
          g += imgData[idx+1];
          b += imgData[idx+2];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      grid.push({
        x: gx * cellW + cellW/2,
        y: gy * cellH + cellH/2,
        color: rgbToHex(r, g, b),
        rgb: [r, g, b]
      });
    }
  }
  return grid;
}
function rgbToHex(r, g, b) {
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

// --- Animation ---
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Линии — белые, изогнутые если близко, прямые если далеко
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
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
          ctx.moveTo(ca.x, ca.y);
          ctx.quadraticCurveTo(cx, cy, cb.x, cb.y);
        } else {
          // Прямая линия
          ctx.moveTo(ca.x, ca.y);
          ctx.lineTo(cb.x, cb.y);
        }
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  // Квадраты и подписи
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 1;
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const agent of agents) {
    if (!agent.visible) continue;
    ctx.strokeRect(Math.round(agent.x)+0.5, Math.round(agent.y)+0.5, AGENT_SIZE, AGENT_SIZE);
    // Цвет под агентом
    const cx = agent.x + AGENT_SIZE/2;
    const cy = agent.y + AGENT_SIZE + 2;
    const text = agent.color || '#------';
    // Тень для читаемости
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
  // Анализируем цвета
  let colorGrid = getColorGrid();
  let colorGroups = groupColorBoxes(colorGrid);
  // Landmark-ы руки
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
      // Цвет в точке landmark
      const px = Math.round(handLandmarks[i].x);
      const py = Math.round(handLandmarks[i].y);
      const imgData = ctx.getImageData(px, py, 1, 1).data;
      agents[used].color = rgbToHex(imgData[0], imgData[1], imgData[2]);
    }
  }
  // Остальные агенты — по цветовым боксам
  for (let g = 0; used < agents.length && g < colorGroups.length; g++) {
    const group = colorGroups[g];
    // Распределяем агентов по периметру bbox группы
    const n = Math.min(MAX_AGENTS_PER_TARGET, agents.length - used);
    if (n <= 0) break;
    const [x, y, w, h] = group.bbox;
    const perim = 2 * (w + h);
    for (let k = 0; k < n && used < agents.length; k++, used++) {
      let p = (perim * k) / n;
      let tx, ty;
      if (p < w) { // верхняя грань
        tx = x + p;
        ty = y;
      } else if (p < w + h) { // правая грань
        tx = x + w;
        ty = y + (p - w);
      } else if (p < w + h + w) { // нижняя грань
        tx = x + w - (p - w - h);
        ty = y + h;
      } else { // левая грань
        tx = x;
        ty = y + h - (p - w - h - w);
      }
      agents[used].moveSmart({x: tx, y: ty}, dt, agents);
      agents[used].visible = true;
      agents[used].color = group.color;
    }
  }
  // Остальные скрываем
  for (; used < agents.length; used++) {
    agents[used].x = -1000;
    agents[used].y = -1000;
    agents[used].visible = false;
    agents[used].color = '';
  }
  draw();
  requestAnimationFrame(animate);
}
video.addEventListener('playing', () => {
  requestAnimationFrame(animate);
}); 
