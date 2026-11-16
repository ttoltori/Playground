import * as THREE from 'three';
import { box } from '../forklift/world';
import type { Setup } from './parts';
import { DS, LANE_W, deckY, type Seg, type Track } from './track';

export const HALF_W = 1.6; // deck half width
export const WALL_H = 0.5;
export const DECK_Y = 0.14;

const lam = (c: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });

export function textTex(text: string, w: number, h: number, bg: string, fg: string, font = 'bold 64px sans-serif', stripe = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (stripe) {
    g.fillStyle = 'rgba(255,255,255,.18)';
    for (let x = -h; x < w; x += 36) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 18, h);
      g.lineTo(x + 18 + h, 0);
      g.lineTo(x + h, 0);
      g.fill();
    }
  }
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Pt {
  x: number;
  y: number;
  z: number; // world coords
  nx: number;
  nz: number; // left normal in world xz
}

/** centreline samples between two lap distances as world points */
function pts(track: Track, s0: number, s1: number): Pt[] {
  const out: Pt[] = [];
  const i0 = Math.floor(s0 / DS), i1 = Math.min(track.samples.length - 1, Math.ceil(s1 / DS));
  for (let i = i0; i <= i1; i++) {
    const sm = track.samples[i];
    const sLap = Math.min(track.length, i * DS);
    const nxm = -Math.sin(sm.h), nzm = Math.cos(sm.h); // math left normal
    out.push({ x: sm.x, y: deckY(track, sLap), z: -sm.z, nx: nxm, nz: -nzm });
  }
  return out;
}

function ptAt(track: Track, sLap: number): Pt {
  const i = Math.max(0, Math.min(track.samples.length - 1, Math.round(sLap / DS)));
  const sm = track.samples[i];
  return { x: sm.x, y: deckY(track, sLap), z: -sm.z, nx: -Math.sin(sm.h), nz: -Math.cos(sm.h) };
}

/** extrudes a cross-section profile ([lateral, y] pairs, lateral + = left) along points */
function ribbon(points: Pt[], profile: [number, number][], mat: THREE.Material, close = false): THREE.Mesh | null {
  if (points.length < 2) return null;
  const P = profile.length, N = points.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const p of points) for (const [lat, y] of profile) pos.push(p.x + p.nx * lat, p.y + y, p.z + p.nz * lat);
  const strips = close ? P : P - 1;
  for (let i = 0; i < N - 1; i++)
    for (let j = 0; j < strips; j++) {
      const a = i * P + j, b = i * P + ((j + 1) % P), c = (i + 1) * P + j, d = (i + 1) * P + ((j + 1) % P);
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  return m;
}

export const THEMES = {
  shop: { sky: 0x9ed0ff, fog: 0xbfe0ff, ground: 0x6d6f73, track: 0x2f7fe0, wall: 0xf2f2f2, accent: 0xffd23a },
  roof: { sky: 0xff9a5a, fog: 0xffc08a, ground: 0x8d8a84, track: 0xe8452c, wall: 0xf4efe2, accent: 0x7be0ff },
  hobby: { sky: 0x1d2233, fog: 0x1d2233, ground: 0x8a5a33, track: 0x22b86a, wall: 0xf6f6f6, accent: 0xff3b5e },
} as const;
export type Theme = keyof typeof THEMES;

export interface World {
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  sky: number;
  fog: number;
  bench: THREE.Vector3; // garage turntable position
  sun: THREE.DirectionalLight;
}

