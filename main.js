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

// Запуск камеры
navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  .then(stream => {
    video.srcObject = stream;
  })
  .catch(err => {
    alert('Не удалось получить доступ к камере: ' + err);
  });

// Класс для прямоугольника
class MovingRect {
  constructor() {
    this.randomize();
  }
  randomize() {
    this.width = Math.random() * 80 + 40; // 40-120px
    this.height = Math.random() * 80 + 40; // 40-120px
    this.x = Math.random() * (canvas.width - this.width);
    this.y = Math.random() * (canvas.height - this.height);
    this.color = 'rgba(120,120,120,0.7)'; // Серый
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
function animate() {
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
  // Рисуем прямоугольники
  for (const r of rects) {
    r.draw(ctx);
  }
  requestAnimationFrame(animate);
}
animate(); 
