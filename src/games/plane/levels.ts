/** Pure world / level data for 고무줄 비행기 (no three.js, so it can run headless in tests). Forward is -z, right is +x, up is +y (metres). */

export type SolidKind = 'bar' | 'stand' | 'goal' | 'pole' | 'building' | 'apt' | 'fence' | 'shop' | 'house' | 'wall';
export interface Solid { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; kind: SolidKind }
export interface Tree { x: number; z: number; r: number; crownY: number; crownH: number }
export interface Thermal { x: number; z: number; r: number; w: number; top: number }
export interface Rng { (): number }

export interface LevelCfg {
  name: string;
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  treeZ: number; // z of the first tree row (negative)
  windMin: number; // m/s
  windMax: number;
  gust: number; // gust amplitude, m/s
  ups: number; // thermals per throw
  upW: [number, number]; // strength range m/s
  downs: number;
  balls: number;
  pigeons: number;
  snap: [number, number]; // actual snap point as a multiple of the gauge's 100% mark
  stormy: boolean;
}

export const LEVELS: LevelCfg[] = [
  { name: '운동장 연습', sky: 0x8fd0ff, fog: 0xcfe9ff, fogNear: 90, fogFar: 330, treeZ: -100, windMin: 0, windMax: 0.5, gust: 0, ups: 0, upW: [0, 0], downs: 0, balls: 0, pigeons: 0, snap: [1.08, 1.22], stormy: false },
  { name: '과학의 날 대회', sky: 0x7cc4ff, fog: 0xd6ecff, fogNear: 80, fogFar: 300, treeZ: -95, windMin: 1.0, windMax: 3.2, gust: 0.7, ups: 2, upW: [1.7, 2.6], downs: 0, balls: 0, pigeons: 0, snap: [0.97, 1.13], stormy: false },
  { name: '태풍 전야', sky: 0x7d8aa6, fog: 0x9aa4ba, fogNear: 55, fogFar: 230, treeZ: -82, windMin: 2.0, windMax: 4.6, gust: 2.2, ups: 2, upW: [2.6, 3.8], downs: 2, balls: 2, pigeons: 2, snap: [0.92, 1.08], stormy: true },
];

