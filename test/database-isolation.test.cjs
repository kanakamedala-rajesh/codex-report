'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isolatedDatabase } = require('../dist/database-isolation');
const { Store } = require('../dist/database');

function nativeModule() {
  if (process.env.CODEX_REPORT_SQLITE_BACKEND === 'builtin') return 'node:sqlite';
  try {
    return require.resolve('libsql');
  } catch (error) {
    if (process.env.CODEX_REPORT_SQLITE_BACKEND === 'libsql') throw error;
    return 'node:sqlite';
  }
}
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-isolated-'));
  const opened = [];
  t.after(() => {
    for (const db of opened) db.close();
    // This must succeed on Windows without retries, GC flags or process exit.
    fs.rmSync(home, { recursive: true, force: true });
  });
  function open(file = 'data.sqlite3', readonly = false) {
    const db = isolatedDatabase({ file: path.join(home, file), module: nativeModule(), readonly });
    opened.push(db);
    return db;
  }
  return { home, open };
}

test('isolated close releases files even while prepared wrappers remain reachable', (t) => {
  const { home, open } = fixture(t);
  const db = open();
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
  const insert = db.prepare('INSERT INTO sample VALUES(?,?)');
  insert.run(1, 'retained');
  const query = db.prepare('SELECT value FROM sample WHERE id=?');
  assert.equal(query.get(1).value, 'retained');
  db.close();
  assert.throws(() => insert.run(2, 'forbidden'), /not open/);
  assert.throws(() => query.get(1), /not open/);
  const moved = path.join(home, 'renamed.sqlite3');
  fs.renameSync(path.join(home, 'data.sqlite3'), moved);
  fs.unlinkSync(moved);
  assert.equal(fs.existsSync(moved), false);
});

test('isolated statements retain binding, reuse, error codes and transaction rollback', (t) => {
  const { open } = fixture(t);
  const db = open();
  db.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT)');
  const insert = db.prepare('INSERT INTO sample VALUES(?,?)');
  insert.run(1, "quoted ' ; text");
  insert.run(2, null);
  assert.deepEqual(db.prepare('SELECT id,value FROM sample ORDER BY id').all(), [
    { id: 1, value: "quoted ' ; text" },
    { id: 2, value: null },
  ]);
  assert.throws(
    () => insert.run(1, 'duplicate'),
    (error) => typeof error.code === 'string',
  );
  assert.throws(() => db.prepare('not valid SQL'));
  db.exec('BEGIN IMMEDIATE');
  insert.run(3, 'not committed');
  db.close();
  const check = open('data.sqlite3', true);
  assert.equal(check.prepare('SELECT COUNT(*) AS n FROM sample').get().n, 2);
  assert.throws(() => check.prepare('DELETE FROM sample').run());
});

test('isolated backups are readable and replaceable immediately after validation', (t) => {
  const { home, open } = fixture(t);
  const db = open();
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT)');
  db.prepare('INSERT INTO sample VALUES(?)').run('saved');
  const backup = path.join(home, 'backup with spaces.sqlite3');
  db.prepare('VACUUM INTO ?').run(backup);
  const check = open('backup with spaces.sqlite3', true);
  assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(check.prepare('SELECT value FROM sample').get().value, 'saved');
  check.close();
  fs.renameSync(backup, path.join(home, 'validated.sqlite3'));
  fs.unlinkSync(path.join(home, 'validated.sqlite3'));
});

test('isolated readonly open refuses missing files instead of creating them', (t) => {
  const { home, open } = fixture(t);
  assert.throws(() => open('missing.sqlite3', true), /ENOENT|existing database/);
  assert.equal(fs.existsSync(path.join(home, 'missing.sqlite3')), false);
});

test('unexpected connection exit is reported without hanging or treating it as a result', (t) => {
  const { home } = fixture(t);
  const module = path.join(home, 'exit-fixture.cjs');
  fs.writeFileSync(module, 'module.exports = class { exec() { process.exit(17); } close() {} };');
  const db = isolatedDatabase({ file: ':memory:', module, readonly: false });
  assert.throws(() => db.exec('trigger worker exit'), /exited unexpectedly/);
  db.close();
});

