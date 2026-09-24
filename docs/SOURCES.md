# Primary references and build provenance

Documentation inspected September 24, 2026. Versions are intentional snapshots,
not a claim that every dependency is the newest release.

- Codex hook contract: https://developers.openai.com/codex/hooks
- Codex persisted schema reference: https://github.com/openai/codex/tree/rust-v0.156.1/codex-rs
- Node 18 lifecycle: https://github.com/nodejs/Release/blob/main/schedule.json
- SQLite adapter source: https://github.com/tursodatabase/libsql-js/tree/v0.5.29
- Node SQLite APIs: https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html
- API pricing: https://developers.openai.com/api/docs/pricing
- Model price sources are embedded per entry in data/prices.json.
- Native decoder source: Go 1.23.2 internal/zstd with its BSD license, copied from
  the installed toolchain; helper wrapper authored for this application. No runtime
  external download. Six binary SHA-256 values are in runtime/manifest.json.
- test/fixtures/hello.zst and data/self-test.zst come from the same Go source
  testdata; the expected decompressed SHA-256 prefix is f2a8e35c.
- Formatter: official Prettier 3.9.9 build at tag commit
  cdd17f2288b28b170a76416c72dac56e3ea5daff, workflow artifact 10735133596,
  archive SHA-256 2136d7494662b6a86a2fc058b595189bea80e60b99482bec8d4fad56b5709ba1.
  The upstream workflow uploaded that artifact before cancellation; no passing
  upstream full pipeline is claimed. The actual formatter was executed locally.
  It is a development tool, not a runtime package payload.

The SQLite adapter explicitly accounts for the v0.5.29 constructor not honoring
readonly/fileMustExist: https://github.com/tursodatabase/libsql-js/blob/v0.5.29/index.js
Read-only operations use query_only, and backups use VACUUM INTO. The adapter
contract was simulated using the executed built-in driver; actual libsql execution
remains a target verification gate.
