import { mulberry32, range } from '../forklift/rng';

// ---------------------------------------------------------------- terrain (deterministic, pure functions of x,z)
export interface HillDef { x: number; z: number; r: number; h: number; plateau: number; pal: number }
export interface RidgeDef { x1: number; z1: number; x2: number; z2: number; w: number; h: number; mat: 'blanket' | 'wood'; pal: number }

const sstep = (n: number) => n * n * (3 - 2 * n);

export class Terrain {
  constructor(public hills: HillDef[], public ridges: RidgeDef[]) {}

  h(x: number, z: number): number {
    let y = 0;
    for (const a of this.hills) {
      const d = Math.hypot(x - a.x, z - a.z) / a.r;
      if (d >= 1) continue;
      const n = Math.min(1, (1 - d) / (1 - a.plateau));
      y += a.h * sstep(n);
    }
    for (const r of this.ridges) {
      const d = ridgeDist(r, x, z);
      if (d >= r.w) continue;
      y += r.h * sstep(1 - d / r.w);
    }
    return y;
  }

  /** 0..1: how "blanket-soft" the surface is (tracks slip, slower) */
  soft(x: number, z: number): number {
    let m = 0;
    for (const a of this.hills) {
      const d = Math.hypot(x - a.x, z - a.z) / a.r;
      if (d < 1) m = Math.max(m, Math.min(1, (1 - d) * 4));
    }
    for (const r of this.ridges) {
      if (r.mat !== 'blanket') continue;
      const d = ridgeDist(r, x, z);
      if (d < r.w) m = Math.max(m, Math.min(1, (1 - d / r.w) * 3));
    }
    return m;
  }

  /** palette index of the blanket under (x,z), or -1 (wood ridge = -2) */
  palAt(x: number, z: number): number {
    let best = -1;
    let bv = 0;
    for (const a of this.hills) {
      const d = Math.hypot(x - a.x, z - a.z) / a.r;
      if (d < 1 && 1 - d > bv) { bv = 1 - d; best = a.pal; }
    }
    for (const r of this.ridges) {
      const d = ridgeDist(r, x, z);
      if (d < r.w && 1 - d / r.w > bv) { bv = 1 - d / r.w; best = r.mat === 'wood' ? -2 : r.pal; }
    }
    return best;
  }

  grad(x: number, z: number, e = 0.55): [number, number] {
    return [(this.h(x + e, z) - this.h(x - e, z)) / (2 * e), (this.h(x, z + e) - this.h(x, z - e)) / (2 * e)];
  }
}

function ridgeDist(r: RidgeDef, x: number, z: number) {
  const dx = r.x2 - r.x1;
  const dz = r.z2 - r.z1;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - r.x1) * dx + (z - r.z1) * dz) / l2));
  return Math.hypot(x - (r.x1 + dx * t), z - (r.z1 + dz * t));
}

// ---------------------------------------------------------------- obstacles
export type PropType = 'books' | 'comics' | 'lego' | 'yogang' | 'kettle' | 'baduk' | 'lamp';
export interface Obs {
  kind: 'box' | 'cyl';
  type: PropType;
  x: number; z: number;
  hx: number; hz: number; // half extents (box)
  r: number; // radius (cyl)
  rot: number; // yaw (box)
  h: number; // height
  cos: number; sin: number;
  spec: number[]; // per-type render data (book thicknesses, colors, ...)
  /** tall enough to block line of sight */
  tall: boolean;
}

export type EnemyKind = 'tiger' | 'panther' | 'boss';
export interface EnemyDef { kind: EnemyKind; x: number; z: number; yaw: number; patrol: [number, number][]; sentry?: boolean }
export interface PickupDef { kind: 'bat' | 'glue' | 'pow'; x: number; z: number }

