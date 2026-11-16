import * as THREE from 'three';
import { type LevelCfg, isWaterFn } from './levels';
import { type Hazard, type Target, targetPos } from './physics';

/** visual scale of the rocket (the real one is a 30 cm bottle; a bigger model reads better on a phone) */
export const VS = 2.4;
const UP = new THREE.Vector3(0, 1, 0);
const lam = (color: number, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...o });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}
function labelSprite(text: string, color = '#fff', size = 3) {
  const t = canvasTex(256, 128, (g) => {
    g.font = 'bold 76px "Black Han Sans", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.strokeText(text, 128, 64);
    g.fillStyle = color;
    g.fillText(text, 128, 64);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(size, size / 2, 1);
  return s;
}
const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
const bx = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};

export const FLAG_COLORS = [0xff5252, 0xffc107, 0x40c4ff, 0xb388ff, 0xff80ab];

// ------------------------------------------------------------------ rocket model
export class RocketModel {
  readonly root = new THREE.Group();
  readonly rig = new THREE.Group();
  private water: THREE.Mesh;
  fill = 0.3;

  constructor(color: number) {
    const bottle = lam(0x9fd8ff, { transparent: true, opacity: 0.5 });
    const col = lam(color);
    const body = cyl(0.045 * VS, 0.045 * VS, 0.28 * VS, bottle, 10);
    body.position.y = 0.19 * VS;
    const neck = cyl(0.045 * VS, 0.014 * VS, 0.05 * VS, bottle, 10);
    neck.position.y = 0.025 * VS;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.047 * VS, 0.17 * VS, 10), col);
    nose.position.y = (0.33 + 0.085) * VS;
    const ring = cyl(0.048 * VS, 0.048 * VS, 0.02 * VS, col, 10);
    ring.position.y = 0.335 * VS;
    this.water = new THREE.Mesh(new THREE.CylinderGeometry(0.041 * VS, 0.041 * VS, 1, 10), lam(0x1e88e5));
    this.rig.add(body, neck, nose, ring, this.water);
    for (let i = 0; i < 4; i++) {
      const fin = bx(0.008 * VS, 0.13 * VS, 0.085 * VS, col, 0, 0.1 * VS, 0.07 * VS);
      const a = new THREE.Group();
      a.rotation.y = (i * Math.PI) / 2;
      a.add(fin);
      this.rig.add(a);
    }
    this.rig.position.y = -0.25 * VS;
    this.root.add(this.rig);
    this.setFill(0.3);
  }
  /** fraction of the bottle volume that is water (0..1) */
  setFill(f: number) {
    this.fill = f;
    const h = Math.max(0.001, f * 0.28 * VS);
    this.water.scale.y = h;
    this.water.position.y = (0.05 + 0.0) * VS + h / 2;
    this.water.visible = f > 0.004;
  }
  orient(dx: number, dy: number, dz: number) {
    this.root.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).normalize());
  }
}

// ------------------------------------------------------------------ people / cars
function person(shirt: number, tall: number, tie = false): THREE.Group {
  const g = new THREE.Group();
  const skin = lam(0xf1c7a0);
  const legs = bx(0.34 * tall, 0.8 * tall, 0.22 * tall, lam(0x35435a), 0, 0.4 * tall, 0);
  const torso = bx(0.42 * tall, 0.6 * tall, 0.24 * tall, lam(shirt), 0, 1.1 * tall, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17 * tall, 8, 6), skin);
  head.position.y = 1.6 * tall;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.18 * tall, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x201a14));
  hair.position.y = 1.64 * tall;
  g.add(legs, torso, head, hair);
  for (const s of [-1, 1]) g.add(bx(0.1 * tall, 0.55 * tall, 0.1 * tall, lam(shirt), s * 0.28 * tall, 1.1 * tall, 0));
  if (tie) g.add(bx(0.07, 0.35 * tall, 0.03, lam(0xc62828), 0, 1.15 * tall, 0.13 * tall));
  return g;
}
function ponyCar(): THREE.Group {
  const g = new THREE.Group();
  const paint = lam(0xe8d36a);
  g.add(bx(1.7, 0.55, 4.0, paint, 0, 0.55, 0));
  g.add(bx(1.5, 0.5, 2.0, lam(0xdfc95c), 0, 1.05, 0.2));
  g.add(bx(1.42, 0.38, 1.9, lam(0x384a5a), 0, 1.07, 0.2));
  for (const sx of [-1, 1]) for (const sz of [-1.3, 1.3]) {
    const w = cyl(0.33, 0.33, 0.22, lam(0x151515), 10);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 0.86, 0.33, sz);
    g.add(w);
  }
  g.add(bx(0.3, 0.12, 0.05, lam(0xfff3b0), -0.55, 0.62, -2.01), bx(0.3, 0.12, 0.05, lam(0xfff3b0), 0.55, 0.62, -2.01));
  return g;
}

