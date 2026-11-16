import * as THREE from 'three';
import { collide, obbVsCircle, type Collider } from '../forklift/collide';
import { fmtTime } from '../forklift/hud';
import { KEYMAP_SOLO, KeyboardControls, isTouchDevice, type ControlSource, type ControlState } from '../forklift/input';
import { Particles } from '../forklift/particles';
import type { MiniGame, MiniGameOptions, MiniGameResult } from '../../platform/minigame';
import { DumpAudio } from './audio';
import { DtHud, type DtHudData } from './hud';
import { DumpTouchControls } from './input';
import { CAP_T, LEVELS } from './levels';
import { pickLine, RADIO } from './lines';
import { bedPeak, DumpTruck, TK } from './truck';
import { World, type DCol } from './world';

const STEP = 1 / 60;
const G = 9.81;
const LOSS_PEN = 0.5; // seconds per ton that never reaches the bay
const CAM_LABELS = ['추적', '운전석', '탑뷰'];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const zeroCtl = (): ControlState => ({ throttle: 0, steer: 0, lift: 0, handbrake: false, turbo: false, horn: false, camPressed: false, tiltPressed: false });
const cssColor = (c: number) => '#' + c.toString(16).padStart(6, '0');

interface Pose { x: number; z: number; yaw: number }

export interface DumpStats {
  delivered: number; // tons in the bay
  lost: number; // tons spilled / dumped elsewhere
  trips: number;
  penalty: number;
  bonus: number;
  crashes: number;
  cones: number;
  rollovers: number;
  bars: number;
  workers: number;
  illegal: number;
  weighMiss: number;
  zeroSpill: number;
  oneShot: number;
  center: number;
  maxSpeed: number;
}

