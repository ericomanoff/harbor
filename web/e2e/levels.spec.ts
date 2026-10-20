import { expect, test, type Page } from '@playwright/test';

/**
 * Plays Harbor Academy levels 1 and 2 end to end in the training harbor
 * (no cluster needed), then checks stars, locks and the summary card.
 */
const title = (page: Page) => page.locator('#captain .bubble .title');
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
  // Bring the island comfortably into view first so the site is not under the HUD.
  await page.evaluate((n) => (window.harbor.game.scene.keys['Map'] as MapHandle & { focusKey(k: string): void }).focusKey(`dock:${n}`), node);
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

// Every test starts with an empty logbook: other specs (the real-cluster one) record progress too.
test.beforeEach(async ({ page }) => {
  await page.request.delete('/api/progress');
});

test('Harbor Select lists the expeditions with level 2 locked', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo&expeditions');
  const select = page.locator('#expeditions');
  await expect(select).toBeVisible({ timeout: 15_000 });
  await expect(select.locator('.expedition[data-campaign=advanced] .row.level')).toHaveCount(10);
  await expect(select.locator('.row.level[data-level="advanced/2"]')).toHaveClass(/locked/);
  await expect(select.locator('.row.level[data-level="advanced/2"] button')).toBeDisabled();
  await select.locator('.row.level[data-level="advanced/1"] button').click();
  await expect(select).toBeHidden();
  await expect(title(page)).toHaveText('Welcome aboard');
  await page.locator('[data-tour=skip]').click(); // Leave level
  await expect(page.locator('#captain')).toBeHidden();
  await expect(select).toBeVisible();
});

test('levels 1 and 2 play through, award stars and unlock the next', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo&level=advanced/1');
  const tour = page.locator('#captain');
  await expect(tour).toBeVisible({ timeout: 15_000 });
  await expect(title(page)).toHaveText('Welcome aboard');
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
  const select = page.locator('#expeditions');
  await expect(select).toBeVisible();
  await expect(select.locator('.row.level[data-level="advanced/1"] .stars')).toHaveText('★★★');
  await expect(select.locator('.row.level[data-level="advanced/2"] .stars')).toHaveText('★★☆');
  await expect(select.locator('.row.level[data-level="advanced/3"] button')).toBeEnabled();
  await expect(select.locator('.expedition[data-campaign=advanced] .row.level.locked')).toHaveCount(7);
  await expect(select.locator('.row.level[data-level="advanced/2"] button').first()).toHaveText('REPLAY');
  expect(await page.evaluate(() => fetch('/api/progress').then((r) => r.json()))).toMatchObject({ levels: { 'advanced/1': { stars: 3 }, 'advanced/2': { stars: 2 } } });
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
  await page.goto('/?demo&level=advanced/3');
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
  await expect(page.locator('#summary [data-next]')).toBeVisible();
  await page.locator('#summary [data-select]').click();
  const select = page.locator('#expeditions');
  await expect(select).toBeVisible();
  await expect(select.locator('.expedition[data-campaign=advanced] .row.level')).toHaveCount(10);
  await expect(select.locator('.row.level[data-level="advanced/5"] .stars')).toHaveText('★★★');
});

