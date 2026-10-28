import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
});

test('terms get tooltips and the glossary opens on them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo');
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);

  // The selection card for a shipyard mentions ships: the words are marked up.
  await page.evaluate(() => window.harbor.selection.set(['b:sandbox/nginx']));
  const card = page.locator('#hud .selection');
  await expect(card).toBeVisible();
  const term = card.locator('abbr.term').first();
  await expect(term).toBeVisible();
  await term.hover();
  const tip = page.locator('#term-tip');
  await expect(tip).toBeVisible();
  await expect(tip.locator('.pair')).toContainText('·');
  await expect(tip.locator('.concept')).not.toBeEmpty();
  await expect(tip.locator('.harbor')).toContainText('In the harbor:');

  // Terms in the status chips (outside the selection card) hover too: the HUD lets clicks through, terms must not.
  // Open sea at the top centre: clear of the card, the tooltip (which stays while hovered) and the islands (which hover too).
  await page.mouse.move(640, 90);
  await expect(tip).toBeHidden();
  const chipTerm = page.locator('#hud .cluster abbr.term').first();
  await expect(chipTerm).toBeVisible();
  await chipTerm.hover();
  await expect(tip).toBeVisible();
  await expect(tip.locator('.pair')).toContainText('·');
  await term.hover();

  // Hovering a shipyard's flag on the map names the fleet; clicking it opens the Fleets filter on that fleet.
  const flag = await page.evaluate(() => (window.harbor.game.scene.keys['Map'] as { screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined }).screenRectOf('flag:sandbox/nginx')!);
  await page.mouse.move(flag.x + flag.width / 2, flag.y + flag.height / 2);
  await expect(tip).toBeVisible();
  await expect(tip.locator('.pair')).toContainText('sandbox');
  await page.mouse.click(flag.x + flag.width / 2, flag.y + flag.height / 2);
  await expect(page.locator('#filter')).toBeVisible();
  await expect(page.locator('#filter .list label.highlight')).toContainText('sandbox');
  await page.keyboard.press('Escape');
  // The readiness bar above the shipyard carries its live numbers.
  const bar = await page.evaluate(() => (window.harbor.game.scene.keys['Map'] as { screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined }).screenRectOf('bar:sandbox/nginx')!);
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect(tip).toBeVisible();
  await expect(tip.locator('.pair')).toContainText('ready replicas');
  await expect(tip.locator('.pair')).toContainText('3/3');
  await term.hover();

  // Clicking a term opens the glossary at that entry.
  const id = await term.getAttribute('data-term');
  await term.click();
  const glossary = page.locator('#glossary');
  await expect(glossary).toBeVisible();
  await expect(glossary.locator('ul.entries li.active')).toHaveAttribute('data-id', id!);
  await glossary.locator('input[name=q]').fill('Deployment');
  await expect(glossary.locator('ul.entries li').first()).toContainText('Deployment · shipyard');
  await expect(glossary.locator('.detail .use')).toContainText('Use it');
  await page.keyboard.press('Escape');
  await expect(glossary).toBeHidden();

  // G opens it too; both-languages shows the Kubernetes word beside the naval one.
  await page.mouse.click(640, 700);
  await page.keyboard.press('g');
  await expect(glossary).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.harbor.settings.bothLanguages = true; window.harbor.settings.changed.emit(); });
  await expect(card.locator('abbr.term .k8s').first()).toBeVisible();
});
