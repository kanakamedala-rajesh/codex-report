const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Store } = require('../dist/database');
const { initializeConfig, validateConfig } = require('../dist/config');
const { Collector } = require('../dist/collector');
const { parseJson } = require('../dist/util');
const { tokenVector } = require('../dist/parser');
const { initialState } = require('../dist/types');
const { compressedBytes } = require('../dist/compression');
const { configureHooks, handleHook } = require('../dist/hooks');
const { restoreBackup, inspectBackup, assignAccount } = require('../dist/maintenance');
const { report } = require('../dist/reports');
function environment(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-safety-'));
  const root = path.join(home, 'sessions');
  fs.mkdirSync(root);
  const config = initializeConfig(home);
  config.sources = [{ name: 'test', path: root, kind: 'rollouts', account: 'unattributed' }];
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, root, config };
}
function record(type, payload) {
  return JSON.stringify({ timestamp: '2026-09-24T10:00:00.000Z', type, payload }) + '\n';
}
function sampleFile() {
  return (
    record('session_meta', { id: 'main', session_id: 'main', source: 'cli' }) +
    record('turn_context', { turn_id: 'one', model: 'gpt-6-sol' }) +
    record('event_msg', { type: 'task_started', turn_id: 'one' }) +
    record('token_usage_record', {
      thread_id: 'main',
      session_id: 'main',
      turn_id: 'one',
      root_turn_id: 'one',
      response_id: 'request-1',
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 800,
        output_tokens: 100,
        reasoning_output_tokens: 30,
      },
    })
  );
}
function rawZstd(text) {
  const b = Buffer.from(text);
  const header = Buffer.alloc(9);
  header.set([0x28, 0xb5, 0x2f, 0xfd, 0xa0]);
  header.writeUInt32LE(b.length, 5);
  const out = [header];
  for (let offset = 0; offset < b.length; offset += 128 * 1024) {
    const chunk = b.subarray(offset, offset + 128 * 1024);
    const h = Buffer.alloc(3);
    h.writeUIntLE((chunk.length << 3) | (offset + chunk.length === b.length ? 1 : 0), 0, 3);
    out.push(h, chunk);
  }
  return Buffer.concat(out);
}
for (const text of ['{"x":1,"x":2}', '{"a":{"x":1,"x":2}}', '{"x":1,"\\u0078":2}'])
  test('settings reject duplicate keys: ' + text, () =>
    assert.throws(() => parseJson(text), /Duplicate/),
  );
test('strict settings reader accepts nested arrays, escapes and independent keys', () =>
  assert.deepEqual(parseJson('{"a":[{"x":"a\\\"b"},{"x":2}],"b":null}'), {
    a: [{ x: 'a"b' }, { x: 2 }],
    b: null,
  }));
for (const field of ['cached_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens'])
  test('negative optional token count is not zeroed: ' + field, () =>
    assert.equal(tokenVector({ input_tokens: 10, output_tokens: 10, [field]: -1 }), null),
  );
