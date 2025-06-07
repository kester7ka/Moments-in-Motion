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

// Класс для квадратика
class MovingSquare {
  constructor() {
    this.size = Math.random() * 60 + 20; // 20-80px
    this.x = Math.random() * (canvas.width - this.size);
    this.y = Math.random() * (canvas.height - this.size);
    this.vx = (Math.random() - 0.5) * 12; // скорость по X
    this.vy = (Math.random() - 0.5) * 12; // скорость по Y
    this.color = `rgba(${Math.floor(Math.random()*255)},${Math.floor(Math.random()*255)},${Math.floor(Math.random()*255)},0.7)`;
  }
  move() {
    this.x += this.vx;
    this.y += this.vy;
    // Отскок от краёв
    if (this.x < 0 || this.x + this.size > canvas.width) this.vx *= -1;
    if (this.y < 0 || this.y + this.size > canvas.height) this.vy *= -1;
  }
  draw(ctx) {
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(this.x, this.y, this.size, this.size);
  }
}

// Массив квадратов
const squares = Array.from({length: 25}, () => new MovingSquare());

// Анимация
function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const sq of squares) {
    sq.move();
    sq.draw(ctx);
  }
  requestAnimationFrame(animate);
}
animate(); 