export interface LevelCfg {
  hx: number; hz: number;
  seed: number;
  speedK: number; reloadK: number; errK: number; sight: number;
  hills: HillDef[]; ridges: RidgeDef[];
  props: { type: PropType; x: number; z: number; rot: number; w: number; d: number; n: number }[];
  enemies: EnemyDef[];
  pickups: PickupDef[];
  marbles: number;
  cat?: { x: number; z: number; yaw: number };
  dim: boolean;
  start: { x: number; z: number; yaw: number };
  momAt: number; // seconds into the run
}

const P = (type: PropType, x: number, z: number, rot: number, w: number, d: number, n = 6) => ({ type, x, z, rot, w, d, n });

export const LEVELS: LevelCfg[] = [
  {
    hx: 26, hz: 18, seed: 11, speedK: 0.55, reloadK: 1.9, errK: 2.2, sight: 27,
    hills: [], ridges: [],
    props: [
      P('books', -10, 1, 0.2, 4, 3, 9), P('books', 12, -3, -0.35, 4.2, 3, 7), P('yogang', 0, -3, 0, 1.3, 1.3),
      P('lego', -18, -9, 0.4, 3.2, 1.6), P('lego', 17, 8, -0.3, 3.2, 1.6), P('baduk', 20, -10, 0.1, 6, 6),
      P('comics', -4, 9, 0.5, 3.4, 2.4, 3),
    ],
    enemies: [
      { kind: 'tiger', x: -12, z: -12, yaw: 0, patrol: [[-12, -12], [-5, -12], [-12, -6]] },
      { kind: 'tiger', x: 14, z: -13, yaw: 0, patrol: [[14, -13], [8, -8], [18, -6]] },
    ],
    pickups: [{ kind: 'bat', x: -18, z: 8 }, { kind: 'bat', x: 19, z: -2 }, { kind: 'glue', x: 8, z: 7 }, { kind: 'pow', x: -8, z: -9 }],
    marbles: 3, dim: false, start: { x: 0, z: 12, yaw: 0 }, momAt: 50,
  },
  {
    hx: 35, hz: 23, seed: 22, speedK: 0.8, reloadK: 1.5, errK: 1.5, sight: 36,
    hills: [
      { x: 0, z: -11, r: 12, h: 2.3, plateau: 0.45, pal: 0 },
      { x: -19, z: 5, r: 7.5, h: -0.9, plateau: 0.3, pal: 1 },
      { x: 22, z: 6, r: 6.5, h: 1.1, plateau: 0.2, pal: 2 },
    ],
    ridges: [{ x1: -30, z1: -17, x2: -14, z2: -15, w: 2.6, h: 1.0, mat: 'blanket', pal: 1 }],
    props: [
      P('books', -12, 14, 0.1, 4.2, 3, 8), P('books', 12, 14, -0.2, 4.2, 3, 10), P('books', -26, -4, 1.4, 4, 3, 7),
      P('books', 28, -12, 0.5, 4, 3, 9), P('kettle', 13, -4, 0, 1.8, 1.8), P('baduk', -12, -6, 0.2, 6, 6),
      P('lego', -2, 4, 0.3, 3.2, 1.6), P('lego', 30, 14, 0.9, 3.2, 1.6), P('lego', -30, 16, -0.4, 3.2, 1.6),
      P('yogang', -27, 10, 0, 1.4, 1.4), P('comics', 4, 14, 0.2, 3.4, 2.4, 3),
    ],
    enemies: [
      { kind: 'panther', x: 0, z: -11, yaw: 0, patrol: [[0, -11]], sentry: true },
      { kind: 'tiger', x: -22, z: -13, yaw: 0, patrol: [[-22, -13], [-8, -19], [-24, -5]] },
      { kind: 'panther', x: 24, z: -16, yaw: 0, patrol: [[24, -16], [14, -19], [26, -8]] },
      { kind: 'tiger', x: 25, z: 5, yaw: 0, patrol: [[25, 5], [18, -1], [28, 12]] },
    ],
    pickups: [{ kind: 'bat', x: -28, z: 17 }, { kind: 'bat', x: 6, z: -19 }, { kind: 'glue', x: 0, z: 2 }, { kind: 'pow', x: -6, z: -19 }],
    marbles: 8, dim: false, start: { x: 0, z: 18, yaw: 0 }, momAt: 62,
  },
  {
    hx: 40, hz: 28, seed: 33, speedK: 1.0, reloadK: 1.25, errK: 1.2, sight: 38,
    hills: [{ x: 30, z: 17, r: 8.5, h: 1.4, plateau: 0.35, pal: 2 }],
    ridges: [
      { x1: -40, z1: -2, x2: -7, z2: -2, w: 1.7, h: 1.0, mat: 'wood', pal: 0 },
      { x1: -7, z1: -2, x2: 7, z2: -2, w: 1.7, h: 0.3, mat: 'wood', pal: 0 },
      { x1: 7, z1: -2, x2: 40, z2: -2, w: 1.7, h: 1.0, mat: 'wood', pal: 0 },
    ],
    props: [
      P('books', -14, 12, 0.2, 4.2, 3, 10), P('books', 14, 8, -0.4, 4.2, 3, 8), P('books', -30, 2, 1.3, 4, 3, 9),
      P('books', -20, -14, 0.3, 4.2, 3, 11), P('books', 20, -12, -0.2, 4.2, 3, 8), P('comics', 3, 15, 0.2, 3.4, 2.4, 3),
      P('lego', -4, 10, 0.5, 3.2, 1.6), P('lego', 8, -9, 0.2, 3.2, 1.6), P('lego', -34, -18, 0, 3.2, 1.6), P('lego', 34, -8, 0.7, 3.2, 1.6),
      P('yogang', 18, 16, 0, 1.4, 1.4), P('kettle', -30, -20, 0, 1.8, 1.8), P('baduk', 28, -20, 0.1, 6, 6),
      P('lamp', 35, -22, 0, 1, 1),
    ],
    enemies: [
      { kind: 'panther', x: -24, z: 8, yaw: 0, patrol: [[-24, 8], [-10, 4], [-30, 18]] },
      { kind: 'tiger', x: 24, z: 3, yaw: 0, patrol: [[24, 3], [12, 20], [32, 8]] },
      { kind: 'panther', x: 33, z: 23, yaw: 0, patrol: [[33, 23], [22, 24], [36, 12]] },
      { kind: 'tiger', x: -26, z: -15, yaw: 0, patrol: [[-26, -15], [-12, -22], [-30, -8]] },
      { kind: 'panther', x: 22, z: -17, yaw: 0, patrol: [[22, -17], [10, -24], [32, -14]] },
      { kind: 'boss', x: 0, z: -19, yaw: 0, patrol: [[0, -19], [-8, -14], [8, -14]] },
    ],
    pickups: [
      { kind: 'bat', x: -33, z: 22 }, { kind: 'bat', x: 34, z: 24 }, { kind: 'bat', x: 0, z: -7 },
      { kind: 'glue', x: -12, z: 2 }, { kind: 'glue', x: 14, z: -6 }, { kind: 'pow', x: 0, z: 4 }, { kind: 'pow', x: -14, z: -24 },
    ],
    cat: { x: -26, z: 17, yaw: 0.6 },
    marbles: 12, dim: true, start: { x: 0, z: 23, yaw: 0 }, momAt: 80,
  },
];

