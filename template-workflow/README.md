# Template Workflow for macOS

Template Workflow is a macOS Claude Code template producer maintained in this repository. Its capture, cleaning, tool preservation, drift detection and release implementation is included locally. Normal production requires no Dario service, repository access or future source releases.

The implementation was originally extracted from Dario, and the initial tool baseline included definitions from an imported Dario template. Retained definitions may still trace back to that initial baseline; independently running the producer does not mean every tool has been independently recaptured. Historical source attribution and the original license remain in this repository. Fixtures under `test/reference/` are local development test inputs.

## Production

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run produce
```

`produce` requires macOS and always resolves the official npm `latest` version once at the start of the run. It downloads the exact native macOS client for the runner architecture, verifies the npm package integrity, binary digest and reported version, then uses that same client for the whole run. A failed download or capture fails the job; it does not fall back to an old client or an upstream template.

The production sequence is:

1. Restore our last published macOS template and provenance. A verified checked-in macOS baseline is preferred over legacy releases when no macOS release exists yet.
2. Resolve and verify the latest Claude Code client.
3. Capture the base prompt and model-family variants against a local loopback endpoint.
4. Apply scrubbing, macOS tool preservation and drift classification against our previous macOS baseline.
5. Rebake on structural drift; sync version labels only after a matching live shape check; retain the existing artifact when there is no drift.
6. Verify the template contract, variants, scrubbed content, client version and capture provenance.
7. Export and publish our artifact with its checksums and provenance.

The producer preserves interactive, configuration-scoped and deferred tools from the previous baseline when a macOS capture does not expose them. Other-platform tools are removed from the baseline and blocked at export; the current Windows-only classification contains `PowerShell`, `Glob` and `Grep`. A produced template therefore combines freshly observed content with those preserved definitions. The provenance records the previous baseline digest. Unclassified tool loss is a failure; production does not bypass tool-drop, missing-variant or macOS host checks.

`src/cc-template-data.json` is the producer's macOS baseline. The current checked-in baseline was captured on a hosted Apple Silicon macOS runner using the verified native Claude Code 2.1.310 client (34 tools and three model variants). `src/cc-template-provenance.json` binds it to a successful native macOS capture or verified label-only update. Export requires `target_platform=darwin` and a verified `darwin-*` client. During a legacy platform migration, the producer removes other-platform tools and discards all prior model variants and A/B shape history. All model families must then be captured on macOS before a new artifact can be exported; a Linux artifact is never relabeled as macOS.

Historical platform-neutral definitions can still be retained. A macOS template is a reusable inventory for macOS scenes, not a claim that every retained tool was observed in the current non-interactive capture, nor an authenticated official-endpoint parity certificate.

## Delivery

Default `npm run export` exports our own verified template to `artifacts/latest/`:

- `cc-template-data.json`: the schema 3 template, unchanged by the exporter.
- `metadata.json`: version, tool/variant counts and digest; `target_platform=darwin` and `origin.type=template-workflow`.
- `provenance.json`: target platform, actual native package/architecture, resolved client version/digest, previous baseline digest, implementation commit and capture run.
- `SHA256SUMS`: checksums for the three files above.

`npm run export -- --source /path/to/source.json` additionally emits the existing Gateway `cc-template-bundle/v1` envelope. Its embedded template bytes and digest are identical to the raw artifact. The source object's CC version must match the template.

Export requires matching capture provenance. It neither loads nor compares a Dario official template. `--observed` remains an alias for the same production export for compatibility. There is no official-snapshot export mode.

## GitHub Actions

Active workflows live in the parent repository's `.github/workflows/`:

- `template-workflow-ci.yml`: Node 22/24 on macOS, implementation integrity and regression tests, including controlled capture and export tests.
- `template-workflow-capture.yml`: hourly at :41, calls the complete production/release workflow.
- `template-workflow-release.yml`: runs on producer changes, manual dispatch or the hourly caller; restores our last release, captures latest, validates and publishes.
- `template-workflow-npm-drift.yml`: hourly npm drift detection; dispatches capture when needed.
- `template-workflow-liveness.yml`: every two hours, checks production watcher health.
- `template-workflow-upstream-sync.yml`: optional source-import tool, available only through an explicit manual dispatch. It has no schedule and is not called by production.

Capture/release uses a fresh GitHub-hosted macOS runner with Claude's default `~/.claude` configuration path so the project-path scrubbing rules apply. Requests used for capture go to the loopback collector, with a placeholder API key; a personal Claude login or paid model request is not required. `GITHUB_TOKEN` with Contents write permission can publish the artifact; production does not depend on creating or merging a PR.

Releases use `template-macos-cc-<CC version>-<template digest>` tags. An unchanged template reuses its immutable release after checking its files. A rebake or label update produces a new tag. Normal restoration accepts only this macOS namespace with matching provenance and checksums. A previously produced generic release can bootstrap a fresh macOS capture only when no macOS release or verified checked-in macOS baseline exists. It is never directly exported. Legacy official-snapshot releases are never restored.

For code-maintenance PRs, configure organization-approved `CC_DRIFT_BOT_PAT`. Without it, npm drift still dispatches production and upstream changes are reported as issues. `TEMPLATE_AUTO_MERGE=true` applies only to optional maintenance PRs.

## Development

```sh
npm test
npm run prepare:claude
npm run check
npm run capture
npm run export
npm run verify:source
```

`capture`, `produce` and `label-sync` require macOS. Failed direct captures restore the previous baseline and provenance. `check` is non-destructive: exit 0 means a match, 1 infrastructure failure, 2 structural drift and 3 label-only drift. `label-sync <version>` requires a matching live check. Standalone capture/check support `--cc-version`, `TEMPLATE_CC_VERSION` and `TEMPLATE_CLAUDE_BIN` for explicit historical/debug runs; the production `produce` entry point always uses npm latest. `TEMPLATE_HTTP_PROXY` configures npm/Git downloads. Keep a local proxy such as port 7897 local to that machine; GitHub runners use their own network.

`upstream-snapshot.json` records historical source attribution and local file hashes. `verify:source` checks those local files and does not contact upstream. Optional source imports are deliberate maintainer actions; they never write `src/cc-template-data.json` or its provenance. Original Dario fixtures and replay tests are development-only; their bytes do not determine the production artifact. The declared source adapter changes the bake-host guard to macOS.

To validate a branch before publication, dispatch `template-workflow-release.yml` with `publish=false`. It runs the same macOS capture and validation, uploads the generated files as an Actions artifact, and skips the release publication step. Scheduled and normal production runs publish by default.
