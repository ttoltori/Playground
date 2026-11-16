import { GameAudio } from '../forklift/audio';

/** forklift audio + a few heavy-machinery extras (all synthesized). */
export class DumpAudio extends GameAudio {
  private lastRumble = 0;

  /** gravel pouring / sliding. `power` 0..1 */
  rumble(power: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastRumble < 0.18) return;
    this.lastRumble = now;
    this['noise'](0.22, 500 + power * 700, 0.1 + power * 0.18, 'lowpass');
  }

  thud() {
    this['tone'](60, 0.35, 0.35, 'sine', 0, -25);
    this['noise'](0.25, 300, 0.25, 'lowpass');
  }

  sparks() {
    this['noise'](0.4, 3500, 0.3, 'highpass');
    this['tone'](1200, 0.2, 0.08, 'square', 0, -700);
  }

  weigh() {
    this['tone'](880, 0.12, 0.12, 'square');
    this['tone'](1320, 0.18, 0.12, 'square', 0.12);
  }

  warnBeep() {
    this['tone'](1500, 0.09, 0.08, 'square');
  }
}
