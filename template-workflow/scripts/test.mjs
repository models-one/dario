import { spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = new URL('../', import.meta.url);
// Maintenance jobs carry a prepared real client. Tests must use their own
// controlled clients and cache, even when invoked from those jobs.
const testEnv = { ...process.env };
for (const key of Object.keys(testEnv)) if (key.startsWith('TEMPLATE_') || key === 'DARIO_CLAUDE_BIN') delete testEnv[key];
const testHome = mkdtempSync(join(tmpdir(), 'producer-test-cache-'));
testEnv.DARIO_LIVE_TEMPLATE_CACHE = join(testHome, 'no-live-cache.json');
process.on('exit', () => rmSync(testHome, { recursive: true, force: true }));
const legacy = ['live-fingerprint', 'scrub-template', 'capture-provenance', 'drift-detection', 'compat-range', 'bake-drift-report', 'label-sync', 'auto-draft-drift-fix', 'close-superseded-drift-prs'];
const referenceBuild = spawnSync(process.execPath, ['scripts/build-reference.mjs'], { cwd: root, env: testEnv, stdio: 'inherit' });
if (referenceBuild.status !== 0) process.exit(referenceBuild.status || 1);
let files = 0, checks = 0;
for (const name of legacy) {
  const r = spawnSync(process.execPath, [`test/${name}.mjs`], { cwd: root, env: testEnv, encoding: 'utf8', timeout: 120000 });
  const text = r.stdout || '';
  const counts = [...text.matchAll(/(\d+) pass(?:ed)?, (\d+) fail(?:ed)?/g)].at(-1) || (text.match(/# pass (\d+)/) && ['', text.match(/# pass (\d+)/)[1], text.match(/# fail (\d+)/)?.[1] || '0']);
  if (r.status !== 0 || !counts || Number(counts[2]) !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  checks += Number(counts[1]); files++;
  console.log(`${name}: ${counts[1]} passed`);
}
for (const name of ['template-deferred-tools', 'template-defer-loading']) {
  const r = spawnSync(process.execPath, [`test/reference/dario/test/${name}.mjs`], { cwd: root, env: testEnv, encoding: 'utf8', timeout: 120000 });
  const counts = [...(r.stdout || '').matchAll(/(\d+) pass(?:ed)?, (\d+) fail(?:ed)?/g)].at(-1);
  if (r.status !== 0 || !counts || Number(counts[2]) !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  console.log(`official reference ${name}: ${counts[1]} passed`); checks += Number(counts[1]); files++;
}
for (const file of readdirSync(new URL('../test/', import.meta.url)).filter((n) => n.endsWith('.test.mjs'))) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', `test/${file}`], { cwd: root, env: testEnv, stdio: 'inherit', timeout: 180000 });
  if (r.status !== 0) process.exit(r.status || 1);
}
console.log(`Upstream: ${checks} assertions passed in ${files} files.`);
