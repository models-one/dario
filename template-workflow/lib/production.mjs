import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, validateTemplate } from './template.mjs';

export const PROVENANCE_FILE = 'src/cc-template-provenance.json';
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function productionRecord({ raw, baseline, client, operation, upstreamCommit, env = process.env, now = new Date().toISOString() }) {
  const template = validateTemplate(raw);
  if (!['capture', 'label-sync'].includes(operation) || template._version !== client.version) throw new Error('Capture output does not match the verified client');
  const repository = env.GITHUB_REPOSITORY || null;
  const runId = env.GITHUB_RUN_ID || null;
  return {
    format: 'template-workflow-production/v1', producer: 'template-workflow', operation,
    produced_at: now,
    template: { cc_version: template._version, captured_at: template._captured, bytes: raw.length, sha256: sha256(raw) },
    client: { version: client.version, platform: client.platform, sha256: client.sha256, package: client.package || null, package_integrity: client.package_integrity || null, requested: client.requested || 'explicit', resolved_at: client.resolved_at || now },
    baseline: { cc_version: JSON.parse(baseline)._version, sha256: sha256(baseline) },
    implementation: { upstream_commit: upstreamCommit, repository, commit: env.GITHUB_SHA || null },
    run: { id: runId, attempt: env.GITHUB_RUN_ATTEMPT || null, url: repository && runId ? `https://github.com/${repository}/actions/runs/${runId}` : null },
  };
}
export function verifyProduction(raw, provenance, { expectedVersion, repository } = {}) {
  const template = validateTemplate(raw);
  if (provenance?.format !== 'template-workflow-production/v1' || provenance.producer !== 'template-workflow' || !['capture', 'label-sync'].includes(provenance.operation)) throw new Error('Missing producer capture provenance; run npm run produce first');
  const captured = provenance.template;
  if (!captured || captured.sha256 !== sha256(raw) || captured.bytes !== raw.length || captured.cc_version !== template._version || captured.captured_at !== template._captured) throw new Error('Template does not match its capture provenance');
  if (provenance.client?.version !== template._version || !digest(provenance.client?.sha256) || !digest(provenance.baseline?.sha256) || !/^[a-f0-9]{40}$/.test(provenance.implementation?.upstream_commit || '')) throw new Error('Invalid capture provenance');
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
