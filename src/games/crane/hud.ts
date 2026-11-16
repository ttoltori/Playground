import { escapeHtml, fmtTime } from '../forklift/hud';

export interface HudData {
  time: number;
  delivered: number;
  total: number;
  penalty: number;
  bonus: number;
  hookH: number; // hook height above the surface under it
  hookVy: number;
  radius: number;
  cable: number;
  moment: number; // 0..1+
  loadMass: number; // 0 = nothing carried
  wind: number;
  windAngle: number; // radians, direction wind blows toward (world)
  jibAngle: number;
  swingX: number; // load offset from trolley (m), right/forward in screen frame
  swingY: number;
  swingSpeed: number;
  guide: string;
  guideKind: 'info' | 'ok' | 'warn';
  camLabel: string;
  overload: boolean;
  canAttach: boolean;
  fragile: boolean;
}

export interface RadarData {
  theta: number;
  r: number;
  jibLen: number;
  hook: [number, number];
  loads: { x: number; z: number; c: string; carried: boolean; done: boolean }[];
  pads: { x: number; z: number; c: string; active: boolean }[];
  workers: [number, number][];
  blocks: { x: number; z: number; w: number; d: number; building: boolean }[];
}

export const HUD_CSS = `
.cr-hud{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-weight:700;text-shadow:0 2px 4px #000c;color:#fff}
.cr-top{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(10px,env(safe-area-inset-left));display:flex;gap:12px;align-items:center;flex-wrap:nowrap;white-space:nowrap}
.cr-chip{background:var(--accent);color:#000;text-shadow:none;padding:2px 10px;border-radius:8px;font-size:13px}
.cr-time{font-family:ui-monospace,monospace;font-size:30px}
.cr-del{font-size:20px}
.cr-pen{font-size:13px;color:#ff9a9a}
.cr-pen b{color:#8dffa6}
.cr-guide{position:absolute;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);background:#000b;border:2px solid #fff3;padding:6px 14px;border-radius:12px;font-size:15px;text-align:center;max-width:min(46%,520px);transition:border-color .2s}
.cr-guide.ok{border-color:#58f08a;color:#b6ffca}
.cr-guide.warn{border-color:#ff5a5a;color:#ffd0d0}
.cr-gauges{position:absolute;top:calc(max(8px,env(safe-area-inset-top)) + 52px);left:max(10px,env(safe-area-inset-left));display:flex;flex-direction:column;gap:5px}
.cr-g{background:#000a;border-radius:9px;padding:3px 10px;font-size:12px;display:flex;gap:7px;align-items:baseline;min-width:132px}
.cr-g i{font-style:normal;color:#ffffffb0;font-size:11px;width:44px}
.cr-g b{font-family:ui-monospace,monospace;font-size:17px;margin-left:auto}
.cr-g u{text-decoration:none;color:#ffffff90;font-size:10px;width:28px}
.cr-g.wind b{font-size:15px}
.cr-arrow{display:inline-block;transition:transform .2s;font-size:17px}
.cr-radar{position:absolute;top:calc(max(8px,env(safe-area-inset-top)) + 48px);right:max(10px,env(safe-area-inset-right));width:116px;height:116px;border-radius:12px;background:#000a;border:2px solid #fff2}
.cr-bottom{position:absolute;bottom:max(10px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:flex-end}
.cr-scope{width:104px;height:104px;border-radius:50%;background:#000a}
.cr-mom{background:#000a;border-radius:10px;padding:6px 10px;width:150px;font-size:12px;text-align:center}
.cr-mbar{height:12px;border-radius:6px;background:#ffffff22;overflow:hidden;margin-top:4px}
.cr-mbar i{display:block;height:100%;width:0;background:#58f08a;transition:background .2s}
.cr-mom.hot .cr-mbar i{background:#ff5a5a}
.cr-mom.warn .cr-mbar i{background:#ffc83a}
.cr-alarm{position:absolute;top:34%;left:50%;transform:translateX(-50%);background:#e22;color:#fff;padding:8px 18px;border-radius:10px;font-size:20px;opacity:0;animation:crblink .3s infinite alternate;text-align:center}
.cr-alarm.on{opacity:1}
.cr-toasts{position:absolute;top:calc(max(8px,env(safe-area-inset-top)) + 54px);left:50%;transform:translateX(-50%);width:min(92%,500px);display:flex;flex-direction:column;gap:6px;align-items:center}
.cr-toast{background:#000b;padding:7px 13px;border-radius:12px;font-size:14px;text-align:center;animation:crtin .25s;transition:opacity .5s,transform .5s}
.cr-toast.good{color:#8dffa6}.cr-toast.bad{color:#ff9a9a}.cr-toast.radio{color:#ffe9a8;font-weight:400;font-style:italic;border-left:3px solid var(--accent)}
.cr-toast.out{opacity:0;transform:translateY(-10px)}
.cr-center{position:absolute;top:38%;left:0;right:0;text-align:center;font-family:'Black Han Sans',sans-serif;font-size:90px;transform:translateY(-50%)}
.cr-center.go{color:var(--accent)}
.cr-center.small{font-size:34px}
.cr-hint{position:absolute;left:max(10px,env(safe-area-inset-left));bottom:max(10px,env(safe-area-inset-bottom));font-size:11px;font-weight:500;color:#ffffffa0;background:#0006;padding:4px 8px;border-radius:8px;max-width:30%}
.cr-cab{position:absolute;inset:0;display:none;box-shadow:inset 0 0 110px 30px #000b;border-top:14px solid #14161a;border-bottom:26px solid #14161a}
.cr-hud.cabview .cr-cab{display:block}
.cr-camlabel{position:absolute;bottom:max(10px,env(safe-area-inset-bottom));left:50%;margin-left:-190px;font-size:11px;background:#0008;padding:3px 8px;border-radius:8px}
.cr-hud.fragile::after{content:'🪟 깨짐주의 화물';position:absolute;top:calc(max(8px,env(safe-area-inset-top)) + 28px);left:50%;transform:translateX(-50%);color:#ffb3b3;font-size:12px}
.cr-hud.touchui .cr-hint{display:none}
.cr-hud.touchui .cr-camlabel{display:none}
@keyframes crblink{from{filter:brightness(1)}to{filter:brightness(1.6)}}
@keyframes crtin{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@keyframes crpulse{from{box-shadow:0 0 0 0 #58f08a}to{box-shadow:0 0 0 8px #58f08a00}}
@media (max-height:520px){
  .cr-time{font-size:22px}.cr-del{font-size:15px}
  .cr-top{gap:8px}
  .cr-guide{font-size:12px;padding:4px 10px;top:calc(max(6px,env(safe-area-inset-top)) + 34px);max-width:44%}
  .cr-gauges{top:calc(max(6px,env(safe-area-inset-top)) + 40px);gap:3px}
  .cr-g{min-width:106px;padding:2px 8px;font-size:11px}.cr-g b{font-size:14px}.cr-g i{width:36px}
  .cr-radar{width:92px;height:92px;top:calc(max(6px,env(safe-area-inset-top)) + 46px)}
  .cr-scope{width:80px;height:80px}
  .cr-mom{width:116px;font-size:10px;padding:4px 8px}
  .cr-toasts{top:calc(max(6px,env(safe-area-inset-top)) + 76px)}
  .cr-toast{font-size:12px;padding:5px 10px}
  .cr-center{font-size:60px}
  .cr-alarm{font-size:15px;top:30%}
}
`;

