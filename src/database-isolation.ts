import {
  isMainThread,
  MessageChannel,
  MessagePort,
  receiveMessageOnPort,
  Worker,
  workerData,
} from 'node:worker_threads';
import { createRequire } from 'node:module';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import type { Database, Statement } from './database';

type Value = string | number | null;
type Operation = 'open' | 'prepare' | 'run' | 'get' | 'all' | 'exec' | 'close' | 'abort';
interface Request {
  id: number;
  op: Operation;
  sql?: string;
  params?: Value[];
  options?: Options;
}
interface Reply {
  id: number;
  stopped?: boolean;
  value?: unknown;
  error?: { message: string; code?: string };
}
interface Options {
  file: string;
  module: string;
  readonly: boolean;
}
interface Bootstrap {
  role: 'database-supervisor';
  options: Options;
  port?: MessagePort;
  signal?: SharedArrayBuffer;
}
function failure(error: unknown): NonNullable<Reply['error']> {
  const value = error as { message?: unknown; code?: unknown } | null;
  return {
    message: typeof value?.message === 'string' ? value.message : String(error),
    ...(typeof value?.code === 'string' ? { code: value.code } : {}),
  };
}

/**
 * libsql retains statements after close(), and its native worker teardown can
 * crash Node 18 on Windows. A dedicated process owns the native connection.
 * A supervisor acknowledges close only AFTER that process exits, when Windows
 * has released its handles. A native failure cannot crash the application.
 *
 * The supervisor worker carries messages only; it never loads a native addon.
 * It bridges asynchronous process events to the existing synchronous API.
 * No forced GC, delayed file deletion, new binary, or SQL conversion is used.
 */
export function isolatedDatabase(options: Options): Database {
  const { port1, port2 } = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(8));
  const supervisor = new Worker(__filename, {
    workerData: {
      role: 'database-supervisor',
      options,
      port: port2,
      signal: signal.buffer,
    } satisfies Bootstrap,
    transferList: [port2],
  });
  supervisor.unref();
  let workerError: Error | undefined;
  supervisor.on('error', (error) => {
    workerError = error instanceof Error ? error : new Error(String(error));
  });
  let sequence = 0;
  let closed = false;
  const release = () => {
    closed = true;
    port1.close();
  };
  const wait = (id: number, deadline: number): Reply => {
    for (;;) {
      let received = receiveMessageOnPort(port1);
      while (received) {
        const reply = received.message as Reply;
        if (reply.id === id) return reply;
        received = receiveMessageOnPort(port1);
      }
      if (Atomics.load(signal, 1)) {
        release();
        throw workerError || new Error('The database worker has stopped.');
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw workerError || new Error('Database process did not respond.');
      const observed = Atomics.load(signal, 0);
      // The port message is queued before its wakeup. A short poll also covers
      // worker-start failures without depending on the blocked caller's events.
      Atomics.wait(signal, 0, observed, Math.min(remaining, 20));
    }
  };
  const exchange = (op: Operation, sql?: string, params?: Value[]): unknown => {
    if (closed) throw new Error('The database connection is not open.');
    const id = ++sequence;
    port1.postMessage({ id, op, sql, params } satisfies Request);
    let reply: Reply;
    try {
      reply = wait(id, Date.now() + 60000);
    } catch (error) {
      // The supervisor stays responsive while native SQL is running. Ask it to
      // terminate the connection process and wait for its exit before releasing.
      if (closed) throw error;
      const abortId = ++sequence;
      port1.postMessage({ id: abortId, op: 'abort' } satisfies Request);
      try {
        wait(abortId, Date.now() + 60000);
        release();
      } catch {
        throw Object.assign(
          new Error(
            'Database process shutdown is unconfirmed; stop this process before maintenance.',
          ),
          { code: 'CODEX_REPORT_DATABASE_SHUTDOWN_UNCONFIRMED' },
        );
      }
      throw error;
    }
    if (op === 'close' || reply.stopped) release();
    if (reply.error) {
      const error = new Error(reply.error.message);
      if (reply.error.code) Object.assign(error, { code: reply.error.code });
      throw error;
    }
    return reply.value;
  };
  try {
    exchange('open');
  } catch (error) {
    if (!closed) {
      port1.postMessage({ id: ++sequence, op: 'abort' } satisfies Request);
      try {
        wait(sequence, Date.now() + 60000);
        release();
      } catch {
        void supervisor.terminate();
        throw Object.assign(
          new Error(
            'Database process shutdown is unconfirmed; stop this process before maintenance.',
          ),
          { code: 'CODEX_REPORT_DATABASE_SHUTDOWN_UNCONFIRMED' },
        );
      }
    }
    throw error;
  }
  return {
    exec(sql) {
      return exchange('exec', sql);
    },
    prepare(sql) {
      exchange('prepare', sql);
      return {
        run: (...params) => exchange('run', sql, params),
        get: (...params) => exchange('get', sql, params) as ReturnType<Statement['get']>,
        all: (...params) => exchange('all', sql, params) as ReturnType<Statement['all']>,
      };
    },
    close() {
      if (!closed) exchange('close');
    },
  };
}

