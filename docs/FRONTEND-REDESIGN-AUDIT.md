# Frontend redesign: verification and audit

Date: September 25, 2026.
Base: `41d100a76fe23086e660143f6d2cbaa07822eab9`.
Branch: `feat/dashboard-redesign`.

## Scope and implementation integrity

The runtime changes are limited to `public/index.html`, `public/app.js`, and
`public/style.css`. The existing five views are rebuilt, not replaced with a
standalone mockup. Reporting requests, Settings payloads, revision-conflict
checks, saved preferences, session nicknames, search, pagination, turn expansion,
and JSON export retain their existing contracts.

No backend, database, pricing, collector, hook, package-version, dependency,
lockfile or network-policy changes are included. All visualized quantities come
from the existing report response. No additional fonts, telemetry, remotely
loaded assets or fabricated trend data are introduced.

The code uses a graphite/warm-linen token system with copper emphasis, native
controls, authored SVG icons and data graphics. The activity chart displays the
latest 14 recorded day categories, explicitly not a continuous-time interpolation.
Its exact-values disclosure remains available to keyboard and screen-reader users.
Unknown and partially priced work stays visibly distinct from known zero.

## Audit method and result

**Direct technical audit: PASS within the exercised scope.**

The design was informed by the published gpt-taste guidance and the Impeccable
technical-audit playbook. The Impeccable launcher/detector was not available and
was not run. This report records direct code review, browser inspection and the
committed `tools/ui-audit.cjs` checks; it is not a claim of an Impeccable binary
result, an independent accessibility certification, or exhaustive WCAG conformance.

| Dimension             | Exercised checks                                                                                                                             | Result                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Accessibility         | Visible sampled text contrast, named controls, one page heading, unique IDs, labelled exact-value table, mobile Escape/focus return          | Passed                                                                       |
| Responsive behavior   | Desktop 1440px, mobile 390px, narrow 320px, Settings and session layouts, visible controls at least 44px with subpixel tolerance             | Passed                                                                       |
| Theming               | Dark, Light and System behavior; computed colors and contrast in the selected surfaces                                                       | Passed                                                                       |
| Interaction           | Five views, session naming/search/expansion, refresh retention, account filter, Settings save and unsaved-field preservation                 | Passed                                                                       |
| Performance/integrity | No external browser requests, no new runtime dependencies, bounded 14-day chart, resize debouncing, no new full-history collection in the UI | Passed by inspection and functional checks; no performance benchmark claimed |

The first inspection identified intermediate theme-transition contrast and a
mobile navigation visibility transition affecting accessibility checks. These
were corrected by removing surface-color and visibility transitions while
retaining restrained border/drawer feedback. Chart dimensions and date labels
were also adapted for narrow screens. The confirmation run passed all checks.

The UI check is deliberately bounded: it samples visible text styles against
computed ancestor backgrounds, measures control boxes, and checks basic DOM
semantics. It does not establish assistive-technology behavior on physical devices,
all zoom/forced-color combinations, non-text contrast everywhere, or every possible
user-generated string.

## Executed verification

| Check                    | Evidence                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing automated suite | 105 passed, zero failures and zero skips                                                                                                                                         |
| Application type-check   | TypeScript strict no-emit check passed                                                                                                                                           |
| Browser type-check       | Checked JavaScript against shared backend types; passed                                                                                                                          |
| Prettier                 | Changed runtime and browser-test files passed Prettier 3.9.9                                                                                                                     |
| Build                    | Actual TypeScript build passed                                                                                                                                                   |
| Packed installation      | Actual scoped npm package, generated CLI shim, init/repeat init, self-test, HTTP authentication, failure collection, interruption, backup/restore, exchange and uninstall passed |
| Browser UI               | Ten surface/theme/viewport checkpoints passed using an explicit offline DOM fixture with a real synthetic collector snapshot                                                     |
| Private-data boundary    | Synthetic records only; no real usage logs, tokens or private config included                                                                                                    |

The browser run covered Overview, Sessions, Usage comparison, Data health,
Settings dark/light, mobile Settings/Sessions/Overview, and Overview at 320px.
It checked that local names are rendered as text rather than HTML, expanded state
survives refresh, Settings edits survive background updates, System follows the
emulated color preference, the mobile drawer makes main content inert, Escape
restores focus, and reduced-motion removes the drawer transition.

Machine-readable results are in `docs/evidence/frontend-redesign-ui.json`.

### Environment and limitations

Executed on Linux x64 / Node 22.16.0 / npm 10.9.2, with TypeScript 5.8.3 and
Prettier 3.9.9. Available `@types/node` was 24.0.4, rather than the repository's
22.19.7 pin. Available browser tooling was Chromium 144.0.7559.96 with Playwright
1.57.0-beta-1764944708000, rather than the repository's Playwright 1.56.1 pin.
No dependency or lockfile was changed to accommodate the build environment.

A live browser-to-loopback attempt failed with `ERR_BLOCKED_BY_ADMINISTRATOR`.
No bypass was attempted. The explicit fixture mode loads the same checked-in UI
into a browser and supplies synthetic responses; the actual authenticated HTTP
service and persistence are exercised separately by integration/package tests.
Fixture results must not be reported as a live browser-to-server pass.

ESLint and pnpm were unavailable locally, so full `pnpm verify` is not claimed.
The packed test used the documented offline mode with built-in SQLite. Exact
Node 18, libSQL, Windows, macOS and ARM64 were not exercised in this redesign run.
Remote CI results are separate from these local results.

## Reproduction on a normal development machine

Use the repository's pinned package manager/dependencies and the matching
Playwright Chromium installation:

```sh
pnpm install --frozen-lockfile
pnpm run format:check
pnpm run lint
pnpm run type-check
pnpm test
pnpm run test:package
pnpm run browser:install
pnpm run test:browser
pnpm run pack:local
```

The ordinary browser command still attempts the live local service. Fixture mode
must be selected explicitly with `CODEX_REPORT_BROWSER_FIXTURE=1`; it is not an
automatic fallback on a failed live test. `CODEX_REPORT_SCREENSHOTS` can select a
local output directory for synthetic screenshots.

## Deployment and rollback

Review the feature branch/PR before merging. Build and reinstall the resulting
package through the existing workflow, then restart the collector to load the
new frontend assets. Do not delete the ledger or rerun initialization for this UI
change. Existing preferences, nicknames and applied prices remain in place.
Rollback consists of reverting the frontend/test commits and reinstalling the
previous package; no schema or data migration is involved.
