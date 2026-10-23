import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function repositoryPath(relativePath, cwd = moduleRoot) {
  if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').includes('..')) throw new Error('Expected a module-relative repository path');
  const prefix = execFileSync('git', ['rev-parse', '--show-prefix'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return prefix + relativePath;
}
