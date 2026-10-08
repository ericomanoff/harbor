import { expect, test } from '@playwright/test';

/**
 * Visual regression on pages that need no cluster. Baselines live next to
 * this file and are platform-specific (fonts, GPU): regenerate with
 * `make test-visual-update` on the machine that will run them.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
});

test.describe('visual', () => {
  test('style page', async ({ page }) => {
    await page.setViewportSize({ width: 1320, height: 600 });
    await page.goto('/?style');
    await page.waitForFunction(() => (window as unknown as { harbor?: { game: { scene: { keys: Record<string, { sys: { isActive(): boolean } }> } } } }).harbor?.game.scene.keys['Style']?.sys.isActive());
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('style.png', { maxDiffPixelRatio: 0.02 });
  });

  test('demo harbor at home zoom', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.goto('/?demo');
    await page.waitForFunction(() => !document.getElementById('hud')?.hidden);
    await page.waitForTimeout(600);
    // Water scrolls, ships bob, lamps pulse, toasts fade: allow a little drift
    // and ignore the toast column.
    await expect(page).toHaveScreenshot('demo-home.png', { maxDiffPixelRatio: 0.06, mask: [page.locator('#hud .toasts')] });
  });
});
