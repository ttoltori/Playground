import * as THREE from 'three';
import { fwdOf, rightOf, type Collider, type OBB } from '../forklift/collide';
import { tex } from '../forklift/textures';
import { box } from '../forklift/world';
import type { LevelDef, MoverDef, Rect } from './levels';

export interface DCol extends Collider {
  clear?: number; // overhead obstacle: lowest underside (m above ground)
  label?: string;
  pen?: number; // seconds penalty on a hard hit
}

export interface Cone {
  x: number; z: number; mesh: THREE.Mesh; knocked: boolean; vx: number; vz: number; t: number;
}

export interface Mover {
  def: MoverDef;
  a: [number, number]; b: [number, number];
  x: number; z: number; yaw: number; vx: number; vz: number;
  phase: number; timer: number;
  mesh: THREE.Group;
  col: DCol;
  down: number; // >0: knocked down (worker)
  hw: number; hd: number;
}

export interface Hint { x: number; z: number; text: string; r: number }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

// ------------------------------------------------------------------ route
export interface Near { i: number; d: number; x: number; z: number; y: number; s: number; tx: number; tz: number; lat: number }

export class Route {
  n = 0;
  x: number[] = [];
  z: number[] = [];
  y: number[] = [];
  s: number[] = [];
  tx: number[] = [];
  tz: number[] = [];
  length = 0;

  constructor(ctrl: [number, number][], private elev: [number, number][]) {
    let pts = ctrl;
    for (let k = 0; k < 3; k++) pts = Route.chaikin(pts);
    // resample every 2 m
    const raw: [number, number][] = [pts[0]];
    let carry = 0;
    const step = 2;
    for (let i = 1; i < pts.length; i++) {
      let [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      let seg = Math.hypot(bx - ax, bz - az);
      while (carry + seg >= step) {
        const t = (step - carry) / seg;
        ax += (bx - ax) * t;
        az += (bz - az) * t;
        raw.push([ax, az]);
        seg = Math.hypot(bx - ax, bz - az);
        carry = 0;
      }
      carry += seg;
    }
    const last = pts[pts.length - 1];
    const lp = raw[raw.length - 1];
    if (Math.hypot(last[0] - lp[0], last[1] - lp[1]) > 0.5) raw.push(last);
    this.n = raw.length;
    let s = 0;
    for (let i = 0; i < this.n; i++) {
      if (i > 0) s += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
      this.x.push(raw[i][0]);
      this.z.push(raw[i][1]);
      this.s.push(s);
    }
    this.length = s;
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(this.n - 1, i + 1);
      const dx = this.x[b] - this.x[a];
      const dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx.push(dx / l);
      this.tz.push(dz / l);
      this.y.push(this.elevAt(this.s[i]));
    }
  }

  private static chaikin(p: [number, number][]): [number, number][] {
    const out: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    out.push(p[p.length - 1]);
    return out;
  }

  elevAt(s: number) {
    const f = clamp(s / this.length, 0, 1);
    const e = this.elev;
    if (f <= e[0][0]) return e[0][1];
    for (let i = 1; i < e.length; i++) {
      if (f <= e[i][0]) {
        const t = (f - e[i - 1][0]) / (e[i][0] - e[i - 1][0]);
        const k = (1 - Math.cos(t * Math.PI)) / 2;
        return e[i - 1][1] + (e[i][1] - e[i - 1][1]) * k;
      }
    }
    return e[e.length - 1][1];
  }

  /** nearest point on the polyline. */
  nearest(px: number, pz: number, out: Near = { i: 0, d: 0, x: 0, z: 0, y: 0, s: 0, tx: 0, tz: 1, lat: 0 }): Near {
    let best = Infinity;
    for (let i = 0; i < this.n - 1; i++) {
      const ax = this.x[i];
      const az = this.z[i];
      const dx = this.x[i + 1] - ax;
      const dz = this.z[i + 1] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
      t = clamp(t, 0, 1);
      const qx = ax + dx * t;
      const qz = az + dz * t;
      const d2 = (px - qx) ** 2 + (pz - qz) ** 2;
      if (d2 < best) {
        best = d2;
        out.i = i;
        out.x = qx;
        out.z = qz;
        out.s = this.s[i] + (this.s[i + 1] - this.s[i]) * t;
        out.y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
        out.tx = this.tx[i];
        out.tz = this.tz[i];
      }
    }
    out.d = Math.sqrt(best);
    out.lat = (px - out.x) * out.tz - (pz - out.z) * out.tx;
    return out;
  }

  at(s: number) {
    s = clamp(s, 0, this.length);
    let i = 0;
    while (i < this.n - 2 && this.s[i + 1] < s) i++;
    const t = (s - this.s[i]) / Math.max(1e-6, this.s[i + 1] - this.s[i]);
    const tx = this.tx[i] + (this.tx[i + 1] - this.tx[i]) * t;
    const tz = this.tz[i] + (this.tz[i + 1] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz) || 1;
    return {
      x: this.x[i] + (this.x[i + 1] - this.x[i]) * t,
      z: this.z[i] + (this.z[i + 1] - this.z[i]) * t,
      y: this.y[i] + (this.y[i + 1] - this.y[i]) * t,
      tx: tx / l, tz: tz / l,
    };
  }
  atF(f: number) {
    return this.at(f * this.length);
  }
}

// ------------------------------------------------------------------ world
export const CELL = 3;

export class World {
  readonly group = new THREE.Group();
  readonly route: Route;
  readonly statics: DCol[] = [];
  readonly cones: Cone[] = [];
  readonly movers: Mover[] = [];
  readonly hints: Hint[] = [];
  readonly bounds = { x0: 0, x1: 0, z0: 0, z1: 0 };
  // bay frame
  readonly bayM: [number, number];
  readonly bayU: [number, number];
  readonly bayL: [number, number];
  readonly bayC: [number, number];
  readonly bayObb: OBB;
  // gantry
  readonly chute: [number, number];
  weighZone: OBB | null = null;
  mudS: [number, number][] = [];
  gate: { bar: THREE.Mesh; col: DCol; broken: boolean; fall: number }[] = [];
  lamp: THREE.Mesh | null = null;
  pile: THREE.Mesh;
  pileT = 0; // seconds since the pile started to disappear
  pileSize = 0;
  private H!: Float32Array;
  private gx0 = 0;
  private gz0 = 0;
  private gnx = 0;
  private gnz = 0;
  private bumpsAt: { x: number; z: number; tx: number; tz: number }[] = [];
  private holes: { x: number; z: number }[] = [];
  private nearTmp: Near = { i: 0, d: 0, x: 0, z: 0, y: 0, s: 0, tx: 0, tz: 1, lat: 0 };
  private rng: () => number;
  private lampMats = { red: new THREE.MeshBasicMaterial({ color: 0xff3b3b }), amber: new THREE.MeshBasicMaterial({ color: 0xffb020 }), green: new THREE.MeshBasicMaterial({ color: 0x3bff6b }) };
  private std: Record<string, THREE.MeshStandardMaterial> = {};
  private dusk: boolean;

