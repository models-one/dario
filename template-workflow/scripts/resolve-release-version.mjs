import { appendFileSync } from 'node:fs';
import { resolveLatestClaudeVersion } from '../lib/claude-runtime.mjs';
const resolved = resolveLatestClaudeVersion();
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${resolved.version}\nresolved_at=${resolved.resolved_at}\n`);
console.log(JSON.stringify(resolved));
