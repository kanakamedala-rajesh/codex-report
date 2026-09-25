'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { launchBrowser } = require('./browser-launch.cjs');
const { auditSurface } = require('./ui-audit.cjs');
const playwright = require(process.env.CODEX_REPORT_PLAYWRIGHT || 'playwright-core');
const { initializeConfig, saveConfig } = require('../dist/config');
const { Store } = require('../dist/database');
const { startService, rpc } = require('../dist/service');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-browser-'));
const source = path.join(temp, 'sessions');
fs.mkdirSync(source);
const config = initializeConfig(temp);
config.port = 0;
config.pollMs = 500;
config.sources = [{ name: 'synthetic', path: source, kind: 'rollouts', account: 'demo' }];
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
async function main() {
  // Fail with setup instructions before launching a collector when the browser is absent.
  browser = await launchBrowser(playwright);
  service = await startService(temp);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  async function visit(name) {
    const target = page.locator(`button[data-view="${name}"]`);
    if (await page.locator('#nav-toggle').isVisible()) {
      if ((await page.locator('#nav-toggle').getAttribute('aria-expanded')) !== 'true')
        await page.click('#nav-toggle');
    }
    await target.click();
    await page.waitForFunction(
      (name) =>
        document.querySelector(`button[data-view="${name}"]`).getAttribute('aria-current') ===
        'page',
      name,
    );
  }
  const audit = [];
  const errors = [],
    external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:')) external.push(r.url());
  });
  if (process.env.CODEX_REPORT_BROWSER_FIXTURE === '1') {
    // Offline DOM fixture rendering is a separate check, not a live browser test.
    // It does not navigate to an address blocked by managed browser policy.
    let snapshot;
    for (let n = 0; n < 30; n++) {
      snapshot = await rpc(temp, '/api/report?scope=lifetime');
      if (snapshot.tasks.length === 13) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await page.setContent(
      fs
        .readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
        .replace(/<link[^>]+>/g, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''),
    );
    await page.addStyleTag({
      content: fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8'),
    });
    const settings = await rpc(temp, '/api/settings');
    await page.evaluate(
      ({ snapshot, settings }) => {
        let revision = 0;
        const data = structuredClone(snapshot);
        const prefs = structuredClone(settings);
        // This branch only exercises DOM behavior with synthetic responses.
        // Real auth, validation, persistence and conflicts have HTTP integration tests.
        window.fetch = async (url, options) => {
          let result;
          if (String(url).includes('/api/settings')) {
            if (options?.method === 'POST') {
              const changes = JSON.parse(options.body).changes;
              if (changes.dashboard) Object.assign(prefs.values.dashboard, changes.dashboard);
              for (const key of ['timezone', 'display', 'reportAccount'])
                if (key in changes) prefs.values[key] = changes[key];
              if (changes.accounts) Object.assign(prefs.values.accounts, changes.accounts);
              if (changes.sessionNames)
                for (const [id, name] of Object.entries(changes.sessionNames))
                  data.sessions.find((s) => s.id === id).name = name;
              prefs.revision = 'fixture-' + ++revision;
            }
            result = prefs;
          } else if (String(url).includes('/api/status'))
            result = {
              revision: data.revision + revision,
              settingsRevision: prefs.revision,
              accounts: ['all', 'demo'],
            };
          else result = data;
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        };
      },
      { snapshot, settings },
    );
    await page.addScriptTag({
      content: fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'),
    });
  } else await page.goto(service.url);
  await page.waitForFunction(
    () => document.getElementById('connection').textContent === 'Collector connected',
  );
  await page.selectOption('#period', 'lifetime');
  await page.waitForFunction(() => document.querySelectorAll('details.task').length > 0);
  await page.waitForSelector('.activity-chart');
  assert.equal(await page.locator('.activity-chart').getAttribute('role'), 'img');
  assert.equal(
    await page.locator('.activity-chart g[data-day]').count(),
    Number(await page.locator('.activity-chart').getAttribute('data-days')),
  );
  await page.click('.chart-data > summary');
  assert.ok(await page.locator('.chart-data table tbody tr').count());
  await page.click('#refresh');
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('.chart-data').getAttribute('open'), '');
  await page.click('.chart-data > summary');

  audit.push(await auditSurface(page, 'overview-dark'));
  const out = process.env.CODEX_REPORT_SCREENSHOTS;
  if (out) fs.mkdirSync(out, { recursive: true });
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-desktop.png'),
      fullPage: true,
    });
  await visit('sessions');
  assert.equal(await page.locator('details.session').count(), 2);
  audit.push(await auditSurface(page, 'sessions-dark'));
  await page.evaluate(() => window.scrollTo(0, 0));
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-sessions.png'),
      fullPage: true,
    });
  const mainSession = page.locator('details.session[data-session="demo-thread"]');
  await mainSession.locator(':scope > summary').click();
  assert.equal(await mainSession.locator('details.task').count(), 12);
  assert.ok((await mainSession.textContent()).includes('Usage exceeded'));
  await mainSession.locator('details.task summary').first().click();
  await page.waitForTimeout(2200);
  assert.equal(await mainSession.getAttribute('open'), '');
  assert.equal(await mainSession.locator('details.task').first().getAttribute('open'), '');
  await mainSession.getByRole('button', { name: 'Name session' }).click();
  await page.fill('#session-name', '<img src=x onerror=alert(1)>');
  await page.click('#rename-save');
  await page.waitForFunction(() => !document.getElementById('rename-dialog').open);
  await page.waitForFunction(() =>
    document
      .querySelector('.session[data-session="demo-thread"] .session-title')
      .textContent.includes('<img'),
  );
  assert.equal(await mainSession.locator('img').count(), 0, 'name rendered as text, never markup');
  await mainSession.getByRole('button', { name: 'Name session' }).click();
  await page.fill('#session-name', 'Usage collector refinements');
  await page.click('#rename-save');
  await page.waitForFunction(() => !document.getElementById('rename-dialog').open);
  await page.fill('#session-search', 'second-thread');
  assert.equal(await page.locator('details.session').count(), 1);
  await page.fill('#session-search', '');
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-sessions-dark.png'),
      fullPage: true,
    });
  await page.selectOption('#account', 'demo');
  await page.waitForTimeout(100);
  assert.equal(await page.inputValue('#account'), 'demo');
  await visit('limits');
  await page.waitForSelector('.quota');
  assert.ok((await page.textContent('#content')).includes('100%'));
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-limits.png'),
      fullPage: true,
    });
  audit.push(await auditSurface(page, 'comparison-dark'));
  await visit('health');
  assert.ok((await page.textContent('#content')).includes('Source status'));
  audit.push(await auditSurface(page, 'health-dark'));
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-health.png'),
      fullPage: true,
    });
  await visit('settings');
  await page.waitForSelector('#settings-form');
  audit.push(await auditSurface(page, 'settings-dark'));
  await page.selectOption('#settings-theme', 'light');
  await page.selectOption('#settings-view', 'sessions');
  await page.selectOption('#settings-period', '5h');
  await page.fill('#settings-timezone', 'Asia/Kolkata');
  await page.fill('#billing-account', 'demo');
  await page.locator('#billing-account').press('Tab');
  await page.fill('#billing-day', '31');
  await page.fill('#billing-time', '09:00');
  await page.selectOption('#billing-fee-mode', 'usd');
  await page.fill('#billing-usd', '120');
  await page.waitForTimeout(2200);
  await visit('settings');
  assert.equal(await page.inputValue('#billing-day'), '31', 'live refresh does not erase edits');
  assert.equal(await page.inputValue('#settings-theme'), 'light');
  await page.click('#settings-save');
  await page.waitForFunction(() =>
    document.getElementById('settings-message').textContent.startsWith('Saved.'),
  );
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.evaluate(() => window.scrollTo(0, 0));
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-settings-light.png'),
      fullPage: true,
    });
  await page.selectOption('#settings-theme', 'system');
  await page.click('#settings-save');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'light',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
    'dark',
  );
  await page.selectOption('#settings-theme', 'light');
  await page.click('#settings-save');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  audit.push(await auditSurface(page, 'settings-light'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'settings mobile fit',
  );
  audit.push(await auditSurface(page, 'settings-mobile'));
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-settings-mobile.png'),
      fullPage: true,
    });
  await visit('sessions');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#nav-toggle');
  assert.equal(await page.locator('#main').getAttribute('inert'), '');
  assert.ok(
    await page
      .locator('button[data-view="settings"]')
      .evaluate((n) => n.getBoundingClientRect().right <= window.innerWidth),
    'Settings navigation accessible in the mobile drawer',
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(
    await page.locator('#nav-toggle').evaluate((n) => n === document.activeElement),
    true,
  );
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-sessions-mobile.png'),
      fullPage: true,
    });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'sessions mobile fit',
  );
  audit.push(await auditSurface(page, 'sessions-mobile'));
  await visit('overview');
  await page.setViewportSize({ width: 390, height: 844 });
  if (out)
    await page.screenshot({
      animations: 'disabled',
      path: path.join(out, 'dashboard-mobile.png'),
      fullPage: true,
    });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'No page overflow on mobile',
  );
  audit.push(await auditSurface(page, 'overview-mobile'));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.waitForTimeout(200);
  audit.push(await auditSurface(page, 'overview-320px'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.click('#nav-toggle');
  assert.equal(
    await page.locator('#navigation').evaluate((n) => getComputedStyle(n).transitionDuration),
    '0s',
  );
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        mode:
          process.env.CODEX_REPORT_BROWSER_FIXTURE === '1'
            ? 'offline DOM fixtures with real collector snapshot'
            : 'live browser',
        browser: browser.version(),
        playwright: require(
          path.join(process.env.CODEX_REPORT_PLAYWRIGHT || 'playwright-core', 'package.json'),
        ).version,
        audit,
        checks: [
          'real collector snapshot',
          'recorded-day chart with exact values and preserved table expansion',
          'mobile drawer, keyboard Escape and focus restoration',
          'text contrast, 44px controls and reduced motion',
          'dashboard boot',
          'two grouped sessions / thirteen turns',
          'usage-exceeded display status',
          'local session nickname with HTML treated as text',
          'session search',
          'settings save and dirty-form preservation',
          'dark, light, and system theme behavior',
          'mobile sessions and settings',
          'expanded state retained',
          'account filter',
          'provider quota view',
          'data health view',
          '390px viewport without overflow',
          'no page errors',
          'no external requests',
        ],
      },
      null,
      2,
    ),
  );
}
main()
  .finally(async () => {
    try {
      await browser?.close();
    } finally {
      try {
        await service?.close();
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    }
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
