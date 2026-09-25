'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { initializeConfig, saveConfig } = require('../dist/config');
const { Store } = require('../dist/database');
const { initializePrices } = require('../dist/pricing');
const { Collector } = require('../dist/collector');

// Entirely synthetic records. No prompts, real accounts, credentials or source paths.
async function seedWorkspace(home) {
  const source = path.join(home, 'synthetic-rollouts');
  fs.mkdirSync(source, { recursive: true });
  const config = initializeConfig(home);
  config.port = 0;
  config.pollMs = 500;
  config.timezone = 'UTC';
  config.dashboard.defaultPeriod = 'lifetime';
  config.sources = [{ name: 'synthetic', path: source, kind: 'rollouts', account: 'demo' }];
  config.accounts.demo = { billingDay: 6, monthlyUsd: 120 };
  const names = [
    'Dashboard exploration',
    'API integration tests',
    'Authentication refresh',
    'Runtime compatibility',
    'Release preparation',
    'Background collection',
    'Settings and preferences',
    'Storage reliability',
    'Developer documentation',
    'Session accounting',
    'Dependency review',
    'Performance investigation',
    'CLI onboarding',
    'Export refinements',
  ];
  const line = (type, payload, at) => JSON.stringify({ timestamp: at, type, payload }) + '\n';
  const now = Date.now();
  for (let i = 0; i < names.length; i++) {
    const thread = `demo-session-${i}`;
    config.sessionNames[thread] = names[i];
    const start = now - 45 * 60000 - i * 20 * 3600000;
    let text = line(
      'session_meta',
      { id: thread, session_id: thread, source: 'cli' },
      new Date(start).toISOString(),
    );
    for (let j = 0; j < 3 + (i % 3); j++) {
      const at = new Date(start + j * 5 * 60000).toISOString();
      const turn = `turn-${j}`;
      const model =
        j === 0 && i % 4 === 0 ? 'codex-auto-review' : i % 3 ? 'gpt-6-sol' : 'gpt-6-astra';
      text += line('turn_context', { turn_id: turn, model, effort: 'medium' }, at);
      text += line('event_msg', { type: 'task_started', turn_id: turn }, at);
      for (let k = 0; k < 7; k++)
        text += line(
          'token_usage_record',
          {
            thread_id: thread,
            session_id: thread,
            turn_id: turn,
            root_turn_id: turn,
            response_id: `demo-${i}-${j}-${k}`,
            usage: {
              input_tokens: 100000 + i * 6000 + j * 27000,
              cached_input_tokens: 70000 + i * 4000 + j * 24000,
              output_tokens: 2000 + i * 130,
              reasoning_output_tokens: 900,
            },
          },
          at,
        );
      text += line(
        'event_msg',
        {
          type: i % 4 === 3 && j === 1 ? 'turn_aborted' : 'task_complete',
          turn_id: turn,
          duration_ms: 90000 + i * 1500 + j * 3000,
          ...(i % 5 === 2 && j === 2
            ? { error: { codex_error_info: 'usage_limit_exceeded' } }
            : {}),
          ...(i === 8 && j === 1 ? { error: { codex_error_info: 'network_error' } } : {}),
        },
        new Date(Date.parse(at) + 90000 + i * 1500 + j * 3000).toISOString(),
      );
    }
    if (i === 0)
      text += line(
        'event_msg',
        {
          type: 'token_count',
          info: null,
          rate_limits: {
            limit_id: 'codex',
            primary: {
              window_minutes: 300,
              used_percent: 78,
              resets_at: Math.floor(now / 1000) + 4200,
            },
            secondary: {
              window_minutes: 10080,
              used_percent: 34,
              resets_at: Math.floor(now / 1000) + 3 * 86400,
            },
          },
        },
        new Date(now).toISOString(),
      );
    fs.writeFileSync(path.join(source, `${thread}.jsonl`), text);
  }
  const childAt = new Date(now - 40 * 60000).toISOString();
  fs.writeFileSync(
    path.join(source, 'child.jsonl'),
    line(
      'session_meta',
      {
        id: 'demo-worker',
        session_id: 'demo-session-0',
        parent_thread_id: 'demo-session-0',
        thread_source: 'subagent',
      },
      childAt,
    ) +
      line(
        'turn_context',
        { turn_id: 'child-turn', root_turn_id: 'turn-1', model: 'gpt-6-sol', effort: 'medium' },
        childAt,
      ) +
      line(
        'token_usage_record',
        {
          thread_id: 'demo-worker',
          session_id: 'demo-session-0',
          turn_id: 'child-turn',
          root_turn_id: 'turn-1',
          response_id: 'demo-worker-response',
          usage: {
            input_tokens: 90000,
            cached_input_tokens: 82000,
            output_tokens: 2400,
            reasoning_output_tokens: 900,
          },
        },
        childAt,
      ),
  );
  saveConfig(home, config);
  initializePrices(home);
  const store = new Store(home);
  try {
    const collector = new Collector(store, config);
    await collector.sync();
  } finally {
    store.close();
  }
  return config;
}
module.exports = { seedWorkspace };
