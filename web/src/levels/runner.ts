import { selection, store } from '../app';
import type { MapApi } from '../hud/minimap';
import { BubbleUI } from '../tour/bubbleUI';
import { TourEngine } from '../tour/engine';
import { enterTraining, leaveTraining, simulate } from '../tour/training';
import { playScript, starsFor } from './director';
import { recordProgress } from './progress';
import { showSuccess } from './success';
import { openSummary } from './summaryCard';
import type { Level, LevelResult } from './types';

export interface RunnerHooks {
  /** Called after a level ends, with where the learner chose to go. */
  onExit(next: 'select' | 'harbor'): void;
  nextLevel(id: string): Level | undefined;
}

/** The level that is running, if any; the tour stays out of the way while it does. */
export const activeLevel: { current?: Level } = {};

let cancelScripts: (() => void)[] = [];
let stopUI: (() => void) | undefined;

/**
 * Plays one level: loads its harbor into the training simulator, walks the
 * harbor master's steps on the tour engine (goals are `waitFor` steps),
 * then celebrates, saves progress and shows the summary card.
 */
export function startLevel(level: Level, map: MapApi, hooks: RunnerHooks): void {
  stopUI?.();
  activeLevel.current = level;
  enterTraining(level.fixture());
  selection.clear();
  map.home();
  // The map rebuilds its layout on the next frame; home again once it has.
  requestAnimationFrame(() => requestAnimationFrame(() => map.home()));
  const ctx = {
    store,
    play: (script: Parameters<typeof playScript>[1]) => {
      const cancel = playScript(store, script);
      cancelScripts.push(cancel);
      return cancel;
    },
    simulate,
  };
  let hints = 0;
  let engine: TourEngine;
  const ui = new BubbleUI(map, { onNext: () => engine.next(), onBack: () => engine.back(), onSkip: () => engine.skip(), onHint: () => hints++ }, 'Leave level');
  const started = performance.now();
  const timer = setInterval(() => {
    engine.tick();
    ui.position();
  }, 150);
  const teardown = (): void => {
    clearInterval(timer);
    ui.destroy();
    for (const c of cancelScripts) c();
    cancelScripts = [];
    activeLevel.current = undefined;
    stopUI = undefined;
  };
  stopUI = teardown;
  engine = new TourEngine(level.steps(ctx), {
    onStep: (s, i, n) => ui.show(s, i, n),
    onFinish: (reason) => {
      teardown();
      if (reason === 'skipped') {
        leaveTraining();
        hooks.onExit('select');
        return;
      }
      const seconds = (performance.now() - started) / 1000;
      const result: LevelResult = { levelId: level.id, stars: starsFor(seconds, hints, level.parSeconds), seconds, hintsUsed: hints };
      void recordProgress(level.id, { stars: result.stars, bestSeconds: Math.round(seconds), hintsUsed: hints });
      const summary = level.summary(store);
      void showSuccess(level, result).then(() => {
        const next = hooks.nextLevel(level.id);
        openSummary(level, result, summary, {
          onReplay: () => startLevel(level, map, hooks),
          ...(next ? { onNext: () => startLevel(next, map, hooks) } : {}),
          onSelect: () => { leaveTraining(); hooks.onExit('select'); },
          onLeave: () => { leaveTraining(); hooks.onExit('harbor'); },
        });
      });
    },
  });
  engine.start();
}
