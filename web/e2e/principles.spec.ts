import { expect, test, type Page } from '@playwright/test';

/**
 * Plays 1st Principles levels 1 to 3 in the training harbor: desired state
 * (apply), the loop (blackout and prediction), one door (ledger actors and
 * the tide keeper operator).
 */
const title = (page: Page) => page.locator('#captain .bubble .title');
const next = (page: Page) => page.locator('[data-tour=next]');
const action = (page: Page) => page.locator('[data-tour=action]');

type MapHandle = { layout: { plateaus: { node: string; w: number; h: number }[] }; screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined; focusKey(k: string): void };

async function clickMapKey(page: Page, key: string): Promise<void> {
  await page.waitForFunction((k) => ((window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(k)?.width ?? 0) > 0, key);
  // Pan the target into view (clear of the bubble), then wait until its rect holds still: ships sail to their berth at level start.
  await page.evaluate((k) => (window.harbor.game.scene.keys['Map'] as MapHandle).focusKey(k), key);
  const read = () => page.evaluate((k) => (window.harbor.game.scene.keys['Map'] as MapHandle & { units?: Map<string, { x: number; y: number }> }).screenRectOf(k)!, key);
  let r = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(200);
    const r2 = await read();
    const still = Math.abs(r2.x - r.x) < 0.5 && Math.abs(r2.y - r.y) < 0.5;
    r = r2;
    if (still && i > 0) break;
  }
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.waitForTimeout(120);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}

const TILE = 32;

/** Clicks a free structure cell, preferring the given island; the camera is centred on it first. */
async function clickIslandSite(page: Page, node: string): Promise<void> {
  await page.waitForFunction((n) => ((window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(`dock:${n}`)?.width ?? 0) > 0, node);
  const cell = await page.evaluate((n) => {
    const m = window.harbor.game.scene.keys['Map'] as { layout: { plateaus: { node: string; x: number; y: number; w: number }[]; buildings: Map<string, { x: number; y: number; kind: string }> } };
    const taken = new Set([...m.layout.buildings.values()].filter((b) => b.kind === 'plateau').map((b) => `${b.x},${b.y}`));
    const plateaus = [...m.layout.plateaus].sort((a, b) => Number(b.node === n) - Number(a.node === n));
    for (const p of plateaus) {
      const cols = Math.floor((p.w - 2) / 3);
      for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
        const x = p.x + 1 + c * 3;
        const y = p.y + 1 + r * 3;
        if (!taken.has(`${x},${y}`)) return { x, y };
      }
    }
    throw new Error('no free cell');
  }, node);
  const at = await page.evaluate(async ([wx, wy]) => {
    const m = window.harbor.game.scene.keys['Map'] as { centerOnWorld(x: number, y: number): void; cameras: { main: { worldView: { x: number; y: number }; zoom: number } } };
    m.centerOnWorld(wx, wy);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cam = m.cameras.main;
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
  }, [cell.x * TILE + TILE * 1.5, cell.y * TILE + TILE * 1.5] as const);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(120);
  await page.mouse.click(at.x, at.y);
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
  await page.locator('#captain .choices button', { hasText: 'stay sunk' }).click();
  await expect(page.locator('#captain .result')).toHaveClass(/fail/);
  await page.locator('#captain .choices button', { hasText: 'launches 2' }).click();
  await expect(page.locator('#captain .result')).toHaveClass(/ok/);
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
  await expect(page.locator('#captain .result')).toContainText('kind: TideTable');
  await next(page).click();
  await expect(title(page)).toHaveText('Post a tide keeper');
  await action(page).click();
  await expect(title(page)).toHaveText('Change the tide', { timeout: 30_000 });
  await action(page).click();
  await expect(title(page)).toHaveText('Dismiss the keeper', { timeout: 40_000 });
  await action(page).click(); // dismiss + highWater 2
  await expect(page.locator('#captain .result')).toContainText('nothing moves');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.harbor.store.deployments.get('harbor/courier')?.replicas)).toBe(5);
  await action(page).click(); // post again
  await expect(title(page)).toHaveText('Extensible by construction', { timeout: 30_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('kind: TideTable');
  await expect(page.locator('#summary [data-next]')).toBeVisible(); // level 4 follows
});

