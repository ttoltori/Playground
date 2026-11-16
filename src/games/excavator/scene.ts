import * as THREE from 'three';
import { box } from '../forklift/world';
import { tex } from '../forklift/textures';
import type { Box3, LevelCfg, PropCfg } from './levels';

const lam = (c: number, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rep?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (rep) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep[0], rep[1]);
  }
  return t;
}

const dirtTex = (rep: [number, number], base = '#8a6a45') => canvasTex(256, 256, (g) => {
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 90 + Math.random() * 90;
    g.fillStyle = `rgba(${v},${v * 0.75},${v * 0.5},${Math.random() * 0.35})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
}, rep);

export interface Pile { x: number; z: number; R: number; H: number; v: number; v0: number; mesh: THREE.Mesh }
export interface GasZone { x: number; z: number; r: number; cool: number; flags: THREE.Group }
export interface Worker { mesh: THREE.Group; x: number; z: number; a: [number, number]; b: [number, number]; speed: number; toB: boolean; wait: number; stun: number }

export interface Site {
  group: THREE.Group;
  boxes: Box3[]; // static obstacles
  piles: Pile[];
  gas: GasZone[];
  workers: Worker[];
  rain: THREE.LineSegments | null;
  lights: THREE.Light[];
  sun: THREE.DirectionalLight;
  marker: THREE.Mesh;
}

export function buildSite(cfg: LevelCfg, shadows: boolean): Site {
  const g = new THREE.Group();
  const boxes: Box3[] = [];
  const lights: THREE.Light[] = [];
  const { x0, x1, z0, z1 } = cfg.size;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const W = x1 - x0;
  const D = z1 - z0;

  // lights
  const hemi = new THREE.HemisphereLight(cfg.night ? 0x6f86b8 : 0xffffff, cfg.night ? 0x1a1f2e : 0x7a6a55, cfg.night ? 1.25 : 1.35);
  g.add(hemi);
  lights.push(hemi);
  const sun = new THREE.DirectionalLight(cfg.night ? 0x8fa6dd : 0xfff1d6, cfg.night ? 0.7 : 1.6);
  sun.position.set(cx + 22, 36, cz - 14);
  sun.target.position.set(cx, 0, cz);
  g.add(sun, sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = Math.max(W, D) * 0.6;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 100 });
  }

  // ground: outer dirt + inner compacted site
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), lam(cfg.night ? 0x2a3626 : 0x6b8a4c, { map: undefined }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  g.add(outer);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, D + 6), lam(cfg.night ? 0x7a6a58 : 0xffffff, { map: dirtTex([W / 8, D / 8]) }));
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(cx, 0, cz);
  inner.receiveShadow = true;
  g.add(inner);

  // fence
  const fenceMat = lam(0xd4d7dc);
  const postMat = lam(0x3a3f47);
  const hz = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: tex.hazard() }));
  void hz;
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.06), fenceMat);
    m.position.set((ax + bx) / 2, 1.0, (az + bz) / 2);
    m.rotation.y = -Math.atan2(bz - az, bx - ax);
    g.add(m);
    const n = Math.floor(len / 4);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      g.add(box(0.18, 1.7, 0.18, postMat, ax + (bx - ax) * t, 0.85, az + (bz - az) * t));
    }
  };
  const m = 1.2;
  rail(x0 - m, z0 - m, x1 + m, z0 - m);
  rail(x0 - m, z1 + m, x1 + m, z1 + m);
  rail(x0 - m, z0 - m, x0 - m, z1 + m);
  rail(x1 + m, z0 - m, x1 + m, z1 + m);
  boxes.push({ x0: x0 - m - 0.2, x1: x1 + m + 0.2, z0: z0 - m - 0.4, z1: z0 - m + 0.2, y0: 0, y1: 1.7 });
  boxes.push({ x0: x0 - m - 0.2, x1: x1 + m + 0.2, z0: z1 + m - 0.2, z1: z1 + m + 0.4, y0: 0, y1: 1.7 });
  boxes.push({ x0: x0 - m - 0.4, x1: x0 - m + 0.2, z0: z0 - m, z1: z1 + m, y0: 0, y1: 1.7 });
  boxes.push({ x0: x1 + m - 0.2, x1: x1 + m + 0.4, z0: z0 - m, z1: z1 + m, y0: 0, y1: 1.7 });

  // distant skyline
  const bm = lam(cfg.night ? 0x161c2c : 0x8d98a8);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = Math.max(W, D) * 0.5 + 45 + (i % 3) * 8;
    const h = 14 + ((i * 37) % 30);
    g.add(box(10 + (i % 4) * 3, h, 10, bm, cx + Math.cos(a) * r * 1.15, h / 2, cz + Math.sin(a) * r));
  }

  // props
  for (const p of cfg.props) addProp(g, boxes, p, cfg.night);

  // piles
  const piles: Pile[] = cfg.piles.map((p) => {
    const geo = new THREE.ConeGeometry(p.R, p.H, 11, 3);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > -p.H / 2 + 0.01 && y < p.H / 2 - 0.01) {
        pos.setX(i, pos.getX(i) * (0.85 + Math.random() * 0.3));
        pos.setZ(i, pos.getZ(i) * (0.85 + Math.random() * 0.3));
      }
    }
    geo.translate(0, p.H / 2, 0);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, lam(0x7d5532, { flatShading: true, map: dirtTex([2, 2], '#7a5231') }));
    mesh.position.set(p.x, 0, p.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return { ...p, v0: p.v, mesh };
  });

  // gas pipe zones with flags
  const gas: GasZone[] = cfg.gas.map((z) => {
    const fl = new THREE.Group();
    const decal = new THREE.Mesh(new THREE.CircleGeometry(z.r, 20), new THREE.MeshBasicMaterial({
      map: canvasTex(256, 256, (c) => {
        c.fillStyle = 'rgba(255,40,30,0.28)';
        c.beginPath();
        c.arc(128, 128, 126, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#ffd400';
        c.lineWidth = 12;
        c.setLineDash([26, 16]);
        c.beginPath();
        c.arc(128, 128, 116, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#ffd400';
        c.font = 'bold 84px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('⚠', 128, 120);
        c.font = 'bold 30px sans-serif';
        c.fillText('가스관', 128, 190);
      }),
      transparent: true,
      depthWrite: false,
    }));
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = 0.03;
    fl.add(decal);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const px = Math.cos(a) * (z.r + 0.2);
      const pz = Math.sin(a) * (z.r + 0.2);
      fl.add(box(0.06, 1.5, 0.06, lam(0xdddddd), px, 0.75, pz));
      fl.add(box(0.5, 0.32, 0.03, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff2a2a : 0xffd400 }), px + 0.25, 1.32, pz));
    }
    fl.position.set(z.x, 0, z.z);
    g.add(fl);
    return { x: z.x, z: z.z, r: z.r, cool: 0, flags: fl };
  });

  // workers
  const workers: Worker[] = cfg.workers.map((w) => {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.1, 8), lam(0xff7a00));
    body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lam(0xf0c8a0));
    head.position.y = 1.62;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), lam(0xffe100));
    helmet.position.y = 1.66;
    const legs = box(0.45, 0.4, 0.25, lam(0x2b3a55), 0, 0.2, 0);
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 8), lam(0xdfe6ff));
    vest.position.y = 0.95;
    grp.add(body, head, helmet, legs, vest);
    grp.position.set(w.a[0], 0, w.a[1]);
    g.add(grp);
    return { mesh: grp, x: w.a[0], z: w.a[1], a: w.a, b: w.b, speed: w.speed, toB: true, wait: 0, stun: 0 };
  });

  // rain
  let rain: THREE.LineSegments | null = null;
  if (cfg.rain) {
    const n = 380;
    const arr = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 50;
      const y = Math.random() * 25;
      const z = (Math.random() - 0.5) * 50;
      arr.set([x, y, z, x - 0.12, y - 0.9, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb8e0, transparent: true, opacity: 0.55 }));
    rain.frustumCulled = false;
    g.add(rain);
  }

  // guidance marker (bobbing arrow)
  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
  marker.rotation.x = Math.PI;
  g.add(marker);

  return { group: g, boxes, piles, gas, workers, rain, lights, sun, marker };
}

function addProp(g: THREE.Group, boxes: Box3[], p: PropCfg, night: boolean) {
  const hx = p.w / 2;
  const hz = p.d / 2;
  const add = (b: Partial<Box3> = {}) => boxes.push({ x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz, y0: 0, y1: p.h, ...b });
  switch (p.kind) {
    case 'container': {
      const t = tex.container('#' + (p.color ?? 0x888888).toString(16).padStart(6, '0'));
      const mat = new THREE.MeshLambertMaterial({ map: t });
      const m = box(p.w, p.h, p.d, mat, p.x, p.h / 2, p.z);
      g.add(m);
      add();
      break;
    }
    case 'cabin':
      g.add(box(p.w, p.h, p.d, lam(0xe8e4d8), p.x, p.h / 2, p.z));
      g.add(box(p.w + 0.3, 0.2, p.d + 0.3, lam(0x4a5a6a), p.x, p.h + 0.1, p.z));
      g.add(box(1.4, 1.0, 0.05, lam(0x20405e), p.x - 1.2, 1.7, p.z - hz - 0.02));
      add({ y1: p.h + 0.2 });
      break;
    case 'barrel': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.95, 8), lam(0xcc2a22));
      m.position.set(p.x, 0.48, p.z);
      g.add(m);
      add({ y1: 0.95 });
      break;
    }
    case 'cone': {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 8), lam(0xff6a00));
      m.position.set(p.x, 0.35, p.z);
      g.add(m);
      add();
      break;
    }
    case 'lamp': {
      g.add(box(0.2, p.h, 0.2, lam(0x44484f), p.x, p.h / 2, p.z));
      g.add(box(1.0, 0.3, 0.5, new THREE.MeshBasicMaterial({ color: night ? 0xfff2b0 : 0xdddddd }), p.x, p.h, p.z));
      if (night) {
        const l = new THREE.PointLight(0xffe9b0, 90, 30, 1.6);
        l.position.set(p.x, p.h - 0.5, p.z);
        g.add(l);
      }
      add({ x0: p.x - 0.25, x1: p.x + 0.25, z0: p.z - 0.25, z1: p.z + 0.25 });
      break;
    }
    case 'pipes':
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, p.w, 10), lam(0x2d2f36));
        c.rotation.z = Math.PI / 2;
        c.position.set(p.x, 0.4 + (i === 2 ? 0.65 : 0), p.z + (i === 0 ? -0.4 : i === 1 ? 0.4 : 0));
        g.add(c);
      }
      add();
      break;
  }
}

// ---------------------------------------------------------------- trucks
export const TRUCK = {
  bedCenterZ: -1.3,
  bedHalfX: 1.0,
  bedZ0: -3.7,
  bedZ1: 1.1,
  floorY: 1.3,
};

/** local-space collision boxes of the dump truck */
export const TRUCK_BOXES: Box3[] = [
  { x0: -1.2, x1: 1.2, z0: -3.9, z1: 3.9, y0: 0, y1: 1.1 },
  { x0: -1.2, x1: 1.2, z0: -3.9, z1: 1.3, y0: 1.1, y1: 1.3 },
  { x0: 1.05, x1: 1.2, z0: -3.9, z1: 1.3, y0: 1.1, y1: 2.7 },
  { x0: -1.2, x1: -1.05, z0: -3.9, z1: 1.3, y0: 1.1, y1: 2.7 },
  { x0: -1.2, x1: 1.2, z0: 1.15, z1: 1.3, y0: 1.1, y1: 3.0 },
  { x0: -1.2, x1: 1.2, z0: -3.9, z1: -3.75, y0: 1.1, y1: 2.6 },
  { x0: -1.2, x1: 1.2, z0: 1.5, z1: 3.9, y0: 1.1, y1: 3.1 },
];

export interface Truck {
  group: THREE.Group;
  dirt: THREE.Mesh;
  x: number; z: number; yaw: number; cap: number; loaded: number;
  px: number; pz: number; // park position
  state: 'arriving' | 'parked' | 'leaving' | 'gone';
  speed: number;
}

export function buildTruck(cfg: { x: number; z: number; yaw: number; cap: number }, shadows: boolean): Truck {
  const grp = new THREE.Group();
  const yellow = lam(0xf2b705);
  const white = lam(0xf4f4f4);
  const dark = lam(0x2b2d31);
  grp.add(box(2.3, 0.6, 7.8, dark, 0, 0.75, 0));
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10);
  for (const sx of [-1, 1]) {
    for (const z of [-3.2, -1.9, 2.8]) {
      const w = new THREE.Mesh(wheelGeo, lam(0x161616));
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 1.2, 0.55, z);
      grp.add(w);
    }
  }
  grp.add(box(2.4, 2.0, 2.4, white, 0, 2.1, 2.7));
  grp.add(box(2.0, 0.9, 0.05, lam(0x1d3a5a), 0, 2.55, 3.93));
  grp.add(box(2.45, 0.15, 2.0, yellow, 0, 3.15, 2.5));
  grp.add(box(2.4, 0.2, 5.2, yellow, 0, 1.2, -1.3));
  grp.add(box(0.15, 1.6, 5.2, yellow, 1.125, 1.9, -1.3));
  grp.add(box(0.15, 1.6, 5.2, yellow, -1.125, 1.9, -1.3));
  grp.add(box(2.4, 1.9, 0.15, yellow, 0, 2.05, 1.225));
  grp.add(box(2.4, 1.5, 0.15, yellow, 0, 1.85, -3.825));
  const dg = new THREE.BoxGeometry(2.0, 1, 4.9);
  dg.translate(0, 0.5, 0);
  const dirt = new THREE.Mesh(dg, lam(0x7a5230));
  dirt.position.set(0, 1.3, -1.3);
  dirt.scale.y = 0.001;
  grp.add(dirt);
  grp.traverse((o) => {
    if (shadows && (o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  grp.rotation.y = cfg.yaw;
  grp.position.set(cfg.x, 0, cfg.z);
  return { group: grp, dirt, x: cfg.x, z: cfg.z, yaw: cfg.yaw, cap: cfg.cap, loaded: 0, px: cfg.x, pz: cfg.z, state: 'parked', speed: 0 };
}

export function truckToLocal(t: Truck, wx: number, wz: number): [number, number] {
  const c = Math.cos(t.yaw);
  const s = Math.sin(t.yaw);
  const dx = wx - t.x;
  const dz = wz - t.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

export function truckWorldBoxes(t: Truck, out: Box3[]) {
  const c = Math.round(Math.cos(t.yaw));
  const s = Math.round(Math.sin(t.yaw));
  for (const b of TRUCK_BOXES) {
    const pts = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]].map(([lx, lz]) => [t.x + lx * c + lz * s, t.z - lx * s + lz * c]);
    out.push({
      x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])),
      z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])),
      y0: b.y0, y1: b.y1,
    });
  }
}
