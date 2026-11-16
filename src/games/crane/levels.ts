/** Level data + load catalogue for the tower crane game. World units are meters, mast at (0,0). */
export const JIB_Y = 34; // height of the jib centreline
export const R_MIN = 3.5;
export const R_MAX = 38;

export interface LoadKind {
  name: string;
  emoji: string;
  mass: number; // tonnes
  w: number; // along load x (before yaw)
  h: number;
  d: number;
  fragile: boolean;
  sail: number; // wind exposure
}

export const KINDS = {
  rebar: { name: '철근 다발', emoji: '🔩', mass: 1.5, w: 3.0, h: 0.5, d: 0.6, fragile: false, sail: 0.8 },
  bucket: { name: '콘크리트 버킷', emoji: '🪣', mass: 1.8, w: 1.3, h: 1.3, d: 1.3, fragile: false, sail: 0.8 },
  toilet: { name: '간이화장실', emoji: '🚽', mass: 0.6, w: 1.1, h: 2.3, d: 1.1, fragile: false, sail: 1.6 },
  bricks: { name: '벽돌 팔레트', emoji: '🧱', mass: 2.5, w: 1.5, h: 1.1, d: 1.2, fragile: false, sail: 0.7 },
  glass: { name: '유리 패널', emoji: '🪟', mass: 1.0, w: 2.4, h: 3.0, d: 0.25, fragile: true, sail: 1.8 },
  generator: { name: '대형 발전기', emoji: '⚡', mass: 6.0, w: 2.4, h: 1.8, d: 1.3, fragile: false, sail: 0.5 },
  beam: { name: 'H빔 묶음', emoji: '🏗️', mass: 5.0, w: 4.6, h: 0.8, d: 0.8, fragile: false, sail: 0.5 },
} satisfies Record<string, LoadKind>;
export type KindId = keyof typeof KINDS;

/** rated capacity (tonnes) at trolley radius r – like a real load chart */
export const capAt = (r: number) => (r <= 12 ? 8 : Math.max(1.0, 8 - 0.25 * (r - 12)));

export interface BlockSpec { x: number; z: number; w: number; d: number; h: number; kind: 'building' | 'prop'; color?: number }
export interface PadSpec { x: number; z: number; y: number }
export interface LoadSpec { kind: KindId; x: number; z: number; yaw: number; pad: number }
export interface WorkerSpec { path: [number, number][]; speed: number }
export interface Crane2Spec { x: number; z: number; mastH: number; jibLen: number; backLen: number }

export interface LevelDef {
  tol: number; // pad radius (m) the load centre must be within
  pickR: number; // hook-to-lifting-point tolerance (m)
  damp: number; // cable swing damping 1/s
  wind: { base: number; gust: number; period: number };
  dusk: boolean;
  blocks: BlockSpec[];
  pads: PadSpec[];
  loads: LoadSpec[];
  workers: WorkerSpec[];
  crane2?: Crane2Spec;
  r0: number;
}

const container = (x: number, z: number, h = 2.6, w = 6, d = 2.4, color = 0xc4521c): BlockSpec => ({ x, z, w, d, h, kind: 'prop', color });

