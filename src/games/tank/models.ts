import * as THREE from 'three';
import { BOOK_COLORS, type Level, type Obs, type Terrain } from './level';

// ---------------------------------------------------------------- tiny helpers
let matCache = new Map<string, THREE.Material>();
export const resetMats = () => { matCache = new Map(); };
export function lam(color: number, opts: { emissive?: number; flat?: boolean } = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${opts.emissive ?? 0}|${opts.flat ?? 1}`;
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: opts.flat ?? true, emissive: opts.emissive ?? 0x000000 });
    matCache.set(key, m);
  }
  return m;
}
export function shiny(color: number, shininess = 80): THREE.MeshPhongMaterial {
  const key = `p${color}|${shininess}`;
  let m = matCache.get(key) as THREE.MeshPhongMaterial | undefined;
  if (!m) {
    m = new THREE.MeshPhongMaterial({ color, shininess, specular: 0x666666 });
    matCache.set(key, m);
  }
  return m;
}
const basic = (color: number) => {
  const key = `b${color}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    matCache.set(key, m);
  }
  return m;
};

function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function cyl(parent: THREE.Object3D, rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// ---------------------------------------------------------------- tank
export interface TankModel {
  root: THREE.Group;
  turret: THREE.Group;
  barrel: THREE.Group;
  muzzle: THREE.Object3D;
  wheels: THREE.Mesh[][]; // [left, right]
  tintable: THREE.MeshLambertMaterial[];
  flag: THREE.Object3D;
}

export function buildTank(hull: number, accent: number, scale: number, opt: { boss?: boolean; player?: boolean } = {}): TankModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);
  const tintable: THREE.MeshLambertMaterial[] = [];
  const own = (c: number) => {
    const m = new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    tintable.push(m);
    return m;
  };
  const hullM = own(hull);
  const darkM = own(new THREE.Color(hull).multiplyScalar(0.62).getHex());
  const accM = own(accent);
  const trackM = lam(0x262626);
  box(body, 1.6, 0.46, 2.6, hullM, 0, 0.66, 0);
  const glacis = box(body, 1.6, 0.1, 1.0, hullM, 0, 0.84, -1.18);
  glacis.rotation.x = -0.42;
  box(body, 1.64, 0.1, 0.9, darkM, 0, 0.9, 1.0); // rear deck
  box(body, 0.5, 0.2, 0.34, lam(0x333333), 0, 0.98, 1.05); // battery box on the back
  if (opt.player) {
    box(body, 1.66, 0.07, 2.0, accM, 0, 0.66, 0.1); // accent belt
  }
  const wheels: THREE.Mesh[][] = [[], []];
  const wheelGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.1, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.04, 0.4, 0.07);
  for (let s = 0; s < 2; s++) {
    const sx = s === 0 ? -1 : 1;
    box(body, 0.42, 0.52, 3.0, trackM, sx * 1.0, 0.36, 0);
    box(body, 0.46, 0.08, 3.1, darkM, sx * 1.0, 0.66, 0);
    for (let i = 0; i < 6; i++) {
      const w = new THREE.Mesh(wheelGeo, own(0x5a5e52));
      w.position.set(sx * 1.2, 0.36, -1.15 + i * 0.46);
      const sp = new THREE.Mesh(spokeGeo, lam(0xd8d8c8));
      sp.position.x = sx * 0.04;
      w.add(sp);
      body.add(w);
      wheels[s].push(w);
    }
  }
  const turret = new THREE.Group();
  turret.position.set(0, 0.9, 0.1);
  body.add(turret);
  const tm = own(new THREE.Color(hull).multiplyScalar(1.08).getHex());
  box(turret, 1.15, 0.36, 1.25, tm, 0, 0.18, 0);
  box(turret, 0.9, 0.12, 0.95, tm, 0, 0.42, 0.05);
  box(turret, 0.38, 0.1, 0.38, accM, 0.28, 0.52, 0.18); // hatch
  const flagPole = cyl(turret, 0.012, 0.012, 1.1, lam(0x222222), -0.45, 0.8, 0.5, 4);
  const flag = box(turret, 0.28, 0.17, 0.02, accM, -0.31, 1.24, 0.5);
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.22, -0.55);
  turret.add(barrel);
  const bg = new THREE.CylinderGeometry(0.075, 0.085, 1.5, 8);
  bg.rotateX(Math.PI / 2);
  bg.translate(0, 0, -0.75);
  barrel.add(new THREE.Mesh(bg, lam(0x3a3d3a)));
  const mb = new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8);
  mb.rotateX(Math.PI / 2);
  mb.translate(0, 0, -1.55);
  barrel.add(new THREE.Mesh(mb, lam(0x25272a)));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -1.7);
  barrel.add(muzzle);
  if (opt.boss) {
    // a generic toy robot head on top of the turret
    const metal = own(0x3b4c86);
    box(turret, 0.9, 0.5, 0.6, metal, 0, 0.78, 0.15);
    box(turret, 0.7, 0.38, 0.5, own(0xd9dde3), 0, 1.22, 0.15);
    box(turret, 0.18, 0.1, 0.05, basic(0xffe14a), -0.17, 1.24, -0.12);
    box(turret, 0.18, 0.1, 0.05, basic(0xffe14a), 0.17, 1.24, -0.12);
    const hl = box(turret, 0.07, 0.5, 0.05, own(0xe6c13a), -0.26, 1.62, 0.1);
    hl.rotation.z = 0.5;
    const hr = box(turret, 0.07, 0.5, 0.05, own(0xe6c13a), 0.26, 1.62, 0.1);
    hr.rotation.z = -0.5;
    box(turret, 0.28, 0.5, 0.3, own(0xc03030), -0.62, 0.7, 0.15);
    box(turret, 0.28, 0.5, 0.3, own(0xc03030), 0.62, 0.7, 0.15);
    flagPole.visible = false;
    flag.visible = false;
  }
  return { root, turret, barrel, muzzle, wheels, tintable, flag };
}

