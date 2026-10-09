import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * Plays one round against the live cluster: place a War Factory, order a
 * unit, sell a unit, repair a unit, sell the structure. Each step is
 * asserted through the game's own store (fed by the backend stream) and the
 * final state through kubectl.
 *
 * Needs the harbor binary built (make build) and a reachable cluster; the
 * Playwright webServer starts the binary on its own port.
 */

// The map fills the viewport; the HUD is DOM, so commands are buttons.
const MAP_W = 960;
const TILE = 32;
/** The n-th action button on the selection card. */
const action = (i: number): string => `#hud .selection button[data-action="${i}"]`;

const NS = 'default';
const NAME = `e2e-${Date.now().toString(36)}`;

function kubectl(...args: string[]): string {
  return execFileSync('kubectl', ['--context', 'kind-harbor', ...args], { encoding: 'utf8' });
}

/**
 * Pans the camera to a world point and returns where it lands on screen.
 * The world is wider than the viewport, so targets must be brought into
 * view before they can be clicked.
 */
async function focus(page: Page, worldX: number, worldY: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    async ([wx, wy]) => {
      const m = window.harbor.game.scene.keys.Map as {
        centerOnWorld(x: number, y: number): void;
        cameras: { main: { worldView: { x: number; y: number }; zoom: number } };
      };
      m.centerOnWorld(wx, wy);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cam = m.cameras.main;
      return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
    },
    [worldX, worldY] as const,
  );
}

/** Waits for a unit to finish driving to its slot and returns its live world centre. */
async function unitCentre(page: Page, key: string): Promise<{ x: number; y: number }> {
  await page.waitForFunction(([k, t]) => {
    const m = window.harbor.game.scene.keys.Map as { units: Map<string, { x: number; y: number; placement: { x: number; y: number } }> };
    const v = m.units.get(k);
    return !!v && Math.abs(v.x - v.placement.x * t) < 0.5 && Math.abs(v.y - v.placement.y * t) < 0.5;
  }, [key, TILE] as const, { timeout: 10_000 });
  return page.evaluate(([k, t]) => {
    const m = window.harbor.game.scene.keys.Map as { units: Map<string, { x: number; y: number }> };
    const v = m.units.get(k)!;
    return { x: v.x + t / 2, y: v.y + t / 2 };
  }, [key, TILE] as const);
}

async function deployment(page: Page): Promise<{ replicas: number; available: number } | undefined> {
  return page.evaluate((key) => window.harbor.store.deployments.get(key) as { replicas: number; available: number } | undefined, `${NS}/${NAME}`);
}

async function podsOf(page: Page): Promise<{ name: string; ready: boolean }[]> {
  return page.evaluate(
    (name) => [...window.harbor.store.pods.values()].filter((p) => (p as { deployment?: string }).deployment === name) as { name: string; ready: boolean }[],
    NAME,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
});

test.afterEach(() => {
  try {
    kubectl('delete', 'deployment', NAME, '-n', NS, '--ignore-not-found');
    kubectl('delete', 'statefulset', `${NAME}-db`, '-n', NS, '--ignore-not-found');
    kubectl('delete', 'service', `${NAME}-db`, '-n', NS, '--ignore-not-found');
    kubectl('delete', 'ingress', `${NAME}-gate`, '-n', NS, '--ignore-not-found');
    kubectl('delete', 'job', `${NAME}-haul`, '-n', NS, '--ignore-not-found');
    kubectl('delete', 'service', `${NAME}-light`, '-n', NS, '--ignore-not-found');
    kubectl('delete', 'configmap', `${NAME}-orders`, '-n', NS, '--ignore-not-found');
  } catch {
    /* cluster gone; nothing to clean */
  }
});