// ------------------------------------------------------------------ target meshes
function bullseye(radius: number, y = 0.03): THREE.Group {
  const g = new THREE.Group();
  const rings: [number, number][] = [[1, 0xf5f5f5], [0.667, 0x1e88e5], [0.417, 0xe53935], [0.25, 0xf5f5f5], [0.133, 0xe53935], [0.067, 0xffd600]];
  rings.forEach(([f, c], i) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(radius * f, 36), new THREE.MeshBasicMaterial({ color: c }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y + i * 0.012;
    g.add(m);
  });
  return g;
}

export interface TargetObj { group: THREE.Group; update(t: number): void }

function buildTarget(t: Target): TargetObj {
  const g = new THREE.Group();
  let update = (_: number) => {};
  const place = () => g.position.set(t.x, 0, t.z);
  switch (t.kind) {
    case 'ground':
      g.add(bullseye(12));
      break;
    case 'stage': {
      g.add(bullseye(12, 0.03));
      g.add(bx(7, t.top, 7, lam(0xc9c2b0), 0, t.top / 2, 0));
      g.add(bx(7.4, 0.12, 7.4, lam(0x8e8573), 0, t.top + 0.06, 0));
      const b = bullseye(3.2, t.top + 0.14);
      g.add(b);
      g.add(bx(7.2, 0.5, 0.2, lam(0x2e5e8c), 0, 0.6, 3.6));
      break;
    }
    case 'basin': {
      g.add(bullseye(7, 0.03));
      const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.65, t.top, 14, 1, true), new THREE.MeshLambertMaterial({ color: 0xe53935, side: THREE.DoubleSide }));
      tub.position.y = t.top / 2;
      const bot = new THREE.Mesh(new THREE.CircleGeometry(0.66, 14), lam(0xe53935));
      bot.rotation.x = -Math.PI / 2;
      bot.position.y = 0.02;
      const wat = new THREE.Mesh(new THREE.CircleGeometry(0.74, 14), new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }));
      wat.rotation.x = -Math.PI / 2;
      wat.position.y = t.top - 0.07;
      g.add(tub, bot, wat);
      break;
    }
    case 'cart': {
      const c = new THREE.Group();
      c.add(bx(1.5, 0.12, 2.4, lam(0x7a5230), 0, t.top, 0));
      for (const s of [-1, 1]) c.add(bx(0.08, 0.35, 2.4, lam(0x6a4526), s * 0.76, t.top + 0.2, 0));
      c.add(bx(1.5, 0.35, 0.08, lam(0x6a4526), 0, t.top + 0.2, -1.2));
      for (const s of [-1, 1]) {
        const w = cyl(0.42, 0.42, 0.1, lam(0x222222), 12);
        w.rotation.z = Math.PI / 2;
        w.position.set(s * 0.85, 0.42, 0.2);
        c.add(w);
        c.add(bx(0.06, 0.06, 1.3, lam(0x555555), s * 0.5, 0.9, 1.7));
      }
      c.add(bx(1.2, 0.07, 0.07, lam(0x555555), 0, 0.9, 2.3));
      const mark = new THREE.Mesh(new THREE.CircleGeometry(1.7, 20), new THREE.MeshBasicMaterial({ color: 0xffd600, transparent: true, opacity: 0.35 }));
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = 0.04;
      c.add(mark);
      g.add(c);
      update = (time) => {
        const [x] = targetPos(t, time);
        g.position.x = x;
        // face travel direction a bit
        const v = Math.cos((2 * Math.PI * time) / t.mov!.period + t.mov!.phase);
        c.rotation.y = v > 0 ? -Math.PI / 2 : Math.PI / 2;
      };
      break;
    }
    case 'roof': {
      g.add(bx(7, t.top - 0.15, 7, lam(0xd8d0c0), 0, (t.top - 0.15) / 2, 0));
      g.add(bx(7.4, 0.3, 7.4, lam(0x9a9a9a), 0, t.top - 0.15, 0));
      const win = canvasTex(64, 128, (c) => {
        c.fillStyle = '#d8d0c0';
        c.fillRect(0, 0, 64, 128);
        c.fillStyle = '#5f86a8';
        for (let y = 8; y < 120; y += 30) for (let x = 8; x < 60; x += 28) c.fillRect(x, y, 16, 18);
      }, [2, 1]);
      const wall = bx(7.02, t.top - 0.15, 7.02, new THREE.MeshLambertMaterial({ map: win }), 0, (t.top - 0.15) / 2, 0);
      g.add(wall);
      g.add(bullseye(2.4, t.top + 0.03));
      const tank = cyl(1.0, 1.0, 1.8, lam(0x8fa8b8), 12);
      tank.position.set(3.0, t.top + 1.0, -2.6);
      g.add(tank);
      g.add(bx(0.2, 1.4, 0.2, lam(0x666666), 3.0, t.top + 0.5, -2.6));
      break;
    }
    case 'ring': {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(t.hr * 0.9, 0.22, 8, 24), lam(0xff6d00));
      ring.rotation.x = -Math.PI / 2;
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(t.hr * 0.9, 0.23, 8, 24, Math.PI / 2), lam(0xffffff));
      ring2.rotation.x = -Math.PI / 2;
      const hold = new THREE.Group();
      hold.add(ring, ring2);
      hold.position.y = 0.1;
      g.add(hold);
      const rip = new THREE.Mesh(new THREE.RingGeometry(t.hr * 1.1, t.hr * 6, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide }));
      rip.rotation.x = -Math.PI / 2;
      rip.position.y = 0.04;
      g.add(rip);
      update = (time) => {
        hold.position.y = 0.1 + Math.sin(time * 2 + t.x) * 0.06;
        hold.rotation.z = Math.sin(time * 1.3) * 0.08;
      };
      break;
    }
  }
  place();
  return { group: g, update };
}

