import * as THREE from 'three';
import type { Water } from './level';

type Shape = 'disc' | 'ring' | 'ball' | 'bit';
const BG = new THREE.Color(0x6aa9b4);

/** one InstancedMesh with simple particle bookkeeping (cheap on phones: 4 draw calls for all effects) */
class Pool {
  mesh: THREE.InstancedMesh;
  n: number;
  x: Float32Array; y: Float32Array; z: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; max: Float32Array; s0: Float32Array; grow: Float32Array; grav: Float32Array; spin: Float32Array;
  col: THREE.Color[];
  alive: Uint8Array;
  cursor = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene, public shape: Shape, n: number, geo: THREE.BufferGeometry, opacity: number) {
    this.n = n;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: opacity < 1, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.s0 = new Float32Array(n);
    this.grow = new Float32Array(n); this.grav = new Float32Array(n); this.spin = new Float32Array(n);
    this.col = Array.from({ length: n }, () => new THREE.Color(1, 1, 1));
    this.alive = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.c.setRGB(1, 1, 1));
    }
    scene.add(this.mesh);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: number, grow = 0, grav = 0) {
    const i = this.cursor++ % this.n;
    this.alive[i] = 1;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = this.max[i] = life;
    this.s0[i] = size; this.grow[i] = grow; this.grav[i] = grav;
    this.spin[i] = Math.random() * 6;
    this.col[i].setHex(color);
  }

  update(dt: number, t: number, water: Water) {
    const flat = this.shape === 'disc' || this.shape === 'ring';
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      const k = this.life[i] / this.max[i]; // 1 -> 0
      this.vy[i] -= this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      let size = this.s0[i] * (1 + this.grow[i] * (1 - k));
      let y = this.y[i];
      if (flat) {
        y = water.h(this.x[i], this.z[i], t) + 0.06;
        this.vx[i] *= 1 - 0.8 * dt;
        this.vz[i] *= 1 - 0.8 * dt;
      } else if (this.shape === 'bit' && this.y[i] < 0.05 && this.grav[i] > 0) {
        // plastic bits float on the surface
        this.y[i] = 0.05;
        this.vy[i] = 0;
        this.vx[i] *= 1 - 1.5 * dt;
        this.vz[i] *= 1 - 1.5 * dt;
        y = water.h(this.x[i], this.z[i], t) + 0.05;
      } else if (this.shape === 'ball' && this.grav[i] > 0 && this.y[i] < 0) {
        this.alive[i] = 0;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      } else if (this.shape === 'ball' && this.grav[i] <= 0 && this.vy[i] > 0 && this.y[i] > 0.05 && this.s0[i] < 0.2) {
        // bubbles pop at the surface
        this.alive[i] = 0;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      if (this.shape === 'ball' || this.shape === 'bit') size *= 0.4 + 0.6 * Math.min(1, k * 3);
      this.p.set(this.x[i], y, this.z[i]);
      if (flat) this.e.set(-Math.PI / 2, 0, 0);
      else this.e.set(this.spin[i] + t * 3, this.spin[i], 0);
      this.q.setFromEuler(this.e);
      this.s.set(size, size, size);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      // fade toward water colour (cheap alpha substitute)
      this.c.copy(this.col[i]).lerp(BG, flat ? 1 - Math.min(1, k * 1.4) : (1 - k) * 0.35);
      this.mesh.setColorAt(i, this.c);
    }
  }

  flush() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Fx {
  disc: Pool;
  ring: Pool;
  ball: Pool;
  bit: Pool;

  constructor(scene: THREE.Scene, mobile: boolean) {
    const k = mobile ? 0.6 : 1;
    this.disc = new Pool(scene, 'disc', Math.floor(260 * k), new THREE.CircleGeometry(0.5, 10), 0.55);
    this.ring = new Pool(scene, 'ring', Math.floor(90 * k), new THREE.RingGeometry(0.38, 0.5, 18), 0.8);
    this.ball = new Pool(scene, 'ball', Math.floor(260 * k), new THREE.SphereGeometry(0.5, 5, 4), 0.85);
    this.bit = new Pool(scene, 'bit', Math.floor(90 * k), new THREE.BoxGeometry(1, 0.6, 1), 1);
  }

  /** wake / foam patch on the surface */
  foam(x: number, z: number, size: number, life: number, color = 0xffffff, vx = 0, vz = 0) {
    this.disc.spawn(x, 0, z, vx, 0, vz, size, life, color, 1.2);
  }
  ripple(x: number, z: number, size: number, grow: number, life: number, color = 0xffffff) {
    this.ring.spawn(x, 0, z, 0, 0, 0, size, life, color, grow);
  }
  drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color = 0xdff6ff) {
    this.ball.spawn(x, y, z, vx, vy, vz, size, life, color, 0, 16);
  }
  bubble(x: number, y: number, z: number, size = 0.12, life = 1.6) {
    this.ball.spawn(x, y, z, (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4, size, life, 0xe8fbff, 0, 0);
  }
  smoke(x: number, y: number, z: number, size = 0.4, life = 1.4, color = 0x555a60) {
    this.ball.spawn(x, y, z, (Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5, size, life, color, 1.6, -0.2);
  }
  bits(x: number, y: number, z: number, n: number, color: number, speed = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.bit.spawn(x, y, z, Math.cos(a) * s, 2.5 + Math.random() * speed, Math.sin(a) * s, 0.1 + Math.random() * 0.14, 2.4 + Math.random() * 2, color, 0, 14);
    }
  }
  /** a splash: droplets + ring (+ white column for ranging feedback) */
  splash(x: number, z: number, big: number) {
    const n = Math.floor(5 + 6 * big);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 1.4 * big;
      this.drop(x, 0.1, z, Math.cos(a) * s, 3 + Math.random() * 3 * big, Math.sin(a) * s, 0.12 + 0.1 * big * Math.random(), 1.1);
    }
    this.ripple(x, z, 0.5, 5 * big + 2, 1.4);
    this.foam(x, z, 0.8 * big + 0.4, 1.2);
  }

  update(dt: number, t: number, water: Water) {
    this.disc.update(dt, t, water);
    this.ring.update(dt, t, water);
    this.ball.update(dt, t, water);
    this.bit.update(dt, t, water);
  }
  flush() {
    this.disc.flush();
    this.ring.flush();
    this.ball.flush();
    this.bit.flush();
  }
  dispose() {
    for (const p of [this.disc, this.ring, this.ball, this.bit]) {
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
      p.mesh.dispose();
      p.mesh.removeFromParent();
    }
  }
}
