import fs from 'fs';
import os from 'os';
import path from 'path';
import { window, workspace } from 'coc.nvim';

import { AuthProvider, ReasoningEffort, ThinkingType } from './interface';

type ConfigTarget = 'global' | 'chat' | 'edit' | 'complete' | 'tab';
type ValueKind = 'string' | 'number' | 'boolean' | 'reasoning' | 'thinking';

interface SettingItem {
  label: string;
  target: ConfigTarget;
  key: string;
  kind: ValueKind;
}

const config = workspace.getConfiguration('coc-ai');
const { nvim } = workspace;

const TASKS: ConfigTarget[] = ['global', 'chat', 'edit', 'complete', 'tab'];
const CHATGPT_MODELS = ['gpt-5-codex', 'gpt-5.5', 'gpt-5.4-mini'];
const API_KEY_MODELS = ['gpt-5.5', 'gpt-5.4-mini', 'deepseek-v4-pro'];
const REASONING_EFFORTS: ReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];
const THINKING_TYPES: ThinkingType[] = ['enabled', 'disabled'];
const COMMON_SETTINGS: SettingItem[] = [
  { label: 'Global: model', target: 'global', key: 'model', kind: 'string' },
  {
    label: 'Global: endpoint URL',
    target: 'global',
    key: 'endpointUrl',
    kind: 'string',
  },
  { label: 'Global: proxy', target: 'global', key: 'proxy', kind: 'string' },
  {
    label: 'Global: API token path',
    target: 'global',
    key: 'tokenPath',
    kind: 'string',
  },
  {
    label: 'Global: OAuth token path',
    target: 'global',
    key: 'oauthTokenPath',
    kind: 'string',
  },
  {
    label: 'Global: max tokens',
    target: 'global',
    key: 'maxTokens',
    kind: 'number',
  },
  {
    label: 'Global: temperature',
    target: 'global',
    key: 'temperature',
    kind: 'number',
  },
  {
    label: 'Global: request timeout',
    target: 'global',
    key: 'requestTimeout',
    kind: 'number',
  },
  {
    label: 'Global: reasoning effort',
    target: 'global',
    key: 'reasoningEffort',
    kind: 'reasoning',
  },
  {
    label: 'Global: thinking mode',
    target: 'global',
    key: 'thinking',
    kind: 'thinking',
  },
  {
    label: 'Chat: auto title',
    target: 'chat',
    key: 'autoTitle',
    kind: 'boolean',
  },
  {
    label: 'Chat: auto scroll',
    target: 'chat',
    key: 'autoScroll',
    kind: 'boolean',
  },
  {
    label: 'Chat: preserve focus',
    target: 'chat',
    key: 'preserveFocus',
    kind: 'boolean',
  },
  {
    label: 'Chat: open chat command',
    target: 'chat',
    key: 'openChatCommand',
    kind: 'string',
  },
  {
    label: 'Chat: populate options header',
    target: 'chat',
    key: 'populatesOptions',
    kind: 'boolean',
  },
  {
    label: 'Tab: enable completion',
    target: 'tab',
    key: 'enabled',
    kind: 'boolean',
  },
  {
    label: 'Tab: max context size',
    target: 'tab',
    key: 'maxContextSize',
    kind: 'number',
  },
  {
    label: 'Tab: include open buffers',
    target: 'tab',
    key: 'includeOpenBuffers',
    kind: 'boolean',
  },
];

async function pick(label: string, items: string[]) {
  const index = await window.showMenuPicker(items, label);
  if (index < 0) return undefined;
  return items[index];
}

async function pickTarget() {
  return (await pick('Configure which coc-ai target?', TASKS)) as
    | ConfigTarget
    | undefined;
}

async function pickModel(models: string[]) {
  const custom = 'Custom model...';
  const model = await pick('Select model', [...models, custom]);
  if (!model) return undefined;
  if (model !== custom) return model;
  return await window.requestInput('Model name');
}

async function update(target: ConfigTarget, key: string, value: unknown) {
  await config.update(`${target}.${key}`, value, true);
}

