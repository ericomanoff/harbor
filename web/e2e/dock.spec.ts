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
    // The bubble is top right, under the portrait and its Tour and Expeditions buttons; the panel bottom right.
    const bubble = await box(page, '#captain .bubble');
    expect(bubble.x + bubble.width).toBeGreaterThan(size.width - 40);
    expect(bubble.y).toBeLessThan(190);
    const portrait = await box(page, '#hud .portrait');
    expect(portrait.y + portrait.height).toBeLessThanOrEqual(bubble.y);
    const btns = await box(page, '#hud .captain-btns');
    expect(btns.y + btns.height).toBeLessThanOrEqual(bubble.y);
    const clusterBefore = await box(page, '#hud .cluster');
    expect(clusterBefore.y + clusterBefore.height).toBeGreaterThan(size.height - 40);
    expect(clusterBefore.x + clusterBefore.width).toBeGreaterThan(size.width - 40);
    await page.evaluate(() => window.harbor.selection.set(['b:harbor/courier']));
    const card = page.locator('#hud .selection');
    await expect(card).toBeVisible();
    await expect(card.locator('button', { hasText: 'Roll back refit' })).toBeVisible();
    // The slide animates: poll until the card has settled clear of both.
    await expect.poll(async () => apart(await box(page, '#hud .selection'), await box(page, '#hud .cluster')), { timeout: 3000 }).toBe(true);
    await expect.poll(async () => apart(await box(page, '#hud .selection'), await box(page, '#captain .bubble')), { timeout: 3000 }).toBe(true);
    // The HEALTH chips stay visible even when the panel folds for room.
    await expect(page.locator('#hud .cluster [data-chip="docks"]')).toBeVisible();
    // The card never crosses the Shop and Charts buttons either.
    const shop = await box(page, '#hud .hud-bottom-left');
    expect((await box(page, '#hud .selection')).x).toBeGreaterThanOrEqual(shop.x + shop.width);
    // The Expeditions button sits under Huber at the top right and shows the running level.
    const exp = page.locator('#hud [data-expeditions]');
    await expect(exp.locator('.sub')).toContainText('1st Principles · 4');
    const eb = await box(page, '#hud [data-expeditions]');
    expect(eb.x + eb.width).toBeGreaterThan(size.width - 40);
    expect(eb.y).toBeLessThan(bubble.y);
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
  // The cluster panel below stays clear of it.
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

test('toasts stack above the cluster panel and never climb past the bubble', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.request.delete('/api/progress');
  await page.goto('/?demo&level=principles/4');
  await expect(page.locator('#captain .bubble .title')).toHaveText('Who holds whom', { timeout: 20_000 });
  const long = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long explanation that the learner should be able to read without scrolling.`).join(' ');
  await page.evaluate((t) => { document.querySelector('#captain .bubble .text')!.textContent = t; }, long);
  // A burst of four announcements.
  await page.evaluate(() => {
    const root = document.querySelector('#hud .toasts')!;
    for (const t of ['Ship launched: nginx-7d9-z1', 'Harbor master online', 'LOW POWER', 'Ship launched: courier-5f-a2']) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = t;
      root.appendChild(el);
    }
  });
  await page.waitForTimeout(300);
  const bubble = await box(page, '#captain .bubble');
  const toasts = await box(page, '#hud .toasts');
  const cluster = await box(page, '#hud .cluster');
  // The toasts sit at the bottom right, between the bubble and the panel.
  expect(toasts.x + toasts.width).toBeGreaterThan(1280 - 40);
  expect(toasts.y).toBeGreaterThanOrEqual(bubble.y + bubble.height);
  expect(toasts.y + toasts.height).toBeLessThanOrEqual(cluster.y);
  // The newest announcement is the one that stays visible when the column is clipped.
  const newest = page.locator('#hud .toast').last();
  await expect(newest).toBeInViewport();
  const nb = (await newest.boundingBox())!;
  expect(nb.y).toBeGreaterThanOrEqual(toasts.y);
  // The portrait opens the library.
  await page.locator('#hud .portrait').click();
  await expect(page.locator('#expeditions')).toBeVisible();
});
