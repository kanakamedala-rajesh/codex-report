'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { launchBrowser } = require('./browser-launch.cjs');
const playwright = require(process.env.CODEX_REPORT_PLAYWRIGHT || 'playwright-core');
const { initializeConfig, saveConfig } = require('../dist/config');
const { Store } = require('../dist/database');
const { auditDesktop } = require('./ui-audit.cjs');
const { startService, rpc } = require('../dist/service');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-browser-'));
const source = path.join(temp, 'sessions');
fs.mkdirSync(source);
const config = initializeConfig(temp);
config.port = 0;
config.pollMs = 500;
config.sources = [{ name: 'synthetic', path: source, kind: 'rollouts', account: 'demo' }];
config.dashboard.defaultPeriod = 'lifetime';
config.sessionNames = {
  'demo-thread': 'Dashboard improvements',
  'second-thread': 'Release validation',
};
saveConfig(temp, config);
const line = (type, payload, at) => JSON.stringify({ timestamp: at, type, payload }) + '\n';
const file = path.join(source, 'demo.jsonl');
const start = Date.now() - 5 * 86400000;
let content = line(
  'session_meta',
  { id: 'demo-thread', session_id: 'demo-thread', source: 'cli' },
  new Date(start).toISOString(),
);
for (let i = 0; i < 12; i++) {
  const at = new Date(start + i * 10 * 3600000).toISOString(),
    id = 'turn-' + i;
  const model = i % 3 === 0 ? 'gpt-6-astra' : i % 3 === 1 ? 'gpt-6-sol' : 'codex-auto-review';
  content +=
    line('turn_context', { turn_id: id, model, effort: 'medium' }, at) +
    line('event_msg', { type: 'task_started', turn_id: id }, at);
  for (let j = 0; j < 6; j++)
    content += line(
      'token_usage_record',
      {
        thread_id: 'demo-thread',
        session_id: 'demo-thread',
        turn_id: id,
        root_turn_id: id,
        response_id: `demo-${i}-${j}`,
        usage: {
          input_tokens: 25000 + i * 8500,
          cached_input_tokens: 18000 + i * 7000,
          output_tokens: 1000 + i * 75,
          reasoning_output_tokens: 400,
        },
      },
      at,
    );
  content += line(
    'event_msg',
    {
      type: i === 8 ? 'turn_aborted' : 'task_complete',
      turn_id: id,
      duration_ms: 120000 + i * 17000,
      ...(i === 11 ? { error: { codex_error_info: 'usage_limit_exceeded' } } : {}),
    },
    new Date(Date.parse(at) + 120000 + i * 17000).toISOString(),
  );
}
content += line(
  'event_msg',
  {
    type: 'token_count',
    info: null,
    rate_limits: {
      limit_id: 'codex',
      primary: {
        window_minutes: 300,
        used_percent: 100,
        resets_at: Math.floor(Date.now() / 1000) + 3600,
      },
      secondary: {
        window_minutes: 10080,
        used_percent: 38,
        resets_at: Math.floor(Date.now() / 1000) + 3 * 86400,
      },
    },
  },
  new Date().toISOString(),
);
fs.writeFileSync(file, content);
// A second root session deliberately has its own Turn 1.
const secondAt = new Date(Date.now() - 3600000).toISOString();
fs.writeFileSync(
  path.join(source, 'second.jsonl'),
  line(
    'session_meta',
    { id: 'second-thread', session_id: 'second-thread', source: 'cli' },
    secondAt,
  ) +
    line('event_msg', { type: 'task_started', turn_id: 'another-turn' }, secondAt) +
    line('event_msg', { type: 'turn_aborted', turn_id: 'another-turn' }, secondAt),
);
const store = new Store(temp);
store.close();
let browser, service;
const fixtureMode = process.env.CODEX_REPORT_UI_FIXTURE === '1';
const output = process.env.CODEX_REPORT_UI_OUTPUT;
const evidence = [];
async function fixturePage(page, snapshot) {
  // Explicit offline rendering mode for restricted test environments. API
  // security is tested separately by the real HTTP integration suite.
  await page.setContent(
    fs
      .readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
      .replace(/<link[^>]+style\.css[^>]*>/, '')
      .replace(/<script[^>]+app\.js[^>]*><\/script>/, ''),
  );
  await page.addStyleTag({
    content: fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8'),
  });
  await page.evaluate((snapshot) => {
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const settings = clone(snapshot.settings),
      report = clone(snapshot.report),
      status = clone(snapshot.status);
    let rev = 0;
    window.__fixture = { empty: false, offline: false, conflict: false, delay: 0, calls: 0 };
    window.fetch = async (url, options = {}) => {
      const state = window.__fixture;
      state.calls++;
      if (state.offline) throw new Error('Synthetic collector unavailable');
      let value;
      if (String(url).startsWith('/api/settings')) {
        if (options.method === 'POST') {
          const body = JSON.parse(options.body);
          if (state.conflict || body.revision !== settings.revision)
            return {
              ok: false,
              json: async () => ({
                error: 'Settings changed in another window. Reload before saving.',
              }),
            };
          const changes = body.changes;
          settings.values = {
            ...settings.values,
            ...changes,
            dashboard: { ...settings.values.dashboard, ...changes.dashboard },
            accounts: { ...settings.values.accounts, ...changes.accounts },
            sessionNames: { ...settings.values.sessionNames, ...changes.sessionNames },
          };
          // The real settings API removes optional fields when sent null.
          for (const account of Object.values(settings.values.accounts))
            for (const [key, value] of Object.entries(account))
              if (value === null) delete account[key];
          settings.revision = `fixture-${++rev}`;
          for (const session of report.sessions)
            if (changes.sessionNames && Object.hasOwn(changes.sessionNames, session.id))
              session.name = changes.sessionNames[session.id];
          status.settingsRevision = settings.revision;
          status.revision++;
        }
        value = settings;
      } else if (String(url).startsWith('/api/status')) value = status;
      else if (String(url).startsWith('/api/report')) {
        value = clone(report);
        const params = new URLSearchParams(String(url).split('?')[1]);
        value.account = params.get('account') || 'all';
        if (params.get('model')) {
          value.models = value.models.filter((m) => m.name === params.get('model'));
        }
        if (state.empty) {
          value.tasks = [];
          value.sessions = [];
          value.days = [];
          value.models = [];
          for (const key of [
            'input',
            'cached',
            'output',
            'reasoning',
            'processed',
            'requests',
            'pricedRequests',
            'unpricedRequests',
          ])
            value.totals[key] = 0;
          value.totals.pricePico = null;
          value.totals.apiEquivalent = 'unpriced';
          value.totals.cachePercent = null;
          value.statistics.tasks = 0;
        }
        if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
      } else value = { ok: true };
      return { ok: true, json: async () => clone(value) };
    };
  }, snapshot);
  await page.addScriptTag({
    content: fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'),
  });
}
async function main() {
  browser = await launchBrowser(playwright);
  service = await startService(temp);
  await rpc(temp, '/api/sync', {});
  const snapshot = {
    report: await rpc(temp, '/api/report?scope=lifetime&account=all'),
    settings: await rpc(temp, '/api/settings'),
    status: await rpc(temp, '/api/status'),
  };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (fixtureMode) await fixturePage(page, snapshot);
  else await page.goto(service.url);
  await page.waitForSelector('.metric-strip');
  const go = async (name) => {
    await page.locator(`nav button[data-view="${name}"]`).click();
    await page.waitForFunction(
      (v) =>
        document.querySelector(`nav button[data-view="${v}"]`).getAttribute('aria-current') ===
        'page',
      name,
    );
  };
  const capture = async (name) => {
    // Measure settled colors, not the middle of a hover/theme transition.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    evidence.push(await auditDesktop(page, name));
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    }
  };
  // One batched desktop/zoom audit. No phone layout or touch-gesture claims.
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    for (const view of ['overview', 'sessions', 'limits', 'health', 'settings']) {
      await go(view);
      if (view === 'settings') await page.waitForSelector('#settings-form');
      await capture(`${view}-${theme}-1440`);
    }
  }
  await go('overview');
  await page.getByRole('button', { name: 'By model', exact: true }).click();
  assert.equal(await page.locator('table').count(), 1);
  await capture('models-light-1440');
  await page.getByRole('button', { name: 'By day', exact: true }).click();
  await page.locator('.chart-data summary').click();
  await capture('exact-values-light-1440');
  await go('sessions');
  await page.locator('.session > summary').first().click();
  await page.locator('.session[open] .task > summary').first().click();
  await capture('session-detail-light-1440');
  const key = await page.locator('.session[open]').getAttribute('data-session');
  await page.locator('#refresh').click();
  await page.waitForFunction(
    (key) =>
      document.querySelector(`details[data-session="${key}"]`)?.open &&
      !document.getElementById('refresh').disabled,
    key,
  );
  assert.ok(await page.locator('.task[open]').count());
  await page.locator('#session-search').fill('no-such-session');
  assert.equal(await page.locator('.session').count(), 0);
  await page.locator('#session-search').fill('');
  const first = page.locator('.session').first();
  if (!(await first.evaluate((node) => node.open))) await first.locator(':scope > summary').click();
  await first.getByRole('button', { name: /Name session|Rename session/ }).click();
  await page.locator('#session-name').fill('<img src=x onerror=alert(1)>');
  await page.locator('#rename-save').click();
  await page.waitForSelector('#rename-dialog', { state: 'hidden' });
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  assert.equal(await page.locator('.session-title img').count(), 0);
  assert.ok(
    (await page.locator('.session-title').allTextContents()).some((v) => v.includes('<img')),
  );
  await go('settings');
  await page.waitForSelector('#settings-form');
  await page.locator('#settings-tab-reporting').click();
  await page.locator('#settings-timezone').fill('Asia/Kolkata');
  await page.locator('#settings-tab-billing').click();
  await page.locator('#billing-day').fill('6');
  await page.locator('#settings-tab-appearance').click();
  await page.locator('#settings-theme').selectOption('light');
  assert.equal(await page.locator('#settings-timezone').inputValue(), 'Asia/Kolkata');
  assert.equal(await page.locator('#billing-day').inputValue(), '6');
  await page.locator('#settings-save').click();
  await page.waitForFunction(() =>
    document.getElementById('settings-message').textContent.startsWith('Saved.'),
  );
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.locator('#settings-tab-reporting').click();
  await page.locator('#settings-timezone').fill('Etc/UTC');
  await page.waitForTimeout(2100);
  assert.equal(await page.locator('#settings-timezone').inputValue(), 'Etc/UTC');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('nav button[data-view="sessions"]').click();
  assert.equal(await page.locator('#settings-form').count(), 1, 'dirty navigation retained');
  await page.locator('#settings-timezone').fill('');
  await page.locator('#settings-tab-billing').click();
  await page.locator('#billing-day').fill('32');
  await page.locator('#settings-tab-appearance').click();
  await page.locator('#settings-save').click();
  assert.equal(await page.locator('#settings-tab-reporting').getAttribute('aria-selected'), 'true');
  assert.equal(
    await page.locator('#settings-timezone').evaluate((n) => n === document.activeElement),
    true,
  );
  await page.locator('#settings-timezone').fill('Etc/UTC');
  await page.locator('#settings-tab-appearance').click();
  await page.locator('#settings-save').click();
  assert.equal(await page.locator('#settings-tab-billing').getAttribute('aria-selected'), 'true');
  await page.locator('#billing-day').fill('6');
  await page.locator('#settings-save').click();
  await page.waitForFunction(() =>
    document.getElementById('settings-message').textContent.startsWith('Saved.'),
  );
  await page.locator('#settings-tab-appearance').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#settings-tab-reporting').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('End');
  assert.equal(await page.locator('#settings-tab-billing').getAttribute('aria-selected'), 'true');
  await capture('billing-light-1440');
  for (const width of [1280, 1920, 960]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ['overview', 'sessions', 'settings']) {
      await go(view);
      if (view === 'settings') await page.waitForSelector('#settings-form');
      await capture(`${view}-desktop-${width}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'system';
  });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'light',
  );
  await go('overview');
  await capture('system-light-reduced-motion');
  if (fixtureMode) {
    await go('settings');
    await page.waitForSelector('#settings-form');
    await page.locator('#settings-tab-reporting').click();
    await page.locator('#settings-timezone').fill('Asia/Kolkata');
    await page.evaluate(() => {
      window.__fixture.conflict = true;
    });
    await page.locator('#settings-save').click();
    await page.waitForFunction(
      () => document.getElementById('settings-message').dataset.state === 'error',
    );
    assert.equal(await page.locator('#settings-timezone').inputValue(), 'Asia/Kolkata');
    await capture('settings-conflict');
    await page.evaluate(() => {
      window.__fixture.conflict = false;
    });
    await page.locator('#settings-save').click();
    await page.waitForFunction(
      () => document.getElementById('settings-message').dataset.state === 'saved',
    );
    await go('overview');
    await page.evaluate(() => {
      window.__fixture.delay = 150;
    });
    await page.locator('#model').selectOption('gpt-6-sol');
    await page.locator('#model').selectOption('gpt-6-astra');
    await page.waitForFunction(() => !document.getElementById('refresh').disabled);
    assert.equal(await page.locator('#model').inputValue(), 'gpt-6-astra');
    await page.getByRole('button', { name: 'By model', exact: true }).click();
    await page.waitForFunction(() => {
      const names = [...document.querySelectorAll('.model-name')].map((node) => node.textContent);
      return names.length === 1 && names[0] === 'gpt-6-astra';
    });
    await page.getByRole('button', { name: 'By day', exact: true }).click();
    await page.locator('#model').selectOption('');
    await page.evaluate(() => {
      window.__fixture.delay = 0;
    });
    await page.waitForFunction(() => !document.getElementById('refresh').disabled);
    await page.evaluate(() => {
      window.__fixture.empty = true;
    });
    await page.locator('#refresh').click();
    await page.waitForFunction(() =>
      document.querySelector('#content').textContent.includes('No activity for these filters'),
    );
    await capture('empty-desktop');
    await page.evaluate(() => {
      window.__fixture.empty = false;
      window.__fixture.offline = true;
    });
    await page.locator('#refresh').click();
    await page.waitForSelector('#error:not(.hidden)');
    assert.equal(await page.locator('.metric-strip').count(), 1, 'offline retains content');
    await capture('offline-desktop');
    await page.evaluate(() => {
      window.__fixture.offline = false;
    });
    await page.locator('#refresh').click();
    await page.waitForSelector('#error', { state: 'hidden' });
  }
  assert.deepEqual(errors, []);
  const result = {
    status: 'PASS',
    mode: fixtureMode
      ? 'explicit offline UI fixtures; HTTP checked separately'
      : 'live authenticated HTTP',
    engine: await browser.version(),
    scope: 'computer viewports and narrow desktop/zoom reflow; no phone layout target',
    checks: evidence,
  };
  if (output) fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (service) await service.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
