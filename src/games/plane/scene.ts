import * as THREE from 'three';
import { makeSolids, makeTrees, type LevelCfg, type Solid, type ThrowEnv, type Tree } from './levels';
import type { Hazard, PlaneSpec } from './physics';

const lam = (color: number, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...o });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
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
function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number, light = true) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${a * Math.random()})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}
function labelTex(text: string, color = '#fff', font = 'bold 84px "Black Han Sans", sans-serif', w = 384, h = 160, bg = '') {
  return canvasTex(w, h, (g) => {
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
    }
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.strokeText(text, w / 2, h / 2);
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);
  });
}
function cell(x: number, y: number, z: number, w: number, h: number, d: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

export interface PlaneModel { root: THREE.Group; prop: THREE.Group; bandMesh: THREE.Mesh }

export function buildPlane(color: number, spec: PlaneSpec): PlaneModel {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const inner = new THREE.Group();
  root.add(inner);
  const balsa = lam(0xe0b878);
  const paper = lam(0xfdfdf5, { side: THREE.DoubleSide });
  const accent = lam(color, { side: THREE.DoubleSide });
  const sx = spec.id === 'gull' ? 1.3 : spec.id === 'bolt' ? 0.82 : 1;
  const chord = spec.id === 'gull' ? 0.12 : spec.id === 'bolt' ? 0.15 : 0.13;
  inner.add(cell(0, 0, 0.0, 0.014, 0.014, 0.5, balsa));
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.02, 0.012, -0.05);
    w.rotation.z = s * 0.1;
    w.add(cell(s * 0.13 * sx, 0, 0, 0.26 * sx, 0.004, chord, paper));
    w.add(cell(s * 0.23 * sx, 0.001, 0, 0.1 * sx, 0.005, chord + 0.002, accent));
    w.add(cell(s * 0.13 * sx, 0.003, -chord / 2 + 0.01, 0.26 * sx, 0.006, 0.012, balsa));
    inner.add(w);
  }
  inner.add(cell(0, 0.003, 0.235, 0.2, 0.003, 0.07, paper));
  inner.add(cell(0, 0.003, 0.235, 0.05, 0.004, 0.071, accent));
  inner.add(cell(0, 0.038, 0.235, 0.004, 0.07, 0.08, accent));
  inner.add(cell(0, -0.003, -0.255, 0.03, 0.03, 0.04, lam(0x444444)));
  const band = cell(0, -0.016, -0.02, 0.004, 0.004, 0.46, lam(0xd8a23a));
  inner.add(band);
  const prop = new THREE.Group();
  prop.position.set(0, -0.003, -0.285);
  prop.add(cell(0, 0, 0, 0.23, 0.014, 0.02, lam(0x222222)));
  prop.add(cell(0, 0, 0, 0.02, 0.02, 0.02, lam(0xffcc33)));
  inner.add(prop);
  inner.scale.setScalar(3);
  return { root, prop, bandMesh: band };
}

export interface Kid { g: THREE.Group; armL: THREE.Mesh; armR: THREE.Mesh; baseY: number; phase: number }

function figure(shirt: number, pants: number, h: number, cap: number | null, tall = false): Kid {
  const g = new THREE.Group();
  const skin = lam(0xf1c7a0);
  const sc = h / 1.25;
  const body = cell(0, 0.78 * sc, 0, 0.36 * sc, 0.46 * sc, 0.2 * sc, lam(shirt));
  g.add(body);
  g.add(cell(-0.09 * sc, 0.28 * sc, 0, 0.14 * sc, 0.56 * sc, 0.16 * sc, lam(pants)));
  g.add(cell(0.09 * sc, 0.28 * sc, 0, 0.14 * sc, 0.56 * sc, 0.16 * sc, lam(pants)));
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15 * sc, 1), skin);
  head.position.y = 1.15 * sc;
  g.add(head);
  g.add(cell(0, 1.27 * sc, 0.0, 0.3 * sc, 0.06 * sc, 0.3 * sc, lam(cap ?? 0x151515)));
  if (cap !== null) g.add(cell(0, 1.24 * sc, -0.17 * sc, 0.26 * sc, 0.03 * sc, 0.12 * sc, lam(cap)));
  const mkArm = (s: number) => {
    const piv = new THREE.Group();
    piv.position.set(s * 0.24 * sc, 0.98 * sc, 0);
    const a = cell(0, -0.2 * sc, 0, 0.09 * sc, 0.42 * sc, 0.09 * sc, tall ? lam(shirt) : skin);
    piv.add(a);
    g.add(piv);
    return a;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  return { g, armL, armR, baseY: 0, phase: Math.random() * 6 };
}

