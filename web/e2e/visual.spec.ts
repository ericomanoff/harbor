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

  test('loading screen while hailing the harbor master', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Keep the backend from answering so the splash sits at the backend stage.
    await page.route('**/api/healthz', () => { /* never fulfilled */ });
    await page.goto('/');
    await expect(page.locator('#splash .status')).toHaveText('Hailing the harbor master…');
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('splash-hailing.png', { maxDiffPixelRatio: 0.02, mask: [page.locator('#splash .tip')] });
  });

  test('loading screen when no harbor answers', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/healthz', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#splash .status')).toContainText('No harbor in sight');
    await expect(page.locator('#splash button[data-demo]')).toBeVisible();
    await expect(page).toHaveScreenshot('splash-failed.png', { maxDiffPixelRatio: 0.02, mask: [page.locator('#splash .tip')] });
    // The demo button is the way out.
    await page.locator('#splash button[data-demo]').click();
    await page.waitForFunction(() => !document.getElementById('hud')?.hidden, null, { timeout: 15_000 });
    await expect(page.locator('#splash')).toBeHidden();
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

  test('a glossary tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
    await page.goto('/?demo');
    await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);
    await page.evaluate(() => window.harbor.selection.set(['b:sandbox/nginx']));
    const term = page.locator('#hud .selection abbr.term[data-term=shipyard]').first();
    await term.hover();
    const tip = page.locator('#term-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveScreenshot('tooltip-shipyard.png');
  });
});
