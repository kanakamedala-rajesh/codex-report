# Codex Report v0.0.1-dev

A fresh, standalone npm application for local Codex usage reporting. It includes
real initialization, persistent accounting, readable turn/interruption reports,
an explicit foreground collector, and a live browser dashboard. No previous
application, migration, Python installation, API key, or paid API call is required.

**This is a development release.** The application is implemented and exercised
on Linux x64 / Node 22.16.0. Windows, macOS, ARM64 and the exact Node 18.20.8
runtime are target platforms, not claimed runtime passes in this build. See
[verification](docs/TEST-REPORT.md) for the executed evidence and open gates.

## Install the packed application

Download the actual `codex-report-0.0.1-dev.tgz` supplied with this release. Do not
install an unrelated package by guessing the public registry name: this project
has not been published to npm.

```sh
npm install -g --ignore-scripts ./codex-report-0.0.1-dev.tgz
codex-report --version
codex-report init
codex-report doctor
codex-report self-test
codex-report sync
codex-report start --open
```

The expected version is `0.0.1-dev`. These commands work with the normal npm
command launcher; there is no separate Python or shell installer. On Windows,
run them in PowerShell. Install separately inside each WSL distribution.

**Node requirement:** 18.20.8 or newer. On Node 18/20 the optional `libsql@0.5.29`
prebuilt database dependency is required; do **not** install with `--omit=optional`
on those runtimes. When that dependency is unavailable, the application can use
Node's built-in SQLite on a runtime where it is enabled. The latter path was the
one executed in this build. No source-build/compiler fallback is invoked. A
missing backend is an explicit error, not a fake successful initialization.

A maintained Node LTS is recommended. Legacy application compatibility does not
restore security updates to an end-of-life Node release. Your global Node, npm,
Python, PATH, and system configuration are not changed by this application.

### First-use behavior

`init` (also `setup`) creates a new configuration, private access token, database,
price table and four managed Codex hooks. It does not import your whole history
or start a server. Existing unrelated hooks are preserved and backed up before
changes. Repeating initialization does not reset settings or duplicate handlers.
No npm installation lifecycle script edits Codex settings.

After initialization, restart Codex and open **`/hooks`** to review/trust the
handlers named **Codex Report**. This application does not grant trust, change
managed policy, modify `config.toml`, or edit `AGENTS.md` or your status line.

`sync` is an explicit historical reconciliation. `start` runs the collector and
server in the foreground; keep that terminal open. Closing the browser does not
stop collection. Ctrl+C in the server terminal, or `codex-report stop` in another
terminal, stops the server. There is no automatically installed startup service.

The browser address includes a private access token in its fragment. The page
exchanges that token for a local HttpOnly cookie and removes it from the address
bar. Do not post the original tokenized address in screenshots or bug reports.

With no command, `codex-report` is equivalent to `codex-report start` after init.
`--open` requests browser opening; otherwise open the address printed by start.
On a WSL setup without a working browser opener, use that address in your Windows
browser. Loopback networking policy still applies.

### Custom locations

```sh
codex-report --home /absolute/path/to/report-data init --codex-home /absolute/path/to/.codex
codex-report --home /absolute/path/to/report-data start --open
```

`CODEX_REPORT_HOME` can select the application data home. `CODEX_HOME` is used
when creating the initial primary Codex source. `init --no-hooks` installs only
the reporting configuration/storage. A later ordinary init can add the hooks.

| Platform    | Default data directory                                          |
| ----------- | --------------------------------------------------------------- |
| Linux / WSL | `$XDG_DATA_HOME/codex-report`, or `~/.local/share/codex-report` |
| macOS       | `~/Library/Application Support/codex-report`                    |
| Windows     | `%LOCALAPPDATA%\CodexReport`                                    |

Data is outside the npm installation and survives package upgrades/removal. Do
not place one active database on a cloud/network share or open it simultaneously
from Windows and WSL. Use metadata exchange instead.

## What is reported

- Input, cached input, cache-write input, output and reasoning (within output).
- Main-turn/root-task totals, direct-thread totals, workers and approval reviews.
- Model requests separately from user turns; tool event counts are best effort.
- Completed, stopping, interrupted, failed and unknown outcomes.
- API-equivalent priced subtotal, with unpriced requests identified by model.
- Provider-observed limit identifiers, percentages, actual window durations,
  reset times and observation times; these are not inferred from token counts.
