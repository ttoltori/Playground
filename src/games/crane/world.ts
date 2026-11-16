import * as THREE from 'three';
import { JIB_Y, KINDS, type BlockSpec, type Crane2Spec, type KindId, type LevelDef } from './levels';
import { T, labelTexture } from './textures';

export interface Solid { minx: number; maxx: number; miny: number; maxy: number; minz: number; maxz: number }

export const PAD_COLORS = [0xff5a5a, 0x4fc3ff, 0xffd24a, 0x6dff7a, 0xd98cff, 0xff9a3c];
export const cssHex = (c: number) => '#' + c.toString(16).padStart(6, '0');

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...o });

export function bx(w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
export function strut(a: THREE.Vector3, b: THREE.Vector3, t: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, len, t), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export function loadHalf(kind: KindId, yaw: number) {
  const k = KINDS[kind];
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return V((c * k.w + s * k.d) / 2, k.h / 2, (s * k.w + c * k.d) / 2);
}

// ------------------------------------------------------------------ crane
export interface CraneRig {
  group: THREE.Group;
  slew: THREE.Group;
  trolley: THREE.Group;
}

export function buildCrane(accent: number, o: { mastH: number; jibY: number; jibLen: number; backLen: number; cab: boolean }, shadows: boolean): CraneRig {
  const group = new THREE.Group();
  const paint = std(accent, { roughness: 0.55 });
  const steel = std(0x555b63, { roughness: 0.6, metalness: 0.4 });
  const dark = std(0x23262b);
  const lat = (rx: number, ry: number) => new THREE.MeshStandardMaterial({ color: accent, map: T.lattice(rx, ry), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  const mh = o.mastH;
  // mast
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(bx(0.3, mh, 0.3, paint, sx, mh / 2, sz, shadows));
  const faces: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]];
  for (const [fx, fz, ry] of faces) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2, mh), lat(1, mh / 2));
    p.position.set(fx, mh / 2, fz);
    p.rotation.y = ry;
    group.add(p);
  }
  group.add(bx(5, 0.9, 5, std(0x777771), 0, 0.45, 0, shadows));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(bx(1.2, 1.1, 1.2, std(0x8a8a84), sx * 1.8, 1.4, sz * 1.8, shadows));

  const slew = new THREE.Group();
  slew.position.y = o.jibY;
  group.add(slew);
  slew.add(bx(2.6, 0.9, 2.6, dark, 0, -1.1, 0, shadows));
  // jib
  const jl = o.jibLen;
  for (const z of [-0.7, 0.7]) slew.add(bx(jl, 0.22, 0.22, paint, jl / 2, -0.9, z, shadows));
  slew.add(bx(jl, 0.25, 0.25, paint, jl / 2, 0.9, 0, shadows));
  for (const z of [-0.7, 0.7]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(jl, 1.8), lat(jl / 1.8, 1));
    p.position.set(jl / 2, 0, z);
    slew.add(p);
  }
  // counter jib + weights
  const bl = o.backLen;
  for (const z of [-0.7, 0.7]) slew.add(bx(bl, 0.22, 0.22, paint, -bl / 2, -0.9, z, shadows));
  slew.add(bx(bl, 0.25, 0.25, paint, -bl / 2, 0.9, 0, shadows));
  for (const z of [-0.7, 0.7]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(bl, 1.8), lat(bl / 1.8, 1));
    p.position.set(-bl / 2, 0, z);
    slew.add(p);
  }
  for (let i = 0; i < 3; i++) slew.add(bx(1.2, 1.1, 2.1, std(0x8d8d88), -bl + 1.0 + i * 1.25, -1.7, 0, shadows));
  // A-frame + pendants
  const top = V(0, 7.5, 0);
  slew.add(strut(V(0.2, 0.9, 0.6), top, 0.25, paint));
  slew.add(strut(V(0.2, 0.9, -0.6), top, 0.25, paint));
  slew.add(bx(0.7, 0.5, 0.7, paint, 0, 7.6, 0, shadows));
  const pend = (x: number) => slew.add(strut(top, V(x, 0.9, 0), 0.07, steel));
  pend(jl * 0.55);
  pend(jl * 0.93);
  pend(-bl * 0.92);
  // cab
  if (o.cab) {
    const cab = bx(2.2, 2.0, 1.9, [paint, paint, paint, paint, std(0x27465c, { roughness: 0.2, metalness: 0.5 }), paint], 2.7, -2.7, -2.1, shadows);
    slew.add(cab);
    slew.add(bx(2.6, 0.2, 2.3, dark, 2.7, -1.6, -2.1, shadows));
  }
  // trolley (origin = jib centreline at radius r)
  const trolley = new THREE.Group();
  trolley.add(bx(1.5, 0.5, 1.9, std(0x2a2d33), 0, -1.35, 0, shadows));
  trolley.add(bx(1.7, 0.2, 0.2, steel, 0, -1.05, 0.9, shadows));
  trolley.add(bx(1.7, 0.2, 0.2, steel, 0, -1.05, -0.9, shadows));
  slew.add(trolley);
  return { group, slew, trolley };
}

