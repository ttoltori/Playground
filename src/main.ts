import './style.css';
import { Game, type GameMode, type GameResult, type PlayerSpec } from './games/forklift/game';
import { fmtTime, escapeHtml } from './games/forklift/hud';
import { isTouchDevice } from './games/forklift/input';
import { LEVELS, STYLE_PER_SECOND, type LevelDef } from './games/forklift/levels';
import { OnlineRoom, type PeerInfo } from './games/forklift/online';
import { submitScore, topScores } from './platform/leaderboard';
import { FORKLIFT_COLORS, loadProfile, saveProfile } from './platform/profile';
import { isOnline } from './platform/supabase';

const app = document.getElementById('app')!;
const profile = loadProfile();
let game: Game | null = null;
let room: OnlineRoom | null = null;
let muted = false;

const css = (c: number) => '#' + c.toString(16).padStart(6, '0');
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = app) => root.querySelector(sel) as T;

function screen(html: string) {
  app.innerHTML = `<div class="screen">${html}</div>`;
}

// ------------------------------------------------------------------ lobby (playground hub)
function showHub() {
  leaveRoom();
  screen(`
    <header class="hub-head">
      <div class="logo">PLAYGROUND<span>어른이 놀이터</span></div>
      <div class="hub-sub">퇴근 후 10분, 남자들의 장난감 상자</div>
    </header>
    <div class="cards">
      <button class="card hot" id="go-forklift">
        <div class="card-emoji">🚜</div>
        <div class="card-title">지게차 러시</div>
        <div class="card-desc">창고에서 창고로. 팔레트 들고 밟아라. 타임어택 & 1:1 들이받기 대전</div>
        <div class="card-tag">PLAY NOW</div>
      </button>
      <div class="card soon"><div class="card-emoji">🏗️</div><div class="card-title">타워크레인 인형뽑기</div><div class="card-desc">30m 위에서 컨테이너 뽑기</div><div class="card-tag">COMING SOON</div></div>
      <div class="card soon"><div class="card-emoji">🚧</div><div class="card-title">포크레인 볼링</div><div class="card-desc">버킷으로 드럼통 스트라이크</div><div class="card-tag">COMING SOON</div></div>
      <div class="card soon"><div class="card-emoji">🚛</div><div class="card-title">덤프트럭 후진주차</div><div class="card-desc">사이드미러 하나로 1cm 주차</div><div class="card-tag">COMING SOON</div></div>
    </div>
    <footer class="foot">${isOnline() ? '🟢 온라인 연결됨 (리더보드 · 온라인 대전)' : '🟡 오프라인 모드 — 기록은 이 기기에만 저장됩니다'}</footer>
  `);
  $('#go-forklift').onclick = () => showForkliftMenu();
}

// ------------------------------------------------------------------ forklift menu
let selectedLevel = 1;
let selectedMode: GameMode = 'solo';

