import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Store, Lease, openDatabase } from './database';
import { Sample, Thread, Turn, Quota, emptyBatch } from './types';
import { exclusiveOutput, hash, object, privateDir, safeId } from './util';
import { validLabel } from './config';
import { PriceTable, priceSample } from './pricing';
const MAX = 128 * 1024 * 1024;
interface Exchange {
  schema: 1;
  device: string;
  createdAt: string;
  threads: Thread[];
  turns: Turn[];
  samples: Sample[];
  quotas: Quota[];
}
export function backup(store: Store, label = 'before-change'): string {
  const dir = path.join(store.home, 'backups');
  privateDir(dir);
  const file = path.join(dir, `${label}-${crypto.randomUUID()}.sqlite3`);
  store.backup(file);
  return file;
}
export function exportData(store: Store, file: string, device: string): void {
  const body: Exchange = {
    schema: 1,
    device,
    createdAt: new Date().toISOString(),
    threads: store.db.prepare('SELECT * FROM threads').all() as unknown as Thread[],
    turns: store.db.prepare('SELECT * FROM turns').all() as unknown as Turn[],
    samples: store.samples(),
    quotas: store.db
      .prepare(
        'SELECT id,thread,at,account,limitId AS "limit",window,minutes,used,resets,reached FROM quotas',
      )
      .all() as unknown as Quota[],
  };
  const payload = JSON.stringify(body);
  exclusiveOutput(
    file,
    zlib.gzipSync(
      JSON.stringify({ format: 'codex-report-exchange', sha256: hash(payload), payload }),
      { level: 6 },
    ),
  );
}
export function readExchange(file: string): Exchange {
  if (fs.statSync(file).size > MAX) throw new Error('Exchange archive too large.');
  const outer = object(
    JSON.parse(zlib.gunzipSync(fs.readFileSync(file), { maxOutputLength: MAX }).toString('utf8')),
  );
  if (
    outer.format !== 'codex-report-exchange' ||
    typeof outer.payload !== 'string' ||
    outer.sha256 !== hash(outer.payload)
  )
    throw new Error('Exchange integrity check failed.');
  const e = object(JSON.parse(outer.payload));
  if (e.schema !== 1) throw new Error('Unsupported exchange schema.');
  for (const key of ['samples', 'turns', 'threads', 'quotas'])
    if (!Array.isArray(e[key]) || (e[key] as unknown[]).length > 500000)
      throw new Error('Invalid exchange collection.');
  for (const row of e.samples as unknown[]) {
    const s = object(row);
    for (const k of [
      'id',
      'thread',
      'turn',
      'rootThread',
      'rootTurn',
      'at',
      'model',
      'effort',
      'tier',
      'account',
      'device',
      'format',
    ]) {
      if (typeof s[k] !== 'string' || String(s[k]).length > 512)
        throw new Error('Invalid sample text.');
    }
    for (const k of ['id', 'thread', 'turn', 'rootThread', 'rootTurn']) safeId(String(s[k]));
    for (const k of ['input', 'cached', 'write', 'output', 'reasoning'])
      if (!Number.isSafeInteger(s[k]) || Number(s[k]) < 0) throw new Error('Invalid token count.');
    if (
      Number(s.cached) + Number(s.write) > Number(s.input) ||
      Number(s.reasoning) > Number(s.output) ||
      !['native', 'legacy'].includes(String(s.format))
    )
      throw new Error('Inconsistent token vector.');
    if (
      s.pricePico !== null &&
      (typeof s.pricePico !== 'string' || !/^\d{1,40}$/.test(s.pricePico))
    )
      throw new Error('Invalid price.');
    if (
      s.priceSnapshot !== null &&
      (typeof s.priceSnapshot !== 'string' || s.priceSnapshot.length > 16000)
    )
      throw new Error('Invalid price snapshot.');
    if (!Number.isFinite(Date.parse(String(s.at)))) throw new Error('Invalid timestamp.');
  }
  for (const row of e.threads as unknown[]) {
    const t = object(row);
    for (const k of ['id', 'root', 'kind', 'started'])
      if (typeof t[k] !== 'string' || String(t[k]).length > 512) throw new Error('Invalid thread.');
    if (t.parent !== null && typeof t.parent !== 'string') throw new Error('Invalid parent.');
  }
  for (const row of e.turns as unknown[]) {
    const t = object(row);
    for (const k of [
      'thread',
      'id',
      'rootThread',
      'rootTurn',
      'started',
      'model',
      'effort',
      'tier',
      'status',
    ])
      if (typeof t[k] !== 'string' || String(t[k]).length > 512) throw new Error('Invalid turn.');
    if (
      !['running', 'stopping', 'completed', 'failed', 'interrupted', 'unknown'].includes(
        String(t.status),
      )
    )
      throw new Error('Invalid outcome.');
    if (
      t.durationMs !== null &&
      (typeof t.durationMs !== 'number' || !Number.isFinite(t.durationMs) || t.durationMs < 0)
    )
      throw new Error('Invalid duration.');
  }
  return e as unknown as Exchange;
}
export function importData(store: Store, file: string, apply = false): Record<string, unknown> {
  const e = readExchange(file);
  const newRows = e.samples.filter(
    (s) => !store.db.prepare('SELECT id FROM samples WHERE id=?').get(s.id),
  ).length;
  const info = { requests: e.samples.length, newRequests: newRows, apply };
  if (!apply) return info;
  const safety = backup(store, 'before-import');
  const b = emptyBatch();
  b.samples = e.samples;
  b.threads = e.threads;
  b.turns = e.turns;
  b.quotas = e.quotas;
  store.transaction(() => {
    store.writeBatch(b);
    store.audit('import', { requests: e.samples.length, device: e.device });
  });
  return { ...info, backup: safety };
}
export function reprice(
  store: Store,
  prices: PriceTable,
  all: boolean,
  apply: boolean,
  basis: 'standard' | 'recorded',
): Record<string, unknown> {
  const source = store.samples().filter((s) => all || s.pricePico === null);
  const changes = source
    .map((s) => priceSample(s, prices, basis))
    .filter(
      (s, i) => s.pricePico !== source[i]?.pricePico || s.priceReason !== source[i]?.priceReason,
    );
  if (!apply) return { changes: changes.length, apply: false };
  const safety = backup(store, 'before-reprice');
  store.transaction(() => {
    for (const s of changes)
      store.db
        .prepare('UPDATE samples SET pricePico=?,priceSnapshot=?,priceReason=? WHERE id=?')
        .run(s.pricePico, s.priceSnapshot, s.priceReason, s.id);
    store.bump();
    store.audit('reprice', { all, changes: changes.length });
  });
  return { changes: changes.length, backup: safety, apply: true };
}
export function inspectBackup(file: string): void {
  if (fs.existsSync(file + '-wal') && fs.statSync(file + '-wal').size > 0)
    throw new Error('Use a consistent backup file, not a live WAL database.');
  const { db } = openDatabase(path.resolve(file), true);
  try {
    if (
      db.prepare('PRAGMA user_version').get()?.user_version !== 1 ||
      db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok'
    )
      throw new Error('Invalid ledger backup.');
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").get())
      throw new Error('Unexpected triggers in backup.');
    for (const name of [
      'meta',
      'threads',
      'turns',
      'samples',
      'quotas',
      'tools',
      'cursors',
      'issues',
      'emissions',
      'audit',
    ])
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))
        throw new Error('Missing backup table.');
  } finally {
    db.close();
  }
}

