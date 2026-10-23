#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareClaude } from '../lib/claude-runtime.mjs';
import { readProduction, PROVENANCE_FILE } from '../lib/production.mjs';
import { sha256 } from '../lib/template.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function cli(...args) {
  const result = spawnSync(process.execPath, [join(root, 'bin/template-workflow.mjs'), ...args], { cwd: root, env: process.env, stdio: 'inherit', timeout: 180000 });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
try {
  if (process.platform !== 'linux') throw new Error('Production requires Linux; no non-Linux bake override is allowed');
  // The production entry point always resolves npm latest once per run.
  // CLI capture/check retain explicit historical overrides for development only.
  const client = { ...prepareClaude({ version: 'latest', binary: null }), requested: 'latest', resolved_at: new Date().toISOString() };
  if (!client.package || !client.package_integrity) throw new Error('Production requires a verified npm native client, not an explicit binary');
  process.env.TEMPLATE_PREPARED_CC = JSON.stringify(client);
  const before = readFileSync(join(root, 'src/cc-template-data.json'));
  const hasProvenance = existsSync(join(root, PROVENANCE_FILE));
  if (hasProvenance) readProduction(root); // Corrupt evidence never silently falls back to a bootstrap.
  const code = cli('check');
  if (![0, 2, 3].includes(code)) throw new Error(`Live drift check failed (${code}); nothing will be published`);
  let operation = 'unchanged';
  if (!hasProvenance || code === 2) {
    if (cli('capture') !== 0) throw new Error('Capture/bake failed; nothing will be published');
    operation = 'capture';
  } else if (code === 3) {
    if (cli('label-sync', client.version) !== 0) throw new Error('Label sync failed; nothing will be published');
    operation = 'label-sync';
  }
  const { raw, provenance, template } = readProduction(root, { expectedVersion: client.version });
  if (cli('export') !== 0) throw new Error('Production export failed');
  const result = { operation, cc_version: client.version, sha256: sha256(raw), tools: template.tools.length, variants: Object.keys(template.system_prompt_variants || {}), changed: !raw.equals(before), captured_at: template._captured, capture_run: provenance.run.url };
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(join(root, 'artifacts/production-result.json'), JSON.stringify(result, null, 2) + '\n');
  const summary = `## Produced Claude Code ${client.version}\n\nOperation: ${operation}. Tools: ${result.tools}. Variants: ${result.variants.join(', ')}.\n\nSHA-256: \`${result.sha256}\`\n\nCapture: ${result.capture_run || 'local'}\n`;
  writeFileSync(join(root, 'artifacts/production-summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(`[produce] ${error.message}`); process.exitCode = 1; }
