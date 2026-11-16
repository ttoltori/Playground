/** Level configs + the water model (waves, currents, drain, 바가지 pours). Everything here is a pure function of (cfg, time). */
export type ShipKind = 'player' | 'destroyer' | 'battleship' | 'gunboat' | 'sub';

export interface EnemySpawn { kind: ShipKind; x: number; z: number; h: number; skill: number; boss?: boolean }
export interface Faucet { x: number; z: number; dx: number; dz: number; len: number; w: number; force: number }
export interface Drain { x: number; z: number; rad: number; tPlug: number }
export interface Pour { first: number; period: number; rad: number; warn: number }
export interface PickupSpawn { kind: 'wind' | 'glue' | 'torp'; x: number; z: number }

export interface LevelCfg {
  id: number;
  seed: number;
  rx: number;
  rz: number;
  wave: number; // base wave height
  dim: boolean;
  start: { x: number; z: number; h: number };
  torpedoes: number;
  enemies: EnemySpawn[];
  ducks: { x: number; z: number }[];
  soaps: { x: number; z: number }[];
  towels: { x: number; z: number; w: number; d: number; rot: number }[];
  faucet: Faucet | null; // a visible faucet always exists (drip); `force` 0 = no current
  drain: Drain | null;
  pour: Pour | null;
  dad: number; // seconds into the run when dad calls (tub shakes)
  pickups: PickupSpawn[];
}

/** bronze medal thresholds in seconds (shared by def.ts; a sunk-ship result is never better than bronze + 30s) */
export const BRONZE = [100, 250, 380];

export function buildLevel(n: number): LevelCfg {
  if (n === 2) {
    return {
      id: 2, seed: 20241, rx: 40, rz: 28, wave: 0.12, dim: false,
      start: { x: -26, z: 14, h: Math.PI * 0.5 }, torpedoes: 4,
      enemies: [
        { kind: 'battleship', x: 24, z: -12, h: -2.2, skill: 0.7 },
        { kind: 'destroyer', x: 18, z: 14, h: 3.4, skill: 0.65 },
        { kind: 'destroyer', x: 4, z: -20, h: 2.0, skill: 0.65 },
        { kind: 'destroyer', x: -8, z: -4, h: 1.2, skill: 0.6 },
      ],
      ducks: [{ x: -4, z: 8 }, { x: 14, z: -4 }],
      soaps: [{ x: 6, z: 2 }],
      towels: [{ x: -14, z: -12, w: 5, d: 3.4, rot: 0.5 }],
      faucet: { x: -30, z: -12, dx: 0.93, dz: 0.37, len: 28, w: 5, force: 2.2 },
      drain: { x: 8, z: 0, rad: 12, tPlug: Infinity },
      pour: { first: 34, period: 36, rad: 11, warn: 3 },
      dad: 52,
      pickups: [
        { kind: 'wind', x: -10, z: 6 }, { kind: 'wind', x: 14, z: 2 }, { kind: 'wind', x: 0, z: -14 },
        { kind: 'glue', x: -2, z: -2 }, { kind: 'glue', x: 20, z: -2 }, { kind: 'torp', x: 8, z: 16 },
      ],
    };
  }
  if (n === 3) {
    return {
      id: 3, seed: 30337, rx: 46, rz: 32, wave: 0.17, dim: true,
      start: { x: -32, z: 16, h: Math.PI * 0.5 }, torpedoes: 5,
      enemies: [
        { kind: 'battleship', x: 28, z: -14, h: -2.4, skill: 0.85 },
        { kind: 'destroyer', x: 20, z: 18, h: 3.4, skill: 0.85 },
        { kind: 'destroyer', x: 6, z: -24, h: 2.2, skill: 0.85 },
        { kind: 'destroyer', x: -6, z: -10, h: 1.4, skill: 0.8 },
        { kind: 'gunboat', x: 12, z: 2, h: 2.6, skill: 0.85 },
        { kind: 'sub', x: 30, z: 4, h: -1.6, skill: 0.95, boss: true },
      ],
      ducks: [{ x: -8, z: 10 }, { x: 10, z: -8 }, { x: 24, z: 14 }],
      soaps: [{ x: 2, z: 12 }, { x: -12, z: -14 }],
      towels: [{ x: -16, z: -4, w: 5, d: 3.4, rot: 0.3 }, { x: 18, z: -22, w: 5, d: 3.4, rot: -0.6 }],
      faucet: { x: -36, z: -14, dx: 0.93, dz: 0.37, len: 30, w: 5, force: 2.4 },
      drain: { x: 6, z: 2, rad: 15, tPlug: 42 },
      pour: { first: 26, period: 28, rad: 12, warn: 3 },
      dad: 38,
      pickups: [
        { kind: 'wind', x: -14, z: 8 }, { kind: 'wind', x: 12, z: 14 }, { kind: 'wind', x: -2, z: -18 }, { kind: 'wind', x: 30, z: -4 },
        { kind: 'glue', x: -6, z: 0 }, { kind: 'glue', x: 18, z: 4 }, { kind: 'glue', x: 0, z: -8 },
        { kind: 'torp', x: 10, z: 20 }, { kind: 'torp', x: -20, z: -16 },
      ],
    };
  }
  return {
    id: 1, seed: 10101, rx: 30, rz: 21, wave: 0.035, dim: false,
    start: { x: -18, z: 8, h: Math.PI * 0.5 }, torpedoes: 3,
    enemies: [
      { kind: 'destroyer', x: 14, z: -8, h: -2.0, skill: 0.3 },
      { kind: 'destroyer', x: 12, z: 10, h: 3.6, skill: 0.3 },
    ],
    ducks: [{ x: 0, z: 2 }],
    soaps: [],
    towels: [],
    faucet: { x: -22, z: -13, dx: 0.9, dz: 0.43, len: 20, w: 4, force: 0 },
    drain: null,
    pour: null,
    dad: 9999,
    pickups: [{ kind: 'wind', x: -4, z: -6 }, { kind: 'glue', x: 4, z: 8 }, { kind: 'torp', x: 6, z: -2 }],
  };
}