test('levels 4 to 6: ensigns, cattle, two crews', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const papersOf = async (key: string) => {
    await clickMapKey(page, key);
    await page.locator('#hud .selection button', { hasText: 'Papers' }).click();
    await expect(page.locator('#papers pre.spec')).not.toBeEmpty();
  };
  const reaim = async (sel: string) => {
    await clickMapKey(page, 's:harbor/courier');
    await page.locator('#hud .selection button', { hasText: 'Re-aim beam' }).click();
    const f = page.locator('#ensign-form');
    await f.locator('input[name=labels]').fill(sel);
    await f.locator('button[type=submit]').click();
    await expect(f).toBeHidden();
  };
  const build = async (name: string, fields: Record<string, string>, node = 'harbor-control-plane') => {
    await page.locator('#hud [data-shop-open]').click();
    await page.locator('#shop [data-card=shipyard] button').click();
    await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
    await clickIslandSite(page, node);
    const bf = page.locator('#build-form form');
    await expect(bf).toBeVisible();
    await bf.locator('select[name=ns]').selectOption('harbor');
    await bf.locator('input[name=name]').fill(name);
    for (const [k, v] of Object.entries(fields)) await bf.locator(`input[name=${k}]`).fill(v);
    await bf.locator('button[type=submit]').click();
  };

  // Level 4: ensigns, not ropes.
  await page.goto('/?demo&level=principles/4');
  await expect(title(page)).toHaveText('Who holds whom', { timeout: 15_000 });
  await papersOf('u:harbor/courier-a');
  await expect(page.locator('#papers pre.meta')).toContainText('ownerReferences');
  await page.locator('#papers button[data-close]').click();
  await papersOf('s:harbor/courier');
  await expect(page.locator('#papers pre.spec')).toContainText('selector');
  await expect(title(page)).toHaveText('Change one ensign');
  await page.locator('#papers button[data-close]').click();
  await clickMapKey(page, 'u:harbor/courier-a');
  await page.locator('#hud .selection button', { hasText: 'Change ensign' }).click();
  await page.locator('#ensign-form input[name=labels]').fill('app=retired');
  await page.locator('#ensign-form button[type=submit]').click();
  await expect(title(page)).toHaveText('An orphan tells a story', { timeout: 15_000 });
  await clickMapKey(page, 'u:harbor/courier-a');
  await page.locator('#hud .selection button', { hasText: 'Scrap ship' }).click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click();
  await expect(title(page)).toHaveText('A canary by ensign', { timeout: 10_000 });
  await reaim('track=stable');
  await expect(title(page)).toHaveText('Hoist the stable ensign');
  await clickMapKey(page, 'b:harbor/courier');
  await page.locator('#hud .selection button', { hasText: 'Change ensign' }).click();
  await page.locator('#ensign-form input[name=labels]').fill('app=courier, track=stable');
  await page.locator('#ensign-form button[type=submit]').click();
  await clickMapKey(page, 'b:harbor/courier');
  await page.locator('#hud .selection button', { hasText: 'Refit shipyard' }).click();
  await page.locator('#refit-form button[type=submit]').click();
  await expect(title(page)).toHaveText('Launch the canary', { timeout: 40_000 });
  await build('courier-canary', { replicas: '1', labels: 'track=stable' });
  await expect(title(page)).toHaveText('When the canary burns', { timeout: 20_000 });
  await clickMapKey(page, 'b:harbor/courier-canary');
  await page.locator('#hud .selection button', { hasText: 'Refit shipyard' }).click();
  await page.locator('#refit-form input[name=image]').fill('ghcr.io/example/courier:broken');
  await page.locator('#refit-form button[type=submit]').click();
  await expect.poll(() => page.evaluate(() => [...window.harbor.store.pods.values()].some((p) => p.deployment === 'courier-canary' && /BackOff/.test((p as { reason?: string }).reason ?? ''))), { timeout: 20_000 }).toBe(true);
  await clickMapKey(page, 'b:harbor/courier-canary');
  await page.locator('#hud .selection button', { hasText: 'Roll back refit' }).click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click();
  await expect(title(page)).toHaveText('Blue and green', { timeout: 40_000 });
  await reaim('track=canary');
  await reaim('track=stable');
  await expect(title(page)).toHaveText('Loosely joined');
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('track: stable');
  await page.locator('#summary [data-next]').click();

  // Level 5: cattle, not pets.
  await expect(title(page)).toHaveText('A trader with a pet');
  await papersOf('unit-of:harbor/courier');
  await expect(page.locator('#papers pre.status')).toContainText('podIP');
  await expect(title(page)).toHaveText('The island is drained');
  await page.locator('#papers button[data-close]').click();
  await expect(title(page)).toHaveText('A stable name on top', { timeout: 30_000 });
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=lighthouse] button').click();
  const lf = page.locator('#lighthouse-form form');
  await lf.locator('select[name=ns]').selectOption('harbor');
  await lf.locator('select[name=fleet]').selectOption('courier');
  await lf.locator('input[name=name]').fill('courier');
  await lf.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Design for the drain', { timeout: 10_000 });
  await clickMapKey(page, 'b:harbor/courier');
  await page.locator('#hud .selection button', { hasText: 'Sell shipyard' }).click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click();
  await expect.poll(() => page.evaluate(() => window.harbor.store.deployments.has('harbor/courier'))).toBe(false);
  await build('courier', { port: '80', cpuLimit: '200m', memLimit: '128Mi', readiness: '/ready', liveness: '/healthz', grace: '10' }, 'harbor-worker');
  await expect(title(page)).toHaveText('Drain it again', { timeout: 20_000 });
  await expect(title(page)).toHaveText('Cattle, not pets', { timeout: 40_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('terminationGracePeriodSeconds: 10');
  await page.locator('#summary [data-next]').click();

  // Level 6: two crews.
  await expect(title(page)).toHaveText('The harbor authority');
  await build('courier', { replicas: '6', cpu: '', mem: '' });
  await expect(page.locator('#build-form .err')).toContainText('admission refused');
  await expect(title(page)).toHaveText('Refused at the door');
  await page.locator('#build-form input[name=labels]').fill('team=cargo');
  await page.locator('#build-form button[type=submit]').click();
  await expect(title(page)).toHaveText('Stopped by the quota', { timeout: 20_000 });
  await page.locator('#hud [data-rail=log]').click();
  await expect(page.locator('#log .row', { hasText: /FailedCreate|quota/ }).first()).toBeVisible({ timeout: 15_000 });
  await page.locator('#log button[data-close]').click();
  await clickMapKey(page, 'b:harbor/courier');
  await page.locator('#hud .selection button', { hasText: 'Scrap one' }).click();
  await expect(title(page)).toHaveText('Defaults you never wrote', { timeout: 20_000 });
  await clickMapKey(page, 'b:harbor/courier');
  await expect(page.locator('#hud .selection .lines')).toContainText('cpu 100m');
  await expect(title(page)).toHaveText('A gate needs a keeper');
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=gate] button').click();
  const gate = page.locator('#gate-form form');
  await gate.locator('select[name=ns]').selectOption('harbor');
  await gate.locator('input[name=name]').fill('courier-gate');
  await gate.locator('input[name=host]').fill('courier.example');
  await gate.locator('select[name=service]').selectOption('courier');
  await gate.locator('input[name=class]').fill('harbor-nginx');
  await gate.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText("The other crew's turn", { timeout: 10_000 });
  await clickMapKey(page, 'b:harbor/courier');
  const launch = page.locator('#hud .selection button', { hasText: 'Launch ship' });
  await launch.click();
  await launch.click();
  await expect(title(page)).toHaveText('Boundaries that match the org', { timeout: 30_000 });
  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('kind: ResourceQuota');
  await expect(page.locator('#summary [data-next]')).toBeHidden();
});
