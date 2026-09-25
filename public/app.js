// @ts-check
'use strict';
/** @typedef {import('../src/reports').Report} CodexReport */
/** @typedef {import('../src/reports').TaskRow} Task */
/** @typedef {import('../src/reports').SessionRow} Session */
/** @typedef {import('../src/reports').Totals} Totals */
/** @typedef {import('../src/settings').SettingsSnapshot} SettingsSnapshot */
/** @typedef {import('../src/config').DashboardPreferences} DashboardPreferences */
/** @typedef {{label:string, detail:string, run:()=>void}} Command */
/** @param {string} id */
function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: ${id}`);
  return node;
}
/** @param {string} id */
function input(id) {
  const node = byId(id);
  if (!(node instanceof HTMLInputElement)) throw new Error('Expected input');
  return node;
}
/** @param {string} id */
function select(id) {
  const node = byId(id);
  if (!(node instanceof HTMLSelectElement)) throw new Error('Expected select');
  return node;
}
/** @param {string} id */
function button(id) {
  const node = byId(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error('Expected button');
  return node;
}
/** @param {string} tag @param {string} [text] @param {string} [className] */
function el(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
/** @param {string} text @param {string} [className] */
function action(text, className = 'secondary') {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = text;
  node.className = className;
  return node;
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
/** @param {string|null} value @param {string} [zone] */
function date(value, zone) {
  if (!value) return 'Not recorded';
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? 'Not recorded'
    : time.toLocaleString(undefined, {
        timeZone: zone || settingsState?.values.timezone || undefined,
      });
}
/** @param {string|null} value */
function shortDate(value) {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: settingsState?.values.timezone,
      })
    : 'Date not recorded';
}
/** @param {number} ms */
function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600
    ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    : `${Math.floor(s / 60)}m ${s % 60}s`;
}
/** @param {Totals} totals */
function estimate(totals) {
  return !totals.requests
    ? 'No usage recorded'
    : totals.pricePico === null
      ? 'Unpriced'
      : `~${totals.apiEquivalent}`;
}
/** @param {Session} session */
function sessionTitle(session) {
  return session.name || `Session ${date(session.started)}`;
}
/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string,unknown>} */ (value)
    : {};
}
/** @type {CodexReport|null} */
let current = null;
/** @type {SettingsSnapshot|null} */
let settingsState = null;
/** @type {Map<string, Task>} */
let taskIndex = new Map();
let view = 'overview';
let revision = -1;
let lastRefresh = 0;
let loading = false;
let refreshRequested = false;
let navigationSequence = 0;
let sessionQuery = '';
let sessionPage = 0;
let selectedSession = '';
let selectedDay = '';
let activityMode = 'days';
let activityTableOpen = false;
let diagnosticsOpen = false;
let settingsSection = 'appearance';
let settingsDirty = false;
let billingDirty = false;
let settingsSaving = false;
let settingsDraftRevision = '';
let billingLabel = '';
let renameThread = '';
let renameRevision = '';
let renameSaving = false;
/** @type {Set<string>} */
const expanded = new Set();
/** @type {Set<string>} */
const expandedTechnical = new Set();
/** @type {Map<string, number>} */
const shownTurns = new Map();
const renameDialog = /** @type {HTMLDialogElement} */ (byId('rename-dialog'));
const commandDialog = /** @type {HTMLDialogElement} */ (byId('command-dialog'));
/** @type {Command[]} */
let commandEntries = [];
let commandIndex = 0;
/** @type {HTMLElement|null} */
let commandReturnFocus = null;
const pageNames = {
  overview: 'Overview',
  sessions: 'Sessions',
  limits: 'Usage comparison',
  health: 'Data health',
  settings: 'Settings',
};
/** @param {string} theme */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}
/** @param {number|undefined} size */
function applyFontSize(size) {
  document.documentElement.dataset.fontSize = String(
    size !== undefined && Number.isInteger(size) && size >= 14 && size <= 24 ? size : 17,
  );
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
  if (![...node.options].some((o) => o.value === value)) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label || value;
    node.append(o);
  }
  node.value = value;
}
/** @param {string} url @param {RequestInit} [options] */
async function get(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal, ...options });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Local request failed.');
    return result;
  } finally {
    clearTimeout(timeout);
  }
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
/** @param {string} title @param {string} description */
function panel(title, description) {
  const node = el('section', '', 'panel');
  node.append(el('h2', title), el('p', description, 'description'));
  return node;
}
/** @param {string} title @param {string} description */
function emptyState(title, description) {
  const node = el('div', '', 'empty');
  node.append(el('h2', title), el('p', description));
  return node;
}
/** @param {string} label @param {string} value */
function datum(label, value) {
  const node = el('div', '', 'datum');
  node.append(el('div', label, 'label'), el('div', value, 'value'));
  return node;
}
/** @param {string} label @param {string} target @param {string} [section] */
function viewLink(label, target, section) {
  const node = action(label, 'text-button');
  node.addEventListener('click', () => {
    if (target === 'settings' && section) settingsSection = section;
    void navigate(target);
  });
  return node;
}
/** @param {string} caption @param {string[]} headings @param {(string|HTMLElement)[][]} rows */
function dataTable(caption, headings, rows) {
  const wrap = el('div', '', 'table-scroll');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', caption);
  wrap.dataset.focusKey = `table-${caption}`;
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  for (const heading of headings) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = heading;
    header.append(cell);
  }
  head.append(header);
  const body = document.createElement('tbody');
  for (const values of rows) {
    const row = document.createElement('tr');
    for (const value of values) {
      const cell = document.createElement('td');
      if (typeof value === 'string') cell.textContent = value;
      else cell.append(value);
      row.append(cell);
    }
    body.append(row);
  }
  table.append(el('caption', caption, 'sr-only'), head, body);
  wrap.append(table);
  return wrap;
}
/** @param {string} name @param {Record<string, string|number>} [attributes] */
function svgElement(name, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}
/** @param {string} code @param {string} label */
function badge(code, label) {
  return el('span', label, `badge ${code}`);
}
/** @param {string} label @param {number} value @param {number} maximum @param {string} text */
function bar(label, value, maximum, text) {
  const row = el('div', '', 'bar-row');
  const title = el('div', '', 'bar-top');
  title.append(el('span', label), el('span', text));
  const progress = document.createElement('progress');
  progress.max = maximum || 1;
  progress.value = value;
  progress.setAttribute('aria-label', label);
  row.append(title, progress);
  return row;
}
/** @param {string} label @param {string} value @param {string} description @param {boolean} [copy] */
function stat(label, value, description, copy = false) {
  const node = el('div', '', 'summary-stat');
  node.append(
    el('div', label, 'label'),
    el('div', value, `value${copy ? ' is-copy' : ''}`),
    el('p', description, 'sub'),
  );
  return node;
}
/** @param {CodexReport} report */
function summaryView(report) {
  const t = report.totals;
  const ribbon = el('section', '', 'summary-ribbon');
  ribbon.setAttribute('aria-label', 'Selected period totals');
  ribbon.append(
    stat(
      'API-equivalent',
      estimate(t),
      t.unpricedRequests
        ? `${precise(t.unpricedRequests)} requests not priced`
        : t.requests
          ? 'Priced usage, not billed charges'
          : 'Choose another period to explore',
      t.pricePico === null,
    ),
    stat('Processed tokens', number(t.processed), 'Input + output across requests'),
    stat(
      'Cached input',
      t.cachePercent === null ? 'Not recorded' : `${t.cachePercent.toFixed(1)}%`,
      `${number(t.cached)} of ${number(t.input)} input tokens`,
      t.cachePercent === null,
    ),
    stat(
      'Model requests',
      precise(t.requests),
      `${precise(report.statistics.tasks)} turns across ${precise(report.sessions.length)} sessions`,
    ),
  );
  return ribbon;
}
/** @param {CodexReport} report */
function activityView(report) {
  const section = el('section', '', 'panel activity-board');
  const heading = el('div', '', 'list-heading');
  const identity = el('div');
  identity.append(
    el('h2', 'Activity'),
    el('p', 'The shape of your recorded workload.', 'description'),
  );
  const tabs = el('div', '', 'section-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Usage breakdown');
  for (const [code, label] of [
    ['days', 'By day'],
    ['models', 'By model'],
  ]) {
    const tab = action(label);
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
    if (!report.models.length)
      section.append(
        emptyState('No model records', 'Model details appear after usage is collected.'),
      );
    else
      section.append(
        dataTable(
          'Model usage in the selected period',
          ['Model', 'Requests', 'Tokens', 'API estimate'],
          report.models.map((m) => {
            const name = el('div');
            name.append(el('span', m.name, 'model-name'));
            if (m.totals.unpricedRequests)
              name.append(
                el('span', `${precise(m.totals.unpricedRequests)} unpriced`, 'model-meta'),
              );
            return [
              name,
              precise(m.totals.requests),
              precise(m.totals.processed),
              estimate(m.totals),
            ];
          }),
        ),
      );
    return section;
  }
  const days = report.days.slice(-10);
  if (!days.length) {
    section.append(
      emptyState(
        'Your activity will appear here',
        'Keep the collector running while you use Codex, or import retained history with codex-report sync.',
      ),
    );
    return section;
  }
  if (!days.some((day) => day.day === selectedDay)) selectedDay = days[days.length - 1].day;
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
  const plot = el('div', '', 'daily-plot');
  plot.setAttribute('role', 'group');
  plot.setAttribute('aria-label', 'Select a recorded day');
  const maximum = Math.max(1, ...days.map((d) => d.totals.processed));
  for (const day of days) {
    const column = action('', 'day-button');
    column.dataset.focusKey = `day-${day.day}`;
    column.dataset.day = day.day;
    column.setAttribute('aria-pressed', String(selectedDay === day.day));
    column.setAttribute(
      'aria-label',
      `${day.day}, ${precise(day.totals.processed)} processed tokens. Inspect this day.`,
    );
    const graph = svgElement('svg', {
      viewBox: '0 0 48 180',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    });
    let y = 180;
    for (const [count, kind] of [
      [day.totals.cached, 'cached'],
      [day.totals.input - day.totals.cached, 'fresh'],
      [day.totals.output, 'output'],
    ]) {
      const height = (Number(count) / maximum) * 174;
      y -= height;
      graph.append(
        svgElement('rect', { x: 6, y, width: 36, height, rx: 1.4, class: String(kind) }),
      );
    }
    const label = new Date(`${day.day}T12:00:00Z`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    column.append(graph, el('span', label, 'day-label'));
    column.addEventListener('click', () => {
      selectedDay = day.day;
      if (current) render(current);
    });
    plot.append(column);
  }
  const chosen = days.find((d) => d.day === selectedDay) || days[days.length - 1];
  const readout = el('div', '', 'daily-readout');
  readout.setAttribute('role', 'status');
  readout.append(
    el('strong', chosen.day),
    el('span', `${precise(chosen.totals.input)} input`),
    el('span', `${precise(chosen.totals.output)} output`),
    el('span', `${estimate(chosen.totals)}${chosen.totals.unpricedRequests ? ' (partial)' : ''}`),
  );
  const exact = document.createElement('details');
  exact.className = 'chart-data';
  exact.open = activityTableOpen;
  exact.addEventListener('toggle', () => {
    if (exact.isConnected) activityTableOpen = exact.open;
  });
  const toggle = el('summary', 'View exact daily values');
  toggle.dataset.focusKey = 'chart-data';
  exact.append(
    toggle,
    dataTable(
      'Exact daily token usage',
      ['Day', 'Cached input', 'Other input', 'Output', 'Total'],
      report.days.map((d) => [
        d.day,
        precise(d.totals.cached),
        precise(d.totals.input - d.totals.cached),
        precise(d.totals.output),
        precise(d.totals.processed),
      ]),
    ),
  );
  section.append(
    legend,
    plot,
    readout,
    el(
      'p',
      `Latest ${days.length} recorded days. Equal spacing; missing days are not counted as zero.`,
      'chart-note',
    ),
    exact,
  );
  return section;
}
/** @param {CodexReport} report */
function workflowView(report) {
  const rail = el('aside', '', 'insight-rail');
  rail.setAttribute('aria-label', 'Workflow and pricing');
  const flow = el('section', '', 'panel');
  const head = el('div', '', 'workflow-title');
  head.append(
    el('h2', 'Your workflow'),
    el('span', precise(report.statistics.tasks), 'workflow-count'),
  );
  flow.append(head);
  for (const [n, label, code] of [
    [report.statistics.completed, 'Completed', 'completed'],
    [report.statistics.interrupted, 'Interrupted', 'interrupted'],
    [report.statistics.usageExceeded, 'Usage exceeded', 'usage-exceeded'],
    [report.statistics.otherFailed, 'Other failures', 'failed'],
    [
      Math.max(
        0,
        report.statistics.tasks -
          report.statistics.completed -
          report.statistics.interrupted -
          report.statistics.failed,
      ),
      'Active / unknown',
      'unknown',
    ],
  ]) {
    if (code === 'unknown' && !n) continue;
    const row = el('div', '', 'outcome-row');
    const name = el('span', String(label), 'outcome-label');
    const dot = el('i', '', `status-dot ${code}`);
    dot.setAttribute('aria-hidden', 'true');
    name.prepend(dot);
    row.append(name, el('strong', precise(Number(n)), 'num'));
    flow.append(row);
  }
  const coverage = el('section', '', 'panel coverage-panel');
  coverage.append(el('h2', 'Pricing coverage'));
  const t = report.totals;
  coverage.append(
    el(
      'div',
      t.requests
        ? `${((t.pricedRequests / t.requests) * 100).toFixed(1)}% priced`
        : 'No requests yet',
      'big-inline',
    ),
  );
  if (t.requests)
    coverage.append(
      bar(
        'Requests with a recorded price',
        t.pricedRequests,
        t.requests,
        `${precise(t.pricedRequests)} / ${precise(t.requests)}`,
      ),
    );
  coverage.append(
    el(
      'p',
      t.unpricedRequests
        ? `${precise(t.unpricedRequests)} requests are recorded without an API rate. They remain in token totals.`
        : t.requests
          ? 'Every request in this selection has a stored price. Estimates are not subscription charges.'
          : 'Price coverage appears when requests are recorded.',
      'note',
    ),
    viewLink('Review data health', 'health'),
  );
  rail.append(flow, coverage);
  return rail;
}
/** @param {Session} session */
function openSession(session) {
  selectedSession = session.id;
  sessionQuery = '';
  input('session-search').value = '';
  select('session-outcome').value = 'all';
  select('session-sort').value = 'recent';
  const i = current?.sessions.findIndex((s) => s.id === session.id) ?? 0;
  sessionPage = Math.floor(
    Math.max(0, i) / (settingsState?.values.dashboard.sessionsPerPage || 20),
  );
  void navigate('sessions');
}
/** @param {CodexReport} report */
function recentSessions(report) {
  const section = el('section', '', 'panel');
  const heading = el('div', '', 'list-heading');
  const name = el('div');
  name.append(
    el('h2', 'Recent conversations'),
    el('p', 'Start with a session. Follow every turn.', 'description'),
  );
  heading.append(name, viewLink('Explore all sessions', 'sessions'));
  section.append(heading);
  if (!report.sessions.length)
    section.append(
      emptyState(
        'No sessions for these filters',
        'Choose Recorded lifetime or import retained Codex history.',
      ),
    );
  else
    section.append(
      dataTable(
        'Recent sessions in this selection',
        ['Session', 'Turns', 'Tokens', 'API estimate'],
        report.sessions.slice(0, 5).map((s) => {
          const identity = el('div');
          const link = action(s.name || `Session ${shortDate(s.started)}`, 'table-link');
          link.dataset.focusKey = `recent-${s.id}`;
          link.addEventListener('click', () => openSession(s));
          identity.append(link, el('span', date(s.lastActivity), 'table-date'));
          const price = el('div', estimate(s.totals), 'num');
          if (s.totals.unpricedRequests)
            price.append(
              el('span', `${precise(s.totals.unpricedRequests)} unpriced`, 'model-meta'),
            );
          return [identity, precise(s.turnIds.length), number(s.totals.processed), price];
        }),
      ),
    );
  return section;
}
/** @param {string} key @param {string} title @param {string} text */
function technicalView(key, title, text) {
  const node = document.createElement('details');
  node.className = 'technical';
  node.open = expandedTechnical.has(key);
  const summary = el('summary', title);
  summary.dataset.focusKey = `technical-${key}`;
  node.append(summary, el('code', text));
  node.addEventListener('toggle', () => {
    if (!node.isConnected) return;
    if (node.open) expandedTechnical.add(key);
    else expandedTechnical.delete(key);
  });
  return node;
}
/** @param {Task} task */
function taskView(task) {
  const key = `${task.thread}:${task.turn}`;
  const node = document.createElement('details');
  node.className = 'task';
  node.dataset.task = key;
  node.open = expanded.has(key);
  node.addEventListener('toggle', () => {
    if (!node.isConnected) return;
    if (node.open) expanded.add(key);
    else expanded.delete(key);
  });
  const summary = el('summary');
  summary.dataset.focusKey = `turn-${key}`;
  const identity = el('div');
  identity.append(
    el('span', `Turn ${task.number ?? task.turn.slice(0, 8)}`, 'task-title'),
    el(
      'span',
      task.durationMs === null
        ? date(task.started)
        : `${shortDate(task.started)} / ${duration(task.durationMs)}`,
      'task-date',
    ),
  );
  const price = el('span', estimate(task.totals), 'num');
  if (task.totals.pricePico !== null && task.totals.unpricedRequests)
    price.append(el('small', `${precise(task.totals.unpricedRequests)} unpriced`, 'partial-price'));
  summary.append(identity, badge(task.displayOutcome.code, task.displayOutcome.label), price);
  const body = el('div', '', 'details');
  const grid = el('div', '', 'detail-grid');
  for (const [label, value] of [
    ['Input tokens', precise(task.totals.input)],
    ['Cached input', precise(task.totals.cached)],
    ['Output tokens', precise(task.totals.output)],
    ['Reasoning in output', precise(task.totals.reasoning)],
    ['Model requests', precise(task.totals.requests)],
    ['Linked agents', `${task.workers} workers / ${task.reviewers} reviews`],
  ])
    grid.append(datum(label, value));
  body.append(
    grid,
    el(
      'p',
      `Started ${date(task.started)}${task.ended ? ` / Ended ${date(task.ended)}` : ''}`,
      'note',
    ),
    el(
      'p',
      task.models.length ? `Models: ${task.models.join(', ')}` : 'Model not recorded.',
      'note',
    ),
  );
  if (task.efforts.length)
    body.append(el('p', `Reasoning settings: ${task.efforts.join(', ')}`, 'note'));
  body.append(
    el(
      'p',
      'Reasoning is included in output. Elapsed time includes tools and approval waits.',
      'note',
    ),
  );
  if (task.collectionPending)
    body.append(el('p', 'Collection is catching up for this turn.', 'notice warning'));
  if (task.error) body.append(el('p', `Recorded reason: ${task.error}`, 'notice warning'));
  if (task.totals.unpricedRequests)
    body.append(
      el(
        'p',
        'Unpriced: ' +
          Object.entries(task.unpriced)
            .map(([m, count]) => `${count} ${m} requests`)
            .join('; ') +
          '. The estimate includes priced requests only.',
        'notice',
      ),
    );
  body.append(technicalView(key, 'Request identifiers', `${task.thread} / ${task.turn}`));
  node.append(summary, body);
  return node;
}
/** @param {Session} session */
function sessionDetail(session) {
  const section = el('section', '', 'panel session-detail');
  section.setAttribute('aria-label', 'Selected session');
  section.dataset.session = session.id;
  const heading = el('div', '', 'session-heading');
  const name = el('div');
  const title = el('h2', sessionTitle(session));
  title.id = 'session-detail-title';
  name.append(title, el('p', `Started ${date(session.started)}`, 'description'));
  const rename = action(session.name ? 'Rename session' : 'Name session');
  rename.dataset.focusKey = `rename-${session.id}`;
  rename.addEventListener('click', () => {
    void renameSession(session);
  });
  heading.append(name, rename);
  const totals = el('div', '', 'session-summary');
  totals.append(
    datum('API-equivalent', estimate(session.totals)),
    datum('Processed tokens', number(session.totals.processed)),
    datum('Model requests', precise(session.totals.requests)),
  );
  section.append(heading, totals);
  if (session.totals.unpricedRequests)
    section.append(
      el(
        'p',
        `${precise(session.totals.unpricedRequests)} requests have no recorded API rate. The estimate covers priced requests only.`,
        'pricing-qualification',
      ),
    );
  const o = session.outcomes;
  const outcomes = el('div', '', 'outcome-list');
  for (const [n, text, code] of [
    [o.completed, 'completed', 'completed'],
    [o.interrupted, 'interrupted', 'interrupted'],
    [o.usageExceeded, 'usage exceeded', 'usage-exceeded'],
    [o.failed, 'failed', 'failed'],
    [o.other, 'active / unknown', 'unknown'],
  ])
    if (n) outcomes.append(badge(String(code), `${n} ${text}`));
  section.append(
    outcomes,
    el('p', 'Values include linked agent work and follow the current report filters.', 'note'),
  );
  const tasks = session.turnIds
    .map((id) => taskIndex.get(`${session.id}:${id}`))
    .filter((t) => t !== undefined);
  const turnsHead = el('div', '', 'turn-heading');
  turnsHead.append(el('h3', 'Turn timeline'), el('span', `${tasks.length} turns`, 'note'));
  section.append(turnsHead);
  const limit = shownTurns.get(session.id) || 50;
  for (const task of tasks.slice(-limit)) section.append(taskView(task));
  if (tasks.length > limit) {
    const more = action(`Show ${Math.min(50, tasks.length - limit)} earlier turns`);
    more.dataset.focusKey = 'more-turns';
    more.addEventListener('click', () => {
      shownTurns.set(session.id, limit + 50);
      if (current) render(current);
    });
    section.append(more);
  }
  section.append(technicalView(session.id, 'Full session ID', session.id));
  return section;
}
/** @param {CodexReport} report */
function sessionsView(report) {
  const query = sessionQuery.trim().toLocaleLowerCase();
  const outcome = select('session-outcome').value;
  const rows = report.sessions.filter(
    (s) =>
      [s.id, s.name || '', date(s.started)].some((v) => v.toLocaleLowerCase().includes(query)) &&
      (outcome === 'all' || s.outcomes[/** @type {keyof Session['outcomes']} */ (outcome)] > 0),
  );
  const order = select('session-sort').value;
  rows.sort((a, b) => {
    if (order === 'tokens')
      return b.totals.processed - a.totals.processed || a.id.localeCompare(b.id);
    if (order === 'cost') {
      const av = a.totals.pricePico === null ? -1n : BigInt(a.totals.pricePico);
      const bv = b.totals.pricePico === null ? -1n : BigInt(b.totals.pricePico);
      return av < bv ? 1 : av > bv ? -1 : a.id.localeCompare(b.id);
    }
    return order === 'oldest'
      ? a.started.localeCompare(b.started)
      : b.lastActivity.localeCompare(a.lastActivity);
  });
  const pageSize = settingsState?.values.dashboard.sessionsPerPage || 20;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  sessionPage = Math.min(sessionPage, pages - 1);
  const visible = rows.slice(sessionPage * pageSize, (sessionPage + 1) * pageSize);
  button('sessions-prev').disabled = sessionPage === 0;
  button('sessions-next').disabled = sessionPage === pages - 1;
  byId('sessions-count').textContent =
    `${rows.length} sessions / Page ${sessionPage + 1} of ${pages}`;
  if (!visible.length)
    return emptyState(
      'No matching sessions',
      query || outcome !== 'all'
        ? 'Clear the search or choose All outcomes to see more conversations.'
        : 'Try Recorded lifetime or run codex-report sync to import retained history.',
    );
  if (!visible.some((s) => s.id === selectedSession)) selectedSession = visible[0].id;
  const shell = el('div', '', 'session-explorer');
  const list = el('div', '', 'session-list');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Choose a session');
  list.dataset.scrollKey = 'session-list';
  for (const session of visible) {
    const choice = action('', 'session-choice');
    choice.dataset.sessionId = session.id;
    choice.dataset.focusKey = `choose-${session.id}`;
    choice.setAttribute('aria-pressed', String(session.id === selectedSession));
    choice.setAttribute('aria-controls', 'session-inspector');
    choice.append(
      el('span', session.name || `Session ${shortDate(session.started)}`, 'session-name'),
      el('span', date(session.started), 'session-date'),
    );
    const meta = el('span', '', 'session-mini');
    meta.append(
      el('span', `${session.turnIds.length} turns`),
      el(
        'span',
        `${estimate(session.totals)}${session.totals.pricePico !== null && session.totals.unpricedRequests ? ' (partial)' : ''}`,
        'num',
      ),
    );
    choice.append(meta);
    choice.addEventListener('click', () => {
      selectedSession = session.id;
      if (current) render(current);
    });
    list.append(choice);
  }
  const selected = visible.find((s) => s.id === selectedSession) || visible[0];
  const detail = sessionDetail(selected);
  detail.id = 'session-inspector';
  shell.append(list, detail);
  return shell;
}
/** @param {CodexReport} report */
function comparisonView(report) {
  const grid = el('div', '', 'comparison-grid');
  const quota = panel(
    'Provider snapshots',
    'What Codex last recorded. These observations are not live account checks.',
  );
  for (const q of report.quotas) {
    const block = el('div', '', 'quota');
    const minutes = Number(q.minutes);
    const windowName =
      Number.isFinite(minutes) && minutes > 0
        ? minutes % 1440 === 0
          ? `${minutes / 1440}-day window`
          : `${minutes / 60}-hour window`
        : String(q.window || 'Unknown window');
    const head = el('div', '', 'quota-head');
    const label = el('div');
    label.append(el('h3', windowName), el('p', `Limit: ${String(q.limitId || 'Unknown')}`, 'note'));
    head.append(
      label,
      el('span', typeof q.used === 'number' ? `${q.used}%` : 'Unknown', 'percent'),
    );
    block.append(head);
    if (typeof q.used === 'number')
      block.append(bar('Recorded allowance used', q.used, 100, 'of window'));
    block.append(
      el('p', `Resets ${date(typeof q.resets === 'string' ? q.resets : null)}`),
      el('p', `Observed ${date(typeof q.at === 'string' ? q.at : null)}`),
    );
    if (q.reached) block.append(el('p', String(q.reached), 'notice warning'));
    quota.append(block);
  }
  if (!report.quotas.length)
    quota.append(
      emptyState(
        'No quota observation yet',
        'Missing does not mean unused. A snapshot appears when Codex records the provider limits.',
      ),
    );
  const workload = panel(
    'Your local workload',
    'Measured in the selected period, account, and model.',
  );
  const values = el('div', '', 'workload-list');
  for (const [label, value] of [
    ['User turns', precise(report.statistics.tasks)],
    ['Model requests', precise(report.totals.requests)],
    ['Input + output tokens', precise(report.totals.processed)],
    ['API-equivalent', estimate(report.totals)],
    ['Unpriced requests', precise(report.totals.unpricedRequests)],
  ])
    values.append(datum(label, value));
  if (report.statistics.subscriptionMultiple !== null)
    values.append(
      datum('Estimate / configured fee', `${report.statistics.subscriptionMultiple.toFixed(2)}x`),
    );
  workload.append(
    values,
    el(
      'p',
      'Last five hours is a local lookback. A provider window has its own duration and reset. API estimates do not determine your subscription allowance.',
      'note comparison-note',
    ),
    viewLink('Configure billing comparison', 'settings', 'billing'),
  );
  grid.append(quota, workload);
  return grid;
}
/** @param {CodexReport} report */
function healthView(report) {
  const c = record(report.health.collection);
  const attention = Boolean(c.pending || c.partial || c.failed || c.missing);
  const collection = panel(
    'Collection status',
    'The most recent scan, independent of pricing coverage.',
  );
  const state = el('div', '', `health-state${attention ? ' attention' : ''}`);
  state.append(
    el(
      'strong',
      !Object.keys(c).length
        ? 'Waiting for a scan'
        : attention
          ? 'Some records need attention'
          : 'Latest scan complete',
    ),
    el(
      'p',
      typeof c.at === 'string'
        ? `Recorded ${date(c.at)}`
        : 'Keep the collector running or run codex-report sync.',
      'note',
    ),
  );
  const counts = el('div', '', 'health-stats');
  for (const [key, label] of [
    ['files', 'Files checked'],
    ['added', 'New requests'],
    ['partial', 'Partial files'],
    ['failed', 'Failed files'],
    ['missing', 'Missing sources'],
  ])
    counts.append(
      datum(label, typeof c[key] === 'number' ? precise(Number(c[key])) : 'Not recorded'),
    );
  collection.append(state, counts);
  const pricing = panel('Price coverage', 'Unknown prices do not erase the recorded token usage.');
  const values = el('div', '', 'workload-list');
  values.append(
    datum('Priced requests', precise(report.totals.pricedRequests)),
    datum('Unpriced requests', precise(report.totals.unpricedRequests)),
    datum('Storage', String(report.health.backend || 'Not recorded')),
  );
  pricing.append(values);
  const missing = report.models.filter((m) => m.totals.unpricedRequests);
  for (const m of missing) {
    const row = el('div', '', 'issue-row');
    row.append(
      el('span', m.name),
      el('span', `${precise(m.totals.unpricedRequests)} requests`, 'note'),
    );
    pricing.append(row);
  }
  if (!missing.length)
    pricing.append(
      el(
        'p',
        report.totals.requests
          ? 'All requests in this selection have a recorded rate.'
          : 'No requests in this selection yet.',
        'note',
      ),
    );
  const grid = el('div', '', 'grid-two');
  grid.append(collection, pricing);
  const issues = panel(
    'Recorded issues',
    'Collection diagnostics, not the failures of individual turns.',
  );
  const observations = Array.isArray(report.health.issues) ? report.health.issues.map(record) : [];
  for (const issue of observations) {
    const row = el('div', '', 'issue-row');
    const name = el('div');
    name.append(
      el('span', String(issue.code || 'Unclassified')),
      el('span', date(typeof issue.latest === 'string' ? issue.latest : null), 'task-date'),
    );
    row.append(name, el('span', `${String(issue.observations ?? '?')} observations`, 'note'));
    issues.append(row);
  }
  if (!observations.length) issues.append(el('p', 'No issues recorded in the ledger.', 'note'));
  const diagnostics = document.createElement('details');
  diagnostics.className = 'diagnostics';
  diagnostics.open = diagnosticsOpen;
  diagnostics.addEventListener('toggle', () => {
    if (diagnostics.isConnected) diagnosticsOpen = diagnostics.open;
  });
  const toggle = el('summary', 'Technical diagnostics and source details');
  toggle.dataset.focusKey = 'diagnostics';
  diagnostics.append(toggle, el('pre', JSON.stringify(report.health, null, 2)));
  const page = el('div', '', 'health-page');
  page.append(grid, issues, diagnostics);
  return page;
}
/** @param {CodexReport} report */
function render(report) {
  current = report;
  taskIndex = new Map(report.tasks.map((t) => [`${t.thread}:${t.turn}`, t]));
  if (view === 'settings') return;
  const content = byId('content');
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusKey = focused && content.contains(focused) ? focused.dataset.focusKey : undefined;
  const listScroll = content.querySelector('.session-list')?.scrollTop || 0;
  const scopeLabel =
    report.period.label === 'lifetime'
      ? 'Recorded lifetime'
      : report.period.label.charAt(0).toUpperCase() + report.period.label.slice(1);
  byId('period-info').replaceChildren(
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
  byId('freshness').textContent = `Updated ${date(report.generatedAt)}`;
  const failure = byId('failure');
  const latest = report.tasks[0];
  failure.classList.toggle('hidden', !latest || latest.status !== 'failed');
  failure.replaceChildren();
  if (latest?.status === 'failed') {
    failure.append(
      el('strong', `Latest turn: ${latest.displayOutcome.label}`),
      el('p', 'Usage is retained. Open its session for the recorded reason and token breakdown.'),
    );
    const session = report.sessions.find((s) => s.id === latest.thread);
    if (session) {
      const show = action('Inspect session', 'text-button');
      show.addEventListener('click', () => openSession(session));
      failure.append(show);
    }
  }
  content.replaceChildren();
  if (view === 'overview') {
    const grid = el('div', '', 'overview-grid');
    grid.append(activityView(report), workflowView(report));
    content.append(summaryView(report), grid, recentSessions(report));
  } else if (view === 'sessions') content.append(sessionsView(report));
  else if (view === 'limits') content.append(comparisonView(report));
  else content.append(healthView(report));
  const newList = content.querySelector('.session-list');
  if (newList) newList.scrollTop = listScroll;
  if (focusKey) {
    const replacement = [...content.querySelectorAll('[data-focus-key]')].find(
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
  if (
    !force &&
    (renameDialog.open || commandDialog.open || window.getSelection()?.type === 'Range')
  )
    return;
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
    const previous = account.value;
    for (const name of status.accounts) {
      if (typeof name === 'string')
        setOption('account', name, name === 'all' ? 'All recorded accounts' : name);
    }
    account.value = previous;
    if (force || status.revision !== revision || Date.now() - lastRefresh >= 10000) {
      const scope = select('period').value;
      const model = select('model').value;
      const params = new URLSearchParams({ scope, account: account.value });
      if (model) params.set('model', model);
      const report = /** @type {CodexReport} */ (await get('/api/report?' + params));
      if (
        select('period').value !== scope ||
        account.value !== params.get('account') ||
        select('model').value !== model
      ) {
        refreshRequested = true;
        return;
      }
      const selectedModel = select('model').value;
      for (const m of report.models) setOption('model', m.name);
      select('model').value = selectedModel;
      if (view !== 'settings') render(report);
      else current = report;
      revision = report.revision;
      lastRefresh = Date.now();
      button('download').disabled = false;
    }
    byId('connection').textContent = 'Collector connected';
    byId('connection').classList.remove('offline');
    byId('error').classList.add('hidden');
  } catch (e) {
    byId('connection').textContent = 'Collector unavailable';
    byId('connection').classList.add('offline');
    showError(
      `${e instanceof Error ? e.message : String(e)} Last loaded data is retained. Use Refresh to retry.`,
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
  form.noValidate = true;
  const appearance = panel(
    'Appearance',
    'Set a comfortable reading size and color mode. Preview the whole workspace before saving.',
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
  const title = el('h3', 'Your reading size');
  title.id = 'typography-heading';
  const help = el(
    'p',
    'One setting for the whole workspace: navigation, charts, session details, forms, and dialogs.',
    'note',
  );
  help.id = 'font-size-help';
  const sizes = el('div', '', 'font-size-controls');
  const size = inputField(
    sizes,
    'settings-font-size',
    'Base text size',
    String(state.dashboard.fontSize ?? 17),
    'number',
  );
  size.min = '14';
  size.max = '24';
  size.step = '1';
  size.required = true;
  size.setAttribute('aria-describedby', 'font-size-help font-size-units');
  const slider = inputField(
    sizes,
    'settings-font-slider',
    'Adjust size',
    String(state.dashboard.fontSize ?? 17),
    'range',
  );
  slider.min = '14';
  slider.max = '24';
  slider.step = '1';
  slider.setAttribute('aria-describedby', 'font-size-help');
  const reset = action('Reset to 17');
  reset.id = 'font-size-reset';
  reset.dataset.preferenceAction = 'reset-size';
  sizes.append(reset);
  const units = el(
    'p',
    '14-24 px reference size. Browser text preferences and zoom still apply.',
    'note',
  );
  units.id = 'font-size-units';
  const preview = el('div', '', 'type-preview');
  preview.setAttribute('aria-label', 'Typography preview');
  preview.append(
    el('span', 'Aa', 'type-specimen'),
    el('p', 'Clear numbers. Comfortable reading.'),
    el('span', '0123456789', 'type-numerals'),
  );
  typography.append(title, help, sizes, units, preview);
  appearance.append(fields, typography);
  const previewSize = () => {
    if (settingsSaving || !size.value || !size.validity.valid) return;
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
    const invalid = [...form.querySelectorAll('input,select')].find(
      (control) =>
        (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) &&
        !control.disabled &&
        !control.checkValidity(),
    );
    if (invalid instanceof HTMLInputElement || invalid instanceof HTMLSelectElement) {
      invalid.reportValidity();
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
    status.textContent = 'Saving preferences...';
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
          'Saved. Appearance and text size apply now. Start-page defaults apply when you reopen this workspace.';
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
      const active = key === name;
      section.hidden = !active;
      const tab = button(`settings-tab-${key}`);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
  };
  for (const [key, title, section] of sections) {
    const tab = action(title);
    tab.id = `settings-tab-${key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `settings-panel-${key}`);
    section.id = `settings-panel-${key}`;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('click', () => activate(key));
    tab.addEventListener('keydown', (e) => {
      const keys = sections.map(([id]) => id);
      const index = keys.indexOf(key);
      let next = index;
      if (e.key === 'ArrowRight') next = (index + 1) % keys.length;
      else if (e.key === 'ArrowLeft') next = (index + keys.length - 1) % keys.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = keys.length - 1;
      else return;
      e.preventDefault();
      activate(keys[next], true);
    });
    tabs.append(tab);
  }
  form.prepend(tabs);
  activate(sections.some(([key]) => key === settingsSection) ? settingsSection : 'appearance');
  form.addEventListener(
    'invalid',
    (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      for (const [key, , section] of sections) if (section.contains(e.target)) activate(key);
    },
    true,
  );
}
/** @param {string} next */
async function navigate(next) {
  if (settingsSaving) return;
  if (!(next in pageNames)) next = 'overview';
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
  const subtitles = {
    overview: 'A clear picture of the work behind your conversations.',
    sessions: 'Choose a conversation. Explore its work, one turn at a time.',
    limits: 'Local measurements, alongside what the provider reported.',
    health: 'Understand what is collected, what is priced, and what needs attention.',
    settings: 'Your workspace. Your way of reading it.',
  };
  byId('title').textContent = pageNames[/** @type {keyof typeof pageNames} */ (view)];
  byId('subtitle').textContent = subtitles[/** @type {keyof typeof subtitles} */ (view)];
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
  const content = byId('content');
  content.classList.remove('route-enter');
  if (view === 'settings') {
    content.replaceChildren(
      emptyState('Opening preferences', 'Reading the settings stored on this computer.'),
    );
    try {
      const snapshot = /** @type {SettingsSnapshot} */ (await get('/api/settings'));
      if (sequence !== navigationSequence || view !== 'settings') return;
      settingsState = snapshot;
      applyAppearance(snapshot.values.dashboard);
      settingsView();
    } catch (e) {
      if (sequence === navigationSequence) showError(e instanceof Error ? e.message : String(e));
    }
  } else if (current) render(current);
  content.classList.add('route-enter');
}
/** @param {Session} session */
async function renameSession(session) {
  if (renameDialog.open || renameSaving) return;
  try {
    const snapshot = /** @type {SettingsSnapshot} */ (await get('/api/settings'));
    renameRevision = snapshot.revision;
    renameThread = session.id;
    input('session-name').value = session.name || '';
    byId('rename-error').textContent = '';
    renameDialog.showModal();
    input('session-name').focus();
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
}
function downloadReport() {
  if (!current) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'codex-report.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderCommands() {
  const query = input('command-search').value.trim().toLocaleLowerCase();
  commandEntries = Object.entries(pageNames).map(([key, label]) => ({
    label,
    detail: 'Page',
    run: () => {
      void navigate(key);
    },
  }));
  if (current)
    commandEntries.push(
      ...current.sessions.map((session) => ({
        label: sessionTitle(session),
        detail: `${session.turnIds.length} turns`,
        run: () => openSession(session),
      })),
    );
  commandEntries = commandEntries
    .filter((entry) => `${entry.label} ${entry.detail}`.toLocaleLowerCase().includes(query))
    .slice(0, 20);
  commandIndex = 0;
  const results = byId('command-results');
  results.replaceChildren();
  for (const [index, entry] of commandEntries.entries()) {
    const node = action('', 'command-result');
    node.append(el('span', entry.label), el('small', entry.detail));
    node.dataset.commandIndex = String(index);
    node.id = `command-result-${index}`;
    node.tabIndex = -1;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', String(index === commandIndex));
    node.addEventListener('click', () => {
      commandDialog.close();
      entry.run();
    });
    results.append(node);
  }
  if (commandEntries.length)
    input('command-search').setAttribute('aria-activedescendant', 'command-result-0');
  else {
    input('command-search').removeAttribute('aria-activedescendant');
    const empty = el('p', 'No matching pages or sessions. Try another search.', 'empty');
    empty.setAttribute('role', 'status');
    results.append(empty);
  }
}
function openCommands() {
  if (renameDialog.open || settingsSaving || commandDialog.open) return;
  commandReturnFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  input('command-search').value = '';
  renderCommands();
  commandDialog.showModal();
  input('command-search').setAttribute('aria-expanded', 'true');
  input('command-search').focus();
}
async function boot() {
  button('download').disabled = true;
  for (const node of document.querySelectorAll('button[data-view]'))
    node.addEventListener('click', () => {
      void navigate(node.getAttribute('data-view') || 'overview');
    });
  document.querySelector('.brand')?.addEventListener('click', (e) => {
    e.preventDefault();
    void navigate('overview');
  });
  button('refresh').addEventListener('click', () => {
    void refresh(true);
  });
  button('download').addEventListener('click', downloadReport);
  button('open-commands').addEventListener('click', openCommands);
  button('command-close').addEventListener('click', () => commandDialog.close());
  input('command-search').addEventListener('input', renderCommands);
  commandDialog.addEventListener('close', () => {
    input('command-search').setAttribute('aria-expanded', 'false');
    if (commandReturnFocus?.isConnected) commandReturnFocus.focus({ preventScroll: true });
    else button('open-commands').focus({ preventScroll: true });
  });
  commandDialog.addEventListener('keydown', (e) => {
    if (e.target !== input('command-search')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!commandEntries.length) return;
      commandIndex =
        (commandIndex + (e.key === 'ArrowDown' ? 1 : -1) + commandEntries.length) %
        commandEntries.length;
      for (const node of byId('command-results').querySelectorAll('button')) {
        const active = node.dataset.commandIndex === String(commandIndex);
        node.setAttribute('aria-selected', String(active));
        if (active) {
          input('command-search').setAttribute('aria-activedescendant', node.id);
          node.scrollIntoView({ block: 'nearest' });
        }
      }
    } else if (e.key === 'Enter' && commandEntries[commandIndex]) {
      e.preventDefault();
      commandDialog.close();
      commandEntries[commandIndex].run();
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (commandDialog.open) commandDialog.close();
      else openCommands();
    }
  });
  const shortcut = byId('open-commands').querySelector('kbd');
  if (shortcut && /Mac/i.test(navigator.platform)) shortcut.textContent = 'Cmd K';
  input('session-search').addEventListener('input', () => {
    sessionQuery = input('session-search').value;
    sessionPage = 0;
    if (current) render(current);
  });
  for (const id of ['session-outcome', 'session-sort'])
    select(id).addEventListener('change', () => {
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
  renameDialog.addEventListener('close', () => {
    const trigger = [...document.querySelectorAll('[data-focus-key]')].find(
      (n) => n instanceof HTMLElement && n.dataset.focusKey === `rename-${renameThread}`,
    );
    if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true });
  });
  byId('rename-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (renameSaving) return;
    renameSaving = true;
    button('rename-save').disabled = true;
    button('rename-cancel').disabled = true;
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
        button('rename-cancel').disabled = false;
        input('session-name').disabled = false;
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
  await navigate(settingsState.values.dashboard.defaultView);
  await refresh(true);
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 2000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
}
void boot().catch((e) => {
  byId('connection').textContent = 'Collector unavailable';
  byId('connection').classList.add('offline');
  byId('content').replaceChildren(
    emptyState(
      'Reconnect to your workspace',
      'Run codex-report start --open and use the newly opened address. Your recorded data has not changed.',
    ),
  );
  showError(e instanceof Error ? e.message : String(e));
});
