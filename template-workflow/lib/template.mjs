import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { VARIANT_FAMILIES, promptVariantsOf } from '../dist/live-fingerprint.js';
import { findUserPathHits } from '../dist/scrub-template.js';
import { NATIVE_PLATFORMS, assertTargetTemplate } from './platform.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function validateTemplate(raw) {
  const t = JSON.parse(Buffer.from(raw).toString('utf8'));
  if (!t || t._schemaVersion !== 3 || typeof t._version !== 'string' || !/^\d+\.\d+\.\d+$/.test(t._version)) throw new Error('Expected a Dario schema 3 template with an exact CC version');
  if (typeof t.agent_identity !== 'string' || !t.agent_identity || typeof t.system_prompt !== 'string' || !t.system_prompt) throw new Error('Missing agent identity or system prompt');
  if (!Array.isArray(t.tools) || !t.tools.length || !Array.isArray(t.tool_names) || t.tools.length !== t.tool_names.length) throw new Error('Invalid tool inventory');
  const seen = new Set();
  for (const [i, tool] of t.tools.entries()) {
    if (!tool || typeof tool.name !== 'string' || !tool.name.trim() || tool.name !== t.tool_names[i] || seen.has(tool.name) || tool.name.startsWith('mcp__')) throw new Error(`Invalid or duplicate tool at index ${i}`);
    if (typeof tool.description !== 'string' || !tool.input_schema || typeof tool.input_schema !== 'object' || Array.isArray(tool.input_schema)) throw new Error(`Invalid tool schema: ${tool.name}`);
    seen.add(tool.name);
  }
  for (const key of ['header_order', 'body_field_order']) {
    const fields = t[key];
    if (fields !== undefined && (!Array.isArray(fields) || fields.some((v) => typeof v !== 'string' || !v || /[\r\n]/.test(v)) || new Set(fields.map((v) => key === 'header_order' ? v.toLowerCase() : v)).size !== fields.length)) throw new Error(`Invalid ${key}`);
  }
  if (t.header_values !== undefined && (!t.header_values || Array.isArray(t.header_values) || typeof t.header_values !== 'object' || Object.values(t.header_values).some((v) => typeof v !== 'string' || /[\r\n]/.test(v)))) throw new Error('Invalid header_values');
  const variants = promptVariantsOf(t);
  const missing = VARIANT_FAMILIES.filter((f) => typeof variants[f.key] !== 'string' || !variants[f.key]).map((f) => f.key);
  if (missing.length) throw new Error(`Missing model variants: ${missing.join(', ')}`);
  const hits = findUserPathHits(JSON.stringify(t));
  if (hits.length) throw new Error('Template contains host-specific content after scrub');
  return t;
}

export function makeBundle(raw, source) {
  validateTemplate(raw);
  const keys = ['capture_run_id', 'environment_id', 'scene_revision', 'comparison_context_id', 'source_sequence', 'cc_version', 'dario_commit'];
  if (!source || keys.some((k) => typeof source[k] !== 'string' || !source[k] || source[k].length > 256 || /[\x00-\x1f\x7f]/.test(source[k])) || Object.keys(source).some((k) => !keys.includes(k))) throw new Error('A complete Gateway source object is required');
  if (!/^[1-9]\d*$/.test(source.source_sequence) || BigInt(source.source_sequence) > 9223372036854775807n || !/^[a-f0-9]{40}$/.test(source.dario_commit)) throw new Error('Invalid source sequence or Dario commit');
  const t = JSON.parse(raw);
  if (source.cc_version !== t._version) throw new Error('Source CC version does not match the template');
  return Buffer.from(JSON.stringify({ format: 'cc-template-bundle/v1', template_base64: Buffer.from(raw).toString('base64'), template_bytes: Buffer.byteLength(raw), template_sha256: sha256(raw), source }, null, 2) + '\n');
}

export function exportTemplate({ templatePath, out, source, provenance, origin = { type: 'local-export' } }) {
  const raw = readFileSync(templatePath);
  const t = validateTemplate(raw);
  if (origin.type === 'dario-official') throw new Error('Official snapshot delivery is not supported');
  if (provenance && (provenance.producer !== 'template-workflow' || provenance.template?.sha256 !== sha256(raw) || provenance.template?.cc_version !== t._version)) throw new Error('Template does not match its capture provenance');
  if (provenance) {
    if (!NATIVE_PLATFORMS.includes(provenance.target_platform) || !provenance.client?.platform?.startsWith(provenance.target_platform + '-')) throw new Error('Only verified native captures can be exported');
    assertTargetTemplate(t, provenance.target_platform);
  }
  if (provenance) origin = { type: 'template-workflow', operation: provenance.operation, upstream_commit: provenance.implementation.upstream_commit, run_url: provenance.run.url };
  // Validate every input before writing any deliverable.
  const bundle = source ? makeBundle(raw, source) : null;
  const target = resolve(out);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'cc-template-data.json'), raw);
  const metadata = { format: 'template-workflow-artifact/v1', ...(provenance ? { target_platform: provenance.target_platform } : {}), schema_version: 3, cc_version: t._version, captured_at: t._captured, bytes: raw.length, sha256: sha256(raw), tools: t.tools.length, variants: Object.keys(promptVariantsOf(t)), origin };
  writeFileSync(join(target, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  let sums = `${metadata.sha256}  cc-template-data.json\n`;
  if (provenance) {
    const bytes = Buffer.from(JSON.stringify(provenance, null, 2) + '\n');
    writeFileSync(join(target, 'provenance.json'), bytes);
    sums += `${sha256(bytes)}  provenance.json\n`;
  } else if (existsSync(join(target, 'provenance.json'))) rmSync(join(target, 'provenance.json'));
  sums += `${sha256(readFileSync(join(target, 'metadata.json')))}  metadata.json\n`;
  if (bundle) {
    writeFileSync(join(target, 'cc-template-bundle.json'), bundle);
    sums += `${sha256(bundle)}  cc-template-bundle.json\n`;
  }
  if (!bundle && existsSync(join(target, 'cc-template-bundle.json'))) rmSync(join(target, 'cc-template-bundle.json'));
  writeFileSync(join(target, 'SHA256SUMS'), sums);
  return { ...metadata, directory: target, bundle: !!bundle };
}