// ------------------------------------------------------------------ loads
export function buildLoadMesh(kind: KindId): THREE.Group {
  const g = new THREE.Group();
  const k = KINDS[kind];
  switch (kind) {
    case 'rebar': {
      g.add(bx(3.0, 0.34, 0.5, std(0x6f6358, { metalness: 0.5 }), 0, -0.05, 0));
      g.add(bx(2.9, 0.14, 0.4, std(0x8a7a68, { metalness: 0.5 }), 0, 0.17, 0));
      for (const x of [-1.1, 0, 1.1]) g.add(bx(0.08, 0.5, 0.62, std(0xe87a1c), x, 0, 0));
      break;
    }
    case 'bucket': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.5, 0.95, 10), std(0xd9731c));
      body.position.y = 0.17;
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.22, 0.3, 10), std(0x777b80));
      spout.position.y = -0.45;
      const bail = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.04, 5, 14, Math.PI), std(0x333333));
      bail.position.y = 0.62;
      for (const m of [body, spout, bail]) { m.castShadow = true; g.add(m); }
      break;
    }
    case 'toilet': {
      g.add(bx(1.1, 2.1, 1.1, std(0x2f6fd8), 0, -0.05, 0));
      g.add(bx(1.2, 0.18, 1.2, std(0xe8eef8), 0, 1.1, 0));
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.9), new THREE.MeshStandardMaterial({ map: T.toilet(), roughness: 0.7 }));
      door.position.set(0, -0.05, 0.56);
      g.add(door);
      break;
    }
    case 'bricks': {
      g.add(bx(1.5, 0.1, 1.2, std(0xb08850), 0, -0.5, 0));
      const mats = new THREE.MeshStandardMaterial({ map: T.bricks(), roughness: 0.9 });
      g.add(bx(1.45, 0.95, 1.15, mats, 0, 0.02, 0));
      for (const x of [-0.45, 0.45]) g.add(bx(0.06, 0.97, 1.18, std(0x2a2a2a), x, 0.02, 0));
      break;
    }
    case 'glass': {
      g.add(bx(2.3, 2.8, 0.1, new THREE.MeshStandardMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0.3 }), 0, 0.05, 0, false));
      const fm = std(0xe87a1c);
      g.add(bx(2.4, 0.12, 0.2, fm, 0, 1.45, 0));
      g.add(bx(2.4, 0.12, 0.25, fm, 0, -1.45, 0));
      g.add(bx(0.12, 3.0, 0.2, fm, -1.16, 0, 0));
      g.add(bx(0.12, 3.0, 0.2, fm, 1.16, 0, 0));
      break;
    }
    case 'generator': {
      g.add(bx(2.4, 0.15, 1.3, std(0x222222), 0, -0.82, 0));
      g.add(bx(2.2, 1.4, 1.2, std(0xe8b020), 0, -0.05, 0));
      g.add(bx(0.9, 0.9, 0.05, std(0x333333), 0.5, 0, 0.62));
      const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.35, 8), std(0x333333));
      ex.position.set(-0.7, 0.8, 0);
      g.add(ex);
      g.add(bx(2.3, 0.1, 1.25, std(0x444444), 0, 0.7, 0));
      break;
    }
    case 'beam': {
      const st = std(0x4a5b6a, { metalness: 0.5, roughness: 0.5 });
      for (const z of [-0.2, 0.2]) {
        g.add(bx(4.6, 0.08, 0.3, st, 0, 0.3, z));
        g.add(bx(4.6, 0.08, 0.3, st, 0, -0.3, z));
        g.add(bx(4.6, 0.55, 0.07, st, 0, 0, z));
      }
      for (const x of [-1.5, 1.5]) g.add(bx(0.08, 0.8, 0.85, std(0xe87a1c), x, 0, 0));
      break;
    }
  }
  g.userData.size = [k.w, k.h, k.d];
  return g;
}

