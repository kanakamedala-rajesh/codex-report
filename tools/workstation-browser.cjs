'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { launchBrowser } = require('./browser-launch.cjs');
const { auditPage, auditScale } = require('./ui-audit.cjs');
const { seedWorkspace } = require('./workstation-fixture.cjs');
const { startService, rpc } = require('../dist/service');
const { loadConfig } = require('../dist/config');

async function runWorkspaceChecks({ appearanceOnly = false } = {}) {
  const playwright = require(process.env.CODEX_REPORT_PLAYWRIGHT || 'playwright-core');
  // Browser prerequisites are checked before creating a store or starting a server.
  const browser = await launchBrowser(playwright);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-workstation-'));
  const output = process.env.CODEX_REPORT_UI_OUTPUT;
  if (output) fs.mkdirSync(output, { recursive: true });
  const fixtureMode = process.env.CODEX_REPORT_BROWSER_FIXTURE === '1';
  const audits = [],
    scales = [],
    checks = [],
    pageErrors = [];
  let service;
  let fixtureOffline = false;
  try {
    await seedWorkspace(home);
    service = await startService(home);
    const config = loadConfig(home);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const base = service.url.split('/#')[0];
    const expected = await rpc(home, '/api/report?scope=lifetime&account=all');
    assert.ok(expected.sessions.length >= 12, 'synthetic history supports pagination');
    if (fixtureMode) {
      // Explicit DOM/transport fixture, never an automatic fallback or a live-browser claim.
      // Requests execute in the test host against the real synthetic local collector.
      await page.exposeFunction('__workspaceFixtureRequest', async (url, options) => {
        if (fixtureOffline)
          return { status: 503, body: { error: 'Synthetic collector unavailable' } };
        assert.ok(url.startsWith('/api/'), 'fixture requests stay on allowlisted API paths');
        const response = await fetch(base + url, {
          method: options.method || 'GET',
          headers: { Authorization: `Bearer ${config.token}`, ...(options.headers || {}) },
          ...(options.body ? { body: options.body } : {}),
        });
        return { status: response.status, body: await response.json() };
      });
      const html = fs
        .readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
        .replace(/<link[^>]+href="\/style\.css"[^>]*>/, '')
        .replace(/<script[^>]+src="\/app\.js"[^>]*><\/script>/, '');
      await page.setContent(html);
      await page.addStyleTag({
        content: fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8'),
      });
      await page.evaluate(() => {
        window.fetch = async (url, options = {}) => {
          const result = await window.__workspaceFixtureRequest(String(url), {
            method: options.method,
            headers: options.headers,
            body: options.body,
          });
          return new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: { 'Content-Type': 'application/json' },
          });
        };
      });
      await page.addScriptTag({
        content: fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'),
      });
    } else {
      await page.goto(service.url);
    }
    await page.waitForFunction(
      () => document.querySelector('#connection')?.textContent === 'Collector connected',
    );
    const nav = async (name) => {
      await page.locator(`.primary-nav [data-view="${name}"]`).click();
      await page.waitForFunction(
        (value) =>
          document
            .querySelector(`.primary-nav [data-view="${value}"]`)
            ?.getAttribute('aria-current') === 'page',
        name,
      );
      if (name === 'settings')
        await page.locator('#settings-font-size').waitFor({ state: 'visible' });
    };
    const capture = async (name) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      audits.push(await auditPage(page, name));
      scales.push(await auditScale(page, name));
      if (output) await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
    };
    const save = async () => {
      await page.locator('#settings-save').click();
      await page.waitForFunction(
        () => document.querySelector('#settings-message')?.getAttribute('data-state') === 'saved',
      );
    };
    const respondDialog = (accept) =>
      page.once('dialog', (dialog) => (accept ? dialog.accept() : dialog.dismiss()));
    const uiSize = async (size) => {
      await page.locator('#settings-font-size').fill(String(size));
      await page.waitForFunction(
        (value) => document.documentElement.dataset.fontSize === String(value),
        size,
      );
    };
    await capture('overview-dark');
    assert.equal(await page.locator('.summary-ribbon').count(), 1);
    await page.locator('.day-button').first().click();
    assert.equal(await page.locator('.day-button[aria-pressed="true"]').count(), 1);
    await page.getByRole('button', { name: 'By model', exact: true }).click();
    assert.equal(await page.locator('table caption').filter({ hasText: 'Model usage' }).count(), 1);
    await capture('overview-models-dark');
    await page.getByRole('button', { name: 'By day', exact: true }).click();
    await page.locator('.chart-data > summary').click();
    await capture('overview-exact-values-dark');
    checks.push('real summary data, day selection and exact values, model breakdown');

    await nav('sessions');
    await capture('sessions-dark');
    await page.locator('.session-choice').nth(1).click();
    const chosen = await page
      .locator('.session-choice[aria-pressed="true"]')
      .getAttribute('data-session-id');
    await page.locator('.task > summary').first().click();
    const openTask = await page.locator('.task[open]').first().getAttribute('data-task');
    await page.locator('#refresh').click();
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
    assert.equal(
      await page.locator('.session-choice[aria-pressed="true"]').getAttribute('data-session-id'),
      chosen,
    );
    assert.equal(await page.locator('.task[open]').first().getAttribute('data-task'), openTask);
    await capture('session-detail-dark');
    await page.locator('#session-outcome').selectOption('usageExceeded');
    assert.ok((await page.locator('.session-choice').count()) > 0);
    await page.locator('#session-sort').selectOption('tokens');
    await page.locator('#session-search').fill('no-such-session');
    assert.equal(await page.locator('.session-choice').count(), 0);
    await capture('session-search-empty');
    await page.locator('#session-search').fill('');
    await page.locator('#session-outcome').selectOption('all');
    await page.locator('#session-sort').selectOption('recent');
    await page.locator('.session-choice').first().click();
    const rename = page
      .locator('#session-inspector button')
      .filter({ hasText: /Name session|Rename session/ });
    await rename.click();
    await page.locator('#session-name').fill('Review <img src=x onerror=alert(1)>');
    await page.locator('#rename-save').click();
    await page.locator('#rename-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#session-inspector img').count(), 0);
    await page.waitForFunction(() =>
      document.querySelector('#session-inspector')?.textContent.includes('Review <img'),
    );
    assert.ok((await page.locator('#session-inspector').textContent()).includes('Review <img'));
    await rename.click();
    await page.locator('#session-name').fill('Dashboard exploration');
    await page.locator('#rename-save').click();
    await page.locator('#rename-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() =>
      document.querySelector('#session-inspector')?.textContent.includes('Dashboard exploration'),
    );
    checks.push(
      'master-detail selection, preserved expansion, search/outcomes/sort, safe persisted session naming',
    );

    await page.locator('#open-commands').click();
    await capture('command-palette-dark');
    assert.equal(await page.locator('#command-search').getAttribute('role'), 'combobox');
    assert.equal(
      await page.locator('#command-search').getAttribute('aria-activedescendant'),
      await page.locator('.command-result[aria-selected=true]').getAttribute('id'),
    );
    await page.locator('#command-search').fill('Data health');
    await page.locator('#command-search').press('Enter');
    await page.waitForFunction(
      () => document.querySelector('#title')?.textContent === 'Data health',
    );
    await page.keyboard.press('Control+k');
    await page.locator('#command-search').fill('Dashboard exploration');
    await page.locator('#command-search').press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#title')?.textContent === 'Sessions');
    assert.ok(
      (await page.locator('#session-inspector').textContent()).includes('Dashboard exploration'),
    );
    await page.locator('#open-commands').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#command-dialog').isVisible(), false);
    checks.push('command search, page/session navigation, keyboard entry and Escape');
    await nav('overview');
    await page.getByRole('button', { name: 'By model', exact: true }).click();
    await page.evaluate(() => {
      const original = window.fetch;
      window.__restoreFetch = () => {
        window.fetch = original;
      };
      window.fetch = async (url, options) => {
        if (String(url).includes('model=gpt-6-sol')) {
          window.__slowFilterRequested = true;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return original(url, options);
      };
    });
    await page.locator('#model').selectOption('gpt-6-sol');
    await page.waitForFunction(() => window.__slowFilterRequested === true);
    await page.locator('#model').selectOption('gpt-6-astra');
    await page.waitForFunction(() => {
      const names = [...document.querySelectorAll('.model-name')].map((node) => node.textContent);
      return names.length === 1 && names[0] === 'gpt-6-astra';
    });
    await page.evaluate(() => window.__restoreFetch());
    const downloadReady = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloadReady;
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(exported.schema, 1);
    assert.deepEqual(
      exported.models.map((model) => model.name),
      ['gpt-6-astra'],
    );
    await page.locator('#model').selectOption('');
    await page.waitForFunction(() => document.querySelectorAll('.model-name').length >= 3);
    await page.getByRole('button', { name: 'By day', exact: true }).click();
    checks.push('stale filter response rejection and actual JSON export for current filters');

    for (const view of ['limits', 'health']) {
      await nav(view);
      await capture(`${view}-dark`);
    }
    await nav('limits');
    await page.getByRole('button', { name: 'Configure billing comparison', exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('#settings-tab-billing')?.getAttribute('aria-selected') === 'true',
    );
    await page.locator('#settings-tab-appearance').click();
    await capture('settings-appearance-dark');
    await uiSize(22);
    await page.locator('#settings-tab-reporting').click();
    await page.locator('#settings-timezone').fill('Asia/Kolkata');
    await page.locator('#settings-tab-appearance').click();
    assert.equal(await page.locator('#settings-font-size').inputValue(), '22');
    await page.locator('#settings-font-slider').focus();
    await page.locator('#settings-font-slider').press('ArrowRight');
    assert.equal(await page.locator('#settings-font-size').inputValue(), '23');
    await page.locator('#font-size-reset').click();
    assert.equal(await page.locator('#settings-font-size').inputValue(), '17');
    respondDialog(false);
    await page.locator('.primary-nav [data-view=overview]').click();
    assert.equal(await page.locator('#title').textContent(), 'Settings');
    respondDialog(true);
    await nav('overview');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fontSize), '17');
    await nav('settings');
    await page.locator('#settings-page-size').selectOption('10');
    await save();
    await nav('sessions');
    assert.equal(await page.locator('.session-choice').count(), 10);
    await page.locator('#sessions-next').click();
    assert.equal(await page.locator('.session-choice').count(), expected.sessions.length - 10);
    await page.locator('#sessions-prev').click();
    checks.push('settings edits persist across tabs, preview/reset/discard, saved pagination');

    await nav('settings');
    await uiSize(20);
    await save();
    assert.equal((await rpc(home, '/api/settings')).values.dashboard.fontSize, 20);
    await page.locator('#settings-tab-billing').click();
    await page.locator('#billing-day').fill('32');
    await page.locator('#settings-tab-appearance').click();
    await page.locator('#settings-save').click();
    assert.equal(await page.locator('#settings-tab-billing').getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'billing-day');
    await page.locator('#billing-day').fill('6');
    await page.locator('#settings-tab-appearance').click();
    await page.locator('#settings-font-size').fill('25');
    await page.locator('#settings-save').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-font-size');
    assert.equal((await rpc(home, '/api/settings')).values.dashboard.fontSize, 20);
    await uiSize(17);
    await save();
    const revision = await rpc(home, '/api/settings');
    await rpc(home, '/api/settings', {
      revision: revision.revision,
      changes: { dashboard: { fontSize: 18 } },
    });
    await uiSize(21);
    await page.locator('#settings-save').click();
    await page.waitForFunction(
      () => document.querySelector('#settings-message')?.getAttribute('data-state') === 'error',
    );
    assert.equal(await page.locator('#settings-font-size').inputValue(), '21');
    respondDialog(true);
    await page.locator('#settings-reload').click();
    await page.waitForFunction(() => document.querySelector('#settings-font-size')?.value === '18');
    await uiSize(17);
    await save();
    checks.push(
      'full-document size save/readback, hidden invalid-field focus, range validation, revision conflict and reload',
    );

    for (const theme of ['light', 'dark']) {
      await nav('settings');
      await page.locator('#settings-theme').selectOption(theme);
      await save();
      for (const size of [14, 17, 24]) {
        await uiSize(size);
        await save();
        for (const view of ['overview', 'sessions', 'limits', 'health', 'settings']) {
          await nav(view);
          await capture(`${view}-${theme}-${size}`);
        }
      }
      await uiSize(17);
      await save();
      for (const tab of ['reporting', 'billing']) {
        await page.locator(`#settings-tab-${tab}`).click();
        await capture(`settings-${tab}-${theme}`);
      }
      await page.locator('#settings-tab-appearance').click();
    }
    await page.locator('#settings-theme').selectOption('system');
    await save();
    await page.emulateMedia({ colorScheme: 'light' });
    const systemLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.locator('#settings-theme').selectOption('light');
    const explicitLight = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    assert.equal(systemLight, explicitLight);
    await save();
    checks.push('dark/light/system, every page at 14/17/24, proportional font scaling');
    for (const width of [1280, 1920, 960]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['overview', 'sessions', 'settings']) {
        await nav(view);
        await capture(`${view}-window-${width}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
    if (fixtureMode && !appearanceOnly) {
      fixtureOffline = true;
      await nav('overview');
      await page.locator('#refresh').click();
      await page.waitForFunction(
        () => document.querySelector('#connection')?.textContent === 'Collector unavailable',
      );
      assert.equal(
        await page.locator('.summary-ribbon').count(),
        1,
        'last loaded data retained offline',
      );
      await capture('offline-retained-data');
      fixtureOffline = false;
      await page.locator('#refresh').click();
      await page.waitForFunction(
        () => document.querySelector('#connection')?.textContent === 'Collector connected',
      );
      checks.push('explicit transport error retains visible history and recovers');
    }
    assert.deepEqual(pageErrors, [], 'no unhandled browser errors');
    assert.deepEqual(
      (await rpc(home, '/api/report?scope=lifetime&account=all')).totals,
      expected.totals,
      'appearance does not modify accounting',
    );
    const result = {
      status: 'PASS',
      mode: fixtureMode
        ? 'explicit DOM transport fixture plus independent real HTTP collector'
        : 'live authenticated browser',
      appearanceOnly,
      node: process.version,
      browser: browser.version(),
      checks,
      checkpoints: audits.length,
      textScaleObservations: scales.reduce((n, row) => n + row.observations, 0),
      audits,
      scales,
    };
    if (output) fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, audits: undefined, scales: undefined }, null, 2));
    await context.close();
    return result;
  } finally {
    if (service) await service.close();
    await browser.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
module.exports = { runWorkspaceChecks };
if (require.main === module)
  runWorkspaceChecks().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
