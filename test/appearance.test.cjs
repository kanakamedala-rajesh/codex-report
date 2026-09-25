'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  initializeConfig,
  saveConfig,
  loadConfig,
  dashboardPreferences,
} = require('../dist/config');
const {
  settingsSnapshot,
  settingsRevision,
  settingsUpdate,
  saveSettings,
} = require('../dist/settings');
const { Store } = require('../dist/database');
const { startService, rpc } = require('../dist/service');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-appearance-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const config = initializeConfig(home);
  config.port = 0;
  config.pollMs = 500;
  config.sources = [];
  saveConfig(home, config);
  return { home, config };
}
function payload(config, fontSize) {
  return { revision: settingsRevision(config), changes: { dashboard: { fontSize } } };
}

test('older configuration receives a nominal 17px default without rewriting it', (t) => {
  const { home, config } = fixture(t);
  delete config.dashboard.fontSize;
  saveConfig(home, config);
  const before = fs.readFileSync(path.join(home, 'config.json'));
  const loaded = loadConfig(home);
  assert.equal(loaded.dashboard.fontSize, undefined);
  assert.equal(dashboardPreferences(loaded).fontSize, 17);
  assert.equal(settingsSnapshot(loaded).values.dashboard.fontSize, 17);
  assert.deepEqual(fs.readFileSync(path.join(home, 'config.json')), before);
});
for (let fontSize = 14; fontSize <= 24; fontSize++) {
  test(`font size ${fontSize} survives save, reload and settings projection`, (t) => {
    const { home, config } = fixture(t);
    const next = saveSettings(home, payload(config, fontSize));
    assert.equal(next.dashboard.fontSize, fontSize);
    assert.equal(loadConfig(home).dashboard.fontSize, fontSize);
    assert.equal(settingsSnapshot(next).values.dashboard.fontSize, fontSize);
    assert.equal(config.dashboard.fontSize, 17, 'input object not mutated');
    assert.equal(next.token, config.token);
    assert.equal(next.deviceId, config.deviceId);
  });
}
for (const [name, value] of [
  ['below range', 13],
  ['above range', 25],
  ['fraction', 18.5],
  ['negative', -17],
  ['numeric string', '20'],
  ['null', null],
  ['array', [20]],
  ['object', {}],
  ['NaN', NaN],
  ['infinity', Infinity],
  ['CSS injection', '17%;color:red'],
  ['boolean', true],
]) {
  test(`rejects ${name} without a settings write or backup`, (t) => {
    const { home, config } = fixture(t);
    const before = fs.readFileSync(path.join(home, 'config.json'));
    assert.throws(() => saveSettings(home, payload(config, value)), /font size/);
    assert.deepEqual(fs.readFileSync(path.join(home, 'config.json')), before);
    assert.equal(fs.existsSync(path.join(home, 'backups')), false);
  });
}
test('partial theme/default changes retain the selected size and reject stale writers', (t) => {
  const { home, config } = fixture(t);
  const next = saveSettings(home, payload(config, 22));
  const changed = settingsUpdate(next, {
    revision: settingsRevision(next),
    changes: { dashboard: { theme: 'system' } },
  });
  assert.equal(changed.dashboard.fontSize, 22);
  assert.equal(changed.dashboard.theme, 'system');
  assert.throws(
    () => saveSettings(home, payload(config, 14)),
    (e) => e.statusCode === 409,
  );
  assert.equal(loadConfig(home).dashboard.fontSize, 22);
});
test('all root scale steps are relative and no descendant font has a fixed pixel size', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
  for (let size = 14; size <= 24; size++) {
    const match = css.match(
      new RegExp(`:root\\[data-font-size='${size}'\\]\\s*\\{\\s*font-size:\\s*([\\d.]+)%`),
    );
    assert.ok(match, `missing root scale ${size}`);
    assert.equal(Number(match[1]), (size / 16) * 100);
  }
  assert.doesNotMatch(css, /font(?:-size)?\s*:[^;{}]*\b\d+(?:\.\d+)?px\b/);
  assert.doesNotMatch(css, /\bzoom\s*:/);
  assert.doesNotMatch(css, /@import|@font-face/);
  assert.match(css, /option,\s*optgroup,\s*output\s*\{\s*font: inherit/s);
});
test('light and system-light theme tokens stay identical', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
  const tokens = (theme) => {
    const match = css.match(new RegExp(`:root\\[data-theme='${theme}'\\]\\s*\\{([^}]+)\\}`));
    assert.ok(match);
    return [...match[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  };
  assert.deepEqual(tokens('system'), tokens('light'));
});
test('live font-size settings are validated, audited and retained after restart', async (t) => {
  const { home, config } = fixture(t);
  const store = new Store(home);
  store.writeBatch({
    threads: [],
    turns: [],
    quotas: [],
    tools: [],
    issues: [],
    samples: [
      {
        id: 'n:preserved-font-test',
        thread: 'test-thread',
        turn: 'test-turn',
        rootThread: 'test-thread',
        rootTurn: 'test-turn',
        at: '2026-09-24T10:00:00.000Z',
        model: 'frozen-price-model',
        effort: 'medium',
        tier: 'default',
        account: 'explicit-owner',
        device: 'test-device',
        format: 'native',
        input: 12880,
        output: 542,
        cached: 9900,
        write: 0,
        reasoning: 35,
        pricePico: '125000000000',
        priceSnapshot: '{"source":"frozen-test"}',
        priceReason: null,
      },
    ],
  });
  const preserved = store.db
    .prepare('SELECT * FROM samples WHERE id=?')
    .get('n:preserved-font-test');
  store.close();
  const service = await startService(home);
  try {
    const before = await rpc(home, '/api/report?scope=lifetime');
    const initial = await rpc(home, '/api/settings');
    const base = service.url.split('/#')[0];
    const save = (size, revision = initial.revision, extra = {}) =>
      fetch(base + '/api/settings', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + config.token,
          'Content-Type': 'application/json',
          ...extra,
        },
        body: JSON.stringify({ revision, changes: { dashboard: { fontSize: size } } }),
      });
    assert.equal((await save(99)).status, 400);
    assert.equal(
      (await save(22, initial.revision, { Origin: 'https://untrusted.example' })).status,
      403,
    );
    const response = await save(22);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.values.dashboard.fontSize, 22);
    assert.equal((await save(20)).status, 409);
    assert.equal((await rpc(home, '/api/settings')).values.dashboard.fontSize, 22);
    assert.equal((await rpc(home, '/api/status')).settingsRevision, saved.revision);
    assert.deepEqual((await rpc(home, '/api/report?scope=lifetime')).totals, before.totals);
    assert.equal(loadConfig(home).token, config.token);
    const read = new Store(home, true);
    try {
      assert.deepEqual(
        read.db.prepare('SELECT * FROM samples WHERE id=?').get('n:preserved-font-test'),
        preserved,
      );
      assert.equal(
        read.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='dashboard-settings'").get()
          .n,
        1,
      );
    } finally {
      read.close();
    }
  } finally {
    await service.close();
  }
  const restarted = await startService(home);
  try {
    assert.equal((await rpc(home, '/api/settings')).values.dashboard.fontSize, 22);
  } finally {
    await restarted.close();
  }
});
