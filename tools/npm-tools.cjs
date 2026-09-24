'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// npm_execpath belongs to the invoking package manager. Under pnpm it is NOT npm.
// Resolve npm's real JS entrypoint so npm-specific flags and the global-prefix
// layout below are consistent on every platform, without invoking a shell.
function resolveNpmCli(env = process.env, execPath = process.execPath) {
  function candidate(file) {
    if (!file) return null;
    try {
      const real = fs.realpathSync(file);
      if (path.basename(real) !== 'npm-cli.js' || !fs.statSync(real).isFile()) return null;
      const pkg = JSON.parse(fs.readFileSync(path.resolve(real, '../../package.json'), 'utf8'));
      return pkg.name === 'npm' ? real : null;
    } catch {
      return null;
    }
  }
  if (env.CODEX_REPORT_NPM_CLI) {
    const override = candidate(env.CODEX_REPORT_NPM_CLI);
    if (override) return override;
    throw new Error('CODEX_REPORT_NPM_CLI must point to an installed npm/bin/npm-cli.js.');
  }
  const invokingNpm = candidate(env.npm_execpath);
  if (invokingNpm) return invokingNpm;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const dirs = [path.dirname(execPath), ...(env[pathKey] || '').split(path.delimiter)];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const file of [
      path.join(dir, 'npm'),
      path.join(dir, 'node_modules/npm/bin/npm-cli.js'),
      path.resolve(dir, '../lib/node_modules/npm/bin/npm-cli.js'),
      path.resolve(dir, '../share/nodejs/npm/bin/npm-cli.js'),
    ]) {
      const found = candidate(file);
      if (found) return found;
    }
  }
  throw new Error(
    'npm was not found. Packaging uses npm explicitly even under pnpm. ' +
      'Make the npm bundled with your Node installation available, or set ' +
      'CODEX_REPORT_NPM_CLI to its npm/bin/npm-cli.js. No downloads were attempted.',
  );
}

function runNpm(args, options = {}) {
  const env = options.env || process.env;
  const npm = resolveNpmCli(env);
  const result = spawnSync(process.execPath, [npm, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`npm ${args[0]} failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function packProject(destination, options = {}) {
  const cwd = options.cwd || path.resolve(__dirname, '..');
  const dest = path.resolve(destination);
  fs.mkdirSync(dest, { recursive: true });
  const result = JSON.parse(
    runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', dest], {
      ...options,
      cwd,
    }),
  );
  const filename = result[0]?.filename;
  if (
    typeof filename !== 'string' ||
    path.basename(filename) !== filename ||
    !filename.endsWith('.tgz')
  )
    throw new Error('npm pack did not return a valid tarball filename.');
  const artifact = path.join(dest, filename);
  if (!fs.statSync(artifact).isFile()) throw new Error('npm pack did not create the tarball.');
  return artifact;
}

module.exports = { resolveNpmCli, runNpm, packProject };
