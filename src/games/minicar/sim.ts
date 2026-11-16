/** Deterministic 1D race simulation along the track. Pure: usable headless for sweeps / tests. */
import { DRAG, G, BATT_SECONDS, derive, driveAccel, topSpeed, type Derived, type Setup } from './parts';
import { G_FLIGHT, buildTrack, laneOffset, lcCurvature, segAt, type Seg, type Track } from './track';

export const DT = 1 / 60;
export const CLIMB_GAIN = 1.8;
export const DNF_MS = 599000;

export type OutKind = 'corner' | 'lc' | 'wave' | 'landing';
export interface OutInfo {
  kind: OutKind;
  segName: string;
  lap: number; // 1-based
  v: number;
  aLat: number;
  aLim: number;
  sLap: number;
  /** +1 flies to the left of travel, -1 right */
  side: number;
  /** approximate safe speed for the failing element (u/s) */
  safeV: number;
}

export interface SimEvent {
  t: number;
  kind: 'bounce' | 'short' | 'wave' | 'nearmiss';
  segName: string;
  lap: number;
}

export interface RaceResult {
  finished: boolean;
  timeMs: number;
  lapTimes: number[]; // seconds
  topV: number;
  out: OutInfo | null;
  tOut: number;
  maxRatio: number;
  maxRatioSeg: string;
  endBatt: number; // 0..1 efficiency at end
  events: SimEvent[];
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const trackCache = new Map<number, Track>();
export function getTrack(level: number): Track {
  let t = trackCache.get(level);
  if (!t) trackCache.set(level, (t = buildTrack(level)));
  return t;
}

export class RaceSim {
  readonly track: Track;
  readonly d: Derived;
  readonly laps: number;
  t = 0;
  sTot = 0;
  v = 0.8;
  used = 0;
  climb = 0;
  ratio = 0;
  state: 'run' | 'out' | 'done' = 'run';
  lapTimes: number[] = [];
  lapStartT = 0;
  topV = 0;
  out: OutInfo | null = null;
  tOut = 0;
  maxRatio = 0;
  maxRatioSeg = '';
  events: SimEvent[] = [];
  finishT = 0;
  eff = 1;
  flying: { left: number; total: number; seg: Seg } | null = null;
  segNow: Seg;
  lapNow = 0;
  trace: number[] | null = null;
  private rnd: () => number;
  private nearCool = 0;

  constructor(readonly setup: Setup, readonly level: number, trace = false) {
    this.track = getTrack(level);
    this.d = derive(setup);
    this.laps = this.track.def.laps;
    this.rnd = mulberry32(level * 7919 + 17);
    this.segNow = this.track.segs[0];
    if (trace) this.trace = [];
  }

  get sLap() {
    return this.sTot - this.lapNow * this.track.length;
  }
  get battery() {
    return Math.max(0, 1 - this.used);
  }

