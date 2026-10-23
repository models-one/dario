import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as url from 'node:url';
import * as localLive from '../dist/live-fingerprint.js';
import * as officialLive from './reference/dario/dist/live-fingerprint.js';
import * as localScrub from '../dist/scrub-template.js';
import * as officialScrub from './reference/dario/dist/scrub-template.js';
import * as localDrift from '../scripts/drift-report.mjs';
import * as officialDrift from './reference/dario/scripts/drift-report.mjs';
const root = url.fileURLToPath(new URL('../', import.meta.url));
const canonical = JSON.parse(readFileSync(new URL('./reference/dario/src/cc-template-data.json', import.meta.url)));
const historical = JSON.parse(readFileSync(new URL('./fixtures/seed-template.json', import.meta.url)));
const observedNames = ['Agent', 'Bash', 'Edit', 'ListAgents', 'Read', 'ReportFindings', 'ScheduleWakeup', 'Skill', 'ToolSearch', 'Workflow', 'DeferredToolPlaceholder', 'Write'];
const observed = canonical.tools.filter((t) => observedNames.includes(t.name));
const cacheBefore = process.env.DARIO_LIVE_TEMPLATE_CACHE;
process.env.DARIO_LIVE_TEMPLATE_CACHE = `/tmp/dario-reference-no-cache-${process.pid}.json`;
const officialTemplate = await import('./reference/dario/dist/cc-template.js');
if (cacheBefore === undefined) delete process.env.DARIO_LIVE_TEMPLATE_CACHE; else process.env.DARIO_LIVE_TEMPLATE_CACHE = cacheBefore;
const captureTime = '2026-10-23T00:00:00.000Z';
function request(model, mutate) {
  const family = officialLive.VARIANT_FAMILIES.find((f) => f.matches(model));
  const raw = {
    method: 'POST', path: '/v1/messages',
    headers: { ...canonical.header_values, 'user-agent': `claude-cli/${canonical._version} (external, cli)`, 'anthropic-beta': canonical.anthropic_beta },
    rawHeaders: canonical.header_order.flatMap((k) => [k, canonical.header_values[k] || 'synthetic']),
    body: { model, messages: [{ role: 'user', content: 'hi' }], system: [{ type: 'text', text: 'synthetic billing' }, { type: 'text', text: canonical.agent_identity }, { type: 'text', text: family ? canonical.system_prompt_variants[family.key] : canonical.system_prompt }], tools: structuredClone(observed), metadata: {}, max_tokens: 128, thinking: { type: 'adaptive' }, context_management: {}, output_config: {}, stream: true },
  };
  mutate?.(raw);
  return raw;
}
function extract(live, raw) {
  const t = live.extractTemplate(raw);
  assert.ok(t);
  t._captured = captureTime;
  return t;
}
class Exit extends Error { constructor(code) { super(`exit ${code}`); this.code = code; } }
async function bake(kind, { check = false, baseline = canonical, mutate, failFamily } = {}) {
  const official = kind === 'official';
  const live = official ? officialLive : localLive;
  const scrub = official ? officialScrub : localScrub;
  const drift = official ? officialDrift : localDrift;
  const basePath = '/fixed-replay';
  const files = new Map([[`${basePath}/src/cc-template-data.json`, JSON.stringify(baseline, null, 2) + '\n']]);
  const calls = [];
  const proc = { env: {}, argv: ['node', 'capture-and-bake.mjs', ...(check ? ['--check'] : [])], platform: 'linux', exit: (code) => { throw new Exit(code); } };
  const context = vm.createContext({ process: proc, console: { error() {}, log() {} }, structuredClone, Buffer, Date });
  const capturedLive = { ...live, findInstalledCC: () => ({ path: '/synthetic/claude', version: canonical._version }), captureLiveTemplateAsync: async () => {
    const model = proc.env.ANTHROPIC_MODEL;
    calls.push(model);
    if (failFamily && model.includes(failFamily)) return null;
    return extract(live, request(model, mutate));
  } };
  const fs = { readFileSync: (name) => { if (!files.has(name)) throw new Error(`No file ${name}`); return files.get(name); }, writeFileSync: (name, body) => files.set(name, String(body)), rmSync: (name) => files.delete(name) };
  const cache = new Map();
  const sourcePath = official ? './reference/dario/scripts/capture-and-bake.mjs' : '../scripts/capture-and-bake.mjs';
  const entry = new vm.SourceTextModule(readFileSync(new URL(sourcePath, import.meta.url), 'utf8'), { context, identifier: `${basePath}/scripts/capture-and-bake.mjs`, initializeImportMeta: (meta) => { meta.url = `file://${basePath}/scripts/capture-and-bake.mjs`; } });
  await entry.link((specifier) => {
    if (cache.has(specifier)) return cache.get(specifier);
    const exports = specifier === 'node:fs' ? fs : specifier === 'node:path' ? path : specifier === 'node:url' ? url : specifier.endsWith('/live-fingerprint.js') ? capturedLive : specifier.endsWith('/scrub-template.js') ? scrub : specifier.endsWith('/cc-template.js') ? officialTemplate : specifier === './drift-report.mjs' ? drift : null;
    if (!exports) throw new Error(`Unexpected upstream bake dependency ${specifier}`);
    const names = Object.keys(exports);
    const mod = new vm.SyntheticModule(names, function() { for (const name of names) this.setExport(name, exports[name]); }, { context });
    cache.set(specifier, mod); return mod;
  });
  let code = 0;
  try { await entry.evaluate(); } catch (error) { if (!(error instanceof Exit)) throw error; code = error.code; }
  return { code, files: [...files].sort(([a], [b]) => a.localeCompare(b)), calls };
}

