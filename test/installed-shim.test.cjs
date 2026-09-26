'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SHIM_TIMEOUT_MS, checkedOutput, readShimVersion } = require('../tools/installed-shim.cjs');

const successful = () => ({ status: 0, signal: null, stdout: '0.0.1-dev\n', stderr: '' });

test('the POSIX installed command is invoked directly without a shell', () => {
  const shim = '/tmp/space & !/bin/codex-report';
  let calls = 0;
  const result = readShimVersion(shim, {
    platform: 'linux',
    env: { PATH: '/test/bin' },
    spawnSync(command, args, options) {
      calls++;
      assert.equal(command, shim);
      assert.deepEqual(args, ['--version']);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 60000);
      return successful();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.trim(), '0.0.1-dev');
});

test('Windows uses the actual cmd shim with literal path expansion and no PowerShell', () => {
  const shim = "C:\\Users\\O'Brien & (test)\\%PATH% !\\codex-report.cmd";
  const environment = {
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
    codex_report_packed_shim: 'old',
  };
  const before = { ...environment };
  let calls = 0;
  readShimVersion(shim, {
    platform: 'win32',
    env: environment,
    spawnSync(command, args, options) {
      calls++;
      assert.equal(command, environment.COMSPEC);
      assert.deepEqual(args, [
        '/d',
        '/s',
        '/v:off',
        '/c',
        '""%CODEX_REPORT_PACKED_SHIM%" --version"',
      ]);
      assert.equal(options.windowsVerbatimArguments, true);
      assert.equal(options.windowsHide, true);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, SHIM_TIMEOUT_MS);
      assert.equal(options.env.CODEX_REPORT_PACKED_SHIM, shim);
      assert.equal(options.env.codex_report_packed_shim, undefined);
      assert.ok(!args.join(' ').includes(shim));
      return successful();
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(environment, before);
});

test('Windows falls back to cmd.exe when ComSpec is absent', () => {
  readShimVersion('C:\\test\\codex-report.cmd', {
    platform: 'win32',
    env: {},
    spawnSync(command) {
      assert.equal(command, 'cmd.exe');
      return successful();
    },
  });
});

for (const [label, result, expected] of [
  [
    'timeout',
    {
      status: null,
      signal: 'SIGTERM',
      error: Object.assign(new Error('spawn ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    },
    /ETIMEDOUT/,
  ],
  [
    'launch error',
    {
      status: null,
      signal: null,
      error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    },
    /ENOENT/,
  ],
  ['signal', { status: null, signal: 'SIGTERM' }, /terminated by SIGTERM/],
  ['nonzero exit', { status: 7, signal: null }, /exit status 7/],
  ['null status without details', { status: null, signal: null }, /exit status null/],
]) {
  test(`shim ${label} preserves diagnostics and never retries`, () => {
    let calls = 0;
    assert.throws(
      () =>
        readShimVersion('/fixture/shim', {
          platform: 'linux',
          spawnSync() {
            calls++;
            return { ...result, stdout: 'partial output', stderr: 'failure detail' };
          },
        }),
      (error) => {
        assert.match(error.message, expected);
        assert.match(error.message, /60000ms/);
        assert.match(error.message, /partial output/);
        assert.match(error.message, /failure detail/);
        if (result.error) {
          assert.equal(error.cause, result.error);
          assert.equal(error.code, result.error.code);
        }
        return true;
      },
    );
    assert.equal(calls, 1);
  });
}

test('a reported launch error cannot be hidden by a zero exit status', () => {
  assert.throws(
    () => checkedOutput({ ...successful(), error: new Error('launch failed') }, 'probe'),
    /launch failed/,
  );
});

test('invalid shim paths are rejected before starting a process', () => {
  for (const shim of ['', null, '/tmp/\nshim', 'C:\\bad"path\\shim.cmd']) {
    assert.throws(
      () =>
        readShimVersion(shim, {
          platform: 'win32',
          spawnSync() {
            assert.fail('must not launch');
          },
        }),
      /path/,
    );
  }
});

test('an actual executable shim works in a path with spaces and shell metacharacters', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-shim-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const directory = path.join(temp, "install & (space) %PATH% ! O'Brien");
  fs.mkdirSync(directory);
  const windows = process.platform === 'win32';
  const shim = path.join(directory, windows ? 'codex-report.cmd' : 'codex-report');
  fs.writeFileSync(
    shim,
    windows
      ? '@echo off\r\nsetlocal DisableDelayedExpansion\r\nif not "%~1"=="--version" exit /b 9\r\necho 0.0.1-dev\r\nexit /b 0\r\n'
      : '#!/bin/sh\n[ "$1" = "--version" ] || exit 9\nprintf "0.0.1-dev\\n"\n',
  );
  fs.chmodSync(shim, 0o755);
  assert.equal(readShimVersion(shim).trim(), '0.0.1-dev');
});

test('real child-process launch errors retain their code instead of null !== 0', () => {
  const missing = path.join(
    os.tmpdir(),
    'codex-report-missing-' + process.pid,
    'missing-executable',
  );
  const result = spawnSync(missing, [], { encoding: 'utf8', timeout: 1000, shell: false });
  assert.throws(
    () => checkedOutput(result, 'missing probe', 1000),
    (error) => {
      assert.equal(error.code, 'ENOENT');
      assert.match(error.message, /missing probe/);
      return true;
    },
  );
});

test('real child-process nonzero exits retain stdout and stderr', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', 'console.log("out"); console.error("err"); process.exitCode = 7;'],
    { encoding: 'utf8', timeout: SHIM_TIMEOUT_MS },
  );
  assert.throws(
    () => checkedOutput(result, 'failed probe'),
    (error) => {
      assert.equal(error.status, 7);
      assert.match(error.message, /stdout:\nout/);
      assert.match(error.message, /stderr:\nerr/);
      return true;
    },
  );
});
