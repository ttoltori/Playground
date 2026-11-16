import * as THREE from 'three';
import { fwdOf, rightOf, type OBB } from './collide';
import { box } from './world';

export const FK = {
  bodyHalfW: 0.62,
  bodyFront: 1.0, // local z of body front / mast
  bodyRear: -1.45,
  forkLen: 1.15,
  palletOffset: 1.68, // local z of a carried pallet's center
  pivot: 0.55, // front axle (forklifts steer with the REAR wheels, the tail swings!)
  wheelbase: 1.55,
  maxFork: 3.2,
  height: 2.3,
};

export class Forklift {
  x = 0; z = 0; y = 0; yaw = 0;
  vx = 0; vz = 0; vy = 0;
  steer = 0;
  forkH = 0.05;
  airborne = false;
  airTime = 0;
  turbo = 1; // 0..1 gauge
  carrying = -1; // pallet id
  carryYaw = 0; // pallet yaw relative to forklift
  tipRisk = 0; // 0..1+
  roll = 0;
  pitch = 0;
  wobble = 0;
  readonly mesh = new THREE.Group();
  private carriage = new THREE.Group();
  private innerMast = new THREE.Group();
  private rearWheels: THREE.Object3D[] = [];
  private allWheels: THREE.Mesh[] = [];
  private beacon!: THREE.Mesh;
  private body = new THREE.Group();
  private guard = new THREE.Group();
  readonly cabAnchor = new THREE.Object3D();
  headlight?: THREE.SpotLight;
  private wheelSpin = 0;

  constructor(public color: number, public name: string) {
    this.buildMesh();
  }

  get fwd() { return fwdOf(this.yaw); }
  get right() { return rightOf(this.yaw); }
  get speed() {
    const [fx, fz] = this.fwd;
    return this.vx * fx + this.vz * fz;
  }

  bodyObb(): OBB {
    const c = (FK.bodyFront + FK.bodyRear) / 2;
    const [fx, fz] = this.fwd;
    return { x: this.x + fx * c, z: this.z + fz * c, hw: FK.bodyHalfW, hd: (FK.bodyFront - FK.bodyRear) / 2, yaw: this.yaw };
  }

  palletObb(): OBB {
    const [fx, fz] = this.fwd;
    return { x: this.x + fx * FK.palletOffset, z: this.z + fz * FK.palletOffset, hw: 0.6, hd: 0.6, yaw: this.yaw + this.carryYaw };
  }

  forkTip(): [number, number] {
    const [fx, fz] = this.fwd;
    const d = FK.bodyFront + FK.forkLen * 0.55;
    return [this.x + fx * d, this.z + fz * d];
  }