- Last five hours, day, week, billing cycle/calendar month, lifetime, and custom
  periods; model/account/device/effort/tier breakdowns and timing percentiles.

Normal Stop and manual Interrupt callbacks show labelled terminal receipts.
Stop is an attempted stopping point, not a final lifecycle guarantee. Unchanged
callbacks are suppressed. New usage can produce an updated report. An Esc
cancellation is labelled **interrupted by you**; missing final in-flight usage
is not invented.

SubagentStop and SessionStart collect silently. Interrupt uses a maximum hook
timeout of three seconds and a shorter internal import budget. Hooks inspect the
relevant file, not all historical sources. If a busy collector prevents a hook
response, persisted usage is recovered by the observer or a later sync.

**Quota/error failure:** while the server is running, its observer ingests
persisted terminal events even when no Stop hook occurs. The dashboard shows the
failure. The program does not inject arbitrary text into Codex's active TUI.
If the collector was stopped, the next sync/start recovers retained events.
Hard process termination cannot guarantee an immediate hook report.

### Optional launch/exit reporting

```sh
codex-report run --
codex-report run -- resume YOUR_THREAD_ID
```

The wrapper starts or reuses the collector, launches Codex with inherited terminal
I/O, and prints a report after Codex exits. It labels the result **observed launch
interval**: concurrent activity in the selected account scope can also fall in
that period. It is not claimed as perfect process-to-thread attribution. Ordinary
`codex` use is still supported; its exit does not trigger wrapper output.

On Windows, the wrapper resolves a normal npm Codex entry point or a native
`codex.exe`. An explicit executable can be selected with `--executable PATH`.

## Accounts, billing periods and display

Labels are user assertions, not verified account identities. No credential files
are read. Historical mixed-account usage remains `unattributed` unless you
explicitly label the source or apply a scoped correction.

```sh
codex-report accounts set premium --billing-day 6 --timezone Asia/Kolkata
codex-report config set reportAccount premium
codex-report config set display detailed
```

Replace `6` with your actual renewal day. Without an account billing day, the
period is labelled **calendar month**, not billing cycle. `--billing-time HH:MM`
sets a known renewal time. Month-end anchors stay anchored across short months.
DST overlaps select the earlier occurrence; nonexistent local times move forward.

Optional fee comparison (syntax examples, not your fee or current exchange rate):

```sh
codex-report accounts set premium --monthly-usd 120
# For another label, local-currency comparison with a manually supplied rate:
codex-report accounts set standard --billing-day 6 --currency INR --subscription-amount 2500 --local-per-usd 100
```

The multiple compares observed priced usage with the configured fee for the same
scope/period. It is not actual billing, money saved, credits consumed, entitlement,
or a productivity measure. A USD fee takes precedence over a local-currency fee;
inspect `config show` before changing that basis.

For shared history, use an explicit label per Codex launch:

```sh
CODEX_REPORT_ACCOUNT=premium codex
# Or:
codex-report run --account premium --
```

PowerShell:

```powershell
$env:CODEX_REPORT_ACCOUNT = 'premium'
codex
Remove-Item Env:CODEX_REPORT_ACCOUNT
```

Live capture can label a current turn that the observer first saw as unattributed,
and later linked child requests. It does not replace a different explicit label
or reassign the whole conversation. Do not switch accounts mid-turn and expect
unknown request-level ownership to be recoverable.

```sh
codex-report accounts assign premium --from-account unattributed --thread THREAD_ID
codex-report accounts assign premium --from-account unattributed --thread THREAD_ID --apply
```

The first command previews. Apply backs up and audits the scoped correction.
Stop the collector before changing configuration or doing maintenance.

Display modes: `compact`, `detailed`, `quiet`. Quiet still collects. Detailed adds
model, effort, request/tool and cache-write quantities. Terminal messages use
Codex's existing hook-message surface, not a custom native footer.

## Sources and reconciliation

```sh
codex-report sources list
codex-report sources add work /path/to/.codex --kind codex-home
codex-report sources add copied /path/to/rollouts --kind rollouts --account premium
codex-report sync
codex-report sync --path /path/to/extracted-jsonl
codex-report sync --verify
```

Sources are read-only. `--account` is an explicit assertion about that source's
history. Adding a source does not install hooks there; `init --codex-home PATH`
registers a home and its handlers. Repeated imports are idempotent. The observer
polls retained files rather than trusting platform-specific filesystem events.

