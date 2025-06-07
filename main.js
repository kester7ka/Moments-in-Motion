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

class Agent {
  constructor() {
    this.x = Math.random() * (canvas.width - AGENT_SIZE);
    this.y = Math.random() * (canvas.height - AGENT_SIZE);
    this.vx = 0;
    this.vy = 0;
  }
  moveInstant(target) {
    if (target) {
      this.x = target.x - AGENT_SIZE/2;
      this.y = target.y - AGENT_SIZE/2;
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
  setInterval(updateTargets, 200);
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

function animate() {
  // Равномерно распределяем агентов по целям
  let targets = detectedTargets.length > 0 ? detectedTargets : null;
  for (let i = 0; i < agents.length; i++) {
    let target = null;
    if (targets) {
      target = targets[i % targets.length];
    }
    agents[i].moveInstant(target);
  }
  draw();
  requestAnimationFrame(animate);
}
video.addEventListener('playing', () => {
  requestAnimationFrame(animate);
}); 
