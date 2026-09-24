'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const { packProject, runNpm } = require('./npm-tools.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-packed-'));
let service;
function run(args, options = {}) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000, ...options });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`Command failed (${r.status}): ${r.stderr}\n${r.stdout}`);
  return r.stdout;
}
const pause = (n) => new Promise((r) => setTimeout(r, n));
async function main() {
  const artifact = packProject(temp);
  const prefix = path.join(temp, 'global install');
  const offline = process.env.CODEX_REPORT_OFFLINE_ONLY === '1';
  runNpm([
    'install',
    '--global',
    '--prefix',
    prefix,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...(offline ? ['--offline', '--omit=optional'] : []),
    artifact,
  ]);
  const packageRoot = path.join(
    prefix,
    ...(process.platform === 'win32' ? [] : ['lib']),
    'node_modules',
    'codex-report',
  );
  const entry = path.join(packageRoot, 'dist', 'cli.js');
  const home = path.join(temp, 'private store'),
    codex = path.join(temp, 'test codex');
  fs.mkdirSync(path.join(codex, 'sessions'), { recursive: true });
  fs.writeFileSync(
    path.join(codex, 'hooks.json'),
    JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo unrelated' }] }] },
    }),
  );
  const command = (args, input) =>
    run([entry, '--home', home, ...args], input === undefined ? {} : { input });
  assert.equal(command(['--version']).trim(), '0.0.1-dev');
  const shim = path.join(
    prefix,
    process.platform === 'win32' ? 'codex-report.cmd' : 'bin/codex-report',
  );
  let version;
  if (process.platform === 'win32') {
    const text = `& '${shim.replace(/'/g, "''")}' --version; exit $LASTEXITCODE`;
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-EncodedCommand', Buffer.from(text, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(r.status, 0, r.stderr);
    version = r.stdout;
  } else {
    const r = spawnSync(shim, ['--version'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 0, r.stderr);
    version = r.stdout;
  }
  assert.equal(version.trim(), '0.0.1-dev');
  command(['init', '--codex-home', codex]);
  command(['init', '--codex-home', codex]);
  assert.equal(JSON.parse(command(['doctor'])).hooks.length, 4);
  assert.equal(JSON.parse(command(['self-test'])).status, 'PASS');
  command(['config', 'set', 'port', '0']);
  command(['config', 'set', 'pollMs', '500']);
  const file = path.join(codex, 'sessions', 'rollout-smoke.jsonl');
  const at = new Date().toISOString();
  const line = (type, payload) => JSON.stringify({ timestamp: at, type, payload }) + '\n';
  fs.writeFileSync(
    file,
    line('session_meta', { id: 'smoke', session_id: 'smoke', source: 'cli' }) +
      line('turn_context', { turn_id: 't1', model: 'gpt-6-sol' }) +
      line('event_msg', { type: 'task_started', turn_id: 't1' }) +
      line('token_usage_record', {
        thread_id: 'smoke',
        session_id: 'smoke',
        turn_id: 't1',
        root_turn_id: 't1',
        response_id: 'smoke-response',
        usage: {
          input_tokens: 1000,
          cached_input_tokens: 800,
          output_tokens: 100,
          reasoning_output_tokens: 40,
        },
      }) +
      line('event_msg', {
        type: 'task_complete',
        turn_id: 't1',
        error: { codex_error_info: 'usage_limit_exceeded' },
      }),
  );
  command(['sync']);
  command(['sync']);
  const report = JSON.parse(command(['report', '--scope', 'lifetime', '--json']));
  assert.equal(report.totals.requests, 1);
  assert.equal(report.tasks[0].status, 'failed');
  service = spawn(process.execPath, [entry, '--home', home, 'start'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  service.stderr.on('data', (b) => {
    errors += b;
  });
  let runtime;
  for (let n = 0; n < 100; n++) {
    if (service.exitCode !== null) throw new Error(errors);
    try {
      runtime = JSON.parse(fs.readFileSync(path.join(home, 'runtime.json'), 'utf8'));
      break;
    } catch {}
    await pause(50);
  }
  assert.ok(runtime, 'server start');
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  const base = `http://127.0.0.1:${runtime.port}`;
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + '/api/report')).status, 401);
  const auth = { Authorization: 'Bearer ' + config.token };
  assert.equal(
    (await (await fetch(base + '/api/report?scope=lifetime', { headers: auth })).json()).totals
      .requests,
    1,
  );
  // Running hooks use the service, while the persistent writer remains in one worker.
  fs.appendFileSync(
    file,
    line('turn_context', { turn_id: 't2', model: 'gpt-6-sol' }) +
      line('event_msg', { type: 'task_started', turn_id: 't2' }) +
      line('token_usage_record', {
        thread_id: 'smoke',
        session_id: 'smoke',
        turn_id: 't2',
        root_turn_id: 't2',
        response_id: 'second-response',
        usage: { input_tokens: 500, output_tokens: 25 },
      }),
  );
  const hook = {
    hook_event_name: 'Interrupt',
    session_id: 'smoke',
    turn_id: 't2',
    transcript_path: file,
  };
  const receipt = JSON.parse(command(['hook'], JSON.stringify(hook)));
  assert.match(receipt.systemMessage, /interrupted by you/);
  assert.deepEqual(JSON.parse(command(['hook'], JSON.stringify(hook))), {});
  command(['stop']);
  await new Promise((resolve, reject) => {
    if (service.exitCode !== null) return resolve();
    const timer = setTimeout(() => reject(new Error('Service did not stop')), 5000);
    service.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  service = null;
  const out = path.join(temp, 'usage.crx');
  command(['export', out]);
  assert.equal(JSON.parse(command(['import', out])).newRequests, 0);
  command(['import', out, '--apply']);
  const backup = path.join(temp, 'snapshot.sqlite3');
  command(['backup', backup]);
  command(['restore', backup]);
  command(['restore', backup, '--apply']);
  assert.equal(JSON.parse(command(['report', '--scope', 'lifetime', '--json'])).totals.requests, 2);
  command(['uninstall-hooks']);
  const remaining = JSON.parse(fs.readFileSync(path.join(codex, 'hooks.json'), 'utf8'));
  assert.equal(remaining.hooks.Stop.length, 1);
  assert.equal(remaining.hooks.Stop[0].hooks[0].command, 'echo unrelated');
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        node: process.version,
        platform: process.platform,
        offline,
        checks: [
          'npm package install and actual shim',
          'init and repeat init',
          'real doctor',
          'device self-test',
          'persistent deduplication',
          'failure without Stop',
          'authenticated dashboard',
          'manual interruption and repeat suppression',
          'clean shutdown',
          'exchange preview/apply',
          'backup/restore',
          'uninstall preserving unrelated hooks',
        ],
      },
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (service) service.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  });
