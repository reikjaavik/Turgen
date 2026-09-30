// Процедурные текстуры для реконструкции (canvas → THREE.CanvasTexture): без внешних файлов, работают офлайн.
import * as THREE from 'three';

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const cache = new Map();

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  seed = 7 + w + h;
  draw(g, w, h);
  return c;
}

function tex(key, w, h, draw, { repeat = [1, 1], wrap = true } = {}) {
  const k = `${key}:${repeat}`;
  if (cache.has(k)) return cache.get(k);
  const t = new THREE.CanvasTexture(canvas(w, h, draw));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  cache.set(k, t);
  return t;
}

// Шум: мелкие пятна вокруг базового цвета.
function noise(g, w, h, base, spread, n = w * h / 6, size = 2) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (rnd() - 0.5) * spread;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(rnd() * w, rnd() * h, size * rnd() + 1, size * rnd() + 1);
  }
}

function window_(g, x, y, w, h, frame, glass = '#3b4a57', shutters = null) {
  if (shutters) { g.fillStyle = shutters; g.fillRect(x - w * 0.45, y, w * 0.42, h); g.fillRect(x + w * 1.03, y, w * 0.42, h); }
  g.fillStyle = frame; g.fillRect(x - 3, y - 3, w + 6, h + 6);
  g.fillStyle = glass; g.fillRect(x, y, w, h);
  g.fillStyle = frame; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h * 0.35 - 2, w, 4);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + 3, y + 3, w * 0.2, h * 0.25);
}
function door(g, x, y, w, h, color) {
  g.fillStyle = color; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + (w * i) / 4, y); g.lineTo(x + (w * i) / 4, y + h); g.stroke(); }
}

// ---- стены ----
export const whitewash = () => tex('whitewash', 256, 256, (g, w, h) => {
  noise(g, w, h, '#ece6d8', 0.12, 6000);
  g.fillStyle = 'rgba(120,95,60,.18)'; g.fillRect(0, h * 0.86, w, h * 0.14); // забрызганный низ
});
export const clay = () => tex('clay', 256, 256, (g, w, h) => noise(g, w, h, '#b3906a', 0.18, 7000, 3));
export const sod = () => tex('sod', 256, 256, (g, w, h) => {
  noise(g, w, h, '#6f5a3e', 0.2, 6000, 3);
  for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(40,30,20,.35)'; g.fillRect(0, y, w, 3); } // пласты дёрна
});
export const felt = () => tex('felt', 256, 256, (g, w, h) => noise(g, w, h, '#e7dfcc', 0.1, 5000, 3));
export const feltDark = () => tex('feltDark', 256, 256, (g, w, h) => noise(g, w, h, '#d6cbb2', 0.12, 5000, 3));
export const ornament = () => tex('ornament', 512, 64, (g, w, h) => {
  g.fillStyle = '#8f2d22'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#e9d9b0'; g.lineWidth = 4;
  for (let x = 0; x < w; x += 64) { // қошқар мүйіз — стилизованный «бараний рог»
    g.beginPath(); g.moveTo(x + 8, h - 12); g.bezierCurveTo(x + 8, 10, x + 32, 10, x + 32, h / 2);
    g.bezierCurveTo(x + 32, 10, x + 56, 10, x + 56, h - 12); g.stroke();
  }
  g.fillStyle = '#e9d9b0'; g.fillRect(0, 2, w, 3); g.fillRect(0, h - 5, w, 3);
}, { repeat: [1, 1] });
export const planks = (color = '#7a5a3a') => tex(`planks${color}`, 256, 256, (g, w, h) => {
  noise(g, w, h, color, 0.15, 3000);
  for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, 0, 2, h); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(rnd() * w, rnd() * h, 1, 20 + rnd() * 40); }
});
export const brick = (base = '#d9d2c3', mortar = '#b8b0a0') => tex(`brick${base}`, 256, 256, (g, w, h) => {
  g.fillStyle = mortar; g.fillRect(0, 0, w, h);
  const bh = 16, bw = 48;
  for (let row = 0, y = 0; y < h; row++, y += bh) {
    for (let x = (row % 2) * -bw / 2; x < w; x += bw) {
      const v = (rnd() - 0.5) * 0.12;
      g.fillStyle = base; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    }
  }
});
export const plaster = (color) => tex(`plaster${color}`, 256, 256, (g, w, h) => noise(g, w, h, color, 0.1, 5000));
export const concrete = () => tex('concrete', 256, 256, (g, w, h) => {
  noise(g, w, h, '#b9b6ae', 0.14, 6000);
  for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, y, w, 2); }
});
export const canvasCloth = () => tex('canvas', 256, 256, (g, w, h) => {
  noise(g, w, h, '#7b7a4e', 0.12, 5000);
  for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(x, 0, 1, h); }
});
export const granite = () => tex('granite', 256, 256, (g, w, h) => noise(g, w, h, '#5e5a57', 0.25, 9000, 2));
export const steel = () => tex('steel', 128, 128, (g, w, h) => noise(g, w, h, '#8a8f93', 0.15, 2500));

