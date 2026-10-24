import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { aggregateTemplates, writeAggregate, verifyAggregate } from '../lib/aggregate.mjs';
import { productionRecord } from '../lib/production.mjs';
import { sha256, exportTemplate } from '../lib/template.mjs';
import { verifyRelease, releaseTag, latestProductionRelease } from '../lib/release.mjs';
const seed = JSON.parse(readFileSync(new URL('./fixtures/seed-template.json', import.meta.url)));
const context = { version: seed._version, repository: 'owner/producer', runId: '456', commit: 'c'.repeat(40) };
function components(t) {
  const root = mkdtempSync(join(tmpdir(), 'multi-platform-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = {};
  for (const platform of ['linux', 'darwin', 'win32']) {
    const template = structuredClone(seed);
    if (platform !== 'win32') template.tools = template.tools.filter((tool) => !['PowerShell', 'Glob', 'Grep'].includes(tool.name));
    template.tool_names = template.tools.map((tool) => tool.name);
    template.system_prompt += `\n${platform} real native scene`;
    template.tools.find((tool) => tool.name === 'Read').description = `Read on ${platform}`;
    const raw = Buffer.from(JSON.stringify(template, null, 2) + '\n');
    const client = { version: seed._version, platform: platform + '-x64', sha256: 'a'.repeat(64), requested: 'latest' };
    const provenance = productionRecord({ raw, baseline: raw, client, operation: 'capture', upstreamCommit: 'b'.repeat(40), env: { GITHUB_REPOSITORY: context.repository, GITHUB_RUN_ID: context.runId, GITHUB_SHA: context.commit } });
    const input = join(root, `${platform}.json`); writeFileSync(input, raw);
    const output = exportTemplate({ templatePath: input, out: join(root, platform), provenance });
    const { directory, bundle, ...metadata } = output;
    const check = { format: 'template-workflow-check/v1', target_platform: platform, cc_version: seed._version, template_sha256: sha256(raw), repository: context.repository, run_id: context.runId, commit: context.commit, client, observed_tools: platform === 'darwin' ? ['Read'] : ['Bash'], variant_outcomes: { fable: 'fresh', 'opus-5': 'fresh', 'sonnet-5': 'fresh' }, variant_hashes: {} };
    result[platform] = { raw, provenance, metadata, check };
  }
  return result;
}
test('aggregate keeps exact platform files and prefers observed definitions over inherited ones', (t) => {
  const input = components(t);
  const result = aggregateTemplates(input, context);
  const union = JSON.parse(result.raw);
  assert.equal(union.system_prompt, JSON.parse(input.linux.raw).system_prompt);
  assert.equal(union.tools.find((tool) => tool.name === 'Read').description, 'Read on darwin');
  assert.ok(union.tool_names.includes('PowerShell'));
  assert.equal(result.provenance.tool_sources.Read.platform, 'darwin');
  assert.ok(result.metadata.tool_conflicts.some((item) => item.name === 'Read'));
  const dir = mkdtempSync(join(tmpdir(), 'all-release-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeAggregate(dir, result);
  assert.deepEqual(readFileSync(join(dir, 'cc-template-windows.json')), input.win32.raw);
  assert.deepEqual(readFileSync(join(dir, 'cc-template-macos.json')), input.darwin.raw);
  const verified = verifyRelease(dir, { repository: context.repository, targetPlatform: 'all' });
  assert.equal(verified.tag, releaseTag(result.raw, 'all', result.metadata.bundle_sha256));
  assert.equal(verifyAggregate(dir).metadata.tools, union.tools.length);
  writeFileSync(join(dir, 'cc-template-windows.json'), input.linux.raw);
  assert.throws(() => verifyRelease(dir, { targetPlatform: 'all' }), /Platform copy/);
});
test('missing, mixed-version, cross-run and failed-variant inputs cannot become a total template', (t) => {
  for (const mutation of ['missing', 'version', 'run', 'variant', 'hash']) {
    const input = components(t);
    if (mutation === 'missing') delete input.win32;
    if (mutation === 'version') input.win32.check.cc_version = '9.9.9';
    if (mutation === 'run') input.win32.check.run_id = 'different-run';
    if (mutation === 'variant') input.win32.check.variant_outcomes.fable = 'kept';
    if (mutation === 'hash') input.win32.check.template_sha256 = '0'.repeat(64);
    assert.throws(() => aggregateTemplates(input, context));
  }
});
test('platform selection and aggregate digests isolate changes in every native component', (t) => {
  const input = components(t); const first = aggregateTemplates(input, context);
  const newer = Object.fromEntries(Object.entries(input).map(([p, c]) => [p, { ...structuredClone(c), raw: Buffer.from(c.raw) }])); const template = JSON.parse(newer.darwin.raw);
  template.system_prompt_variants.fable += '\nA macOS-only change';
  newer.darwin.raw = Buffer.from(JSON.stringify(template, null, 2) + '\n');
  const hash = sha256(newer.darwin.raw);
  newer.darwin.provenance.template.sha256 = hash; newer.darwin.provenance.template.bytes = newer.darwin.raw.length;
  newer.darwin.metadata.sha256 = hash; newer.darwin.metadata.bytes = newer.darwin.raw.length; newer.darwin.check.template_sha256 = hash;
  const second = aggregateTemplates(newer, context);
  assert.deepEqual(first.raw, second.raw); // Linux default prompt/union unchanged.
  assert.notEqual(first.metadata.bundle_sha256, second.metadata.bundle_sha256);
  const rows = ['linux', 'darwin', 'win32'].map((p) => ({tag_name: releaseTag(input[p].raw, p), published_at: '2026-10-24T00:00:00Z'}));
  for (const p of ['linux','darwin','win32']) assert.equal(latestProductionRelease(rows, p).tag_name, releaseTag(input[p].raw,p));
});
