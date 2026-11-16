/** Track definitions + geometry (pure). Math coords: x right, z' up (world z = -z'); heading h is CCW. */

export type SegKind = 'str' | 'arc' | 'lc' | 'rampUp' | 'gap' | 'rampDown' | 'wave' | 'hill';

export interface Seg {
  k: SegKind;
  len: number;
  R?: number; // arcs: signed radius, + = left
  ang?: number; // arcs: sweep (rad)
  grade?: number; // rad, + uphill
  flex?: 'a' | 'b';
  name?: string;
  brake?: boolean; // brake plates bite here
  amp?: number; // wave bump height (visual)
  waveBase?: number; // extra speed allowed on waves
  landBase?: number; // extra safe landing speed
  theta?: number; // launch angle for gap
  // computed
  s0: number;
  s1: number;
  x0: number;
  z0: number;
  h0: number;
  y0: number;
  idx: number;
  corner?: number; // 1-based corner number (arcs only)
}

export interface TrackDef {
  id: number;
  name: string;
  theme: 'shop' | 'roof' | 'hobby';
  laps: number;
  segs: Omit<Seg, 's0' | 's1' | 'x0' | 'z0' | 'h0' | 'y0' | 'idx'>[];
}

export const LANE_W = 1.0;
export const LANE_SEQ = [0, 1, 0, -1];
export const DS = 0.25;
export const G_FLIGHT = 14;

const D = Math.PI / 180;
const arc = (R: number, deg: number, name?: string) => ({ k: 'arc' as const, R, ang: deg * D, len: Math.abs(R) * deg * D, name });
const str = (len: number, extra: object = {}) => ({ k: 'str' as const, len, ...extra });

export const TRACKS: TrackDef[] = [
  {
    id: 1, name: '문방구 앞 오벌', theme: 'shop', laps: 3,
    segs: [
      str(7), { k: 'lc', len: 10, name: '차선 변경' }, str(9),
      arc(13, 180, '1번 코너'),
      str(26),
      arc(13, 180, '2번 코너'),
    ],
  },
  {
    id: 2, name: '옥상 테크니컬', theme: 'roof', laps: 3,
    segs: [
      str(0, { flex: 'a', name: '스타트 직선' }), { k: 'lc', len: 9, name: '차선 변경' }, str(4),
      arc(6.8, 180, '헤어핀'),
      str(4), { k: 'wave', len: 10, amp: 0.2, name: '웨이브 구간' }, str(4),
      { k: 'rampUp', len: 4.5, grade: 0.22, theta: 0.3, brake: true, name: '점프대' },
      { k: 'gap', len: 2.0, theta: 0.3, name: '점프대' },
      { k: 'rampDown', len: 4.5, grade: -0.22, brake: true, name: '착지 램프' },
      str(5),
      arc(4.6, 90, '3번 코너'),
      str(0, { flex: 'b' }),
      arc(4.6, 90, '4번 코너'),
    ],
  },
  {
    id: 3, name: '전국대회 결승', theme: 'hobby', laps: 3,
    segs: [
      str(0, { flex: 'a', name: '긴 직선' }), { k: 'lc', len: 9, name: '차선 변경' }, str(6),
      arc(6.2, 90, '1번 코너'),
      str(10), { k: 'rampUp', len: 5.0, grade: 0.24, theta: 0.34, brake: true, landBase: -0.5, name: '빅 점프' },
      { k: 'gap', len: 2.6, theta: 0.34, name: '빅 점프' },
      { k: 'rampDown', len: 5.0, grade: -0.24, brake: true, name: '착지 램프' }, str(4),
      arc(6.4, 90, '2번 코너'),
      str(4), { k: 'hill', len: 7, grade: 0.3, name: '오르막' }, str(3), { k: 'hill', len: 7, grade: -0.3, name: '내리막' }, str(3),
      arc(-4.6, 60, '3번 코너 (시케인)'), arc(4.6, 60, '4번 코너 (시케인)'),
      str(3),
      arc(6.4, 90, '5번 코너'),
      str(0, { flex: 'b' }),
      arc(6.4, 90, '6번 코너'),
    ],
  },
];

export interface Sample {
  x: number;
  z: number; // math z' (world z = -z)
  h: number;
  y: number;
  gr: number;
}

export interface Track {
  def: TrackDef;
  segs: Seg[];
  length: number;
  samples: Sample[];
  closure: { dx: number; dz: number; dy: number; flexA: number; flexB: number };
  lc: Seg | null;
  corners: number;
}

function lay(def: TrackDef, la: number, lb: number): { segs: Seg[]; end: { x: number; z: number; h: number; y: number } } {
  let s = 0, x = 0, z = 0, h = 0, y = 0, cn = 0;
  const segs: Seg[] = def.segs.map((d, idx) => {
    const seg: Seg = { ...d, s0: s, s1: s, x0: x, z0: z, h0: h, y0: y, idx } as Seg;
    if (d.flex === 'a') seg.len = la;
    if (d.flex === 'b') seg.len = lb;
    if (seg.k === 'arc') seg.corner = ++cn;
    seg.s1 = s + seg.len;
    const g = seg.grade ?? 0;
    if (seg.k === 'arc') {
      const R = seg.R!, a = seg.ang!, sg = Math.sign(R);
      // centre is at left normal (-sin h, cos h) * R
      const ccx = x - Math.sin(h) * R, ccz = z + Math.cos(h) * R;
      const h1 = h + sg * a;
      x = ccx + Math.sin(h1) * R;
      z = ccz - Math.cos(h1) * R;
      h = h1;
    } else if (seg.k === 'lc') {
      x += Math.cos(h) * seg.len;
      z += Math.sin(h) * seg.len;
    } else {
      x += Math.cos(h) * seg.len;
      z += Math.sin(h) * seg.len;
      if (seg.k !== 'gap') y += seg.len * Math.tan(g);
    }
    s += seg.len;
    return seg;
  });
  return { segs, end: { x, z, h, y } };
}

