import { Store } from './database';
import { Config } from './config';
import { Sample, Tokens, Turn, Thread } from './types';
import { period, Period } from './periods';
import { dollars } from './pricing';
import { object, clean } from './util';
export interface Filter {
  scope?: string;
  account?: string;
  thread?: string;
  turn?: string;
  model?: string;
  from?: string;
  to?: string;
}
export interface Totals extends Tokens {
  processed: number;
  requests: number;
  pricedRequests: number;
  unpricedRequests: number;
  pricePico: string | null;
  apiEquivalent: string;
  cachePercent: number | null;
}
export function totals(samples: Sample[]): Totals {
  const t: Totals = {
    input: 0,
    cached: 0,
    write: 0,
    output: 0,
    reasoning: 0,
    processed: 0,
    requests: samples.length,
    pricedRequests: 0,
    unpricedRequests: 0,
    pricePico: null,
    apiEquivalent: 'unpriced',
    cachePercent: null,
  };
  let money = 0n;
  for (const s of samples) {
    for (const k of ['input', 'cached', 'write', 'output', 'reasoning'] as const) {
      t[k] += s[k];
      if (!Number.isSafeInteger(t[k]))
        throw new Error('Token total exceeds the safe integer range.');
    }
    if (s.pricePico !== null) {
      money += BigInt(s.pricePico);
      t.pricedRequests++;
    } else t.unpricedRequests++;
  }
  t.processed = t.input + t.output;
  t.pricePico = t.pricedRequests ? String(money) : null;
  t.apiEquivalent = dollars(t.pricePico);
  t.cachePercent = t.input ? (100 * t.cached) / t.input : null;
  return t;
}
export interface TaskRow {
  thread: string;
  turn: string;
  number: number | null;
  started: string;
  ended: string | null;
  durationMs: number | null;
  status: string;
  error: string | null;
  totals: Totals;
  direct: Totals;
  workers: number;
  reviewers: number;
  unlinked: number;
  models: string[];
  efforts: string[];
  unpriced: Record<string, number>;
  collectionPending: boolean;
  recordedTools: number;
}
export interface Report {
  schema: 1;
  revision: number;
  generatedAt: string;
  account: string;
  period: Period;
  totals: Totals;
  tasks: TaskRow[];
  models: { name: string; totals: Totals }[];
  days: { day: string; totals: Totals }[];
  quotas: Record<string, unknown>[];
  health: Record<string, unknown>;
  breakdowns: Record<string, { name: string; totals: Totals }[]>;
  statistics: {
    tasks: number;
    completed: number;
    interrupted: number;
    failed: number;
    p50Ms: number | null;
    p95Ms: number | null;
    averagePrice: string;
    subscriptionMultiple: number | null;
  };
}
export function report(store: Store, config: Config, f: Filter = {}): Report {
  const account = f.account ?? config.reportAccount;
  const p = period(
    f.scope ?? 'cycle',
    config.timezone,
    config.accounts[account] ?? {},
    Date.now(),
    f.from,
    f.to,
  );
  // Restrict the ledger query before materializing metadata for a turn receipt.
  const clauses: string[] = [];
  const params: string[] = [];
  if (account !== 'all') {
    clauses.push('account=?');
    params.push(account);
  }
  if (p.from) {
    clauses.push('at>=?');
    params.push(p.from);
  }
  if (p.to) {
    clauses.push('at<?');
    params.push(p.to);
  }
  if (f.model) {
    clauses.push('model=?');
    params.push(f.model);
  }
  if (f.thread) {
    if (f.scope === 'task') {
      clauses.push('rootThread=?');
      params.push(f.thread);
    } else {
      clauses.push('(thread=? OR rootThread=?)');
      params.push(f.thread, f.thread);
    }
  }
  if (f.turn) {
    clauses.push(f.scope === 'thread' ? 'turn=?' : 'rootTurn=?');
    params.push(f.turn);
  }
  const filtered = store.db
    .prepare(
      'SELECT * FROM effective_samples' +
        (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '') +
        ' ORDER BY at,id',
    )
    .all(...params) as unknown as Sample[];
  const threads = store.db.prepare('SELECT * FROM threads').all() as unknown as Thread[];
  const tm = new Map(threads.map((t) => [t.id, t]));
  const turns = store.db
    .prepare('SELECT * FROM turns ORDER BY started,id')
    .all() as unknown as Turn[];
  const turnMap = new Map(turns.map((t) => [`${t.thread}:${t.id}`, t]));
  const numbers = new Map<string, number>();
  const next = new Map<string, number>();
  for (const t of turns) {
    const thread = tm.get(t.thread);
    if (thread && thread.parent === null && thread.root === thread.id) {
      const n = (next.get(t.thread) ?? 0) + 1;
      next.set(t.thread, n);
      numbers.set(`${t.thread}:${t.id}`, n);
    }
  }
  const groups = new Map<string, Sample[]>();
  for (const s of filtered) {
    const k = `${s.rootThread}:${s.rootTurn}`;
    const a = groups.get(k) ?? [];
    a.push(s);
    groups.set(k, a);
  }
  // Show persisted zero-usage outcomes too; never invent a price for absent measurements.
  for (const t of turns)
    if (
      t.thread === t.rootThread &&
      (!f.thread || t.thread === f.thread) &&
      (!f.turn || t.id === f.turn) &&
      (!p.from || (t.ended ?? t.started) >= p.from) &&
      (!p.to || t.started < p.to) &&
      !f.model &&
      account === 'all'
    ) {
      const k = `${t.thread}:${t.id}`;
      if (!groups.has(k)) groups.set(k, []);
    }
  const pendingTasks = new Set<string>();
  for (const cursor of store.db.prepare("SELECT state FROM cursors WHERE health='pending'").all()) {
    try {
      const state = object(object(JSON.parse(String(cursor.state))).parser);
      const owner = object(state.owner);
      pendingTasks.add(
        `${String(owner.root ?? owner.id)}:${String(state.rootTurn || state.active)}`,
      );
    } catch {}
  }
  const toolCounts = new Map<string, number>();
  for (const tool of store.db
    .prepare('SELECT thread,turn,COUNT(*) AS count FROM tools GROUP BY thread,turn')
    .all()) {
    const owner = turnMap.get(`${String(tool.thread)}:${String(tool.turn)}`);
    const key = owner
      ? `${owner.rootThread}:${owner.rootTurn}`
      : `${String(tool.thread)}:${String(tool.turn)}`;
    toolCounts.set(key, (toolCounts.get(key) ?? 0) + Number(tool.count));
  }
  const tasks: TaskRow[] = [];
  for (const [key, ss] of groups) {
    const t = turnMap.get(key);
    const first = ss[0];
    if (!t && !first) continue;
    const thread = t?.thread ?? first?.rootThread ?? '',
      turn = t?.id ?? first?.rootTurn ?? '';
    const children = [...new Set(ss.filter((s) => s.thread !== thread).map((s) => s.thread))];
    let workers = 0,
      reviewers = 0,
      unlinked = 0;
    for (const id of children) {
      const kind = tm.get(id)?.kind ?? '';
      if (
        /guardian|review/.test(kind) ||
        ss.filter((s) => s.thread === id).every((s) => s.model === 'codex-auto-review')
      )
        reviewers++;
      else if (tm.has(id)) workers++;
      else unlinked++;
    }
    const unpriced: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const s of ss)
      if (s.pricePico === null)
        unpriced[s.model || 'unknown'] = (unpriced[s.model || 'unknown'] ?? 0) + 1;
    const last = ss[ss.length - 1]?.at ?? t?.started ?? new Date().toISOString();
    tasks.push({
      thread,
      turn,
      number: numbers.get(key) ?? null,
      started: t?.started ?? first?.at ?? last,
      ended: t?.ended ?? null,
      durationMs: t?.durationMs ?? (t?.ended ? Date.parse(t.ended) - Date.parse(t.started) : null),
      status: t?.status ?? 'unknown',
      error: t?.error ?? null,
      totals: totals(ss),
      direct: totals(ss.filter((s) => s.thread === thread)),
      workers,
      reviewers,
      unlinked,
      models: [...new Set(ss.map((s) => s.model || 'unknown'))],
      efforts: [...new Set(ss.map((s) => s.effort).filter(Boolean))],
      unpriced,
      collectionPending: pendingTasks.has(key),
      recordedTools: toolCounts.get(key) ?? 0,
    });
  }
  tasks.sort((a, b) => b.started.localeCompare(a.started));
  const models = [...new Set(filtered.map((s) => s.model || 'unknown'))].map((name) => ({
    name,
    totals: totals(filtered.filter((s) => (s.model || 'unknown') === name)),
  }));
  const breakdowns: Report['breakdowns'] = {};
  for (const field of ['account', 'effort', 'device', 'tier'] as const) {
    const bins = new Map<string, Sample[]>();
    for (const sample of filtered) {
      const name = sample[field] || 'not recorded';
      const bin = bins.get(name) ?? [];
      bin.push(sample);
      bins.set(name, bin);
    }
    breakdowns[field] = [...bins].map(([name, rows]) => ({ name, totals: totals(rows) }));
  }
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: p.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dg = new Map<string, Sample[]>();
  for (const s of filtered) {
    const day = dayFormatter.format(new Date(s.at));
    const a = dg.get(day) ?? [];
    a.push(s);
    dg.set(day, a);
  }
  const latest = new Map<string, Record<string, unknown>>();
  for (const q of store.db.prepare('SELECT * FROM quotas ORDER BY at').all()) {
    if (account !== 'all' && q.account !== account) continue;
    const k = `${String(q.account)}:${String(q.limitId)}:${String(q.window)}:${String(q.minutes)}`;
    latest.set(k, q);
  }
  const durations = tasks
    .map((t) => t.durationMs)
    .filter((n): n is number => n !== null && n >= 0)
    .sort((a, b) => a - b);
  const percentile = (v: number): number | null =>
    durations.length
      ? (durations[Math.min(durations.length - 1, Math.ceil(v * durations.length) - 1)] ?? null)
      : null;
  const t = totals(filtered);
  const pricedTasks = tasks.filter(
    (t) => !t.totals.unpricedRequests && t.totals.pricePico !== null,
  );
  const mean = pricedTasks.length
    ? pricedTasks.reduce((n, t) => n + BigInt(t.totals.pricePico ?? '0'), 0n) /
      BigInt(pricedTasks.length)
    : null;
  const acct = config.accounts[account];
  const fee =
    acct?.monthlyUsd ??
    (acct?.subscriptionAmount && acct.localPerUsd
      ? acct.subscriptionAmount / acct.localPerUsd
      : null);
  let collection: unknown = null;
  try {
    collection = JSON.parse(
      String(
        store.db.prepare("SELECT value FROM meta WHERE key='collection'").get()?.value ?? 'null',
      ),
    );
  } catch {}
  return {
    schema: 1,
    revision: store.revision(),
    generatedAt: new Date().toISOString(),
    account,
    period: p,
    totals: t,
    tasks,
    models,
    days: [...dg.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, s]) => ({ day, totals: totals(s) })),
    quotas: [...latest.values()],
    breakdowns,
    health: {
      collection,
      issues: store.db
        .prepare(
          'SELECT code,COUNT(*) AS observations,MAX(at) AS latest FROM issues GROUP BY code ORDER BY latest DESC',
        )
        .all(),
      sources: store.db
        .prepare('SELECT health,COUNT(*) AS files FROM cursors GROUP BY health')
        .all(),
      backend: store.backend,
      coverage: 'Observed local records; provider quotas are separate snapshots.',
    },
    statistics: {
      tasks: tasks.length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      interrupted: tasks.filter((t) => t.status === 'interrupted').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      averagePrice: dollars(mean),
      subscriptionMultiple:
        (f.scope ?? 'cycle') === 'cycle' && acct?.billingDay && fee && t.pricePico !== null
          ? Number(BigInt(t.pricePico)) / 1e12 / fee
          : null,
    },
  };
}
function duration(ms: number | null): string {
  if (ms === null) return 'not recorded';
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600
    ? `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`
    : `${Math.floor(s / 60)}m ${s % 60}s`;
}
export function receipt(task: TaskRow, context?: Report, override?: string): string {
  const t = task.totals;
  const n = (value: number) => value.toLocaleString('en-US');
  const status = override ?? task.status;
  const title =
    status === 'interrupted'
      ? 'interrupted by you'
      : status === 'stopping'
        ? 'stopping point'
        : status;
  const rows = [
    `Turn ${task.number ?? task.turn.slice(0, 8)} - ${title}`,
    `Elapsed        ${duration(task.durationMs)}`,
    `Input          ${n(t.input)}`,
    `Cached         ${n(t.cached)}${t.cachePercent !== null ? ` (${t.cachePercent.toFixed(1)}%)` : ''}`,
    `Output         ${n(t.output)}`,
    `Reasoning      ${n(t.reasoning)} (included in output)`,
    `API-equivalent ${t.pricePico !== null ? '~' : ''}${t.apiEquivalent}${t.unpricedRequests ? ' (partial)' : ''}`,
  ];
  for (const [model, count] of Object.entries(task.unpriced))
    rows.push(`Not priced     ${count} ${clean(model)} request(s)`);
  if (task.error) rows.push(`Failure        ${clean(task.error)}`);
  if (task.workers + task.reviewers + task.unlinked)
    rows.push(
      `Child work     ${task.workers} workers; ${task.reviewers} approval reviews${task.unlinked ? `; ${task.unlinked} unlinked` : ''}`,
    );
  if (context)
    rows.push(
      `${context.period.label.padEnd(15)}${context.totals.pricePico !== null ? '~' : ''}${context.totals.apiEquivalent}${context.totals.unpricedRequests ? ' (partial)' : ''}`,
    );
  if (task.collectionPending)
    rows.push('Collection     Turn is partial; collector is catching up.');
  if (status === 'interrupted')
    rows.push('Observed usage; an in-flight request may not be recorded.');
  return rows.join('\n');
}
export function reportText(r: Report): string {
  return [
    `Codex Report | ${r.period.label} | ${r.account}`,
    `Input: ${r.totals.input.toLocaleString('en-US')} | Output: ${r.totals.output.toLocaleString('en-US')}`,
    `API-equivalent: ${r.totals.apiEquivalent} | Unpriced requests: ${r.totals.unpricedRequests}`,
    `Tasks: ${r.statistics.tasks} | completed ${r.statistics.completed} | interrupted ${r.statistics.interrupted} | failed ${r.statistics.failed}`,
    ...r.tasks
      .slice(0, 20)
      .map(
        (t) =>
          `  ${t.started} | ${t.number ?? '?'} ${t.status} | ${t.totals.apiEquivalent} | ${t.totals.processed.toLocaleString('en-US')} tokens`,
      ),
  ].join('\n');
}
export function exportReport(r: Report, format: string): string {
  if (format === 'json') return JSON.stringify(r, null, 2) + '\n';
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
  if (format === 'html')
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Codex Report</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px;color:#182632;background:#f4f6f8}pre{white-space:pre-wrap;padding:20px;background:white;border-radius:12px}</style><h1>Codex Report</h1><p>${escape(r.period.label)} | ${escape(r.account)} | ${escape(r.generatedAt)}</p><pre>${escape(reportText(r))}</pre>${r.tasks.map((t) => `<pre>${escape(receipt(t))}</pre>`).join('')}`;
  if (format === 'csv') {
    const cell = (v: unknown) =>
      '"' +
      String(v ?? '')
        .replace(/^[\s]*[=+@-]/, "'$&")
        .replace(/"/g, '""') +
      '"';
    return (
      [
        [
          'turn',
          'thread',
          'started',
          'status',
          'input',
          'cached',
          'output',
          'reasoning',
          'api_equivalent',
          'unpriced_requests',
        ],
        ...r.tasks.map((t) => [
          t.turn,
          t.thread,
          t.started,
          t.status,
          t.totals.input,
          t.totals.cached,
          t.totals.output,
          t.totals.reasoning,
          t.totals.apiEquivalent,
          t.totals.unpricedRequests,
        ]),
      ]
        .map((row) => row.map(cell).join(','))
        .join('\n') + '\n'
    );
  }
  throw new Error('Format must be json, html, or csv.');
}
export function filter(input: unknown): Filter {
  const o = object(input);
  const f: Filter = {};
  for (const k of ['scope', 'account', 'thread', 'turn', 'model', 'from', 'to'] as const)
    if (o[k] !== undefined) {
      if (typeof o[k] !== 'string' || String(o[k]).length > 240)
        throw new Error('Invalid report filter.');
      f[k] = String(o[k]);
    }
  return f;
}
