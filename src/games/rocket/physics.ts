/**
 * 물로켓 physics — pure, deterministic (no DOM, no three.js).
 *
 * Model (SI units; world: x = right, y = up, forward = -z; launcher at the origin):
 *  1. rail   : the first RAIL metres the rocket is guided by the launch tube.
 *  2. water  : water leaves the nozzle (Bernoulli, ve = Cd*sqrt(2*dP/rho)); the air bubble expands
 *              adiabatically (P*V^1.4 = const) so pressure drops; mass falls; thrust = rho*A*ve^2.
 *  3. air    : the remaining compressed air blows out in a short pressure blast (exponential decay).
 *  4. coast  : ballistic flight with quadratic drag; fins weathercock the body into the relative wind,
 *              drag grows with angle of attack.
 *  5. chute  : optional parachute (only after the apex): big drag, wind drift, soft landing.
 * Wind is a function of absolute game time (gusts), so release timing matters.
 */
export const G = 9.81;
export const PATM = 101325;
export const PSI = 6894.757;
export const GAMMA = 1.4;
export const RHO_W = 1000;
export const RHO_A = 1.2;

export const BOTTLE = {
  vol: 1.5e-3, // m^3 (1.5 L PET bottle)
  nozA: 3.46e-4, // nozzle area (d = 21 mm)
  cdNoz: 0.95,
  dry: 0.15, // kg (bottle + nose cone + fins + clay)
  bodyA: 6.4e-3, // frontal area
  cd0: 0.6,
  cdAoa: 0.9,
  kWeather: 0.55, // weathercock gain (1/m)
  rail: 1.0, // m of guidance
  muzzleY: 0.9,
  airTau: 0.022, // s, air blow-down time constant
  chuteK: 0.055, // 0.5*rho*Cd*A of the canopy
  chuteOpenT: 0.5,
  chuteTear: 26, // m/s relative airspeed above which the canopy rips
};

export const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ wind
export interface WindCfg {
  speed: number; // mean m/s
  dir: number; // rad, direction the wind blows TOWARD: 0 = +x (left->right), PI/2 = +z (headwind), -PI/2 = tailwind
  gust: number; // m/s amplitude
  rate: number; // rad/s base gust frequency
  wobble: number; // rad of direction wobble
  ph: number[]; // 5 phases
}
export const CALM: WindCfg = { speed: 0, dir: 0, gust: 0, rate: 1, wobble: 0, ph: [0, 0, 0, 0, 0] };

export function windAt(w: WindCfg, t: number, y = 5): [number, number] {
  if (w.speed === 0 && w.gust === 0) return [0, 0];
  const r = w.rate;
  const g = (Math.sin(r * t + w.ph[0]!) + 0.6 * Math.sin(2.3 * r * t + w.ph[1]!) + 0.35 * Math.sin(4.1 * r * t + w.ph[2]!)) / 1.95;
  const s = Math.max(0, w.speed + w.gust * g);
  const d = w.dir + w.wobble * Math.sin(0.7 * r * t + w.ph[3]!);
  const sw = w.gust * 0.3 * Math.sin(1.7 * r * t + w.ph[4]!);
  const h = 0.55 + 0.45 * Math.min(1, Math.max(0, y) / 25);
  return [(Math.cos(d) * s - Math.sin(d) * sw) * h, (Math.sin(d) * s + Math.cos(d) * sw) * h];
}

// ------------------------------------------------------------------ targets
export type TargetKind = 'ground' | 'stage' | 'basin' | 'cart' | 'roof' | 'ring';
export interface Target {
  kind: TargetKind;
  x: number;
  z: number;
  top: number; // height of the landing surface (0 for ground)
  hr: number; // direct-hit radius (m)
  mov?: { ax: number; period: number; phase: number }; // sinusoidal travel along x
  label: string;
}
export function targetPos(t: Target, time: number): [number, number] {
  if (!t.mov) return [t.x, t.z];
  return [t.x + t.mov.ax * Math.sin((2 * Math.PI * time) / t.mov.period + t.mov.phase), t.z];
}

