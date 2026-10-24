# Template producer workflows

The producer lives in `template-workflow/`. Its build, dependencies and source lock are separate from the parent Dario application.

## Production path

The scheduled capture workflow calls the release workflow on a GitHub-hosted macOS runner. Every run resolves npm latest once, verifies the native Claude Code client, performs the producer's multi-model capture against a local collector, scrubs and merges tools, detects drift, then rebakes or synchronizes labels as needed. It validates and publishes our generated template.

Production reads our last published macOS release as its baseline. It never exports an official Dario snapshot. All implementation code and regression fixtures are stored locally. Optional third-party source imports require an explicit manual dispatch and never touch the production baseline.

Published files: `cc-template-data.json`, `metadata.json`, `provenance.json`, `SHA256SUMS`. Their release tag is `template-macos-cc-<version>-<digest>`. The provenance identifies the client binary, baseline digest and capture run. Failed capture, invalid provenance, unexpected tool loss or a version mismatch stops publication.

Only macOS captures (`target_platform=darwin`, native client `darwin-*`) qualify for publication. A migration from a Linux/generic baseline removes other-platform tools and discards all model variants and A/B history, forcing fresh macOS capture. Missing model-family capture blocks publication. The current Windows-only tools PowerShell/Glob/Grep cannot pass export validation. Historical platform-neutral definitions are still retained when not observed; this is a macOS template inventory, not a single raw request. Development fixtures are not publishable artifacts.

## Workflows

- `ci`: Node 22/24 macOS build and regression checks.
- `capture`: hourly at :41; calls production/release.
- `release`: capture latest, validate and publish on changes or manual dispatch.
- `npm-drift`: hourly at :00; checks npm and dispatches production on drift.
- `liveness`: every two hours; checks the capture workflow.
- `upstream-sync`: manual-only source maintenance; never scheduled or called by production.

Only this repository (`models-one/dario`) enables the operational schedules. Hosted capture uses a placeholder API key and the local loopback collector; it needs no self-hosted runner or Claude account credentials. The production workflow declares Contents write permission for `GITHUB_TOKEN`.

Maintenance PRs require an organization-approved `CC_DRIFT_BOT_PAT`; without it, source updates are reported as issues and normal template production continues independently. Optional auto-merge uses `TEMPLATE_AUTO_MERGE=true`.

## Local production

```sh
cd template-workflow
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run produce
```

Production requires macOS and uses npm latest. Exported files appear under `artifacts/latest/`. For local proxy downloads set `TEMPLATE_HTTP_PROXY=http://127.0.0.1:7897`. See the producer README for explicit development overrides and Gateway bundle export.

## Independence and historical provenance

Normal template production uses the verified npm Claude Code client, this repository's implementation, and our previous published template. It does not fetch Dario templates or code. The implementation and initial baseline were originally imported from Dario; some preserved tool definitions retain that historical origin. Release notes identify Template Workflow as the producer without claiming that every tool was freshly or independently captured. The original license and historical source records remain available.

Manual release dispatch supports `publish=false` for a macOS capture preview. This validates and uploads an Actions artifact without publishing it. The default is true for production and the scheduled caller.
