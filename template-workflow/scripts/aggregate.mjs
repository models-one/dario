import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NATIVE_PLATFORMS } from '../lib/platform.mjs';
import { verifyRelease } from '../lib/release.mjs';
import { aggregateTemplates, writeAggregate } from '../lib/aggregate.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const components = {};
for (const platform of NATIVE_PLATFORMS) {
  const directory = join(root, 'artifacts/inputs', platform);
  components[platform] = { ...verifyRelease(join(directory, 'latest'), { repository: process.env.GITHUB_REPOSITORY, targetPlatform: platform }), check: JSON.parse(readFileSync(join(directory, 'current-check.json'))) };
}
const aggregate = aggregateTemplates(components, { version: process.env.TEMPLATE_RESOLVED_CC_VERSION, repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, commit: process.env.GITHUB_SHA });
const out = join(root, 'artifacts/all');
writeAggregate(out, aggregate);
const verified = verifyRelease(out, { repository: process.env.GITHUB_REPOSITORY, targetPlatform: 'all' });
writeFileSync(join(root, 'artifacts/release-set.json'), JSON.stringify({ version: aggregate.metadata.cc_version, aggregate: verified.tag, platforms: Object.fromEntries(NATIVE_PLATFORMS.map((p) => [p, components[p].tag])) }, null, 2) + '\n');
console.log(JSON.stringify({ ...aggregate.metadata, tag: verified.tag }, null, 2));