export interface Hazard { kind: 'kid' | 'teacher' | 'pony'; x: number; z: number; r: number; pen: number }

// ------------------------------------------------------------------ flight
export interface LaunchParams {
  water: number; // fraction of bottle volume, 0..0.9
  psi: number; // gauge pressure
  pitch: number; // rad above horizon
  yaw: number; // rad, + = right
}

export type FlightPhase = 'water' | 'air' | 'coast' | 'landed';

export interface FlightEnd {
  kind: 'ground' | 'target' | 'water' | 'fizzle';
  x: number; // impact point
  z: number;
  y: number;
  rx: number; // rest point (after skid)
  rz: number;
  speed: number; // impact speed
  vh: number; // horizontal speed at impact
  t: number;
  soft: boolean;
}

export interface WaterFn { (x: number, z: number): boolean }

export class Flight {
  x = 0;
  y = BOTTLE.muzzleY;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  dx: number; // body axis
  dy: number;
  dz: number;
  t = 0;
  tAbs: number;
  phase: FlightPhase = 'water';
  vw: number; // remaining water volume
  p0abs: number;
  vair0: number;
  pg = 0; // air-blast gauge pressure
  thrust = 0;
  maxY = BOTTLE.muzzleY;
  tApex = 0;
  travelled = 0;
  chute = { state: 'none' as 'none' | 'open' | 'torn', open: 0, t: -1, alt: 0, dropAt: 0 };
  end: FlightEnd | null = null;
  /** where the rocket crossed the target's surface height on the way down (hit or miss) */
  cross: { x: number; z: number; t: number } | null = null;
  maxSpeed = 0;
  rangeAtApex = 0;
  readonly launchDir: [number, number, number];
  readonly hx: number; // horizontal heading
  readonly hz: number;
  /** per-flight tiny random-free signature so replays are identical */
  constructor(
    readonly p: LaunchParams,
    readonly wind: WindCfg,
    t0 = 0,
    readonly target: Target | null = null,
    readonly isWater: WaterFn = () => false,
  ) {
    const c = Math.cos(p.pitch);
    this.hx = Math.sin(p.yaw);
    this.hz = -Math.cos(p.yaw);
    this.dx = this.hx * c;
    this.dy = Math.sin(p.pitch);
    this.dz = this.hz * c;
    this.launchDir = [this.dx, this.dy, this.dz];
    this.tAbs = t0;
    this.vw = BOTTLE.vol * clamp(p.water, 0, 0.92);
    this.vair0 = BOTTLE.vol - this.vw;
    this.p0abs = PATM + Math.max(0, p.psi) * PSI;
    if (this.p.water > 0.001) this.phase = 'water';
    else {
      this.phase = 'air';
      this.pg = Math.max(0, this.p0abs - PATM);
    }
  }

  get mass() {
    return BOTTLE.dry + RHO_W * this.vw;
  }
  get speed() {
    return Math.hypot(this.vx, this.vy, this.vz);
  }
  get dist() {
    return Math.hypot(this.x, this.z);
  }

  canChute() {
    return this.phase !== 'landed' && this.chute.state === 'none' && this.phase === 'coast' && (this.vy <= 0.3 || this.y < 0.5);
  }

  deployChute(): 'open' | 'torn' | 'no' {
    if (!this.canChute()) return 'no';
    const [wx, wz] = windAt(this.wind, this.tAbs, this.y);
    const rel = Math.hypot(this.vx - wx, this.vy, this.vz - wz);
    this.chute.t = this.t;
    this.chute.alt = this.y;
    this.chute.dropAt = this.dist;
    if (rel > BOTTLE.chuteTear) {
      this.chute.state = 'torn';
      return 'torn';
    }
    this.chute.state = 'open';
    return 'open';
  }