  step(dt: number) {
    if (this.state !== 'run') return;
    const T = this.track, L = T.length, d = this.d;
    const lap = Math.min(this.laps - 1, Math.floor(this.sTot / L));
    this.lapNow = lap;
    const sLap = this.sTot - lap * L;
    const seg = segAt(T, sLap);
    this.segNow = seg;
    this.eff = d.volt * (1 - d.sag * Math.min(1, this.used)) * (1 - d.fade * Math.max(0, this.t - 10));
    this.used += (dt * d.drain) / BATT_SECONDS;

    let ds: number;
    if (this.flying) {
      ds = this.v * dt;
      this.flying.left -= ds;
      if (this.flying.left <= 0) this.land(this.flying.seg, lap);
      this.t += dt;
    } else {
      let kappa = 0, dist = 1, limMul = 1, kind: OutKind = 'corner';
      if (seg.k === 'arc') {
        const R = seg.R!, off = laneOffset(T, seg.s0, lap);
        const reff = Math.max(1.0, Math.abs(R) - Math.sign(R) * off);
        kappa = 1 / reff;
        dist = Math.abs(R) / reff;
      } else if (seg.k === 'lc') {
        kappa = lcCurvature(T, sLap, lap);
        limMul = 0.8;
        kind = 'lc';
      }
      const aLat = this.v * this.v * kappa;
      const aLim = d.aLim * limMul;
      this.ratio = aLat / aLim;
      if (this.ratio > this.maxRatio && (seg.k === 'arc' || seg.k === 'lc')) {
        this.maxRatio = this.ratio;
        this.maxRatioSeg = seg.name ?? '';
      }
      let a = driveAccel(d, this.v, this.eff) - DRAG * this.v * this.v - d.roll - d.scrub * aLat;
      a -= G * Math.sin(seg.grade ?? 0);
      if (seg.brake && d.brake > 0) a -= d.brake * (0.7 + 0.05 * this.v);
      let waveOut = false;
      if (seg.k === 'wave') {
        const ws = d.waveSafe + (seg.waveBase ?? 0);
        if (this.v > ws) {
          a -= (this.v - ws) * 1.6;
          if (this.v > ws + 5.5) waveOut = true;
          if (this.events.length === 0 || this.events[this.events.length - 1].kind !== 'wave' || this.t - this.events[this.events.length - 1].t > 1.5)
            this.events.push({ t: this.t, kind: 'wave', segName: seg.name ?? '', lap: lap + 1 });
        }
      }
      this.v = Math.max(0.8, this.v + a * dt);
      if (this.v > this.topV) this.topV = this.v;
      if (this.ratio > 1) this.climb += (this.ratio - 1) * CLIMB_GAIN * dt;
      else {
        if (this.ratio > 0.92 && this.climb === 0 && this.nearCool <= 0 && (seg.k === 'arc')) {
          this.events.push({ t: this.t, kind: 'nearmiss', segName: seg.name ?? '', lap: lap + 1 });
          this.nearCool = 2;
        }
        this.climb = Math.max(0, this.climb - 1.5 * dt);
      }
      this.nearCool -= dt;
      this.t += dt;
      if (this.climb >= 1 || waveOut) {
        const lcSide = seg.k === 'lc' ? Math.sign(laneOffset(T, sLap + 0.5, lap) - laneOffset(T, sLap - 0.5, lap)) || 1 : 0;
        this.fail(waveOut ? 'wave' : kind, seg, lap, aLat, aLim, kind === 'lc' ? -lcSide : seg.k === 'arc' ? -Math.sign(seg.R!) : 1,
          waveOut ? d.waveSafe + (seg.waveBase ?? 0) : aLat > 0 ? Math.sqrt(aLim * ((this.v * this.v) / aLat)) : this.v);
        return;
      }
      ds = this.v * dt * dist;
    }

    const sPrev = this.sTot;
    this.sTot += ds;
    this.trace?.push(this.sTot);

    // entering a gap -> launch
    if (!this.flying) {
      const lapN = Math.min(this.laps - 1, Math.floor(this.sTot / L));
      const segN = segAt(T, this.sTot - lapN * L);
      if (segN.k === 'gap' && seg.k !== 'gap') {
        const th = segN.theta ?? 0.3;
        const vClear = Math.sqrt((segN.len * G_FLIGHT) / Math.sin(2 * th));
        this.flying = { left: segN.len, total: segN.len, seg: segN };
        if (this.v < vClear) {
          this.events.push({ t: this.t, kind: 'short', segName: segN.name ?? '', lap: lapN + 1 });
          this.v *= 0.5;
        }
      }
    }

    // lap bookkeeping
    const target = (this.lapTimes.length + 1) * L;
    if (this.sTot >= target) {
      const frac = (target - sPrev) / Math.max(1e-9, this.sTot - sPrev);
      const tc = this.t - dt + frac * dt;
      this.lapTimes.push(tc - this.lapStartT);
      this.lapStartT = tc;
      if (this.lapTimes.length >= this.laps) {
        this.state = 'done';
        this.finishT = tc;
      }
    }
  }

