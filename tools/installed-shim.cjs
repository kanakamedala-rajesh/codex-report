'use strict';
const { spawnSync } = require('node:child_process');

const SHIM_TIMEOUT_MS = 60000;
const SHIM_PATH_VARIABLE = 'CODEX_REPORT_PACKED_SHIM';

/** Fail on launch errors, timeouts, signals and nonzero exits without hiding diagnostics. */
function checkedOutput(result, label, timeoutMs = SHIM_TIMEOUT_MS) {
  if (result.error || result.signal || result.status !== 0) {
    const reason = result.error
      ? `${result.error.code || result.error.name}: ${result.error.message}`
      : result.signal
        ? `terminated by ${result.signal}`
        : `exit status ${String(result.status)}`;
    const error = new Error(
      `${label} failed (${reason}; timeout ${timeoutMs}ms).\n` +
        `stdout:\n${result.stdout || '(empty)'}\nstderr:\n${result.stderr || '(empty)'}`,
      result.error ? { cause: result.error } : undefined,
    );
    if (result.error?.code) error.code = result.error.code;
    error.status = result.status;
    error.signal = result.signal;
    throw error;
  }
  return String(result.stdout || '');
}

/** Exercise the installed npm shim, not its JS entrypoint or a PowerShell host. */
function readShimVersion(shim, options = {}) {
  const platform = options.platform || process.platform;
  const env = { ...(options.env || process.env) };
  const launch = options.spawnSync || spawnSync;
  if (typeof shim !== 'string' || !shim || ['\0', '\r', '\n'].some((c) => shim.includes(c)))
    throw new Error('A single valid installed shim path is required.');

  const spawnOptions = {
    encoding: 'utf8',
    timeout: SHIM_TIMEOUT_MS,
    windowsHide: true,
    shell: false,
    env,
  };
  let executable = shim;
  let args = ['--version'];
  if (platform === 'win32') {
    if (shim.includes('"')) throw new Error('A Windows shim path cannot contain double quotes.');
    const comspec = Object.keys(env).find((key) => key.toLowerCase() === 'comspec');
    executable = (comspec && env[comspec]) || 'cmd.exe';
    // Windows environment keys are case-insensitive. Do not retain a differently
    // cased copy that could take precedence over the fixture's exact path.
    for (const key of Object.keys(env))
      if (key.toUpperCase() === SHIM_PATH_VARIABLE) delete env[key];
    env[SHIM_PATH_VARIABLE] = shim;
    // /d disables AutoRun; /v:off keeps literal ! in paths. Expanding one quoted
    // variable avoids interpolating path characters into command syntax. No CALL
    // is used: its second expansion would interpret percent signs in the path.
    args = ['/d', '/s', '/v:off', '/c', `""%${SHIM_PATH_VARIABLE}%" --version"`];
    spawnOptions.windowsVerbatimArguments = true;
  }
  return checkedOutput(launch(executable, args, spawnOptions), 'Installed codex-report shim');
}

module.exports = { SHIM_TIMEOUT_MS, checkedOutput, readShimVersion };
