const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseRecord, tokenVector } = require('../dist/parser');
const { initialState } = require('../dist/types');
const { Store } = require('../dist/database');
const { initializeConfig, loadConfig, validateConfig } = require('../dist/config');
const { assertRuntime } = require('../dist/version');
const { priceSample, loadPrices, dollars } = require('../dist/pricing');
const { atomicWrite, within } = require('../dist/util');
const at = '2026-09-24T08:00:00.000Z';
const line = (type, payload) => ({ timestamp: at, type, payload });
const tokens = {
  input_tokens: 1000,
  cached_input_tokens: 800,
  cache_write_input_tokens: 20,
  output_tokens: 100,
  reasoning_output_tokens: 60,
  total_tokens: 1100,
};
function state(id = 'root', parent = null) {
  const s = initialState();
  parseRecord(
    line('session_meta', {
      id,
      session_id: parent || id,
      parent_thread_id: parent,
      timestamp: at,
      source: 'cli',
    }),
    s,
    'test',
    'device',
  );
  return s;
}
function sample(s = state()) {
  parseRecord(line('turn_context', { turn_id: 't1', model: 'gpt-6-sol' }), s, 'test', 'device');
  return parseRecord(
    line('token_usage_record', {
      thread_id: s.owner.id,
      session_id: 'root',
      root_turn_id: 't1',
      turn_id: 't1',
      response_id: 'r1',
      usage: tokens,
    }),
    s,
    'test',
    'device',
  );
}
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('runtime accepts the specified minimum and later runtimes', () => {
  assert.doesNotThrow(() => assertRuntime('18.20.8'));
  assert.doesNotThrow(() => assertRuntime('24.11.0'));
  assert.throws(() => assertRuntime('18.19.0'));
});
test('fresh configuration and repeated initialization preserve identity/token', (t) => {
  const h = temp(t);
  const a = initializeConfig(h);
  const b = initializeConfig(h);
  assert.deepEqual(a, b);
  assert.equal(loadConfig(h).schema, 1);
});
for (const [field, value] of [
  ['port', -1],
  ['pollMs', 1],
  ['display', 'bad'],
  ['timezone', 'Invalid/Zone'],
])
  test(`reject invalid configuration ${field}`, (t) => {
    const c = initializeConfig(temp(t));
    assert.throws(() => validateConfig({ ...c, [field]: value }));
  });
