import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../platform/supabase';

export interface PeerInfo {
  id: string;
  name: string;
  color: number;
  joinedAt: number;
}

export type NetMsg =
  | { type: 'start'; level: number; seed: number }
  | { type: 'st'; x: number; z: number; y: number; yaw: number; vx: number; vz: number; forkH: number; steer: number; carry: number; carryYaw: number; delivered: number; t: number }
  | { type: 'pick'; pid: number; t: number }
  | { type: 'place'; pid: number; x: number; z: number; y: number; yaw: number; zone: number }
  | { type: 'reset'; pid: number }
  | { type: 'cone'; i: number; vx: number; vz: number }
  | { type: 'finish'; delivered: number; time: number }
  | { type: 'rematch' };

/** Two-player room over Supabase Realtime (broadcast + presence). No DB tables needed. */
export class OnlineRoom {
  channel: RealtimeChannel | null = null;
  peers: PeerInfo[] = [];
  onPeers?: (peers: PeerInfo[]) => void;
  onMsg?: (m: NetMsg, from: string) => void;
  readonly joinedAt = Date.now();

  constructor(public code: string, public me: PeerInfo) {}

  static newCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  get isHost() {
    return this.peers.length > 0 && this.peers[0].id === this.me.id;
  }
  get opponent() {
    return this.peers.find((p) => p.id !== this.me.id);
  }

  async connect(): Promise<void> {
    if (!supabase) throw new Error('Supabase가 설정되지 않았습니다 (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
    const ch = supabase.channel(`forklift-${this.code}`, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.me.id } },
    });
    this.channel = ch;
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PeerInfo>();
      const list: PeerInfo[] = [];
      for (const k of Object.keys(state)) {
        const p = state[k][0];
        if (p) list.push({ id: p.id, name: p.name, color: p.color, joinedAt: p.joinedAt });
      }
      list.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
      this.peers = list.slice(0, 2);
      this.onPeers?.(this.peers);
    });
    ch.on('broadcast', { event: 'm' }, ({ payload }) => {
      this.onMsg?.(payload.m as NetMsg, payload.from as string);
    });
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('연결 시간 초과')), 10000);
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(to);
          await ch.track({ ...this.me, joinedAt: this.joinedAt });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(to);
          reject(new Error('채널 연결 실패: ' + status));
        }
      });
    });
  }

  send(m: NetMsg) {
    this.channel?.send({ type: 'broadcast', event: 'm', payload: { m, from: this.me.id } });
  }

  async leave() {
    if (this.channel && supabase) await supabase.removeChannel(this.channel);
    this.channel = null;
  }
}
