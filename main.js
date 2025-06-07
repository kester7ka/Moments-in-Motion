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
const AGENT_SPEED = 60; // px/sec
const LINK_DIST = 80;

class Agent {
  constructor() {
    this.x = Math.random() * (canvas.width - AGENT_SIZE);
    this.y = Math.random() * (canvas.height - AGENT_SIZE);
    this.vx = 0;
    this.vy = 0;
    this.stuck = false;
  }
  move(dt, targets) {
    if (this.stuck) return;
    let tx = null, ty = null;
    if (targets && targets.length > 0) {
      // Найти ближайшую цель
      let minDist = Infinity;
      for (const t of targets) {
        const dx = t.x - this.x, dy = t.y - this.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < minDist) {
          minDist = dist;
          tx = t.x; ty = t.y;
        }
      }
    }
    if (tx !== null && ty !== null) {
      // Двигаться к цели
      const dx = tx - this.x, dy = ty - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 1) {
        this.vx = (dx / dist) * AGENT_SPEED;
        this.vy = (dy / dist) * AGENT_SPEED;
      } else {
        this.vx = 0; this.vy = 0;
      }
    } else {
      // Случайное движение
      if (Math.abs(this.vx) < 1 && Math.abs(this.vy) < 1) {
        const angle = Math.random() * 2 * Math.PI;
        this.vx = Math.cos(angle) * AGENT_SPEED * 0.5;
        this.vy = Math.sin(angle) * AGENT_SPEED * 0.5;
      }
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Отскок от краёв
    if (this.x < 0) { this.x = 0; this.vx *= -1; }
    if (this.x > canvas.width - AGENT_SIZE) { this.x = canvas.width - AGENT_SIZE; this.vx *= -1; }
    if (this.y < 0) { this.y = 0; this.vy *= -1; }
    if (this.y > canvas.height - AGENT_SIZE) { this.y = canvas.height - AGENT_SIZE; this.vy *= -1; }
  }
  center() {
    return {x: this.x + AGENT_SIZE/2, y: this.y + AGENT_SIZE/2};
  }
}
const agents = Array.from({length: AGENT_COUNT}, () => new Agent());

// --- Face detection ---
let detectedTargets = [];
async function detectObjects() {
  if (!video.videoWidth || !video.videoHeight) return;
  const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions());
  detectedTargets = detections.map(det => ({
    x: det.box.x + det.box.width/2,
    y: det.box.y + det.box.height/2
  }));
}
async function loadModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights');
}
loadModels();
setInterval(detectObjects, 200);

// --- Animation ---
function draw() {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Линии
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const ca = a.center();
    for (let j = i+1; j < agents.length; j++) {
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
  // Квадраты
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  for (const agent of agents) {
    ctx.globalAlpha = 0.8;
    ctx.strokeRect(agent.x, agent.y, AGENT_SIZE, AGENT_SIZE);
  }
  ctx.restore();
  // (опционально) показать цели
  // for (const t of detectedTargets) {
  //   ctx.beginPath();
  //   ctx.arc(t.x, t.y, 8, 0, 2*Math.PI);
  //   ctx.strokeStyle = 'red';
  //   ctx.stroke();
  // }
}
let lastTime = performance.now();
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  for (const agent of agents) agent.move(dt, detectedTargets);
  draw();
  requestAnimationFrame(animate);
}
video.addEventListener('playing', () => {
  lastTime = performance.now();
  requestAnimationFrame(animate);
}); 
