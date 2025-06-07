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

class Agent {
  constructor() {
    this.x = Math.random() * (canvas.width - AGENT_SIZE);
    this.y = Math.random() * (canvas.height - AGENT_SIZE);
    this.vx = 0;
    this.vy = 0;
    this.target = null;
  }
  moveSmart(target, dt) {
    if (target) {
      // Летим к цели с большой скоростью
      const tx = target.x - AGENT_SIZE/2;
      const ty = target.y - AGENT_SIZE/2;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < AGENT_SPEED * dt) {
        this.x = tx;
        this.y = ty;
      } else {
        this.x += (dx / dist) * AGENT_SPEED * dt;
        this.y += (dy / dist) * AGENT_SPEED * dt;
      }
    } else {
      // хаотичное движение
      this.x += (Math.random() - 0.5) * 10;
      this.y += (Math.random() - 0.5) * 10;
      if (this.x < 0) this.x = 0;
      if (this.x > canvas.width - AGENT_SIZE) this.x = canvas.width - AGENT_SIZE;
      if (this.y < 0) this.y = 0;
      if (this.y > canvas.height - AGENT_SIZE) this.y = canvas.height - AGENT_SIZE;
    }
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
  setInterval(updateTargets, 50); // быстрее обновляем цели
});

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
  // Квадраты — ярко-белые с glow
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 3;
  for (const agent of agents) {
    ctx.globalAlpha = 1;
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

function animate() {
  // Распределяем агентов по объектам
  let targets = detectedTargets.length > 0 ? detectedTargets : null;
  let now = performance.now();
  let dt = (typeof animate.lastTime === 'number') ? (now - animate.lastTime) / 1000 : 0.016;
  animate.lastTime = now;

  if (targets) {
    // Группируем агентов по объектам
    let perObj = Math.floor(agents.length / targets.length);
    let extra = agents.length % targets.length;
    let idx = 0;
    for (let t = 0; t < targets.length; t++) {
      let n = perObj + (t < extra ? 1 : 0);
      for (let k = 0; k < n; k++, idx++) {
        // Для каждого агента вокруг объекта — размещаем по кругу
        let angle = (2 * Math.PI * k) / n;
        let radius = 30 + 10 * (k % 3); // чуть разнесём по радиусу
        let tx = targets[t].x + Math.cos(angle) * radius;
        let ty = targets[t].y + Math.sin(angle) * radius;
        agents[idx].moveSmart({x: tx, y: ty}, dt);
      }
    }
    // Если агентов больше, чем целей, оставшиеся хаотично
    for (; idx < agents.length; idx++) {
      agents[idx].moveSmart(null, dt);
    }
  } else {
    for (let i = 0; i < agents.length; i++) {
      agents[i].moveSmart(null, dt);
    }
  }
  draw();
  requestAnimationFrame(animate);
}
video.addEventListener('playing', () => {
  requestAnimationFrame(animate);
}); 