export class Hud {
  root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private scope: HTMLCanvasElement;
  private radar: HTMLCanvasElement;
  private toastBox: HTMLDivElement;
  private lastDraw = 0;
  private timers: number[] = [];

  constructor(parent: HTMLElement, name: string, accentCss: string, touch: boolean) {
    const r = document.createElement('div');
    r.className = 'cr-hud' + (touch ? ' touchui' : '');
    r.style.setProperty('--accent', accentCss);
    r.innerHTML = `
      <div class="cr-cab"></div>
      <div class="cr-top">
        <span class="cr-chip">🏗️ ${escapeHtml(name)}</span>
        <span class="cr-time" data-k="time">0:00.0</span>
        <span class="cr-del" data-k="del">📦 0/0</span>
        <span class="cr-pen" data-k="pen"></span>
      </div>
      <div class="cr-guide" data-k="guide"></div>
      <div class="cr-gauges">
        <div class="cr-g"><i>훅 높이</i><b data-k="h">0</b><u>m</u></div>
        <div class="cr-g"><i>반경</i><b data-k="rad">0</b><u>m</u></div>
        <div class="cr-g"><i>케이블</i><b data-k="cab">0</b><u>m</u></div>
        <div class="cr-g wind"><i>바람</i><b data-k="wind">0</b><u><span class="cr-arrow" data-k="warrow">➤</span></u></div>
      </div>
      <canvas class="cr-radar" width="232" height="232"></canvas>
      <div class="cr-bottom">
        <canvas class="cr-scope" width="208" height="208"></canvas>
        <div class="cr-mom" data-k="mom"><span data-k="mtxt">하중모멘트 0%</span><div class="cr-mbar"><i data-k="mbar"></i></div></div>
      </div>
      <div class="cr-alarm" data-k="alarm">⚠ 과부하! 트롤리를 안쪽으로</div>
      <div class="cr-toasts"></div>
      <div class="cr-center" data-k="center"></div>
      <div class="cr-hint">A/D 선회 · W/S 트롤리 · R/F 호이스트 · Space 걸기/풀기 · C 시점</div>
      <div class="cr-camlabel" data-k="camlabel"></div>`;
    parent.appendChild(r);
    this.root = r;
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    this.scope = r.querySelector('.cr-scope')!;
    this.radar = r.querySelector('.cr-radar')!;
    this.toastBox = r.querySelector('.cr-toasts')!;
  }

