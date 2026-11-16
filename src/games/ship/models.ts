import * as THREE from 'three';
import type { LevelCfg, ShipKind } from './level';

// ------------------------------------------------------------------ textures
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

export const texTile = (dim: boolean, rep: [number, number]) => canvasTex(256, 256, (g) => {
  const cols = dim ? ['#6c7f86', '#7a8c93', '#5f7279'] : ['#bfe3e6', '#d3eef0', '#a9d7dc'];
  const n = 4;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = cols[(x + y * 2) % 3 === 0 ? 2 : (x + y) % 2];
      g.fillRect((x * 256) / n, (y * 256) / n, 256 / n, 256 / n);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect((x * 256) / n + 4, (y * 256) / n + 4, 20, 6);
    }
  }
  g.strokeStyle = dim ? '#33454b' : '#8fb4b8';
  g.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo((i * 256) / n, 0); g.lineTo((i * 256) / n, 256); g.stroke();
    g.beginPath(); g.moveTo(0, (i * 256) / n); g.lineTo(256, (i * 256) / n); g.stroke();
  }
}, rep);

export const texCaustic = () => canvasTex(256, 256, (g) => {
  g.fillStyle = '#d9f3f6';
  g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    g.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.4})`;
    g.lineWidth = 2 + Math.random() * 4;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 30 * (Math.random() - 0.5), y + 40 * Math.random(), x + 60 * (Math.random() - 0.5), y + 50 * Math.random());
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(60,140,170,${0.08 + Math.random() * 0.12})`;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 16, 0, 7);
    g.fill();
  }
}, [7, 5]);

const texSpiral = () => canvasTex(256, 256, (g) => {
  const gr = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  gr.addColorStop(0, 'rgba(8,24,40,0.95)');
  gr.addColorStop(0.5, 'rgba(40,110,140,0.6)');
  gr.addColorStop(1, 'rgba(120,190,210,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 5;
  for (let a = 0; a < 3; a++) {
    g.beginPath();
    for (let i = 0; i < 80; i++) {
      const r = 6 + i * 1.5;
      const ang = a * 2.1 + i * 0.12;
      const x = 128 + Math.cos(ang) * r;
      const y = 128 + Math.sin(ang) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
});

const texFoam = () => canvasTex(128, 128, (g) => {
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    const r = 5 + Math.random() * 12;
    const a = Math.random() * 6.28;
    const d = Math.sqrt(Math.random()) * 52;
    g.fillStyle = `rgba(255,255,255,${0.5 + Math.random() * 0.4})`;
    g.beginPath();
    g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, 7);
    g.fill();
  }
});

const texTowel = () => canvasTex(128, 96, (g) => {
  g.fillStyle = '#3f9a4d';
  g.fillRect(0, 0, 128, 96);
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 2;
  for (let i = -96; i < 128; i += 6) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 96, 96); g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  for (let i = -96; i < 128; i += 6) {
    g.beginPath(); g.moveTo(i + 3, 0); g.lineTo(i + 99, 96); g.stroke();
  }
  g.fillStyle = '#d9d02a';
  g.fillRect(0, 0, 128, 6);
  g.fillRect(0, 90, 128, 6);
});

function signTex(text: string, bg: string, fg: string, w = 256, h = 128, font = 'bold 54px sans-serif') {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 3);
  });
}

// ------------------------------------------------------------------ materials
const phong = (color: number, o: THREE.MeshPhongMaterialParameters = {}) => new THREE.MeshPhongMaterial({ color, shininess: 40, specular: 0x444444, ...o });