test('a failed database close cannot release the writer lease prematurely', (t) => {
  const { home } = fixture(t);
  const store = new Store(home);
  const close = store.db.close.bind(store.db);
  store.db.close = () => {
    throw new Error('native shutdown unconfirmed');
  };
  assert.throws(() => store.close(), /shutdown unconfirmed/);
  assert.equal(fs.existsSync(path.join(home, 'writer.lock')), true);
  store.db.close = close;
  store.close();
  assert.equal(fs.existsSync(path.join(home, 'writer.lock')), false);
});

test('native connections live in a separate process, not in the application worker heap', (t) => {
  const { home } = fixture(t);
  const module = path.join(home, 'process-fixture.cjs');
  const trace = path.join(home, 'connection-pid.txt');
  fs.writeFileSync(
    module,
    `const fs = require('node:fs');
module.exports = class {
  constructor() { fs.writeFileSync(${JSON.stringify(trace)}, String(process.pid)); }
  close() {}
};`,
  );
  const db = isolatedDatabase({ file: ':memory:', module, readonly: false });
  try {
    const pid = Number(fs.readFileSync(trace, 'utf8'));
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.notEqual(pid, process.pid, 'native addons must not share the application process');
  } finally {
    db.close();
  }
});

test('repeated connection teardown releases native resources without relying on main-thread GC', (t) => {
  const { home, open } = fixture(t);
  for (let i = 0; i < 12; i++) {
    const file = `repeat-${i}.sqlite3`;
    const db = open(file);
    db.exec('CREATE TABLE sample (value INTEGER)');
    const insert = db.prepare('INSERT INTO sample VALUES(?)');
    insert.run(i);
    assert.equal(db.prepare('SELECT value FROM sample').get().value, i);
    db.close();
    fs.unlinkSync(path.join(home, file));
    assert.throws(() => insert.run(0), /not open/);
  }
});

test('Windows adapter resolves the native entrypoint without loading it into its caller', (t) => {
  const { home } = fixture(t);
  const Module = require('node:module');
  const { openDatabase } = require('../dist/database');
  const module = path.join(home, 'routing-fixture.cjs');
  const trace = path.join(home, 'routing-pid.txt');
  fs.writeFileSync(
    module,
    `const fs = require('node:fs');
module.exports = class {
  constructor() { fs.writeFileSync(${JSON.stringify(trace)}, String(process.pid)); }
  close() {}
};`,
  );
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const original = Module._load;
  const resolve = Module._resolveFilename;
  const prior = process.env.CODEX_REPORT_SQLITE_BACKEND;
  let loads = 0;
  // Exercise the Windows selection path on every CI host. Native Windows
  // behavior is separately exercised by that platform's unmodified tests.
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.CODEX_REPORT_SQLITE_BACKEND = 'libsql';
  Module._load = function (request, ...args) {
    if (request === 'libsql') {
      loads++;
      throw new Error('Native addon must not load in the calling worker.');
    }
    return original.call(this, request, ...args);
  };
  Module._resolveFilename = function (request, ...args) {
    if (request === 'libsql') return module;
    return resolve.call(this, request, ...args);
  };
  let db;
  try {
    const opened = openDatabase(path.join(home, 'routing.sqlite3'));
    db = opened.db;
    assert.equal(opened.backend, 'libsql 0.5.29');
    assert.equal(loads, 0);
    assert.notEqual(Number(fs.readFileSync(trace, 'utf8')), process.pid);
  } finally {
    db?.close();
    Module._load = original;
    Module._resolveFilename = resolve;
    Object.defineProperty(process, 'platform', platform);
    if (prior === undefined) delete process.env.CODEX_REPORT_SQLITE_BACKEND;
    else process.env.CODEX_REPORT_SQLITE_BACKEND = prior;
  }
});
