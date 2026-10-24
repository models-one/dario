#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'help', ...args] = process.argv.slice(2);
const help = `template-workflow
  capture [--cc-version x.y.z] [Dario bake flags]
                              Capture and bake our template into src/cc-template-data.json
  check [Dario check flags]    Detect drift; exit 0 match, 1 infra, 2 shape, 3 label
  label-sync <CC-version>      Apply upstream's label-only version update
  status                      Show installed CC and current bundled template
  verify [template.json]       Check the producer's schema 3 artifact
  prepare-claude [--cc-version x.y.z]  Resolve latest once, verify and cache the client
  produce                     Resolve latest, detect drift, bake/label-sync, verify and export
  export [--out directory] [--source source.json]
                              Export our template after verifying its capture provenance
Run npm ci && npm run build first. Production capture must run on the selected native platform.
`;
function value(flag, fallback) {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return args[i + 1];
}
async function script(file, argv = [], capture = false) {
  const env = { ...process.env };
  let client;
  let baseline = capture ? readFileSync(join(root, 'src/cc-template-data.json')) : null;
  const original = baseline;
  const proofFile = join(root, 'src/cc-template-provenance.json');
  const originalProof = existsSync(proofFile) ? readFileSync(proofFile) : null;
  let committed = false;
  try {
  if (capture) {
    const { prepareClaude, verifyPreparedClient } = await import('../lib/claude-runtime.mjs');
    client = env.TEMPLATE_PREPARED_CC
      ? verifyPreparedClient(JSON.parse(env.TEMPLATE_PREPARED_CC))
      : prepareClaude({ version: value('--cc-version', env.TEMPLATE_CC_VERSION || 'latest') });
    client.requested ||= value('--cc-version', env.TEMPLATE_CC_VERSION || 'latest');
    client.resolved_at ||= new Date().toISOString();
    console.error(`[template-workflow] capture client ${client.version}, sha256 ${client.sha256}`);
    env.TEMPLATE_REAL_CLAUDE_BIN = client.path;
    env.TEMPLATE_NODE_BIN = process.execPath;
    env.DARIO_CLAUDE_BIN = join(root, process.platform === 'win32' ? 'scripts/claude-loopback.cmd' : 'scripts/claude-loopback.mjs');
    if (command === 'capture') {
      const { prepareCaptureBaseline } = await import('../lib/production.mjs');
      const repair = prepareCaptureBaseline(root);
      if (repair && !env.TEMPLATE_BASELINE_REPAIR) env.TEMPLATE_BASELINE_REPAIR = JSON.stringify(repair);
      baseline = readFileSync(join(root, 'src/cc-template-data.json'));
    }
  }
  const child = spawn(process.execPath, [join(root, 'scripts', file), ...argv], { cwd: root, env, stdio: 'inherit' });
  const signals = ['SIGINT', 'SIGTERM'];
  const handlers = signals.map((s) => { const handler = () => child.kill(s); process.on(s, handler); return handler; });
  const code = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('exit', (code) => { signals.forEach((s, i) => process.removeListener(s, handlers[i])); done(code ?? 1); });
  });
  if (capture && command === 'capture' && code === 0) {
    const { recordProduction } = await import('../lib/production.mjs');
    recordProduction(root, { raw: readFileSync(join(root, 'src/cc-template-data.json')), baseline, client, operation: 'capture', env, upstreamCommit: JSON.parse(readFileSync(join(root, 'upstream-snapshot.json'))).commit });
  }
  if (capture && command === 'check') {
    const { sha256 } = await import('../lib/template.mjs');
    mkdirSync(join(root, 'artifacts'), { recursive: true });
    writeFileSync(join(root, 'artifacts/check.json'), JSON.stringify({ code, baseline_sha256: sha256(baseline), client }));
  }
  committed = code === 0;
  return code;
  } finally {
    if (capture && command === 'capture' && !committed) {
      writeFileSync(join(root, 'src/cc-template-data.json'), original);
      if (originalProof) writeFileSync(proofFile, originalProof); else rmSync(proofFile, { force: true });
    }
  }
}
try {
  if (['help', '--help', '-h'].includes(command)) { console.log(help); }
  else {
    if (!existsSync(join(root, 'dist/live-fingerprint.js'))) throw new Error('Build missing. Run npm ci && npm run build first.');
    if (['produce', 'capture', 'label-sync'].includes(command)) {
      const { TARGET_PLATFORM, NATIVE_PLATFORMS } = await import('../lib/platform.mjs');
      if (!NATIVE_PLATFORMS.includes(TARGET_PLATFORM) || process.platform !== TARGET_PLATFORM) throw new Error('Template production must run on its target native platform');
    }
    if (command === 'capture' || command === 'check') {
      const forwarded = args.filter((_, i) => args[i] !== '--cc-version' && args[i - 1] !== '--cc-version');
      process.exitCode = await script('capture-and-bake.mjs', command === 'check' ? ['--check', ...forwarded] : forwarded, true);
    }
    else if (command === 'prepare-claude') {
      const { prepareClaude } = await import('../lib/claude-runtime.mjs');
      console.log(JSON.stringify(prepareClaude({ version: value('--cc-version', process.env.TEMPLATE_CC_VERSION || 'latest') }), null, 2));
    }
    else if (command === 'produce') process.exitCode = await script('produce.mjs');
    else if (command === 'label-sync') {
      const { sha256 } = await import('../lib/template.mjs');
      const { recordProduction } = await import('../lib/production.mjs');
      const baseline = readFileSync(join(root, 'src/cc-template-data.json'));
      const check = JSON.parse(readFileSync(join(root, 'artifacts/check.json')));
      if (check.code !== 3 || check.client.version !== args[0] || check.baseline_sha256 !== sha256(baseline)) throw new Error('Label sync requires a matching live check with label-only drift');
      const { verifyPreparedClient } = await import('../lib/claude-runtime.mjs');
      verifyPreparedClient(check.client);
      process.exitCode = await script('label-sync.mjs', args);
      if (!process.exitCode) recordProduction(root, { raw: readFileSync(join(root, 'src/cc-template-data.json')), baseline, client: check.client, operation: 'label-sync', upstreamCommit: JSON.parse(readFileSync(join(root, 'upstream-snapshot.json'))).commit });
    }
    else if (command === 'status') {
      const { findInstalledCC } = await import('../dist/live-fingerprint.js');
      if (process.env.TEMPLATE_CLAUDE_BIN) process.env.DARIO_CLAUDE_BIN = process.env.TEMPLATE_CLAUDE_BIN;
      const installed = findInstalledCC();
      const t = JSON.parse(readFileSync(join(root, 'src/cc-template-data.json')));
      console.log(JSON.stringify({ installed_cc: installed.version, requested_cc: process.env.TEMPLATE_CC_VERSION || 'latest', template_cc: t._version, has_capture_provenance: existsSync(join(root, 'src/cc-template-provenance.json')), schema: t._schemaVersion, captured_at: t._captured, tools: t.tools.length, variants: Object.keys(t.system_prompt_variants || {}) }, null, 2));
    } else if (command === 'verify') {
      const { validateTemplate, sha256 } = await import('../lib/template.mjs');
      const raw = readFileSync(resolve(args[0] || join(root, 'src/cc-template-data.json')));
      const t = validateTemplate(raw);
      const { assertTargetTemplate } = await import('../lib/platform.mjs');
      const proof = existsSync(join(root, 'src/cc-template-provenance.json')) ? JSON.parse(readFileSync(join(root, 'src/cc-template-provenance.json'))) : null;
      assertTargetTemplate(t, proof?.target_platform);
      console.log(JSON.stringify({ valid: true, cc_version: t._version, schema: t._schemaVersion, bytes: raw.length, sha256: sha256(raw) }, null, 2));
    } else if (command === 'export') {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--observed') continue; // Backward-compatible alias for the sole production output.
        if (!['--out', '--source'].includes(args[i])) throw new Error(`Unknown export option: ${args[i]}`);
        value(args[i]); i++;
      }
      const { readProduction } = await import('../lib/production.mjs');
      const { provenance } = readProduction(root);
      const { exportTemplate } = await import('../lib/template.mjs');
      const sourcePath = value('--source');
      const source = sourcePath ? JSON.parse(readFileSync(resolve(sourcePath))) : undefined;
      console.log(JSON.stringify(exportTemplate({ templatePath: join(root, 'src/cc-template-data.json'), out: value('--out', join(root, 'artifacts/latest')), source, provenance }), null, 2));
    } else throw new Error(`Unknown command: ${command}\n${help}`);
  }
} catch (error) { console.error(`[template-workflow] ${error.message}`); process.exitCode = 1; }
