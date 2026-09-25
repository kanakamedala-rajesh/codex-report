'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../dist/database');
const { restoreBackup, inspectBackup } = require('../dist/maintenance');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-restore-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'snapshot.sqlite3');
  const store = new Store(home);
  try {
    store.audit('before-snapshot', {});
    store.backup(source);
    store.audit('after-snapshot', {});
  } finally {
    store.close();
  }
  return { home, source, original: fs.readFileSync(source) };
}
function isStage(file) {
  return typeof file === 'string' && /^restore-.*\.sqlite3$/.test(path.basename(file));
}

test('restore flushes a writable non-truncating staging handle before replacing the ledger', (t) => {
  const { home, source, original } = fixture(t);
  const open = fs.openSync;
  const flush = fs.fsyncSync;
  const rename = fs.renameSync;
  const stages = new Set();
  let flushed = 0;
  let replaced = 0;
  fs.openSync = function (file, flags, ...args) {
    const fd = open.call(this, file, flags, ...args);
    if (isStage(file)) {
      assert.equal(flags, 'r+', 'flush requires write access without truncating the copy');
      stages.add(fd);
    }
    return fd;
  };
  fs.fsyncSync = function (fd) {
    if (stages.has(fd)) flushed++;
    return flush.call(this, fd);
  };
  fs.renameSync = function (from, to) {
    if (isStage(from)) {
      assert.equal(flushed, 1, 'the new ledger must be flushed before it becomes active');
      replaced++;
    }
    return rename.call(this, from, to);
  };
  let safety;
  try {
    safety = restoreBackup(home, source);
  } finally {
    fs.openSync = open;
    fs.fsyncSync = flush;
    fs.renameSync = rename;
  }
  assert.equal(replaced, 1);
  assert.deepEqual(fs.readFileSync(source), original, 'input snapshot remains unchanged');
  inspectBackup(safety);
  const read = new Store(home, true);
  try {
    assert.equal(
      read.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='after-snapshot'").get().n,
      0,
    );
    assert.equal(
      read.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='restore'").get().n,
      1,
    );
  } finally {
    read.close();
  }
});

test('failed restore flush preserves the current ledger and safety backup, and removes staging', (t) => {
  const { home, source, original } = fixture(t);
  const open = fs.openSync;
  const flush = fs.fsyncSync;
  let stageFd;
  const expected = Object.assign(new Error('simulated flush failure'), { code: 'EIO' });
  fs.openSync = function (file, flags, ...args) {
    const fd = open.call(this, file, flags, ...args);
    if (isStage(file)) stageFd = fd;
    return fd;
  };
  fs.fsyncSync = function (fd) {
    if (fd === stageFd) throw expected;
    return flush.call(this, fd);
  };
  try {
    assert.throws(
      () => restoreBackup(home, source),
      (error) => error === expected,
    );
  } finally {
    fs.openSync = open;
    fs.fsyncSync = flush;
  }
  assert.deepEqual(fs.readFileSync(source), original);
  assert.equal(fs.existsSync(path.join(home, 'writer.lock')), false);
  assert.deepEqual(
    fs.readdirSync(home).filter((name) => name.startsWith('restore-')),
    [],
  );
  const backups = fs.readdirSync(path.join(home, 'backups'));
  assert.equal(backups.length, 1);
  inspectBackup(path.join(home, 'backups', backups[0]));
  const read = new Store(home, true);
  try {
    assert.equal(
      read.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='after-snapshot'").get().n,
      1,
      'the original ledger must not be replaced after a failed flush',
    );
    assert.equal(
      read.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='restore'").get().n,
      0,
    );
  } finally {
    read.close();
  }
});
