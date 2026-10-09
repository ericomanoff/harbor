import { stage as stageApi, orders as ordersApi } from '../api/client';
import { eva, selection, settings, store } from '../app';
import type { MapApi } from '../hud/minimap';
import type { Pod } from '../store/cluster';
import { BubbleUI } from '../tour/bubbleUI';
import { TourEngine } from '../tour/engine';
import { enterTraining, leaveTraining, simulate, training } from '../tour/training';
import { ChallengeUI } from './challengeUI';
import { playScript, starsFor } from './director';
import { recordProgress } from './progress';
import { showSuccess } from './success';
import { openSummary } from './summaryCard';
import type { Level, LevelContext, LevelMode, LevelResult } from './types';

export interface RunnerHooks {
  /** Called after a level ends, with where the learner chose to go. */
  onExit(next: 'select' | 'harbor'): void;
  nextLevel(id: string): Level | undefined;
}

export interface RunOptions {
  mode?: LevelMode;
  /** No bubbles, just objectives and the clock. */
  challenge?: boolean;
}

/** The academy namespace on a real cluster; cleanup deletes every namespace with the academy label. */
export const REAL_NS = 'harbor-academy';

/** The level that is running, if any; the tour stays out of the way while it does. */
export const activeLevel: { current?: Level; mode?: LevelMode; challenge?: boolean } = {};

let cancelScripts: (() => void)[] = [];
let stopUI: (() => void) | undefined;

/**
 * Plays one level: loads its harbor (into the training simulator, or onto
 * the real cluster), walks the harbor master's steps on the tour engine
 * (goals are `waitFor` steps), then celebrates, saves progress and shows
 * the summary card. In challenge mode the bubbles are replaced by an
 * objectives bar and the clock.
 */
export function startLevel(level: Level, map: MapApi, hooks: RunnerHooks, opts: RunOptions = {}): void {
  const mode: LevelMode = opts.mode === 'real' && level.real ? 'real' : 'sim';
  const challenge = !!opts.challenge;
  stopUI?.();
  activeLevel.current = level;
  activeLevel.mode = mode;
  activeLevel.challenge = challenge;
  const ns = mode === 'real' ? REAL_NS : 'harbor';
  if (mode === 'sim') enterTraining(level.fixture());
  else if (training.active) leaveTraining();
  selection.clear();
  map.home();
  // The map rebuilds its layout on the next frame; home again once it has.
  requestAnimationFrame(() => requestAnimationFrame(() => map.home()));

  let ordersCache: { kind: string; name: string }[] = [];
  let ordersAt = 0;
  const ctx: LevelContext = {
    store,
    mode,
    ns,
    play: (script) => {
      const cancel = playScript(store, script);
      cancelScripts.push(cancel);
      return cancel;
    },
    simulate,
    sink: (pod: Pod) => {
      if (mode === 'sim') simulate('DELETE', `/api/pods/${pod.ns}/${pod.name}`, undefined);
      else void ctx.stage('sink-pod', { name: pod.name });
    },
    stage: async (incident, args = {}) => {
      if (mode !== 'real') return;
      try {
        const res = await stageApi(incident, { ns, ...args });
        eva.emit(`ACADEMY: ${res.message}`);
      } catch (e) {
        eva.emit(`ACADEMY: could not stage ${incident}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    orders: () => {
      if (mode === 'sim') return (simulate('GET', `/api/orders?ns=${ns}`, undefined) as { kind: string; name: string }[] | undefined) ?? [];
      if (Date.now() - ordersAt > 1500) {
        ordersAt = Date.now();
        void ordersApi.list(ns).then((l) => { ordersCache = l; }).catch(() => undefined);
      }
      return ordersCache;
    },
  };

  // On a real cluster only the academy fleets stay on the map while the level runs.
  const hiddenBefore = new Set(settings.hiddenNamespaces);
  if (mode === 'real') {
    settings.hiddenNamespaces.clear();
    for (const n of store.namespaces.keys()) if (!n.startsWith(REAL_NS)) settings.hiddenNamespaces.add(n);
    settings.changed.emit();
  }
  const restoreFleets = (): void => {
    if (mode !== 'real') return;
    settings.hiddenNamespaces.clear();
    for (const n of hiddenBefore) settings.hiddenNamespaces.add(n);
    settings.changed.emit();
  };

  let hints = 0;
  let engine: TourEngine;
  let ui: { show(step: Parameters<BubbleUI['show']>[0], i: number, n: number): void; position(): void; destroy(): void };
  if (challenge) {
    const c = new ChallengeUI(`Challenge · ${level.title}`, level.steps(ctx), level.parSeconds, () => engine.skip());
    ui = { show: (_s, i) => c.show(i), position: () => c.tick((performance.now() - started) / 1000), destroy: () => c.destroy() };
  } else {
    const b = new BubbleUI(map, { onNext: () => engine.next(), onBack: () => engine.back(), onSkip: () => engine.skip(), onHint: () => hints++ }, 'Leave level');
    ui = b;
  }
  let started = performance.now();
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
    restoreFleets();
    if (mode === 'real') void stageApi('cleanup').then((r) => eva.emit(`ACADEMY: ${r.message}`)).catch(() => undefined);
  };
  stopUI = teardown;
  engine = new TourEngine(level.steps(ctx), {
    onStep: (s, i, n) => {
      ui.show(s, i, n);
      // Challenge: narration steps pass by on their own; only goals wait.
      if (challenge && !s.waitFor) setTimeout(() => { if (engine.current === s && !engine.finished) engine.next(); }, 0);
    },
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
          onReplay: () => startLevel(level, map, hooks, opts),
          ...(next ? { onNext: () => startLevel(next, map, hooks, { ...opts, mode: opts.mode === 'real' && next.real ? 'real' : 'sim' }) } : {}),
          onSelect: () => { leaveTraining(); hooks.onExit('select'); },
          onLeave: () => { leaveTraining(); hooks.onExit('harbor'); },
        });
      });
    },
  });

  const begin = (): void => {
    started = performance.now();
    engine.start();
  };
  if (mode === 'real' && level.real) {
    eva.emit('ACADEMY: preparing the harbor on your cluster…');
    void level.real.setup(ctx).then(() => {
      const until = Date.now() + 120_000;
      const wait = (): void => {
        if (stopUI !== teardown) return; // left meanwhile
        if (level.real!.ready(ctx)) {
          map.focusKey(`dock:${[...store.nodes.keys()][0] ?? ''}`);
          begin();
        } else if (Date.now() < until) setTimeout(wait, 400);
        else {
          eva.emit('ACADEMY: the harbor did not come up in time; leaving the level');
          engine.skip();
        }
      };
      wait();
    }).catch((e: unknown) => {
      eva.emit(`ACADEMY: could not prepare the harbor: ${e instanceof Error ? e.message : String(e)}`);
      engine.skip();
    });
  } else {
    begin();
  }
}
