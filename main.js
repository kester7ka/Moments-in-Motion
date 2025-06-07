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

let currentFacing = 'user'; // 'user' (front) или 'environment' (back)
let stream = null;

function startCamera(facingMode = 'user') {
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

// Обработка двойного тапа
let lastTap = 0;
window.addEventListener('touchend', function(e) {
  const now = Date.now();
  if (now - lastTap < 300) {
    // Двойной тап
    currentFacing = currentFacing === 'user' ? 'environment' : 'user';
    startCamera(currentFacing);
  }
  lastTap = now;
});
// Для ПК — двойной клик мышью
window.addEventListener('dblclick', function(e) {
  currentFacing = currentFacing === 'user' ? 'environment' : 'user';
  startCamera(currentFacing);
});

// Класс для прямоугольника
class MovingRect {
  constructor() {
    this.randomize();
    this.target = {x: this.x, y: this.y};
    this.speed = 30 + Math.random() * 40; // пикселей в секунду
  }
  randomize() {
    this.width = Math.random() * 80 + 40;
    this.height = Math.random() * 80 + 40;
    this.x = Math.random() * (canvas.width - this.width);
    this.y = Math.random() * (canvas.height - this.height);
    this.color = 'rgba(120,120,120,0.7)';
    this.setNewTarget();
  }
  setNewTarget() {
    this.target = {
      x: Math.random() * (canvas.width - this.width),
      y: Math.random() * (canvas.height - this.height)
    };
    this.speed = 1000 + Math.random() * 500; // Очень быстро
  }
  move(dt) {
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
  draw(ctx) {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(this.x, this.y, this.width, this.height);
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
  const dt = Math.min((now - lastTime) / 1000, 0.05); // секунды
  lastTime = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Соединяем центры линиями
  ctx.save();
  ctx.strokeStyle = 'rgba(180,180,180,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const c1 = rects[i].center();
      const c2 = rects[j].center();
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.stroke();
    }
  }
  ctx.restore();
  // Двигаем и рисуем прямоугольники
  for (const r of rects) {
    r.move(dt);
    r.draw(ctx);
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate); 
