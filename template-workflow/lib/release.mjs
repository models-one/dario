import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyProduction } from './production.mjs';
import { sha256 } from './template.mjs';
export const RELEASE_FILES = ['cc-template-data.json', 'metadata.json', 'provenance.json', 'SHA256SUMS'];
export function releaseTag(raw) {
  const template = JSON.parse(raw);
  return `template-cc-${template._version}-${sha256(raw).slice(0, 16)}`;
}
export function latestProductionRelease(releases) {
  return releases.filter((r) => !r.draft && !r.prerelease && /^template-cc-\d+\.\d+\.\d+-[a-f0-9]{16}$/.test(r.tag_name))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
}
export function verifyRelease(directory, { repository, tag, allowRepairableBaseline = false } = {}) {
  const raw = readFileSync(join(directory, RELEASE_FILES[0]));
  const provenance = JSON.parse(readFileSync(join(directory, 'provenance.json')));
  const template = verifyProduction(raw, provenance, { repository, allowRepairableBaseline });
  const metadata = JSON.parse(readFileSync(join(directory, 'metadata.json')));
  if (metadata.format !== 'template-workflow-artifact/v1' || metadata.origin?.type !== 'template-workflow' || metadata.cc_version !== template._version || metadata.bytes !== raw.length || metadata.sha256 !== sha256(raw)) throw new Error('Release metadata does not describe our produced template');
  if (tag && tag !== releaseTag(raw)) throw new Error('Release tag does not match the template digest');
  const lines = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
  for (const name of RELEASE_FILES.slice(0, -1)) {
    const wanted = `${sha256(readFileSync(join(directory, name)))}  ${name}`;
    if (!lines.includes(wanted)) throw new Error(`Release checksum missing or mismatched: ${name}`);
  }
  return { raw, provenance, metadata, tag: releaseTag(raw) };
}
