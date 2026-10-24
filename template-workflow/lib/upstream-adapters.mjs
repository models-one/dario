// Declared source adaptations include module paths, native host guards and observation evidence. HEAD:./ is relative to the producer, even in a larger Git repo.
export function adaptUpstreamSource(target, raw) {
  let text = raw.toString();
  const changes = [];
  if (target === 'scripts/capture-and-bake.mjs') {
    const before = text;
    text = text.replace("from '../dist/cc-template.js'", "from '../dist/live-fingerprint.js'");
    if (text !== before) changes.push('Import preservation constants from their defining module; verified against the original bake by replay.');
    const guardStart = text.indexOf('// Bake host must be Linux,');
    const guardEnd = text.indexOf('// Preserve other-platform tools from the previous bundle', guardStart);
    if (guardStart < 0 || guardEnd < 0) throw new Error('Capture platform guard layout changed; review before importing');
    text = text.replace("const ALLOW_NON_LINUX = process.argv.includes('--allow-non-linux-bake');\n", '');
    const start = text.indexOf('// Bake host must be Linux,');
    const end = text.indexOf('// Preserve other-platform tools from the previous bundle', start);
    text = text.slice(0, start) + "// A native template must be baked on its declared platform.\nconst capturePlatform = process.env.TEMPLATE_TARGET_PLATFORM || process.platform;\nif (!CHECK_MODE && (!['linux', 'darwin', 'win32'].includes(capturePlatform) || process.platform !== capturePlatform)) {\n  log(`error: refusing to bake ${capturePlatform} from ${process.platform}.`);\n  process.exit(1);\n}\n\n" + text.slice(end);
    const evidenceAt = text.indexOf('\nif (CHECK_MODE) {', text.indexOf('scrubbed._variantShapeHashes'));
    if (evidenceAt < 0) throw new Error('Capture evidence insertion point changed');
    text = text.slice(0, evidenceAt) + "\nwriteFileSync(join(repoRoot, 'capture-observation.json'), JSON.stringify({\n  format: 'template-workflow-observation/v1', platform: process.platform, cc_version: captured._version, captured_at: captured._captured,\n  observed_tools: captured.tools.filter((t) => !t.name.startsWith('mcp__')).map((t) => t.name),\n  variant_outcomes: variantOutcomes, variant_hashes: capturedArmHashes, run_id: process.env.GITHUB_RUN_ID || null,\n}, null, 2) + '\\n');\n" + text.slice(evidenceAt);
    changes.push('Require the configured native host and record observed tools/model outcomes; retain capture, scrub, preservation and drift algorithms.');

  }
  if (target === 'test/live-fingerprint.mjs') {
    const before = text;
    const old = "  if (process.platform !== 'win32') {\n    check('other-platform tool restored: PowerShell', names.includes('PowerShell'));\n  }";
    const scoped = "  // The producer baseline is macOS-only; merging its live cache must not\n  // inject platform tools removed during the macOS baseline migration.\n  for (const tool of ['PowerShell', 'Glob', 'Grep']) {\n    check(`macOS baseline does not inject ${tool}`, !names.includes(tool));\n  }";
    if (!text.includes(old) && !text.includes('macOS baseline does not inject')) throw new Error('Live cache platform assertion changed; review before importing');
    text = text.replace(old, scoped);
    if (text !== before) changes.push('Assert macOS baseline exclusion of Windows tools; original cross-platform preservation remains covered by replay tests.');
  }
  if (target === 'scripts/rebake-release-prep.mjs' || target === 'scripts/check-rebake-content.mjs') {
    const before = text;
    text = text.replaceAll('HEAD:${BUNDLE}', 'HEAD:./${BUNDLE}').replaceAll('HEAD:${REL}', 'HEAD:./${REL}');
    if (text !== before) changes.push('Use producer-relative Git paths for the committed baseline in nested repositories.');
  }
  return { bytes: Buffer.from(text), change: changes.join(' ') };
}
