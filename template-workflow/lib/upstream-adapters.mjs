// The upstream implementation is unchanged except for these declared location
// adaptations. HEAD:./ is relative to the producer, even in a larger Git repo.
export function adaptUpstreamSource(target, raw) {
  let text = raw.toString();
  const changes = [];
  if (target === 'scripts/capture-and-bake.mjs') {
    const before = text;
    text = text.replace("from '../dist/cc-template.js'", "from '../dist/live-fingerprint.js'");
    if (text !== before) changes.push('Import preservation constants from their defining module; verified against the original bake by replay.');
  }
  if (target === 'scripts/rebake-release-prep.mjs' || target === 'scripts/check-rebake-content.mjs') {
    const before = text;
    text = text.replaceAll('HEAD:${BUNDLE}', 'HEAD:./${BUNDLE}').replaceAll('HEAD:${REL}', 'HEAD:./${REL}');
    if (text !== before) changes.push('Use producer-relative Git paths for the committed baseline in nested repositories.');
  }
  return { bytes: Buffer.from(text), change: changes.join(' ') };
}
