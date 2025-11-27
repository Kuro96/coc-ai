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
}

export interface IToken {
  apiKey: string;
  orgId: string | null;
}

export interface IAPIOptions {
  model: string;
  messages: IMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface IEngineConfig {
  model: string;
  endpointUrl: string;
  proxy: string;
  maxTokens: number;
  temperature: number;
  requestTimeout: number;
  requiresAuth: boolean;
  initialPrompt: string;
  tokenPath: string;
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
  tokenPath?: string;
  proxy?: string;
  maxTokens?: number;
  temperature?: number;
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
