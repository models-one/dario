#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
const t = JSON.parse(readFileSync(process.env.TEMPLATE_TEST_TEMPLATE));
const version = process.env.TEMPLATE_TEST_VERSION || t._version;
if (process.argv.includes('--version')) { console.log(`${version} (Claude Code)`); process.exit(0); }
const settingsAt = process.argv.indexOf('--settings');
if (settingsAt < 0) { console.error('Expected explicit loopback settings'); process.exit(1); }
const settings = JSON.parse(process.argv[settingsAt + 1]);
const url = new URL(settings.env.ANTHROPIC_BASE_URL);
if (url.hostname !== '127.0.0.1' || url.href !== process.env.ANTHROPIC_BASE_URL) process.exit(1);
const model = process.env.ANTHROPIC_MODEL;
const family = model.includes('fable') ? 'fable' : model.includes('opus-5') ? 'opus-5' : model.includes('sonnet-5') ? 'sonnet-5' : null;
if (process.env.TEMPLATE_TEST_CAPTURES) appendFileSync(process.env.TEMPLATE_TEST_CAPTURES, JSON.stringify({ model, endpoint: url.hostname, explicitSettings: true }) + '\n');
const mutation = process.env.TEMPLATE_TEST_MUTATION;
const prompt = (family ? t.system_prompt_variants[family] : t.system_prompt) + (mutation === 'shape' && !family ? '\nA new canonical instruction.' : '');
const tools = mutation === 'tool-drop' ? t.tools.filter((tool) => tool.name !== 'Read') : t.tools;
const values = { model, messages: [{ role: 'user', content: 'hi' }], system: [{ type: 'text', text: 'x-anthropic-billing-header: test' }, { type: 'text', text: t.agent_identity }, { type: 'text', text: prompt }], tools, metadata: {}, max_tokens: 128, thinking: { type: 'adaptive' }, context_management: {}, output_config: {}, stream: true };
const body = JSON.stringify(Object.fromEntries(t.body_field_order.map((key) => [key, values[key]])));
const headers = { ...t.header_values, 'user-agent': t.header_values['user-agent'].replace(/claude-cli\/[\d.]+/, `claude-cli/${version}`), 'anthropic-beta': t.anthropic_beta, 'content-type': 'application/json', host: url.host, 'content-length': Buffer.byteLength(body).toString(), connection: 'close', 'accept-encoding': 'gzip', 'x-api-key': 'sk-test-capture', 'x-stainless-os': 'Linux', 'x-stainless-arch': 'x64', 'x-claude-code-session-id': 'synthetic-session' };
const pairs = t.header_order.flatMap((name) => [name, headers[name] || 'synthetic']);
const req = http.request(new URL(url.href + '/v1/messages?beta=true'), { method: 'POST', headers: pairs }, (res) => res.resume());
req.on('error', () => { process.exitCode = 1; });
req.end(body);
