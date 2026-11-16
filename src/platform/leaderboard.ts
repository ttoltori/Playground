import { supabase } from './supabase';

export interface ScoreRow {
  nickname: string;
  level: number;
  time_ms: number;
  raw_ms: number;
  penalty_ms: number;
  bonus_ms: number;
  style: number;
  client_id: string;
  created_at?: string;
}

const LOCAL = 'pg.forklift.scores.v1';

function localAll(): ScoreRow[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) || '[]');
  } catch {
    return [];
  }
}

export async function submitScore(row: ScoreRow): Promise<{ ok: boolean; remote: boolean; error?: string }> {
  const all = localAll();
  all.push({ ...row, created_at: new Date().toISOString() });
  try {
    localStorage.setItem(LOCAL, JSON.stringify(all.slice(-300)));
  } catch {
    /* ignore */
  }
  if (!supabase) return { ok: true, remote: false };
  const { error } = await supabase.from('forklift_scores').insert(row);
  return { ok: !error, remote: true, error: error?.message };
}

/** Best time per nickname for a level. */
export async function topScores(level: number, limit = 20): Promise<{ rows: ScoreRow[]; remote: boolean }> {
  let rows: ScoreRow[] = [];
  let remote = false;
  if (supabase) {
    const { data, error } = await supabase
      .from('forklift_scores')
      .select('nickname,level,time_ms,raw_ms,penalty_ms,bonus_ms,style,client_id,created_at')
      .eq('level', level)
      .order('time_ms', { ascending: true })
      .limit(200);
    if (!error && data) {
      rows = data as ScoreRow[];
      remote = true;
    }
  }
  if (!remote) rows = localAll().filter((r) => r.level === level).sort((a, b) => a.time_ms - b.time_ms);
  const seen = new Set<string>();
  const best: ScoreRow[] = [];
  for (const r of rows) {
    const k = r.nickname.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    best.push(r);
    if (best.length >= limit) break;
  }
  return { rows: best, remote };
}

// ---------------------------------------------------------------- generic mini-game scores
export interface GameScoreRow {
  game: string;
  nickname: string;
  level: number;
  time_ms: number;
  client_id: string;
  created_at?: string;
}

const LOCAL_G = 'pg.game.scores.v1';
function localGames(): GameScoreRow[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_G) || '[]');
  } catch {
    return [];
  }
}

export async function submitGameScore(row: GameScoreRow): Promise<{ ok: boolean; remote: boolean; error?: string }> {
  const all = localGames();
  all.push({ ...row, created_at: new Date().toISOString() });
  try {
    localStorage.setItem(LOCAL_G, JSON.stringify(all.slice(-500)));
  } catch {
    /* ignore */
  }
  if (!supabase) return { ok: true, remote: false };
  const { error } = await supabase.from('game_scores').insert(row);
  return { ok: !error, remote: true, error: error?.message };
}

export async function topGameScores(game: string, level: number, limit = 20, higherBetter = false): Promise<{ rows: GameScoreRow[]; remote: boolean }> {
  let rows: GameScoreRow[] = [];
  let remote = false;
  if (supabase) {
    const { data, error } = await supabase
      .from('game_scores')
      .select('game,nickname,level,time_ms,client_id,created_at')
      .eq('game', game)
      .eq('level', level)
      .order('time_ms', { ascending: !higherBetter })
      .limit(200);
    if (!error && data) {
      rows = data as GameScoreRow[];
      remote = true;
    }
  }
  if (!remote) rows = localGames().filter((r) => r.game === game && r.level === level).sort((a, b) => (higherBetter ? b.time_ms - a.time_ms : a.time_ms - b.time_ms));
  const seen = new Set<string>();
  const best: GameScoreRow[] = [];
  for (const r of rows) {
    const k = r.nickname.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    best.push(r);
    if (best.length >= limit) break;
  }
  return { rows: best, remote };
}
