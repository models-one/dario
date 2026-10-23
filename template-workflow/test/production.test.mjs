import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { productionRecord, verifyProduction } from '../lib/production.mjs';
import { exportTemplate } from '../lib/template.mjs';
import { verifyRelease, releaseTag, latestProductionRelease } from '../lib/release.mjs';
const raw = readFileSync(new URL('./fixtures/seed-template.json', import.meta.url));
const template = JSON.parse(raw);
const record = () => productionRecord({ raw, baseline: raw, client: { version: template._version, sha256: 'a'.repeat(64), platform: 'linux-x64', requested: 'latest' }, operation: 'capture', upstreamCommit: 'b'.repeat(40), env: { GITHUB_REPOSITORY: 'owner/producer', GITHUB_SHA: 'c'.repeat(40), GITHUB_RUN_ID: '123' } });
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
  assert.throws(() => verifyRelease(out, { tag: `template-cc-${template._version}-${'0'.repeat(16)}` }), /tag/);
  const sums = readFileSync(join(out, 'SHA256SUMS')); writeFileSync(join(out, 'SHA256SUMS'), '');
  assert.throws(() => verifyRelease(out), /checksum/); writeFileSync(join(out, 'SHA256SUMS'), sums);
  const metadata = JSON.parse(readFileSync(join(out, 'metadata.json'))); metadata.origin.type = 'dario-official'; writeFileSync(join(out, 'metadata.json'), JSON.stringify(metadata));
  assert.throws(() => verifyRelease(out), /our produced/);
});
test('baseline selection ignores legacy official releases and incomplete releases', () => {
  const good = { tag_name: releaseTag(raw), published_at: '2026-10-23T00:00:00Z' };
  const candidates = [good, { tag_name: 'template-workflow-v0.2.1', published_at: '2026-12-01T00:00:00Z' }, { ...good, draft: true, published_at: '2026-12-02T00:00:00Z' }, { ...good, prerelease: true, published_at: '2026-12-03T00:00:00Z' }];
  assert.equal(latestProductionRelease(candidates), good);
  assert.equal(latestProductionRelease(candidates.slice(1)), undefined);
});
