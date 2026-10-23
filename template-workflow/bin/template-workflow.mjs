#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'help', ...args] = process.argv.slice(2);
const help = `template-workflow
  capture [--cc-version x.y.z] [Dario bake flags]
                              Capture a local observation into src/cc-template-data.json
  check [Dario check flags]    Detect drift; exit 0 match, 1 infra, 2 shape, 3 label
  label-sync <CC-version>      Apply upstream's label-only version update
  status                      Show installed CC and current bundled template
  verify [template.json]       Check the producer's schema 3 artifact
  prepare-claude [--cc-version x.y.z]  Resolve latest once, verify and cache the client
  export [--out directory] [--source source.json]
                              Export the pinned official Dario bytes (verified SHA-256)
  export --observed [--template file] [--out directory]
                              Export a local observation, explicitly marked as such
  verify-parity               Compare the local observation with the official reference
Run npm ci && npm run build first. Capture/bake follows Dario's Linux guard.
`;
function value(flag, fallback) {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return args[i + 1];
}
async function script(file, argv = [], capture = false) {
  const env = { ...process.env };
  if (capture) {
    const { prepareClaude, verifyPreparedClient } = await import('../lib/claude-runtime.mjs');
    const client = env.TEMPLATE_PREPARED_CC
      ? verifyPreparedClient(JSON.parse(env.TEMPLATE_PREPARED_CC))
      : prepareClaude({ version: value('--cc-version', env.TEMPLATE_CC_VERSION || 'latest') });
    console.error(`[template-workflow] capture client ${client.version}, sha256 ${client.sha256}`);
    env.TEMPLATE_REAL_CLAUDE_BIN = client.path;
    env.DARIO_CLAUDE_BIN = join(root, 'scripts/claude-loopback.mjs');
  }
  const child = spawn(process.execPath, [join(root, 'scripts', file), ...argv], { cwd: root, env, stdio: 'inherit' });
  const signals = ['SIGINT', 'SIGTERM'];
  const handlers = signals.map((s) => { const handler = () => child.kill(s); process.on(s, handler); return handler; });
  return await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code) => { signals.forEach((s, i) => process.removeListener(s, handlers[i])); done(code ?? 1); });
  });
}
try {
  if (['help', '--help', '-h'].includes(command)) { console.log(help); }
  else {
    if (!existsSync(join(root, 'dist/live-fingerprint.js'))) throw new Error('Build missing. Run npm ci && npm run build first.');
    if (command === 'capture' || command === 'check') {
      const forwarded = args.filter((_, i) => args[i] !== '--cc-version' && args[i - 1] !== '--cc-version');
      process.exitCode = await script('capture-and-bake.mjs', command === 'check' ? ['--check', ...forwarded] : forwarded, true);
    }
    else if (command === 'prepare-claude') {
      const { prepareClaude } = await import('../lib/claude-runtime.mjs');
      console.log(JSON.stringify(prepareClaude({ version: value('--cc-version', process.env.TEMPLATE_CC_VERSION || 'latest') }), null, 2));
    }
    else if (command === 'verify-parity') process.exitCode = await script('verify-parity.mjs');
    else if (command === 'label-sync') process.exitCode = await script('label-sync.mjs', args);
    else if (command === 'status') {
      const { findInstalledCC } = await import('../dist/live-fingerprint.js');
      if (process.env.TEMPLATE_CLAUDE_BIN) process.env.DARIO_CLAUDE_BIN = process.env.TEMPLATE_CLAUDE_BIN;
      const installed = findInstalledCC();
      const t = JSON.parse(readFileSync(join(root, 'src/cc-template-data.json')));
      const { readOfficialReference } = await import('../lib/official.mjs');
      const official = readOfficialReference(root);
      console.log(JSON.stringify({ installed_cc: installed.version, requested_cc: process.env.TEMPLATE_CC_VERSION || 'latest', official_cc: official.template._version, official_commit: official.origin.commit, observation_cc: t._version, template_cc: t._version, schema: t._schemaVersion, captured_at: t._captured, tools: t.tools.length, variants: Object.keys(t.system_prompt_variants || {}) }, null, 2));
    } else if (command === 'verify') {
      const { validateTemplate, sha256 } = await import('../lib/template.mjs');
      const raw = readFileSync(resolve(args[0] || join(root, 'src/cc-template-data.json')));
      const t = validateTemplate(raw);
      console.log(JSON.stringify({ valid: true, cc_version: t._version, schema: t._schemaVersion, bytes: raw.length, sha256: sha256(raw) }, null, 2));
    } else if (command === 'export') {
      const observed = args.includes('--observed');
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--observed') continue;
        if (!['--out', '--source', '--template'].includes(args[i])) throw new Error(`Unknown export option: ${args[i]}`);
        value(args[i]); i++;
      }
      if (args.includes('--template') && !observed) throw new Error('--template requires --observed; official export always uses the locked reference');
      const { exportTemplate } = await import('../lib/template.mjs');
      const sourcePath = value('--source');
      const source = sourcePath ? JSON.parse(readFileSync(resolve(sourcePath))) : undefined;
      let templatePath, origin;
      if (observed) {
        templatePath = resolve(value('--template', join(root, 'src/cc-template-data.json')));
        const { readOfficialReference } = await import('../lib/official.mjs');
        const { sha256 } = await import('../lib/template.mjs');
        const official = readOfficialReference(root);
        origin = { type: 'observation', reference_commit: official.origin.commit, reference_sha256: official.origin.reference_sha256, byte_identical: sha256(readFileSync(templatePath)) === official.origin.reference_sha256 };
      } else {
        const { readOfficialReference } = await import('../lib/official.mjs');
        const official = readOfficialReference(root);
        templatePath = official.path; origin = official.origin;
        if (source && source.dario_commit !== origin.commit) throw new Error('Source Dario commit does not match the official reference');
      }
      console.log(JSON.stringify(exportTemplate({ templatePath, out: value('--out', join(root, 'artifacts', observed ? 'observations/latest' : 'official')), source, origin }), null, 2));
    } else throw new Error(`Unknown command: ${command}\n${help}`);
  }
} catch (error) { console.error(`[template-workflow] ${error.message}`); process.exitCode = 1; }
