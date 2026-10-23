#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { meaningfulTemplateKeys, rebakePrAction } from './drift-report.mjs';
import { repositoryPath } from '../lib/repository.mjs';
import { prepareClaude } from '../lib/claude-runtime.mjs';
import { selectSupersededPrs } from './close-superseded-drift-prs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.DEFAULT_BRANCH || 'master';
const captureWorkflow = process.env.TEMPLATE_CAPTURE_WORKFLOW || 'template-workflow-capture.yml';
const repo = process.env.GITHUB_REPOSITORY || process.env.GH_REPO;
const runURL = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
function run(bin, args, { allowFailure = false, cwd = root } = {}) {
  const r = spawnSync(bin, args, { cwd, env: { ...process.env, ...(repo ? { GH_REPO: repo } : {}) }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (!allowFailure && r.status !== 0) throw new Error(`${bin} ${args.slice(0, 2).join(' ')} failed: ${r.stderr || r.stdout}`);
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}
const gh = (...args) => run('gh', args).stdout.trim();
const ghJSON = (...args) => JSON.parse(gh(...args));
const git = (...args) => run('git', args).stdout.trim();
const read = (name) => readFileSync(join(root, name));
const node = (name, ...args) => run(process.execPath, [join(root, name), ...args], { allowFailure: true });
function checkedNode(name, ...args) {
  const r = node(name, ...args);
  process.stderr.write(r.stderr);
  if (r.code) throw new Error(`${name} failed (exit ${r.code})`);
  return r.stdout.trim();
}
function captureCheck() {
  const r = node('bin/template-workflow.mjs', 'check');
  process.stderr.write(r.stderr);
  if (![0, 2, 3].includes(r.code)) throw new Error(`Capture infrastructure failure (exit ${r.code}); no automatic update`);
  return r.code;
}
function ensureLabel(label) { gh('label', 'create', label, '--color', 'D4C5F9', '--force'); }
function issues(label) { return ghJSON('issue', 'list', '--state', 'open', '--label', label, '--json', 'number'); }
function issue(label, title, body, close = false) {
  ensureLabel(label);
  const open = issues(label);
  if (close) { for (const i of open) gh('issue', 'close', String(i.number), '--comment', body); return; }
  if (open.length) gh('issue', 'comment', String(open[0].number), '--body', body);
  else gh('issue', 'create', '--label', label, '--title', title, '--body', body);
}
function prs(prefix) {
  return ghJSON('pr', 'list', '--state', 'open', '--search', `head:${prefix}`, '--json', 'number,headRefName,url,createdAt,isCrossRepository').filter((p) => !p.isCrossRepository && p.headRefName.startsWith(prefix));
}
function publishPR({ branch, title, body, labels, files }) {
  const known = prs(branch).find((p) => p.headRefName === branch);
  if (known) return known.url;
  git('switch', '-c', branch);
  git('add', '--', ...files);
  git('-c', 'user.name=template-workflow[bot]', '-c', 'user.email=template-workflow[bot]@users.noreply.github.com', 'commit', '-m', title);
  git('push', '--set-upstream', 'origin', branch);
  for (const label of labels) ensureLabel(label);
  const scratch = mkdtempSync(join(tmpdir(), 'template-workflow-pr-'));
  try {
    const bodyFile = join(scratch, 'body.md'); writeFileSync(bodyFile, body + '\n');
    const url = gh('pr', 'create', '--base', base, '--head', branch, '--title', title, '--body-file', bodyFile, ...labels.flatMap((l) => ['--label', l]));
    if (process.env.TEMPLATE_CI_WORKFLOW) gh('workflow', 'run', process.env.TEMPLATE_CI_WORKFLOW, '--ref', branch);
    if (process.env.TEMPLATE_AUTO_MERGE === 'true') gh('pr', 'merge', url, '--auto', '--squash');
    console.log(url);
    return url;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export async function checkOpenRebake(masterCheck, { findPRs = () => prs('bot/template-rebake-'), check = captureCheck, getBundle = (branch) => Buffer.from(gh('api', `repos/${repo}/contents/${repositoryPath('src/cc-template-data.json')}?ref=${encodeURIComponent(branch)}`, '--jq', '.content'), 'base64'), closePR = (pr, action) => { gh('pr', 'comment', String(pr.number), '--body', `Two captures no longer match this bundle. Watcher action: ${action}. ${runURL}`); gh('pr', 'close', String(pr.number), '--delete-branch'); }, rootDir = root, now = Date.now() } = {}) {
  const pr = findPRs()[0];
  if (!pr) return null;
  const ageHours = (now - Date.parse(pr.createdAt)) / 3600000;
  if (!(ageHours >= 2)) return pr;
  const files = ['src/cc-template-data.json', 'drift-summary.md', 'label-target.txt', 'issue-881-tripwire.txt'];
  const before = new Map(files.map((name) => [name, existsSync(join(rootDir, name)) ? readFileSync(join(rootDir, name)) : null]));
  const codes = [];
  let residue = false;
  try {
    writeFileSync(join(rootDir, files[0]), getBundle(pr.headRefName));
    for (let i = 0; i < 2; i++) {
      const code = check(); codes.push(code);
      residue ||= existsSync(join(rootDir, 'issue-881-tripwire.txt'));
      if (code !== 2 || residue) break;
    }
  } finally {
    for (const [name, raw] of before) { if (raw === null) rmSync(join(rootDir, name), { force: true }); else writeFileSync(join(rootDir, name), raw); }
  }
  const action = rebakePrAction({ ageHours, staleAfterHours: 2, prChecks: codes, masterCheck, residue });
  if (action === 'keep') return pr;
  closePR(pr, action);
  return null;
}

export async function templateWatch() {
  process.env.TEMPLATE_PREPARED_CC = JSON.stringify(prepareClaude());
  const code = captureCheck();
  const existing = await checkOpenRebake(code);
  if (code === 0) { issue('cc-drift-template', 'Claude Code template drift', `Live capture matches the committed template. ${runURL}`, true); return; }
  const summary = existsSync(join(root, 'drift-summary.md')) ? read('drift-summary.md').toString() : 'The template shape matches; the version label is behind.';
  issue('cc-drift-template', 'Claude Code template drift', `${summary}\n\n${runURL}`);
  if (code === 2) {
    if (existing) { console.log(`Rebake already open: ${existing.url}`); return; }
    const before = read('src/cc-template-data.json');
    const tripwire = existsSync(join(root, 'issue-881-tripwire.txt'));
    checkedNode('bin/template-workflow.mjs', 'capture');
    const after = read('src/cc-template-data.json');
    if (!meaningfulTemplateKeys(JSON.parse(before), JSON.parse(after)).length) {
      writeFileSync(join(root, 'src/cc-template-data.json'), before);
      console.log('Capture changed only transient fields; no PR needed.'); return;
    }
    checkedNode('bin/template-workflow.mjs', 'verify');
    const version = checkedNode('scripts/rebake-release-prep.mjs');
    run('npm', ['run', 'build']); run('npm', ['test']);
    const t = JSON.parse(after);
    const labels = ['cc-drift-template'];
    if (tripwire || existsSync(join(root, 'issue-881-tripwire.txt'))) labels.push('issue-881-residue');
    publishPR({ branch: `bot/template-rebake-${t._version}-${process.env.GITHUB_RUN_ID || Date.now()}`, title: `chore(template): rebake CC ${t._version} (${version})`, body: `Fresh capture, original Dario scrub and bake, schema 3 artifact verification, and producer tests.\n\n${read('rebake-summary.md')}\n\n${runURL}`, labels, files: ['src/cc-template-data.json', 'src/cc-template-provenance.json', 'package.json', 'package-lock.json', 'CHANGELOG.md'] });
  } else {
    if (prs('bot/template-label-').length) { console.log('Label-sync PR already open.'); return; }
    const target = read('label-target.txt').toString().trim();
    const version = checkedNode('bin/template-workflow.mjs', 'label-sync', target);
    checkedNode('bin/template-workflow.mjs', 'verify');
    run('npm', ['run', 'build']); run('npm', ['test']);
    publishPR({ branch: `bot/template-label-${target}-${process.env.GITHUB_RUN_ID || Date.now()}`, title: `chore(template): sync CC label ${target} (${version})`, body: `Live wire-shape check matched. Only upstream's version labels and release metadata are updated.\n\n${runURL}`, labels: ['cc-drift-template'], files: ['src/cc-template-data.json', 'src/cc-template-provenance.json', 'package.json', 'package-lock.json', 'CHANGELOG.md'] });
  }
}

export function npmWatch() {
  const r = node('scripts/check-cc-drift.mjs');
  process.stderr.write(r.stderr);
  let report;
  try { report = JSON.parse(r.stdout); } catch { throw new Error('npm drift scanner did not produce a report'); }
  writeFileSync(join(root, 'drift-report.json'), r.stdout);
  if (r.code === 0) { issue('cc-drift', 'Claude Code npm drift', `npm drift resolved. ${runURL}`, true); return; }
  if (!report.ccVersion || !Array.isArray(report.items)) throw new Error('npm scanner failed before obtaining a valid comparison');
  issue('cc-drift', `Claude Code npm drift: ${report.ccVersion}`, `${report.items.map((i) => `- ${i.category}: ${i.message}`).join('\n')}\n\n${runURL}`);
  gh('workflow', 'run', captureWorkflow, '--ref', base);
  if (process.env.TEMPLATE_PR_UPDATES_ENABLED !== 'true') { console.log('Capture dispatched. Compatibility PR updates require an approved bot token.'); return; }
  const branch = `bot/cc-drift-v${report.ccVersion}`;
  if (prs(branch).some((p) => p.headRefName === branch)) return;
  const result = JSON.parse(checkedNode('scripts/auto-draft-drift-fix.mjs', join(root, 'drift-report.json')));
  if (!result.fixed) { console.log(result.reason); return; }
  run('npm', ['run', 'build']); run('npm', ['test']);
  const url = publishPR({ branch, title: `chore(cc-drift): test through CC ${report.ccVersion}`, body: `${result.prBody || result.reason || 'Update the tested CC version range.'}\n\n${runURL}`, labels: ['cc-drift'], files: result.changedFiles });
  for (const pr of selectSupersededPrs(prs('bot/cc-drift-v'), branch)) gh('pr', 'close', String(pr.number), '--delete-branch', '--comment', `Superseded by ${url}`);
}

export function upstreamWatch() {
  const result = JSON.parse(checkedNode('scripts/sync-upstream.mjs'));
  if (!result.changed) { console.log(`Already synced to Dario ${result.commit}`); return; }
  const branch = `bot/dario-upstream-${result.commit.slice(0, 12)}`;
  if (prs(branch).some((p) => p.headRefName === branch)) return;
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('npm', ['run', 'build']); run('npm', ['run', 'verify:upstream']); run('npm', ['test']);
  if (process.env.TEMPLATE_PR_UPDATES_ENABLED !== 'true') { issue('dario-upstream', 'Dario capture implementation update available', `Prepared and tested Dario ${result.commit}. Configure an approved bot token to open its source update PR.\n\n${runURL}`); return; }
  publishPR({ branch, title: `chore(upstream): sync Dario ${result.commit.slice(0, 12)}`, body: `Update the capture implementation and development fixtures from one Dario commit. The producer baseline and published templates are preserved.\n\n${runURL}`, labels: ['dario-upstream'], files: result.changedFiles });
}

export function liveness() {
  const data = ghJSON('api', `repos/${repo}/actions/workflows/${captureWorkflow}/runs?per_page=100`);
  const runs = data.workflow_runs || [];
  const success = runs.find((r) => r.conclusion === 'success');
  const age = success ? (Date.now() - Date.parse(success.created_at)) / 3600000 : Infinity;
  if (age <= 8) { issue('cc-watcher-liveness', 'Template watcher is inactive', `Template watcher is healthy. ${runURL}`, true); return; }
  issue('cc-watcher-liveness', 'Template watcher is inactive', `No successful template check within 8 hours. Check the hosted capture/release run and npm client preparation. ${runURL}`);
  if (!runs.some((r) => ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(r.status))) gh('workflow', 'run', captureWorkflow, '--ref', base);
  throw new Error('Template watcher has no recent successful run');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!repo) throw new Error('Set GITHUB_REPOSITORY or GH_REPO before running GitHub automation');
    const mode = process.argv[2];
    if (mode === 'watch') await templateWatch();
    else if (mode === 'npm') npmWatch();
    else if (mode === 'liveness') liveness();
    else if (mode === 'upstream') upstreamWatch();
    else throw new Error('Expected watch, npm, upstream or liveness');
  } catch (error) { console.error(`[automation] ${error.message}`); process.exitCode = 1; }
}
