import * as THREE from 'three';
import type { MiniGame, MiniGameOptions } from '../../platform/minigame';
import { escapeHtml, fmtTime } from '../forklift/hud';
import { isTouchDevice } from '../forklift/input';
import { Particles } from '../forklift/particles';
import { MAudio } from './audio';
import { ATTEMPTS, LEVEL_INFO } from './levels';
import { DEFAULT_SETUP, SLOTS, setupLabel, stats, type Setup, type SlotKey } from './parts';
import { buildCar, buildTrackMesh, buildWorld, type CarRig, type World } from './scene';
import { DNF_MS, RISK_LABELS, RaceSim, getTrack, riskLevel, riskScore, simulateRace, type OutInfo, type RaceResult } from './sim';
import { deckY, laneOffset, poseAt, type Track } from './track';

const STEP = 1 / 60;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const kmh = (v: number) => Math.round(v * 3.6);
const angLerp = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

const SAY = {
  start: [
    '📢 문방구 아저씨: 그 모터는 2천원 더 줘야 돼',
    '📢 친구: 야 건전지 새 거 맞지? 쓰던 거 넣은 거 아니지?',
    '📢 동네 꼬마: 형 이번엔 꼭 완주해!',
    '📢 친구: 출발선에서 놓는 순간이 제일 떨린다',
  ],
  near: ['📢 친구: 어어어?! 벽 탔다 벽 탔어!!', '📢 동네 꼬마: 아슬아슬하다 진짜!', '📢 친구: 심장 떨어지는 줄 알았네'],
  out: ['📢 친구: 야 날아간다 날아가!!', '📢 동네 꼬마: 으아아 코스아웃!!', '📢 문방구 아저씨: 주워다 줄 테니 가만있어라', '📢 친구: 어디 갔냐 어디! 저기 화단!'],
  short: ['📢 친구: 점프대에서 힘이 딸린다!', '📢 동네 꼬마: 도랑에 빠졌다 ㅋㅋㅋ'],
  bounce: ['📢 동네 꼬마: 착지 쿵!!', '📢 친구: 튕겼다 튕겨! 그래도 살았다'],
  wave: ['📢 친구: 웨이브에서 통통 튄다'],
  lap: ['📢 친구: 한 바퀴 돌았다!', '📢 동네 꼬마: 형 빠르다 빠르다!'],
  win: ['📢 문방구 아저씨: 우승 상품은 쫀드기다', '📢 친구: 완주 축하한다 이 녀석아!', '📢 동네 꼬마: 와아아 형 짱!'],
  cheer: ['📢 동네 꼬마: 가라 가라 가라!!', '📢 친구: 제발 제발 제발...', '📢 문방구 아저씨: 기도는 공짜다', '📢 친구: 건전지야 버텨줘!'],
};

