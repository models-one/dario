// Declared source adaptations include module paths and the macOS bake host. HEAD:./ is relative to the producer, even in a larger Git repo.
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
    text = text.slice(0, start) + "// This producer publishes macOS templates. Checks may run elsewhere, but\n// a production bake must come from the native macOS client on a macOS host.\nif (!CHECK_MODE && process.platform !== 'darwin') {\n  log(`error: refusing to bake a macOS template from ${process.platform}. Run the macOS capture workflow.`);\n  process.exit(1);\n}\n\n" + text.slice(end);
    changes.push('Require macOS for template baking; keep the original multi-model capture, scrub, preservation and drift algorithms.');

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
