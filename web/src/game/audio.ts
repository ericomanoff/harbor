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
    // Wood knock: a short burst of filtered noise.
    const knock = (start: number, gain = 0.12): void => {
      const ctx = this.ctx!;
      const len = Math.floor(ctx.sampleRate * 0.06);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t + start);
      src.connect(lp).connect(g).connect(ctx.destination);
      src.start(t + start);
    };
    switch (name) {
      case 'click': knock(0, 0.1); break;
      case 'ok': tone(880, 'sine', 0, 0.5, 0.07); tone(1760, 'sine', 0, 0.35, 0.03); break; // ship's bell
      case 'error': tone(110, 'sawtooth', 0, 0.45, 0.08, 95); tone(165, 'sawtooth', 0.05, 0.4, 0.04, 140); break; // foghorn
      case 'alert': tone(880, 'sine', 0, 0.25, 0.07); tone(880, 'sine', 0.3, 0.25, 0.07); break; // bell twice
      case 'build': knock(0); knock(0.12); knock(0.24, 0.09); break; // hammering
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
