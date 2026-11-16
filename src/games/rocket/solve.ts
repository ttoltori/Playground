/** Headless helpers: run one shot through the real physics + scoring, and a firing-solution solver (used by the test bots). */
import { type LevelCfg, type ShotDef, isWaterFn } from './levels';
import { CALM, DEG, type LaunchParams, type ShotScore, type SimResult, type WindCfg, clamp, scoreShot, simulate, targetPos } from './physics';

export interface Plan {
  water: number;
  psi: number;
  pitchDeg: number;
  yaw: number; // rad
  chuteAlt?: number;
}

export function shoot(cfg: LevelCfg, shot: ShotDef, wind: WindCfg, tRel: number, plan: Plan): { sim: SimResult; score: ShotScore; burst: boolean } {
  const p: LaunchParams = { water: plan.water, psi: plan.psi, pitch: plan.pitchDeg * DEG, yaw: plan.yaw };
  const sim = simulate(p, wind, tRel, { target: shot.target, isWater: isWaterFn(cfg), chuteAlt: plan.chuteAlt });
  const score = scoreShot(sim.end, tRel + sim.t, shot.target, shot.hazards, sim.chute);
  return { sim, score, burst: false };
}

interface Err { along: number; lat: number }
function errOf(cfg: LevelCfg, shot: ShotDef, wind: WindCfg, tRel: number, plan: Plan): Err {
  const sim = simulate({ water: plan.water, psi: plan.psi, pitch: plan.pitchDeg * DEG, yaw: plan.yaw }, wind, tRel, {
    target: shot.target,
    isWater: isWaterFn(cfg),
    chuteAlt: plan.chuteAlt,
  });
  const e = sim.end;
  let px = e.kind === 'target' ? e.x : e.rx;
  let pz = e.kind === 'target' ? e.z : e.rz;
  let tt = tRel + sim.t;
  if (sim.cross && e.kind !== 'target') {
    px = sim.cross.x;
    pz = sim.cross.z;
    tt = sim.cross.t;
  } else if (shot.target.kind !== 'ground' && e.kind !== 'target') {
    px = e.x;
    pz = e.z;
  }
  const [tx, tz] = targetPos(shot.target, tt);
  const l = Math.hypot(shot.target.x, shot.target.z);
  const ux = shot.target.x / l;
  const uz = shot.target.z / l;
  const dx = px - tx;
  const dz = pz - tz;
  return { along: dx * ux + dz * uz, lat: dx * -uz + dz * ux };
}

export interface SolveOpts {
  water?: number;
  pitches?: number[];
  chuteAlt?: number;
  /** wind the solver believes in (CALM = ignore wind) */
  believed?: WindCfg;
  maxPsi?: number;
}

/** Find (psi, yaw) that put the rocket on the target for a given pitch. Returns residual error too. */
export function solveAt(cfg: LevelCfg, shot: ShotDef, wind: WindCfg, tRel: number, pitchDeg: number, o: SolveOpts = {}) {
  const believed = o.believed ?? wind;
  const l = Math.hypot(shot.target.x, shot.target.z);
  let yaw = Math.atan2(shot.target.x, -shot.target.z);
  let psi = 12 + l * 0.7;
  const plan: Plan = { water: o.water ?? 0.28, psi, pitchDeg, yaw, chuteAlt: o.chuteAlt };
  let e = errOf(cfg, shot, believed, tRel, plan);
  for (let i = 0; i < 28; i++) {
    const p2: Plan = { ...plan, psi: plan.psi + 1.5 };
    const e2 = errOf(cfg, shot, believed, tRel, p2);
    const slope = (e2.along - e.along) / 1.5 || 1;
    plan.psi = clamp(plan.psi - e.along / (slope < 0.05 ? 0.05 : slope), 6, 130);
    plan.yaw -= Math.atan2(e.lat, l) * 0.9;
    e = errOf(cfg, shot, believed, tRel, plan);
    if (Math.hypot(e.along, e.lat) < 0.03) break;
  }
  return { plan, err: e, ok: Math.hypot(e.along, e.lat) < 0.35 && plan.psi <= (o.maxPsi ?? cfg.red - 1) };
}

/** Best valid solution over a list of pitches (prefers the first that works). */
export function solve(cfg: LevelCfg, shot: ShotDef, wind: WindCfg, tRel: number, o: SolveOpts = {}) {
  let best: ReturnType<typeof solveAt> | null = null;
  for (const pitch of o.pitches ?? [42, 36, 50, 30, 58, 65]) {
    const s = solveAt(cfg, shot, wind, tRel, pitch, o);
    if (s.ok) return s;
    if (!best || Math.hypot(s.err.along, s.err.lat) < Math.hypot(best.err.along, best.err.lat)) best = s;
  }
  return best!;
}

export { CALM };
