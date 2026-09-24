'use strict';
const path = require('node:path');
const { packProject } = require('./npm-tools.cjs');

try {
  if (process.argv.length > 2)
    throw new Error('Usage: npm run pack:local (or pnpm run pack:local)');
  console.log(`Created ${packProject(path.resolve(__dirname, '..'))}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
