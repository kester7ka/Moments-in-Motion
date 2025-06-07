const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W = window.innerWidth, H = window.innerHeight;
canvas.width = W;
canvas.height = H;
window.addEventListener('resize', () => {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
});

// --- Camera setup ---
const video = document.createElement('video');
video.autoplay = true;
video.playsInline = true;
video.style.display = 'none';
navigator.mediaDevices.getUserMedia({video: true, audio: false})
  .then(stream => { video.srcObject = stream; })
  .catch(e => alert('Нет доступа к камере: ' + e));

// --- Agent (square) setup ---
const AGENT_SIZE = 10;
const AGENT_COUNT = 100;
const AGENT_SPEED = 30; // px/sec
const STICK_THRESHOLD = 30; // разница яркости для "залипания"
const MOTION_CHECK_INTERVAL = 120; // ms
const LINK_DIST = 80;

class Agent {
  constructor() {
    this.x = Math.random() * (W - AGENT_SIZE);
    this.y = Math.random() * (H - AGENT_SIZE);
    const angle = Math.random() * 2 * Math.PI;
    this.vx = Math.cos(angle) * AGENT_SPEED;
    this.vy = Math.sin(angle) * AGENT_SPEED;
    this.stuck = false;
  }
  move(dt) {
    if (this.stuck) return;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Отскок от краёв
    if (this.x < 0) { this.x = 0; this.vx *= -1; }
    if (this.x > W - AGENT_SIZE) { this.x = W - AGENT_SIZE; this.vx *= -1; }
    if (this.y < 0) { this.y = 0; this.vy *= -1; }
    if (this.y > H - AGENT_SIZE) { this.y = H - AGENT_SIZE; this.vy *= -1; }
  }
  center() {
    return {x: this.x + AGENT_SIZE/2, y: this.y + AGENT_SIZE/2};
  }
}
const agents = Array.from({length: AGENT_COUNT}, () => new Agent());

// --- Motion detection ---
let prevFrame = null;
function getFrameData() {
  ctx.drawImage(video, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}
function checkMotion() {
  if (!prevFrame) {
    prevFrame = getFrameData();
    return;
  }
  const currFrame = getFrameData();
  for (const agent of agents) {
    if (agent.stuck) continue;
    const cx = Math.floor(agent.x + AGENT_SIZE/2);
    const cy = Math.floor(agent.y + AGENT_SIZE/2);
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const idx = (cy * W + cx) * 4;
    const r1 = prevFrame.data[idx];
    const r2 = currFrame.data[idx];
    if (Math.abs(r1 - r2) > STICK_THRESHOLD) {
      agent.stuck = true;
    }
  }
  prevFrame = currFrame;
}
setInterval(checkMotion, MOTION_CHECK_INTERVAL);

// --- Animation ---
function draw() {
  // 1. Нарисовать видео
  ctx.drawImage(video, 0, 0, W, H);
  // 2. Нарисовать связи
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
  // 3. Нарисовать квадраты
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  for (const agent of agents) {
    ctx.globalAlpha = agent.stuck ? 1 : 0.6;
    ctx.strokeRect(agent.x, agent.y, AGENT_SIZE, AGENT_SIZE);
  }
  ctx.restore();
}
let lastTime = performance.now();
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  for (const agent of agents) agent.move(dt);
  draw();
  requestAnimationFrame(animate);
}
video.addEventListener('playing', () => {
  lastTime = performance.now();
  requestAnimationFrame(animate);
});