export function buildWorld(track: Track, shadows: boolean): World {
  const th = THEMES[track.def.theme];
  const g = new THREE.Group();
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const s of track.samples) {
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, -s.z); maxZ = Math.max(maxZ, -s.z);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 3;
  const R = radius + 10;

  // ground
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), lam(th.ground));
  gm.rotation.x = -Math.PI / 2;
  gm.position.set(cx, 0, cz);
  gm.receiveShadow = shadows;
  g.add(gm);
  if (track.def.theme === 'hobby') {
    // wood planks
    const t = textTex('', 256, 256, '#8a5a33', '#000');
    const c2 = (t.image as HTMLCanvasElement).getContext('2d')!;
    for (let i = 0; i < 8; i++) {
      c2.fillStyle = i % 2 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.05)';
      c2.fillRect(0, i * 32, 256, 32);
      c2.fillStyle = 'rgba(0,0,0,.35)';
      c2.fillRect(0, i * 32, 256, 2);
    }
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(40, 40);
    (gm.material as THREE.MeshLambertMaterial).map = t;
    (gm.material as THREE.MeshLambertMaterial).color.set(0xffffff);
  } else if (track.def.theme === 'roof') {
    const t = textTex('', 128, 128, '#8d8a84', '#000');
    const c2 = (t.image as HTMLCanvasElement).getContext('2d')!;
    c2.strokeStyle = 'rgba(0,0,0,.25)';
    c2.lineWidth = 2;
    c2.strokeRect(1, 1, 126, 126);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(70, 70);
    (gm.material as THREE.MeshLambertMaterial).map = t;
    (gm.material as THREE.MeshLambertMaterial).color.set(0xffffff);
  }

  // props
  const bx = cx, bz = cz - R; // "back" side (-z world)
  if (track.def.theme === 'shop') {
    const front = box(26, 9, 3, lam(0xe9d9b0), bx, 4.5, bz - 4);
    g.add(front);
    g.add(box(26, 1.4, 4.5, new THREE.MeshLambertMaterial({ map: textTex('', 256, 64, '#d92b2b', '#fff', 'bold 40px sans-serif', true) }), bx, 7.6, bz - 2.2));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3), new THREE.MeshBasicMaterial({ map: textTex('문 방 구', 512, 128, '#1b4fb5', '#ffe14a', 'bold 84px sans-serif') }));
    sign.position.set(bx, 9.4, bz - 2.4);
    g.add(sign);
    g.add(box(8, 5, 0.3, lam(0x7fb9d8), bx - 5, 3.2, bz - 2.45));
    g.add(box(5, 6.5, 0.3, lam(0x5b3a22), bx + 7, 3.3, bz - 2.45));
    // gumball machines + crates
    for (let i = 0; i < 4; i++) {
      const x = bx - 10 + i * 4.2 + (i > 1 ? 8 : 0);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 1.6, 10), lam(0xd33));
      base.position.set(x, 0.8, bz + 0.5);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshLambertMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.85 }));
      ball.position.set(x, 2.3, bz + 0.5);
      g.add(base, ball);
    }
    for (let i = 0; i < 5; i++) g.add(box(1.2, 1.2, 1.2, lam([0xe0a030, 0x4a9d5a, 0xd05a5a][i % 3]), cx - R + 1 + i * 1.3, 0.6, cz + 2 - (i % 2) * 1.4));
    // curb ring
    const curb = box(R * 2 + 6, 0.12, 0.4, lam(0xf2c200), cx, 0.07, cz + R + 2);
    g.add(curb);
  } else if (track.def.theme === 'roof') {
    const para = lam(0xb9b4a8);
    g.add(box(R * 2 + 20, 1.2, 0.8, para, cx, 0.6, cz - R - 2), box(R * 2 + 20, 1.2, 0.8, para, cx, 0.6, cz + R + 2));
    g.add(box(0.8, 1.2, R * 2 + 4, para, cx - R - 10, 0.6, cz), box(0.8, 1.2, R * 2 + 4, para, cx + R + 10, 0.6, cz));
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4, 12), lam(0x5d88a8));
    tank.position.set(cx - R + 2, 3.2, cz - R + 1);
    g.add(tank, box(0.3, 1.6, 0.3, lam(0x333), cx - R + 1, 0.8, cz - R + 1), box(0.3, 1.6, 0.3, lam(0x333), cx - R + 3, 0.8, cz - R + 1));
    const ant = box(0.12, 6, 0.12, lam(0x444), cx + R - 3, 3, cz - R + 2);
    g.add(ant, box(1.6, 0.1, 0.1, lam(0x444), cx + R - 3, 5.3, cz - R + 2), box(1.1, 0.1, 0.1, lam(0x444), cx + R - 3, 4.5, cz - R + 2));
    // skyline
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, d = R + 40 + (i % 3) * 10;
      const h = 12 + ((i * 37) % 26);
      g.add(box(8 + (i % 4) * 2, h, 8, lam(0x3a3f55 + (i % 4) * 0x040404), cx + Math.cos(a) * d, h / 2 - 8, cz + Math.sin(a) * d));
    }
    // laundry line (yellow sheets)
    g.add(box(3, 1.6, 0.05, lam(0xfff1b0), cx + R - 6, 3.2, cz + R + 1.5), box(3, 1.6, 0.05, lam(0xb0d8ff), cx + R - 2.5, 3.2, cz + R + 1.5));
  } else {
    // hobby shop: back wall + shelves + banner
    g.add(box(R * 2 + 30, 14, 1, lam(0x2c3248), cx, 7, bz - 6));
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.4), new THREE.MeshBasicMaterial({ map: textTex('🏁 전국대회 결승 🏁', 768, 128, '#b3122f', '#fff', 'bold 72px sans-serif', true) }));
    ban.position.set(bx, 10.5, bz - 5.4);
    g.add(ban);
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 12; i++) {
        const col = [0xe94b4b, 0x4b8fe9, 0xf2c200, 0x3dbb6e, 0xb86be0][(i + r) % 5];
        g.add(box(1.6, 1.0, 0.9, lam(col), bx - 20 + i * 3.6, 1.3 + r * 2.5 + 0.5, bz - 5));
      }
    for (let r = 0; r < 3; r++) g.add(box(R * 2 + 12, 0.15, 1.3, lam(0x6b4a2a), bx, 0.9 + r * 2.5, bz - 5));
    // spectators' tables
    g.add(box(10, 0.6, 3, lam(0x5a3d22), cx - R - 4, 0.3, cz), box(10, 0.6, 3, lam(0x5a3d22), cx + R + 4, 0.3, cz));
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lam(0xf0c8a0));
      p.position.set(cx + (i < 3 ? -R - 6 + i * 2 : R + 2 + (i - 3) * 2), 1.7, cz + (i % 2) * 0.6);
      g.add(p, box(0.9, 1.0, 0.6, lam([0xe94b4b, 0x4b8fe9, 0xf2c200][i % 3]), p.position.x, 0.9, p.position.z));
    }
  }

  // lights
  g.add(new THREE.HemisphereLight(track.def.theme === 'hobby' ? 0xbcc7ff : 0xffffff, 0x555566, track.def.theme === 'hobby' ? 1.0 : 1.35));
  const sun = new THREE.DirectionalLight(track.def.theme === 'roof' ? 0xffd2a0 : 0xffffff, track.def.theme === 'hobby' ? 1.5 : 1.8);
  sun.position.set(cx - 18, 34, cz + 14);
  sun.target.position.set(cx, 0, cz);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const e = radius + 6;
    Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 100 });
    sun.shadow.bias = -0.0006;
  }
  g.add(sun, sun.target);

  // garage turntable, far off to the side so it never shows in race views
  const bench = new THREE.Vector3(cx, 0, cz + R * 6 + 60);
  const tt = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.3, 28), lam(0x2a303c));
  tt.position.set(bench.x, 0.15, bench.z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.06, 6, 40), new THREE.MeshBasicMaterial({ color: th.accent }));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(bench.x, 0.32, bench.z);
  const backdrop = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x151a26, side: THREE.BackSide }));
  backdrop.position.set(bench.x, 8, bench.z);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 24), new THREE.MeshBasicMaterial({ color: 0x151a26 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(bench.x, 0.01, bench.z);
  g.add(floor);
  const spot = new THREE.PointLight(0xffffff, 40, 20);
  spot.position.set(bench.x + 3, 6, bench.z + 3);
  g.add(tt, ring, backdrop, spot);

  return { group: g, center: new THREE.Vector3(cx, 0, cz), radius, sky: th.sky, fog: th.fog, bench, sun };
}

export function buildTrackMesh(track: Track, shadows: boolean): THREE.Group {
  const th = THEMES[track.def.theme];
  const g = new THREE.Group();
  const floorM = lam(th.track, { side: THREE.DoubleSide });
  const rampM = lam(0xff8a1f, { side: THREE.DoubleSide });
  const lcM = lam(th.accent, { side: THREE.DoubleSide });
  const waveM = lam(0x7ad06a, { side: THREE.DoubleSide });
  const wallM = lam(th.wall, { side: THREE.DoubleSide });
  const lineM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const legM = lam(0x8a8f99);
    const thick: [number, number][] = [[HALF_W + 0.15, -0.12], [HALF_W + 0.15, 0], [-HALF_W - 0.15, 0], [-HALF_W - 0.15, -0.12]];

  const deckSegs: Seg[] = track.segs.filter((s) => s.k !== 'gap');
  // merge neighbouring plain segments into runs per material so we create fewer meshes
  const matFor = (s: Seg) => (s.k === 'lc' ? lcM : s.k === 'rampUp' || s.k === 'rampDown' ? rampM : s.k === 'wave' ? waveM : floorM);
  for (const s of deckSegs) {
    const P = pts(track, s.s0, s.s1);
    const f = ribbon(P, thick, matFor(s), false);
    if (f) {
      f.receiveShadow = shadows;
      f.castShadow = shadows;
      g.add(f);
    }
    // walls
    for (const sd of [1, -1]) {
      const inner = sd * (HALF_W - 0.02), outer = sd * (HALF_W + 0.14);
      const w = ribbon(P, [[inner, 0], [inner, WALL_H], [outer, WALL_H], [outer, 0]], wallM);
      if (w) {
        w.castShadow = shadows;
        g.add(w);
      }
    }
    // lane lines
    for (const l of [-0.5, 0.5]) {
      const ln = ribbon(P, [[l * LANE_W + 0.025, 0.012], [l * LANE_W - 0.025, 0.012]], lineM);
      if (ln) g.add(ln);
    }
    // support legs for elevated sections
    if (s.k === 'rampUp' || s.k === 'rampDown' || s.k === 'hill') {
      for (let u = 0.8; u < s.len; u += 2.6) {
        const p = ptAt(track, s.s0 + u);
        if (p.y > 0.3) {
          const leg = box(0.35, p.y, 3.4, legM, p.x, p.y / 2 - 0.1, p.z);
          leg.rotation.y = Math.atan2(p.nx, p.nz);
          g.add(leg);
        }
      }
    }
  }
  // elevated plateaus around the gap
  for (const s of track.segs.filter((q) => q.k === 'gap')) {
    for (const p of [ptAt(track, s.s0), ptAt(track, s.s1)]) {
      const leg = box(0.5, p.y, 3.4, legM, p.x, p.y / 2 - 0.1, p.z);
      leg.rotation.y = Math.atan2(p.nx, p.nz);
      g.add(leg);
    }
  }
  // start line
  const sm = track.samples[2];
  const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, HALF_W * 2), new THREE.MeshBasicMaterial({ map: textTex('', 64, 256, '#fff', '#000'), side: THREE.DoubleSide }));
  const c2 = (sl.material as THREE.MeshBasicMaterial).map!.image as HTMLCanvasElement;
  const cg = c2.getContext('2d')!;
  cg.fillStyle = '#111';
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) cg.fillRect(j * 32, i * 32, 32, 32);
  (sl.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
  sl.rotation.x = -Math.PI / 2;
  sl.rotation.z = sm.h + Math.PI / 2; // plane's long axis across the track
  sl.position.set(sm.x, deckY(track, 0.5) + 0.02, -sm.z);
  g.add(sl);

  // corner number signs outside the walls
  for (const s of track.segs) {
    if (s.k !== 'arc') continue;
    const mid = (s.s0 + s.s1) / 2;
    const sm2 = track.samples[Math.round(mid / DS)];
    const side = Math.sign(s.R!); // + = left turn -> centre on left, so outside is right
    const off = -side * (HALF_W + 1.0);
    const nxm = -Math.sin(sm2.h), nzm = Math.cos(sm2.h);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex(String(s.corner), 128, 128, '#ffd23a', '#222', 'bold 90px sans-serif'), depthTest: true }));
    sp.scale.set(1.5, 1.5, 1);
    sp.position.set(sm2.x + nxm * off, sm2.y + 1.2, -(sm2.z + nzm * off));
    g.add(sp);
  }
  return g;
}