function showForkliftMenu() {
  leaveRoom();
  const touch = isTouchDevice();
  screen(`
    <div class="menu">
      <div class="menu-head">
        <button class="back" id="back">←</button>
        <div class="title">FORKLIFT <b>RUSH</b><small>지게차 러시</small></div>
      </div>
      <div class="menu-grid">
        <section class="panel">
          <h3>🧑‍🔧 기사 등록</h3>
          <input id="nick" maxlength="16" placeholder="닉네임 (최대 16자)" value="${escapeHtml(profile.nickname)}" />
          <div class="colors">${FORKLIFT_COLORS.map((c) => `<button class="color ${c === profile.color ? 'on' : ''}" data-c="${c}" style="background:${css(c)}"></button>`).join('')}</div>

          <h3>🎮 모드</h3>
          <div class="modes">
            <button class="mode" data-m="solo">⏱️ 1인 타임어택<small>기록 경신 & 리더보드</small></button>
            <button class="mode" data-m="local2p" ${touch ? 'disabled' : ''}>👥 2인 로컬 대전<small>${touch ? 'PC 키보드/패드 전용' : '한 화면 분할 · 들이받기 허용'}</small></button>
            <button class="mode" data-m="online">🌐 2인 온라인 대전<small>${isOnline() ? '방 코드로 친구와 대결' : 'Supabase 설정 필요'}</small></button>
          </div>

          <h3>📈 난이도</h3>
          <div class="levels">${LEVELS.map((l) => `
            <button class="level" data-l="${l.id}">
              <span class="lv">LV.${l.id}</span><b>${l.name}</b><em>${l.title}</em>
              <small>${l.desc}</small>
              <span class="medals">🥇 ${l.medals[0]}s · 🥈 ${l.medals[1]}s · 🥉 ${l.medals[2]}s</span>
            </button>`).join('')}
          </div>
          <button class="big-btn" id="start">출근하기 ▶</button>
        </section>

        <section class="panel">
          <h3>🏆 리더보드 <span class="lb-level" id="lb-level"></span></h3>
          <div id="lb" class="lb">불러오는 중...</div>
          <details class="howto" ${touch ? '' : 'open'}>
            <summary>🕹️ 조작법 & 꿀팁</summary>
            <div class="keys">
              <div><b>1인</b> W/A/S/D·방향키 주행 · R/E 포크↑ · F/Q 포크↓ · Shift 터보 · Space 드리프트 · C 시점 · H 경적</div>
              <div><b>2P-좌</b> WASD · R/F 포크 · Shift 터보 · Space 드리프트 · C 시점</div>
              <div><b>2P-우</b> 방향키 · . / , 포크 · 우Shift 터보 · / 드리프트 · M 시점</div>
              <div><b>모바일</b> 왼쪽 드래그 주행 · 오른쪽 버튼 (가로 모드 추천)</div>
              <div><b>패드</b> RT/LT 가감속 · 스틱 조향 · 십자 ↑↓ 포크 · A 드리프트 · B 터보 · Y 시점</div>
            </div>
            <ul class="tips">
              <li>포크를 바닥까지 내리고 팔레트에 <b>정면으로</b> 꽂은 뒤 들어올리면 픽업.</li>
              <li><b>초록 DROP</b> 구역에 내려놓으면 입고. 중앙에 칼각이면 보너스!</li>
              <li><b>분홍 DROP</b>은 트럭 상차 — 포크를 1.2m 이상 들고 짐칸에 밀어넣은 후 내려라.</li>
              <li>지게차는 <b>뒷바퀴 조향</b>. 꼬리가 크게 돈다. 랙에 엉덩이 조심.</li>
              <li>짐 높이 들고 급커브 = 전복 위험. 🥃 위스키는 살짝만 부딪혀도 박살 (+15s).</li>
              <li>가운데 🔥JUMP 램프 — 터보로 컨테이너 사이 화물더미를 뛰어넘는 지름길.</li>
              <li>드리프트·에어타임·니어미스·칼각 = STYLE 점수 → ${STYLE_PER_SECOND}점당 1초 단축.</li>
            </ul>
          </details>
        </section>
      </div>
    </div>
  `);
  $('#back').onclick = showHub;
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
  const refreshSel = () => {
    app.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => b.classList.toggle('on', b.dataset.m === selectedMode));
    app.querySelectorAll<HTMLButtonElement>('.level').forEach((b) => b.classList.toggle('on', Number(b.dataset.l) === selectedLevel));
    $('#start').textContent = selectedMode === 'online' ? '대전방 입장 ▶' : '출근하기 ▶';
  };
  if (touch && selectedMode === 'local2p') selectedMode = 'solo';
  app.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => (b.onclick = () => {
    selectedMode = b.dataset.m as GameMode;
    refreshSel();
  }));
  app.querySelectorAll<HTMLButtonElement>('.level').forEach((b) => (b.onclick = () => {
    selectedLevel = Number(b.dataset.l);
    refreshSel();
    loadLeaderboard(selectedLevel);
  }));
  refreshSel();
  loadLeaderboard(selectedLevel);
  $('#start').onclick = () => {
    if (!profile.nickname) {
      nick.focus();
      nick.classList.add('shake');
      setTimeout(() => nick.classList.remove('shake'), 500);
      return;
    }
    const level = LEVELS[selectedLevel - 1];
    if (selectedMode === 'online') return showOnlineLobby();
    const players: PlayerSpec[] = [{ name: profile.nickname, color: profile.color }];
    if (selectedMode === 'local2p') {
      const c2 = FORKLIFT_COLORS.find((c) => c !== profile.color) ?? 0xff5a1f;
      players.push({ name: '2P', color: c2 });
    }
    startGame(selectedMode, level, Math.floor(Math.random() * 1e9), players);
  };
}

