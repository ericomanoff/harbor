import { expect, test, type Page } from '@playwright/test';

/**
 * Plays the welcome tour end to end in the training harbor (no cluster
 * needed): every interactive step is performed the way a player would.
 */
const title = (page: Page) => page.locator('#captain .bubble .title');

async function clickMapKey(page: Page, key: string): Promise<void> {
  await page.waitForFunction((k) => {
    const m = window.harbor.game.scene.keys['Map'] as { screenRectOf(k: string): { width: number } | undefined };
    return (m.screenRectOf(k)?.width ?? 0) > 0;
  }, key);
  const r = await page.evaluate((k) => {
    const m = window.harbor.game.scene.keys['Map'] as { screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined };
    return m.screenRectOf(k)!;
  }, key);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}

test('welcome tour plays through in the training harbor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo');
  const tour = page.locator('#captain');
  await expect(tour).toBeVisible({ timeout: 15_000 });
  await expect(title(page)).toHaveText('Ahoy, harbor master!');
  await expect(page.locator('#hud [data-chip=link]')).toHaveText('demo');

  await page.locator('[data-tour=next]').click();
  await expect(title(page)).toHaveText('Islands are nodes');
  await page.locator('[data-tour=next]').click();
  await expect(title(page)).toHaveText('Shipyards are Deployments');

  await clickMapKey(page, 'b:sandbox/nginx');
  await expect(title(page)).toHaveText('The selection card');
  await expect(page.locator('#hud .selection button[data-action="0"]')).toHaveText('Launch ship');
  await page.locator('#hud .selection button[data-action="0"]').click();
  await expect(title(page)).toHaveText('Ships are pods');
  await expect.poll(() => page.evaluate(() => window.harbor.store.deployments.get('sandbox/nginx')?.replicas)).toBe(4);

  await clickMapKey(page, 'unit-of:sandbox/nginx');
  await expect(title(page)).toHaveText('Reading a ship');
  await page.locator('[data-tour=next]').click();
  await expect(title(page)).toHaveText('Tankers, tugs and fishing boats');
  await page.locator('[data-tour=next]').click();
  await expect(title(page)).toHaveText('Lighthouses are Services');

  await clickMapKey(page, 's:sandbox/nginx');
  await expect(title(page)).toHaveText('The harbor mouth');
  await page.locator('[data-tour=next]').click();
  await expect(title(page)).toHaveText('Anchorages are Helm releases');
  await page.locator('[data-tour=next]').click();
  await expect(title(page)).toHaveText('Harbor health and capacity');
  await page.locator('[data-tour=next]').click();
  await expect(title(page)).toHaveText('Building');

  await page.locator('#hud [data-shop-open]').click();
  await expect(title(page)).toHaveText('Placing a shipyard');
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect(title(page)).toHaveText('Around the harbor');
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('idle'); // the rails step tidies up

  await page.locator('[data-tour=next]').click();
  await expect(title(page)).toHaveText('Fair winds');
  await expect(page.locator('[data-tour=next]')).toHaveText('Finish');
  await page.locator('[data-tour=next]').click();
  await expect(tour).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('harbor.tour.v1'))).toBe('done');

  // Help replays it; Skip ends it. While the dock is up, the map outside the bubble still takes clicks.
  await page.locator('#hud [data-rail=help]').click();
  await expect(tour).toBeVisible();
  await page.evaluate(() => window.harbor.selection.set(['b:sandbox/nginx']));
  const bubble = await page.locator('#captain .bubble').boundingBox();
  await page.mouse.click(bubble!.x + 60, bubble!.y - 60); // sea above the bubble, inside the dock layer's area
  await expect.poll(() => page.evaluate(() => window.harbor.selection.keys.size)).toBe(0);
  await page.locator('[data-tour=skip]').click();
  await expect(tour).toBeHidden();
});
