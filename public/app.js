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
let activityMode = 'days';
let activityTableOpen = false;
let diagnosticsOpen = false;
let refreshRequested = false;
let settingsSection = 'appearance';
let navigationSequence = 0;
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
/** @param {number|undefined} size */
function applyFontSize(size) {
  // An allowlisted attribute selects the root percentage in CSS: no inline style,
  // page transform or browser-zoom override. Every text role is rooted in rem.
  const value =
    size !== undefined && Number.isInteger(size) && size >= 14 && size <= 24 ? size : 17;
  document.documentElement.dataset.fontSize = String(value);
}
/** @param {DashboardPreferences} preferences */
function applyAppearance(preferences) {
  applyTheme(preferences.theme);
  applyFontSize(preferences.fontSize);
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
  applyAppearance(saved.values.dashboard);
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
/** @param {string} url @param {RequestInit} [options] */
async function get(url, options) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Local request failed');
  return value;
}
/** @param {string} label @param {string} value @param {string} sub @param {boolean} [money] */
function card(label, value, sub, money = false) {
  const node = el('div', '', 'card');
  node.append(
    el('div', label, 'label'),
    el('div', value, money ? 'value money' : 'value'),
    el('div', sub, 'sub'),
  );
  return node;
}
/** @param {string} title @param {string} description */
function panel(title, description) {
  const node = el('section', '', 'panel');
  node.append(el('h2', title), el('p', description, 'description'));
  return node;
}
/** @param {string} label @param {string} value */
function datum(label, value) {
  const node = el('div', '', 'datum');
  node.append(el('div', label, 'label'), el('div', value, 'value'));
  return node;
}
/** @param {import('../src/reports').Totals} totals */
function estimate(totals) {
  if (!totals.requests) return 'No usage recorded';
  return totals.pricePico === null ? 'Unpriced' : `~${totals.apiEquivalent}`;
}
/** @param {string} title @param {string} description */
function emptyState(title, description) {
  const node = el('div', '', 'empty');
  node.append(el('h2', title), el('p', description));
  return node;
}
/** @param {string} label @param {string} target */
function viewLink(label, target) {
  const node = el('button', label, 'secondary section-action');
  node.setAttribute('type', 'button');
  node.addEventListener('click', () => {
    void navigate(target);
  });
  return node;
}
/** @param {string} label @param {number} value @param {number} maximum @param {string} text */
function bar(label, value, maximum, text) {
  const row = el('div', '', 'bar-row');
  const top = el('div', '', 'bar-top');
  top.append(el('span', label), el('span', text));
  const progress = document.createElement('progress');
  progress.max = maximum || 1;
  progress.value = value;
  progress.setAttribute('aria-label', label);
  row.append(top, progress);
  return row;
}
/** @param {string} caption @param {string[]} headings @param {(string|HTMLElement)[][]} rows */
function dataTable(caption, headings, rows) {
  const wrap = el('div', '', 'table-scroll');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', caption);
  wrap.dataset.focusKey = `table-${caption}`;
  const table = document.createElement('table');
  const cap = el('caption', caption, 'sr-only');
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of headings) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    header.append(th);
  }
  head.append(header);
  const body = document.createElement('tbody');
  for (const values of rows) {
    const tr = document.createElement('tr');
    for (const item of values) {
      const td = document.createElement('td');
      if (typeof item === 'string') td.textContent = item;
      else td.append(item);
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(cap, head, body);
  wrap.append(table);
  return wrap;
}
/** @param {string} name @param {Record<string,string|number>} [attributes] */
function svgElement(name, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
/** @param {number} ms */
function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
/** @param {Session} session */
function sessionTitle(session) {
  return session.name || `Session ${date(session.started)}`;
}
/** @param {Session} session */
function sessionView(session) {
  const tasks = session.turnIds
    .map((id) => taskIndex.get(`${session.id}:${id}`))
    .filter((task) => task !== undefined);
  const details = document.createElement('details');
  details.className = 'session';
  details.dataset.session = session.id;
  details.open = expandedSessions.get(session.id) ?? false;
  details.addEventListener('toggle', () => {
    if (details.isConnected) expandedSessions.set(session.id, details.open);
  });
  const summary = el('summary');
  summary.dataset.focusKey = `session-${session.id}`;
  const identity = el('div', '', 'session-identity');
  identity.append(
    el('span', sessionTitle(session), 'session-title'),
    el(
      'span',
      session.name ? `Started ${date(session.started)}` : `Session ID ${session.id.slice(0, 8)}`,
      'task-date',
    ),
  );
  const counts = el('div', '', 'session-counts');
  counts.append(el('strong', `${tasks.length} turn${tasks.length === 1 ? '' : 's'}`));
  const outcome = session.outcomes;
  const state = outcome.usageExceeded
    ? `${outcome.usageExceeded} usage exceeded`
    : outcome.failed
      ? `${outcome.failed} failed`
      : outcome.interrupted
        ? `${outcome.interrupted} interrupted`
        : outcome.other
          ? 'Active / unknown'
          : 'Completed';
  counts.append(el('span', state, 'note'));
  const cost = el('div', '', 'session-cost');
  cost.append(
    el(
      'span',
      estimate(session.totals),
      session.totals.pricePico === null ? 'num no-estimate' : 'num',
    ),
    el(
      'span',
      session.totals.unpricedRequests
        ? `${session.totals.unpricedRequests} requests unpriced`
        : 'API estimate',
      'note',
    ),
  );
  summary.append(identity, counts, cost);
  const body = el('div', '', 'session-body');
  const meta = el('div', '', 'session-meta');
  const rename = el('button', session.name ? 'Rename session' : 'Name session', 'secondary');
  rename.setAttribute('type', 'button');
  rename.dataset.focusKey = `rename-${session.id}`;
  rename.addEventListener('click', () => {
    void renameSession(session);
  });
  meta.append(el('span', `Last activity ${date(session.lastActivity)}`, 'note'), rename);
  body.append(meta, el('p', 'These turns and their totals follow your current filters.', 'note'));
  const outcomes = el('div', '', 'outcome-list');
  for (const [count, label] of [
    [outcome.completed, 'completed'],
    [outcome.interrupted, 'interrupted'],
    [outcome.usageExceeded, 'usage exceeded'],
    [outcome.failed, 'failed'],
    [outcome.other, 'active / unknown'],
  ]) {
    if (count) outcomes.append(el('span', `${count} ${label}`));
  }
  const limit = shownTurns.get(session.id) ?? 50;
  for (const task of tasks.slice(-limit)) body.append(taskView(task));
  if (tasks.length > limit) {
    const more = el(
      'button',
      `Show ${Math.min(50, tasks.length - limit)} earlier turns`,
      'secondary',
    );
    more.setAttribute('type', 'button');
    more.dataset.focusKey = `more-${session.id}`;
    more.addEventListener('click', () => {
      shownTurns.set(session.id, limit + 50);
      expandedSessions.set(session.id, true);
      if (current) render(current);
    });
    body.append(more);
  }
  body.append(outcomes);
  const technical = document.createElement('details');
  technical.className = 'technical';
  technical.append(el('summary', 'Full session ID'), el('code', session.id));
  body.append(technical);
  details.append(summary, body);
  return details;
}
/** @param {Task} task @param {boolean} [showSession] */
function taskView(task, showSession = false) {
  const details = document.createElement('details');
  details.className = 'task';
  const key = `${task.thread}:${task.turn}`;
  details.dataset.task = key;
  details.open = expanded.has(key);
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) expanded.add(key);
    else expanded.delete(key);
  });
  const summary = el('summary');
  summary.dataset.focusKey = `turn-${key}`;
  const identity = el('div');
  identity.append(
    el('span', `Turn ${task.number ?? task.turn.slice(0, 8)}`, 'task-title'),
    el(
      'span',
      `${date(task.started)}${task.durationMs === null ? '' : ` / ${duration(task.durationMs)}`}`,
      'task-date',
    ),
  );
  if (showSession)
    identity.append(
      el(
        'span',
        current?.sessions.find((s) => s.id === task.thread)?.name ||
          `Session ${task.thread.slice(0, 8)}`,
        'task-date',
      ),
    );
  summary.append(
    identity,
    el('span', task.displayOutcome.label, `badge ${task.displayOutcome.code}`),
    el('span', estimate(task.totals), 'num'),
  );
  const body = el('div', '', 'details');
  const grid = el('div', '', 'detail-grid');
  for (const [label, value] of [
    ['Input tokens', precise(task.totals.input)],
    ['Cached input', precise(task.totals.cached)],
    ['Output tokens', precise(task.totals.output)],
    ['Reasoning within output', precise(task.totals.reasoning)],
    ['Model requests', precise(task.totals.requests)],
    ['Linked agents', `${task.workers} workers / ${task.reviewers} reviews`],
  ])
    grid.append(datum(label, value));
  body.append(
    grid,
    el(
      'p',
      task.models.length
        ? `Models: ${task.models.join(', ')}`
        : 'Model information was not recorded.',
      'note',
    ),
  );
  if (task.durationMs !== null)
    body.append(el('p', 'Elapsed time includes tool activity and approval waits.', 'note'));
  if (task.collectionPending)
    body.append(el('p', 'Collection is catching up for this turn.', 'notice warning'));
  if (task.error) body.append(el('p', `Recorded reason: ${task.error}`, 'notice warning'));
  if (task.totals.unpricedRequests)
    body.append(
      el(
        'p',
        'Not priced: ' +
          Object.entries(task.unpriced)
            .map(([model, count]) => `${count} ${model} request${count === 1 ? '' : 's'}`)
            .join('; ') +
          '. The estimate includes priced requests only.',
        'notice',
      ),
    );
  const technical = document.createElement('details');
  technical.className = 'technical';
  technical.append(
    el('summary', 'Request identifiers'),
    el('code', `${task.thread} / ${task.turn}`),
  );
  body.append(technical);
  details.append(summary, body);
  return details;
}
/** @param {CodexReport} report */
function modelTable(report) {
  return dataTable(
    'Model usage in the selected period',
    ['Model', 'Requests', 'Processed tokens', 'API estimate'],
    report.models.map((model) => {
      const name = el('div');
      name.append(el('span', model.name, 'model-name'));
      if (model.totals.unpricedRequests)
        name.append(
          el('span', `${precise(model.totals.unpricedRequests)} requests unpriced`, 'model-meta'),
        );
      return [
        name,
        precise(model.totals.requests),
        precise(model.totals.processed),
        estimate(model.totals),
      ];
    }),
  );
}
/** @param {CodexReport} report */
function activityView(report) {
  const section = el('section', '', 'panel');
  const heading = el('div', '', 'list-heading');
  const identity = el('div');
  identity.append(
    el('h2', 'Usage breakdown'),
    el('p', 'See where your recorded tokens went.', 'description'),
  );
  const tabs = el('div', '', 'section-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Usage breakdown');
  for (const [code, label] of [
    ['days', 'By day'],
    ['models', 'By model'],
  ]) {
    const tab = el('button', label);
    tab.setAttribute('type', 'button');
    tab.setAttribute('aria-pressed', String(activityMode === code));
    tab.dataset.focusKey = `activity-${code}`;
    tab.addEventListener('click', () => {
      activityMode = code;
      if (current) render(current);
    });
    tabs.append(tab);
  }
  heading.append(identity, tabs);
  section.append(heading);
  if (activityMode === 'models') {
    if (report.models.length) section.append(modelTable(report));
    else
      section.append(
        emptyState('No model records yet', 'Model details appear after usage is collected.'),
      );
    return section;
  }
  const days = report.days.slice(-7);
  if (!days.length) {
    section.append(
      emptyState(
        'No activity for these filters',
        'Try Recorded lifetime, or run codex-report sync to import retained sessions.',
      ),
    );
    return section;
  }
  const legend = el('div', '', 'chart-legend');
  for (const [label, kind] of [
    ['Cached input', 'cached'],
    ['Other input', 'fresh'],
    ['Output', 'output'],
  ]) {
    const item = el('span', label);
    const swatch = el('i', '', `swatch ${kind}`);
    swatch.setAttribute('aria-hidden', 'true');
    item.prepend(swatch);
    legend.append(item);
  }
  section.append(legend);
  const maximum = Math.max(1, ...days.map((day) => day.totals.processed));
  for (const day of days) {
    const row = el('div', '', 'activity-row');
    const dateLabel = new Date(`${day.day}T12:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const graph = svgElement('svg', {
      viewBox: '0 0 1000 20',
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': `${day.day}: ${precise(day.totals.cached)} cached input, ${precise(day.totals.input - day.totals.cached)} other input, ${precise(day.totals.output)} output tokens`,
      class: 'activity-track',
    });
    let left = 0;
    for (const [amount, kind] of [
      [day.totals.cached, 'cached'],
      [day.totals.input - day.totals.cached, 'fresh'],
      [day.totals.output, 'output'],
    ]) {
      const width = (Number(amount) / maximum) * 1000;
      graph.append(svgElement('rect', { x: left, y: 0, width, height: 20, class: String(kind) }));
      left += width;
    }
    row.append(
      el('span', dateLabel),
      graph,
      el('span', `${number(day.totals.processed)} tokens`, 'activity-total'),
    );
    section.append(row);
  }
  section.append(
    el(
      'p',
      `${days.length < report.days.length ? `Latest ${days.length} of ${report.days.length}` : days.length} recorded days. Gaps in history are not treated as zero usage.`,
      'chart-note',
    ),
  );
  const details = document.createElement('details');
  details.className = 'chart-data';
  details.open = activityTableOpen;
  details.addEventListener('toggle', () => {
    if (details.isConnected) activityTableOpen = details.open;
  });
  const toggle = el('summary', 'View exact values for all recorded days');
  toggle.dataset.focusKey = 'chart-data';
  details.append(
    toggle,
    dataTable(
      'Exact daily token usage',
      ['Day', 'Cached input', 'Other input', 'Output', 'Total'],
      report.days.map((day) => [
        day.day,
        precise(day.totals.cached),
        precise(day.totals.input - day.totals.cached),
        precise(day.totals.output),
        precise(day.totals.processed),
      ]),
    ),
  );
  section.append(details);
  return section;
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string,unknown>} */ (value)
    : {};
}
/** @param {CodexReport} report */
function healthView(report) {
  const collection = record(report.health.collection);
  const attention = Boolean(
    collection.pending || collection.partial || collection.failed || collection.missing,
  );
  const section = panel('Collection status', 'The latest scan of your local session records.');
  const state = el('div', '', `health-state${attention ? ' attention' : ''}`);
  const copy = el('div');
  copy.append(
    el(
      'strong',
      !Object.keys(collection).length
        ? 'Waiting for the first scan'
        : attention
          ? 'Some records need attention'
          : 'Latest scan completed',
    ),
    el(
      'p',
      typeof collection.at === 'string'
        ? `Last scan ${date(collection.at)}`
        : 'Start the collector or run codex-report sync.',
      'note',
    ),
  );
  state.append(copy);
  section.append(state);
  const stats = el('div', '', 'health-stats');
  for (const [key, label] of [
    ['files', 'Files checked'],
    ['added', 'New requests'],
    ['partial', 'Partial files'],
    ['failed', 'Failed files'],
    ['missing', 'Missing sources'],
  ])
    stats.append(
      datum(
        label,
        typeof collection[key] === 'number'
          ? precise(/** @type {number} */ (collection[key]))
          : 'Not recorded',
      ),
    );
  section.append(stats);
  const pricing = panel(
    'Pricing coverage',
    'Missing rates affect dollar estimates, not your recorded token counts.',
  );
  const list = el('div', '', 'workload-list');
  list.append(
    datum('Priced requests', precise(report.totals.pricedRequests)),
    datum('Unpriced requests', precise(report.totals.unpricedRequests)),
  );
  pricing.append(list);
  const missing = report.models.filter((model) => model.totals.unpricedRequests);
  for (const model of missing) {
    const row = el('div', '', 'issue-row');
    row.append(
      el('span', model.name),
      el('span', `${precise(model.totals.unpricedRequests)} requests`, 'note'),
    );
    pricing.append(row);
  }
  if (!missing.length)
    pricing.append(
      el(
        'p',
        report.totals.requests
          ? 'All requests in this selection have a recorded price.'
          : 'No requests in this selection yet.',
        'note',
      ),
    );
  const grid = el('div', '', 'grid-two');
  grid.append(section, pricing);
  const issues = panel(
    'Recorded issues',
    'Ledger diagnostics are separate from quota failures in individual sessions.',
  );
  const observations = Array.isArray(report.health.issues) ? report.health.issues.map(record) : [];
  for (const observation of observations) {
    const row = el('div', '', 'issue-row');
    const name = el('div');
    name.append(
      el('span', String(observation.code || 'Unclassified')),
      el(
        'span',
        typeof observation.latest === 'string' ? date(observation.latest) : 'Time not recorded',
        'task-date',
      ),
    );
    row.append(name, el('span', `${String(observation.observations ?? '?')} observations`, 'note'));
    issues.append(row);
  }
  if (!observations.length) issues.append(el('p', 'No issues recorded in the ledger.', 'note'));
  const technical = document.createElement('details');
  technical.className = 'diagnostics';
  technical.open = diagnosticsOpen;
  technical.addEventListener('toggle', () => {
    if (technical.isConnected) diagnosticsOpen = technical.open;
  });
  const toggle = el('summary', 'Technical diagnostics and source details');
  toggle.dataset.focusKey = 'diagnostics';
  technical.append(toggle, el('pre', JSON.stringify(report.health, null, 2)));
  const group = el('div', '', 'health-page');
  group.append(grid, issues, technical);
  return group;
}
/** @param {CodexReport} report */
function comparisonView(report) {
  const grid = el('div', '', 'comparison-grid');
  const snapshots = panel(
    'Provider quota snapshots',
    'Last observed in Codex records. These are not live account checks.',
  );
  for (const quota of report.quotas) {
    const item = el('div', '', 'quota');
    const minutes = Number(quota.minutes);
    const windowName =
      Number.isFinite(minutes) && minutes > 0
        ? minutes >= 1440 && minutes % 1440 === 0
          ? `${minutes / 1440}-day window`
          : `${minutes / 60}-hour window`
        : String(quota.window || 'Unknown window');
    const title = el('div');
    title.append(
      el('h3', windowName),
      el('p', `Limit: ${String(quota.limitId || 'Unknown')}`, 'note'),
    );
    const heading = el('div', '', 'quota-head');
    heading.append(
      title,
      el('span', typeof quota.used === 'number' ? `${quota.used}%` : 'Unknown', 'percent'),
    );
    item.append(heading);
    if (typeof quota.used === 'number')
      item.append(bar('Recorded allowance used', quota.used, 100, 'of window'));
    item.append(
      el('p', `Resets ${date(typeof quota.resets === 'string' ? quota.resets : null)}`),
      el('p', `Observed ${date(typeof quota.at === 'string' ? quota.at : null)}`),
    );
    if (quota.reached) item.append(el('p', String(quota.reached), 'notice warning'));
    snapshots.append(item);
  }
  if (!report.quotas.length)
    snapshots.append(
      emptyState(
        'No quota snapshot recorded',
        'Missing information does not mean your allowance is unused.',
      ),
    );
  const workload = panel(
    'Your recorded usage',
    'Local workload for the selected period, account, and model.',
  );
  const values = el('div', '', 'workload-list');
  values.append(
    datum('User turns', precise(report.statistics.tasks)),
    datum('Model requests', precise(report.totals.requests)),
    datum('Input + output tokens', precise(report.totals.processed)),
    datum('API-equivalent estimate', estimate(report.totals)),
    datum('Unpriced requests', precise(report.totals.unpricedRequests)),
  );
  if (report.statistics.subscriptionMultiple !== null)
    values.append(
      datum('Estimate / configured fee', `${report.statistics.subscriptionMultiple.toFixed(2)}x`),
    );
  workload.append(
    values,
    el(
      'p',
      'Last five hours is a local lookback. A quota snapshot has its own window and reset time. API estimates are not subscription charges.',
      'note',
    ),
  );
  grid.append(snapshots, workload);
  return grid;
}
/** @param {CodexReport} report */
function render(report) {
  current = report;
  taskIndex = new Map(report.tasks.map((task) => [`${task.thread}:${task.turn}`, task]));
  if (view === 'settings') return;
  const content = byId('content');
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusKey = active && content.contains(active) ? active.dataset.focusKey : undefined;
  content.replaceChildren();
  const period = byId('period-info');
  const scopeLabel =
    report.period.label === 'lifetime'
      ? 'Recorded lifetime'
      : report.period.label.charAt(0).toUpperCase() + report.period.label.slice(1);
  period.replaceChildren(
    el(
      'span',
      `${scopeLabel} / ${report.account === 'all' ? 'All recorded accounts' : report.account}`,
      'period-range',
    ),
    el(
      'span',
      `${report.period.from ? date(report.period.from, report.period.timezone) : 'Earliest recorded usage'} to ${report.period.to ? date(report.period.to, report.period.timezone) : 'now'} (${report.period.timezone})`,
    ),
  );
  byId('freshness').textContent = `Last updated ${date(report.generatedAt)}`;
  const failure = byId('failure');
  const latest = report.tasks[0];
  failure.classList.toggle('hidden', !latest || latest.status !== 'failed');
  failure.replaceChildren();
  if (latest?.status === 'failed')
    failure.append(
      el('strong', `Latest turn: ${latest.displayOutcome.label}`),
      el('p', 'Recorded usage is retained. Open the session for its breakdown and failure reason.'),
    );
  const totals = report.totals;
  if (view === 'overview') {
    const metrics = el('section', '', 'metric-strip');
    metrics.setAttribute('aria-label', 'Selected period totals');
    metrics.append(
      card(
        'API-equivalent estimate',
        estimate(totals),
        totals.unpricedRequests
          ? `${precise(totals.unpricedRequests)} requests still unpriced`
          : totals.requests
            ? 'All recorded requests priced'
            : 'No usage in this selection',
        true,
      ),
      card(
        'Input tokens',
        number(totals.input),
        totals.cachePercent === null
          ? 'No input recorded'
          : `${totals.cachePercent.toFixed(1)}% cached input`,
      ),
      card(
        'Output tokens',
        number(totals.output),
        `${number(totals.reasoning)} reasoning, included`,
      ),
      card(
        'User turns',
        precise(report.statistics.tasks),
        `${precise(report.sessions.length)} sessions / ${precise(totals.requests)} model requests`,
      ),
    );
    content.append(metrics, activityView(report));
    const recent = el('section', '', 'panel');
    const heading = el('div', '', 'list-heading');
    const title = el('div');
    title.append(
      el('h2', 'Recent sessions'),
      el('p', 'Open a conversation to explore its turns.', 'description'),
    );
    heading.append(title, viewLink('View all sessions', 'sessions'));
    recent.append(heading);
    for (const session of report.sessions.slice(0, 3)) recent.append(sessionView(session));
    if (!report.sessions.length)
      recent.append(
        emptyState(
          'No sessions in this selection',
          'Keep the collector running while using Codex, or import retained history with codex-report sync.',
        ),
      );
    content.append(recent);
  } else if (view === 'sessions') {
    const query = sessionQuery.trim().toLocaleLowerCase();
    const sessions = report.sessions.filter((session) =>
      [session.id, session.name || '', date(session.started)].some((text) =>
        text.toLocaleLowerCase().includes(query),
      ),
    );
    const pageSize = settingsState?.values.dashboard.sessionsPerPage || 20;
    const pages = Math.max(1, Math.ceil(sessions.length / pageSize));
    sessionPage = Math.min(sessionPage, pages - 1);
    button('sessions-prev').disabled = sessionPage === 0;
    button('sessions-next').disabled = sessionPage >= pages - 1;
    byId('sessions-count').textContent =
      `${sessions.length} sessions / Page ${sessionPage + 1} of ${pages}`;
    const list = panel(
      'Your conversations',
      `${report.tasks.length} root turns in the selected period. Session totals include linked agent work.`,
    );
    list.classList.add('sessions-panel');
    for (const session of sessions.slice(sessionPage * pageSize, (sessionPage + 1) * pageSize))
      list.append(sessionView(session));
    if (!sessions.length)
      list.append(
        emptyState(
          query ? 'No matching sessions' : 'No sessions in this period',
          query
            ? 'Try another name, date, or session ID.'
            : 'Choose Recorded lifetime or import retained history.',
        ),
      );
    content.append(list);
  } else if (view === 'limits') content.append(comparisonView(report));
  else content.append(healthView(report));
  if (focusKey) {
    const replacement = Array.from(content.querySelectorAll('[data-focus-key]')).find(
      (node) => node instanceof HTMLElement && node.dataset.focusKey === focusKey,
    );
    if (replacement instanceof HTMLElement) replacement.focus({ preventScroll: true });
  }
}
async function refresh(force = false) {
  if (loading) {
    if (force) refreshRequested = true;
    return;
  }
  // Background collection must not interrupt selecting/copying values or naming.
  if (!force && (renameDialog.open || window.getSelection()?.type === 'Range')) return;
  loading = true;
  if (force) {
    button('refresh').disabled = true;
    byId('content').setAttribute('aria-busy', 'true');
  }
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
      applyAppearance(settingsState.values.dashboard);
    }
    const account = select('account');
    for (const name of status.accounts) {
      if (!Array.from(account.options).some((option) => option.value === name)) {
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
      const report = /** @type {CodexReport} */ (await get('/api/report?' + params));
      if (
        select('period').value !== params.get('scope') ||
        select('account').value !== params.get('account') ||
        select('model').value !== (params.get('model') || '')
      ) {
        refreshRequested = true;
        return;
      }
      button('download').disabled = false;
      if (view !== 'settings') render(report);
      else current = report;
      revision = report.revision;
      lastRefresh = Date.now();
      for (const model of report.models) {
        const models = select('model');
        if (!Array.from(models.options).some((option) => option.value === model.name)) {
          const option = document.createElement('option');
          option.value = model.name;
          option.textContent = model.name;
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
    showError(
      (error instanceof Error ? error.message : String(error)) +
        ' Last loaded data is retained; use Refresh to retry.',
    );
  } finally {
    loading = false;
    button('refresh').disabled = false;
    byId('content').removeAttribute('aria-busy');
    if (refreshRequested) {
      refreshRequested = false;
      queueMicrotask(() => {
        void refresh(true);
      });
    }
  }
}
/** @param {string} label @param {string} className */
function buttonElement(label, className) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.className = className;
  return node;
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
  // Validate the first invalid field explicitly so hidden tabs cannot compete
  // for native focus. Browser constraints still provide the validation rules.
  form.noValidate = true;
  const appearance = panel(
    'Appearance',
    'Personalize the entire workspace. Preview changes here, then save them for this computer.',
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
  const typography = el('section', '', 'typography-settings');
  typography.setAttribute('aria-labelledby', 'typography-heading');
  const typographyHeading = el('h3', 'Text size');
  typographyHeading.id = 'typography-heading';
  const help = el(
    'p',
    'Scales every page, including navigation, charts, tables, settings, and dialogs. Preview is instant; Save settings makes it permanent.',
    'note',
  );
  help.id = 'font-size-help';
  const sizeControls = el('div', '', 'font-size-controls');
  const size = inputField(
    sizeControls,
    'settings-font-size',
    'Base size',
    String(state.dashboard.fontSize ?? 17),
    'number',
  );
  size.min = '14';
  size.max = '24';
  size.step = '1';
  size.required = true;
  size.setAttribute('aria-describedby', 'font-size-help font-size-units');
  const slider = inputField(
    sizeControls,
    'settings-font-slider',
    'Adjust text size',
    String(state.dashboard.fontSize ?? 17),
    'range',
  );
  slider.min = '14';
  slider.max = '24';
  slider.step = '1';
  slider.setAttribute('aria-describedby', 'font-size-help font-size-units');
  const reset = buttonElement('Reset to 17', 'secondary');
  reset.id = 'font-size-reset';
  reset.dataset.preferenceAction = 'reset-size';
  sizeControls.append(reset);
  const units = el(
    'p',
    '14-24 px reference size. Default: 17. Browser text preferences and zoom still apply.',
    'note',
  );
  units.id = 'font-size-units';
  const preview = el('div', '', 'type-preview');
  preview.setAttribute('aria-label', 'Typography preview');
  preview.append(
    el('span', 'Aa', 'type-specimen'),
    el('p', 'Your workspace, at your reading size.'),
    el('span', '0123456789', 'type-numerals'),
  );
  typography.append(typographyHeading, help, sizeControls, units, preview);
  appearance.append(fields, typography);
  const previewSize = () => {
    if (settingsSaving || !size.validity.valid || !size.value) return;
    slider.value = size.value;
    slider.setAttribute('aria-valuetext', `${size.value} pixels reference size`);
    applyFontSize(Number(size.value));
  };
  size.addEventListener('input', previewSize);
  slider.addEventListener('input', () => {
    if (settingsSaving) return;
    size.value = slider.value;
    previewSize();
  });
  reset.addEventListener('click', () => {
    if (settingsSaving) return;
    size.value = '17';
    size.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const reporting = panel(
    'Reporting defaults',
    'Set your initial filters, timezone, and terminal detail. Recorded usage and prices stay unchanged.',
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
    'Billing cycle',
    'Configure one account label at a time. Choose the same account in your report filters to use its cycle.',
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
  reload.textContent = 'Discard changes';
  actions.append(save, reload);
  const status = el('p', '', 'settings-message');
  status.id = 'settings-message';
  status.setAttribute('role', 'status');
  const savebar = el('div', '', 'settings-savebar');
  status.textContent = 'No unsaved changes.';
  savebar.append(status, actions);
  form.append(appearance, reporting, billing, savebar);
  content.replaceChildren(form);
  for (const id of ['settings-period', 'settings-account', 'settings-model']) {
    const field = byId(id).closest('label');
    if (field) rf.prepend(field);
  }
  settingsTabs(form, [
    ['appearance', 'Appearance', appearance],
    ['reporting', 'Reporting', reporting],
    ['billing', 'Billing', billing],
  ]);
  select('settings-theme').addEventListener('change', () => {
    if (!settingsSaving) applyTheme(select('settings-theme').value);
  });
  previewSize();
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
    status.dataset.state = 'dirty';
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
        applyAppearance(settingsState.values.dashboard);
        settingsView();
      })
      .catch((e) => {
        status.dataset.state = 'error';
        status.textContent = e instanceof Error ? e.message : String(e);
      });
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (settingsSaving) return;
    const firstInvalid = Array.from(form.querySelectorAll('input,select')).find(
      (control) =>
        (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) &&
        !control.disabled &&
        !control.checkValidity(),
    );
    if (firstInvalid instanceof HTMLInputElement || firstInvalid instanceof HTMLSelectElement) {
      firstInvalid.reportValidity();
      return;
    }
    /** @param {string} id */
    const text = (id) => input(id).value.trim() || null;
    /** @param {string} id */
    const numeric = (id) => (text(id) === null ? null : Number(text(id)));
    const mode = select('billing-fee-mode').value;
    const label = input('billing-account').value.trim();
    const changes = {
      dashboard: {
        theme: select('settings-theme').value,
        fontSize: Number(input('settings-font-size').value),
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
      button('settings-tab-billing').click();
      status.dataset.state = 'error';
      status.textContent = 'Complete the fee fields, or choose Disabled.';
      return;
    }
    settingsSaving = true;
    status.textContent = 'Saving settings...';
    status.dataset.state = 'saving';
    save.disabled = true;
    reload.disabled = true;
    // Freeze controls so edits made while the request is in flight cannot be silently lost.
    const controls = [...form.querySelectorAll('input,select,button[data-preference-action]')];
    const disabledBefore = controls.map((n) => n.hasAttribute('disabled'));
    controls.forEach((n) => n.setAttribute('disabled', ''));
    void saveSettings(changes, settingsDraftRevision)
      .then((saved) => {
        settingsDraftRevision = saved.revision;
        settingsDirty = false;
        billingDirty = false;
        status.dataset.state = saved.auditWarning ? 'error' : 'saved';
        status.textContent =
          saved.auditWarning ||
          'Saved. Appearance, text size, and reporting settings apply now. Default page and filters apply when you reopen the dashboard.';
      })
      .catch((e) => {
        status.dataset.state = 'error';
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
/** @param {HTMLFormElement} form @param {[string,string,HTMLElement][]} sections */
function settingsTabs(form, sections) {
  const tabs = el('div', '', 'settings-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Settings sections');
  /** @param {string} name @param {boolean} [focus] */
  const activate = (name, focus = false) => {
    settingsSection = name;
    for (const [key, , section] of sections) {
      const selected = key === name;
      section.hidden = !selected;
      const tab = button(`settings-tab-${key}`);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
  };
  for (const [key, title, section] of sections) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = title;
    tab.id = `settings-tab-${key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `settings-panel-${key}`);
    section.id = `settings-panel-${key}`;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('click', () => activate(key));
    tab.addEventListener('keydown', (event) => {
      const keys = sections.map(([id]) => id);
      const index = keys.indexOf(key);
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % keys.length;
      else if (event.key === 'ArrowLeft') next = (index + keys.length - 1) % keys.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = keys.length - 1;
      else return;
      event.preventDefault();
      activate(keys[next], true);
    });
    tabs.append(tab);
  }
  form.prepend(tabs);
  activate(sections.some(([key]) => key === settingsSection) ? settingsSection : 'appearance');
  // Native validation can find a field on a different tab. Reveal it before
  // the browser moves focus, instead of leaving an invalid hidden control.
  form.addEventListener(
    'invalid',
    (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      for (const [key, , section] of sections) if (section.contains(event.target)) activate(key);
    },
    true,
  );
}
/** @param {string} next */
async function navigate(next) {
  if (settingsSaving) return;
  if (next === 'settings' && view === next && document.getElementById('settings-form')) return;
  if (
    view === 'settings' &&
    next !== view &&
    settingsDirty &&
    !window.confirm('Discard unsaved settings?')
  )
    return;
  if (view === 'settings' && next !== view && settingsState)
    applyAppearance(settingsState.values.dashboard);
  settingsDirty = false;
  const sequence = ++navigationSequence;
  view = next;
  const names = {
    overview: 'Overview',
    sessions: 'Sessions',
    limits: 'Usage comparison',
    health: 'Data health',
    settings: 'Settings',
  };
  const subtitles = {
    overview: 'Understand your usage without losing the detail.',
    sessions: 'Your conversations, with every turn in context.',
    limits: 'Compare your recorded workload with observed quotas.',
    health: 'Know what was collected and what still needs attention.',
    settings: 'Choose how this workspace works for you.',
  };
  byId('title').textContent = names[/** @type {keyof typeof names} */ (view)] || names.overview;
  byId('subtitle').textContent =
    subtitles[/** @type {keyof typeof subtitles} */ (view)] || subtitles.overview;
  document.title = `${byId('title').textContent} - Codex Report`;
  for (const node of document.querySelectorAll('button[data-view]')) {
    const active = node.getAttribute('data-view') === view;
    node.classList.toggle('selected', active);
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }
  for (const id of ['filters', 'period-info', 'report-actions'])
    byId(id).classList.toggle('hidden', view === 'settings');
  byId('session-controls').classList.toggle('hidden', view !== 'sessions');
  byId('failure').classList.add('hidden');
  if (view === 'settings') {
    byId('content').replaceChildren(
      emptyState('Opening settings', 'Reading your saved preferences.'),
    );
    try {
      const snapshot = /** @type {SettingsSnapshot} */ (await get('/api/settings'));
      if (sequence === navigationSequence && view === 'settings') {
        settingsState = snapshot;
        applyAppearance(snapshot.values.dashboard);
        settingsView();
      }
    } catch (error) {
      if (sequence === navigationSequence)
        showError(error instanceof Error ? error.message : String(error));
    }
  } else if (current) render(current);
}
async function boot() {
  button('download').disabled = true;
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
  applyAppearance(settingsState.values.dashboard);
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
  renameDialog.addEventListener('cancel', (event) => {
    if (renameSaving) event.preventDefault();
  });
  renameDialog.addEventListener('close', () => {
    const trigger = Array.from(document.querySelectorAll('[data-focus-key]')).find(
      (node) => node instanceof HTMLElement && node.dataset.focusKey === `rename-${renameThread}`,
    );
    if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true });
  });
  byId('rename-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (renameSaving) return;
    renameSaving = true;
    button('rename-save').disabled = true;
    input('session-name').disabled = true;
    void saveSettings(
      { sessionNames: { [renameThread]: input('session-name').value.trim() || null } },
      renameRevision,
    )
      .then(async () => {
        renameDialog.close();
        await refresh(true);
      })
      .catch((error) => {
        byId('rename-error').textContent = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        renameSaving = false;
        button('rename-save').disabled = false;
        input('session-name').disabled = false;
      });
  });
  window.addEventListener('beforeunload', (event) => {
    if (settingsDirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  for (const id of ['period', 'account', 'model'])
    select(id).addEventListener('change', () => {
      sessionPage = 0;
      void refresh(true);
    });
  button('refresh').addEventListener('click', () => {
    void refresh(true);
  });
  button('download').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'codex-report.json';
    link.click();
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
  byId('connection').textContent = 'Collector unavailable';
  byId('connection').classList.add('offline');
  byId('content').replaceChildren(
    emptyState(
      'Reconnect to your workspace',
      'Run codex-report start --open and use the newly opened address. Your data has not changed.',
    ),
  );
  showError(error instanceof Error ? error.message : String(error));
});