Plain JSONL, gzip and Zstandard are supported. A partial final line is deferred.
Usage and its cursor commit in one database transaction. Native response records
are preferred over cumulative snapshots; inherited metadata cannot replace the
physical file's owning thread. Legacy records without enough evidence remain
conservative/unpriced instead of fabricating request boundaries.

The bounded decoder supports ordinary non-dictionary Zstandard; its vendored
reader retains an 8 MiB back-reference window. Unsupported dictionary/large-window
streams, corrupt data and bounds violations become source-health errors rather
than silently successful imports. Default source/decompressed bound is 256 MiB;
individual JSONL records are limited to 8 MiB. Large initial scans can require an
explicit stopped-collector sync. These bounds are not provider usage limits.

## Reports and live dashboard

The dashboard has Overview, Turns & agents, Usage comparison, and Data health.
It polls a revision endpoint, retains filters/expanded turns, and periodically
refreshes health even when no new requests arrive. The database is authoritative;
there is no independently maintained JSON ledger. All assets are local.

```sh
codex-report last
codex-report last --json
codex-report report --scope 5h --account premium
codex-report report --scope lifetime
codex-report report --scope task --thread THREAD_ID --turn TURN_ID
codex-report report --from 2026-09-01T00:00:00+05:30 --to 2026-10-01T00:00:00+05:30
codex-report report --scope lifetime --format html --output report.html
codex-report report --scope lifetime --format csv --output report.csv
codex-report report --scope lifetime --json
```

Output files refuse overwrite. HTML exports are standalone snapshots; the live
viewer does not need manual regeneration. CSV neutralizes formula-leading text.
A period can contain only a slice of a long turn; timing/tool observations refer
to recorded turns, not per-period model generation speed.

## Prices

The bundled table is dated **September 24, 2026** and includes five explicitly
mapped model IDs. Unknown models, including internal reviewer identifiers without
a verified public mapping, remain unpriced. Rates are per million tokens and are
applied to each recorded request, not to the last selected conversation model.
Reasoning is not charged twice. Ordinary, cached, and cache-write input categories
are kept distinct. Long-context thresholds are evaluated per request.

Standard list-price equivalence is the default. The optional `recorded` basis
only prices service tiers explicitly understood by this development version;
unknown/nonstandard tiers stay unpriced. Tools, image/audio-specific fees, taxes,
regional charges and subscription-credit conversions are not included.

```sh
codex-report prices show
codex-report prices alias VERIFIED_ID gpt-6-sol
codex-report prices alias VERIFIED_ID gpt-6-sol --apply
codex-report prices load reviewed-prices.json
codex-report prices load reviewed-prices.json --apply
codex-report reprice --unpriced-only
codex-report reprice --unpriced-only --apply
```

Existing prices are frozen; table edits do not retroactively change history.
`reprice --all --apply` deliberately revalues after backup. Old usage is valued at
the table available on import, not an automatically reconstructed historical
billing tariff. Dated/promotional rows have explicit review boundaries.

## Backup, restore and device exchange

```sh
codex-report stop
codex-report backup /path/to/new-backup.sqlite3
codex-report restore /path/to/backup.sqlite3
codex-report restore /path/to/backup.sqlite3 --apply
codex-report export device-usage.crx
codex-report import device-usage.crx
codex-report import device-usage.crx --apply
codex-report audit
codex-report conflicts
```

Restore and import preview first, then back up before explicit apply. Restore
accepts this product's schema-1 snapshots only, checks integrity, and refuses a
live WAL source. No legacy migration is implemented. Exchange contains metadata,
not raw transcripts or source paths; it is not encrypted or signed. Native IDs
are deduplicated across imports; ambiguous legacy identities have narrower
coverage. Conflicting usage preserves local values and is reported.

`uninstall-hooks` removes only the exact managed hook definitions, preserving
unrelated hooks and all stored data. Then `npm uninstall -g codex-report` removes
the application. Private data removal remains a deliberate filesystem operation.

## Development and quality checks

### Build an installable tarball

`pnpm run build` compiles TypeScript into `dist/`. It does not
create a tarball. To build, check the package contents, and create the installable
archive in the repository root, run:

```sh
pnpm run pack:local
```

