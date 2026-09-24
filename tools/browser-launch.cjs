'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Browsers are development-test prerequisites, not application dependencies.
// Never download them or silently skip a test from this helper.
async function launchBrowser(playwright, env = process.env) {
  const options = { headless: true };
  if (env.CODEX_REPORT_BROWSER_PATH) {
    const file = path.resolve(env.CODEX_REPORT_BROWSER_PATH);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      throw new Error(`CODEX_REPORT_BROWSER_PATH is not a browser executable file: ${file}`);
    options.executablePath = file;
  }
  try {
    return await playwright.chromium.launch(options);
  } catch (error) {
    if (/Executable doesn't exist/.test(String(error.message))) {
      throw new Error(
        'The Playwright Chromium binary for the installed playwright-core version is missing.\n' +
          'One-time browser setup (repeat after upgrading Playwright):\n' +
          '  pnpm run browser:install\n' +
          '  # or: npm run browser:install\n' +
          'Then rerun test:browser. This is a test-only prerequisite; the application does not need it.\n' +
          'Alternatively set CODEX_REPORT_BROWSER_PATH to a compatible existing Chromium executable.\n' +
          'No browser was downloaded and the test was not skipped.\n\n' +
          error.message,
      );
    }
    throw error;
  }
}
module.exports = { launchBrowser };
