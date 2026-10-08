/** Logical render size. Scaled to the window with nearest-neighbour sampling. */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 600;
/** The C&C sidebar on the right; the map viewport is everything left of it. */
export const SIDEBAR_W = 200;
export const MAP_W = GAME_WIDTH - SIDEBAR_W;

/** Sidebar palette, matched to the Tiberian Dawn / Red Alert 1 look. */
export const PALETTE = {
  black: 0x0a0a0a,
  bevelLight: 0x5a5a5a,
  bevelDark: 0x2c2c2c,
  radarGreen: 0x39ff14,
  radarGround: 0x001a00,
  amber: 0xffb000,
  alert: 0xff2a2a,
  ground: 0x0b0b06,
  plateau: 0x4a4632,
  plateauDown: 0x3a2424,
  cliff: 0x8a7a50,
  voidStrip: 0x1a1a14,
} as const;

export const FONT = 'monospace';

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
