#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_FILES, latestProductionRelease, verifyRelease } from '../lib/release.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.GITHUB_REPOSITORY || process.env.GH_REPO;
function gh(...args) {
  const result = spawnSync('gh', [...args, '--repo', repo], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000 });
  if (result.error || result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${result.stderr || result.error?.message}`);
  return result.stdout;
}
function releases() {
  // gh api has no --repo option. Do not silently interpret API errors as an empty history.
  const result = spawnSync('gh', ['api', `repos/${repo}/releases?per_page=100`, '--paginate', '--slurp'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000 });
  if (result.error || result.status !== 0) throw new Error(`Could not list producer releases: ${result.stderr || result.error?.message}`);
  return JSON.parse(result.stdout).flat();
}
function download(tag, dir) { gh('release', 'download', tag, '--dir', dir, ...RELEASE_FILES.flatMap((name) => ['--pattern', name])); }
let scratch;
try {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Set GITHUB_REPOSITORY or GH_REPO');
  const mode = process.argv[2];
  if (mode === 'restore') {
    const previous = latestProductionRelease(releases());
    if (!previous) {
      console.log('No produced release exists yet. A fresh capture is required before first publication.');
    } else {
      scratch = mkdtempSync(join(tmpdir(), 'producer-baseline-'));
      download(previous.tag_name, scratch);
      const verified = verifyRelease(scratch, { repository: repo, tag: previous.tag_name, allowRepairableBaseline: true });
      copyFileSync(join(scratch, 'cc-template-data.json'), join(root, 'src/cc-template-data.json'));
      copyFileSync(join(scratch, 'provenance.json'), join(root, 'src/cc-template-provenance.json'));
      console.log(`Restored our produced baseline: ${verified.tag}`);
    }
  } else if (mode === 'publish') {
    const dir = join(root, 'artifacts/latest');
    const artifact = verifyRelease(dir, { repository: repo });
    const existing = releases().find((release) => release.tag_name === artifact.tag);
    if (existing) {
      if (existing.draft || existing.prerelease) throw new Error('The production release tag is already used by an incomplete release');
      scratch = mkdtempSync(join(tmpdir(), 'producer-existing-'));
      download(artifact.tag, scratch);
      const published = verifyRelease(scratch, { repository: repo, tag: artifact.tag });
      if (!published.raw.equals(artifact.raw)) throw new Error('Existing immutable release has different bytes');
      console.log(`Verified existing produced release: ${artifact.tag}`);
    } else {
      scratch = mkdtempSync(join(tmpdir(), 'producer-notes-'));
      const notes = join(scratch, 'notes.md');
      writeFileSync(notes, `Produced by this repository using the verified npm Claude Code ${artifact.metadata.cc_version} client and Dario's capture, scrub, merge and drift mechanisms.\n\n${readFileSync(join(root, 'artifacts/production-summary.md'), 'utf8')}\nThe provenance records the client digest, previous baseline digest and capture workflow run.\n`);
      gh('release', 'create', artifact.tag, ...RELEASE_FILES.map((name) => join(dir, name)), '--target', process.env.GITHUB_SHA || 'master', '--title', `Claude Code ${artifact.metadata.cc_version} template (${artifact.metadata.sha256.slice(0, 12)})`, '--notes-file', notes, '--latest');
      console.log(`Published our produced template: ${artifact.tag}`);
    }
  } else throw new Error('Expected restore or publish');
} catch (error) { console.error(`[production-release] ${error.message}`); process.exitCode = 1; }
finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
