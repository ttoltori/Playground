/** Parts catalogue + derived physical numbers. Pure (no DOM / three). */

export interface Setup {
  motor: number;
  gear: number;
  tire: number;
  roller: number;
  weight: number;
  battery: number;
}
export type SlotKey = keyof Setup;

export interface Part {
  name: string;
  desc: string;
  icon: string;
}

export interface SlotDef {
  key: SlotKey;
  label: string;
  icon: string;
  parts: Part[];
}

export const SLOTS: SlotDef[] = [
  {
    key: 'motor', label: '모터', icon: '⚙️',
    parts: [
      { name: '노멀 모터', desc: '문방구 기본 포장. 무난', icon: '🟡' },
      { name: '토크 튠', desc: '힘 좋음, 회전 낮음. 오르막/출발', icon: '🟠' },
      { name: '레브 튠', desc: '고회전. 직선 최고속, 힘 약함', icon: '🔵' },
      { name: '하이퍼 대시', desc: '힘+회전 둘 다. 건전지 순삭', icon: '🔴' },
    ],
  },
  {
    key: 'gear', label: '기어비', icon: '🔩',
    parts: [
      { name: '4.2:1 가속형', desc: '발진 빠름, 최고속 낮음', icon: '🐢' },
      { name: '3.7:1 표준형', desc: '설명서대로', icon: '🚗' },
      { name: '3.2:1 최고속형', desc: '직선 폭주, 발진 굼뜸', icon: '🚀' },
    ],
  },
  {
    key: 'tire', label: '타이어', icon: '🛞',
    parts: [
      { name: '소경 스폰지', desc: '접지 최고, 저중심. 최고속↓', icon: '🧽' },
      { name: '중경 고무', desc: '무난한 기본 타이어', icon: '⚫' },
      { name: '대경 슬릭', desc: '최고속↑, 접지↓, 무게중심↑', icon: '🛞' },
    ],
  },
  {
    key: 'roller', label: '롤러', icon: '🔘',
    parts: [
      { name: '플라스틱 · 좁게', desc: '마찰 큼(코너에서 감속), 기본 안정', icon: '⚪' },
      { name: '플라스틱 · 넓게', desc: '벽 잘 잡음. 마찰 큼, 약간 무거움', icon: '⭕' },
      { name: '베어링 · 좁게', desc: '마찰 거의 0, 대신 벽 타기 쉬움', icon: '💿' },
      { name: '베어링 · 넓게', desc: '저마찰 + 적당한 안정. 착지엔 약함', icon: '🥏' },
    ],
  },
  {
    key: 'weight', label: '무게추·브레이크', icon: '🧲',
    parts: [
      { name: '없음', desc: '가볍고 빠름. 착지/웨이브에 약함', icon: '🪶' },
      { name: '무게추 +30g', desc: '코너·착지 안정, 가속 둔화', icon: '🧲' },
      { name: '슬로프 브레이크', desc: '경사·점프 구간에서 감속', icon: '🛑' },
      { name: '경량추 + 소형 브레이크', desc: '약한 무게추와 약한 브레이크', icon: '⚖️' },
    ],
  },
  {
    key: 'battery', label: '건전지', icon: '🔋',
    parts: [
      { name: '새 알카라인', desc: '초반 힘 최고, 갈수록 처짐', icon: '🔋' },
      { name: '쓰던 망간', desc: '힘 약함, 가벼움, 꾸준', icon: '🪫' },
      { name: '충전지(Ni-MH)', desc: '약간 낮지만 끝까지 일정', icon: '♻️' },
    ],
  },
];

// ---- numeric tables (index-aligned with SLOTS parts)
const MOTOR = [
  { fs: 1.0, vn: 1.0, drain: 1.0, w: 30, fade: 0.001 },
  { fs: 1.3, vn: 0.82, drain: 1.1, w: 31, fade: 0.002 },
  { fs: 0.8, vn: 1.22, drain: 0.9, w: 29, fade: 0.001 },
  { fs: 1.12, vn: 1.12, drain: 2.5, w: 34, fade: 0.006 },
];
const GEAR = [0.84, 1.0, 1.2];
const TIRE = [
  { k: 0.9, mu: 1.1, lim: 1.8, w: 8, roll: 0.45 },
  { k: 1.0, mu: 0.9, lim: 0, w: 10, roll: 0.25 },
  { k: 1.12, mu: 0.62, lim: -2.4, w: 12, roll: 0.1 },
];
const ROLLER = [
  { scrub: 0.2, roll: 0.35, lim: 0, w: 8, land: 0, wave: 0 },
  { scrub: 0.2, roll: 0.75, lim: 3.4, w: 14, land: 1.0, wave: 0.2 },
  { scrub: 0.04, roll: 0.1, lim: -1.6, w: 12, land: -0.6, wave: -0.4 },
  { scrub: 0.04, roll: 0.3, lim: 1.4, w: 18, land: -0.6, wave: -0.2 },
];
const WEIGHT = [
  { w: 0, lim: 0, land: 0, wave: 0, brake: 0 },
  { w: 30, lim: 2.6, land: 2.6, wave: 1.0, brake: 0 },
  { w: 10, lim: 0, land: 1.0, wave: 0.6, brake: 2.4 },
  { w: 16, lim: 1.2, land: 1.5, wave: 0.6, brake: 1.2 },
];
const BATTERY = [
  { volt: 1.0, sag: 0.34, w: 22 },
  { volt: 0.8, sag: 0.16, w: 16 },
  { volt: 0.9, sag: 0.05, w: 26 },
];

