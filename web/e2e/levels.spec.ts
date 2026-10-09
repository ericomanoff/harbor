import { expect, test, type Page } from '@playwright/test';

/**
 * Plays Harbor Academy levels 1 and 2 end to end in the training harbor
 * (no cluster needed), then checks stars, locks and the summary card.
 */
const title = (page: Page) => page.locator('#tour .bubble .title');
const next = (page: Page) => page.locator('[data-tour=next]');

type MapHandle = { layout: { plateaus: { node: string; w: number; h: number }[] }; screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined };

async function clickMapKey(page: Page, key: string): Promise<void> {
  await page.waitForFunction((k) => ((window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(k)?.width ?? 0) > 0, key);
  const r = await page.evaluate((k) => (window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(k)!, key);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}

/** Clicks the first structure cell of an island: one tile in from the corner, cells are 3x3 tiles. */
async function clickIslandSite(page: Page, node: string): Promise<void> {
  await page.waitForFunction((n) => ((window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(`dock:${n}`)?.width ?? 0) > 0, node);
  const pt = await page.evaluate((n) => {
    const m = window.harbor.game.scene.keys['Map'] as MapHandle;
    const p = m.layout.plateaus.find((x) => x.node === n)!;
    const r = m.screenRectOf(`dock:${n}`)!;
    return { x: r.x + (r.width * 2.5) / p.w, y: r.y + (r.height * 2.5) / p.h };
  }, node);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y);
}

async function finishAndContinue(page: Page): Promise<void> {
  await expect(next(page)).toHaveText('Finish');
  await next(page).click();
  const success = page.locator('#success');
  await expect(success).toBeVisible();
  await expect(success.locator('.eyebrow')).toHaveText('HARBOR SECURED');
  await expect(success.locator('.stars span.on')).toHaveCount(3, { timeout: 5000 });
  await success.locator('[data-continue]').click();
  await expect(page.locator('#summary')).toBeVisible();
}

test('Harbor Select lists the academy with level 2 locked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo&academy');
  const select = page.locator('#academy');
  await expect(select).toBeVisible({ timeout: 15_000 });
  await expect(select.locator('.row.level')).toHaveCount(5);
  await expect(select.locator('.row.level[data-level="academy/2"]')).toHaveClass(/locked/);
  await expect(select.locator('.row.level[data-level="academy/2"] button')).toBeDisabled();
  await select.locator('.row.level[data-level="academy/1"] button').click();
  await expect(select).toBeHidden();
  await expect(title(page)).toHaveText('Welcome to the academy');
  await page.locator('[data-tour=skip]').click(); // Leave level
  await expect(page.locator('#tour')).toBeHidden();
  await expect(select).toBeVisible();
});

test('levels 1 and 2 play through, award stars and unlock the next', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo&level=academy/1');
  const tour = page.locator('#tour');
  await expect(tour).toBeVisible({ timeout: 15_000 });
  await expect(title(page)).toHaveText('Welcome to the academy');
  await expect(page.locator('#hud [data-chip=link]')).toHaveText('demo');

  // Level 1: inspect the lone ship, read its log, watch it sink twice.
  await next(page).click();
  await expect(title(page)).toHaveText('Ships are pods');
  await clickMapKey(page, 'u:harbor/courier');
  await expect(title(page)).toHaveText('Cargo is containers');
  await page.locator('#hud .selection button', { hasText: "Ship's log" }).click();
  await expect(title(page)).toHaveText("The ship's log");
  await page.locator('#logs button[data-close]').click();
  await expect(title(page)).toHaveText('A reef!');
  await expect(title(page)).toHaveText('Pods are mortal', { timeout: 10_000 });
  await next(page).click();
  await expect(title(page)).toHaveText('The same reef');
  await expect(title(page)).toHaveText('What a pod is', { timeout: 10_000 });
  await finishAndContinue(page);
  const summary = page.locator('#summary');
  await expect(summary.locator('h2 .lvl')).toHaveText('Level 1: A ship and its cargo');
  await expect(summary.locator('[data-col=k8s]')).toContainText('Pod');
  await expect(summary.locator('pre.yaml')).toContainText('kind: Pod');
  await summary.locator('[data-next]').click();

  // Level 2: build a shipyard and watch it relaunch the sunk ship.
  await expect(title(page)).toHaveText('Same reef, same sea');
  await expect(title(page)).toHaveText('Build a shipyard', { timeout: 15_000 });
  await page.locator('[data-tour=hint]').click(); // costs a star
  await expect(tour.locator('.hint')).toBeVisible();
  await page.locator('#hud [data-shop-open]').click();
  await expect(title(page)).toHaveText('The shipyard card');
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect(title(page)).toHaveText('Choose a site');
  await clickIslandSite(page, 'harbor-worker');
  await expect(title(page)).toHaveText("The ship's manifest");
  const form = page.locator('#build-form form');
  await form.locator('select[name=ns]').selectOption('harbor');
  await form.locator('input[name=name]').fill('courier');
  await expect(form.locator('details.manifest pre')).toContainText('name: courier');
  await form.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('The reef again', { timeout: 15_000 });
  await expect(title(page)).toHaveText('Desired state', { timeout: 20_000 });
  await expect(next(page)).toHaveText('Finish');
  await next(page).click();
  const success = page.locator('#success');
  await expect(success).toBeVisible();
  await expect(success.locator('.stars span.on')).toHaveCount(2, { timeout: 5000 }); // one hint used
  await success.locator('[data-continue]').click();
  await expect(summary).toBeVisible();
  await expect(summary.locator('pre.yaml')).toContainText('kind: Deployment');
  await expect(summary.locator('pre.kubectl')).toContainText('kubectl create deployment courier');
  await expect(summary.locator('[data-next]')).toBeVisible();
  await summary.locator('[data-select]').click();

  // Back at Harbor Select: both levels completed, stars kept, level 3 open and the rest locked.
  const select = page.locator('#academy');
  await expect(select).toBeVisible();
  await expect(select.locator('.row.level[data-level="academy/1"] .stars')).toHaveText('★★★');
  await expect(select.locator('.row.level[data-level="academy/2"] .stars')).toHaveText('★★☆');
  await expect(select.locator('.row.level[data-level="academy/3"] button')).toBeEnabled();
  await expect(select.locator('.row.level.locked')).toHaveCount(2);
  await expect(select.locator('.row.level[data-level="academy/2"] button')).toHaveText('REPLAY');
  expect(await page.evaluate(() => fetch('/api/progress').then((r) => r.json()))).toMatchObject({ levels: { 'academy/1': { stars: 3 }, 'academy/2': { stars: 2 } } });
});

