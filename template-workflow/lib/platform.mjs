import { PLATFORM_ONLY_TOOLS } from '../dist/live-fingerprint.js';
export const TARGET_PLATFORM = 'darwin';
export const TARGET_LABEL = 'macOS';
export function foreignPlatformToolNames(template) {
  return (template.tools || []).filter((tool) => Object.entries(PLATFORM_ONLY_TOOLS).some(([platform, names]) => platform !== TARGET_PLATFORM && names.has(tool.name))).map((tool) => tool.name);
}
export function assertTargetTemplate(template) {
  const foreign = foreignPlatformToolNames(template);
  if (foreign.length) throw new Error(`macOS template contains other-platform tools: ${foreign.join(', ')}`);
  return template;
}