  private rem = 0;
  /** advance by dt seconds; integration always runs at a fixed 1/240 s so results never depend on the frame rate */
  step(dt: number) {
    const H = 1 / 240;
    this.rem += dt;
    while (this.rem >= H - 1e-12 && !this.end) {
      this.sub(H);
      this.rem -= H;
    }
  }

  private sub(h: number) {
    const B = BOTTLE;
    const prevY = this.y;
    const [wx, wz] = windAt(this.wind, this.tAbs, this.y);
    const rx = this.vx - wx;
    const ry = this.vy;
    const rz = this.vz - wz;
    const rs = Math.hypot(rx, ry, rz);

    // thrust ---------------------------------------------------------
    let F = 0;
    if (this.phase === 'water') {
      const vair = B.vol - this.vw;
      const pabs = this.p0abs * Math.pow(this.vair0 / vair, GAMMA);
      const dP = pabs - PATM;
      if (dP > 200) {
        const ve = B.cdNoz * Math.sqrt((2 * dP) / RHO_W);
        const dV = Math.min(this.vw, B.nozA * ve * h);
        F = (RHO_W * dV * ve) / h;
        this.vw -= dV;
        if (this.vw <= 1e-9) {
          this.vw = 0;
          const pend = this.p0abs * Math.pow(this.vair0 / B.vol, GAMMA);
          this.pg = Math.max(0, pend - PATM);
          this.phase = 'air';
        }
      } else this.phase = 'coast'; // pressure used up, leftover water is dead weight
    }
    if (this.phase === 'air') {
      const tau = B.airTau * (B.vol / 1.5e-3);
      this.pg *= Math.exp(-h / tau);
      F = 1.1 * B.nozA * this.pg;
      if (this.pg < 1500) this.phase = 'coast';
    }
    this.thrust = F;

    // drag -----------------------------------------------------------
    let ax = 0;
    let ay = -G;
    let az = 0;
    const m = this.mass;
    if (rs > 1e-3) {
      const cosA = clamp((this.dx * rx + this.dy * ry + this.dz * rz) / rs, -1, 1);
      const sin2 = 1 - cosA * cosA;
      const cd = B.cd0 + B.cdAoa * sin2 + (cosA < 0 ? 0.4 : 0);
      const k = 0.5 * RHO_A * cd * B.bodyA;
      let kk = k;
      if (this.chute.state === 'open') {
        this.chute.open = Math.min(1, (this.t - this.chute.t) / B.chuteOpenT);
        kk += B.chuteK * this.chute.open;
      }
      ax -= (kk * rs * rx) / m;
      ay -= (kk * rs * ry) / m;
      az -= (kk * rs * rz) / m;
    }
    ax += (F * this.dx) / m;
    ay += (F * this.dy) / m;
    az += (F * this.dz) / m;

    // rail guidance ---------------------------------------------------
    if (this.travelled < B.rail) {
      const along = ax * this.launchDir[0] + ay * this.launchDir[1] + az * this.launchDir[2];
      ax = along * this.launchDir[0];
      ay = along * this.launchDir[1];
      az = along * this.launchDir[2];
    }

    this.vx += ax * h;
    this.vy += ay * h;
    this.vz += az * h;
    if (this.travelled < B.rail) {
      // stay on rail line
      const vd = this.vx * this.launchDir[0] + this.vy * this.launchDir[1] + this.vz * this.launchDir[2];
      if (vd < 0) {
        this.finish('fizzle', 0, 0, 0);
        return;
      }
      this.vx = vd * this.launchDir[0];
      this.vy = vd * this.launchDir[1];
      this.vz = vd * this.launchDir[2];
    }
    this.x += this.vx * h;
    this.y += this.vy * h;
    this.z += this.vz * h;
    const step = Math.hypot(this.vx, this.vy, this.vz) * h;
    this.travelled += step;
    this.t += h;
    this.tAbs += h;

    // orientation (weathercock) -----------------------------------------
    if (this.travelled >= B.rail && rs > 0.5) {
      let tx = rx / rs;
      let ty = ry / rs;
      let tz = rz / rs;
      if (this.chute.state === 'open') {
        // hang nose-down under the canopy
        const o = this.chute.open;
        tx *= 1 - o;
        ty = ty * (1 - o) - o;
        tz *= 1 - o;
      }
      const a = Math.min(1, B.kWeather * Math.max(rs, 4) * h * (this.chute.state === 'open' ? 1.5 : 1));
      this.dx += (tx - this.dx) * a;
      this.dy += (ty - this.dy) * a;
      this.dz += (tz - this.dz) * a;
      const l = Math.hypot(this.dx, this.dy, this.dz) || 1;
      this.dx /= l;
      this.dy /= l;
      this.dz /= l;
    }

    const sp = this.speed;
    if (sp > this.maxSpeed) this.maxSpeed = sp;
    if (this.y > this.maxY) {
      this.maxY = this.y;
      this.tApex = this.t;
      this.rangeAtApex = this.dist;
    }

    // collisions ---------------------------------------------------------
    const tg = this.target;
    if (tg && tg.top > 0 && this.vy < 0 && prevY > tg.top && this.y <= tg.top) {
      const [tx, tz] = targetPos(tg, this.tAbs);
      this.cross = { x: this.x, z: this.z, t: this.tAbs };
      const d = Math.hypot(this.x - tx, this.z - tz);
      if (d <= tg.hr) {
        this.y = tg.top;
        this.finish('target', 0, 0, tg.top);
        return;
      }
    }
    if (this.y <= 0 && this.t > 0.02) {
      this.y = 0;
      const water = this.isWater(this.x, this.z);
      this.finish(water ? 'water' : 'ground', 0, 0, 0);
    }
  }

