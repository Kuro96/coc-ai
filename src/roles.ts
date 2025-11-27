import * as os from 'os';
import * as fs from 'fs';
import * as toml from '@iarna/toml';

import { IOptions, IRoleConfig } from './interface';
import { defaultEngineConfig } from './engine';
import { mergeDefault } from './utils';

export function getRoles() {
  let rolesConfigPath = defaultEngineConfig.rolesConfigPath;
  rolesConfigPath = rolesConfigPath.replace(/^~/, os.homedir());
  try {
    const content = fs.readFileSync(rolesConfigPath, 'utf-8');
    const roles: Record<string, IRoleConfig> = toml.parse(content) as Record<
      string,
      any
    >;
    return roles;
  } catch (e) {
    console.error(`Error reading ini file: ${e}`);
    return null;
  }
}

export function parseTaskRole(
  rawPrompt: string,
  task?: 'chat' | 'complete' | 'edit',
): IRoleConfig {
  rawPrompt = rawPrompt.trim();
  if (!rawPrompt.startsWith('/')) return { prompt: rawPrompt };

  const parts = rawPrompt.trim().split(/[^\S\r\n]+/);
  const roleNames: string[] = [];
  let promptParts: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const currentPart = parts[i];
    if (currentPart.startsWith('/')) {
      roleNames.push(currentPart.slice(1));
      i++;
    } else {
      promptParts = parts.slice(i);
      break;
    }
  }
  let prompt = promptParts.join(' ');

  const roles = getRoles();
  let roleConfig: IRoleConfig = {};
  for (const roleName of roleNames) {
    const role = roles ? roles[roleName] : null;
    if (role) roleConfig = mergeDefault(roleConfig, role);
  }

  let options: IOptions = {};
  if (Object.keys(roleConfig).length) {
    if (roleConfig.prompt) prompt = roleConfig.prompt + ':\n' + prompt;
    if (roleConfig.options) options = roleConfig.options;
    if (task) {
      const taskOptions = roleConfig[`options-${task}`];
      if (taskOptions) options = mergeDefault(options, taskOptions);
    }
  }
  return { prompt, options };
}