  private land(seg: Seg, lap: number) {
    const d = this.d;
    const th = seg.theta ?? 0.3;
    this.flying = null;
    const next = this.track.segs[seg.idx + 1];
    const D = (this.v * this.v * Math.sin(2 * th)) / G_FLIGHT;
    const over = Math.max(0, D - (seg.len + (next ? next.len * 0.8 : 3)));
    const safe = d.landSafe + (seg.landBase ?? 0);
    const stress = (this.v - safe) / 3.2 + over * 0.15;
    if (stress >= 1) {
      this.fail('landing', seg, lap, this.v * this.v, safe * safe, 1, safe);
    } else if (stress > 0) {
      const jitter = 1 + 0.35 * this.rnd();
      this.v = Math.max(1.5, this.v * (1 - 0.17 * stress * jitter));
      this.events.push({ t: this.t, kind: 'bounce', segName: seg.name ?? '', lap: lap + 1 });
    }
  }

  private fail(kind: OutKind, seg: Seg, lap: number, aLat: number, aLim: number, side: number, safeV: number) {
    this.state = 'out';
    this.tOut = this.t;
    this.out = { kind, segName: kind === 'corner' && seg.corner ? `${seg.corner}번 코너${seg.name && seg.name.includes('(') ? ' ' + seg.name.slice(seg.name.indexOf('(')) : ''}` : seg.name ?? '', lap: lap + 1, v: this.v, aLat, aLim, sLap: this.sTot - lap * this.track.length, side, safeV };
    if (seg.name === '헤어핀') this.out.segName = '헤어핀';
  }

  get result(): RaceResult {
    return {
      finished: this.state === 'done',
      timeMs: this.state === 'done' ? Math.round(this.finishT * 1000) : DNF_MS,
      lapTimes: this.lapTimes.slice(),
      topV: this.topV,
      out: this.out,
      tOut: this.tOut,
      maxRatio: this.maxRatio,
      maxRatioSeg: this.maxRatioSeg,
      endBatt: this.eff,
      events: this.events,
    };
  }
}

export function simulateRace(setup: Setup, level: number, trace = false): RaceResult & { trace: number[] | null } {
  const sim = new RaceSim(setup, level, trace);
  let guard = 0;
  while (sim.state === 'run' && guard++ < 60 * 400) sim.step(DT);
  return { ...sim.result, trace: sim.trace };
}


/** Deliberately rough "course-out risk" estimate for the garage screen (0 = safe .. 1+ = very risky). */
export function riskScore(setup: Setup, level: number): number {
  const T = getTrack(level);
  const d = derive(setup);
  const top = topSpeed(d, 0.97) * 0.95;
  let worst = 0;
  for (const seg of T.segs) {
    if (seg.k !== 'arc') continue;
    let rmin = Infinity;
    for (let lap = 0; lap < T.def.laps; lap++) rmin = Math.min(rmin, Math.max(1.0, Math.abs(seg.R!) - Math.sign(seg.R!) * laneOffset(T, seg.s0, lap)));
    worst = Math.max(worst, top * top / rmin / d.aLim);
  }
  // deterministic "fog": +-12% so players cannot treat it as exact
  const h = (setup.motor * 7 + setup.gear * 13 + setup.tire * 17 + setup.roller * 19 + setup.weight * 23 + setup.battery * 29 + level * 31) % 11;
  return worst * (0.88 + (h / 10) * 0.24);
}
export const RISK_LABELS = ['낮음', '보통', '높음', '매우 높음'];
export function riskLevel(score: number, level: number): number {
  const cut = RISK_CUTS[level - 1] ?? RISK_CUTS[0];
  return score < cut[0] ? 0 : score < cut[1] ? 1 : score < cut[2] ? 2 : 3;
}
export const RISK_CUTS: [number, number, number][] = [
  [1.0, 1.3, 1.7],
  [1.9, 2.5, 3.3],
  [1.9, 2.5, 3.3],
];