export function restoreBackup(home: string, file: string): string {
  inspectBackup(file);
  const target = path.join(home, 'usage.sqlite3');
  if (fs.realpathSync(file) === fs.realpathSync(target))
    throw new Error('Backup and active database must differ.');
  const store = new Store(home);
  let safety: string;
  try {
    safety = backup(store, 'before-restore');
    const checkpoint = store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (Number(checkpoint?.busy ?? 1) !== 0)
      throw new Error('Database has active readers; close reports before restore.');
  } finally {
    store.close();
  }
  // Reacquire the writer reservation before replacement; another writer winning
  // the race causes a safe refusal, never a live-database overwrite.
  const lease = new Lease(home);
  const temp = path.join(home, `restore-${crypto.randomUUID()}.sqlite3`);
  try {
    if (fs.existsSync(target + '-wal') && fs.statSync(target + '-wal').size > 0)
      throw new Error('Database changed during restore; retry with collectors stopped.');
    fs.copyFileSync(file, temp, fs.constants.COPYFILE_EXCL);
    inspectBackup(temp);
    if (process.platform !== 'win32') fs.chmodSync(temp, 0o600);
    // Windows FlushFileBuffers requires write access. Open the staging copy
    // read/write without truncation, and retain the flush-before-rename order.
    const fd = fs.openSync(temp, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, target);
    // No WAL content remains after the successful checkpoint. Remove stale
    // sidecars under the writer lease, not while a collector can write.
    for (const suffix of ['-wal', '-shm']) fs.rmSync(target + suffix, { force: true });
  } finally {
    fs.rmSync(temp, { force: true });
    lease.close();
  }
  const verified = new Store(home);
  try {
    verified.audit('restore', { previousBackup: path.basename(safety) });
    verified.bump();
  } finally {
    verified.close();
  }
  return safety;
}
export function assignAccount(
  store: Store,
  label: string,
  scope: { from?: string; thread?: string; turn?: string; device?: string },
  apply = false,
): Record<string, unknown> {
  if (!validLabel(label) || !scope.from || (!scope.thread && !scope.device))
    throw new Error('Use an explicit --from-account and --thread or --device scope.');
  const rows = store
    .samples()
    .filter(
      (s) =>
        s.account === scope.from &&
        (!scope.thread || s.thread === scope.thread || s.rootThread === scope.thread) &&
        (!scope.turn || s.turn === scope.turn || s.rootTurn === scope.turn) &&
        (!scope.device || s.device === scope.device),
    );
  if (!apply) return { changes: rows.length, label, apply: false };
  const safety = backup(store, 'before-account-assignment');
  store.transaction(() => {
    for (const s of rows)
      store.db.prepare('UPDATE samples SET account=? WHERE id=?').run(label, s.id);
    store.audit('account-assignment', { label, scope, changes: rows.length });
    store.bump();
  });
  return { changes: rows.length, label, apply: true, backup: safety };
}
