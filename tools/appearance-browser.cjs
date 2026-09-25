'use strict';
// This test always uses disposable synthetic records. Fixture mode must be explicit;
// it tests DOM behavior, not browser transport, authentication, or persistence.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { launchBrowser } = require('./browser-launch.cjs');
const playwright = require(process.env.CODEX_REPORT_PLAYWRIGHT || 'playwright-core');
const { initializeConfig, saveConfig } = require('../dist/config');
const { Store } = require('../dist/database');
const { startService, rpc } = require('../dist/service');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-font-ui-'));
const source = path.join(home, 'sessions');
fs.mkdirSync(source);
const config = initializeConfig(home);
config.sources = [{ name: 'synthetic', path: source, kind: 'rollouts', account: 'demo' }];
config.port = 0;
config.pollMs = 500;
config.dashboard.defaultPeriod = 'lifetime';
config.sessionNames = { 'session-demo': 'Build tooling and dashboard improvements' };
config.accounts.demo = { billingDay: 6 };
saveConfig(home, config);
const line = (type, payload, timestamp) => JSON.stringify({ type, payload, timestamp }) + '\n';
const now = Date.now();
let content = line(
  'session_meta',
  { id: 'session-demo', source: 'cli' },
  new Date(now - 5 * 86400000).toISOString(),
);
for (let i = 0; i < 9; i++) {
  const at = new Date(now - (9 - i) * 12 * 3600000).toISOString();
  const model = i === 8 ? 'codex-auto-review' : i % 2 ? 'gpt-6-sol' : 'gpt-6-astra';
  content += line('turn_context', { turn_id: 't' + i, model, effort: 'medium' }, at);
  content += line('event_msg', { type: 'task_started', turn_id: 't' + i }, at);
  for (let j = 0; j < 8; j++)
    content += line(
      'token_usage_record',
      {
        thread_id: 'session-demo',
        session_id: 'session-demo',
        turn_id: 't' + i,
        root_turn_id: 't' + i,
        response_id: `response-${i}-${j}`,
        usage: {
          input_tokens: 140000 + i * 13000,
          cached_input_tokens: 120000 + i * 12000,
          output_tokens: 3300,
          reasoning_output_tokens: 1200,
        },
      },
      at,
    );
  content += line(
    'event_msg',
    {
      type: i === 5 ? 'turn_aborted' : 'task_complete',
      turn_id: 't' + i,
      ...(i === 7 ? { error: { codex_error_info: 'usage_limit_exceeded' } } : {}),
    },
    new Date(Date.parse(at) + 260000).toISOString(),
  );
}
content += line(
  'event_msg',
  {
    type: 'token_count',
    info: null,
    rate_limits: {
      limit_id: 'codex',
      primary: { window_minutes: 300, used_percent: 81, resets_at: Math.floor(now / 1000) + 3600 },
      secondary: {
        window_minutes: 10080,
        used_percent: 34,
        resets_at: Math.floor(now / 1000) + 86400,
      },
    },
  },
  new Date(now).toISOString(),
);
fs.writeFileSync(path.join(source, 'demo.jsonl'), content);
const store = new Store(home);
store.close();
let service, browser;
const results = [];
const fixtureMode = process.env.CODEX_REPORT_BROWSER_FIXTURE === '1';
const output = process.env.CODEX_REPORT_UI_OUTPUT;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Measures every visible element carrying direct text, and every native text
// control, rather than checking only a few headings. Native browser chrome is
// outside document CSS; placeholder and marker styles are sampled separately.
async function measure(page) {
  await page.waitForTimeout(180);
  return page.evaluate(() => {
    const rgb = (value) => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = (values) =>
      values.slice(0, 3).reduce((sum, value, index) => {
        const v = value / 255;
        return (
          sum +
          (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]
        );
      }, 0);
    const contrast = (foreground, background) => {
      const a = luminance(foreground),
        b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const bg = (node) => {
      let n = node;
      while (n) {
        const color = rgb(getComputedStyle(n).backgroundColor);
        if (color.length === 3 || color[3] === 1) return color;
        n = n.parentElement;
      }
      return rgb(getComputedStyle(document.body).backgroundColor);
    };
    const errors = [],
      sizes = {},
      placeholders = {};
    for (const [index, node] of [...document.querySelectorAll('body *')].entries()) {
      if (!(node instanceof HTMLElement) || !node.getClientRects().length) continue;
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || node.closest('.sr-only')) continue;
      const isControl = node.matches('input:not([type="range"]),select,textarea,output');
      const hasText = [...node.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
      );
      if (!hasText && !isControl) continue;
      const key = `${index}:${node.tagName}:${node.id || node.className}`;
      const font = parseFloat(style.fontSize);
      sizes[key] = font;
      if (node.matches('input[placeholder]'))
        placeholders[key] = parseFloat(getComputedStyle(node, '::placeholder').fontSize);
      const color = rgb(style.color);
      const ratio = contrast(color, bg(node));
      const minimum = font >= 24 || (font >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      if (ratio + 0.015 < minimum)
        errors.push({
          key,
          text: (node.textContent || node.value || '').trim().slice(0, 65),
          contrast: ratio,
          minimum,
        });
    }
    const controls = [...document.querySelectorAll('button,input,select,summary')].filter(
      (n) => n.getClientRects().length,
    );
    for (const node of controls) {
      const rect = node.getBoundingClientRect();
      if (rect.height < 43.8)
        errors.push({ control: node.id || node.tagName, height: rect.height });
      if (node.matches('button') && !(node.textContent.trim() || node.getAttribute('aria-label')))
        errors.push({ unnamed: node.outerHTML });
    }
    const ids = [...document.querySelectorAll('[id]')].map((n) => n.id);
    if (ids.length !== new Set(ids).size) errors.push({ duplicateIds: true });
    if (document.documentElement.scrollWidth > window.innerWidth + 1)
      errors.push({ overflow: document.documentElement.scrollWidth, viewport: window.innerWidth });
    return {
      sizes,
      placeholders,
      errors,
      root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      canvas: getComputedStyle(document.body).backgroundColor,
    };
  });
}
async function main() {
  browser = await launchBrowser(playwright);
  service = await startService(home);
  let report;
  for (let i = 0; i < 60; i++) {
    report = await rpc(home, '/api/report?scope=lifetime');
    if (report.tasks.length === 9) break;
    await pause(100);
  }
  assert.equal(report.tasks.length, 9);
  const settings = await rpc(home, '/api/settings');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function open() {
    if (!fixtureMode) {
      await page.goto(service.url);
    } else {
      await page.goto('about:blank');
      await page.setContent(
        fs
          .readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
          .replace(/<link[^>]+>/g, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/g, ''),
      );
      await page.addStyleTag({
        content: fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8'),
      });
      await page.evaluate(
        ({ report, settings }) => {
          const prefs = structuredClone(settings);
          const snapshot = structuredClone(report);
          let revision = 0;
          window.fetch = async (url, options) => {
            let value;
            const route = String(url);
            if (route.includes('/api/settings')) {
              if (options?.method === 'POST') {
                const body = JSON.parse(options.body);
                if (body.revision !== prefs.revision)
                  return new Response(
                    JSON.stringify({
                      error: 'Settings changed in another window. Reload settings before saving.',
                    }),
                    { status: 409 },
                  );
                if (body.changes.dashboard)
                  Object.assign(prefs.values.dashboard, body.changes.dashboard);
                for (const key of ['timezone', 'reportAccount', 'display'])
                  if (key in body.changes) prefs.values[key] = body.changes[key];
                if (body.changes.accounts) {
                  for (const [label, changes] of Object.entries(body.changes.accounts)) {
                    const account = { ...prefs.values.accounts[label] };
                    for (const [key, value] of Object.entries(changes)) {
                      if (value === null) delete account[key];
                      else account[key] = value;
                    }
                    prefs.values.accounts[label] = account;
                  }
                }
                prefs.revision = 'saved-' + ++revision;
              }
              value = prefs;
            } else if (route.includes('/api/status'))
              value = {
                revision: report.revision + revision,
                settingsRevision: prefs.revision,
                accounts: ['all', 'demo'],
              };
            else value = snapshot;
            return new Response(JSON.stringify(value), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          };
        },
        { report, settings },
      );
      await page.addScriptTag({
        content: fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'),
      });
    }
    await page.waitForFunction(
      () => document.getElementById('connection').textContent === 'Collector connected',
    );
  }
  await open();
  const rootSize = () =>
    page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.click('[data-view="settings"]');
  await page.waitForSelector('#settings-font-size');
  assert.equal(await page.inputValue('#settings-font-size'), '17');
  await page.fill('#settings-font-size', '22');
  assert.equal(await rootSize(), 22, 'numeric preview affects root immediately');
  assert.equal(await page.inputValue('#settings-font-slider'), '22');
  await page.click('#settings-tab-reporting');
  assert.equal(await rootSize(), 22, 'tab switch keeps preview');
  await page.click('#settings-tab-appearance');
  await page.click('#font-size-reset');
  assert.equal(await rootSize(), 17);
  await page.locator('#settings-font-slider').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await rootSize(), 18, 'keyboard slider input works');
  await page.selectOption('#settings-theme', 'light');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.click('[data-view="overview"]');
  assert.equal(await page.locator('#settings-form').count(), 1, 'cancel discard preserves form');
  assert.equal(await rootSize(), 18);
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('[data-view="overview"]');
  assert.equal(await rootSize(), 17, 'accepted discard restores saved size');
  assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
  await page.click('[data-view="settings"]');
  await page.waitForSelector('#settings-font-size');
  await page.fill('#settings-font-size', '24');
  await page.click('#settings-save');
  await page.waitForFunction(
    () => document.getElementById('settings-message').dataset.state === 'saved',
  );
  assert.equal(
    await page.evaluate(
      async () => (await (await fetch('/api/settings')).json()).values.dashboard.fontSize,
    ),
    24,
  );
  if (!fixtureMode) assert.equal((await rpc(home, '/api/settings')).values.dashboard.fontSize, 24);
  await page.click('[data-view="overview"]');
  assert.equal(await rootSize(), 24);
  await page.click('[data-view="settings"]');
  await page.waitForSelector('#settings-font-size');
  assert.equal(
    await page.inputValue('#settings-font-size'),
    '24',
    'reopened form uses saved value',
  );
  await page.fill('#settings-font-size', '25');
  await page.click('#settings-tab-reporting');
  await page.click('#settings-save');
  assert.equal(await page.getAttribute('#settings-tab-appearance', 'aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-font-size');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#settings-reload');
  await page.waitForFunction(() => document.getElementById('settings-font-size').value === '24');
  assert.equal(await rootSize(), 24);
  await page.click('#font-size-reset');
  await page.click('#settings-save');
  await page.waitForFunction(
    () => document.getElementById('settings-message').dataset.state === 'saved',
  );
  results.push({
    interaction:
      'numeric/slider preview, reset, tabs, cancel/accept discard, save/readback, validation focus, reload',
    status: 'PASS',
  });

  // Run one batched visual/measurement pass; no alternate stylesheet or disabled
  // security assertion is introduced. All sizes use the actual appearance setter.
  if (output) fs.mkdirSync(output, { recursive: true });
  for (const theme of ['dark', 'light']) {
    await page.click('[data-view="settings"]');
    await page.waitForSelector('#settings-tab-appearance');
    await page.click('#settings-tab-appearance');
    await page.selectOption('#settings-theme', theme);
    await page.click('#settings-save');
    await page.waitForFunction(
      () => document.getElementById('settings-message').dataset.state === 'saved',
    );
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['overview', 'sessions', 'limits', 'health', 'settings']) {
        await page.click(`[data-view="${view}"]`);
        if (view === 'settings')
          await page.waitForSelector('#settings-font-size', { state: 'attached' });
        if (view === 'sessions') {
          await page
            .locator('details.session')
            .first()
            .evaluate((node) => {
              node.open = true;
            });
          await page
            .locator('details.task')
            .first()
            .evaluate((node) => {
              node.open = true;
            });
        }
        const sections = view === 'settings' ? ['appearance', 'reporting', 'billing'] : ['main'];
        for (const section of sections) {
          if (section !== 'main') await page.click(`#settings-tab-${section}`);
          await page.evaluate((theme) => window.applyTheme(theme), theme);
          await page.evaluate(() => window.applyFontSize(14));
          const small = await measure(page);
          await page.evaluate(() => window.applyFontSize(24));
          const large = await measure(page);
          for (const [key, value] of Object.entries(small.sizes)) {
            assert.ok(key in large.sizes, 'same content stays exposed when resized: ' + key);
            assert.ok(
              Math.abs(large.sizes[key] / value - 24 / 14) < 0.005,
              `unscaled text ${key}: ${value} -> ${large.sizes[key]}`,
            );
          }
          for (const [key, value] of Object.entries(small.placeholders))
            assert.ok(
              Math.abs(large.placeholders[key] / value - 24 / 14) < 0.005,
              'placeholder scales',
            );
          await page.evaluate(() => window.applyFontSize(17));
          const normal = await measure(page);
          results.push({
            theme,
            width,
            view,
            section,
            textElements: Object.keys(normal.sizes).length,
            errors: [...small.errors, ...normal.errors, ...large.errors],
            allTextScales: true,
          });
          if (output && width === 1440 && section !== 'reporting')
            await page.screenshot({
              path: path.join(output, `${view}-${section}-${theme}.png`),
              fullPage: true,
            });
        }
      }
    }
  }
  // Dialog text is outside main but must share the same root scale.
  await page.click('[data-view="sessions"]');
  await page
    .locator('details.session')
    .first()
    .evaluate((node) => {
      node.open = true;
    });
  await page
    .locator('button')
    .filter({ hasText: /Rename session|Name session/ })
    .first()
    .click();
  await page.waitForSelector('#rename-dialog[open]');
  await page.evaluate(() => window.applyFontSize(14));
  const a = await page
    .locator('#rename-dialog')
    .evaluate((node) =>
      [...node.querySelectorAll('*')]
        .filter((n) => n.getClientRects().length)
        .map((n) => parseFloat(getComputedStyle(n).fontSize)),
    );
  await page.evaluate(() => window.applyFontSize(24));
  const b = await page
    .locator('#rename-dialog')
    .evaluate((node) =>
      [...node.querySelectorAll('*')]
        .filter((n) => n.getClientRects().length)
        .map((n) => parseFloat(getComputedStyle(n).fontSize)),
    );
  a.forEach((size, i) => assert.ok(Math.abs(b[i] / size - 24 / 14) < 0.005));
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.applyFontSize(24);
    window.applyTheme('system');
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const light = await measure(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const dark = await measure(page);
  assert.notEqual(light.canvas, dark.canvas, 'system theme follows OS');
  results.push({ state: 'dialog/system-theme/reduced-motion', status: 'PASS' });
  const failures = results.flatMap((r) =>
    (r.errors || []).map((error) => ({
      theme: r.theme,
      width: r.width,
      view: r.view,
      section: r.section,
      ...error,
    })),
  );
  const evidence = {
    mode: fixtureMode
      ? 'explicit offline API fixtures; HTTP validated separately'
      : 'live authenticated service',
    node: process.version,
    browser: browser.version(),
    checkpoints: results,
    pageErrors: errors,
    failures,
  };
  if (output)
    fs.writeFileSync(
      path.join(output, 'appearance-audit.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    );
  assert.deepEqual(errors, [], 'browser errors');
  assert.deepEqual(failures, [], 'font/contrast/layout audit');
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        mode: evidence.mode,
        checkpoints: results.length,
        measuredElements: results.reduce((n, r) => n + (r.textElements || 0), 0),
        node: process.version,
        browser: evidence.browser,
      },
      null,
      2,
    ),
  );
}
main()
  .catch((error) => {
    console.error(String(error).replace(/#token=[a-zA-Z0-9]+/g, '#token=[redacted]'));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (service) await service.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
