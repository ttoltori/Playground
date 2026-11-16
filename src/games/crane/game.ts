import * as THREE from 'three';
import type { MiniGame, MiniGameOptions } from '../../platform/minigame';
import { fmtTime } from '../forklift/hud';
import { Particles } from '../forklift/particles';
import { CraneAudio } from './audio';
import { Hud, HUD_CSS, type HudData } from './hud';
import { CraneControls, TOUCH_CSS, emptyInput, isTouch, type CraneInput } from './input';
import { JIB_Y, KINDS, LEVELS, R_MAX, R_MIN, capAt, type KindId, type LevelDef } from './levels';
import { CraneWorld, PAD_COLORS, bx, buildLoadMesh, buildWorker, cssHex, loadHalf, makeLabelSprite, type Solid } from './world';

const STEP = 1 / 60;
const G = 9.81;
const PIVOT_Y = JIB_Y - 1.5;
const L_MIN = 2.5;
const L_MAX = PIVOT_Y - 0.3;
const HOOK_H = new THREE.Vector3(0.35, 0.3, 0.35);
const CAMS = ['운전석', '훅 추적', '탑뷰'];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const approach = (v: number, t: number, d: number) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const rLimit = (mass: number) => (mass >= 8 ? 12 : Math.min(R_MAX, 12 + (8 - mass) / 0.25));

const RADIO = {
  start: ['📻 신호수: 마이크 테스트~ 아래 사람 없는 거 확인했습니다. 시작하세요 기사님!', '📻 신호수: 오늘도 하늘에서 안전운전 부탁드립니다. 아래는 제가 있어요.', '📻 신호수: 기사님, 고소공포증은... 없으시죠? 없다고 해주세요.'],
  hook: ['📻 신호수: 걸렸습니다! 천천히, 천천히~ 감아요.', '📻 신호수: 훅 걸렸고요, 이제 와이어를 믿어봅시다.', '📻 신호수: 좋아요. 올리세요. 올리는 건 쉽습니다. 내리는 게 문제지.'],
  toilet: ['📻 신호수: 화장실이 하늘을 나네요. 안에 사람은 없죠? ...없죠?!'],
  swing: ['📻 신호수: 기사님 그거 댄스 아닙니다. 흔들려요!', '📻 신호수: 시계추도 아니고... 트롤리로 받아요, 트롤리로!', '📻 신호수: 짐이 그네 타는 중입니다. 멀미 나요.'],
  good: ['📻 신호수: 납품 완료! 담배 한 대 하고 오세요.', '📻 신호수: 안착! 오늘 점심은 기사님이 쏘는 겁니다.', '📻 신호수: 깔끔합니다. 건물이 고마워하네요.'],
  perfect: ['📻 신호수: 캬~ 정중앙! 자로 잰 줄 알았습니다.', '📻 신호수: 이게 장인입니다. 이게 바로 밥값이에요.'],
  crash: ['📻 신호수: 방금 건물이 아파했습니다.', '📻 신호수: 쿵 소리 났는데 우리 아무 말도 안 한 겁니다.', '📻 신호수: 그건 벽이에요 기사님. 문이 아니라...'],
  slam: ['📻 신호수: 쿵! 지반이 놀랐습니다.', '📻 신호수: 내려놓는 거지 던지는 게 아닙니다!'],
  glass: ['📻 신호수: 유리... 유리가... 오늘 점심은 기사님이 사셔야겠습니다.', '📻 신호수: 와장창! 반사광이 아주 예쁘네요. 반사광만.'],
  drop: ['📻 신호수: 떨어진 건 물건이지 제 심장이 아닙니다.', '📻 신호수: 그건 놓는 게 아니라 버리는 겁니다!'],
  over: ['📻 신호수: 과부하! 그 크레인 헬스장 안 다닙니다!', '📻 신호수: 하중표 좀 보세요. 무거운 건 안쪽으로!'],
  near: ['📻 신호수: 아래 사람! 사람 있어요!!', '📻 신호수: 머리 위! 머리 위 조심! 아니 기사님이 조심하셔야죠!', '📻 신호수: 방금 그 사람 머리카락 쓸렸어요...'],
  hit: ['📻 신호수: 안전모 덕에 사셨네 이 양반아!!', '📻 신호수: 사람입니다! 사람이에요 기사님!!'],
  gust: ['📻 신호수: 돌풍 옵니다! 머리카락이 아니라 짐이 날려요.', '📻 신호수: 바람 쎄요. 천천히 천천히...'],
  last: ['📻 신호수: 마지막 하나! 퇴근이 보입니다.'],
  done: ['📻 신호수: 작업 끝! 오늘 크레인은 기사님이 지배했습니다.'],
} as const;
const pickLine = (k: keyof typeof RADIO) => RADIO[k][Math.floor(Math.random() * RADIO[k].length)];

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

interface Load {
  i: number;
  kindId: KindId;
  kind: (typeof KINDS)[KindId];
  color: number;
  mesh: THREE.Group;
  sprite: THREE.Sprite;
  beam: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  half: THREE.Vector3;
  state: 'ground' | 'attached' | 'falling' | 'delivered' | 'broken';
  pad: number;
  home: { x: number; z: number; yaw: number };
  respawnT: number;
}
interface WorkerState {
  mesh: THREE.Group;
  path: [number, number][];
  speed: number;
  s: number; // distance along path
  dir: number;
  x: number;
  z: number;
  downT: number;
  nearCd: number;
  hitCd: number;
}
interface Contact { impact: number; side: boolean; top: boolean; ground: boolean }
interface Gust { t0: number; dur: number; amp: number; dirOff: number; told: boolean }

