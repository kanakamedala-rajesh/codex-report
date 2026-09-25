'use strict';
const assert = require('node:assert/strict');

// Snapshot every persisted column, not driver-added query telemetry. libsql's
// get() result includes _metadata.duration, which changes between identical reads.
// Derive the fields from SQLite so future schema columns are still compared.
function sampleSnapshot(db, id) {
  const columns = db.prepare('PRAGMA table_info(samples)').all();
  assert.ok(columns.length, 'The samples table must exist.');
  const row = db.prepare('SELECT * FROM samples WHERE id=?').get(id);
  assert.ok(row, `Expected persisted sample ${id}.`);
  return Object.fromEntries(
    columns.map(({ name }) => {
      assert.equal(typeof name, 'string');
      assert.ok(Object.hasOwn(row, name), `Missing persisted column ${name}.`);
      return [name, row[name]];
    }),
  );
}

module.exports = { sampleSnapshot };
