// @ts-check
'use strict';
/** @typedef {import('../src/reports').Report} CodexReport */
/** @typedef {import('../src/reports').TaskRow} Task */
/** @typedef {import('../src/reports').SessionRow} Session */
/** @typedef {import('../src/settings').SettingsSnapshot} SettingsSnapshot */
/** @typedef {import('../src/config').Account} Account */
/** @typedef {import('../src/config').DashboardPreferences} DashboardPreferences */
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
/** @param {string} id */
function input(id) {
  const value = byId(id);
  if (!(value instanceof HTMLInputElement)) throw new Error('Expected input');
  return value;
}
/** @param {string} id */
function button(id) {
  const value = byId(id);
  if (!(value instanceof HTMLButtonElement)) throw new Error('Expected button');
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
/** @param {string|null} t @param {string} [zone] */
function date(t, zone) {
  return t
    ? new Date(t).toLocaleString(undefined, {
        timeZone: zone || settingsState?.values.timezone || undefined,
      })
    : 'Not recorded';
}
/** @type {CodexReport|null} */
let current = null;
/** @type {Map<string, Task>} */
let taskIndex = new Map();
let lastRefresh = 0;
let view = 'overview',
  revision = -1,
  loading = false;
const expanded = new Set();
/** @type {Map<string, boolean>} */
const expandedSessions = new Map();
/** @type {Map<string, number>} */
const shownTurns = new Map();
/** @type {SettingsSnapshot|null} */
let settingsState = null;
let sessionPage = 0;
let sessionQuery = '';
let settingsDirty = false;
let billingDirty = false;
let settingsSaving = false;
let settingsDraftRevision = '';
let billingLabel = '';
let renameThread = '';
let renameRevision = '';
let renameSaving = false;
const renameDialog = /** @type {HTMLDialogElement} */ (byId('rename-dialog'));
/** @param {string} theme */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}
/** @param {string} text */
function showError(text) {
  byId('error').textContent = text;
  byId('error').classList.remove('hidden');
}
/** @param {string} id @param {string} value @param {string} [label] */
function setOption(id, value, label) {
  const node = select(id);
  if (!Array.from(node.options).some((o) => o.value === value)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label || value;
    node.append(option);
  }
  node.value = value;
}
/** @param {Record<string, unknown>} changes @param {string} expectedRevision */
async function saveSettings(changes, expectedRevision) {
  const saved = /** @type {SettingsSnapshot & {auditWarning?: string|null}} */ (
    await get('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: expectedRevision, changes }),
    })
  );
  settingsState = saved;
  applyTheme(saved.values.dashboard.theme);
  revision = -1;
  return saved;
}
/** @param {Session} session */
async function renameSession(session) {
  if (renameDialog.open || renameSaving) return;
  try {
    const state = /** @type {SettingsSnapshot} */ (await get('/api/settings'));
    renameRevision = state.revision;
    renameThread = session.id;
    input('session-name').value = session.name || '';
    byId('rename-error').textContent = '';
    renameDialog.showModal();
    input('session-name').focus();
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
}
/** @param {Session} session */
function sessionView(session) {
  const tasks = session.turnIds
    .map((id) => taskIndex.get(`${session.id}:${id}`))
    .filter((t) => t !== undefined);
  const details = document.createElement('details');
  details.className = 'session';
  details.dataset.session = session.id;
  details.open = expandedSessions.get(session.id) ?? false;
  details.addEventListener('toggle', () => {
    if (details.isConnected) expandedSessions.set(session.id, details.open);
  });
  const summary = el('summary');
  const identity = el('div', '', 'session-identity');
  identity.append(
    el('span', session.name || `Session ${date(session.started)}`, 'session-title'),
    el('span', `Started ${date(session.started)} | ID ${session.id.slice(0, 8)}`, 'task-date'),
  );
  const counts = el('div', '', 'session-counts');
  counts.append(
    el('span', `${tasks.length} turn${tasks.length === 1 ? '' : 's'} in selection`, 'note'),
  );
  for (const [n, label, code] of [
    [session.outcomes.completed, 'completed', 'completed'],
    [session.outcomes.interrupted, 'interrupted', 'interrupted'],
    [session.outcomes.usageExceeded, 'usage exceeded', 'usage-exceeded'],
    [session.outcomes.failed, 'failed', 'failed'],
    [session.outcomes.other, 'active / unknown', 'unknown'],
  ])
    if (n) counts.append(el('span', `${n} ${label}`, `badge ${code}`));
  const cost = el('div', '', 'session-cost');
  cost.append(
    el(
      'span',
      `${session.totals.pricePico !== null ? '~' : ''}${session.totals.apiEquivalent}`,
      'num',
    ),
    el(
      'span',
      session.totals.unpricedRequests
        ? `${session.totals.unpricedRequests} unpriced requests`
        : 'API-equivalent',
      'task-date',
    ),
  );
  summary.append(identity, counts, cost);
  const body = el('div', '', 'session-body');
  const meta = el('div', '', 'session-meta');
  const rename = el('button', 'Name session', 'secondary');
  rename.setAttribute('type', 'button');
  rename.addEventListener('click', () => {
    void renameSession(session);
  });
  meta.append(el('code', session.id), rename);
  body.append(
    meta,
    el(
      'p',
      `Last activity ${date(session.lastActivity)}. Usage totals follow the selected period, account, and model.`,
      'note',
    ),
  );
  const limit = shownTurns.get(session.id) ?? 50;
  for (const task of tasks.slice(-limit)) body.append(taskView(task));
  if (tasks.length > limit) {
    const more = el(
      'button',
      `Show ${Math.min(50, tasks.length - limit)} earlier turns`,
      'secondary',
    );
    more.addEventListener('click', () => {
      shownTurns.set(session.id, limit + 50);
      expandedSessions.set(session.id, true);
      if (current) render(current);
    });
    body.append(more);
  }
  details.append(summary, body);
  return details;
}

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
/** @param {Task} task @param {boolean} [showSession] */
function taskView(task, showSession = false) {
  const details = document.createElement('details');
  details.className = 'task';
  const key = task.thread + ':' + task.turn;
  details.open = expanded.has(key);
  details.addEventListener('toggle', () =>
    details.open ? expanded.add(key) : expanded.delete(key),
  );
  const summary = el('summary'),
    title = el('div'),
    name = el('span', `Turn ${task.number ?? task.turn.slice(0, 8)}`, 'task-title');
  title.append(name, el('span', date(task.started), 'task-date'));
  if (showSession) title.append(el('span', `Session ${task.thread.slice(0, 8)}`, 'task-date'));
  summary.append(
    title,
    el('span', task.displayOutcome.label, `badge ${task.displayOutcome.code}`),
    el(
      'span',
      `${task.totals.pricePico !== null ? '~' : ''}${task.totals.apiEquivalent}${task.totals.pricePico !== null && task.totals.unpricedRequests ? ' (partial)' : ''}`,
      'num',
    ),
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
  if (task.error) body.append(el('p', `Reason: ${task.error}`, 'notice'));
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
  taskIndex = new Map(r.tasks.map((t) => [`${t.thread}:${t.turn}`, t]));
  const content = byId('content');
  if (view === 'settings') return;
  content.replaceChildren();
  const t = r.totals;
  byId('period-info').textContent =
    `${r.period.label} | ${r.account} | ${r.period.from ? date(r.period.from, r.period.timezone) : 'Earliest recorded usage'} to ${r.period.to ? date(r.period.to, r.period.timezone) : 'now'} (${r.period.timezone})`;
  byId('freshness').textContent = `Snapshot ${date(r.generatedAt)} | revision ${r.revision}`;
  const latest = r.tasks[0],
    failure = byId('failure');
  failure.classList.toggle('hidden', !latest || latest.status !== 'failed');
  failure.textContent =
    latest?.status === 'failed'
      ? `Latest turn: ${latest.displayOutcome.label.toLowerCase()}. Reason: ${latest.error || 'unspecified error'}. Observed usage has been retained.`
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
        `${r.statistics.completed} complete / ${r.statistics.interrupted} interrupted / ${r.statistics.usageExceeded} usage exceeded`,
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
    for (const task of r.tasks.slice(0, 5)) recent.append(taskView(task, true));
    if (!r.tasks.length)
      recent.append(
        el(
          'p',
          'Run Codex with the collector open, or use codex-report sync to import retained history.',
          'note',
        ),
      );
    content.append(recent);
  } else if (view === 'sessions') {
    const query = sessionQuery.trim().toLocaleLowerCase();
    const rows = r.sessions.filter((s) =>
      [s.id, s.name || '', date(s.started)].some((v) => v.toLocaleLowerCase().includes(query)),
    );
    const perPage = settingsState?.values.dashboard.sessionsPerPage || 20;
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    sessionPage = Math.min(sessionPage, pages - 1);
    button('sessions-prev').disabled = sessionPage === 0;
    button('sessions-next').disabled = sessionPage >= pages - 1;
    byId('sessions-count').textContent =
      `${rows.length} sessions | Page ${sessionPage + 1} of ${pages}`;
    const p = panel(
      'Sessions',
      `${r.sessions.length} sessions and ${r.tasks.length} root turns in this selection. Open a session to see its turns and linked agents.`,
    );
    for (const session of rows.slice(sessionPage * perPage, (sessionPage + 1) * perPage))
      p.append(sessionView(session));
    if (!rows.length)
      p.append(
        el(
          'p',
          query
            ? 'No sessions match your search.'
            : 'No sessions in this period. Try Recorded lifetime or run sync.',
          'empty',
        ),
      );
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
    if (
      settingsState &&
      status.settingsRevision &&
      status.settingsRevision !== settingsState.revision &&
      view !== 'settings' &&
      !renameDialog.open
    ) {
      settingsState = /** @type {SettingsSnapshot} */ (await get('/api/settings'));
      applyTheme(settingsState.values.dashboard.theme);
    }
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
      if (view !== 'settings') render(r);
      else current = r;
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
/** @param {HTMLElement} parent @param {string} id @param {string} label @param {string} [value] @param {string} [type] */
function inputField(parent, id, label, value = '', type = 'text') {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  wrap.className = 'form-field';
  const control = document.createElement('input');
  control.id = id;
  control.type = type;
  control.value = value;
  control.autocomplete = 'off';
  wrap.htmlFor = id;
  wrap.append(control);
  parent.append(wrap);
  return control;
}
/** @param {HTMLElement} parent @param {string} id @param {string} label @param {string[][]} choices @param {string} value */
function selectField(parent, id, label, choices, value) {
  const wrap = document.createElement('label');
  wrap.className = 'form-field';
  wrap.textContent = label;
  wrap.htmlFor = id;
  const control = document.createElement('select');
  control.id = id;
  for (const [key, text] of choices) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = text;
    control.append(option);
  }
  control.value = value;
  wrap.append(control);
  parent.append(wrap);
  return control;
}
function feeVisibility() {
  const mode = select('billing-fee-mode').value;
  for (const id of ['billing-usd', 'billing-local', 'billing-fx', 'billing-currency']) {
    const node = input(id);
    const visible = id === 'billing-usd' ? mode === 'usd' : mode === 'local';
    node.disabled = !visible;
    node.parentElement?.classList.toggle('hidden', !visible);
  }
}
/** @param {string} label */
function fillBilling(label) {
  const a = settingsState?.values.accounts[label] || {};
  for (const [id, value] of [
    ['billing-day', a.billingDay],
    ['billing-time', a.billingTime],
    ['billing-zone', a.timezone],
    ['billing-usd', a.monthlyUsd],
    ['billing-currency', a.currency || 'INR'],
    ['billing-local', a.subscriptionAmount],
    ['billing-fx', a.localPerUsd],
  ])
    input(String(id)).value = value === undefined ? '' : String(value);
  select('billing-fee-mode').value =
    a.monthlyUsd !== undefined ? 'usd' : a.subscriptionAmount !== undefined ? 'local' : 'none';
  feeVisibility();
  billingLabel = label;
  billingDirty = false;
}
function settingsView() {
  if (!settingsState) return;
  const state = settingsState.values;
  settingsDraftRevision = settingsState.revision;
  settingsDirty = false;
  billingDirty = false;
  const content = byId('content');
  const form = document.createElement('form');
  form.id = 'settings-form';
  const appearance = panel(
    'Appearance & defaults',
    'Preferences are saved for this installation. Default page and filters are used when you reopen the dashboard.',
  );
  const fields = el('div', '', 'form-grid');
  selectField(
    fields,
    'settings-theme',
    'Theme',
    [
      ['dark', 'Dark'],
      ['light', 'Light'],
      ['system', 'System'],
    ],
    state.dashboard.theme,
  );
  selectField(
    fields,
    'settings-view',
    'Default page',
    [
      ['overview', 'Overview'],
      ['sessions', 'Sessions'],
      ['limits', 'Usage comparison'],
      ['health', 'Data health'],
    ],
    state.dashboard.defaultView,
  );
  selectField(
    fields,
    'settings-period',
    'Default period',
    [
      ['cycle', 'Billing cycle / month'],
      ['5h', 'Last five hours'],
      ['day', 'Today'],
      ['week', 'This week'],
      ['lifetime', 'Recorded lifetime'],
    ],
    state.dashboard.defaultPeriod,
  );
  const account = inputField(
    fields,
    'settings-account',
    'Default report account',
    state.reportAccount,
  );
  account.required = true;
  account.maxLength = 80;
  account.setAttribute('list', 'settings-accounts');
  const accounts = document.createElement('datalist');
  accounts.id = 'settings-accounts';
  for (const name of new Set([
    'all',
    'unattributed',
    ...Object.keys(state.accounts),
    ...Array.from(select('account').options).map((o) => o.value),
  ])) {
    const option = document.createElement('option');
    option.value = name;
    accounts.append(option);
  }
  fields.append(accounts);
  const model = inputField(
    fields,
    'settings-model',
    'Default model (blank = all)',
    state.dashboard.defaultModel,
  );
  model.maxLength = 240;
  selectField(
    fields,
    'settings-page-size',
    'Sessions per page',
    [
      ['10', '10'],
      ['20', '20'],
      ['50', '50'],
    ],
    String(state.dashboard.sessionsPerPage),
  );
  appearance.append(fields);
  const reporting = panel(
    'Reporting',
    'Changes apply to future receipts and report boundaries. Stored tokens and applied prices are not modified.',
  );
  const rf = el('div', '', 'form-grid');
  const zone = inputField(rf, 'settings-timezone', 'Reporting timezone', state.timezone);
  zone.required = true;
  zone.maxLength = 100;
  zone.placeholder = 'Asia/Kolkata';
  selectField(
    rf,
    'settings-display',
    'Terminal receipt detail',
    [
      ['compact', 'Compact'],
      ['detailed', 'Detailed'],
      ['quiet', 'Quiet (still collects)'],
    ],
    state.display,
  );
  reporting.append(rf);
  const billing = panel(
    'Billing & subscription comparison',
    'Configure each account label separately. Labels do not change ownership of recorded usage. Select that account in report filters to view its billing cycle.',
  );
  const bf = el('div', '', 'form-grid');
  const billAccount = inputField(
    bf,
    'billing-account',
    'Account label to configure',
    state.reportAccount === 'all' ? 'unattributed' : state.reportAccount,
  );
  billAccount.required = true;
  billAccount.maxLength = 80;
  billAccount.setAttribute('list', 'settings-accounts');
  const day = inputField(
    bf,
    'billing-day',
    'Monthly billing start day (blank = calendar month)',
    '',
    'number',
  );
  day.min = '1';
  day.max = '31';
  day.step = '1';
  inputField(bf, 'billing-time', 'Renewal time (blank = midnight)', '', 'time');
  const billingZone = inputField(
    bf,
    'billing-zone',
    'Account timezone (blank = reporting timezone)',
  );
  billingZone.maxLength = 100;
  selectField(
    bf,
    'billing-fee-mode',
    'Optional fee comparison',
    [
      ['none', 'Disabled'],
      ['usd', 'USD amount'],
      ['local', 'Local currency + conversion'],
    ],
    'none',
  );
  const usd = inputField(bf, 'billing-usd', 'Monthly fee in USD', '', 'number');
  usd.min = '0.000001';
  usd.step = 'any';
  const currency = inputField(bf, 'billing-currency', 'Currency code');
  currency.maxLength = 3;
  const local = inputField(bf, 'billing-local', 'Monthly fee in local currency', '', 'number');
  local.min = '0.000001';
  local.step = 'any';
  const fx = inputField(bf, 'billing-fx', 'Local currency units per 1 USD', '', 'number');
  fx.min = '0.000001';
  fx.step = 'any';
  billing.append(
    bf,
    el(
      'p',
      'Day 29-31 is clamped in shorter months without shifting the next renewal. This is a recurring day, not a filter excluding earlier history. Conversion rates are manual; no provider or currency API is contacted.',
      'note',
    ),
  );
  const actions = el('div', '', 'form-actions');
  const save = document.createElement('button');
  save.id = 'settings-save';
  save.type = 'submit';
  save.className = 'primary';
  save.textContent = 'Save settings';
  const reload = document.createElement('button');
  reload.id = 'settings-reload';
  reload.type = 'button';
  reload.className = 'secondary';
  reload.textContent = 'Reload / discard edits';
  actions.append(save, reload);
  const status = el('p', '', 'settings-message');
  status.id = 'settings-message';
  status.setAttribute('role', 'status');
  form.append(appearance, reporting, billing, actions, status);
  content.replaceChildren(form);
  fillBilling(billAccount.value);
  /** @param {Event} event */
  const mark = (event) => {
    settingsDirty = true;
    if (
      event.target instanceof HTMLElement &&
      event.target.id.startsWith('billing-') &&
      event.target.id !== 'billing-account'
    )
      billingDirty = true;
    status.textContent = 'Unsaved changes';
  };
  form.addEventListener('input', mark);
  form.addEventListener('change', mark);
  billAccount.addEventListener('change', () => {
    const label = billAccount.value.trim();
    if (
      billingDirty &&
      !window.confirm('Discard the unsaved billing fields for the previous account?')
    ) {
      billAccount.value = billingLabel;
      return;
    }
    fillBilling(label);
  });
  select('billing-fee-mode').addEventListener('change', feeVisibility);
  reload.addEventListener('click', () => {
    if (
      settingsSaving ||
      (settingsDirty && !window.confirm('Discard unsaved changes and reload settings?'))
    )
      return;
    void get('/api/settings')
      .then((value) => {
        settingsState = /** @type {SettingsSnapshot} */ (value);
        settingsView();
      })
      .catch((e) => {
        status.textContent = e instanceof Error ? e.message : String(e);
      });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (settingsSaving) return;
    /** @param {string} id */
    const text = (id) => input(id).value.trim() || null;
    /** @param {string} id */
    const numeric = (id) => (text(id) === null ? null : Number(text(id)));
    const mode = select('billing-fee-mode').value;
    const label = input('billing-account').value.trim();
    const changes = {
      dashboard: {
        theme: select('settings-theme').value,
        defaultView: select('settings-view').value,
        defaultPeriod: select('settings-period').value,
        defaultModel: input('settings-model').value.trim(),
        sessionsPerPage: Number(select('settings-page-size').value),
      },
      timezone: input('settings-timezone').value.trim(),
      reportAccount: input('settings-account').value.trim(),
      display: select('settings-display').value,
      accounts: {
        [label]: {
          billingDay: numeric('billing-day'),
          billingTime: text('billing-time'),
          timezone: text('billing-zone'),
          monthlyUsd: mode === 'usd' ? numeric('billing-usd') : null,
          currency: mode === 'local' ? (text('billing-currency') || '').toUpperCase() : null,
          subscriptionAmount: mode === 'local' ? numeric('billing-local') : null,
          localPerUsd: mode === 'local' ? numeric('billing-fx') : null,
        },
      },
    };
    if (
      (mode === 'usd' && !text('billing-usd')) ||
      (mode === 'local' &&
        (!text('billing-local') || !text('billing-fx') || !text('billing-currency')))
    ) {
      status.textContent = 'Complete the fee fields, or choose Disabled.';
      return;
    }
    settingsSaving = true;
    save.disabled = true;
    reload.disabled = true;
    // Freeze controls so edits made while the request is in flight cannot be silently lost.
    const controls = [...form.querySelectorAll('input,select')];
    const disabledBefore = controls.map((n) => n.hasAttribute('disabled'));
    controls.forEach((n) => n.setAttribute('disabled', ''));
    void saveSettings(changes, settingsDraftRevision)
      .then((saved) => {
        settingsDraftRevision = saved.revision;
        settingsDirty = false;
        billingDirty = false;
        status.textContent =
          saved.auditWarning ||
          'Saved. Theme and reporting settings apply now. Default page and filters apply when you reopen the dashboard.';
      })
      .catch((e) => {
        status.textContent = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        settingsSaving = false;
        save.disabled = false;
        reload.disabled = false;
        controls.forEach((n, i) => {
          if (!disabledBefore[i]) n.removeAttribute('disabled');
        });
      });
  });
}
/** @param {string} next */
async function navigate(next) {
  if (
    settingsSaving ||
    (next === 'settings' && view === next && document.getElementById('settings-form'))
  )
    return;
  if (
    view === 'settings' &&
    next !== view &&
    settingsDirty &&
    !window.confirm('Discard unsaved settings?')
  )
    return;
  settingsDirty = false;
  view = next;
  /** @type {Record<string, string>} */
  const names = {
    overview: 'Overview',
    sessions: 'Sessions',
    limits: 'Usage comparison',
    health: 'Data health',
    settings: 'Settings',
  };
  byId('title').textContent = names[view] || 'Overview';
  document.title = `${names[view] || 'Overview'} - Codex Report`;
  for (const b of document.querySelectorAll('button[data-view]')) {
    const active = b.getAttribute('data-view') === view;
    b.classList.toggle('selected', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  byId('filters').classList.toggle('hidden', view === 'settings');
  byId('session-controls').classList.toggle('hidden', view !== 'sessions');
  byId('period-info').classList.toggle('hidden', view === 'settings');
  byId('failure').classList.add('hidden');
  if (view === 'settings') {
    byId('content').replaceChildren(el('p', 'Loading settings...', 'empty'));
    try {
      settingsState = /** @type {SettingsSnapshot} */ (await get('/api/settings'));
      if (view === 'settings') settingsView();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    }
  } else if (current) render(current);
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
  settingsState = /** @type {SettingsSnapshot} */ (await get('/api/settings'));
  applyTheme(settingsState.values.dashboard.theme);
  setOption('period', settingsState.values.dashboard.defaultPeriod);
  setOption(
    'account',
    settingsState.values.reportAccount,
    settingsState.values.reportAccount === 'all' ? 'All recorded accounts' : undefined,
  );
  setOption(
    'model',
    settingsState.values.dashboard.defaultModel,
    settingsState.values.dashboard.defaultModel || 'All models',
  );
  for (const node of document.querySelectorAll('button[data-view]'))
    node.addEventListener('click', () => {
      void navigate(node.getAttribute('data-view') || 'overview');
    });
  await navigate(settingsState.values.dashboard.defaultView);
  input('session-search').addEventListener('input', () => {
    sessionQuery = input('session-search').value;
    sessionPage = 0;
    if (current) render(current);
  });
  button('sessions-prev').addEventListener('click', () => {
    sessionPage = Math.max(0, sessionPage - 1);
    if (current) render(current);
  });
  button('sessions-next').addEventListener('click', () => {
    sessionPage++;
    if (current) render(current);
  });
  button('rename-cancel').addEventListener('click', () => {
    if (!renameSaving) renameDialog.close();
  });
  renameDialog.addEventListener('cancel', (e) => {
    if (renameSaving) e.preventDefault();
  });
  byId('rename-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (renameSaving) return;
    renameSaving = true;
    button('rename-save').disabled = true;
    void saveSettings(
      { sessionNames: { [renameThread]: input('session-name').value.trim() || null } },
      renameRevision,
    )
      .then(async () => {
        renameDialog.close();
        await refresh(true);
      })
      .catch((e) => {
        byId('rename-error').textContent = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        renameSaving = false;
        button('rename-save').disabled = false;
      });
  });
  window.addEventListener('beforeunload', (e) => {
    if (settingsDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  for (const id of ['period', 'account', 'model'])
    select(id).addEventListener('change', () => {
      sessionPage = 0;
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