export class DumpGame implements MiniGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly world: World;
  readonly truck: DumpTruck;
  readonly audio = new DumpAudio();
  readonly stats: DumpStats = { delivered: 0, lost: 0, trips: 0, penalty: 0, bonus: 0, crashes: 0, cones: 0, rollovers: 0, bars: 0, workers: 0, illegal: 0, weighMiss: 0, zeroSpill: 0, oneShot: 0, center: 0, maxSpeed: 0 };
  ctrl: ControlSource;
  state: 'countdown' | 'run' | 'done' = 'countdown';
  t = 0;
  risk = 0;
  hauling = false; // loaded and on the way to the bay
  tripLost = 0;
  camMode = 0;
  readonly target: number;
  readonly spillBy = { bump: 0, turn: 0, brake: 0, other: 0 };

  private hud: DtHud;
  private particles: Particles;
  private overlay: HTMLDivElement;
  private cam = new THREE.PerspectiveCamera(65, 1, 0.3, 600);
  private sun: THREE.DirectionalLight;
  private resizeObs: ResizeObserver;
  private touch: DumpTouchControls | null = null;
  private colorCss: string;
  private nick: string;
  private quality: 'high' | 'low';
  private countdown = 3.2;
  private lastCount = 4;
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  private paused = false;
  private muted = false;
  private disposed = false;
  private camR = 0;
  private shake = 0;
  private dwell = 0;
  private brakeLevel = 0;
  private tipTimer = 0;
  private rolling = 0; // >0 : rollover sequence timer
  private feat = [0, 0, 0, 0, 0, 0]; // previous feature heights (rear, front) x 3
  private jolt = 0;
  private aLat = 0;
  private near = { i: 0, d: 0, x: 0, z: 0, y: 0, s: 0, tx: 0, tz: 1, lat: 0 };
  private safe: Pose[] = [];
  private safeT = 0;
  private lastRadio = -10;
  private lastHit = -10;
  private lastCone = -10;
  private lastSpillMsg = -10;
  private lastBump = -10;
  private spillAcc = 0;
  private lastTip = -10;
  private loadedFlag = false;
  private reverseStarts = 0;
  private forwardCorr = 0;
  private weighed = false;
  private inWeigh = false;
  private weighT = 0;
  private weighMissed = false;
  private dump = { active: false, inT: 0, outT: 0, sumW: 0, sumLat: 0, sumLon: 0, yawErr: 0, px: 0, pz: 0, started: false };
  private pen: Record<string, number> = {};
  private warnText = '';
  private endTimer = 0;
  private bedMove = 0;

  constructor(private opts: MiniGameOptions) {
    const lv = LEVELS[opts.level - 1] ?? LEVELS[0];
    const container = opts.container;
    const mobile = isTouchDevice() || window.innerWidth < 800;
    this.quality = mobile ? 'low' : 'high';
    this.nick = opts.nickname;
    this.colorCss = cssColor(opts.color);
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';

    this.overlay = document.createElement('div');
    this.overlay.className = 'game-overlay';
    container.appendChild(this.overlay);

    const dusk = lv.look === 'dusk';
    this.scene.background = new THREE.Color(dusk ? 0xe0a070 : 0x9ec9ff);
    this.scene.fog = dusk ? new THREE.Fog(0xd8966a, 50, 230) : new THREE.Fog(0xc4d6e6, 90, 290);
    this.scene.add(new THREE.HemisphereLight(dusk ? 0xffcfa0 : 0xdfefff, dusk ? 0x3b2a30 : 0x6b5a45, dusk ? 0.85 : 1.15));
    this.sun = new THREE.DirectionalLight(dusk ? 0xffa860 : 0xfff1d6, dusk ? 1.6 : 2.1);
    this.sun.castShadow = this.quality === 'high';
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 180;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);

    this.world = new World(lv, this.quality);
    this.scene.add(this.world.group);
    this.target = lv.loads * CAP_T * lv.targetFrac;

    this.truck = new DumpTruck(opts.color, dusk);
    this.truck.x = lv.spawn.x;
    this.truck.z = lv.spawn.z;
    this.truck.yaw = lv.spawn.yaw;
    this.truck.vy = this.world.terrainAt(lv.spawn.x, lv.spawn.z);
    this.scene.add(this.truck.group);
    this.particles = new Particles(this.scene, 320);

    this.ctrl = isTouchDevice() ? (this.touch = new DumpTouchControls(this.overlay)) : new KeyboardControls(KEYMAP_SOLO, 0);
    this.hud = new DtHud(this.overlay, this.nick, this.colorCss, this.world, !!this.touch);

    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();

    this.audio.init(1);
    this.audio.resume();
    this.hud.toast(pickLine('start'), 'radio');
    this.safe.push({ x: lv.spawn.x, z: lv.spawn.z, yaw: lv.spawn.yaw });
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ plumbing
  private layout() {
    const c = this.opts.container;
    const w = c.clientWidth;
    const h = c.clientHeight;
    this.renderer.setSize(w, h);
    this.cam.aspect = w / Math.max(1, h);
    this.cam.updateProjectionMatrix();
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
    this.audio.setMuted(p || this.muted);
    if (!p) this.lastFrame = performance.now();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.audio.setMuted(m || this.paused);
  }

  /** testing helper: skip the 3-2-1 */
  skipCountdown() {
    this.countdown = 0;
  }

  private radio(key: keyof typeof RADIO, force = false) {
    if (!force && this.t - this.lastRadio < 4.5) return;
    this.lastRadio = this.t;
    this.hud.toast(pickLine(key), 'radio');
  }

  private addPenalty(sec: number, key: string) {
    this.stats.penalty += sec;
    this.pen[key] = (this.pen[key] ?? 0) + sec;
  }
  private addBonus(sec: number) {
    this.stats.bonus += sec;
  }

  // ------------------------------------------------------------------ simulation
  step(dt: number) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n <= 3) {
        this.lastCount = n;
        if (n > 0) {
          this.audio.countdown(false);
          this.hud.center(String(n), 'count');
        }
      }
      if (this.countdown <= 0) {
        this.state = 'run';
        this.audio.countdown(true);
        this.hud.center('GO!', 'count go');
        setTimeout(() => this.hud.center(''), 800);
      }
    } else if (this.state === 'run') this.t += dt;

    this.world.update(dt, this.t);
    this.particles.update(dt);

    const raw = this.ctrl.read();
    if (raw.camPressed) {
      this.camMode = (this.camMode + 1) % 3;
      this.truck.setView(this.camMode === 1);
    }
    const live = this.state === 'run' && this.rolling <= 0;
    const ctl = live ? raw : { ...zeroCtl(), horn: raw.horn };

    if (this.rolling > 0) this.stepRollover(dt);
    else this.stepTruck(dt, ctl);

    if (this.state === 'run') {
      this.stepLoading(dt);
      this.stepDump(dt);
      this.stepHazards(dt);
      this.stepWeigh(dt);
      this.recordSafe(dt);
    }
    this.world.route.nearest(this.truck.x, this.truck.z, this.near);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, Math.abs(this.truck.speed));

    // audio
    const T = this.truck;
    const vf = T.speed;
    this.audio.update(0, dt, vf * (T.load > 0.5 ? 0.8 : 1), ctl.throttle, T.gear === 'R' && this.state === 'run', ctl.horn, this.bedMove, 1);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.state === 'run') this.checkEnd(dt);
  }

  private onGear(g: 'D' | 'R') {
    const T = this.truck;
    T.gear = g;
    const bd = Math.hypot(T.x - this.world.bayC[0], T.z - this.world.bayC[1]);
    if (this.hauling && bd < 40) {
      if (g === 'R') {
        this.reverseStarts++;
        if (this.reverseStarts === 1) this.radio('reverse');
      } else if (this.reverseStarts > 0) this.forwardCorr++;
    }
  }

  private stepTruck(dt: number, ctl: ControlState) {
    const T = this.truck;
    const w = this.world;
    const Lw = TK.wheelbase;
    const [fx, fz] = T.fwd;
    const [lx, lz] = T.left;
    let vf = T.vx * fx + T.vz * fz;
    let vl = T.vx * lx + T.vz * lz;
    const vf0 = vf;
    const lf = T.load;

    // ---- bed hydraulics (slow, slower when loaded)
    const bedRate = ctl.lift > 0 ? (14 - 5 * lf) : 18;
    const bed0 = T.bed;
    if (ctl.lift !== 0) T.bed = clamp(T.bed + ctl.lift * bedRate * (Math.PI / 180) * dt, 0, TK.maxBed);
    this.bedMove = (T.bed - bed0) / dt > 0.01 ? 1 : (T.bed - bed0) / dt < -0.01 ? -1 : 0;

    // ---- terrain under the truck
    const xF = T.x + fx * Lw;
    const zF = T.z + fz * Lw;
    const tR = w.terrainAt(T.x, T.z);
    const tF = w.terrainAt(xF, zF);
    const slope = (tF - tR) / Lw;
    const mx = T.x + fx * 2;
    const mz = T.z + fz * 2;
    const sL = (w.terrainAt(mx + lx * 1.4, mz + lz * 1.4) - w.terrainAt(mx - lx * 1.4, mz - lz * 1.4)) / 2.8;
    const mud = w.mudAt(T.x, T.z);
    const tract = mud ? 0.4 : 1;

    // ---- gear / pedals
    let gs = T.gear === 'D' ? 1 : -1;
    const th = ctl.throttle;
    let accelIn = th * gs;
    if (accelIn < 0) {
      const vg0 = vf * gs;
      if (vg0 < -0.35) {
        gs = -gs;
        this.onGear(gs > 0 ? 'D' : 'R');
        accelIn = -accelIn;
        this.dwell = 0;
      } else if (vg0 < 0.3) {
        this.dwell += dt;
        if (this.dwell > 0.3) {
          gs = -gs;
          this.onGear(gs > 0 ? 'D' : 'R');
          accelIn = -accelIn;
          this.dwell = 0;
        }
      } else this.dwell = 0;
    } else this.dwell = 0;
    const vg = vf * gs;
    const brakeIn = accelIn < 0 && vg > 0.3 ? -accelIn : 0;
    this.brakeLevel = brakeIn > 0 ? Math.min(1, this.brakeLevel + dt * 1.7) : Math.max(0, this.brakeLevel - dt * 5);

    const bedUp = T.bed > 0.17;
    let vmaxF = 14.5 - 3.5 * lf;
    if (bedUp) vmaxF = Math.min(vmaxF, 5.5);
    const vmax = gs > 0 ? vmaxF : 3.4;
    const accMax = gs > 0 ? 3.4 - 1.7 * lf : 1.6 - 0.3 * lf;
    const brakeDec = (6.0 - 2.0 * lf) * (mud ? 0.45 : 1);
    let a = 0; // along +fwd
    let coasting = false;
    if (accelIn > 0) {
      const tv = vmax * accelIn;
      let ag: number;
      if (vg < tv) ag = accMax * (1 - Math.pow(clamp(Math.max(0, vg) / vmax, 0, 1), 1.5)) * tract;
      else ag = -0.7;
      if (vg < 0) ag += 5;
      a += gs * ag;
    } else if (brakeIn > 0) {
      a += -Math.sign(vf) * brakeDec * brakeIn * this.brakeLevel;
    } else if (Math.abs(vf) > 0.05) {
      coasting = true;
      a += -Math.sign(vf) * ((mud ? 0.6 : 0.32) + 0.004 * vf * vf);
    }
    if (vf > vmaxF + 0.5) a -= 1.5;
    const auto = Math.abs(vf) < 0.18 && accelIn <= 0 && Math.abs(slope) < 0.22;
    if (!auto) a += -G * slope * 0.9;
    let nv = vf + a * dt;
    if ((brakeIn > 0 || coasting) && Math.sign(nv) !== Math.sign(vf) && !(Math.abs(G * slope) > 1.2)) nv = 0;
    vf = nv;
    if (auto) vf = 0;
    if (ctl.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 7 * tract * dt);
    T.setBrake(brakeIn > 0 || ctl.handbrake);
    const decel = ((vf0 - vf) / dt) * Math.sign(vf0 || 1);

    // ---- steering
    const maxSteer = THREE.MathUtils.lerp(0.52, 0.2, clamp(Math.abs(vf) / 12, 0, 1));
    const sTarget = -ctl.steer * maxSteer;
    const sRate = ctl.steer !== 0 ? 1.5 : 2.4;
    T.steer += clamp(sTarget - T.steer, -sRate * dt, sRate * dt);
    let yr = (vf * Math.tan(T.steer)) / Lw;
    if (ctl.handbrake) yr *= 1.3;
    const grip = mud ? 0.9 : ctl.handbrake ? 1.8 : 7.5 - 1.5 * lf;
    vl *= Math.exp(-grip * dt);
    T.vx = fx * vf + lx * vl;
    T.vz = fz * vf + lz * vl;
    T.x += T.vx * dt;
    T.z += T.vz * dt;
    T.yaw += yr * dt;

    // ---- stability
    const b = T.bed / TK.maxBed;
    const raised = Math.pow(b, 1.3);
    const limit = 11 * (1 - 0.12 * lf) * Math.max(0.08, 1 - 1.05 * raised * (0.4 + 0.6 * lf));
    const aEff = vf * yr + G * sL * 2.2;
    this.aLat = Math.abs(vf * yr);
    this.risk = Math.abs(aEff) / Math.max(0.5, limit);
    if (this.risk > 1) this.tipTimer += dt;
    else this.tipTimer = Math.max(0, this.tipTimer - dt * 2);
    if (this.risk > 0.7 && this.t - this.lastTip > 6) {
      this.lastTip = this.t;
      this.radio('tip', true);
    }
    if (this.tipTimer > 0.35 && this.state === 'run') {
      this.startRollover(Math.sign(aEff) || 1);
      return;
    }

    // ---- collisions, bounds
    this.resolve();

    // ---- vertical + visual attitude
    const fR = w.featureAt(T.x, T.z);
    const xF2 = T.x + T.fwd[0] * Lw;
    const zF2 = T.z + T.fwd[1] * Lw;
    const fF = w.featureAt(xF2, zF2);
    const gR = w.terrainAt(T.x, T.z) + fR;
    const gF = w.terrainAt(xF2, zF2) + fF;
    const p = this.feat;
    const azR = (fR - 2 * p[0] + p[1]) / (dt * dt);
    const azF = (fF - 2 * p[2] + p[3]) / (dt * dt);
    p[1] = p[0]; p[0] = fR; p[3] = p[2]; p[2] = fF;
    this.jolt = Math.max(Math.abs(azR), Math.abs(azF));
    const kv = 1 - Math.exp(-22 * dt);
    T.vy += (gR - T.vy) * kv;
    T.y = T.vy;
    const pitchT = Math.atan2(gF - gR, Lw);
    T.pitch += (pitchT - T.pitch) * (1 - Math.exp(-10 * dt));
    const rollT = Math.atan(sL) + clamp(aEff * 0.011 * (1 + raised * 1.6), -0.3, 0.3);
    T.roll += (rollT - T.roll) * (1 - Math.exp(-6 * dt));

    // ---- spill
    if (lf > 0.004) {
      let sp = 0;
      if (this.jolt > 24) {
        const q = Math.min(0.03, (this.jolt - 24) * dt * 0.01);
        sp += q;
        this.spillBy.bump += q * CAP_T;
        if (this.t - this.lastBump > 3 && this.jolt > 30) {
          this.lastBump = this.t;
          this.radio('bump');
          this.shake = Math.max(this.shake, 0.45);
        }
      }
      if (this.aLat > 2.6) {
        const q = (this.aLat - 2.6) * dt * 0.008;
        sp += q;
        this.spillBy.turn += q * CAP_T;
      }
      if (decel > 2.6 && Math.abs(vf0) > 1) {
        const q = (decel - 2.6) * dt * 0.012;
        sp += q;
        this.spillBy.brake += q * CAP_T;
      }
      if (ctl.handbrake && Math.abs(vf) > 3) sp += 0.02 * dt;
      if (sp > 0) this.spill(sp);
    }

    // dust
    if (Math.abs(vf) > 4 && Math.random() < Math.min(0.7, Math.abs(vf) / 18)) {
      const sd = Math.random() < 0.5 ? -1 : 1;
      this.particles.spawn(T.x - fx * 1.0 + lx * 1.2 * sd, T.y + 0.3, T.z - fz * 1.0 + lz * 1.2 * sd, (Math.random() - 0.5) * 1.2, 0.8, (Math.random() - 0.5) * 1.2, mud ? 0x4b3b2d : this.world.level.look === 'dusk' ? 0x9a8470 : 0xc4b494, 0.9, 0.5, -0.4, 1.4);
    }
  }

  private spill(frac: number) {
    const T = this.truck;
    const amt = Math.min(T.load, frac);
    if (amt <= 0) return;
    T.load -= amt;
    const tons = amt * CAP_T;
    this.stats.lost += tons;
    this.tripLost += tons;
    this.addPenalty(tons * LOSS_PEN, 'spill');
    this.spillAcc += amt;
    while (this.spillAcc > 0.0035) {
      this.spillAcc -= 0.0035;
      const sd = Math.random() < 0.5 ? -1 : 1;
      const [px, py, pz] = T.bedPoint(sd * (0.6 + Math.random() * 0.8), 0.4 + Math.random() * (TK.bedLen - 0.8));
      const [lx, lz] = T.left;
      const [fx, fz] = T.fwd;
      this.particles.spawn(px, py + 0.9 + T.load, pz, lx * sd * (1 + Math.random() * 2.5) - fx * 1.2 + T.vx * 0.5, 1.5 + Math.random() * 2, lz * sd * (1 + Math.random() * 2.5) - fz * 1.2 + T.vz * 0.5, Math.random() < 0.5 ? 0x7b6249 : 0x9a8466, 1.0, 0.2 + Math.random() * 0.15, 16);
    }
    if (this.t - this.lastSpillMsg > 7 && this.tripLost > 0.6) {
      this.lastSpillMsg = this.t;
      this.hud.toast(`🍂 적재물 유실 −${this.tripLost.toFixed(1)}t`, 'bad');
      this.radio('spill');
    }
  }

  // ---- collisions
  private resolve() {
    const T = this.truck;
    const w = this.world;
    const b = w.bounds;
    // world bounds
    if (T.x < b.x0) { T.x = b.x0; T.vx = Math.max(0, T.vx); }
    if (T.x > b.x1) { T.x = b.x1; T.vx = Math.min(0, T.vx); }
    if (T.z < b.z0) { T.z = b.z0; T.vz = Math.max(0, T.vz); }
    if (T.z > b.z1) { T.z = b.z1; T.vz = Math.min(0, T.vz); }
    const cols: DCol[] = [];
    for (const c of w.statics) cols.push(c);
    for (const m of w.movers) if (m.def.kind === 'vehicle') cols.push(m.col);
    let impact = 0;
    let hit: DCol | null = null;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      const body = T.bodyObb();
      for (const c of cols) {
        if (c.clear !== undefined) continue;
        if (c.obb) {
          if (Math.abs(c.obb.x - body.x) > 14 || Math.abs(c.obb.z - body.z) > 14) continue;
        }
        const h = collide(body, c as Collider);
        if (!h) continue;
        any = true;
        T.x += h.nx * h.depth;
        T.z += h.nz * h.depth;
        body.x += h.nx * h.depth;
        body.z += h.nz * h.depth;
        const rv = (T.vx - (c.vx ?? 0)) * h.nx + (T.vz - (c.vz ?? 0)) * h.nz;
        if (rv < 0) {
          T.vx -= 1.2 * rv * h.nx;
          T.vz -= 1.2 * rv * h.nz;
          T.vx *= 0.985;
          T.vz *= 0.985;
          if (-rv > impact) {
            impact = -rv;
            hit = c;
          }
        }
      }
      if (!any) break;
    }
    if (hit && impact > 1.7 && this.t - this.lastHit > 0.7 && this.state === 'run') {
      this.lastHit = this.t;
      this.stats.crashes++;
      const pen = (hit.pen ?? 2) * (impact > 4 ? 1.5 : 1);
      this.addPenalty(pen, 'crash');
      this.shake = Math.min(1.2, impact * 0.18);
      this.audio.crash(impact * 1.5);
      this.hud.toast(`💥 ${hit.label ?? '충돌'} 쾅! +${pen.toFixed(0)}s`, 'bad');
      this.radio('crash');
      if (this.truck.load > 0) this.spill(0.012 * impact);
      const [fx, fz] = T.fwd;
      this.particles.burst(T.x + fx * 2, 1, T.z + fz * 2, 8, 0xffcc33, impact * 0.7, 0.1, 0.5);
    }
  }

  // ---- rollover accident
  private startRollover(sign: number) {
    const T = this.truck;
    this.rolling = 3.4;
    T.rollSign = sign;
    this.tipTimer = 0;
    this.stats.rollovers++;
    this.addPenalty(20, 'roll');
    this.shake = 1.2;
    this.audio.crash(10);
    this.audio.thud();
    if (T.load > 0) this.spill(T.load * 0.5);
    this.hud.toast('🙃 전복 사고!! +20s (크레인 출동)', 'bad');
    this.radio('roll', true);
    const [fx, fz] = T.fwd;
    this.particles.burst(T.x + fx * 2, 1, T.z + fz * 2, 24, 0x8a7a60, 5, 0.3, 1.2);
  }

  private stepRollover(dt: number) {
    const T = this.truck;
    this.rolling -= dt;
    const el = 3.4 - this.rolling;
    T.rollOver = Math.min(1, el / 0.9);
    T.vx *= Math.exp(-3 * dt);
    T.vz *= Math.exp(-3 * dt);
    T.x += T.vx * dt;
    T.z += T.vz * dt;
    T.bed = Math.max(0, T.bed - dt * 0.3);
    this.bedMove = 0;
    if (this.rolling <= 1.0 && T.rollOver > 0) T.rollOver = Math.max(0, this.rolling / 1.0);
    if (this.rolling <= 0) {
      const pose = this.safe[Math.max(0, this.safe.length - 8)] ?? this.safe[0];
      T.x = pose.x; T.z = pose.z; T.yaw = pose.yaw;
      T.vx = T.vz = 0;
      T.bed = 0;
      T.rollOver = 0;
      T.steer = 0;
      T.gear = 'D';
      T.vy = this.world.terrainAt(T.x, T.z);
      T.pitch = 0;
      T.roll = 0;
      this.risk = 0;
      this.rolling = 0;
      this.hud.toast('🚛 크레인이 바로 세워줬다. 안전운전!', 'info');
    }
  }

  private recordSafe(dt: number) {
    if (this.rolling > 0) return;
    this.safeT -= dt;
    if (this.safeT > 0) return;
    this.safeT = 0.5;
    if (this.risk < 0.4 && this.truck.bed < 0.1) {
      this.safe.push({ x: this.truck.x, z: this.truck.z, yaw: this.truck.yaw });
      if (this.safe.length > 14) this.safe.shift();
    }
  }

  // ---- loading under the hopper
  private stepLoading(dt: number) {
    const T = this.truck;
    const w = this.world;
    const [bx, bz] = T.bedCenter();
    const d = Math.hypot(bx - w.chute[0], bz - w.chute[1]);
    const speed = Math.abs(T.speed);
    const canLoad = d < 1.9 && speed < 0.7 && T.bed < 0.06 && T.load < 0.995 && this.rolling <= 0;
    w.setLamp(canLoad ? 'green' : d < 16 ? 'amber' : 'red');
    if (canLoad) {
      const was = T.load;
      T.load = Math.min(1, T.load + dt / 3.4);
      if (was < 0.5 && T.load >= 0.5) this.hud.toast('⛰ 상차 중... 움직이지 마세요', 'info');
      if (Math.random() < 0.7) {
        const py = w.terrainAt(w.chute[0], w.chute[1]) + 5.0;
        this.particles.spawn(w.chute[0] + (Math.random() - 0.5) * 0.8, py, w.chute[1] + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, -1, (Math.random() - 0.5) * 0.8, Math.random() < 0.5 ? 0x7b6249 : 0x9a8466, 0.42, 0.28, 18);
      }
      this.audio.rumble(0.6);
      if (T.load >= 1 && !this.loadedFlag) {
        this.loadedFlag = true;
        this.hauling = true;
        this.tripLost = 0;
        this.reverseStarts = 0;
        this.forwardCorr = 0;
        this.weighed = false;
        this.weighMissed = false;
        this.audio.pickup();
        this.hud.toast('✅ 상차 완료 25t — 부드럽게 출발!', 'good');
        this.radio('loaded', true);
      }
    }
    if (!this.hauling && T.load > 0.5 && T.load < 0.995 && !canLoad) {
      /* partially filled stays loaded but is not counted as a 'full' trip */
    }
    if (T.load > 0.5) this.hauling = true;
  }

  private bayLocal(px: number, pz: number) {
    const w = this.world;
    const dx = px - w.bayC[0];
    const dz = pz - w.bayC[1];
    return { lat: dx * w.bayL[0] + dz * w.bayL[1], lon: dx * w.bayU[0] + dz * w.bayU[1] };
  }

  private inBay(px: number, pz: number) {
    const b = this.world.level.bay;
    const { lat, lon } = this.bayLocal(px, pz);
    return Math.abs(lat) <= b.w / 2 + 0.25 && lon <= b.d / 2 && lon >= -b.d / 2 - 2.6;
  }

  // ---- dumping
  private stepDump(dt: number) {
    const T = this.truck;
    const w = this.world;
    const deg = (T.bed * 180) / Math.PI;
    if (T.load > 0.004 && deg > 33) {
      const rate = clamp((deg - 33) / 19, 0, 1);
      const out = Math.min(T.load, (0.04 + 0.28 * rate) * dt);
      const [tx, tz] = T.tail();
      const [fx, fz] = T.fwd;
      const dist = 0.5 + 1.6 * rate;
      const px = tx - fx * dist;
      const pz = tz - fz * dist;
      const ev = this.dump;
      if (!ev.active) {
        ev.active = true;
        ev.inT = 0; ev.outT = 0; ev.sumW = 0; ev.sumLat = 0; ev.sumLon = 0; ev.yawErr = 0; ev.started = false;
        w.pileT = 0;
        w.pile.scale.set(0.01, 0.01, 0.01);
        w.pile.visible = false;
        this.radio('dump');
      }
      if (!ev.started && T.load < 0.97) {
        ev.started = true;
        // style checks at the moment material really starts to flow
        if (this.hauling && this.tripLost <= 0.5) {
          this.stats.zeroSpill++;
          this.addBonus(3);
          this.hud.toast('✨ 무손실 운반! −3s', 'good');
          this.radio('zero', true);
        }
        if (this.hauling && this.reverseStarts === 1 && this.forwardCorr === 0 && this.inBay(tx, tz)) {
          this.stats.oneShot++;
          this.addBonus(4);
          this.hud.toast('🅿️ 한방 후진 주차! −4s', 'good');
          this.radio('oneShot', true);
        }
      }
      const tons = out * CAP_T;
      T.load -= out;
      const inside = this.inBay(px, pz);
      if (inside) {
        this.stats.delivered += tons;
        ev.inT += tons;
        const { lat, lon } = this.bayLocal(px, pz);
        ev.sumW += tons;
        ev.sumLat += lat * tons;
        ev.sumLon += lon * tons;
        ev.yawErr += Math.abs(wrap(T.yaw - w.level.bay.yaw)) * tons;
        ev.px = px;
        ev.pz = pz;
        // pile
        const ground = w.terrainAt(px, pz);
        const frac = clamp(ev.inT / CAP_T, 0, 1);
        w.pile.visible = true;
        const r = 1.2 + 1.9 * Math.sqrt(frac);
        const h = 0.4 + 1.9 * frac;
        w.pile.scale.set(r, h, r);
        w.pile.position.set(px, ground + h / 2, pz);
      } else {
        ev.outT += tons;
        this.stats.lost += tons;
        this.addPenalty(tons * LOSS_PEN, 'spill');
      }
      // flying dirt
      const n = Math.ceil(out * 700);
      for (let i = 0; i < n; i++) {
        const [lx, lz] = T.left;
        const sd = (Math.random() - 0.5) * 2.4;
        this.particles.spawn(tx + lx * sd, T.y + 1.2 + T.bed * 1.5, tz + lz * sd, -fx * (1.2 + Math.random() * 2) + T.vx, 0.5 + Math.random(), -fz * (1.2 + Math.random() * 2) + T.vz, Math.random() < 0.5 ? 0x7b6249 : 0x9a8466, 1.0, 0.22 + Math.random() * 0.2, 16);
      }
      this.audio.rumble(0.3 + rate * 0.6);
      if (T.load <= 0.02 || (deg > 40 && T.load < 0.03)) {
        T.load = 0;
        this.finishDump();
      }
    } else if (this.dump.active && T.load <= 0.004) {
      this.finishDump();
    }
    // leaving the hopper area empty
  }

  private finishDump() {
    const ev = this.dump;
    if (!ev.active) return;
    ev.active = false;
    const T = this.truck;
    const w = this.world;
    this.truck.load = 0;
    this.stats.trips++;
    this.hauling = false;
    this.loadedFlag = false;
    const total = ev.inT + ev.outT;
    this.hud.toast(`🏗 납품 ${ev.inT.toFixed(1)}t / ${total.toFixed(1)}t`, ev.inT > total * 0.9 ? 'good' : 'info');
    if (ev.outT > 2.5) {
      this.stats.illegal++;
      this.addPenalty(10, 'illegal');
      this.hud.toast('🚫 불법 투기! 과태료 +10s', 'bad');
      this.radio('illegal', true);
    } else {
      this.radio('dumped');
    }
    if (ev.sumW > 0.75 * CAP_T * 0.8) {
      const lat = Math.abs(ev.sumLat / ev.sumW);
      const yawErr = ev.yawErr / ev.sumW;
      if (lat < 0.9 && yawErr < 0.2 && ev.outT < 1) {
        this.stats.center++;
        this.addBonus(2);
        this.hud.toast('🎯 정중앙 투하! −2s', 'good');
        this.radio('center', true);
      }
    }
    // the bulldozer clears the pile after a moment
    w.pileT = 0.001;
    this.audio.deliver(true);
    void T;
    if (this.target - this.stats.delivered < CAP_T * 1.05 && this.stats.delivered < this.target) this.radio('last');
  }

  // ---- cones, movers, bar, workers
  private stepHazards(dt: number) {
    const T = this.truck;
    const w = this.world;
    void dt;
    const body = T.bodyObb();
    for (const c of w.cones) {
      if (c.knocked) continue;
      if (obbVsCircle(body, c.x, c.z, 0.3)) {
        const [fx, fz] = T.fwd;
        w.knockCone(c, T.vx * 1.1 + fx * 2 + (Math.random() - 0.5) * 2, T.vz * 1.1 + fz * 2 + (Math.random() - 0.5) * 2);
        this.stats.cones++;
        this.addPenalty(1, 'cone');
        this.audio.cone();
        const combo = this.t - this.lastCone < 1.5;
        this.lastCone = this.t;
        this.hud.toast(combo ? '🎳 STRIKE! 콘 연속 +1s' : '🚧 라바콘 +1s', 'bad');
        this.radio('cone');
      }
    }
    for (const m of w.movers) {
      if (m.def.kind !== 'worker' || m.down > 0) continue;
      if (obbVsCircle(body, m.x, m.z, 0.5)) {
        m.down = 3.5;
        this.stats.workers++;
        this.addPenalty(10, 'worker');
        this.audio.crash(5);
        this.hud.toast('🦺 작업자 충돌!! +10s', 'bad');
        this.radio('worker', true);
        this.shake = 0.8;
      }
    }
    // overhead obstacles
    const peak = Math.max(T.y + bedPeak(T.bed), T.y + TK.height + 0.05);
    for (const g of w.gate) {
      if (g.broken || !g.col.obb) continue;
      const h = collide(body, g.col as Collider);
      if (h && peak > (g.col.clear ?? 99) - 0.02) {
        g.broken = true;
        this.stats.bars++;
        this.addPenalty(g.col.pen ?? 10, 'bar');
        this.shake = 1;
        this.audio.sparks();
        this.audio.crash(8);
        const [fx, fz] = T.fwd;
        this.particles.burst(g.col.obb.x, (g.col.clear ?? 4) + 0.3, g.col.obb.z, 30, 0xffc94a, 6, 0.1, 0.8);
        this.particles.burst(g.col.obb.x, (g.col.clear ?? 4) + 0.3, g.col.obb.z, 14, 0xff7a1a, 4, 0.14, 1.0);
        T.vx *= 0.3; T.vz *= 0.3;
        void fx; void fz;
        this.hud.toast(`⚡ ${g.col.label} 충돌!! +${g.col.pen ?? 10}s`, 'bad');
        this.radio('bar', true);
      }
    }
  }

  private stepWeigh(dt: number) {
    const w = this.world;
    const T = this.truck;
    const z = w.weighZone;
    if (!z) return;
    const [fx, fz] = T.fwd;
    const cx = T.x + fx * 1.8;
    const cz = T.z + fz * 1.8;
    const dx = cx - z.x;
    const dz = cz - z.z;
    const [zx, zz] = [Math.sin(z.yaw), Math.cos(z.yaw)];
    const inside = Math.abs(dx * zz - dz * zx) <= z.hw && Math.abs(dx * zx + dz * zz) <= z.hd - 2.2;
    if (this.hauling && T.load > 0.5 && !this.weighed) {
      if (inside) {
        this.inWeigh = true;
        if (Math.abs(T.speed) < 0.5) this.weighT += dt;
        if (this.weighT > 1.1) {
          this.weighed = true;
          this.audio.weigh();
          this.hud.toast(`⚖ 계량 완료 — 총중량 ${(T.load * CAP_T + 24).toFixed(1)}t`, 'good');
          this.radio('weigh', true);
        }
      } else if (this.inWeigh) {
        this.inWeigh = false;
        this.weighT = 0;
        if (!this.weighMissed) {
          this.weighMissed = true;
          this.stats.weighMiss++;
          this.addPenalty(4, 'weigh');
          this.hud.toast('⚖ 계량 안 하고 통과! +4s', 'bad');
          this.radio('weighMiss', true);
        }
      }
    } else if (!inside) {
      this.inWeigh = false;
      this.weighT = 0;
    }
  }

  private checkEnd(dt: number) {
    void dt;
    const T = this.truck;
    if (this.stats.delivered >= this.target && T.load < 0.02 && this.rolling <= 0 && !this.dump.active) this.finish();
  }

  private finish() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.audio.fanfare();
    this.hud.center('FINISH!', 'count go');
    const s = this.stats;
    const final = Math.max(this.t * 0.5, this.t + s.penalty - s.bonus);
    const pen = Object.entries(this.pen).filter(([, v]) => v > 0);
    const names: Record<string, string> = { spill: '유실', crash: '충돌', cone: '콘', roll: '전복', bar: '높이제한', worker: '작업자', illegal: '불법투기', weigh: '계량' };
    const penTxt = pen.length ? pen.map(([k, v]) => `${names[k] ?? k} ${v.toFixed(0)}s`).join(' · ') : '없음';
    const bonTxt = [s.zeroSpill ? `무손실 ×${s.zeroSpill}` : '', s.oneShot ? `한방주차 ×${s.oneShot}` : '', s.center ? `정중앙 ×${s.center}` : ''].filter(Boolean).join(' · ') || '없음';
    const clean = s.penalty < 3 && s.lost < 3;
    const result: MiniGameResult = {
      timeMs: Math.round(final * 1000),
      title: s.rollovers ? '전복했지만 배달은 완료!' : clean ? '무결점 배달왕!' : s.lost > 12 ? '길바닥 흙 뿌리기 장인' : '배달 완료! 🚛',
      detail: [
        { label: '납품', value: `${s.delivered.toFixed(1)}t / 목표 ${this.target.toFixed(0)}t` },
        { label: '운반 횟수', value: `${s.trips}회` },
        { label: '흘린 양', value: `${s.lost.toFixed(1)}t` },
        { label: '순수 주행', value: fmtTime(this.t) },
        { label: '페널티', value: `+${s.penalty.toFixed(1)}s (${penTxt})` },
        { label: '보너스', value: `−${s.bonus.toFixed(0)}s (${bonTxt})` },
        { label: '충돌/콘', value: `${s.crashes}회 / ${s.cones}개` },
      ],
    };
    this.endTimer = window.setTimeout(() => this.opts.onEnd(result), 1800);
  }

  // ------------------------------------------------------------------ guidance (HUD text + arrow)
  private guidance() {
    const T = this.truck;
    const w = this.world;
    const L = w.level;
    const loaded = T.load > 0.05;
    const gd = Math.hypot(T.x - L.gantry.x, T.z - L.gantry.z);
    const bayD = Math.hypot(T.x - w.bayC[0], T.z - w.bayC[1]);
    const R = w.route;
    const n = this.near;
    const speed = Math.abs(T.speed);
    const deg = (T.bed * 180) / Math.PI;
    let text = '';
    let tone: 'info' | 'ok' | 'warn' = 'info';
    let target: [number, number] | null = null;
    const ahead = (ds: number): [number, number] => {
      if (n.d > 28) return [n.x, n.z];
      const p = R.at(n.s + ds);
      return [p.x, p.z];
    };
    const [tx, tz] = T.tail();
    const tailIn = this.inBay(tx, tz) && this.bayLocal(tx, tz).lon < w.level.bay.d / 2 - 0.6;
    if (this.state === 'countdown') return { text: '출발 준비! 목표: 25t 짜리 흙을 덤프장 베이에 쏟아라', tone, target: [L.gantry.x, L.gantry.z] as [number, number] };
    if (this.rolling > 0) return { text: '🙃 크레인이 복구 중입니다…', tone: 'warn' as const, target: null };
    if (loaded) {
      if (this.dump.active && T.load > 0.004 && deg > 20) {
        text = `⏫ 배출 중 ${Math.round((1 - T.load) * 100)}% — ${deg < 40 ? '조금 더 올려요' : '그대로 대기'}`;
        tone = 'ok';
      } else if (tailIn) {
        text = T.bed < 0.3 ? (speed > 0.6 ? '🛑 완전히 정차! 그 다음 ⏫ 덤프 올림 (R키)' : '⏫ 덤프 올림 (R키 / 버튼 길게) — 35° 넘으면 쏟아짐') : '⏫ 계속 올려서 쏟아내기';
        tone = 'ok';
      } else if (bayD < 36) {
        const lon = this.bayLocal(T.x, T.z).lon;
        text = T.gear === 'R' ? '⬇ 후진 중 — 노란 중앙선에 맞춰 천천히 (후방카메라 확인)' : lon > 6 || bayD > 20 ? '↩ 베이를 지나쳐 돌아서 → 뒷문을 베이로 향하게 (R 후진)' : '↩ 후진(S/스틱 아래)으로 베이에 진입!';
        target = [w.bayC[0], w.bayC[1]];
      } else {
        const wb = L.weigh !== undefined && !this.weighed ? R.atF(L.weigh) : null;
        if (wb && Math.hypot(T.x - wb.x, T.z - wb.z) < 30 && n.s < L.weigh! * R.length + 6) {
          text = '⚖ 계량대 위에서 잠깐 정차 (1초)';
          tone = 'warn';
          target = [wb.x, wb.z];
        } else {
          text = this.warnHint() || '🚛 덤프장으로 운반 — 부드럽게! (급제동/급커브/과속턱 = 유실)';
          target = ahead(24);
        }
      }
    } else {
      const canLoad = this.world.lamp && gd < 12;
      if (this.dump.active || (this.stats.trips > 0 && deg > 3 && gd > 25)) {
        text = deg > 3 ? '⏬ 침대 내리고 출발 (F키 / ⏬)' : '비웠다! 상차장으로 복귀';
        target = gd < 40 ? [L.gantry.x, L.gantry.z] : ahead(-24);
        if (deg > 3) tone = 'warn';
      } else if (gd < 15) {
        text = T.load > 0.02 ? `⛰ 상차 중 ${Math.round(T.load * 100)}% — 움직이지 마세요` : speed > 0.7 ? '호퍼 아래 초록 박스에 정차' : '호퍼 아래 정확히 서고 침대 완전히 내리기';
        if (T.load > 0.02) tone = 'ok';
        target = [L.gantry.x, L.gantry.z];
      } else {
        text = this.stats.trips === 0 ? '⛰ 상차장 호퍼 아래로 이동 — 정차하면 자동 상차' : '상차장으로 복귀 — 호퍼 아래 정차';
        target = gd < 40 ? [L.gantry.x, L.gantry.z] : ahead(-24);
        void canLoad;
      }
    }
    if (deg > 12 && speed > 2 && !this.dump.active) {
      text = '⚠ 침대를 올린 채 주행 중! 내려요 (F키 / ⏬)';
      tone = 'warn';
    }
    return { text, tone, target };
  }

  private warnHint(): string {
    const T = this.truck;
    const [fx, fz] = T.fwd;
    for (const h of this.world.hints) {
      const dx = h.x - T.x;
      const dz = h.z - T.z;
      const d = Math.hypot(dx, dz);
      if (d < h.r && dx * fx + dz * fz > 0 && !h.text.startsWith('🟢') && !h.text.startsWith('↩')) return h.text;
    }
    return '';
  }

  // ------------------------------------------------------------------ rendering
  private render(dt: number, now: number) {
    const T = this.truck;
    const c = this.opts.container;
    const w = c.clientWidth;
    const h = c.clientHeight;
    T.sync(dt, T.steer);
    this.updateCamera(dt);
    // sun follows the truck (shadow window)
    this.sun.position.set(T.x - 35, T.y + 60, T.z + 25);
    this.sun.target.position.set(T.x, T.y, T.z);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.render(this.scene, this.cam);

    // rear-view inset
    const reversing = T.gear === 'R' && this.state !== 'countdown';
    const showRear = reversing || this.camMode === 1;
    let rw = 0;
    let rh = 0;
    let rx = 0;
    let ry = 0;
    if (showRear) {
      const compact = h < 500 || w < 700;
      rw = Math.round(clamp(w * 0.24, 140, 300));
      rh = Math.round(rw * 0.56);
      rx = Math.round((w - rw) / 2);
      ry = compact ? 52 : 66;
      T.rearCam.aspect = rw / rh;
      T.rearCam.updateProjectionMatrix();
      this.renderer.setScissorTest(true);
      this.renderer.setViewport(rx, h - ry - rh, rw, rh);
      this.renderer.setScissor(rx, h - ry - rh, rw, rh);
      // hide the cab interior from the rear camera
      this.renderer.render(this.scene, T.rearCam);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, w, h);
    }
    this.hud.setRect(rx, ry, rw, rh, reversing ? '후방카메라 · R' : '후방 미러', reversing);

    const g = this.guidance();
    let arrow: number | null = null;
    let dist: number | null = null;
    if (g.target) {
      const [fx, fz] = T.fwd;
      const [lx, lz] = T.left;
      const dx = g.target[0] - T.x;
      const dz = g.target[1] - T.z;
      arrow = (Math.atan2(-(dx * lx + dz * lz), dx * fx + dz * fz) * 180) / Math.PI;
      dist = Math.hypot(dx, dz);
    }
    let warn = '';
    const deg = (T.bed * 180) / Math.PI;
    if (this.risk > 0.65 && this.rolling <= 0) warn = '⚠ 전복 위험! 침대 내리고 감속!';
    else if (deg > 12 && Math.abs(T.speed) > 2 && !this.dump.active) warn = '⚠ 침대 올린 채 주행 금지!';
    if (this.warnText !== warn) {
      this.warnText = warn;
      if (warn) this.audio.warnBeep();
    }
    const d: DtHudData = {
      time: this.t,
      tons: this.stats.delivered,
      target: this.target,
      trips: this.stats.trips,
      loads: this.world.level.loads,
      loadPct: T.load * 100,
      speed: T.speed * 3.6,
      gear: T.gear,
      bedDeg: deg,
      penalty: this.stats.penalty,
      bonus: this.stats.bonus,
      risk: this.risk,
      guide: g.text,
      guideTone: g.tone,
      arrowDeg: arrow,
      dist,
      camLabel: CAM_LABELS[this.camMode],
      warn,
      beeping: reversing,
    };
    this.hud.update(d);
    this.hud.drawMinimap(T, g.target, now);
  }

  private updateCamera(dt: number) {
    const T = this.truck;
    const cam = this.cam;
    const [fx, fz] = T.fwd;
    const sh = this.shake * this.shake * 0.5;
    const jx = (Math.random() - 0.5) * sh;
    const jy = (Math.random() - 0.5) * sh;
    cam.up.set(0, 1, 0);
    let fov = 62;
    if (this.camMode === 0) {
      const rev = T.gear === 'R' && Math.abs(T.speed) > 0.05 ? 1 : T.gear === 'R' ? this.camR : 0;
      this.camR += (rev - this.camR) * (1 - Math.exp(-2.4 * dt));
      const r = this.camR;
      const back = THREE.MathUtils.lerp(-16 - Math.abs(T.speed) * 0.12, 5.5, r);
      const hgt = THREE.MathUtils.lerp(8.6, 10.5, r);
      const lookF = THREE.MathUtils.lerp(10, -9, r);
      const desired = new THREE.Vector3(T.x + fx * back, T.y + hgt, T.z + fz * back);
      const minY = this.world.terrainAt(desired.x, desired.z) + 1.8;
      if (desired.y < minY) desired.y = minY;
      cam.position.lerp(desired, 1 - Math.exp(-5.5 * dt));
      cam.position.x += jx;
      cam.position.y += jy;
      cam.lookAt(T.x + fx * lookF, T.y + 1.3, T.z + fz * lookF);
      fov = 62 + Math.max(0, Math.abs(T.speed) - 9) * 1.4;
    } else if (this.camMode === 1) {
      const a = new THREE.Vector3();
      T.eyeAnchor.getWorldPosition(a);
      const q = new THREE.Quaternion();
      T.group.getWorldQuaternion(q);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      cam.position.set(a.x + jx, a.y + jy, a.z);
      cam.quaternion.copy(q);
      fov = 78;
    } else {
      const desired = new THREE.Vector3(T.x + fx * 6, T.y + 44, T.z + fz * 6);
      cam.position.lerp(desired, 1 - Math.exp(-5 * dt));
      cam.up.set(fx, 0, fz);
      cam.lookAt(cam.position.x, 0, cam.position.z - 0.001 + 0);
      cam.lookAt(T.x + fx * 6, T.y, T.z + fz * 6);
      fov = 50;
    }
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * 0.1;
      cam.updateProjectionMatrix();
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.endTimer);
    this.resizeObs.disconnect();
    this.ctrl.dispose();
    this.touch?.dispose();
    this.hud.dispose();
    this.audio.dispose();
    this.world.dispose();
    this.truck.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }
}
