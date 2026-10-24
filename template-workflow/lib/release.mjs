import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyProduction } from './production.mjs';
import { verifyAggregate, PLATFORM_FILES } from './aggregate.mjs';
import { sha256 } from './template.mjs';
import { TARGET_PLATFORM, profile } from './platform.mjs';
export const RELEASE_FILES = ['cc-template-data.json', 'metadata.json', 'provenance.json', 'SHA256SUMS'];
export function releaseFiles(platform) {
  return platform === 'all' ? [...RELEASE_FILES, 'platforms.json', ...Object.values(PLATFORM_FILES)] : RELEASE_FILES;
}
export function releaseTag(raw, platform = TARGET_PLATFORM, bundleHash) {
  const t = JSON.parse(raw);
  const digest = platform === 'all' ? bundleHash : sha256(raw);
  if (!/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('Missing release content digest');
  return `template-${profile(platform).key}-cc-${t._version}-${digest.slice(0, 16)}`;
}
export function latestProductionRelease(releases, platform = TARGET_PLATFORM) {
  const pattern = new RegExp(`^template-${profile(platform).key}-cc-\\d+\\.\\d+\\.\\d+-[a-f0-9]{16}$`);
  return releases.filter((r) => !r.draft && !r.prerelease && pattern.test(r.tag_name)).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
}
export function latestLegacyProductionRelease(releases) {
  return releases.filter((r) => !r.draft && !r.prerelease && /^template-cc-\d+\.\d+\.\d+-[a-f0-9]{16}$/.test(r.tag_name)).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
}
export function verifyRelease(directory, { repository, tag, targetPlatform, allowRepairableBaseline = false, allowLegacyPlatform = false } = {}) {
  const raw = readFileSync(join(directory, 'cc-template-data.json'));
  const provenance = JSON.parse(readFileSync(join(directory, 'provenance.json')));
  const metadata = JSON.parse(readFileSync(join(directory, 'metadata.json')));
  const platform = targetPlatform || metadata.target_platform || TARGET_PLATFORM;
  let template;
  if (platform === 'all') { verifyAggregate(directory, { repository }); template = JSON.parse(raw); }
  else template = verifyProduction(raw, provenance, { repository, targetPlatform: platform, allowRepairableBaseline, allowLegacyPlatform });
  if (metadata.format !== 'template-workflow-artifact/v1' || metadata.origin?.type !== 'template-workflow' || metadata.cc_version !== template._version || metadata.bytes !== raw.length || metadata.sha256 !== sha256(raw) || metadata.tools !== template.tools.length) throw new Error('Release metadata does not describe our produced template');
  if (!allowLegacyPlatform && metadata.target_platform !== platform) throw new Error('Release platform mismatch');
  const expectedTag = allowLegacyPlatform && tag?.startsWith('template-cc-') ? `template-cc-${template._version}-${sha256(raw).slice(0,16)}` : releaseTag(raw, platform, metadata.bundle_sha256);
  if (tag && tag !== expectedTag) throw new Error('Release tag does not match the content digest');
  const lines = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
  for (const name of releaseFiles(platform).filter((name) => name !== 'SHA256SUMS')) {
    if (!lines.includes(`${sha256(readFileSync(join(directory, name)))}  ${name}`)) throw new Error(`Release checksum missing or mismatched: ${name}`);
  }
  return { raw, provenance, metadata, tag: expectedTag };
}
