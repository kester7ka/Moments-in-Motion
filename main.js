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

function getLargestObjects(n) {
  // Сортируем по площади bbox (самые крупные объекты)
  return detectedObjects
    .slice()
    .sort((a, b) => (b.bbox[2] * b.bbox[3]) - (a.bbox[2] * a.bbox[3]))
    .slice(0, n);
}

// Класс для прямоугольника
class MovingRect {
  constructor(idx) {
    this.idx = idx;
    this.randomize();
    this.target = {x: this.x, y: this.y};
    this.speed = 1000 + Math.random() * 500;
    this.targetObjId = null;
    this.isObject = false;
    this.width = 60;
    this.height = 60;
  }
  randomize() {
    this.width = 40 + Math.random() * 80;
    this.height = 40 + Math.random() * 80;
    this.x = Math.random() * (canvas.width - this.width);
    this.y = Math.random() * (canvas.height - this.height);
    this.setNewTarget();
  }
  setNewTarget() {
    const largest = getLargestObjects(rects.length);
    if (largest[this.idx]) {
      const obj = largest[this.idx];
      const scaleX = canvas.width / video.videoWidth;
      const scaleY = canvas.height / video.videoHeight;
      this.target = {
        x: obj.bbox[0] * scaleX,
        y: obj.bbox[1] * scaleY
      };
      this.width = obj.bbox[2] * scaleX;
      this.height = obj.bbox[3] * scaleY;
      this.targetObjId = obj.id || obj.bbox.join('-');
      this.isObject = true;
    } else {
      this.target = {
        x: Math.random() * (canvas.width - this.width),
        y: Math.random() * (canvas.height - this.height)
      };
      this.width = 40 + Math.random() * 80;
      this.height = 40 + Math.random() * 80;
      this.targetObjId = null;
      this.isObject = false;
    }
    this.speed = 1000 + Math.random() * 500;
  }
  move(dt) {
    const largest = getLargestObjects(rects.length);
    if (this.targetObjId && !largest[this.idx]) {
      this.setNewTarget();
    }
    if (this.targetObjId && largest[this.idx]) {
      const obj = largest[this.idx];
      const scaleX = canvas.width / video.videoWidth;
      const scaleY = canvas.height / video.videoHeight;
      this.target = {
        x: obj.bbox[0] * scaleX,
        y: obj.bbox[1] * scaleY
      };
      this.width = obj.bbox[2] * scaleX;
      this.height = obj.bbox[3] * scaleY;
      this.targetObjId = obj.id || obj.bbox.join('-');
      this.isObject = true;
    } else if (!this.targetObjId) {
      this.isObject = false;
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
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.3)';
    ctx.shadowBlur = 30;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 4;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
    // Подпись memoris
    ctx.font = `${Math.floor(this.height/3)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.shadowBlur = 0;
    ctx.fillText('memoris', this.x + this.width/2, this.y + this.height/2);
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
const rects = Array.from({length: 15}, (_,i) => new MovingRect(i));

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
  // Линии между квадратами: случайно прямые или кривые
  ctx.save();
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const c1 = rects[i].center();
      const c2 = rects[j].center();
      ctx.beginPath();
      if (Math.random() < 0.5) {
        // Прямая
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
      } else {
        // Кривая Безье
        const mx = (c1.x + c2.x) / 2 + (Math.random()-0.5)*100;
        const my = (c1.y + c2.y) / 2 + (Math.random()-0.5)*100;
        ctx.moveTo(c1.x, c1.y);
        ctx.quadraticCurveTo(mx, my, c2.x, c2.y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2 + 2 * Math.sin(now/200 + i + j);
      ctx.shadowColor = 'rgba(255,255,255,0.2)';
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