function bx(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

// ------------------------------------------------------------------ ships
export interface ShipModel {
  root: THREE.Group; // positioned & yawed
  body: THREE.Group; // rolled / pitched / sunk
  mats: THREE.MeshPhongMaterial[]; // for hit flash
  turrets: THREE.Group[];
  flag: THREE.Mesh | null;
  funnel: THREE.Vector3;
  up?: THREE.Group; // sub: tower+periscope
  hl: number;
  hb: number;
}

function hullGeo(hl: number, hb: number, h: number, y0: number) {
  const s = new THREE.Shape();
  // shape x = beam, shape y = forward; mirrored polygon
  const pts: [number, number][] = [
    [0, hl], [hb * 0.5, hl * 0.72], [hb * 0.92, hl * 0.3], [hb, -hl * 0.1], [hb, -hl * 0.6], [hb * 0.82, -hl],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  for (let i = pts.length - 1; i >= 1; i--) s.lineTo(-pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // (x, y, z) -> (x, -z, y): extrusion goes down, shape-y becomes +z
  g.translate(0, y0 + h, 0);
  return g;
}

function turret(mat: THREE.Material, barrels: number, len: number, w = 0.34) {
  const g = new THREE.Group();
  g.add(cyl(w, w * 1.1, 0.16, mat, 0, 0.08, 0, 10));
  for (let i = 0; i < barrels; i++) {
    const off = (i - (barrels - 1) / 2) * 0.14;
    g.add(bx(0.06, 0.06, len, mat, off, 0.17, len / 2 + 0.1));
  }
  return g;
}

export interface ShipOpts { hull: number; deck: number; accent: number; boss?: boolean; player?: boolean }

export function buildShip(kind: ShipKind, o: ShipOpts): ShipModel {
  if (kind === 'sub') return buildSub(o);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mats: THREE.MeshPhongMaterial[] = [];
  const m = (c: number, extra: THREE.MeshPhongMaterialParameters = {}) => {
    const mm = phong(c, { emissive: 0x000000, ...extra });
    mats.push(mm);
    return mm;
  };
  const P = {
    hl: kind === 'battleship' ? 3.3 : kind === 'gunboat' ? 1.45 : kind === 'player' ? 2.45 : 2.2,
    hb: kind === 'battleship' ? 0.85 : kind === 'gunboat' ? 0.4 : kind === 'player' ? 0.58 : 0.5,
    h: kind === 'battleship' ? 0.55 : kind === 'gunboat' ? 0.3 : 0.42,
  };
  const draft = P.h * 0.45;
  const lowerMat = m(0x8f2c24);
  const hullMat = m(o.hull);
  const deckMat = m(o.deck);
  const darkMat = m(0x4a4f55);
  const accentMat = m(o.accent);
  // red anti-fouling bottom + grey topsides
  const low = new THREE.Mesh(hullGeo(P.hl, P.hb * 0.96, draft, -draft), lowerMat);
  const up = new THREE.Mesh(hullGeo(P.hl, P.hb, P.h - draft, 0), hullMat);
  body.add(low, up);
  const deckY = P.h - draft;
  const turrets: THREE.Group[] = [];
  const addTurret = (z: number, y: number, barrels: number, len: number, mat = darkMat) => {
    const t = turret(mat, barrels, len);
    t.position.set(0, y, z);
    body.add(t);
    turrets.push(t);
  };
  let funnel = new THREE.Vector3(0, deckY + 0.7, -0.2);
  let flag: THREE.Mesh | null = null;
  if (kind === 'battleship') {
    addTurret(P.hl * 0.56, deckY, 3, 0.9);
    addTurret(P.hl * 0.34, deckY + 0.2, 3, 0.9);
    addTurret(-P.hl * 0.55, deckY, 3, 0.9);
    body.add(bx(0.9, 0.5, 1.5, deckMat, 0, deckY + 0.25, -0.1));
    body.add(bx(0.55, 0.5, 0.7, hullMat, 0, deckY + 0.75, 0.15));
    body.add(bx(0.7, 0.18, 0.8, darkMat, 0, deckY + 1.08, 0.15));
    body.add(cyl(0.025, 0.025, 1.0, darkMat, 0, deckY + 1.6, 0.15, 4));
    body.add(cyl(0.2, 0.24, 0.8, darkMat, 0, deckY + 0.9, -0.85, 10));
    body.add(cyl(0.21, 0.21, 0.1, accentMat, 0, deckY + 1.1, -0.85, 10));
    funnel = new THREE.Vector3(0, deckY + 1.4, -0.85);
  } else if (kind === 'gunboat') {
    addTurret(P.hl * 0.45, deckY, 1, 0.5);
    body.add(bx(0.4, 0.3, 0.6, deckMat, 0, deckY + 0.15, -0.3));
    body.add(cyl(0.07, 0.07, 0.3, darkMat, 0, deckY + 0.45, -0.55, 6));
    funnel = new THREE.Vector3(0, deckY + 0.7, -0.55);
  } else {
    addTurret(P.hl * 0.55, deckY, 2, 0.6);
    addTurret(-P.hl * 0.5, deckY, 2, 0.6);
    addTurret(-P.hl * 0.22, deckY + 0.22, 1, 0.45);
    body.add(bx(0.55, 0.4, 0.9, deckMat, 0, deckY + 0.2, P.hl * 0.12));
    body.add(bx(0.4, 0.2, 0.5, hullMat, 0, deckY + 0.5, P.hl * 0.12));
    body.add(cyl(0.025, 0.025, 0.9, darkMat, 0, deckY + 1.1, P.hl * 0.12, 4));
    body.add(cyl(0.14, 0.17, 0.7, darkMat, 0, deckY + 0.55, -0.25, 10));
    body.add(cyl(0.15, 0.15, 0.1, accentMat, 0, deckY + 0.75, -0.25, 10));
    body.add(bx(0.55, 0.12, 0.3, darkMat, 0, deckY + 0.08, -P.hl * 0.05)); // torpedo tubes
    funnel = new THREE.Vector3(0, deckY + 1.0, -0.25);
  }
  // mast flag (accent colour; no real flags)
  const mastZ = kind === 'battleship' ? 0.15 : kind === 'gunboat' ? -0.3 : P.hl * 0.12;
  const mastTop = kind === 'battleship' ? deckY + 2.1 : kind === 'gunboat' ? deckY + 0.7 : deckY + 1.55;
  flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.28), new THREE.MeshBasicMaterial({ color: o.accent, side: THREE.DoubleSide }));
  flag.position.set(0, mastTop - 0.12, mastZ - 0.28);
  flag.rotation.y = Math.PI / 2;
  body.add(flag);
  if (o.player) {
    // the rubber band motor: a yellow loop at the stern + prop
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 5, 14), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
    band.position.set(0, deckY + 0.14, -P.hl + 0.25);
    body.add(band);
    body.add(bx(0.05, 0.05, 0.5, accentMat, 0, deckY + 0.05, -P.hl + 0.4));
  }
  return { root, body, mats, turrets, flag, funnel, hl: P.hl, hb: P.hb };
}

