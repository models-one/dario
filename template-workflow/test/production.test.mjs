import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { productionRecord, verifyProduction, prepareCaptureBaseline } from '../lib/production.mjs';
import { exportTemplate } from '../lib/template.mjs';
import { verifyRelease, releaseTag, latestProductionRelease } from '../lib/release.mjs';
const originalSeed = JSON.parse(readFileSync(new URL('./fixtures/seed-template.json', import.meta.url)));
originalSeed.tools = originalSeed.tools.filter((tool) => !['PowerShell', 'Glob', 'Grep'].includes(tool.name));
originalSeed.tool_names = originalSeed.tools.map((tool) => tool.name);
const raw = Buffer.from(JSON.stringify(originalSeed, null, 2) + '\n');
const template = JSON.parse(raw);
const record = () => productionRecord({ raw, baseline: raw, client: { version: template._version, sha256: 'a'.repeat(64), platform: 'darwin-arm64', requested: 'latest' }, operation: 'capture', upstreamCommit: 'b'.repeat(40), env: { GITHUB_REPOSITORY: 'owner/producer', GITHUB_SHA: 'c'.repeat(40), GITHUB_RUN_ID: '123' } });
test('capture proof binds the bytes, resolved client version and producer repository', () => {
  assert.equal(verifyProduction(raw, record(), { expectedVersion: template._version, repository: 'owner/producer' })._version, template._version);
  assert.throws(() => verifyProduction(raw, null), /provenance/);
  assert.throws(() => verifyProduction(raw, record(), { expectedVersion: '9.9.9' }), /resolved latest/);
  assert.throws(() => verifyProduction(raw, record(), { repository: 'someone/else' }), /different producer/);
  assert.throws(() => verifyProduction(Buffer.from(JSON.stringify({ ...template, system_prompt: template.system_prompt + 'changed' })), record()), /provenance/);
  const wrong = record(); wrong.client.version = '9.9.9'; assert.throws(() => verifyProduction(raw, wrong), /Invalid/);
});
test('published and restored artifacts require our provenance, metadata and complete checksums', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'produced-release-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'input.json'); writeFileSync(input, raw);
  const out = join(dir, 'out');
  exportTemplate({ templatePath: input, out, provenance: record() });
  const result = verifyRelease(out, { repository: 'owner/producer', tag: releaseTag(raw) });
  assert.deepEqual(result.raw, raw); assert.equal(result.metadata.origin.type, 'template-workflow');
  assert.equal(result.provenance.run.url, 'https://github.com/owner/producer/actions/runs/123');
  assert.throws(() => verifyRelease(out, { tag: `template-macos-cc-${template._version}-${'0'.repeat(16)}` }), /tag/);
  const sums = readFileSync(join(out, 'SHA256SUMS')); writeFileSync(join(out, 'SHA256SUMS'), '');
  assert.throws(() => verifyRelease(out), /checksum/); writeFileSync(join(out, 'SHA256SUMS'), sums);
  const metadata = JSON.parse(readFileSync(join(out, 'metadata.json'))); metadata.origin.type = 'dario-official'; writeFileSync(join(out, 'metadata.json'), JSON.stringify(metadata));
  assert.throws(() => verifyRelease(out), /our produced/);
});
test('baseline selection ignores legacy official releases and incomplete releases', () => {
  const good = { tag_name: releaseTag(raw), published_at: '2026-10-23T00:00:00Z' };
  const candidates = [good, { tag_name: `template-cc-${template._version}-${'a'.repeat(16)}`, published_at: '2027-01-01T00:00:00Z' }, { tag_name: 'template-workflow-v0.2.1', published_at: '2026-12-01T00:00:00Z' }, { ...good, draft: true, published_at: '2026-12-02T00:00:00Z' }, { ...good, prerelease: true, published_at: '2026-12-03T00:00:00Z' }];
  assert.equal(latestProductionRelease(candidates), good);
  assert.equal(latestProductionRelease(candidates.slice(1)), undefined);
});

