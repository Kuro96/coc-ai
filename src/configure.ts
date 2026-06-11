import { window, workspace } from 'coc.nvim';

import { AuthProvider, ReasoningEffort } from './interface';

type ConfigTarget = 'global' | 'chat' | 'edit' | 'complete' | 'tab';

const config = workspace.getConfiguration('coc-ai');

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