  private buildMesh() {
    const paint = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.45, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.8 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const b = this.body;
    const guard = this.guard;
    // chassis + body
    b.add(box(1.2, 0.55, 2.2, paint, 0, 0.55, -0.25));
    b.add(box(1.24, 0.75, 0.6, dark, 0, 0.75, -1.15)); // counterweight
    b.add(box(1.0, 0.2, 0.9, dark, 0, 0.9, -0.2)); // floor
    // seat
    b.add(box(0.55, 0.12, 0.5, dark, 0, 1.15, -0.55));
    b.add(box(0.55, 0.6, 0.12, dark, 0, 1.45, -0.82));
    // steering column + wheel
    const col = box(0.08, 0.6, 0.08, dark, 0, 1.2, 0.25);
    col.rotation.x = -0.5;
    b.add(col);
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), dark);
    sw.position.set(0, 1.48, 0.12);
    sw.rotation.x = -1.1;
    sw.name = 'steeringWheel';
    b.add(sw);
    // overhead guard (hidden from the driver's own 1st-person camera via layers)
    for (const x of [-0.55, 0.55]) for (const z of [0.55, -0.95]) guard.add(box(0.07, 1.45, 0.07, dark, x, 1.55, z));
    for (let i = 0; i < 6; i++) guard.add(box(1.18, 0.05, 0.08, dark, 0, 2.28, -0.9 + i * 0.29));
    guard.add(box(1.2, 0.06, 1.55, paint, 0, 2.3, -0.2).translateY(0.02));
    b.add(guard);
    // rotating beacon
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 12), new THREE.MeshBasicMaterial({ color: 0xff8800 }));
    this.beacon.position.set(0, 2.42, -0.6);
    guard.add(this.beacon);
    // headlights
    for (const x of [-0.45, 0.45]) {
      const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
      hl.rotation.x = Math.PI / 2;
      hl.position.set(x, 2.15, 0.6);
      guard.add(hl);
    }
    // wheels
    const wf = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 16);
    const wr = new THREE.CylinderGeometry(0.26, 0.26, 0.24, 14);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wf, tire);
      w.rotation.z = Math.PI / 2;
      w.position.set(s * 0.6, 0.34, FK.pivot);
      w.castShadow = true;
      b.add(w);
      this.allWheels.push(w);
      const pivot = new THREE.Object3D();
      pivot.position.set(s * 0.52, 0.26, FK.pivot - FK.wheelbase);
      const r = new THREE.Mesh(wr, tire);
      r.rotation.z = Math.PI / 2;
      pivot.add(r);
      b.add(pivot);
      this.rearWheels.push(pivot);
      this.allWheels.push(r);
    }
    // mast (outer)
    for (const x of [-0.42, 0.42]) b.add(box(0.1, 2.2, 0.12, steel, x, 1.2, FK.bodyFront));
    b.add(box(0.94, 0.1, 0.12, steel, 0, 2.3, FK.bodyFront));
    // inner mast (telescopes)
    for (const x of [-0.32, 0.32]) this.innerMast.add(box(0.08, 2.2, 0.1, steel, x, 1.2, FK.bodyFront + 0.08));
    this.innerMast.add(box(0.72, 0.08, 0.1, steel, 0, 2.3, FK.bodyFront + 0.08));
    b.add(this.innerMast);
    // carriage + forks
    const c = this.carriage;
    c.add(box(1.0, 0.45, 0.06, dark, 0, 0.32, FK.bodyFront + 0.16));
    for (let i = 0; i < 5; i++) c.add(box(0.05, 0.75, 0.04, dark, -0.4 + i * 0.2, 0.9, FK.bodyFront + 0.16));
    c.add(box(1.0, 0.05, 0.05, dark, 0, 1.27, FK.bodyFront + 0.16));
    for (const x of [-0.3, 0.3]) {
      c.add(box(0.12, 0.5, 0.05, steel, x, 0.3, FK.bodyFront + 0.2));
      c.add(box(0.12, 0.05, FK.forkLen, steel, x, 0.06, FK.bodyFront + 0.2 + FK.forkLen / 2));
    }
    b.add(c);
    // name tag
    b.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    this.cabAnchor.position.set(0, 1.9, -0.3);
    b.add(this.cabAnchor);
    this.mesh.add(b);
  }

  /** put the overhead guard on its own render layer so a cab camera can skip it */
  setGuardLayer(layer: number) {
    this.guard.traverse((o) => o.layers.set(layer));
  }

  addHeadlight() {
    const l = new THREE.SpotLight(0xfff2cc, 60, 40, 0.6, 0.5, 1.2);
    l.position.set(0, 2.1, 0.6);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, 0, 10);
    this.body.add(tgt);
    l.target = tgt;
    this.body.add(l);
    this.headlight = l;
  }

  syncMesh(dt: number, t: number) {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(0, this.yaw, 0);
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, this.roll, 0.2);
    this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, this.pitch, 0.2);
    this.carriage.position.y = this.forkH;
    this.innerMast.position.y = Math.max(0, this.forkH - 1.0);
    for (const w of this.rearWheels) w.rotation.y = -this.steer;
    this.wheelSpin += (this.speed * dt) / 0.3;
    for (const w of this.allWheels) w.rotation.x = this.wheelSpin;
    this.beacon.rotation.y = t * 8;
    const on = Math.sin(t * 8) > 0;
    (this.beacon.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xffa000 : 0x803000);
    const sw = this.body.getObjectByName('steeringWheel');
    if (sw) sw.rotation.z = this.steer * 3;
  }

  /** world transform where a carried pallet sits */
  carriedPose(): { x: number; y: number; z: number; yaw: number } {
    const [fx, fz] = this.fwd;
    return {
      x: this.x + fx * FK.palletOffset,
      z: this.z + fz * FK.palletOffset,
      y: this.y + this.forkH,
      yaw: this.yaw + this.carryYaw,
    };
  }
}