export class SchoolWorld {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private kids: Kid[] = [];
  private teacher: Kid;
  private teacherTape: THREE.Group;
  private tape: THREE.Mesh;
  private distLabel: THREE.Sprite;
  private flagCloth: THREE.Mesh;
  private sockPivot: THREE.Group;
  private sock: THREE.Mesh;
  private dust: THREE.Points;
  private dustPos: Float32Array;
  private dustSeed: Float32Array;
  private envGroup = new THREE.Group();
  private thermalViz: { mesh: THREE.Mesh; tex: THREE.Texture; birds: THREE.Group[]; r: number; x: number; z: number; up: boolean }[] = [];
  private ballMeshes = new Map<number, THREE.Object3D>();
  private clouds: THREE.Mesh[] = [];
  private cheerT = 0;
  private tapeT = 0;
  private tapeLen = 0;
  readonly solids: Solid[];
  readonly trees: Tree[];
  private shadow: THREE.Mesh;
  private ballGeo = new THREE.IcosahedronGeometry(0.28, 1);
  private ballMat: THREE.Material;
  private pigeonProto: THREE.Group;

  constructor(readonly cfg: LevelCfg, mobile: boolean) {
    const g = this.group;
    this.solids = makeSolids(cfg);
    this.trees = makeTrees(cfg);
    const tz = cfg.treeZ;
    const storm = cfg.stormy;

    // lights
    g.add(new THREE.HemisphereLight(storm ? 0xaab4c8 : 0xd6ecff, storm ? 0x6d6a60 : 0xb09a68, storm ? 1.15 : 1.25));
    this.sun = new THREE.DirectionalLight(storm ? 0xdfe3ea : 0xfff1d0, storm ? 1.0 : 1.7);
    this.sun.position.set(-30, 60, 25);
    g.add(this.sun);

    // sky dome
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(520, 16, 10),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color(storm ? 0x4c5772 : 0x3d8fe0) }, bot: { value: new THREE.Color(cfg.fog) } },
        vertexShader: 'varying float h;void main(){h=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'uniform vec3 top;uniform vec3 bot;varying float h;void main(){gl_FragColor=vec4(mix(bot,top,clamp(pow(max(h,0.),0.6),0.,1.)),1.);}',
      }),
    );
    g.add(sky);

    // ground: grass, sand yard, road
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), lam(storm ? 0x5f7a4c : 0x7cae52));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    g.add(grass);
    const sandTex = canvasTex(256, 256, (c) => {
      c.fillStyle = '#d2b484';
      c.fillRect(0, 0, 256, 256);
      speckle(c, 256, 256, 2600, 0.5);
      speckle(c, 256, 256, 1600, 0.25, false);
    }, [6, Math.abs(tz) / 12 + 3]);
    const ylen = 22 + Math.abs(tz) + 10;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(72, ylen), lam(0xffffff, { map: sandTex }));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(0, 0, 18 - ylen / 2);
    g.add(yard);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(500, 300), lam(0x55575c));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, -0.01, tz - 7 - 150);
    g.add(road);

    // chalk lines + distance labels
    const chalk = lam(0xffffff);
    for (let d = 10; d < Math.abs(tz) - 4; d += 10) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(68, 0.22), chalk);
      l.rotation.x = -Math.PI / 2;
      l.position.set(0, 0.015, -d);
      g.add(l);
      for (const sx of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.4), new THREE.MeshBasicMaterial({ map: labelTex(`${d}m`, '#fff', 'bold 90px "Black Han Sans", sans-serif', 256, 128), transparent: true, depthWrite: false }));
        t.rotation.x = -Math.PI / 2;
        t.position.set(sx * 13, 0.02, -d + 1.6);
        g.add(t);
      }
    }
    const start = new THREE.Mesh(new THREE.PlaneGeometry(68, 0.5), lam(0xe53935));
    start.rotation.x = -Math.PI / 2;
    start.position.set(0, 0.02, 0);
    g.add(start);
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.4), new THREE.MeshBasicMaterial({ map: labelTex('출발선', '#ffeb3b', 'bold 76px "Black Han Sans", sans-serif', 256, 128), transparent: true, depthWrite: false }));
    sl.rotation.x = -Math.PI / 2;
    sl.position.set(5, 0.025, 1.8);
    g.add(sl);

    // static solids
    for (const s of this.solids) this.addSolid(s);

    // 철봉 grips, 골대 net
    const net = new THREE.Mesh(new THREE.PlaneGeometry(7.3, 2.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, wireframe: true }));
    net.position.set(0, 1.2, -63.0);
    g.add(net);

    // trees (instanced)
    const trunkG = new THREE.CylinderGeometry(0.28, 0.4, 1, 7);
    const crownG = new THREE.IcosahedronGeometry(1, 1);
    const trunks = new THREE.InstancedMesh(trunkG, lam(0xb8a98c), this.trees.length);
    const crowns = new THREE.InstancedMesh(crownG, lam(storm ? 0x4c7a3f : 0x58a03c), this.trees.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    this.trees.forEach((t, i) => {
      m4.compose(new THREE.Vector3(t.x, t.crownY / 2, t.z), q, new THREE.Vector3(1, t.crownY, 1));
      trunks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(t.x, t.crownY + t.crownH * 0.1, t.z), q, new THREE.Vector3(t.r, t.crownH, t.r));
      crowns.setMatrixAt(i, m4);
    });
    g.add(trunks, crowns);

    // school building windows front / apartments handled in addSolid. Banner + festival flags behind the thrower
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.2), new THREE.MeshBasicMaterial({ map: labelTex('제32회 과학의 날 · 고무동력기 대회', '#fff', 'bold 54px "Black Han Sans", sans-serif', 1024, 150, '#c62828'), side: THREE.DoubleSide }));
    banner.position.set(0, 4.2, 16.8);
    banner.rotation.y = Math.PI;
    g.add(banner);
    const flagCols = [0xe53935, 0xfdd835, 0x1e88e5, 0x43a047, 0xffffff, 0xfb8c00];
    for (let i = 0; i < 30; i++) {
      const x = -26 + i * 1.8;
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 3), lam(flagCols[i % flagCols.length], { side: THREE.DoubleSide }));
      f.position.set(x, 6.6 - Math.sin((x / 28) * Math.PI * 0.5 + 1.57) * 0.0 - 0.9 * Math.cos((x / 26) * 1.5), 14);
      f.rotation.x = Math.PI;
      g.add(f);
    }
    // 국기게양대 flag
    this.flagCloth = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.6, 1, 1),
      new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        map: canvasTex(96, 64, (c) => {
          c.fillStyle = '#fff';
          c.fillRect(0, 0, 96, 64);
          c.fillStyle = '#c62828';
          c.beginPath();
          c.arc(48, 32, 14, Math.PI, 0);
          c.fill();
          c.fillStyle = '#1e4fa2';
          c.beginPath();
          c.arc(48, 32, 14, 0, Math.PI);
          c.fill();
          c.fillStyle = '#222';
          for (const [x, y] of [[10, 10], [86, 10], [10, 54], [86, 54]]) c.fillRect(x - 5, y - 4, 10, 8);
        }),
      }),
    );
    this.flagCloth.geometry.translate(1.2, 0, 0);
    this.flagCloth.position.set(-16, 11, -40);
    g.add(this.flagCloth);
    // windsock near the start
    const pole = cell(4.5, 1.5, -6, 0.06, 3, 0.06, lam(0xcccccc));
    g.add(pole);
    this.sockPivot = new THREE.Group();
    this.sockPivot.position.set(4.5, 3, -6);
    this.sockPivot.rotation.order = 'YXZ';
    const sockGeo = new THREE.CylinderGeometry(0.34, 0.12, 1.5, 8, 1, true);
    sockGeo.rotateX(Math.PI / 2);
    sockGeo.translate(0, 0, -0.75);
    this.sock = new THREE.Mesh(
      sockGeo,
      new THREE.MeshLambertMaterial({
        side: THREE.DoubleSide,
        map: canvasTex(8, 64, (c) => {
          for (let i = 0; i < 4; i++) {
            c.fillStyle = i % 2 ? '#fff' : '#ff6d00';
            c.fillRect(0, i * 16, 8, 16);
          }
        }),
      }),
    );
    this.sockPivot.add(this.sock);
    g.add(this.sockPivot);

    // clouds + mountains
    const cloudMat = new THREE.MeshBasicMaterial({ color: storm ? 0x8e95a6 : 0xffffff, fog: false });
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), cloudMat);
      c.scale.set(26 + Math.random() * 22, 5 + Math.random() * 3, 12 + Math.random() * 8);
      c.position.set(-300 + Math.random() * 600, 80 + Math.random() * 60, -80 - Math.random() * 380);
      g.add(c);
      this.clouds.push(c);
    }
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(70 + Math.random() * 60, 90 + Math.random() * 60, 6), lam(i % 2 ? 0x6e8f78 : 0x5f8070));
      m.position.set(-420 + i * 120 + Math.random() * 40, 30, tz - 380 - Math.random() * 60);
      g.add(m);
    }

    // people
    const pal = [0xffffff, 0xfff176, 0x81d4fa, 0xef9a9a, 0xa5d6a7, 0xffcc80];
    const spots: [number, number][] = [[-3.4, 2.2], [-4.4, -0.8], [-5.4, 1.4], [-3.0, -3.6], [3.5, 1.8], [4.6, -1.0], [5.6, 2.5], [3.1, -4.2], [-6.4, -3], [6.6, -3.2]];
    spots.forEach(([x, z], i) => {
      const k = figure(pal[i % pal.length], i % 3 ? 0x1a237e : 0x37474f, 1.2 + (i % 4) * 0.05, i % 2 ? 0xfdd835 : null);
      k.g.position.set(x, 0, z);
      k.g.rotation.y = Math.atan2(-x * 0.3, -(0 - z) + 0.001) + Math.PI; // face the thrower/field
      k.g.rotation.y = x < 0 ? -0.8 : 0.8;
      g.add(k.g);
      this.kids.push(k);
    });
    this.teacher = figure(0x1565c0, 0x263238, 1.78, null, true);
    this.teacher.g.visible = false;
    g.add(this.teacher.g);
    this.teacherTape = new THREE.Group();
    this.teacherTape.add(cell(0, 0, 0, 0.18, 0.18, 0.06, lam(0xffd600)));
    this.teacherTape.position.set(-0.3, 1.0, -0.25);
    this.teacher.g.add(this.teacherTape);
    this.tape = cell(0, 0.04, 0, 0.06, 0.03, 1, lam(0xffd600));
    this.tape.visible = false;
    g.add(this.tape);
    const ls = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex('', '#fff'), transparent: true, depthTest: false }));
    ls.scale.set(8, 3, 1);
    ls.visible = false;
    ls.renderOrder = 10;
    this.distLabel = ls;
    g.add(ls);

    // blob shadow for the plane
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.visible = false;
    g.add(this.shadow);

    // dust / leaves
    const nd = mobile ? 90 : 170;
    this.dustPos = new Float32Array(nd * 3);
    this.dustSeed = new Float32Array(nd * 3);
    for (let i = 0; i < nd; i++) {
      this.dustSeed[i * 3] = Math.random();
      this.dustSeed[i * 3 + 1] = Math.random();
      this.dustSeed[i * 3 + 2] = Math.random();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: storm ? 0xd6e0a8 : 0xf0e2c0, size: storm ? 0.22 : 0.16, transparent: true, opacity: 0.8, depthWrite: false }));
    this.dust.frustumCulled = false;
    g.add(this.dust);

    g.add(this.envGroup);
    this.ballMat = new THREE.MeshLambertMaterial({
      map: canvasTex(64, 64, (c) => {
        c.fillStyle = '#fff';
        c.fillRect(0, 0, 64, 64);
        c.fillStyle = '#222';
        for (const [x, y] of [[16, 16], [48, 16], [32, 40], [8, 52], [56, 52]]) {
          c.beginPath();
          c.arc(x, y, 8, 0, 7);
          c.fill();
        }
      }),
    });
    const pg = new THREE.Group();
    pg.add(cell(0, 0, 0, 0.3, 0.2, 0.5, lam(0x8a8f9a)));
    pg.add(cell(0, 0.12, -0.28, 0.14, 0.14, 0.14, lam(0x6d7280)));
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.add(cell(s * 0.35, 0, 0, 0.7, 0.03, 0.35, lam(0xa5aab5)));
      w.name = s < 0 ? 'wl' : 'wr';
      pg.add(w);
    }
    this.pigeonProto = pg;
  }

  private addSolid(s: Solid) {
    const g = this.group;
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    const d = s.z1 - s.z0;
    const cx = (s.x0 + s.x1) / 2;
    const cy = (s.y0 + s.y1) / 2;
    const cz = (s.z0 + s.z1) / 2;
    switch (s.kind) {
      case 'bar':
        g.add(cell(cx, cy, cz, w, h, d, lam(0x8d99a6)));
        break;
      case 'stand': {
        g.add(cell(cx, cy, cz, w, h, d, lam(0xcfd8dc)));
        g.add(cell(cx, h + 0.05, cz, w + 0.1, 0.1, d + 0.1, lam(0x90a4ae)));
        g.add(cell(cx, h + 0.3, s.z0 + 0.1, w, 0.5, 0.06, lam(0xb71c1c)));
        const steps = cell(s.x0 - 0.7, 0.3, cz, 1.4, 0.6, 2, lam(0xb0bec5));
        g.add(steps);
        break;
      }
      case 'goal':
        g.add(cell(cx, cy, cz, w, h, d, lam(0xffffff)));
        break;
      case 'pole': {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, h, 8), lam(0xcfd0d2));
        p.position.set(cx, cy, cz);
        g.add(p);
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), lam(0xffd600));
        ball.position.set(cx, h + 0.2, cz);
        g.add(ball);
        break;
      }
      case 'building': {
        const t = canvasTex(128, 128, (c) => {
          c.fillStyle = '#e8dfc8';
          c.fillRect(0, 0, 128, 128);
          c.fillStyle = '#5b8bb5';
          for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) c.fillRect(8 + x * 30, 14 + y * 62, 22, 34);
          c.fillStyle = '#b8ad92';
          c.fillRect(0, 60, 128, 4);
        }, [d / 12, 1.4]);
        const m = lam(0xffffff, { map: t });
        const b = cell(cx, cy, cz, w, h, d, m);
        g.add(b);
        g.add(cell(cx, h + 0.4, cz, w + 0.6, 0.8, d + 0.6, lam(0xb85c38)));
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.2), new THREE.MeshBasicMaterial({ map: labelTex('명랑초등학교', '#fff', 'bold 70px "Black Han Sans", sans-serif', 512, 110, '#2e5aa8') }));
        sign.position.set(s.x1 + 0.05, h - 1.8, (s.z0 + s.z1) / 2 + 24);
        sign.rotation.y = Math.PI / 2;
        g.add(sign);
        break;
      }
      case 'apt': {
        const t = canvasTex(128, 256, (c) => {
          c.fillStyle = '#d9d4c7';
          c.fillRect(0, 0, 128, 256);
          c.fillStyle = '#6f93b3';
          for (let y = 0; y < 8; y++) for (let x = 0; x < 3; x++) c.fillRect(10 + x * 40, 8 + y * 31, 26, 20);
        }, [Math.max(1, Math.round(Math.max(w, d) / 14)), Math.round(h / 22)]);
        g.add(cell(cx, cy, cz, w, h, d, lam(0xffffff, { map: t })));
        const nm = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), new THREE.MeshBasicMaterial({ map: labelTex(`${105 + Math.round(Math.abs(cz)) % 9}동`, '#fff', 'bold 80px "Black Han Sans", sans-serif', 256, 128, '#1565c0') }));
        nm.position.set(s.x0 - 0.05, h - 3, cz);
        nm.rotation.y = -Math.PI / 2;
        if (s.x0 > 0) g.add(nm);
        break;
      }
      case 'fence': {
        const t = canvasTex(64, 64, (c) => {
          c.clearRect(0, 0, 64, 64);
          c.strokeStyle = 'rgba(40,90,50,0.9)';
          c.lineWidth = 2;
          for (let i = -64; i < 128; i += 12) {
            c.beginPath();
            c.moveTo(i, 0);
            c.lineTo(i + 64, 64);
            c.moveTo(i + 64, 0);
            c.lineTo(i, 64);
            c.stroke();
          }
        }, [Math.max(w, d) / 3.5, 1]);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, d), h), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(cx, cy, cz);
        if (d > w) m.rotation.y = Math.PI / 2;
        g.add(m);
        break;
      }
      case 'wall':
        g.add(cell(cx, cy, cz, w, h, d, lam(0xd9c9a8)));
        break;
      case 'shop': {
        g.add(cell(cx, cy, cz, w, h, d, lam(0xf3e2b3)));
        const sg = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.6), new THREE.MeshBasicMaterial({ map: labelTex('문방구', '#fff', 'bold 100px "Black Han Sans", sans-serif', 384, 140, '#d32f2f') }));
        sg.position.set(cx, h - 0.6, s.z1 + 0.06);
        g.add(sg);
        g.add(cell(cx, 3.2, s.z1 + 0.7, w, 0.12, 1.4, lam(0x1e88e5)));
        // toy shelf
        for (let i = 0; i < 5; i++) g.add(cell(cx - 3 + i * 1.5, 1.2, s.z1 + 0.2, 1.1, 1.2, 0.1, lam([0xff7043, 0x66bb6a, 0x42a5f5, 0xffee58, 0xab47bc][i]!)));
        g.add(cell(cx, h + 0.15, cz, w + 0.3, 0.3, d + 0.3, lam(0x8d6e63)));
        break;
      }
      case 'house': {
        const col = [0xe0c9a6, 0xc9b79c, 0xd7a98c, 0xb7c4cf][Math.floor(Math.abs(cx + cz) * 3) % 4]!;
        g.add(cell(cx, cy, cz, w, h, d, lam(col)));
        g.add(cell(cx, h + 0.12, cz, w + 0.3, 0.25, d + 0.3, lam(0x6d7b8a)));
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 8), lam(0x2e7d9e));
        tank.position.set(cx + w * 0.25, h + 0.85, cz);
        g.add(tank);
        break;
      }
    }
  }

  /** build the throw-specific visuals: thermals / downdrafts */
  setEnv(env: ThrowEnv) {
    for (const v of this.thermalViz) {
      this.envGroup.remove(v.mesh);
      v.mesh.geometry.dispose();
      (v.mesh.material as THREE.Material).dispose();
      v.tex.dispose();
      v.birds.forEach((b) => this.envGroup.remove(b));
    }
    this.thermalViz = [];
    for (const [list, up] of [[env.thermals, true], [env.downs, false]] as const) {
      for (const t of list) {
        const tex = canvasTex(64, 128, (c) => {
          const gr = c.createLinearGradient(0, 0, 0, 128);
          gr.addColorStop(0, 'rgba(255,255,255,0)');
          gr.addColorStop(0.2, 'rgba(255,255,255,0.9)');
          gr.addColorStop(0.8, 'rgba(255,255,255,0.9)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = gr;
          for (let i = 0; i < 6; i++) c.fillRect(i * 11 + 2, 0, 4, 128);
        }, [3, 2]);
        const mat = new THREE.MeshBasicMaterial({ map: tex, color: up ? 0xffd27a : 0x9fb6d8, transparent: true, opacity: up ? 0.17 : 0.2, side: THREE.DoubleSide, depthWrite: false });
        const h = up ? Math.min(t.top, 26) : 18;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.8, t.r * 0.95, h, 18, 1, true), mat);
        cyl.position.set(t.x, h / 2, t.z);
        this.envGroup.add(cyl);
        const patch = new THREE.Mesh(new THREE.CircleGeometry(t.r * 0.9, 20), new THREE.MeshBasicMaterial({ color: up ? 0xf2a65a : 0x7f98b8, transparent: true, opacity: 0.35, depthWrite: false }));
        patch.rotation.x = -Math.PI / 2;
        patch.position.set(t.x, 0.03, t.z);
        cyl.add(patch);
        patch.position.set(0, -h / 2 + 0.03, 0);
        const birds: THREE.Group[] = [];
        if (up) {
          for (let i = 0; i < 3; i++) {
            const b = new THREE.Group();
            for (const s of [-1, 1]) {
              const w = cell(s * 0.4, 0, 0, 0.8, 0.04, 0.3, lam(0x4e342e));
              w.rotation.z = s * 0.2;
              b.add(w);
            }
            b.add(cell(0, 0, 0, 0.2, 0.15, 0.6, lam(0x5d4037)));
            b.userData = { phase: i * 2.1, h: 9 + i * 3.5 };
            this.envGroup.add(b);
            birds.push(b);
          }
        }
        this.thermalViz.push({ mesh: cyl, tex, birds, r: t.r, x: t.x, z: t.z, up });
      }
    }
  }

  /** set live hazards (balls, pigeons) */
  setHazards(hs: Hazard[], t: number) {
    const seen = new Set<number>();
    for (const h of hs) {
      seen.add(h.id);
      let o = this.ballMeshes.get(h.id);
      if (!o) {
        o = h.kind === 'ball' ? new THREE.Mesh(this.ballGeo, this.ballMat) : this.pigeonProto.clone();
        this.envGroup.add(o);
        this.ballMeshes.set(h.id, o);
      }
      o.position.set(h.x, h.y, h.z);
      if (h.kind === 'ball') o.rotation.x = t * 8;
      else {
        const f = Math.sin(t * 22 + h.id) * 0.6;
        o.rotation.y = h.x > 0 ? Math.PI / 2 : -Math.PI / 2;
        o.getObjectByName('wl')!.rotation.z = f;
        o.getObjectByName('wr')!.rotation.z = -f;
      }
    }
    for (const [id, o] of this.ballMeshes) {
      if (!seen.has(id)) {
        this.envGroup.remove(o);
        this.ballMeshes.delete(id);
      }
    }
  }

  cheer(sec = 2.2) {
    this.cheerT = sec;
  }

  showMeasure(x: number, z: number, text: string) {
    this.teacher.g.visible = true;
    this.teacher.g.position.set(x + 1.2, 0, z + 0.8);
    this.teacher.g.rotation.y = Math.atan2(-(0 - x), -(0 - z)) + Math.PI;
    this.tapeLen = Math.hypot(x, z);
    this.tapeT = 0.0001;
    this.tape.visible = true;
    this.tape.position.set(x / 2, 0.04, z / 2);
    this.tape.rotation.y = Math.atan2(-x, -z) + Math.PI;
    this.tape.scale.z = 0.001;
    const tex = labelTex(text, '#ffeb3b', 'bold 92px "Black Han Sans", sans-serif', 512, 192);
    (this.distLabel.material as THREE.SpriteMaterial).map?.dispose();
    (this.distLabel.material as THREE.SpriteMaterial).map = tex;
    (this.distLabel.material as THREE.SpriteMaterial).needsUpdate = true;
    this.distLabel.position.set(x, 3.4, z);
    this.distLabel.visible = true;
  }
  hideMeasure() {
    this.teacher.g.visible = false;
    this.tape.visible = false;
    this.distLabel.visible = false;
    this.tapeT = 0;
  }

  setShadow(x: number, y: number, z: number, on: boolean) {
    this.shadow.visible = on;
    this.shadow.position.set(x, 0.04, z);
    const s = Math.max(0.5, 1.2 - y * 0.03);
    this.shadow.scale.setScalar(s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.38 - y * 0.012);
  }

  update(dt: number, time: number, wind: { x: number; z: number }, focus: THREE.Vector3) {
    const sp = Math.hypot(wind.x, wind.z);
    const psi = Math.atan2(wind.x, -wind.z);
    // flag + sock. Cloth extends along local +x; rotation.y = pi/2 - psi points it downwind.
    this.flagCloth.rotation.y = Math.PI / 2 - psi;
    this.flagCloth.rotation.z = -Math.max(0, 1.2 - sp * 0.4) + Math.sin(time * (4 + sp)) * 0.08 * Math.min(1, sp);
    this.flagCloth.rotation.x = Math.sin(time * (6 + sp * 2)) * 0.1 * Math.min(1, sp);
    this.sockPivot.rotation.y = -psi;
    this.sockPivot.rotation.x = -(Math.max(0, 1 - sp / 3.2) * 1.15) + Math.sin(time * 5) * 0.04 * Math.min(1, sp);
    // kids
    this.cheerT = Math.max(0, this.cheerT - dt);
    const cheering = this.cheerT > 0;
    for (const k of this.kids) {
      const p = k.phase;
      k.g.position.y = cheering ? Math.abs(Math.sin(time * 9 + p)) * 0.22 : 0;
      const ar = cheering ? 2.6 + Math.sin(time * 14 + p) * 0.35 : Math.sin(time * 1.5 + p) * 0.06;
      (k.armL.parent as THREE.Object3D).rotation.z = ar;
      (k.armR.parent as THREE.Object3D).rotation.z = -ar;
    }
    // tape unrolls
    if (this.tapeT > 0) {
      this.tapeT += dt;
      const f = Math.min(1, this.tapeT / 1.1);
      this.tape.scale.z = Math.max(0.001, this.tapeLen * f);
    }
    // thermals
    for (const v of this.thermalViz) {
      v.tex.offset.y -= (v.up ? -1 : 1) * dt * 0.35;
      v.birds.forEach((b) => {
        const a = time * 0.7 + (b.userData.phase as number);
        b.position.set(v.x + Math.cos(a) * v.r * 0.55, (b.userData.h as number) + Math.sin(time * 0.5 + (b.userData.phase as number)) * 1.2, v.z + Math.sin(a) * v.r * 0.55);
        b.rotation.y = -a;
        b.rotation.z = -0.3;
        const fl = Math.sin(time * 6 + (b.userData.phase as number)) * 0.18;
        b.children[0]!.rotation.z = -0.2 - fl;
        b.children[1]!.rotation.z = 0.2 + fl;
      });
    }
    // clouds
    for (const c of this.clouds) {
      c.position.x += dt * (1 + wind.x * 0.4);
      if (c.position.x > 320) c.position.x = -320;
    }
    // dust: drift with wind, wrapped around the focus
    const n = this.dustPos.length / 3;
    const R = 34;
    const mod = (v: number) => ((v % (2 * R)) + 2 * R) % (2 * R);
    for (let i = 0; i < n; i++) {
      const sx = this.dustSeed[i * 3]!;
      const sy = this.dustSeed[i * 3 + 1]!;
      const sz = this.dustSeed[i * 3 + 2]!;
      const rx = sx * 2 * R + time * (wind.x * 1.1 + 0.25);
      const rz = sz * 2 * R + time * wind.z * 1.1;
      this.dustPos[i * 3] = focus.x - R + mod(rx - (focus.x - R));
      this.dustPos[i * 3 + 1] = 0.3 + sy * 9 + Math.sin(time * 1.3 + sx * 40) * 0.4;
      this.dustPos[i * 3 + 2] = focus.z - R + mod(rz - (focus.z - R));
    }
    this.dust.geometry.attributes.position!.needsUpdate = true;
  }
}
