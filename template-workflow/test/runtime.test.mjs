import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareClaude, verifyPreparedClient } from '../lib/claude-runtime.mjs';
function fixture(root, version) {
  const directory = join(root, version); mkdirSync(join(directory, 'package'), { recursive: true });
  const executable = join(directory, 'package/claude');
  writeFileSync(executable, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(version + ' (Claude Code)')});\n`, { mode: 0o700 });
  const archive = join(directory, 'client.tgz');
  const tar = spawnSync('tar', ['-czf', archive, '-C', directory, 'package'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  return { archive, executable, integrity: 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64') };
}
test('latest is resolved once per task; the verified cached client never masks a new version or failed lookup', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'template-runtime-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = { '2.1.501': fixture(root, '2.1.501'), '2.1.502': fixture(root, '2.1.502') };
  let latest = '2.1.501', requests = 0, downloads = 0;
  const options = { version: 'latest', platform: 'linux-x64', cacheDir: join(root, 'cache'), resolveMetadata(spec) {
    requests++;
    if (spec === '@anthropic-ai/claude-code@latest') return { version: latest, optionalDependencies: { '@anthropic-ai/claude-code-linux-x64': latest } };
    return { version: latest, dist: { integrity: packages[latest].integrity } };
  }, pack(_, directory) { downloads++; const archive = join(directory, 'client.tgz'); copyFileSync(packages[latest].archive, archive); return archive; } };
  const first = prepareClaude(options); assert.equal(first.version, '2.1.501'); assert.equal(requests, 2); assert.equal(downloads, 1);
  assert.equal(prepareClaude(options).sha256, first.sha256); assert.equal(requests, 4); assert.equal(downloads, 1);
  latest = '2.1.502'; const second = prepareClaude(options); assert.equal(second.version, latest); assert.equal(downloads, 2);
  assert.notEqual(second.sha256, first.sha256);
  assert.throws(() => prepareClaude({ ...options, resolveMetadata() { throw new Error('registry unavailable'); } }), /registry unavailable/);
  writeFileSync(second.path, 'corrupt');
  assert.throws(() => prepareClaude(options), /changed|wrong version/);
  assert.equal(downloads, 2);
});
test('package integrity or binary-version disagreement cannot publish a prepared cache entry', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'template-runtime-reject-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const actual = fixture(root, '2.1.501');
  const options = { version: '2.1.502', platform: 'linux-x64', cacheDir: join(root, 'cache'), resolveMetadata(spec) { return spec === '@anthropic-ai/claude-code@2.1.502' ? { version: '2.1.502', optionalDependencies: { '@anthropic-ai/claude-code-linux-x64': '2.1.502' } } : { version: '2.1.502', dist: { integrity: actual.integrity } }; }, pack(_, directory) { const archive = join(directory, 'client.tgz'); copyFileSync(actual.archive, archive); return archive; } };
  assert.throws(() => prepareClaude(options), /wrong version/);
  assert.equal(existsSync(join(options.cacheDir, '2.1.502-linux-x64')), false);
  assert.throws(() => prepareClaude({ ...options, pack(_, directory) { const archive = join(directory, 'client.tgz'); writeFileSync(archive, 'corrupt'); return archive; } }), /integrity mismatch/);
  assert.equal(existsSync(join(options.cacheDir, '2.1.502-linux-x64')), false);
});
test('explicit historical binaries require a matching exact version and remain immutable within the task', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'template-runtime-explicit-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const item = fixture(root, '2.1.501');
  const options = { version: '2.1.501', binary: item.executable, resolveMetadata() { assert.fail('fixed explicit binary must be offline'); } };
  const client = prepareClaude(options); assert.equal(client.version, '2.1.501'); assert.equal(verifyPreparedClient(client), client);
  assert.throws(() => prepareClaude({ ...options, version: '2.1.502' }), /does not match/);
  writeFileSync(item.executable, '#!/bin/sh\nexit 1\n');
  assert.throws(() => verifyPreparedClient(client), /changed|wrong version/);
});