test('levels 6 to 8: the gate, sealed orders, berths and cargo', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 760 });

  // Level 6: open a gate to the courier lighthouse.
  await page.goto('/?demo&level=advanced/6');
  await expect(title(page)).toHaveText('Traders outside the breakwater', { timeout: 15_000 });
  await next(page).click();
  await expect(title(page)).toHaveText('Open a gate');
  await page.locator('#hud [data-shop-open]').click();
  await expect(title(page)).toHaveText('The Gate card');
  await page.locator('#shop [data-card=gate] button').click();
  await expect(title(page)).toHaveText('Host, path, lighthouse');
  const gate = page.locator('#gate-form form');
  await gate.locator('select[name=ns]').selectOption('harbor');
  await gate.locator('input[name=name]').fill('shop');
  await gate.locator('input[name=host]').fill('shop.example');
  await gate.locator('select[name=service]').selectOption('courier');
  await gate.locator('input[name=tls]').check();
  await gate.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Traders come in', { timeout: 10_000 });
  await next(page).click();
  await expect(title(page)).toHaveText('The gate and its keeper');
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('kind: Ingress');
  await expect(page.locator('#summary pre.yaml')).toContainText('host: shop.example');
  await page.locator('#summary [data-next]').click();

  // Level 7: seal orders, then a shipyard that reads them.
  await expect(title(page)).toHaveText('Orders painted on the hull');
  await next(page).click();
  await expect(title(page)).toHaveText('Seal the orders');
  await page.locator('#hud [data-shop-open]').click();
  await expect(title(page)).toHaveText('Sealed orders');
  await page.locator('#shop [data-card=orders] button').click();
  await expect(title(page)).toHaveText('A chart locker');
  const of = page.locator('#orders-form form');
  await of.locator('select[name=kind]').selectOption('ConfigMap');
  await of.locator('select[name=ns]').selectOption('harbor');
  await of.locator('input[name=name]').fill('courier-orders');
  await of.locator('textarea[name=data]').fill('PORT=8443\nREGION=north');
  await expect(of.locator('details.manifest pre')).toContainText('PORT: "8443"');
  await of.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('A shipyard that reads them');
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  await clickIslandSite(page, 'harbor-control-plane');
  const bf = page.locator('#build-form form');
  await expect(bf).toBeVisible();
  await bf.locator('select[name=ns]').selectOption('harbor');
  await bf.locator('select[name=orders]').selectOption('ConfigMap/courier-orders');
  await bf.locator('input[name=name]').fill('courier-v2');
  await expect(bf.locator('details.manifest pre')).toContainText('configMapRef');
  await bf.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('The orders change', { timeout: 15_000 });
  await expect(title(page)).toHaveText('Image and configuration, apart', { timeout: 20_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('kind: ConfigMap');
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl create configmap courier-orders');
  await page.locator('#summary [data-next]').click();

  // Level 8: sell the greedy hog, rebuild it with requests and limits.
  await expect(title(page)).toHaveText('A greedy ship');
  await expect(page.locator('#hud .selection')).toBeHidden();
  await next(page).click();
  await expect(title(page)).toHaveText('Overloaded and sunk');
  await next(page).click();
  await expect(title(page)).toHaveText('Retire the hog');
  await clickMapKey(page, 'b:harbor/hog');
  await page.locator('#hud .selection button', { hasText: 'Sell shipyard' }).click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click();
  await expect(title(page)).toHaveText('The courier moors', { timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => window.harbor.store.pods.get('harbor/courier-a')?.ready), { timeout: 10_000 }).toBe(true);
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  await clickIslandSite(page, 'harbor-worker');
  await expect(title(page)).toHaveText('A fair berth and a cargo cap');
  await fillShipyard(page, 'hog', { cpu: '250m', mem: '64Mi', cpuLimit: '500m', memLimit: '128Mi' });
  await expect(title(page)).toHaveText('The hog tries again', { timeout: 15_000 });
  await next(page).click();
  await expect(title(page)).toHaveText('Requests and limits');
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('limits:');
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl set resources deployment/hog');
  await expect(page.locator('#summary [data-next]')).toBeVisible();
  await page.locator('#summary [data-select]').click();
  const select = page.locator('#expeditions');
  await expect(select).toBeVisible();
  await expect(select.locator('.expedition[data-campaign=advanced] .row.level')).toHaveCount(10);
  await expect(select.locator('.row.level[data-level="advanced/8"] .stars')).toHaveText('★★★');
});

