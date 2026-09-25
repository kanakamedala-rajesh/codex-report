'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  initializeConfig,
  loadConfig,
  saveConfig,
  dashboardPreferences,
} = require('../dist/config');
const {
  settingsSnapshot,
  settingsUpdate,
  settingsRevision,
  saveSettings,
} = require('../dist/settings');
const { Store } = require('../dist/database');
const { startService, rpc } = require('../dist/service');
function init(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-settings-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const c = initializeConfig(home);
  c.port = 0;
  c.pollMs = 500;
  c.sources = [];
  saveConfig(home, c);
  return { home, c };
}
function update(c, changes) {
  return { revision: settingsRevision(c), changes };
}

test('old config reads with dark-compatible preferences without being rewritten', (t) => {
  const { home, c } = init(t);
  delete c.dashboard;
  delete c.sessionNames;
  saveConfig(home, c);
  const before = fs.readFileSync(path.join(home, 'config.json'));
  const loaded = loadConfig(home);
  assert.equal(dashboardPreferences(loaded).theme, 'dark');
  assert.equal(settingsSnapshot(loaded).values.dashboard.sessionsPerPage, 20);
  assert.deepEqual(fs.readFileSync(path.join(home, 'config.json')), before);
});
test('browser settings projection excludes secrets, sources and device identity', (t) => {
  const { c } = init(t);
  c.accounts.premium = { billingDay: 6, monthlyUsd: 100, privateExtra: 'sensitive' };
  const snapshot = settingsSnapshot(c);
  assert.equal(snapshot.values.accounts.premium.billingDay, 6);
  const text = JSON.stringify(snapshot);
  for (const secret of [c.token, c.deviceId, 'sources', 'privateExtra', 'sensitive'])
    assert.ok(!text.includes(secret));
});
test('settings partial merge preserves sources, price basis, other accounts and immutable fields', (t) => {
  const { c } = init(t);
  c.accounts.other = { billingDay: 21, monthlyUsd: 200 };
  const next = settingsUpdate(
    c,
    update(c, { dashboard: { theme: 'light' }, accounts: { premium: { billingDay: 31 } } }),
  );
  assert.equal(next.dashboard.defaultPeriod, 'cycle');
  assert.equal(next.accounts.other.billingDay, 21);
  assert.equal(next.accounts.premium.billingDay, 31);
  assert.deepEqual(next.sources, c.sources);
  assert.equal(next.token, c.token);
  assert.equal(next.priceBasis, c.priceBasis);
  assert.equal(c.dashboard.theme, 'dark');
});
for (const [name, changes] of [
  ['port', { port: 8000 }],
  ['token', { token: 'bad' }],
  ['sources', { sources: [] }],
  ['price basis', { priceBasis: 'recorded' }],
  ['unknown', { unexpected: true }],
  ['theme', { dashboard: { theme: 'blue' } }],
  ['theme array', { dashboard: { theme: ['dark'] } }],
  ['page', { dashboard: { defaultView: 'invalid' } }],
  ['period', { dashboard: { defaultPeriod: 'hour' } }],
  ['page size', { dashboard: { sessionsPerPage: 1000000 } }],
  ['page string', { dashboard: { sessionsPerPage: '20' } }],
  ['model control', { dashboard: { defaultModel: 'model\u0000' } }],
  ['timezone', { timezone: 'No/Such_Zone' }],
  ['mode', { display: 'noisy' }],
  ['billing day', { accounts: { premium: { billingDay: 0 } } }],
  ['billing time', { accounts: { premium: { billingTime: '25:90' } } }],
  ['billing zone type', { accounts: { premium: { timezone: [] } } }],
  ['negative fee', { accounts: { premium: { monthlyUsd: -1 } } }],
  [
    'ambiguous fee',
    { accounts: { premium: { monthlyUsd: 100, subscriptionAmount: 100, localPerUsd: 1 } } },
  ],
  ['missing conversion', { accounts: { premium: { subscriptionAmount: 100 } } }],
  ['bad currency', { accounts: { premium: { currency: 'usd' } } }],
  ['protected account', { accounts: { all: { billingDay: 5 } } }],
  ['private account field', { accounts: { premium: { token: 'x' } } }],
])
  test(`invalid ${name} rejected without changing config`, (t) => {
    const { home, c } = init(t);
    const before = fs.readFileSync(path.join(home, 'config.json'));
    assert.throws(() => saveSettings(home, update(c, changes)));
    assert.deepEqual(fs.readFileSync(path.join(home, 'config.json')), before);
    assert.equal(fs.existsSync(path.join(home, 'backups')), false);
  });
