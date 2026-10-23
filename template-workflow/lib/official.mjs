import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, validateTemplate } from './template.mjs';

export function readOfficialReference(root) {
  const snapshot = JSON.parse(readFileSync(join(root, 'upstream-snapshot.json')));
  const spec = snapshot.officialTemplate;
  if (snapshot.repository !== 'askalf/dario' || !/^[a-f0-9]{40}$/.test(snapshot.commit) || spec?.path !== 'reference/cc-template-data.json') throw new Error('Missing or invalid official Dario reference lock');
  const raw = readFileSync(join(root, spec.path));
  if (raw.length !== spec.bytes || sha256(raw) !== spec.sha256 || snapshot.files['src/cc-template-data.json']?.source_sha256 !== spec.sha256) throw new Error('Official Dario reference integrity mismatch; restore the locked reference before export');
  const template = validateTemplate(raw);
  if (template._version !== spec.ccVersion) throw new Error('Official reference version does not match its lock');
  return { raw, template, path: join(root, spec.path), origin: { type: 'dario-official', repository: snapshot.repository, commit: snapshot.commit, reference_sha256: spec.sha256, byte_identical: true } };
}
