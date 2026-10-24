# Changelog

## [Unreleased]

- Seed the repository with our verified hosted capture of Claude Code 2.1.310 and its production provenance.

- Publish our own latest-client captures with validated provenance; production no longer exports or compares an official Dario snapshot.
- Run capture and release on hosted Linux, restore only our produced baselines, and keep source synchronization separate from production data.

## [0.3.1] - 2026-10-23

- Sync Dario 0a4a7bc6cda6 implementation and development fixtures; preserve the producer baseline.

## [0.2.1] - 2026-10-23

- Integrate the standalone producer into models-one/dario with repository-root Actions and module-relative Git baselines.

## [0.2.0] - 2026-10-23

- Sync the official Dario capture implementation, deferred-tool preservation, defer_loading handling and template reference at 15d269e3.
- Verify full bake parity against the unmodified reference and export official template bytes by default. Mark local captures as observations.
- Prepare and verify the exact latest Claude Code client for each capture task; retain explicit historical-version runs.
- Add tested upstream synchronization and publish releases only when the official reference changes.

## [0.1.0] - 2026-10-23

- Extract Dario template capture, scrub, drift detection, rebake and label sync.