/** The map scene exposes `layout.plateaus`; a free structure cell is one tile in from the island corner. */
async function fillShipyard(page: Page, name: string, extra: Record<string, string> = {}): Promise<void> {
  const form = page.locator('#build-form form');
  await form.locator('select[name=ns]').selectOption('harbor');
  await form.locator('input[name=name]').fill(name);
  for (const [k, v] of Object.entries(extra)) await form.locator(`input[name=${k}]`).fill(v);
  await form.locator('button[type=submit]').click();
}

test('levels 3 to 5: scaling, lookouts and the lighthouse', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 760 });

  // Level 3: ride out the storm with three ships.
  await page.goto('/?demo&level=academy/3');
  await expect(title(page)).toHaveText('A lighthouse for the fleet', { timeout: 15_000 });
  await next(page).click();
  await expect(title(page)).toHaveText('Storm season');
  await expect(title(page)).toHaveText('More ships', { timeout: 15_000 });
  await clickMapKey(page, 'b:harbor/courier');
  await expect(title(page)).toHaveText('Launch ships');
  const launch = page.locator('#hud .selection button', { hasText: 'Launch ship' });
  await launch.click();
  await launch.click();
  await expect(title(page)).toHaveText('The storm returns', { timeout: 15_000 });
  await expect(title(page)).toHaveText('Replicas', { timeout: 15_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl scale deployment courier --replicas=3');
  await page.locator('#summary [data-next]').click();

  // Level 4: a shipyard with lookouts, then sell the old one.
  await expect(title(page)).toHaveText('A broken hull');
  await next(page).click();
  await expect(title(page)).toHaveText('Post lookouts');
  await page.locator('#hud [data-shop-open]').click();
  await expect(title(page)).toHaveText('A new shipyard');
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect(title(page)).toHaveText('Choose a site');
  await clickIslandSite(page, 'harbor-control-plane');
  await expect(title(page)).toHaveText('Lookouts on the manifest');
  await expect(page.locator('#build-form .lookouts')).toBeVisible();
  await fillShipyard(page, 'courier-v2', { port: '80', readiness: '/ready', liveness: '/healthz' });
  await expect(title(page)).toHaveText('Retire the old shipyard', { timeout: 15_000 });
  await clickMapKey(page, 'b:harbor/courier');
  const sell = page.locator('#hud .selection button', { hasText: 'Sell shipyard' });
  await sell.click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click();
  await expect(title(page)).toHaveText('The hull breaks again', { timeout: 10_000 });
  await expect(title(page)).toHaveText('Two questions', { timeout: 20_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('livenessProbe');
  await page.locator('#summary [data-next]').click();

  // Level 5: light a lighthouse for the courier fleet.
  await expect(title(page)).toHaveText('A trader with an address');
  await next(page).click();
  await expect(title(page)).toHaveText('The address is gone');
  await expect(title(page)).toHaveText('Light a lighthouse', { timeout: 15_000 });
  await page.locator('#hud [data-shop-open]').click();
  await expect(title(page)).toHaveText('The Lighthouse card');
  await page.locator('#shop [data-card=lighthouse] button').click();
  await expect(title(page)).toHaveText('Which ships?');
  const lf = page.locator('#lighthouse-form form');
  await lf.locator('select[name=ns]').selectOption('harbor');
  await lf.locator('input[name=name]').fill('courier');
  await lf.locator('select[name=fleet]').selectOption('courier');
  await expect(lf.locator('details.manifest pre')).toContainText('app: courier');
  await lf.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Ships come and go', { timeout: 15_000 });
  await expect(title(page)).toHaveText('One name, many ships', { timeout: 25_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl expose deployment courier');
  await expect(page.locator('#summary [data-next]')).toBeHidden();
  await page.locator('#summary [data-select]').click();
  const select = page.locator('#academy');
  await expect(select).toBeVisible();
  await expect(select.locator('.row.level')).toHaveCount(5);
  await expect(select.locator('.row.level[data-level="academy/5"] .stars')).toHaveText('★★★');
});
