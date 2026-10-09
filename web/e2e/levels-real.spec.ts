import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * Plays academy level 2 "for real": the incidents are staged on the kind
 * cluster in a harbor-academy namespace, the learner uses the normal forms,
 * and the level cleans the namespace up afterwards.
 */
const title = (page: Page) => page.locator('#tour .bubble .title');
const next = (page: Page) => page.locator('[data-tour=next]');
const NS = 'harbor-academy';
const TILE = 32;

function kubectl(...args: string[]): string {
  return execFileSync('kubectl', ['--context', 'kind-harbor', ...args], { encoding: 'utf8' });
}

/** A free structure cell on any island, brought into view; returns where to click. */
async function freeSite(page: Page): Promise<{ x: number; y: number }> {
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
  return page.evaluate(async ([wx, wy]) => {
    const m = window.harbor.game.scene.keys.Map as { centerOnWorld(x: number, y: number): void; cameras: { main: { worldView: { x: number; y: number }; zoom: number } } };
    m.centerOnWorld(wx, wy);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cam = m.cameras.main;
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
  }, [cell.x * TILE + TILE * 1.5, cell.y * TILE + TILE * 1.5] as const);
}

test.afterEach(() => {
  try {
    kubectl('delete', 'namespace', NS, '--ignore-not-found', '--wait=false');
  } catch {
    /* cluster gone */
  }
});

test('level 2 for real: a staged reef on kind and a Deployment that relaunches', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
  await page.goto('/?level=academy/2&real');
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));

  // Setup: the academy founds its fleet and sends out the lone ship.
  await expect(title(page)).toHaveText('Same reef, same sea', { timeout: 120_000 });
  expect(kubectl('get', 'namespace', NS, '-o', 'jsonpath={.metadata.labels.harbor\\.dev/academy}')).toBe('true');
  expect(kubectl('get', 'pod', 'courier', '-n', NS, '-o', 'jsonpath={.metadata.labels.harbor\\.dev/staged}')).toBe('true');
  // Only the academy fleet stays on the map while the level runs.
  expect(await page.evaluate(() => window.harbor.settings.hiddenNamespaces.has('default'))).toBe(true);

  // The reef is a real pod deletion.
  await expect(title(page)).toHaveText('Build a shipyard', { timeout: 90_000 });
  expect(() => kubectl('get', 'pod', 'courier', '-n', NS)).toThrow();

  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=shipyard] button').click();
  await expect.poll(() => page.evaluate(() => window.harbor.mode.current)).toBe('place');
  const at = await freeSite(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
  const form = page.locator('#build-form form');
  await expect(form).toBeVisible();
  await form.locator('select[name=ns]').selectOption(NS);
  await form.locator('input[name=name]').fill('courier');
  await form.locator('input[name=port]').fill('80');
  await form.locator('button[type=submit]').click();
  await expect(form).toBeHidden();
  await expect(title(page)).toHaveText('The reef again', { timeout: 180_000 });
  await expect(title(page)).toHaveText('Desired state', { timeout: 180_000 });
  expect(kubectl('get', 'deployment', 'courier', '-n', NS, '-o', 'jsonpath={.status.readyReplicas}')).toBe('1');
  await expect(next(page)).toHaveText('Finish');
  await next(page).click();
  await expect(page.locator('#success')).toBeVisible();
  await page.locator('#success [data-continue]').click();
  await expect(page.locator('#summary pre.yaml')).toContainText(`namespace: ${NS}`);
  await page.locator('#summary [data-leave]').click();
  // Leaving cleans the academy fleet up and brings the other fleets back.
  await expect.poll(() => page.evaluate(() => window.harbor.settings.hiddenNamespaces.size)).toBe(0);
  await expect.poll(() => { try { return kubectl('get', 'namespace', NS, '-o', 'jsonpath={.status.phase}'); } catch { return 'Gone'; } }, { timeout: 60_000 }).toMatch(/Terminating|Gone/);
});