test('build, order, sell, repair and sell the structure', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));
  await page.waitForFunction(() => {
    const active = (k: string): boolean => !!(window.harbor.game.scene.keys[k] as { sys?: { isActive(): boolean } } | undefined)?.sys?.isActive();
    return active('Map') && !document.getElementById('hud')?.hidden;
  });
  // The loading screen names the harbor it hailed, then gets out of the way.
  await expect(page.locator('#splash')).toBeHidden({ timeout: 5000 });

  // Enter placement mode from the shop and pick a free building cell.
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  const cell = await page.evaluate(() => {
    const m = window.harbor.game.scene.keys.Map as {
      layout: { plateaus: { x: number; y: number; w: number; node: string }[]; buildings: Map<string, { x: number; y: number; kind: string }> };
    };
    const taken = new Set([...m.layout.buildings.values()].filter((b) => b.kind === 'plateau').map((b) => `${b.x},${b.y}`));
    for (const p of m.layout.plateaus) {
      const cols = Math.floor((p.w - 2) / 3);
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
          const x = p.x + 1 + c * 3;
          const y = p.y + 1 + r * 3;
          if (!taken.has(`${x},${y}`)) return { x, y };
        }
      }
    }
    throw new Error('no free building cell');
  });
  const at = await focus(page, cell.x * TILE + TILE * 1.5, cell.y * TILE + TILE * 1.5);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);

  const form = page.locator('#build-form');
  await expect(form).toBeVisible();
  await expect(form.locator('.where')).toHaveText(`site ${cell.x},${cell.y}`);
  await form.locator('select[name=ns]').selectOption(NS);
  await form.locator('input[name=name]').fill(NAME);
  await form.locator('input[name=replicas]').fill('1');
  await form.locator('button[type=submit]').click();
  await expect(form).toBeHidden();

  await page.waitForFunction((key) => {
    const d = window.harbor.store.deployments.get(key) as { available: number } | undefined;
    return d?.available === 1;
  }, `${NS}/${NAME}`, { timeout: 120_000 });
  expect(kubectl('get', 'deployment', NAME, '-n', NS, '-o', 'jsonpath={.metadata.annotations.harbor\\.dev/map-pos}')).toBe(`${cell.x},${cell.y}`);

  // Locate it by name: "/" opens the search, Enter selects the first hit.
  await page.mouse.click(MAP_W / 2, 300); // focus the canvas, clear selection
  await page.keyboard.press('/');
  const search = page.locator('#search');
  await expect(search).toBeVisible();
  await search.locator('input').fill(NAME.slice(0, 6));
  await expect(search.locator('li.active')).toContainText(`${NS}/${NAME}`);
  await page.keyboard.press('Enter');
  await expect(search).toBeHidden();
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`b:${NS}/${NAME}`]);

  // Filter: hiding the namespace removes the structure from the map, and
  // showing it again brings it back.
  await page.keyboard.press('f');
  const filter = page.locator('#filter');
  await expect(filter).toBeVisible();
  await filter.locator('.list label', { hasText: NS }).locator('input').uncheck();
  await expect.poll(() => page.evaluate((key) => {
    const m = window.harbor.game.scene.keys.Map as { layout: { buildings: Map<string, unknown> } };
    return m.layout.buildings.has(key);
  }, `${NS}/${NAME}`)).toBe(false);
  await filter.locator('.list label', { hasText: NS }).locator('input').check();
  await filter.locator('button[data-close]').click();
  await expect(filter).toBeHidden();
  await expect.poll(() => page.evaluate((key) => {
    const m = window.harbor.game.scene.keys.Map as { layout: { buildings: Map<string, unknown> } };
    return m.layout.buildings.has(key);
  }, `${NS}/${NAME}`)).toBe(true);

  // Select the factory (click its cell) and order one more unit.
  let bAt = await focus(page, cell.x * TILE + TILE * 1.5, cell.y * TILE + TILE * 1.5);
  await page.mouse.click(bAt.x, bAt.y);
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`b:${NS}/${NAME}`]);
  await expect(page.locator(action(0))).toHaveText('Launch ship');
  await page.locator(action(0)).click();
  await page.waitForFunction((key) => {
    const d = window.harbor.store.deployments.get(key) as { replicas: number; available: number } | undefined;
    return d?.replicas === 2 && d.available === 2;
  }, `${NS}/${NAME}`, { timeout: 120_000 });

  // Select one unit and sell it: exactly that pod must go.
  const pods = await podsOf(page);
  expect(pods).toHaveLength(2);
  const victim = pods[0]!.name;
  const unitPos = await unitCentre(page, `${NS}/${victim}`);
  const uAt = await focus(page, unitPos.x, unitPos.y);
  await page.mouse.click(uAt.x, uAt.y);
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`u:${NS}/${victim}`]);
  await expect(page.locator(action(1))).toHaveText('Scrap ship');
  await page.locator(action(1)).click();
  await page.waitForFunction(
    ([name, v]) => {
      const live = [...window.harbor.store.pods.values()].filter((p) => (p as { deployment?: string }).deployment === name) as { name: string }[];
      return live.length === 1 && live[0]!.name !== v;
    },
    [NAME, victim] as const,
    { timeout: 120_000 },
  );
  expect((await deployment(page))?.replicas).toBe(1);

  // Unit intel: the logs panel shows nginx's startup output for the remaining unit.
  const [intel] = await podsOf(page);
  const iPos = await unitCentre(page, `${NS}/${intel!.name}`);
  const iAt = await focus(page, iPos.x, iPos.y);
  await page.mouse.click(iAt.x, iAt.y);
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`u:${NS}/${intel!.name}`]);
  await expect(page.locator(action(0))).toHaveText("Ship's log");
  await page.locator(action(0)).click();
  const logs = page.locator('#logs');
  await expect(logs).toBeVisible();
  await expect(logs.locator('.where')).toHaveText(`${NS}/${intel!.name}`);
  await expect(logs.locator('pre')).toContainText('nginx', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(logs).toBeHidden();

  // Theater select lists the active context and refuses to re-select it.
  await page.keyboard.press('c');
  const mission = page.locator('#mission');
  await expect(mission).toBeVisible();
  const active = mission.locator('.row', { hasText: 'kind-harbor' }).locator('button');
  await expect(active).toHaveText('ACTIVE');
  await expect(active).toBeDisabled();
  await mission.locator('button[data-close]').click();
  await expect(mission).toBeHidden();

  // Repair the remaining unit: a different pod replaces it, replicas unchanged.
  const [remaining] = await podsOf(page);
  const rPos = await unitCentre(page, `${NS}/${remaining!.name}`);
  const rAt = await focus(page, rPos.x, rPos.y);
  await page.mouse.click(rAt.x, rAt.y);
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`u:${NS}/${remaining!.name}`]);
  await expect(page.locator(action(2))).toHaveText('Refit ship');
  await page.locator(action(2)).click();
  await page.waitForFunction(
    ([name, old]) => {
      const live = [...window.harbor.store.pods.values()].filter((p) => (p as { deployment?: string }).deployment === name) as { name: string; ready: boolean }[];
      return live.length === 1 && live[0]!.name !== old && live[0]!.ready;
    },
    [NAME, remaining!.name] as const,
    { timeout: 120_000 },
  );

  // Sell the structure: needs a confirming second click.
  bAt = await focus(page, cell.x * TILE + TILE * 1.5, cell.y * TILE + TILE * 1.5);
  await page.mouse.click(bAt.x, bAt.y);
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`b:${NS}/${NAME}`]);
  await page.locator(action(2)).click();
  await expect(page.locator(action(2))).toContainText('Confirm'); // first click only arms the confirm
  expect(await deployment(page)).toBeDefined();
  await page.locator(action(2)).click();
  await page.waitForFunction((key) => !window.harbor.store.deployments.has(key), `${NS}/${NAME}`, { timeout: 60_000 });
  expect(() => kubectl('get', 'deployment', NAME, '-n', NS)).toThrow();
});