  update(d: HudData, cab: boolean) {
    this.el.time.textContent = fmtTime(d.time);
    this.el.del.textContent = `📦 ${d.delivered}/${d.total}`;
    this.el.pen.innerHTML = (d.penalty > 0 ? `사고 +${d.penalty.toFixed(0)}s ` : '') + (d.bonus > 0 ? `<b>정밀 -${d.bonus.toFixed(0)}s</b>` : '');
    this.el.h.textContent = d.hookH.toFixed(1);
    this.el.h.style.color = d.hookVy < -2.3 && d.hookH < 6 ? '#ff9a9a' : '';
    this.el.rad.textContent = d.radius.toFixed(1);
    this.el.cab.textContent = d.cable.toFixed(1);
    this.el.wind.textContent = d.wind.toFixed(1);
    (this.el.warrow as HTMLElement).style.transform = `rotate(${(d.windAngle - d.jibAngle - Math.PI / 2) * 1}rad)`;
    const pct = Math.round(d.moment * 100);
    this.el.mtxt.textContent = d.loadMass > 0 ? `하중모멘트 ${pct}% · ${d.loadMass.toFixed(1)}t` : '하중모멘트 — (무부하)';
    (this.el.mbar as HTMLElement).style.width = `${Math.min(100, pct)}%`;
    this.el.mom.className = 'cr-mom' + (pct >= 100 ? ' hot' : pct >= 85 ? ' warn' : '');
    this.el.alarm.classList.toggle('on', d.overload);
    this.el.guide.textContent = d.guide;
    this.el.guide.className = 'cr-guide ' + (d.guideKind === 'info' ? '' : d.guideKind);
    this.el.camlabel.textContent = `🎥 ${d.camLabel}`;
    this.root.classList.toggle('cabview', cab);
    this.root.classList.toggle('fragile', d.fragile);
    this.drawScope(d);
  }

