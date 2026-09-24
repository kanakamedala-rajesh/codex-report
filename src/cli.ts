#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { VERSION, assertRuntime } from './version';
import { initializeConfig, loadConfig, saveConfig, Account } from './config';
import { initializePrices, loadPrices, validatePrices } from './pricing';
import { Store } from './database';
import { Collector } from './collector';
import { configureHooks, inspectHooks, projectHook, handleHook } from './hooks';
import { report, receipt, reportText, exportReport, Filter } from './reports';
import { startService, rpc, publicConfig } from './service';
import {
  exportData,
  importData,
  inspectBackup,
  restoreBackup,
  assignAccount,
  reprice,
} from './maintenance';
import { dataHome, message, object, readJson, writeJson, exclusiveOutput, hash } from './util';
import { decoderPath, compressedBytes } from './compression';
interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  passthrough: string[];
}
const BOOLEAN = new Set([
  'help',
  'version',
  'open',
  'no-open',
  'no-hooks',
  'apply',
  'yes',
  'json',
  'all',
  'unpriced-only',
  'verify',
]);
function parse(args: string[]): Args {
  const result: Args = { command: '', positional: [], flags: {}, passthrough: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--') {
      result.passthrough = args.slice(i + 1);
      break;
    }
    if (a === '-h') {
      result.flags.help = true;
      continue;
    }
    if (a === '-v') {
      result.flags.version = true;
      continue;
    }
    if (a.startsWith('--')) {
      const [key, ...parts] = a.slice(2).split('=');
      if (!key) throw new Error('Empty option.');
      if (BOOLEAN.has(key)) {
        result.flags[key] = true;
        continue;
      }
      const v = parts.length ? parts.join('=') : args[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`Missing value for --${key}.`);
      result.flags[key] = v;
    } else if (!result.command) result.command = a;
    else result.positional.push(a);
  }
  return result;
}
const HELP = `Codex Report ${VERSION}

Fresh install:
  codex-report init [--codex-home PATH] [--account LABEL] [--no-hooks]
  codex-report start --open

Commands:
  init / setup          Create storage/configuration and install own hooks
  start / dashboard     Run the local observer and dashboard (default command)
  stop                  Stop this installation's local dashboard process
  doctor                Inspect real runtime, storage, sources, and hooks
  self-test             Exercise the installed build in a temporary store
  sync [--path PATH]    Reconcile saved JSONL/gzip/Zstandard usage
  last                  Display the latest observed main turn
  report                Display analytics; --scope 5h|day|week|cycle|lifetime
  run -- [CODEX ARGS]    Run Codex and print a post-exit report
  config show|set        Set config keys: e.g. config set display detailed
  accounts list|set|assign Configure a label's renewal and fee settings
  sources list|add      Register another Codex home or rollout directory
  prices show|load|alias  Review/load a price table or explicit model alias
  reprice               Preview repricing; --apply writes a backed-up change
  export FILE.crx       Export metadata, never message or tool contents
  import FILE.crx       Preview import; --apply merges metadata
  backup FILE.sqlite3   Create a consistent database snapshot
  restore FILE.sqlite3  Preview restore; --apply replaces after safety backup
  audit / conflicts     Inspect changes and data-quality conflicts
  uninstall-hooks       Remove only this installation's registered handlers

Common options: --home PATH --json
Report filters: --account LABEL --thread ID --turn ID --model ID
Exports: --format json|csv|html --output FILE
Custom period: --from ISO_TIMESTAMP --to ISO_TIMESTAMP
Node >=18.20.8; a maintained LTS is recommended. Nothing is published automatically.
`;
function val(a: Args, key: string): string | undefined {
  const v = a.flags[key];
  return typeof v === 'string' ? v : undefined;
}
function show(value: unknown, json = true): void {
  process.stdout.write((json ? JSON.stringify(value, null, 2) : String(value)) + '\n');
}
function filters(a: Args): Filter {
  const f: Filter = {};
  for (const k of ['scope', 'account', 'thread', 'turn', 'model', 'from', 'to'] as const) {
    const v = val(a, k);
    if (v !== undefined) f[k] = v;
  }
  return f;
}
async function inputJson(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += b.length;
    if (size > 1024 * 1024) throw new Error('Hook input exceeds 1 MiB.');
    chunks.push(b);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function reportRead(home: string, f: Filter): Promise<ReturnType<typeof report>> {
  try {
    return (await rpc(
      home,
      '/api/report?' + new URLSearchParams(f as Record<string, string>).toString(),
      undefined,
      15000,
    )) as ReturnType<typeof report>;
  } catch {
    const s = new Store(home, true);
    try {
      return report(s, loadConfig(home), f);
    } finally {
      s.close();
    }
  }
}
async function selfTest(): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-selftest-'));
  const results: string[] = [];
  let s: Store | undefined;
  try {
    initializeConfig(home);
    initializePrices(home);
    s = new Store(home);
    s.transaction(() => s?.audit('self-test', { synthetic: true }));
    results.push('SQLite transaction');
    const file = path.join(home, 'backup.sqlite3');
    s.backup(file);
    inspectBackup(file);
    results.push('SQLite backup/integrity');
    decoderPath();
    const decoded = await compressedBytes(path.resolve(__dirname, '../data/self-test.zst'), 200000);
    if (hash(decoded).slice(0, 8) !== 'f2a8e35c') throw new Error('Zstandard self-test mismatch.');
    results.push('Zstandard decoding and helper integrity');
    configureHooks(home, path.join(home, 'codex'));
    configureHooks(home, path.join(home, 'codex'));
    if (inspectHooks(home).length !== 4) throw new Error('Hook idempotency failed.');
    results.push('Idempotent hook configuration');
    const exchange = path.join(home, 'sample.crx');
    exportData(s, exchange, 'self-test');
    importData(s, exchange, false);
    results.push('Metadata exchange');
    show({
      status: 'PASS',
      version: VERSION,
      node: process.version,
      backend: s.backend,
      checks: results,
    });
  } finally {
    s?.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
async function main(): Promise<void> {
  assertRuntime(process.versions.node);
  const a = parse(process.argv.slice(2));
  const home = path.resolve(val(a, 'home') ?? dataHome());
  const command = a.command || 'start';
  if (a.flags.version) {
    show(VERSION, false);
    return;
  }
  if (a.flags.help || command === 'help') {
    show(HELP, false);
    return;
  }
  if (command === 'hook') {
    let store: Store | undefined;
    try {
      const payload = projectHook(await inputJson());
      let response: unknown;
      try {
        response = await rpc(home, '/api/hook', payload, 2200);
      } catch {
        store = new Store(home);
        response = await handleHook(store, loadConfig(home), payload);
      }
      show(response);
    } catch {
      show({});
    } finally {
      store?.close();
    }
    return;
  }
  if (command === 'self-test') {
    await selfTest();
    return;
  }
  if (command === 'init' || command === 'setup') {
    const c = initializeConfig(home, val(a, 'codex-home'), val(a, 'account') ?? 'unattributed');
    const s = new Store(home);
    s.close();
    initializePrices(home);
    const selected = val(a, 'codex-home') ?? c.sources.find((s) => s.kind === 'codex-home')?.path;
    const h = a.flags['no-hooks']
      ? { installed: false }
      : selected
        ? configureHooks(home, selected)
        : { installed: false };
    show({
      initialized: true,
      version: VERSION,
      home,
      hooks: h,
      next: ['codex-report doctor', 'Review handlers in Codex /hooks', 'codex-report start --open'],
    });
    return;
  }
  const config = loadConfig(home);
  if (command === 'start' || command === 'dashboard') {
    const service = await startService(home, Boolean(a.flags.open) && !a.flags['no-open']);
    show(
      `Codex Report ${VERSION}\nDashboard: ${service.url}\nCollector active. Keep this process running; Ctrl+C stops it.`,
      false,
    );
    const stop = (): void => {
      void service.close().catch((e) => process.stderr.write(message(e) + '\n'));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  if (command === 'stop') {
    show(await rpc(home, '/api/stop', {}));
    return;
  }
  if (command === 'doctor') {
    let state: unknown = null;
    try {
      state = await rpc(home, '/api/status', undefined, 500);
    } catch {}
    const s = new Store(home, true);
    try {
      let decoder: string;
      try {
        decoder = decoderPath();
      } catch (e) {
        decoder = message(e);
      }
      const result = {
        version: VERSION,
        node: process.version,
        executable: process.execPath,
        home,
        backend: s.backend,
        integrity: s.db.prepare('PRAGMA integrity_check').get(),
        requests: s.samples().length,
        collector: state ?? 'stopped',
        hooks: inspectHooks(home),
        sources: config.sources.map((x) => ({
          name: x.name,
          exists: fs.existsSync(x.path),
          account: x.account,
        })),
        decoder,
        display: config.display,
        issues: s.db.prepare('SELECT code,COUNT(*) AS sources FROM issues GROUP BY code').all(),
        trust: 'Trust is managed in Codex /hooks, never modified here.',
      };
      show(result);
    } finally {
      s.close();
    }
    return;
  }
  if (command === 'last' || command === 'report') {
    const f = filters(a);
    if (command === 'last') f.scope = 'lifetime';
    const r = await reportRead(home, f);
    const format = val(a, 'format') ?? (a.flags.json ? 'json' : 'text');
    const output =
      command === 'last'
        ? a.flags.json
          ? JSON.stringify(r.tasks[0] ?? null, null, 2)
          : r.tasks[0]
            ? receipt(r.tasks[0])
            : 'No turns recorded. Run sync or start the collector.'
        : format === 'text'
          ? reportText(r)
          : exportReport(r, format);
    const destination = val(a, 'output');
    if (destination) exclusiveOutput(destination, output + '\n');
    else show(output, false);
    return;
  }
  if (command === 'config') {
    if (a.positional[0] === 'show' || !a.positional.length) {
      show(publicConfig(config));
      return;
    }
    const key = a.positional[1],
      value = a.positional[2];
    const allowed = [
      'port',
      'pollMs',
      'timezone',
      'display',
      'reportAccount',
      'priceBasis',
      'maxFileMb',
    ];
    if (a.positional[0] !== 'set' || !key || value === undefined || !allowed.includes(key))
      throw new Error('Use config set KEY VALUE; see config show for keys.');
    const lease = new Store(home);
    try {
      const next = {
        ...config,
        [key]: ['port', 'pollMs', 'maxFileMb'].includes(key) ? Number(value) : value,
      };
      saveConfig(home, next);
      lease.audit('config', { key });
      show({ updated: key, restart: 'Restart a running collector to reload configuration.' });
    } finally {
      lease.close();
    }
    return;
  }
  if (command === 'accounts') {
    if (a.positional[0] === 'list' || !a.positional.length) {
      show(config.accounts);
      return;
    }
    if (a.positional[0] === 'assign') {
      const label = a.positional[1];
      if (!label) throw new Error('Account label required.');
      const store = new Store(home);
      try {
        show(
          assignAccount(
            store,
            label,
            {
              from: val(a, 'from-account'),
              thread: val(a, 'thread'),
              turn: val(a, 'turn'),
              device: val(a, 'device'),
            },
            Boolean(a.flags.apply),
          ),
        );
      } finally {
        store.close();
      }
      return;
    }
    const label = a.positional[1];
    if (a.positional[0] !== 'set' || !label)
      throw new Error('Use accounts set LABEL --billing-day DAY --timezone ZONE.');
    const acct: Account = { ...config.accounts[label] };
    for (const [flag, key] of [
      ['billing-day', 'billingDay'],
      ['billing-time', 'billingTime'],
      ['timezone', 'timezone'],
      ['monthly-usd', 'monthlyUsd'],
      ['currency', 'currency'],
      ['subscription-amount', 'subscriptionAmount'],
      ['local-per-usd', 'localPerUsd'],
    ] as const) {
      const v = val(a, flag);
      if (v !== undefined)
        Object.assign(acct, {
          [key]: ['billingDay', 'monthlyUsd', 'subscriptionAmount', 'localPerUsd'].includes(key)
            ? Number(v)
            : v,
        });
    }
    const s = new Store(home);
    try {
      saveConfig(home, { ...config, accounts: { ...config.accounts, [label]: acct } });
      s.audit('account-settings', { label });
      show({ label, ...acct });
    } finally {
      s.close();
    }
    return;
  }
  if (command === 'sources') {
    if (a.positional[0] === 'list' || !a.positional.length) {
      show(config.sources);
      return;
    }
    const [action, name, source] = a.positional;
    if (action !== 'add' || !name || !source)
      throw new Error('Use sources add NAME PATH [--kind codex-home|rollouts] [--account LABEL].');
    const kind = val(a, 'kind') ?? 'codex-home';
    if (kind !== 'codex-home' && kind !== 'rollouts') throw new Error('Invalid source kind.');
    const s = new Store(home);
    try {
      saveConfig(home, {
        ...config,
        sources: [
          ...config.sources.filter((x) => x.name !== name),
          { name, path: path.resolve(source), kind, account: val(a, 'account') ?? 'unattributed' },
        ],
      });
      s.audit('source-settings', { name });
      show({ registered: name });
    } finally {
      s.close();
    }
    return;
  }
  if (command === 'run') {
    let own: Awaited<ReturnType<typeof startService>> | null = null;
    try {
      await rpc(home, '/api/status', undefined, 500);
    } catch {
      own = await startService(home, Boolean(a.flags.open));
      show(`Dashboard: ${own.url}`, false);
    }
    const started = new Date().toISOString();
    let executable = val(a, 'executable') ?? 'codex';
    let args = a.passthrough;
    if (process.platform === 'win32' && executable === 'codex') {
      const dirs = (process.env.PATH ?? '').split(path.delimiter);
      const js = dirs
        .map((d) => path.join(d, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'))
        .find((p) => fs.existsSync(p));
      if (js) {
        executable = process.execPath;
        args = [js, ...args];
      } else {
        const exe = dirs.map((d) => path.join(d, 'codex.exe')).find((p) => fs.existsSync(p));
        if (!exe)
          throw new Error(
            'Cannot resolve Codex on Windows. Use --executable with a native codex.exe path.',
          );
        executable = exe;
      }
    }
    try {
      const code = await new Promise<number>((resolve, reject) => {
        const child = spawn(executable, args, {
          stdio: 'inherit',
          env: {
            ...process.env,
            CODEX_REPORT_ACCOUNT: val(a, 'account') ?? process.env.CODEX_REPORT_ACCOUNT,
          },
        });
        const signal = (): void => {
          child.kill('SIGINT');
        };
        process.on('SIGINT', signal);
        child.once('error', (e) => {
          process.off('SIGINT', signal);
          reject(e);
        });
        child.once('exit', (c) => {
          process.off('SIGINT', signal);
          resolve(c ?? 1);
        });
      });
      try {
        await rpc(home, '/api/sync', {}, 4000);
      } catch {}
      const r = await reportRead(home, {
        scope: 'lifetime',
        from: started,
        account: val(a, 'account') ?? config.reportAccount,
      });
      show('\nCodex exit report - observed launch interval\n' + reportText(r), false);
      process.exitCode = code;
    } finally {
      await own?.close();
    }
    return;
  }
  if (command === 'sync' && !val(a, 'path') && !a.flags.verify) {
    try {
      show(await rpc(home, '/api/sync', {}, 15000));
      return;
    } catch {}
  }
  if (command === 'uninstall-hooks') {
    const manifest = path.join(home, 'managed-hooks.json');
    if (!fs.existsSync(manifest)) {
      show({ removed: 0 });
      return;
    }
    for (const codexFile of Object.keys(object(readJson(manifest))))
      show(configureHooks(home, path.dirname(codexFile), true));
    return;
  }
  if (command === 'restore') {
    const file = a.positional[0];
    if (!file) throw new Error('Backup path required.');
    inspectBackup(file);
    if (!a.flags.apply) {
      show({ valid: true, apply: false });
      return;
    }
    show({ restored: true, backup: restoreBackup(home, file) });
    return;
  }
  const s = new Store(home);
  try {
    if (command === 'sync') {
      if (a.flags.verify) s.db.exec('DELETE FROM cursors');
      show(
        await new Collector(s, config).sync({
          paths: val(a, 'path') ? [path.resolve(val(a, 'path') ?? '')] : undefined,
          account: val(a, 'account'),
        }),
      );
    } else if (command === 'backup') {
      const file = a.positional[0];
      if (!file) throw new Error('Destination required.');
      s.backup(file);
      show({ backup: path.resolve(file) });
    } else if (command === 'export') {
      const file = a.positional[0];
      if (!file) throw new Error('Destination required.');
      exportData(s, file, config.deviceId);
      show({ export: path.resolve(file) });
    } else if (command === 'import') {
      const file = a.positional[0];
      if (!file) throw new Error('Archive required.');
      show(importData(s, file, Boolean(a.flags.apply)));
    } else if (command === 'reprice')
      show(
        reprice(
          s,
          loadPrices(home),
          Boolean(a.flags.all),
          Boolean(a.flags.apply),
          config.priceBasis,
        ),
      );
    else if (command === 'prices') {
      const action = a.positional[0] ?? 'show';
      const prices = loadPrices(home);
      if (action === 'show') show(prices);
      else if (action === 'load') {
        const file = a.positional[1];
        if (!file) throw new Error('Price table path required.');
        const p = validatePrices(readJson(file));
        if (a.flags.apply) {
          writeJson(path.join(home, 'prices.json'), p);
          s.audit('prices-load', { asOf: p.asOf });
        }
        show({ models: Object.keys(p.models), apply: Boolean(a.flags.apply) });
      } else if (action === 'alias') {
        const alias = a.positional[1],
          target = a.positional[2];
        if (!alias || !target || !prices.models[target])
          throw new Error('Use prices alias LOCAL_ID PRICED_MODEL.');
        prices.aliases[alias] = target;
        validatePrices(prices);
        if (a.flags.apply) {
          writeJson(path.join(home, 'prices.json'), prices);
          s.audit('price-alias', { alias, target });
        }
        show({ alias, target, apply: Boolean(a.flags.apply) });
      } else throw new Error('Unknown prices operation.');
    } else if (command === 'audit')
      show(s.db.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT 100').all());
    else if (command === 'conflicts')
      show(s.db.prepare('SELECT * FROM issues ORDER BY at DESC LIMIT 100').all());
    else throw new Error(`Unknown command: ${command}. Run codex-report --help.`);
  } finally {
    s.close();
  }
}
void main().catch((e) => {
  if (process.argv.includes('hook')) {
    show({});
    return;
  }
  process.stderr.write(`codex-report: ${message(e)}\n`);
  process.exitCode = 1;
});