export class CraneGame implements MiniGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.2, 700);
  readonly level: LevelDef;
  readonly world: CraneWorld;
  readonly audio = new CraneAudio();
  private particles: Particles;
  private hud: Hud;
  private controls: CraneControls;
  private styleEl: HTMLStyleElement;
  private overlay: HTMLDivElement;
  private resizeObs: ResizeObserver;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private paused = false;
  private disposed = false;
  private ended = false;
  private touch: boolean;
  private quality: 'low' | 'high';
  private rng = mulberry(12345);

  // --- simulation state (public for tests)
  state: 'countdown' | 'run' | 'finishing' | 'done' = 'countdown';
  countdown = 3.2;
  private lastCount = 4;
  t = 0; // elapsed run time
  penalty = 0;
  bonus = 0;
  stats = { incidents: 0, drops: 0, breaks: 0, nearMiss: 0, perfect: 0, workerHits: 0, overloads: 0, hits: 0, offsetSum: 0 };
  delivered = 0;
  crane = { theta: 0, omega: 0, r: 14, vr: 0, L: 12, vL: 0 };
  pivot = new THREE.Vector3();
  private pivotPrev = new THREE.Vector3();
  pivotVel = new THREE.Vector3();
  bob = new THREE.Vector3(); // hook centre
  vel = new THREE.Vector3();
  sling = 1.4;
  loads: Load[] = [];
  attached: Load | null = null;
  workers: WorkerState[] = [];
  scriptInput: (() => CraneInput) | null = null;
  lastInput: CraneInput = emptyInput();
  wind = { speed: 0, dir: 0, x: 0, z: 0 };
  private gusts: Gust[] = [];
  private lastIncident = -10;
  private tapCd = 0;
  private overloadT = 0;
  private overloadToastCd = 0;
  private swingToastCd = 8;
  private shake = 0;
  private camMode = 0;
  private aim = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private fov = 72;
  private finishT = 0;
  private hudT = 0;
  private radioCd = 0;
  private lastGuide = '';

  // --- visuals
  private cable: THREE.Mesh;
  private hookMesh: THREE.Group;
  private slings: THREE.LineSegments;
  private laser: THREE.Mesh;
  private ringMarker: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private laserMat: THREE.MeshBasicMaterial;
  private sun: THREE.DirectionalLight;
  private confettiT = 0;

  constructor(private opts: MiniGameOptions) {
    this.level = LEVELS[clamp(opts.level, 1, LEVELS.length) - 1];
    const lv = this.level;
    this.touch = isTouch();
    const mobile = this.touch || window.innerWidth < 800;
    this.quality = mobile ? 'low' : 'high';
    const container = opts.container;

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = HUD_CSS + TOUCH_CSS;
    document.head.appendChild(this.styleEl);

    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    this.overlay = document.createElement('div');
    this.overlay.className = 'game-overlay';
    container.appendChild(this.overlay);

    // accent colour (avoid near-black paint)
    let accent = opts.color;
    const lum = ((accent >> 16) & 255) * 0.3 + ((accent >> 8) & 255) * 0.59 + (accent & 255) * 0.11;
    if (lum < 40) accent = 0xf2c200;

    // scene + lights
    const dusk = lv.dusk;
    this.scene.background = new THREE.Color(dusk ? 0xe0825a : 0x9ec9ff);
    this.scene.fog = new THREE.Fog(dusk ? 0xe0825a : 0x9ec9ff, 90, dusk ? 230 : 280);
    this.scene.add(new THREE.HemisphereLight(dusk ? 0xffb48a : 0xdfefff, dusk ? 0x4a3f55 : 0x6b5e48, dusk ? 1.0 : 1.15));
    this.sun = new THREE.DirectionalLight(dusk ? 0xff9a55 : 0xfff1d6, dusk ? 1.7 : 2.1);
    this.sun.position.set(dusk ? 70 : -35, dusk ? 28 : 65, dusk ? -45 : 28);
    this.sun.castShadow = this.quality === 'high';
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);

    this.world = new CraneWorld(lv, accent, this.quality, mulberry(777));
    this.scene.add(this.world.group);
    this.particles = new Particles(this.scene, 140);

    // loads
    lv.loads.forEach((spec, i) => {
      const kind = KINDS[spec.kind];
      const color = PAD_COLORS[i % PAD_COLORS.length];
      const mesh = buildLoadMesh(spec.kind);
      this.scene.add(mesh);
      const sprite = makeLabelSprite(String(i + 1), color, 2.2);
      this.scene.add(sprite);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 14, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false }));
      this.scene.add(beam);
      const half = loadHalf(spec.kind, spec.yaw);
      const l: Load = {
        i, kindId: spec.kind, kind, color, mesh, sprite, beam, pos: new THREE.Vector3(spec.x, half.y, spec.z), vel: new THREE.Vector3(),
        yaw: spec.yaw, half, state: 'ground', pad: spec.pad, home: { x: spec.x, z: spec.z, yaw: spec.yaw }, respawnT: 0,
      };
      this.loads.push(l);
    });

    // workers
    for (const w of lv.workers) {
      const mesh = buildWorker();
      this.scene.add(mesh);
      this.workers.push({ mesh, path: w.path, speed: w.speed, s: Math.random() * 3, dir: 1, x: w.path[0][0], z: w.path[0][1], downT: 0, nearCd: 0, hitCd: 0 });
    }

    // cable, hook, slings, markers
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x15171a });
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), cableMat);
    this.scene.add(this.cable);
    this.hookMesh = new THREE.Group();
    this.hookMesh.add(bx(0.7, 0.45, 0.5, new THREE.MeshStandardMaterial({ map: undefined, color: 0xe8b020, roughness: 0.5 }), 0, 0.05, 0, false));
    this.hookMesh.add(bx(0.72, 0.1, 0.52, new THREE.MeshStandardMaterial({ color: 0x222222 }), 0, 0.15, 0, false));
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 12, Math.PI * 1.4), new THREE.MeshStandardMaterial({ color: 0x888e96, metalness: 0.6, roughness: 0.4 }));
    hk.position.y = -0.38;
    hk.rotation.z = Math.PI * 0.8;
    this.hookMesh.add(hk);
    this.scene.add(this.hookMesh);
    this.slings = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd34a }));
    this.slings.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    this.slings.frustumCulled = false;
    this.scene.add(this.slings);
    this.laserMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.55, depthWrite: false });
    this.laser = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), this.laserMat);
    this.scene.add(this.laser);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
    this.ringMarker = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 24), this.ringMat);
    this.ringMarker.rotation.x = -Math.PI / 2;
    this.ringMarker.renderOrder = 5;
    this.scene.add(this.ringMarker);

    // wind schedule
    this.buildGusts();

    // crane initial state
    const first = lv.loads[0];
    this.crane.theta = Math.atan2(first.z, first.x);
    this.crane.r = lv.r0;
    this.crane.L = 12;
    this.updatePivot(true);
    this.bob.set(this.pivot.x, this.pivot.y - this.crane.L, this.pivot.z);
    this.aim.copy(this.bob);

    // hud + controls
    this.hud = new Hud(this.overlay, opts.nickname, cssHex(accent), this.touch);
    this.controls = new CraneControls(this.overlay, this.touch);
    if (this.touch) {
      const h = document.createElement('div');
      h.className = 'rotate-hint';
      h.textContent = '📱 가로로 돌리면 더 좋아요';
      this.overlay.appendChild(h);
    }
    this.hud.toast(pickLine('start'), 'radio');

    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();
    this.audio.init();
    this.audio.resume();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.syncVisuals(0);
  }

  // ------------------------------------------------------------ plumbing
  private layout() {
    const w = this.opts.container.clientWidth || window.innerWidth;
    const h = this.opts.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 6) {
        this.step(STEP);
        this.acc -= STEP;
        n++;
      }
      if (n === 6) this.acc = 0;
    }
    this.render(dt, now);
  };

  setPaused(p: boolean) {
    this.paused = p;
    this.audio.suspend(p);
    if (!p) this.lastFrame = performance.now();
  }
  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.hud.dispose();
    this.audio.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        const anyM = x as THREE.Material & { map?: THREE.Texture | null };
        anyM.map?.dispose();
        x.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.overlay.remove();
    this.styleEl.remove();
  }

  // ------------------------------------------------------------ wind
  private buildGusts() {
    const w = this.level.wind;
    if (w.gust <= 0) return;
    let t = 6;
    for (let i = 0; i < 80; i++) {
      this.gusts.push({ t0: t, dur: 2.5 + this.rng() * 2.5, amp: w.gust * (0.4 + this.rng() * 0.6), dirOff: (this.rng() - 0.5) * 1.2, told: false });
      t += w.period * (0.7 + this.rng() * 0.9);
    }
  }
  private updateWind(dt: number) {
    const w = this.level.wind;
    void dt;
    let g = 0;
    let off = 0;
    for (const gu of this.gusts) {
      if (this.t < gu.t0) break;
      const x = (this.t - gu.t0) / gu.dur;
      if (x >= 0 && x <= 1) {
        const b = Math.sin(Math.PI * x) ** 2;
        g = Math.max(g, gu.amp * b);
        off = gu.dirOff * b;
        if (!gu.told && gu.amp > w.gust * 0.65 && x < 0.5) {
          gu.told = true;
          this.radio('gust');
        }
      }
    }
    const base = w.base > 0 ? w.base * (0.85 + 0.15 * Math.sin(this.t * 0.31)) : 0;
    const sp = base + g;
    const dir = 0.9 + 0.35 * Math.sin(this.t * 0.07) + off;
    this.wind.speed = sp;
    this.wind.dir = dir;
    this.wind.x = Math.cos(dir) * sp;
    this.wind.z = Math.sin(dir) * sp;
  }

  // ------------------------------------------------------------ helpers
  private updatePivot(init = false) {
    const c = this.crane;
    this.pivot.set(Math.cos(c.theta) * c.r, PIVOT_Y, Math.sin(c.theta) * c.r);
    if (init) this.pivotPrev.copy(this.pivot);
  }

  private radio(key: keyof typeof RADIO, force = false) {
    if (!force && this.radioCd > 0) return;
    this.radioCd = 2.2;
    this.hud.toast(pickLine(key), 'radio');
    this.audio.radio();
  }

  private incident(secs: number, line: keyof typeof RADIO, toast: string, shake = 0.6) {
    if (this.t - this.lastIncident < 0.8) return false;
    this.lastIncident = this.t;
    this.penalty += secs;
    this.stats.incidents++;
    this.shake = Math.max(this.shake, shake);
    this.hud.toast(`${toast} +${secs}초`, 'bad');
    this.radio(line, true);
    return true;
  }

  private collidables(ignore: Load | null): Solid[] {
    const out: Solid[] = this.world.solids.slice();
    for (const l of this.loads) {
      if (l === ignore || l.state === 'attached' || l.state === 'broken') continue;
      out.push({ minx: l.pos.x - l.half.x, maxx: l.pos.x + l.half.x, miny: l.pos.y - l.half.y, maxy: l.pos.y + l.half.y, minz: l.pos.z - l.half.z, maxz: l.pos.z + l.half.z });
    }
    return out;
  }

  /** push the box (centre c, half h) out of all solids; mutates c and v */
  private resolve(c: THREE.Vector3, h: THREE.Vector3, v: THREE.Vector3, prevBottom: number, ignore: Load | null): Contact {
    const out: Contact = { impact: 0, side: false, top: false, ground: false };
    if (c.y - h.y < 0) {
      out.impact = Math.max(out.impact, -v.y);
      c.y = h.y;
      if (v.y < 0) v.y = 0;
      out.top = out.ground = true;
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.collidables(ignore)) {
        const ox = Math.min(c.x + h.x, s.maxx) - Math.max(c.x - h.x, s.minx);
        if (ox <= 0) continue;
        const oz = Math.min(c.z + h.z, s.maxz) - Math.max(c.z - h.z, s.minz);
        if (oz <= 0) continue;
        const oy = Math.min(c.y + h.y, s.maxy) - Math.max(c.y - h.y, s.miny);
        if (oy <= 0) continue;
        const dyUp = s.maxy - (c.y - h.y);
        const above = prevBottom >= s.maxy - 0.3;
        if (above || (dyUp <= ox && dyUp <= oz)) {
          c.y += dyUp;
          out.impact = Math.max(out.impact, -v.y);
          if (v.y < 0) v.y = 0;
          out.top = true;
        } else if (ox < oz) {
          const sgn = c.x < (s.minx + s.maxx) / 2 ? -1 : 1;
          c.x += sgn * ox;
          const vn = -sgn * v.x; // speed into the wall
          if (vn > 0) {
            out.impact = Math.max(out.impact, vn);
            v.x = -v.x * 0.15;
          }
          out.side = true;
        } else {
          const sgn = c.z < (s.minz + s.maxz) / 2 ? -1 : 1;
          c.z += sgn * oz;
          const vn = -sgn * v.z;
          if (vn > 0) {
            out.impact = Math.max(out.impact, vn);
            v.z = -v.z * 0.15;
          }
          out.side = true;
        }
      }
    }
    return out;
  }

  surfaceUnder(x: number, z: number, hx: number, hz: number, maxY: number, ignore: Load | null = null) {
    let y = 0;
    for (const s of this.collidables(ignore)) {
      if (s.maxy > maxY) continue;
      if (x + hx > s.minx && x - hx < s.maxx && z + hz > s.minz && z - hz < s.maxz) y = Math.max(y, s.maxy);
    }
    return y;
  }

  get carriedMass() {
    return this.attached ? this.attached.kind.mass : 0;
  }
  get moment() {
    return this.attached ? this.attached.kind.mass / capAt(this.crane.r) : 0;
  }

  // ------------------------------------------------------------ simulation
  step(dt: number) {
    if (this.state === 'done') return;
    const raw = this.scriptInput ? this.scriptInput() : this.controls.read();
    this.lastInput = raw;
    if (raw.cam) this.camMode = (this.camMode + 1) % 3;
    this.radioCd = Math.max(0, this.radioCd - dt);
    this.tapCd = Math.max(0, this.tapCd - dt);
    this.overloadT = Math.max(0, this.overloadT - dt);
    this.overloadToastCd = Math.max(0, this.overloadToastCd - dt);

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n <= 3) {
        this.lastCount = n;
        if (n > 0) {
          this.audio.countdown(false);
          this.hud.center(String(n));
        }
      }
      if (this.countdown <= 0) {
        this.state = 'run';
        this.audio.countdown(true);
        this.hud.center('GO!', 'go');
        window.setTimeout(() => this.hud.center(''), 800);
      }
    } else if (this.state === 'run') {
      this.t += dt;
    }
    const live = this.state === 'run' || this.state === 'finishing';
    const inp = live && this.state === 'run' ? raw : { ...emptyInput(), cam: raw.cam };

    this.updateWind(dt);
    this.moveCrane(inp, dt);
    this.simulateBob(dt);
    if (inp.action) this.onAction();
    this.simulateLoads(dt);
    this.simulateWorkers(dt);
    this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);

    // swing warning
    this.swingToastCd -= dt;
    const sw = this.swingInfo();
    if (this.attached && sw.dist > 2.2 && sw.speed > 1.5 && this.swingToastCd <= 0 && this.state === 'run') {
      this.swingToastCd = 12;
      this.radio('swing');
    }

    this.audio.update(
      dt,
      this.crane.omega / 0.26, this.crane.vr / 4.2, -this.crane.vL / 5,
      this.wind.speed, this.pivot.y,
      this.overloadT > 0,
    );

    if (this.state === 'finishing') {
      this.finishT -= dt;
      this.confettiT -= dt;
      if (this.confettiT <= 0) {
        this.confettiT = 0.12;
        const pad = this.level.pads[this.loads[this.loads.length - 1].pad];
        for (const c of [0xffd24a, 0x58f08a, 0xff5a5a, 0x4fc3ff]) this.particles.burst(pad.x, pad.y + 2, pad.z, 4, c, 6, 0.2, 1.4);
      }
      if (this.finishT <= 0) this.finish();
    }
  }

  private moveCrane(inp: CraneInput, dt: number) {
    const c = this.crane;
    const mass = this.carriedMass;
    const sf = 1 - 0.035 * mass;
    c.omega = approach(c.omega, inp.slew * 0.26 * sf, 0.15 * dt);
    c.theta += c.omega * dt;
    if (c.theta > Math.PI) c.theta -= Math.PI * 2;
    if (c.theta < -Math.PI) c.theta += Math.PI * 2;

    let tv = inp.trolley * 4.2 * sf;
    const lock = this.attached && this.moment >= 1;
    if (lock) {
      if (tv > 0) tv = 0;
    }
    c.vr = approach(c.vr, tv, 1.6 * dt);
    let nr = c.r + c.vr * dt;
    if (this.attached) {
      const lim = rLimit(mass);
      if (nr > lim && nr > c.r) {
        nr = Math.max(c.r, lim);
        if (c.vr > 0.5) {
          this.overloadT = 1.0;
          this.stats.overloads++;
          if (this.overloadToastCd <= 0) {
            this.overloadToastCd = 4;
            this.radio('over', true);
            this.audio.warn();
          }
        }
        c.vr = 0;
      }
    }
    if (nr >= R_MAX) { nr = R_MAX; c.vr = Math.min(c.vr, 0); }
    if (nr <= R_MIN) { nr = R_MIN; c.vr = Math.max(c.vr, 0); }
    c.r = nr;

    let tl = -inp.hoist * (inp.hoist > 0 ? 5.0 : 4.5) * sf;
    if (lock && tl < 0) tl = 0;
    c.vL = approach(c.vL, tl, 3.2 * dt);
    c.L += c.vL * dt;
    if (c.L >= L_MAX) { c.L = L_MAX; c.vL = Math.min(c.vL, 0); }
    if (c.L <= L_MIN) { c.L = L_MIN; c.vL = Math.max(c.vL, 0); }

    this.pivotPrev.copy(this.pivot);
    this.updatePivot();
    this.pivotVel.copy(this.pivot).sub(this.pivotPrev).multiplyScalar(1 / dt);
  }

  private simulateBob(dt: number) {
    const att = this.attached;
    const P = this.bob;
    const V = this.vel;
    const Va = this.pivotVel;
    const mass = att ? att.kind.mass : 0.3;
    const sail = att ? att.kind.sail : 0.25;
    const wk = (0.04 * sail) / (0.5 + mass * 0.5);
    V.y -= G * dt;
    V.x += this.wind.x * wk * dt;
    V.z += this.wind.z * wk * dt;
    const kd = Math.exp(-this.level.damp * dt);
    V.x = Va.x + (V.x - Va.x) * kd;
    V.z = Va.z + (V.z - Va.z) * kd;
    const prevBottom = att ? att.pos.y - att.half.y : P.y - HOOK_H.y;
    P.addScaledVector(V, dt);

    // rope (inequality constraint)
    const A = this.pivot;
    const L = this.crane.L;
    const dx = P.x - A.x, dy = P.y - A.y, dz = P.z - A.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > L) {
      const nx = dx / dist, ny = dy / dist, nz = dz / dist;
      P.set(A.x + nx * L, A.y + ny * L, A.z + nz * L);
      const rvn = (V.x - Va.x) * nx + (V.y - Va.y) * ny + (V.z - Va.z) * nz;
      if (rvn > 0) V.addScaledVector(new THREE.Vector3(nx, ny, nz), -rvn);
    }

    // collisions (load box when carrying, else the hook block)
    if (att) {
      const half = att.half;
      const c0 = new THREE.Vector3(P.x, P.y - this.sling - half.y, P.z);
      const cl = c0.clone();
      const ct = this.resolve(cl, half, V, prevBottom, att);
      P.x += cl.x - c0.x;
      P.y += cl.y - c0.y;
      P.z += cl.z - c0.z;
      att.pos.set(P.x, P.y - this.sling - half.y, P.z);
      if (ct.top) { V.x *= Math.exp(-4 * dt); V.z *= Math.exp(-4 * dt); }
      this.handleLoadImpact(att, ct, true);
    } else {
      const ct = this.resolve(P, HOOK_H, V, prevBottom, null);
      if (ct.top) { V.x *= Math.exp(-4 * dt); V.z *= Math.exp(-4 * dt); }
      if (ct.impact > 0.8 && this.tapCd <= 0) {
        this.tapCd = 0.3;
        this.audio.thud(ct.impact);
      }
      if (ct.side && ct.impact > 2.5) this.incident(1.5, 'crash', '🪝 훅 충돌', 0.4);
    }
  }

  private handleLoadImpact(l: Load, ct: Contact, carried: boolean) {
    const fragile = l.kind.fragile;
    const sideThr = fragile ? 0.9 : 1.6;
    const vertThr = fragile ? 1.3 : 2.4;
    const p = l.pos;
    if (ct.impact > 0.5 && this.tapCd <= 0) {
      this.tapCd = 0.25;
      this.audio.thud(ct.impact);
      this.particles.burst(p.x, p.y - l.half.y, p.z, 4, 0xb8a98c, 2.5, 0.15, 0.7);
    }
    if (!carried) return;
    if (fragile && ((ct.side && ct.impact > sideThr) || (ct.top && ct.impact > vertThr))) {
      this.breakLoad(l);
      return;
    }
    if (ct.side && ct.impact > sideThr) {
      if (this.incident(3, 'crash', '💥 구조물 충돌')) {
        this.stats.hits++;
        this.audio.crash(ct.impact);
        this.particles.burst(p.x, p.y, p.z, 14, 0xdddddd, 5, 0.18, 0.9);
      }
    } else if (ct.top && ct.impact > vertThr) {
      if (this.incident(4, 'slam', '💢 쾅! 거칠게 착지')) {
        this.stats.hits++;
        this.audio.crash(ct.impact);
        this.particles.burst(p.x, p.y - l.half.y, p.z, 16, 0xb8a98c, 5, 0.2, 1.0);
      }
    }
  }

  private breakLoad(l: Load) {
    this.stats.breaks++;
    this.audio.glass();
    for (let k = 0; k < 3; k++) this.particles.burst(l.pos.x, l.pos.y, l.pos.z, 10, [0x9fe8ff, 0xffffff, 0xcfefff][k], 5, 0.14, 1.4);
    if (this.attached === l) this.attached = null;
    l.state = 'broken';
    l.mesh.visible = false;
    l.sprite.visible = false;
    l.beam.visible = false;
    l.respawnT = 1.8;
    this.lastIncident = this.t - 0.5;
    this.penalty += 10;
    this.stats.incidents++;
    this.shake = 0.9;
    this.hud.toast('🪟 유리 파손! +10초', 'bad');
    this.radio('glass', true);
  }

  findAttachable(): Load | null {
    if (this.attached) return null;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    let best: Load | null = null;
    let bd = Infinity;
    for (const l of this.loads) {
      if (l.state !== 'ground') continue;
      const topY = l.pos.y + l.half.y;
      const d = Math.hypot(this.bob.x - l.pos.x, this.bob.z - l.pos.z);
      const dy = this.bob.y - topY;
      if (d < this.level.pickR && dy > 0.1 && dy < 1.9 && hv < 2.5 && d < bd) {
        best = l;
        bd = d;
      }
    }
    return best;
  }

  private onAction() {
    if (this.state !== 'run') return;
    if (!this.attached) {
      const l = this.findAttachable();
      if (!l) {
        this.hud.toast('🪝 훅을 짐 중앙 위로 더 가까이! (흔들림도 잡고)', 'info');
        return;
      }
      this.attached = l;
      l.state = 'attached';
      this.sling = clamp(this.bob.y - (l.pos.y + l.half.y), 0.35, 1.9);
      this.audio.clank();
      this.hud.toast(`${l.kind.emoji} ${l.i + 1}번 ${l.kind.name} (${l.kind.mass}t) 걸림!`, 'good');
      this.radio(l.kindId === 'toilet' ? 'toilet' : 'hook', true);
      if (this.moment > 0.85) this.hud.toast(`⚠ 하중모멘트 ${(this.moment * 100).toFixed(0)}% · 트롤리 반경 ${rLimit(l.kind.mass).toFixed(0)}m 이내 유지`, 'info');
      return;
    }
    this.release();
  }

  private release() {
    const l = this.attached!;
    const pad = this.level.pads[l.pad];
    const d = Math.hypot(l.pos.x - pad.x, l.pos.z - pad.z);
    const bottom = l.pos.y - l.half.y;
    this.attached = null;
    this.audio.release();
    if (d <= this.level.tol && Math.abs(bottom - pad.y) <= 0.5) {
      // delivered
      l.state = 'delivered';
      l.pos.y = pad.y + l.half.y;
      l.vel.set(0, 0, 0);
      this.delivered++;
      this.stats.offsetSum += d;
      const rel = Math.hypot(this.vel.x - this.pivotVel.x, this.vel.z - this.pivotVel.z);
      let bonus = 0;
      let perfect = false;
      if (d <= 0.35 && rel < 0.4) { bonus = 2; perfect = true; this.stats.perfect++; } else if (d <= this.level.tol * 0.55) bonus = 1;
      this.bonus += bonus;
      this.audio.deliver(perfect);
      this.particles.burst(l.pos.x, pad.y + 0.3, l.pos.z, 18, l.color, 5, 0.18, 1.2);
      l.sprite.visible = false;
      l.beam.visible = false;
      this.hud.toast(perfect ? `🎯 퍼펙트! 오차 ${(d * 100).toFixed(0)}cm  -${bonus}초` : `✅ ${l.i + 1}번 납품 · 오차 ${(d * 100).toFixed(0)}cm${bonus ? `  -${bonus}초` : ''}`, 'good');
      this.radio(perfect ? 'perfect' : 'good', true);
      if (this.delivered === this.loads.length) {
        this.state = 'finishing';
        this.finishT = 2.2;
        this.audio.fanfare();
        this.hud.center('작업 완료!', 'go small');
        this.radio('done', true);
      } else if (this.delivered === this.loads.length - 1) {
        window.setTimeout(() => !this.disposed && this.radio('last'), 2500);
      }
      return;
    }
    // set down / drop
    const surf = this.surfaceUnder(l.pos.x, l.pos.z, l.half.x * 0.9, l.half.z * 0.9, bottom + 0.4, l);
    const h = bottom - surf;
    if (h < 0.35) {
      l.state = 'ground';
      l.pos.y = surf + l.half.y;
      l.vel.set(0, 0, 0);
      if (this.nearPad(l)) this.hud.toast('📍 번호/위치가 패드 밖이에요. 다시 들어서 중앙에!', 'info');
    } else {
      l.state = 'falling';
      l.vel.set(this.vel.x * 0.4, Math.min(0, this.vel.y), this.vel.z * 0.4);
      this.stats.drops++;
    }
  }

  private nearPad(l: Load) {
    const p = this.level.pads[l.pad];
    return Math.hypot(l.pos.x - p.x, l.pos.z - p.z) < this.level.tol * 2.5;
  }

  private simulateLoads(dt: number) {
    for (const l of this.loads) {
      if (l.state === 'falling') {
        l.vel.y -= G * dt;
        const prevB = l.pos.y - l.half.y;
        l.pos.addScaledVector(l.vel, dt);
        l.vel.x *= Math.exp(-0.4 * dt);
        l.vel.z *= Math.exp(-0.4 * dt);
        const ct = this.resolve(l.pos, l.half, l.vel, prevB, l);
        if (ct.top && ct.impact > 0.5) {
          this.audio.thud(ct.impact);
          this.particles.burst(l.pos.x, l.pos.y - l.half.y, l.pos.z, 10, 0xb8a98c, 4, 0.18, 0.9);
          if (l.kind.fragile && ct.impact > 1.3) {
            this.breakLoad(l);
            continue;
          }
          if (ct.impact > 3 && this.incident(3, 'drop', '📉 추락 사고')) {
            this.audio.crash(ct.impact);
            this.stats.hits++;
          }
        }
        if (ct.top) {
          l.vel.x *= 0.5;
          l.vel.z *= 0.5;
          if (Math.hypot(l.vel.x, l.vel.y, l.vel.z) < 0.6) {
            l.state = 'ground';
            l.vel.set(0, 0, 0);
          }
        }
      } else if (l.state === 'broken') {
        l.respawnT -= dt;
        if (l.respawnT <= 0) {
          l.state = 'ground';
          l.yaw = l.home.yaw;
          l.pos.set(l.home.x, l.half.y, l.home.z);
          l.vel.set(0, 0, 0);
          l.mesh.visible = true;
          l.sprite.visible = true;
          l.beam.visible = true;
          this.hud.toast('🔁 새 유리 패널이 입고되었습니다', 'info');
        }
      }
    }
  }

  private simulateWorkers(dt: number) {
    if (this.workers.length === 0) return;
    const att = this.attached;
    // body: carried load box or hook
    const bh = att ? att.half : HOOK_H;
    const bc = att ? att.pos : this.bob;
    const bottom = bc.y - bh.y;
    for (const w of this.workers) {
      w.nearCd = Math.max(0, w.nearCd - dt);
      w.hitCd = Math.max(0, w.hitCd - dt);
      if (w.downT > 0) {
        w.downT -= dt;
      } else {
        const [a, b] = w.path;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        w.s += w.dir * w.speed * dt;
        if (w.s > len) { w.s = len; w.dir = -1; }
        if (w.s < 0) { w.s = 0; w.dir = 1; }
        const u = w.s / len;
        w.x = a[0] + (b[0] - a[0]) * u;
        w.z = a[1] + (b[1] - a[1]) * u;
      }
      if (this.state !== 'run') continue;
      // distance from worker to the body footprint
      const ddx = Math.max(Math.abs(w.x - bc.x) - bh.x, 0);
      const ddz = Math.max(Math.abs(w.z - bc.z) - bh.z, 0);
      const d = Math.hypot(ddx, ddz);
      if (d < 0.35 && bottom < 1.9 && w.hitCd <= 0 && w.downT <= 0) {
        w.hitCd = 4;
        w.downT = 3;
        this.stats.workerHits++;
        this.incident(10, 'hit', '🚑 작업자 충돌!', 1.0);
        this.audio.crash(4);
      } else if (d < 2.0 && bottom < 5 && w.nearCd <= 0 && w.downT <= 0) {
        w.nearCd = 5;
        this.stats.nearMiss++;
        this.hud.toast('⚠ 아슬아슬! 작업자 위를 지나갑니다', 'bad');
        this.radio('near', true);
        this.audio.warn();
      }
    }
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    this.state = 'done';
    const raw = this.t + this.penalty - this.bonus;
    const timeMs = Math.max(1000, Math.round(raw * 1000));
    const n = this.loads.length;
    const avg = this.delivered ? (this.stats.offsetSum / this.delivered) * 100 : 0;
    const clean = this.penalty === 0;
    this.opts.onEnd({
      timeMs,
      title: clean ? '🏆 무사고 크레인 달인!' : this.penalty < 12 ? '👷 안전하게 마감!' : '🧯 안전교육 다시 받으세요',
      detail: [
        { label: '양중 완료', value: `${this.delivered}/${n}` },
        { label: '순수 작업시간', value: fmtTime(this.t) },
        { label: '사고 페널티', value: `+${this.penalty.toFixed(0)}초 (${this.stats.incidents}건)` },
        { label: '정밀 보너스', value: `-${this.bonus.toFixed(0)}초 (퍼펙트 ${this.stats.perfect}회)` },
        { label: '평균 안착 오차', value: `${avg.toFixed(0)}cm` },
        { label: '구조물 충돌', value: `${this.stats.hits}회` },
        { label: '작업자 아슬아슬', value: `${this.stats.nearMiss}회 / 충돌 ${this.stats.workerHits}회` },
        { label: '파손/추락', value: `${this.stats.breaks}회 / ${this.stats.drops}회` },
        { label: '과부하 경보', value: `${this.stats.overloads}회` },
      ],
    });
  }

  // ------------------------------------------------------------ queries
  swingInfo() {
    const ox = this.bob.x - this.pivot.x;
    const oz = this.bob.z - this.pivot.z;
    const th = this.crane.theta;
    const fx = Math.cos(th), fz = Math.sin(th);
    const fwd = ox * fx + oz * fz;
    const right = -ox * fz + oz * fx;
    const dist = Math.hypot(ox, oz);
    const speed = Math.hypot(this.vel.x - this.pivotVel.x, this.vel.z - this.pivotVel.z);
    return { fwd, right, dist, speed };
  }

  bodyClearance() {
    const att = this.attached;
    if (att) {
      const bottom = att.pos.y - att.half.y;
      return bottom - this.surfaceUnder(att.pos.x, att.pos.z, att.half.x * 0.9, att.half.z * 0.9, bottom + 0.4, att);
    }
    const bottom = this.bob.y - HOOK_H.y;
    return bottom - this.surfaceUnder(this.bob.x, this.bob.z, 0.2, 0.2, bottom + 0.4);
  }

  private guide(): { text: string; kind: 'info' | 'ok' | 'warn' } {
    if (this.state === 'countdown') return { text: '준비하세요... 짐 번호와 같은 색 패드로!', kind: 'info' };
    if (this.state !== 'run') return { text: '작업 완료!', kind: 'ok' };
    const c = this.crane;
    const dirText = (tx: number, tz: number, fromX: number, fromZ: number) => {
      const bits: string[] = [];
      const dth = wrapPi(Math.atan2(tz, tx) - c.theta);
      const lateral = Math.abs(dth) * Math.hypot(tx, tz);
      if (lateral > 0.9) bits.push(dth > 0 ? '선회 ▶' : '◀ 선회');
      const dr = Math.hypot(tx, tz) - Math.hypot(fromX, fromZ);
      if (Math.abs(dr) > 0.8) bits.push(dr > 0 ? '트롤리 바깥 ⇗' : '트롤리 안쪽 ⇙');
      return bits;
    };
    if (this.attached) {
      const l = this.attached;
      const pad = this.level.pads[l.pad];
      if (this.overloadT > 0 || this.moment >= 1) return { text: `⚠ 과부하! 트롤리를 안쪽으로 (${rLimit(l.kind.mass).toFixed(0)}m 이내)`, kind: 'warn' };
      const d = Math.hypot(pad.x - l.pos.x, pad.z - l.pos.z);
      const bottom = l.pos.y - l.half.y;
      const sw = this.swingInfo();
      if (d <= this.level.tol * 0.8) {
        if (Math.abs(bottom - pad.y) <= 0.5) return { text: '지금! 🪝 걸기/풀기(Space)로 내려놓기', kind: 'ok' };
        if (sw.speed > 0.8) return { text: '흔들림부터 잡으세요 (트롤리로 받기)', kind: 'warn' };
        return { text: `${l.i + 1}번 패드 위 · 호이스트를 천천히 내리세요 ▼`, kind: 'ok' };
      }
      const bits = dirText(pad.x, pad.z, l.pos.x, l.pos.z);
      if (bottom < pad.y + 1.5 && d > 4) bits.unshift('먼저 ▲ 들어올리기');
      return { text: `${l.kind.emoji} → ${l.i + 1}번 패드 (${d.toFixed(0)}m) ${bits.join(' · ')}`, kind: 'info' };
    }
    // choose nearest remaining load
    let best: Load | null = null;
    let bd = Infinity;
    for (const l of this.loads) {
      if (l.state !== 'ground' && l.state !== 'falling') continue;
      const d = Math.hypot(l.pos.x - this.bob.x, l.pos.z - this.bob.z);
      if (d < bd) { bd = d; best = l; }
    }
    if (!best) return { text: '유리 재입고 대기중...', kind: 'info' };
    if (this.findAttachable()) return { text: `${best.kind.emoji} 지금! 🪝 걸기(Space)`, kind: 'ok' };
    const bits = dirText(best.pos.x, best.pos.z, this.bob.x, this.bob.z);
    if (bd < 3.5) bits.push('▼ 호이스트 내리고 중앙 맞추기');
    else if (this.bob.y < 12) bits.unshift('▲ 훅 높이기');
    const heavy = best.kind.mass >= 4 ? ` · 중량 ${best.kind.mass}t` : '';
    return { text: `${best.kind.emoji} ${best.i + 1}번 ${best.kind.name}${heavy} (${bd.toFixed(0)}m) ${bits.join(' · ')}`, kind: 'info' };
  }

  // ------------------------------------------------------------ rendering
  private syncVisuals(dt: number) {
    const c = this.crane;
    const rig = this.world.rig;
    rig.slew.rotation.y = -c.theta;
    rig.trolley.position.x = c.r;
    rig.group.updateMatrixWorld(true);

    // cable
    const A = this.pivot;
    const P = this.bob;
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(P.x - A.x, P.y + 0.3 - A.y, P.z - A.z);
    const len = Math.max(0.01, dir.length());
    this.cable.position.set((A.x + P.x) / 2, (A.y + P.y + 0.3) / 2, (A.z + P.z) / 2);
    this.cable.scale.set(1, len, 1);
    this.cable.quaternion.setFromUnitVectors(up, dir.normalize());
    this.hookMesh.position.copy(P);
    this.hookMesh.rotation.y = -c.theta;

    // loads
    for (const l of this.loads) {
      l.mesh.position.copy(l.pos);
      l.mesh.rotation.y = -l.yaw;
      const top = l.pos.y + l.half.y;
      l.sprite.position.set(l.pos.x, top + 2.4, l.pos.z);
      l.beam.position.set(l.pos.x, top + 7, l.pos.z);
      l.beam.visible = l.state === 'ground' || l.state === 'falling';
      l.sprite.visible = l.state !== 'delivered' && l.state !== 'broken';
    }
    // slings
    const att = this.attached;
    this.slings.visible = !!att;
    if (att) {
      const pos = this.slings.geometry.getAttribute('position') as THREE.BufferAttribute;
      const k = att.kind;
      const cs = Math.cos(-att.yaw), sn = Math.sin(-att.yaw);
      const topY = att.pos.y + att.half.y;
      let n = 0;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = (sx * k.w) / 2 * 0.8, lz = (sz * k.d) / 2 * 0.8;
        pos.setXYZ(n++, P.x, P.y - 0.35, P.z);
        pos.setXYZ(n++, att.pos.x + lx * cs + lz * sn, topY, att.pos.z - lx * sn + lz * cs);
      }
      pos.needsUpdate = true;
    }

    // laser + ring on the surface below
    const hx = att ? att.half.x * 0.9 : 0.2;
    const hz = att ? att.half.z * 0.9 : 0.2;
    const ref = att ? att.pos : P;
    const bottom = att ? att.pos.y - att.half.y : P.y - HOOK_H.y;
    const surf = this.surfaceUnder(ref.x, ref.z, hx, hz, bottom + 0.4, att);
    const lh = Math.max(0.05, P.y - surf);
    this.laser.position.set(ref.x, surf + lh / 2, ref.z);
    this.laser.scale.set(1, lh, 1);
    this.ringMarker.position.set(ref.x, surf + 0.06, ref.z);
    const rr = att ? Math.max(att.half.x, att.half.z, 0.8) : 0.7;
    this.ringMarker.scale.setScalar(rr);
    const near = this.findAttachable();
    const col = near ? 0x40ff80 : this.attached && this.moment >= 0.999 ? 0xffa030 : 0xff3030;
    this.ringMat.color.setHex(col);
    this.laserMat.color.setHex(col);

    // pads pulse
    const tt = performance.now() / 1000;
    this.world.pads.forEach((pv, i) => {
      const l = this.loads[i];
      const active = this.attached === l;
      const done = l.state === 'delivered';
      pv.group.visible = !done;
      const pulse = 0.5 + 0.5 * Math.sin(tt * 5);
      (pv.mats[0] as THREE.MeshBasicMaterial).opacity = active ? 0.7 + 0.3 * pulse : 0.55;
      (pv.mats[1] as THREE.MeshBasicMaterial).opacity = active ? 0.25 + 0.25 * pulse : 0.12;
      (pv.mats[2] as THREE.MeshBasicMaterial).opacity = active ? 0.55 : 0.2;
    });

    // workers
    for (const w of this.workers) {
      w.mesh.position.set(w.x, 0, w.z);
      const [a, b] = w.path;
      w.mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]) + (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const down = w.downT > 0;
      w.mesh.rotation.x = down ? -Math.PI / 2 : 0;
      w.mesh.position.y = down ? 0.25 : Math.abs(Math.sin(this.t * 7 + w.x)) * 0.05;
    }
    void dt;
  }

  private render(dt: number, now: number) {
    this.syncVisuals(dt);
    const cam = this.camera;
    const bob = this.bob;
    const rig = this.world.rig;
    // aim smoothing
    const k = 1 - Math.exp(-7 * dt);
    const tgt = new THREE.Vector3(bob.x, bob.y - (this.attached ? 1.5 : 0.5), bob.z);
    this.aim.lerp(tgt, dt === 0 ? 1 : k);
    let targetFov = 70;
    if (this.camMode === 0) {
      const eye = rig.slew.localToWorld(new THREE.Vector3(2.9, -2.35, -2.1));
      cam.position.copy(eye);
      const dist = eye.distanceTo(this.aim);
      targetFov = 72 - 30 * clamp((dist - 10) / 26, 0, 1);
      const dv = this.aim.clone().sub(eye);
      const hl = Math.hypot(dv.x, dv.z) || 1;
      const hookPitch = Math.atan2(dv.y, hl);
      const pitch = Math.max(hookPitch, -0.85);
      const offs = pitch - hookPitch; // radians the hook sits below view centre
      targetFov = clamp(Math.max(targetFov, 2 * (offs + 0.32) * 57.3), 40, 88);
      cam.up.set(0, 1, 0);
      cam.lookAt(eye.x + (dv.x / hl) * Math.cos(pitch) * 10, eye.y + Math.sin(pitch) * 10, eye.z + (dv.z / hl) * Math.cos(pitch) * 10);
    } else if (this.camMode === 1) {
      const ux = bob.x, uz = bob.z;
      const ul = Math.hypot(ux, uz) || 1;
      const nx = ux / ul, nz = uz / ul;
      const want = new THREE.Vector3(bob.x - nx * 13 - nz * 4, bob.y + 4.5, bob.z - nz * 13 + nx * 4);
      want.y = Math.max(want.y, 2.5);
      if (dt === 0) this.camPos.copy(want);
      else this.camPos.lerp(want, 1 - Math.exp(-3.5 * dt));
      cam.position.copy(this.camPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(bob.x, bob.y - 3, bob.z);
      targetFov = 62;
    } else {
      const cx = bob.x * 0.5, cz = bob.z * 0.5;
      cam.position.set(cx, 82, cz + 0.001);
      cam.up.set(0, 0, -1);
      cam.lookAt(cx, 0, cz);
      targetFov = 62;
    }
    this.fov += (targetFov - this.fov) * (dt === 0 ? 1 : 1 - Math.exp(-4 * dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    if (this.shake > 0) {
      const s = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
    }
    this.renderer.render(this.scene, cam);

    // HUD at ~15 Hz
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.066;
      const sw = this.swingInfo();
      const g = this.guide();
      const att = this.attached;
      const d: HudData = {
        time: this.t,
        delivered: this.delivered,
        total: this.loads.length,
        penalty: this.penalty,
        bonus: this.bonus,
        hookH: this.bodyClearance(),
        hookVy: this.vel.y,
        radius: this.crane.r,
        cable: this.crane.L,
        moment: this.moment,
        loadMass: this.carriedMass,
        wind: this.wind.speed,
        windAngle: this.wind.dir,
        jibAngle: this.crane.theta,
        swingX: sw.right,
        swingY: sw.fwd,
        swingSpeed: sw.speed,
        guide: g.text,
        guideKind: g.kind,
        camLabel: CAMS[this.camMode],
        overload: this.overloadT > 0 || this.moment > 1,
        canAttach: !!this.findAttachable(),
        fragile: !!att && att.kind.fragile,
      };
      this.hud.update(d, this.camMode === 0);
      if (g.text !== this.lastGuide) this.lastGuide = g.text;
      this.overlay.querySelectorAll('.cr-tb.act').forEach((b) => b.classList.toggle('hint', d.canAttach || (!!att && g.kind === 'ok')));
    }
    this.hud.drawRadar({
      theta: this.crane.theta, r: this.crane.r, jibLen: 40, hook: [bob.x, bob.z],
      loads: this.loads.map((l) => ({ x: l.pos.x, z: l.pos.z, c: cssHex(l.color), carried: l.state === 'attached', done: l.state === 'delivered' || l.state === 'broken' })),
      pads: this.level.pads.map((p, i) => {
        const li = this.loads.findIndex((l) => l.pad === i);
        const l = this.loads[li];
        return { x: p.x, z: p.z, c: cssHex(PAD_COLORS[li % PAD_COLORS.length]), active: this.attached === l };
      }),
      workers: this.workers.map((w) => [w.x, w.z] as [number, number]),
      blocks: this.level.blocks.map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d, building: b.kind === 'building' })),
    }, now);
  }
}
