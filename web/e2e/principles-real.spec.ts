import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * Plays 1st Principles levels 1 and 5 "for real" on the kind cluster: the
 * academy founds a harbor-academy fleet, the apply, the by-hand ship and the
 * drains all happen on the cluster, and the fleet is scuttled on leaving.
 */
const title = (page: Page) => page.locator('#captain .bubble .title');
const next = (page: Page) => page.locator('[data-tour=next]');
const action = (page: Page) => page.locator('[data-tour=action]');
const NS = 'harbor-academy';
const TILE = 32;

type MapHandle = { screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined; focusKey(k: string): void };

function kubectl(...args: string[]): string {
  return execFileSync('kubectl', ['--context', 'kind-harbor', ...args], { encoding: 'utf8' });
}

/** The courier fleet's ships that are not on their way out: name and island. */
function ships(): { name: string; node: string }[] {
  return kubectl('get', 'pods', '-n', NS, '-l', 'app=courier', '-o', 'jsonpath={range .items[*]}{.metadata.name} {.spec.nodeName} {.metadata.deletionTimestamp}{"\\n"}{end}')
    .split('\n').filter(Boolean).map((l) => l.split(' ')).filter((f) => !f[2]).map((f) => ({ name: f[0] ?? '', node: f[1] ?? '' }));
}

/** Names of cordoned nodes, if any. */
function cordoned(): string[] {
  return kubectl('get', 'nodes', '-o', 'jsonpath={range .items[?(@.spec.unschedulable==true)]}{.metadata.name}{"\\n"}{end}').split('\n').filter(Boolean);
}

async function clickMapKey(page: Page, key: string): Promise<void> {
  await page.waitForFunction((k) => ((window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(k)?.width ?? 0) > 0, key, { timeout: 30_000 });
  // Pan the target into view, then wait until its rect holds still: ships sail to their berth.
  await page.evaluate((k) => (window.harbor.game.scene.keys['Map'] as MapHandle).focusKey(k), key);
  const read = () => page.evaluate((k) => (window.harbor.game.scene.keys['Map'] as MapHandle).screenRectOf(k)!, key);
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

/** Clicks a free structure cell on any island, the camera centred on it first. */
async function clickFreeSite(page: Page): Promise<void> {
  const cell = await page.evaluate(() => {
    const m = window.harbor.game.scene.keys['Map'] as { layout: { plateaus: { x: number; y: number; w: number }[]; buildings: Map<string, { x: number; y: number; kind: string }> } };
    const taken = new Set([...m.layout.buildings.values()].filter((b) => b.kind === 'plateau').map((b) => `${b.x},${b.y}`));
    for (const p of m.layout.plateaus) {
      const cols = Math.floor((p.w - 2) / 3);
      for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
        const x = p.x + 1 + c * 3;
        const y = p.y + 1 + r * 3;
        if (!taken.has(`${x},${y}`)) return { x, y };
      }
    }
    throw new Error('no free cell');
  });
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

async function papersOf(page: Page, key: string): Promise<void> {
  await clickMapKey(page, key);
  await page.locator('#hud .selection button', { hasText: 'Papers' }).click();
  await expect(page.locator('#papers pre.spec')).not.toBeEmpty();
}

/** Opens the step's Apply manifest action, sets replicas, applies, and returns what the form reported. */
async function applyReplicas(page: Page, n: number): Promise<string> {
  await action(page).click();
  const form = page.locator('#apply-form');
  await expect(form).toBeVisible();
  const text = await form.locator('textarea').inputValue();
  expect(text).toContain(`namespace: ${NS}`);
  expect(text).toContain('nginx:1.27-alpine');
  await form.locator('textarea').fill(text.replace(/replicas: \d+/, `replicas: ${n}`));
  await form.locator('button[type=submit]').click();
  const item = form.locator('.apply-item');
  await expect(item).toBeVisible({ timeout: 20_000 });
  const report = (await item.textContent()) ?? '';
  await form.locator('button[data-cancel]').click();
  return report;
}

async function finishAndContinue(page: Page): Promise<void> {
  await expect(next(page)).toHaveText('Finish');
  await next(page).click();
  await expect(page.locator('#success')).toBeVisible();
  await page.locator('#success [data-continue]').click();
  await expect(page.locator('#summary')).toBeVisible();
}

/** Leaves from the summary and checks the academy fleet is scuttled and the other fleets return. */
async function leave(page: Page): Promise<void> {
  await page.locator('#summary [data-leave]').click();
  await expect.poll(() => page.evaluate(() => window.harbor.settings.hiddenNamespaces.size)).toBe(0);
  await expect.poll(() => { try { return kubectl('get', 'namespace', NS, '-o', 'jsonpath={.status.phase}'); } catch { return 'Gone'; } }, { timeout: 60_000 }).toMatch(/Terminating|Gone/);
}

async function openForReal(page: Page, level: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
  await page.goto(`/?level=${level}&real`);
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));
}