function expandHome(filePath: string) {
  return filePath.replace(/^~(?=$|\/|\\)/, os.homedir());
}

function quoteVimString(value: string) {
  return value.replace(/'/g, "''");
}

async function editFile(filePath: string) {
  const expanded = expandHome(filePath);
  await nvim.command(`execute 'edit '.fnameescape('${quoteVimString(expanded)}')`);
}

async function openCocConfig() {
  await nvim.command('CocConfig');
}

function getConfigValue(target: ConfigTarget, key: string) {
  return config.get<unknown>(`${target}.${key}`);
}

function stringifyValue(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function editBooleanSetting(item: SettingItem) {
  const current = getConfigValue(item.target, item.key);
  const value = await pick(`${item.label} is ${stringifyValue(current) || 'unset'}`, [
    'true',
    'false',
  ]);
  if (!value) return;
  await update(item.target, item.key, value === 'true');
  await window.showInformationMessage(`coc-ai ${item.target}.${item.key} set to ${value}`);
}

async function editNumberSetting(item: SettingItem) {
  const input = await window.requestInput(
    item.label,
    stringifyValue(getConfigValue(item.target, item.key)),
  );
  if (input === undefined) return;
  const value = Number(input.trim());
  if (!Number.isFinite(value)) {
    await window.showInformationMessage(`${item.label} must be a number`, 'error');
    return;
  }
  await update(item.target, item.key, value);
  await window.showInformationMessage(`coc-ai ${item.target}.${item.key} set to ${value}`);
}

async function editStringSetting(item: SettingItem) {
  const input = await window.requestInput(
    item.label,
    stringifyValue(getConfigValue(item.target, item.key)),
  );
  if (input === undefined) return;
  await update(item.target, item.key, input);
  await window.showInformationMessage(`coc-ai ${item.target}.${item.key} updated`);
}

async function editReasoningSetting(item: SettingItem) {
  const value = (await pick(`${item.label}`, REASONING_EFFORTS)) as
    | ReasoningEffort
    | undefined;
  if (!value) return;
  await update(item.target, item.key, value);
  await window.showInformationMessage(`coc-ai ${item.target}.${item.key} set to ${value}`);
}

async function editThinkingSetting(item: SettingItem) {
  const value = (await pick(`${item.label}`, THINKING_TYPES)) as
    | ThinkingType
    | undefined;
  if (!value) return;
  await update(item.target, item.key, { type: value });
  await window.showInformationMessage(`coc-ai ${item.target}.${item.key} set to ${value}`);
}

async function editSetting(item: SettingItem) {
  if (item.kind === 'boolean') {
    await editBooleanSetting(item);
  } else if (item.kind === 'number') {
    await editNumberSetting(item);
  } else if (item.kind === 'reasoning') {
    await editReasoningSetting(item);
  } else if (item.kind === 'thinking') {
    await editThinkingSetting(item);
  } else {
    await editStringSetting(item);
  }
}

async function configureOneSetting() {
  const labels = COMMON_SETTINGS.map((item) => item.label);
  const label = await pick('Pick a common coc-ai setting', labels);
  if (!label) return;
  const item = COMMON_SETTINGS.find((candidate) => candidate.label === label);
  if (item) await editSetting(item);
}

async function configureRolesPath() {
  const defaultPath = config.get<string>(
    'global.rolesConfigPath',
    '~/.vim/vimrc.d/coc-ai-roles.toml',
  );
  const rolesConfigPath = await window.requestInput('Roles TOML path', defaultPath);
  if (!rolesConfigPath) return;
  await update('global', 'rolesConfigPath', rolesConfigPath);
  await window.showInformationMessage(`coc-ai rolesConfigPath set to ${rolesConfigPath}`);
}

async function openRolesConfig() {
  const rolesConfigPath = config.get<string>(
    'global.rolesConfigPath',
    '~/.vim/vimrc.d/coc-ai-roles.toml',
  );
  const expanded = expandHome(rolesConfigPath);
  if (!fs.existsSync(expanded)) {
    const shouldCreate = await window.showPrompt(
      `${rolesConfigPath} does not exist. Create an empty roles file?`,
    );
    if (!shouldCreate) return;
    fs.mkdirSync(path.dirname(expanded), { recursive: true });
    fs.writeFileSync(
      expanded,
      '# coc-ai roles\n# Example:\n# [grammar]\n# prompt = "fix spelling and grammar"\n',
      'utf-8',
    );
  }
  await editFile(rolesConfigPath);
}

async function configureChatGPT(target: ConfigTarget) {
  const model = await pickModel(CHATGPT_MODELS);
  if (!model) return;
  const reasoningEffort = (await pick(
    'Select reasoning effort',
    REASONING_EFFORTS,
  )) as ReasoningEffort | undefined;
  if (!reasoningEffort) return;

  await update(target, 'authProvider', 'openai-codex' satisfies AuthProvider);
  await update(target, 'model', model);
  await update(target, 'requiresAuth', true);
  await update(target, 'reasoningEffort', reasoningEffort);

  const shouldSetPath = await window.showPrompt(
    'Set a custom OAuth token path? No keeps the default OpenCode path with Codex CLI fallback.',
  );
  if (shouldSetPath) {
    const path = await window.requestInput(
      'OAuth token path',
      config.get<string>(`${target}.oauthTokenPath`, '~/.opencode/auth/openai.json'),
    );
    if (path) await update(target, 'oauthTokenPath', path);
  }

  await window.showInformationMessage(
    `coc-ai ${target} configured for ChatGPT Plus/Pro with ${model}`,
  );
}

async function configureAPIKey(target: ConfigTarget) {
  const model = await pickModel(API_KEY_MODELS);
  if (!model) return;
  const endpointUrl = await window.requestInput(
    'OpenAI-compatible endpoint URL',
    model.startsWith('deepseek-')
      ? 'https://api.deepseek.com/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions',
  );
  if (!endpointUrl) return;
  const tokenPath = await window.requestInput(
    'API token path',
    config.get<string>(`${target}.tokenPath`, '~/.vim/vimrc.d/coc-ai-token.toml'),
  );
  if (!tokenPath) return;
  const reasoningEffort = (await pick(
    'Select reasoning effort',
    ['none', ...REASONING_EFFORTS],
  )) as ReasoningEffort | undefined;
  if (!reasoningEffort) return;

  await update(target, 'authProvider', 'api-key' satisfies AuthProvider);
  await update(target, 'model', model);
  await update(target, 'endpointUrl', endpointUrl);
  await update(target, 'tokenPath', tokenPath);
  await update(target, 'requiresAuth', true);
  await update(target, 'reasoningEffort', reasoningEffort);

  await window.showInformationMessage(
    `coc-ai ${target} configured for ${model}`,
  );
}

async function configureModelOnly(target: ConfigTarget) {
  const model = await pickModel([...CHATGPT_MODELS, ...API_KEY_MODELS]);
  if (!model) return;
  await update(target, 'model', model);
  await window.showInformationMessage(`coc-ai ${target} model set to ${model}`);
}

export async function configure() {
  const mode = await pick('coc-ai configuration', [
    'Provider/model wizard',
    'Edit one common setting',
    'Set roles config path',
    'Open roles TOML',
    'Open coc-settings.json',
  ]);
  if (!mode) return;

  if (mode === 'Edit one common setting') {
    await configureOneSetting();
    return;
  }
  if (mode === 'Set roles config path') {
    await configureRolesPath();
    return;
  }
  if (mode === 'Open roles TOML') {
    await openRolesConfig();
    return;
  }
  if (mode === 'Open coc-settings.json') {
    await openCocConfig();
    return;
  }

  const target = await pickTarget();
  if (!target) return;

  const action = await pick('What do you want to configure?', [
    'ChatGPT Plus/Pro (Codex OAuth)',
    'OpenAI-compatible API key',
    'Model only',
  ]);
  if (!action) return;

  if (action === 'ChatGPT Plus/Pro (Codex OAuth)') {
    await configureChatGPT(target);
  } else if (action === 'OpenAI-compatible API key') {
    await configureAPIKey(target);
  } else {
    await configureModelOnly(target);
  }
}