function supervise(bootstrap: Bootstrap): void {
  const port = bootstrap.port!;
  const signal = new Int32Array(bootstrap.signal!);
  let connection: ChildProcess | undefined;
  let pending = 0;
  let terminal: Reply | undefined;
  let aborting = false;
  const send = (reply: Reply, stopped = false) => {
    // Carry terminal state in the reply as well as the wakeup; the receiver
    // may read the port before the following shared-state store is visible.
    port.postMessage({ ...reply, stopped });
    if (stopped) Atomics.store(signal, 1, 1);
    Atomics.store(signal, 0, reply.id);
    Atomics.notify(signal, 0);
  };
  port.on('message', (request: Request) => {
    pending = request.id;
    if (request.op === 'abort') {
      aborting = true;
      terminal = { id: request.id };
      if (connection) connection.kill();
      else {
        send(terminal, true);
        port.close();
      }
      return;
    }
    if (request.op === 'open') {
      try {
        connection = spawn(process.execPath, [__filename, '--codex-report-database-child'], {
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
          serialization: 'advanced',
          windowsHide: true,
        });
        let diagnostic = '';
        connection.stderr?.on('data', (chunk: Buffer) => {
          diagnostic = (diagnostic + chunk.toString()).slice(-4096);
        });
        connection.on('message', (reply: Reply & { closing?: boolean }) => {
          if (terminal) return;
          if (reply.closing) terminal = reply;
          else send(reply);
        });
        connection.on('error', (error) => {
          terminal = { id: pending, error: failure(error) };
        });
        connection.on('close', (code, signalName) => {
          const unexpected: Reply = {
            id: pending,
            error: terminal?.error || {
              message: `Database process exited unexpectedly (${code ?? signalName}). ${diagnostic.trim()}`,
            },
          };
          // A native crash during close must not become a successful close just
          // because its reply was queued before teardown failed.
          send(code !== 0 && !aborting ? unexpected : terminal || unexpected, true);
          connection = undefined;
          port.close();
        });
      } catch (error) {
        send({ id: request.id, error: failure(error) });
      }
    } else if (request.op === 'close' && !connection) {
      send({ id: request.id }, true);
      port.close();
      return;
    }
    connection?.send(
      request.op === 'open' ? { ...request, options: bootstrap.options } : request,
      (error) => {
        if (error && !terminal) {
          terminal = { id: pending, error: failure(error) };
          connection?.kill();
        }
      },
    );
  });
}

function connect(): void {
  const req = createRequire(__filename);
  let db: Database | undefined;
  const cache = new Map<string, Statement>();
  const statement = (sql: string): Statement => {
    let value = cache.get(sql);
    if (!value) {
      value = db!.prepare(sql);
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      cache.set(sql, value);
    }
    return value;
  };
  process.on('disconnect', () => process.exit(1));
  process.on('message', (request: Request) => {
    const reply: Reply & { closing?: boolean } = { id: request.id };
    try {
      if (request.op === 'open') {
        const options = request.options!;
        const loaded = req(options.module) as
          | { DatabaseSync?: new (file: string, options: object) => Database }
          | (new (file: string, options: object) => Database);
        const Constructor = typeof loaded === 'function' ? loaded : loaded.DatabaseSync!;
        if (options.readonly && !fs.statSync(options.file).isFile())
          throw new Error('Expected an existing database file.');
        db = new Constructor(options.file, { timeout: 1500, readOnly: options.readonly });
        if (options.readonly) db.exec('PRAGMA query_only=ON;');
      } else if (request.op === 'close') {
        cache.clear();
        db?.close();
      } else if (!db) throw new Error('The database connection is not open.');
      else if (request.op === 'exec') db.exec(request.sql!);
      else if (request.op === 'prepare') statement(request.sql!);
      else if (request.op === 'run' || request.op === 'get' || request.op === 'all')
        reply.value = statement(request.sql!)[request.op](...(request.params || []));
    } catch (error) {
      reply.error = failure(error);
    }
    if (request.op === 'close' || (request.op === 'open' && reply.error)) reply.closing = true;
    process.send!(reply, (error: Error | null) => {
      if (error || reply.closing) process.exit(error ? 1 : 0);
    });
  });
}

if (!isMainThread && workerData?.role === 'database-supervisor') supervise(workerData as Bootstrap);
else if (isMainThread && process.argv[2] === '--codex-report-database-child' && process.send)
  connect();
