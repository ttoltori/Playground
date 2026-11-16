export const CAP_T = 25; // payload per full load (tons)

export interface Rect {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface BayDef {
  x: number; // mouth centre
  z: number;
  yaw: number; // direction a parked truck's nose points (= out of the bay)
  w: number; // interior width
  d: number; // interior depth
  cross: number; // side slope across the bay (m/m)
}

export interface MoverDef {
  kind: 'vehicle' | 'worker';
  space: 'route' | 'bay';
  f?: number; // route fraction (space = route)
  p0: [number, number]; // route: [lateral, 0]; bay: [lateral, out]
  p1: [number, number];
  speed: number;
  pause: number;
}

export interface LevelDef {
  loads: number;
  targetFrac: number;
  roadW: number;
  route: [number, number][];
  elev: [number, number][]; // [route fraction, height]
  loadYard: Rect;
  dumpYard: Rect;
  gantry: { x: number; z: number; yaw: number };
  spawn: { x: number; z: number; yaw: number };
  bay: BayDef;
  bumps: number[]; // route fractions
  potholes: { f: number; lat: number }[];
  gate?: { f: number; gap: number; clear: number };
  rack?: { f: number; clear: number };
  mud: [number, number][]; // route fraction ranges
  weigh?: number; // route fraction
  movers: MoverDef[];
  cliff?: [number, number]; // unit vector pointing downhill (quarry edge)
  bankW: number;
  edgeBarriers: boolean;
  look: 'day' | 'dusk';
  soil: number;
  roadCol: number;
}

const yard22 = { x: 0, z: 0, hw: 22, hd: 22 };

export const LEVELS: LevelDef[] = [
  {
    loads: 2, targetFrac: 0.92, roadW: 9,
    route: [[0, 22], [0, 52], [24, 84], [60, 96], [82, 96]],
    elev: [[0, 0], [1, 0]],
    loadYard: yard22, dumpYard: { x: 110, z: 96, hw: 28, hd: 26 },
    gantry: { x: 0, z: 6, yaw: 0 }, spawn: { x: 0, z: -14, yaw: 0 },
    bay: { x: 112, z: 112, yaw: Math.PI, w: 7.8, d: 9.5, cross: 0 },
    bumps: [0.4], potholes: [], mud: [], movers: [],
    bankW: 10, edgeBarriers: false, look: 'day', soil: 0xb9a070, roadCol: 0x857862,
  },
  {
    loads: 3, targetFrac: 0.92, roadW: 8,
    route: [[0, 22], [0, 64], [10, 104], [40, 134], [84, 144], [128, 140], [158, 152], [166, 190], [165, 218]],
    elev: [[0, 0], [0.14, 0.4], [0.36, 6.2], [0.46, 6.8], [0.72, 0.9], [1, 0.7]],
    loadYard: yard22, dumpYard: { x: 165, z: 244, hw: 30, hd: 26 },
    gantry: { x: 0, z: 6, yaw: 0 }, spawn: { x: 0, z: -14, yaw: 0 },
    bay: { x: 184, z: 246, yaw: (3 * Math.PI) / 2, w: 5.9, d: 9.5, cross: 0.03 },
    bumps: [0.17, 0.19, 0.5, 0.62],
    potholes: [{ f: 0.58, lat: -1.8 }, { f: 0.595, lat: 1.6 }, { f: 0.66, lat: 0 }],
    gate: { f: 0.84, gap: 5.9, clear: 4.6 },
    mud: [],
    movers: [
      { kind: 'vehicle', space: 'route', f: 0.28, p0: [-11, 0], p1: [11, 0], speed: 4.6, pause: 3.4 },
      { kind: 'worker', space: 'bay', p0: [-6.8, 6], p1: [-6.8, 14], speed: 1.3, pause: 1.2 },
    ],
    bankW: 14, edgeBarriers: false, look: 'day', soil: 0xa88a5e, roadCol: 0x7a6d5c,
  },
  {
    loads: 4, targetFrac: 0.92, roadW: 7.2,
    route: [[0, 22], [0, 96], [3, 108], [14, 114], [25, 108], [28, 96], [28, 48], [31, 36], [42, 30], [53, 36], [56, 48], [56, 138], [56, 152]],
    elev: [[0, 0], [0.12, 0], [0.3, 5.5], [0.36, 6], [0.55, 11.5], [0.62, 12], [0.9, 16], [1, 16]],
    loadYard: yard22, dumpYard: { x: 56, z: 180, hw: 34, hd: 28 },
    gantry: { x: 0, z: 6, yaw: 0 }, spawn: { x: 0, z: -14, yaw: 0 },
    bay: { x: 76, z: 176, yaw: (3 * Math.PI) / 2 + 0.44, w: 4.9, d: 9.5, cross: 0.12 },
    bumps: [0.48, 0.82],
    potholes: [{ f: 0.26, lat: 1.2 }, { f: 0.275, lat: -1.4 }, { f: 0.7, lat: 0.6 }],
    rack: { f: 0.7, clear: 5.0 },
    mud: [[0.4, 0.46], [0.76, 0.81]],
    weigh: 0.18,
    movers: [{ kind: 'worker', space: 'bay', p0: [-7, 7], p1: [-7, 15], speed: 1.3, pause: 1.2 }],
    cliff: [-1, 0],
    bankW: 14, edgeBarriers: true, look: 'dusk', soil: 0x8f7d6c, roadCol: 0x6f665c,
  },
];
