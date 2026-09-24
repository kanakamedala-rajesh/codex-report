# Architecture decision: standalone Node application

## Decision

Implement a new TypeScript CLI and ledger with prebuilt, checked JavaScript
browser assets. Keep all accounting in the same backend functions. No predecessor
schema migration, fallback launcher, or runtime dependency exists.

## Runtime adapters

Use pinned optional libsql 0.5.29 where its platform prebuild is available. When
it cannot be loaded, use enabled node:sqlite. Actual database-opening errors are
not hidden by changing drivers. The selected libsql release ignores better-sqlite3
readonly options, so read-only operations require an existing file and explicitly
enable SQLite `query_only`. This blocks application SQL writes; it is not an
OS-level file permission change. Built-in SQLite also uses its native read-only
open option. Backups use SQL `VACUUM INTO`, not libsql's unimplemented backup method. The older runtime path is an unexecuted validation
gate in this environment, not claimed proof of Node 18 support. Native Windows
ARM64 is not present in the selected libsql tag's prebuild list; use a Node with
built-in SQLite there, or a separately validated x64 runtime. No compiler fallback.

A bundled, hash-checked, stdin-only Go decoder supplies gzip-independent Zstandard
support on six OS/architecture targets. Only the Linux x64 helper was executed.
This replaces a JS/WASM decoder choice that could not be acquired and reviewed in
the build environment. It adds native files to the package but no consumer Go or
Python requirement. Reader back-reference and output bounds are documented.

The UI uses typed DOM code instead of requiring React/Vite on consumers. This is
an implementation choice, not a reduced analytics interface. Its types are checked
against shared backend types. No external assets are loaded.

## Data and lifecycle

Immutable physical-file thread ownership prevents inherited headers from
reassigning child usage. Native response identities are deduplicated. Legacy
counter deltas are conservative; native records suppress same-turn legacy shadows.
Quota-only notifications are persisted independently from tokens. Root-task
relationships and worker/reviewer counts use explicit recorded IDs.

A worker thread performs bounded reconciliation and owns the writer lease. The
HTTP main thread remains responsive while parsing yields between batches. Hooks
submit small local operations; when the server is absent they attempt a bounded
standalone import. Stop and Interrupt are visible, child/start events are silent.
Persisted failures are captured by the observer even when no Stop hook executes.

SQLite is the source of truth. Browser JSON is computed from it. A revision
endpoint reduces redundant UI requests; periodic refresh updates health and
rolling-window displays. Import freshness, unpriced usage and quota observations
are kept separate.

## Boundaries and trade-offs

The collector polls known sources; it is not a resident OS service. Large cold
histories can exceed hook budgets and require explicit sync. Full expanded reports
currently materialize matching metadata in memory, with bounded source inputs;
very large lifetime stores should be profiled before a paging/indexing extension.
A writer lease coordinates this application, not arbitrary external SQL writers.

An optional launch wrapper reports an observed launch interval after child exit;
it does not claim perfect attribution when concurrent Codex sessions share scope.
Local records cannot establish unobserved cloud usage or infer subscription limits.
Unknown upstream formats are a compatibility gap, not zero usage.

## Verification and rollback

Ship as 0.0.1-dev, with target/runtime gaps explicitly recorded. Validate the packed
artifact, not only source tests. New state is separate from npm assets. Uninstall
removes only managed hooks; backups and user data remain. There is no remote,
registry publication, implicit trust grant or automatic system change.
