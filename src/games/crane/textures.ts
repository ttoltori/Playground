import * as THREE from 'three';

const memo = new Map<string, HTMLCanvasElement>();
function canvasOf(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  let c = memo.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    memo.set(key, c);
  }
  return c;
}
function tx(c: HTMLCanvasElement, rep?: [number, number]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (rep) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep[0], rep[1]);
  }
  return t;
}
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() * 255;
    g.fillStyle = `rgba(${v},${v},${v},${a * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

export const T = {
  ground: (rep: number) => tx(canvasOf('ground', 256, 256, (g) => {
    g.fillStyle = '#b9a982';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 3500, 0.45);
    g.strokeStyle = 'rgba(60,45,30,0.25)';
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(Math.random() * 256, Math.random() * 256);
      g.lineTo(Math.random() * 256, Math.random() * 256);
      g.stroke();
    }
  }), [rep, rep]),
  lattice: (rx: number, ry: number) => tx(canvasOf('lattice', 128, 128, (g) => {
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    g.lineCap = 'square';
    g.strokeRect(4, 4, 120, 120);
    g.beginPath();
    g.moveTo(4, 124);
    g.lineTo(64, 4);
    g.lineTo(124, 124);
    g.stroke();
  }), [rx, ry]),
  floors: (rx: number, ry: number) => tx(canvasOf('floors', 128, 128, (g) => {
    g.fillStyle = '#9a9a96';
    g.fillRect(0, 0, 128, 128);
    speckle(g, 128, 128, 800, 0.3);
    g.fillStyle = '#6d6d6a';
    g.fillRect(0, 0, 128, 12); // slab edge
    g.fillRect(0, 116, 128, 12);
    g.fillStyle = '#85857f';
    g.fillRect(8, 20, 14, 96); // columns
    g.fillRect(106, 20, 14, 96);
    g.fillStyle = '#2a2d33';
    g.fillRect(34, 34, 62, 56); // open window void
    g.fillStyle = '#3b4048';
    g.fillRect(34, 34, 62, 8);
  }), [rx, ry]),
  roof: (rx: number, ry: number) => tx(canvasOf('roof', 128, 128, (g) => {
    g.fillStyle = '#8d8d88';
    g.fillRect(0, 0, 128, 128);
    speckle(g, 128, 128, 1500, 0.35);
    g.strokeStyle = 'rgba(40,40,40,0.35)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, 126, 126);
  }), [rx, ry]),
  bricks: () => tx(canvasOf('bricks', 128, 128, (g) => {
    g.fillStyle = '#b4513a';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#6e2e22';
    g.lineWidth = 3;
    for (let y = 0; y < 128; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(128, y);
      g.stroke();
      for (let x = (y / 16) % 2 ? 0 : 16; x < 128; x += 32) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + 16);
        g.stroke();
      }
    }
  }), [2, 2]),
  toilet: () => tx(canvasOf('toilet', 128, 256, (g) => {
    g.fillStyle = '#2f6fd8';
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#245bb3';
    g.fillRect(10, 14, 108, 228);
    g.fillStyle = '#dfe9ff';
    g.fillRect(52, 120, 12, 20); // handle
    g.fillStyle = '#fff';
    g.font = 'bold 44px sans-serif';
    g.textAlign = 'center';
    g.fillText('WC', 64, 80);
    g.fillStyle = '#e33';
    g.fillRect(40, 150, 48, 10);
  })),
  city: () => tx(canvasOf('city', 64, 128, (g) => {
    g.fillStyle = '#8d97ab';
    g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 124; y += 12) {
      for (let x = 6; x < 60; x += 12) {
        g.fillStyle = Math.random() < 0.3 ? '#ffd98a' : '#4a5468';
        g.fillRect(x, y, 7, 7);
      }
    }
  })),
  hatch: () => tx(canvasOf('hatch', 64, 64, (g) => {
    g.fillStyle = '#e9b520';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#222';
    for (let i = -64; i < 128; i += 24) {
      g.beginPath();
      g.moveTo(i, 64);
      g.lineTo(i + 12, 64);
      g.lineTo(i + 76, 0);
      g.lineTo(i + 64, 0);
      g.fill();
    }
  })),
};

export function labelTexture(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#000c';
  g.stroke();
  g.fillStyle = '#000';
  g.font = 'bold 76px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
