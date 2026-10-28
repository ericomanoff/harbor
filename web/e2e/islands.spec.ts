import { expect, test, type Page } from '@playwright/test';

/**
 * Islands (nodes) hover and click like everything else on the map: the
 * land shows the dock tooltip with the node's state, a click selects the
 * island and its card reads the node's numbers, Papers opens the Node,
 * and anything standing or moored on the island still wins the pointer.
 */
type MapHandle = { layout: { plateaus: { node: string; w: number; h: number }[] }; screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined };

/** Screen point on the island's sand corner: tile (0, 0) of the plateau, where nothing stands. */
async function sandCorner(page: Page, node: string): Promise<{ x: number; y: number }> {
  await page.waitForFunction((n) => ((window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(`dock:${n}`)?.width ?? 0) > 0, node);
  return page.evaluate((n) => {
    const m = window.harbor.game.scene.keys['Map'] as MapHandle;
    const r = m.screenRectOf(`dock:${n}`)!;
    const p = m.layout.plateaus.find((pl) => pl.node === n)!;
    const tile = r.width / p.w;
    return { x: r.x + tile / 2, y: r.y + tile / 2 };
  }, node);
}

test('islands hover, select, show their card and papers; ships on them still win', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo');
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);
  const node = 'harbor-worker';

  // Hover the sand: the dock tooltip, subtitled with the node's state.
  const at = await sandCorner(page, node);
  await page.mouse.move(at.x, at.y);
  const tip = page.locator('#term-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveAttribute('data-term', 'dock');
  await expect(tip.locator('.pair')).toContainText(`${node} · Ready`);
  await expect(tip.locator('.pair')).toContainText('ships moored');

  // Click it: the island is selected and its card reads the node.
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`dock:${node}`]);
  const card = page.locator('#hud .selection');
  await expect(card.locator('.title')).toHaveText(`Island ${node}`);
  await expect(card.locator('.lines')).toContainText('Ready · node');
  await expect(card.locator('.lines')).toContainText('allocatable');
  const moored = await page.evaluate((n) => [...window.harbor.store.pods.values()].filter((p) => (p as { node?: string }).node === n).length, node);
  await expect(card.locator('.lines')).toContainText(`${moored} ship${moored === 1 ? '' : 's'} moored`);

  // Papers open the Node.
  await card.locator('button', { hasText: 'Papers' }).click();
  const papers = page.locator('#papers');
  await expect(papers).toBeVisible();
  await expect(papers.locator('h2')).toContainText(`Node ${node}`);
  await papers.locator('button[data-close]').click();

  // A ship moored at the island wins the click over the island.
  const shipKey = await page.evaluate((n) => {
    const p = [...window.harbor.store.pods.values()].find((x) => (x as { node?: string }).node === n) as unknown as { ns: string; name: string };
    return `u:${p.ns}/${p.name}`;
  }, node);
  const ship = await page.evaluate((k) => (window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(k)!, shipKey);
  await page.mouse.click(ship.x + ship.width / 2, ship.y + ship.height / 2);
  expect(await page.evaluate(() => [...window.harbor.selection.keys])).toEqual([shipKey]);

  // The shallows are water: clicking them clears the selection.
  const shallows = await page.evaluate((n) => {
    const m = window.harbor.game.scene.keys['Map'] as MapHandle;
    const r = m.screenRectOf(`dock:${n}`)!;
    const p = m.layout.plateaus.find((pl) => pl.node === n)!;
    const tile = r.height / p.h;
    return { x: r.x + tile / 2, y: r.y + r.height - tile / 2 };
  }, node);
  await page.mouse.click(shallows.x, shallows.y);
  expect(await page.evaluate(() => window.harbor.selection.keys.size)).toBe(0);
});
