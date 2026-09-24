'use strict';
const path = require('node:path');
const packageJson = require(path.resolve(__dirname, '../package.json'));
const { VERSION } = require('../dist/version.js');
const tag = process.argv[2];

if (process.argv.length !== 3 || !tag) {
  console.error('Usage: node tools/check-release-version.cjs <release-tag>');
  process.exitCode = 1;
} else if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageJson.version)) {
  console.error(`Refusing to stage prerelease or invalid package version: ${packageJson.version}`);
  process.exitCode = 1;
} else if (VERSION !== packageJson.version) {
  console.error(
    `Built application version ${VERSION} does not match package version ${packageJson.version}.`,
  );
  process.exitCode = 1;
} else if (tag !== `v${packageJson.version}`) {
  console.error(`Release tag ${tag} must match v${packageJson.version}.`);
  process.exitCode = 1;
} else {
  console.log(`Release tag ${tag} matches package version ${packageJson.version}.`);
}