test.beforeEach(async ({ page }) => {
  await page.request.delete('/api/progress');
  // The previous level's fleet may still be scuttling; the level waits for it, so the clock should not start early.
  await expect.poll(() => { try { kubectl('get', 'namespace', NS); return 'there'; } catch { return 'gone'; } }, { timeout: 90_000 }).toBe('gone');
});

test.afterEach(() => {
  try {
    kubectl('delete', 'namespace', NS, '--ignore-not-found', '--wait=false');
    // A failed run must not leave an island cordoned for the next one.
    for (const n of cordoned()) kubectl('uncordon', n);
  } catch {
    /* cluster gone */
  }
});

test('principle 1 for real: apply writes the record, the cluster follows', async ({ page }) => {
  test.setTimeout(540_000);
  await openForReal(page, 'principles/1');

  // Setup: a courier shipyard with three ships and its lighthouse in the academy fleet.
  await expect(title(page)).toHaveText('Two documents, one object', { timeout: 180_000 });
  expect(kubectl('get', 'namespace', NS, '-o', 'jsonpath={.metadata.labels.harbor\\.dev/academy}')).toBe('true');
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.status.readyReplicas}')).toBe('3');
  expect(await page.evaluate(() => window.harbor.settings.hiddenNamespaces.has('default'))).toBe(true);

  await papersOf(page, `b:${NS}/courier`);
  await expect(title(page)).toHaveText('spec and status agree');
  await expect(page.locator('#papers pre.spec')).toContainText('replicas: 3');
  await page.locator('#papers button[data-close]').click();

  // The ship by hand is a real bare pod, then a real deletion that nothing answers.
  await expect(title(page)).toHaveText('An order, not a record');
  await expect.poll(() => { try { return kubectl('get', 'pod', 'courier-by-hand', '-n', NS, '-o', 'jsonpath={.metadata.labels.harbor\\.dev/staged}'); } catch { return ''; } }, { timeout: 60_000 }).toBe('true');
  await expect(title(page)).toHaveText('Write the wish down', { timeout: 120_000 });
  expect(() => kubectl('get', 'pod', 'courier-by-hand', '-n', NS)).toThrow();
  expect(kubectl('get', 'pods', '-n', NS, '-l', 'app=courier', '-o', 'name').trim().split('\n')).toHaveLength(3);

  // Apply 4: server-side apply on the cluster; the shipyard's own hull stays.
  expect(await applyReplicas(page, 4)).toContain('configured');
  await expect(title(page)).toHaveText('spec leads, status follows');
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.spec.replicas}')).toBe('4');
  await papersOf(page, `b:${NS}/courier`);
  await expect(title(page)).toHaveText('Apply it again', { timeout: 120_000 });
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.status.readyReplicas}')).toBe('4');
  await page.locator('#papers button[data-close]').click();

  // The same manifest again changes nothing.
  expect(await applyReplicas(page, 4)).toContain('unchanged');
  await expect(title(page)).toHaveText('Change the record, not the ships');

  // Apply 2: two ships retire; then the reef is a real deletion and the record relaunches.
  expect(await applyReplicas(page, 2)).toContain('configured');
  await expect(title(page)).toHaveText('The record outlives the ship', { timeout: 120_000 });
  await expect(title(page)).toHaveText('Your manifests are the desired state', { timeout: 120_000 });
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.spec.replicas}')).toBe('2');
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.metadata.managedFields[*].manager}')).toContain('harbor');

  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText(`namespace: ${NS}`);
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl apply -f');
  await leave(page);
});