function buildSub(o: ShipOpts): ShipModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mats: THREE.MeshPhongMaterial[] = [];
  const m = (c: number) => {
    const mm = phong(c, { emissive: 0x000000 });
    mats.push(mm);
    return mm;
  };
  const sc = o.boss ? 1.5 : 1;
  const hullMat = m(o.hull);
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 9), hullMat);
  hull.scale.set(0.5 * sc, 0.45 * sc, 2.6 * sc);
  body.add(hull);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.505 * sc, 0.505 * sc, 0.16, 12), m(o.accent));
  band.rotation.x = Math.PI / 2;
  band.position.z = -0.5 * sc;
  body.add(band);
  body.add(bx(0.07, 0.5 * sc, 0.9 * sc, hullMat, 0, 0, -2.4 * sc).translateY(0.25 * sc)); // tail fin
  const up = new THREE.Group();
  up.add(bx(0.4 * sc, 0.45 * sc, 0.9 * sc, hullMat, 0, 0.55 * sc, 0.2 * sc));
  up.add(cyl(0.025, 0.025, 0.9, m(0x222222), 0, 1.05 * sc, 0.35 * sc, 4));
  up.add(bx(0.09, 0.07, 0.16, m(0x222222), 0, 1.5 * sc, 0.4 * sc));
  const gun = new THREE.Group();
  gun.add(cyl(0.12, 0.12, 0.12, m(0x333333), 0, 0.12, 0, 8));
  gun.add(bx(0.05, 0.05, 0.5, m(0x333333), 0, 0.15, 0.3));
  gun.position.set(0, 0.62 * sc, -0.6 * sc);
  up.add(gun);
  body.add(up);
  return { root, body, mats, turrets: [gun], flag: null, funnel: new THREE.Vector3(0, 1, -0.3), up, hl: 2.4 * sc, hb: 0.5 * sc };
}