export function buildTrack(level: number): Track {
  const def = TRACKS[Math.max(0, Math.min(TRACKS.length - 1, level - 1))];
  let a = 0, b = 0;
  const flexA = def.segs.find((q) => q.flex === 'a');
  const flexB = def.segs.find((q) => q.flex === 'b');
  if (flexA || flexB) {
    // solve La, Lb so the loop closes
    const base = lay(def, 0, 0);
    const ia = base.segs.findIndex((q) => q.flex === 'a');
    const ib = base.segs.findIndex((q) => q.flex === 'b');
    const ha = base.segs[ia].h0, hb = base.segs[ib].h0;
    const rx = base.end.x, rz = base.end.z;
    // a*(cos ha, sin ha) + b*(cos hb, sin hb) = -(rx, rz) -- but later segments rotate nothing (translation only)
    const m11 = Math.cos(ha), m12 = Math.cos(hb), m21 = Math.sin(ha), m22 = Math.sin(hb);
    const det = m11 * m22 - m12 * m21;
    if (Math.abs(det) < 1e-6) throw new Error('flex segments parallel');
    a = (-rx * m22 + rz * m12) / det;
    b = (-m11 * rz + m21 * rx) / det;
  }
  const { segs, end } = lay(def, a, b);
  const length = segs[segs.length - 1].s1;
  const closure = { dx: end.x, dz: end.z, dy: end.y, flexA: a, flexB: b };

  // sample the centreline
  const n = Math.ceil(length / DS) + 1;
  const samples: Sample[] = [];
  let si = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(length, i * DS);
    while (si < segs.length - 1 && s > segs[si].s1) si++;
    samples.push(poseOn(segs[si], s));
  }
  const lc = segs.find((q) => q.k === 'lc') ?? null;
  return { def, segs, length, samples, closure, lc, corners: segs.filter((q) => q.k === 'arc').length };
}

function poseOn(seg: Seg, s: number): Sample {
  const u = Math.max(0, s - seg.s0);
  let x: number, z: number, h: number;
  if (seg.k === 'arc') {
    const R = seg.R!, sg = Math.sign(R);
    const ccx = seg.x0 - Math.sin(seg.h0) * R, ccz = seg.z0 + Math.cos(seg.h0) * R;
    const h1 = seg.h0 + sg * (u / Math.abs(R));
    x = ccx + Math.sin(h1) * R;
    z = ccz - Math.cos(h1) * R;
    h = h1;
  } else {
    x = seg.x0 + Math.cos(seg.h0) * u;
    z = seg.z0 + Math.sin(seg.h0) * u;
    h = seg.h0;
  }
  let y = seg.y0, gr = 0;
  if (seg.k !== 'gap' && seg.grade) {
    y += u * Math.tan(seg.grade);
    gr = seg.grade;
  }
  return { x, z, h, y, gr };
}

export function segAt(t: Track, sLap: number): Seg {
  const s = Math.max(0, Math.min(t.length - 1e-6, sLap));
  // segments are few; linear scan from a guess is fine
  let lo = 0, hi = t.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.segs[mid].s0 <= s) lo = mid;
    else hi = mid - 1;
  }
  return t.segs[lo];
}

export function poseAt(t: Track, sLap: number): Sample {
  return poseOn(segAt(t, sLap), Math.max(0, Math.min(t.length, sLap)));
}

/** lane offset (+ = left of travel) at lap-local distance for given 0-based lap index. */
export function laneOffset(t: Track, sLap: number, lap: number): number {
  const a = LANE_SEQ[Math.min(lap, LANE_SEQ.length - 2)] * LANE_W;
  const b = LANE_SEQ[Math.min(lap + 1, LANE_SEQ.length - 1)] * LANE_W;
  if (!t.lc) return a;
  if (sLap <= t.lc.s0) return a;
  if (sLap >= t.lc.s1) return b;
  const u = (sLap - t.lc.s0) / t.lc.len;
  return a + (b - a) * (1 - Math.cos(Math.PI * u)) * 0.5;
}

/** lateral curvature magnitude produced by the lane-change S-curve. */
export function lcCurvature(t: Track, sLap: number, lap: number): number {
  if (!t.lc || sLap < t.lc.s0 || sLap > t.lc.s1) return 0;
  const a = LANE_SEQ[Math.min(lap, LANE_SEQ.length - 2)] * LANE_W;
  const b = LANE_SEQ[Math.min(lap + 1, LANE_SEQ.length - 1)] * LANE_W;
  const u = (sLap - t.lc.s0) / t.lc.len;
  return Math.abs(((b - a) * 0.5 * (Math.PI / t.lc.len) ** 2) * Math.cos(Math.PI * u));
}

/** deck height incl. visual wave bumps (sLap = lap-local distance). */
export function deckY(t: Track, sLap: number): number {
  const p = { ...poseAt(t, sLap) };
  p.y += 0.14;
  const seg = segAt(t, sLap);
  if (seg.k === 'wave') {
    const u = (sLap - seg.s0) / seg.len;
    const n = Math.round(seg.len / 1.7);
    return p.y + (seg.amp ?? 0.2) * Math.max(0, Math.sin(Math.PI * 2 * n * u - Math.PI / 2) * 0.5 + 0.5) * Math.sin(Math.PI * u);
  }
  return p.y;
}
