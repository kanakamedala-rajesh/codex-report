# Security and privacy

Codex Report reads authorized local session files and stores usage metadata. It
never reads authentication files, calls a provider API, submits model requests,
or uploads reports. Reading a session necessarily reads bytes that may contain
prompts and tool contents; only the allowlisted metadata projection is retained.

## Local service

- Binds to 127.0.0.1, not the LAN. The browser needs the installation's private token.
- A fragment-based token exchange produces an HttpOnly SameSite=Strict cookie.
- Host and Origin checks, CSP, fixed asset routes and size/time bounds are enforced.
- Analytics routes are read-only. `GET /api/settings` returns an explicit public
  projection, never tokens, device IDs or source paths. `POST /api/settings` can
  change only allowlisted presentation/reporting/billing fields and local session
  nicknames. Cookie-authenticated writes require an exact same-Origin header and
  JSON content type; body size is capped at 64 KiB. Duplicate/unknown fields and
  stale config revisions are rejected. The worker serializes writes, backs up the
  private config, atomically replaces it, reloads settings, and records an audit.
  Config and audit are separate stores: an audit failure is reported as a warning
  after a successful config save, not misrepresented as a failed save.
- Internal hook/sync/stop operations still require bearer authentication and do
  not accept filesystem paths from browser cookies alone.
- The server does not expose the ledger, backups, configuration or raw rollouts.
- A malicious process already running as the same OS user can read that user's
  private files; localhost authentication does not replace the OS trust boundary.

## Storage and concurrency

A private data directory, SQLite WAL/FULL synchronization, and an exclusive app
writer lease coordinate mutations. An observer worker owns the active writer;
CLI reads use its API or a read-only connection. Maintenance requires the writer
to be stopped. Cursors and imported metadata commit atomically. Imports, pricing
changes, ownership changes and restores have explicit apply/backup/audit paths.

Settings reject duplicate JSON keys. Imported identifiers are never interpolated
into SQL. Browser content is inserted through textContent, not HTML injection.
CSV formula prefixes are neutralized. Unknown models stay unpriced.

Native decoders use stdin/stdout only, verify their shipped hashes, have execution
and output bounds, and never download an executable at runtime. A checksum detects
accidental changes; it is not a publisher signature. The helpers are unsigned.
Their source and build provenance are included; no independent security audit is
claimed. Import only trusted files. Legacy runtimes carry their own security risk.

## Publication boundaries

No private user logs, configurations, credentials or original source files are
bundled. The Git history is new and local. npm install does not grant hook trust,
change Codex security settings, start a system service, or publish anything.

## Disclosure

Follow the private disclosure instructions in the repository's root
[`SECURITY.md`](../SECURITY.md). GitHub Private Vulnerability Reporting must be
enabled by the repository owner before the repository is made public. Keep
sensitive logs and access tokens out of public issues; use minimized synthetic
reproductions for ordinary defects.