// ------------------------------------------------------------------ props
export function buildDuck(): THREE.Group {
  const g = new THREE.Group();
  const y = new THREE.MeshPhongMaterial({ color: 0xffd21f, shininess: 70, specular: 0x666666 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), y);
  body.scale.set(0.95, 0.7, 1.2);
  body.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), y);
  head.position.set(0, 1.35, 0.7);
  const beak = bx(0.4, 0.14, 0.4, new THREE.MeshPhongMaterial({ color: 0xff7a1a }), 0, 1.3, 1.25);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 6), y);
  tail.rotation.x = -1.9;
  tail.position.set(0, 0.95, -1.2);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), eyeM);
  e1.position.set(0.28, 1.5, 1.05);
  const e2 = e1.clone();
  e2.position.x = -0.28;
  g.add(body, head, beak, tail, e1, e2);
  g.scale.setScalar(1.1);
  return g;
}

export function buildSoap(): THREE.Group {
  const g = new THREE.Group();
  const soap = bx(1.9, 0.6, 1.2, new THREE.MeshPhongMaterial({ color: 0xf2a6b8, shininess: 90, specular: 0xffffff }), 0, 0.12, 0);
  const stamp = bx(1.2, 0.02, 0.6, new THREE.MeshBasicMaterial({ color: 0xffe6ee }), 0, 0.43, 0);
  g.add(soap, stamp);
  return g;
}

export function buildFoamPatch(r: number): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ map: texFoam(), transparent: true, opacity: 0.8, depthWrite: false });
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

export function buildTowel(w: number, d: number): THREE.Mesh {
  const m = bx(w, 0.14, d, new THREE.MeshLambertMaterial({ map: texTowel() }), 0, 0.02, 0);
  return m;
}

export function buildPickup(kind: 'wind' | 'glue' | 'torp'): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'wind') {
    const mat = new THREE.MeshPhongMaterial({ color: 0xffc928, shininess: 60, emissive: 0x553300 });
    const a = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 6, 14), mat);
    const b = a.clone();
    b.rotation.x = Math.PI / 2;
    g.add(a, b, bx(0.2, 0.7, 0.2, new THREE.MeshPhongMaterial({ color: 0xcccccc }), 0, 0, 0));
  } else if (kind === 'glue') {
    g.add(cyl(0.3, 0.3, 0.9, new THREE.MeshPhongMaterial({ color: 0xf2d11a, emissive: 0x332a00 }), 0, 0, 0, 10));
    g.add(cyl(0.12, 0.3, 0.28, new THREE.MeshPhongMaterial({ color: 0x2a5fd0 }), 0, 0.55, 0, 10));
    g.add(bx(0.62, 0.34, 0.02, new THREE.MeshBasicMaterial({ color: 0xd32a2a }), 0, 0, 0.31));
  } else {
    g.add(bx(1.0, 0.4, 0.7, new THREE.MeshPhongMaterial({ color: 0xc8302a, emissive: 0x330a08 }), 0, 0, 0));
    g.add(bx(0.7, 0.02, 0.5, new THREE.MeshBasicMaterial({ color: 0xf1e3c0 }), 0, 0.21, 0));
    for (let i = 0; i < 3; i++) g.add(cyl(0.03, 0.03, 1.0, new THREE.MeshPhongMaterial({ color: 0xd9b36b }), (i - 1) * 0.16, 0.34, 0, 4).rotateZ(Math.PI / 2));
  }
  g.scale.setScalar(1.15);
  return g;
}

