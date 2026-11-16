/** Rubber-band plane flight model (pure maths, headless-testable). Forward -z, right +x, up +y, metres / seconds / radians. */
import type { Solid, ThrowEnv, Tree, Thermal } from './levels';

export interface PlaneSpec {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  kL: number; // aero scale (rho*S/2m): accel = kL*V^2*C
  cd0: number;
  kInd: number; // induced drag factor
  tmax: number; // thrust accel at nref turns (m/s^2)
  nref: number; // reference turns for the torque curve
  limit: number; // gauge 100% mark (turns)
  rollBias: number; // prop-torque roll (rad at full thrust, + = right)
  mass: number; // grams (display only)
}

export const PLANES: PlaneSpec[] = [
  { id: 'eagle', name: '독수리호', emoji: '🦅', desc: '무난한 표준형', kL: 0.56, cd0: 0.042, kInd: 0.034, tmax: 3.3, nref: 150, limit: 190, rollBias: -0.04, mass: 18 },
  { id: 'gull', name: '갈매기호', emoji: '🕊️', desc: '큰 날개, 활공 특화 · 고무줄 약함', kL: 0.7, cd0: 0.034, kInd: 0.026, tmax: 2.5, nref: 140, limit: 150, rollBias: -0.025, mass: 14 },
  { id: 'bolt', name: '번개호', emoji: '⚡', desc: '작은 날개, 힘센 고무줄 · 급강하 주의', kL: 0.44, cd0: 0.05, kInd: 0.042, tmax: 4.4, nref: 170, limit: 230, rollBias: -0.06, mass: 22 },
];

const G = 9.81;
const CLA = 3.8;
const A0 = -0.05; // zero-lift AoA
const A_STALL = 0.27;
const A_NEG = -0.2;
const CL_MAX = CLA * (A_STALL - A0);
const CL_MIN = CLA * (A_NEG - A0);
const sstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Torque curve: strong burst, long tail. x = turns / nref. */
export function thrustOf(spec: PlaneSpec, n: number) {
  const x = n / spec.nref;
  return spec.tmax * x * (0.35 + 0.65 * x);
}
/** Turns released per second (prop speed). */
export function unwindRate(spec: PlaneSpec, n: number) {
  return 6 + 34 * (n / spec.nref);
}

export interface Aero { cl: number; cd: number; stalled: number }
export function aero(spec: PlaneSpec, alpha: number): Aero {
  let cl: number;
  let w = 0;
  if (alpha > A_STALL) {
    w = sstep((alpha - A_STALL) / 0.12);
    cl = CL_MAX * (1 - w) + 0.9 * Math.sin(2 * alpha) * w;
  } else if (alpha < A_NEG) {
    w = sstep((A_NEG - alpha) / 0.12);
    cl = CL_MIN * (1 - w) + 0.9 * Math.sin(2 * alpha) * w;
  } else cl = CLA * (alpha - A0);
  const sa = Math.sin(alpha);
  const cd = spec.cd0 + spec.kInd * cl * cl + 1.2 * sa * sa * w;
  return { cl, cd, stalled: w };
}

export type EndKind = 'ground' | 'tree' | 'solid' | 'roof' | 'timeout' | 'knock' | 'fly';
export interface FlightEnd { kind: EndKind; what: string; x: number; y: number; z: number }

export interface FlightCmd { bank: number; pitch: number } // -1..1 each

export interface Hazard { kind: 'ball' | 'pigeon'; x: number; y: number; z: number; r: number; id: number }

export class Flight {
  x = 0; y = 1.6; z = 0;
  vx = 0; vy = 0; vz = 0;
  theta = 0; // pitch attitude
  q = 0;
  phi = 0; // bank
  phiR = 0;
  psi = 0; // heading (0 = -z, + = right)
  n = 0; // turns remaining
  n0 = 0;
  t = 0;
  alpha = 0;
  stalled = 0;
  airspeed = 0;
  thrust = 0;
  propAngle = 0;
  tumble = 0; // >0: knocked out, ballistic
  maxAlt = 0;
  stallTime = 0;
  maxStall = 0;
  end: FlightEnd | null = null;
  events: string[] = [];
  cmd: FlightCmd = { bank: 0, pitch: 0 };
  windNow = { x: 0, y: 0, z: 0 };
  hitIds = new Set<number>();
  private sub = 1 / 120;

  constructor(
    public spec: PlaneSpec,
    public env: ThrowEnv,
    public gust: number,
    public solids: Solid[],
    public trees: Tree[],
    turns: number,
  ) {
    this.n = this.n0 = turns;
  }