export const LEVELS: LevelDef[] = [
  // ---------------------------------------------------------------- LV1
  {
    tol: 1.6, pickR: 1.1, damp: 0.22, wind: { base: 0, gust: 0, period: 10 }, dusk: false, r0: 14,
    blocks: [
      { x: 24, z: 14, w: 16, d: 14, h: 5, kind: 'building' },
      { x: 28, z: 16, w: 8, d: 8, h: 10, kind: 'building' },
    ],
    pads: [{ x: 19.5, z: 10, y: 5 }, { x: 20, z: 18, y: 5 }, { x: 28, z: 16, y: 10 }],
    loads: [
      { kind: 'bricks', x: -18, z: 8, yaw: 0.1, pad: 1 },
      { kind: 'rebar', x: -6, z: 20, yaw: 0.3, pad: 0 },
      { kind: 'bucket', x: -14, z: -14, yaw: 0, pad: 2 },
    ],
    workers: [],
  },
  // ---------------------------------------------------------------- LV2
  {
    tol: 1.25, pickR: 0.95, damp: 0.14, wind: { base: 1.8, gust: 2.5, period: 9 }, dusk: false, r0: 16,
    blocks: [
      { x: -14, z: -14, w: 14, d: 14, h: 9, kind: 'building' },
      { x: -18.5, z: -18.5, w: 5, d: 5, h: 15, kind: 'building' },
      { x: -3, z: -12, w: 4, d: 4, h: 12, kind: 'building' },
      container(30, -4), container(30, -7.2), container(30, -5.6, 5.2),
    ],
    pads: [
      { x: -13.5, z: -13.5, y: 9 }, // 0 heavy
      { x: -9.5, z: -17.5, y: 9 },
      { x: -18.5, z: -18.5, y: 15 },
      { x: -18, z: -10, y: 9 },
      { x: -3, z: -12, y: 12 },
    ],
    loads: [
      { kind: 'bucket', x: 24, z: 8, yaw: 0, pad: 4 },
      { kind: 'rebar', x: 14, z: 18, yaw: 0.5, pad: 1 },
      { kind: 'toilet', x: 22, z: -6, yaw: 0.4, pad: 2 },
      { kind: 'bricks', x: 8, z: 24, yaw: 0, pad: 3 },
      { kind: 'generator', x: 12, z: -2, yaw: 0.3, pad: 0 },
    ],
    workers: [
      { path: [[10, 12], [18, 24]], speed: 1.3 },
      { path: [[4, 10], [16, 4]], speed: 1.1 },
      { path: [[22, -12], [8, -16]], speed: 1.4 },
    ],
  },
  // ---------------------------------------------------------------- LV3
  {
    tol: 0.95, pickR: 0.85, damp: 0.1, wind: { base: 3.2, gust: 5.5, period: 6 }, dusk: true, r0: 18,
    blocks: [
      { x: 22, z: -24, w: 14, d: 12, h: 10, kind: 'building' },
      { x: 19, z: -26, w: 6, d: 6, h: 18, kind: 'building' },
      { x: 26, z: -20, w: 4, d: 4, h: 14, kind: 'building' },
      { x: 10, z: -16, w: 7, d: 7, h: 7, kind: 'building' },
      container(-20, 22), container(-20, 25), container(-20, 23.5, 5.2),
    ],
    pads: [
      { x: 17.5, z: -20, y: 10 }, // 0 glass
      { x: 19, z: -26, y: 18 }, // 1 bricks
      { x: 26, z: -20, y: 14 }, // 2 toilet
      { x: 22.5, z: -20.5, y: 10 }, // 3 bucket
      { x: 10, z: -16, y: 7 }, // 4 beam (heavy)
      { x: 25, z: -24.5, y: 10 }, // 5 rebar
    ],
    loads: [
      { kind: 'bucket', x: 6, z: 28, yaw: 0, pad: 3 },
      { kind: 'rebar', x: -24, z: -12, yaw: 0.2, pad: 5 },
      { kind: 'toilet', x: -8, z: 26, yaw: 0.3, pad: 2 },
      { kind: 'glass', x: -12, z: 16, yaw: 0.6, pad: 0 },
      { kind: 'bricks', x: -22, z: 6, yaw: 0, pad: 1 },
      { kind: 'beam', x: -14, z: -4, yaw: 0, pad: 4 },
    ],
    workers: [
      { path: [[-6, 14], [-16, 20]], speed: 1.2 },
      { path: [[-20, 0], [-10, -8]], speed: 1.3 },
    ],
    crane2: { x: -3, z: -27, mastH: 24, jibLen: 15, backLen: 6 },
  },
];

/** sanity check used by tests: returns a list of problems (empty = ok) */
export function validateLevel(lv: LevelDef): string[] {
  const out: string[] = [];
  lv.loads.forEach((l, i) => {
    const k = KINDS[l.kind];
    const rs = Math.hypot(l.x, l.z);
    const p = lv.pads[l.pad];
    const rp = Math.hypot(p.x, p.z);
    if (k.mass > capAt(rs)) out.push(`load ${i} staging overloaded r=${rs.toFixed(1)}`);
    if (k.mass > capAt(rp) * 0.995) out.push(`load ${i} pad overloaded r=${rp.toFixed(1)} cap=${capAt(rp).toFixed(2)}`);
    if (rp > R_MAX - 2 || rs > R_MAX - 2 || rs < R_MIN + 4) out.push(`load ${i} out of reach`);
    for (const b of lv.blocks) {
      if (Math.abs(l.x - b.x) < b.w / 2 + 2.5 && Math.abs(l.z - b.z) < b.d / 2 + 2.5) out.push(`load ${i} overlaps block`);
    }
  });
  const used = new Set(lv.loads.map((l) => l.pad));
  if (used.size !== lv.loads.length) out.push('pads not unique');
  lv.pads.forEach((p, i) => {
    const under = lv.blocks.filter((b) => b.kind === 'building' && Math.abs(p.x - b.x) <= b.w / 2 - lv.tol && Math.abs(p.z - b.z) <= b.d / 2 - lv.tol && Math.abs(b.h - p.y) < 1e-6);
    if (under.length === 0) out.push(`pad ${i} not on a block top`);
    for (const b of lv.blocks) {
      if (b.h > p.y && Math.abs(p.x - b.x) < b.w / 2 + lv.tol + 0.3 && Math.abs(p.z - b.z) < b.d / 2 + lv.tol + 0.3 && b.kind === 'building') out.push(`pad ${i} blocked by higher block`);
    }
  });
  return out;
}