test('build a tanker terminal and open a gate from the shop', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);

  // Terminal: place it like a shipyard, with 1 Gi of storage per tanker.
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=terminal] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  const cell = await page.evaluate(() => {
    const m = window.harbor.game.scene.keys.Map as {
      layout: { plateaus: { x: number; y: number; w: number }[]; buildings: Map<string, { x: number; y: number; kind: string }> };
    };
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
  const at = await focus(page, cell.x * TILE + TILE * 1.5, cell.y * TILE + TILE * 1.5);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  const form = page.locator('#build-form');
  await expect(form).toBeVisible();
  await expect(form.locator('h2 .kind')).toHaveText('TANKER TERMINAL');
  await form.locator('select[name=ns]').selectOption(NS);
  await form.locator('input[name=name]').fill(`${NAME}-db`);
  await form.locator('input[name=replicas]').fill('1');
  await form.locator('input[name=port]').fill('5432');
  await form.locator('input[name=storage]').fill('100Mi');
  await form.locator('button[type=submit]').click();
  await expect(form).toBeHidden();
  await page.waitForFunction((key) => {
    const w = (window.harbor.store as unknown as { workloads: Map<string, { ready: number }> }).workloads.get(key);
    return w?.ready === 1;
  }, `StatefulSet:${NS}/${NAME}-db`, { timeout: 180_000 });
  expect(kubectl('get', 'service', `${NAME}-db`, '-n', NS, '-o', 'jsonpath={.spec.clusterIP}')).toBe('None');

  // Gate: a host rule to the terminal's headless service.
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=gate] button').click();
  const gate = page.locator('#gate-form');
  await expect(gate).toBeVisible();
  await gate.locator('select[name=ns]').selectOption(NS);
  await gate.locator('input[name=name]').fill(`${NAME}-gate`);
  await gate.locator('input[name=host]').fill('tankers.example');
  await gate.locator('select[name=service]').selectOption(`${NAME}-db`);
  await gate.locator('input[name=tls]').check();
  await gate.locator('button[type=submit]').click();
  await expect(gate).toBeHidden();
  await page.waitForFunction((key) => (window.harbor.store as unknown as { ingresses: Map<string, unknown> }).ingresses.has(key), `${NS}/${NAME}-gate`, { timeout: 60_000 });
  expect(kubectl('get', 'ingress', `${NAME}-gate`, '-n', NS, '-o', 'jsonpath={.spec.rules[0].host}')).toBe('tankers.example');

  // Sell the terminal from its card; the headless service goes with it.
  const bAt = await focus(page, cell.x * TILE + TILE * 1.5, cell.y * TILE + TILE * 1.5);
  await page.mouse.click(bAt.x, bAt.y);
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`b:sts:${NS}/${NAME}-db`]);
  await page.locator(action(2)).click();
  await page.locator(action(2)).click();
  await page.waitForFunction((key) => !(window.harbor.store as unknown as { workloads: Map<string, unknown> }).workloads.has(key), `StatefulSet:${NS}/${NAME}-db`, { timeout: 60_000 });
  expect(() => kubectl('get', 'service', `${NAME}-db`, '-n', NS)).toThrow();
});

