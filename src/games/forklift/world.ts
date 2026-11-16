import * as THREE from 'three';
import type { Collider, OBB } from './collide';
import type { LevelDef } from './levels';
import { mulberry32, range, shuffle, type Rng } from './rng';
import { tex } from './textures';

export const PALLET_H = 1.15; // pallet + cargo height
export const MAP = { x0: -48, x1: 48, z0: -30, z1: 30 };

export interface Pallet {
  id: number;
  x: number; z: number; y: number; yaw: number;
  carriedBy: number; // -1 = none
  delivered: boolean;
  fragile: boolean;
  home: { x: number; z: number; y: number; yaw: number };
  mesh: THREE.Group;
}
export interface Zone {
  id: number; x: number; z: number; hw: number; hd: number; h: number;
  filled: boolean; truck: boolean; mesh: THREE.Mesh; label: string;
}
export interface Cone { x: number; z: number; y: number; vx: number; vy: number; vz: number; knocked: boolean; spin: number; mesh: THREE.Object3D }
export interface Oil { x: number; z: number; r: number }
export interface Agv {
  ax: number; az: number; bx: number; bz: number; speed: number; phase: number;
  x: number; z: number; yaw: number; vx: number; vz: number; mesh: THREE.Group; nearCd: number[];
}
export interface BarrelLane { x: number; speed: number; interval: number; offset: number; meshes: THREE.Mesh[]; pos: { z: number; active: boolean }[] }
export interface Door { x: number; zc: number; period: number; phase: number; bottom: number; mesh: THREE.Mesh }
export interface Crane { px: number; pz: number; amp: number; period: number; phase: number; x: number; z: number; vx: number; vz: number; load: THREE.Mesh; cable: THREE.Mesh }
export interface Ramp { x0: number; x1: number; z0: number; z1: number; h: number; dir: 1 | -1 }

const std = (color: number | string, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1, ...opts });

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function makePalletMesh(fragile: boolean, label: string): THREE.Group {
  const g = new THREE.Group();
  const woodMat = std(0xffffff, { map: tex.wood() });
  // top deck slats
  for (let i = 0; i < 5; i++) g.add(box(1.2, 0.03, 0.18, woodMat, 0, 0.135, -0.5 + i * 0.25));
  // stringer blocks: 3 rows of blocks leaving fork pockets
  for (const x of [-0.5, 0, 0.5]) for (const z of [-0.5, 0, 0.5]) g.add(box(0.16, 0.1, 0.16, woodMat, x, 0.07, z));
  for (const x of [-0.5, 0, 0.5]) g.add(box(0.16, 0.025, 1.2, woodMat, x, 0.0125, 0));
  // cargo
  if (fragile) {
    const m = std(0xffffff, { map: tex.fragile() });
    g.add(box(1.1, 1.0, 1.1, m, 0, 0.65, 0));
  } else {
    const m = std(0xffffff, { map: tex.cardboard() });
    const s = 0.53;
    for (const x of [-0.27, 0.27]) for (const z of [-0.27, 0.27]) for (const y of [0.4, 0.92]) {
      const b = box(s, 0.5, s, m, x, y, z);
      b.rotation.y = (Math.random() - 0.5) * 0.06;
      g.add(b);
    }
    // stretch wrap shimmer
    const wrap = new THREE.Mesh(
      new THREE.BoxGeometry(1.12, 1.02, 1.12),
      new THREE.MeshStandardMaterial({ color: 0xddeeff, transparent: true, opacity: 0.18, roughness: 0.1 }),
    );
    wrap.position.y = 0.66;
    g.add(wrap);
  }
  // floating label sprite
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.sign(label, fragile ? '#d1131f' : '#1f6feb'), depthTest: false }));
  sp.scale.set(1.2, 0.3, 1);
  sp.position.y = 1.7;
  sp.name = 'label';
  sp.renderOrder = 10;
  g.add(sp);
  return g;
}

export class World {
  readonly group = new THREE.Group();
  statics: Collider[] = [];
  pallets: Pallet[] = [];
  zones: Zone[] = [];
  cones: Cone[] = [];
  oils: Oil[] = [];
  agvs: Agv[] = [];
  barrels: BarrelLane[] = [];
  doors: Door[] = [];
  cranes: Crane[] = [];
  ramps: Ramp[] = [];
  /** lines drawn on the minimap */
  mapRects: { x: number; z: number; hw: number; hd: number; color: string }[] = [];
  spawns: { x: number; z: number; yaw: number }[] = [];
  private rng: Rng;

