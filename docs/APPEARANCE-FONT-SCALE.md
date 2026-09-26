# Palette and whole-dashboard text scaling

Base: PR #1 at `26c4d7781ae895e1af5bd85805be388f2e97772a`.
Package version remains `0.0.1-dev`. Desktop use is the target.

## User-facing changes

Replace the previous slate/teal treatment with near-black dark surfaces and crisp
white light surfaces, indigo primary actions, violet secondary emphasis, and
emerald/amber/rose semantic states. Interrupted and Usage exceeded now have
different colors as well as different labels. Use the actual native system sans
rather than relying on an unavailable named web font. There are no font downloads.

Settings > Appearance > Text size accepts a whole-number reference size from
14 through 24, default 17. Use the numeric field, the keyboard-operable slider,
or Reset to 17. The entire current document previews the choice immediately;
Save settings persists it for this installation. Discard changes restores the
saved theme and size. Tabs retain unsaved edits. Saving failures retain the draft.

All text is proportional to the same root, not a body-only override: navigation,
filters, status labels, dates, chart labels, tables, session and turn details,
forms, notices, footers, diagnostics, and dialogs. Layout spacing and controls
scale too and reflow when needed. The reference pixels assume the browser's
ordinary 16px initial setting; browser text defaults and zoom remain effective.
Browser-owned chrome and terminal font preferences are not changed.

## Compatibility and security

`dashboard.fontSize` is an additive optional preference, not a ledger migration.
Reading an older configuration supplies the 17 default without rewriting it.
The server accepts integer numbers only in 14..24; strings, null, fractions,
non-finite values and out-of-range input are rejected before a write or backup.
Existing authenticated/same-origin write rules, revision conflicts, private
settings backups and audit entries remain in force. No styles or arbitrary paths
can be supplied through this setting. Existing recorded tokens, applied prices,
source ownership, token secrets and device IDs are preserved.

The browser selects a validated attribute with predeclared percentage rules;
it does not inject inline CSS or weaken the Content Security Policy. Every
component font uses rem/inheritance. Containers adapt to the scaled text rather
than clipping it or shrinking fonts at a laptop breakpoint. Save controls are in
normal flow so they cannot cover enlarged form content.

## Impeccable-guided audit

**PASS for the measured desktop scope**, not a full accessibility certification
or a green claim for the separate pinned CI/platform matrix. gpt-taste guided the
visual rework; Impeccable colorize/typeset/craft-floor/audit guidance was used for
the direct checks. Its binary launcher could not download in this environment,
so the detector was not executed.

| Dimension                | Direct score / 4 | Evidence and scope                                                                                                               |
| ------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility            | 3                | Visible text contrast, control sizes/names, keyboard slider, invalid-field focus; no physical assistive-technology certification |
| Performance              | 3                | One root attribute update, no re-render needed for scaling, no new dependencies/assets; no new workload benchmark                |
| Desktop reflow           | 4                | 1280/1440/1920 CSS-pixel windows at 14,17,24; local table scrolling rather than page overflow                                    |
| Theming                  | 4                | Dark/light/system, semantic tokens, coherent hover and selected states                                                           |
| Implementation integrity | 4                | Shared root scale, server validation, persistence, backward compatibility and revision checks                                    |
| Total                    | 18 / 20          | Excellent within the stated direct scope; remaining execution limits below                                                       |

The first inspection identified a transition-only contrast problem: text changed
theme immediately while button backgrounds interpolated from the old theme.
Background crossfading was removed; border feedback remains. A sticky save bar
also obscured part of the size preview during full-page inspection; save controls
now occupy ordinary document flow. Neither was hidden by removing an assertion.
The confirmation pass found no remaining sampled contrast/control/overflow defect.

## Executed verification

- **133 automated tests passed**, zero failures or skips: the prior 105 plus 28
  new preference/validation/HTTP/style-contract cases.
- Strict application and browser TypeScript checks passed.
- Prettier 3.9.9 checks passed for changed files.
- **44 browser checkpoints passed**, including 42 view/section/theme/viewport
  combinations at three sizes plus interaction/dialog/system-theme checks.
- **4,266 visible text-bearing element observations** were measured at nominal
  17; their 14-to-24 computed font-size ratios were checked individually. Native
  placeholders and all visible dialog descendants were checked separately.
- All five views, expanded session/turn details, and all three settings sections
  were included. No measured page horizontal overflow remained.
- UI interaction checks exercised numeric and keyboard slider input, preview,
  reset, tab retention, cancel/accept discard, save/readback, invalid-size focus,
  reload/discard, theme changes and reduced-motion rendering.
- Real HTTP tests independently verified authentication/origin checks, invalid
  inputs, stale revisions, hot settings reads, audit entries and restart
  persistence. A non-empty sample's full stored record was compared before/after
  the font-size write, including its price and owner.

Browser testing locally used **explicit offline API fixtures**, seeded from an
actual synthetic collector. Live browser navigation was attempted and blocked
by managed browser policy; it was not bypassed or silently treated as a pass.
The default test mode remains a real authenticated browser-to-service test.
The fixture's behavior checks do not substitute for the separate HTTP tests.

Local tools: Linux x64, Node 22.16.0, built-in SQLite, TypeScript 5.8.3,
available @types/node 25.1.0, Prettier 3.9.9, Chromium 144.0.7559.96 and the
available Playwright harness. This is not the pinned cross-platform matrix.
ESLint/pnpm dependency execution, exact Node 18/libSQL, Windows/macOS and physical
browser zoom/OS font changes were not executed here. No new package-install pass
is claimed. Existing lint and CI gates remain mandatory and were not disabled.

## Validate and try

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
# One time, or after changing the pinned Playwright dependency:
pnpm run browser:install
pnpm run test:browser
# Run only the added appearance checks:
pnpm run test:appearance
pnpm run pack:local
```

The new appearance suite runs after the existing browser smoke in `test:browser`.
It uses only disposable synthetic records. `CODEX_REPORT_UI_OUTPUT` retains its
screenshots and machine-readable audit. `CODEX_REPORT_BROWSER_FIXTURE=1` explicitly
selects offline DOM fixtures for restricted environments; never call that a live
browser transport pass. A failed browser launch remains a failure.

Pull the PR branch, build/reinstall the newly generated scoped tarball, and
restart the collector. Do not delete the ledger or rerun init. No new dependency
installation or lockfile update is needed for the preference itself.
