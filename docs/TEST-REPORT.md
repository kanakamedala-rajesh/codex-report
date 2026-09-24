# Validation report - Codex Report v0.0.1-dev

Build date: September 24, 2026. This is an implemented development application,
not a production certification or a claim of identical behavior on untested
runtimes. All mutations in these checks used disposable local homes.

## Executed environment

Linux x64, Node 22.16.0, npm 10.9.2, TypeScript 5.8.3, Git 2.47.3.
The database backend actually exercised was `node:sqlite`. The pinned optional
`libsql@0.5.29` runtime could not be installed from the inaccessible npm registry.
The six Zstandard executables were built using Go 1.23.2; Linux x64 was executed,
while Windows/macOS x64/ARM64 and Linux ARM64 were cross-compiled only.

## Executed checks

| Check                       | Result and scope                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier                    | 3.9.9 format and format:check passed using the official tag build, with provenance in SOURCES.md.                                                                                                                                                         |
| Type-check                  | Strict application TypeScript and checked browser JavaScript passed. The browser check also passed with dist absent, so it does not depend on a prior build.                                                                                              |
| Tests                       | **52 passed, zero failed, zero skipped.** Unit, accounting, storage, lifecycle, service, privacy and maintenance regressions.                                                                                                                             |
| Coverage                    | The same 52 tests passed with V8 coverage enabled. The report includes test code, so its overall percentage is not represented as application-only coverage.                                                                                              |
| Actual package installation | npm pack, install into a disposable global prefix, and execution through npm's generated CLI shim passed.                                                                                                                                                 |
| First-use journey           | init, repeat init, real doctor, self-test, persistent sync/deduplication, start, local HTTP authentication, interruption receipt, shutdown, metadata exchange, backup/restore and uninstall passed.                                                       |
| Failure without Stop        | Persisted failed-turn data was collected and exposed through the real service without invoking a Stop hook.                                                                                                                                               |
| Source replay               | An independent scanner checked all 1,163 native requests from 21 authorized JSONL files against persisted request identities and token vectors. Three main turns remained three.                                                                          |
| Compression                 | Known independently hashed compressed fixture, raw frames, truncation/corruption, output limits, cursor resumption and duplicate representation tests passed.                                                                                             |
| Backend read-only contract  | A real writable connection emulated the older driver's ignored constructor options; explicit query_only rejected writes and a missing file was not created. This is not execution of the actual libsql binary.                                            |
| Browser DOM fixture         | The actual HTML, CSS and JavaScript rendered with a synthetic report obtained from the real reporting service. Desktop 1280px and mobile 390px layouts, expansion retention, quota/failure/unpriced states and absence of external asset requests passed. |
| Packaging                   | Entrypoint, exact version, declared file allowlist, privacy exclusions and all six native hashes passed.                                                                                                                                                  |

The package smoke used `CODEX_REPORT_OFFLINE_ONLY=1`, which installs the tarball
with lifecycle scripts disabled, offline, and with optional dependencies omitted.
It validates the built-in database path; it is **not** evidence that an offline
Node 18 install can work without its required optional database dependency.

The browser DOM check used preinstalled Playwright
1.57.0-beta-1764944708000 and Chromium 144.0.7559.96. Direct browser navigation to
the local server was blocked by the environment's browser policy. That policy
was not bypassed: the fixture check used setContent and fixture responses, while
HTTP authentication/collection were tested independently using Node HTTP calls.
This is not claimed as a successful real browser-to-localhost end-to-end test.
The declared development dependency, playwright-core 1.56.1, was not installed
or executed here.

## Important defects found and corrected during verification

- Inherited session metadata no longer replaces the physical owner of a rollout.
- Repeated interruption callbacks no longer re-emit solely because time advanced.
- Explicit live labels can capture an observer-first unattributed current turn
  without relabeling unrelated historical work or overriding a different label.
- Incomplete compressed imports resume at the decoded cursor rather than byte zero.
- Read-only database operations do not rely on ignored libsql constructor flags.
- Restore refuses active writers and uncheckpointed source backups; it creates a
  consistent safety snapshot rather than copying an open live database.
- Multi-day analytics sorts explicit day keys, not driver-specific row objects.
- Hook timeouts are event-specific; Interrupt requests three seconds, not five.
- Whole-history scan status does not masquerade as this turn's completeness.

## Blocked and not-run gates

| Gate                    | Status                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint                  | **BLOCKED:** declared and configured, but unavailable locally; npm run lint exited 127 with eslint: not found. It was not silently skipped by verify.                                                         |
| Dependency audit        | **BLOCKED:** registry resolution unavailable and no resolved lockfile exists. Offline audit returned ENOLOCK, not a clean audit.                                                                              |
| Node 18.20.8            | **NOT RUN:** runtime acquisition unavailable. The engines declaration is a compatibility target, not proof.                                                                                                   |
| Actual libsql backend   | **NOT RUN:** source contract reviewed, including its ignored readonly option and unimplemented backup method; adapter uses query_only and SQL VACUUM INTO. Exact native package still needs target execution. |
| Windows, macOS, ARM64   | **NOT RUN:** source/configuration and cross-built decoders are provided; no native runtime pass claimed.                                                                                                      |
| Live Codex UI/trust     | **NOT RUN:** no authenticated interactive Codex process or user hook-trust action was exercised. Fixtures validate the handler contract.                                                                      |
| CI matrix               | **NOT RUN:** workflow provided, not pushed or executed.                                                                                                                                                       |
| Public registry release | **NOT DONE:** no npm publication, remote repository, push or external account mutation.                                                                                                                       |

Direct dependency versions are pinned. No lockfile was fabricated when registry
resolution failed. On an online development machine, resolve and review the
lockfile, execute npm run verify and the Node 18/libsql matrix before claiming
all release gates pass. The complete verify command is intentionally red when
its lint dependency is absent.

## Source replay totals

| Main turn | Outcome   | Native requests |      Input | Output | Workers | Approval-review threads |
| --------- | --------- | --------------: | ---------: | -----: | ------: | ----------------------: |
| 1         | Failed    |             434 | 41,021,526 | 93,523 |       3 |                       3 |
| 2         | Completed |             199 | 20,137,496 | 35,316 |       4 |                       1 |
| 3         | Completed |             530 | 51,408,619 | 96,664 |       2 |                       3 |

Total processed tokens: **112,793,144**. These are replayed token measurements,
not a new claim about provider bills. No private records, raw prompts, user
configuration, source paths or real thread/request IDs are distributed. The
repository retains aggregate evidence and synthetic structural tests only.

## Reproduce

```sh
npm install --ignore-scripts
npm run format:check
npm run lint
npm run type-check
npm test
npm run test:coverage
npm run test:package
npm run check:package
npm run verify
npm run audit:dependencies
```

For the exact minimum backend gate, run the packed install and self-test with
Node 18.20.8 and CODEX_REPORT_SQLITE_BACKEND=libsql in the environment. For browser
QA install the declared Playwright package and a permitted Chromium executable,
then run npm run test:browser. CODEX_REPORT_BROWSER_FIXTURE=1 is the explicitly
separate offline DOM mode, not a way to assert a blocked live navigation passed.

On a target device: install the packed application, init, doctor, self-test,
sync, start --open, review the managed hooks in Codex, complete a turn, cancel
another active turn, and inspect the dashboard. Repeating sync must not increase
unchanged native request totals. Failure collection requires the collector to
be running; otherwise the next reconciliation recovers retained events.
