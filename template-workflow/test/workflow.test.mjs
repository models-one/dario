import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportTemplate, makeBundle, sha256, validateTemplate } from '../lib/template.mjs';
import { checkOpenRebake } from '../scripts/automation.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const seed = readFileSync(new URL('fixtures/seed-template.json', import.meta.url));
const source = (t) => ({ capture_run_id: 'synthetic-test-run', environment_id: 'synthetic-test-env', scene_revision: 'test-1', comparison_context_id: 'test', source_sequence: '1', cc_version: t._version, dario_commit: 'c528850aae26f1de845f364c430aeeb5b8d733ab' });

test('export preserves the original artifact bytes and Gateway bundle digest', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'template-export-')); t.after(() => rmSync(out, { recursive: true, force: true }));
  const input = join(out, 'original.json'); writeFileSync(input, seed);
  const template = validateTemplate(seed);
  const result = exportTemplate({ templatePath: input, out: join(out, 'export'), source: source(template) });
  assert.deepEqual(readFileSync(join(result.directory, 'cc-template-data.json')), seed);
  const bundle = JSON.parse(readFileSync(join(result.directory, 'cc-template-bundle.json')));
  assert.equal(bundle.format, 'cc-template-bundle/v1');
  assert.deepEqual(Buffer.from(bundle.template_base64, 'base64'), seed);
  assert.equal(bundle.template_sha256, sha256(seed)); assert.equal(bundle.template_bytes, seed.length);
  assert.equal(JSON.parse(makeBundle(seed, source(template))).source.cc_version, template._version);
  exportTemplate({ templatePath: input, out: result.directory });
  assert.equal(existsSync(join(result.directory, 'cc-template-bundle.json')), false);
  assert.throws(() => exportTemplate({ templatePath: input, out: join(out, 'false-official'), origin: { type: 'dario-official', reference_sha256: '0'.repeat(64), byte_identical: true } }), /not supported/);
  assert.equal(existsSync(join(out, 'false-official')), false);
});

test('malformed inventories, leaked paths and missing variants block artifact export', () => {
  for (const mutate of [(t) => { t.tool_names.pop(); }, (t) => { t.tools[0].input_schema = null; }, (t) => { delete t.system_prompt_variants.fable; }, (t) => { t.system_prompt += '\n/Users/capture-operator/private'; }, (t) => { t.header_values.accept = 'x\r\nInjected: bad'; }]) {
    const t = JSON.parse(seed); mutate(t); assert.throws(() => validateTemplate(Buffer.from(JSON.stringify(t))));
  }
  assert.throws(() => makeBundle(seed, { ...source(JSON.parse(seed)), cc_version: '1.0.0' }));
  assert.throws(() => makeBundle(seed, { ...source(JSON.parse(seed)), source_sequence: '9223372036854775808' }));
  assert.doesNotThrow(() => validateTemplate(seed)); // Includes advisor's empty schema.
});

