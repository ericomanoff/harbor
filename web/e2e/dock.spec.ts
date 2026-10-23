import { expect, test } from '@playwright/test';

/**
 * Captain Huber's dock sits top right and can grow to two thirds of the
 * window; the cluster panel sits bottom right and never overlaps the
 * selection card or the toasts: the bottom-centre column slides left by
 * what is measured, and the panel folds to its HEALTH chips when there is
 * no room. Checked on the widest card we have (a shipyard) at two sizes.
 */
const box = async (page: import('@playwright/test').Page, sel: string) => (await page.locator(sel).boundingBox())!;
const apart = (a: { x: number; width: number; y: number; height: number }, b: { x: number; width: number; y: number; height: number }) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

for (const size of [{ width: 1280, height: 760 }, { width: 1100, height: 700 }]) {
  test(`the panel and the selection card stay apart at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.request.delete('/api/progress');
    await page.goto('/?demo&level=principles/4');
    await expect(page.locator('#captain .bubble .title')).toHaveText('Who holds whom', { timeout: 20_000 });
    // The bubble is top right, under the portrait, and the panel bottom right.
    const bubble = await box(page, '#captain .bubble');
    expect(bubble.x + bubble.width).toBeGreaterThan(size.width - 40);
    expect(bubble.y).toBeLessThan(140);
    const portrait = await box(page, '#captain .portrait');
    expect(portrait.y + portrait.height).toBeLessThanOrEqual(bubble.y);
    const clusterBefore = await box(page, '#hud .cluster');
    expect(clusterBefore.y + clusterBefore.height).toBeGreaterThan(size.height - 40);
    expect(clusterBefore.x + clusterBefore.width).toBeGreaterThan(size.width - 40);
    await page.evaluate(() => window.harbor.selection.set(['b:harbor/courier']));
    const card = page.locator('#hud .selection');
    await expect(card).toBeVisible();
    await expect(card.locator('button', { hasText: 'Roll back refit' })).toBeVisible();
    await page.waitForTimeout(600); // the slide animates
    expect(apart(await box(page, '#hud .selection'), await box(page, '#hud .cluster'))).toBe(true);
    expect(apart(await box(page, '#hud .selection'), await box(page, '#captain .bubble'))).toBe(true);
    // The HEALTH chips stay visible even when the panel folds for room.
    await expect(page.locator('#hud .cluster [data-chip="docks"]')).toBeVisible();
    // The card never crosses the Shop and Charts buttons either.
    const shop = await box(page, '#hud .hud-bottom-left');
    expect((await box(page, '#hud .selection')).x).toBeGreaterThanOrEqual(shop.x + shop.width);
    // The Expeditions button sits top centre and shows the running level.
    const exp = page.locator('#hud [data-expeditions]');
    await expect(exp.locator('.sub')).toContainText('1st Principles · 4');
    const eb = await box(page, '#hud [data-expeditions]');
    expect(Math.abs(eb.x + eb.width / 2 - size.width / 2)).toBeLessThan(4);
  });
}

test('a long step grows the bubble down the right edge instead of scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.request.delete('/api/progress');
  await page.goto('/?demo&level=principles/4');
  await expect(page.locator('#captain .bubble .title')).toHaveText('Who holds whom', { timeout: 20_000 });
  // Pour a long text into the bubble: it should show without a scrollbar up to the two-thirds cap.
  const long = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long explanation that the learner should be able to read without scrolling.`).join(' ');
  await page.evaluate((t) => { document.querySelector('#captain .bubble .text')!.textContent = t; }, long);
  const bubble = await box(page, '#captain .bubble');
  expect(bubble.height).toBeGreaterThan(760 * 0.5);
  expect(bubble.height).toBeLessThanOrEqual(760 * 0.66 + 1);
  // The right rail and the panel below stay clear of it.
  expect(apart(bubble, await box(page, '#hud .hud-right-rail'))).toBe(true);
  expect(apart(bubble, await box(page, '#hud .cluster'))).toBe(true);
});

test('with no level running the panel still makes room for a wide card', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 600 });
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
  await page.goto('/?demo');
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);
  await page.evaluate(() => window.harbor.selection.set(['b:sandbox/nginx']));
  const card = page.locator('#hud .selection');
  await expect(card.locator('button', { hasText: 'Roll back refit' })).toBeVisible();
  await page.waitForTimeout(600);
  expect(apart(await box(page, '#hud .selection'), await box(page, '#hud .cluster'))).toBe(true);
  await expect(page.locator('#hud .cluster [data-chip="docks"]')).toBeVisible();
  // Every card button can be clicked: nothing sits over the card.
  await card.locator('button', { hasText: 'Papers' }).click();
  await expect(page.locator('#papers')).toBeVisible();
});
