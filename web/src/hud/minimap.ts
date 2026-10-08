import { settings } from '../app';
import { namespaceVisible } from '../game/filter';
import { namespaceColor } from '../layout/colors';
import { BUILD_CELL, TILE, type MapLayout } from '../layout/grid';
import { openOverlay } from '../ui/overlay';
import type { ClusterEvent } from '../store/cluster';

/** What the HUD needs from the map scene. */
export interface MapApi {
  readonly layout: MapLayout;
  cameraView(): { x: number; y: number; width: number; height: number };
  centerOnWorld(x: number, y: number): void;
  zoomBy(factor: number): void;
  home(): void;
  openSearch(): void;
  flashFor(ev: ClusterEvent): void;
  /** Screen rectangle of a selectable thing ("b:", "u:", "s:", "r:", "dock:<node>", "unit-of:<ns/deployment>"), if present. */
  screenRectOf(key: string): { x: number; y: number; width: number; height: number } | undefined;
  /** Pan (and zoom in a little) so the thing is comfortably in view. */
  focusKey(key: string): void;
}

/** The chart table: a minimap drawn on a 2D canvas; click to sail the camera there. */
export function openMinimap(map: MapApi): void {
  const root = document.getElementById('minimap')!;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const ctx = canvas.getContext('2d')!;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = openOverlay('minimap', () => { if (timer) clearInterval(timer); });
  root.querySelector<HTMLButtonElement>('button[data-close]')!.onclick = close;

  const scale = (): { s: number; ox: number; oy: number } => {
    const L = map.layout;
    const s = Math.min(canvas.width / (L.width * TILE), canvas.height / (L.height * TILE));
    return { s, ox: (canvas.width - L.width * TILE * s) / 2, oy: (canvas.height - L.height * TILE * s) / 2 };
  };
  const draw = (): void => {
    const L = map.layout;
    const { s, ox, oy } = scale();
    ctx.fillStyle = '#3a98c9';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const p of L.plateaus) {
      ctx.fillStyle = p.ready ? '#f3e4bd' : '#b98b8b';
      ctx.fillRect(ox + p.x * TILE * s, oy + p.y * TILE * s, p.w * TILE * s, p.h * TILE * s);
    }
    const show = (ns: string): boolean => namespaceVisible(ns, settings);
    for (const [key, pl] of L.buildings) {
      const ns = key.split('/')[0] ?? '';
      if (!show(ns)) continue;
      ctx.fillStyle = `#${namespaceColor(ns).toString(16).padStart(6, '0')}`;
      ctx.fillRect(ox + pl.x * TILE * s, oy + pl.y * TILE * s, Math.max(3, BUILD_CELL * TILE * s), Math.max(3, BUILD_CELL * TILE * s));
    }
    for (const [key, pl] of L.units) {
      const ns = key.split('/')[0] ?? '';
      if (!show(ns)) continue;
      ctx.fillStyle = `#${namespaceColor(ns).toString(16).padStart(6, '0')}`;
      ctx.fillRect(ox + pl.x * TILE * s, oy + pl.y * TILE * s, Math.max(2, TILE * s), Math.max(2, TILE * s));
    }
    const v = map.cameraView();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + v.x * s, oy + v.y * s, v.width * s, v.height * s);
  };
  canvas.onclick = (ev) => {
    const r = canvas.getBoundingClientRect();
    const { s, ox, oy } = scale();
    const x = ((ev.clientX - r.left) * (canvas.width / r.width) - ox) / s;
    const y = ((ev.clientY - r.top) * (canvas.height / r.height) - oy) / s;
    map.centerOnWorld(x, y);
    draw();
  };
  draw();
  timer = setInterval(draw, 300);
}
