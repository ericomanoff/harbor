/** Logical render size. Scaled to the window with nearest-neighbour sampling. */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 600;

/** Sidebar palette, matched to the Tiberian Dawn / Red Alert 1 look. */
export const PALETTE = {
  black: 0x0a0a0a,
  bevelLight: 0x5a5a5a,
  bevelDark: 0x2c2c2c,
  radarGreen: 0x39ff14,
  radarGround: 0x001a00,
  amber: 0xffb000,
  alert: 0xff2a2a,
} as const;