async function loadLeaderboard(level: number) {
  const el = document.getElementById('lb');
  const lv = document.getElementById('lb-level');
  if (!el) return;
  if (lv) lv.textContent = `LV.${level} ${LEVELS[level - 1].name}`;
  el.textContent = '불러오는 중...';
  const { rows, remote } = await topScores(level, 15);
  if (!document.getElementById('lb')) return;
  if (!rows.length) {
    el.innerHTML = `<div class="lb-empty">아직 기록이 없습니다. 첫 번째 전설이 되어라.</div>`;
    return;
  }
  el.innerHTML = `
    <table><tbody>${rows.map((r, i) => `
      <tr class="${r.client_id === profile.id ? 'me' : ''}">
        <td class="rk">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
        <td class="nm">${escapeHtml(r.nickname)}</td>
        <td class="tm">${fmtTime(r.time_ms / 1000)}</td>
        <td class="st">★${r.style}</td>
      </tr>`).join('')}
    </tbody></table>
    <div class="lb-src">${remote ? '🌐 전체 랭킹' : '📱 이 기기 기록'}</div>`;
}

// ------------------------------------------------------------------ online lobby
function leaveRoom() {
  if (room) {
    room.leave();
    room = null;
  }
}

function showOnlineLobby() {
  if (!isOnline()) {
    screen(`<div class="menu narrow"><div class="menu-head"><button class="back" id="back">←</button><div class="title">ONLINE</div></div>
      <section class="panel"><h3>⚠️ 온라인 대전 준비 안 됨</h3><p>Vercel 환경변수 <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code> 를 설정하면 열립니다. README 참고.</p></section></div>`);
    $('#back').onclick = showForkliftMenu;
    return;
  }
  screen(`
    <div class="menu narrow">
      <div class="menu-head"><button class="back" id="back">←</button><div class="title">1:1 <b>대전방</b></div></div>
      <section class="panel">
        <h3>방 만들기</h3>
        <button class="big-btn" id="create">새 방 만들기</button>
        <h3>방 참가</h3>
        <div class="row"><input id="code" maxlength="4" placeholder="방 코드 4자리" style="text-transform:uppercase" /><button class="big-btn small" id="join">참가</button></div>
        <p class="hint">친구에게 방 코드를 보내세요. 같은 맵, 같은 장애물, 같은 팔레트 — 먼저 과반수를 입고하는 쪽이 승리. 들이받아서 상대 화물을 떨궈도 됩니다 😈</p>
        <div id="room-status"></div>
      </section>
    </div>`);
  $('#back').onclick = showForkliftMenu;
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $<HTMLInputElement>('#code').value = params.get('room')!.toUpperCase();
  $('#create').onclick = () => enterRoom(OnlineRoom.newCode());
  $('#join').onclick = () => {
    const code = $<HTMLInputElement>('#code').value.trim().toUpperCase();
    if (code.length === 4) enterRoom(code);
  };
}