  constructor(readonly level: LevelDef, quality: 'high' | 'low') {
    this.rng = mulberry(1234 + level.loads);
    this.dusk = level.look === 'dusk';
    this.route = new Route(level.route, level.elev);
    const b = level.bay;
    this.bayM = [b.x, b.z];
    this.bayU = [Math.sin(b.yaw), Math.cos(b.yaw)];
    this.bayL = [Math.cos(b.yaw), -Math.sin(b.yaw)];
    this.bayC = [b.x - this.bayU[0] * b.d / 2, b.z - this.bayU[1] * b.d / 2];
    this.bayObb = { x: this.bayC[0], z: this.bayC[1], hw: b.w / 2, hd: b.d / 2, yaw: b.yaw };
    this.chute = [level.gantry.x, level.gantry.z];
    this.mudS = level.mud.map(([a, c]) => [a * this.route.length, c * this.route.length]);

    this.computeBounds();
    this.buildGrid();
    this.buildTerrain();
    this.buildRoad();
    this.buildFeatures();
    this.buildGantry();
    this.buildBay();
    this.buildWeigh();
    this.buildBarriers();
    this.buildMovers();
    this.buildDecor(quality);

    const pg = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: 0x7a6048, roughness: 1, flatShading: true }));
    pg.visible = false;
    pg.castShadow = true;
    this.pile = pg;
    this.group.add(pg);
  }

  // ---- materials
  private mat(key: string, color: number, opts: THREE.MeshStandardMaterialParameters = {}) {
    if (!this.std[key]) this.std[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...opts });
    return this.std[key];
  }

  // ---- terrain ------------------------------------------------------------
  private computeBounds() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const grow = (x: number, z: number) => {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    };
    for (const r of [this.level.loadYard, this.level.dumpYard]) {
      grow(r.x - r.hw, r.z - r.hd);
      grow(r.x + r.hw, r.z + r.hd);
    }
    for (let i = 0; i < this.route.n; i++) grow(this.route.x[i], this.route.z[i]);
    const m = 26;
    this.bounds.x0 = x0 - m; this.bounds.x1 = x1 + m; this.bounds.z0 = z0 - m; this.bounds.z1 = z1 + m;
  }

  private rawHeight(px: number, pz: number): number {
    const L = this.level;
    const near = this.route.nearest(px, pz, this.nearTmp);
    const edge = L.roadW / 2 + 1.2;
    let h: number;
    if (near.d <= edge) h = near.y;
    else {
      const e = near.d - edge;
      if (L.cliff) {
        const dot = (px - near.x) * L.cliff[0] + (pz - near.z) * L.cliff[1];
        h = dot >= 0 ? near.y - Math.min(14, e * 1.15) : near.y + Math.min(9, e * 0.75);
      } else {
        h = near.y * (1 - smooth(e / L.bankW));
      }
    }
    const flat = (r: Rect, y: number) => {
      const o = Math.max(0, Math.abs(px - r.x) - r.hw, Math.abs(pz - r.z) - r.hd);
      const w = 1 - smooth(o / 7);
      h += (y - h) * w;
    };
    flat(L.loadYard, this.route.y[0]);
    flat(L.dumpYard, this.route.y[this.route.n - 1]);
    // side slope across the bay
    const dx = px - this.bayC[0];
    const dz = pz - this.bayC[1];
    const lat = dx * this.bayL[0] + dz * this.bayL[1];
    const lon = dx * this.bayU[0] + dz * this.bayU[1];
    const b = L.bay;
    if (b.cross) {
      const ex = Math.max(0, Math.abs(lat) - (b.w / 2 + 3));
      const ey = Math.max(0, lon - (b.d / 2 + 14), -b.d / 2 - 3 - lon);
      h += b.cross * lat * (1 - smooth(Math.hypot(ex, ey) / 4));
    }
    return h;
  }

  private buildGrid() {
    const { x0, x1, z0, z1 } = this.bounds;
    this.gx0 = x0;
    this.gz0 = z0;
    this.gnx = Math.ceil((x1 - x0) / CELL) + 1;
    this.gnz = Math.ceil((z1 - z0) / CELL) + 1;
    this.H = new Float32Array(this.gnx * this.gnz);
    for (let j = 0; j < this.gnz; j++) for (let i = 0; i < this.gnx; i++) this.H[j * this.gnx + i] = this.rawHeight(x0 + i * CELL, z0 + j * CELL);
  }

  /** smooth terrain only (no bumps / potholes) */
  terrainAt(x: number, z: number): number {
    let fx = (x - this.gx0) / CELL;
    let fz = (z - this.gz0) / CELL;
    fx = clamp(fx, 0, this.gnx - 1.001);
    fz = clamp(fz, 0, this.gnz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const H = this.H;
    const n = this.gnx;
    const h00 = H[j * n + i];
    const h10 = H[j * n + i + 1];
    const h01 = H[(j + 1) * n + i];
    const h11 = H[(j + 1) * n + i + 1];
    return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
  }

  /** speed bumps (+) and potholes (-) */
  featureAt(x: number, z: number): number {
    let h = 0;
    for (const b of this.bumpsAt) {
      const dx = x - b.x;
      const dz = z - b.z;
      if (Math.abs(dx) > 5.5 || Math.abs(dz) > 5.5) continue;
      const u = dx * b.tx + dz * b.tz;
      const v = dx * b.tz - dz * b.tx;
      if (Math.abs(u) < 0.9 && Math.abs(v) < this.level.roadW / 2) {
        const c = Math.cos((Math.PI * u) / 1.8);
        h += 0.15 * c * c;
      }
    }
    for (const p of this.holes) {
      const r2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (r2 < 6) h -= 0.17 * Math.exp(-r2 / 0.8);
    }
    return h;
  }

  groundAt(x: number, z: number) {
    return this.terrainAt(x, z) + this.featureAt(x, z);
  }

  mudAt(x: number, z: number): boolean {
    if (!this.mudS.length) return false;
    const n = this.route.nearest(x, z, this.nearTmp);
    if (n.d > this.level.roadW / 2 + 1) return false;
    return this.mudS.some(([a, b]) => n.s >= a && n.s <= b);
  }

  private buildTerrain() {
    const nx = this.gnx;
    const nz = this.gnz;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const base = new THREE.Color(this.level.soil);
    const yardCol = new THREE.Color(this.level.soil).lerp(new THREE.Color(0xbdb4a2), 0.55);
    const rock = new THREE.Color(0x6d6458);
    const tmp = new THREE.Color();
    const r = this.level;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = this.gx0 + i * CELL;
        const z = this.gz0 + j * CELL;
        const h = this.H[k];
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        const hx = this.H[j * nx + Math.min(nx - 1, i + 1)] - this.H[j * nx + Math.max(0, i - 1)];
        const hz = this.H[Math.min(nz - 1, j + 1) * nx + i] - this.H[Math.max(0, j - 1) * nx + i];
        const slope = Math.hypot(hx, hz) / (2 * CELL);
        const n = 0.88 + 0.24 * (Math.sin(x * 0.37 + z * 0.21) * 0.5 + Math.sin(x * 0.11 - z * 0.53) * 0.5 + 1) * 0.5;
        tmp.copy(base).lerp(rock, clamp(slope * 1.1, 0, 0.8)).multiplyScalar(n);
        // yards are lighter gravel
        for (const y of [r.loadYard, r.dumpYard]) {
          const o = Math.max(0, Math.abs(x - y.x) - y.hw, Math.abs(z - y.z) - y.hd);
          const w = 1 - smooth(o / 4);
          if (w > 0) tmp.lerp(yardCol, w * 0.85);
        }
        col[k * 3] = tmp.r;
        col[k * 3 + 1] = tmp.g;
        col[k * 3 + 2] = tmp.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ---- road ---------------------------------------------------------------
  private strip(off: number, width: number, mat: THREE.Material, lift: number, vcol?: (s: number) => THREE.Color, vrep = 6) {
    const R = this.route;
    const pos: number[] = [];
    const uv: number[] = [];
    const cols: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < R.n; i++) {
      const lx = R.tz[i];
      const lz = -R.tx[i];
      for (const side of [-1, 1]) {
        const o = off + side * width / 2;
        const x = R.x[i] + lx * o;
        const z = R.z[i] + lz * o;
        pos.push(x, this.terrainAt(x, z) + lift, z);
        uv.push(side < 0 ? 0 : 1, R.s[i] / vrep);
        if (vcol) {
          const c = vcol(R.s[i]);
          cols.push(c.r, c.g, c.b);
        }
      }
      if (i < R.n - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (vcol) g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private buildRoad() {
    const L = this.level;
    const gravel = canvasTexture(128, 128, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) {
        const v = 170 + Math.random() * 85;
        g.fillStyle = `rgba(${v},${v},${v},0.5)`;
        g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 2, 2);
      }
    }, [1, 1]);
    const mudC = new THREE.Color(0x4b3b2d);
    const white = new THREE.Color(1, 1, 1);
    const tmp = new THREE.Color();
    const mudAmt = (s: number) => {
      let a = 0;
      for (const [s0, s1] of this.mudS) a = Math.max(a, smooth((s - s0 + 3) / 3) * (1 - smooth((s - s1) / 3)));
      return a;
    };
    const road = this.strip(0, L.roadW, new THREE.MeshStandardMaterial({ map: gravel, color: L.roadCol, roughness: 1, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0.07, (s) => tmp.copy(white).lerp(mudC, mudAmt(s) * 0.85).clone());
    road.name = 'road';
    const edgeMat = new THREE.MeshBasicMaterial({ color: this.dusk ? 0xb8a98a : 0xeadfc2, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const sd of [-1, 1]) this.strip(sd * (L.roadW / 2 - 0.45), 0.22, edgeMat, 0.09);
  }

  // ---- decals -------------------------------------------------------------
  private decal(cx: number, cz: number, yaw: number, hw: number, hd: number, map: THREE.Texture, opts: { lift?: number; segs?: number; color?: number } = {}) {
    const segs = opts.segs ?? 8;
    const g = new THREE.PlaneGeometry(hw * 2, hd * 2, segs, segs);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    const [fx, fz] = fwdOf(yaw);
    const [rx, rz] = rightOf(yaw);
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i);
      const lz = p.getZ(i);
      // local +Z = forward, local +X = right; the texture's top edge (v=1) faces local -Z -> flip
      const x = cx + rx * lx + fx * lz;
      const z = cz + rz * lx + fz * lz;
      p.setXYZ(i, x, this.terrainAt(x, z) + (opts.lift ?? 0.1), z);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, color: opts.color ?? (this.dusk ? 0xc8b8a8 : 0xffffff) }));
    this.group.add(m);
    return m;
  }

  // ---- features: bumps, potholes, gate, rack ------------------------------
  private addBox(cx: number, cz: number, yaw: number, hw: number, hd: number, h: number, mat: THREE.Material, kind: string, pen = 2, label = '', y0 = 0): THREE.Mesh {
    const y = this.terrainAt(cx, cz);
    const m = box(hw * 2, h, hd * 2, mat, cx, y + y0 + h / 2, cz);
    m.rotation.y = yaw;
    this.group.add(m);
    this.statics.push({ obb: { x: cx, z: cz, hw, hd, yaw }, yMin: 0, yMax: h, kind, pen, label });
    return m;
  }

  private buildFeatures() {
    const L = this.level;
    const R = this.route;
    const hazard = new THREE.MeshStandardMaterial({ map: tex.hazard(), roughness: 0.8 });
    // speed bumps
    const bumpGeo = new THREE.CylinderGeometry(0.9, 0.9, L.roadW, 12, 1, false, 0, Math.PI);
    bumpGeo.rotateZ(Math.PI / 2); // axis along X, half faces +Y
    bumpGeo.rotateX(0);
    bumpGeo.scale(1, 0.17, 1);
    const bumpMat = new THREE.MeshStandardMaterial({ color: 0xe4b50f, roughness: 0.7 });
    for (const f of L.bumps) {
      const p = R.atF(f);
      this.bumpsAt.push({ x: p.x, z: p.z, tx: p.tx, tz: p.tz });
      const m = new THREE.Mesh(bumpGeo, bumpMat);
      m.position.set(p.x, this.terrainAt(p.x, p.z) + 0.02, p.z);
      m.rotation.y = Math.atan2(p.tx, p.tz); // local +Z along the road; the bump axis (X) spans the road
      m.castShadow = false;
      this.group.add(m);
      this.hints.push({ x: p.x, z: p.z, text: '⚠ 과속방지턱 — 감속! (흙이 튀어요)', r: 26 });
    }
    // potholes
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x241c14, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    for (const h of L.potholes) {
      const p = R.atF(h.f);
      const x = p.x + p.tz * h.lat;
      const z = p.z - p.tx * h.lat;
      this.holes.push({ x, z });
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.0, 14), holeMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, this.terrainAt(x, z) + 0.1, z);
      this.group.add(m);
    }
    if (L.potholes.length) {
      const p = R.atF(L.potholes[0].f);
      this.hints.push({ x: p.x, z: p.z, text: '⚠ 패인 구간 — 구덩이를 피해서!', r: 26 });
    }
    // mud
    for (const [a, c] of L.mud) {
      const p = R.atF(a);
      this.hints.push({ x: p.x, z: p.z, text: '⚠ 진흙길! 미끄러워요 — 급핸들 금지', r: 26 });
      void c;
    }
    // gate with height bar
    if (L.gate) {
      const g = L.gate;
      const p = R.atF(g.f);
      const yaw = Math.atan2(p.tx, p.tz);
      const concrete = this.mat('concrete', 0xb2b0a6);
      const off = g.gap / 2 + 0.65;
      for (const sd of [-1, 1]) {
        const x = p.x + p.tz * off * sd;
        const z = p.z - p.tx * off * sd;
        const pil = this.addBox(x, z, yaw, 0.65, 0.65, 5.6, concrete, 'pillar', 4, '기둥');
        const stripe = box(1.34, 1.6, 1.34, hazard, 0, -2.0, 0);
        pil.add(stripe);
        // cones at the mouth
        this.addCone(p.x + p.tz * (g.gap / 2 - 0.35) * sd - p.tx * 3.2, p.z - p.tx * (g.gap / 2 - 0.35) * sd - p.tz * 3.2);
      }
      const barW = g.gap + 2.6;
      const bar = box(barW, 0.4, 0.5, hazard, 0, 0, 0);
      const grp = new THREE.Group();
      grp.position.set(p.x, this.terrainAt(p.x, p.z) + g.clear + 0.2, p.z);
      grp.rotation.y = yaw;
      grp.add(bar);
      this.group.add(grp);
      const col: DCol = { obb: { x: p.x, z: p.z, hw: barW / 2, hd: 0.45, yaw }, yMin: g.clear, yMax: g.clear + 0.4, kind: 'bar', clear: g.clear + this.terrainAt(p.x, p.z), label: '높이제한 바', pen: 10 };
      this.gate.push({ bar: grp as unknown as THREE.Mesh, col, broken: false, fall: 0 });
      // sign
      this.sign(p.x + p.tz * (L.roadW / 2 + 1.4) , p.z - p.tx * (L.roadW / 2 + 1.4) , yaw, `높이 ${g.clear.toFixed(1)}m`, '#d8141c', 5);
      this.hints.push({ x: p.x - p.tx * 18, z: p.z - p.tz * 18, text: `⚠ 좁은 게이트 + 높이제한 ${g.clear.toFixed(1)}m — 침대 내리고!`, r: 22 });
    }
    // overhead conveyor rack
    if (L.rack) {
      const k = L.rack;
      const p = R.atF(k.f);
      const yaw = Math.atan2(p.tx, p.tz);
      const steel = this.mat('steel', 0x4a6b8a, { metalness: 0.4 });
      const off = L.roadW / 2 + 1.1;
      const y0 = this.terrainAt(p.x, p.z);
      for (const sd of [-1, 1]) {
        const x = p.x + p.tz * off * sd;
        const z = p.z - p.tx * off * sd;
        this.addBox(x, z, yaw, 0.5, 0.5, k.clear + 0.6, steel, 'pillar', 4, '지지대');
      }
      const span = box(L.roadW + 3.6, 1.1, 1.8, steel, 0, 0, 0);
      const grp = new THREE.Group();
      grp.position.set(p.x, y0 + k.clear + 0.55, p.z);
      grp.rotation.y = yaw;
      grp.add(span);
      const belt = box(L.roadW + 3.6, 0.2, 1.1, this.mat('belt', 0x222222), 0, 0.65, 0);
      grp.add(belt);
      this.group.add(grp);
      const col: DCol = { obb: { x: p.x, z: p.z, hw: (L.roadW + 3.6) / 2, hd: 0.9, yaw }, yMin: k.clear, yMax: k.clear + 1.2, kind: 'bar', clear: k.clear + y0, label: '컨베이어 구조물', pen: 10 };
      this.gate.push({ bar: grp as unknown as THREE.Mesh, col, broken: false, fall: 0 });
      this.sign(p.x + p.tz * (L.roadW / 2 + 2.6), p.z - p.tx * (L.roadW / 2 + 2.6), yaw, `높이 ${k.clear.toFixed(1)}m`, '#d8141c', 5);
      this.hints.push({ x: p.x - p.tx * 18, z: p.z - p.tz * 18, text: `⚠ 컨베이어 아래 높이제한 ${k.clear.toFixed(1)}m — 침대 내리고!`, r: 22 });
    }
  }

  sign(x: number, z: number, yaw: number, text: string, bg: string, h: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.65, 0.08), new THREE.MeshBasicMaterial({ map: tex.sign(text, bg) }));
    m.position.set(x, this.terrainAt(x, z) + h, z);
    m.rotation.y = yaw + Math.PI;
    const post = box(0.12, h, 0.12, this.mat('post', 0x555555), x, this.terrainAt(x, z) + h / 2, z);
    this.group.add(m, post);
  }

  // ---- cones --------------------------------------------------------------
  private coneGeo = new THREE.CylinderGeometry(0.05, 0.3, 0.72, 8);
  private coneMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7 });
  addCone(x: number, z: number) {
    const m = new THREE.Mesh(this.coneGeo, this.coneMat);
    m.position.set(x, this.terrainAt(x, z) + 0.36, z);
    m.castShadow = true;
    this.group.add(m);
    this.cones.push({ x, z, mesh: m, knocked: false, vx: 0, vz: 0, t: 0 });
  }

  knockCone(c: Cone, vx: number, vz: number) {
    c.knocked = true;
    c.vx = vx;
    c.vz = vz;
    c.t = 0;
  }

  // ---- gantry hopper ------------------------------------------------------
  private buildGantry() {
    const L = this.level;
    const gnt = L.gantry;
    const g = new THREE.Group();
    const y0 = this.terrainAt(gnt.x, gnt.z);
    g.position.set(gnt.x, y0, gnt.z);
    g.rotation.y = gnt.yaw;
    const steel = this.mat('hopper', 0x5b94cf, { metalness: 0.3 });
    const dark = this.mat('hopperDark', 0x2a2f36, { metalness: 0.4 });
    const hazard = new THREE.MeshStandardMaterial({ map: tex.hazard(), roughness: 0.8 });
    const [rx, rz] = rightOf(gnt.yaw);
    for (const sd of [-1, 1]) {
      g.add(box(1.3, 7.4, 1.3, steel, sd * 5.0, 3.7, 0));
      g.add(box(1.36, 1.2, 1.36, hazard, sd * 5.0, 0.6, 0));
      this.statics.push({ obb: { x: gnt.x + rx * 5.0 * sd, z: gnt.z + rz * 5.0 * sd, hw: 0.65, hd: 0.65, yaw: gnt.yaw }, yMin: 0, yMax: 7.4, kind: 'pillar', pen: 4, label: '호퍼 기둥' });
    }
    g.add(box(11.6, 1.4, 6, steel, 0, 8.1, 0));
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 0.8, 2.2, 4), steel);
    funnel.rotation.y = Math.PI / 4;
    funnel.position.set(0, 6.3, 0);
    funnel.castShadow = true;
    g.add(funnel);
    g.add(box(1.4, 1.2, 1.4, dark, 0, 5.2, 0));
    g.add(box(12.2, 0.3, 6.4, hazard, 0, 9.0, 0));
    // traffic lamp
    const lampPost = box(0.2, 3.4, 0.2, dark, 5.2, 1.7, -2.6);
    g.add(lampPost);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), this.lampMats.red);
    lamp.position.set(5.2, 3.6, -2.6);
    g.add(lamp);
    this.lamp = lamp;
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.1, 0.12), new THREE.MeshBasicMaterial({ map: tex.sign('⛰ 상차장 · 여기 정차', '#12703a') }));
    board.position.set(0, 9.9, -3.1);
    g.add(board);
    const board2 = board.clone();
    board2.position.z = 3.1;
    board2.rotation.y = Math.PI;
    g.add(board2);
    this.group.add(g);
    // loading zone marking
    const zoneTex = canvasTexture(256, 256, (c) => {
      c.clearRect(0, 0, 256, 256);
      c.fillStyle = 'rgba(46,230,107,0.16)';
      c.fillRect(0, 0, 256, 256);
      c.strokeStyle = '#2ee66b';
      c.lineWidth = 12;
      c.setLineDash([36, 20]);
      c.strokeRect(8, 8, 240, 240);
      c.setLineDash([]);
      c.fillStyle = '#2ee66b';
      c.font = 'bold 54px sans-serif';
      c.textAlign = 'center';
      c.fillText('STOP', 128, 138);
    });
    this.decal(gnt.x, gnt.z, gnt.yaw, 2.8, 4.6, zoneTex);
    // a parked wheel loader for flavour
    this.parkedLoader(gnt.x + 13, gnt.z - 3, -0.6);
    this.stockPile(gnt.x - 15, gnt.z + 10, 4.5);
    this.stockPile(gnt.x + 16, gnt.z + 12, 3.2);
    this.sign(gnt.x - 6.5, gnt.z - 18, 0, '상차장 ▶', '#12703a', 3.2);
    this.hints.push({ x: gnt.x, z: gnt.z, text: '🟢 호퍼 아래에 정차 + 침대 내림 → 상차 시작', r: 18 });
  }

  private parkedLoader(x: number, z: number, yaw: number) {
    const g = new THREE.Group();
    const y = this.terrainAt(x, z);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    const body = this.mat('loaderY', 0xf2b705);
    g.add(box(2.4, 1.2, 4.4, body, 0, 1.3, 0));
    g.add(box(2.0, 1.6, 1.8, body, 0, 2.6, -0.6));
    g.add(box(1.8, 0.5, 0.2, this.mat('glass', 0x223344), 0, 2.9, 0.34));
    g.add(box(3.0, 0.9, 1.4, this.mat('bucket', 0x333333), 0, 0.7, 3.2));
    const wm = this.mat('tyre', 0x1a1a1a);
    for (const sx of [-1, 1]) for (const sz of [-1.5, 1.5]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.7, 10), wm);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 1.35, 0.9, sz);
      w.castShadow = true;
      g.add(w);
    }
    this.group.add(g);
    this.statics.push({ obb: { x, z, hw: 1.6, hd: 3.4, yaw }, yMin: 0, yMax: 3, kind: 'prop', pen: 2, label: '휠로더' });
  }

  private stockPile(x: number, z: number, r: number) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, r * 0.7, 7), this.mat('pileMat', 0x7d6a52, { flatShading: true }));
    m.position.set(x, this.terrainAt(x, z) + r * 0.3, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ---- dump bay -----------------------------------------------------------
  private buildBay() {
    const L = this.level;
    const b = L.bay;
    const [cx, cz] = this.bayC;
    const [ux, uz] = this.bayU;
    const [lx, lz] = this.bayL;
    const concrete = this.mat('concrete', 0xb2b0a6);
    const hazard = new THREE.MeshStandardMaterial({ map: tex.hazard(), roughness: 0.8 });
    const T = 0.9;
    // side walls
    for (const sd of [-1, 1]) {
      const x = cx + lx * (b.w / 2 + T / 2) * sd;
      const z = cz + lz * (b.w / 2 + T / 2) * sd;
      const m = this.addBox(x, z, b.yaw, T / 2, b.d / 2, 1.5, concrete, 'wall', 3, '벽');
      m.add(box(T + 0.02, 0.25, b.d + 0.02, hazard, 0, 0.7, 0));
    }
    // back wall
    {
      const x = cx - ux * (b.d / 2 + T / 2);
      const z = cz - uz * (b.d / 2 + T / 2);
      const m = this.addBox(x, z, b.yaw, b.w / 2 + T, T / 2, 1.9, concrete, 'wall', 3, '뒷벽');
      m.add(box(b.w + 2 * T + 0.02, 0.3, T + 0.02, hazard, 0, 0.8, 0));
    }
    // floor markings
    const W = b.w;
    const D = b.d;
    const mark = canvasTexture(256, 512, (c) => {
      c.clearRect(0, 0, 256, 512);
      c.fillStyle = 'rgba(255,200,40,0.10)';
      c.fillRect(0, 0, 256, 512);
      c.strokeStyle = '#ffd23a';
      c.lineWidth = 10;
      c.strokeRect(5, 5, 246, 502);
      c.setLineDash([34, 22]);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(128, 20);
      c.lineTo(128, 500);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#ff4b3a';
      c.fillRect(20, 20, 216, 14);
      c.fillStyle = '#ffd23a';
      c.font = 'bold 52px sans-serif';
      c.textAlign = 'center';
      c.fillText('DUMP', 128, 100);
      c.font = 'bold 44px sans-serif';
      c.fillText('▲ ▲ ▲', 128, 440);
    });
    // texture top edge faces local -Z (back of the bay); decal forward (+Z local) = out of the bay
    this.decal(cx, cz, b.yaw, W / 2, D / 2, mark, { segs: 10 });
    // guide lane extension outward
    const lane = canvasTexture(128, 512, (c) => {
      c.clearRect(0, 0, 128, 512);
      c.strokeStyle = '#ffffffcc';
      c.lineWidth = 6;
      c.setLineDash([30, 30]);
      c.beginPath();
      c.moveTo(64, 0);
      c.lineTo(64, 512);
      c.stroke();
    });
    this.decal(cx + ux * (D / 2 + 12), cz + uz * (D / 2 + 12), b.yaw, 0.5, 12, lane, { segs: 8 });
    // mouth flags + cones
    const poleMat = this.mat('pole', 0xf2f2f2);
    const flagMat = this.mat('flag', 0xff4b1a);
    for (const sd of [-1, 1]) {
      const x = b.x + lx * (b.w / 2 + T / 2) * sd;
      const z = b.z + lz * (b.w / 2 + T / 2) * sd;
      const y = this.terrainAt(x, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), poleMat);
      pole.position.set(x + ux * 0.3, y + 1.7, z + uz * 0.3);
      const flag = box(0.7, 0.45, 0.04, flagMat, 0, 1.4, 0);
      pole.add(flag);
      this.group.add(pole);
      this.addCone(b.x + lx * (b.w / 2 - 0.45) * sd + ux * 0.9, b.z + lz * (b.w / 2 - 0.45) * sd + uz * 0.9);
    }
    this.sign(b.x + lx * (b.w / 2 + 3.2), b.z + lz * (b.w / 2 + 3.2), b.yaw, '덤프장 ◀ 후진!', '#b3260c', 3.4);
    this.hints.push({ x: b.x + ux * 14, z: b.z + uz * 14, text: '↩ 덤프 베이 — 후진(S/아래)으로 뒷문부터 진입!', r: 30 });
  }

  // ---- weighbridge --------------------------------------------------------
  private buildWeigh() {
    const L = this.level;
    if (L.weigh === undefined) return;
    const p = this.route.atF(L.weigh);
    const yaw = Math.atan2(p.tx, p.tz);
    const plate = canvasTexture(128, 256, (c) => {
      c.fillStyle = '#5d6872';
      c.fillRect(0, 0, 128, 256);
      c.strokeStyle = '#3a424a';
      c.lineWidth = 3;
      for (let y = 0; y < 256; y += 16) {
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(128, y);
        c.stroke();
      }
      c.fillStyle = '#ffd23a';
      c.fillRect(6, 0, 6, 256);
      c.fillRect(116, 0, 6, 256);
      c.fillStyle = '#fff';
      c.font = 'bold 28px sans-serif';
      c.textAlign = 'center';
      c.fillText('계량대', 64, 130);
    });
    this.decal(p.x, p.z, yaw, L.roadW / 2 - 0.5, 5, plate, { lift: 0.14 });
    this.weighZone = { x: p.x, z: p.z, hw: L.roadW / 2, hd: 5, yaw };
    const off = L.roadW / 2 + 2.5;
    const x = p.x + p.tz * off;
    const z = p.z - p.tx * off;
    this.addBox(x, z, yaw, 1.4, 2.0, 2.6, this.mat('cabin', 0xe8e4da), 'prop', 2, '계량 사무소');
    this.sign(p.x - p.tz * (L.roadW / 2 + 1.2) - p.tx * 7, p.z + p.tx * (L.roadW / 2 + 1.2) - p.tz * 7, yaw, '⚖ 계량 — 정차!', '#c2810a', 3.4);
    this.hints.push({ x: p.x - p.tx * 14, z: p.z - p.tz * 14, text: '⚖ 계량대 — 올라가서 잠깐 정차!', r: 20 });
  }

  // ---- barriers (instanced) -----------------------------------------------
  private buildBarriers() {
    const L = this.level;
    const R = this.route;
    const items: { x: number; z: number; yaw: number }[] = [];
    if (L.cliff) {
      const off = L.roadW / 2 + 0.55;
      for (let i = 0; i < R.n; i += 2) {
        const lx = R.tz[i];
        const lz = -R.tx[i];
        const d = lx * L.cliff[0] + lz * L.cliff[1];
        const yaw = Math.atan2(R.tx[i], R.tz[i]);
        const sides = Math.abs(d) < 0.3 ? [-1, 1] : [Math.sign(d)];
        for (const sd of sides) {
          const x = R.x[i] + lx * off * sd;
          const z = R.z[i] + lz * off * sd;
          // skip where the barrier would block the yard entrances
          if (this.insideRect(this.level.loadYard, x, z, 4) || this.insideRect(this.level.dumpYard, x, z, 4)) continue;
          items.push({ x, z, yaw });
        }
      }
    }
    if (L.edgeBarriers) {
      const r = L.dumpYard;
      const gapAt = [R.x[R.n - 1], R.z[R.n - 1]];
      const perim: [number, number][] = [];
      for (let t = -r.hw; t <= r.hw; t += 4) { perim.push([r.x + t, r.z - r.hd + 0.6], [r.x + t, r.z + r.hd - 0.6]); }
      for (let t = -r.hd; t <= r.hd; t += 4) { perim.push([r.x - r.hw + 0.6, r.z + t], [r.x + r.hw - 0.6, r.z + t]); }
      for (const [x, z] of perim) {
        if (Math.hypot(x - gapAt[0], z - gapAt[1]) < 9) continue;
        const dxb = x - this.bayC[0];
        const dzb = z - this.bayC[1];
        if (Math.hypot(dxb, dzb) < 11) continue;
        const horiz = Math.abs(z - r.z) > r.hd - 1;
        items.push({ x, z, yaw: horiz ? Math.PI / 2 : 0 });
      }
    }
    if (!items.length) return;
    const geo = new THREE.BoxGeometry(0.8, 0.95, 4.1);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xbdbbb0, roughness: 0.9 }), items.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach((it, i) => {
      q.setFromEuler(new THREE.Euler(0, it.yaw, 0));
      m4.compose(new THREE.Vector3(it.x, this.terrainAt(it.x, it.z) + 0.47, it.z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m4);
      this.statics.push({ obb: { x: it.x, z: it.z, hw: 0.4, hd: 2.05, yaw: it.yaw }, yMin: 0, yMax: 0.95, kind: 'barrier', pen: 2, label: '방호벽' });
    });
    im.castShadow = true;
    im.receiveShadow = true;
    this.group.add(im);
  }

  private insideRect(r: Rect, x: number, z: number, m = 0) {
    return Math.abs(x - r.x) < r.hw + m && Math.abs(z - r.z) < r.hd + m;
  }

  // ---- movers -------------------------------------------------------------
  private buildMovers() {
    const R = this.route;
    for (const d of this.level.movers) {
      let a: [number, number];
      let b: [number, number];
      if (d.space === 'route') {
        const p = R.atF(d.f ?? 0.5);
        const pt = (lat: number): [number, number] => [p.x + p.tz * lat, p.z - p.tx * lat];
        a = pt(d.p0[0]);
        b = pt(d.p1[0]);
      } else {
        const pt = (lat: number, out: number): [number, number] => [this.bayM[0] + this.bayL[0] * lat + this.bayU[0] * out, this.bayM[1] + this.bayL[1] * lat + this.bayU[1] * out];
        a = pt(d.p0[0], d.p0[1]);
        b = pt(d.p1[0], d.p1[1]);
      }
      const g = new THREE.Group();
      let hw: number;
      let hd: number;
      if (d.kind === 'vehicle') {
        hw = 1.0; hd = 2.4;
        g.add(box(2.0, 0.9, 4.8, this.mat('pickup', 0xe8e8e8), 0, 1.0, 0));
        g.add(box(1.9, 0.8, 1.9, this.mat('pickupCab', 0xe8e8e8), 0, 1.8, 0.7));
        g.add(box(1.85, 0.5, 0.06, this.mat('glass', 0x223344), 0, 1.9, 1.67));
        g.add(box(2.02, 0.35, 4.82, this.mat('pickupStripe', 0xff7a00), 0, 0.7, 0));
        const lampMat = new THREE.MeshBasicMaterial({ color: 0xffa500 });
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.3), lampMat));
        (g.children[g.children.length - 1] as THREE.Mesh).position.set(0, 2.35, 0.7);
        const wm = this.mat('tyre', 0x1a1a1a);
        for (const sx of [-1, 1]) for (const sz of [-1.5, 1.5]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10), wm);
          w.rotation.z = Math.PI / 2;
          w.position.set(sx * 1.0, 0.45, sz);
          g.add(w);
        }
      } else {
        hw = 0.35; hd = 0.35;
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.0, 8), this.mat('vest', 0xff7a00)));
        g.children[0].position.y = 0.95;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), this.mat('skin', 0xe6b38a));
        head.position.y = 1.62;
        const hat = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), this.mat('hat', 0xffd400));
        hat.position.y = 1.68;
        const legs = box(0.46, 0.5, 0.3, this.mat('pants', 0x2c3a52), 0, 0.25, 0);
        g.add(head, hat, legs);
      }
      g.traverse((o) => { o.castShadow = true; });
      this.group.add(g);
      const col: DCol = { obb: { x: a[0], z: a[1], hw, hd, yaw: 0 }, yMin: 0, yMax: d.kind === 'vehicle' ? 2.3 : 1.8, kind: d.kind === 'vehicle' ? 'vehicle' : 'worker', pen: d.kind === 'vehicle' ? 5 : 10, label: d.kind === 'vehicle' ? '현장 차량' : '작업자' };
      this.movers.push({ def: d, a, b, x: a[0], z: a[1], yaw: 0, vx: 0, vz: 0, phase: 0, timer: d.pause * 0.5, mesh: g, col, down: 0, hw, hd });
    }
  }

  // ---- decor --------------------------------------------------------------
  private buildDecor(quality: 'high' | 'low') {
    const L = this.level;
    const rnd = this.rng;
    const nRocks = quality === 'high' ? 90 : 50;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: this.dusk ? 0x7a6a5a : 0x8c8173, roughness: 1, flatShading: true }), nRocks);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let k = 0;
    let guard = 0;
    while (k < nRocks && guard++ < 2000) {
      const x = this.bounds.x0 + rnd() * (this.bounds.x1 - this.bounds.x0);
      const z = this.bounds.z0 + rnd() * (this.bounds.z1 - this.bounds.z0);
      const n = this.route.nearest(x, z, this.nearTmp);
      if (n.d < L.roadW / 2 + 6) continue;
      if (this.insideRect(L.loadYard, x, z, 6) || this.insideRect(L.dumpYard, x, z, 6)) continue;
      const s = 0.5 + rnd() * 1.8;
      q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
      m4.compose(new THREE.Vector3(x, this.terrainAt(x, z) + s * 0.3, z), q, new THREE.Vector3(s, s * 0.7, s));
      im.setMatrixAt(k++, m4);
    }
    im.count = k;
    im.castShadow = true;
    this.group.add(im);
    // far hills
    const hm = new THREE.MeshStandardMaterial({ color: this.dusk ? 0x5a4a50 : 0xa39682, roughness: 1, flatShading: true, fog: true });
    const cx = (this.bounds.x0 + this.bounds.x1) / 2;
    const cz = (this.bounds.z0 + this.bounds.z1) / 2;
    const R = Math.max(this.bounds.x1 - this.bounds.x0, this.bounds.z1 - this.bounds.z0) * 0.5 + 150;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
      const h = 16 + rnd() * 24;
      const m = new THREE.Mesh(new THREE.ConeGeometry(40 + rnd() * 30, h, 6), hm);
      m.position.set(cx + Math.cos(a) * R, h / 2 - 12, cz + Math.sin(a) * R);
      this.group.add(m);
    }
    // site props near the dump yard + light poles
    const y = L.dumpYard;
    this.addBox(y.x - y.hw + 6, y.z + y.hd - 7, 0, 3.0, 1.3, 2.7, new THREE.MeshStandardMaterial({ map: tex.container('#2b6cb0'), roughness: 0.7 }), 'prop', 2, '컨테이너');
    this.addBox(y.x - y.hw + 6, y.z + y.hd - 11, 0, 3.0, 1.3, 2.7, new THREE.MeshStandardMaterial({ map: tex.container('#b04a2b'), roughness: 0.7 }), 'prop', 2, '컨테이너');
    const bulbMat = new THREE.MeshBasicMaterial({ color: this.dusk ? 0xffd9a0 : 0xdddddd });
    const poles: [number, number][] = [[L.loadYard.x - 19, L.loadYard.z + 14], [L.loadYard.x + 19, L.loadYard.z + 14], [y.x - 18, y.z - 16], [y.x + 22, y.z - 16]];
    for (const [px, pz] of poles) {
      const yy = this.terrainAt(px, pz);
      const pole = box(0.25, 9, 0.25, this.mat('post', 0x555555), px, yy + 4.5, pz);
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.5), bulbMat);
      bulb.position.set(px, yy + 9.1, pz);
      this.group.add(pole, bulb);
    }
  }

  // ---- gantry lamp --------------------------------------------------------
  setLamp(state: 'red' | 'amber' | 'green') {
    if (this.lamp) this.lamp.material = this.lampMats[state];
  }

  // ---- dynamic ------------------------------------------------------------
  update(dt: number, t: number) {
    for (const m of this.movers) {
      const d = m.def;
      if (m.down > 0) {
        m.down -= dt;
        m.mesh.rotation.z = Math.min(Math.PI / 2, m.mesh.rotation.z + dt * 6);
        m.vx = 0;
        m.vz = 0;
        if (m.down <= 0) m.mesh.rotation.z = 0;
        m.col.obb = { x: m.x, z: m.z, hw: 0, hd: 0, yaw: 0 };
        continue;
      }
      const target = m.phase === 1 ? m.b : m.a;
      if (m.phase === 0 || m.phase === 2) {
        m.timer -= dt;
        m.vx = 0;
        m.vz = 0;
        if (m.timer <= 0) m.phase = m.phase === 0 ? 1 : 3;
      } else {
        const tgt = m.phase === 1 ? m.b : m.a;
        const dx = tgt[0] - m.x;
        const dz = tgt[1] - m.z;
        const l = Math.hypot(dx, dz);
        if (l < 0.15) {
          m.phase = m.phase === 1 ? 2 : 0;
          m.timer = d.pause;
          m.vx = 0;
          m.vz = 0;
        } else {
          m.vx = (dx / l) * d.speed;
          m.vz = (dz / l) * d.speed;
          m.x += m.vx * dt;
          m.z += m.vz * dt;
          m.yaw = Math.atan2(dx, dz);
        }
      }
      void target;
      void t;
      m.mesh.position.set(m.x, this.terrainAt(m.x, m.z), m.z);
      m.mesh.rotation.y = m.yaw;
      m.col.obb = { x: m.x, z: m.z, hw: m.hw, hd: m.hd, yaw: m.yaw };
      m.col.vx = m.vx;
      m.col.vz = m.vz;
    }
    for (const c of this.cones) {
      if (!c.knocked) continue;
      c.t += dt;
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.vx *= Math.exp(-2.2 * dt);
      c.vz *= Math.exp(-2.2 * dt);
      const f = Math.min(1, c.t * 4);
      c.mesh.position.set(c.x, this.terrainAt(c.x, c.z) + 0.3 - 0.1 * f, c.z);
      c.mesh.rotation.set(0, 0, Math.PI / 2 * f);
      c.mesh.rotation.y = Math.atan2(c.vx, c.vz);
    }
    for (const g of this.gate) {
      if (g.broken && g.fall < 1) {
        g.fall = Math.min(1, g.fall + dt * 2);
        g.bar.rotation.z = g.fall * 0.5;
        g.bar.position.y -= dt * 2.2 * (1 - g.fall);
      }
    }
    if (this.pile.visible && this.pileT > 0) {
      this.pileT += dt;
      const k = Math.max(0, 1 - (this.pileT - 3) / 3);
      this.pile.scale.setScalar(Math.max(0.001, k));
      if (k <= 0) {
        this.pile.visible = false;
        this.pileT = 0;
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of list) {
        const mm = x as THREE.MeshBasicMaterial;
        if (mm.map && !(mm.map as THREE.Texture & { userData: { shared?: boolean } }).userData.shared) mm.map.dispose();
        x.dispose();
      }
    });
  }
}
