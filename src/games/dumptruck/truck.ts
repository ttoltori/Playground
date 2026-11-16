import * as THREE from 'three';
import { fwdOf, rightOf, type OBB } from '../forklift/collide';
import { box } from '../forklift/world';

/** Dimensions (m). Local frame: origin = rear drive axle on the ground, +Z forward, +X = the truck's left. */
export const TK = {
  wheelbase: 4.6, // rear axle -> front axle
  rear: -2.4, // tail end
  front: 6.1, // bumper
  hw: 1.45,
  bedLen: 5.8,
  hinge: { y: 1.4, z: -2.3 },
  maxBed: (52 * Math.PI) / 180,
  height: 3.4,
  eye: { x: 0.55, y: 2.95, z: 4.5 },
};

/** highest point of the raised bed (m above the rear axle's ground level). */
export function bedPeak(a: number): number {
  return TK.hinge.y + 1.6 * Math.cos(a) + TK.bedLen * Math.sin(a);
}

const mk = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.15, ...o });

export class DumpTruck {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group(); // pitch / roll applied here? (group takes yaw+pitch+roll)
  // physics state
  x = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  y = 0;
  steer = 0; // wheel angle (rad), + = yaw increases
  bed = 0; // bed angle (rad)
  load = 0; // 0..1
  gear: 'D' | 'R' = 'D';
  // visual smoothing
  vy = 0;
  pitch = 0;
  roll = 0;
  rollOver = 0; // 0..1 flip animation
  rollSign = 1;
  spin = 0;
  // parts
  private bed3 = new THREE.Group();
  private heap: THREE.Mesh;
  private gate = new THREE.Group();
  private strut: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  private steerWheels: THREE.Group[] = [];
  cabOuter = new THREE.Group();
  cabInside = new THREE.Group();
  readonly rearCam = new THREE.PerspectiveCamera(70, 1.7, 0.2, 200);
  readonly headlight: THREE.SpotLight;
  private brakeLamps: THREE.Mesh[] = [];
  private brakeMat = new THREE.MeshBasicMaterial({ color: 0x6a0d0d });
  readonly eyeAnchor = new THREE.Object3D();

