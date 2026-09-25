# Desktop readability rework: Impeccable audit

Date: September 25, 2026.
Base: PR #1, `8ba9f0fec3d95bec042a2762eaf0e46fea12e572`.
Scope: all five desktop pages, plus settings sections and interaction states.

## Verdict

**PASS for the directly inspected desktop UI scope.** No outstanding P0 or P1
finding was observed in the tested states. This is an Impeccable skill-guided
code/browser audit, not execution of its binary detector or an accessibility
certification. The engine launcher was attempted and failed to download because
DNS was unavailable. Its Operate, craft-floor, and audit references were used
with direct measurable checks. gpt-taste informed the replacement hierarchy and
composition; the task UI retains product-oriented controls instead of marketing
scroll choreography.

The latest full CI/platform result is a separate release gate; a local UI audit
must never stand in for that result.

## Initial findings and corrections

| Severity     | Finding                                                                         | Correction                                                                                                |
| ------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| P1 usability | 14px base, 13px labels and 12px metadata made prolonged reading uncomfortable   | 17px body/control text; 16px notes/labels/metadata; 24px section and 36px page headings                   |
| P1 usability | Parallel chart and model panels compressed readable data on laptops             | One wide breakdown with By day / By model controls and an exact-values table                              |
| P2           | Long settings page competed with dense field explanations                       | Three keyboard-operable sections retaining a single mounted form                                          |
| P2           | Session rows mixed identifiers, repeated dates, badges and counts               | Clear name/date, turn summary and estimate columns; technical identifiers behind disclosures              |
| P2           | Empty-cost text could crowd the estimate column                                 | Wrapping, ordinary-sized no-estimate text instead of a large numeric style                                |
| P2           | Multiple invalid fields on hidden settings panels could fight for browser focus | Explicit first-invalid-field validation using native constraints; reveal that panel before reportValidity |
| P2           | Refresh could interrupt copying values or naming                                | Pause background rendering during text selection/rename; retain disclosure and focus keys                 |

No data schema, price, collector, hook, API route, dependency, package-version or
saved-setting format was changed. JSON export and original failure details remain.
No private records or font files are included.

## Audit dimensions

Scores describe this bounded inspection, not certification or measured production
performance. Phone layouts are intentionally outside the user's target scope.

| Dimension                | Score | Evidence / boundary                                                                                                                                                                          |
| ------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessibility            | 3/4   | Sampled visible text meets 4.5:1 normal / 3:1 large contrast; named controls; keyboard tabs, invalid-field focus and dirty-form behavior checked. Screen-reader certification not performed. |
| Performance              | 3/4   | No added runtime dependencies or external assets; seven visible daily bars; coalesced refresh and stale-result rejection retained. Large-history rendering not benchmarked.                  |
| Desktop adaptability     | 4/4   | 1280, 1440, 1920 and 960 CSS-pixel computer windows checked without page overflow or smaller text. 960 is narrow-window/zoom-equivalent reflow, not a claim of actual OS zoom testing.       |
| Theming                  | 4/4   | Dark/light surfaces plus system/light and reduced-motion combinations checked using the same tokens.                                                                                         |
| Implementation integrity | 4/4   | Existing APIs and constraints retained; no made-up metrics; all five views functional; automated measurements and interaction assertions pass.                                               |
| Total                    | 18/20 | Excellent within the declared inspection scope                                                                                                                                               |

## Executed checks

- 105 existing automated tests passed, with zero failures and zero skips.
- Strict application and browser TypeScript checks passed.
- Real Prettier 3.9.9 check passed for all changed implementation and test files.
- 27 desktop browser checkpoints passed. The minimum sampled visible text was
  16px; no sampled contrast failure, unnamed/undersized control, duplicate ID,
  extra page heading or page overflow remained.
- Browser behavior checked day/model switching, exact values, session search,
  safe nickname rendering, expanded-state retention, edits across settings tabs,
  dirty-navigation cancellation, first invalid field across multiple tabs,
  save/conflict recovery, roving tab keyboard controls, system theme, empty and
  offline recovery, and rejection of stale model-filter results.
- The source/test backend files used for local replay were checked against their
  GitHub blob hashes. Only the frontend, browser harness, and design/audit docs
  are part of this rework.

Browser execution here used explicit offline API fixtures generated from a real
synthetic collector snapshot. Actual HTTP behavior is covered separately by the
existing integration tests. A live browser navigation attempt was blocked by the
managed environment policy, `ERR_BLOCKED_BY_ADMINISTRATOR`; it was not bypassed.
The default browser test still uses the live authenticated service. Fixture mode
requires an explicit environment variable and is never an automatic fallback.

Host: Linux x64, Node 22.16.0, TypeScript 5.8.3, available @types/node 24.0.4,
Prettier 3.9.9, Chromium 144.0.7559.96, available Playwright
1.57.0-beta-1764944708000. This differs from the pinned Playwright dependency.
ESLint/pnpm were unavailable locally; no lint rule was disabled. Native Windows,
macOS, Node 18/libSQL and the complete pinned CI matrix were not executed here.

## Repeat on the repository's pinned environment

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
pnpm run browser:install
pnpm run test:browser
pnpm run pack:local
```

The browser test now targets computer windows, not phone touch/drawer behavior.
`CODEX_REPORT_UI_OUTPUT` optionally retains screenshots and its JSON audit report.
`CODEX_REPORT_UI_FIXTURE=1` explicitly selects the isolated fixture path only when
that limited evidence is desired; it is not proof of live browser connectivity.

Runtime file blobs used in the passing audit:

```text
public/index.html fd5210c0805a088b99e60ee1bb1f5dbbc83a986a
public/style.css 36a217843928cae172488584cac8d8077ba3a06d
public/app.js e9fcd6a52f7e7e28ec27fa1cbd8d1227bd1ca079
```
