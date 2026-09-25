'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initializeConfig } = require('../dist/config');
const { Store } = require('../dist/database');
const { report, receipt, reportText, exportReport } = require('../dist/reports');
const { displayOutcome } = require('../dist/outcomes');
const { emptyBatch } = require('../dist/types');
function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-sessions-'));
  const c = initializeConfig(home);
  const store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { c, store };
}
function data() {
  const b = emptyBatch();
  b.threads = [
    { id: 'a', parent: null, root: 'a', kind: 'user', started: '2026-09-20T10:00:00.000Z' },
    { id: 'b', parent: null, root: 'b', kind: 'user', started: '2026-09-24T10:00:00.000Z' },
    { id: 'child', parent: 'a', root: 'a', kind: 'subagent', started: '2026-09-24T10:00:00.000Z' },
  ];
  b.turns = [
    ['a', 'one', 'a', 'one', '2026-09-23T10:00:00.000Z', 'completed', null],
    ['a', 'two', 'a', 'two', '2026-09-24T10:00:00.000Z', 'failed', 'usage_limit_exceeded'],
    ['b', 'one', 'b', 'one', '2026-09-24T12:00:00.000Z', 'failed', 'provider_error'],
    ['child', 'worker', 'a', 'two', '2026-09-24T10:00:01.000Z', 'completed', null],
  ].map(([thread, id, rootThread, rootTurn, started, status, error]) => ({
    thread,
    id,
    rootThread,
    rootTurn,
    started,
    ended: started,
    durationMs: 1000,
    status,
    error,
    model: 'test-model',
    effort: 'medium',
    tier: 'default',
  }));
  b.samples = b.turns.map((t, i) => ({
    id: 'n:' + i,
    thread: t.thread,
    turn: t.id,
    rootThread: t.rootThread,
    rootTurn: t.rootTurn,
    at: t.started,
    model: 'test-model',
    effort: 'medium',
    tier: 'default',
    account: 'premium',
    device: 'test-device',
    format: 'native',
    pricePico: i === 3 ? null : '1000000000000',
    priceSnapshot: null,
    priceReason: i === 3 ? 'test-unpriced' : null,
    input: 1000,
    output: 100,
    cached: 500,
    write: 0,
    reasoning: 30,
  }));
  return b;
}
test('sessions group resumed root turns, include linked children once, and preserve distinct Turn 1s', (t) => {
  const { store, c } = setup(t);
  store.writeBatch(data());
  store.writeBatch(data());
  const r = report(store, c, { scope: 'lifetime' });
  assert.equal(r.sessions.length, 2);
  const a = r.sessions.find((s) => s.id === 'a');
  const b = r.sessions.find((s) => s.id === 'b');
  assert.equal(a.started, '2026-09-20T10:00:00.000Z');
  assert.deepEqual(a.turnIds, ['one', 'two']);
  assert.deepEqual(b.turnIds, ['one']);
  assert.equal(a.totals.processed, 3300);
  assert.equal(a.totals.unpricedRequests, 1);
  assert.equal(
    r.sessions.reduce((n, s) => n + s.totals.processed, 0),
    r.totals.processed,
  );
  assert.equal(r.sessions[0].id, 'b', 'latest session activity first');
  assert.equal(r.tasks.find((t) => t.thread === 'a' && t.turn === 'one').number, 1);
  assert.equal(r.tasks.find((t) => t.thread === 'b' && t.turn === 'one').number, 1);
});
test('session totals follow period/account/model filters; start remains the actual session start', (t) => {
  const { store, c } = setup(t);
  store.writeBatch(data());
  const r = report(store, c, {
    from: '2026-09-24T00:00:00Z',
    to: '2026-09-25T00:00:00Z',
    account: 'premium',
    model: 'test-model',
  });
  const a = r.sessions.find((s) => s.id === 'a');
  assert.deepEqual(a.turnIds, ['two']);
  assert.equal(a.totals.processed, 2200);
  assert.equal(a.started, '2026-09-20T10:00:00.000Z');
  assert.equal(r.tasks.find((t) => t.thread === 'a').number, 2, 'do not renumber after filtering');
  assert.equal(report(store, c, { scope: 'lifetime', model: 'missing' }).sessions.length, 0);
  assert.equal(report(store, c, { scope: 'lifetime', account: 'standard' }).sessions.length, 0);
});
test('usage exceeded is a distinct display category without changing raw lifecycle data', (t) => {
  const { store, c } = setup(t);
  store.writeBatch(data());
  const r = report(store, c, { scope: 'lifetime' });
  const task = r.tasks.find((x) => x.error === 'usage_limit_exceeded');
  assert.equal(task.status, 'failed');
  assert.deepEqual(task.displayOutcome, { code: 'usage-exceeded', label: 'Usage exceeded' });
  assert.equal(r.statistics.failed, 2, 'raw API failed count remains backwards compatible');
  assert.equal(r.statistics.usageExceeded, 1);
  assert.equal(r.statistics.otherFailed, 1);
  assert.equal(r.sessions.find((s) => s.id === 'a').outcomes.failed, 0);
  assert.equal(r.sessions.find((s) => s.id === 'a').outcomes.usageExceeded, 1);
  assert.match(receipt(task), /usage exceeded/);
  assert.match(receipt(task), /usage_limit_exceeded/);
  assert.match(reportText(r), /usage exceeded 1/);
  assert.match(exportReport(r, 'csv'), /"Usage exceeded","usage_limit_exceeded"/);
});
test('only exact failed usage_limit_exceeded becomes usage exceeded', () => {
  assert.equal(displayOutcome('failed', 'rate_limit_error').label, 'Failed');
  assert.equal(displayOutcome('interrupted', 'usage_limit_exceeded').label, 'Interrupted');
  assert.equal(displayOutcome('unknown', 'usage_limit_exceeded').label, 'Unknown');
  assert.equal(displayOutcome('__proto__', null).label, 'Unknown');
});
test('local nickname is display metadata, no prompts or Codex names are inferred', (t) => {
  const { store, c } = setup(t);
  store.writeBatch(data());
  c.sessionNames = { a: '<script>alert(1)</script>' };
  const r = report(store, c, { scope: 'lifetime' });
  assert.equal(r.sessions.find((s) => s.id === 'a').name, '<script>alert(1)</script>');
  assert.equal(r.sessions.find((s) => s.id === 'b').name, null);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM threads WHERE id='a'").get().n, 1);
});
test('zero-usage failed turns remain visible with unknown pricing', (t) => {
  const { store, c } = setup(t);
  const b = data();
  b.samples = [];
  store.writeBatch(b);
  const r = report(store, c, { scope: 'lifetime' });
  assert.equal(r.sessions.length, 2);
  assert.equal(r.sessions[0].totals.apiEquivalent, 'unpriced');
  assert.equal(r.statistics.usageExceeded, 1);
});

test('session membership is not truncated at the old 200-turn UI cutoff', (t) => {
  const { store, c } = setup(t);
  const b = data();
  const baseTurn = b.turns[0];
  const baseSample = b.samples[0];
  b.threads = [b.threads[0]];
  b.turns = Array.from({ length: 205 }, (_, i) => ({
    ...baseTurn,
    id: `turn-${String(i).padStart(3, '0')}`,
    rootTurn: `turn-${String(i).padStart(3, '0')}`,
  }));
  b.samples = b.turns.map((turn) => ({
    ...baseSample,
    id: 'n:' + turn.id,
    turn: turn.id,
    rootTurn: turn.id,
  }));
  store.writeBatch(b);
  const r = report(store, c, { scope: 'lifetime' });
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].turnIds.length, 205);
  assert.equal(r.sessions[0].totals.requests, 205);
  assert.ok(!Object.hasOwn(r.sessions[0], 'tasks'), 'do not duplicate all payloads over the wire');
});
