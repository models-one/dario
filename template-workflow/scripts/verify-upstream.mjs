import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const snapshot = JSON.parse(readFileSync(new URL('upstream-snapshot.json', root)));
let count = 0;
for (const [name, spec] of Object.entries(snapshot.files)) {
  if (spec.mutable) continue;
  let raw = readFileSync(new URL(name, root));
  let expected = spec.local_sha256;
  if (spec.normalized_sha256) { raw = Buffer.from(raw.toString().replace(/maxTested:\s*'[^']+'/g, "maxTested: 'PINNED'")); expected = spec.normalized_sha256; }
  if (createHash('sha256').update(raw).digest('hex') !== expected) throw new Error(`Upstream code changed without updating its source record: ${name}`);
  count++;
}
console.log(`Verified ${count} extracted files against Dario ${snapshot.commit}`);
