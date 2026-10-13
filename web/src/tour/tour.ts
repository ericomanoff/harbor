import { selection } from '../app';
import { activeLevel } from '../levels/runner';
import type { MapApi } from '../hud/minimap';
import { BubbleUI } from './bubbleUI';
import { TourEngine } from './engine';
import { tourSteps } from './steps';
import { enterTraining, leaveTraining } from './training';

const DONE_KEY = 'harbor.tour.v1';
let running = false;

export function tourDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === 'done';
  } catch {
    return true;
  }
}

/** The welcome tour: the harbor master walks through the harbor in the training harbor. */
export function startTour(map: MapApi): void {
  if (running || activeLevel.current) return;
  running = true;
  enterTraining();
  selection.clear();
  let engine: TourEngine;
  const ui = new BubbleUI(map, { onNext: () => engine.next(), onBack: () => engine.back(), onSkip: () => engine.skip() });
  const timer = setInterval(() => {
    engine.tick();
    ui.position();
  }, 150);
  engine = new TourEngine(tourSteps(), {
    onStep: (s, i, n) => ui.show(s, i, n),
    onFinish: () => {
      clearInterval(timer);
      ui.destroy();
      try {
        localStorage.setItem(DONE_KEY, 'done');
      } catch {
        /* private mode */
      }
      selection.clear();
      leaveTraining();
      running = false;
    },
  });
  engine.start();
}

/** Auto-start on the first visit unless the URL opts out or a level is requested. */
export function maybeAutoStartTour(map: MapApi): void {
  const params = new URLSearchParams(location.search);
  if (params.has('notour') || params.has('style') || params.has('level') || params.has('expeditions') || params.has('academy') || tourDone()) return;
  setTimeout(() => startTour(map), 900);
}