export const BASE_MASS = 96;
export const A0 = 15; // stall acceleration at neutral setup (u/s^2)
export const V0 = 17.5; // no-load speed at neutral setup (u/s)
export const G = 9.8;
export const BATT_SECONDS = 70; // nominal seconds of run per "full" battery use

export interface Derived {
  mass: number;
  fs: number;
  vn: number;
  k: number;
  volt: number;
  sag: number;
  fade: number;
  drain: number;
  mu: number;
  aLim: number;
  scrub: number;
  roll: number;
  brake: number;
  landSafe: number;
  waveSafe: number;
}

export function derive(s: Setup): Derived {
  const m = MOTOR[s.motor], t = TIRE[s.tire], r = ROLLER[s.roller], w = WEIGHT[s.weight], b = BATTERY[s.battery];
  return {
    mass: BASE_MASS + m.w + t.w + r.w + w.w + b.w,
    fs: m.fs,
    vn: m.vn,
    k: GEAR[s.gear] * t.k,
    volt: b.volt,
    sag: b.sag,
    fade: m.fade,
    drain: m.drain,
    mu: t.mu,
    aLim: 11.2 + t.lim + r.lim + w.lim,
    scrub: r.scrub,
    roll: ((0.3 + t.roll + r.roll) * (BASE_MASS + m.w + t.w + r.w + w.w + b.w)) / 150,
    brake: w.brake,
    landSafe: 8.0 + r.land + w.land + (t.lim > 0 ? 0.7 : t.lim < -1 ? -0.5 : 0),
    waveSafe: 8.8 + (BASE_MASS + m.w + t.w + r.w + w.w + b.w - 150) * 0.035 + r.wave + w.wave + (t.lim < -1 ? -0.4 : 0),
  };
}

export const DRAG = 0.011;

/** drive acceleration at speed v with battery efficiency eff (before gravity / drag). */
export function driveAccel(d: Derived, v: number, eff: number): number {
  const v0 = V0 * d.vn * d.k * eff;
  const a = ((A0 * d.fs) / d.k) * eff * Math.max(0, 1 - v / v0);
  return Math.min(a / (d.mass / 150), d.mu * 11);
}

/** steady top speed on the flat for a given battery efficiency (u/s). */
export function topSpeed(d: Derived, eff = 1): number {
  let lo = 0, hi = V0 * d.vn * d.k * eff;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const net = driveAccel(d, mid, eff) - DRAG * mid * mid - d.roll;
    if (net > 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface Stats {
  top: number; // u/s
  kmh: number;
  speed: number; // 0..1 bars
  accel: number;
  stab: number;
  weight: number;
  drain: number;
  aLim: number;
  massG: number;
  a3: number;
  drainRaw: number;
}

export function stats(s: Setup): Stats {
  const d = derive(s);
  const top = topSpeed(d, 1);
  const a3 = driveAccel(d, 3, 1) - DRAG * 9 - d.roll;
  const c = (v: number) => Math.max(0.04, Math.min(1, v));
  return {
    top,
    kmh: top * 3.6,
    speed: c((top - 7) / 11),
    accel: c((a3 - 2) / 9),
    stab: c((d.aLim - 5) / 13),
    weight: c((d.mass - 150) / 70 + 0.15),
    drain: c((d.drain * (0.25 + d.sag * 1.8) + d.fade * 40) / 1.3),
    aLim: d.aLim,
    massG: d.mass,
    a3,
    drainRaw: d.drain * (0.25 + d.sag * 1.8) + d.fade * 40,
  };
}

export const DEFAULT_SETUP: Setup = { motor: 0, gear: 1, tire: 1, roller: 0, weight: 0, battery: 0 };

export function setupLabel(s: Setup): string {
  return SLOTS.map((sl) => sl.parts[s[sl.key]].name).join(' / ');
}

export function* allSetups(): Generator<Setup> {
  for (let motor = 0; motor < MOTOR.length; motor++)
    for (let gear = 0; gear < GEAR.length; gear++)
      for (let tire = 0; tire < TIRE.length; tire++)
        for (let roller = 0; roller < ROLLER.length; roller++)
          for (let weight = 0; weight < WEIGHT.length; weight++)
            for (let battery = 0; battery < BATTERY.length; battery++)
              yield { motor, gear, tire, roller, weight, battery };
}
