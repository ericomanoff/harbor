import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * The GUI features expeditions script: Papers (spec vs status), Apply
 * manifest (idempotent), the ledger (who wrote what) and Change ensign
 * (labels re-evaluated by selectors). In the demo harbor they run on the
 * simulator; the last test runs them on kind.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
});

function kubectl(...args: string[]): string {
  return execFileSync('kubectl', ['--context', 'kind-harbor', ...args], { encoding: 'utf8' });
}

test('papers, apply, ledger and ensign in the training harbor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?demo');
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);

  // Papers: spec says 3, status says 3; the lagging line is marked when they disagree.
  await page.evaluate(() => window.harbor.selection.set(['b:sandbox/nginx']));
  await page.locator('#hud .selection button', { hasText: 'Papers' }).click();
  const papers = page.locator('#papers');
  await expect(papers.locator('pre.spec')).toContainText('replicas: 3');
  await expect(papers.locator('pre.status')).toContainText('availableReplicas: 3');
  await expect(papers.locator('.managers')).toContainText('harbor');
  await papers.locator('button[data-close]').click();

  // Apply: preview, apply, apply again unchanged.
  const manifest = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nginx\n  namespace: sandbox\nspec:\n  replicas: 8\n  template:\n    spec:\n      containers:\n        - name: nginx\n          image: nginx:1.27-alpine\n';
  await page.locator('#hud [data-shop-open]').click();
  await page.locator('#shop [data-card=apply] button').click();
  const form = page.locator('#apply-form');
  await form.locator('textarea').fill(manifest);
  await form.locator('button[data-preview]').click();
  await expect(form.locator('.apply-item.configured')).toContainText('would change');
  await expect(form.locator('.apply-item .diff')).toContainText('+ replicas: 8');
  expect(await page.evaluate(() => window.harbor.store.deployments.get('sandbox/nginx')?.replicas)).toBe(3);
  await form.locator('button[type=submit]').click();
  await expect(form.locator('.apply-item.configured')).toContainText('configured');
  await expect.poll(() => page.evaluate(() => window.harbor.store.deployments.get('sandbox/nginx')?.replicas)).toBe(8);
  await form.locator('button[type=submit]').click();
  await expect(form.locator('.apply-item.unchanged')).toContainText('unchanged');
  await form.locator('button[data-cancel]').click();

  // The ledger saw the write and the controller's launch.
  await page.locator('#hud [data-rail=ledger]').click();
  const ledger = page.locator('#ledger');
  await expect(ledger.locator('.row.request', { hasText: 'POST /api/apply' }).first()).toBeVisible();
  await expect(ledger.locator('.row.change .who', { hasText: 'the Deployment controller' }).first()).toBeVisible({ timeout: 10_000 });
  await expect(ledger.locator('.row.change .who', { hasText: 'the scheduler' }).first()).toBeVisible({ timeout: 10_000 });
  await ledger.locator('button[data-close]').click();

  // Change ensign on a ship: it leaves the shipyard and a replacement is launched.
  const before = await page.evaluate(() => [...window.harbor.store.pods.values()].filter((p) => p.deployment === 'nginx').length);
  await page.evaluate(() => window.harbor.selection.set(['u:sandbox/nginx-7d9-a1']));
  await page.locator('#hud .selection button', { hasText: 'Change ensign' }).click();
  const ensign = page.locator('#ensign-form');
  await ensign.locator('input[name=labels]').fill('app=retired');
  await ensign.locator('button[type=submit]').click();
  await expect(ensign).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.harbor.store.pods.get('sandbox/nginx-7d9-a1')?.deployment)).toBeUndefined();
  await expect.poll(() => page.evaluate(() => [...window.harbor.store.pods.values()].filter((p) => p.deployment === 'nginx').length), { timeout: 10_000 }).toBe(before);
});

test('papers and apply on kind', async ({ page }) => {
  const NAME = `e2e-${Date.now().toString(36)}`;
  await page.goto('/');
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));
  await page.waitForFunction(() => !document.getElementById('hud')?.hidden && document.getElementById('splash')?.hidden);
  try {
    const manifest = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${NAME}\n  namespace: default\ndata:\n  PORT: "80"\n`;
    await page.locator('#hud [data-shop-open]').click();
    await page.locator('#shop [data-card=apply] button').click();
    const form = page.locator('#apply-form');
    await form.locator('textarea').fill(manifest);
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.apply-item.created')).toContainText('created');
    await form.locator('button[type=submit]').click();
    await expect(form.locator('.apply-item.unchanged')).toContainText('unchanged');
    await form.locator('textarea').fill(manifest.replace('"80"', '"8443"'));
    await form.locator('button[data-preview]').click();
    await expect(form.locator('.apply-item .diff')).toContainText('+ PORT: "8443"');
    await form.locator('button[data-cancel]').click();
    expect(kubectl('get', 'configmap', NAME, '-n', 'default', '-o', 'jsonpath={.metadata.managedFields[0].manager}')).toBe('harbor');
    const papers = await page.evaluate((n) => fetch(`/api/objects/ConfigMap/default/${n}`).then((r) => r.json()), NAME) as { spec: string; managers: string[] };
    expect(papers.spec).toContain('PORT');
    expect(papers.managers).toContain('harbor');
  } finally {
    kubectl('delete', 'configmap', NAME, '-n', 'default', '--ignore-not-found');
  }
});