The result is `codex-report-0.0.1-dev.tgz`. Nothing is published and nothing is
installed by this command. A later run replaces that generated tarball.
`test:package`, in contrast, packs into a temporary directory, tests an isolated
installation, and removes that temporary directory afterwards.

To test/install your freshly built tarball on this machine:

```sh
npm install -g --ignore-scripts ./codex-report-0.0.1-dev.tgz
codex-report --version
codex-report doctor
```

The new `pack:local` command and the package smoke test use the **real npm CLI**,
even when invoked through pnpm. They must not treat `npm_execpath` as npm: pnpm
sets that variable to its own executable, whose flags and output differ. npm's
entrypoint is resolved from the installed Node/npm layout or PATH and launched
without a shell. If a custom runtime manager hides npm, set
`CODEX_REPORT_NPM_CLI` to the installed `npm/bin/npm-cli.js`; it is never downloaded
on demand. Package lifecycle scripts remain disabled while packing/installing
the test artifact. This does not add installation hooks to the application.

Use pnpm 10.11.0 for development commands. The package smoke test and local pack
command call the installed npm CLI internally because npm provides the package
archive and isolated installation operations; invoke those tasks through pnpm.

### Browser test setup (development only)

The project depends on **playwright-core**. Installing the JavaScript dependency
does not install Chromium. Install the matching browser once and repeat this
step after changing the Playwright version:

```sh
pnpm browser:install
pnpm test:browser
```

`browser:install` runs the installed `playwright-core install chromium` CLI, not
an unpinned `npx` download. It downloads browser files but does not install system
packages. On Linux/WSL, if Playwright subsequently reports missing shared libraries,
review `pnpm exec playwright-core install-deps chromium` with your machine's
administrator; it may require system-package installation privileges.

To use a compatible browser already installed instead of downloading one:

```sh
CODEX_REPORT_BROWSER_PATH=/absolute/path/to/chrome pnpm run test:browser
```

PowerShell:

```powershell
$env:CODEX_REPORT_BROWSER_PATH = 'C:\Path\To\chrome.exe'
pnpm run test:browser
Remove-Item Env:CODEX_REPORT_BROWSER_PATH
```

Playwright works best with its matching bundled browser; an arbitrary installed
Chrome version is not guaranteed compatible. Browser setup is **not required**
for running the Codex Report application or building the tarball. Missing browser
binaries fail the test with instructions; they are never automatically downloaded,
silently skipped, or counted as a pass. A managed-browser policy failure is not a
reason to disable that policy. The offline fixture mode, when explicitly used,
is only a DOM check and is not a live browser-to-server test.

### Run the checks

Install dependencies and run the development checks through pnpm. `verify` runs
the non-browser gates and packed-install smoke; run `test:browser` separately
after the explicit browser setup above.

```sh
pnpm install --ignore-scripts
pnpm format
pnpm format:check
pnpm  lint
pnpm type-check
pnpm test
pnpm test:coverage
pnpm test:package
pnpm check:package
pnpm verify
pnpm audit:dependencies
```

TypeScript strict mode covers server code; a separate checked-JavaScript project
covers the browser against shared backend types. Prettier is pinned. ESLint
includes TypeScript recommended and floating-promise checks. The complete verify
command fails if a required tool is missing: it does not silently skip linting.

The build container could not resolve the npm registry. It used the available
TypeScript compiler and an integrity-checked official Prettier 3.9.9 build.
ESLint, dependency audit, the libsql runtime and exact Node 18 execution could not
be exercised there. Direct versions are pinned, and the pnpm lockfile records the
resolved dependency graph. CI installs the declared dependencies and executes the
full gates on its matrix; a workflow file is not evidence that CI has run.

For offline package validation on a Node with built-in SQLite, development CI can
set `CODEX_REPORT_OFFLINE_ONLY=1`; that smoke test intentionally omits optional
dependencies. This is not a substitute for the Node 18/libsql test matrix.

To rebuild the bundled decoders, an already installed Go toolchain is a **developer
build-time** requirement only:

```sh
node tools/build-native.cjs
pnpm build
pnpm pack:local
```

The runtime executable sources and BSD license are included. Go 1.23.2 was the
available build toolchain; this is provenance, not a claim of current toolchain
security maintenance. See [architecture](docs/ARCHITECTURE.md),
[security](docs/SECURITY.md), and [phase plan](docs/IMPLEMENTATION-PLAN.md).
