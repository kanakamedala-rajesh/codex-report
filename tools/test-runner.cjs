'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = fs
  .readdirSync('test')
  .filter((file) => file.endsWith('.test.cjs'))
  .sort()
  .map((file) => path.join('test', file));
const flags = process.argv.includes('--coverage') ? ['--experimental-test-coverage'] : [];
const child = spawnSync(process.execPath, [...flags, '--test', ...files], { stdio: 'inherit' });
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
