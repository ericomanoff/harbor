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
  await page.mouse.move(640, 400);
  await expect(tip).toBeHidden();
  const chipTerm = page.locator('#hud .chips abbr.term').first();
  await expect(chipTerm).toBeVisible();
  await chipTerm.hover();
  await expect(tip).toBeVisible();
  await expect(tip.locator('.pair')).toContainText('·');
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