test('prototype keys are rejected, never merged', (t) => {
  const { c } = init(t);
  const attack = JSON.parse('{"accounts":{"__proto__":{"monthlyUsd":100}}}');
  assert.throws(() => settingsUpdate(c, update(c, attack)), /label/);
  assert.equal({}.monthlyUsd, undefined);
});
test('settings write is backed up, repeat no-op creates no extra backup, stale revision conflicts', (t) => {
  const { home, c } = init(t);
  const before = fs.readFileSync(path.join(home, 'config.json'));
  const next = saveSettings(
    home,
    update(c, { timezone: 'Asia/Kolkata', dashboard: { theme: 'system' } }),
  );
  const backups = fs.readdirSync(path.join(home, 'backups'));
  assert.equal(backups.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(home, 'backups', backups[0])), before);
  assert.equal(loadConfig(home).timezone, 'Asia/Kolkata');
  saveSettings(home, update(next, { timezone: 'Asia/Kolkata' }));
  assert.equal(fs.readdirSync(path.join(home, 'backups')).length, 1);
  assert.throws(
    () => saveSettings(home, update(c, { timezone: 'UTC' })),
    (e) => e.statusCode === 409,
  );
});
test('clearing billing removes only selected values and preserves another account', (t) => {
  const { c } = init(t);
  c.accounts.premium = { billingDay: 6, monthlyUsd: 100, timezone: 'Asia/Kolkata' };
  c.accounts.standard = { billingDay: 21 };
  const next = settingsUpdate(
    c,
    update(c, { accounts: { premium: { billingDay: null, monthlyUsd: null } } }),
  );
  assert.deepEqual(next.accounts.premium, { timezone: 'Asia/Kolkata' });
  assert.deepEqual(next.accounts.standard, { billingDay: 21 });
});
test('local session name can be cleared without altering the underlying session', (t) => {
  const { c } = init(t);
  const next = settingsUpdate(
    c,
    update(c, { sessionNames: { 'thread-1': '  Work on dashboard  ' } }),
  );
  assert.equal(next.sessionNames['thread-1'], 'Work on dashboard');
  assert.deepEqual(
    settingsUpdate(next, update(next, { sessionNames: { 'thread-1': null } })).sessionNames,
    {},
  );
  assert.throws(() => settingsUpdate(c, update(c, { sessionNames: { 'thread-1': 'a\nb' } })));
  assert.throws(() =>
    settingsUpdate(c, update(c, { sessionNames: { 'thread-1': 'x'.repeat(121) } })),
  );
});

