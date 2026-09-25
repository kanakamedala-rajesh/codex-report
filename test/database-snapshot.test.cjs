'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../dist/database');
const { sampleSnapshot } = require('./helpers/sample-snapshot.cjs');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-snapshot-'));
  const { db } = openDatabase(path.join(home, 'test.sqlite3'));
  t.after(() => {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  db.exec(`CREATE TABLE samples (
    id TEXT PRIMARY KEY, input INTEGER, output INTEGER, account TEXT,
    pricePico TEXT, priceSnapshot TEXT, priceReason TEXT
  )`);
  db.prepare('INSERT INTO samples VALUES(?,?,?,?,?,?,?)').run(
    'sample',
    100,
    10,
    'explicit-owner',
    '900719925474099312345',
    '{"source":"frozen"}',
    null,
  );
  return db;
}

test('sample snapshots exclude changing query telemetry without mutating returned rows', (t) => {
  const db = fixture(t);
  let duration = 0;
  const observed = [];
  // Inject deterministic timing differences around real SQL reads. The test
  // must catch this regression even on node:sqlite, which has no such metadata.
  const timed = {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        all: (...params) => statement.all(...params),
        get: (...params) => {
          const row = statement.get(...params);
          if (!row) return row;
          const value = Object.freeze({ ...row, _metadata: { duration: ++duration } });
          observed.push(value);
          return value;
        },
      };
    },
  };
  const before = sampleSnapshot(timed, 'sample');
  const after = sampleSnapshot(timed, 'sample');
  assert.notDeepEqual(observed[0], observed[1], 'raw query results have different durations');
  assert.deepEqual(after, before);
  assert.equal(observed[0]._metadata.duration, 1, 'the driver result was not modified');
  assert.equal(Object.hasOwn(after, '_metadata'), false);
  assert.deepEqual(after, {
    id: 'sample',
    input: 100,
    output: 10,
    account: 'explicit-owner',
    pricePico: '900719925474099312345',
    priceSnapshot: '{"source":"frozen"}',
    priceReason: null,
  });
});

test('sample snapshots detect changes to every persisted column', (t) => {
  const db = fixture(t);
  const before = sampleSnapshot(db, 'sample');
  for (const [column, previous] of Object.entries(before)) {
    const next = typeof previous === 'number' ? previous + 1 : 'changed';
    db.prepare(`UPDATE samples SET "${column}"=? WHERE id=?`).run(next, 'sample');
    const rowId = column === 'id' ? next : 'sample';
    assert.notDeepEqual(sampleSnapshot(db, rowId), before, `${column} changes must fail equality`);
    db.prepare(`UPDATE samples SET "${column}"=? WHERE id=?`).run(previous, rowId);
    assert.deepEqual(sampleSnapshot(db, 'sample'), before);
  }
});

test('sample snapshots include future persisted columns rather than a hardcoded field list', (t) => {
  const db = fixture(t);
  const before = sampleSnapshot(db, 'sample');
  db.exec('ALTER TABLE samples ADD COLUMN futureField TEXT');
  const expanded = sampleSnapshot(db, 'sample');
  assert.equal(expanded.futureField, null);
  assert.equal(Object.keys(expanded).length, Object.keys(before).length + 1);
  db.prepare('UPDATE samples SET futureField=? WHERE id=?').run('preserve me', 'sample');
  assert.notDeepEqual(sampleSnapshot(db, 'sample'), expanded);
  assert.equal(sampleSnapshot(db, 'sample').futureField, 'preserve me');
});

test('sample snapshots bind the identifier and fail if the persisted row disappears', (t) => {
  const db = fixture(t);
  assert.throws(() => sampleSnapshot(db, "sample' OR 1=1 --"), /Expected persisted sample/);
  db.prepare('DELETE FROM samples WHERE id=?').run('sample');
  assert.throws(() => sampleSnapshot(db, 'sample'), /Expected persisted sample/);
});

test('sample snapshots reject missing columns instead of treating them as unchanged', (t) => {
  const db = fixture(t);
  const incomplete = {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        all: (...params) => statement.all(...params),
        get: (...params) => {
          const row = { ...statement.get(...params) };
          delete row.pricePico;
          return row;
        },
      };
    },
  };
  assert.throws(() => sampleSnapshot(incomplete, 'sample'), /Missing persisted column pricePico/);
});
