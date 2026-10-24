#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareClaude } from '../lib/claude-runtime.mjs';
import { readProduction, PROVENANCE_FILE, prepareCaptureBaseline } from '../lib/production.mjs';
import { sha256 } from '../lib/template.mjs';
import { TARGET_PLATFORM, TARGET_LABEL, NATIVE_PLATFORMS } from '../lib/platform.mjs';
import { verifyCurrentCheck } from '../lib/check.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function cli(...args) {
  const result = spawnSync(process.execPath, [join(root, 'bin/template-workflow.mjs'), ...args], { cwd: root, env: process.env, stdio: 'inherit', timeout: 180000 });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
try {
  if (!NATIVE_PLATFORMS.includes(TARGET_PLATFORM) || process.platform !== TARGET_PLATFORM) throw new Error('Production must run on the selected native platform');
  // The production entry point always resolves npm latest once per run.
  // CLI capture/check retain explicit historical overrides for development only.
  const version = process.env.TEMPLATE_RESOLVED_CC_VERSION || 'latest';
  if (version !== 'latest' && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid coordinated client version');
  const client = { ...prepareClaude({ version, binary: null }), requested: 'latest', resolved_at: process.env.TEMPLATE_VERSION_RESOLVED_AT || new Date().toISOString() };
  if (!client.package || !client.package_integrity) throw new Error('Production requires a verified npm native client, not an explicit binary');
  process.env.TEMPLATE_PREPARED_CC = JSON.stringify(client);
  delete process.env.TEMPLATE_BASELINE_REPAIR;
  const before = readFileSync(join(root, 'src/cc-template-data.json'));
  const repair = prepareCaptureBaseline(root);
  if (repair) { process.env.TEMPLATE_BASELINE_REPAIR = JSON.stringify(repair); console.log(`Preparing ${TARGET_LABEL} baseline; recapture required for variants: ${repair.recaptured_variants.join(', ')}`); }
  const hasProvenance = existsSync(join(root, PROVENANCE_FILE));
  if (hasProvenance) readProduction(root, { targetPlatform: TARGET_PLATFORM }); // Corrupt evidence never silently falls back to a bootstrap.
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
  const { raw, provenance, template } = readProduction(root, { expectedVersion: client.version, targetPlatform: TARGET_PLATFORM });
  const observation = JSON.parse(readFileSync(join(root, 'capture-observation.json')));
  if (observation.cc_version !== client.version || observation.platform !== TARGET_PLATFORM) throw new Error('Observation does not match the selected native client');
  const { path: _clientPath, ...publicClient } = client;
  const check = { format: 'template-workflow-check/v1', target_platform: TARGET_PLATFORM, cc_version: client.version, template_sha256: sha256(raw), checked_at: new Date().toISOString(), repository: process.env.GITHUB_REPOSITORY || null, run_id: process.env.GITHUB_RUN_ID || null, commit: process.env.GITHUB_SHA || null, client: publicClient, observed_tools: observation.observed_tools, variant_outcomes: observation.variant_outcomes, variant_hashes: observation.variant_hashes };
  verifyCurrentCheck(check, raw, { platform: TARGET_PLATFORM, version: client.version, repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID, commit: process.env.GITHUB_SHA });
  if (cli('export') !== 0) throw new Error('Production export failed');
  writeFileSync(join(root, 'artifacts/current-check.json'), JSON.stringify(check, null, 2) + '\n');
  const result = { operation, target_platform: TARGET_PLATFORM, cc_version: client.version, sha256: sha256(raw), tools: template.tools.length, variants: Object.keys(template.system_prompt_variants || {}), changed: !raw.equals(before), captured_at: template._captured, capture_run: provenance.run.url };
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(join(root, 'artifacts/production-result.json'), JSON.stringify(result, null, 2) + '\n');
  const summary = `## Produced ${TARGET_LABEL} Claude Code ${client.version}\n\nOperation: ${operation}. Tools: ${result.tools}. Variants: ${result.variants.join(', ')}.\n\nSHA-256: \`${result.sha256}\`\n\nCapture: ${result.capture_run || 'local'}\n`;
  writeFileSync(join(root, 'artifacts/production-summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(`[produce] ${error.message}`); process.exitCode = 1; }
