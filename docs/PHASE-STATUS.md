# Phase status - v0.0.1-dev

This repository was initialized independently on main. The implementation plan
was the first commit. Subsequent work packages have detailed local commit bodies.
No remote is configured, and no predecessor code or database is required.

| Phase                      | Implementation                  | Verification                                                                                                                            |
| -------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0 - Plan and repository    | Complete                        | Independent Git history and scope recorded.                                                                                             |
| 1 - Tooling and runtime    | Complete, with runtime adapters | Prettier/type-check/package guards pass; ESLint, Node 18 and actual optional SQLite driver gates remain open.                           |
| 2 - Persistent accounting  | Complete                        | Native/legacy, inherited identity, deduplication, partial cursors, quota snapshots and private replay pass.                             |
| 3 - Analytics/maintenance  | Complete                        | Prices, periods, reports, metadata exchange, backup/restore and scoped corrections exercised.                                           |
| 4 - Onboarding/hooks       | Complete                        | Actual packed init/re-init, hook contract, interruption, noninterference and uninstall exercised; real Codex UI remains a target check. |
| 5 - Local service/observer | Complete                        | Authenticated HTTP and unhooked failure collection exercised; one writer per local store.                                               |
| 6 - Dashboard              | Complete                        | Typed DOM, desktop/mobile fixture rendering exercised; direct live browser navigation blocked by environment policy.                    |
| 7 - Development packaging  | Complete                        | Local tarball and repository delivery; cross-platform release gates are not all passed.                                                 |

## Finish the remaining verification without changing scope

1. Resolve declared dependencies in an online development environment, inspect
   optional package scripts/prebuilds and commit the generated lockfile.
2. Run ESLint and the complete verify command without disabling checks.
3. Execute the actual Node 18.20.8/libsql packed-install journey. Modern built-in
   SQLite runs are not a substitute. Verify query-only enforcement and VACUUM
   INTO with the selected driver.
4. Run Windows/macOS/Linux target CI and real browser-to-localhost tests, followed
   by live Codex hook review and two ordinary turn/cancellation checks.
5. Measure very large lifetime histories before broad scalability claims. Keep
   pricing and capture coverage distinct from service availability.

These open verification gates do not remove init, hooks, persistent collection
or the dashboard from this application. They limit the platforms/runtimes and
assurances that can honestly be claimed for this development build.
