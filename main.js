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
    this.targetType = 'random'; // 'object' или 'random'
    this.targetObjId = null;
  }
  randomize() {
    this.width = Math.random() * 80 + 40;
    this.height = Math.random() * 80 + 40;
    this.x = Math.random() * (canvas.width - this.width);
    this.y = Math.random() * (canvas.height - this.height);
    this.setNewTarget();
  }
  setTargetToObject(obj) {
    const scaleX = canvas.width / video.videoWidth;
    const scaleY = canvas.height / video.videoHeight;
    this.target = {
      x: (obj.bbox[0] + obj.bbox[2]/2) * scaleX - this.width/2,
      y: (obj.bbox[1] + obj.bbox[3]/2) * scaleY - this.height/2
    };
    this.targetType = 'object';
    this.targetObjId = obj.id || obj.bbox.join('-');
    this.speed = 1000 + Math.random() * 500;
  }
  setTargetToRandom() {
    this.target = {
      x: Math.random() * (canvas.width - this.width),
      y: Math.random() * (canvas.height - this.height)
    };
    this.targetType = 'random';
    this.targetObjId = null;
    this.speed = 1000 + Math.random() * 500;
  }
  move(dt) {
    // Если цель была объект, а он исчез — ищем новую
    if (this.targetType === 'object' && !detectedObjects.some(obj => (obj.id || obj.bbox.join('-')) === this.targetObjId)) {
      this.setTargetToRandom();
    }
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 10) {
      if (this.targetType === 'random') {
        this.setTargetToRandom();
      } else {
        // Остаёмся на объекте, пока он есть
      }
      return;
    }
    const moveDist = Math.min(dist, this.speed * dt);
    this.x += dx / dist * moveDist;
    this.y += dy / dist * moveDist;
  }
  draw(ctx, t) {
    // Белый цвет и glow
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur = 30;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 4;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
    ctx.restore();
    // Координаты под квадратом
    ctx.save();
    ctx.font = '18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'white';
    const cx = this.x + this.width/2;
    const cy = this.y + this.height + 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 4;
    ctx.strokeText(`(${Math.round(cx)}, ${Math.round(cy)})`, cx, cy);
    ctx.fillText(`(${Math.round(cx)}, ${Math.round(cy)})`, cx, cy);
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

// Назначаем квадраты к объектам (один к одному, остальные — к случайным)
function assignRectsToObjects() {
  // Сохраняем старые назначения
  const usedObjIds = new Set();
  // Сначала назначаем квадраты к объектам
  for (let i = 0; i < rects.length; i++) {
    if (i < detectedObjects.length) {
      const obj = detectedObjects[i];
      rects[i].setTargetToObject(obj);
      usedObjIds.add(obj.id || obj.bbox.join('-'));
    } else if (rects[i].targetType !== 'random') {
      rects[i].setTargetToRandom();
    }
  }
}
setInterval(assignRectsToObjects, 200); // переназначаем цели 5 раз в секунду

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
