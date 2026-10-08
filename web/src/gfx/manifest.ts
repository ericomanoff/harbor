/**
 * Logical asset names → atlas frames. Code refers to these names only, so
 * swapping art (another pack, bespoke sprites) is a change here and in
 * public/assets, never in entities. A test checks every frame exists.
 */
export const ATLAS = {
  ships: { key: 'pirate', png: 'assets/pirate/shipsMiscellaneous_sheet.png', xml: 'assets/pirate/shipsMiscellaneous_sheet.xml' },
  tiles: { key: 'tiles', png: 'assets/pirate/tiles_sheet.png', size: 64, columns: 16, count: 96 },
} as const;

export interface FrameRef {
  atlas: 'pirate';
  frame: string;
}

const f = (frame: string): FrameRef => ({ atlas: 'pirate', frame });

/** Six hull/sail colour families in the pack, indexed like FACTION_PALETTE. */
const SHIP_COLOURS = 6;

export const SPRITES = {
  /** Complete ships (hull + sail), four per colour family: index = colour*4 + variant. */
  ship: (colour: number, variant = 0): FrameRef => f(`ship (${((colour % SHIP_COLOURS) * 4 + (variant % 4)) + 1}).png`),
  hullLarge: (variant: number): FrameRef => f(`hullLarge (${(variant % 4) + 1}).png`),
  hullSmall: (variant: number): FrameRef => f(`hullSmall (${(variant % 4) + 1}).png`),
  dinghy: (variant: number): FrameRef => f(`dinghySmall${(variant % 3) + 1}.png`),
  flag: (colour: number): FrameRef => f(`flag (${(colour % SHIP_COLOURS) + 1}).png`),
  crew: (variant: number): FrameRef => f(`crew (${(variant % 6) + 1}).png`),
  fire: [f('fire1.png'), f('fire2.png')],
  explosion: [f('explosion1.png'), f('explosion2.png'), f('explosion3.png')],
  wood: (variant: number): FrameRef => f(`wood (${(variant % 4) + 1}).png`),
  cannon: f('cannon.png'),
  cannonBall: f('cannonBall.png'),
  nest: f('nest.png'),
  pole: f('pole.png'),
} as const;

/**
 * Tile indices into the 16x6 tilesheet, read off the `?style` page
 * (2026-10-08). Rows of 16: 0-2/16-18/32-34 sand island (17 centre),
 * 5-8/21-24/37-40 grass island (38 centre), 9-11/25-27/41-43 shallows
 * (26 centre), 48-50/64-66 rocks, 69-71 bushes, 72-75 water, 12/28/44/60
 * round towers, 14-15/30-31/46-47/62-63 stone walls, 56 plank, 59 crate.
 */
export const TILES = {
  water: 72,
  waterWave: 73,
  shallows: 26,
  sand: 17,
  sandEdgeN: 1,
  sandEdgeS: 33,
  sandEdgeW: 16,
  sandEdgeE: 18,
  grass: 38,
  rock: 49,
  bush: 70,
  tower: 12,
  wallH: 14,
  wallV: 15,
  plank: 56,
  crate: 59,
} as const;

/** Every frame the manifest can produce, for the asset test and style page. */
export function allSpriteFrames(): { name: string; ref: FrameRef }[] {
  const out: { name: string; ref: FrameRef }[] = [];
  for (let c = 0; c < SHIP_COLOURS; c++) {
    for (let v = 0; v < 4; v++) out.push({ name: `ship ${c}.${v}`, ref: SPRITES.ship(c, v) });
    out.push({ name: `flag ${c}`, ref: SPRITES.flag(c) });
    out.push({ name: `crew ${c}`, ref: SPRITES.crew(c) });
  }
  for (let v = 0; v < 4; v++) {
    out.push({ name: `hullLarge ${v}`, ref: SPRITES.hullLarge(v) });
    out.push({ name: `hullSmall ${v}`, ref: SPRITES.hullSmall(v) });
    out.push({ name: `wood ${v}`, ref: SPRITES.wood(v) });
  }
  for (let v = 0; v < 3; v++) out.push({ name: `dinghy ${v}`, ref: SPRITES.dinghy(v) });
  SPRITES.fire.forEach((r, i) => out.push({ name: `fire ${i}`, ref: r }));
  SPRITES.explosion.forEach((r, i) => out.push({ name: `explosion ${i}`, ref: r }));
  out.push({ name: 'cannon', ref: SPRITES.cannon }, { name: 'cannonBall', ref: SPRITES.cannonBall }, { name: 'nest', ref: SPRITES.nest }, { name: 'pole', ref: SPRITES.pole });
  return out;
}
