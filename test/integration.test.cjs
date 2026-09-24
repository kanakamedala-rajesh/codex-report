const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { Store } = require('../dist/database');
const { Collector } = require('../dist/collector');
const { initializeConfig, saveConfig } = require('../dist/config');
const { report, receipt, exportReport } = require('../dist/reports');
const { configureHooks, handleHook, inspectHooks } = require('../dist/hooks');
const { period, wallInstant } = require('../dist/periods');
const { startService, rpc } = require('../dist/service');
const { exportData, importData } = require('../dist/maintenance');
function home(t) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-integrated-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  return p;
}
const at = '2026-09-24T08:00:00Z';
function line(type, payload, time = at) {
  return JSON.stringify({ timestamp: time, type, payload }) + '\n';
}
function fixture(id = 'root', parent = null, response = 'r1', outcome = 'completed') {
  return (
    line('session_meta', {
      id,
      session_id: parent || id,
      parent_thread_id: parent,
      timestamp: at,
      source: 'cli',
    }) +
    (parent ? line('session_meta', { id: parent, session_id: parent }) : '') +
    line('turn_context', {
      turn_id: id === 'root' ? 't1' : 'child-turn',
      model: 'gpt-6-sol',
      effort: 'medium',
    }) +
    line('event_msg', {
      type: 'task_started',
      turn_id: id === 'root' ? 't1' : 'child-turn',
      root_turn_id: 't1',
      started_at: 1790236800,
    }) +
    line('token_usage_record', {
      thread_id: id,
      session_id: parent || id,
      turn_id: id === 'root' ? 't1' : 'child-turn',
      root_turn_id: 't1',
      response_id: response,
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 800,
        output_tokens: 100,
        reasoning_output_tokens: 60,
        total_tokens: 1100,
      },
    }) +
    line(
      'event_msg',
      {
        type: outcome === 'interrupted' ? 'turn_aborted' : 'task_complete',
        turn_id: id === 'root' ? 't1' : 'child-turn',
        started_at: 1790236800,
        completed_at: 1790236860,
        duration_ms: 60000,
        ...(outcome === 'failed'
          ? { error: { codex_error_info: 'usage_limit_exceeded', message: 'PRIVATE' } }
          : {}),
      },
      '2026-09-24T08:01:00Z',
    )
  );
}
function init(t) {
  const h = home(t);
  const root = path.join(h, 'sessions');
  fs.mkdirSync(root);
  const c = initializeConfig(h);
  c.sources = [{ name: 'test', kind: 'rollouts', path: root, account: 'test' }];
  c.port = 0;
  c.pollMs = 500;
  saveConfig(h, c);
  return { h, root, c };
}
test('incremental JSONL persists cursor, excludes partial tail, and resumes exactly once', async (t) => {
  const { h, root, c } = init(t);
  const s = new Store(h);
  try {
    const p = path.join(root, 'a.jsonl');
    fs.writeFileSync(p, fixture() + '{"timestamp":');
    const collector = new Collector(s, c);
    const a = await collector.sync();
    assert.equal(a.added, 1);
    assert.equal(a.partial, 1);
    await collector.sync();
    assert.equal(s.samples().length, 1);
    fs.truncateSync(p, Buffer.byteLength(fixture()));
    await collector.sync();
    assert.equal(s.samples().length, 1);
  } finally {
    s.close();
  }
});
test('root turns and linked agents share one task without inherited duplicate turns', async (t) => {
  const { h, root, c } = init(t);
  fs.writeFileSync(path.join(root, 'a.jsonl'), fixture());
  fs.writeFileSync(path.join(root, 'b.jsonl'), fixture('child', 'root', 'r2'));
  const s = new Store(h);
  try {
    await new Collector(s, c).sync();
    const r = report(s, c, { scope: 'lifetime' });
    assert.equal(r.totals.processed, 2200);
    assert.equal(r.tasks.length, 1);
    assert.equal(r.tasks[0].workers, 1);
    assert.equal(r.tasks[0].number, 1);
    assert.equal(r.tasks[0].direct.processed, 1100);
  } finally {
    s.close();
  }
});
test('gzip import and duplicate plain copy do not double count', async (t) => {
  const { h, root, c } = init(t);
  fs.writeFileSync(path.join(root, 'a.jsonl'), fixture());
  fs.writeFileSync(path.join(root, 'a-copy.jsonl.gz'), zlib.gzipSync(fixture()));
  const s = new Store(h);
  try {
    await new Collector(s, c).sync();
    assert.equal(s.samples().length, 1);
  } finally {
    s.close();
  }
});
test('corrupt compression produces source health error without new usage', async (t) => {
  const { h, root, c } = init(t);
  fs.writeFileSync(path.join(root, 'a.jsonl.gz'), 'garbage');
  const s = new Store(h);
  try {
    const r = await new Collector(s, c).sync();
    assert.equal(r.failed, 1);
    assert.equal(s.samples().length, 0);
  } finally {
    s.close();
  }
});
test('hook setup preserves unrelated handlers and uninstall removes only owned definitions', (t) => {
  const { h, root } = init(t);
  const p = path.join(root, 'hooks.json');
  const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }] } };
  fs.writeFileSync(p, JSON.stringify(old));
  configureHooks(h, root);
  configureHooks(h, root);
  assert.equal(inspectHooks(h).length, 4);
  const x = JSON.parse(fs.readFileSync(p));
  assert.equal(x.hooks.Stop.length, 2);
  assert.equal(x.hooks.Interrupt[0].hooks[0].timeout, 3);
  configureHooks(h, root, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(p)), old);
});
test('manual interruption hook emits a labelled receipt and does not print for child event', async (t) => {
  const { h, root, c } = init(t);
  const p = path.join(root, 'a.jsonl');
  fs.writeFileSync(p, fixture('root', null, 'r1', 'interrupted'));
  const s = new Store(h);
  try {
    const input = {
      event: 'Interrupt',
      thread: 'root',
      turn: 't1',
      transcript: p,
      account: 'test',
    };
    const r = await handleHook(s, c, input);
    assert.match(r.systemMessage, /interrupted by you/);
    assert.equal(
      (await handleHook(s, c, { ...input, event: 'SubagentStop' })).systemMessage,
      undefined,
    );
  } finally {
    s.close();
  }
});
test('portable export/import is preview-first and idempotent', async (t) => {
  const a = init(t),
    b = init(t);
  fs.writeFileSync(path.join(a.root, 'a.jsonl'), fixture());
  const x = new Store(a.h),
    y = new Store(b.h);
  try {
    await new Collector(x, a.c).sync();
    const out = path.join(a.h, 'transfer.crx');
    exportData(x, out, 'A');
    assert.equal(importData(y, out).newRequests, 1);
    assert.equal(y.samples().length, 0);
    importData(y, out, true);
    importData(y, out, true);
    assert.equal(y.samples().length, 1);
    assert.ok(!zlib.gunzipSync(fs.readFileSync(out)).toString().includes(a.root));
  } finally {
    x.close();
    y.close();
  }
});
test('failed turn is ingested without a Stop callback', async (t) => {
  const { h, root, c } = init(t);
  fs.writeFileSync(path.join(root, 'a.jsonl'), fixture('root', null, 'r1', 'failed'));
  const s = new Store(h);
  try {
    await new Collector(s, c).sync();
    const r = report(s, c, { scope: 'lifetime' });
    assert.equal(r.tasks[0].status, 'failed');
    assert.equal(r.tasks[0].error, 'usage_limit_exceeded');
    assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  } finally {
    s.close();
  }
});
test('cycle clamp retains its anchor in the following month', () => {
  const p = period('cycle', 'UTC', { billingDay: 31 }, Date.parse('2026-03-10T00:00:00Z'));
  assert.equal(p.from, '2026-02-28T00:00:00.000Z');
  assert.equal(p.to, '2026-03-31T00:00:00.000Z');
});
test('India cycle and exact local midnight are converted to UTC', () => {
  const p = period('cycle', 'Asia/Kolkata', { billingDay: 6 }, Date.parse('2026-09-24T00:00:00Z'));
  assert.equal(p.from, '2026-09-05T18:30:00.000Z');
});
test('DST fold selects earlier occurrence and gap moves forward', () => {
  assert.equal(
    new Date(wallInstant([2026, 11, 1, 1, 30, 0], 'America/New_York')).toISOString(),
    '2026-11-01T05:30:00.000Z',
  );
  assert.equal(
    new Date(wallInstant([2026, 3, 8, 2, 30, 0], 'America/New_York')).toISOString(),
    '2026-03-08T07:30:00.000Z',
  );
});
test('all-unpriced reports never claim zero-dollar cost', async (t) => {
  const { h, root, c } = init(t);
  fs.writeFileSync(path.join(root, 'a.jsonl'), fixture().replaceAll('gpt-6-sol', 'unlisted'));
  const s = new Store(h);
  try {
    await new Collector(s, c).sync();
    const r = report(s, c, { scope: 'lifetime' });
    assert.equal(r.totals.pricePico, null);
    assert.match(receipt(r.tasks[0]), /unlisted request/);
    assert.ok(!exportReport(r, 'html').includes('$0.00'));
  } finally {
    s.close();
  }
});
test('live service authenticates, blocks cross-origin access and observes unhooked failure', async (t) => {
  const { h, root } = init(t);
  const s = new Store(h);
  s.close();
  const service = await startService(h);
  try {
    const base = service.url.split('/#')[0];
    assert.equal((await fetch(base + '/api/report')).status, 401);
    const token = new URLSearchParams(service.url.split('#')[1]).get('token');
    assert.equal(
      (
        await fetch(base + '/api/report', {
          headers: { Authorization: 'Bearer ' + token, Origin: 'https://example.com' },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + '/usage.sqlite3')).status, 404);
    fs.writeFileSync(path.join(root, 'a.jsonl'), fixture('root', null, 'r1', 'failed'));
    let result;
    for (let n = 0; n < 30; n++) {
      await new Promise((r) => setTimeout(r, 100));
      result = await rpc(h, '/api/report?scope=lifetime');
      if (result.tasks.length) break;
    }
    assert.equal(result.tasks[0].status, 'failed');
    assert.equal((await rpc(h, '/api/status')).backend.includes('sqlite'), true);
    const auth = await fetch(base + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    assert.equal(auth.status, 200);
    assert.match(auth.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  } finally {
    await service.close();
  }
});

test('multi-day aggregation sorts by day, not by converting SQLite rows to strings', async (t) => {
  const { h, root, c } = init(t);
  fs.writeFileSync(path.join(root, 'first.jsonl'), fixture());
  fs.writeFileSync(
    path.join(root, 'second.jsonl'),
    fixture('second', null, 'r2').replaceAll('2026-09-24', '2026-09-25'),
  );
  const s = new Store(h);
  try {
    await new Collector(s, c).sync();
    const r = report(s, c, { scope: 'lifetime' });
    assert.equal(r.days.length, 2);
    assert.ok(r.days[0].day < r.days[1].day);
  } finally {
    s.close();
  }
});