  private finish(kind: FlightEnd['kind'], _a: number, _b: number, y: number) {
    const vh = Math.hypot(this.vx, this.vz);
    const speed = this.speed;
    const chuted = this.chute.state === 'open' && this.chute.open > 0.6;
    let skid = 0;
    if (kind === 'ground') skid = chuted ? Math.min(0.5, 0.2 * vh) : Math.min(5, 0.13 * vh);
    const soft = chuted && Math.abs(this.vy) < 8;
    const hx = vh > 0.01 ? this.vx / vh : this.hx;
    const hz = vh > 0.01 ? this.vz / vh : this.hz;
    this.end = {
      kind,
      x: this.x,
      z: this.z,
      y,
      rx: this.x + hx * skid,
      rz: this.z + hz * skid,
      speed,
      vh,
      t: this.t,
      soft,
    };
    this.phase = 'landed';
  }
}

// ------------------------------------------------------------------ headless helpers
export interface SimOpts {
  target?: Target | null;
  isWater?: WaterFn;
  /** deploy the chute at this altitude on the way down (undefined = never) */
  chuteAlt?: number;
  /** collect path samples every `sample` seconds */
  sample?: number;
  maxT?: number;
}
export interface SimResult {
  end: FlightEnd;
  apex: number;
  tApex: number;
  t: number;
  chute: Flight['chute'];
  maxSpeed: number;
  path: number[]; // x,y,z triplets
  chuteMsg: string;
  maxRangeAtApex: number;
  cross: { x: number; z: number; t: number } | null;
}

export function simulate(p: LaunchParams, wind: WindCfg, t0: number, o: SimOpts = {}): SimResult {
  const f = new Flight(p, wind, t0, o.target ?? null, o.isWater);
  const path: number[] = [];
  let nextS = 0;
  let msg = '';
  const dt = 1 / 120;
  const maxT = o.maxT ?? 40;
  while (!f.end && f.t < maxT) {
    if (o.chuteAlt !== undefined && f.chute.state === 'none' && f.canChute() && f.y <= o.chuteAlt) msg = f.deployChute();
    f.step(dt);
    if (o.sample && f.t >= nextS) {
      path.push(f.x, f.y, f.z);
      nextS += o.sample;
    }
  }
  
  const end = f.end ?? { kind: 'fizzle' as const, x: f.x, z: f.z, y: f.y, rx: f.x, rz: f.z, speed: f.speed, vh: 0, t: f.t, soft: false };
  if (o.sample) path.push(end.x, end.y, end.z);
  return { end, apex: f.maxY, tApex: f.tApex, t: f.t, chute: f.chute, maxSpeed: f.maxSpeed, path, chuteMsg: msg, maxRangeAtApex: f.rangeAtApex, cross: f.cross };
}

