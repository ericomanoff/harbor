import { expect, test } from '@playwright/test';

/**
 * Captain Huber's dock never overlaps the selection card or the toasts:
 * the bottom-centre column slides left by what is measured, and the dock
 * folds when there is no room. Checked on the widest card we have (a
 * shipyard) at two window sizes.
 */
const box = async (page: import('@playwright/test').Page, sel: string) => (await page.locator(sel).boundingBox())!;
const apart = (a: { x: number; width: number; y: number; height: number }, b: { x: number; width: number; y: number; height: number }) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

for (const size of [{ width: 1280, height: 760 }, { width: 1100, height: 700 }]) {
  test(`the dock and the selection card stay apart at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.request.delete('/api/progress');
    await page.goto('/?demo&level=principles/4');
    await expect(page.locator('#captain .bubble .title')).toHaveText('Who holds whom', { timeout: 20_000 });
    await page.evaluate(() => window.harbor.selection.set(['b:harbor/courier']));
    const card = page.locator('#hud .selection');
    await expect(card).toBeVisible();
    await expect(card.locator('button', { hasText: 'Roll back refit' })).toBeVisible();
    await page.waitForTimeout(600); // the slide animates
    expect(apart(await box(page, '#hud .selection'), await box(page, '#captain .bubble'))).toBe(true);
    // The card never crosses the Shop and Charts buttons either.
    const shop = await box(page, '#hud .hud-bottom-left');
    expect((await box(page, '#hud .selection')).x).toBeGreaterThanOrEqual(shop.x + shop.width);
    // The Expeditions button sits top centre and shows the running level.
    const exp = page.locator('#hud [data-expeditions]');
    await expect(exp.locator('.sub')).toContainText('1st Principles · 4');
    const eb = await box(page, '#hud [data-expeditions]');
    if (size.width >= 1200) expect(Math.abs(eb.x + eb.width / 2 - size.width / 2)).toBeLessThan(4);
    // On narrow windows it steps left of centre, clear of the cluster panel.
    const cluster = await box(page, '#hud .cluster');
    expect(eb.x + eb.width).toBeLessThanOrEqual(cluster.x);
  });
}