  constructor(color: number, night: boolean) {
    const paint = mk(color, { metalness: 0.1, roughness: 0.5 });
    const dark = mk(0x23262b, { metalness: 0.4 });
    const steel = mk(0x8a8f96, { metalness: 0.5 });
    const bedMat = mk(0xe2b82a, { metalness: 0.05, roughness: 0.7 });
    const bedDark = mk(0x9c7e12, { metalness: 0.3 });
    const glass = mk(0x14202e, { metalness: 0.7, roughness: 0.2 });
    const g = this.body;
    this.group.add(g);
    this.group.rotation.order = 'YXZ';

    // chassis
    g.add(box(2.1, 0.5, 8.2, dark, 0, 0.95, 1.8));
    g.add(box(2.5, 0.25, 1.4, dark, 0, 0.7, 6.0)); // bumper

    // wheels
    const tyre = mk(0x151515, { roughness: 1, metalness: 0 });
    const hub = mk(0xd8d8d8, { metalness: 0.6 });
    const mkWheel = (x: number, z: number, steerable: boolean) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.62, 12), tyre);
      w.rotation.z = Math.PI / 2;
      w.castShadow = true;
      const spinner = new THREE.Group();
      spinner.add(w);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.66, 8), hub);
      cap.rotation.z = Math.PI / 2;
      spinner.add(cap);
      spinner.add(box(0.7, 0.12, 0.12, hub, x > 0 ? 0.0 : 0.0, 0, 0).translateX(0));
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.66, z);
      pivot.add(spinner);
      g.add(pivot);
      this.wheels.push(spinner as unknown as THREE.Mesh);
      if (steerable) this.steerWheels.push(pivot);
    };
    for (const sx of [-1, 1]) {
      mkWheel(sx * 1.2, TK.wheelbase, true);
      mkWheel(sx * 1.2, 0, false);
      mkWheel(sx * 1.2, -1.5, false);
    }
    // fenders
    for (const sx of [-1, 1]) g.add(box(0.35, 0.12, 4.2, dark, sx * 1.2, 1.5, -0.7));

    // cab (outer) + hood
    const co = this.cabOuter;
    co.add(box(2.6, 2.25, 1.55, paint, 0, 2.35, 4.25));
    co.add(box(2.3, 0.8, 0.06, glass, 0, 2.95, 5.04));
    co.add(box(0.06, 0.8, 1.2, glass, 1.31, 2.95, 4.35));
    co.add(box(0.06, 0.8, 1.2, glass, -1.31, 2.95, 4.35));
    co.add(box(2.7, 0.18, 1.7, dark, 0, 3.5, 4.35)); // visor
    g.add(co);
    g.add(box(2.5, 1.15, 1.2, paint, 0, 1.75, 5.5)); // hood
    g.add(box(2.1, 0.5, 0.06, dark, 0, 1.6, 6.12)); // grille
    g.add(box(0.3, 1.3, 0.3, steel, 1.05, 3.3, 3.55)); // exhaust
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.05), new THREE.MeshBasicMaterial({ color: night ? 0xfff3c4 : 0xe8e0b0 }));
      hl.position.set(sx * 0.9, 1.85, 6.11);
      g.add(hl);
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.05), this.brakeMat);
      bl.position.set(sx * 1.0, 1.2, -2.42);
      g.add(bl);
      this.brakeLamps.push(bl);
      g.add(box(0.12, 0.5, 0.25, dark, sx * 1.6, 2.8, 5.0)); // mirror
    }

    // cab interior (first-person)
    const ci = this.cabInside;
    const dashMat = mk(0x1b1d21, { metalness: 0.1, roughness: 0.9 });
    ci.add(box(2.45, 0.55, 0.45, dashMat, 0, 2.2, 4.8));
    const gauge = new THREE.Mesh(new THREE.CircleGeometry(0.17, 14), new THREE.MeshBasicMaterial({ color: 0x35f0a0 }));
    gauge.position.set(0.55, 2.52, 4.575);
    gauge.rotation.y = Math.PI;
    ci.add(gauge);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 6, 16), dashMat);
    wheel.position.set(0.55, 2.55, 4.45);
    wheel.rotation.x = -0.9;
    wheel.name = 'swheel';
    ci.add(wheel);
    ci.add(box(0.12, 1.0, 0.14, dashMat, 1.18, 2.95, 4.95)); // A pillars
    ci.add(box(0.12, 1.0, 0.14, dashMat, -1.18, 2.95, 4.95));
    ci.add(box(2.45, 0.1, 0.1, dashMat, 0, 3.4, 4.98));
    const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), new THREE.MeshStandardMaterial({ color: 0x5b6d82, metalness: 0.9, roughness: 0.15, side: THREE.DoubleSide }));
    for (const sx of [-1, 1]) {
      const m = mir.clone();
      m.position.set(sx * 1.55, 2.8, 4.95);
      m.rotation.y = -sx * 0.6;
      ci.add(m);
    }
    ci.visible = false;
    g.add(ci);
    this.eyeAnchor.position.set(TK.eye.x, TK.eye.y, TK.eye.z);
    g.add(this.eyeAnchor);

    // bed
    const bed = this.bed3;
    bed.position.set(0, TK.hinge.y, TK.hinge.z);
    const L = TK.bedLen;
    bed.add(box(2.85, 0.2, L, bedMat, 0, 0, L / 2));
    for (const sx of [-1, 1]) {
      bed.add(box(0.16, 1.35, L, bedMat, sx * 1.35, 0.65, L / 2));
      bed.add(box(0.3, 0.12, L + 0.1, bedDark, sx * 1.35, 1.35, L / 2));
    }
    bed.add(box(2.85, 1.7, 0.2, bedMat, 0, 0.8, L - 0.1));
    bed.add(box(2.9, 0.2, 0.3, bedDark, 0, 1.6, L - 0.1));
    for (let i = 0; i < 4; i++) bed.add(box(0.1, 0.9, 5.4, bedDark, -1.0 + i * 0.66, 0.0, L / 2).translateY(-0.45).translateZ(0)); // underside ribs
    // tailgate
    const gt = this.gate;
    gt.position.set(0, 1.25, 0.02);
    gt.add(box(2.8, 1.1, 0.12, bedDark, 0, -0.55, 0));
    bed.add(gt);
    // load heap
    const hg = new THREE.BoxGeometry(1, 1, 1);
    const pa = hg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      if (pa.getY(i) > 0) {
        pa.setX(i, pa.getX(i) * 0.55);
        pa.setZ(i, pa.getZ(i) * 0.5);
      }
    }
    hg.computeVertexNormals();
    this.heap = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: 0x7b6249, roughness: 1, flatShading: true }));
    this.heap.castShadow = true;
    bed.add(this.heap);
    g.add(bed);
    // hydraulic strut
    this.strut = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 8), steel);
    g.add(this.strut);

    // rear camera (on the chassis, looking backwards and down)
    this.rearCam.position.set(0, 2.0, TK.rear - 0.3);
    this.rearCam.rotation.order = 'YXZ';
    this.rearCam.rotation.set(-0.32, 0, 0);
    g.add(this.rearCam);

    // headlight
    this.headlight = new THREE.SpotLight(0xfff0cc, night ? 60 : 0, 70, 0.55, 0.5, 1.2);
    this.headlight.position.set(0, 2.0, 5.8);
    this.headlight.target.position.set(0, 0.5, 30);
    g.add(this.headlight, this.headlight.target);

    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    this.updateBed();
  }

  get fwd(): [number, number] {
    return fwdOf(this.yaw);
  }
  get left(): [number, number] {
    return rightOf(this.yaw);
  }
  get speed() {
    const [fx, fz] = this.fwd;
    return this.vx * fx + this.vz * fz;
  }
  bodyObb(): OBB {
    const [fx, fz] = this.fwd;
    const c = (TK.rear + TK.front) / 2;
    return { x: this.x + fx * c, z: this.z + fz * c, hw: TK.hw, hd: (TK.front - TK.rear) / 2, yaw: this.yaw };
  }
  /** centre of the bed floor (world xz) */
  bedCenter(): [number, number] {
    const [fx, fz] = this.fwd;
    const c = TK.hinge.z + TK.bedLen / 2;
    return [this.x + fx * c, this.z + fz * c];
  }
  /** world position of the tail edge */
  tail(): [number, number] {
    const [fx, fz] = this.fwd;
    return [this.x + fx * (TK.hinge.z - 0.3), this.z + fz * (TK.hinge.z - 0.3)];
  }
  /** a point on the bed rim, local (lx, lz) */
  bedPoint(lx: number, lz: number): [number, number, number] {
    const [fx, fz] = this.fwd;
    const [lfx, lfz] = this.left;
    const a = this.bed;
    // bed-local z -> truck z with the tilt, height from tilt
    const zz = TK.hinge.z + lz * Math.cos(a);
    const yy = this.y + TK.hinge.y + lz * Math.sin(a) + 1.3 * Math.cos(a);
    return [this.x + fx * zz + lfx * lx, yy, this.z + fz * zz + lfz * lx];
  }

  setBrake(on: boolean) {
    this.brakeMat.color.setHex(on ? 0xff2a2a : 0x6a0d0d);
  }

  setView(cab: boolean) {
    this.cabOuter.visible = !cab;
    this.cabInside.visible = cab;
  }

  private updateBed() {
    const a = this.bed;
    this.bed3.rotation.x = -a;
    const lf = Math.max(0.0001, this.load);
    const h = lf * 1.75;
    this.heap.visible = this.load > 0.004;
    this.heap.scale.set(2.55, Math.max(0.02, h), TK.bedLen - 0.4);
    this.heap.position.set(0, 0.1 + h / 2, TK.bedLen / 2 - 0.05);
    this.gate.rotation.x = Math.min(1.2, Math.max(0, (a - 0.38) * 3.2));
    // strut from the chassis (0,0.95,1.5) to the bed underside point (z=3.4 along the bed)
    const bz = 3.4;
    const by = TK.hinge.y + bz * Math.sin(a) - 0.1 * Math.cos(a);
    const bzw = TK.hinge.z + bz * Math.cos(a) + 0.1 * Math.sin(a);
    const ay = 0.95;
    const az = 1.6;
    const dy = by - ay;
    const dz = bzw - az;
    const len = Math.hypot(dy, dz);
    this.strut.scale.set(1, len, 1);
    this.strut.position.set(0, (ay + by) / 2, (az + bzw) / 2);
    this.strut.rotation.set(Math.atan2(dz, dy), 0, 0);
  }

  /** copy state to the meshes */
  sync(dt: number, steerWheelAngle: number) {
    const g = this.group;
    g.position.set(this.x, this.vy, this.z);
    g.rotation.y = this.yaw;
    g.rotation.x = -this.pitch;
    const flip = Math.sin(this.rollOver * Math.PI * 0.5) * 1.45 * this.rollSign;
    g.rotation.z = this.roll + flip;
    this.updateBed();
    const sp = this.speed;
    this.spin += (sp * dt) / 0.66;
    for (const w of this.wheels) w.rotation.x = this.spin;
    for (const s of this.steerWheels) s.rotation.y = this.steer;
    const sw = this.cabInside.getObjectByName('swheel');
    if (sw) sw.rotation.z = -steerWheelAngle * 2.4;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
  }
}
