'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
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
const store = new Store(temp);
store.close();
let browser, service;
async function main() {
  service = await startService(temp);
  browser = await playwright.chromium.launch({
    headless: true,
    ...(process.env.CODEX_REPORT_BROWSER_PATH
      ? { executablePath: process.env.CODEX_REPORT_BROWSER_PATH }
      : {}),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
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
      if (snapshot.tasks.length === 12) break;
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
    await page.evaluate((snapshot) => {
      window.fetch = async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes('/api/status')
              ? { revision: snapshot.revision, accounts: ['all', 'demo'] }
              : snapshot,
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
    }, snapshot);
    await page.addScriptTag({
      content: fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'),
    });
  } else await page.goto(service.url);
  await page.waitForFunction(
    () => document.getElementById('connection').textContent === 'Collector connected',
  );
  await page.selectOption('#period', 'lifetime');
  await page.waitForFunction(() => document.querySelectorAll('details.task').length > 0);
  const out = process.env.CODEX_REPORT_SCREENSHOTS;
  if (out) fs.mkdirSync(out, { recursive: true });
  if (out) await page.screenshot({ path: path.join(out, 'dashboard-desktop.png'), fullPage: true });
  await page.click('button[data-view="turns"]');
  assert.equal(await page.locator('details.task').count(), 12);
  await page.locator('details.task summary').first().click();
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('details.task').first().getAttribute('open'), '');
  await page.selectOption('#account', 'demo');
  await page.waitForTimeout(100);
  assert.equal(await page.inputValue('#account'), 'demo');
  await page.click('button[data-view="limits"]');
  await page.waitForSelector('.quota');
  assert.ok((await page.textContent('#content')).includes('100%'));
  if (out) await page.screenshot({ path: path.join(out, 'dashboard-limits.png'), fullPage: true });
  await page.click('button[data-view="health"]');
  assert.ok((await page.textContent('#content')).includes('Source status'));
  await page.click('button[data-view="overview"]');
  await page.setViewportSize({ width: 390, height: 844 });
  if (out) await page.screenshot({ path: path.join(out, 'dashboard-mobile.png'), fullPage: true });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'No page overflow on mobile',
  );
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
        checks: [
          'real collector snapshot',
          'dashboard boot',
          'twelve visible synthetic turns',
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
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    await service?.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