test('principle 5 for real: a drained island, a lighthouse and a ship built to be replaced', async ({ page }) => {
  test.setTimeout(600_000);
  await openForReal(page, 'principles/5');

  // Setup: a courier ship, the ledger-db tanker with its lighthouse, and a trader staged as a prop.
  await expect(title(page)).toHaveText('A trader with a pet', { timeout: 180_000 });
  expect(kubectl('get', 'pod', 'trader', '-n', NS, '-o', 'jsonpath={.metadata.labels.harbor\\.dev/staged}')).toBe('true');
  expect(kubectl('get', 'statefulset', 'ledger-db', '-n', NS, '-o', 'jsonpath={.status.readyReplicas}')).toBe('1');
  const shipBefore = ships()[0] ?? { name: '', node: '' };
  expect(shipBefore.name).not.toBe('');

  await papersOf(page, `unit-of:${NS}/courier`);
  await expect(page.locator('#papers pre.status')).toContainText('podIP');
  await expect(title(page)).toHaveText('The island is drained');
  await page.locator('#papers button[data-close]').click();

  // The drain cordons the ship's island for real and evicts the fleet's ships there; the trader prop stays.
  await expect.poll(cordoned, { timeout: 60_000 }).toEqual([shipBefore.node]);
  await expect(title(page)).toHaveText('A stable name on top', { timeout: 180_000 });
  const shipAfter = ships()[0] ?? { name: '', node: '' };
  expect(ships()).toHaveLength(1);
  expect(shipAfter.name).not.toBe(shipBefore.name);
  expect(shipAfter.node).not.toBe(shipBefore.node);
  expect(kubectl('get', 'pod', 'ledger-db-0', '-n', NS, '-o', 'jsonpath={.spec.nodeName}')).not.toBe(shipBefore.node);
  expect(kubectl('get', 'pod', 'trader', '-n', NS, '-o', 'jsonpath={.status.phase}')).toBe('Running');
  await expect.poll(cordoned, { timeout: 60_000 }).toEqual([]);

  // A lighthouse for the courier fleet.
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=lighthouse] button').click();
  const lf = page.locator('#lighthouse-form form');
  await lf.locator('select[name=ns]').selectOption(NS);
  await lf.locator('select[name=fleet]').selectOption('courier');
  await lf.locator('input[name=name]').fill('courier');
  await lf.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Design for the drain', { timeout: 60_000 });
  expect(kubectl('get', 'service', 'courier', '-n', NS, '-o', 'jsonpath={.spec.selector.app}')).toBe('courier');

  // Sell the shipyard and rebuild it with lookouts, limits and a grace period.
  await clickMapKey(page, `b:${NS}/courier`);
  await page.locator('#hud .selection button', { hasText: 'Sell shipyard' }).click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click();
  await expect.poll(() => page.evaluate((k) => window.harbor.store.deployments.has(k), `${NS}/courier`), { timeout: 30_000 }).toBe(false);
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  await clickFreeSite(page);
  const bf = page.locator('#build-form form');
  await expect(bf).toBeVisible();
  await bf.locator('select[name=ns]').selectOption(NS);
  await bf.locator('input[name=name]').fill('courier');
  for (const [k, v] of Object.entries({ port: '80', cpuLimit: '200m', memLimit: '128Mi', readiness: '/', liveness: '/', grace: '10' })) await bf.locator(`input[name=${k}]`).fill(v);
  await bf.locator('button[type=submit]').click();
  await expect(bf).toBeHidden();
  await expect(title(page)).toHaveText('Drain it again', { timeout: 180_000 });
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.spec.template.spec.terminationGracePeriodSeconds}')).toBe('10');
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.spec.template.spec.containers[0].readinessProbe.httpGet.path}')).toBe('/');

  // The second drain goes unnoticed: the trader is still there, a ship is ready, the island reopens.
  await expect.poll(() => cordoned().length, { timeout: 60_000 }).toBe(1);
  await expect(title(page)).toHaveText('Cattle, not pets', { timeout: 180_000 });
  expect(kubectl('get', 'pod', 'trader', '-n', NS, '-o', 'jsonpath={.status.phase}')).toBe('Running');
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.status.readyReplicas}')).toBe('1');
  await expect.poll(cordoned, { timeout: 60_000 }).toEqual([]);

  await finishAndContinue(page);
  await expect(page.locator('#summary pre.yaml')).toContainText('terminationGracePeriodSeconds: 10');
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl drain');
  await leave(page);
});
