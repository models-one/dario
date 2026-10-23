import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { adaptUpstreamSource } from './upstream-adapters.mjs';
import { bumpPatch, promoteUnreleased, appendUnreleased } from '../scripts/_drift-patch-helpers.mjs';
const hash = (raw) => createHash('sha256').update(raw).digest('hex');

// Prepare implementation and development fixtures without changing production data.
// The network entry point supplies bytes from a single fixed Git commit.
export function planUpstreamSync({ root, commit, readUpstream }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid upstream commit');
  const old = JSON.parse(readFileSync(join(root, 'upstream-snapshot.json')));
  if (old.commit === commit) return { changed: false, commit };
  const pending = new Map(), records = {};
  for (const [target, previous] of Object.entries(old.files)) {
    if (target === 'src/cc-template-data.json' || target === 'src/cc-template-provenance.json' || target.startsWith('reference/')) continue;
    const source = previous.source_path || target;
    if (target.startsWith('/') || target.split('/').includes('..') || source.startsWith('/') || source.split('/').includes('..')) throw new Error('Invalid upstream source path');
    const raw = Buffer.from(readUpstream(source));
    const adapted = adaptUpstreamSource(target, raw);
    const local = adapted.bytes;
    const record = { source_path: source, source_sha256: hash(raw), local_sha256: hash(local) };
    if (!raw.equals(local)) record.change = adapted.change;
    if (target === 'test/compat-pinned.json') record.mutable = 'version regression data updated by the upstream drift drafter';
    if (target === 'src/live-fingerprint.ts') {
      const text = local.toString();
      record.maxTested = /maxTested:\s*'([^']+)'/.exec(text)?.[1];
      if (!record.maxTested) throw new Error('Upstream maxTested layout changed');
      record.normalized_sha256 = hash(Buffer.from(text.replace(/maxTested:\s*'[^']+'/g, "maxTested: 'PINNED'")));
    }
    pending.set(target, local); records[target] = record;
  }
  const templateBytes = pending.get('test/reference/dario/src/cc-template-data.json');
  const template = JSON.parse(templateBytes);
  if (template._schemaVersion !== 3 || !Array.isArray(template.tools) || !Array.isArray(template.tool_names) || template.tool_names.length !== template.tools.length || template.tools.some((tool, i) => tool.name !== template.tool_names[i])) throw new Error('Unsupported upstream template contract');
  const snapshot = { repository: 'askalf/dario', commit, files: records };
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  pkg.version = bumpPatch(pkg.version);
  pkg.devDependencies = JSON.parse(readUpstream('package.json')).devDependencies;
  const lock = JSON.parse(readUpstream('package-lock.json'));
  lock.name = pkg.name; lock.version = pkg.version;
  Object.assign(lock.packages[''], { name: pkg.name, version: pkg.version, engines: pkg.engines, bin: pkg.bin, devDependencies: pkg.devDependencies });
  pending.set('package.json', Buffer.from(JSON.stringify(pkg, null, 2) + '\n'));
  pending.set('package-lock.json', Buffer.from(JSON.stringify(lock, null, 2) + '\n'));
  const date = new Date().toISOString().slice(0, 10);
  const changelog = promoteUnreleased(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), pkg.version, date);
  pending.set('CHANGELOG.md', Buffer.from(appendUnreleased(changelog, `- Sync Dario ${commit.slice(0, 12)} implementation and development fixtures; preserve the producer baseline.`, new RegExp(`^## \\[${pkg.version}\\] - ${date}\\s*$`, 'm'))));
  // Write the implementation lock last so partial code updates cannot pass verification.
  pending.set('upstream-snapshot.json', Buffer.from(JSON.stringify(snapshot, null, 2) + '\n'));
  return { changed: true, commit, ccVersion: template._version, version: pkg.version, files: pending, changedFiles: [...pending.keys()] };
}
export function applyUpstreamSync(root, plan) {
  if (!plan.changed) return plan;
  for (const [name, raw] of plan.files) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), raw); }
  const { files, ...summary } = plan;
  return summary;
}
