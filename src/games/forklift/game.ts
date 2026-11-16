import * as THREE from 'three';
import { GameAudio } from './audio';
import { collide, fwdOf, obbVsCircle, obbVsObb, pointInObb, quarterDiff, type Collider } from './collide';
import { FK, Forklift } from './forklift';
import { Hud } from './hud';
import { KEYMAP_P1, KEYMAP_P2, KEYMAP_SOLO, KeyboardControls, TouchControls, isTouchDevice, type ControlSource, type ControlState } from './input';
import { PENALTY, STYLE_PER_SECOND, type LevelDef } from './levels';
import { pickLine, RADIO } from './lines';
import type { NetMsg, OnlineRoom } from './online';
import { Particles } from './particles';
import { PALLET_H, World, type Pallet } from './world';

export type GameMode = 'solo' | 'local2p' | 'online';

export interface PlayerSpec {
  name: string;
  color: number;
}

export interface PlayerStats {
  delivered: number;
  penalty: number;
  style: number;
  cones: number;
  crashes: number;
  drops: number;
  breaks: number;
  airtime: number;
  nearMiss: number;
  perfect: number;
  rams: number;
  maxSpeed: number;
}

export interface PlayerResult {
  name: string;
  color: number;
  stats: PlayerStats;
  time: number;
  final: number;
  isLocal: boolean;
}

export interface GameResult {
  mode: GameMode;
  level: LevelDef;
  seed: number;
  players: PlayerResult[];
  winner: number; // -1 = tie / solo
}

export interface GameOptions {
  mode: GameMode;
  level: LevelDef;
  seed: number;
  players: PlayerSpec[];
  room?: OnlineRoom;
  localIndex?: number; // online: which slot is me
  onEnd: (r: GameResult) => void;
}

interface Player {
  idx: number;
  spec: PlayerSpec;
  colorCss: string;
  f: Forklift;
  ctrl: ControlSource | null;
  remote: boolean;
  cam: THREE.PerspectiveCamera | null;
  camMode: number;
  hud: Hud | null;
  stats: PlayerStats;
  engaged: number;
  pickT: number;
  tipTimer: number;
  climbVy: number;
  shake: number;
  driftT: number;
  lastRadio: number;
  lastCone: number;
  lastHit: number;
  lift: number;
  ctl: ControlState;
  net?: { x: number; z: number; y: number; yaw: number; vx: number; vz: number; forkH: number; steer: number; carry: number; carryYaw: number; recv: number };
}