// ---------------------------------------------------------------- pickups
export function buildPickup(kind: 'bat' | 'glue' | 'pow'): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 6, 20), basic(kind === 'bat' ? 0xffd400 : kind === 'glue' ? 0x2ee66b : 0xff7a1f));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  const item = new THREE.Group();
  item.position.y = 0.9;
  item.name = 'item';
  g.add(item);
  if (kind === 'bat') {
    cyl(item, 0.24, 0.24, 1.0, lam(0xd9a441), 0, 0, 0, 10);
    cyl(item, 0.245, 0.245, 0.3, lam(0x151515), 0, 0.1, 0, 10);
    cyl(item, 0.1, 0.1, 0.12, lam(0xc8c8c8), 0, 0.56, 0, 8);
    box(item, 0.3, 0.12, 0.02, lam(0xffffff), 0, -0.2, 0.25);
  } else if (kind === 'glue') {
    cyl(item, 0.3, 0.3, 0.8, lam(0xf3d23a), 0, 0, 0, 10);
    cyl(item, 0.05, 0.3, 0.3, lam(0x2f6fd0), 0, 0.55, 0, 10);
    box(item, 0.4, 0.3, 0.02, lam(0xd03030), 0, -0.05, 0.3);
  } else {
    box(item, 0.8, 0.5, 0.8, lam(0xc92b2b), 0, 0, 0);
    cyl(item, 0.41, 0.41, 0.12, lam(0xf2f2f2), 0, 0, 0, 12);
    cyl(item, 0.02, 0.02, 0.4, lam(0x222222), 0, 0.45, 0, 4);
  }
  return g;
}