test('levels 9 and 10: fleets and ensigns, refit at sea', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 760 });

  // Level 9: found the ferry fleet, move the crew, light its lighthouse, retire the impostor.
  await page.goto('/?demo&level=advanced/9');
  await expect(title(page)).toHaveText('Two crews, one basin', { timeout: 15_000 });
  await next(page).click();
  await expect(title(page)).toHaveText('Found a fleet');
  await page.locator('#hud [data-shop-open]').click();
  await expect(title(page)).toHaveText('New fleet');
  await page.locator('#shop [data-card=fleet-ns] button').click();
  await expect(title(page)).toHaveText('Name the fleet');
  await page.locator('#fleet-form input[name=name]').fill('ferry');
  await page.locator('#fleet-form button[type=submit]').click();
  await expect(title(page)).toHaveText('Move the ferry crew');
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  await clickIslandSite(page, 'harbor-control-plane');
  const bf = page.locator('#build-form form');
  await expect(bf).toBeVisible();
  await bf.locator('select[name=ns]').selectOption('ferry');
  await bf.locator('input[name=name]').fill('ferry');
  await bf.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Their own lighthouse', { timeout: 15_000 });
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=lighthouse] button').click();
  const lf = page.locator('#lighthouse-form form');
  await lf.locator('select[name=ns]').selectOption('ferry');
  await lf.locator('select[name=fleet]').selectOption('ferry');
  await lf.locator('input[name=name]').fill('ferry');
  await lf.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Retire the impostor');
  await clickMapKey(page, 'b:harbor/ferry');
  await page.locator('#hud .selection button', { hasText: 'Sell shipyard' }).click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click();
  await expect(title(page)).toHaveText('Each beam its own crew', { timeout: 10_000 });
  await next(page).click();
  await expect(title(page)).toHaveText('One fleet at a time');
  await page.locator('#hud [data-rail=fleets]').click();
  await page.locator('#filter .list label', { hasText: 'harbor' }).locator('input').uncheck();
  await page.locator('#filter button[data-close]').click();
  await expect(title(page)).toHaveText('Namespaces and labels');
  expect(await page.evaluate(() => window.harbor.settings.hiddenNamespaces.size)).toBe(0);
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('kind: Namespace');
  await page.locator('#summary [data-next]').click();

  // Level 10: a burning refit, roll back, then a careful refit.
  await expect(title(page)).toHaveText('A refit goes wrong');
  await expect(title(page)).toHaveText('Roll back', { timeout: 15_000 });
  await clickMapKey(page, 'b:harbor/courier');
  await page.locator('#hud .selection button', { hasText: 'Roll back refit' }).click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click();
  await expect(title(page)).toHaveText('Refit, carefully', { timeout: 30_000 });
  await page.locator('#hud .selection button', { hasText: 'Refit shipyard' }).click();
  const rf = page.locator('#refit-form form');
  await expect(rf).toBeVisible();
  await rf.locator('input[name=image]').fill('ghcr.io/example/courier:2.1');
  await rf.locator('input[name=maxUnavailable]').fill('0');
  await expect(rf.locator('details.manifest pre')).toContainText('maxUnavailable: 0');
  await rf.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Rollouts and revisions', { timeout: 30_000 });
  await expect(page.locator('#hud .selection')).toBeHidden();
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl rollout undo deployment/courier');
  await expect(page.locator('#summary [data-next]')).toBeHidden();
  await page.locator('#summary [data-select]').click();
  const select = page.locator('#expeditions');
  await expect(select).toBeVisible();
  await expect(select.locator('.expedition[data-campaign=advanced] .row.level')).toHaveCount(10);
  await expect(select.locator('.row.level[data-level="advanced/10"] .stars')).toHaveText('★★★');
});

test('challenge mode: level 2 with objectives and the clock, no bubbles', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/?demo&level=advanced/2&challenge');
  const bar = page.locator('#challenge');
  await expect(bar).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#captain')).toBeHidden();
  await expect(bar.locator('.lvl')).toHaveText('Challenge · The shipyard');
  await expect(bar.locator('.objectives li')).toHaveCount(6);
  await expect(bar.locator('.objectives li.now')).toHaveText('Same reef, same sea');
  await expect(bar.locator('.objectives li.now')).toHaveText('Open the Shop', { timeout: 15_000 });
  await page.locator('#hud [data-shop-open]').click();
  await expect(bar.locator('.objectives li.now')).toHaveText('Press Build on the Shipyard card');
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  await clickIslandSite(page, 'harbor-worker');
  await expect(bar.locator('.objectives li.now')).toHaveText('Fill it in and press BUILD');
  await fillShipyard(page, 'courier');
  await expect(bar.locator('.objectives li.done')).toHaveCount(5, { timeout: 15_000 });
  const success = page.locator('#success');
  await expect(success).toBeVisible({ timeout: 20_000 });
  await expect(success.locator('.stars span.on')).toHaveCount(3, { timeout: 5000 });
  await expect(bar).toBeHidden();
  await success.locator('[data-continue]').click();
  await page.locator('#summary [data-select]').click();
  const row = page.locator('#expeditions .row.level[data-level="advanced/2"]');
  await expect(row.locator('.best')).toContainText('best 0:');
  await expect(row.locator('button[data-challenge]')).toBeVisible();
  await expect(row.locator('button[data-real]')).toHaveCount(0); // demo harbor: nothing to do it for real on
});
