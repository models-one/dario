import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { planUpstreamSync, applyUpstreamSync } from '../lib/upstream-sync.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'template-sync-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of ['upstream-snapshot.json', 'package.json', 'package-lock.json', 'CHANGELOG.md']) writeFileSync(join(directory, name), readFileSync(join(root, name)));
  const manifest = JSON.parse(readFileSync(join(directory, 'upstream-snapshot.json')));
  const upstream = new Map();
  for (const [name, record] of Object.entries(manifest.files)) {
    const source = record.source_path || name;
    if (name.startsWith('test/reference/dario/')) upstream.set(source, readFileSync(join(root, name)));
    else if (!upstream.has(source)) upstream.set(source, readFileSync(join(root, name)));
  }
  upstream.set('package.json', readFileSync(join(root, 'test/reference/dario/package.json')));
  upstream.set('package-lock.json', readFileSync(join(root, 'package-lock.json')));
  return { directory, upstream, manifest };
}
test('upstream implementation and test fixtures update without replacing our produced baseline', (t) => {
  const { directory, upstream } = fixture(t);
  const before = JSON.parse(readFileSync(join(directory, 'package.json')));
  mkdirSync(join(directory, 'src'));
  writeFileSync(join(directory, 'src/cc-template-data.json'), 'our independently produced baseline');
  writeFileSync(join(directory, 'src/cc-template-provenance.json'), 'our capture evidence');
  const result = planUpstreamSync({ root: directory, commit: 'a'.repeat(40), readUpstream: (name) => { if (!upstream.has(name)) throw new Error(`missing fixture ${name}`); return upstream.get(name); } });
  assert.equal(result.changed, true);
  for (const name of ['reference/cc-template-data.json', 'src/cc-template-data.json', 'src/cc-template-provenance.json']) assert.equal(result.files.has(name), false);
  assert.deepEqual(result.files.get('test/reference/dario/src/cc-template-data.json'), upstream.get('src/cc-template-data.json'));
  const pkg = JSON.parse(result.files.get('package.json'));
  assert.equal(pkg.scripts.capture, before.scripts.capture);
  assert.notEqual(pkg.version, before.version);
  assert.equal(JSON.parse(result.files.get('package-lock.json')).version, pkg.version);
  assert.equal([...result.files.keys()].at(-1), 'upstream-snapshot.json');
  applyUpstreamSync(directory, result);
  const after = JSON.parse(readFileSync(join(directory, 'upstream-snapshot.json')));
  assert.equal(after.commit, 'a'.repeat(40));
  assert.equal(after.officialTemplate, undefined);
  assert.equal(after.files['src/cc-template-data.json'], undefined);
  assert.equal(readFileSync(join(directory, 'src/cc-template-data.json'), 'utf8'), 'our independently produced baseline');
  assert.equal(readFileSync(join(directory, 'src/cc-template-provenance.json'), 'utf8'), 'our capture evidence');
  assert.match(readFileSync(join(directory, 'scripts/capture-and-bake.mjs'), 'utf8'), /DEFERRED_TOOLS/);
  assert.match(readFileSync(join(directory, 'CHANGELOG.md'), 'utf8'), /Sync Dario aaaaaaaaaaaa/);
});
test('unchanged upstream commits are idempotent and do not consume a release version', (t) => {
  const { directory, manifest } = fixture(t);
  const before = readFileSync(join(directory, 'package.json'));
  const result = planUpstreamSync({ root: directory, commit: manifest.commit, readUpstream() { assert.fail('no source reads needed'); } });
  assert.equal(result.changed, false); applyUpstreamSync(directory, result);
  assert.deepEqual(readFileSync(join(directory, 'package.json')), before);
});
test('missing upstream files or unsupported templates fail before touching the checkout', (t) => {
  const { directory, upstream } = fixture(t);
  const before = readFileSync(join(directory, 'upstream-snapshot.json'));
  assert.throws(() => planUpstreamSync({ root: directory, commit: 'b'.repeat(40), readUpstream(name) { if (name === 'scripts/capture-and-bake.mjs') throw new Error('upstream moved this file'); return upstream.get(name); } }), /moved/);
  assert.deepEqual(readFileSync(join(directory, 'upstream-snapshot.json')), before);
  assert.throws(() => planUpstreamSync({ root: directory, commit: 'b'.repeat(40), readUpstream(name) { return name === 'src/cc-template-data.json' ? Buffer.from('{"_schemaVersion":4,"tools":[],"tool_names":[]}') : upstream.get(name); } }), /Unsupported/);
  assert.deepEqual(readFileSync(join(directory, 'upstream-snapshot.json')), before);
});
