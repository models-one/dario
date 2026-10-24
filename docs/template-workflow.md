# Four-platform template workflows

The producer is in `template-workflow/`. One scheduled or manual run publishes four products: total, macOS, Windows and Linux.

The release workflow resolves the latest Claude Code version once, then uses macOS, Windows and Linux hosted runners to install verified native clients at that exact version. Each restores its own baseline, captures and cleans request templates, detects drift and rebakes or synchronizes labels. A job records current observation evidence even when no rebake is needed.

Aggregation requires all three native outputs from the same workflow run, version and commit. It verifies checksums, platform provenance and successful model captures. Missing inputs, wrong-platform artifacts, version mismatches, corrupt bytes or failed variants stop publication. The entire set is verified before the first release write.

Native release tags use `template-macos-cc-*`, `template-windows-cc-*` and `template-linux-cc-*`. The total uses `template-all-cc-*` and becomes Latest after the native releases succeed. Retrying publication verifies existing immutable assets and completes missing releases.

Every release has the template, metadata, provenance and SHA256SUMS. The total also has exact platform-specific JSON files and platforms.json. Its schema 3 compatibility union uses Linux prompts and observed-first tool selection; metadata lists cross-platform definition conflicts. Consumers needing platform fidelity select the native file. No schema 3 contract extension is required.

The producer and its initial historical baseline originated in Dario. Code, tests and baselines are now locally maintained, and scheduled production does not fetch upstream source or templates. Some tools remain historically preserved rather than freshly observed. Original licensing and source attribution remain available.

Scheduled capture runs hourly at :41. Manual dispatch with `publish=false` runs the same full capture/aggregation without publishing. CI covers Node 22/24 on macOS and Linux; Windows is exercised by real native capture. No personal Claude login is required for the local collector. Optional source import is manual-only.

See `template-workflow/README.md` for files, platform selection, provenance, commands and release details.
