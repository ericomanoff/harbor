/**
 * Synthesised sound effects and an EVA voice. Nothing is loaded from disk:
 * beeps come from WebAudio oscillators and speech from the browser's
 * speechSynthesis. Off until the player turns it on (which is also what the
 * browser's autoplay policy requires).
 */
export type SfxName = 'click' | 'ok' | 'error' | 'alert' | 'build';

const REPEAT_GAP_MS = 2500;

export class Sfx {
  enabled = false;
  private ctx?: AudioContext;
  private lastSaid = new Map<string, number>();

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
      this.play('ok');
    } else {
      speechSynthesis?.cancel();
    }
  }

  play(name: SfxName): void {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const tone = (freq: number, type: OscillatorType, start: number, dur: number, gain = 0.08, slideTo?: number): void => {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t + start);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + start + dur);
      g.gain.setValueAtTime(gain, t + start);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      osc.connect(g).connect(this.ctx!.destination);
      osc.start(t + start);
      osc.stop(t + start + dur + 0.02);
    };
    switch (name) {
      case 'click': tone(900, 'square', 0, 0.04, 0.05); break;
      case 'ok': tone(660, 'square', 0, 0.07); tone(990, 'square', 0.08, 0.1); break;
      case 'error': tone(160, 'sawtooth', 0, 0.25, 0.1, 110); break;
      case 'alert': tone(440, 'sawtooth', 0, 0.12, 0.08, 880); tone(440, 'sawtooth', 0.15, 0.12, 0.08, 880); break;
      case 'build': tone(120, 'triangle', 0, 0.35, 0.06, 240); break;
    }
  }

  /** Speaks a line, rate-limiting repeats of the same line. */
  say(line: string | undefined, now = Date.now()): void {
    if (!this.enabled || !line || typeof speechSynthesis === 'undefined') return;
    const last = this.lastSaid.get(line) ?? -Infinity;
    if (now - last < REPEAT_GAP_MS) return;
    this.lastSaid.set(line, now);
    if (speechSynthesis.pending) return; // never let announcements pile up
    const u = new SpeechSynthesisUtterance(line);
    u.rate = 0.95;
    u.pitch = 0.5;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  }
}

export const sfx = new Sfx();