// ---------------------------------------------------------------- props
export function buildProp(o: Obs): THREE.Group {
  const g = new THREE.Group();
  g.position.set(o.x, 0, o.z);
  g.rotation.y = -o.rot;
  switch (o.type) {
    case 'books':
    case 'comics': {
      let y = 0;
      const n = o.spec.length / 5;
      for (let i = 0; i < n; i++) {
        const [t, color, ox, oz, ry] = o.spec.slice(i * 5, i * 5 + 5);
        const b = new THREE.Group();
        b.position.set(ox, y + t / 2, oz);
        b.rotation.y = ry;
        box(b, o.hx * 2 - 0.1, t, o.hz * 2 - 0.1, lam(color), 0, 0, 0);
        box(b, o.hx * 2 - 0.34, t - 0.09, o.hz * 2 + 0.03, lam(0xf0e6c8), 0, 0, 0);
        box(b, o.hx * 2 - 0.4, t + 0.02, 0.16, lam(color), 0, 0, -(o.hz - 0.2)); // spine band
        g.add(b);
        y += t;
      }
      break;
    }
    case 'lego': {
      const c = o.spec[0];
      box(g, o.hx * 2, 1.1, o.hz * 2, lam(c), 0, 0.55, 0);
      for (let i = -1; i <= 2; i++) for (let j = 0; j < 2; j++) cyl(g, 0.24, 0.24, 0.22, lam(c), -1.2 + i * 0.8 + 0.8, 1.2, -0.4 + j * 0.8, 8);
      break;
    }
    case 'baduk': {
      box(g, o.hx * 2, 0.9, o.hz * 2, lam(0xd9a95b), 0, 0.45, 0);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(o.hx * 2 - 0.4, o.hz * 2 - 0.4), new THREE.MeshLambertMaterial({ map: badukTex() }));
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.91;
      g.add(top);
      for (let i = 0; i < 7; i++) cyl(g, 0.16, 0.16, 0.07, lam(i % 2 ? 0x151515 : 0xf4f4ee), -1.8 + (i * 0.9) % 3.4, 0.95, -1.5 + (i * 1.3) % 3, 8);
      break;
    }
    case 'yogang': {
      const r = o.r;
      cyl(g, r, r * 0.8, 1.7, shiny(0xf5f5ef, 60), 0, 0.85, 0, 14);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 6, 16), lam(0x2a5fb0));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.7;
      g.add(rim);
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.93, 0.07, 6, 16), lam(0x2a5fb0));
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.15;
      g.add(band);
      const hd = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 6, 10, Math.PI), shiny(0xf5f5ef, 60));
      hd.position.set(r, 1.2, 0);
      hd.rotation.z = -Math.PI / 2;
      g.add(hd);
      const lid = cyl(g, r * 0.2, r * 1.0, 0.3, shiny(0xf5f5ef, 60), 0.2, 1.95, 0, 14);
      lid.rotation.z = 0.3;
      break;
    }
    case 'kettle': {
      const r = o.r;
      cyl(g, r * 0.85, r, 1.6, shiny(0xe6c34a, 90), 0, 0.8, 0, 14);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 0.85, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), shiny(0xe6c34a, 90));
      dome.position.y = 1.6;
      g.add(dome);
      cyl(g, 0.12, 0.12, 0.2, lam(0x222222), 0, 2.3, 0, 6);
      const sp = cyl(g, 0.12, 0.28, 1.0, shiny(0xe6c34a, 90), -r - 0.3, 1.5, 0, 8);
      sp.rotation.z = 0.9;
      const hd = new THREE.Mesh(new THREE.TorusGeometry(r * 0.85, 0.07, 6, 14, Math.PI), lam(0x2b2b2b));
      hd.position.y = 1.6;
      g.add(hd);
      break;
    }
    case 'lamp': {
      cyl(g, 1.0, 1.2, 0.3, lam(0x2d2d2d), 0, 0.15, 0, 12);
      cyl(g, 0.1, 0.1, 13, lam(0x2d2d2d), 0, 6.5, 0, 6);
      const shade = cyl(g, 1.3, 2.6, 2.2, new THREE.MeshBasicMaterial({ color: 0xffe2a8, side: THREE.DoubleSide }), 0, 13.2, 0, 14);
      shade.name = 'shade';
      break;
    }
  }
  return g;
}