  launch(pitch: number, yaw: number, speed: number, bank = 0, wobble = 0) {
    this.theta = pitch + wobble * 0.15;
    this.psi = yaw;
    this.phi = bank;
    const cp = Math.cos(pitch);
    this.vx = Math.sin(yaw) * cp * speed;
    this.vy = Math.sin(pitch) * speed;
    this.vz = -Math.cos(yaw) * cp * speed;
    this.q = wobble * 0.8;
    this.maxAlt = this.y;
  }

  get dist() {
    return Math.hypot(this.x, this.z);
  }
  get ground() {
    return Math.hypot(this.vx - this.windNow.x, this.vz - this.windNow.z);
  }

  /** air velocity (wind + thermals) at a point */
  airAt(x: number, y: number, z: number, t: number, out = this.windNow) {
    const e = this.env;
    const hf = 0.55 + 0.45 * Math.min(1, y / 7);
    const g = this.gust > 0 ? this.gust * (Math.sin(t * 1.7 + e.gustPhase) * 0.55 + Math.sin(t * 3.1 + e.gustPhase * 2.3) * 0.3 + Math.sin(t * 0.6 + e.gustPhase * 0.7) * 0.4) : 0;
    const wl = Math.hypot(e.wind.x, e.wind.z) || 1;
    out.x = (e.wind.x + (e.wind.x / wl) * g) * hf + (this.gust > 0 ? Math.sin(t * 2.3 + e.gustPhase * 1.3) * this.gust * 0.25 : 0);
    out.z = (e.wind.z + (e.wind.z / wl) * g) * hf;
    out.y = 0;
    for (const th of e.thermals) out.y += thermalW(th, x, y, z);
    for (const th of e.downs) out.y += thermalW(th, x, y, z);
    return out;
  }

  step(dt: number) {
    if (this.end) return;
    let left = dt;
    while (left > 1e-6 && !this.end) {
      const h = Math.min(this.sub, left);
      this.sub1(h);
      left -= h;
    }
  }

