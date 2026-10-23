#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOfficialReference } from '../lib/official.mjs';
import { sha256 } from '../lib/template.mjs';
import { computeDrift } from './drift-report.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const official = readOfficialReference(root);
  const raw = readFileSync(join(root, 'src/cc-template-data.json'));
  const local = JSON.parse(raw);
  const changedFields = [...new Set([...Object.keys(local), ...Object.keys(official.template)])].filter((key) => JSON.stringify(local[key]) !== JSON.stringify(official.template[key]));
  const identical = raw.equals(official.raw);
  console.log(JSON.stringify({ official_commit: official.origin.commit, official_cc: official.template._version, observation_cc: local._version, byte_identical: identical, official_sha256: sha256(official.raw), observation_sha256: sha256(raw), changed_fields: changedFields, drift: computeDrift(official.template, local) }, null, 2));
  process.exitCode = identical ? 0 : 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
