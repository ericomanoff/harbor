import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/**
 * Plays the FortiAIGate expedition's first two levels against kind as a dry
 * run: checks run for real (some pass, the GPU one cannot), failed checks
 * are skipped, and the forms create the real namespace and secret.
 */
const title = (page: Page) => page.locator('#captain .bubble .title');
const next = (page: Page) => page.locator('[data-tour=next]');
const result = (page: Page) => page.locator('#captain .bubble .result');

function kubectl(...args: string[]): string {
  return execFileSync('kubectl', ['--context', 'kind-harbor', ...args], { encoding: 'utf8' });
}

test.afterEach(() => {
  try {
    kubectl('delete', 'namespace', 'fortiaigate', '--ignore-not-found', '--wait=false');
  } catch {
    /* cluster gone */
  }
});

test('the FortiAIGate expedition: survey the harbor, then load the cargo', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.addInitScript(() => localStorage.setItem('harbor.tour.v1', 'done'));
  await page.request.delete('/api/progress');
  await page.goto('/?expeditions');
  await page.waitForFunction(() => window.harbor?.store.context === 'kind-harbor', null, { timeout: 30_000 })
    .catch(() => test.skip(true, 'backend is not connected to kind-harbor'));

  const select = page.locator('#expeditions');
  await expect(select).toBeVisible({ timeout: 15_000 });
  const exp = select.locator('.expedition[data-campaign=fortiaigate]');
  await expect(exp).toBeVisible({ timeout: 15_000 });
  await expect(exp.locator('.title a')).toHaveAttribute('href', /docs\.fortinet\.com/);
  await expect(exp.locator('.row.level')).toHaveCount(7);
  await exp.locator('.row.level[data-level="fortiaigate/validate"] button').click();

  // Level 1: checks. Kubernetes version passes on kind; the GPU label does not.
  await expect(title(page)).toHaveText('Before the expedition');
  await next(page).click();
  await expect(title(page)).toHaveText('Kubernetes version');
  await page.locator('[data-tour=action]').click();
  await expect(result(page)).toHaveClass(/ok/, { timeout: 15_000 });
  await expect(result(page)).toContainText('Kubernetes');
  await expect(title(page)).toHaveText('Worker architecture');
  await page.locator('[data-tour=action]').click();
  await expect(result(page)).toHaveClass(/ok|fail/, { timeout: 15_000 });
  if (await result(page).evaluate((el) => el.classList.contains('fail'))) await next(page).click(); // Skip step: this laptop's kind is not amd64
  await expect(title(page)).toHaveText('GPU docks');
  await page.locator('[data-tour=action]').click();
  await expect(result(page)).toHaveClass(/fail/, { timeout: 15_000 });
  await expect(result(page)).toContainText('nvidia.com/gpu.present');
  await expect(next(page)).toHaveText('Skip step');
  await next(page).click();
  await expect(title(page)).toHaveText('A gatekeeper');
  await page.locator('[data-tour=action]').click();
  await expect(result(page)).toHaveClass(/ok|fail/, { timeout: 15_000 });
  if (await result(page).evaluate((el) => el.classList.contains('fail'))) await next(page).click();
  await expect(title(page)).toHaveText('Storage for the models');
  await page.locator('[data-tour=action]').click();
  await expect(result(page)).toHaveClass(/ok/, { timeout: 15_000 }); // kind ships a standard StorageClass
  await expect(page.locator('#success')).toBeVisible({ timeout: 10_000 });
  await page.locator('#success [data-continue]').click();
  await expect(page.locator('#summary pre.kubectl')).toContainText('kubectl get storageclass');
  await page.locator('#summary [data-next]').click();

  // Level 2: found the fleet and seal the registry secret, for real.
  await expect(title(page)).toHaveText('Images in your own registry');
  await next(page).click();
  await expect(title(page)).toHaveText('Found the fleet');
  await page.locator('[data-tour=action]').click();
  const ff = page.locator('#fleet-form');
  await expect(ff).toBeVisible();
  await expect(ff.locator('input[name=name]')).toHaveValue('fortiaigate');
  await ff.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('Seal the registry credentials', { timeout: 30_000 });
  await page.locator('[data-tour=action]').click();
  const of = page.locator('#orders-form');
  await expect(of).toBeVisible();
  await expect(of.locator('select[name=kind]')).toHaveValue('Secret');
  await expect(of.locator('input[name=name]')).toHaveValue('fortiaigate-registry');
  await of.locator('textarea[name=data]').fill('registry=registry.example.com\nusername=sailor\npassword=hush');
  await of.locator('button[type=submit]').click();
  await expect(title(page)).toHaveText('The envelope is sealed', { timeout: 30_000 });
  await page.locator('[data-tour=action]').click();
  await expect(result(page)).toHaveClass(/ok/, { timeout: 15_000 });
  await expect(page.locator('#success')).toBeVisible({ timeout: 10_000 });
  expect(kubectl('get', 'secret', 'fortiaigate-registry', '-n', 'fortiaigate', '-o', 'jsonpath={.type}')).toBe('Opaque');
  await page.locator('#success [data-continue]').click();
  await page.locator('#summary [data-select]').click();
  await expect(select.locator('.expedition .row.level[data-level="fortiaigate/cargo"] .stars')).toHaveText(/★/);
  expect(await page.evaluate(() => fetch('/api/progress').then((r) => r.json()))).toMatchObject({ levels: { 'fortiaigate/validate': {}, 'fortiaigate/cargo': {} } });
});