/** range along the launch heading (m) in calm air */
export function calmRange(p: LaunchParams) {
  const r = simulate(p, CALM, 0);
  return Math.hypot(r.end.rx, r.end.rz);
}

// ------------------------------------------------------------------ scoring
export const RINGS: [number, number][] = [
  [0.8, 1000],
  [1.6, 800],
  [3, 600],
  [5, 400],
  [8, 200],
  [12, 100],
];
export function ringPts(d: number) {
  for (const [r, p] of RINGS) if (d <= r) return p;
  return 0;
}

export interface ShotScore {
  points: number;
  base: number;
  bonus: { label: string; pts: number }[];
  dist: number; // horizontal distance from target centre at landing time
  along: number; // + = long, - = short (m)
  lat: number; // + = right of target, - = left (m)
  direct: boolean;
  hazard: Hazard | null;
  tx: number;
  tz: number;
}

export function scoreShot(end: FlightEnd, tAbsLand: number, target: Target, hazards: Hazard[], chute: { state: string }): ShotScore {
  const [tx, tz] = targetPos(target, tAbsLand);
  const direct = end.kind === 'target' || (target.kind === 'ring' && end.kind === 'water' && Math.hypot(end.x - tx, end.z - tz) <= target.hr);
  // landing point used for scoring
  const px = direct ? end.x : end.rx;
  const pz = direct ? end.z : end.rz;
  const dx = px - tx;
  const dz = pz - tz;
  const dist = Math.hypot(dx, dz);
  const ul = Math.hypot(tx, tz) || 1;
  const ux = tx / ul; // unit launcher -> target
  const uz = tz / ul;
  const along = dx * ux + dz * uz;
  const lat = dx * -uz + dz * ux; // right-hand side of heading (heading (ux,uz); right = (-uz, ux) with forward -z)
  const bonus: { label: string; pts: number }[] = [];
  let hazard: Hazard | null = null;
  for (const h of hazards) {
    if (Math.hypot(px - h.x, pz - h.z) <= h.r) hazard = h;
  }
  let base = 0;
  if (hazard) {
    return { points: -hazard.pen, base: -hazard.pen, bonus, dist, along, lat, direct: false, hazard, tx, tz };
  }
  const soft = end.soft && chute.state === 'open';
  switch (target.kind) {
    case 'ground':
      base = ringPts(dist);
      break;
    case 'stage':
      base = direct ? ringPts(dist) : Math.round(ringPts(dist) * 0.6);
      if (direct) bonus.push({ label: '구령대 착지', pts: 300 });
      break;
    case 'basin':
      base = direct ? 1500 : Math.round(ringPts(dist) * 0.6);
      if (direct) bonus.push({ label: '풍덩!', pts: 0 });
      break;
    case 'cart':
      base = direct ? 1300 : Math.round(ringPts(dist) * 0.6);
      if (direct) bonus.push({ label: '움직이는 과녁', pts: 300 });
      break;
    case 'roof':
      base = direct ? 1600 : Math.round(ringPts(dist) * 0.5);
      if (direct) bonus.push({ label: '옥상 탱크 명중', pts: 300 });
      break;
    case 'ring':
      base = direct ? 1400 : Math.round(ringPts(dist) * 0.6);
      if (direct) bonus.push({ label: '고리 통과', pts: 300 });
      break;
  }
  if (soft && (direct || dist <= 3)) bonus.push({ label: '낙하산 정밀착지', pts: 300 });
  const points = base + bonus.reduce((s, b) => s + b.pts, 0);
  return { points, base, bonus, dist, along, lat, direct, hazard: null, tx, tz };
}
