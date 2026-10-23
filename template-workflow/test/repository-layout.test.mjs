import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repositoryPath } from '../lib/repository.mjs';
import { adaptUpstreamSource } from '../lib/upstream-adapters.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
  assert.equal(r.status, 0, r.stderr); return r.stdout;
}
test('repository API paths include the module directory', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'producer-prefix-')); t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, 'init', '-q'); mkdirSync(join(repo, 'template-workflow'), { recursive: true });
  assert.equal(repositoryPath('src/cc-template-data.json', repo), 'src/cc-template-data.json');
  assert.equal(repositoryPath('src/cc-template-data.json', join(repo, 'template-workflow')), 'template-workflow/src/cc-template-data.json');
  assert.throws(() => repositoryPath('../src/template.json', repo));
});
test('bake content and release notes compare the nested producer baseline, not parent Dario', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'producer-baseline-')); t.after(() => rmSync(repo, { recursive: true, force: true }));
  const module = join(repo, 'template-workflow');
  for (const directory of [join(repo, 'src'), join(module, 'src'), join(module, 'scripts')]) mkdirSync(directory, { recursive: true });
  for (const name of ['scripts/check-rebake-content.mjs', 'scripts/rebake-release-prep.mjs', 'scripts/drift-report.mjs', 'scripts/_drift-patch-helpers.mjs', 'package.json', 'package-lock.json', 'CHANGELOG.md']) copyFileSync(join(root, name), join(module, name));
  const baseline = JSON.parse(readFileSync(join(root, 'test/fixtures/seed-template.json')));
  const parent = structuredClone(baseline); parent.system_prompt = 'PARENT MUST NOT BE THE BASELINE';
  writeFileSync(join(repo, 'src/cc-template-data.json'), JSON.stringify(parent));
  writeFileSync(join(module, 'src/cc-template-data.json'), JSON.stringify(baseline));
  git(repo, 'init', '-q'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'fixture');
  let r = spawnSync(process.execPath, [join(module, 'scripts/check-rebake-content.mjs')], { cwd: module, encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr); // No meaningful producer change, despite the different parent file.
  const changed = structuredClone(baseline); changed.system_prompt += '\nA new producer-only instruction.';
  writeFileSync(join(module, 'src/cc-template-data.json'), JSON.stringify(changed));
  r = spawnSync(process.execPath, [join(module, 'scripts/check-rebake-content.mjs')], { cwd: module, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /system_prompt/);
  r = spawnSync(process.execPath, [join(module, 'scripts/rebake-release-prep.mjs')], { cwd: module, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(readFileSync(join(module, 'rebake-summary.md'), 'utf8'), /PARENT MUST NOT/);
  assert.ok(readFileSync(join(module, 'rebake-summary.md'), 'utf8').includes(`from ${baseline.system_prompt.length} to ${changed.system_prompt.length} characters`));
});
test('upstream sync retains repository-relative path adaptations', () => {
  for (const [file, name] of [['scripts/rebake-release-prep.mjs', 'BUNDLE'], ['scripts/check-rebake-content.mjs', 'REL']]) {
    const upstream = Buffer.from('const revision = `HEAD:${' + name + '}`;');
    const result = adaptUpstreamSource(file, upstream);
    assert.equal(result.bytes.toString(), 'const revision = `HEAD:./${' + name + '}`;');
    assert.match(result.change, /producer-relative/);
  }
});
