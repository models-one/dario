#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planUpstreamSync, applyUpstreamSync } from '../lib/upstream-sync.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function git(args, cwd = root) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000 });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed (${result.error?.code || result.status})`);
  return result.stdout;
}
let scratch;
try {
  const old = JSON.parse(readFileSync(join(root, 'upstream-snapshot.json')));
  const protectedFiles = [...Object.keys(old.files), 'upstream-snapshot.json', 'package.json', 'package-lock.json', 'CHANGELOG.md'];
  if (git(['status', '--porcelain', '--untracked-files=no', '--', ...protectedFiles]).trim()) throw new Error('Save tracked source/baseline changes before syncing upstream');
  scratch = mkdtempSync(join(tmpdir(), 'template-upstream-'));
  const checkout = join(scratch, 'dario');
  const options = ['-c', 'http.version=HTTP/1.1', ...(process.env.TEMPLATE_HTTP_PROXY ? ['-c', `http.proxy=${process.env.TEMPLATE_HTTP_PROXY}`] : [])];
  git([...options, 'clone', '--depth=1', '--single-branch', '--branch', 'master', 'https://github.com/askalf/dario.git', checkout]);
  const commit = git(['rev-parse', 'HEAD'], checkout).trim();
  const plan = planUpstreamSync({ root, commit, readUpstream: (name) => Buffer.from(git(['show', `${commit}:${name}`], checkout)) });
  console.log(JSON.stringify(applyUpstreamSync(root, plan), null, 2));
} catch (error) { console.error(`[sync-upstream] ${error.message}`); process.exitCode = 1; }
finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
