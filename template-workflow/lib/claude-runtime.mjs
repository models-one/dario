import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, renameSync, rmSync, openSync, closeSync, chmodSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

function run(bin, args, options = {}) {
  if (bin === 'npm' && process.platform === 'win32') {
    const cli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (!existsSync(cli)) throw new Error('Cannot locate npm-cli.js; launch through npm run on Windows');
    args = [cli, ...args]; bin = process.execPath;
  }
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${bin} ${args[0]} failed (${result.error?.code || result.status}); client preparation stopped`);
  return result.stdout;
}
const digest = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');
function binaryVersion(path) {
  const text = run(path, ['--version'], { timeout: 15000 });
  const version = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/.exec(text)?.[1];
  if (!version) throw new Error('Claude did not report an exact version');
  return version;
}
export function runtimePlatform() {
  let platform = `${process.platform}-${process.arch}`;
  if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) platform += '-musl';
  return platform;
}
export function verifyPreparedClient(client) {
  if (!client || !/^\d+\.\d+\.\d+$/.test(client.version) || !/^[a-f0-9]{64}$/.test(client.sha256 || '') || !client.path) throw new Error('Invalid prepared client manifest');
  if (digest(readFileSync(client.path)) !== client.sha256 || binaryVersion(client.path) !== client.version) throw new Error('Prepared Claude binary changed or reports the wrong version');
  return client;
}
export function installClientArchive({ archive, dist, version, platform, target, packageName }) {
  const archiveBytes = readFileSync(archive);
  const [algorithm, expected] = String(dist.integrity).split('-');
  if (algorithm !== 'sha512' || createHash('sha512').update(archiveBytes).digest('base64') !== expected) throw new Error('Claude package integrity mismatch');
  const names = run('tar', ['-tf', archive]).trim().split(/\r?\n/);
  const binaries = names.filter((name) => /^package\/(?:bin\/)?claude(?:\.exe)?$/.test(name));
  if (binaries.length !== 1) throw new Error('Claude archive must contain exactly one expected native binary');
  mkdirSync(target, { recursive: true });
  const path = join(target, platform.startsWith('win32-') ? 'claude.exe' : 'claude');
  const fd = openSync(path, 'wx', 0o700);
  try { run('tar', ['-xOf', archive, binaries[0]], { stdio: ['ignore', fd, 'pipe'] }); } finally { closeSync(fd); }
  chmodSync(path, 0o700);
  if (statSync(path).size === 0 || binaryVersion(path) !== version) throw new Error('Downloaded Claude binary reports the wrong version');
  const manifest = { version, platform, package: packageName, package_integrity: dist.integrity, sha256: digest(readFileSync(path)) };
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { ...manifest, path };
}

export function prepareClaude({ version = process.env.TEMPLATE_CC_VERSION || 'latest', binary = process.env.TEMPLATE_CLAUDE_BIN || process.env.DARIO_CLAUDE_BIN, cacheDir = process.env.TEMPLATE_CC_CACHE_DIR || join(homedir(), '.cache', 'template-workflow', 'claude'), platform = runtimePlatform(), resolveMetadata, pack } = {}) {
  if (version !== 'latest' && !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('CC version must be latest or an exact x.y.z version');
  const npmEnv = { ...process.env };
  if (process.env.TEMPLATE_HTTP_PROXY) npmEnv.npm_config_proxy = process.env.TEMPLATE_HTTP_PROXY;
  const view = resolveMetadata || ((spec) => JSON.parse(run('npm', ['view', spec, '--json', '--registry=https://registry.npmjs.org'], { env: npmEnv })));
  // An explicit binary still has to match latest unless the operator explicitly
  // requests a fixed version. Tests use a fixed version and never access npm.
  let wrapper;
  let exact = version;
  if (!binary || version === 'latest') {
    wrapper = view(`@anthropic-ai/claude-code@${version}`);
    exact = wrapper.version;
    if (!/^\d+\.\d+\.\d+$/.test(exact || '') || (version !== 'latest' && exact !== version)) throw new Error('npm returned an unexpected Claude version');
  }
  if (binary) {
    let path = binary;
    if (!binary.includes('/') && !binary.includes('\\')) {
      const search = run(process.platform === 'win32' ? 'where' : 'which', [binary]);
      path = search.trim().split(/\r?\n/)[0];
    }
    path = resolve(path);
    if (binaryVersion(path) !== exact) throw new Error(`Configured Claude does not match ${exact}; use TEMPLATE_CC_VERSION for an explicit historical run`);
    return { path, version: exact, platform, sha256: digest(readFileSync(path)), source: 'explicit-binary' };
  }
  const packageName = `@anthropic-ai/claude-code-${platform}`;
  const nativeVersion = wrapper.optionalDependencies?.[packageName];
  if (nativeVersion !== exact) throw new Error(`No pinned native package for ${platform} at ${exact}`);
  const metadata = view(`${packageName}@${exact}`);
  if (metadata.version !== exact || typeof metadata.dist?.integrity !== 'string') throw new Error('Invalid native package metadata');
  const destination = join(resolve(cacheDir), `${exact}-${platform}`);
  if (existsSync(destination)) {
    const manifest = JSON.parse(readFileSync(join(destination, 'manifest.json')));
    if (manifest.version !== exact || manifest.platform !== platform || manifest.package !== packageName || manifest.package_integrity !== metadata.dist.integrity) throw new Error('Cached Claude metadata does not match the requested package');
    return verifyPreparedClient({ ...manifest, path: join(destination, platform.startsWith('win32-') ? 'claude.exe' : 'claude') });
  }
  mkdirSync(resolve(cacheDir), { recursive: true });
  const scratch = mkdtempSync(join(resolve(cacheDir), '.prepare-'));
  try {
    const acquire = pack || ((spec, directory) => {
      const packed = JSON.parse(run('npm', ['pack', spec, '--registry=https://registry.npmjs.org', '--ignore-scripts', '--silent', '--json', '--pack-destination', directory], { env: npmEnv }));
      const filename = packed[0]?.filename;
      if (!filename || filename.includes('/') || filename.includes('\\')) throw new Error('Invalid npm archive filename');
      return join(directory, filename);
    });
    const archive = acquire(`${packageName}@${exact}`, scratch);
    const staged = join(scratch, 'client');
    const client = installClientArchive({ archive, dist: metadata.dist, version: exact, platform, target: staged, packageName });
    try { renameSync(staged, destination); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      const other = JSON.parse(readFileSync(join(destination, 'manifest.json')));
      if (other.sha256 !== client.sha256 || other.package_integrity !== client.package_integrity) throw new Error('Concurrent Claude cache preparation disagreed');
    }
    return verifyPreparedClient({ ...client, path: join(destination, platform.startsWith('win32-') ? 'claude.exe' : 'claude') });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

export function resolveLatestClaudeVersion() {
  const env = { ...process.env };
  if (env.TEMPLATE_HTTP_PROXY) env.npm_config_proxy = env.TEMPLATE_HTTP_PROXY;
  const version = JSON.parse(run('npm', ['view', '@anthropic-ai/claude-code@latest', 'version', '--json', '--registry=https://registry.npmjs.org'], { env }));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('npm did not return an exact latest version');
  return { version, resolved_at: new Date().toISOString() };
}
