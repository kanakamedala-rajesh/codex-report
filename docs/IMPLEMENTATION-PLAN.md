# Codex Report v0.0.1-dev: implementation plan

Fresh standalone TypeScript/npm application. No previous installation, database,
Python runtime, or migration code is required. Work is local; no remote repository
or registry publication is authorized. Each phase receives a detailed Git commit.

## Phase 0 - Contract and repository

- Write this plan before initializing Git; create a new main branch.
- Freeze install > init > doctor > start --open as the acceptance journey.
- Track outcomes, unknowns, pricing coverage and source freshness separately.
- Never copy prompts, tool bodies, credentials, or private source paths into
  distributable fixtures. Preserve unrelated Codex settings and hooks.
- Gate: clean independent history and documented scope.

## Phase 1 - Tooling and runtime

- Node 18.20.8 compatibility target; maintained Node recommended.
- Strict TypeScript, Prettier, ESLint, unit/integration tests, package checks, CI.
- Precompiled application/dashboard; no consumer compiler or Python requirement.
- Select durable file-backed SQLite and bounded Zstandard decoding. Isolate
  upstream runtime dependencies behind small adapters. State actual target tests.
- Gate: executable CLI, database transaction/rollback/backup, compressed fixture.

## Phase 2 - Accounting and persistent ingestion

- Immutable physical-thread owner, inherited-header rejection, explicit request,
  root-turn and child identities; idempotent native and conservative legacy import.
- Incremental per-source cursors committed with usage; crash recovery, partial-line
  handling, compression transitions, scope-specific health and quota-only events.
- SQLite source of truth; frozen prices, explicit accounts, revision and audit log.
- Gate: synthetic regression matrix, persistent replay and duplicate invariants.

## Phase 3 - Reports, configuration and maintenance

- Tokens/cache/reasoning, task vs direct thread, outcomes, duration, counts and
  unpriced reasons; account/model/date filters, rolling five hours and billing cycles.
- Dated pricing, explicit aliases, preview/apply repricing, subscription comparisons.
- JSON/CSV/standalone HTML, metadata-only device exchange, backup/restore, diagnostics.
- Gate: arithmetic, unknown-state, timezone, privacy and round-trip tests.

## Phase 4 - Real onboarding and hook integration

- init/setup creates fresh state; safe idempotent hook merge with backups and trust
  left to Codex. No npm lifecycle script mutates Codex or starts processes.
- Short Stop and manual Interrupt receipts; silent child/start reconciliation.
- Event-specific deadlines; failure-open output; no history scans in cancel path.
- Optional run wrapper prints a final report after child exit. No active TUI writes.
- Gate: actual CLI init/re-init/uninstall, generated hook stdin, cancelled turn.

## Phase 5 - Collector and dashboard service

- Explicit foreground start, single instance per store; periodic incremental
  reconciliation to recover missed notifications and unhooked failures.
- Loopback-only authenticated API, host/origin validation, bounded input, CSP;
  never serve raw database/config/transcripts. Read-only browser API.
- Browser revision polling or SSE updates; last-observed/freshness is visible.
- Gate: live append/failure collection, auth, concurrency, orderly shutdown.

## Phase 6 - Dashboard

- Responsive Overview, Turns, Limits, Data Health with expandable detail and filters.
- Live refresh preserves selection. Local assets only; no telemetry, remote fonts,
  cloud account, or model calls. Empty/loading/error/unpriced states are first-class.
- Browser open only when requested. Static HTML export retained.
- Gate: real server/browser, small/wide viewport, filters and failure scenario.

## Phase 7 - Release validation and packaging

- Run format:check, lint, type-check, tests, build, package-smoke, privacy checks.
- npm pack and actual isolated global-prefix install; init > doctor > sync > start
  > hook > reports > restart > uninstall-hooks with synthetic temporary homes.
- CI targets Windows, macOS and Linux on Node 18.20.8/22/24. Never imply unexecuted
  CI or missing OS/runtime tests passed. Record actual evidence and limitations.
- Deliver installable tgz, clean source with Git history, bundle, plan and test report.
- Gate: usable application, not a preview-only checkpoint; no placeholder commands.

## Preserved invariants

Request usage is counted once. Reasoning is part of output; cached input is part
of input. Stop is a stopping attempt, Interrupt is manual cancellation, and a
persisted terminal event determines final outcome. Limit percentages are provider
observations, not reconstructed token entitlements. Unknown prices are not zero.
Explicit account assignments are not inferred from credentials. The dashboard
never mutates configuration. Device exchange never shares a live SQLite file.

## Stop/rollback boundaries

Do not edit original user uploads, existing installations, credential files, or
production code. All verification uses disposable homes. Back up before explicit
maintenance writes. Unsupported schemas/formats remain reported; do not fabricate
completeness. Do not auto-publish, push, register startup services, or approve hooks.