const STEP = 1 / 60;
const CAM_LABELS = ['3인칭', '1인칭', '탑뷰'];
const zeroCtl = (): ControlState => ({ throttle: 0, steer: 0, lift: 0, handbrake: false, turbo: false, horn: false, camPressed: false });
const newStats = (): PlayerStats => ({ delivered: 0, penalty: 0, style: 0, cones: 0, crashes: 0, drops: 0, breaks: 0, airtime: 0, nearMiss: 0, perfect: 0, rams: 0, maxSpeed: 0 });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const cssColor = (c: number) => '#' + c.toString(16).padStart(6, '0');

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly world: World;
  readonly audio = new GameAudio();
  private particles: Particles;
  private players: Player[] = [];
  private overlay: HTMLDivElement;
  private state: 'countdown' | 'run' | 'done' = 'countdown';
  private countdown = 3.5;
  private lastCount = 4;
  t = 0;
  private acc = 0;
  private lastFrame = 0;
  private raf = 0;
  private paused = false;
  private netTimer = 0;
  private disposed = false;
  private quality: 'high' | 'low';
  private touch: TouchControls | null = null;
  private resizeObs: ResizeObserver;
  private lastAnnounceLast = false;

  constructor(private container: HTMLElement, private opts: GameOptions) {
    const mobile = isTouchDevice() || window.innerWidth < 800;
    this.quality = mobile ? 'low' : 'high';
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

    this.world = new World(opts.level, opts.seed, this.quality);
    this.scene.add(this.world.group);
    this.setupLights();
    this.particles = new Particles(this.scene);

    this.setupPlayers();

    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();

    if (opts.room) opts.room.onMsg = (m) => this.onNet(m);

    const localCount = this.players.filter((p) => !p.remote).length;
    this.audio.init(localCount);
    this.audio.resume();
    for (const p of this.players) p.hud?.toast(pickLine('start'), 'radio');
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private setupLights() {
    const night = this.opts.level.night;
    this.scene.background = new THREE.Color(night ? 0x05070c : 0x9ec9ff);
    this.scene.fog = night ? new THREE.Fog(0x05070c, 12, 60) : new THREE.Fog(0x9ec9ff, 70, 160);
    const hemi = new THREE.HemisphereLight(night ? 0x5566aa : 0xdfefff, night ? 0x141420 : 0x5b5040, night ? 0.55 : 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(night ? 0x8899ff : 0xfff1d6, night ? 0.25 : 2.0);
    sun.position.set(-30, 50, 20);
    sun.castShadow = this.quality === 'high';
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 35; sc.bottom = -35; sc.near = 1; sc.far = 140;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    if (night) {
      // a few sodium lamps over the doors
      for (const x of [-16, 16]) for (const z of [-7, 7]) {
        const l = new THREE.PointLight(0xffa64d, 25, 18, 1.6);
        l.position.set(x + (x < 0 ? 1.5 : -1.5), 5, z);
        this.scene.add(l);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
        bulb.position.copy(l.position);
        this.scene.add(bulb);
      }
      for (const [x, z] of [[32, -12], [32, 12], [-30, -12], [-30, 12]]) {
        const l = new THREE.PointLight(0x99bbff, 30, 22, 1.4);
        l.position.set(x, 6, z);
        this.scene.add(l);
      }
    }
  }

  private setupPlayers() {
    const { mode, players } = this.opts;
    const touch = isTouchDevice();
    players.forEach((spec, idx) => {
      const remote = mode === 'online' && idx !== (this.opts.localIndex ?? 0);
      const f = new Forklift(spec.color, spec.name);
      const sp = this.world.spawns[idx] ?? this.world.spawns[0];
      f.x = sp.x;
      f.z = sp.z;
      f.yaw = sp.yaw;
      if (this.opts.level.night) f.addHeadlight();
      f.setGuardLayer(2 + idx);
      this.scene.add(f.mesh);
      let ctrl: ControlSource | null = null;
      let cam: THREE.PerspectiveCamera | null = null;
      let hud: Hud | null = null;
      if (!remote) {
        if (mode === 'local2p') ctrl = new KeyboardControls(idx === 0 ? KEYMAP_P1 : KEYMAP_P2, idx);
        else if (touch) ctrl = this.touch = new TouchControls(this.overlay);
        else ctrl = new KeyboardControls(KEYMAP_SOLO, 0);
        cam = new THREE.PerspectiveCamera(65, 1, 0.1, 400);
        cam.layers.enable(2);
        cam.layers.enable(3);
        cam.position.set(f.x - 8, 5, f.z);
        hud = new Hud(this.overlay, spec.name, cssColor(spec.color), mode === 'local2p');
      }
      this.players.push({
        idx, spec, colorCss: cssColor(spec.color), f, ctrl, remote, cam, camMode: 0, hud, stats: newStats(),
        engaged: -1, pickT: 0, tipTimer: 0, climbVy: 0, shake: 0, driftT: 0, lastRadio: -10, lastCone: -10, lastHit: -10, lift: 0, ctl: zeroCtl(),
      });
    });
  }

  private get viewers() {
    return this.players.filter((p) => !p.remote);
  }

  private layout() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    const vs = this.viewers;
    const sideBySide = w >= h;
    vs.forEach((p, i) => {
      let rect: [number, number, number, number];
      if (vs.length === 1) rect = [0, 0, w, h];
      else if (sideBySide) rect = [i * (w / 2), 0, w / 2, h];
      else rect = [0, i * (h / 2), w, h / 2];
      (p as Player & { rect?: number[] }).rect = rect;
      p.cam!.aspect = rect[2] / rect[3];
      p.cam!.updateProjectionMatrix();
      p.hud!.setRect(rect[0], rect[1], rect[2], rect[3]);
    });
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused || this.opts.mode === 'online') {
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
    if (!p) this.lastFrame = performance.now();
  }

  // ---------------------------------------------------------------- simulation
  private step(dt: number) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount && n <= 3) {
        this.lastCount = n;
        if (n > 0) {
          this.audio.countdown(false);
          for (const p of this.viewers) p.hud!.center(String(n), 'count');
        }
      }
      if (this.countdown <= 0) {
        this.state = 'run';
        this.audio.countdown(true);
        for (const p of this.viewers) {
          p.hud!.center('GO!', 'count go');
          setTimeout(() => p.hud?.center(''), 800);
        }
      }
    } else if (this.state === 'run') {
      this.t += dt;
    }

    this.world.update(this.t, dt);
    const dyn = this.world.dynamicColliders();

    for (const p of this.players) {
      if (p.remote) this.stepRemote(p, dt);
      else this.stepLocal(p, dt, dyn);
    }
    this.forkliftContacts();
    this.world.updateCones(dt);
    this.particles.update(dt);
    this.syncPallets();

    if (this.opts.room && this.state !== 'done') {
      this.netTimer -= dt;
      if (this.netTimer <= 0) {
        this.netTimer = 1 / 15;
        const me = this.viewers[0];
        const f = me.f;
        this.opts.room.send({
          type: 'st', x: f.x, z: f.z, y: f.y, yaw: f.yaw, vx: f.vx, vz: f.vz, forkH: f.forkH, steer: f.steer,
          carry: f.carrying, carryYaw: f.carryYaw, delivered: me.stats.delivered, t: this.t,
        });
      }
    }
    if (this.state === 'run') this.checkEnd();
  }

  private radio(p: Player, key: keyof typeof RADIO, force = false) {
    if (!p.hud) return;
    if (!force && this.t - p.lastRadio < 2.5) return;
    p.lastRadio = this.t;
    p.hud.toast(pickLine(key), 'radio');
  }

  private stepLocal(p: Player, dt: number, dyn: Collider[]) {
    const f = p.f;
    const raw = p.ctrl!.read();
    if (raw.camPressed) p.camMode = (p.camMode + 1) % 3;
    const ctl = this.state === 'run' ? raw : { ...zeroCtl(), lift: raw.lift, horn: raw.horn };
    p.ctl = ctl;
    const w = this.world;

    // ---- steering (rear-wheel steer: the tail swings around the front axle)
    const spd = f.speed;
    const maxSteer = THREE.MathUtils.lerp(0.62, 0.3, clamp(Math.abs(spd) / 12, 0, 1));
    const target = -ctl.steer * maxSteer;
    const sr = 3.2 * dt;
    f.steer += clamp(target - f.steer, -sr, sr);

    const [fx, fz] = f.fwd;
    const [rx, rz] = f.right;
    let vf = f.vx * fx + f.vz * fz;
    let vl = f.vx * rx + f.vz * rz;
    const onOil = w.gripAt(f.x, f.z) < 1;

    if (!f.airborne) {
      const boosting = ctl.turbo && f.turbo > 0.02 && ctl.throttle > 0;
      if (boosting) f.turbo = Math.max(0, f.turbo - dt * 0.33);
      else f.turbo = Math.min(1, f.turbo + dt * 0.035);
      const load = f.carrying >= 0 ? 0.92 : 1;
      const maxF = (boosting ? 15 : 9.5) * load;
      const accel = boosting ? 13 : 6.5;
      const th = ctl.throttle;
      if (th > 0) {
        if (vf < -0.3) vf += 16 * dt * th;
        else if (vf < maxF) vf = Math.min(maxF, vf + accel * th * dt);
      } else if (th < 0) {
        if (vf > 0.3) vf += 16 * dt * th;
        else if (vf > -5) vf = Math.max(-5, vf + 5 * th * dt);
      } else {
        const dec = (onOil ? 0.6 : 3) * dt;
        vf = Math.abs(vf) < dec ? 0 : vf - Math.sign(vf) * dec;
      }
      if (vf > maxF) vf = Math.max(maxF, vf - 6 * dt);
      if (ctl.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 3.5 * dt);
      const grip = onOil ? 0.7 : ctl.handbrake ? 1.6 : 11;
      vl *= Math.exp(-grip * dt);
      let yr = (vf * Math.tan(f.steer)) / FK.wheelbase;
      if (ctl.handbrake) yr *= 1.45;
      if (onOil) yr *= 1.15;
      f.vx = fx * vf + rx * vl;
      f.vz = fz * vf + rz * vl;
      // integrate around the front axle
      const P = FK.pivot;
      const Fx = f.x + fx * P + f.vx * dt;
      const Fz = f.z + fz * P + f.vz * dt;
      f.yaw += yr * dt;
      const [nfx, nfz] = fwdOf(f.yaw);
      f.x = Fx - nfx * P;
      f.z = Fz - nfz * P;

      // ---- tipping
      const aLat = vf * yr;
      const loadH = f.carrying >= 0 ? f.forkH + 0.6 : f.forkH * 0.3;
      const limit = f.carrying >= 0 ? 11 - loadH * 2.3 : 18 - loadH * 3;
      f.tipRisk = Math.abs(aLat) / limit;
      f.roll = clamp(-aLat * 0.012, -0.14, 0.14) * (1 + Math.max(0, f.tipRisk - 0.7) * 2);
      if (f.tipRisk > 1) p.tipTimer += dt;
      else p.tipTimer = Math.max(0, p.tipTimer - dt * 2);
      if (f.tipRisk > 0.85) this.radio(p, 'tip');
      if (p.tipTimer > 0.3) {
        p.tipTimer = 0;
        if (f.carrying >= 0) this.dropCargo(p, 'tip');
        f.roll = Math.sign(-aLat) * 0.35;
        p.shake = 0.5;
        vf *= 0.5;
        f.vx = fx * vf + rx * vl;
        f.vz = fz * vf + rz * vl;
      }

      // ---- drift style
      if (Math.abs(vl) > 2.2 && Math.abs(vf) > 3.5) {
        p.driftT += dt;
        p.stats.style += 70 * dt;
        if (Math.random() < 0.5) {
          const [bx, bz] = [f.x - fx * 1.2, f.z - fz * 1.2];
          this.particles.spawn(bx + (Math.random() - 0.5), 0.2, bz + (Math.random() - 0.5), 0, 0.8, 0, 0xcccccc, 0.8, 0.3, -0.5, 1.5);
        }
      } else {
        if (p.driftT > 1.0) {
          p.hud?.toast(`🌀 드리프트 ${p.driftT.toFixed(1)}s  +${Math.round(p.driftT * 70)}`, 'good');
          this.radio(p, 'drift');
        }
        p.driftT = 0;
      }
    } else {
      f.x += f.vx * dt;
      f.z += f.vz * dt;
      f.airTime += dt;
      f.tipRisk = 0;
    }
    p.stats.maxSpeed = Math.max(p.stats.maxSpeed, Math.abs(vf));

    // ---- vertical (ramps & jumps)
    const gh = w.groundHeight(f.x, f.z);
    if (f.airborne) {
      f.vy -= 22 * dt;
      f.y += f.vy * dt;
      f.pitch = clamp(-f.vy * 0.04, -0.35, 0.35);
      if (f.y <= gh) {
        const impact = -f.vy;
        f.y = gh;
        f.vy = 0;
        f.airborne = false;
        if (f.airTime > 0.3) {
          const pts = Math.round(f.airTime * 300);
          p.stats.style += pts;
          p.stats.airtime += f.airTime;
          p.hud?.toast(`🚀 에어타임 ${f.airTime.toFixed(2)}s  +${pts}`, 'good');
          this.radio(p, 'air', true);
        }
        p.shake = Math.min(1, impact * 0.08);
        this.audio.clank();
        this.particles.burst(f.x, 0.1, f.z, 10, 0x999999, 3, 0.2);
        if (f.carrying >= 0) {
          const pal = w.pallets[f.carrying];
          if ((pal.fragile && impact > 6.5) || impact > 11 || f.forkH > 1.6) this.dropCargo(p, 'landing');
        }
        f.airTime = 0;
      }
    } else {
      const climb = (gh - f.y) / dt;
      if (gh < f.y - 0.02 && p.climbVy > 1.0) {
        f.airborne = true;
        f.vy = p.climbVy * 1.05;
        f.airTime = 0;
        this.audio.whoosh();
      } else {
        f.y = gh;
        p.climbVy = climb;
      }
      const hf = w.groundHeight(f.x + fx * 0.9, f.z + fz * 0.9);
      const hr = w.groundHeight(f.x - fx * 0.9, f.z - fz * 0.9);
      f.pitch = -Math.atan2(hf - hr, 1.8);
    }

    // ---- forks
    const liftRate = 1.15;
    p.lift = ctl.lift;
    let fork = clamp(f.forkH + ctl.lift * liftRate * dt, 0, FK.maxFork);
    let restTop = 0;
    let resting = false;
    if (f.carrying >= 0) {
      const po = f.palletObb();
      const oldBottom = f.y + f.forkH;
      let floor = w.groundHeight(po.x, po.z);
      for (const c of [...w.statics, ...dyn]) {
        if (c.ref === w.pallets[f.carrying]) continue;
        if (c.yMax <= floor || c.yMax > oldBottom + 0.06) continue;
        if (c.kind === 'agv' || c.kind === 'barrel' || c.kind === 'crane' || c.kind === 'door') continue;
        if (collide(po, c)) floor = Math.max(floor, c.yMax);
      }
      if (f.y + fork <= floor + 0.015) {
        fork = floor - f.y;
        resting = true;
        restTop = floor;
      }
    }
    f.forkH = fork;

    // ---- collisions
    this.resolveCollisions(p, dyn);

    // ---- pallets: pick / place
    if (f.carrying < 0) this.tryPickup(p);
    else if (resting && ctl.lift <= 0 && this.state === 'run') this.placePallet(p, restTop);

    // ---- cones
    const body = f.bodyObb();
    const pal = f.carrying >= 0 ? f.palletObb() : null;
    const palBottom = f.y + f.forkH;
    w.cones.forEach((c, i) => {
      if (c.knocked) return;
      const hit = (f.y < 0.7 && obbVsCircle(body, c.x, c.z, 0.3)) || (pal && palBottom < 0.7 && obbVsCircle(pal, c.x, c.z, 0.3));
      if (!hit) return;
      this.knockCone(i, f.vx * 1.3 + (Math.random() - 0.5) * 2, f.vz * 1.3 + (Math.random() - 0.5) * 2);
      this.opts.room?.send({ type: 'cone', i, vx: c.vx, vz: c.vz });
      p.stats.cones++;
      p.stats.penalty += PENALTY.cone;
      const combo = this.t - p.lastCone < 1.2;
      p.lastCone = this.t;
      p.hud?.toast(combo ? '🎳 STRIKE! 콘 연속 박살 +2s' : '🚧 라바콘 +2s', 'bad');
      this.radio(p, 'cone');
    });

    // ---- AGV near-miss
    for (const a of w.agvs) {
      const d = Math.hypot(a.x - f.x, a.z - f.z);
      if (d < 2.3 && Math.abs(vf) > 4.5 && a.nearCd[p.idx] <= 0 && this.t - p.lastHit > 1) {
        a.nearCd[p.idx] = 3;
        p.stats.nearMiss++;
        p.stats.style += 60;
        p.hud?.toast('😱 니어미스 +60', 'good');
        this.radio(p, 'nearMiss');
      }
    }

    // ---- audio
    const ai = this.viewers.indexOf(p);
    this.audio.update(ai, dt, vf, ctl.throttle, vf < -0.3, ctl.horn, ctl.lift, this.viewers.length > 1 ? 0.7 : 1);
  }

  private resolveCollisions(p: Player, dyn: Collider[]) {
    const f = p.f;
    const others: Collider[] = [];
    for (const o of this.players) {
      if (o === p) continue;
      // in local split-screen the bodies are resolved symmetrically in forkliftContacts()
      if (this.opts.mode === 'online') others.push({ obb: o.f.bodyObb(), yMin: o.f.y, yMax: o.f.y + FK.height, vx: o.f.vx, vz: o.f.vz, kind: 'forklift', ref: o });
      if (o.f.carrying >= 0) {
        const b = o.f.y + o.f.forkH;
        others.push({ obb: o.f.palletObb(), yMin: b, yMax: b + PALLET_H, vx: o.f.vx, vz: o.f.vz, kind: 'otherpallet', ref: o });
      }
    }
    const all = [...this.world.statics, ...dyn, ...others];
    let impact = 0;
    let hitKind = '';
    let ramHit: { o: Player; rv: number; nx: number; nz: number } | null = null;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const c of all) {
        const shapes: { obb: ReturnType<Forklift['bodyObb']>; y0: number; y1: number }[] = [
          { obb: f.bodyObb(), y0: f.y + 0.05, y1: f.y + FK.height },
        ];
        if (f.carrying >= 0) {
          const b = f.y + f.forkH;
          shapes.push({ obb: f.palletObb(), y0: b + 0.02, y1: b + PALLET_H });
        }
        for (const s of shapes) {
          if (c.yMin >= s.y1 || c.yMax <= s.y0) continue;
          if (c.ref && c.ref === this.world.pallets[f.carrying]) continue;
          const h = collide(s.obb, c);
          if (!h) continue;
          any = true;
          f.x += h.nx * h.depth;
          f.z += h.nz * h.depth;
          const rv = (f.vx - (c.vx ?? 0)) * h.nx + (f.vz - (c.vz ?? 0)) * h.nz;
          if (rv < 0) {
            const e = c.kind === 'truckbed' || c.kind === 'pallet' || c.kind === 'wall' || c.kind === 'rack' ? 1.05 : 1.35;
            f.vx -= e * rv * h.nx;
            f.vz -= e * rv * h.nz;
            if (c.kind === 'forklift' && (!ramHit || -rv > ramHit.rv)) ramHit = { o: c.ref as Player, rv: -rv, nx: h.nx, nz: h.nz };
            else if (-rv > impact) {
              impact = -rv;
              hitKind = c.kind;
            }
          }
        }
      }
      if (!any) break;
    }
    if (ramHit) this.ram(p, ramHit.o, ramHit.rv, ramHit.nx, ramHit.nz);
    // docking against a truck bed or nudging a pallet is part of the job: be forgiving
    if (hitKind === 'truckbed' || hitKind === 'pallet') impact -= 1.5;
    if (impact > 3) this.onImpact(p, impact, hitKind);
  }

  private onImpact(p: Player, impact: number, kind: string) {
    const f = p.f;
    if (this.t - p.lastHit < 0.4) return;
    p.lastHit = this.t;
    p.shake = Math.min(1.2, impact * 0.12);
    this.audio.crash(impact);
    const [fx, fz] = f.fwd;
    this.particles.burst(f.x + fx * 1.6, 1, f.z + fz * 1.6, 8, 0xffcc33, impact * 0.6, 0.08, 0.4);
    if (impact > 4.5 && this.state === 'run') {
      p.stats.crashes++;
      p.stats.penalty += PENALTY.crash;
      p.hud?.toast(kind === 'agv' ? '🤖 AGV 충돌 +1s' : kind === 'barrel' ? '🛢 드럼통 직격 +1s' : kind === 'crane' ? '🏗 크레인 강타 +1s' : '💥 충돌 +1s', 'bad');
      this.radio(p, 'crash');
    }
    if (f.carrying >= 0) {
      const pal = this.world.pallets[f.carrying];
      const thr = (pal.fragile ? 3.2 : 6) * (1 - Math.min(0.5, f.forkH * 0.15));
      if (impact > thr) this.dropCargo(p, 'crash');
    }
  }

  private tryPickup(p: Player) {
    const f = p.f;
    const [tx, tz] = f.forkTip();
    const forkY = f.y + f.forkH;
    let best: Pallet | null = null;
    for (const pal of this.world.pallets) {
      if (pal.carriedBy !== -1 || pal.delivered) continue;
      if (Math.hypot(tx - pal.x, tz - pal.z) > 0.5) continue;
      if (quarterDiff(f.yaw - pal.yaw) > 0.32) continue;
      if (forkY > pal.y + 0.14 || forkY < pal.y - 0.25) continue;
      best = pal;
      break;
    }
    if (!best) {
      if (p.engaged >= 0) {
        const e = this.world.pallets[p.engaged];
        if (forkY > e.y + 0.14 && Math.hypot(tx - e.x, tz - e.z) < 0.5 && e.carriedBy === -1) {
          this.attach(p, e);
          return;
        }
      }
      p.engaged = -1;
      return;
    }
    p.engaged = best.id;
  }

  private attach(p: Player, pal: Pallet) {
    const f = p.f;
    p.engaged = -1;
    f.carrying = pal.id;
    let rel = pal.yaw - f.yaw;
    const q = Math.PI / 2;
    rel = Math.round(rel / q) * q + ((rel - Math.round(rel / q) * q) * 0.5);
    f.carryYaw = rel;
    pal.carriedBy = p.idx;
    p.pickT = this.t;
    this.audio.pickup();
    p.hud?.toast(pal.fragile ? '🥃 위스키 확보 (깨짐주의!)' : `📦 팔레트 ${pal.id + 1} 확보`, 'info');
    this.radio(p, pal.fragile ? 'fragile' : 'pickup', pal.fragile);
    this.opts.room?.send({ type: 'pick', pid: pal.id, t: this.t });
  }

  private placePallet(p: Player, restTop: number) {
    const f = p.f;
    const pal = this.world.pallets[f.carrying];
    const pose = f.carriedPose();
    pal.x = pose.x;
    pal.z = pose.z;
    pal.y = restTop;
    pal.yaw = pose.yaw;
    pal.carriedBy = -1;
    f.carrying = -1;
    p.engaged = pal.id;
    let zoneId = -1;
    for (const z of this.world.zones) {
      if (z.filled) continue;
      if (Math.abs(restTop - z.h) > 0.12) continue;
      if (Math.abs(pal.x - z.x) > z.hw - 0.3 || Math.abs(pal.z - z.z) > z.hd - 0.3) continue;
      zoneId = z.id;
      break;
    }
    if (zoneId >= 0) this.deliver(p, pal, zoneId, true);
    else this.audio.clank();
    this.opts.room?.send({ type: 'place', pid: pal.id, x: pal.x, z: pal.z, y: pal.y, yaw: pal.yaw, zone: zoneId });
  }

  private deliver(p: Player, pal: Pallet, zoneId: number, local: boolean) {
    const z = this.world.zones[zoneId];
    z.filled = true;
    pal.delivered = true;
    (pal as Pallet & { by?: number }).by = p.idx;
    p.engaged = -1;
    p.stats.delivered++;
    (z.mesh.material as THREE.MeshBasicMaterial).opacity = 0.25;
    const label = pal.mesh.getObjectByName('label');
    if (label) label.visible = false;
    this.particles.burst(pal.x, 1.5, pal.z, 24, z.truck ? 0xff4fd8 : 0x2ee66b, 4, 0.12, 1.2);
    if (!local) return;
    const err = Math.hypot(pal.x - z.x, pal.z - z.z);
    const aligned = quarterDiff(pal.yaw) < 0.08;
    const perfect = err < 0.22 && aligned;
    let pts = 100 + (z.truck ? 150 : 0);
    if (perfect) {
      pts += 200;
      p.stats.perfect++;
    }
    p.stats.style += pts;
    this.audio.deliver(perfect);
    p.hud?.toast(`${perfect ? '🎯 칼각 입고!' : '✅ 입고 완료'} ${z.truck ? '(트럭 상차) ' : ''}+${pts}`, 'good');
    this.radio(p, perfect ? 'perfect' : z.truck ? 'truck' : 'deliver', true);
    const remaining = this.world.pallets.filter((x) => !x.delivered).length;
    if (remaining === 1 && !this.lastAnnounceLast) {
      this.lastAnnounceLast = true;
      for (const v of this.viewers) setTimeout(() => this.radio(v, 'last', true), 1500);
    }
  }

  private dropCargo(p: Player, why: 'crash' | 'tip' | 'landing' | 'rammed') {
    const f = p.f;
    if (f.carrying < 0) return;
    const pal = this.world.pallets[f.carrying];
    const pose = f.carriedPose();
    f.carrying = -1;
    pal.carriedBy = -1;
    p.engaged = -1;
    p.stats.drops++;
    this.particles.burst(pose.x, pose.y + 0.6, pose.z, 18, pal.fragile ? 0xc28a3a : 0xb8874f, 4, 0.18, 1.2);
    if (pal.fragile) {
      p.stats.breaks++;
      p.stats.penalty += PENALTY.breakFragile;
      this.audio.glass();
      this.particles.burst(pose.x, pose.y + 0.6, pose.z, 20, 0xd9a441, 6, 0.08, 1.0);
      p.hud?.toast('💔 위스키 박살! +15s (원위치 재입고)', 'bad');
      this.radio(p, 'break', true);
      Object.assign(pal, { x: pal.home.x, z: pal.home.z, y: 0, yaw: pal.home.yaw });
      this.opts.room?.send({ type: 'reset', pid: pal.id });
    } else {
      p.stats.penalty += PENALTY.drop;
      this.audio.crash(4);
      p.hud?.toast(why === 'tip' ? '🙃 전복 위기! 화물 낙하 +5s' : why === 'rammed' ? '😡 들이받혀서 화물 낙하 +5s' : '📦 화물 낙하 +5s', 'bad');
      this.radio(p, why === 'rammed' ? 'rammed' : 'drop', true);
      const [fx, fz] = f.fwd;
      pal.x = pose.x + fx * 0.6 + (Math.random() - 0.5) * 0.6;
      pal.z = pose.z + fz * 0.6 + (Math.random() - 0.5) * 0.6;
      pal.y = 0;
      pal.yaw = pose.yaw + (Math.random() - 0.5) * 0.5;
      this.opts.room?.send({ type: 'place', pid: pal.id, x: pal.x, z: pal.z, y: 0, yaw: pal.yaw, zone: -1 });
    }
  }

  private knockCone(i: number, vx: number, vz: number) {
    const c = this.world.cones[i];
    if (c.knocked) return;
    c.knocked = true;
    c.vx = vx;
    c.vz = vz;
    c.vy = 4 + Math.hypot(vx, vz) * 0.3;
    c.y = 0.01;
    this.audio.cone();
  }

  /** forklift vs forklift (local split-screen): ramming! */
  private forkliftContacts() {
    if (this.opts.mode === 'solo' || this.players.length < 2) return;
    const [A, B] = this.players;
    if (this.opts.mode === 'online') return; // each client resolves its own forklift in resolveCollisions()
    const h = obbVsObb(A.f.bodyObb(), B.f.bodyObb());
    if (!h) return;
    A.f.x += h.nx * h.depth * 0.5;
    A.f.z += h.nz * h.depth * 0.5;
    B.f.x -= h.nx * h.depth * 0.5;
    B.f.z -= h.nz * h.depth * 0.5;
    const rv = (A.f.vx - B.f.vx) * h.nx + (A.f.vz - B.f.vz) * h.nz;
    if (rv < 0) {
      const j = -rv * 0.6;
      A.f.vx += h.nx * j;
      A.f.vz += h.nz * j;
      B.f.vx -= h.nx * j;
      B.f.vz -= h.nz * j;
      this.ram(A, B, -rv, h.nx, h.nz);
    }
  }

  private lastRam = -10;

  private ram(A: Player, B: Player, impact: number, nx: number, nz: number) {
    if (impact < 3.5 || this.t - this.lastRam < 0.8 || this.state !== 'run') return;
    this.lastRam = this.t;
    // n points from B to A. A attacks if it moves toward B (-n), B attacks if it moves along n.
    const aToward = -(A.f.vx * nx + A.f.vz * nz);
    const bToward = B.f.vx * nx + B.f.vz * nz;
    const attacker = aToward >= bToward ? A : B;
    const victim = attacker === A ? B : A;
    for (const p of [A, B]) {
      if (p.remote) continue;
      p.shake = 1;
    }
    this.audio.crash(impact);
    if (!attacker.remote) {
      attacker.stats.rams++;
      attacker.stats.style += 150;
      attacker.hud?.toast('🐂 들이받기! +150', 'good');
      if (victim.f.carrying >= 0) this.radio(attacker, 'ram', true);
    }
    if (!victim.remote && impact > 4.5 && victim.f.carrying >= 0) this.dropCargo(victim, 'rammed');
  }

  private stepRemote(p: Player, dt: number) {
    const n = p.net;
    if (!n) return;
    const f = p.f;
    const age = Math.min(0.35, (performance.now() - n.recv) / 1000);
    const tx = n.x + n.vx * age;
    const tz = n.z + n.vz * age;
    const k = 1 - Math.exp(-12 * dt);
    f.x += (tx - f.x) * k;
    f.z += (tz - f.z) * k;
    f.y += (n.y - f.y) * k;
    let dy = n.yaw - f.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    f.yaw += dy * k;
    f.forkH += (n.forkH - f.forkH) * k;
    f.steer = n.steer;
    f.vx = n.vx;
    f.vz = n.vz;
    f.carryYaw = n.carryYaw;
    if (n.carry !== f.carrying) {
      if (f.carrying >= 0 && this.world.pallets[f.carrying].carriedBy === p.idx) this.world.pallets[f.carrying].carriedBy = -1;
      f.carrying = n.carry;
      if (n.carry >= 0) {
        const pal = this.world.pallets[n.carry];
        if (!pal.delivered) pal.carriedBy = p.idx;
      }
    }
  }

  private onNet(m: NetMsg) {
    const remote = this.players.find((p) => p.remote);
    const me = this.viewers[0];
    if (!remote) return;
    switch (m.type) {
      case 'st': {
        remote.net = { ...m, recv: performance.now() };
        remote.stats.delivered = m.delivered;
        break;
      }
      case 'pick': {
        const pal = this.world.pallets[m.pid];
        if (me.f.carrying === m.pid) {
          const iLose = m.t < me.pickT || (m.t === me.pickT && remote.idx === 0);
          if (!iLose) return;
          me.f.carrying = -1;
          me.hud?.toast('😤 한 발 늦었다! 상대가 먼저 잡음', 'bad');
        }
        if (me.engaged === m.pid) me.engaged = -1;
        pal.carriedBy = remote.idx;
        remote.f.carrying = m.pid;
        break;
      }
      case 'place': {
        const pal = this.world.pallets[m.pid];
        if (me.f.carrying === m.pid) return;
        Object.assign(pal, { x: m.x, z: m.z, y: m.y, yaw: m.yaw, carriedBy: -1 });
        if (remote.f.carrying === m.pid) remote.f.carrying = -1;
        if (m.zone >= 0 && !pal.delivered) {
          const z = this.world.zones[m.zone];
          if (z.filled) {
            // conflict: someone already filled this zone locally; still count the delivery
          }
          this.deliver(remote, pal, m.zone, false);
        }
        break;
      }
      case 'reset': {
        const pal = this.world.pallets[m.pid];
        Object.assign(pal, { x: pal.home.x, z: pal.home.z, y: 0, yaw: pal.home.yaw, carriedBy: -1 });
        if (remote.f.carrying === m.pid) remote.f.carrying = -1;
        break;
      }
      case 'cone':
        this.knockCone(m.i, m.vx, m.vz);
        break;
      default:
        break;
    }
  }

  opponentLeft() {
    if (this.state === 'done') return;
    for (const v of this.viewers) v.hud?.toast('📴 상대가 나갔습니다. 부전승!', 'info');
    setTimeout(() => this.finish(), 1500);
  }

  private syncPallets() {
    for (const pal of this.world.pallets) {
      if (pal.carriedBy !== -1) {
        const owner = this.players.find((p) => p.idx === pal.carriedBy);
        if (owner && owner.f.carrying === pal.id) {
          const pose = owner.f.carriedPose();
          pal.x = pose.x;
          pal.z = pose.z;
          pal.y = pose.y;
          pal.yaw = pose.yaw;
        }
      }
      pal.mesh.position.set(pal.x, pal.y - 0.02, pal.z);
      pal.mesh.rotation.y = pal.yaw;
    }
  }

  private checkEnd() {
    const total = this.world.pallets.length;
    const delivered = this.world.pallets.filter((p) => p.delivered).length;
    if (this.opts.mode === 'solo') {
      if (delivered >= total) this.finish();
      return;
    }
    const majority = Math.floor(total / 2) + 1;
    if (delivered >= total || this.players.some((p) => p.stats.delivered >= majority)) this.finish();
  }

  private finish() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.audio.fanfare();
    const results: PlayerResult[] = this.players.map((p) => {
      const bonus = p.stats.style / STYLE_PER_SECOND;
      const final = Math.max(this.t * 0.5, this.t + p.stats.penalty - bonus);
      return { name: p.spec.name, color: p.spec.color, stats: { ...p.stats }, time: this.t, final, isLocal: !p.remote };
    });
    let winner = -1;
    if (results.length === 2) {
      const [a, b] = results;
      if (a.stats.delivered !== b.stats.delivered) winner = a.stats.delivered > b.stats.delivered ? 0 : 1;
      else if (Math.round(a.stats.style) !== Math.round(b.stats.style)) winner = a.stats.style > b.stats.style ? 0 : 1;
    }
    for (const v of this.viewers) {
      if (this.opts.mode === 'solo') v.hud?.center('FINISH!', 'count go');
      else v.hud?.center(winner === -1 ? 'DRAW' : winner === v.idx ? 'WIN!' : 'LOSE', 'count ' + (winner === v.idx ? 'go' : ''));
    }
    setTimeout(() => this.opts.onEnd({ mode: this.opts.mode, level: this.opts.level, seed: this.opts.seed, players: results, winner }), 1800);
  }

  // ---------------------------------------------------------------- rendering
  private render(dt: number, now: number) {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const p of this.players) p.f.syncMesh(dt, now / 1000);
    const flist = this.players.map((p) => ({ f: p.f, color: p.colorCss }));
    this.renderer.setScissorTest(true);
    for (const p of this.viewers) {
      const cam = p.cam!;
      this.updateCamera(p, dt);
      const rect = (p as Player & { rect?: number[] }).rect ?? [0, 0, w, h];
      const [x, y, rw, rh] = rect;
      this.renderer.setViewport(x, h - y - rh, rw, rh);
      this.renderer.setScissor(x, h - y - rh, rw, rh);
      // hide own forklift's roof in cab view for visibility
      this.renderer.render(this.scene, cam);
      const opp = this.players.find((o) => o !== p);
      p.hud!.update({
        time: this.t, delivered: p.stats.delivered, total: this.world.pallets.length, speed: p.f.speed, forkH: p.f.forkH,
        turbo: p.f.turbo, style: p.stats.style, penalty: p.stats.penalty, tip: p.f.tipRisk, carrying: p.f.carrying >= 0,
        fragile: p.f.carrying >= 0 && this.world.pallets[p.f.carrying].fragile, camLabel: CAM_LABELS[p.camMode],
        opponent: opp ? { name: opp.spec.name, delivered: opp.stats.delivered } : undefined,
      });
      p.hud!.drawMinimap(this.world, flist, p.f, now);
    }
    this.renderer.setScissorTest(false);
  }

  private updateCamera(p: Player, dt: number) {
    const f = p.f;
    const cam = p.cam!;
    const [fx, fz] = f.fwd;
    p.shake = Math.max(0, p.shake - dt * 2.5);
    const sh = p.shake * p.shake * 0.6;
    const jx = (Math.random() - 0.5) * sh;
    const jy = (Math.random() - 0.5) * sh;
    let fov = 65;
    cam.layers.enable(2 + p.idx);
    if (p.camMode === 0) {
      let dist = 8.5 + Math.abs(f.speed) * 0.12;
      let camH = 4.8 + f.forkH * 0.35;
      // keep racks / walls from blocking the view: pull the camera in and up
      for (let d = 1.2; d <= dist; d += 0.3) {
        const px = f.x - fx * d;
        const pz = f.z - fz * d;
        const hy = f.y + 1.5 + (camH - 1.5) * (d / dist);
        if (this.world.statics.some((c) => c.obb && c.yMax > hy && pointInObb(px, pz, c.obb, 0.25))) {
          dist = Math.max(1.2, d - 0.5);
          camH += 1.5;
          break;
        }
      }
      const desired = new THREE.Vector3(f.x - fx * dist, f.y + camH, f.z - fz * dist);
      const k = 1 - Math.exp(-6 * dt);
      cam.position.lerp(desired, k);
      cam.position.x += jx;
      cam.position.y += jy;
      cam.lookAt(f.x + fx * 3, f.y + 1.2 + f.forkH * 0.3, f.z + fz * 3);
      fov = 65 + Math.max(0, Math.abs(f.speed) - 9) * 1.8;
    } else if (p.camMode === 1) {
      const a = new THREE.Vector3();
      f.cabAnchor.getWorldPosition(a);
      cam.position.set(a.x + jx, a.y + jy, a.z);
      const look = f.speed < -0.5 && p.ctl.throttle < 0 ? -1 : 1;
      cam.lookAt(f.x + fx * 8 * look, f.y + 0.6 + f.forkH * 0.45, f.z + fz * 8 * look);
      fov = 80;
      cam.layers.disable(2 + p.idx);
    } else {
      const desired = new THREE.Vector3(f.x - fx * 5, f.y + 26, f.z - fz * 5);
      cam.position.lerp(desired, 1 - Math.exp(-5 * dt));
      cam.position.x += jx;
      cam.lookAt(f.x + fx * 2, f.y, f.z + fz * 2);
      fov = 55;
    }
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * 0.1;
      cam.updateProjectionMatrix();
    }
  }

  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    for (const p of this.players) {
      p.ctrl?.dispose();
      p.hud?.dispose();
    }
    this.touch?.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
