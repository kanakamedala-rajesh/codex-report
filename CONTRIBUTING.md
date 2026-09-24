# Contributing

Thanks for helping improve Codex Report. Please open a focused issue before
substantial changes so the expected behavior and compatibility impact are clear.

## Development setup

- Node.js 18.20.8 or newer.
- pnpm 10.11.0 for development dependencies and scripts.
- Go is needed only when rebuilding the bundled native decoders.

```sh
pnpm install --ignore-scripts
pnpm run format:check
pnpm run lint
pnpm run type-check
pnpm run verify
```

The live browser check is separate. Follow the browser setup in the README, then
run `pnpm run test:browser`. Do not disable a browser policy or turn a missing
browser into a skipped pass.

## Privacy and reports

Do not attach Codex session files, transcripts, prompts, tokens, private
configuration, or database files to issues or pull requests. Reduce a report to
the smallest synthetic example that reproduces the behavior. Redact local paths
and account identifiers from logs.

## Changes and patch archive

Keep pull requests focused and update user-facing documentation when behavior
or commands change. Conversation-generated patches supplied with the project are
archived under `patches/`; the source tree and Git history remain authoritative.

## Releases

Only maintainers prepare releases. See [the publishing guide](docs/PUBLISHING.md)
for version checks and staged npm publishing.
