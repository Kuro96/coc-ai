export interface IRoleConfig {
  prompt?: string;
  options?: IOptions; // global/merged
  'options-chat'?: IOptions; // chat
  'options-complete'?: IOptions; // complete
  'options-edit'?: IOptions; // edit
  'options-tab'?: IOptions; // tab
}

export interface IMessage {
  role: 'system' | 'user' | 'assistant' | 'include';
  content: string;
  reasoning_content?: string;
}

export interface IToken {
  apiKey: string;
  orgId: string | null;
}

export interface IOAuthToken {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
}

export interface IOpenAICodexToken {
  access: string;
  refresh: string;
  expires?: number;
  accountId?: string;
  path: string;
  authFile?: ICodexAuthFile;
  openCodeAuthFile?: IOpenCodeAuthFile;
}

export interface ICodexTokenData {
  id_token?: string | { chatgpt_account_id?: string; raw_jwt?: string };
  access_token: string;
  refresh_token: string;
  account_id?: string;
}

export interface ICodexAuthFile {
  auth_mode?: string;
  tokens?: ICodexTokenData;
  last_refresh?: string;
}

export interface IOpenCodeOAuthToken {
  type: 'oauth';
  access: string;
  refresh: string;
  expires?: number;
  accountId?: string;
}

export interface IOpenCodeAuthFile {
  openai?: IOpenCodeOAuthToken;
}

export interface IAPIOptions {
  model: string;
  messages: IMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  thinking?: IThinkingOptions;
  reasoning_effort?: APIReasoningEffort;
}

export type ThinkingType = 'enabled' | 'disabled';

export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export type APIReasoningEffort = ReasoningEffort;

export type AuthProvider = 'api-key' | 'openai-codex';

export interface IThinkingOptions {
  type: ThinkingType;
}

export interface IEngineConfig {
  model: string;
  endpointUrl: string;
  proxy: string;
  maxTokens: number;
  temperature: number;
  requestTimeout: number;
  authProvider?: AuthProvider;
  thinking?: IThinkingOptions;
  reasoningEffort?: ReasoningEffort;
  requiresAuth: boolean;
  initialPrompt: string;
  tokenPath: string;
  oauthTokenPath?: string;
  rolesConfigPath: string;

  // chat
  autoScroll?: boolean;
  codeSyntaxEnabled?: boolean;
  preserveFocus?: boolean;
  populatesOptions?: boolean;
  openChatCommand?: string;
  scratchBufferKeepOpen?: boolean;
  autoTitle?: boolean;

  // tab
  enabled?: boolean;
  maxContextSize?: number;
  includeOpenBuffers?: boolean;
}

export interface IOptions {
  model?: string;
  endpointUrl?: string;
  requiresAuth?: boolean;
  authProvider?: AuthProvider;
  tokenPath?: string;
  oauthTokenPath?: string;
  proxy?: string;
  maxTokens?: number;
  temperature?: number;
  thinking?: IThinkingOptions;
  reasoningEffort?: ReasoningEffort;
  initialPrompt?: string;
}

export interface IChatPreset {
  preset_below: string;
  preset_tab: string;
  preset_right: string;
}

export interface IEditRange {
  kind: 'visual' | 'line';
  start: [number, number];
  end: [number, number];
}

export interface IChunk {
  type: 'content' | 'reasoning_content';
  content: string;
}
