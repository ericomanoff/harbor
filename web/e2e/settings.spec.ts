import { expect, test } from '@playwright/test';

/**
 * Settings is a popover beside the left rail, not a modal: its VIEW row
 * zooms the live map and leaves the popover open; Escape, an outside
 * click or the gear closes it; + and - zoom from the keyboard.
 */
test('settings popover: live zoom row, closes on Escape, keys zoom', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo');
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);
  const zoom = (): Promise<number> => page.evaluate(() => (window.harbor.game.scene.keys.Map as { cameras: { main: { zoom: number } } }).cameras.main.zoom);

  const popover = page.locator('#settings');
  await expect(popover).toBeHidden();
  await page.locator('#hud [data-rail=settings]').click();
  await expect(popover).toBeVisible();
  await expect(popover.locator('[data-set=sound]')).toContainText('Sound:');

  const before = await zoom();
  await popover.locator('[data-set=zoom-in]').click();
  await expect.poll(zoom).toBeGreaterThan(before);
  await expect(popover).toBeVisible();
  await popover.locator('[data-set=zoom-out]').click();
  await expect.poll(zoom).toBeLessThan(before * 1.25);

  // Escape closes it without the modal flag ever being set; the gear toggles it.
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  expect(await page.evaluate(() => window.harbor.modal.open)).toBe(false);
  await page.locator('#hud [data-rail=settings]').click();
  await expect(popover).toBeVisible();
  await page.locator('#hud [data-rail=settings]').click();
  await expect(popover).toBeHidden();

  // Keys: - zooms out, + (the = key) zooms in.
  const atHome = await zoom();
  await page.keyboard.press('Minus');
  await expect.poll(zoom).toBeLessThan(atHome);
  await page.keyboard.press('Equal');
  await expect.poll(zoom).toBeGreaterThan(atHome * 0.8);
});