test('live settings endpoint protects writes, rejects conflicts, and hot-reloads billing/reporting', async (t) => {
  const { home, c } = init(t);
  const store = new Store(home);
  store.close();
  const service = await startService(home);
  try {
    const base = service.url.split('/#')[0];
    assert.equal((await fetch(base + '/api/settings')).status, 401);
    const auth = await fetch(base + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: c.token }),
    });
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    const getSettings = async () =>
      (await fetch(base + '/api/settings', { headers: { Cookie: cookie } })).json();
    const initial = await getSettings();
    const post = (payload, extra = {}, method = 'POST') =>
      fetch(base + '/api/settings', {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base, ...extra },
        body: typeof payload === 'string' ? payload : JSON.stringify(payload),
      });
    const body = { revision: initial.revision, changes: { dashboard: { theme: 'light' } } };
    assert.equal((await post(body, { Origin: 'https://evil.example' })).status, 403);
    assert.equal(
      (
        await fetch(base + '/api/settings', {
          method: 'POST',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
      403,
      'cookie writes without Origin rejected',
    );
    assert.equal((await post(body, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('{"revision":"x","revision":"y","changes":{}}')).status, 400);
    assert.equal((await post({ revision: initial.revision, changes: { port: 10 } })).status, 400);
    assert.equal((await post(body, {}, 'PUT')).status, 405);
    assert.equal(
      (
        await post({
          revision: initial.revision,
          changes: { dashboard: { defaultModel: 'x'.repeat(66000) } },
        })
      ).status,
      413,
    );
    const responses = await Promise.all([post(body), post(body)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const after = await getSettings();
    assert.equal(after.values.dashboard.theme, 'light');
    assert.equal(after.values.accounts.premium, undefined);
    const saved = await post({
      revision: after.revision,
      changes: {
        timezone: 'Asia/Kolkata',
        reportAccount: 'premium',
        display: 'detailed',
        accounts: { premium: { billingDay: 31, timezone: 'Asia/Kolkata', monthlyUsd: 100 } },
      },
    });
    assert.equal(saved.status, 200);
    const live = await rpc(home, '/api/report');
    assert.equal(live.account, 'premium');
    assert.equal(live.period.label, 'billing cycle');
    assert.equal(live.period.timezone, 'Asia/Kolkata');
    assert.ok((await rpc(home, '/api/status')).accounts.includes('premium'));
    assert.equal(loadConfig(home).display, 'detailed');
    assert.equal(loadConfig(home).token, c.token);
    const readStore = new Store(home, true);
    try {
      assert.equal(readStore.db.prepare('SELECT COUNT(*) AS n FROM samples').get().n, 0);
      assert.equal(
        readStore.db
          .prepare("SELECT COUNT(*) AS n FROM audit WHERE action='dashboard-settings'")
          .get().n,
        2,
      );
    } finally {
      readStore.close();
    }
    assert.equal((await fetch(base + '/config.json', { headers: { Cookie: cookie } })).status, 404);
    const settingsText = JSON.stringify(await getSettings());
    assert.ok(!settingsText.includes(c.token));
    assert.ok(!settingsText.includes(home));
  } finally {
    await service.close();
  }
  const restarted = await startService(home);
  try {
    assert.equal((await rpc(home, '/api/settings')).values.dashboard.theme, 'light');
  } finally {
    await restarted.close();
  }
});

test('live preferences and fee changes preserve recorded tokens, prices, and ownership', async (t) => {
  const { home, c } = init(t);
  const store = new Store(home);
  const sample = {
    id: 'n:keep',
    thread: 'root',
    turn: 'turn',
    rootThread: 'root',
    rootTurn: 'turn',
    at: '2026-09-24T10:00:00.000Z',
    model: 'frozen-price-model',
    effort: 'medium',
    tier: 'default',
    account: 'unattributed',
    device: 'fixture',
    format: 'native',
    input: 100,
    output: 10,
    cached: 50,
    write: 0,
    reasoning: 3,
    pricePico: '1234500000000',
    priceSnapshot: '{"source":"frozen"}',
    priceReason: null,
  };
  store.writeBatch({
    threads: [],
    turns: [],
    quotas: [],
    issues: [],
    tools: [],
    samples: [sample],
  });
  const before = store.db.prepare('SELECT * FROM samples WHERE id=?').get('n:keep');
  store.close();
  const service = await startService(home);
  try {
    const state = await rpc(home, '/api/settings');
    await rpc(home, '/api/settings', {
      revision: state.revision,
      changes: {
        accounts: { premium: { billingDay: 6, monthlyUsd: 150 } },
        reportAccount: 'premium',
        sessionNames: { root: 'Reporting work' },
      },
    });
    const read = new Store(home, true);
    try {
      assert.deepEqual(read.db.prepare('SELECT * FROM samples WHERE id=?').get('n:keep'), before);
    } finally {
      read.close();
    }
    assert.equal(loadConfig(home).token, c.token);
  } finally {
    await service.close();
  }
});
