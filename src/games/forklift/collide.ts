/** 2D (XZ plane) oriented boxes with a vertical extent. yaw follows three.js Y rotation:
 *  local +Z (forward) -> world (sin yaw, cos yaw), local +X -> world (cos yaw, -sin yaw). */
export interface OBB {
  x: number;
  z: number;
  hw: number; // half extent along local X
  hd: number; // half extent along local Z
  yaw: number;
}

export interface Collider {
  obb?: OBB;
  circle?: { x: number; z: number; r: number };
  yMin: number;
  yMax: number;
  vx?: number;
  vz?: number;
  kind: string;
  ref?: unknown;
}

export interface Hit {
  nx: number;
  nz: number;
  depth: number;
}

export const fwdOf = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];
export const rightOf = (yaw: number): [number, number] => [Math.cos(yaw), -Math.sin(yaw)];

function project(o: OBB, ax: number, az: number) {
  const c = o.x * ax + o.z * az;
  const [fx, fz] = fwdOf(o.yaw);
  const [rx, rz] = rightOf(o.yaw);
  const r = o.hw * Math.abs(rx * ax + rz * az) + o.hd * Math.abs(fx * ax + fz * az);
  return [c - r, c + r];
}

/** Minimum translation to push A out of B (normal points from B towards A). */
export function obbVsObb(a: OBB, b: OBB): Hit | null {
  const axes = [fwdOf(a.yaw), rightOf(a.yaw), fwdOf(b.yaw), rightOf(b.yaw)];
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  for (const [ax, az] of axes) {
    const [amin, amax] = project(a, ax, az);
    const [bmin, bmax] = project(b, ax, az);
    const o = Math.min(amax - bmin, bmax - amin);
    if (o <= 0) return null;
    if (o < best) {
      best = o;
      bx = ax;
      bz = az;
    }
  }
  if ((a.x - b.x) * bx + (a.z - b.z) * bz < 0) {
    bx = -bx;
    bz = -bz;
  }
  return { nx: bx, nz: bz, depth: best };
}

/** Push OBB A out of circle C. */
export function obbVsCircle(a: OBB, cx: number, cz: number, r: number): Hit | null {
  const dx = cx - a.x;
  const dz = cz - a.z;
  const [fx, fz] = fwdOf(a.yaw);
  const [rx, rz] = rightOf(a.yaw);
  const lx = dx * rx + dz * rz;
  const lz = dx * fx + dz * fz;
  const qx = Math.max(-a.hw, Math.min(a.hw, lx));
  const qz = Math.max(-a.hd, Math.min(a.hd, lz));
  const ex = lx - qx;
  const ez = lz - qz;
  const d2 = ex * ex + ez * ez;
  if (d2 > r * r) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    // normal from circle to box (local), convert to world
    const nlx = -ex / d;
    const nlz = -ez / d;
    return { nx: nlx * rx + nlz * fx, nz: nlx * rz + nlz * fz, depth: r - d };
  }
  // center inside the box: push along the smallest axis
  const px = a.hw - Math.abs(lx);
  const pz = a.hd - Math.abs(lz);
  if (px < pz) {
    const s = lx > 0 ? -1 : 1;
    return { nx: s * rx, nz: s * rz, depth: px + r };
  }
  const s = lz > 0 ? -1 : 1;
  return { nx: s * fx, nz: s * fz, depth: pz + r };
}

export function collide(a: OBB, c: Collider): Hit | null {
  if (c.obb) return obbVsObb(a, c.obb);
  if (c.circle) return obbVsCircle(a, c.circle.x, c.circle.z, c.circle.r);
  return null;
}

export function pointInObb(px: number, pz: number, o: OBB, margin = 0): boolean {
  const dx = px - o.x;
  const dz = pz - o.z;
  const [fx, fz] = fwdOf(o.yaw);
  const [rx, rz] = rightOf(o.yaw);
  return Math.abs(dx * rx + dz * rz) <= o.hw + margin && Math.abs(dx * fx + dz * fz) <= o.hd + margin;
}

export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Distance of angle a from the nearest multiple of 90 degrees. */
export const quarterDiff = (a: number) => {
  const q = Math.PI / 2;
  const m = ((a % q) + q) % q;
  return Math.min(m, q - m);
};