test('token fields retain reasoning as a subset', () => {
  assert.deepEqual(tokenVector(tokens), {
    input: 1000,
    cached: 800,
    write: 20,
    output: 100,
    reasoning: 60,
  });
  assert.equal(tokenVector({ ...tokens, reasoning_output_tokens: 101 }), null);
  assert.equal(tokenVector({ ...tokens, cached_input_tokens: 2000 }), null);
});
test('first physical session owner cannot be replaced by inherited parent', () => {
  const s = state('child', 'root');
  parseRecord(line('session_meta', { id: 'root', session_id: 'root' }), s, 'test', 'device');
  assert.equal(s.owner.id, 'child');
  const b = sample(s);
  assert.equal(b.samples[0].thread, 'child');
});
test('foreign inherited native request is not attributed to child', () => {
  const s = state('child', 'root');
  assert.equal(
    parseRecord(
      line('token_usage_record', {
        thread_id: 'root',
        turn_id: 't1',
        response_id: 'r1',
        usage: tokens,
      }),
      s,
      'test',
      'device',
    ).samples.length,
    0,
  );
});
test('quota-only notification retained with its real window', () => {
  const s = state();
  const b = parseRecord(
    line('event_msg', {
      type: 'token_count',
      info: null,
      rate_limits: {
        limit_id: 'codex',
        primary: { window_minutes: 10080, used_percent: 42, resets_at: 1790000000 },
      },
    }),
    s,
    'test',
    'device',
  );
  assert.equal(b.quotas[0].minutes, 10080);
  assert.equal(b.samples.length, 0);
});
test('terminal errors preserve failure codes without private messages', () => {
  const s = state();
  parseRecord(line('event_msg', { type: 'task_started', turn_id: 't1' }), s, 'test', 'device');
  const b = parseRecord(
    line('event_msg', {
      type: 'error',
      codex_error_info: 'usage_limit_exceeded',
      message: 'PRIVATE',
    }),
    s,
    'test',
    'device',
  );
  assert.equal(b.turns[0].status, 'failed');
  assert.ok(!JSON.stringify(b).includes('PRIVATE'));
});
test('manual cancellation is not completion', () => {
  const s = state();
  parseRecord(line('event_msg', { type: 'task_started', turn_id: 't1' }), s, 'test', 'device');
  assert.equal(
    parseRecord(line('event_msg', { type: 'turn_aborted', turn_id: 't1' }), s, 'test', 'device')
      .turns[0].status,
    'interrupted',
  );
});
test('SQLite persists, deduplicates and rolls transactions back', (t) => {
  const h = temp(t);
  let db = new Store(h);
  const b = sample();
  db.transaction(() => db.writeBatch(b));
  db.transaction(() => db.writeBatch(b));
  assert.equal(db.samples().length, 1);
  assert.throws(() =>
    db.transaction(() => {
      db.db.exec('DELETE FROM samples');
      throw Error('rollback');
    }),
  );
  assert.equal(db.samples().length, 1);
  db.close();
  db = new Store(h, true);
  assert.equal(db.samples().length, 1);
  db.close();
});
test('writer lease protects shared store', (t) => {
  const h = temp(t);
  const db = new Store(h);
  try {
    assert.throws(() => new Store(h), /Collector is running/);
  } finally {
    db.close();
  }
});
test('native data supersedes same-turn fallback without doubling totals', (t) => {
  const db = new Store(temp(t));
  try {
    const b = sample();
    db.transaction(() => {
      db.writeBatch({ ...b, samples: [{ ...b.samples[0], id: 'l:fake', format: 'legacy' }] });
      db.writeBatch(b);
    });
    assert.equal(db.samples().length, 1);
  } finally {
    db.close();
  }
});
test('frozen price fields survive duplicate observations', (t) => {
  const h = temp(t);
  const db = new Store(h);
  try {
    const b = sample();
    b.samples[0] = priceSample(b.samples[0], loadPrices(h), 'standard');
    db.transaction(() => db.writeBatch(b));
    db.transaction(() => db.writeBatch(sample()));
    assert.equal(db.samples()[0].pricePico, b.samples[0].pricePico);
  } finally {
    db.close();
  }
});
test('backup is a valid standalone SQLite database', (t) => {
  const h = temp(t);
  const db = new Store(h);
  try {
    db.transaction(() => db.writeBatch(sample()));
    const target = path.join(h, 'backup.sqlite3');
    db.backup(target);
    assert.ok(fs.readFileSync(target).subarray(0, 16).toString().startsWith('SQLite format 3'));
    assert.throws(() => db.backup(target));
  } finally {
    db.close();
  }
});
test('price arithmetic includes cache writes but never charges reasoning twice', (t) => {
  const h = temp(t);
  const s = sample().samples[0];
  const p = priceSample(s, loadPrices(h), 'standard');
  assert.equal(
    p.pricePico,
    String(180n * 2000000n + 800n * 200000n + 20n * 2500000n + 100n * 10000000n),
  );
  assert.equal(
    priceSample({ ...s, model: 'codex-auto-review' }, loadPrices(h), 'standard').pricePico,
    null,
  );
  assert.equal(dollars(null), 'unpriced');
});
test('atomic output preserves a complete replacement', (t) => {
  const h = temp(t);
  const p = path.join(h, 'a');
  atomicWrite(p, 'old');
  atomicWrite(p, 'new');
  assert.equal(fs.readFileSync(p, 'utf8'), 'new');
  assert.equal(within(p, [h]), true);
  assert.equal(within('/etc/passwd', [h]), false);
});