async function enterRoom(code: string) {
  leaveRoom();
  const me: PeerInfo = { id: profile.id + '-' + Math.random().toString(36).slice(2, 6), name: profile.nickname, color: profile.color, joinedAt: Date.now() };
  room = new OnlineRoom(code, me);
  const status = () => document.getElementById('room-status');
  const st = status();
  if (st) st.innerHTML = '연결 중...';
  try {
    await room.connect();
  } catch (e) {
    const s = status();
    if (s) s.innerHTML = `<div class="err">${escapeHtml(String((e as Error).message))}</div>`;
    room = null;
    return;
  }
  renderRoom();
  room.onPeers = () => {
    if (game) {
      if (!room?.opponent) game.opponentLeft();
      return;
    }
    renderRoom();
  };
  room.onMsg = lobbyMsg;
}

function lobbyMsg(m: { type: string; level?: number; seed?: number }) {
  if (m.type === 'start' && room && !game) beginOnline(m.level!, m.seed!);
}

function renderRoom() {
  if (!room) return;
  const r = room;
  const link = `${location.origin}${location.pathname}?room=${r.code}`;
  screen(`
    <div class="menu narrow">
      <div class="menu-head"><button class="back" id="back">←</button><div class="title">ROOM <b>${r.code}</b></div></div>
      <section class="panel">
        <div class="room-code">${r.code}</div>
        <button class="big-btn small ghost" id="share">🔗 초대 링크 복사</button>
        <h3>참가자</h3>
        <div class="peers">${r.peers.map((p, i) => `<div class="peer"><i style="background:${css(p.color)}"></i>${escapeHtml(p.name)} ${i === 0 ? '👑' : ''} ${p.id === r.me.id ? '(나)' : ''}</div>`).join('') || '...'}</div>
        ${r.peers.length < 2 ? '<p class="hint">상대를 기다리는 중... ⏳</p>' : ''}
        ${r.isHost ? `
          <h3>난이도 (방장)</h3>
          <div class="levels compact">${LEVELS.map((l) => `<button class="level ${l.id === selectedLevel ? 'on' : ''}" data-l="${l.id}"><span class="lv">LV.${l.id}</span><b>${l.name}</b></button>`).join('')}</div>
          <button class="big-btn" id="go" ${r.peers.length < 2 ? 'disabled' : ''}>대전 시작 ▶</button>` : '<p class="hint">방장이 시작하기를 기다리는 중...</p>'}
      </section>
    </div>`);
  $('#back').onclick = () => {
    leaveRoom();
    showOnlineLobby();
  };
  $('#share').onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: '지게차 러시 1:1', text: `지게차 러시 대전방 ${r.code} 들어와!`, url: link });
      else await navigator.clipboard.writeText(link);
      $('#share').textContent = '✅ 복사됨';
    } catch {
      /* cancelled */
    }
  };
  app.querySelectorAll<HTMLButtonElement>('.level').forEach((b) => (b.onclick = () => {
    selectedLevel = Number(b.dataset.l);
    renderRoom();
  }));
  const go = document.getElementById('go');
  if (go) go.onclick = () => {
    const seed = Math.floor(Math.random() * 1e9);
    r.send({ type: 'start', level: selectedLevel, seed });
    beginOnline(selectedLevel, seed);
  };
}

function beginOnline(levelId: number, seed: number) {
  if (!room) return;
  const players: PlayerSpec[] = room.peers.map((p) => ({ name: p.name, color: p.color }));
  if (players.length < 2) return;
  if (players[0].color === players[1].color) players[1].color = FORKLIFT_COLORS.find((c) => c !== players[0].color)!;
  const localIndex = room.peers.findIndex((p) => p.id === room!.me.id);
  startGame('online', LEVELS[levelId - 1], seed, players, localIndex);
}

