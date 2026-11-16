import { type Hazard, type Target, type WindCfg, CALM } from './physics';

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SHOTS = 5;

export interface ShotDef {
  target: Target;
  hazards: Hazard[]; // absolute positions
  intro: string; // radio line when this target comes up
}

export interface LevelCfg {
  id: number;
  name: string;
  scenery: 'school' | 'river';
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  /** hidden bottle burst band (psi) — the red zone on the gauge starts at `red` */
  burst: [number, number];
  red: number;
  gaugeMax: number;
  /** trajectory aid: 'calm' = shown, accurate only in still air; 'none' = hidden */
  aid: 'calm' | 'none';
  riverZ: number | null; // z below -riverZ is water
  windFor(rng: () => number): WindCfg;
  shots: ShotDef[];
}

const D = Math.PI / 180;
const polar = (d: number, bDeg: number): [number, number] => [d * Math.sin(bDeg * D), -d * Math.cos(bDeg * D)];

function ground(d: number, b: number, label = '과녁'): Target {
  const [x, z] = polar(d, b);
  return { kind: 'ground', x, z, top: 0, hr: 0, label };
}
function haz(t: Target, kind: Hazard['kind'], dx: number, dz: number): Hazard {
  const r = kind === 'kid' ? 1.1 : kind === 'teacher' ? 1.3 : 2.4;
  const pen = kind === 'kid' ? 300 : kind === 'teacher' ? 500 : 800;
  return { kind, x: t.x + dx, z: t.z + dz, r, pen };
}

const phases = (rng: () => number) => [0, 1, 2, 3, 4].map(() => rng() * Math.PI * 2);

// ---------------------------------------------------------------- LV1
const t11 = ground(22, 0);
const t12 = ground(30, -8);
const t13 = ground(38, 6);
const t14 = ground(45, -3);
const t15 = ground(34, 10);
const LV1: LevelCfg = {
  id: 1,
  name: '운동장 연습',
  scenery: 'school',
  sky: 0x8fd0f5,
  fog: 0xcfe9f5,
  fogNear: 90,
  fogFar: 300,
  burst: [108, 118],
  red: 95,
  gaugeMax: 120,
  aid: 'calm',
  riverZ: null,
  windFor: () => CALM,
  shots: [
    { target: t11, hazards: [], intro: '📢 선생님: 자, 첫 발은 가까운 과녁부터!' },
    { target: t12, hazards: [haz(t12, 'kid', 6.5, 1.5)], intro: '📢 짝꿍: 야 저기 나 서있다, 조심해라' },
    { target: t13, hazards: [haz(t13, 'teacher', -7, 3)], intro: '📢 선생님: 선생님은 여기 서 있을게~ (불안)' },
    { target: t14, hazards: [haz(t14, 'kid', -6, -2), haz(t14, 'kid', 7, 0)], intro: '📢 반장: 이번엔 제일 멀다!' },
    { target: t15, hazards: [haz(t15, 'pony', -8, -6)], intro: '📢 교감 선생님: 저기 내 포니 세워뒀으니까 알아서 해라' },
  ],
};

