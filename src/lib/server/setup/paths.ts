import { homedir } from 'node:os';
import path from 'node:path';
import { PLUGINS_ROOT, POLICIES_ROOT, SKILLS_ROOT } from '#lib/config';

export function murphHome(): string {
  return process.env.MURPH_HOME || path.join(homedir(), '.murph');
}

export function userPluginRoot(): string {
  return path.join(murphHome(), PLUGINS_ROOT);
}

export function userPolicyRoot(): string {
  return path.join(murphHome(), POLICIES_ROOT);
}

export function userSkillRoot(): string {
  return path.join(murphHome(), SKILLS_ROOT);
}

export function userIntegrationRoot(): string {
  return path.join(murphHome(), 'integrations');
}