// Фасады с окнами. Текстура покрывает одну длинную стену целиком: floors — этажи, n — окон в ряд.
export function facade(key, { wall, frame = '#f2f2ee', shutters = null, floors = 1, n = 3, doorColor = null, glass }) {
  return tex(`facade:${key}`, 512, 256 * floors, (g, w, h) => {
    const base = wall.image ?? null;
    if (base) { for (let y = 0; y < h; y += base.height) for (let x = 0; x < w; x += base.width) g.drawImage(base, x, y); }
    const fh = h / floors;
    for (let f = 0; f < floors; f++) {
      const y = f * fh + fh * 0.28;
      for (let i = 0; i < n; i++) {
        const cx = (w / n) * (i + 0.5);
        if (doorColor && f === floors - 1 && i === Math.floor(n / 2) && n % 2) { door(g, cx - 34, f * fh + fh * 0.25, 68, fh * 0.75, doorColor); continue; }
        window_(g, cx - 30, y, 60, fh * 0.42, frame, glass, shutters);
      }
    }
  }, { wrap: false });
}

// ---- крыши ----
export const thatch = () => tex('thatch', 256, 256, (g, w, h) => {
  noise(g, w, h, '#a58a52', 0.12, 1000);
  g.lineWidth = 1.2;
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w, y = rnd() * h, l = 10 + rnd() * 18;
    g.strokeStyle = `rgba(${rnd() > 0.5 ? '70,55,25' : '220,200,140'},${0.25 + rnd() * 0.35})`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 3, y + l); g.stroke();
  }
});
export const earthRoof = () => tex('earthRoof', 256, 256, (g, w, h) => {
  noise(g, w, h, '#6d6446', 0.22, 7000, 3);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(110,130,60,${rnd() * 0.5})`; g.fillRect(rnd() * w, rnd() * h, 2, 4); }
});
export const slate = () => tex('slate', 256, 256, (g, w, h) => { // шифер: волна
  for (let x = 0; x < w; x++) { const v = 150 + Math.sin((x / w) * Math.PI * 16) * 22; g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(x, 0, 1, h); }
  for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y, w, 2); }
});
export const metalRoof = (color) => tex(`metal${color}`, 256, 256, (g, w, h) => {
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x + 3, 0, 2, h); }
});
export const woodRoof = () => planks('#5e4a35');

// ---- земля ----
export const steppe = () => tex('steppe', 512, 512, (g, w, h) => {
  noise(g, w, h, '#a3a067', 0.16, 30000, 2);
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '95,110,50' : '190,175,110'},${rnd() * 0.5})`; g.fillRect(rnd() * w, rnd() * h, 1, 3 + rnd() * 3); }
}, { repeat: [160, 160] });
export const dirt = () => tex('dirt', 256, 256, (g, w, h) => noise(g, w, h, '#9c8663', 0.2, 6000, 3), { repeat: [1, 40] });
export const gravel = () => tex('gravel', 256, 256, (g, w, h) => noise(g, w, h, '#a39a88', 0.3, 9000, 2), { repeat: [1, 40] });
export const asphalt = () => tex('asphalt', 256, 256, (g, w, h) => noise(g, w, h, '#5d5f60', 0.18, 9000, 2), { repeat: [1, 40] });
export const water = () => tex('water', 256, 256, (g, w, h) => {
  noise(g, w, h, '#5f8ea3', 0.1, 3000);
  for (let i = 0; i < 300; i++) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(rnd() * w, rnd() * h, 10 + rnd() * 20, 1); }
}, { repeat: [1, 30] });
export const foliage = () => tex('foliage', 128, 128, (g, w, h) => noise(g, w, h, '#4f6b2e', 0.3, 3000, 4));
export const bark = () => tex('bark', 64, 128, (g, w, h) => noise(g, w, h, '#6b5a48', 0.25, 1200, 2));
