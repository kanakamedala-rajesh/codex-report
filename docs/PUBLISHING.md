# Publishing Codex Report

This guide prepares a release; it does not authorize or perform publication.
The current `0.0.1-dev` version is intentionally blocked from the release
workflow.

## Before the first public npm release

1. Publish as `@venkatasudhalabs/codex-report` under the npm organization
   [scope `@venkatasudhalabs`](https://www.npmjs.com/org/venkatasudhalabs).
   Confirm that the organization grants you publish access and that this exact
   package name is available. The unscoped `codex-report` name is already taken.
   The GitHub repository owner and npm organization are separate identities.
2. Create the public repository at
   `https://github.com/kanakamedala-rajesh/codex-report`. Keep the `repository`,
   `homepage`, and `bugs` fields in `package.json` in sync with that exact URL.
3. Enable GitHub Private Vulnerability Reporting and ensure the Security tab
   points to the instructions in the root `SECURITY.md`.
4. Review the complete Git history and the files selected by `pnpm run pack:local`.
   Confirm that no private data, credentials, or local-only material is included.
5. Replace the development version with the chosen stable SemVer version in
   `package.json`. `src/version.ts` reads that value, and the release workflow
   requires the GitHub release tag to be exactly `v<version>`.
6. Require the full CI checks before creating a GitHub release. The workflow
   builds, verifies, and stages the package; it does not publish it immediately.

The npm registry could not be reached from the development environment when
this guide was prepared, so availability of
`@venkatasudhalabs/codex-report` has not been verified. Do not assume the name
is free. Scoped packages default to private; this manifest and the publish
commands explicitly set public visibility.

## Bootstrap the npm package

The npm staging command requires the package to exist in the registry. For the
first stable release, the maintainer must publish the reviewed scoped package
manually with npm account two-factor authentication and `--access public`.
Review the tarball before publishing it and do not publish `0.0.1-dev` as the
first public version.

After that first publication:

1. In `@venkatasudhalabs/codex-report` package settings, add a GitHub Actions
   trusted publisher for owner `kanakamedala-rajesh`, repository `codex-report`,
   workflow `publish-npm.yml`.
2. Allow only `npm stage publish` for that trusted publisher. Require two-factor
   authentication and disallow traditional publishing tokens for the package.
3. Publish a GitHub Release with tag `v<package.json version>`. The workflow
   verifies the tag and package version, runs `pnpm run verify`, then stages the
   package publicly with provenance.
4. Inspect the staged package and approve it with npm two-factor authentication.

The publishing workflow uses npm's OpenID Connect trusted publishing and
staging flow. It stores no npm token in GitHub Actions. The publisher is bound to
the exact repository and workflow filename, so update the npm trust settings if
either changes.

## Local release checks

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
pnpm run pack:local
npm pack --dry-run --ignore-scripts
```

Inspect the package file list and run the isolated install smoke before a
release. Never commit npm credentials or local `.npmrc` files.

References: [npm package metadata fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/),
[publishing scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/),
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[npm staged publishing](https://docs.npmjs.com/cli/v11/commands/npm-stage/), and
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/).
