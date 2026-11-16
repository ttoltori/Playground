const KEY = 'pg.profile.v1';

export interface Profile {
  id: string;
  nickname: string;
  color: number;
}

const COLORS = [0xf2c200, 0xff5a1f, 0x1f9bff, 0x2ee66b, 0xff4fd8, 0xb07cff];
export const FORKLIFT_COLORS = COLORS;

function uuid() {
  return crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const p: Profile = { id: uuid(), nickname: '', color: COLORS[0] };
  saveProfile(p);
  return p;
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
