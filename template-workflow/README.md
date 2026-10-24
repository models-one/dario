# Template workflow

Standalone Claude Code template producer, using Dario's capture, scrub, tool-preservation and drift mechanisms. Production publishes this repository's own output. The Dario template fixtures under `test/reference/` are only development test inputs.

## Production

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run produce
```

`produce` requires Linux and always resolves the official npm `latest` version once at the start of the run. It downloads the exact native client, verifies the npm package integrity, binary digest and reported version, then uses that same client for the whole run. A failed download or capture fails the job; it does not fall back to an old client or an upstream template.

The production sequence is:

1. Restore our last published template and provenance, if one exists.
2. Resolve and verify the latest Claude Code client.
3. Capture the base prompt and model-family variants against a local loopback endpoint.
4. Apply Dario's scrubbing, tool merging/preservation and drift classification against our previous baseline.
5. Rebake on structural drift; sync version labels only after a matching live shape check; retain the existing artifact when there is no drift.
6. Verify the template contract, variants, scrubbed content, client version and capture provenance.
7. Export and publish our artifact with its checksums and provenance.

Dario preserves classified platform, interactive, configuration-scoped and deferred tools from the previous baseline when a capture does not expose them. A produced template therefore combines freshly observed content with those preserved definitions. The provenance records the previous baseline digest. Unclassified tool loss is a failure; production does not pass any tool-drop, missing-variant or non-Linux bypass flags.

`src/cc-template-data.json` is the producer's baseline. `src/cc-template-provenance.json` binds it to a successful capture or verified label-only update. A bootstrap baseline without provenance can never be exported directly: a fresh capture and bake are mandatory. Legacy hosted-config paths are rejected from production output; affected cached variants must be recaptured.

## Delivery

Default `npm run export` exports our own verified template to `artifacts/latest/`:

- `cc-template-data.json`: the schema 3 template, unchanged by the exporter.
- `metadata.json`: version, tool/variant counts and digest; `origin.type=template-workflow`.
- `provenance.json`: resolved client version/digest, previous baseline digest, implementation commit and producing workflow run.
- `SHA256SUMS`: checksums for the three files above.

`npm run export -- --source /path/to/source.json` additionally emits the existing Gateway `cc-template-bundle/v1` envelope. Its embedded template bytes and digest are identical to the raw artifact. The source object's CC version must match the template.

Export requires matching capture provenance. It neither loads nor compares a Dario official template. `--observed` remains an alias for the same production export for compatibility. There is no official-snapshot export mode.

## GitHub Actions

Active workflows live in the parent repository's `.github/workflows/`:

- `template-workflow-ci.yml`: Node 22/24 build, implementation integrity and regression tests, including controlled capture and export tests.
- `template-workflow-capture.yml`: hourly at :41, calls the complete production/release workflow.
- `template-workflow-release.yml`: runs on producer changes, manual dispatch or the hourly caller; restores our last release, captures latest, validates and publishes.
- `template-workflow-npm-drift.yml`: hourly npm drift detection; dispatches capture when needed.
- `template-workflow-liveness.yml`: every two hours, checks production watcher health.
- `template-workflow-upstream-sync.yml`: checks Dario implementation updates; updates code and development fixtures only, preserving our production data.

Capture/release uses a fresh GitHub-hosted Ubuntu runner with Claude's default `~/.claude` configuration path so Dario's project-path scrubbing rules apply. Requests used for capture go to the loopback collector, with a placeholder API key; a personal Claude login or paid model request is not required. `GITHUB_TOKEN` with Contents write permission can publish the artifact; production does not depend on creating or merging a PR.

Releases use `template-cc-<CC version>-<template digest>` tags. An unchanged template reuses its immutable release after checking its files. A rebake or label update produces a new tag. Baseline restoration only accepts this namespace, matching provenance and checksums; legacy official-snapshot releases are never restored.

For code-maintenance PRs, configure organization-approved `CC_DRIFT_BOT_PAT`. Without it, npm drift still dispatches production and upstream changes are reported as issues. `TEMPLATE_AUTO_MERGE=true` applies only to optional maintenance PRs.

## Development

```sh
npm test
npm run prepare:claude
npm run check
npm run capture
npm run export
npm run sync:upstream
```

`check` is non-destructive: exit 0 means a match, 1 infrastructure failure, 2 structural drift and 3 label-only drift. `label-sync <version>` requires a matching live check. Standalone capture/check support `--cc-version`, `TEMPLATE_CC_VERSION` and `TEMPLATE_CLAUDE_BIN` for explicit historical/debug runs; the production `produce` entry point always uses npm latest. `TEMPLATE_HTTP_PROXY` configures npm/Git downloads. Keep a local proxy such as port 7897 local to that machine; GitHub runners use their own network.

`upstream-snapshot.json` locks the extracted implementation. Upstream synchronization never writes `src/cc-template-data.json` or its provenance. Original Dario fixtures and replay tests are development-only; their bytes do not determine the production artifact.