let _baduk: THREE.Texture | null = null;
function badukTex() {
  if (_baduk) return _baduk;
  _baduk = canvasTex(128, 128, (g) => {
    g.fillStyle = '#e0b468';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#3a2a14';
    g.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      const p = 8 + i * 14;
      g.beginPath();
      g.moveTo(8, p);
      g.lineTo(120, p);
      g.moveTo(p, 8);
      g.lineTo(p, 120);
      g.stroke();
    }
  });
  return _baduk;
}

// ---------------------------------------------------------------- marbles & cat
const MARBLE_COLS = [0x3aa0ff, 0x35d07f, 0xff8c2b, 0xb05cff, 0xf4f4f4, 0xff4f6a];
export function buildMarble(i: number, r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshPhongMaterial({ color: MARBLE_COLS[i % MARBLE_COLS.length], shininess: 120, specular: 0xffffff, flatShading: false }));
  const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 6, 5), lam(MARBLE_COLS[(i + 3) % MARBLE_COLS.length], { flat: true }));
  m.add(core);
  return m;
}

export interface CatModel { root: THREE.Group; paw: THREE.Group; eyesOpen: THREE.Object3D; eyesShut: THREE.Object3D; zzz: THREE.Sprite; tail: THREE.Group }
export function buildCat(): CatModel {
  const root = new THREE.Group();
  const fur = lam(0xe39b4a, { flat: false });
  const dark = lam(0xb86f2a, { flat: false });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), fur);
  body.scale.set(2.3, 1.3, 1.5);
  body.position.y = 1.2;
  root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 8), fur);
  head.position.set(2.2, 1.35, 0);
  root.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 4), dark);
    ear.position.set(2.1, 2.1, s * 0.5);
    root.add(ear);
  }
  const eyesOpen = new THREE.Group();
  const eyesShut = new THREE.Group();
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), basic(0xfff060));
    e.position.set(2.95, 1.5, s * 0.36);
    eyesOpen.add(e);
    box(eyesShut, 0.04, 0.05, 0.3, lam(0x222222), 2.97, 1.45, s * 0.36);
  }
  eyesOpen.visible = false;
  root.add(eyesOpen, eyesShut);
  const tail = new THREE.Group();
  tail.position.set(-2.1, 1.0, 0);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.28 - i * 0.02, 6, 5), i === 3 ? dark : fur);
    s.position.set(-0.5 * i - 0.2, 0.15 * i * i * 0.3, 0.3 * i);
    tail.add(s);
  }
  root.add(tail);
  for (const [x, z] of [[1.3, 0.8], [1.3, -0.8], [-1.3, 0.8], [-1.3, -0.8]]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 5), fur);
    l.position.set(x, 0.35, z);
    root.add(l);
  }
  const paw = new THREE.Group();
  paw.position.set(1.4, 0.6, -0.9);
  box(paw, 3.8, 0.45, 0.6, fur, 1.9, 0, 0);
  box(paw, 0.8, 0.5, 0.8, dark, 3.9, 0, 0);
  paw.visible = false;
  root.add(paw);
  const tex = canvasTex(128, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.font = 'bold 44px sans-serif';
    g.fillText('Zzz', 10, 48);
  });
  const zzz = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  zzz.scale.set(3, 1.5, 1);
  zzz.position.set(2.2, 3.6, 0);
  root.add(zzz);
  return { root, paw, eyesOpen, eyesShut, zzz, tail };
}

// ---------------------------------------------------------------- room
const PALS: [number, number, number][] = [
  [0xe8789a, 0xfff2b8, 0xb84a6a],
  [0x3c9ea0, 0xe8ffe0, 0x226a70],
  [0x8a5cc0, 0xffd6f2, 0x5a3a8a],
];
const hex = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

