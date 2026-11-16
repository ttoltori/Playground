import * as THREE from 'three';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

const cache = new Map<string, THREE.Texture>();
const cached = (key: string, make: () => THREE.Texture) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key)!;
};

export const tex = {
  asphalt: () => cached('asphalt', () => canvasTex(256, 256, (g) => {
    g.fillStyle = '#4a4d52';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 3000, 0.35);
  }, [24, 16])),
  epoxy: () => cached('epoxy', () => canvasTex(256, 256, (g) => {
    g.fillStyle = '#6b7773';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 1200, 0.15);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 256, 256);
  }, [8, 12])),
  hazard: () => cached('hazard', () => canvasTex(128, 32, (g) => {
    g.fillStyle = '#f2c200';
    g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#111';
    for (let x = -32; x < 160; x += 32) {
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + 16, 32);
      g.lineTo(x + 32, 0);
      g.lineTo(x + 16, 0);
      g.fill();
    }
  }, [1, 1])),
  cardboard: () => cached('cardboard', () => canvasTex(128, 128, (g) => {
    g.fillStyle = '#b8874f';
    g.fillRect(0, 0, 128, 128);
    speckle(g, 128, 128, 400, 0.15);
    g.fillStyle = '#d9c39a';
    g.fillRect(56, 0, 16, 128);
    g.strokeStyle = 'rgba(60,30,0,0.5)';
    g.lineWidth = 3;
    g.strokeRect(1, 1, 126, 126);
  })),
  fragile: () => cached('fragile', () => canvasTex(256, 256, (g) => {
    g.fillStyle = '#8a5a2b';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#5a3612';
    g.lineWidth = 10;
    for (let y = 0; y < 256; y += 64) g.strokeRect(0, y, 256, 64);
    g.fillStyle = '#d1131f';
    g.font = 'bold 44px sans-serif';
    g.textAlign = 'center';
    g.fillText('깨짐주의', 128, 110);
    g.font = 'bold 30px sans-serif';
    g.fillText('🥃 PREMIUM', 128, 160);
    g.fillText('FRAGILE', 128, 200);
  })),
  wood: () => cached('wood', () => canvasTex(64, 64, (g) => {
    g.fillStyle = '#a0763f';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(70,40,10,0.4)';
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      g.moveTo(0, Math.random() * 64);
      g.lineTo(64, Math.random() * 64);
      g.stroke();
    }
  })),
  zone: (label: string, color: string) => canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = color + '33';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = color;
    g.lineWidth = 14;
    g.setLineDash([30, 18]);
    g.strokeRect(10, 10, 236, 236);
    g.setLineDash([]);
    g.fillStyle = color;
    g.font = 'bold 120px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 128, 140);
    g.font = 'bold 34px sans-serif';
    g.fillText('DROP', 128, 50);
  }),
  sign: (text: string, bg: string, fg = '#fff') => canvasTex(512, 128, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = fg;
    g.font = 'bold 64px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
  }),
  container: (color: string) => canvasTex(256, 128, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let x = 0; x < 256; x += 12) g.fillRect(x, 0, 5, 128);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = 'bold 22px monospace';
    g.fillText('PGND 420-69', 14, 30);
  }),
};