test('deferred preservation matches official Dario: 35 previous plus 12 observed yields 37', () => {
  assert.equal(historical.tools.length, 35); assert.equal(observed.length, 12);
  const actual = localLive.mergePreservedTools(observed, historical.tools, 'linux');
  const expected = officialLive.mergePreservedTools(observed, historical.tools, 'linux');
  assert.deepEqual(actual, expected); assert.equal(actual.tools.length, 37);
  assert.equal(actual.preserved.filter((p) => p.reason === 'deferred').length, 12);
  assert.deepEqual(localLive.unclassifiedToolDrops(observed, historical.tools, 'linux'), []);
});

test('extract, scrub and drift retain defer_loading exactly as upstream', () => {
  const raw = request('claude-opus-4-8');
  const local = localScrub.scrubTemplate(extract(localLive, raw));
  const expected = officialScrub.scrubTemplate(extract(officialLive, raw));
  assert.deepEqual(local, expected);
  const placeholder = local.tools.find((t) => t.name === 'DeferredToolPlaceholder');
  assert.equal(placeholder.defer_loading, true);
  const changed = structuredClone(local); delete changed.tools.find((t) => t.name === placeholder.name).defer_loading;
  const diff = localDrift.computeDrift(local, changed);
  assert.deepEqual(diff, officialDrift.computeDrift(expected, changed));
  assert.ok(diff.some((d) => d.summary.includes('defer_loading')));
});

const oldLabel = structuredClone(canonical); oldLabel._version = '2.1.1'; oldLabel._supportedMaxTested = '2.1.1'; oldLabel.header_values['user-agent'] = 'claude-cli/2.1.1 (external, cli)';
const missingVariant = structuredClone(canonical); delete missingVariant.system_prompt_variants['sonnet-5'];
for (const [name, options, expectedCode] of [
  ['bake all four model captures without tool-drop bypass', {}, 0],
  ['check official shape', { check: true }, 0],
  ['detect label-only drift', { check: true, baseline: oldLabel }, 3],
  ['refuse missing family with no fallback', { baseline: missingVariant, failFamily: 'sonnet-5' }, 1],
  ['detect a changed base prompt', { check: true, mutate: (r) => { if (r.body.model === officialLive.TEMPLATE_BASE_MODEL) r.body.system[2].text += '\nA real new instruction.'; } }, 2],
  ['refuse unclassified tool loss', { mutate: (r) => { r.body.tools = r.body.tools.filter((t) => t.name !== 'Read'); } }, 4],
  ['retain a previous family on capture failure', { failFamily: 'sonnet-5' }, 0],
]) {
  test(`original and extracted bake produce identical results: ${name}`, async () => {
    const actual = await bake('local', options); const expected = await bake('official', options);
    assert.deepEqual(actual, expected); assert.equal(actual.code, expectedCode);
    if (!options.check && expectedCode === 0) {
      const result = JSON.parse(new Map(actual.files).get('/fixed-replay/src/cc-template-data.json'));
      assert.equal(result.tools.length, 37);
      assert.deepEqual(result.tool_names, result.tools.map((t) => t.name));
      assert.equal(result.tools.find((t) => t.name === 'DeferredToolPlaceholder').defer_loading, true);
    }
  });
}