export function buildTorpedo(enemy: boolean): THREE.Group {
  const g = new THREE.Group();
  const stick = cyl(0.045, 0.045, 1.2, new THREE.MeshPhongMaterial({ color: enemy ? 0x8a6a40 : 0xe0bd75 }), 0, 0, 0, 5);
  stick.rotation.x = Math.PI / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshPhongMaterial({ color: enemy ? 0x4a1a1a : 0xd8261a }));
  head.position.z = -0.6;
  g.add(stick, head);
  return g;
}

// ------------------------------------------------------------------ the bathroom
export interface Room {
  group: THREE.Group;
  waterMesh: THREE.Mesh;
  waterGeo: THREE.BufferGeometry;
  caustic: THREE.Texture;
  spiral: THREE.Mesh;
  plug: THREE.Mesh;
  scoop: THREE.Group;
  scoopStream: THREE.Mesh;
  warn: THREE.Mesh;
  stream: THREE.Mesh | null;
  streamTex: THREE.Texture | null;
  faucetPos: { x: number; z: number };
  waterRings: number;
  waterSegs: number;
}

export const lampName = 'ceil-lamp';

export function buildRoom(cfg: LevelCfg): Room {
  const g = new THREE.Group();
  const { rx, rz, dim } = cfg;
  const FLOOR = -4.4;
  const RIM = 2.7;

  // tub: red rubber basin
  const tubMat = new THREE.MeshPhongMaterial({ color: dim ? 0x8a2a24 : 0xd23a2e, shininess: 25, side: THREE.DoubleSide });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.03, 0.9, RIM - FLOOR, 56, 1, true), tubMat);
  wall.scale.set(rx + 0.2, 1, rz + 0.2);
  wall.position.y = (RIM + FLOOR) / 2;
  g.add(wall);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 72), tubMat);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(rx + 0.8, rz + 0.8, 14);
  rim.position.y = RIM;
  g.add(rim);
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshLambertMaterial({ color: dim ? 0x6a8a98 : 0xe8f2f4 }));
  bottom.rotation.x = -Math.PI / 2;
  bottom.scale.set(rx, rz, 1);
  bottom.position.y = FLOOR + 0.05;
  g.add(bottom);

  // water: polar grid, vertices displaced each frame
  const rings = 14;
  const segs = 52;
  const pos = new Float32Array((rings * segs + 1) * 3);
  const uv = new Float32Array((rings * segs + 1) * 2);
  for (let i = 0; i <= rings; i++) {
    const r = i === 0 ? 0 : (i / rings) ** 0.85;
    const cnt = i === 0 ? 1 : segs;
    for (let j = 0; j < cnt; j++) {
      const idx = i === 0 ? 0 : 1 + (i - 1) * segs + j;
      const a = (j / segs) * Math.PI * 2;
      pos[idx * 3] = Math.cos(a) * r * (rx + 0.25);
      pos[idx * 3 + 1] = 0;
      pos[idx * 3 + 2] = Math.sin(a) * r * (rz + 0.25);
      uv[idx * 2] = pos[idx * 3] / 14;
      uv[idx * 2 + 1] = pos[idx * 3 + 2] / 14;
    }
  }
  const index: number[] = [];
  const vi = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * segs + (j % segs));
  for (let j = 0; j < segs; j++) index.push(0, vi(1, j + 1), vi(1, j));
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      index.push(vi(i, j), vi(i, j + 1), vi(i + 1, j));
      index.push(vi(i, j + 1), vi(i + 1, j + 1), vi(i + 1, j));
    }
  }
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  waterGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  waterGeo.setIndex(index);
  waterGeo.computeVertexNormals();
  const caustic = texCaustic();
  const waterMesh = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({
    color: dim ? 0x2c6a80 : 0x4fb3cf, map: caustic, specular: 0x7a8a90, shininess: 60, transparent: true, opacity: 0.86,
  }));
  g.add(waterMesh);

  // room
  const WR = Math.max(rx, rz * 1.4) + 26;
  const wallTex = texTile(dim, [Math.round(WR / 5), 8]);
  const room = new THREE.Mesh(new THREE.CylinderGeometry(WR, WR, 80, 48, 1, true), new THREE.MeshBasicMaterial({ map: wallTex, side: THREE.BackSide, color: dim ? 0xb0a8b8 : 0xffffff, fog: false }));
  room.position.y = FLOOR + 40;
  g.add(room);
  const floorTex = texTile(dim, [26, 26]);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(WR, 40), new THREE.MeshBasicMaterial({ map: floorTex, color: dim ? 0x9a94a4 : 0xeeeeee, fog: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR;
  g.add(floor);
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(WR, 24), new THREE.MeshBasicMaterial({ color: dim ? 0x2a2630 : 0xfff8e8 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = FLOOR + 60;
  g.add(ceil);
  ceil.name = lampName;
  // wall props on shelves (visible over the rim)
  const shelfMat = new THREE.MeshLambertMaterial({ color: 0xc9b48a });
  const props: THREE.Object3D[] = [];
  const onWall = (ang: number, y: number, obj: THREE.Object3D, face = true) => {
    const r = WR - 1.2;
    obj.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
    if (face) obj.rotation.y = -ang - Math.PI / 2;
    props.push(obj);
    g.add(obj);
  };
  const shelf = (ang: number, y: number, items: THREE.Object3D[]) => {
    const s = new THREE.Group();
    s.add(bx(7, 0.3, 1.8, shelfMat, 0, 0, 0));
    items.forEach((it, i) => {
      it.position.x += (i - (items.length - 1) / 2) * 2;
      it.position.y += 0.15;
      s.add(it);
    });
    onWall(ang, y, s);
  };
  const bottle = (c: number, h: number) => {
    const b = new THREE.Group();
    b.add(cyl(0.55, 0.6, h, new THREE.MeshPhongMaterial({ color: c, shininess: 80 }), 0, h / 2, 0, 12));
    b.add(cyl(0.2, 0.2, 0.5, new THREE.MeshPhongMaterial({ color: 0xffffff }), 0, h + 0.2, 0, 8));
    return b;
  };
  const angs = [0.2, 0.9, 1.6, 2.3, 3.0, 3.8, 4.5, 5.2, 5.8];
  shelf(angs[0], 7, [bottle(0xe86aa0, 3), bottle(0x4aa0e8, 2.4), bottle(0xf5e04a, 3.4)]);
  shelf(angs[3], 9, [bottle(0x6ac86a, 2.6), bottle(0xe86aa0, 3.4)]);
  shelf(angs[6], 6.5, [bottle(0xf5a34a, 3), bottle(0x9a6ae8, 2.6), bottle(0x4aa0e8, 3.2)]);
  // signs
  onWall(angs[1], 14, new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: signTex('♨ 목욕탕', '#2a5fa8', '#ffffff', 256, 128, 'bold 64px sans-serif') })));
  onWall(angs[4], 12, new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshBasicMaterial({ map: signTex('때밀이 환영', '#d8a21a', '#3a2200', 256, 128, 'bold 50px sans-serif') })));
  onWall(angs[7], 13, new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshBasicMaterial({ map: signTex('1989 달력', '#f4ecd8', '#b52a2a', 256, 128, 'bold 46px sans-serif') })));
  // hanging 바가지 stack + 때수건
  const scoopA = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0x3a74d8, side: THREE.DoubleSide }));
  scoopA.rotation.x = Math.PI;
  onWall(angs[2], 10, scoopA, false);
  onWall(angs[5], 9, bx(1.4, 3.4, 0.3, new THREE.MeshLambertMaterial({ color: 0x3f9a4d }), 0, 0, 0));
  onWall(angs[8], 8, bx(5, 7, 0.3, new THREE.MeshLambertMaterial({ color: 0xf4f0e6 }), 0, 0, 0)); // hanging towel
  // ceiling lamp glow (warm)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8), new THREE.MeshBasicMaterial({ color: dim ? 0xffb066 : 0xfff3c8 }));
  lamp.position.set(0, FLOOR + 48, 0);
  lamp.name = lampName;
  g.add(lamp);

  // faucet: pipe over the rim + dripping/streaming spout at cfg.faucet
  const f = cfg.faucet!;
  const chrome = new THREE.MeshPhongMaterial({ color: 0xcfd6dc, shininess: 120, specular: 0xffffff });
  const len = Math.hypot(f.x, f.z) || 1;
  const ox = f.x / len;
  const oz = f.z / len;
  let s = 0;
  while (s < 40 && ((f.x + ox * s) / (rx + 0.2)) ** 2 + ((f.z + oz * s) / (rz + 0.2)) ** 2 < 1) s += 0.5;
  const sx = f.x + ox * (s + 3.5);
  const sz = f.z + oz * (s + 3.5);
  const pipe = new THREE.Group();
  pipe.add(cyl(0.7, 0.7, 14 - FLOOR - 1, chrome, sx, (14 + FLOOR - 1) / 2, sz, 10));
  const arm = cyl(0.55, 0.55, s + 3.5, chrome, 0, 0, 0, 10);
  arm.rotation.set(0, 0, Math.PI / 2); // lies along local X; the holder yaws it onto (ox, oz)
  const armHolder = new THREE.Group();
  armHolder.add(arm);
  armHolder.position.set((f.x + sx) / 2, 14, (f.z + sz) / 2);
  armHolder.rotation.y = -Math.atan2(oz, ox);
  pipe.add(armHolder);
  pipe.add(cyl(0.6, 0.6, 1.2, chrome, f.x, 13.4, f.z, 10));
  g.add(pipe);
  let stream: THREE.Mesh | null = null;
  let streamTex: THREE.Texture | null = null;
  if (f.force > 0) {
    streamTex = canvasTex(32, 128, (c) => {
      c.fillStyle = '#bfeaf5';
      c.fillRect(0, 0, 32, 128);
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 8; i++) c.fillRect(Math.random() * 28, i * 16, 3, 10);
    }, [1, 2]);
    stream = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 13.2, 8, 1, true), new THREE.MeshBasicMaterial({ map: streamTex, transparent: true, opacity: 0.7, depthWrite: false }));
    stream.position.set(f.x, 6.6, f.z);
    g.add(stream);
  }

  // drain: plug on the bottom + whirlpool disc
  const dr = cfg.drain;
  const spiral = new THREE.Mesh(new THREE.CircleGeometry(dr ? dr.rad : 1, 36), new THREE.MeshBasicMaterial({ map: texSpiral(), transparent: true, opacity: 0, depthWrite: false }));
  spiral.rotation.x = -Math.PI / 2;
  spiral.visible = !!dr;
  if (dr) spiral.position.set(dr.x, 0.12, dr.z);
  g.add(spiral);
  const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.7, 0.5, 12), new THREE.MeshPhongMaterial({ color: 0x1c1c1c, shininess: 60 }));
  plug.visible = !!dr;
  if (dr) plug.position.set(dr.x, FLOOR + 0.3, dr.z);
  g.add(plug);

  // 바가지 (the pour) + warning shadow
  const scoop = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0x3a74d8, shininess: 80, side: THREE.DoubleSide }));
  bowl.rotation.x = Math.PI; // open side up by default (bowl hemisphere down)
  bowl.position.y = 0;
  scoop.add(bowl);
  scoop.add(bx(0.7, 0.4, 5, new THREE.MeshPhongMaterial({ color: 0x2a58b0 }), 0, 0.2, -5.4));
  scoop.visible = false;
  g.add(scoop);
  const scoopStream = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.2, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xbfeaf5, transparent: true, opacity: 0.75, depthWrite: false }));
  scoopStream.visible = false;
  g.add(scoopStream);
  const warn = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }));
  warn.rotation.x = -Math.PI / 2;
  warn.renderOrder = 10;
  warn.visible = false;
  const shade = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false }));
  shade.renderOrder = 9;
  warn.add(shade);
  shade.rotation.x = 0;
  g.add(warn);

  return {
    group: g, waterMesh, waterGeo, caustic, spiral, plug, scoop, scoopStream, warn, stream, streamTex,
    faucetPos: { x: f.x, z: f.z }, waterRings: rings, waterSegs: segs,
  };
}
