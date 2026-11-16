/** Contract every playground mini-game implements. A game lives in src/games/<id>/ and exports `def` from def.ts. */
export interface MiniGameResult {
  /** final time in ms after penalties/bonuses (lower is better) */
  timeMs: number;
  /** headline shown on the result screen, e.g. "퇴근 완료!" */
  title?: string;
  /** stat rows for the result screen */
  detail: { label: string; value: string }[];
}

export interface MiniGameOptions {
  container: HTMLElement; // fills the viewport; the game appends its canvas + HUD here
  level: number; // 1-based index into def.levels
  nickname: string;
  color: number; // player's vehicle color (0xRRGGBB)
  onEnd: (r: MiniGameResult) => void; // call once when the run is finished
}

export interface MiniGame {
  dispose(): void; // stop loop, remove DOM, release audio/WebGL
  setPaused(p: boolean): void;
  setMuted(m: boolean): void;
}

export interface MiniGameDef {
  id: string; // folder name, used as leaderboard key
  name: string; // Korean display name
  emoji: string;
  desc: string; // one-line pitch for the hub card
  order: number; // hub ordering
  levels: { name: string; title: string; desc: string; medals: [number, number, number] }[]; // medal times in seconds
  howto: string[]; // HTML-safe tips/controls lines
  create(opts: MiniGameOptions): MiniGame;
}
