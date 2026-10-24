import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, validateTemplate } from './template.mjs';
import { TARGET_PLATFORM, assertTargetTemplate, foreignPlatformToolNames } from './platform.mjs';

export const PROVENANCE_FILE = 'src/cc-template-provenance.json';
const legacyConfigPath = (value) => typeof value === 'string' && value.includes('/work/_temp/template-claude-config/projects/');
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function productionRecord({ raw, baseline, client, operation, upstreamCommit, env = process.env, now = new Date().toISOString() }) {
  const template = validateTemplate(raw);
  if (!['capture', 'label-sync'].includes(operation) || template._version !== client.version) throw new Error('Capture output does not match the verified client');
  const repository = env.GITHUB_REPOSITORY || null;
  const runId = env.GITHUB_RUN_ID || null;
  return {
    format: 'template-workflow-production/v1', producer: 'template-workflow', target_platform: TARGET_PLATFORM, operation,
    produced_at: now,
    template: { cc_version: template._version, captured_at: template._captured, bytes: raw.length, sha256: sha256(raw) },
    client: { version: client.version, platform: client.platform, sha256: client.sha256, package: client.package || null, package_integrity: client.package_integrity || null, requested: client.requested || 'explicit', resolved_at: client.resolved_at || now },
    baseline: { cc_version: JSON.parse(baseline)._version, sha256: sha256(baseline), ...(env.TEMPLATE_BASELINE_REPAIR ? { repair: JSON.parse(env.TEMPLATE_BASELINE_REPAIR) } : {}) },
    implementation: { upstream_commit: upstreamCommit, repository, commit: env.GITHUB_SHA || null },
    run: { id: runId, attempt: env.GITHUB_RUN_ATTEMPT || null, url: repository && runId ? `https://github.com/${repository}/actions/runs/${runId}` : null },
  };
}
export function verifyProduction(raw, provenance, { expectedVersion, repository, allowRepairableBaseline = false, allowLegacyPlatform = false } = {}) {
  const template = validateTemplate(raw);
  if (provenance?.format !== 'template-workflow-production/v1' || provenance.producer !== 'template-workflow' || !['capture', 'label-sync'].includes(provenance.operation)) throw new Error('Missing producer capture provenance; run npm run produce first');
  if (!allowRepairableBaseline && legacyConfigPath(raw.toString())) throw new Error('Template retains a legacy capture configuration path; recapture is required');
  const captured = provenance.template;
  if (!captured || captured.sha256 !== sha256(raw) || captured.bytes !== raw.length || captured.cc_version !== template._version || captured.captured_at !== template._captured) throw new Error('Template does not match its capture provenance');
  if (provenance.client?.version !== template._version || !digest(provenance.client?.sha256) || !digest(provenance.baseline?.sha256) || !/^[a-f0-9]{40}$/.test(provenance.implementation?.upstream_commit || '')) throw new Error('Invalid capture provenance');
  if (!allowLegacyPlatform) {
    if (provenance.target_platform !== TARGET_PLATFORM || !provenance.client.platform?.startsWith('darwin-')) throw new Error('Expected verified macOS capture provenance; a platform migration requires a fresh capture');
    assertTargetTemplate(template);
  }
  if (expectedVersion && template._version !== expectedVersion) throw new Error(`Produced CC ${template._version} does not match resolved latest ${expectedVersion}`);
  if (repository && provenance.implementation.repository !== repository) throw new Error('Capture provenance belongs to a different producer repository');
  return template;
}
export function readProduction(root, options) {
  const raw = readFileSync(join(root, 'src/cc-template-data.json'));
  const provenance = JSON.parse(readFileSync(join(root, PROVENANCE_FILE)));
  return { raw, provenance, template: verifyProduction(raw, provenance, options) };
}
export function recordProduction(root, options) {
  const provenance = productionRecord(options);
  verifyProduction(options.raw, provenance);
  writeFileSync(join(root, PROVENANCE_FILE), JSON.stringify(provenance, null, 2) + '\n');
  return provenance;
}

// A platform migration discards foreign prompt variants and A/B history. The
// native macOS client must supply all variants before a new artifact can ship.
export function prepareCaptureBaseline(root) {
  const file = join(root, 'src/cc-template-data.json');
  const original = readFileSync(file);
  const proofFile = join(root, PROVENANCE_FILE);
  const proof = existsSync(proofFile) ? JSON.parse(readFileSync(proofFile)) : null;
  if (proof) verifyProduction(original, proof, { allowRepairableBaseline: true, allowLegacyPlatform: true });
  const template = JSON.parse(original);
  const migration = proof?.target_platform !== TARGET_PLATFORM || !proof?.client?.platform?.startsWith('darwin-');
  const foreign = foreignPlatformToolNames(template);
  if (!migration && !foreign.length && !legacyConfigPath(original.toString())) return null;
  const removed = [];
  for (const [key, prompt] of Object.entries(template.system_prompt_variants || {})) {
    if (!migration && !legacyConfigPath(prompt)) continue;
    delete template.system_prompt_variants[key];
    if (template._variantShapeHashes) delete template._variantShapeHashes[key];
    removed.push(key);
  }
  if (migration) {
    delete template.system_prompt_fable;
    delete template._variantShapeHashes;
  }
  template.tools = template.tools.filter((tool) => !foreign.includes(tool.name));
  template.tool_names = template.tools.map((tool) => tool.name);
  writeFileSync(file, JSON.stringify(template, null, 2) + '\n');
  rmSync(proofFile, { force: true });
  return { reason: migration || foreign.length ? 'macos-platform-migration' : 'legacy-temporary-config-path', previous_sha256: sha256(original), previous_capture_platform: proof?.client?.platform || 'unverified', target_platform: TARGET_PLATFORM, removed_tools: foreign, recaptured_variants: removed };
}