// ------------------------------------------------------------------ game
function startGame(mode: GameMode, level: LevelDef, seed: number, players: PlayerSpec[], localIndex = 0) {
  app.innerHTML = `<div class="game-root" id="game-root">
    <div class="game-menu">
      <button id="pause" title="일시정지">⏸</button>
      <button id="mute" title="소리">${muted ? '🔇' : '🔊'}</button>
    </div>
    ${isTouchDevice() ? '<div class="rotate-hint">📱 가로로 돌리면 더 좋아요</div>' : ''}
  </div>`;
  const root = $('#game-root');
  game?.dispose();
  game = new Game(root, {
    mode, level, seed, players, room: room ?? undefined, localIndex,
    onEnd: (r) => {
      game?.dispose();
      game = null;
      if (room) room.onMsg = lobbyMsg;
      showResult(r, players, localIndex);
    },
  });
  game.setMuted(muted);
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  $('#mute').onclick = () => {
    muted = !muted;
    game?.setMuted(muted);
    $('#mute').textContent = muted ? '🔇' : '🔊';
  };
  $('#pause').onclick = () => showPause(mode, level, seed, players, localIndex);
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape' && game && !document.querySelector('.pause')) showPause(mode, level, seed, players, localIndex);
  };
  window.addEventListener('keydown', onKey);
  const stopKey = () => window.removeEventListener('keydown', onKey);
  const prevEnd = game;
  const iv = setInterval(() => {
    if (game !== prevEnd) {
      stopKey();
      clearInterval(iv);
    }
  }, 500);
}

function showPause(mode: GameMode, level: LevelDef, seed: number, players: PlayerSpec[], localIndex: number) {
  if (!game) return;
  game.setPaused(true);
  const root = $('#game-root');
  const d = document.createElement('div');
  d.className = 'pause';
  d.innerHTML = `<div class="pause-box"><h2>⏸ 일시정지</h2>
    ${mode === 'online' ? '<p class="hint">온라인 대전은 멈추지 않습니다!</p>' : ''}
    <button class="big-btn" id="resume">계속하기</button>
    ${mode !== 'online' ? '<button class="big-btn ghost" id="restart">처음부터</button>' : ''}
    <button class="big-btn ghost" id="quit">그만두기</button></div>`;
  root.appendChild(d);
  $('#resume', d).onclick = () => {
    d.remove();
    game?.setPaused(false);
  };
  const rs = d.querySelector<HTMLButtonElement>('#restart');
  if (rs) rs.onclick = () => startGame(mode, level, mode === 'solo' ? seed : Math.floor(Math.random() * 1e9), players, localIndex);
  $('#quit', d).onclick = () => {
    game?.dispose();
    game = null;
    if (mode === 'online') {
      leaveRoom();
      showOnlineLobby();
    } else showForkliftMenu();
  };
}

function medalFor(level: LevelDef, t: number) {
  if (t <= level.medals[0]) return '🥇';
  if (t <= level.medals[1]) return '🥈';
  if (t <= level.medals[2]) return '🥉';
  return '🎖️';
}