export interface Level {
  cfg: LevelCfg;
  terrain: Terrain;
  obstacles: Obs[];
}

export const BOOK_COLORS = [0x2f5aa8, 0xb8352c, 0x2e8b57, 0xe0b020, 0x7b3f98, 0xe27a2a, 0x1c7f8f, 0xc7c0a8];

export function buildLevel(n: number): Level {
  const cfg = LEVELS[Math.max(1, Math.min(LEVELS.length, n)) - 1];
  const rng = mulberry32(cfg.seed);
  const obstacles: Obs[] = [];
  for (const p of cfg.props) {
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const base = { x: p.x, z: p.z, rot: p.rot, cos: c, sin: s, type: p.type };
    switch (p.type) {
      case 'books':
      case 'comics': {
        const spec: number[] = [];
        let h = 0;
        for (let i = 0; i < p.n; i++) {
          const t = p.type === 'books' ? range(rng, 0.32, 0.55) : range(rng, 0.1, 0.18);
          const color = BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)];
          spec.push(t, color, range(rng, -0.18, 0.18), range(rng, -0.12, 0.12), range(rng, -0.08, 0.08));
          h += t;
        }
        obstacles.push({ ...base, kind: 'box', hx: p.w / 2, hz: p.d / 2, r: 0, h, spec, tall: h > 1.6 });
        break;
      }
      case 'lego':
        obstacles.push({ ...base, kind: 'box', hx: p.w / 2, hz: p.d / 2, r: 0, h: 1.1, spec: [BOOK_COLORS[Math.floor(rng() * 4)]], tall: false });
        break;
      case 'baduk':
        obstacles.push({ ...base, kind: 'box', hx: p.w / 2, hz: p.d / 2, r: 0, h: 0.9, spec: [], tall: false });
        break;
      case 'yogang':
        obstacles.push({ ...base, kind: 'cyl', hx: 0, hz: 0, r: p.w, h: 1.9, spec: [], tall: true });
        break;
      case 'kettle':
        obstacles.push({ ...base, kind: 'cyl', hx: 0, hz: 0, r: p.w, h: 2.3, spec: [], tall: true });
        break;
      case 'lamp':
        obstacles.push({ ...base, kind: 'cyl', hx: 0, hz: 0, r: 0.8, h: 14, spec: [], tall: true });
        break;
    }
  }
  return { cfg, terrain: new Terrain(cfg.hills, cfg.ridges), obstacles };
}

