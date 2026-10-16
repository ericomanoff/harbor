import { expect, test, type Page } from '@playwright/test';

/**
 * Plays 1st Principles levels 1 to 3 in the training harbor: desired state
 * (apply), the loop (blackout and prediction), one door (ledger actors and
 * the tide keeper operator).
 */
const title = (page: Page) => page.locator('#tour .bubble .title');
const next = (page: Page) => page.locator('[data-tour=next]');
const action = (page: Page) => page.locator('[data-tour=action]');

type MapHandle = { layout: { plateaus: { node: string; w: number; h: number }[] }; screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined; focusKey(k: string): void };

async function clickMapKey(page: Page, key: string): Promise<void> {
  await page.waitForFunction((k) => ((window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(k)?.width ?? 0) > 0, key);
  const r = await page.evaluate((k) => (window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(k)!, key);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}

async function clickIslandSite(page: Page, node: string): Promise<void> {
  await page.waitForFunction((n) => ((window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(`dock:${n}`)?.width ?? 0) > 0, node);
  await page.evaluate((n) => (window.harbor.game.scene.keys['Map'] as MapHandle).focusKey(`dock:${n}`), node);
  await page.waitForTimeout(500);
  const pt = await page.evaluate((n) => {
    const m = window.harbor.game.scene.keys['Map'] as MapHandle;
    const p = m.layout.plateaus.find((x) => x.node === n)!;
    const r = m.screenRectOf(`dock:${n}`)!;
    return { x: r.x + (r.width * 2.5) / p.w, y: r.y + (r.height * 2.5) / p.h };
  }, node);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y);
}

async function applyReplicas(page: Page, n: number): Promise<void> {
  await action(page).click();
  const form = page.locator('#apply-form');
  await expect(form).toBeVisible();
  const text = await form.locator('textarea').inputValue();
  await form.locator('textarea').fill(text.replace(/replicas: \d+/, `replicas: ${n}`));
  await form.locator('button[type=submit]').click();
  await expect(form.locator('.apply-item')).toBeVisible();
  await form.locator('button[data-cancel]').click();
}

async function finishAndContinue(page: Page): Promise<void> {
  await expect(next(page)).toHaveText('Finish');
  await next(page).click();
  await expect(page.locator('#success')).toBeVisible();
  await page.locator('#success [data-continue]').click();
  await expect(page.locator('#summary')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.request.delete('/api/progress');
});

test('1st Principles is first in the library and level 1 plays', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?demo&expeditions');
  const select = page.locator('#expeditions');
  await expect(select.locator('.expedition').first()).toHaveAttribute('data-campaign', 'principles', { timeout: 15_000 });
  await expect(select.locator('.expedition').nth(1)).toHaveAttribute('data-campaign', 'advanced');
  await select.locator('.row.level[data-level="principles/1"] button').click();

  await expect(title(page)).toHaveText('Two documents, one object');
  await clickMapKey(page, 'b:harbor/courier');
  await page.locator('#hud .selection button', { hasText: 'Papers' }).click();
  await expect(title(page)).toHaveText('spec and status agree');
  await expect(page.locator('#papers pre.spec')).toContainText('replicas: 3');
  await page.locator('#papers button[data-close]').click();
  await expect(title(page)).toHaveText('An order, not a record');
  await expect(title(page)).toHaveText('Write the wish down', { timeout: 15_000 });
  await applyReplicas(page, 4);
  await expect(title(page)).toHaveText('spec leads, status follows');
  await clickMapKey(page, 'b:harbor/courier');
  await page.locator('#hud .selection button', { hasText: 'Papers' }).click();
  await expect(title(page)).toHaveText('Apply it again', { timeout: 20_000 });
  await page.locator('#papers button[data-close]').click();
  await applyReplicas(page, 4);
  await expect(title(page)).toHaveText('Change the record, not the ships');
  await applyReplicas(page, 2);
  await expect(title(page)).toHaveText('The record outlives the ship', { timeout: 20_000 });
  await expect(title(page)).toHaveText('Your manifests are the desired state', { timeout: 20_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl apply -f');
  await page.locator('#summary [data-next]').click();

  // Level 2: the loop.
  await expect(title(page)).toHaveText('A loop, not a to-do list');
  await page.locator('#hud [data-rail=ledger]').click();
  await expect(page.locator('#ledger .row', { hasText: 'nothing to do' }).first()).toBeVisible();
  await expect(title(page)).toHaveText('The controller goes deaf');
  await page.locator('#ledger button[data-close]').click();
  await expect(title(page)).toHaveText('What happens when it hears again?', { timeout: 15_000 });
  await page.locator('#tour .choices button', { hasText: 'stay sunk' }).click();
  await expect(page.locator('#tour .result')).toHaveClass(/fail/);
  await page.locator('#tour .choices button', { hasText: 'launches 2' }).click();
  await expect(page.locator('#tour .result')).toHaveClass(/ok/);
  await expect(title(page)).toHaveText('Level-triggered');
  await expect(title(page)).toHaveText('An island goes dark', { timeout: 20_000 });
  await expect(title(page)).toHaveText('Self-healing falls out of the design', { timeout: 20_000 });
  await finishAndContinue(page);
  await expect(page.locator('#success .stars span.on')).toHaveCount(2); // the wrong guess cost a star
  await page.locator('#summary [data-next]').click();

  // Level 3: one door.
  await expect(title(page)).toHaveText('Watch who writes');
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  await clickIslandSite(page, 'harbor-worker');
  const bf = page.locator('#build-form form');
  await bf.locator('select[name=ns]').selectOption('harbor');
  await bf.locator('input[name=name]').fill('courier');
  await bf.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Four hands, one door', { timeout: 15_000 });
  await page.locator('#hud [data-rail=ledger]').click();
  await expect(title(page)).toHaveText('A kind of your own', { timeout: 15_000 });
  await page.locator('#ledger button[data-close]').click();
  await action(page).click();
  await expect(page.locator('#tour .result')).toContainText('kind: TideTable');
  await next(page).click();
  await expect(title(page)).toHaveText('Post a tide keeper');
  await action(page).click();
  await expect(title(page)).toHaveText('Change the tide', { timeout: 30_000 });
  await action(page).click();
  await expect(title(page)).toHaveText('Dismiss the keeper', { timeout: 40_000 });
  await action(page).click(); // dismiss + highWater 2
  await expect(page.locator('#tour .result')).toContainText('nothing moves');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.harbor.store.deployments.get('harbor/courier')?.replicas)).toBe(5);
  await action(page).click(); // post again
  await expect(title(page)).toHaveText('Extensible by construction', { timeout: 30_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('kind: TideTable');
  await expect(page.locator('#summary [data-next]')).toBeHidden();
});