test('send out a fishing fleet and watch the catch come home', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);

  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=fleet] button').click();
  const form = page.locator('#job-form');
  await expect(form).toBeVisible();
  await form.locator('select[name=ns]').selectOption(NS);
  await form.locator('input[name=name]').fill(`${NAME}-haul`);
  await form.locator('input[name=command]').fill('sh -c "sleep 3; echo catch"');
  await form.locator('input[name=completions]').fill('2');
  await form.locator('input[name=parallelism]').fill('2');
  await form.locator('button[type=submit]').click();
  await expect(form).toBeHidden();

  const key = `Job:${NS}/${NAME}-haul`;
  await page.waitForFunction((k) => {
    const w = (window.harbor.store as unknown as { workloads: Map<string, { ready: number; complete?: boolean }> }).workloads.get(k);
    return w?.ready === 2 && w.complete === true;
  }, key, { timeout: 180_000 });
  expect(kubectl('get', 'job', `${NAME}-haul`, '-n', NS, '-o', 'jsonpath={.status.succeeded}')).toBe('2');

  // Both boats are home: grey, phase Succeeded, still on the map.
  const boats = await page.evaluate((name) => [...window.harbor.store.pods.values()].filter((p) => (p as { ownerName?: string }).ownerName === name) as { phase?: string }[], `${NAME}-haul`);
  expect(boats.map((b) => (b as { phase?: string }).phase)).toEqual(['Succeeded', 'Succeeded']);

  // Recall the fleet from a boat's card.
  const boatName = (await page.evaluate((name) => [...window.harbor.store.pods.values()].find((p) => (p as { ownerName?: string }).ownerName === name)!.name, `${NAME}-haul`)) as string;
  const pos = await unitCentre(page, `${NS}/${boatName}`);
  const at = await focus(page, pos.x, pos.y);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([`u:${NS}/${boatName}`]);
  await page.locator('#hud .selection button', { hasText: 'Recall fleet' }).click();
  await page.locator('#hud .selection button', { hasText: 'Confirm' }).click(); // the armed label
  await page.waitForFunction((k) => !(window.harbor.store as unknown as { workloads: Map<string, unknown> }).workloads.has(k), key, { timeout: 60_000 });
  expect(() => kubectl('get', 'job', `${NAME}-haul`, '-n', NS)).toThrow();
});

