import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATLAS, TILES, allSpriteFrames } from './manifest';

/** Frame names in the Kenney XML atlas shipped under public/. */
function atlasFrames(): Set<string> {
  const xml = readFileSync(new URL(`../../public/${ATLAS.ships.xml}`, import.meta.url), 'utf8');
  return new Set([...xml.matchAll(/<SubTexture name="([^"]+)"/g)].map((m) => m[1]!));
}

describe('asset manifest', () => {
  it('names only frames that exist in the atlas', () => {
    const frames = atlasFrames();
    expect(frames.size).toBeGreaterThan(90);
    const missing = allSpriteFrames().filter(({ ref }) => !frames.has(ref.frame)).map(({ name, ref }) => `${name} -> ${ref.frame}`);
    expect(missing).toEqual([]);
  });

  it('keeps tile indices inside the sheet', () => {
    for (const [name, idx] of Object.entries(TILES)) {
      expect(idx, name).toBeGreaterThanOrEqual(0);
      expect(idx, name).toBeLessThan(ATLAS.tiles.count);
    }
  });

  it('gives every colour family a distinct ship', () => {
    const ships = new Set(allSpriteFrames().filter((x) => x.name.startsWith('ship ')).map((x) => x.ref.frame));
    expect(ships.size).toBe(24);
  });
});