test('legacy hosted-config paths force fresh variant capture instead of sticking in A/B memory', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'repair-capture-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  const legacy = structuredClone(template);
  legacy.system_prompt_variants.fable += '\nMemory at /home/user/work/_temp/template-claude-config/projects/old/memory/';
  legacy._variantShapeHashes = { fable: ['old-shape'], 'opus-5': ['keep-this-shape'] };
  const bytes = Buffer.from(JSON.stringify(legacy));
  const proof = productionRecord({ raw: bytes, baseline: raw, client: { version: template._version, sha256: 'a'.repeat(64), platform: 'darwin-arm64' }, operation: 'capture', upstreamCommit: 'b'.repeat(40), env: {} });
  writeFileSync(join(root, 'src/cc-template-data.json'), bytes);
  writeFileSync(join(root, 'src/cc-template-provenance.json'), JSON.stringify(proof));
  assert.throws(() => verifyProduction(bytes, proof), /recapture/);
  const repair = prepareCaptureBaseline(root);
  assert.deepEqual(repair.recaptured_variants, ['fable']);
  const prepared = JSON.parse(readFileSync(join(root, 'src/cc-template-data.json')));
  assert.deepEqual(prepared.tools, template.tools);
  assert.equal(prepared.system_prompt_variants.fable, undefined);
  assert.equal(prepared._variantShapeHashes.fable, undefined);
  assert.deepEqual(prepared._variantShapeHashes['opus-5'], ['keep-this-shape']);
  assert.equal(existsSync(join(root, 'src/cc-template-provenance.json')), false);
  // Missing provenance still requires a fresh macOS capture, even after cleanup.
  assert.throws(() => verifyProduction(Buffer.from(JSON.stringify(prepared)), null), /Missing model variants/);
});

test('macOS export rejects Linux provenance and Windows tool definitions', (t) => {
  const linux = record(); linux.client.platform = 'linux-x64';
  assert.throws(() => verifyProduction(raw, linux), /macOS/);
  const missing = record(); delete missing.target_platform;
  assert.throws(() => verifyProduction(raw, missing), /macOS/);
  const contaminated = structuredClone(template);
  contaminated.tools.push({ name: 'PowerShell', description: 'Windows-only', input_schema: { type: 'object' } });
  contaminated.tool_names.push('PowerShell');
  const bytes = Buffer.from(JSON.stringify(contaminated));
  const proof = productionRecord({ raw: bytes, baseline: raw, client: { version: template._version, sha256: 'a'.repeat(64), platform: 'darwin-arm64' }, operation: 'capture', upstreamCommit: 'b'.repeat(40), env: {} });
  assert.throws(() => verifyProduction(bytes, proof), /other-platform tools: PowerShell/);
  const dir = mkdtempSync(join(tmpdir(), 'macos-export-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'input.json'); writeFileSync(input, bytes);
  assert.throws(() => exportTemplate({ templatePath: input, out: join(dir, 'out'), provenance: proof }), /other-platform/);
  assert.equal(existsSync(join(dir, 'out')), false);
});

test('Linux baseline migration drops foreign tools and all prompt history before macOS recapture', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'macos-migrate-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src'));
  const old = structuredClone(template);
  old.tools.push({ name: 'PowerShell', description: 'old platform', input_schema: { type: 'object' } });
  old.tool_names.push('PowerShell'); old._variantShapeHashes = { fable: ['old-linux-shape'] };
  const bytes = Buffer.from(JSON.stringify(old));
  const proof = productionRecord({ raw: bytes, baseline: raw, client: { version: template._version, sha256: 'a'.repeat(64), platform: 'linux-x64' }, operation: 'capture', upstreamCommit: 'b'.repeat(40), env: {} });
  delete proof.target_platform;
  writeFileSync(join(dir, 'src/cc-template-data.json'), bytes); writeFileSync(join(dir, 'src/cc-template-provenance.json'), JSON.stringify(proof));
  const migration = prepareCaptureBaseline(dir);
  assert.equal(migration.reason, 'macos-platform-migration'); assert.equal(migration.previous_capture_platform, 'linux-x64');
  assert.deepEqual(migration.removed_tools, ['PowerShell']);
  const migrated = JSON.parse(readFileSync(join(dir, 'src/cc-template-data.json')));
  assert.equal(migrated.tools.some((tool) => tool.name === 'PowerShell'), false);
  assert.deepEqual(migrated.tool_names, migrated.tools.map((tool) => tool.name));
  assert.deepEqual(Object.keys(migrated.system_prompt_variants), []);
  assert.equal(migrated._variantShapeHashes, undefined);
  assert.equal(existsSync(join(dir, 'src/cc-template-provenance.json')), false);
});
