# Dashboard redesign

Base: `41d100a76fe23086e660143f6d2cbaa07822eab9` (main).
Branch: `feat/dashboard-redesign`.

## Product and direction

Codex Report is a local analytics workspace for understanding recorded Codex
work. The interface must make selected-period totals, sessions, partial pricing,
quota observations and collector health easy to distinguish. It must not imply
that API-equivalent cost is a subscription invoice or that missing data is zero.

Replace the incumbent visual system with graphite and warm-linen themes,
restrained copper emphasis, tabular measurements, compact aligned session rows,
and an activity visualization drawn from actual report data. This is a working
tool, not a landing page: no decorative hero, stock imagery, artificial trends,
scroll hijacking, animation framework or externally loaded assets.

The design uses the gpt-taste upstream guidance for hierarchy, composition and
contrast, and the Impeccable technical audit playbook for accessibility,
performance, theming, responsiveness and implementation integrity. The
Impeccable launcher is unavailable in the execution environment; its context is
read from the repository and its upstream references rather than represented as
an executed binary. Any review results must distinguish those checks.

## Implementation phases

1. Replace the shell and token system; rebuild Overview, Sessions, Usage
   comparison, Data health, Settings and the rename dialog. Preserve API routes,
   request payloads, saved defaults, session nicknames and original outcome codes.
2. Preserve keyboard navigation and expanded state across refresh; add explicit
   loading, empty, error and offline states; verify light/dark/system themes,
   reduced motion, readable mobile controls and unsaved-settings protection.
3. Run the existing test suite and browser type-check, extend browser regressions,
   inspect desktop/mobile renders together, correct verified issues, and run a
   confirmation audit. Record actual results and unavailable checks. Open a pull
   request without merging or changing main.

## Non-goals and preserved contracts

- No database/schema, collector, pricing, hook, CLI or runtime changes.
- No dependency, lockfile, package version, telemetry or network-policy changes.
- Settings retain revision conflict checks, validation and existing write limits.
- Session search, pagination, naming, turn expansion, account/model/period filters
  and JSON export remain available.
- Completed, Interrupted, Usage exceeded and Failed remain distinct.
- No private session content or real user data enters tests or screenshots.
- No font files or external assets are bundled.

## Acceptance

The existing automated tests must continue to pass. The changed browser code
must pass the strict browser type-check and formatting checks. Browser checks
must exercise all five views, settings save/conflict/dirty states, safe nickname
rendering, filter retention, dark/light/system themes, keyboard access and small
viewports. Audit evidence must identify whether it used a live local server or
an isolated fixture; one must not be presented as the other.

The published npm scope and package-manager configuration from main remain
untouched. This redesign does not change Node compatibility guarantees.