function paintFloor(t: Terrain, hx: number, hz: number, dim: boolean): HTMLCanvasElement {
  const W = 1024;
  const H = Math.round((1024 * hz) / hx / 2) * 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // 장판 (vinyl floor): warm tan with diamond motif
  g.fillStyle = '#d6ae62';
  g.fillRect(0, 0, W, H);
  const cell = (W / (hx * 2)) * 2.6;
  g.strokeStyle = 'rgba(120,70,20,0.28)';
  g.lineWidth = 1.5;
  for (let x = 0; x < W; x += cell) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = 0; y < H; y += cell) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.fillStyle = 'rgba(140,84,30,0.20)';
  for (let x = cell / 2; x < W; x += cell) {
    for (let y = cell / 2; y < H; y += cell) {
      g.beginPath();
      g.moveTo(x, y - cell * 0.22);
      g.lineTo(x + cell * 0.22, y);
      g.lineTo(x, y + cell * 0.22);
      g.lineTo(x - cell * 0.22, y);
      g.fill();
    }
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,240,200' : '90,50,10'},${0.05 + Math.random() * 0.08})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 1);
  }
  // blankets / wood ridges, per pixel
  if (t.hills.length || t.ridges.length) {
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    const q = W / (hx * 2);
    for (let j = 0; j < H; j++) {
      const z = (j / H - 0.5) * hz * 2;
      for (let i = 0; i < W; i++) {
        const x = (i / W - 0.5) * hx * 2;
        const pal = t.palAt(x, z);
        if (pal === -1) continue;
        const m = Math.min(1, Math.max(t.soft(x, z), pal === -2 ? 1 : 0) * 1.2);
        let r: number;
        let gg: number;
        let b: number;
        if (pal === -2) {
          const grain = 0.85 + 0.15 * Math.sin(j * 0.9 + Math.sin(i * 0.05) * 3);
          [r, gg, b] = [122 * grain, 76 * grain, 38 * grain];
        } else {
          const [base, hi, lo] = PALS[pal % PALS.length];
          let [cr, cg, cb] = hex(base);
          const px = i % 44;
          const py = j % 44;
          const dd = Math.hypot(px - 22, py - 22);
          if (dd < 7 || (dd > 10 && dd < 11.5 && (pal === 1))) [cr, cg, cb] = hex(hi);
          else if (px < 2 || py < 2) [cr, cg, cb] = hex(lo);
          const k = 0.92 + 0.08 * Math.sin((i + j) * 0.7);
          [r, gg, b] = [cr * k, cg * k, cb * k];
        }
        const idx = (j * W + i) * 4;
        // soft edge toward the floor; wood ridge edge is hard
        const a = pal === -2 ? 1 : Math.min(1, m * 1.6);
        d[idx] = d[idx] * (1 - a) + r * a;
        d[idx + 1] = d[idx + 1] * (1 - a) + gg * a;
        d[idx + 2] = d[idx + 2] * (1 - a) + b * a;
      }
    }
    g.putImageData(img, 0, 0);
    void q;
  }
  if (dim) {
    g.fillStyle = 'rgba(20,10,40,0.12)';
    g.fillRect(0, 0, W, H);
  }
  return c;
}

