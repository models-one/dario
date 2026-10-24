import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, validateTemplate } from './template.mjs';
import { verifyProduction } from './production.mjs';
import { verifyCurrentCheck } from './check.mjs';
import { NATIVE_PLATFORMS, profile } from './platform.mjs';
export const PLATFORM_FILES = Object.fromEntries(NATIVE_PLATFORMS.map((p) => [p, `cc-template-${profile(p).key}.json`]));
export function bundleDigest(raw, components) {
  return sha256(Buffer.from(JSON.stringify({ format: 'template-workflow-all/v1', default_platform: 'linux', template_sha256: sha256(raw), platforms: NATIVE_PLATFORMS.map((p) => [p, sha256(components[p].raw)]) })));
}
export function aggregateTemplates(components, { version, repository, runId, commit, now = new Date().toISOString() } = {}) {
  if (Object.keys(components).length !== NATIVE_PLATFORMS.length || NATIVE_PLATFORMS.some((p) => !components[p])) throw new Error('All three native platforms are required for aggregation');
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !repository || !runId || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Aggregation requires a resolved version and workflow batch identity');
  const index = { format: 'template-workflow-platforms/v1', cc_version: version, default_platform: 'linux', platforms: {} };
  const candidates = new Map();
  for (const platform of NATIVE_PLATFORMS) {
    const input = components[platform];
    const t = verifyProduction(input.raw, input.provenance, { expectedVersion: version, repository, targetPlatform: platform });
    verifyCurrentCheck(input.check, input.raw, { platform, version, repository, runId, commit });
    if (input.metadata?.target_platform !== platform || input.metadata.cc_version !== version || input.metadata.sha256 !== sha256(input.raw) || input.metadata.bytes !== input.raw.length || input.metadata.origin?.type !== 'template-workflow') throw new Error('Native metadata does not match the aggregation input');
    index.platforms[platform] = { file: PLATFORM_FILES[platform], sha256: sha256(input.raw), bytes: input.raw.length, metadata: input.metadata, provenance: input.provenance, current_check: input.check };
    for (const tool of t.tools) {
      if (!candidates.has(tool.name)) candidates.set(tool.name, []);
      candidates.get(tool.name).push({ platform, tool, observed: input.check.observed_tools.includes(tool.name) });
    }
  }
  const template = JSON.parse(components.linux.raw);
  const sources = {}, conflicts = [];
  template.tools = [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, choices]) => {
    choices.sort((a, b) => Number(b.observed) - Number(a.observed) || NATIVE_PLATFORMS.indexOf(a.platform) - NATIVE_PLATFORMS.indexOf(b.platform));
    const selected = choices[0];
    sources[name] = { platform: selected.platform, observation: selected.observed ? 'observed' : 'preserved' };
    const hashes = Object.fromEntries(choices.map((c) => [c.platform, sha256(Buffer.from(JSON.stringify(c.tool)))]));
    if (new Set(Object.values(hashes)).size > 1) conflicts.push({ name, selected_platform: selected.platform, definition_sha256: hashes });
    return selected.tool;
  });
  template.tool_names = template.tools.map((t) => t.name);
  const raw = Buffer.from(JSON.stringify(template, null, 2) + '\n');
  validateTemplate(raw);
  const bundle = bundleDigest(raw, components);
  const url = `https://github.com/${repository}/actions/runs/${runId}`;
  const metadata = { format: 'template-workflow-artifact/v1', target_platform: 'all', default_platform: 'linux', schema_version: 3, cc_version: version, captured_at: template._captured, bytes: raw.length, sha256: sha256(raw), bundle_sha256: bundle, tools: template.tools.length, variants: Object.keys(template.system_prompt_variants || {}), origin: { type: 'template-workflow', operation: 'aggregate', run_url: url }, selection: 'observed-first; Linux, macOS, Windows tie-break', tool_conflicts: conflicts };
  const provenance = { format: 'template-workflow-aggregate/v1', producer: 'template-workflow', target_platform: 'all', operation: 'aggregate', produced_at: now, template: { cc_version: version, bytes: raw.length, sha256: sha256(raw) }, bundle_sha256: bundle, default_platform: 'linux', tool_sources: sources, implementation: { repository, commit }, run: { id: runId, url } };
  return { raw, metadata, provenance, index, components };
}
export function writeAggregate(out, aggregate) {
  mkdirSync(out, { recursive: true });
  const files = new Map([
    ['cc-template-data.json', aggregate.raw],
    ['metadata.json', Buffer.from(JSON.stringify(aggregate.metadata, null, 2) + '\n')],
    ['provenance.json', Buffer.from(JSON.stringify(aggregate.provenance, null, 2) + '\n')],
    ['platforms.json', Buffer.from(JSON.stringify(aggregate.index, null, 2) + '\n')],
    ...NATIVE_PLATFORMS.map((p) => [PLATFORM_FILES[p], aggregate.components[p].raw]),
  ]);
  for (const [name, bytes] of files) writeFileSync(join(out, name), bytes);
  writeFileSync(join(out, 'SHA256SUMS'), [...files].map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`).join(''));
}
export function verifyAggregate(directory, { repository } = {}) {
  const raw = readFileSync(join(directory, 'cc-template-data.json'));
  const metadata = JSON.parse(readFileSync(join(directory, 'metadata.json')));
  const provenance = JSON.parse(readFileSync(join(directory, 'provenance.json')));
  const index = JSON.parse(readFileSync(join(directory, 'platforms.json')));
  if (metadata.target_platform !== 'all' || provenance.format !== 'template-workflow-aggregate/v1' || provenance.operation !== 'aggregate' || provenance.producer !== 'template-workflow' || index.format !== 'template-workflow-platforms/v1' || index.default_platform !== 'linux') throw new Error('Invalid aggregate artifact contract');
  const components = {};
  for (const p of NATIVE_PLATFORMS) {
    const entry = index.platforms?.[p];
    if (entry?.file !== PLATFORM_FILES[p]) throw new Error('Invalid platform file mapping');
    const component = readFileSync(join(directory, PLATFORM_FILES[p]));
    if (entry.sha256 !== sha256(component) || entry.bytes !== component.length) throw new Error('Platform copy does not match the aggregate index');
    components[p] = { raw: component, metadata: entry.metadata, provenance: entry.provenance, check: entry.current_check };
  }
  const rebuilt = aggregateTemplates(components, { version: metadata.cc_version, repository: repository || provenance.implementation?.repository, commit: provenance.implementation?.commit, runId: provenance.run?.id, now: provenance.produced_at });
  if (!raw.equals(rebuilt.raw) || JSON.stringify(metadata) !== JSON.stringify(rebuilt.metadata) || JSON.stringify(provenance) !== JSON.stringify(rebuilt.provenance) || index.cc_version !== metadata.cc_version) throw new Error('Aggregate does not match its native inputs');
  return { raw, metadata, provenance, index };
}
