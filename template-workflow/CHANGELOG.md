# Changelog

## [Unreleased]

## [0.2.1] - 2026-10-23

- Integrate the standalone producer into models-one/dario with repository-root Actions and module-relative Git baselines.

## [0.2.0] - 2026-10-23

- Sync the official Dario capture implementation, deferred-tool preservation, defer_loading handling and template reference at 15d269e3.
- Verify full bake parity against the unmodified reference and export official template bytes by default. Mark local captures as observations.
- Prepare and verify the exact latest Claude Code client for each capture task; retain explicit historical-version runs.
- Add tested upstream synchronization and publish releases only when the official reference changes.

## [0.1.0] - 2026-10-23

- Extract Dario template capture, scrub, drift detection, rebake and label sync.