  private drawScope(d: HudData) {
    const g = this.scope.getContext('2d')!;
    const W = this.scope.width;
    const c = W / 2;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(0,0,0,0.0)';
    g.strokeStyle = '#ffffff55';
    g.lineWidth = 2;
    const S = c / 5; // 5 m = full radius
    for (const rr of [1, 3, 5]) {
      g.beginPath();
      g.arc(c, c, rr * S - 2, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c, 6); g.lineTo(c, W - 6); g.moveTo(6, c); g.lineTo(W - 6, c);
    g.stroke();
    const px = c + Math.max(-5, Math.min(5, d.swingX)) * S;
    const py = c - Math.max(-5, Math.min(5, d.swingY)) * S;
    const calm = d.swingSpeed < 0.5 && Math.hypot(d.swingX, d.swingY) < 1.2;
    g.fillStyle = calm ? '#58f08a' : d.swingSpeed > 2 ? '#ff5a5a' : '#ffc83a';
    g.beginPath();
    g.arc(px, py, 11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#fff';
    g.font = 'bold 20px sans-serif';
    g.textAlign = 'center';
    g.fillText('흔들림', c, W - 14);
    g.font = 'bold 22px sans-serif';
    g.fillText(`${Math.hypot(d.swingX, d.swingY).toFixed(1)}m`, c, 28);
    g.textAlign = 'left';
  }

  drawRadar(d: RadarData, now: number) {
    if (now - this.lastDraw < 90) return;
    this.lastDraw = now;
    const g = this.radar.getContext('2d')!;
    const W = this.radar.width;
    const c = W / 2;
    const sc = (W / 2 - 6) / 42; // px per meter
    g.clearRect(0, 0, W, W);
    g.save();
    g.translate(c, c);
    g.strokeStyle = '#ffffff22';
    g.lineWidth = 1;
    for (const rr of [10, 20, 30, 40]) {
      g.beginPath();
      g.arc(0, 0, rr * sc, 0, Math.PI * 2);
      g.stroke();
    }
    for (const b of d.blocks) {
      g.fillStyle = b.building ? '#8d8d88' : '#c4521c';
      g.fillRect((b.x - b.w / 2) * sc, (b.z - b.d / 2) * sc, b.w * sc, b.d * sc);
    }
    for (const p of d.pads) {
      g.strokeStyle = p.c;
      g.lineWidth = p.active ? 4 : 2;
      g.globalAlpha = p.active ? 1 : 0.6;
      g.beginPath();
      g.arc(p.x * sc, p.z * sc, p.active ? 7 : 5, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    for (const l of d.loads) {
      if (l.done) continue;
      g.fillStyle = l.c;
      g.fillRect(l.x * sc - 4, l.z * sc - 4, 8, 8);
      if (l.carried) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.strokeRect(l.x * sc - 6, l.z * sc - 6, 12, 12);
      }
    }
    g.fillStyle = '#ffdd33';
    for (const w of d.workers) {
      g.beginPath();
      g.arc(w[0] * sc, w[1] * sc, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    // jib
    g.strokeStyle = '#ffcc33';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-Math.cos(d.theta) * 13 * sc, -Math.sin(d.theta) * 13 * sc);
    g.lineTo(Math.cos(d.theta) * d.jibLen * sc, Math.sin(d.theta) * d.jibLen * sc);
    g.stroke();
    g.fillStyle = '#fff';
    g.fillRect(Math.cos(d.theta) * d.r * sc - 3, Math.sin(d.theta) * d.r * sc - 3, 6, 6);
    g.strokeStyle = '#ff4040';
    g.lineWidth = 2;
    g.beginPath();
    const hx = d.hook[0] * sc;
    const hz = d.hook[1] * sc;
    g.moveTo(hx - 5, hz); g.lineTo(hx + 5, hz); g.moveTo(hx, hz - 5); g.lineTo(hx, hz + 5);
    g.stroke();
    g.restore();
  }

  center(text: string, cls = '') {
    this.el.center.textContent = text;
    this.el.center.className = 'cr-center ' + cls;
  }

  toast(text: string, kind: 'good' | 'bad' | 'info' | 'radio' = 'info') {
    const t = document.createElement('div');
    t.className = `cr-toast ${kind}`;
    t.textContent = text;
    this.toastBox.appendChild(t);
    while (this.toastBox.children.length > 3) this.toastBox.firstChild?.remove();
    this.timers.push(window.setTimeout(() => t.classList.add('out'), 3200), window.setTimeout(() => t.remove(), 3800));
  }

  setHint(html: string) {
    const h = this.root.querySelector('.cr-hint');
    if (h) h.innerHTML = html;
  }

  dispose() {
    this.timers.forEach((t) => clearTimeout(t));
    this.root.remove();
  }
}
