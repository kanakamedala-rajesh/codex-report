# Sessions, settings and usage-limit presentation patch

Target: `codex-report` **0.0.1-dev**. Date: September 24, 2026.
Apply this patch **after the preceding tooling-fixes patch** for the same release.
The original release base was `e00cc92241b9ccd980813a821f613557b563b184`.
No package version, dependencies, lockfile, native decoder, or database schema changes.

## Apply, validate and rebuild

From the source repository root:

```sh
git apply --check ./codex-report-0.0.1-dev-sessions-settings.patch
git apply ./codex-report-0.0.1-dev-sessions-settings.patch
pnpm run verify
pnpm run test:browser
pnpm run pack:local
```

Run `pnpm run browser:install` first only if the matching Playwright Chromium
binary has not already been installed. This remains a test-only prerequisite.
The prior tooling patch supplies `pack:local`, `browser:install`, and the npm/pnpm
resolver fixes. Review conflicts rather than forcing application over local edits.

`pack:local` creates `codex-report-0.0.1-dev.tgz` in the repository root. Stop the
running collector before installing the updated archive:

```sh
codex-report stop
npm install -g --ignore-scripts ./codex-report-0.0.1-dev.tgz
codex-report start --open
```

Open the new tokenized address, or the browser window opened by `--open`. An old
browser tab may need a fresh token exchange after the server restart. Keep private
access tokens out of screenshots and issue reports. Do not delete your database,
run a full reset, or rerun init; existing hook definitions and data remain valid.

## Sessions

The navigation and page are renamed **Sessions**. Each stable root thread becomes
one expandable session, including resumed work. Its title defaults to the recorded
start date/time, with a short ID for disambiguation. Within-session turn numbers
are preserved, including when a date/model/account filter hides earlier turns.

Open a session to see its turns, costs, outcomes and linked workers/reviewers.
Session totals are **for the active selection**, not automatically lifetime totals.
A resumed session therefore retains its original start label while displaying only
the usage in the currently selected period. Session summaries expose separate
completed, interrupted, usage-exceeded and other-failure counts rather than claiming
the entire reusable session is permanently finished.

**Name session** adds an optional local nickname. Clear it to restore the default.
This does not rename the Codex thread or extract any prompt text. Local names are
stored in config and included in explicitly exported report JSON. Configuration
is not synchronized by the metadata exchange archive.

Search by name, ID, or start date. Sessions are paginated (10/20/50 per page) rather
than discarding turns after the old 200-turn view limit. A long session initially
shows its latest 50 turns, with an explicit control for earlier turns. Live refresh
preserves expanded session and turn state. Mobile navigation wraps so Settings is
not hidden offscreen.

## Settings

The new Settings page edits only an allowlist of relevant options:

- Dark / Light / System theme, default page, period, account, model and page size.
- Reporting timezone and Compact / Detailed / Quiet terminal receipts.
- Per-account monthly billing start day, renewal time, optional account timezone,
  and optional USD or local-currency subscription comparison with manual FX.

Billing start means the recurring **day of the month**, not a one-time start date
that excludes earlier records. A blank day selects calendar-month reporting.
Choose the appropriate account in the report filter to use its billing calendar;
`all` is deliberately not an inferred combination of several account calendars.
None of these edits change recorded token counts, attribution or frozen prices.

Save settings explicitly. Theme/reporting/billing changes apply to the running
collector without another restart. Default page/filters apply on the next dashboard
opening; existing report filters are not forcibly changed. Unsaved fields survive
refresh and clicking the current Settings navigation item. Leaving with unsaved
changes asks before discarding them. Reload/discard reloads the current config.

The HTTP API returns only editable values, never tokens, device identity or source
paths. Writes require authentication, same-Origin for browser cookies, JSON content,
a 64 KiB body bound and an expected config revision. Stale edits return HTTP 409.
Invalid or unknown fields are rejected before any backup/write. An accepted change
makes a private config backup, performs an atomic config replacement and updates
the shared worker settings. It records an audit entry without copying the submitted
values; an audit failure after a successful save is reported explicitly as a warning.

No source-path editing, port/token changes, arbitrary config replacement, price-table
changes or database access was added to the browser. Internal hook/sync/stop routes
remain bearer-only.

## Usage-exceeded outcomes

Only `status=failed` with the exact `error=usage_limit_exceeded` maps to the visible
**Usage exceeded** label. Other errors remain Failed; manual cancellation remains
Interrupted. No tokens or statuses are rewritten in the ledger.

The common mapper is used by the dashboard, terminal receipts and human reports.
JSON retains the raw `status`/`error` and adds `displayOutcome`. Its original
`statistics.failed` stays inclusive for compatibility; `usageExceeded` and
`otherFailed` provide explicit breakdowns. CSV appends `display_status` and `error`
without changing existing column positions. Session rows reference existing task
IDs rather than duplicating all task payloads.

## Executed verification

Environment: Linux x64, Node 22.16.0, npm 10.9.2, TypeScript 5.8.3,
`@types/node` 25.1.0 available locally, built-in SQLite. Prettier 3.9.9 was loaded
from the previously supplied upstream build, not substituted with another formatter.
No dependency versions in your project were changed.

- **105 tests passed**, no failures or skips: 66 preceding tests plus 39 new cases.
- Strict application and browser type-checks passed.
- Repository-wide Prettier check and Git whitespace checks passed.
- Actual packed npm installation smoke passed in an isolated offline prefix,
  using the enabled built-in SQLite backend.
- Real loopback HTTP tests exercised auth, cookie/origin checks, allowed settings,
  JSON/body limits, rejected unknown fields, concurrent stale-save conflicts,
  live config updates, disk persistence across restart, and preserving raw samples.
- Grouping tests cover same-numbered turns in separate sessions, resumed sessions,
  selected-period totals, children counted once, zero-usage failures, local names,
  exact usage-exceeded classification, and more than 200 root turns.
- Chromium offline DOM tests passed for grouped sessions, search, local nicknames
  rendered as text, unsaved settings preservation, saving, all three theme modes,
  retained expansion, and desktop/mobile layouts. No external requests or page
  errors were observed. Screenshots contain synthetic data only.

The actual browser-to-loopback navigation was attempted and rejected by the host
browser policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). It was not bypassed. The DOM test
uses synthetic responses and is **not** a live browser-to-server verification. Real
HTTP behavior was exercised independently. The available renderer was Chromium
144.0.7559.96 / Playwright 1.57.0-beta-1764944708000, not the project's pinned 1.56.1.

`pnpm lint`/full ESLint could not run here: ESLint is not installed and the npm
registry cannot be resolved. No lint rules were disabled or errors ignored. Run
`pnpm run verify` with your installed dependencies. Native libSQL, exact Node 18,
Windows/macOS/ARM64 and remote CI were not executed. Compatibility targets are
unchanged; no target-runtime passes are implied by host tests.

All original source/config/usage attachments were left unchanged. This patch does
not publish a package, operate on your device, or include personal session records.
