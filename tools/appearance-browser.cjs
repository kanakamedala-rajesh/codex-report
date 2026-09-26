'use strict';
const { runWorkspaceChecks } = require('./workstation-browser.cjs');
runWorkspaceChecks({ appearanceOnly: true }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
