# Template Workflow

Template Workflow produces four independently versioned outputs: the total template package, macOS, Windows and Linux. Capture, cleaning, tool preservation, drift detection and publication are maintained in this repository. Normal production requires no Dario service, repository access or future source release. Original source/license records and development fixtures remain locally available.

## Automated production

One GitHub Actions run resolves npm `@anthropic-ai/claude-code@latest` once and passes the exact version to three native capture jobs:

- macOS: `macos-latest`, native `darwin-*` client.
- Windows: `windows-latest`, native `win32-*` client.
- Linux: `ubuntu-latest`, native `linux-*` client.

Each job verifies npm package integrity, binary digest and reported version. It restores only its own platform's previous release, captures the base prompt and the three model-family variants through a local collector, scrubs host details, merges eligible historical tools, checks drift and rebakes or synchronizes labels when required. A missing platform baseline triggers a migration from the checked-in owned baseline, clearing old prompt variants and A/B history so each family must be captured on the new platform.

`capture-observation.json` records tool names and model outcomes actually observed. `artifacts/current-check.json` binds that evidence, the exact client, template digest and workflow run. These contain no account credentials or raw requests. A failed or retained-from-failure model capture cannot qualify a four-platform publication batch.

The capture matrix uses placeholder authentication against its loopback collector. It needs no personal Claude login or paid inference request. This is not an authenticated official-endpoint equivalence certificate.

## Four release products

- `template-macos-cc-<version>-<digest>`: macOS schema 3 template.
- `template-windows-cc-<version>-<digest>`: Windows schema 3 template.
- `template-linux-cc-<version>-<digest>`: Linux schema 3 template.
- `template-all-cc-<version>-<bundle-digest>`: total package, published last and marked GitHub Latest.

Every native release contains `cc-template-data.json`, `metadata.json`, `provenance.json` and `SHA256SUMS`. Metadata and provenance identify `target_platform` as `darwin`, `win32` or `linux`. macOS/Linux artifacts reject names currently classified Windows-only: PowerShell, Glob and Grep. Windows definitions must be observed or come from its own prior baseline; they are not supplied by fetching an external template.

The total release contains the standard four files plus:

- `cc-template-macos.json`, `cc-template-windows.json`, `cc-template-linux.json`: byte-identical copies of this batch's verified native outputs.
- `platforms.json`: platform-to-file mapping, component digests, metadata, original capture provenance and current-run observation evidence.

The total `cc-template-data.json` is a backward-compatible schema 3 union. It uses the Linux base/model prompts and merges tool names across the three inputs. For a shared tool, a definition observed in this batch takes precedence over preserved history; ties use Linux, macOS, Windows order. Differing definitions are recorded in `metadata.json.tool_conflicts`, and `provenance.json.tool_sources` identifies each selected tool. Consumers requiring a native platform's exact prompt and definitions must select that platform file; the union is not one raw native request body.

The total tag hashes both its union and all three native template digests. A platform-only prompt change therefore creates a new total release even when the Linux-default union is unchanged. Before any release is created, all four outputs are validated together for version, platform, checksums and a shared workflow batch. GitHub does not provide a four-release transaction: native releases publish first, total publishes last. Publication is idempotent so a failed publication job can be rerun safely.

## Historical definitions and independence

The implementation and initial baseline were originally imported from Dario. Some retained tool definitions can still trace to that initial baseline. A capture updates definitions it observes; platform-compatible interactive, configuration-scoped and deferred tools may be retained when absent. The producer blocks unclassified tool loss instead of silently shrinking the inventory. Not every tool in a release is freshly captured, and a no-drift result does not prove that unobserved tools are current.

Normal production restores only our releases or our checked-in baseline. It does not download another project's template. Source imports are optional manual maintenance, never part of scheduled production. Original notices and `upstream-snapshot.json` document historical source attribution and local file integrity.

## Commands

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run produce
npm run export
```

`produce` defaults to the host platform, which must be macOS, Windows or Linux. `TEMPLATE_TARGET_PLATFORM=darwin|win32|linux` can select a native target, but capture cannot impersonate another OS. Local production resolves latest; the workflow uses `TEMPLATE_RESOLVED_CC_VERSION` from its shared resolution job. `TEMPLATE_HTTP_PROXY` configures downloads, such as a local proxy on port 7897.

`export` validates the captured platform in provenance and copies the raw template unchanged into `artifacts/latest/`; export itself can run on any OS. `export --source source.json` additionally writes the existing Gateway `cc-template-bundle/v1` envelope without altering the inner bytes. No custom platform field is added to the schema 3 template itself.

## Workflows and checks

- `template-workflow-release.yml`: resolve latest, capture on three native runners, aggregate, test and publish all four releases.
- `template-workflow-capture.yml`: hourly at :41, invokes the complete release workflow.
- `template-workflow-ci.yml`: Node 22/24 on macOS and Linux; capture/merge/parity/provenance/aggregate regression tests.
- `template-workflow-npm-drift.yml`: npm monitoring and production dispatch on drift.
- `template-workflow-liveness.yml`: scheduled capture health monitoring.
- `template-workflow-upstream-sync.yml`: optional manual source import; no schedule.

Manual release dispatch accepts `publish=false` to exercise all native captures and aggregation, upload Actions artifacts, and skip release publication. Windows is validated by its real native capture job; POSIX mock-client tests run on macOS/Linux. `verify:source` checks local files only. Maintenance PRs require an organization-approved bot token; normal four-product publication uses `GITHUB_TOKEN` and does not depend on PR creation.

GitHub Issues are optional for drift/liveness notifications. When the repository disables Issues, the automation writes its notification to the Actions step summary and `automation-summary.md`; npm drift still dispatches capture. The npm-drift artifact includes both the scan report and notification summary. Authentication, network, API and workflow-dispatch errors remain job failures.