// ---------------------------------------------------------------- car
export interface CarRig {
  group: THREE.Group;
  spin: THREE.Object3D[];
  tireR: number;
}

export function buildCar(color: number, s: Setup, ghost = false): CarRig {
  const g = new THREE.Group();
  const spin: THREE.Object3D[] = [];
  const mk = (c: number) => (ghost ? new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35, depthWrite: false }) : lam(c));
  const tireR = [0.2, 0.235, 0.275][s.tire];
  const tireCol = [0xd9c27a, 0x222222, 0x111111][s.tire];
  // chassis
  g.add(box(1.15, 0.12, 0.5, mk(0x24272e), 0, 0.2, 0));
  // shell
  const shell = box(0.95, 0.2, 0.46, mk(color), 0, 0.36, 0);
  g.add(shell);
  g.add(box(0.5, 0.18, 0.36, mk(color), -0.05, 0.54, 0));
  g.add(box(0.34, 0.12, 0.3, mk(ghost ? 0xbfe6ff : 0x9fd8ff), 0.1, 0.56, 0));
  g.add(box(0.22, 0.06, 0.5, mk(0x333333), -0.52, 0.62, 0)); // wing
  g.add(box(0.05, 0.16, 0.05, mk(0x333333), -0.5, 0.52, 0.18), box(0.05, 0.16, 0.05, mk(0x333333), -0.5, 0.52, -0.18));
  g.add(box(0.5, 0.05, 0.03, mk(0xffffff), 0.1, 0.39, 0.235), box(0.5, 0.05, 0.03, mk(0xffffff), 0.1, 0.39, -0.235));
  // wheels
  const wg = new THREE.CylinderGeometry(tireR, tireR, 0.16, 14);
  wg.rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(tireR * 0.55, tireR * 0.55, 0.18, 8);
  hub.rotateX(Math.PI / 2);
  for (const [x, z] of [[0.38, 0.33], [0.38, -0.33], [-0.38, 0.33], [-0.38, -0.33]]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(wg, mk(tireCol)), new THREE.Mesh(hub, mk(0xe6e6e6)));
    w.add(box(tireR * 1.2, 0.04, 0.19, mk(0x888888), 0, 0, 0));
    w.position.set(x, tireR, z);
    g.add(w);
    spin.push(w);
  }
  // rollers
  const wide = s.roller === 1 || s.roller === 3;
  const bearing = s.roller >= 2;
  const rz = wide ? 0.52 : 0.44;
  const rg = new THREE.CylinderGeometry(0.1, 0.1, wide ? 0.09 : 0.07, 10);
  for (const [x, z] of [[0.52, rz], [0.52, -rz], [-0.52, rz], [-0.52, -rz]]) {
    const r = new THREE.Mesh(rg, mk(bearing ? 0xc8ccd2 : 0xff7a1a));
    r.position.set(x, 0.3, z);
    g.add(r);
    if (bearing) g.add(box(0.06, 0.12, 0.06, mk(0x555555), x, 0.3, z));
  }
  if (s.weight === 1) g.add(box(0.3, 0.12, 0.3, mk(0x7a7f88), 0.38, 0.6, 0));
  if (s.weight === 3) g.add(box(0.18, 0.08, 0.26, mk(0x7a7f88), 0.42, 0.58, 0));
  if (s.weight === 2 || s.weight === 3) g.add(box(0.3, 0.04, s.weight === 2 ? 0.46 : 0.34, mk(0x111111), -0.7, 0.2, 0));
  if (s.motor === 3) g.add(box(0.2, 0.1, 0.2, mk(0xff3030), 0.0, 0.7, 0));
  g.traverse((o) => {
    (o as THREE.Mesh).castShadow = !ghost;
  });
  return { group: g, spin, tireR };
}