test('unsafe account names are refused', (t) => {
  const { config } = environment(t);
  assert.throws(() => validateConfig({ ...config, accounts: JSON.parse('{"__proto__":{}}') }));
});
test('invalid hooks JSON is not overwritten', (t) => {
  const { home, root } = environment(t);
  const file = path.join(root, 'hooks.json');
  fs.writeFileSync(file, '[]');
  assert.throws(() => configureHooks(home, root));
  assert.equal(fs.readFileSync(file, 'utf8'), '[]');
});
test('second writer is refused without corrupting the first', (t) => {
  const { home } = environment(t);
  const a = new Store(home);
  try {
    assert.throws(() => new Store(home), /Collector is running/);
    a.audit('still-usable', {});
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 1);
  } finally {
    a.close();
  }
});
test('repeated interruption after clock advances is suppressed', async (t) => {
  const { home, root, config } = environment(t);
  const file = path.join(root, 'test.jsonl');
  fs.writeFileSync(file, sampleFile());
  const s = new Store(home);
  try {
    const input = {
      event: 'Interrupt',
      thread: 'main',
      turn: 'one',
      transcript: file,
      account: 'unattributed',
    };
    assert.ok((await handleHook(s, config, input)).systemMessage);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await handleHook(s, config, input), {});
    assert.equal(s.samples().length, 1);
  } finally {
    s.close();
  }
});
test('live capture labels only current unassigned turn and future linked requests', async (t) => {
  const { home, root, config } = environment(t);
  const file = path.join(root, 'test.jsonl');
  fs.writeFileSync(file, sampleFile());
  const s = new Store(home);
  try {
    await new Collector(s, config).sync();
    assert.equal(s.samples()[0].account, 'unattributed');
    await handleHook(s, config, {
      event: 'Stop',
      thread: 'main',
      turn: 'one',
      transcript: file,
      account: 'premium',
    });
    assert.equal(s.samples()[0].account, 'premium');
    s.captureAccount('main', 'one', 'other');
    assert.equal(s.samples()[0].account, 'premium');
    assert.equal(s.capturedAccount({ ...s.samples()[0], thread: 'child', turn: 'c' }), 'premium');
  } finally {
    s.close();
  }
});
test('Zstandard compressed fixture decodes with known independent hash', async () => {
  const out = await compressedBytes(path.join(__dirname, 'fixtures', 'hello.zst'), 200000);
  assert.equal(crypto.createHash('sha256').update(out).digest('hex').slice(0, 8), 'f2a8e35c');
});
test('Zstandard output is bounded and corrupt/truncated frames fail', async (t) => {
  const { home } = environment(t);
  await assert.rejects(compressedBytes(path.join(__dirname, 'fixtures', 'hello.zst'), 1000));
  const p = path.join(home, 'bad.zst');
  fs.writeFileSync(p, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0]));
  await assert.rejects(compressedBytes(p, 1000));
  fs.writeFileSync(p, 'not-zstd');
  await assert.rejects(compressedBytes(p, 1000));
});
test('raw valid Zstandard imports actual usage and deduplicates representation changes', async (t) => {
  const { home, root, config } = environment(t);
  const file = path.join(root, 'test.jsonl.zst');
  fs.writeFileSync(file, rawZstd(sampleFile()));
  const s = new Store(home);
  try {
    const c = new Collector(s, config);
    assert.equal((await c.sync()).added, 1);
    fs.writeFileSync(file.slice(0, -4), sampleFile());
    await c.sync();
    assert.equal(s.samples().length, 1);
  } finally {
    s.close();
  }
});
test('partial compressed cursor resumes rather than restarting at byte zero', async (t) => {
  const { home, root, config } = environment(t);
  const content = sampleFile(),
    file = path.join(root, 'test.jsonl.gz');
  fs.writeFileSync(file, zlib.gzipSync(content));
  const s = new Store(home);
  try {
    const state = initialState();
    const { parseRecord } = require('../dist/parser');
    const first = content.indexOf('\n') + 1;
    parseRecord(JSON.parse(content.slice(0, first)), state, 'unattributed', config.deviceId);
    const stat = fs.statSync(file);
    const prefix = Buffer.from(content).subarray(0, 256);
    s.db.prepare('INSERT INTO cursors VALUES(?,?,?,?,?,?,?)').run(
      fs.realpathSync(file),
      stat.size,
      stat.mtimeMs,
      first,
      JSON.stringify({
        parser: state,
        prefix: crypto.createHash('sha256').update(prefix).digest('hex'),
        prefixLength: prefix.length,
      }),
      'pending',
      new Date().toISOString(),
    );
    assert.equal((await new Collector(s, config).sync()).added, 1);
    assert.equal(s.samples().length, 1);
  } finally {
    s.close();
  }
});
test('backup restore preserves snapshot and refuses live source/active writer', (t) => {
  const { home } = environment(t);
  let s = new Store(home);
  const file = path.join(home, 'test-backup.sqlite3');
  s.audit('before', {});
  s.backup(file);
  s.audit('after', {});
  assert.throws(() => restoreBackup(home, file), /Collector is running/);
  s.close();
  restoreBackup(home, file);
  s = new Store(home);
  try {
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='after'").get().n, 0);
  } finally {
    s.close();
  }
  fs.writeFileSync(file + '-wal', 'uncheckpointed');
  assert.throws(() => inspectBackup(file), /live WAL/);
});
test('account reassignment requires explicit scope and previews without writes', async (t) => {
  const { home, root, config } = environment(t);
  fs.writeFileSync(path.join(root, 'test.jsonl'), sampleFile());
  const s = new Store(home);
  try {
    await new Collector(s, config).sync();
    assert.throws(() => assignAccount(s, 'premium', {}));
    const p = assignAccount(s, 'premium', { from: 'unattributed', thread: 'main' });
    assert.equal(p.changes, 1);
    assert.equal(s.samples()[0].account, 'unattributed');
    assignAccount(s, 'premium', { from: 'unattributed', thread: 'main' }, true);
    assert.equal(s.samples()[0].account, 'premium');
    const r = report(s, config, { scope: 'lifetime' });
    assert.equal(r.breakdowns.account[0].name, 'premium');
  } finally {
    s.close();
  }
});
test('read-only libsql adapter enforces query_only even when constructor ignores flags', (t) => {
  const { home } = environment(t);
  const source = new Store(home);
  source.audit('keep', {});
  source.close();
  const Module = require('node:module');
  const { openDatabase } = require('../dist/database');
  // A real writable connection simulates a driver that ignores constructor options.
  // This uses either installed backend, so the test also runs on Node 18.
  const underlying = openDatabase(path.join(home, 'usage.sqlite3')).db;
  const original = Module._load;
  const prior = process.env.CODEX_REPORT_SQLITE_BACKEND;
  process.env.CODEX_REPORT_SQLITE_BACKEND = 'libsql';
  let opened = 0;
  Module._load = function (request, ...args) {
    if (request === 'libsql')
      return class {
        constructor(file) {
          opened++;
          assert.equal(file, path.join(home, 'usage.sqlite3'));
          return underlying;
        }
      };
    return original.call(this, request, ...args);
  };
  try {
    const { db, backend } = openDatabase(path.join(home, 'usage.sqlite3'), true);
    try {
      assert.equal(backend, 'libsql 0.5.29');
      assert.equal(db.prepare('PRAGMA query_only').get().query_only, 1);
      assert.throws(() => db.exec('DELETE FROM audit'), /readonly/i);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 1);
    } finally {
      db.close();
    }
    assert.throws(() => openDatabase(path.join(home, 'missing.sqlite3'), true), /ENOENT/);
    assert.equal(opened, 1);
    assert.equal(fs.existsSync(path.join(home, 'missing.sqlite3')), false);
  } finally {
    Module._load = original;
    if (prior === undefined) delete process.env.CODEX_REPORT_SQLITE_BACKEND;
    else process.env.CODEX_REPORT_SQLITE_BACKEND = prior;
  }
});