  constructor(public level: LevelDef, public seed: number, public quality: 'high' | 'low') {
    this.rng = mulberry32(seed * 7919 + level.id * 104729);
    this.buildGround();
    this.buildBuildings();
    this.buildYard();
    this.buildPallets();
    this.buildZones();
    this.buildHazards();
  }

  private addStatic(x: number, z: number, hw: number, hd: number, yMax: number, kind: string, mesh?: THREE.Object3D, mapColor = '#777', yaw = 0) {
    const obb: OBB = { x, z, hw, hd, yaw };
    this.statics.push({ obb, yMin: 0, yMax, kind });
    if (mesh) this.group.add(mesh);
    if (mapColor) this.mapRects.push({ x, z, hw, hd, color: mapColor });
  }

  private wall(x0: number, z0: number, x1: number, z1: number, h = 4, mat?: THREE.Material) {
    const t = 0.6;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = Math.max(Math.abs(x1 - x0), t);
    const d = Math.max(Math.abs(z1 - z0), t);
    const m = box(w, h, d, mat ?? std(0x9aa3ad), cx, h / 2, cz);
    this.addStatic(cx, cz, w / 2, d / 2, h, 'wall', m, '#9aa3ad');
  }

  private buildGround() {
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(MAP.x1 - MAP.x0 + 20, MAP.z1 - MAP.z0 + 20), std(0xffffff, { map: tex.asphalt(), roughness: 0.95 }));
    yard.rotation.x = -Math.PI / 2;
    yard.receiveShadow = true;
    this.group.add(yard);
    for (const sx of [-1, 1]) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 48), std(0xffffff, { map: tex.epoxy(), roughness: 0.6 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(sx * 31, 0.01, 0);
      floor.receiveShadow = true;
      this.group.add(floor);
    }
    // painted lane lines in the yard
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2c200 });
    for (const z of [-7, 7]) {
      for (let x = -15; x < 15; x += 3) {
        if (Math.abs(x + 0.75) < 7) continue;
        const l = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.15), lineMat);
        l.rotation.x = -Math.PI / 2;
        l.position.set(x + 0.75, 0.02, z);
        this.group.add(l);
      }
    }
  }

  private buildBuildings() {
    const wallMat = std(0x8e99a6, { roughness: 0.7 });
    const stripe = std(0xffffff, { map: tex.hazard() });
    // outer fence
    this.wall(MAP.x0, MAP.z0, MAP.x1, MAP.z0, 2, std(0x55606b));
    this.wall(MAP.x0, MAP.z1, MAP.x1, MAP.z1, 2, std(0x55606b));
    this.wall(MAP.x0, MAP.z0, MAP.x0, MAP.z1, 2, std(0x55606b));
    this.wall(MAP.x1, MAP.z0, MAP.x1, MAP.z1, 2, std(0x55606b));

    for (const side of [-1, 1] as const) {
      const back = side * 46;
      const front = side * 16;
      this.wall(back, -24, back, 24, 4, wallMat);
      this.wall(Math.min(back, front), -24, Math.max(back, front), -24, 4, wallMat);
      this.wall(Math.min(back, front), 24, Math.max(back, front), 24, 4, wallMat);
      this.wall(front, -24, front, -10, 4, wallMat);
      this.wall(front, -4, front, 4, 4, wallMat);
      this.wall(front, 10, front, 24, 4, wallMat);
      // door frame stripes
      for (const z of [-10, -4, 4, 10]) {
        const s = box(0.7, 4.05, 0.7, stripe, front, 2.02, z);
        this.group.add(s);
      }
      // building sign
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 2),
        new THREE.MeshBasicMaterial({ map: tex.sign(side < 0 ? 'A동 출고창고' : 'B동 입고창고', side < 0 ? '#1f6feb' : '#2da44e') }),
      );
      sign.position.set(front + side * -0.35, 5, 0);
      sign.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(sign);
      const signPost = box(0.3, 1, 8.2, std(0x333333), front, 4.5, 0);
      this.group.add(signPost);
    }

    // racks: A at x = -41,-33,-25 ; B at x = 25
    const rackMat = std(0x2f6fd6, { metalness: 0.4, roughness: 0.5 });
    const beamMat = std(0xf08c00, { metalness: 0.4, roughness: 0.5 });
    const cargoMat = std(0xffffff, { map: tex.cardboard() });
    const rackLines = [-41, -33, -25, 25];
    for (const rx of rackLines) {
      for (const zc of [-12, 12]) {
        const g = new THREE.Group();
        // uprights
        for (let z = -9; z <= 9; z += 3) for (const dx of [-0.6, 0.6]) g.add(box(0.12, 3.4, 0.12, rackMat, dx, 1.7, z));
        // beams
        for (const y of [0.15, 1.35, 2.55]) for (const dx of [-0.6, 0.6]) g.add(box(0.1, 0.15, 18, beamMat, dx, y, 0));
        // shelf boxes
        for (const y of [1.45, 2.65]) for (let z = -8; z <= 8; z += 2) {
          if (this.rng() < 0.25) continue;
          const b = box(1.0, 0.8 + this.rng() * 0.3, 1.4, cargoMat, 0, y + 0.45, z);
          g.add(b);
        }
        g.position.set(rx, 0, zc);
        this.addStatic(rx, zc, 0.7, 9, 3.4, 'rack', g, '#2f6fd6');
      }
    }

    // trucks inside B (decor + optional raised delivery targets)
    for (const tz of [-14, 0, 14]) this.buildTruck(tz);
  }

  private buildTruck(tz: number) {
    const bedH = 1.2;
    const x0 = 36;
    const x1 = 44;
    const cx = (x0 + x1) / 2;
    const g = new THREE.Group();
    const body = std(0xd9dde3, { metalness: 0.3 });
    const chassis = std(0x333333);
    g.add(box(8, 0.25, 2.6, chassis, cx, bedH - 0.125, tz));
    g.add(box(8, 0.06, 2.4, std(0x7a5a3a), cx, bedH + 0.03, tz));
    for (const s of [-1, 1]) g.add(box(8, 2.6, 0.12, body, cx, bedH + 1.3, tz + s * 1.3));
    g.add(box(0.12, 2.6, 2.6, body, x1, bedH + 1.3, tz));
    g.add(box(8, 0.12, 2.72, body, cx, bedH + 2.66, tz));
    for (const wx of [37.5, 39, 42.5]) for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 16), std(0x111111));
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.5, tz + s * 1.15);
      g.add(w);
    }
    // rear bumper hazard
    g.add(box(0.15, 0.2, 2.6, std(0xffffff, { map: tex.hazard() }), x0 - 0.05, 0.55, tz));
    // cab
    g.add(box(1.8, 2.8, 2.6, std(0xc0392b, { metalness: 0.4, roughness: 0.4 }), 45, 1.6, tz));
    this.group.add(g);
    // colliders: bed (low) + walls + cab
    this.statics.push({ obb: { x: cx, z: tz, hw: 4, hd: 1.2, yaw: 0 }, yMin: 0, yMax: bedH, kind: 'truckbed' });
    for (const s of [-1, 1]) this.statics.push({ obb: { x: cx, z: tz + s * 1.3, hw: 4, hd: 0.08, yaw: 0 }, yMin: 0, yMax: 4, kind: 'wall' });
    this.statics.push({ obb: { x: x1 + 1, z: tz, hw: 1, hd: 1.35, yaw: 0 }, yMin: 0, yMax: 4, kind: 'wall' });
    this.mapRects.push({ x: cx + 1, z: tz, hw: 5, hd: 1.4, color: '#c0392b' });
  }

  private buildYard() {
    // container barrier in the middle with a jumpable low section
    const colors = ['#c0392b', '#1f6feb', '#2da44e', '#e67e22', '#8e44ad', '#16a085'];
    for (const [z0, z1] of [[-24, -2], [2, 24]]) {
      const len = z1 - z0;
      const n = Math.round(len / 6);
      const g = new THREE.Group();
      for (let i = 0; i < n; i++) {
        const segLen = len / n;
        const zc = z0 + segLen * (i + 0.5);
        const c = colors[Math.floor(this.rng() * colors.length)];
        const m = new THREE.MeshStandardMaterial({ map: tex.container(c), roughness: 0.6, metalness: 0.3 });
        g.add(box(2.4, 2.6, segLen - 0.1, m, 0, 1.3, zc));
        if (this.rng() < 0.4) g.add(box(2.4, 2.6, segLen - 0.1, m.clone(), 0, 3.9, zc));
      }
      this.addStatic(0, (z0 + z1) / 2, 1.2, len / 2, 6, 'container', g, '#b35c00');
    }
    // low crate barrier (jump over it!)
    const crateG = new THREE.Group();
    const crateMat = std(0xffffff, { map: tex.wood() });
    for (const z of [-1.5, -0.5, 0.5, 1.5]) for (const x of [-0.6, 0.6]) crateG.add(box(1.1, 0.85, 0.95, crateMat, x, 0.425, z));
    this.addStatic(0, 0, 1.2, 2, 0.85, 'crates', crateG, '#a0763f');
    // ramps
    const rampMat = std(0xffffff, { map: tex.hazard() });
    for (const dir of [1, -1] as const) {
      const x0 = dir === 1 ? -6.2 : 2.2;
      const x1 = dir === 1 ? -2.2 : 6.2;
      const h = 1.2;
      this.ramps.push({ x0, x1, z0: -2, z1: 2, h, dir });
      const len = Math.hypot(x1 - x0, h);
      const ang = Math.atan2(h, x1 - x0);
      const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 4), rampMat);
      top.position.set((x0 + x1) / 2, h / 2, 0);
      top.rotation.z = dir === 1 ? ang : -ang;
      top.castShadow = top.receiveShadow = true;
      this.group.add(top);
      // supports
      const sup = box(0.2, h, 4, std(0x555555), dir === 1 ? x1 - 0.1 : x0 + 0.1, h / 2, 0);
      this.group.add(sup);
      this.mapRects.push({ x: (x0 + x1) / 2, z: 0, hw: 2, hd: 2, color: '#f2c200' });
    }
    // jump sign
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.sign('🔥 JUMP 🔥', '#d1131f') }));
    sign.scale.set(4, 1, 1);
    sign.position.set(0, 4.2, 0);
    this.group.add(sign);
  }

  private buildPallets() {
    const slots: { x: number; z: number }[] = [];
    for (const rx of [-41, -33, -25]) {
      for (const seg of [-1, 1]) for (let i = 0; i < 9; i++) {
        slots.push({ x: rx + 0.7 + 0.1 + 0.6, z: seg * (4 + i * 2) });
      }
    }
    const chosen = shuffle(this.rng, slots).slice(0, this.level.pallets + (this.level.pallets % 2 === 0 ? 1 : 0));
    // use exactly level.pallets (an extra spare slot keeps randomness stable)
    for (let i = 0; i < this.level.pallets; i++) {
      const s = chosen[i];
      const fragile = i < this.level.fragile;
      const yaw = Math.PI / 2 + (this.rng() - 0.5) * 0.12;
      const label = fragile ? `🥃 ${i + 1}` : `📦 ${i + 1}`;
      const mesh = makePalletMesh(fragile, label);
      const p: Pallet = {
        id: i, x: s.x, z: s.z, y: 0, yaw, carriedBy: -1, delivered: false, fragile,
        home: { x: s.x, z: s.z, y: 0, yaw }, mesh,
      };
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = yaw;
      this.group.add(mesh);
      this.pallets.push(p);
    }
    this.spawns = [
      { x: -20, z: -6, yaw: Math.PI / 2 },
      { x: -20, z: 6, yaw: Math.PI / 2 },
    ];
  }

  private buildZones() {
    const n = this.level.pallets;
    const truckCount = Math.min(this.level.trucks, n);
    const truckZ = shuffle(this.rng, [-14, 0, 14]).slice(0, truckCount);
    const ground: { x: number; z: number }[] = [];
    for (const z of [-20, -16, -12, -8, -4.5, 4.5, 8, 12, 16, 20]) ground.push({ x: 28.6, z });
    for (const z of [-20, -16, 16, 20]) ground.push({ x: 21.5, z });
    const gsel = shuffle(this.rng, ground).slice(0, n - truckCount);
    let id = 0;
    const mk = (x: number, z: number, h: number, truck: boolean) => {
      const label = String.fromCharCode(65 + id);
      const color = truck ? '#ff4fd8' : '#2ee66b';
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: tex.zone(label, color), transparent: true, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(x, h + 0.04, z);
      this.group.add(mesh);
      this.zones.push({ id: id++, x, z, hw: 1, hd: 1, h, filled: false, truck, mesh, label });
    };
    for (const tz of truckZ) mk(37.1, tz, 1.2, true);
    for (const g of gsel) mk(g.x, g.z, 0, false);
  }

  private buildHazards() {
    const L = this.level;
    const r = this.rng;
    // cones
    const coneGeo = new THREE.ConeGeometry(0.25, 0.7, 12);
    const coneMat = std(0xff6a00, { roughness: 0.5 });
    const stripeMat = std(0xffffff);
    for (let i = 0; i < L.cones; i++) {
      let x = 0;
      let z = 0;
      for (let k = 0; k < 30; k++) {
        const inYard = r() < 0.75;
        x = inYard ? range(r, -14.5, 14.5) : range(r, -22.5, -17) * (r() < 0.5 ? 1 : -1);
        z = inYard ? range(r, -28, 28) : range(r, -22, 22);
        if (Math.abs(x) < 2.2 || (Math.abs(x) < 7 && Math.abs(z) < 3)) continue;
        break;
      }
      const g = new THREE.Group();
      const c = new THREE.Mesh(coneGeo, coneMat);
      c.position.y = 0.35;
      c.castShadow = true;
      g.add(c);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.12, 12), stripeMat);
      s.position.y = 0.4;
      g.add(s);
      const base = box(0.5, 0.05, 0.5, std(0x222222), 0, 0.025, 0);
      g.add(base);
      g.position.set(x, 0, z);
      this.group.add(g);
      this.cones.push({ x, z, y: 0, vx: 0, vy: 0, vz: 0, knocked: false, spin: 0, mesh: g });
    }
    // oil
    const oilMat = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.9 });
    for (let i = 0; i < L.oil; i++) {
      const inYard = r() < 0.6;
      const x = inYard ? range(r, -13, 13) : (r() < 0.5 ? range(r, -23, -18) : range(r, 18, 23));
      const z = range(r, -22, 22);
      if (Math.abs(x) < 3) { i--; continue; }
      const rad = range(r, 1.4, 2.4);
      const m = new THREE.Mesh(new THREE.CircleGeometry(rad, 24), oilMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.025, z);
      m.scale.set(1, range(r, 0.6, 1), 1);
      this.group.add(m);
      this.oils.push({ x, z, r: rad * 0.9 });
    }
    // AGVs
    const paths: [number, number, number, number][] = [
      [-9, -26, -9, 26], [9, 26, 9, -26], [-44, 0, -18, 0], [18, 0, 33, 0],
      [-19.5, -22, -19.5, 22], [19.5, 22, 19.5, -22], [33, -22, 33, 22], [-12, -26, -12, 26],
    ];
    for (let i = 0; i < L.agvs; i++) {
      const [ax, az, bx, bz] = paths[i % paths.length];
      const mesh = this.makeAgvMesh();
      this.group.add(mesh);
      this.agvs.push({
        ax, az, bx, bz, speed: L.agvSpeed * range(r, 0.85, 1.15), phase: r() * 100,
        x: ax, z: az, yaw: 0, vx: 0, vz: 0, mesh, nearCd: [0, 0],
      });
    }
    // barrels
    const lanes = [-12.5, 12.5, 5.5];
    const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 16);
    const barrelMats = [std(0x1f6feb, { metalness: 0.5 }), std(0xc0392b, { metalness: 0.5 }), std(0x2da44e, { metalness: 0.5 })];
    for (let i = 0; i < L.barrelLanes; i++) {
      const lane: BarrelLane = { x: lanes[i], speed: range(r, 5, 7), interval: range(r, 3.5, 5), offset: r() * 5, meshes: [], pos: [] };
      const maxN = Math.ceil(60 / lane.speed / lane.interval) + 1;
      for (let k = 0; k < maxN; k++) {
        const m = new THREE.Mesh(barrelGeo, barrelMats[(i + k) % 3]);
        m.rotation.z = Math.PI / 2;
        m.rotation.order = 'ZXY';
        m.castShadow = true;
        m.visible = false;
        this.group.add(m);
        lane.meshes.push(m);
        lane.pos.push({ z: 0, active: false });
      }
      this.barrels.push(lane);
      // spawn chute decoration
      this.group.add(box(1.6, 1.4, 1.2, std(0x444444), lane.x, 0.7, 29.2));
    }
    // shutter doors
    if (L.doors) {
      const doorMat = std(0xb8c2cc, { metalness: 0.6, roughness: 0.4 });
      for (const fx of [-16, 16]) for (const zc of [-7, 7]) {
        const m = box(0.25, 3.8, 6, doorMat, fx, 1.9, zc);
        this.group.add(m);
        this.doors.push({ x: fx, zc, period: L.doorPeriod * range(r, 0.9, 1.1), phase: r() * 10, bottom: 4, mesh: m });
      }
    }
    // cranes
    const pivots: [number, number][] = shuffle(r, [[-11, 7], [11, -7], [-11, -7], [11, 7]]);
    for (let i = 0; i < L.cranes; i++) {
      const [px, pz] = pivots[i];
      const load = box(1.4, 1.2, 1.4, std(0x666666, { roughness: 1 }), px, 1.2, pz);
      const hz = box(1.45, 0.2, 1.45, std(0xffffff, { map: tex.hazard() }), 0, 0.5, 0);
      load.add(hz);
      this.group.add(load);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), std(0x111111));
      this.group.add(cable);
      // gantry
      this.group.add(box(0.4, 9, 0.4, std(0xf2c200), px, 4.5, pz - 6));
      this.group.add(box(0.4, 9, 0.4, std(0xf2c200), px, 4.5, pz + 6));
      this.group.add(box(0.5, 0.5, 12.4, std(0xf2c200), px, 9, pz));
      this.cranes.push({ px, pz, amp: 4.2, period: range(r, 3.5, 4.5), phase: r() * 10, x: px, z: pz, vx: 0, vz: 0, load, cable });
      this.statics.push({ obb: { x: px, z: pz - 6, hw: 0.2, hd: 0.2, yaw: 0 }, yMin: 0, yMax: 9, kind: 'wall' });
      this.statics.push({ obb: { x: px, z: pz + 6, hw: 0.2, hd: 0.2, yaw: 0 }, yMin: 0, yMax: 9, kind: 'wall' });
    }
  }

  private makeAgvMesh() {
    const g = new THREE.Group();
    g.add(box(1.2, 0.5, 1.8, std(0xf5f5f5, { metalness: 0.3, roughness: 0.4 }), 0, 0.35, 0));
    g.add(box(1.22, 0.1, 1.82, std(0xffffff, { map: tex.hazard() }), 0, 0.12, 0));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff8800 }));
    lamp.position.set(0, 0.75, 0);
    lamp.name = 'lamp';
    g.add(lamp);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
    eye.position.set(0, 0.45, 0.92);
    g.add(eye);
    return g;
  }

  groundHeight(x: number, z: number): number {
    for (const r of this.ramps) {
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
        const u = (x - r.x0) / (r.x1 - r.x0);
        return r.h * (r.dir === 1 ? u : 1 - u);
      }
    }
    return 0;
  }

  gripAt(x: number, z: number): number {
    for (const o of this.oils) if ((x - o.x) ** 2 + (z - o.z) ** 2 < o.r * o.r) return 0.9;
    return 1;
  }

  /** Advance kinematic hazards. All are pure functions of time so online peers agree. */
  update(t: number, dt: number) {
    for (const a of this.agvs) {
      const len = Math.hypot(a.bx - a.ax, a.bz - a.az);
      const s = (t * a.speed + a.phase * a.speed) % (2 * len);
      const fwd = s < len;
      const d = fwd ? s : 2 * len - s;
      const ux = (a.bx - a.ax) / len;
      const uz = (a.bz - a.az) / len;
      const nx = a.ax + ux * d;
      const nz = a.az + uz * d;
      a.vx = (fwd ? ux : -ux) * a.speed;
      a.vz = (fwd ? uz : -uz) * a.speed;
      a.x = nx;
      a.z = nz;
      a.yaw = Math.atan2(a.vx, a.vz);
      a.mesh.position.set(nx, 0, nz);
      a.mesh.rotation.y = a.yaw;
      const lamp = a.mesh.getObjectByName('lamp') as THREE.Mesh;
      (lamp.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(t * 4) % 2 ? 0xff8800 : 0x552200);
      a.nearCd[0] = Math.max(0, a.nearCd[0] - dt);
      a.nearCd[1] = Math.max(0, a.nearCd[1] - dt);
    }
    for (const lane of this.barrels) {
      const travel = 60;
      const life = travel / lane.speed;
      const n = lane.meshes.length;
      const tt = t + lane.offset;
      const kNow = Math.floor(tt / lane.interval);
      for (let i = 0; i < n; i++) {
        const k = kNow - i;
        const age = tt - k * lane.interval;
        const m = lane.meshes[((k % n) + n) % n];
        const st = lane.pos[((k % n) + n) % n];
        if (k < 0 || age > life) {
          m.visible = false;
          st.active = false;
          continue;
        }
        const z = 29 - age * lane.speed;
        st.z = z;
        st.active = true;
        m.visible = true;
        m.position.set(lane.x, 0.45, z);
        m.rotation.x = -age * lane.speed / 0.45;
      }
    }
    for (const d of this.doors) {
      const u = (((t + d.phase) % d.period) + d.period) % d.period / d.period;
      let b: number;
      if (u < 0.55) b = 4;
      else if (u < 0.68) b = 4 * (1 - (u - 0.55) / 0.13);
      else if (u < 0.85) b = 0;
      else b = 4 * ((u - 0.85) / 0.15);
      d.bottom = b;
      d.mesh.position.y = b + 1.9;
      d.mesh.scale.y = 1;
    }
    for (const c of this.cranes) {
      const w = (Math.PI * 2) / c.period;
      const ph = (t + c.phase) * w;
      const nz = c.pz + Math.sin(ph) * c.amp;
      c.vz = Math.cos(ph) * c.amp * w;
      c.vx = 0;
      c.x = c.px;
      c.z = nz;
      const y = 1.2 + (1 - Math.cos(Math.sin(ph) * 0.6)) * 2;
      c.load.position.set(c.x, y, c.z);
      c.load.rotation.x = Math.sin(ph) * 0.5;
      const top = new THREE.Vector3(c.px, 9, c.pz);
      const bot = new THREE.Vector3(c.x, y + 0.6, c.z);
      c.cable.position.copy(top).add(bot).multiplyScalar(0.5);
      c.cable.scale.y = top.distanceTo(bot);
      c.cable.lookAt(top);
      c.cable.rotateX(Math.PI / 2);
    }
  }

  /** Colliders for moving hazards + resting pallets (rebuilt every step). */
  dynamicColliders(): Collider[] {
    const out: Collider[] = [];
    for (const p of this.pallets) {
      if (p.carriedBy !== -1) continue;
      out.push({ obb: { x: p.x, z: p.z, hw: 0.6, hd: 0.6, yaw: p.yaw }, yMin: p.y, yMax: p.y + PALLET_H, kind: 'pallet', ref: p });
    }
    for (const a of this.agvs) out.push({ obb: { x: a.x, z: a.z, hw: 0.6, hd: 0.9, yaw: a.yaw }, yMin: 0, yMax: 0.9, vx: a.vx, vz: a.vz, kind: 'agv', ref: a });
    for (const lane of this.barrels) for (const p of lane.pos) if (p.active) {
      out.push({ circle: { x: lane.x, z: p.z, r: 0.5 }, yMin: 0, yMax: 0.95, vx: 0, vz: -lane.speed, kind: 'barrel' });
    }
    for (const d of this.doors) if (d.bottom < 3.95) {
      out.push({ obb: { x: d.x, z: d.zc, hw: 0.2, hd: 3, yaw: 0 }, yMin: d.bottom, yMax: 4, kind: 'door' });
    }
    for (const c of this.cranes) {
      const y = c.load.position.y;
      out.push({ circle: { x: c.x, z: c.z, r: 0.85 }, yMin: y - 0.6, yMax: y + 0.6, vx: c.vx, vz: c.vz, kind: 'crane' });
    }
    return out;
  }

  updateCones(dt: number) {
    for (const c of this.cones) {
      if (!c.knocked) continue;
      if (c.y > 0 || c.vy > 0) {
        c.vy -= 20 * dt;
        c.x += c.vx * dt;
        c.z += c.vz * dt;
        c.y += c.vy * dt;
        c.spin += dt * 12;
        if (c.y < 0) {
          c.y = 0;
          c.vy = Math.abs(c.vy) > 2 ? -c.vy * 0.3 : 0;
          c.vx *= 0.5;
          c.vz *= 0.5;
        }
      } else {
        c.vx *= 0.9;
        c.vz *= 0.9;
        c.x += c.vx * dt;
        c.z += c.vz * dt;
      }
      c.mesh.position.set(c.x, c.y + (c.y > 0 ? 0 : 0.0), c.z);
      c.mesh.rotation.x = c.y > 0 ? c.spin : Math.PI / 2;
    }
  }
}