test('light a lighthouse from the shop and put it out from its card', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);

  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=lighthouse] button').click();
  const form = page.locator('#lighthouse-form');
  await expect(form).toBeVisible();
  await form.locator('select[name=ns]').selectOption(NS);
  await form.locator('input[name=name]').fill(`${NAME}-light`);
  await form.locator('select[name=fleet]').selectOption('');
  await form.locator('input[name=labels]').fill(`app=${NAME}`);
  await form.locator('input[name=port]').fill('8080');
  await form.locator('button[type=submit]').click();
  await expect(form).toBeHidden();
  await page.waitForFunction((key) => (window.harbor.store as unknown as { services: Map<string, unknown> }).services.has(key), `${NS}/${NAME}-light`, { timeout: 60_000 });
  expect(kubectl('get', 'service', `${NAME}-light`, '-n', NS, '-o', 'jsonpath={.spec.selector.app}')).toBe(NAME);

  // Select the lighthouse on the map and put it out (asks twice).
  const key = `s:${NS}/${NAME}-light`;
  await page.waitForFunction((k) => {
    const m = window.harbor.game.scene.keys.Map as { screenRectOf(k: string): { width: number } | undefined };
    return (m.screenRectOf(k)?.width ?? 0) > 0;
  }, key, { timeout: 15_000 });
  const r = await page.evaluate((k) => {
    const m = window.harbor.game.scene.keys.Map as { focusKey(k: string): void; screenRectOf(k: string): { x: number; y: number; width: number; height: number } | undefined };
    m.focusKey(k);
    return new Promise<{ x: number; y: number; width: number; height: number }>((res) => setTimeout(() => res(m.screenRectOf(k)!), 700));
  }, key);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
  await expect.poll(() => page.evaluate(() => [...window.harbor.selection.keys])).toEqual([key]);
  await page.locator(action(0)).click();
  await expect(page.locator(action(0))).toHaveText(/Confirm/);
  await page.locator(action(0)).click();
  await page.waitForFunction((k) => !(window.harbor.store as unknown as { services: Map<string, unknown> }).services.has(k), `${NS}/${NAME}-light`, { timeout: 60_000 });
  expect(() => kubectl('get', 'service', `${NAME}-light`, '-n', NS)).toThrow();
});

test('seal orders from the shop and read them from a shipyard', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);

  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=orders] button').click();
  const form = page.locator('#orders-form');
  await expect(form).toBeVisible();
  await form.locator('select[name=kind]').selectOption('ConfigMap');
  await form.locator('select[name=ns]').selectOption(NS);
  await form.locator('input[name=name]').fill(`${NAME}-orders`);
  await form.locator('textarea[name=data]').fill('PORT=8443\nREGION=north');
  await form.locator('button[type=submit]').click();
  await expect(form).toBeHidden();
  expect(kubectl('get', 'configmap', `${NAME}-orders`, '-n', NS, '-o', 'jsonpath={.data.PORT}')).toBe('8443');

  // A shipyard that reads the orders, with a cargo cap; the backend reports both.
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  const cell = await page.evaluate(() => {
    const m = window.harbor.game.scene.keys.Map as { layout: { plateaus: { x: number; y: number; w: number }[]; buildings: Map<string, { x: number; y: number; kind: string }> } };
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
  const at = await focus(page, cell.x * TILE + TILE * 1.5, cell.y * TILE + TILE * 1.5);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  const bf = page.locator('#build-form form');
  await expect(bf).toBeVisible();
  await bf.locator('select[name=ns]').selectOption(NS);
  await bf.locator('select[name=orders]').selectOption(`ConfigMap/${NAME}-orders`);
  await bf.locator('input[name=name]').fill(NAME);
  await bf.locator('input[name=cpuLimit]').fill('200m');
  await bf.locator('input[name=memLimit]').fill('128Mi');
  await bf.locator('button[type=submit]').click();
  await expect(bf).toBeHidden();
  await page.waitForFunction((key) => {
    const d = window.harbor.store.deployments.get(key) as { orders?: string[]; limits?: string } | undefined;
    return d?.orders?.[0] === `ConfigMap/${key.split('/')[1]}-orders` && d.limits === 'cpu 200m · mem 128Mi';
  }, `${NS}/${NAME}`, { timeout: 60_000 });
  expect(kubectl('get', 'deployment', NAME, '-n', NS, '-o', 'jsonpath={.spec.template.spec.containers[0].envFrom[0].configMapRef.name}')).toBe(`${NAME}-orders`);
});