export function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S = (kind: SolidKind, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Solid => ({ kind, x0, x1, y0, y1, z0, z1 });

/** Static collidable things. `treeZ` shifts the whole far end (fence, shops, rooftops). */
export function makeSolids(cfg: LevelCfg): Solid[] {
  const tz = cfg.treeZ;
  const s: Solid[] = [];
  // 철봉: two posts + bar
  s.push(S('bar', -12.1, -11.9, 0, 2.4, -17.1, -16.9), S('bar', -8.1, -7.9, 0, 2.4, -17.1, -16.9), S('bar', -12, -8, 2.25, 2.4, -17.1, -16.9));
  // 구령대 (commander's platform)
  s.push(S('stand', 6, 11, 0, 1.3, -32, -28));
  // 축구 골대: posts + crossbar
  s.push(S('goal', -3.75, -3.55, 0, 2.44, -63.1, -62.9), S('goal', 3.55, 3.75, 0, 2.44, -63.1, -62.9), S('goal', -3.75, 3.75, 2.3, 2.44, -63.1, -62.9));
  // 국기게양대
  s.push(S('pole', -16.2, -15.8, 0, 12, -40.2, -39.8));
  // school building (left) and apartments (right)
  s.push(S('building', -52, -36, 0, 16, 18, tz + 6));
  s.push(S('apt', 50, 66, 0, 42, -10, tz - 10));
  s.push(S('apt', 50, 66, 0, 36, 14, 4));
  // fence around the yard (low) - far end
  s.push(S('fence', -36, 36, 0, 3.5, tz - 7.2, tz - 6.8));
  s.push(S('fence', 35.8, 36.2, 0, 3.5, 12, tz - 7));
  s.push(S('fence', -36.2, -35.8, 0, 3.5, 12, tz - 7)); // behind school wall: harmless
  // back wall behind the thrower
  s.push(S('wall', -36, 36, 0, 3, 17.8, 18.2));
  // beyond the fence: 문방구 and rooftops
  s.push(S('shop', -10, -2, 0, 5.2, tz - 46, tz - 36));
  s.push(S('house', 8, 18, 0, 6.5, tz - 30, tz - 21));
  s.push(S('house', -26, -16, 0, 7.5, tz - 26, tz - 16));
  s.push(S('house', 22, 32, 0, 8, tz - 58, tz - 47));
  s.push(S('house', -34, -22, 0, 9, tz - 62, tz - 50));
  s.push(S('house', 0, 12, 0, 10, tz - 80, tz - 66));
  s.push(S('house', -20, -8, 0, 9, tz - 90, tz - 76));
  s.push(S('apt', -14, 14, 0, 40, tz - 140, tz - 120));
  return s;
}

export function makeTrees(cfg: LevelCfg): Tree[] {
  const rng = mulberry(777);
  const t: Tree[] = [];
  for (let row = 0; row < 2; row++) {
    for (let x = -33 + row * 3.2; x <= 34; x += 6.6) {
      t.push({ x: x + (rng() - 0.5) * 1.6, z: cfg.treeZ - row * 5.5 + (rng() - 0.5) * 1.6, r: 3.6 + rng() * 1.2, crownY: 7.4 + rng() * 1.2, crownH: 5 + rng() * 1.4 });
    }
  }
  // a few shade trees at the yard edges
  for (const [x, z] of [[-30, -4], [31, -12], [-31, -52], [30, -46]] as const) t.push({ x, z, r: 3.4, crownY: 7.6, crownH: 4 });
  return t;
}

export interface Wind { x: number; z: number } // m/s, direction the air moves toward

export interface ThrowEnv {
  wind: Wind;
  gustPhase: number;
  thermals: Thermal[];
  downs: Thermal[];
  balls: { x: number; y: number; z: number; vx: number; vy: number; vz: number; t0: number }[];
  pigeons: { x: number; y: number; z: number; vx: number; phase: number }[];
}

/** Roll the weather/obstacles for one throw. */
export function rollEnv(cfg: LevelCfg, rng: Rng): ThrowEnv {
  const sp = cfg.windMin + rng() * (cfg.windMax - cfg.windMin);
  // direction: 0 = tailwind (air moving away from thrower, i.e. -z), pi = headwind
  const dir = rng() * Math.PI * 2;
  const wind = cfg.windMax <= 0.6 ? { x: (rng() - 0.5) * sp, z: -(rng() - 0.3) * sp } : { x: Math.sin(dir) * sp, z: -Math.cos(dir) * sp };
  const thermals: Thermal[] = [];
  for (let i = 0; i < cfg.ups; i++) {
    const zz = -(22 + i * 22 + rng() * 14);
    thermals.push({ x: (rng() - 0.5) * 22, z: zz, r: 7 + rng() * 3, w: cfg.upW[0] + rng() * (cfg.upW[1] - cfg.upW[0]), top: 30 });
  }
  const downs: Thermal[] = [];
  for (let i = 0; i < cfg.downs; i++) downs.push({ x: (rng() - 0.5) * 18, z: -(16 + i * 24 + rng() * 14), r: 6 + rng() * 2, w: -(2.2 + rng() * 1.4), top: 24 });
  const balls = [];
  for (let i = 0; i < cfg.balls; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const spd = 7 + rng() * 5;
    balls.push({ x: side * 34, y: 0.6, z: -(18 + rng() * 40), vx: -side * spd, vy: 9 + rng() * 6, vz: (rng() - 0.5) * 2, t0: 3 + i * 4 + rng() * 3 });
  }
  const pigeons = [];
  for (let i = 0; i < cfg.pigeons; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    pigeons.push({ x: side * (28 + rng() * 6), y: 3 + rng() * 5, z: -(22 + rng() * 45), vx: -side * (3 + rng() * 2), phase: rng() * 6 });
  }
  return { wind, gustPhase: rng() * 100, thermals, downs, balls, pigeons };
}

/** score thresholds in cm (gold, silver, bronze), per level - calibrated from test flights */
export const MEDALS: [number, number, number][] = [
  [7800, 6000, 3800],
  [10500, 8000, 5500],
  [9000, 6500, 4000],
];