// ------------------------------------------------------------------ world
export class RocketWorld {
  readonly group = new THREE.Group();
  readonly rocket: RocketModel;
  readonly chute = new THREE.Group();
  private canopy: THREE.Mesh;
  private tube = new THREE.Group();
  private tubeMesh: THREE.Mesh;
  private post: THREE.Mesh;
  private hose: THREE.Line;
  private pumpHandle = new THREE.Group();
  private cordLine: THREE.Line;
  private cordHandle: THREE.Mesh;
  private sock = new THREE.Group();
  private sockCone = new THREE.Group();
  private targets: (TargetObj | null)[] = [];
  private hazards: THREE.Group[][] = [];
  private beacon: THREE.Mesh;
  private arrow: THREE.Mesh;
  readonly flags = new THREE.Group();
  readonly arc: THREE.Line;
  private arcN = 0;
  private arcMark: THREE.Mesh;
  readonly trail: THREE.Line;
  private trailN = 0;
  private aimLine: THREE.Line;
  private crowd: THREE.Group[] = [];
  private clouds: THREE.Mesh[] = [];
  private cur = -1;
  readonly water: (x: number, z: number) => boolean;
  private dir = new THREE.Vector3(0, 1, 0);

  constructor(private cfg: LevelCfg, mobile: boolean, color: number) {
    const g = this.group;
    this.water = isWaterFn(cfg);
    // lights
    g.add(new THREE.HemisphereLight(0xdff1ff, 0x6a8a55, 0.95));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.05);
    sun.position.set(-40, 80, 30);
    g.add(sun);