export function buildFloor(level: Level): THREE.Mesh {
  const { hx, hz, dim } = level.cfg;
  const cs = 0.7;
  const nx = Math.ceil((hx * 2) / cs);
  const nz = Math.ceil((hz * 2) / cs);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  let k = 0;
  let u = 0;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = -hx + (i / nx) * hx * 2;
      const z = -hz + (j / nz) * hz * 2;
      pos[k++] = x;
      pos[k++] = level.terrain.h(x, z);
      pos[k++] = z;
      uv[u++] = i / nx;
      uv[u++] = 1 - j / nz;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(paintFloor(level.terrain, hx, hz, dim));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRoom(level: Level): THREE.Group {
  const { hx, hz, dim } = level.cfg;
  const g = new THREE.Group();
  const H = 32;
  const wp = canvasTex(256, 256, (c) => {
    c.fillStyle = dim ? '#b8a48a' : '#efe3c4';
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = dim ? 'rgba(120,90,70,0.35)' : 'rgba(190,150,110,0.45)';
    c.lineWidth = 6;
    for (let x = 16; x < 256; x += 64) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, 256);
      c.stroke();
    }
    c.fillStyle = dim ? 'rgba(120,70,60,0.5)' : 'rgba(210,110,120,0.55)';
    for (let x = 48; x < 256; x += 64) for (let y = 20; y < 256; y += 64) {
      c.beginPath();
      c.arc(x, y, 7, 0, 7);
      c.fill();
    }
  }, [hx / 6, 2.6]);
  const wm = new THREE.MeshLambertMaterial({ map: wp });
  const baseM = lam(dim ? 0x4a3322 : 0x7a5130);
  const walls: [number, number, number, number][] = [
    [0, -hz, 0, hx * 2], [0, hz, Math.PI, hx * 2], [hx, 0, -Math.PI / 2, hz * 2], [-hx, 0, Math.PI / 2, hz * 2],
  ];
  for (const [x, z, ry, w] of walls) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wm);
    p.position.set(x, H / 2, z);
    p.rotation.y = ry;
    g.add(p);
    const bb = new THREE.Mesh(new THREE.BoxGeometry(w, 1.5, 0.5), baseM);
    bb.position.set(x, 0.75, z);
    bb.rotation.y = ry;
    bb.translateZ(0.25);
    g.add(bb);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), lam(dim ? 0x8a7a68 : 0xf4ecd8));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  g.add(ceil);
  // window on the north wall
  const wx = hx * 0.35;
  const win = canvasTex(256, 192, (c) => {
    const gr = c.createLinearGradient(0, 0, 0, 192);
    if (dim) { gr.addColorStop(0, '#2a2a5a'); gr.addColorStop(1, '#e8764a'); } else { gr.addColorStop(0, '#9fd8ff'); gr.addColorStop(1, '#e8f6ff'); }
    c.fillStyle = gr;
    c.fillRect(0, 0, 256, 192);
    c.fillStyle = '#f2ecdc';
    c.fillRect(0, 0, 256, 10);
    c.fillRect(0, 182, 256, 10);
    c.fillRect(0, 0, 10, 192);
    c.fillRect(246, 0, 10, 192);
    c.fillRect(122, 0, 12, 192);
    c.fillRect(0, 90, 256, 12);
  });
  const win3 = new THREE.Mesh(new THREE.PlaneGeometry(15, 11), new THREE.MeshBasicMaterial({ map: win }));
  win3.position.set(wx, 12, -hz + 0.05);
  g.add(win3);
  // light shaft on the floor
  const shaft = canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = dim ? 'rgba(255,150,80,0.55)' : 'rgba(255,248,200,0.8)';
    for (const [x, y] of [[8, 8], [68, 8], [8, 68], [68, 68]]) c.fillRect(x, y, 52, 52);
  });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(15, 11), new THREE.MeshBasicMaterial({ map: shaft, transparent: true, opacity: dim ? 0.18 : 0.26, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.rotation.x = -Math.PI / 2;
  beam.rotation.z = -0.25;
  beam.position.set(wx - 4, 0.06 + level.terrain.h(wx - 4, -hz + 14) * 0, -hz + 14);
  g.add(beam);
  // calendar on the east wall
  const cal = canvasTex(128, 192, (c) => {
    c.fillStyle = '#fafafa';
    c.fillRect(0, 0, 128, 192);
    c.fillStyle = '#c22';
    c.fillRect(0, 0, 128, 40);
    c.fillStyle = '#fff';
    c.font = 'bold 30px sans-serif';
    c.fillText('11월', 34, 30);
    c.fillStyle = '#333';
    c.font = '14px sans-serif';
    for (let i = 0; i < 28; i++) c.fillText(String(i + 1), 8 + (i % 7) * 17, 66 + Math.floor(i / 7) * 24);
    c.fillStyle = '#c22';
    c.beginPath();
    c.arc(60, 138, 11, 0, 7);
    c.stroke();
  });
  const calM = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), new THREE.MeshLambertMaterial({ map: cal }));
  calM.position.set(hx - 0.05, 10, -hz * 0.3);
  calM.rotation.y = -Math.PI / 2;
  g.add(calM);
  return g;
}
export { BOOK_COLORS };