// ---------------------------------------------------------------- LV2
const t21 = ground(32, -4);
const [bx, bz] = polar(45, 5);
const t22: Target = { kind: 'basin', x: bx, z: bz, top: 0.35, hr: 0.9, label: '대야' };
const [sx, sz] = polar(38, -10);
const t23: Target = { kind: 'stage', x: sx, z: sz, top: 1.6, hr: 3.4, label: '구령대' };
const t24 = ground(58, 3);
const t25 = ground(70, -2);
const LV2: LevelCfg = {
  id: 2,
  name: '과학의 날 본선',
  scenery: 'school',
  sky: 0x9fc6e6,
  fog: 0xd2dfe8,
  fogNear: 110,
  fogFar: 340,
  burst: [88, 100],
  red: 80,
  gaugeMax: 105,
  aid: 'calm',
  riverZ: null,
  windFor: (rng) => {
    const side = rng() < 0.5 ? -1 : 1;
    const dir = side > 0 ? (rng() - 0.5) * 0.7 : Math.PI + (rng() - 0.5) * 0.7;
    return { speed: 2.4 + rng() * 1.8, dir, gust: 1.6, rate: 0.7 + rng() * 0.4, wobble: 0.2, ph: phases(rng) };
  },
  shots: [
    { target: t21, hazards: [haz(t21, 'kid', 6, 2)], intro: '📢 선생님: 바람이 분다~ 깃발 잘 보고 쏴라' },
    { target: t22, hazards: [haz(t22, 'kid', -5, 2)], intro: '📢 짝꿍: 대야에 직접 넣으면 물벼락이다!' },
    { target: t23, hazards: [], intro: '📢 반장: 구령대 위 과녁은 높아서 헷갈려' },
    { target: t24, hazards: [haz(t24, 'pony', 9, 1)], intro: '📢 교감 선생님: 내 차 저기 있다. 알지?' },
    { target: t25, hazards: [haz(t25, 'teacher', -8, -2)], intro: '📢 선생님: 마지막 한 발, 70미터!' },
  ],
};

// ---------------------------------------------------------------- LV3
const t31 = ground(40, 0);
const [cx, cz] = polar(46, 0);
const t32: Target = { kind: 'cart', x: cx, z: cz, top: 0.9, hr: 1.6, mov: { ax: 7, period: 11, phase: 0 }, label: '리어카' };
const [rx, rz] = polar(52, -6);
const t33: Target = { kind: 'roof', x: rx, z: rz, top: 8, hr: 2.1, label: '옥상 물탱크' };
const [gx, gz] = polar(60, 4);
const t34: Target = { kind: 'ring', x: gx, z: gz, top: 0.05, hr: 1.7, label: '둥둥 고리' };
const [dx, dz] = polar(50, 9);
const t35: Target = { kind: 'basin', x: dx, z: dz, top: 0.35, hr: 0.9, label: '대야' };
const LV3: LevelCfg = {
  id: 3,
  name: '한강 둔치 결승',
  scenery: 'river',
  sky: 0xb9d4e6,
  fog: 0xd6e0e8,
  fogNear: 90,
  fogFar: 320,
  burst: [72, 84],
  red: 64,
  gaugeMax: 95,
  aid: 'none',
  riverZ: 57,
  windFor: (rng) => ({ speed: 2.5 + rng() * 2, dir: rng() * Math.PI * 2, gust: 2.6, rate: 1.1 + rng() * 0.6, wobble: 0.5, ph: phases(rng) }),
  shots: [
    { target: t31, hazards: [haz(t31, 'pony', 9, 2)], intro: '📢 짝꿍: 한강 바람은 변덕이다...' },
    { target: t32, hazards: [], intro: '📢 아저씨: 리어카 지나간다~ 앞질러 쏴야지!' },
    { target: t33, hazards: [haz(t33, 'kid', 7, 6)], intro: '📢 반장: 옥상 물탱크, 위로 떨어뜨려야 돼' },
    { target: t34, hazards: [], intro: '📢 낚시꾼: 강 위 고리다. 빠지면 못 건진다~' },
    { target: t35, hazards: [haz(t35, 'teacher', -6, 4), haz(t35, 'kid', 6, -3)], intro: '📢 선생님: 마지막! 대야에 쏙!' },
  ],
};

export const LEVELS: LevelCfg[] = [LV1, LV2, LV3];
/** raw point thresholds (gold, silver, bronze) — grounded in headless bot sweeps (naive / calm-solver / noisy-human / oracle) */
export const MEDALS: [number, number, number][] = [
  [5200, 3800, 2200],
  [5200, 3500, 1800],
  [5500, 3300, 1500],
];

export const isWaterFn = (cfg: LevelCfg) => (_x: number, z: number) => cfg.riverZ !== null && z < -cfg.riverZ;

/** per-shot bottle: where the PET bottle gives up (hidden inside the red zone) */
export function rollBurst(cfg: LevelCfg, rng: () => number) {
  return cfg.burst[0] + rng() * (cfg.burst[1] - cfg.burst[0]);
}