export function buildWorker(): THREE.Group {
  const g = new THREE.Group();
  g.add(bx(0.4, 0.8, 0.28, std(0x1d2a4a), 0, 0.4, 0, false));
  g.add(bx(0.5, 0.6, 0.32, std(0xff7a00), 0, 1.1, 0, false));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), std(0xe8b890));
  head.position.y = 1.55;
  const hat = new THREE.Mesh(new THREE.SphereGeometry(0.23, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0xffe030));
  hat.position.y = 1.58;
  g.add(head, hat);
  return g;
}

// ------------------------------------------------------------------ world
export interface PadVis { group: THREE.Group; ring: THREE.Mesh; disc: THREE.Mesh; beam: THREE.Mesh; mats: THREE.Material[] }

export class CraneWorld {
  group = new THREE.Group();
  solids: Solid[] = [];
  rig!: CraneRig;
  pads: PadVis[] = [];
  crane2Rig?: CraneRig;
  blockSolid = new Map<BlockSpec, Solid>();

  constructor(readonly level: LevelDef, accent: number, quality: 'low' | 'high', rngf: () => number) {
    const shadows = quality === 'high';
    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ map: T.ground(90), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    // distant city (vertigo reference)
    const cityMat = new THREE.MeshStandardMaterial({ map: T.city(), roughness: 0.9 });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rngf() * 0.1;
      const d = 95 + rngf() * 70;
      const h = 12 + rngf() * 60;
      const w = 10 + rngf() * 14;
      const m = bx(w, h, w, cityMat, Math.cos(a) * d, h / 2, Math.sin(a) * d, false);
      m.receiveShadow = false;
      this.group.add(m);
    }
    // player crane
    this.rig = buildCrane(accent, { mastH: JIB_Y - 1.2, jibY: JIB_Y, jibLen: 40, backLen: 13, cab: true }, shadows);
    this.group.add(this.rig.group);
    this.solids.push({ minx: -1.3, maxx: 1.3, miny: 0, maxy: JIB_Y - 1, minz: -1.3, maxz: 1.3 });