const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

export interface PourEvent { k: number; t: number; x: number; z: number }

/** water model: deterministic functions of time */
export class Water {
  constructor(public cfg: LevelCfg) {}

  /** dad shakes the tub: 1 normally, up to ~2.6 for 7 s after dad's call */
  shake(t: number) {
    const d = t - this.cfg.dad;
    if (d < 0 || d > 8) return 1;
    return 1 + 1.7 * Math.min(1, d / 0.6) * (d > 6 ? (8 - d) / 2 : 1);
  }

  drainStrength(t: number) {
    const dr = this.cfg.drain;
    if (!dr || !isFinite(dr.tPlug)) return 0;
    return Math.max(0, Math.min(1, (t - dr.tPlug) / 30));
  }

  pourEvent(k: number): PourEvent | null {
    const p = this.cfg.pour;
    if (!p || k < 0) return null;
    const a = hash(this.cfg.seed + k * 31) * Math.PI * 2;
    const r = (0.15 + 0.5 * hash(this.cfg.seed + k * 57 + 5));
    return { k, t: p.first + k * p.period, x: Math.cos(a) * this.cfg.rx * r, z: Math.sin(a) * this.cfg.rz * r };
  }

  /** the pour event whose warning/impact window contains t (or the next upcoming), plus phase info */
  activePour(t: number): { ev: PourEvent; warn: number; since: number } | null {
    const p = this.cfg.pour;
    if (!p) return null;
    const k = Math.floor((t - p.first + p.warn) / p.period);
    for (let kk = k; kk <= k + 1; kk++) {
      const ev = this.pourEvent(kk);
      if (!ev) continue;
      if (t >= ev.t - p.warn && t <= ev.t + 9) return { ev, warn: Math.max(0, (t - (ev.t - p.warn)) / p.warn), since: t - ev.t };
    }
    return null;
  }

  /** wave height at (x,z) */
  h(x: number, z: number, t: number): number {
    const A = this.cfg.wave * this.shake(t);
    let y = A * (0.62 * Math.sin(0.46 * x + 0.21 * z - 1.5 * t) + 0.38 * Math.sin(-0.31 * x + 0.52 * z - 2.05 * t + 1.3));
    const ap = this.activePour(t);
    if (ap && ap.since > 0 && ap.since < 9) {
      const dx = x - ap.ev.x;
      const dz = z - ap.ev.z;
      const r = Math.hypot(dx, dz);
      const front = ap.since * 5.5;
      const q = r - front;
      y += 0.5 * Math.exp(-ap.since / 3) * Math.exp(-(q * q) / 6) * Math.cos(q * 1.1);
    }
    return y;
  }

  /** water velocity at (x,z): faucet stream + drain whirlpool. writes into out */
  cur(x: number, z: number, t: number, out: { x: number; z: number }) {
    out.x = 0;
    out.z = 0;
    const f = this.cfg.faucet;
    if (f && f.force > 0) {
      const rx = x - f.x;
      const rz = z - f.z;
      const s = rx * f.dx + rz * f.dz;
      const l = rx * -f.dz + rz * f.dx;
      if (s > 0 && s < f.len && Math.abs(l) < f.w) {
        const k = f.force * (1 - 0.5 * (s / f.len)) * (1 - (l / f.w) ** 2);
        out.x += f.dx * k;
        out.z += f.dz * k;
      }
    }
    const dr = this.cfg.drain;
    if (dr) {
      const s = this.drainStrength(t);
      if (s > 0) {
        const dx = x - dr.x;
        const dz = z - dr.z;
        const r = Math.hypot(dx, dz) + 0.001;
        if (r < dr.rad) {
          const f1 = (1 - r / dr.rad) ** 1.5;
          const vt = 4.2 * s * f1;
          const vi = 2.8 * s * f1;
          out.x += (-dz / r) * vt - (dx / r) * vi;
          out.z += (dx / r) * vt - (dz / r) * vi;
        }
      }
    }
  }
}
