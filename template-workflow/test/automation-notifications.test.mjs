import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));

// Exercise the real automation CLI and GitHub command ordering. Only the
// external npm scan and gh process are controlled; no account is contacted.
function scenario(t, { issues = false, drift = true, failure = '', openIssues = [] } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'npm-drift-notifications-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  for (const dir of ['scripts', 'lib', 'dist']) cpSync(join(root, dir), join(work, dir), { recursive: true });
  const report = { ccVersion: '2.1.310', drift, items: drift ? [{ category: 'compat.range', severity: 'medium', message: 'New client version observed' }] : [] };
  writeFileSync(join(work, 'scripts/check-cc-drift.mjs'), `console.log(${JSON.stringify(JSON.stringify(report))}); process.exit(${drift ? 1 : 0});\n`);
  const bin = join(work, 'mock-bin'); mkdirSync(bin);
  const callsFile = join(work, 'gh-calls.jsonl');
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(args) + '\\n');
const enabled = ${JSON.stringify(issues)};
const failure = ${JSON.stringify(failure)};
if (args[0] === 'api') {
  if (failure === 'api') { console.error('HTTP 403: Resource not accessible by integration'); process.exit(1); }
  if (args[1] !== 'repos/owner/producer') throw new Error('Unexpected API path');
  console.log(JSON.stringify(failure === 'metadata' ? {} : { has_issues: enabled }));
} else if (args[0] === 'label') {
  // GitHub labels also serve PRs, so label creation can succeed with Issues off.
} else if (args[0] === 'issue') {
  if (!enabled) { console.error("the 'owner/producer' repository has disabled issues"); process.exit(1); }
  if (failure === 'issue') { console.error('HTTP 403: issue access denied'); process.exit(1); }
  if (args[1] === 'list') console.log(JSON.stringify(${JSON.stringify(openIssues)}));
} else if (args[0] === 'workflow') {
  if (failure === 'dispatch') { console.error('HTTP 403: workflow dispatch denied'); process.exit(1); }
} else { console.error('Unexpected gh command ' + args.join(' ')); process.exit(1); }
`, { mode: 0o755 });
  const stepSummary = join(work, 'step-summary.md');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'owner/producer', GH_REPO: 'owner/producer', GITHUB_RUN_ID: '123', DEFAULT_BRANCH: 'master', TEMPLATE_PR_UPDATES_ENABLED: 'false', TEMPLATE_CAPTURE_WORKFLOW: 'template-workflow-capture.yml', GITHUB_STEP_SUMMARY: stepSummary };
  delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
  const result = spawnSync(process.execPath, ['scripts/automation.mjs', 'npm'], { cwd: work, env, encoding: 'utf8', timeout: 20000 });
  return { ...result, work, stepSummary, calls: existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse) : [], report };
}

test('Issues-disabled npm drift retains its report and dispatches capture successfully', (t) => {
  const result = scenario(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(result.work, 'drift-report.json'))), result.report);
  assert.ok(result.calls.some((args) => args[0] === 'api' && args[1] === 'repos/owner/producer'));
  assert.ok(result.calls.some((args) => args.join(' ') === 'workflow run template-workflow-capture.yml --ref master'));
  assert.ok(result.calls.every((args) => !['issue', 'label'].includes(args[0])));
  for (const path of [result.stepSummary, join(result.work, 'automation-summary.md')]) {
    const summary = readFileSync(path, 'utf8');
    assert.match(summary, /compat\.range/); assert.match(summary, /Issues.*disabled/i); assert.match(summary, /Capture.*dispatched/i);
  }
});

test('Issues-disabled no-drift run succeeds without issue commands or capture dispatch', (t) => {
  const result = scenario(t, { drift: false });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.every((args) => !['issue', 'label', 'workflow'].includes(args[0])));
  assert.match(readFileSync(result.stepSummary, 'utf8'), /npm drift resolved/i);
});

test('Issues-enabled notifications still create, comment and close issues as appropriate', async (t) => {
  for (const options of [{ drift: true, openIssues: [] }, { drift: true, openIssues: [{ number: 7 }] }, { drift: false, openIssues: [{ number: 7 }] }]) {
    await t.test(JSON.stringify(options), (t) => {
      const result = scenario(t, { issues: true, ...options });
      assert.equal(result.status, 0, result.stderr);
      const expected = options.drift ? options.openIssues.length ? 'comment' : 'create' : 'close';
      assert.ok(result.calls.some((args) => args[0] === 'issue' && args[1] === expected));
      assert.equal(result.calls.some((args) => args[0] === 'workflow'), options.drift);
    });
  }
});

test('API, invalid metadata, issue permission and dispatch failures remain failures', async (t) => {
  for (const failure of ['api', 'metadata', 'issue', 'dispatch']) {
    await t.test(failure, (t) => {
      const result = scenario(t, { issues: failure === 'issue', failure });
      assert.notEqual(result.status, 0, `${failure} was hidden`);
      if (failure !== 'dispatch') assert.equal(result.calls.some((args) => args[0] === 'workflow'), false);
    });
  }
});
