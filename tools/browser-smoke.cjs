'use strict';
const { runWorkspaceChecks } = require('./workstation-browser.cjs');
runWorkspaceChecks().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
