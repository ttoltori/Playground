import { escapeHtml, fmtTime } from './games/forklift/hud';
import { isTouchDevice } from './games/forklift/input';
import { submitGameScore, topGameScores } from './platform/leaderboard';
import type { MiniGame, MiniGameDef, MiniGameResult } from './platform/minigame';
import { FORKLIFT_COLORS, loadProfile, saveProfile } from './platform/profile';

// every src/games/<id>/def.ts that exports `def` shows up in the hub automatically
const mods = import.meta.glob<{ def: MiniGameDef }>('./games/*/def.ts', { eager: true });
export const MINIGAMES: MiniGameDef[] = Object.values(mods)
  .map((m) => m.def)
  .filter(Boolean)
  .sort((a, b) => a.order - b.order);

const app = document.getElementById('app')!;
const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = app) => root.querySelector(sel) as T;
let current: MiniGame | null = null;
let muted = false;
const selected = new Map<string, number>();

export function showMiniMenu(def: MiniGameDef, back: () => void) {
  current?.dispose();
  current = null;
  const profile = loadProfile();
  let level = selected.get(def.id) ?? 1;
  app.innerHTML = `<div class="screen"><div class="menu">
    <div class="menu-head"><button class="back" id="back">←</button><div class="title">${def.emoji} <b>${escapeHtml(def.name)}</b></div></div>
    <div class="menu-grid">
      <section class="panel">
        <h3>🧑‍🔧 기사 등록</h3>
        <input id="nick" maxlength="16" placeholder="닉네임 (최대 16자)" value="${escapeHtml(profile.nickname)}" />
        <div class="colors">${FORKLIFT_COLORS.map((c) => `<button class="color ${c === profile.color ? 'on' : ''}" data-c="${c}" style="background:${css(c)}"></button>`).join('')}</div>
        <h3>📈 난이도</h3>
        <div class="levels">${def.levels.map((l, i) => `
          <button class="level" data-l="${i + 1}"><span class="lv">LV.${i + 1}</span><b>${l.name}</b><em>${l.title}</em>
          <small>${l.desc}</small><span class="medals">🥇 ${l.medals[0]}s · 🥈 ${l.medals[1]}s · 🥉 ${l.medals[2]}s</span></button>`).join('')}
        </div>
        <button class="big-btn" id="start">출근하기 ▶</button>
      </section>
      <section class="panel">
        <h3>🏆 리더보드 <span class="lb-level" id="lb-level"></span></h3>
        <div id="lb" class="lb">불러오는 중...</div>
        <details class="howto" ${isTouchDevice() ? '' : 'open'}><summary>🕹️ 조작법 & 꿀팁</summary><ul class="tips">${def.howto.map((h) => `<li>${h}</li>`).join('')}</ul></details>
      </section>
    </div></div></div>`;
  $('#back').onclick = back;
  const nick = $<HTMLInputElement>('#nick');
  nick.oninput = () => {
    profile.nickname = nick.value.trim().slice(0, 16);
    saveProfile(profile);
  };
  app.querySelectorAll<HTMLButtonElement>('.color').forEach((b) => (b.onclick = () => {
    profile.color = Number(b.dataset.c);
    saveProfile(profile);
    app.querySelectorAll('.color').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const refresh = () => {
    app.querySelectorAll<HTMLButtonElement>('.level').forEach((b) => b.classList.toggle('on', Number(b.dataset.l) === level));
    loadBoard(def, level, profile.id);
  };
  app.querySelectorAll<HTMLButtonElement>('.level').forEach((b) => (b.onclick = () => {
    level = Number(b.dataset.l);
    selected.set(def.id, level);
    refresh();
  }));
  refresh();
  $('#start').onclick = () => {
    if (!profile.nickname) {
      nick.focus();
      nick.classList.add('shake');
      setTimeout(() => nick.classList.remove('shake'), 500);
      return;
    }
    startMini(def, level, back);
  };
}

async function loadBoard(def: MiniGameDef, level: number, myId: string) {
  const el = document.getElementById('lb');
  const lv = document.getElementById('lb-level');
  if (!el) return;
  if (lv) lv.textContent = `LV.${level} ${def.levels[level - 1].name}`;
  const { rows, remote } = await topGameScores(def.id, level, 15);
  if (!document.getElementById('lb')) return;
  el.innerHTML = rows.length ? `<table><tbody>${rows.map((r, i) => `
    <tr class="${r.client_id === myId ? 'me' : ''}"><td class="rk">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
    <td class="nm">${escapeHtml(r.nickname)}</td><td class="tm">${fmtTime(r.time_ms / 1000)}</td></tr>`).join('')}</tbody></table>
    <div class="lb-src">${remote ? '🌐 전체 랭킹' : '📱 이 기기 기록'}</div>` : `<div class="lb-empty">아직 기록이 없습니다. 첫 번째 전설이 되어라.</div>`;
}

export function startMini(def: MiniGameDef, level: number, back: () => void) {
  const profile = loadProfile();
  current?.dispose();
  app.innerHTML = `<div class="game-root" id="game-root"><div class="game-menu">
    <button id="pause" title="일시정지">⏸</button><button id="mute" title="소리">${muted ? '🔇' : '🔊'}</button></div></div>`;
  const root = $('#game-root');
  const game = def.create({
    container: root, level, nickname: profile.nickname || '기사님', color: profile.color,
    onEnd: (r) => {
      if (current !== game) return;
      game.dispose();
      current = null;
      showMiniResult(def, level, r, back);
    },
  });
  current = game;
  game.setMuted(muted);
  if (import.meta.env.DEV) (window as unknown as { __game: unknown }).__game = game;
  $('#mute').onclick = () => {
    muted = !muted;
    game.setMuted(muted);
    $('#mute').textContent = muted ? '🔇' : '🔊';
  };
  const pause = () => {
    if (current !== game || root.querySelector('.pause')) return;
    game.setPaused(true);
    const d = document.createElement('div');
    d.className = 'pause';
    d.innerHTML = `<div class="pause-box"><h2>⏸ 일시정지</h2><button class="big-btn" id="resume">계속하기</button>
      <button class="big-btn ghost" id="restart">처음부터</button><button class="big-btn ghost" id="quit">그만두기</button></div>`;
    root.appendChild(d);
    $('#resume', d).onclick = () => {
      d.remove();
      game.setPaused(false);
    };
    $('#restart', d).onclick = () => startMini(def, level, back);
    $('#quit', d).onclick = () => showMiniMenu(def, back);
  };
  $('#pause').onclick = pause;
  const onKey = (e: KeyboardEvent) => {
    if (current !== game) return window.removeEventListener('keydown', onKey);
    if (e.code === 'Escape') pause();
  };
  window.addEventListener('keydown', onKey);
}

async function showMiniResult(def: MiniGameDef, level: number, r: MiniGameResult, back: () => void) {
  const profile = loadProfile();
  const lv = def.levels[level - 1];
  const t = r.timeMs / 1000;
  const medal = t <= lv.medals[0] ? '🥇' : t <= lv.medals[1] ? '🥈' : t <= lv.medals[2] ? '🥉' : '🎖️';
  app.innerHTML = `<div class="screen"><div class="menu narrow result">
    <div class="res-title">${escapeHtml(r.title ?? '퇴근 완료!')}</div>
    <div class="res-sub">${def.emoji} ${escapeHtml(def.name)} · LV.${level} ${lv.name}</div>
    <div class="res-cards"><div class="res-card winner" style="--pc:${css(profile.color)}">
      <div class="res-name">${escapeHtml(profile.nickname)}</div>
      <div class="res-final">${medal} ${fmtTime(t)}</div>
      ${r.detail.map((d) => `<div class="sr"><span>${escapeHtml(d.label)}</span><b>${escapeHtml(d.value)}</b></div>`).join('')}
    </div></div>
    <div id="submit-status" class="hint">리더보드 등록 중...</div>
    <div class="row"><button class="big-btn" id="again">한 판 더</button>
      ${level < def.levels.length ? '<button class="big-btn ghost" id="next">다음 레벨 ▶</button>' : ''}
      <button class="big-btn ghost" id="menu">메뉴</button></div></div></div>`;
  $('#again').onclick = () => startMini(def, level, back);
  $('#menu').onclick = () => showMiniMenu(def, back);
  const next = document.getElementById('next');
  if (next) next.onclick = () => {
    selected.set(def.id, level + 1);
    startMini(def, level + 1, back);
  };
  const res = await submitGameScore({ game: def.id, nickname: profile.nickname, level, time_ms: Math.round(r.timeMs), client_id: profile.id });
  const { rows } = await topGameScores(def.id, level, 100);
  const rank = rows.findIndex((x) => x.nickname.toLowerCase() === profile.nickname.toLowerCase()) + 1;
  const el = document.getElementById('submit-status');
  if (el) el.textContent = res.ok ? `${res.remote ? '🌐 전체' : '📱 기기'} 랭킹 ${rank > 0 ? rank + '위' : '-'} (개인 최고기록 기준)` : `등록 실패: ${res.error}`;
}
