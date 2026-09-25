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
