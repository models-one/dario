#!/usr/bin/env node
// Launch adaptation only. The Dario capture/scrub/drift algorithms are unchanged.
import { spawn } from 'node:child_process';
const binary = process.env.TEMPLATE_REAL_CLAUDE_BIN;
if (!binary) { console.error('Missing TEMPLATE_REAL_CLAUDE_BIN'); process.exit(1); }
const args = process.argv.slice(2);
const env = { ...process.env };
if (!args.includes('--version')) {
  let endpoint;
  try { endpoint = new URL(env.ANTHROPIC_BASE_URL); } catch { console.error('Missing loopback capture URL'); process.exit(1); }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !/^\/dario-capture-[a-f0-9]+$/.test(endpoint.pathname)) { console.error('Refusing a non-loopback capture URL'); process.exit(1); }
  // Claude's user settings can override process env. The explicit --settings
  // layer pins only this child's endpoint/model; personal settings stay intact.
  args.push('--settings', JSON.stringify({ env: { ANTHROPIC_BASE_URL: endpoint.href, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || 'sk-dario-fingerprint-capture', ANTHROPIC_MODEL: env.ANTHROPIC_MODEL } }), '--model', env.ANTHROPIC_MODEL);
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
  env.NO_PROXY = env.no_proxy = '127.0.0.1,localhost';
}
const child = spawn(binary, args, { env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(`Claude launch failed: ${error.code || 'unknown'}`); process.exitCode = 1; });
child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
