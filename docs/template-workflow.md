# Standalone template workflow

The producer lives in `template-workflow/`. It has its own package, lockfile,
source lock, capture CLI and tests. The parent Dario application remains at the
repository root.

```sh
cd template-workflow
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
npm run export
```

The official template is exported to
`template-workflow/artifacts/official/cc-template-data.json`. Its bytes and
SHA-256 must match the pinned `askalf/dario` reference. Local capture uses the
verified npm latest client and exports observations only with `--observed`.
See the [producer README](../template-workflow/README.md) for capture options.

## Repository workflows

The active workflows are under the repository-root `.github/workflows/` and
have the `template-workflow-` filename prefix:

- `ci`: Node 22/24 build, upstream source verification, original Dario tests,
  bake parity, runtime and nested repository tests, official artifact upload.
- `release`: build and verify the official artifact, then publish a
  `template-workflow-v<version>` release. Tags are separate from Dario releases.
- `upstream-sync`: inspect upstream hourly at :23 and open a tested sync PR.
- `npm-drift`: inspect Claude Code npm releases hourly at :00.
- `capture`: capture and rebake observations hourly at :41 on a dedicated Linux
  runner. It also handles label-only drift and stale rebake PRs.
- `liveness`: monitor the capture workflow every two hours.

CI runs on changes to the producer or its workflows, and supports manual
`workflow_dispatch`. Operational jobs target this repository explicitly, so
fork status does not silently disable the configured workflows.

## Live capture setup

Register a Linux self-hosted runner with the label `template-workflow`, install
Node/npm/Git/tar/gh, and prepare a usable Claude login for that runner account.
Set `TEMPLATE_RUNNER_LABEL` if the label differs. Once ready, set
`TEMPLATE_CAPTURE_ENABLED=true` to enable scheduled capture and its liveness
monitor. A manual dispatch is an explicit request to run even before that flag
is set.

Other supported variables: `TEMPLATE_HTTP_PROXY`, `TEMPLATE_CC_CACHE_DIR`,
`TEMPLATE_CC_VERSION` and `TEMPLATE_CLAUDE_BIN`. Default client selection is
latest; fixed client overrides still have to match the requested version.

The maintenance jobs require Contents, Issues, Pull requests and Actions
permissions as declared in their workflows. The repository must allow Actions
to create PRs when using GITHUB_TOKEN. `CC_DRIFT_BOT_PAT` is optional. After
creating a bot PR, the maintenance job explicitly dispatches producer CI for
that branch. Auto-merge is opt-in via `TEMPLATE_AUTO_MERGE=true` and the
repository's branch protection/auto-merge settings.

No test credentials are needed for the hosted build or producer regression
suite. A passing hosted build does not mean a live capture runner is registered.
