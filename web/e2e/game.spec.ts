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

declare global {
  interface Window {
    harbor: {
      store: { context: string; deployments: Map<string, unknown>; pods: Map<string, unknown> };
      selection: { keys: Set<string> };
      mode: { current: string };
      game: { scene: { keys: Record<string, unknown> } };
    };
  }
}

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

test.afterEach(() => {
  try {
    kubectl('delete', 'deployment', NAME, '-n', NS, '--ignore-not-found');
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