const CSS = `
.mc-g,.mc-h{position:absolute;inset:0;pointer-events:none;color:#fff;font-weight:600;text-shadow:0 1px 3px #000a}
.mc-g button,.mc-h button,.mc-end button,.mc-end{pointer-events:auto}
.mc-top{position:absolute;top:max(6px,env(safe-area-inset-top));left:8px;right:104px;min-height:30px;display:flex;gap:8px;align-items:center;font-size:13px;flex-wrap:wrap}
.mc-pill{background:#0b0f17cc;border:1px solid #fff2;border-radius:16px;padding:3px 10px;white-space:nowrap}
.mc-pill b{color:var(--accent)}
.mc-left{position:absolute;left:8px;top:44px;bottom:8px;width:196px;background:#0b0f17d9;border:1px solid #fff2;border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:5px;overflow:hidden}
.mc-left h4{margin:0;font-size:12px;color:var(--accent)}
.mc-row{display:grid;grid-template-columns:44px 1fr;gap:6px;align-items:center;font-size:11px}
.mc-bar{height:8px;border-radius:4px;background:#ffffff1f;overflow:hidden}
.mc-bar i{display:block;height:100%;width:0;border-radius:4px;transition:width .18s}
.mc-pred{font-size:12px;line-height:1.35;margin-top:2px}
.mc-pred b{color:var(--accent);font-size:15px}
.mc-risk{display:flex;gap:3px;margin:3px 0 2px}
.mc-risk i{flex:1;height:9px;border-radius:3px;background:#ffffff22}
.mc-note{font-size:10px;color:#9fb0c6;font-weight:400;line-height:1.3}
.mc-right{position:absolute;right:8px;top:44px;bottom:8px;width:min(372px,48vw);background:#0b0f17e6;border:1px solid #fff2;border-radius:12px;padding:6px;display:flex;flex-direction:column;gap:6px}
.mc-tabs{display:flex;gap:4px}
.mc-tab{flex:1;min-width:0;min-height:46px;border-radius:9px;border:2px solid #fff2;background:#1b2433;font-size:17px;line-height:1.05;padding:2px;text-shadow:none}
.mc-tab small{display:block;font-size:9px;color:#cfd8e6;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:clip}
.mc-tab.on{border-color:var(--accent);background:#3a3010}
.mc-cards{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:5px;min-height:0;-webkit-overflow-scrolling:touch}
.mc-card{display:flex;align-items:center;gap:8px;min-height:50px;padding:4px 8px;border-radius:10px;border:2px solid #fff2;background:#1b2433;text-align:left;width:100%;text-shadow:none;flex-shrink:0}
.mc-card.on{border-color:var(--accent);background:#2e2a10}
.mc-card .ic{font-size:22px;width:28px;text-align:center}
.mc-card .tx{flex:1;min-width:0}
.mc-card .nm{font-size:13px;font-weight:800;line-height:1.15}
.mc-card .ds{font-size:10.5px;color:#aebbd0;font-weight:400;line-height:1.2}
.mc-chips{display:flex;flex-direction:column;gap:2px;align-items:flex-end;min-width:54px}
.mc-chip{font-size:10px;padding:1px 5px;border-radius:8px;background:#ffffff18;white-space:nowrap}
.mc-chip.up{color:#7dffa6}.mc-chip.dn{color:#ff9a9a}.mc-chip.nu{color:#ffd98a}
.mc-go{margin:0!important;padding:11px!important;font-size:17px!important;flex-shrink:0}
.mc-fb{position:absolute;left:214px;right:min(388px,50vw);bottom:10px;background:#0b0f17d9;border:1px solid #ff6a6a66;border-radius:10px;padding:6px 8px;font-size:11px;line-height:1.35;font-weight:400;max-height:96px;overflow:hidden}
.mc-fb:empty{display:none}
.mc-fb b{color:#ffb0b0}
.mc-hud-tl{position:absolute;top:max(8px,env(safe-area-inset-top));left:10px;display:flex;flex-direction:column;gap:5px;max-width:42%}
.mc-hud-c{position:absolute;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);text-align:center;background:#0b0f17b0;border-radius:12px;padding:3px 14px}
.mc-hud-c .t{font-family:ui-monospace,monospace;font-size:26px;line-height:1.1}
.mc-hud-c .l{font-size:12px;color:#d8e2f0}
.mc-laps{font-size:12px;line-height:1.35;background:#0b0f17a0;border-radius:8px;padding:3px 8px}
.mc-laps .best{color:var(--good)}
.mc-bl{position:absolute;left:10px;bottom:max(10px,env(safe-area-inset-bottom));display:flex;gap:8px;align-items:flex-end}
.mc-bl .gauge{min-width:78px}
.mc-batt{width:86px;height:10px;background:#fff3;border-radius:5px;overflow:hidden;margin-top:4px}
.mc-batt i{display:block;height:100%;background:var(--good);width:100%}
.mc-br{position:absolute;right:10px;bottom:max(10px,env(safe-area-inset-bottom));display:flex;gap:6px}
.mc-br .tb{width:56px;height:56px;font-size:20px;border-radius:14px;padding:0}
.mc-br .tb small{font-size:9px;margin-top:1px}
.mc-cd{position:absolute;top:36%;left:0;right:0;text-align:center;font-family:'Black Han Sans',sans-serif;font-size:84px;transform:translateY(-50%)}
.mc-cd.go{color:var(--accent)}
.mc-toasts{position:absolute;top:92px;left:50%;transform:translateX(-50%);width:min(92%,520px);display:flex;flex-direction:column;gap:5px;align-items:center}
.mc-toasts .toast{font-size:13px;padding:6px 12px;font-weight:600}
.mc-gap{font-size:12px;color:#bfe6ff}
.mc-end{position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:5}
.mc-card2{width:min(94%,480px);max-height:92%;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px 16px;font-weight:500;text-shadow:none;color:var(--text)}
.mc-card2 h2{margin:0 0 4px;font-size:22px}
.mc-card2 .big{font-family:ui-monospace,monospace;font-size:30px;color:var(--accent)}
.mc-card2 .ln{font-size:13px;line-height:1.45;margin:3px 0}
.mc-card2 .bad{color:#ff9a9a}.mc-card2 .good{color:var(--good)}.mc-card2 .tip{color:#ffd98a}
.mc-btns{display:flex;gap:8px;margin-top:10px}
.mc-btns .big-btn{margin:0;padding:12px;font-size:15px}
@media (max-height:430px){
 .mc-left{top:40px;padding:6px 8px;gap:3px}.mc-right{top:40px}.mc-pill{padding:2px 8px;font-size:12px}
 .mc-card2{padding:10px 12px}.mc-card2 h2{font-size:18px}.mc-card2 .big{font-size:24px}.mc-card2 .ln{font-size:12px;margin:2px 0}
 .mc-cd{font-size:64px}
 .mc-tab{min-height:40px;font-size:15px}.mc-card{min-height:42px;padding:3px 8px;gap:6px}.mc-card .nm{font-size:12.5px}.mc-card .ds{font-size:10px}.mc-card .ic{font-size:19px}
 .mc-go{padding:8px!important;font-size:15px!important}.mc-right{gap:4px}
}
@media (max-aspect-ratio:1/1){
 .mc-left{top:40px;bottom:auto;right:8px;width:auto;height:150px}
 .mc-right{top:auto;left:8px;right:8px;width:auto;height:50%}
 .mc-fb{left:8px;right:8px;bottom:calc(50% + 14px)}
 .mc-hud-tl{max-width:34%}
}
`;

interface CarPose {
  x: number; y: number; z: number; yaw: number; pitch: number; roll: number;
}

type Phase = 'garage' | 'countdown' | 'race' | 'attemptEnd' | 'over';

interface AttemptRec {
  setup: Setup;
  res: RaceResult;
  rivalMs: number;
}