    if (cfg.scenery === 'school') this.buildSchool(mobile);
    else this.buildRiver(mobile);

    // clouds
    const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(30 + i * 3, 4, 14), cm);
      c.position.set(-220 + i * 55, 90 + (i % 3) * 18, -160 - (i % 4) * 40);
      g.add(c);
      this.clouds.push(c);
    }

    // distance posts (left of the field) for artillery ranging
    for (let d = 10; d <= 80; d += 10) {
      const p = cyl(0.08, 0.08, 1.6, lam(0xffffff), 6);
      p.position.set(-17, 0.8, -d);
      const s = labelSprite(d + 'm', '#fff', 3.2);
      s.position.set(-17, 2.4, -d);
      g.add(p, s);
      const r = new THREE.Mesh(new THREE.PlaneGeometry(34, 0.25), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
      r.rotation.x = -Math.PI / 2;
      r.position.set(0, 0.02, -d);
      if (!(cfg.riverZ && d > cfg.riverZ)) g.add(r);
    }

    // launcher ---------------------------------------------------------------
    const metal = lam(0x8a8f96);
    const base = cyl(0.55, 0.65, 0.1, lam(0x6b6f76), 12);
    base.position.y = 0.05;
    g.add(base);
    this.post = cyl(0.04, 0.04, 1, metal, 6);
    g.add(this.post);
    this.tubeMesh = cyl(0.07, 0.07, 0.9, lam(0xd0d4da), 8);
    this.tube.add(this.tubeMesh);
    g.add(this.tube);
    this.rocket = new RocketModel(color);
    g.add(this.rocket.root);
    // hose + pump
    const pump = new THREE.Group();
    pump.position.set(1.15, 0, 0.9);
    pump.add(bx(0.5, 0.05, 0.3, lam(0x37474f), 0, 0.025, 0));
    const barrel = cyl(0.06, 0.06, 0.7, lam(0xd32f2f), 10);
    barrel.position.y = 0.4;
    pump.add(barrel);
    const rod = cyl(0.015, 0.015, 0.6, lam(0xcfd8dc), 6);
    rod.position.y = 0.3;
    this.pumpHandle.add(rod, bx(0.34, 0.05, 0.06, lam(0x263238), 0, 0.62, 0));
    this.pumpHandle.position.y = 0.75;
    pump.add(this.pumpHandle);
    g.add(pump);
    const hg = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 14 }, () => new THREE.Vector3()));
    this.hose = new THREE.Line(hg, new THREE.LineBasicMaterial({ color: 0x212121 }));
    this.hose.frustumCulled = false;
    g.add(this.hose);
    // release cord
    this.cordLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffeb3b }));
    this.cordLine.frustumCulled = false;
    this.cordHandle = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), lam(0xffeb3b));
    g.add(this.cordLine, this.cordHandle);
    this.pull(0);

    // chute
    this.canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xff7043, side: THREE.DoubleSide }),
    );
    this.chute.add(this.canopy);
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3].flatMap((i) => [new THREE.Vector3(Math.cos((i * Math.PI) / 2), 0, Math.sin((i * Math.PI) / 2)), new THREE.Vector3(0, -1.6, 0)])),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    this.chute.add(lines);
    this.chute.visible = false;
    g.add(this.chute);

    // windsock
    const sp = cyl(0.05, 0.05, 4.2, lam(0xdddddd), 6);
    sp.position.set(-5, 2.1, 1.5);
    g.add(sp);
    this.sock.position.set(-5, 4.2, 1.5);
    const stripe = [0xff5722, 0xffffff, 0xff5722, 0xffffff];
    stripe.forEach((c, i) => {
      const seg = cyl(0.42 - i * 0.07, 0.5 - i * 0.07, 0.55, lam(c, { side: THREE.DoubleSide }), 8);
      seg.position.y = 0.28 + i * 0.55;
      this.sockCone.add(seg);
    });
    this.sockCone.rotation.z = -Math.PI / 2;
    this.sock.add(this.sockCone);
    g.add(this.sock);

    // pad crowd: classmates cheering on both sides
    const shirts = [0xe57373, 0x64b5f6, 0x81c784, 0xffd54f, 0xba68c8, 0x4db6ac];
    for (let i = 0; i < 6; i++) {
      const p = person(shirts[i]!, 0.78);
      p.position.set((i < 3 ? -1 : 1) * (6 + (i % 3) * 1.4), 0, 2 + (i % 2) * 1.5);
      p.rotation.y = Math.PI + (i < 3 ? 0.3 : -0.3);
      g.add(p);
      this.crowd.push(p);
    }
    const teacher = person(0x6d4c41, 1.0, true);
    teacher.position.set(-9.5, 0, 3.5);
    teacher.rotation.y = Math.PI + 0.4;
    g.add(teacher, labelSpriteAt('선생님', -9.5, 2.5, 3.5));
    this.crowd.push(teacher);

    // aim line, arc, trail, markers
    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.05, -90)]), new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, dashSize: 1, gapSize: 1.2 }));
    this.aimLine.computeLineDistances();
    this.aimLine.frustumCulled = false;
    g.add(this.aimLine);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(200 * 3), 3));
    this.arc = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({ color: 0xfff176, transparent: true, opacity: 0.8, dashSize: 0.7, gapSize: 0.5 }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    g.add(this.arc);
    this.arcMark = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.8, 20), new THREE.MeshBasicMaterial({ color: 0xfff176, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    this.arcMark.rotation.x = -Math.PI / 2;
    this.arcMark.visible = false;
    g.add(this.arcMark);
    const trGeo = new THREE.BufferGeometry();
    trGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900 * 3), 3));
    this.trail = new THREE.Line(trGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.trail.frustumCulled = false;
    g.add(this.trail);
    g.add(this.flags);

    // beacon on the current target
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 40, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.28, depthWrite: false, fog: false }));
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 8), new THREE.MeshBasicMaterial({ color: 0xffeb3b }));
    this.arrow.rotation.x = Math.PI;
    g.add(this.beacon, this.arrow);
    this.setAim(0, Math.PI / 4);
  }

  // -------------------------------------------------------------- scenery
  private buildSchool(mobile: boolean) {
    const g = this.group;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), lam(0x74b255));
    grass.rotation.x = -Math.PI / 2;
    g.add(grass);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), lam(0xd9c28b));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0.01, 2);
    g.add(sand);
    // building
    const tex = canvasTex(256, 64, (c) => {
      c.fillStyle = '#ece3c8';
      c.fillRect(0, 0, 256, 64);
      c.fillStyle = '#7aa7c7';
      for (let x = 6; x < 250; x += 22) for (const y of [8, 36]) c.fillRect(x, y, 14, 18);
    }, [3, 1]);
    const b = bx(150, 16, 20, new THREE.MeshLambertMaterial({ map: tex }), 0, 8, -170);
    g.add(b);
    g.add(bx(14, 26, 14, lam(0xe0d4b4), 40, 13, -160));
    const pole = cyl(0.12, 0.12, 12, lam(0xcccccc), 6);
    pole.position.set(-50, 6, -120);
    const flag = bx(4, 2.4, 0.1, lam(0xffffff), -48, 10.5, -120);
    g.add(pole, flag);
    // soccer goals
    for (const gx of [-30, 30]) {
      g.add(bx(0.2, 2.4, 0.2, lam(0xffffff), gx - 3.6, 1.2, -112), bx(0.2, 2.4, 0.2, lam(0xffffff), gx + 3.6, 1.2, -112), bx(7.4, 0.2, 0.2, lam(0xffffff), gx, 2.4, -112));
    }
    // trees
    const n = mobile ? 26 : 44;
    const trunk = lam(0x6d4c41);
    const leaf = [lam(0x3f8f3f), lam(0x4f9f45), lam(0x35813b)];
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (38 + ((i * 37) % 55));
      const z = 30 - ((i * 53) % 190);
      const t = new THREE.Group();
      const h = 4 + ((i * 7) % 5);
      const tr = cyl(0.3, 0.4, h, trunk, 6);
      tr.position.y = h / 2;
      const top = new THREE.Mesh(new THREE.ConeGeometry(2.6 + (i % 3) * 0.4, 6, 7), leaf[i % 3]);
      top.position.y = h + 2.4;
      t.add(tr, top);
      t.position.set(x, 0, z);
      g.add(t);
    }
    // fence
    for (const sx of [-1, 1]) g.add(bx(0.2, 1.6, 200, lam(0x9aa5ab), sx * 36, 0.8, -60));
  }

  private buildRiver(mobile: boolean) {
    const g = this.group;
    const zr = this.cfg.riverZ ?? 57;
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(900, zr + 120), lam(0x7ab85a));
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(0, 0, (120 - zr) / 2);
    g.add(bank);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(900, 5), lam(0xb8b4a8));
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.02, 14);
    g.add(path);
    const river = new THREE.Mesh(new THREE.PlaneGeometry(900, 360), new THREE.MeshLambertMaterial({ color: 0x4a82a8 }));
    river.rotation.x = -Math.PI / 2;
    river.position.set(0, -0.12, -zr - 180);
    g.add(river);
    g.add(bx(900, 0.8, 1.4, lam(0xa8a8a0), 0, 0.2, -zr + 0.7));
    const far = new THREE.Mesh(new THREE.PlaneGeometry(900, 120), lam(0x6a9a55));
    far.rotation.x = -Math.PI / 2;
    far.position.set(0, 0, -zr - 360 - 60);
    g.add(far);
    // apartment skyline
    const wt = canvasTex(64, 128, (c) => {
      c.fillStyle = '#d9dde0';
      c.fillRect(0, 0, 64, 128);
      c.fillStyle = '#8aa4b8';
      for (let y = 6; y < 124; y += 12) for (let x = 6; x < 60; x += 14) c.fillRect(x, y, 8, 7);
    }, [1, 2]);
    const n = mobile ? 9 : 14;
    for (let i = 0; i < n; i++) {
      const h = 40 + ((i * 29) % 50);
      g.add(bx(22, h, 14, new THREE.MeshLambertMaterial({ map: wt }), -160 + i * (320 / n) + ((i * 13) % 9), h / 2, -zr - 380 - ((i * 17) % 30)));
    }
    // bridge
    g.add(bx(700, 2, 16, lam(0xb0b6bc), 0, 16, -zr - 160));
    for (let x = -300; x <= 300; x += 75) g.add(bx(5, 16, 6, lam(0x9aa0a6), x, 8, -zr - 160));
    // boat + trees
    const boat = new THREE.Group();
    boat.add(bx(2.2, 0.7, 6, lam(0xeeeeee), 0, 0.2, 0), bx(1.4, 1, 2, lam(0x90a4ae), 0, 1, -0.5));
    boat.position.set(24, 0, -zr - 40);
    g.add(boat);
    for (let i = 0; i < (mobile ? 12 : 22); i++) {
      const side = i % 2 ? 1 : -1;
      const t = new THREE.Group();
      const tr = cyl(0.25, 0.35, 3, lam(0x6d4c41), 6);
      tr.position.y = 1.5;
      const top = new THREE.Mesh(new THREE.SphereGeometry(2.2, 7, 5), lam(0x4d9a4a));
      top.position.y = 4.2;
      t.add(tr, top);
      t.position.set(side * (30 + ((i * 41) % 60)), 0, 30 - ((i * 23) % 70));
      g.add(t);
    }
  }

  // -------------------------------------------------------------- targets
  ensureTarget(i: number, t: Target, hazards: Hazard[]) {
    if (this.targets[i]) return;
    const o = buildTarget(t);
    this.targets[i] = o;
    this.group.add(o.group);
    this.hazards[i] = hazards.map((h) => {
      const m = h.kind === 'pony' ? ponyCar() : h.kind === 'teacher' ? person(0x5d4037, 1.05, true) : person(0xef5350, 0.8);
      m.position.set(h.x, 0, h.z);
      m.rotation.y = h.kind === 'pony' ? Math.PI / 2 + 0.2 : Math.PI;
      m.visible = false;
      this.group.add(m);
      return m;
    });
  }
  setCurrent(i: number, t: Target) {
    this.cur = i;
    this.targets.forEach((o, k) => {
      if (o) o.group.visible = k <= i;
    });
    this.hazards.forEach((hs, k) => hs.forEach((m) => (m.visible = k === i)));
    this.beacon.position.set(t.x, 20, t.z);
    this.arrow.position.set(t.x, t.top + 5, t.z);
  }
  hazardMesh(i: number, k: number) {
    return this.hazards[i]?.[k];
  }
  updateTargets(time: number) {
    this.targets.forEach((o) => o?.update(time));
    const t = this.cur;
    if (t >= 0 && this.targets[t]) {
      const p = this.targets[t]!.group.position;
      this.beacon.position.x = p.x;
      this.arrow.position.x = p.x;
      this.arrow.position.y = (this.arrow.position.y * 0 + 5.2) + Math.sin(time * 4) * 0.5;
    }
    this.clouds.forEach((c, i) => {
      c.position.x += 0.01 * (1 + (i % 3));
      if (c.position.x > 280) c.position.x = -280;
    });
  }
  currentGroup() {
    return this.targets[this.cur]?.group ?? null;
  }
  showBeacon(v: boolean) {
    this.beacon.visible = v;
    this.arrow.visible = v;
  }

  // -------------------------------------------------------------- launcher
  setAim(yaw: number, pitch: number) {
    const c = Math.cos(pitch);
    const d = this.dir.set(Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
    const piv = new THREE.Vector3(0, 0.9, 0);
    this.tube.position.copy(piv).addScaledVector(d, -0.45 - 0.05);
    this.tube.quaternion.setFromUnitVectors(UP, d);
    this.post.scale.y = Math.max(0.05, this.tube.position.y);
    this.post.position.set(this.tube.position.x, this.post.scale.y / 2, this.tube.position.z);
    const base = new THREE.Vector3().copy(piv).addScaledVector(d, -0.95);
    // cord from the trigger at the tube base to a handle at the camera side
    this.cordBase = base;
    this.updateCord();
    // hose from the pump to the tube base
    const a = new THREE.Vector3(1.15, 0.75, 0.9);
    const m = new THREE.Vector3((a.x + base.x) / 2, 0.15, (a.z + base.z) / 2 + 0.4);
    const pts = new THREE.QuadraticBezierCurve3(a, m, base).getPoints(13);
    (this.hose.geometry as THREE.BufferGeometry).setFromPoints(pts);
    this.aimLine.rotation.y = -yaw;
    if (this.rocketOnPad) this.restRocketOnPad();
  }
  private cordBase = new THREE.Vector3();
  private cordPull = 0;
  rocketOnPad = true;
  private updateCord() {
    const h = new THREE.Vector3(-0.9 + this.cordPull * 0.0, 0.1, 3.2 + this.cordPull * 1.0);
    this.cordHandle.position.copy(h);
    (this.cordLine.geometry as THREE.BufferGeometry).setFromPoints([this.cordBase, h]);
  }
  pull(v: number) {
    this.cordPull = v;
    this.updateCord();
  }
  restRocketOnPad() {
    this.rocketOnPad = true;
    this.rocket.root.position.set(0, 0.9, 0);
    this.rocket.orient(this.dir.x, this.dir.y, this.dir.z);
    this.rocket.root.visible = true;
  }
  get aimDir() {
    return this.dir;
  }
  setPump(phase: number) {
    this.pumpHandle.position.y = 0.75 - 0.3 * (0.5 + 0.5 * Math.sin(phase));
  }
  setWind(wx: number, wz: number) {
    const s = Math.hypot(wx, wz);
    this.sock.rotation.y = Math.atan2(-wz, wx);
    const lift = Math.min(1, s / 6);
    this.sockCone.rotation.z = -Math.PI / 2 - (1 - lift) * 1.15 + Math.sin(performance.now() / 120) * 0.04 * lift;
  }
  setChute(on: boolean, open: number, x: number, y: number, z: number) {
    this.chute.visible = on;
    if (!on) return;
    const s = 0.2 + 0.8 * open;
    this.chute.scale.set(s * 1.1, s * (0.6 + 0.4 * open), s * 1.1);
    this.chute.position.set(x, y + 1.6 * s * VS * 0.55, z);
  }

  // -------------------------------------------------------------- overlays
  setArc(points: number[] | null, landing: [number, number] | null) {
    if (!points || points.length < 6) {
      this.arc.visible = false;
      this.arcMark.visible = false;
      return;
    }
    const n = Math.min(200, points.length / 3);
    const a = this.arc.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) a.setXYZ(i, points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
    this.arc.geometry.setDrawRange(0, n);
    a.needsUpdate = true;
    this.arc.computeLineDistances();
    this.arcN = n;
    this.arc.visible = true;
    if (landing) {
      this.arcMark.position.set(landing[0], 0.08, landing[1]);
      this.arcMark.visible = true;
    }
  }
  get arcCount() {
    return this.arcN;
  }
  showAim(v: boolean) {
    this.aimLine.visible = v;
  }
  clearTrail() {
    this.trailN = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }
  pushTrail(x: number, y: number, z: number) {
    if (this.trailN >= 900) return;
    const a = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    a.setXYZ(this.trailN++, x, y, z);
    a.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailN);
  }
  addFlag(n: number, x: number, z: number, y = 0, burst = false) {
    const c = FLAG_COLORS[(n - 1) % FLAG_COLORS.length]!;
    const f = new THREE.Group();
    const pole = cyl(0.04, 0.04, 3, lam(0xeeeeee), 5);
    pole.position.y = 1.5;
    const cloth = bx(1.1, 0.7, 0.04, new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }), 0.55, 2.6, 0);
    f.add(pole, cloth);
    const s = labelSprite(burst ? '펑' : String(n), '#fff', 1.7);
    s.position.set(0.55, 3.5, 0);
    f.add(s);
    f.position.set(x, y, z);
    this.flags.add(f);
    return f;
  }
  clearFlags() {
    while (this.flags.children.length) this.flags.remove(this.flags.children[0]!);
  }
  crowdHop(t: number) {
    this.crowd.forEach((p, i) => (p.position.y = Math.max(0, Math.sin(t * 9 + i * 1.7)) * 0.25));
  }
  crowdRest() {
    this.crowd.forEach((p) => (p.position.y = 0));
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const mm of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        (mm as THREE.MeshBasicMaterial).map?.dispose();
        mm.dispose();
      }
    });
  }
}

function labelSpriteAt(text: string, x: number, y: number, z: number) {
  const s = labelSprite(text, '#ffe9a8', 2.2);
  s.position.set(x, y, z);
  return s;
}
