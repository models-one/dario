import { PLATFORM_ONLY_TOOLS } from '../dist/live-fingerprint.js';
export const PROFILES = Object.freeze({
  darwin: { key: 'macos', label: 'macOS' },
  win32: { key: 'windows', label: 'Windows' },
  linux: { key: 'linux', label: 'Linux' },
  all: { key: 'all', label: 'All platforms' },
});
export const NATIVE_PLATFORMS = ['linux', 'darwin', 'win32'];
export function profile(platform) {
  if (!Object.hasOwn(PROFILES, platform)) throw new Error(`Unsupported template platform: ${platform}`);
  return PROFILES[platform];
}
export const TARGET_PLATFORM = process.env.TEMPLATE_TARGET_PLATFORM || process.platform;
export const TARGET_LABEL = profile(TARGET_PLATFORM).label;
export function foreignPlatformToolNames(template, platform = TARGET_PLATFORM) {
  profile(platform);
  if (platform === 'all') return [];
  return (template.tools || []).filter((tool) => Object.entries(PLATFORM_ONLY_TOOLS).some(([owner, names]) => owner !== platform && names.has(tool.name))).map((tool) => tool.name);
}
export function assertTargetTemplate(template, platform = TARGET_PLATFORM) {
  const foreign = foreignPlatformToolNames(template, platform);
  if (foreign.length) throw new Error(`${profile(platform).label} template contains other-platform tools: ${foreign.join(', ')}`);
  return template;
}
