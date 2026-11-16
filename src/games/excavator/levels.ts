export interface Box3 { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }

export interface PropCfg {
  kind: 'container' | 'cabin' | 'barrel' | 'cone' | 'lamp' | 'pipes';
  x: number; z: number; w: number; d: number; h: number; color?: number;
}

export interface LevelCfg {
  size: { x0: number; x1: number; z0: number; z1: number };
  start: { x: number; z: number; yaw: number };
  piles: { x: number; z: number; R: number; H: number; v: number }[];
  /** trucks come one after another; quota = sum of capacities (m3) */
  trucks: { x: number; z: number; yaw: number; cap: number }[];
  gas: { x: number; z: number; r: number }[];
  props: PropCfg[];
  workers: { a: [number, number]; b: [number, number]; speed: number }[];
  night: boolean;
  rain: boolean;
  sky: number;
  fog: number;
}

const ORANGE = 0xd9741a;
const BLUE = 0x2c5f9e;
const GREEN = 0x3f7a4a;

export const LEVELS: LevelCfg[] = [
  {
    size: { x0: -26, x1: 26, z0: -22, z1: 22 },
    start: { x: 0, z: -3, yaw: 0 },
    piles: [{ x: -4, z: 9, R: 3.4, H: 2.3, v: 11 }],
    trucks: [{ x: 4.8, z: 6, yaw: 0, cap: 6 }],
    gas: [],
    props: [
      { kind: 'container', x: -18, z: -8, w: 6.1, d: 2.5, h: 2.6, color: ORANGE },
      { kind: 'container', x: -18, z: -4.6, w: 6.1, d: 2.5, h: 2.6, color: BLUE },
      { kind: 'cabin', x: 19, z: -15, w: 6, d: 3, h: 2.8 },
      { kind: 'barrel', x: 5, z: -14, w: 0.7, d: 0.7, h: 1 },
      { kind: 'barrel', x: 6, z: -14.8, w: 0.7, d: 0.7, h: 1 },
      { kind: 'cone', x: -9, z: 2, w: 0.5, d: 0.5, h: 0.7 },
      { kind: 'cone', x: -9, z: 5, w: 0.5, d: 0.5, h: 0.7 },
      { kind: 'lamp', x: 22, z: 17, w: 0.5, d: 0.5, h: 7 },
      { kind: 'lamp', x: -22, z: 17, w: 0.5, d: 0.5, h: 7 },
    ],
    workers: [],
    night: false, rain: false, sky: 0x9fc9e8, fog: 0xb9d6ea,
  },
  {
    size: { x0: -34, x1: 34, z0: -24, z1: 26 },
    start: { x: 0, z: -10, yaw: 0 },
    piles: [
      { x: -19, z: 2, R: 3.2, H: 2.2, v: 9 },
      { x: 19, z: 4, R: 3.2, H: 2.2, v: 9 },
    ],
    trucks: [{ x: 0, z: 15, yaw: Math.PI / 2, cap: 10 }],
    gas: [
      { x: -14.5, z: 5.5, r: 2.4 },
      { x: 14.5, z: 1.2, r: 2.6 },
      { x: 4, z: -2, r: 2.2 },
    ],
    props: [
      { kind: 'container', x: -27, z: -14, w: 6.1, d: 2.5, h: 2.6, color: GREEN },
      { kind: 'container', x: 27, z: -16, w: 2.5, d: 6.1, h: 2.6, color: ORANGE },
      { kind: 'cabin', x: -4, z: -20, w: 6, d: 3, h: 2.8 },
      { kind: 'pipes', x: 12, z: -18, w: 6, d: 1.6, h: 1.2 },
      { kind: 'barrel', x: -9, z: -6, w: 0.7, d: 0.7, h: 1 },
      { kind: 'barrel', x: -9.8, z: -6.6, w: 0.7, d: 0.7, h: 1 },
      { kind: 'cone', x: 9, z: 9, w: 0.5, d: 0.5, h: 0.7 },
      { kind: 'cone', x: -9, z: 9, w: 0.5, d: 0.5, h: 0.7 },
      { kind: 'lamp', x: 30, z: 22, w: 0.5, d: 0.5, h: 7 },
      { kind: 'lamp', x: -30, z: 22, w: 0.5, d: 0.5, h: 7 },
    ],
    workers: [],
    night: false, rain: false, sky: 0xf0b98a, fog: 0xf2cfae,
  },
  {
    size: { x0: -34, x1: 34, z0: -26, z1: 28 },
    start: { x: 0, z: -14, yaw: 0 },
    piles: [
      { x: -17, z: -4, R: 3.2, H: 2.2, v: 11 },
      { x: -3, z: 15, R: 3.2, H: 2.2, v: 11 },
    ],
    trucks: [
      { x: 14, z: 6, yaw: 0, cap: 8 },
      { x: 14, z: 6, yaw: 0, cap: 8 },
    ],
    gas: [{ x: -11, z: 6, r: 2.6 }],
    props: [
      { kind: 'container', x: -28, z: -18, w: 6.1, d: 2.5, h: 2.6, color: BLUE },
      { kind: 'cabin', x: 26, z: -18, w: 6, d: 3, h: 2.8 },
      { kind: 'barrel', x: 6, z: -8, w: 0.7, d: 0.7, h: 1 },
      { kind: 'barrel', x: 7, z: -8.8, w: 0.7, d: 0.7, h: 1 },
      { kind: 'cone', x: -6, z: 4, w: 0.5, d: 0.5, h: 0.7 },
      { kind: 'cone', x: 4, z: 18, w: 0.5, d: 0.5, h: 0.7 },
      { kind: 'lamp', x: 30, z: 24, w: 0.5, d: 0.5, h: 7 },
      { kind: 'lamp', x: -30, z: 24, w: 0.5, d: 0.5, h: 7 },
      { kind: 'lamp', x: 8, z: 24, w: 0.5, d: 0.5, h: 7 },
    ],
    workers: [
      { a: [-8, -8], b: [8, -8], speed: 1.5 },
      { a: [-2, 3], b: [-14, 10], speed: 1.3 },
      { a: [4, 8], b: [4, 22], speed: 1.4 },
    ],
    night: true, rain: true, sky: 0x0b1224, fog: 0x0b1224,
  },
];
