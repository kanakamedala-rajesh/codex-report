// @ts-check
'use strict';
/** @typedef {import('../src/reports').Report} CodexReport */
/** @typedef {import('../src/reports').TaskRow} Task */
/** @param {string} id */
function byId(id) {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element: ${id}`);
  return value;
}
/** @param {string} id */
function select(id) {
  const value = byId(id);
  if (!(value instanceof HTMLSelectElement)) throw new Error('Expected select');
  return value;
}
/** @param {string} tag @param {string} [text] @param {string} [className] */
function el(tag, text = '', className = '') {
  const n = document.createElement(tag);
  n.textContent = text;
  if (className) n.className = className;
  return n;
}
/** @param {number} n */
function number(n) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(
    n,
  );
}
/** @param {number} n */
function precise(n) {
  return n.toLocaleString('en-US');
}
/** @param {string|null} t */
function date(t) {
  return t ? new Date(t).toLocaleString() : 'Not recorded';
}
/** @type {CodexReport|null} */
let current = null;
let lastRefresh = 0;
let view = 'overview',
  revision = -1,
  loading = false;
const expanded = new Set();
/** @param {string} url @param {RequestInit} [options] */
async function get(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Local request failed');
  return value;
}
/** @param {string} label @param {string} value @param {string} sub @param {boolean} [money] */
function card(label, value, sub, money = false) {
  const n = el('div', '', 'card');
  n.append(
    el('div', label, 'label'),
    el('div', value, money ? 'value money' : 'value'),
    el('div', sub, 'sub'),
  );
  return n;
}
/** @param {string} title @param {string} description */
function panel(title, description) {
  const n = el('section', '', 'panel');
  n.append(el('h2', title), el('p', description, 'description'));
  return n;
}
/** @param {string} label @param {string} value */
function datum(label, value) {
  const d = el('div', '', 'datum');
  d.append(el('div', value, 'value'), el('div', label, 'label'));
  return d;
}
/** @param {string} label @param {number} value @param {number} maximum @param {string} text */
function bar(label, value, maximum, text) {
  const row = el('div', '', 'bar-row'),
    top = el('div', '', 'bar-top');
  top.append(el('span', label), el('span', text));
  const p = document.createElement('progress');
  p.max = maximum || 1;
  p.value = value;
  p.setAttribute('aria-label', label);
  row.append(top, p);
  return row;
}
/** @param {Task} task */
function taskView(task) {
  const details = document.createElement('details');
  details.className = 'task';
  const key = task.thread + task.turn;
  details.open = expanded.has(key);
  details.addEventListener('toggle', () =>
    details.open ? expanded.add(key) : expanded.delete(key),
  );
  const summary = el('summary'),
    title = el('div'),
    name = el('span', `Turn ${task.number ?? task.turn.slice(0, 8)}`, 'task-title');
  title.append(name, el('span', date(task.started), 'task-date'));
  summary.append(
    title,
    el('span', task.status, `badge ${task.status}`),
    el('span', `${task.totals.pricePico !== null ? '~' : ''}${task.totals.apiEquivalent}`, 'num'),
  );
  const body = el('div', '', 'details'),
    grid = el('div', '', 'detail-grid');
  for (const [label, value] of [
    ['Input', precise(task.totals.input)],
    ['Cached', precise(task.totals.cached)],
    ['Output', precise(task.totals.output)],
    ['Reasoning (within output)', precise(task.totals.reasoning)],
    ['Model requests', String(task.totals.requests)],
    ['Child threads', `${task.workers} workers / ${task.reviewers} reviews`],
  ])
    grid.append(datum(label || '', value || ''));
  body.append(
    grid,
    el('p', task.models.join(' + '), 'note'),
    el('code', `${task.thread} / ${task.turn}`),
  );
  if (task.collectionPending)
    body.append(el('p', 'Collection is catching up for this turn.', 'notice'));
  if (task.error) body.append(el('p', `Failure: ${task.error}`, 'notice'));
  if (task.totals.unpricedRequests)
    body.append(
      el(
        'p',
        'Not priced: ' +
          Object.entries(task.unpriced)
            .map(([model, count]) => `${count} ${model} request(s)`)
            .join('; '),
        'notice',
      ),
    );
  details.append(summary, body);
  return details;
}
/** @param {CodexReport} r */
function render(r) {
  current = r;
  const content = byId('content');
  content.replaceChildren();
  const t = r.totals;
  byId('period-info').textContent =
    `${r.period.label} | ${r.account} | ${r.period.from ? date(r.period.from) : 'Earliest recorded usage'} to ${r.period.to ? date(r.period.to) : 'now'}`;
  byId('freshness').textContent = `Snapshot ${date(r.generatedAt)} | revision ${r.revision}`;
  const latest = r.tasks[0],
    failure = byId('failure');
  failure.classList.toggle('hidden', !latest || latest.status !== 'failed');
  failure.textContent =
    latest?.status === 'failed'
      ? `Latest turn failed: ${latest.error || 'unspecified error'}. Observed usage has been retained.`
      : '';
  if (view === 'overview') {
    const cards = el('section', '', 'cards');
    cards.append(
      card(
        'API equivalent',
        `${t.pricePico !== null ? '~' : ''}${t.apiEquivalent}`,
        t.unpricedRequests
          ? `${t.unpricedRequests} requests remain unpriced`
          : 'Standard token-price estimate',
        true,
      ),
      card(
        'Input processed',
        number(t.input),
        `${t.cachePercent?.toFixed(1) ?? '0'}% served from cache`,
      ),
      card('Output tokens', number(t.output), `${number(t.reasoning)} reasoning, included`),
      card(
        'User turns',
        String(r.statistics.tasks),
        `${r.statistics.completed} complete / ${r.statistics.interrupted} interrupted`,
      ),
    );
    content.append(cards);
    const grid = el('div', '', 'grid-two'),
      timeline = panel('Activity over time', 'Input and output processed, by recorded day'),
      bars = el('div', '', 'bars');
    const maximum = Math.max(1, ...r.days.map((d) => d.totals.processed));
    for (const d of r.days.slice(-10))
      bars.append(bar(d.day, d.totals.processed, maximum, number(d.totals.processed)));
    if (!r.days.length) bars.append(el('p', 'No recorded usage in this period.', 'note'));
    timeline.append(bars);
    const models = panel('Model breakdown', 'Unknown rates remain visible, never zero'),
      mb = el('div', '', 'bars');
    for (const m of r.models)
      mb.append(
        bar(
          m.name,
          m.totals.processed,
          t.processed,
          `${m.totals.apiEquivalent} / ${number(m.totals.processed)} tokens`,
        ),
      );
    models.append(mb);
    grid.append(timeline, models);
    content.append(grid);
    const recent = panel(
      'Recent turns',
      'Expand a turn for its requests, agents, and price coverage.',
    );
    for (const task of r.tasks.slice(0, 5)) recent.append(taskView(task));
    if (!r.tasks.length)
      recent.append(
        el(
          'p',
          'Run Codex with the collector open, or use codex-report sync to import retained history.',
          'note',
        ),
      );
    content.append(recent);
  } else if (view === 'turns') {
    const p = panel(
      'Turns & agent accounting',
      `${r.tasks.length} observed root turns. Displaying the latest 200; use CLI JSON export for the complete selection.`,
    );
    for (const task of r.tasks.slice(0, 200)) p.append(taskView(task));
    content.append(p);
  } else if (view === 'limits') {
    const grid = el('div', '', 'grid-two'),
      quota = panel(
        'Provider-reported limits',
        'Snapshots observed in local session records, not a live account API.',
      );
    for (const q of r.quotas) {
      const block = el('div', '', 'quota');
      const minutes = Number(q.minutes);
      const window =
        Number.isFinite(minutes) && minutes > 0 ? `${minutes / 60}h window` : String(q.window);
      const head = el('div', '', 'quota-head');
      head.append(
        el('h3', `${String(q.limitId)} / ${window}`),
        el('span', typeof q.used === 'number' ? `${q.used}%` : 'Unknown', 'percent'),
      );
      block.append(head);
      if (typeof q.used === 'number')
        block.append(bar('Recorded allowance used', q.used, 100, 'used'));
      block.append(
        el(
          'p',
          `Observed ${date(String(q.at))} | Reset ${date(typeof q.resets === 'string' ? q.resets : null)}`,
        ),
      );
      if (q.reached) block.append(el('p', String(q.reached), 'notice'));
      quota.append(block);
    }
    if (!r.quotas.length)
      quota.append(
        el('p', 'No quota snapshot recorded yet. Missing does not mean unused.', 'note'),
      );
    const comparison = panel(
      'Your recorded workload',
      'Compare these measurements with your plan usage page.',
    );
    comparison.append(
      datum('Model requests', precise(t.requests)),
      datum('Input + output', precise(t.processed)),
      datum('API-equivalent estimate', t.apiEquivalent),
      datum('Unpriced requests', precise(t.unpricedRequests)),
    );
    if (r.statistics.subscriptionMultiple !== null)
      comparison.append(
        datum(
          'API-equivalent / configured fee',
          `${r.statistics.subscriptionMultiple.toFixed(2)}x`,
        ),
      );
    comparison.append(
      el(
        'p',
        'Last five hours is a local lookback. Provider windows retain their own recorded duration and reset.',
        'note',
      ),
    );
    grid.append(quota, comparison);
    content.append(grid);
  } else {
    const health = panel(
      'Data health',
      'Collection, attribution, and price coverage are separate observations.',
    );
    health.append(
      datum('Storage backend', String(r.health.backend)),
      datum('Priced requests', `${t.pricedRequests} / ${t.requests}`),
    );
    const collection = r.health.collection;
    health.append(
      el('h3', 'Latest collection'),
      el('pre', JSON.stringify(collection, null, 2)),
      el('h3', 'Source status'),
      el('pre', JSON.stringify(r.health.sources, null, 2)),
      el('h3', 'Recorded issues'),
      el('pre', JSON.stringify(r.health.issues, null, 2)),
    );
    content.append(health);
  }
}
async function refresh(force = false) {
  if (loading) return;
  loading = true;
  try {
    const status = await get('/api/status');
    const account = select('account');
    for (const name of status.accounts) {
      if (!Array.from(account.options).some((o) => o.value === name)) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        account.append(option);
      }
    }
    if (force || status.revision !== revision || Date.now() - lastRefresh >= 10000) {
      const params = new URLSearchParams({ scope: select('period').value, account: account.value });
      const model = select('model').value;
      if (model) params.set('model', model);
      const r = /** @type {CodexReport} */ (await get('/api/report?' + params));
      render(r);
      revision = r.revision;
      lastRefresh = Date.now();
      for (const m of r.models) {
        const models = select('model');
        if (!Array.from(models.options).some((o) => o.value === m.name)) {
          const option = document.createElement('option');
          option.value = m.name;
          option.textContent = m.name;
          models.append(option);
        }
      }
    }
    byId('connection').textContent = 'Collector connected';
    byId('connection').classList.remove('offline');
    byId('error').classList.add('hidden');
  } catch (error) {
    byId('connection').textContent = 'Collector unavailable';
    byId('connection').classList.add('offline');
    byId('error').textContent = error instanceof Error ? error.message : String(error);
    byId('error').classList.remove('hidden');
  } finally {
    loading = false;
  }
}
async function boot() {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  if (token) {
    history.replaceState(null, '', location.pathname);
    await get('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  }
  for (const button of document.querySelectorAll('button[data-view]'))
    button.addEventListener('click', () => {
      view = button.getAttribute('data-view') || 'overview';
      for (const b of document.querySelectorAll('button[data-view]')) {
        b.classList.toggle('selected', b === button);
        if (b === button) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      }
      byId('title').textContent = button.textContent;
      if (current) render(current);
    });
  for (const id of ['period', 'account', 'model'])
    select(id).addEventListener('change', () => {
      void refresh(true);
    });
  byId('refresh').addEventListener('click', () => {
    void refresh(true);
  });
  byId('download').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codex-report.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  await refresh(true);
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 2000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
}
void boot().catch((error) => {
  byId('error').textContent = error instanceof Error ? error.message : String(error);
  byId('error').classList.remove('hidden');
});