/** push a circle out of an obstacle. Returns [nx, nz, penetration] or null. */
export function circleVsObs(cx: number, cz: number, r: number, o: Obs): [number, number, number] | null {
  if (o.kind === 'cyl') {
    const dx = cx - o.x;
    const dz = cz - o.z;
    const d = Math.hypot(dx, dz);
    const rr = r + o.r;
    if (d >= rr) return null;
    if (d < 1e-5) return [1, 0, rr];
    return [dx / d, dz / d, rr - d];
  }
  const dx = cx - o.x;
  const dz = cz - o.z;
  const lx = dx * o.cos + dz * o.sin;
  const lz = -dx * o.sin + dz * o.cos;
  const qx = Math.max(-o.hx, Math.min(o.hx, lx));
  const qz = Math.max(-o.hz, Math.min(o.hz, lz));
  const ex = lx - qx;
  const ez = lz - qz;
  const d = Math.hypot(ex, ez);
  if (d >= r) return null;
  let nx: number;
  let nz: number;
  let pen: number;
  if (d < 1e-5) {
    const px = o.hx - Math.abs(lx);
    const pz = o.hz - Math.abs(lz);
    if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; pen = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; pen = pz + r; }
  } else {
    nx = ex / d;
    nz = ez / d;
    pen = r - d;
  }
  return [nx * o.cos - nz * o.sin, nx * o.sin + nz * o.cos, pen];
}

/** is the point inside the obstacle footprint (inflated by m)? */
export function pointInObs(px: number, pz: number, o: Obs, m = 0): boolean {
  if (o.kind === 'cyl') return Math.hypot(px - o.x, pz - o.z) < o.r + m;
  const dx = px - o.x;
  const dz = pz - o.z;
  const lx = dx * o.cos + dz * o.sin;
  const lz = -dx * o.sin + dz * o.cos;
  return Math.abs(lx) < o.hx + m && Math.abs(lz) < o.hz + m;
}