    // buildings & props
    const floorsBase = new THREE.MeshStandardMaterial({ color: 0xffffff });
    void floorsBase;
    for (const b of level.blocks) {
      const sx = Math.max(b.w, b.d) / 5;
      const sy = Math.max(1, b.h / 3.2);
      const mats: THREE.Material[] = b.kind === 'building'
        ? [0, 1, 2, 3, 4, 5].map((i) => (i === 2 ? new THREE.MeshStandardMaterial({ map: T.roof(b.w / 4, b.d / 4), roughness: 0.95 }) : new THREE.MeshStandardMaterial({ map: T.floors(i < 2 ? b.d / 5 : b.w / 5, sy), roughness: 0.95 })))
        : [std(b.color ?? 0xc4521c, { roughness: 0.6, metalness: 0.3 })];
      void sx;
      const m = bx(b.w, b.h, b.d, b.kind === 'building' ? mats : mats[0], b.x, b.h / 2, b.z, shadows);
      this.group.add(m);
      const s: Solid = { minx: b.x - b.w / 2, maxx: b.x + b.w / 2, miny: 0, maxy: b.h, minz: b.z - b.d / 2, maxz: b.z + b.d / 2 };
      this.solids.push(s);
      this.blockSolid.set(b, s);
      if (b.kind === 'building') {
        // rebar sprouting from the top corners + parapet stripes
        const rb = std(0xb4511c);
        for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          this.group.add(bx(0.07, 1.6, 0.07, rb, b.x + cx * (b.w / 2 - 0.3), b.h + 0.8, b.z + cz * (b.d / 2 - 0.3), false));
        }
      }
    }
    // second (static) crane
    const c2 = level.crane2;
    if (c2) this.buildCrane2(c2, accent, shadows);

    // pads
    level.loads.forEach((l) => {
      const p = level.pads[l.pad];
      const color = PAD_COLORS[level.loads.indexOf(l) % PAD_COLORS.length];
      const g = new THREE.Group();
      g.position.set(p.x, p.y + 0.04, p.z);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(level.tol - 0.18, level.tol, 28), ringMat);
      ring.rotation.x = -Math.PI / 2;
      const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(level.tol - 0.18, 24), discMat);
      disc.rotation.x = -Math.PI / 2;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10), ringMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.y = 0.01;
      const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 40, 6, 1, true), beamMat);
      beam.position.y = 20;
      g.add(ring, disc, dot, beam);
      this.group.add(g);
      this.pads.push({ group: g, ring, disc, beam, mats: [ringMat, discMat, beamMat] });
    });
    // staging marks
    for (const l of level.loads) {
      const k = KINDS[l.kind];
      const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(k.w, k.d) + 1.4, Math.max(k.w, k.d) + 1.4), new THREE.MeshBasicMaterial({ map: T.hatch(), transparent: true, opacity: 0.55 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(l.x, 0.02, l.z);
      this.group.add(m);
    }
    // a few decorative site props: barrels and cones near the staging area
    const barrel = std(0x2a5ec8);
    for (let i = 0; i < 10; i++) {
      const a = rngf() * Math.PI * 2;
      const d = 8 + rngf() * 26;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (level.loads.some((l) => Math.hypot(l.x - x, l.z - z) < 5) || level.blocks.some((b) => Math.abs(b.x - x) < b.w / 2 + 3 && Math.abs(b.z - z) < b.d / 2 + 3)) continue;
      if (i % 2) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8), barrel);
        c.position.set(x, 0.45, z);
        this.group.add(c);
      } else {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 8), std(0xff6a00));
        c.position.set(x, 0.35, z);
        this.group.add(c);
      }
    }
  }

  private buildCrane2(c2: Crane2Spec, accent: number, shadows: boolean) {
    const col = accent === 0xf2c200 ? 0xd8d8d0 : 0xf2c200;
    const jy = c2.mastH + 1.2;
    const rig = buildCrane(col, { mastH: c2.mastH, jibY: jy, jibLen: c2.jibLen, backLen: c2.backLen, cab: false }, shadows);
    rig.group.position.set(c2.x, 0, c2.z);
    rig.slew.rotation.y = 0; // jib along +x
    rig.trolley.position.x = c2.jibLen * 0.7;
    this.group.add(rig.group);
    this.crane2Rig = rig;
    this.solids.push({ minx: c2.x - 1.3, maxx: c2.x + 1.3, miny: 0, maxy: jy, minz: c2.z - 1.3, maxz: c2.z + 1.3 });
    this.solids.push({ minx: c2.x - c2.backLen, maxx: c2.x + c2.jibLen, miny: jy - 2.2, maxy: jy + 1.2, minz: c2.z - 1.0, maxz: c2.z + 1.0 });
  }
}

export function makeLabelSprite(text: string, color: number, size: number) {
  const mat = new THREE.SpriteMaterial({ map: labelTexture(text, cssHex(color)), depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  s.renderOrder = 10;
  return s;
}
