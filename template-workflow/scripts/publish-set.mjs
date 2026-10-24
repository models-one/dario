import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from '../lib/release.mjs';
import { NATIVE_PLATFORMS } from '../lib/platform.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [...NATIVE_PLATFORMS, 'all'];
const directories = Object.fromEntries(targets.map((p) => [p, join(root, p === 'all' ? 'artifacts/all' : `artifacts/inputs/${p}/latest`)]));
// Validate the complete set before the first GitHub mutation. The final all
// release is published last and is the sole latest release. Retries are idempotent.
for (const p of targets) {
  const artifact = verifyRelease(directories[p], { repository: process.env.GITHUB_REPOSITORY, targetPlatform: p });
  if (artifact.metadata.cc_version !== process.env.TEMPLATE_RESOLVED_CC_VERSION) throw new Error('Release set contains mixed Claude Code versions');
}
for (const p of targets) {
  const result = spawnSync(process.execPath, [join(root, 'scripts/production-release.mjs'), 'publish', directories[p]], { cwd: root, env: { ...process.env, TEMPLATE_TARGET_PLATFORM: p }, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Publication failed for ${p}; rerun the failed publication job to resume`);
}