export class MiniCarGame implements MiniGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly audio = new MAudio();
  readonly track: Track;
  readonly level: number;
  readonly world: World;
  readonly parts: Particles;
  setup: Setup = { ...DEFAULT_SETUP };
  attempts: AttemptRec[] = [];
  phase: Phase = 'garage';
  sim: RaceSim | null = null;
  paused = false;
  fast = 1;
  camMode = 0;
  tab = 0;
  ended = false;
  stepCount = 0;
  private styleEl: HTMLStyleElement;
  private ui: HTMLDivElement;
  private hud: HTMLDivElement | null = null;
  private hudEl: Record<string, HTMLElement> = {};
  private endEl: HTMLDivElement | null = null;
  private carRig: CarRig | null = null;
  private previewRig: CarRig | null = null;
  private ghostRig: CarRig | null = null;
  private rivalTrace: number[] = [];
  private rivalRes: RaceResult;
  private resizeObs: ResizeObserver;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private disposed = false;
  private cdT = 0;
  private endT = 0;
  private eventsSeen = 0;
  private lapsSeen = 0;
  private tumble: { p: THREE.Vector3; v: THREE.Vector3; w: THREE.Vector3; t: number } | null = null;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camYaw = 0;
  private shake = 0;
  private lastPose: CarPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  private nearToastAt = -9;
  private onKey: (e: KeyboardEvent) => void;

  constructor(private container: HTMLElement, private opts: MiniGameOptions) {
    this.level = clamp(opts.level, 1, LEVEL_INFO.length);
    const mobile = isTouchDevice() || window.innerWidth < 800;
    const shadows = !isTouchDevice();
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);

    this.track = getTrack(this.level);
    this.world = buildWorld(this.track, shadows);
    this.scene.add(this.world.group, buildTrackMesh(this.track, shadows));
    this.scene.background = new THREE.Color(this.world.sky);
    this.scene.fog = new THREE.Fog(this.world.fog, 70, 240);
    this.parts = new Particles(this.scene, mobile ? 90 : 180);

    // rival ghost (fixed decent setup, deterministic)
    const rv = LEVEL_INFO[this.level - 1].rival;
    const rr = simulateRace(rv.setup, this.level, true);
    this.rivalRes = rr;
    this.rivalTrace = rr.trace ?? [];
    this.ghostRig = buildCar(0xffffff, rv.setup, true);
    this.ghostRig.group.visible = false;
    this.scene.add(this.ghostRig.group);

    this.styleEl = document.createElement('style');
    this.styleEl.textContent = CSS;
    document.head.appendChild(this.styleEl);
    this.ui = document.createElement('div');
    this.ui.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    container.appendChild(this.ui);

    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey);
    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.enterGarage();
    this.layout();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ setup / garage
  private enterGarage() {
    this.phase = 'garage';
    this.endEl?.remove();
    this.endEl = null;
    this.hud?.remove();
    this.hud = null;
    this.tumble = null;
    this.carRig && (this.carRig.group.visible = false);
    if (this.ghostRig) this.ghostRig.group.visible = false;
    this.audio.motor(0, false);
    this.rebuildPreview();
    this.renderGarage();
    this.layout();
  }

  private rebuildPreview() {
    if (this.previewRig) {
      this.scene.remove(this.previewRig.group);
      this.disposeObj(this.previewRig.group);
    }
    const rig = buildCar(this.opts.color, this.setup);
    rig.group.position.set(this.world.bench.x, 0.3, this.world.bench.z);
    rig.group.scale.setScalar(1.6);
    this.previewRig = rig;
    this.scene.add(rig.group);
  }

  private bestMs() {
    let b = Infinity;
    for (const a of this.attempts) if (a.res.finished) b = Math.min(b, a.res.timeMs);
    return b;
  }

  private lastFeedback(): string {
    const a = this.attempts[this.attempts.length - 1];
    if (!a) return '';
    if (a.res.finished) {
      const near = a.res.maxRatio > 0.8 ? ` · 가장 아슬아슬: <b>${escapeHtml(a.res.maxRatioSeg)}</b> (한계의 ${Math.round(a.res.maxRatio * 100)}%)` : '';
      return `지난 시도: 완주 ${(a.res.timeMs / 1000).toFixed(2)}초${near}`;
    }
    return `지난 시도: <b>${escapeHtml(this.outText(a.res.out!))}</b>`;
  }

  private outText(o: OutInfo): string {
    const where = `${o.segName} (${o.lap}랩째)`;
    const v = kmh(o.v), s = kmh(o.safeV);
    if (o.kind === 'landing') return `${where} 착지 실패 — 점프 속도 ${v}km/h, 안전 속도 약 ${s}km/h`;
    if (o.kind === 'wave') return `${where} 과속 — ${v}km/h로 진입, 약 ${s}km/h까지만 버텨요`;
    return `${where} 진입 속도 과다 — ${v}km/h, 이 코너 안전 속도 약 ${s}km/h`;
  }

  private adviceFor(o: OutInfo): string {
    if (o.kind === 'landing') return '→ 슬로프 브레이크 / 무게추로 점프 속도를 낮추거나, 착지에 강한 롤러(플라스틱·넓게)로.';
    if (o.kind === 'wave') return '→ 무게추를 달거나 브레이크로 진입 속도를 낮춰 보세요.';
    return '→ 롤러를 넓게 / 무게추 / 소경 타이어로 코너 한계를 올리거나, 기어비·모터로 최고속을 낮추세요.';
  }

  /** deltas of replacing slot with option vs the current setup, as chips */
  private chips(slot: SlotKey, idx: number): string {
    if (this.setup[slot] === idx) return '';
    const cur = stats(this.setup), alt = stats({ ...this.setup, [slot]: idx });
    const out: [string, number, number][] = [
      ['최고속', alt.top - cur.top, 0.35],
      ['가속', alt.a3 - cur.a3, 0.5],
      ['안정', alt.aLim - cur.aLim, 0.5],
      ['무게', -(alt.massG - cur.massG), 3],
      ['소모', -(alt.drainRaw - cur.drainRaw), 0.12],
    ];
    return out
      .filter(([, d, th]) => Math.abs(d) >= th)
      .sort((a, b) => Math.abs(b[1] / b[2]) - Math.abs(a[1] / a[2]))
      .slice(0, 2)
      .map(([n, d]) => `<span class="mc-chip ${d > 0 ? 'up' : 'dn'}">${n}${d > 0 ? '▲' : '▼'}</span>`)
      .join('');
  }

  private renderGarage() {
    this.ui.innerHTML = '';
    const g = document.createElement('div');
    g.className = 'mc-g';
    const info = LEVEL_INFO[this.level - 1];
    const best = this.bestMs();
    g.innerHTML = `
      <div class="mc-top">
        <span class="mc-pill">🔧 <b>세팅</b> · 시도 <b>${this.attempts.length + 1}/${ATTEMPTS}</b></span>
        <span class="mc-pill">LV.${this.level} ${info.name}</span>
        <span class="mc-pill">🏆 ${best < Infinity ? (best / 1000).toFixed(2) + '초' : '기록 없음'}</span>
        <span class="mc-pill">🆚 ${escapeHtml(info.rival.name)}</span>
      </div>
      <div class="mc-left">
        <h4>📊 예상 성능</h4>
        ${['speed:최고속:#ffb347', 'accel:가속:#7dd3ff', 'stab:안정성:#7dffa6', 'weight:무게:#c9b8ff', 'drain:전지소모:#ff8a8a']
          .map((r) => {
            const [k, l, c] = r.split(':');
            return `<div class="mc-row"><span>${l}</span><div class="mc-bar"><i data-b="${k}" style="background:${c}"></i></div></div>`;
          })
          .join('')}
        <div class="mc-pred" data-k="pred"></div>
        <div class="mc-risk" data-k="risk"><i></i><i></i><i></i><i></i></div>
        <div class="mc-note">※ 위험도는 대략적인 추정치. 점프·웨이브·배터리는 반영 안 됨. 직접 달려 봐야 안다!</div>
      </div>
      <div class="mc-fb" data-k="fb">${this.lastFeedback()}</div>
      <div class="mc-right">
        <div class="mc-tabs">${SLOTS.map((s, i) => `<button class="mc-tab" data-tab="${i}">${s.icon}<small>${s.key === 'weight' ? '추·브레이크' : s.key === 'battery' ? '전지' : s.label}</small></button>`).join('')}</div>
        <div class="mc-cards" data-k="cards"></div>
        <button class="big-btn mc-go" data-k="go">🏁 출발! (시도 ${this.attempts.length + 1}/${ATTEMPTS})</button>
      </div>`;
    this.ui.appendChild(g);
    g.querySelectorAll<HTMLButtonElement>('.mc-tab').forEach((b) => (b.onclick = () => this.selectTab(Number(b.dataset.tab))));
    (g.querySelector('[data-k="go"]') as HTMLButtonElement).onclick = () => this.startRace();
    this.refreshGarage();
  }

  selectTab(i: number) {
    this.tab = clamp(i, 0, SLOTS.length - 1);
    this.audio.click();
    this.refreshGarage();
  }

  /** same as tapping a card */
  pick(slot: number, idx: number) {
    const sl = SLOTS[slot];
    this.tab = slot;
    this.setup = { ...this.setup, [sl.key]: idx };
    this.audio.click();
    this.rebuildPreview();
    this.refreshGarage();
  }

  private refreshGarage() {
    const root = this.ui.querySelector('.mc-g');
    if (!root) return;
    root.querySelectorAll<HTMLButtonElement>('.mc-tab').forEach((b) => b.classList.toggle('on', Number(b.dataset.tab) === this.tab));
    const sl = SLOTS[this.tab];
    const cards = root.querySelector('[data-k="cards"]') as HTMLElement;
    cards.innerHTML = sl.parts
      .map(
        (p, i) => `<button class="mc-card ${this.setup[sl.key] === i ? 'on' : ''}" data-i="${i}">
          <span class="ic">${p.icon}</span><span class="tx"><div class="nm">${p.name}</div><div class="ds">${p.desc}</div></span>
          <span class="mc-chips">${this.chips(sl.key, i)}</span></button>`,
      )
      .join('');
    cards.querySelectorAll<HTMLButtonElement>('.mc-card').forEach((b) => (b.onclick = () => this.pick(this.tab, Number(b.dataset.i))));
    const st = stats(this.setup);
    (['speed', 'accel', 'stab', 'weight', 'drain'] as const).forEach((k) => {
      (root.querySelector(`[data-b="${k}"]`) as HTMLElement).style.width = `${Math.round(st[k] * 100)}%`;
    });
    const rl = riskLevel(riskScore(this.setup, this.level), this.level);
    (root.querySelector('[data-k="pred"]') as HTMLElement).innerHTML = `예상 최고속 <b>${Math.round(st.kmh)}</b> km/h<br>코스아웃 위험도 <b style="color:${['#7dffa6', '#ffe27a', '#ffa05a', '#ff6a6a'][rl]}">${RISK_LABELS[rl]}</b> <span class="mc-note">(추정)</span>`;
    root.querySelectorAll<HTMLElement>('[data-k="risk"] i').forEach((el, i) => {
      el.style.background = i <= rl ? ['#3be07a', '#ffe27a', '#ffa05a', '#ff5a5a'][rl] : '#ffffff22';
    });
    // card tabs show current choice short name
    root.querySelectorAll<HTMLButtonElement>('.mc-tab').forEach((b, i) => {
      b.title = SLOTS[i].parts[this.setup[SLOTS[i].key]].name;
    });
  }

  // ------------------------------------------------------------ race flow
  startRace() {
    if (this.phase !== 'garage' || this.ended) return;
    this.audio.click();
    this.sim = new RaceSim(this.setup, this.level);
    this.stepCount = 0;
    this.eventsSeen = 0;
    this.lapsSeen = 0;
    this.tumble = null;
    this.nearToastAt = -9;
    if (this.carRig) {
      this.scene.remove(this.carRig.group);
      this.disposeObj(this.carRig.group);
    }
    this.carRig = buildCar(this.opts.color, this.setup);
    this.scene.add(this.carRig.group);
    this.ghostRig!.group.visible = true;
    this.phase = 'countdown';
    this.cdT = 0;
    this.fast = 1;
    this.ui.innerHTML = '';
    this.buildHud();
    this.placeCar(this.carRig, this.sim.sTot + 0.3);
    this.camYaw = this.lastPose.yaw;
    this.snapCamera();
    this.toast(pick(SAY.start), 'radio');
    this.layout();
  }

  private buildHud() {
    const h = document.createElement('div');
    h.className = 'mc-h';
    const col = '#' + this.opts.color.toString(16).padStart(6, '0');
    h.innerHTML = `
      <div class="mc-hud-tl">
        <div class="hud-name" style="--pc:${col};display:inline-block;width:fit-content;text-shadow:none">${escapeHtml(this.opts.nickname)}</div>
        <div class="mc-pill">시도 <b>${this.attempts.length + 1}/${ATTEMPTS}</b></div>
        <div class="mc-laps" data-k="laps"></div>
      </div>
      <div class="mc-hud-c"><div class="l" data-k="lap">LAP 1/3</div><div class="t" data-k="time">0:00.0</div><div class="mc-gap" data-k="gap"></div></div>
      <div class="mc-bl">
        <div class="gauge"><span>속도</span><b data-k="spd">0</b><small>km/h</small></div>
        <div class="gauge"><span>🔋 배터리</span><div class="mc-batt"><i data-k="batt"></i></div><small data-k="bp">100%</small></div>
      </div>
      <div class="mc-br">
        <button class="tb" data-act="cheer">📣<small>응원</small></button>
        <button class="tb" data-act="ff">⏩<small data-k="ffl">×1</small></button>
        <button class="tb" data-act="cam">🎥<small data-k="caml">추적</small></button>
      </div>
      <div class="mc-cd" data-k="cd"></div>
      <div class="mc-toasts" data-k="toasts"></div>`;
    this.ui.appendChild(h);
    this.hud = h;
    this.hudEl = {};
    h.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.hudEl[e.dataset.k!] = e));
    h.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'cam') this.cycleCam();
        else if (a === 'ff') this.cycleFast();
        else this.cheer();
      };
    });
  }

  cycleCam() {
    this.camMode = (this.camMode + 1) % 3;
    this.snapCamera();
  }
  cycleFast() {
    this.fast = this.fast === 1 ? 2 : this.fast === 2 ? 4 : 1;
  }
  cheer() {
    if (this.phase !== 'race' && this.phase !== 'countdown') return;
    this.audio.cheer();
    this.toast(pick(SAY.cheer), 'radio');
  }

  private toast(text: string, cls = '') {
    const box = this.hudEl.toasts;
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild?.remove();
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
  }

  /** advance game logic by dt (called with fixed 1/60 from the frame loop; also directly by tests) */
  step(dt: number) {
    if (this.ended) return;
    this.parts.update(dt);
    if (this.phase === 'garage') {
      if (this.previewRig) this.previewRig.group.rotation.y += dt * 0.7;
      return;
    }
    if (this.phase === 'countdown') {
      const before = Math.ceil(3 - this.cdT);
      this.cdT += dt;
      const n = Math.ceil(3 - this.cdT);
      if (n !== before && n > 0) this.audio.beep();
      if (this.hudEl.cd) {
        this.hudEl.cd.textContent = n > 0 ? String(n) : '출발!';
        this.hudEl.cd.className = 'mc-cd' + (n > 0 ? '' : ' go');
      }
      if (this.cdT >= 3) {
        this.phase = 'race';
        this.audio.beep(true);
        setTimeout(() => this.hudEl.cd && (this.hudEl.cd.textContent = ''), 700);
      }
      this.sync(dt);
      return;
    }
    if (this.phase === 'race' && this.sim) {
      const sim = this.sim;
      if (sim.t > 0.8 && this.hudEl.cd?.textContent) this.hudEl.cd.textContent = '';
      if (sim.state === 'run') {
        sim.step(dt);
        this.stepCount++;
        this.pollEvents();
        const st = sim.state as string;
        if (st === 'out') this.onOut();
        else if (st === 'done') {
          this.audio.fanfare();
          this.toast(pick(SAY.win), 'good');
          this.endT = 0;
        }
      } else {
        this.endT += dt;
        if (sim.state === 'out' && this.tumble) this.stepTumble(dt);
        if (this.endT > (sim.state === 'out' ? 2.4 : 1.4)) this.finishAttempt();
      }
      this.sync(dt);
    }
  }

  private pollEvents() {
    const sim = this.sim!;
    if (sim.lapTimes.length > this.lapsSeen) {
      this.lapsSeen = sim.lapTimes.length;
      if (sim.state === 'run') this.toast(pick(SAY.lap), 'good');
    }
    while (this.eventsSeen < sim.events.length) {
      const e = sim.events[this.eventsSeen++];
      if (e.kind === 'nearmiss') {
        if (sim.t - this.nearToastAt > 4) {
          this.toast(pick(SAY.near), 'bad');
          this.nearToastAt = sim.t;
        }
      } else if (e.kind === 'short') {
        this.toast(pick(SAY.short), 'bad');
        this.audio.thud();
      } else if (e.kind === 'bounce') {
        this.toast(pick(SAY.bounce), 'bad');
        this.audio.thud();
        this.shake = 0.5;
      } else if (e.kind === 'wave') this.toast(pick(SAY.wave), 'bad');
    }
  }

  private onOut() {
    const sim = this.sim!;
    const o = sim.out!;
    this.audio.crash();
    this.audio.sad();
    this.toast(pick(SAY.out), 'bad');
    this.shake = 1;
    this.endT = 0;
    const p = this.lastPose;
    const fwd = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const left = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw)); // world left
    const v = o.v;
    const vel = fwd.clone().multiplyScalar(v * 0.9);
    const w = new THREE.Vector3();
    if (o.kind === 'landing' || o.kind === 'wave') {
      vel.y = 3.5;
      w.set(0, 0.5, o.kind === 'landing' ? -9 : 4);
    } else {
      vel.add(left.multiplyScalar(o.side * v * 0.45));
      vel.y = 4 + v * 0.15;
      w.set(-o.side * 7, 2, 3);
    }
    this.tumble = { p: new THREE.Vector3(p.x, p.y + 0.3, p.z), v: vel, w, t: 0 };
    this.parts.burst(p.x, p.y + 0.4, p.z, 18, 0xffb347, 6, 0.12, 0.7);
    this.parts.burst(p.x, p.y + 0.4, p.z, 8, 0xffffff, 4, 0.1, 0.5);
  }

  private stepTumble(dt: number) {
    const t = this.tumble!;
    t.t += dt;
    t.v.y -= 24 * dt;
    t.p.addScaledVector(t.v, dt);
    if (t.p.y < 0.2) {
      t.p.y = 0.2;
      if (Math.abs(t.v.y) > 2) this.audio.thud();
      t.v.y = -t.v.y * 0.35;
      t.v.x *= 0.7;
      t.v.z *= 0.7;
      t.w.multiplyScalar(0.7);
      if (Math.abs(t.v.y) > 1.5) this.parts.burst(t.p.x, 0.2, t.p.z, 5, 0xbbbbbb, 2, 0.1, 0.5);
    }
    const g = this.carRig!.group;
    g.position.copy(t.p);
    g.rotation.order = 'XYZ';
    g.rotation.x += t.w.x * dt;
    g.rotation.y += t.w.y * dt;
    g.rotation.z += t.w.z * dt;
  }

  private finishAttempt() {
    const sim = this.sim!;
    if (this.phase !== 'race') return;
    this.phase = 'attemptEnd';
    const res = sim.result;
    this.attempts.push({ setup: { ...this.setup }, res, rivalMs: this.rivalRes.timeMs });
    this.audio.motor(0, false);
    this.showEnd(res);
  }

  private showEnd(res: RaceResult) {
    const info = LEVEL_INFO[this.level - 1];
    const left = ATTEMPTS - this.attempts.length;
    const best = this.bestMs();
    const d = document.createElement('div');
    d.className = 'mc-end';
    let body = '';
    if (res.finished) {
      const laps = res.lapTimes.map((t, i) => `${i + 1}랩 ${t.toFixed(2)}`).join(' · ');
      const fade = res.lapTimes[res.lapTimes.length - 1] > res.lapTimes[0] * 1.07;
      const ev = res.events.filter((e) => e.kind !== 'nearmiss');
      const sh = ev.filter((e) => e.kind === 'short').length, bo = ev.filter((e) => e.kind === 'bounce').length, wv = ev.filter((e) => e.kind === 'wave').length;
      const rivalLine = this.rivalRes.finished
        ? `🆚 ${escapeHtml(info.rival.name)} ${(this.rivalRes.timeMs / 1000).toFixed(2)}초 — ${res.timeMs < this.rivalRes.timeMs ? '<span class="good">이겼다!</span>' : '<span class="bad">졌다...</span>'}`
        : '';
      body = `<h2>🏁 완주!</h2><div class="big">${(res.timeMs / 1000).toFixed(2)}초${res.timeMs <= best ? ' <span class="good" style="font-size:14px">🆕 베스트</span>' : ''}</div>
        <div class="ln">${laps}</div>
        <div class="ln">최고속 ${kmh(res.topV)}km/h${res.maxRatio > 0.8 ? ` · 가장 아슬아슬: ${escapeHtml(res.maxRatioSeg)} (한계의 ${Math.round(res.maxRatio * 100)}%)` : ''}</div>
        ${fade ? '<div class="ln tip">🔋 후반 랩이 느려졌다 — 건전지/모터 소모를 확인해 보세요.</div>' : ''}
        ${sh ? '<div class="ln tip">🕳️ 점프대에서 힘이 모자라 떨어졌다 — 토크/가속형 세팅이나 브레이크 약화.</div>' : ''}
        ${bo ? `<div class="ln tip">🦘 착지에서 ${bo}번 튕김 — 속도 손실. 브레이크나 무게추를 고려.</div>` : ''}
        ${wv ? '<div class="ln tip">〰️ 웨이브에서 통통 튀며 감속했다.</div>' : ''}
        <div class="ln">${rivalLine}</div>`;
    } else {
      const o = res.out!;
      body = `<h2>💥 코스아웃!</h2>
        <div class="ln bad"><b>${escapeHtml(this.outText(o))}</b></div>
        <div class="ln tip">${this.adviceFor(o)}</div>`;
    }
    const buttons = left > 0
      ? `<button class="big-btn" data-a="again">🔧 다시 세팅 (남은 ${left}회)</button>${this.attempts.length >= 1 ? '<button class="big-btn ghost" data-a="finish">여기서 끝내기</button>' : ''}`
      : '<button class="big-btn" data-a="finish">📋 결과 보기</button>';
    d.innerHTML = `<div class="mc-card2">${body}<div class="mc-btns">${buttons}</div></div>`;
    this.ui.appendChild(d);
    this.endEl = d;
    (d.querySelector('[data-a="again"]') as HTMLButtonElement | null)?.addEventListener('click', () => this.enterGarage());
    (d.querySelector('[data-a="finish"]') as HTMLButtonElement | null)?.addEventListener('click', () => this.finishRun());
  }

  finishRun() {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'over';
    const okRuns = this.attempts.filter((a) => a.res.finished);
    const info = LEVEL_INFO[this.level - 1];
    const detail: { label: string; value: string }[] = [];
    let timeMs = DNF_MS;
    let title = '전부 코스아웃...';
    if (okRuns.length) {
      const best = okRuns.reduce((a, b) => (a.res.timeMs <= b.res.timeMs ? a : b));
      timeMs = best.res.timeMs;
      const s = timeMs / 1000;
      title = s <= info.medals[0] ? '🏆 챔피언 등극!' : s <= info.medals[1] ? '🥈 준우승!' : s <= info.medals[2] ? '🥉 입상!' : '완주!';
      detail.push({ label: '베스트 랩', value: Math.min(...best.res.lapTimes).toFixed(2) + '초' });
      detail.push({ label: '3랩 타임', value: best.res.lapTimes.map((t) => t.toFixed(1)).join(' / ') });
      detail.push({ label: '최고 속도', value: `${kmh(best.res.topV)} km/h` });
      detail.push({ label: '베스트 세팅', value: setupLabel(best.setup).replace(/ \/ /g, ' · ') });
      if (this.rivalRes.finished) detail.push({ label: `🆚 ${info.rival.name}`, value: `${(this.rivalRes.timeMs / 1000).toFixed(2)}초 ${timeMs < this.rivalRes.timeMs ? '(승)' : '(패)'}` });
    }
    detail.push({ label: '시도 결과', value: `완주 ${okRuns.length} · 코스아웃 ${this.attempts.length - okRuns.length}` });
    this.opts.onEnd({ timeMs, title, detail });
  }

  // ------------------------------------------------------------ poses
  private poseFor(sTot: number, laneAdd = 0): CarPose {
    const T = this.track, L = T.length;
    const lap = Math.min(T.def.laps - 1, Math.max(0, Math.floor(sTot / L)));
    const sLap = clamp(sTot - lap * L, 0, L);
    const sm = poseAt(T, sLap);
    const off = laneOffset(T, sLap, lap) + laneAdd;
    const dOff = (laneOffset(T, Math.min(L, sLap + 0.4), lap) - off) / 0.4;
    return {
      x: sm.x - Math.sin(sm.h) * off,
      z: -(sm.z + Math.cos(sm.h) * off),
      y: deckY(T, sLap),
      yaw: sm.h + Math.atan(dOff),
      pitch: sm.gr,
      roll: 0,
    };
  }

  private placeCar(rig: CarRig, sTot: number, sim?: RaceSim): CarPose {
    const p = this.poseFor(sTot);
    if (sim) {
      const seg = sim.segNow;
      if (sim.flying) {
        const u = 1 - sim.flying.left / sim.flying.total;
        p.y += (0.22 + sim.v * 0.045) * 4 * u * (1 - u);
        p.pitch = (seg.theta ?? 0.3) * (1 - 2 * u) * 0.9;
      }
      const c = sim.state === 'out' ? 0 : sim.climb;
      if (c > 0.01 && seg.k === 'arc') {
        const side = -Math.sign(seg.R!); // + = world-left
        p.y += c * 0.28;
        p.roll = -side * c * 0.5 * -1;
        const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
        p.x += lx * side * c * 0.3;
        p.z += lz * side * c * 0.3;
      } else if (this.phase === 'race' && sim.ratio > 0.75 && seg.k === 'arc') {
        p.roll = Math.sign(seg.R!) * 0.04 * (sim.ratio - 0.75) * 4;
      }
    }
    rig.group.visible = true;
    rig.group.position.set(p.x, p.y, p.z);
    rig.group.rotation.order = 'YZX';
    rig.group.rotation.set(p.roll, p.yaw, p.pitch);
    if (sim) this.lastPose = p;
    return p;
  }

  private sync(dt: number) {
    const sim = this.sim;
    if (!sim || !this.carRig) return;
    if (!this.tumble) {
      const sNow = this.phase === 'countdown' ? 0.3 : sim.sTot + 0.3;
      this.placeCar(this.carRig, sNow, sim);
      if (sim.state === 'run' && this.phase === 'race') {
        const spin = (sim.v * dt) / this.carRig.tireR;
        for (const w of this.carRig.spin) w.rotation.z -= spin;
        if (sim.climb > 0.2 && this.stepCount % 3 === 0) this.parts.spawn(this.lastPose.x, this.lastPose.y + 0.2, this.lastPose.z, (Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3, 0xffd36a, 0.35, 0.07, 14);
      }
    }
    // ghost
    const gh = this.ghostRig!.group;
    if (this.phase === 'race' && this.rivalTrace.length) {
      const i = Math.min(this.rivalTrace.length - 1, this.stepCount);
      this.placeCar(this.ghostRig!, this.rivalTrace[i] + 0.3);
      gh.visible = !(this.rivalRes.finished && i >= this.rivalTrace.length - 1) || sim.state === 'run';
    } else if (this.phase === 'countdown') {
      this.placeCar(this.ghostRig!, 0.3);
    }
  }

  // ------------------------------------------------------------ camera
  private snapCamera() {
    this.camSnap = true;
  }
  private camSnap = true;

  private updateCamera(dt: number) {
    const cam = this.camera;
    if (this.phase === 'garage' || this.phase === 'over') {
      const b = this.world.bench;
      cam.position.set(b.x + 5.4, 3.0, b.z + 6.2);
      cam.lookAt(b.x, 0.9, b.z);
      cam.fov = 38;
      cam.updateProjectionMatrix();
      return;
    }
    const p = this.tumble ? { x: this.tumble.p.x, y: this.tumble.p.y, z: this.tumble.p.z, yaw: this.lastPose.yaw } : this.lastPose;
    const fwd = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const pos = new THREE.Vector3(p.x, p.y, p.z);
    const want = new THREE.Vector3(), look = new THREE.Vector3();
    let fov = 62;
    const k = this.camSnap ? 1 : 1 - Math.exp(-dt * 6);
    if (this.camMode === 0) {
      if (!this.tumble) this.camYaw = angLerp(this.camYaw, p.yaw, this.camSnap ? 1 : 1 - Math.exp(-dt * 3.5));
      const f2 = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      want.copy(pos).addScaledVector(f2, -5.4).add(new THREE.Vector3(0, 2.7, 0));
      look.copy(pos).addScaledVector(f2, 3.5).add(new THREE.Vector3(0, 0.3, 0));
    } else if (this.camMode === 1) {
      const c = this.world.center, r = this.world.radius;
      want.set(c.x, r * 1.6 + 8, c.z + r * 0.9);
      look.copy(c);
      fov = 55;
    } else {
      want.copy(pos).addScaledVector(fwd, 0.35).add(new THREE.Vector3(0, 0.95, 0));
      look.copy(pos).addScaledVector(fwd, 7).add(new THREE.Vector3(0, 0.55, 0));
      fov = 75;
    }
    if (this.camMode === 1) {
      this.camPos.copy(want);
      this.camLook.copy(look);
    } else {
      this.camPos.lerp(want, this.camMode === 2 ? 1 : k);
      this.camLook.lerp(look, this.camMode === 2 ? 1 : k);
    }
    this.camSnap = false;
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.35;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.35;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    cam.lookAt(this.camLook);
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------ hud / layout
  private updateHud() {
    const sim = this.sim;
    const e = this.hudEl;
    if (!sim || !this.hud) return;
    const L = this.track.def.laps;
    const lapNo = Math.min(L, sim.lapTimes.length + 1);
    e.lap.textContent = `LAP ${lapNo}/${L}`;
    e.time.textContent = fmtTime(sim.state === 'done' ? sim.finishT : sim.t);
    e.spd.textContent = String(kmh(sim.state === 'out' ? 0 : sim.v));
    const b = Math.max(0, Math.min(1, sim.eff));
    (e.batt as HTMLElement).style.width = `${Math.round(b * 100)}%`;
    (e.batt as HTMLElement).style.background = b > 0.6 ? 'var(--good)' : b > 0.4 ? '#ffd23a' : 'var(--bad)';
    e.bp.textContent = `출력 ${Math.round(b * 100)}%`;
    const best = sim.lapTimes.length ? Math.min(...sim.lapTimes) : 0;
    e.laps.innerHTML =
      sim.lapTimes.map((t, i) => `<div class="${t === best ? 'best' : ''}">${i + 1}랩 ${t.toFixed(2)}</div>`).join('') +
      (sim.state === 'run' ? `<div>${lapNo}랩 ${(sim.t - sim.lapStartT).toFixed(1)}</div>` : '');
    e.ffl.textContent = `×${this.fast}`;
    e.caml.textContent = ['추적', '전경', '탑승'][this.camMode];
    if (this.rivalTrace.length && this.phase === 'race') {
      const i = Math.min(this.rivalTrace.length - 1, this.stepCount);
      const gap = this.rivalTrace[i] - sim.sTot;
      e.gap.textContent = `🆚 ${Math.abs(gap).toFixed(1)}m ${gap > 0 ? '앞서감' : '뒤처짐'}`;
    }
    this.audio.motor(sim.v, this.phase === 'race' && sim.state === 'run');
  }

  private layout() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.phase === 'garage') {
      const l = this.ui.querySelector('.mc-left')?.getBoundingClientRect();
      const r = this.ui.querySelector('.mc-right')?.getBoundingClientRect();
      const root = this.container.getBoundingClientRect();
      if (l && r) {
        let fx = 0.5, fy = 0.5;
        if (w / h >= 1) {
          fx = (l.right - root.left + (r.left - root.left)) / 2 / w;
          fy = 0.55;
        } else {
          fy = (l.bottom - root.top + (r.top - root.top)) / 2 / h;
        }
        this.camera.setViewOffset(w, h, Math.round(w / 2 - fx * w), Math.round(h / 2 - fy * h), w, h);
      }
    }
  }

  // ------------------------------------------------------------ input
  private key(e: KeyboardEvent) {
    if (this.ended || this.paused || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'KeyC') this.cycleCam();
    else if (e.code === 'KeyF') this.cycleFast();
    else if (e.code === 'KeyP') this.cheer();
    else if (this.phase === 'garage') {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.startRace();
      } else if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5)) - 1;
        if (n >= 0 && n < SLOTS.length) this.selectTab(n);
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const sl = SLOTS[this.tab];
        const n = sl.parts.length;
        this.pick(this.tab, (this.setup[sl.key] + (e.code === 'ArrowRight' ? 1 : n - 1)) % n);
      } else if (e.code === 'ArrowUp') this.selectTab((this.tab + SLOTS.length - 1) % SLOTS.length);
      else if (e.code === 'ArrowDown') this.selectTab((this.tab + 1) % SLOTS.length);
    }
  }

  // ------------------------------------------------------------ loop
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      this.acc += dt * (this.phase === 'race' ? this.fast : 1);
      let n = 0;
      while (this.acc >= STEP && n++ < 40) {
        this.step(STEP);
        this.acc -= STEP;
      }
      if (this.acc > STEP * 40) this.acc = 0;
    }
    this.updateCamera(dt);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
  };

  setPaused(p: boolean) {
    this.paused = p;
    this.lastFrame = performance.now();
    this.audio.suspend(p);
  }
  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  private disposeObj(o: THREE.Object3D) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    window.removeEventListener('keydown', this.onKey);
    this.audio.dispose();
    this.ui.remove();
    this.styleEl.remove();
    this.disposeObj(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** headless helper for tests */
  simulate(setup: Setup) {
    return simulateRace(setup, this.level);
  }
}

