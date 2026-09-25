import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Batch, Sample, Turn } from './types';
import { privateDir, hash } from './util';
import { isolatedDatabase } from './database-isolation';
type Value = string | number | null;
export interface Statement {
  run(...params: Value[]): unknown;
  all(...params: Value[]): Record<string, unknown>[];
  get(...params: Value[]): Record<string, unknown> | undefined;
}
export interface Database {
  exec(sql: string): unknown;
  prepare(sql: string): Statement;
  close(): void;
}
export function openDatabase(file: string, readonly = false): { db: Database; backend: string } {
  // libsql 0.5.x ignores better-sqlite3's readonly/fileMustExist options.
  // Refuse missing sources before opening, then enforce SQLite query-only mode.
  if (readonly && !fs.statSync(file).isFile())
    throw new Error('Expected an existing database file.');
  const req = createRequire(__filename);
  let Constructor: (new (p: string, o: object) => Database) | undefined;
  let nativeModule: string | undefined;
  if (process.env.CODEX_REPORT_SQLITE_BACKEND !== 'builtin') {
    try {
      // The collector itself runs in a worker. Resolve only on Windows so the
      // native addon is loaded exclusively inside its dedicated process.
      if (process.platform === 'win32') nativeModule = req.resolve('libsql');
      else Constructor = req('libsql') as typeof Constructor;
    } catch (error) {
      if (process.env.CODEX_REPORT_SQLITE_BACKEND === 'libsql') throw error;
    }
    // Opening an existing database must not silently fall back after a real database error.
    if (Constructor || nativeModule) {
      const db = nativeModule
        ? isolatedDatabase({ file, module: nativeModule, readonly })
        : new Constructor!(file, { timeout: 1500 });
      try {
        if (readonly) db.exec('PRAGMA query_only=ON;');
        return { db, backend: 'libsql 0.5.29' };
      } catch (error) {
        db.close();
        throw error;
      }
    }
  }
  let native: { DatabaseSync: new (p: string, o: object) => Database };
  try {
    native = req('node:sqlite') as typeof native;
  } catch {
    throw new Error(
      'No SQLite backend available. Install the optional libsql dependency for Node 18/20, or use a Node release with node:sqlite. No compiler fallback is invoked.',
    );
  }
  return { db: new native.DatabaseSync(file, { readOnly: readonly }), backend: 'node:sqlite' };
}
export class Lease {
  private file: string;
  private nonce = crypto.randomUUID();
  constructor(home: string) {
    this.file = path.join(home, 'writer.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(this.file, JSON.stringify({ pid: process.pid, nonce: this.nonce }), {
          flag: 'wx',
          mode: 0o600,
        });
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        let pid: number;
        try {
          pid = Number((JSON.parse(fs.readFileSync(this.file, 'utf8')) as { pid: unknown }).pid);
        } catch {
          throw new Error('Writer lock is unreadable; inspect it with all collectors stopped.');
        }
        if (!Number.isInteger(pid) || pid <= 0)
          throw new Error('Invalid writer lock; manual inspection required.');
        try {
          process.kill(pid, 0);
          throw new Error('Collector is running. Use its dashboard or stop it before maintenance.');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
        }
        fs.unlinkSync(this.file);
      }
    }
    throw new Error('Could not obtain writer lease.');
  }
  close(): void {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { nonce: unknown };
      if (value.nonce === this.nonce) fs.unlinkSync(this.file);
    } catch {}
  }
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,parent TEXT,root TEXT NOT NULL,kind TEXT NOT NULL,started TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS turns(thread TEXT NOT NULL,id TEXT NOT NULL,rootThread TEXT NOT NULL,rootTurn TEXT NOT NULL,started TEXT NOT NULL,ended TEXT,durationMs REAL,status TEXT NOT NULL,error TEXT,model TEXT NOT NULL,effort TEXT NOT NULL,tier TEXT NOT NULL,PRIMARY KEY(thread,id));
CREATE TABLE IF NOT EXISTS samples(id TEXT PRIMARY KEY,thread TEXT NOT NULL,turn TEXT NOT NULL,rootThread TEXT NOT NULL,rootTurn TEXT NOT NULL,at TEXT NOT NULL,model TEXT NOT NULL,effort TEXT NOT NULL,tier TEXT NOT NULL,account TEXT NOT NULL,device TEXT NOT NULL,format TEXT NOT NULL,input INTEGER NOT NULL,cached INTEGER NOT NULL,write INTEGER NOT NULL,output INTEGER NOT NULL,reasoning INTEGER NOT NULL,pricePico TEXT,priceSnapshot TEXT,priceReason TEXT);
CREATE TABLE IF NOT EXISTS quotas(id TEXT PRIMARY KEY,thread TEXT NOT NULL,at TEXT NOT NULL,account TEXT NOT NULL,limitId TEXT NOT NULL,window TEXT NOT NULL,minutes REAL,used REAL,resets TEXT,reached TEXT);
CREATE TABLE IF NOT EXISTS tools(id TEXT PRIMARY KEY,thread TEXT NOT NULL,turn TEXT NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cursors(path TEXT PRIMARY KEY,size INTEGER NOT NULL,mtime REAL NOT NULL,offset INTEGER NOT NULL,state TEXT NOT NULL,health TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY,scope TEXT NOT NULL,code TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS emissions(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,at TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sample_turn ON samples(thread,turn);
CREATE INDEX IF NOT EXISTS sample_root ON samples(rootThread,rootTurn);
CREATE INDEX IF NOT EXISTS sample_at ON samples(at,account);
CREATE INDEX IF NOT EXISTS quota_at ON quotas(at);
CREATE VIEW IF NOT EXISTS effective_samples AS SELECT s.* FROM samples s WHERE s.format='native' OR NOT EXISTS(SELECT 1 FROM samples n WHERE n.thread=s.thread AND n.turn=s.turn AND n.format='native');
`;
export class Store {
  readonly db: Database;
  readonly backend: string;
  private lease: Lease | null = null;
  constructor(
    readonly home: string,
    readonly readOnly = false,
  ) {
    if (!readOnly) {
      privateDir(home);
      this.lease = new Lease(home);
    }
    let connection: Database | undefined;
    try {
      const opened = openDatabase(path.join(home, 'usage.sqlite3'), readOnly);
      this.db = opened.db;
      connection = opened.db;
      this.backend = opened.backend;
      this.db.exec('PRAGMA busy_timeout=1500; PRAGMA foreign_keys=ON;');
      if (!readOnly) {
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
        const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
        if (version !== 0 && version !== 1) throw new Error('Unsupported ledger schema.');
        this.db.exec(SCHEMA);
        this.db.exec('PRAGMA user_version=1;');
        if (process.platform !== 'win32') fs.chmodSync(path.join(home, 'usage.sqlite3'), 0o600);
        this.db.prepare("INSERT OR IGNORE INTO meta VALUES('revision','0')").run();
      }
    } catch (e) {
      // Keep the reservation if native shutdown cannot be confirmed. A later
      // process can recover a stale lease only after this process has exited.
      connection?.close();
      if ((e as NodeJS.ErrnoException).code !== 'CODEX_REPORT_DATABASE_SHUTDOWN_UNCONFIRMED')
        this.lease?.close();
      throw e;
    }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw e;
    }
  }
  revision(): number {
    return Number(this.db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value ?? 0);
  }
  bump(): void {
    this.db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
  }
  writeBatch(batch: Batch): number {
    let added = 0;
    for (const t of batch.threads)
      this.db
        .prepare('INSERT OR IGNORE INTO threads VALUES(?,?,?,?,?)')
        .run(t.id, t.parent, t.root, t.kind, t.started);
    for (const t of batch.turns) this.putTurn(t);
    for (const s of batch.samples) {
      const exists = this.db.prepare('SELECT * FROM samples WHERE id=?').get(s.id);
      if (exists) {
        if (
          [
            'input',
            'cached',
            'write',
            'output',
            'reasoning',
            'thread',
            'turn',
            'rootThread',
            'rootTurn',
          ].some((k) => exists[k] !== s[k as keyof Sample])
        )
          this.addIssue(s.thread, 'conflicting_request_identity', s.at);
        continue;
      }
      this.db
        .prepare('INSERT INTO samples VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          s.id,
          s.thread,
          s.turn,
          s.rootThread,
          s.rootTurn,
          s.at,
          s.model,
          s.effort,
          s.tier,
          s.account,
          s.device,
          s.format,
          s.input,
          s.cached,
          s.write,
          s.output,
          s.reasoning,
          s.pricePico,
          s.priceSnapshot,
          s.priceReason,
        );
      added++;
    }
    for (const q of batch.quotas)
      this.db
        .prepare('INSERT OR IGNORE INTO quotas VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          q.id,
          q.thread,
          q.at,
          q.account,
          q.limit,
          q.window,
          q.minutes,
          q.used,
          q.resets,
          q.reached,
        );
    for (const t of batch.tools)
      this.db
        .prepare('INSERT OR IGNORE INTO tools VALUES(?,?,?,?,?)')
        .run(t.id, t.thread, t.turn, t.kind, t.at);
    for (const i of batch.issues) this.addIssue(i.scope, i.code, i.at);
    if (added || batch.turns.length || batch.quotas.length || batch.issues.length) this.bump();
    return added;
  }
  putTurn(t: Turn): void {
    const old = this.db
      .prepare('SELECT * FROM turns WHERE thread=? AND id=?')
      .get(t.thread, t.id) as unknown as Turn | undefined;
    if (old) {
      const rank: Record<Turn['status'], number> = {
        unknown: 0,
        running: 1,
        stopping: 2,
        interrupted: 3,
        completed: 3,
        failed: 3,
      };
      const useNew =
        rank[t.status] >= rank[old.status] &&
        t.status !== 'unknown' &&
        (!old.ended || !t.ended || t.ended >= old.ended);
      t = {
        ...old,
        model: t.model || old.model,
        effort: t.effort || old.effort,
        tier: t.tier || old.tier,
        rootThread: t.rootThread || old.rootThread,
        rootTurn: t.rootTurn || old.rootTurn,
        started: t.started < old.started ? t.started : old.started,
        ended: useNew ? (t.ended ?? old.ended) : old.ended,
        durationMs: useNew ? (t.durationMs ?? old.durationMs) : old.durationMs,
        status: useNew ? t.status : old.status,
        error: useNew ? (t.error ?? old.error) : old.error,
      };
      this.db
        .prepare(
          'UPDATE turns SET rootThread=?,rootTurn=?,started=?,ended=?,durationMs=?,status=?,error=?,model=?,effort=?,tier=? WHERE thread=? AND id=?',
        )
        .run(
          t.rootThread,
          t.rootTurn,
          t.started,
          t.ended,
          t.durationMs,
          t.status,
          t.error,
          t.model,
          t.effort,
          t.tier,
          t.thread,
          t.id,
        );
    } else
      this.db
        .prepare('INSERT INTO turns VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(
          t.thread,
          t.id,
          t.rootThread,
          t.rootTurn,
          t.started,
          t.ended,
          t.durationMs,
          t.status,
          t.error,
          t.model,
          t.effort,
          t.tier,
        );
  }
  addIssue(scope: string, code: string, at = new Date().toISOString()): void {
    this.db
      .prepare('INSERT INTO issues VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at')
      .run(hash(scope + ':' + code), scope, code, at);
  }
  audit(action: string, detail: unknown): void {
    this.db
      .prepare('INSERT INTO audit VALUES(?,?,?,?)')
      .run(crypto.randomUUID(), new Date().toISOString(), action, JSON.stringify(detail));
  }
  captureAccount(thread: string, turn: string, account: string): void {
    if (account === 'unattributed') return;
    this.transaction(() => {
      const key = `capture:${thread}:${turn}`;
      const prior = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
      if (prior && prior.value !== account) {
        this.addIssue(thread, 'conflicting_live_account_label');
        return;
      }
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES(?,?)').run(key, account);
      this.db
        .prepare(
          "UPDATE samples SET account=? WHERE account='unattributed' AND ((thread=? AND turn=?) OR (rootThread=? AND rootTurn=?))",
        )
        .run(account, thread, turn, thread, turn);
      if (!prior) this.audit('live-account-label', { thread, turn, account });
      this.bump();
    });
  }
  capturedAccount(s: Sample): string {
    const row =
      this.db.prepare('SELECT value FROM meta WHERE key=?').get(`capture:${s.thread}:${s.turn}`) ??
      this.db
        .prepare('SELECT value FROM meta WHERE key=?')
        .get(`capture:${s.rootThread}:${s.rootTurn}`);
    return typeof row?.value === 'string' ? row.value : s.account;
  }
  samples(): Sample[] {
    return this.db
      .prepare('SELECT * FROM effective_samples ORDER BY at,id')
      .all() as unknown as Sample[];
  }
  backup(destination: string): void {
    if (fs.existsSync(destination)) throw new Error('Backup destination already exists.');
    this.db.prepare('VACUUM INTO ?').run(path.resolve(destination));
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o600);
  }
  close(): void {
    this.db.close();
    this.lease?.close();
    this.lease = null;
  }
}
