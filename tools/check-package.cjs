'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const p = require('../package.json');
assert.equal(p.name, 'codex-report');
assert.equal(p.version, '0.0.1-dev');
assert.equal(p.bin['codex-report'], 'dist/cli.js');
assert.ok(
  !p.scripts.install && !p.scripts.postinstall && !p.scripts.prepare,
  'No installation side effects',
);
for (const f of [
  'dist/cli.js',
  'dist/worker.js',
  'public/index.html',
  'public/app.js',
  'public/style.css',
  'data/prices.json',
  'README.md',
  'docs/SECURITY.md',
])
  assert.ok(fs.statSync(f).isFile(), f);
const manifest = require('../runtime/manifest.json');
for (const [name, hash] of Object.entries(manifest))
  assert.equal(
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join('runtime', name)))
      .digest('hex'),
    hash,
    name,
  );
const forbidden = ['codex' + '-receipts', 'vs' + '-workspace', 'PRIVATE' + '_PROMPT'];
function scan(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isDirectory()) scan(f);
    else if (/\.(js|ts|json|html|css|md)$/.test(f)) {
      const text = fs.readFileSync(f, 'utf8');
      for (const item of forbidden)
        assert.ok(!text.includes(item), `Forbidden legacy/private text in ${f}`);
    }
  }
}
for (const dir of ['src', 'dist', 'public', 'data', 'docs']) scan(dir);
assert.ok(fs.readFileSync('dist/cli.js', 'utf8').startsWith('#!/usr/bin/env node'));
console.log('Package contracts, privacy exclusions, entrypoint and six native hashes passed.');
