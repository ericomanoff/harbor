import type { Level, LevelResult } from './types';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`success: missing ${sel}`);
  return el;
};

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string }

/** Fireworks on a 2D canvas over the harbor: a few shells, each bursting into sparks. */
function fireworks(canvas: HTMLCanvasElement, durationMs: number): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const colors = ['#ffd84d', '#ff6b57', '#5cb82a', '#5fbde6', '#ffffff', '#e8b33a'];
  const sparks: Spark[] = [];
  const burst = (x: number, y: number): void => {
    const color = colors[Math.floor(Math.random() * colors.length)]!;
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + Math.random() * 0.1;
      const sp = 1.6 + Math.random() * 3.2;
      sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 55 + Math.random() * 35, color });
    }
  };
  const fit = (): void => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  fit();
  const t0 = performance.now();
  let next = 0;
  let raf = 0;
  const frame = (t: number): void => {
    const elapsed = t - t0;
    if (elapsed > next && elapsed < durationMs) {
      burst(canvas.width * (0.15 + Math.random() * 0.7), canvas.height * (0.15 + Math.random() * 0.4));
      next = elapsed + 350 + Math.random() * 450;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]!;
      s.life++;
      s.vy += 0.045;
      s.vx *= 0.985;
      s.vy *= 0.985;
      s.x += s.vx;
      s.y += s.vy;
      const a = 1 - s.life / s.max;
      if (a <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (elapsed < durationMs || sparks.length) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  window.addEventListener('resize', fit);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', fit);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}

const fmt = (s: number): string => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

/**
 * HARBOR SECURED: fireworks from the breakwater, a banner, and the stars
 * popping in one by one. Resolves when the learner presses Continue.
 */
export function showSuccess(level: Level, result: LevelResult): Promise<void> {
  const root = $<HTMLDivElement>('#success');
  const stop = fireworks($('canvas', root), 5000);
  $('.level', root).textContent = `Level ${level.number} · ${level.title}`;
  $('.time', root).textContent = `${fmt(result.seconds)} · par ${fmt(level.parSeconds)}${result.hintsUsed ? ` · ${result.hintsUsed} hint${result.hintsUsed > 1 ? 's' : ''}` : ' · no hints'}`;
  const stars = Array.from(root.querySelectorAll<HTMLElement>('.stars span'));
  stars.forEach((s, i) => {
    s.classList.remove('on', 'pop');
    if (i < result.stars) setTimeout(() => s.classList.add('on', 'pop'), 700 + i * 450);
  });
  root.hidden = false;
  root.classList.add('in');
  return new Promise<void>((resolve) => {
    $('[data-continue]', root).onclick = () => {
      stop();
      root.classList.remove('in');
      root.hidden = true;
      resolve();
    };
  });
}
