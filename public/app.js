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
let activityTableOpen = false;
let diagnosticsOpen = false;
let refreshRequested = false;
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
  summary.dataset.focusKey = `session-${session.id}`;
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
  const mark = el('span', '', 'session-icon');
  mark.append(icon('session'));
  summary.append(mark, identity, counts, cost);
  const body = el('div', '', 'session-body');
  const meta = el('div', '', 'session-meta');
  const rename = el('button', 'Name session', 'secondary');
  rename.setAttribute('type', 'button');
  rename.dataset.focusKey = `rename-${session.id}`;
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
    more.dataset.focusKey = `more-${session.id}`;
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
/** @param {import('../src/reports').Totals} t */
function estimate(t) {
  return `${t.pricePico !== null ? '~' : ''}${t.apiEquivalent}`;
}
/** @param {string} name @param {Record<string, string|number>} [attributes] */
function svgElement(name, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
/** @param {string} kind */
function icon(kind) {
  const svg = svgElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  const shapes = {
    session: 'M4 4h16v12H9l-5 4V4zM8 8h8M8 12h5',
    health: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zM8 12l3 3 5-6',
    chart: 'M4 20V10m8 10V4m8 16v-7M2 20h20',
  };
  svg.append(
    svgElement('path', { d: shapes[/** @type {keyof typeof shapes} */ (kind)] || shapes.chart }),
  );
  return svg;
}
/** @param {string} title @param {string} description */
function emptyState(title, description) {
  const state = el('div', '', 'empty');
  state.append(icon('chart'), el('h2', title), el('p', description));
  return state;
}
/** @param {string} title @param {string} target */
function viewLink(title, target) {
  const action = el('button', title, 'secondary section-action');
  action.setAttribute('type', 'button');
  action.addEventListener('click', () => {
    void navigate(target).then(() => byId('title').focus({ preventScroll: true }));
  });
  return action;
}
/** @param {string} label @param {number} value @param {number} maximum @param {string} text */
function bar(label, value, maximum, text) {
  const row = el('div', '', 'bar-row');
  const top = el('div', '', 'bar-top');
  top.append(el('span', label), el('span', text));
  const p = document.createElement('progress');
  p.max = maximum || 1;
  p.value = value;
  p.setAttribute('aria-label', label);
  row.append(top, p);
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
  const cap = document.createElement('caption');
  cap.className = 'sr-only';
  cap.textContent = caption;
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
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const item of row) {
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
/** @param {CodexReport} r */
function activityView(r) {
  const timeline = panel(
    'Recorded activity',
    'Cached input, other input, and output across the selected period.',
  );
  const days = r.days.slice(-14);
  if (!days.length) {
    timeline.append(
      emptyState(
        'No activity in this period',
        'Choose another reporting period, or run codex-report sync to import retained history.',
      ),
    );
    return timeline;
  }
  const wrap = el('div', '', 'chart-wrap');
  const legend = el('div', '', 'chart-legend');
  for (const [label, className] of [
    ['Cached input', 'cached'],
    ['Other input', 'fresh'],
    ['Output', 'output'],
  ]) {
    const item = el('span', label);
    const swatch = el('i', '', `swatch ${className}`);
    swatch.setAttribute('aria-hidden', 'true');
    item.prepend(swatch);
    legend.append(item);
  }
  const narrow = window.innerWidth <= 700;
  const contentWidth = byId('content').clientWidth;
  const sideBySide = window.innerWidth > 980;
  const gap = window.innerWidth > 1180 ? 24 : 18;
  const ratio = window.innerWidth > 1180 ? 1.65 : 1.3;
  const minimumRight = window.innerWidth > 1180 ? 280 : 260;
  const panelWidth = sideBySide
    ? Math.min(((contentWidth - gap) * ratio) / (1 + ratio), contentWidth - gap - minimumRight)
    : contentWidth;
  const width = Math.max(220, panelWidth - (narrow ? 32 : 48));
  const height = narrow ? 234 : 264,
    left = 55,
    bottom = height - 40,
    top = 16;
  const plotWidth = width - left - 10;
  const maximum = Math.max(1, ...days.map((d) => d.totals.processed));
  const chart = svgElement('svg', {
    class: 'activity-chart',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-labelledby': 'activity-title activity-description',
    'data-days': days.length,
  });
  const title = svgElement('title', { id: 'activity-title' });
  title.textContent = 'Token usage by recorded day';
  const description = svgElement('desc', { id: 'activity-description' });
  description.textContent = `${days.length} recorded days. Exact token quantities are available in the data table below. Days without a record are not interpolated.`;
  chart.append(title, description);
  for (let tick = 0; tick <= 4; tick++) {
    const y = bottom - (tick / 4) * (bottom - top);
    chart.append(svgElement('line', { x1: left, y1: y, x2: width - 10, y2: y, class: 'gridline' }));
    const label = svgElement('text', { x: left - 12, y: y + 4, 'text-anchor': 'end' });
    label.textContent = number((maximum * tick) / 4);
    chart.append(label);
  }
  days.forEach((day, i) => {
    const group = svgElement('g', { 'data-day': day.day });
    const barWidth = Math.min(42, (plotWidth / days.length) * 0.56);
    const x = left + (plotWidth * (i + 0.5)) / days.length - barWidth / 2;
    let y = bottom;
    for (const [className, count] of /** @type {[string,number][]} */ ([
      ['cached', day.totals.cached],
      ['fresh', day.totals.input - day.totals.cached],
      ['output', day.totals.output],
    ])) {
      const h = (count / maximum) * (bottom - top);
      y -= h;
      const rect = svgElement('rect', { x, y, width: barWidth, height: h, class: className });
      const tip = svgElement('title');
      tip.textContent = `${day.day}: ${className === 'fresh' ? 'Other input' : className === 'cached' ? 'Cached input' : 'Output'} ${precise(count)}`;
      rect.append(tip);
      group.append(rect);
    }
    // Label selected categories, while preserving every exact date in the table.
    if (
      i === 0 ||
      i === days.length - 1 ||
      i % Math.max(1, Math.ceil(days.length / (width < 420 ? 3 : 5))) === 0
    ) {
      const label = svgElement('text', {
        x: x + barWidth / 2,
        y: bottom + 27,
        'text-anchor': 'middle',
      });
      label.textContent = new Date(`${day.day}T12:00:00Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
      group.append(label);
    }
    chart.append(group);
  });
  const details = document.createElement('details');
  details.className = 'chart-data';
  details.open = activityTableOpen;
  details.addEventListener('toggle', () => {
    if (details.isConnected) activityTableOpen = details.open;
  });
  const toggle = el('summary', 'View exact values');
  toggle.dataset.focusKey = 'chart-data';
  details.append(toggle);
  details.append(
    dataTable(
      'Exact token usage for the displayed days',
      ['Day', 'Cached input', 'Other input', 'Output', 'Total'],
      days.map((d) => [
        d.day,
        precise(d.totals.cached),
        precise(d.totals.input - d.totals.cached),
        precise(d.totals.output),
        precise(d.totals.processed),
      ]),
    ),
  );
  wrap.append(
    legend,
    chart,
    el(
      'p',
      `${days.length < r.days.length ? `Latest ${days.length} of ${r.days.length}` : days.length} recorded day${days.length === 1 ? '' : 's'}. Equal spacing represents recorded days, not continuous time.`,
      'chart-note',
    ),
    details,
  );
  timeline.append(wrap);
  return timeline;
}
/** @param {CodexReport} r */
function modelView(r) {
  const p = panel(
    'Models in use',
    'Recorded requests, with estimated cost kept separate from unpriced work.',
  );
  if (!r.models.length) {
    p.append(
      emptyState('No model records', 'Model details appear after recorded requests are collected.'),
    );
    return p;
  }
  p.append(
    dataTable(
      'Model usage in the selected period',
      ['Model / requests', 'Tokens', 'API equiv.'],
      r.models.map((m) => {
        const name = el('div');
        name.append(
          el('span', m.name, 'model-name'),
          el(
            'span',
            `${precise(m.totals.requests)} requests${m.totals.unpricedRequests ? ` / ${precise(m.totals.unpricedRequests)} unpriced` : ''}`,
            'model-meta',
          ),
        );
        const quantity = el('div', number(m.totals.processed));
        const progress = document.createElement('progress');
        progress.className = 'model-track';
        progress.max = r.totals.processed || 1;
        progress.value = m.totals.processed;
        progress.setAttribute(
          'aria-label',
          `${m.name}: ${precise(m.totals.processed)} of ${precise(r.totals.processed)} processed tokens`,
        );
        quantity.append(progress);
        const price = el('div', estimate(m.totals));
        if (m.totals.pricePico !== null && m.totals.unpricedRequests)
          price.append(el('span', 'Partial estimate', 'model-meta'));
        return [name, quantity, price];
      }),
    ),
  );
  p.append(
    el(
      'p',
      'Reasoning is included in output. Token counts are not unique words or subscription credits.',
      'chart-note',
    ),
  );
  return p;
}
/** @param {Task} task @param {boolean} [showSession] */
function taskView(task, showSession = false) {
  const details = document.createElement('details');
  details.className = 'task';
  const key = task.thread + ':' + task.turn;
  details.dataset.task = key;
  details.open = expanded.has(key);
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) expanded.add(key);
    else expanded.delete(key);
  });
  const summary = el('summary');
  summary.dataset.focusKey = `turn-${key}`;
  const title = el('div');
  title.append(
    el('span', `Turn ${task.number ?? task.turn.slice(0, 8)}`, 'task-title'),
    el('span', date(task.started), 'task-date'),
  );
  if (showSession) {
    const session = current?.sessions.find((s) => s.id === task.thread);
    title.append(el('span', session?.name || `Session ${task.thread.slice(0, 8)}`, 'task-date'));
  }
  summary.append(
    title,
    el('span', task.displayOutcome.label, `badge ${task.displayOutcome.code}`),
    el(
      'span',
      `${estimate(task.totals)}${task.totals.pricePico !== null && task.totals.unpricedRequests ? ' (partial)' : ''}`,
      'num',
    ),
  );
  const body = el('div', '', 'details');
  const grid = el('div', '', 'detail-grid');
  for (const [label, value] of [
    ['Input tokens', precise(task.totals.input)],
    ['Cached input', precise(task.totals.cached)],
    ['Output tokens', precise(task.totals.output)],
    ['Reasoning (included in output)', precise(task.totals.reasoning)],
    ['Model requests', precise(task.totals.requests)],
    ['Child threads', `${task.workers} workers / ${task.reviewers} reviews`],
  ])
    grid.append(datum(label, value));
  body.append(
    grid,
    el(
      'p',
      task.models.length
        ? `Models: ${task.models.join(' + ')}`
        : 'No model recorded for this turn.',
      'note',
    ),
  );
  if (task.durationMs !== null)
    body.append(
      el('p', `Elapsed ${duration(task.durationMs)}. Includes tools and approval waits.`, 'note'),
    );
  body.append(el('code', `${task.thread} / ${task.turn}`));
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
/** @param {number} ms */
function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}
/** @param {CodexReport} r */
function healthView(r) {
  const c = record(r.health.collection);
  const count = (/** @type {string} */ key) =>
    typeof c[key] === 'number' ? precise(/** @type {number} */ (c[key])) : 'Not recorded';
  const attention = Boolean(c.pending || c.partial || c.failed || c.missing);
  const collection = panel(
    'Collection',
    'The latest local scan. This is independent of price coverage.',
  );
  const state = el('div', '', `health-state${attention ? ' attention' : ''}`);
  const copy = el('div');
  copy.append(
    el(
      'strong',
      !Object.keys(c).length
        ? 'Awaiting a scan'
        : attention
          ? 'Needs attention'
          : 'Latest scan complete',
    ),
    el(
      'p',
      typeof c.at === 'string'
        ? `Recorded ${date(c.at)}`
        : 'Collection activity has not been recorded yet.',
      'note',
    ),
  );
  state.append(icon('health'), copy);
  const numbers = el('div', '', 'health-stats');
  for (const [key, label] of [
    ['files', 'Files considered'],
    ['added', 'New requests'],
    ['partial', 'Partial files'],
    ['failed', 'Failed files'],
    ['missing', 'Missing roots'],
  ])
    numbers.append(datum(label, count(key)));
  collection.append(state, numbers);
  const sources = Array.isArray(r.health.sources) ? r.health.sources.map(record) : [];
  const sourceSection = el('section', '', 'health-detail');
  sourceSection.append(el('h3', 'Source status'));
  if (sources.length)
    sourceSection.append(
      dataTable(
        'Source collection status',
        ['State', 'Files'],
        sources.map((s) => [
          String(s.health || 'Unknown'),
          typeof s.files === 'number' ? precise(s.files) : 'Not recorded',
        ]),
      ),
    );
  else
    sourceSection.append(
      el(
        'p',
        'No source status recorded. Run codex-report sync to reconcile retained history.',
        'note',
      ),
    );
  collection.append(sourceSection);
  const integrity = panel(
    'Coverage & integrity',
    'Unknown prices are not collection failures. The underlying records stay unchanged.',
  );
  const coverage = el('div', '', 'workload-list');
  coverage.append(
    datum('Priced requests', `${precise(r.totals.pricedRequests)} / ${precise(r.totals.requests)}`),
    datum('Unpriced requests', precise(r.totals.unpricedRequests)),
    datum('Storage backend', String(r.health.backend ?? 'Not recorded')),
  );
  integrity.append(coverage);
  const unpriced = r.models.filter((m) => m.totals.unpricedRequests);
  if (unpriced.length) {
    const list = el('section', '', 'health-detail');
    list.append(el('h3', 'Models without complete pricing'));
    for (const m of unpriced) {
      const row = el('div', '', 'issue-row');
      row.append(
        el('code', m.name),
        el('span', `${precise(m.totals.unpricedRequests)} requests`, 'badge'),
      );
      list.append(row);
    }
    integrity.append(list);
  }
  const issues = Array.isArray(r.health.issues) ? r.health.issues.map(record) : [];
  const observations = el('section', '', 'health-detail');
  observations.append(el('h3', 'Recorded issues'));
  if (issues.length)
    for (const issue of issues) {
      const row = el('div', '', 'issue-row');
      const text = el('div');
      text.append(
        el('code', String(issue.code || 'Unclassified')),
        el(
          'span',
          typeof issue.latest === 'string' ? date(issue.latest) : 'Time not recorded',
          'task-date',
        ),
      );
      row.append(text, el('span', `${String(issue.observations ?? '?')} observations`, 'badge'));
      observations.append(row);
    }
  else observations.append(el('p', 'No issues recorded in the ledger.', 'note'));
  integrity.append(observations);
  const grid = el('div', '', 'grid-two');
  grid.append(collection, integrity);
  const diagnostics = document.createElement('details');
  diagnostics.className = 'diagnostics';
  diagnostics.open = diagnosticsOpen;
  diagnostics.addEventListener('toggle', () => {
    if (diagnostics.isConnected) diagnosticsOpen = diagnostics.open;
  });
  diagnostics.append(
    el('summary', 'Inspect technical diagnostics'),
    el('pre', JSON.stringify(r.health, null, 2)),
  );
  const group = el('div');
  group.append(grid, diagnostics);
  return group;
}
/** @param {CodexReport} r */
function render(r) {
  current = r;
  taskIndex = new Map(r.tasks.map((t) => [`${t.thread}:${t.turn}`, t]));
  const content = byId('content');
  if (view === 'settings') return;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusKey = focused && content.contains(focused) ? focused.dataset.focusKey : undefined;
  content.replaceChildren();
  const t = r.totals;
  const periodName = select('period').selectedOptions[0]?.textContent || r.period.label;
  byId('period-info').textContent =
    `${periodName} / ${r.period.from ? date(r.period.from, r.period.timezone) : 'Earliest recorded usage'} to ${r.period.to ? date(r.period.to, r.period.timezone) : 'now'} / ${r.period.timezone}`;
  byId('freshness').textContent = `Updated ${date(r.generatedAt)} / revision ${r.revision}`;
  const latest = r.tasks[0],
    failure = byId('failure');
  failure.classList.toggle('hidden', !latest || latest.status !== 'failed');
  failure.textContent =
    latest?.status === 'failed'
      ? `Latest turn: ${latest.displayOutcome.label}. ${latest.error || 'Unspecified error'}. Observed usage has been retained.`
      : '';
  if (view === 'overview') {
    const cards = el('section', '', 'metric-strip');
    cards.setAttribute('aria-label', 'Selected period totals');
    cards.append(
      card(
        'API-equivalent estimate',
        estimate(t),
        t.unpricedRequests
          ? `${precise(t.unpricedRequests)} requests unpriced / partial`
          : t.requests
            ? 'All observed requests priced'
            : 'No priced requests recorded',
        true,
      ),
      card(
        'Input tokens',
        number(t.input),
        t.cachePercent === null
          ? 'No input recorded'
          : `${t.cachePercent.toFixed(1)}% served from cache`,
      ),
      card('Output tokens', number(t.output), `${number(t.reasoning)} reasoning / included`),
      card(
        'User turns',
        precise(r.statistics.tasks),
        `${precise(r.sessions.length)} sessions / ${precise(t.requests)} requests`,
      ),
    );
    content.append(cards);
    const grid = el('div', '', 'grid-two');
    grid.append(activityView(r), modelView(r));
    content.append(grid);
    const recent = el('section', '', 'panel');
    const head = el('div', '', 'list-heading');
    const title = el('div');
    title.append(
      el('h2', 'Latest turns'),
      el('p', 'Each turn belongs to a session. Expand for its complete breakdown.', 'description'),
    );
    head.append(title, viewLink('View sessions', 'sessions'));
    recent.append(head);
    for (const task of r.tasks.slice(0, 5)) recent.append(taskView(task, true));
    if (!r.tasks.length)
      recent.append(
        emptyState(
          'Your next session starts here',
          'Run Codex with the collector open, or use codex-report sync to import retained history.',
        ),
      );
    const outcomes = el('div', '', 'outcome-list');
    for (const [count, label] of [
      [r.statistics.completed, 'completed'],
      [r.statistics.interrupted, 'interrupted'],
      [r.statistics.usageExceeded, 'usage exceeded'],
      [r.statistics.otherFailed, 'other failures'],
    ]) {
      const item = el('span', String(label));
      item.prepend(el('strong', String(count)));
      outcomes.append(item);
    }
    recent.append(outcomes);
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
      `${rows.length} sessions / Page ${sessionPage + 1} of ${pages}`;
    const p = panel(
      'Session history',
      `${r.sessions.length} sessions / ${r.tasks.length} root turns in this selection. Open a session to explore its turns and linked agents.`,
    );
    p.classList.add('sessions-panel');
    for (const session of rows.slice(sessionPage * perPage, (sessionPage + 1) * perPage))
      p.append(sessionView(session));
    if (!rows.length)
      p.append(
        emptyState(
          query ? 'No matching sessions' : 'No sessions in this period',
          query
            ? 'Try a different name, session ID, or start date.'
            : 'Choose Recorded lifetime, or run codex-report sync to import retained history.',
        ),
      );
    content.append(p);
  } else if (view === 'limits') {
    const grid = el('div', '', 'grid-two');
    const quota = panel(
      'Provider-reported limits',
      'Latest snapshots retained in local records, independent of the selected report period. Not a live account API.',
    );
    for (const q of r.quotas) {
      const block = el('div', '', 'quota');
      const minutes = Number(q.minutes);
      const window =
        Number.isFinite(minutes) && minutes > 0
          ? minutes >= 1440 && minutes % 1440 === 0
            ? `${minutes / 1440}-day window`
            : `${minutes / 60}-hour window`
          : String(q.window || 'Unknown window');
      const head = el('div', '', 'quota-head');
      const title = el('div');
      title.append(el('h3', String(q.limitId ?? 'Unknown limit')), el('p', window, 'note'));
      head.append(
        title,
        el('span', typeof q.used === 'number' ? `${q.used}%` : 'Unknown', 'percent'),
      );
      block.append(head);
      if (typeof q.used === 'number')
        block.append(bar('Recorded allowance used', q.used, 100, 'of window'));
      block.append(
        el('p', `Observed ${date(typeof q.at === 'string' ? q.at : null)}`),
        el('p', `Reset ${date(typeof q.resets === 'string' ? q.resets : null)}`),
      );
      if (q.reached) block.append(el('p', String(q.reached), 'notice'));
      quota.append(block);
    }
    if (!r.quotas.length)
      quota.append(
        emptyState(
          'No limit snapshot yet',
          'Missing does not mean unused. Snapshots appear when Codex records provider quota information.',
        ),
      );
    const comparison = panel(
      'Your recorded workload',
      'Local measurements for the selected account, model, and period.',
    );
    const list = el('div', '', 'workload-list');
    list.append(
      datum('User turns', precise(r.statistics.tasks)),
      datum('Model requests', precise(t.requests)),
      datum('Input + output tokens', precise(t.processed)),
      datum('API-equivalent estimate', estimate(t)),
      datum('Unpriced requests', precise(t.unpricedRequests)),
    );
    if (r.statistics.subscriptionMultiple !== null)
      list.append(
        datum(
          'API-equivalent / configured fee',
          `${r.statistics.subscriptionMultiple.toFixed(2)}x`,
        ),
      );
    comparison.append(
      list,
      el(
        'p',
        'Last five hours is a local lookback. Provider snapshots retain their own window duration and reset. API-equivalent cost is an estimate, not a subscription charge.',
        'note comparison-note',
      ),
    );
    grid.append(quota, comparison);
    content.append(grid);
  } else content.append(healthView(r));
  if (focusKey) {
    const replacement = Array.from(content.querySelectorAll('[data-focus-key]')).find(
      (n) => n instanceof HTMLElement && n.dataset.focusKey === focusKey,
    );
    if (replacement instanceof HTMLElement) replacement.focus({ preventScroll: true });
  }
}
async function refresh(force = false) {
  if (loading) {
    if (force) refreshRequested = true;
    return;
  }
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
      if (
        select('period').value !== params.get('scope') ||
        select('account').value !== params.get('account') ||
        select('model').value !== (params.get('model') || '')
      ) {
        refreshRequested = true;
        return;
      }
      button('download').disabled = false;
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
  const savebar = el('div', '', 'settings-savebar');
  status.textContent = 'Changes are saved to this installation only.';
  savebar.append(status, actions);
  form.append(appearance, reporting, billing, savebar);
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
  if (settingsSaving) return;
  if (next === 'settings' && view === next && document.getElementById('settings-form')) {
    closeNavigation(false);
    return;
  }
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
  closeNavigation(false);
  byId('title').textContent = names[view] || 'Overview';
  byId('title').tabIndex = -1;
  const subtitles = {
    overview: 'The work behind every turn, in one place.',
    sessions: 'Follow the conversation. Keep every turn in context.',
    limits: 'Your recorded workload, beside provider observations.',
    health: 'Know what is collected, priced, and still catching up.',
    settings: 'Make this workspace work the way you do.',
  };
  byId('subtitle').textContent =
    subtitles[/** @type {keyof typeof subtitles} */ (view)] || subtitles.overview;
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

/** @param {boolean} [restoreFocus] */
function closeNavigation(restoreFocus = true) {
  const wasOpen = document.body.classList.contains('nav-open');
  document.body.classList.remove('nav-open');
  byId('nav-scrim').hidden = true;
  button('nav-toggle').setAttribute('aria-expanded', 'false');
  byId('main').inert = false;
  byId('navigation').removeAttribute('role');
  byId('navigation').removeAttribute('aria-modal');
  byId('navigation').removeAttribute('aria-label');
  if (wasOpen && restoreFocus) button('nav-toggle').focus();
}
function setupNavigation() {
  button('nav-toggle').addEventListener('click', () => {
    document.body.classList.add('nav-open');
    byId('nav-scrim').hidden = false;
    button('nav-toggle').setAttribute('aria-expanded', 'true');
    byId('main').inert = true;
    const navigation = byId('navigation');
    navigation.setAttribute('role', 'dialog');
    navigation.setAttribute('aria-modal', 'true');
    navigation.setAttribute('aria-label', 'Navigation');
    const selected = navigation.querySelector('button[aria-current="page"]');
    if (selected instanceof HTMLElement) selected.focus();
  });
  for (const id of ['nav-close', 'nav-scrim'])
    button(id).addEventListener('click', () => closeNavigation());
  document.addEventListener('keydown', (event) => {
    if (!document.body.classList.contains('nav-open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeNavigation();
    } else if (event.key === 'Tab') {
      const controls = Array.from(byId('navigation').querySelectorAll('button')).filter(
        (n) => !n.disabled && n.getClientRects().length,
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  window.matchMedia('(max-width: 700px)').addEventListener('change', () => closeNavigation(false));
}

async function boot() {
  setupNavigation();
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
      void navigate(node.getAttribute('data-view') || 'overview').then(() => {
        if (
          window.matchMedia('(max-width: 700px)').matches &&
          !document.body.classList.contains('nav-open')
        )
          byId('title').focus({ preventScroll: true });
      });
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
  let lastWidth = window.innerWidth;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let resizeTimer;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (current && view !== 'settings') render(current);
    }, 150);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
}
void boot().catch((error) => {
  byId('connection').textContent = 'Collector unavailable';
  byId('connection').classList.add('offline');
  byId('content').replaceChildren(
    emptyState(
      'Reconnect to your local workspace',
      'Run codex-report start --open and use the newly opened dashboard address. No data has been changed.',
    ),
  );
  byId('error').textContent = error instanceof Error ? error.message : String(error);
  byId('error').classList.remove('hidden');
});
