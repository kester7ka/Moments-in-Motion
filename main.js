// Получаем элементы
const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

// Размеры canvas подгоняем под окно
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let currentFacing = 'environment'; // только задняя
let stream = null;

function startCamera(facingMode = 'environment') {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: false })
    .then(s => {
      stream = s;
      video.srcObject = stream;
    })
    .catch(err => {
      alert('Не удалось получить доступ к камере: ' + err);
    });
}

startCamera(currentFacing);

let detectedObjects = [];
let model = null;

// Создаём отдельный canvas для захвата кадра
const hiddenCanvas = document.createElement('canvas');
const hiddenCtx = hiddenCanvas.getContext('2d');

async function loadModel() {
  model = await cocoSsd.load();
}
loadModel();

async function detectObjects() {
  if (!model || video.readyState !== 4) {
    setTimeout(detectObjects, 200);
    return;
  }
  hiddenCanvas.width = video.videoWidth;
  hiddenCanvas.height = video.videoHeight;
  hiddenCtx.drawImage(video, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
  const predictions = await model.detect(hiddenCanvas);
  detectedObjects = predictions;
  setTimeout(detectObjects, 200); // 5 раз в секунду
}
video.addEventListener('loadeddata', detectObjects);

// Класс для прямоугольника
class MovingRect {
  constructor() {
    this.randomize();
    this.target = {x: this.x, y: this.y};
    this.speed = 1000 + Math.random() * 500;
  }
  randomize() {
    this.width = Math.random() * 80 + 40;
    this.height = Math.random() * 80 + 40;
    this.x = Math.random() * (canvas.width - this.width);
    this.y = Math.random() * (canvas.height - this.height);
    this.setNewTarget();
  }
  setNewTarget() {
    // Если есть объекты — летим к ним
    if (detectedObjects.length > 0) {
      const obj = detectedObjects[Math.floor(Math.random() * detectedObjects.length)];
      const scaleX = canvas.width / video.videoWidth;
      const scaleY = canvas.height / video.videoHeight;
      this.target = {
        x: (obj.bbox[0] + obj.bbox[2]/2) * scaleX - this.width/2,
        y: (obj.bbox[1] + obj.bbox[3]/2) * scaleY - this.height/2
      };
      this.targetObjId = obj.id || obj.bbox.join('-');
    } else {
      this.target = {
        x: Math.random() * (canvas.width - this.width),
        y: Math.random() * (canvas.height - this.height)
      };
      this.targetObjId = null;
    }
    this.speed = 1000 + Math.random() * 500;
  }
  move(dt) {
    // Если цель была объект, а он исчез — ищем новую
    if (this.targetObjId && !detectedObjects.some(obj => (obj.id || obj.bbox.join('-')) === this.targetObjId)) {
      this.setNewTarget();
    }
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 10) {
      this.setNewTarget();
      return;
    }
    const moveDist = Math.min(dist, this.speed * dt);
    this.x += dx / dist * moveDist;
    this.y += dy / dist * moveDist;
  }
  draw(ctx, t) {
    // Серый цвет и glow
    ctx.save();
    ctx.shadowColor = 'rgba(180,180,180,0.3)';
    ctx.shadowBlur = 30;
    ctx.strokeStyle = 'rgba(120,120,120,0.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
    ctx.restore();
  }
  center() {
    return {
      x: this.x + this.width / 2,
      y: this.y + this.height / 2
    };
  }
}

// Массив прямоугольников
const rects = Array.from({length: 15}, () => new MovingRect());

function randomizeRects() {
  for (const r of rects) r.randomize();
}
setInterval(randomizeRects, 300); // Резко меняем положение и размер

// Анимация
let lastTime = performance.now();
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // TouchDesigner-стиль: динамичные линии
  ctx.save();
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const c1 = rects[i].center();
      const c2 = rects[j].center();
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      const pulse = 2 + 2 * Math.sin(now/200 + i + j);
      ctx.strokeStyle = `rgba(0,255,255,0.2)`;
      ctx.lineWidth = pulse;
      ctx.shadowColor = `rgba(0,255,255,0.3)`;
      ctx.shadowBlur = 10;
      ctx.stroke();
    }
  }
  ctx.restore();
  // Двигаем и рисуем прямоугольники
  for (const r of rects) {
    r.move(dt);
    r.draw(ctx, now);
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate); 