test('real CLI capture/check/label/export chain with a controlled Claude process', { timeout: 100000 }, (t) => {
  const work = mkdtempSync(join(tmpdir(), 'template-cli-')); t.after(() => rmSync(work, { recursive: true, force: true }));
  cpSync(root, work, { recursive: true, filter: (file) => !['node_modules', '.git', 'artifacts'].some((name) => file === resolve(root, name) || file.startsWith(resolve(root, name) + '/')) });
  writeFileSync(join(work, 'src/cc-template-data.json'), seed); writeFileSync(join(work, 'dist/cc-template-data.json'), seed);
  const captures = join(work, 'captures.jsonl');
  const env = { ...process.env, TEMPLATE_CLAUDE_BIN: join(work, 'test/fixtures/mock-claude.mjs'), TEMPLATE_TEST_TEMPLATE: join(work, 'test/fixtures/seed-template.json'), TEMPLATE_TEST_CAPTURES: captures };
  const cli = (args, extra = {}) => spawnSync(process.execPath, [join(work, 'bin/template-workflow.mjs'), ...args], { cwd: work, env: { ...env, ...extra, TEMPLATE_CC_VERSION: extra.TEMPLATE_TEST_VERSION || JSON.parse(seed)._version }, encoding: 'utf8', timeout: 70000 });
  let r = cli(['check']); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(work, 'src/cc-template-data.json')), seed);
  const calls = readFileSync(captures, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map((c) => c.model), ['claude-opus-4-8', 'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5']);
  assert.ok(calls.every((c) => c.endpoint === '127.0.0.1' && c.explicitSettings));
  r = cli(['check'], { TEMPLATE_TEST_VERSION: '2.1.297' }); assert.equal(r.status, 3, r.stderr);
  assert.equal(readFileSync(join(work, 'label-target.txt'), 'utf8').trim(), '2.1.297');
  r = cli(['check'], { TEMPLATE_TEST_MUTATION: 'shape' }); assert.equal(r.status, 2, r.stderr);
  assert.ok(existsSync(join(work, 'drift-summary.md')));
  r = cli(['check'], { TEMPLATE_TEST_VERSION: '2.1.295' }); assert.equal(r.status, 1, r.stderr);
  r = cli(['capture', '--allow-non-linux-bake'], { TEMPLATE_TEST_MUTATION: 'tool-drop' }); assert.equal(r.status, 4, r.stderr);
  assert.deepEqual(readFileSync(join(work, 'src/cc-template-data.json')), seed);
  r = cli(['capture', '--allow-non-linux-bake'], { TEMPLATE_TEST_MUTATION: 'shape' }); assert.equal(r.status, 0, r.stderr);
  const baked = JSON.parse(readFileSync(join(work, 'src/cc-template-data.json')));
  assert.match(baked.system_prompt, /A new canonical instruction\./); assert.equal(baked._source, 'bundled');
  assert.deepEqual(baked.tool_names, baked.tools.map((tool) => tool.name));
  const stamp = baked._captured;
  r = cli(['check'], { TEMPLATE_TEST_VERSION: '2.1.297', TEMPLATE_TEST_MUTATION: 'shape' }); assert.equal(r.status, 3, r.stderr);
  r = cli(['label-sync', '2.1.297'], { TEMPLATE_TEST_VERSION: '2.1.297' }); assert.equal(r.status, 0, r.stderr);
  const labelled = JSON.parse(readFileSync(join(work, 'src/cc-template-data.json')));
  assert.equal(labelled._version, '2.1.297'); assert.equal(labelled._captured, stamp); assert.deepEqual(labelled.tools, baked.tools);
  assert.equal(JSON.parse(readFileSync(join(work, 'package.json'))).version, JSON.parse(readFileSync(join(work, 'package-lock.json'))).version);
  r = cli(['export', '--observed', '--out', join(work, 'artifacts')]); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(work, 'artifacts/cc-template-data.json')), readFileSync(join(work, 'src/cc-template-data.json')));
  r = cli(['export', '--out', join(work, 'default-output')]); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(work, 'default-output/cc-template-data.json')), readFileSync(join(work, 'src/cc-template-data.json')));
  assert.equal(JSON.parse(readFileSync(join(work, 'default-output/metadata.json'))).origin.type, 'template-workflow');
  assert.equal(JSON.parse(readFileSync(join(work, 'default-output/provenance.json'))).operation, 'label-sync');
  r = cli(['export', '--template', join(work, 'src/cc-template-data.json')]); assert.equal(r.status, 1);
  mkdirSync(join(work, 'reference'), { recursive: true });
  writeFileSync(join(work, 'reference/cc-template-data.json'), Buffer.from('an unrelated broken official snapshot'));
  r = cli(['export', '--out', join(work, 'independent-output')]); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(work, 'independent-output/cc-template-data.json')), readFileSync(join(work, 'src/cc-template-data.json')));
  rmSync(join(work, 'src/cc-template-provenance.json'));
  r = cli(['export', '--out', join(work, 'rejected-export')]); assert.equal(r.status, 1);
  assert.equal(existsSync(join(work, 'rejected-export')), false);

});

test('stale rebake is closed only after two drift captures; original baseline and outputs are restored', async (t) => {
  const work = mkdtempSync(join(tmpdir(), 'template-pr-')); t.after(() => rmSync(work, { recursive: true, force: true }));
  cpSync(join(root, 'src'), join(work, 'src'), { recursive: true });
  writeFileSync(join(work, 'drift-summary.md'), 'master summary'); writeFileSync(join(work, 'label-target.txt'), 'master target');
  const original = readFileSync(join(work, 'src/cc-template-data.json'));
  const pr = { number: 123, headRefName: 'bot/template-rebake-test', createdAt: new Date(Date.now() - 3 * 3600000).toISOString() };
  for (const codes of [[2, 2], [2, 0], [3]]) {
    let checks = 0, closed = 0;
    const kept = await checkOpenRebake(2, { rootDir: work, findPRs: () => [pr], getBundle: () => Buffer.from('PR BASELINE'), check: () => { assert.equal(readFileSync(join(work, 'src/cc-template-data.json'), 'utf8'), 'PR BASELINE'); writeFileSync(join(work, 'drift-summary.md'), 'PR summary'); return codes[checks++]; }, closePR: (_, action) => { assert.equal(action, 'replace'); closed++; } });
    assert.equal(closed, codes.length === 2 && codes.every((c) => c === 2) ? 1 : 0); assert.equal(!!kept, !closed);
    assert.deepEqual(readFileSync(join(work, 'src/cc-template-data.json')), original);
    assert.equal(readFileSync(join(work, 'drift-summary.md'), 'utf8'), 'master summary'); assert.equal(readFileSync(join(work, 'label-target.txt'), 'utf8'), 'master target');
  }
  await assert.rejects(checkOpenRebake(2, { rootDir: work, findPRs: () => [pr], getBundle: () => Buffer.from('PR BASELINE'), check: () => { throw new Error('capture failure'); }, closePR: () => assert.fail('must not close on failure') }));
  assert.deepEqual(readFileSync(join(work, 'src/cc-template-data.json')), original);
});