async function showResult(r: GameResult, players: PlayerSpec[], localIndex: number) {
  const lv = r.level;
  const statRow = (label: string, v: string) => `<div class="sr"><span>${label}</span><b>${v}</b></div>`;
  const card = (pr: GameResult['players'][number], i: number) => {
    const s = pr.stats;
    const bonus = s.style / STYLE_PER_SECOND;
    return `<div class="res-card ${r.winner === i ? 'winner' : ''}" style="--pc:${css(pr.color)}">
      <div class="res-name">${escapeHtml(pr.name)} ${r.winner === i ? '👑' : ''}</div>
      ${r.mode === 'solo' ? `<div class="res-final">${medalFor(lv, pr.final)} ${fmtTime(pr.final)}</div>` : `<div class="res-final">📦 ${s.delivered}</div>`}
      ${statRow('주행 시간', fmtTime(pr.time))}
      ${statRow('페널티', `+${s.penalty.toFixed(0)}s`)}
      ${statRow('스타일 보너스', `-${bonus.toFixed(1)}s (★${Math.round(s.style)})`)}
      ${statRow('칼각 입고', String(s.perfect))}
      ${statRow('라바콘 / 충돌', `${s.cones} / ${s.crashes}`)}
      ${statRow('화물 낙하 / 위스키 파손', `${s.drops} / ${s.breaks}`)}
      ${statRow('에어타임', `${s.airtime.toFixed(1)}s`)}
      ${statRow('니어미스 / 들이받기', `${s.nearMiss} / ${s.rams}`)}
      ${statRow('최고 속도', `${Math.round(s.maxSpeed * 3.6)} km/h`)}
    </div>`;
  };
  const title = r.mode === 'solo' ? '퇴근 완료!' : r.winner === -1 ? '무승부' : r.mode === 'online' ? (r.winner === localIndex ? '승리! 🏆' : '패배... 😭') : `${escapeHtml(r.players[r.winner].name)} 승리!`;
  screen(`
    <div class="menu narrow result">
      <div class="res-title">${title}</div>
      <div class="res-sub">LV.${lv.id} ${lv.name} · ${lv.title}</div>
      <div class="res-cards">${r.players.map(card).join('')}</div>
      <div id="submit-status" class="hint"></div>
      <div class="row">
        <button class="big-btn" id="again">${r.mode === 'online' ? '대전방으로' : '한 판 더'}</button>
        ${r.mode === 'solo' && lv.id < 4 ? '<button class="big-btn ghost" id="next">다음 레벨 ▶</button>' : ''}
        <button class="big-btn ghost" id="menu">메뉴</button>
      </div>
    </div>`);
  $('#menu').onclick = showForkliftMenu;
  $('#again').onclick = () => {
    if (r.mode === 'online') {
      if (room) renderRoom();
      else showOnlineLobby();
    } else startGame(r.mode, lv, Math.floor(Math.random() * 1e9), players, localIndex);
  };
  const next = document.getElementById('next');
  if (next) next.onclick = () => {
    selectedLevel = lv.id + 1;
    startGame('solo', LEVELS[lv.id], Math.floor(Math.random() * 1e9), players);
  };
  if (r.mode === 'solo') {
    const pr = r.players[0];
    const s = pr.stats;
    const st = $('#submit-status');
    st.textContent = '리더보드 등록 중...';
    const res = await submitScore({
      nickname: pr.name, level: lv.id, time_ms: Math.round(pr.final * 1000), raw_ms: Math.round(pr.time * 1000),
      penalty_ms: Math.round(s.penalty * 1000), bonus_ms: Math.round((s.style / STYLE_PER_SECOND) * 1000), style: Math.round(s.style),
      client_id: profile.id,
    });
    const { rows } = await topScores(lv.id, 100);
    const rank = rows.findIndex((x) => x.nickname.toLowerCase() === pr.name.toLowerCase()) + 1;
    const el = document.getElementById('submit-status');
    if (el) el.textContent = res.ok ? `${res.remote ? '🌐 전체' : '📱 기기'} 랭킹 ${rank > 0 ? rank + '위' : '-'} (개인 최고기록 기준)` : `등록 실패: ${res.error}`;
  }
}

showHub();
if (new URLSearchParams(location.search).get('room')) {
  showForkliftMenu();
  selectedMode = 'online';
  if (profile.nickname) showOnlineLobby();
}

// dev-only: simulate an online match between two tabs with BroadcastChannel (no Supabase needed)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__mockOnline = (idx: number, seed: number, level = 3) => {
    const bc = new BroadcastChannel('mock-room');
    const fake = {
      send: (m: unknown) => bc.postMessage(m),
      onMsg: undefined as undefined | ((m: unknown) => void),
      leave: () => bc.close(),
    };
    bc.onmessage = (e) => fake.onMsg?.(e.data);
    room = fake as unknown as OnlineRoom;
    startGame('online', LEVELS[level - 1], seed, [{ name: 'HOST', color: 0xf2c200 }, { name: 'GUEST', color: 0x1f9bff }], idx);
  };
}
