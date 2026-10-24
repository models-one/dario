import { sha256 } from './template.mjs';
import { NATIVE_PLATFORMS } from './platform.mjs';
export function verifyCurrentCheck(check, raw, { platform, version, repository, runId, commit } = {}) {
  const template = JSON.parse(raw);
  if (check?.format !== 'template-workflow-check/v1' || !NATIVE_PLATFORMS.includes(check.target_platform) || check.target_platform !== platform || check.cc_version !== version || template._version !== version || check.template_sha256 !== sha256(raw)) throw new Error('Capture batch check does not match the platform artifact');
  if (repository && check.repository !== repository || runId && check.run_id !== runId || commit && check.commit !== commit) throw new Error('Capture components came from different workflow batches');
  if (!check.client?.platform?.startsWith(platform + '-') || check.client.version !== version || check.client.requested !== 'latest') throw new Error('Capture batch used the wrong native client');
  if (!Array.isArray(check.observed_tools) || !check.observed_tools.length || new Set(check.observed_tools).size !== check.observed_tools.length || check.observed_tools.some((name) => !template.tool_names.includes(name))) throw new Error('Invalid observed-tool inventory');
  for (const family of ['fable', 'opus-5', 'sonnet-5']) {
    if (!['fresh', 'base', 'known-alt'].includes(check.variant_outcomes?.[family])) throw new Error(`Incomplete fresh capture for ${platform}/${family}`);
  }
  return check;
}
