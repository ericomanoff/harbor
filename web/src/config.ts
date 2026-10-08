/** Logical render size. Scaled to the window with nearest-neighbour sampling. */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 600;
/** The map fills the window; the HUD is HTML over it. */
export const SIDEBAR_W = 0;
export const MAP_W = GAME_WIDTH;

/** Nunito for everything drawn on the map; falls back until the font is ready. */
export const MAP_FONT = 'Nunito, "Segoe UI", system-ui, sans-serif';

/** Sea and island colours used by procedural drawing (booms, beams, outlines). */
export const SEA = {
  water: 0x5fbde6,
  deep: 0x3a98c9,
  foam: 0xe9f7fd,
  sand: 0xf3e4bd,
  outline: 0xffffff,
  boom: 0xffd166,
  beam: 0xfff3a0,
} as const;
