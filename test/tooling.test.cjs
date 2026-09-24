'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveNpmCli, packProject } = require('../tools/npm-tools.cjs');
const { launchBrowser } = require('../tools/browser-launch.cjs');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-report-tooling-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fakeNpm(root, name = 'npm') {
  const dir = path.join(root, 'node_modules', 'npm');
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }));
  const file = path.join(dir, 'bin', 'npm-cli.js');
  fs.writeFileSync(file, 'throw new Error("This resolution fixture must not be executed.");');
  return file;
}

test('npm resolver accepts a verified npm_execpath', (t) => {
  const root = temporary(t);
  const npm = fakeNpm(root);
  assert.equal(resolveNpmCli({ npm_execpath: npm }, path.join(root, 'other', 'node')), npm);
});
test('npm resolver does not treat pnpm as npm, and finds the Node sibling layout', (t) => {
  const root = temporary(t);
  const npm = fakeNpm(root);
  assert.equal(
    resolveNpmCli({ npm_execpath: path.join(root, 'pnpm.cjs') }, path.join(root, 'node.exe')),
    npm,
  );
});
test('npm resolver finds a PATH prefix, including Windows-style npm.cmd layout', (t) => {
  const root = temporary(t);
  const prefix = path.join(root, "directory with spaces & apostrophe's");
  const npm = fakeNpm(prefix);
  fs.writeFileSync(path.join(prefix, 'npm.cmd'), '@echo must-not-execute-a-shell');
  assert.equal(resolveNpmCli({ Path: prefix }, path.join(root, 'other', 'node.exe')), npm);
});
test('npm resolver handles the POSIX lib/node_modules distribution layout', (t) => {
  const root = temporary(t);
  const npm = fakeNpm(path.join(root, 'lib'));
  assert.equal(resolveNpmCli({}, path.join(root, 'bin', 'node')), npm);
});
test('npm resolver rejects a foreign package even when the filename is npm-cli.js', (t) => {
  const root = temporary(t);
  const foreign = fakeNpm(root, 'pnpm');
  assert.throws(
    () => resolveNpmCli({ npm_execpath: foreign }, path.join(root, 'node')),
    /npm was not found/,
  );
});
test('an invalid explicit npm override fails instead of silently choosing another executable', (t) => {
  const root = temporary(t);
  const npm = fakeNpm(root);
  assert.throws(
    () => resolveNpmCli({ CODEX_REPORT_NPM_CLI: path.join(root, 'missing'), npm_execpath: npm }),
    /CODEX_REPORT_NPM_CLI/,
  );
});
test('npm resolver reports a missing npm without attempting installation', (t) => {
  const root = temporary(t);
  assert.throws(() => resolveNpmCli({}, path.join(root, 'node')), /No downloads were attempted/);
});
test('pack works with a pnpm npm_execpath and never runs package lifecycle scripts', (t) => {
  const root = temporary(t);
  const fakePnpm = path.join(root, 'pnpm.cjs');
  fs.writeFileSync(fakePnpm, 'throw new Error("pnpm must not receive npm-specific flags");');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'codex-report-tooling-fixture',
      version: '1.0.0',
      files: ['index.js'],
      scripts: { prepack: 'node missing-prepack-must-not-run.cjs' },
    }),
  );
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = 42;');
  const artifact = packProject(path.join(root, 'output with spaces'), {
    cwd: root,
    env: { ...process.env, npm_execpath: fakePnpm },
  });
  assert.equal(path.basename(artifact), 'codex-report-tooling-fixture-1.0.0.tgz');
  assert.ok(fs.statSync(artifact).size > 0);
});
test('browser helper passes through successful default launches', async () => {
  const browser = { marker: 'browser' };
  const result = await launchBrowser(
    {
      chromium: {
        launch: async (options) => {
          assert.deepEqual(options, { headless: true });
          return browser;
        },
      },
    },
    {},
  );
  assert.equal(result, browser);
});
test('missing Playwright binary fails with the project-specific installation command', async () => {
  await assert.rejects(
    launchBrowser(
      {
        chromium: {
          launch: async () => {
            throw new Error("Executable doesn't exist at /missing/headless_shell");
          },
        },
      },
      {},
    ),
    (error) => {
      assert.match(error.message, /pnpm run browser:install/);
      assert.match(error.message, /npm run browser:install/);
      assert.match(error.message, /not skipped/);
      return true;
    },
  );
});
test('an existing browser path is passed through without downloads', async (t) => {
  const root = temporary(t);
  const file = path.join(root, 'chrome');
  fs.writeFileSync(file, 'path fixture');
  await launchBrowser(
    {
      chromium: {
        launch: async (options) => {
          assert.equal(options.executablePath, file);
        },
      },
    },
    { CODEX_REPORT_BROWSER_PATH: file },
  );
});
test('invalid explicit browser path fails before launch', async (t) => {
  let called = false;
  await assert.rejects(
    launchBrowser(
      {
        chromium: {
          launch: async () => {
            called = true;
          },
        },
      },
      {
        CODEX_REPORT_BROWSER_PATH: path.join(temporary(t), 'missing'),
      },
    ),
    /not a browser executable file/,
  );
  assert.equal(called, false);
});
test('unrelated browser failures are not disguised as missing downloads', async () => {
  const original = new Error('A required shared library could not be loaded.');
  await assert.rejects(
    launchBrowser(
      {
        chromium: {
          launch: async () => {
            throw original;
          },
        },
      },
      {},
    ),
    (error) => error === original,
  );
});
test('browser smoke missing-binary path exits nonzero and cleans its temporary store', (t) => {
  const root = temporary(t);
  const module = path.join(root, 'mock-playwright.cjs');
  fs.writeFileSync(
    module,
    `module.exports = { chromium: { launch: async () => { throw new Error("Executable doesn't exist at /missing/headless_shell"); } } };`,
  );
  const env = {
    ...process.env,
    CODEX_REPORT_PLAYWRIGHT: module,
    TMPDIR: root,
    TMP: root,
    TEMP: root,
  };
  delete env.CODEX_REPORT_BROWSER_PATH;
  const result = spawnSync(process.execPath, [path.join(__dirname, '../tools/browser-smoke.cjs')], {
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pnpm run browser:install/);
  assert.deepEqual(
    fs.readdirSync(root).filter((name) => name.startsWith('codex-report-browser-')),
    [],
  );
});
