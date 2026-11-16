import * as THREE from 'three';

interface P {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number; max: number; grav: number; grow: number;
}

export class Particles {
  private pool: P[] = [];
  private geo = new THREE.BoxGeometry(1, 1, 1);
  private mats = new Map<number, THREE.MeshBasicMaterial>();
  private i = 0;

  constructor(scene: THREE.Scene, size = 160) {
    for (let k = 0; k < size; k++) {
      const m = new THREE.Mesh(this.geo, this.mat(0xffffff));
      m.visible = false;
      scene.add(m);
      this.pool.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, max: 1, grav: 0, grow: 0 });
    }
  }

  private mat(color: number) {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
      this.mats.set(color, m);
    }
    return m;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life: number, size: number, grav = 20, grow = 0) {
    const p = this.pool[this.i++ % this.pool.length];
    p.mesh.material = this.mat(color);
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(size);
    p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    p.mesh.visible = true;
    Object.assign(p, { vx, vy, vz, life, max: life, grav, grow });
  }

  burst(x: number, y: number, z: number, n: number, color: number, speed: number, size = 0.15, life = 0.9) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, z, Math.cos(a) * s, 2 + Math.random() * speed, Math.sin(a) * s, color, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8));
    }
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.vy -= p.grav * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vy = -p.vy * 0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.mesh.rotation.x += dt * 5;
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt);
    }
  }
}