  private sub1(dt: number) {
    const sp = this.spec;
    this.t += dt;
    const w = this.airAt(this.x, this.y, this.z, this.t);
    // thrust / rubber
    let aT = 0;
    if (this.n > 0 && this.tumble <= 0) {
      aT = thrustOf(sp, this.n);
      this.n = Math.max(0, this.n - unwindRate(sp, this.n) * dt);
      this.propAngle += unwindRate(sp, this.n) * dt * Math.PI * 2;
    }
    this.thrust = aT;

    const rx = this.vx - w.x;
    const ry = this.vy - w.y;
    const rz = this.vz - w.z;
    const V = Math.max(0.05, Math.hypot(rx, ry, rz));
    this.airspeed = V;
    const fx = rx / V;
    const fy = ry / V;
    const fz = rz / V;
    const hv = Math.hypot(rx, rz);
    if (hv > 0.6) {
      const tgt = Math.atan2(rx, -rz);
      let d = tgt - this.psi;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.psi += d * Math.min(1, dt * 6);
    }
    const gamma = Math.asin(Math.max(-1, Math.min(1, fy)));

    if (this.tumble > 0) {
      // knocked out of the air: flop, heavy drag
      this.tumble -= dt;
      this.theta += dt * 9;
      const drag = 0.5 * V;
      this.vx += (-rx * drag) * dt;
      this.vz += (-rz * drag) * dt;
      this.vy += (-G - ry * drag) * dt;
    } else {
      const alpha = this.theta - gamma;
      this.alpha = alpha;
      const a = aero(sp, alpha);
      this.stalled = a.stalled;
      if (a.stalled > 0.4) {
        this.stallTime += dt;
        this.maxStall = Math.max(this.maxStall, this.stallTime);
      } else this.stallTime = Math.max(0, this.stallTime - dt * 2);
      const k = sp.kL * V * V;
      const aL = k * a.cl;
      const aD = k * a.cd;
      // lift direction: perpendicular to flow, tilted by bank
      // right = f x up = (-fz, 0, fx): +x when flying along -z
      let rxx = -fz;
      let rzz = fx;
      const rl = Math.hypot(rxx, rzz);
      if (rl > 0.2) {
        rxx /= rl;
        rzz /= rl;
      } else {
        rxx = Math.cos(this.psi);
        rzz = Math.sin(this.psi);
      }
      // up-perp = r x f
      let ux = 0 * fz - rzz * fy;
      let uy = rzz * fx - rxx * fz;
      let uz = rxx * fy - 0 * fx;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const cb = Math.cos(this.phi);
      const sb = Math.sin(this.phi);
      const lx = ux * cb + rxx * sb;
      const ly = uy * cb;
      const lz = uz * cb + rzz * sb;
      // thrust along the body axis
      const ct = Math.cos(this.theta);
      const tx = Math.sin(this.psi) * ct;
      const ty = Math.sin(this.theta);
      const tz = -Math.cos(this.psi) * ct;
      this.vx += (aL * lx - aD * fx + aT * tx) * dt;
      this.vy += (aL * ly - aD * fy + aT * ty - G) * dt;
      this.vz += (aL * lz - aD * fz + aT * tz) * dt;

      // pitch: static stability pulls alpha toward trim, nose drops when stalled
      const aTrim = 0.1 + this.cmd.pitch * 0.055 + aT * 0.004;
      const stallDown = alpha > A_STALL ? -26 * (alpha - A_STALL) * (0.4 + a.stalled) : 0;
      this.q += (-44 * (alpha - aTrim) - 7.5 * this.q + stallDown) * dt;
      this.theta += this.q * dt;
      this.theta = Math.max(-1.45, Math.min(1.45, this.theta));
      // roll: dihedral restores toward trimmed bank, prop torque biases it
      const eq = sp.rollBias * (aT / sp.tmax) + this.cmd.bank * 0.11;
      this.phiR += (-30 * (this.phi - eq) - 7 * this.phiR) * dt;
      this.phi += this.phiR * dt;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    if (this.y > this.maxAlt) this.maxAlt = this.y;
    this.collide();
    if (!this.end && this.t > 70) this.end = { kind: 'timeout', what: '체공 시간 초과', x: this.x, y: this.y, z: this.z };
  }

  private finish(kind: EndKind, what: string) {
    this.end = { kind, what, x: this.x, y: Math.max(0, this.y), z: this.z };
  }

  private collide() {
    const px = this.x;
    const py = this.y;
    const pz = this.z;
    for (const s of this.solids) {
      if (px > s.x0 - 0.12 && px < s.x1 + 0.12 && pz > s.z0 - 0.12 && pz < s.z1 + 0.12 && py > s.y0 && py < s.y1 + 0.1) {
        const roof = s.kind === 'house' || s.kind === 'shop' || s.kind === 'stand' || s.kind === 'building' || s.kind === 'apt';
        const fromAbove = py > s.y1 - 0.45 && this.vy <= 0;
        if (roof && fromAbove) {
          this.y = s.y1;
          this.finish('roof', s.kind);
        } else this.finish('solid', s.kind);
        return;
      }
    }
    for (const t of this.trees) {
      const dx = px - t.x;
      const dz = pz - t.z;
      const h = Math.hypot(dx, dz);
      if (h > t.r + 0.5) continue;
      const dy = (py - t.crownY) / t.crownH;
      if ((h * h) / (t.r * t.r) + dy * dy < 1 || (h < 0.5 && py < t.crownY)) {
        this.finish('tree', '플라타너스');
        return;
      }
    }
    if (py <= 0.06) {
      this.y = 0;
      this.finish('ground', 'ground');
    }
  }

  /** knock the plane (called by game for balls / pigeons) */
  knock(h: Hazard) {
    if (this.hitIds.has(h.id) || this.end) return;
    this.hitIds.add(h.id);
    if (h.kind === 'ball') {
      this.tumble = 99;
      this.n = 0;
      this.vx = this.vx * 0.3 + (this.x - h.x) * 3;
      this.vy = Math.min(this.vy, 0) * 0.4 + 1;
      this.vz = this.vz * 0.2;
      this.events.push('ball');
    } else {
      this.vx *= 0.4;
      this.vy = this.vy * 0.4 - 0.8;
      this.vz *= 0.4;
      this.q -= 4;
      this.events.push('pigeon');
    }
  }
}

export function thermalW(t: Thermal, x: number, y: number, z: number) {
  const d = Math.hypot(x - t.x, z - t.z);
  if (d >= t.r * 1.15) return 0;
  const p = 1 - (d / (t.r * 1.15)) ** 2;
  const fade = y > t.top ? Math.max(0, 1 - (y - t.top) / 8) : 1;
  const low = Math.min(1, y / 2.5 + 0.35);
  return t.w * p * p * fade * low;
}

/** Moving obstacles (soccer balls, pigeons) at flight time t. */
export function hazardsAt(env: ThrowEnv, t: number): Hazard[] {
  const out: Hazard[] = [];
  env.balls.forEach((b, i) => {
    const dt = t - b.t0;
    if (dt < 0 || dt > 7) return;
    const y = b.y + b.vy * dt - 4.9 * dt * dt;
    if (y < 0.3) return;
    out.push({ kind: 'ball', id: i, x: b.x + b.vx * dt, y, z: b.z + b.vz * dt, r: 0.55 });
  });
  env.pigeons.forEach((p, i) => {
    out.push({ kind: 'pigeon', id: 100 + i, x: p.x + p.vx * t, y: p.y + Math.sin(t * 2 + p.phase) * 0.5, z: p.z + Math.sin(t * 0.5 + p.phase) * 2, r: 0.7 });
  });
  return out;
}
