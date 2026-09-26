# Installed-command CI repair

## Failure evidence

Base commit: `92c7e492f77140764f2193d2e28b49b5ae956ab5`.

Pull-request run `36163307684`, Windows/Node 24 job `108164913001`, passed
formatting, lint, type-checking, all 150 tests and package-content checks. The
subsequent packed-install smoke failed at `tools/package-smoke.cjs:64` with
`null !== 0` while invoking the npm-generated `.cmd` shim through PowerShell.
The push run for the same head passed. This is not evidence of another database
regression or a need to remove Windows/backend coverage.

The test imposed a 10-second PowerShell startup/command timeout and asserted
`status` without inspecting `error` or `signal`. Node reports null status for a
signalled or failed launch. Because the original assertion discarded those
fields, the retained log cannot distinguish an exact timeout from another launch
failure. A slow, cold PowerShell host is a plausible explanation, not a measured
root cause. The confirmed harness defects are the unnecessary host dependency,
the inconsistent startup budget, and lost subprocess diagnostics.

## Repair

- Invoke the actual installed Windows `.cmd` with `cmd.exe`, not the underlying
  JavaScript entrypoint and not PowerShell. POSIX still executes the npm shim.
- Disable Windows command AutoRun and delayed expansion. Expand an environment
  variable inside quotes, without `CALL`, to preserve spaces, apostrophes,
  ampersands, parentheses, literal percent signs and exclamation marks in paths.
- Allow 60 seconds for a cold installed-command launch, consistent with other
  packed CLI commands. There is one attempt, no fixed sleep and no retry.
- Reject launch errors, timeouts, signals and nonzero exits. Preserve the error
  code/cause, status, signal and captured output instead of reporting a bare
  assertion against null. The exact installed version is still asserted.
- Use the same diagnostic checker for direct packed CLI subprocesses.

No workflow, backend, dependency, version, application/UI, stored data, security
assertion or quality gate is changed. Both push and pull-request matrices remain
enabled, including libSQL and built-in SQLite coverage.

## Regression coverage

`test/installed-shim.test.cjs` covers POSIX dispatch, Windows argument/environment
construction, case-insensitive Windows environment keys, ComSpec fallback,
no retries, timeout and signal propagation, nonzero exits, actual OS launch
errors, invalid paths, and a real executable shim in a path containing shell
metacharacters. The fixture runs in the native platform's command interpreter;
the packed test separately invokes the actual npm-generated shim.

All 13 new tests passed locally on Linux x64 / Node 22.16.0. The changed files
were formatted with Prettier 3.9.9 using the repository's configuration. Actual
Windows/macOS and the pinned full suite require the commit's GitHub matrix;
local argument assertions are not a substitute for those runs.
