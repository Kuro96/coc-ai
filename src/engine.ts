import { workspace, window } from 'coc.nvim';
import * as os from 'os';
import * as fs from 'fs';
import { TextDecoder } from 'util';
import axios, { AxiosResponse } from 'axios';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

import {
  IAPIOptions,
  ICodexAuthFile,
  IChunk,
  IEngineConfig,
  IMessage,
  IOpenAICodexToken,
  IOpenCodeAuthFile,
  IOAuthToken,
  IOptions,
  ReasoningEffort,
  IToken,
} from './interface';
import { AbortController, mergeDefault } from './utils';

const config = workspace.getConfiguration('coc-ai');
export const defaultEngineConfig = config.get<IEngineConfig>('global')!;
const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';
const OPENAI_CODEX_DEFAULT_TOKEN_PATH = '~/.opencode/auth/openai.json';
const OPENAI_OPENCODE_TOKEN_PATH = '~/.local/share/opencode/auth.json';
const OPENAI_CODEX_FALLBACK_TOKEN_PATH = '~/.codex/auth.json';

function expandHome(filePath: string) {
  return filePath.replace(/^~/, os.homedir());
}

function needsDeepSeekReasoningEffortMapping(config: IEngineConfig) {
  if (isOpenAICodex(config)) return false;
  return (
    config.model.startsWith('deepseek-') ||
    config.endpointUrl.includes('api.deepseek.com')
  );
}

function supportsThinkingMode(config: IEngineConfig) {
  return needsDeepSeekReasoningEffortMapping(config);
}

function normalizeReasoningEffort(
  config: IEngineConfig,
  effort: ReasoningEffort,
) {
  if (!needsDeepSeekReasoningEffortMapping(config)) {
    return effort === 'max' ? 'xhigh' : effort;
  }
  if (effort === 'xhigh' || effort === 'max') return 'max';
  return 'high';
}

function supportsReasoningContent(config: IEngineConfig) {
  return supportsThinkingMode(config);
}

function normalizeMessages(config: IEngineConfig, messages: IMessage[]) {
  if (supportsReasoningContent(config)) return messages;
  return messages.map(({ reasoning_content, ...message }) => message);
}

function isOpenAICodex(config: IEngineConfig) {
  return config.authProvider === 'openai-codex';
}

function decodeJWT(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getChatGPTAccountId(accessToken: string) {
  const decoded = decodeJWT(accessToken);
  return (
    decoded?.chatgpt_account_id ||
    decoded?.[OPENAI_AUTH_CLAIM]?.chatgpt_account_id ||
    decoded?.organizations?.[0]?.id
  );
}

function getJWTExpiration(accessToken: string) {
  const decoded = decodeJWT(accessToken);
  return typeof decoded?.exp === 'number' ? decoded.exp * 1000 : undefined;
}

function getCodexIdTokenAccountId(authFile: ICodexAuthFile) {
  const idToken = authFile.tokens?.id_token;
  if (typeof idToken === 'string') return getChatGPTAccountId(idToken);
  return idToken?.chatgpt_account_id || (idToken?.raw_jwt && getChatGPTAccountId(idToken.raw_jwt));
}

function toCodexRole(role: IMessage['role']) {
  if (role === 'system') return 'developer';
  if (role === 'include') return 'user';
  return role;
}

function buildCodexRequest(data: IAPIOptions) {
  return {
    model: data.model,
    input: data.messages.map((message) => ({
      role: toCodexRole(message.role),
      content: message.content,
    })),
    stream: true,
    store: false,
    ...(data.reasoning_effort && {
      reasoning: { effort: data.reasoning_effort === 'max' ? 'xhigh' : data.reasoning_effort },
    }),
  };
}

export function buildAPIOptions(
  config: IEngineConfig,
  messages: IAPIOptions['messages'],
  stream: boolean,
): IAPIOptions {
  return {
    model: config.model,
    messages: normalizeMessages(config, messages),
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream,
    ...(supportsThinkingMode(config) &&
      config.thinking?.type && { thinking: config.thinking }),
    ...(config.reasoningEffort && {
      reasoning_effort: normalizeReasoningEffort(
        config,
        config.reasoningEffort,
      ),
    }),
  };
}

export class Engine {
  config: IEngineConfig;
  controller: AbortController;

  constructor(public configName: 'chat' | 'edit' | 'complete' | 'tab') {
    this.config = this.#initEngineConfig();
    this.controller = new AbortController();
  }

  /**
   * Merge and normalize: coc-ai.[name] & coc-ai.global
   */
  #initEngineConfig() {
    let specificConfig = config.get<Partial<IEngineConfig>>(this.configName)!;
    let engineConfig = mergeDefault(defaultEngineConfig, specificConfig);
    return this.#normalizeEngineConfig(engineConfig);
  }

  #normalizeEngineConfig(engineConfig: IEngineConfig): IEngineConfig {
    engineConfig.tokenPath = expandHome(engineConfig.tokenPath);
    engineConfig.oauthTokenPath = (
      engineConfig.oauthTokenPath || OPENAI_CODEX_DEFAULT_TOKEN_PATH
    ).replace(/^~/, os.homedir());
    return engineConfig;
  }

  mergeOptions(override: IOptions = {}) {
    // 1. chat options 2. role options
    if (!Object.keys(override).length) return this.config;
    let mergedConfig = mergeDefault(this.config, override);
    return this.#normalizeEngineConfig(mergedConfig);
  }

  get token(): IToken {
    let apiKeyParamValue: string = '';
    try {
      apiKeyParamValue = fs.readFileSync(this.config.tokenPath, 'utf-8');
    } catch (error) {}
    if (!apiKeyParamValue) {
      throw new Error('Missing API key');
    }

    const elements = apiKeyParamValue.trim().split(',');
    const apiKey = elements[0].trim();
    const orgId = elements.length > 1 ? elements[1].trim() : null;
    return { apiKey, orgId };
  }

  get oauthToken(): IOpenAICodexToken {
    const defaultTokenPath = expandHome(OPENAI_CODEX_DEFAULT_TOKEN_PATH);
    const configuredTokenPath = this.config.oauthTokenPath!;
    const openCodeTokenPath = expandHome(OPENAI_OPENCODE_TOKEN_PATH);
    const fallbackTokenPath = fs.existsSync(openCodeTokenPath)
      ? openCodeTokenPath
      : expandHome(OPENAI_CODEX_FALLBACK_TOKEN_PATH);
    const tokenPath =
      configuredTokenPath === defaultTokenPath && !fs.existsSync(configuredTokenPath)
        ? fallbackTokenPath
        : configuredTokenPath;
    let rawToken = '';
    try {
      rawToken = fs.readFileSync(tokenPath, 'utf-8');
    } catch (error) {}
    if (!rawToken) {
      throw new Error(`Missing OpenAI Codex OAuth token at ${tokenPath}`);
    }
    const authFile = JSON.parse(rawToken) as
      | ICodexAuthFile
      | IOpenCodeAuthFile
      | IOAuthToken;
    if ('openai' in authFile && authFile.openai?.type === 'oauth') {
      return {
        access: authFile.openai.access,
        refresh: authFile.openai.refresh,
        path: tokenPath,
        expires: authFile.openai.expires || getJWTExpiration(authFile.openai.access),
        accountId: authFile.openai.accountId || getChatGPTAccountId(authFile.openai.access),
        openCodeAuthFile: authFile,
      };
    }
    if ('tokens' in authFile && authFile.tokens?.access_token && authFile.tokens.refresh_token) {
      return {
        access: authFile.tokens.access_token,
        refresh: authFile.tokens.refresh_token,
        path: tokenPath,
        expires: getJWTExpiration(authFile.tokens.access_token),
        accountId:
          authFile.tokens.account_id ||
          getCodexIdTokenAccountId(authFile) ||
          getChatGPTAccountId(authFile.tokens.access_token),
        authFile,
      };
    }
    const token = authFile as IOAuthToken;
    if (token.type !== 'oauth' || !token.access || !token.refresh) {
      throw new Error(`Invalid OpenAI Codex OAuth token at ${tokenPath}`);
    }
    return {
      access: token.access,
      refresh: token.refresh,
      path: tokenPath,
      expires: token.expires,
      accountId: getChatGPTAccountId(token.access),
    };
  }

  async #refreshOAuthToken(token: IOpenAICodexToken) {
    const httpAgent = this.config.proxy
      ? new HttpProxyAgent(this.config.proxy)
      : null;
    const httpsAgent = this.config.proxy
      ? new HttpsProxyAgent(this.config.proxy)
      : null;
    let response: AxiosResponse<{
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    }>;
    try {
      response = await axios({
        method: 'post',
        url: OPENAI_CODEX_TOKEN_URL,
        data: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: token.refresh,
          client_id: OPENAI_CODEX_CLIENT_ID,
        }),
        headers: { 'Content-Type': 'application/json' },
        httpAgent,
        httpsAgent,
        timeout: this.config.requestTimeout * 1000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to refresh OpenAI Codex OAuth token: ${message}`);
    }
    if (response.status !== 200) throw new Error('Failed to refresh OpenAI Codex OAuth token');
    const data = response.data;
    if (!data.access_token) {
      throw new Error('Invalid OpenAI Codex OAuth refresh response');
    }
    const refreshed: IOpenAICodexToken = {
      access: data.access_token || token.access,
      refresh: data.refresh_token || token.refresh,
      expires: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : data.access_token
          ? getJWTExpiration(data.access_token)
          : token.expires,
      path: token.path,
    };
    if (token.authFile?.tokens) {
      token.authFile.tokens.access_token = refreshed.access;
      token.authFile.tokens.refresh_token = refreshed.refresh;
      if (data.id_token) token.authFile.tokens.id_token = data.id_token;
      refreshed.accountId =
        token.authFile.tokens.account_id ||
        getCodexIdTokenAccountId(token.authFile) ||
        getChatGPTAccountId(refreshed.access);
      token.authFile.last_refresh = new Date().toISOString();
      fs.writeFileSync(token.path, JSON.stringify(token.authFile, null, 2), {
        mode: 0o600,
      });
    } else if (token.openCodeAuthFile?.openai) {
      token.openCodeAuthFile.openai.access = refreshed.access;
      token.openCodeAuthFile.openai.refresh = refreshed.refresh;
      token.openCodeAuthFile.openai.expires = refreshed.expires;
      token.openCodeAuthFile.openai.accountId =
        token.openCodeAuthFile.openai.accountId ||
        getChatGPTAccountId(refreshed.access);
      refreshed.accountId = token.openCodeAuthFile.openai.accountId;
      fs.writeFileSync(token.path, JSON.stringify(token.openCodeAuthFile, null, 2), {
        mode: 0o600,
      });
    } else {
      const legacyToken: IOAuthToken = {
        type: 'oauth',
        access: refreshed.access,
        refresh: refreshed.refresh,
        expires: refreshed.expires || Date.now(),
      };
      refreshed.accountId = getChatGPTAccountId(refreshed.access);
      fs.writeFileSync(token.path, JSON.stringify(legacyToken, null, 2), {
        mode: 0o600,
      });
    }
    fs.chmodSync(token.path, 0o600);
    return refreshed;
  }

  async #getOAuthToken() {
    const token = this.oauthToken;
    if (!token.expires || token.expires > Date.now() + 60_000) return token;
    return await this.#refreshOAuthToken(token);
  }

  async #headers() {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!this.config.requiresAuth) return headers;
    if (!isOpenAICodex(this.config)) {
      headers.Authorization = `Bearer ${this.token.apiKey}`;
      if (this.token.orgId) headers['OpenAI-Organization'] = this.token.orgId;
      return headers;
    }
    const token = await this.#getOAuthToken();
    const accountId = token.accountId || getChatGPTAccountId(token.access);
    if (!accountId) throw new Error('Failed to extract ChatGPT account id from OAuth token');
    headers.Authorization = `Bearer ${token.access}`;
    headers['chatgpt-account-id'] = accountId;
    headers['OpenAI-Beta'] = 'responses=experimental';
    headers.originator = 'codex_cli_rs';
    headers.accept = 'text/event-stream';
    return headers;
  }

  async #makeRequest(requestConfig: IEngineConfig, data: IAPIOptions) {
    this.config = requestConfig;
    const headers = await this.#headers();
    const isCodex = isOpenAICodex(this.config);
    const body = JSON.stringify(isCodex ? buildCodexRequest(data) : data);
    const httpAgent = this.config.proxy
      ? new HttpProxyAgent(this.config.proxy)
      : null;
    const httpsAgent = this.config.proxy
      ? new HttpsProxyAgent(this.config.proxy)
      : null;

    if (!this.controller.signal.aborted) this.controller.abort();
    this.controller = new AbortController();
    let timeout = setTimeout(() => {
      this.controller.abort();
    }, this.config.requestTimeout * 1000);

    let resp: AxiosResponse;
    try {
      resp = await axios({
        method: 'post',
        url: isCodex ? OPENAI_CODEX_ENDPOINT : this.config.endpointUrl,
        data: body,
        headers,
        httpAgent,
        httpsAgent,
        signal: this.controller.signal,
        timeout: this.config.requestTimeout * 1000,
        responseType: isCodex || data.stream ? 'stream' : 'json',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`coc-ai request failed: ${message}`);
      throw new Error(`coc-ai request failed: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
    if (resp.status !== 200) {
      window.showErrorMessage(`HTTPError ${resp.status}: ${resp.statusText}`);
    }
    return resp;
  }

  async execute(
    requestConfig: IEngineConfig,
    data: IAPIOptions,
  ): Promise<string> {
    const resp = await this.#makeRequest(requestConfig, data);
    if (isOpenAICodex(requestConfig)) return await this.#collectStream(resp);
    const choice = resp.data.choices?.[0];
    if (!choice) return '';
    if (choice.message?.content) return choice.message.content;
    return '';
  }

  #parseLine(line: string) {
    const parsed = JSON.parse(line);
    let chunk: IChunk;
    if (typeof parsed.delta === 'string') {
      if (parsed.type?.includes('reasoning')) {
        return { type: 'reasoning_content', content: parsed.delta };
      }
      return { type: 'content', content: parsed.delta };
    }
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return { type: 'content', content: '' };
    if (typeof delta.reasoning_content === 'string') {
      chunk = {
        type: 'reasoning_content',
        content: delta.reasoning_content,
      };
    } else if (typeof delta.content === 'string') {
      chunk = {
        type: 'content',
        content: delta.content,
      };
    } else {
      chunk = { type: 'content', content: '' };
    }
    return chunk;
  }

  async #collectStream(resp: AxiosResponse) {
    let result = '';
    for await (const chunk of this.#streamChunks(resp)) {
      if (chunk.type === 'content') result += chunk.content;
    }
    return result;
  }

  async *#streamChunks(resp: AxiosResponse) {
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let dataLines: string[] = [];

    const parseEvent = (lines: string[]) => {
      if (!lines.length) return null;
      const payload = lines.join('\n');
      if (payload === '[DONE]') return null;
      return this.#parseLine(payload);
    };

    for await (const value of resp.data) {
      if (this.controller.signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      let lineEnd = buffer.indexOf('\n');
      while (lineEnd !== -1) {
        let line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          const chunk = parseEvent(dataLines);
          if (chunk) yield chunk;
          dataLines = [];
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
        lineEnd = buffer.indexOf('\n');
      }
    }
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice('data:'.length).trimStart());
    const chunk = parseEvent(dataLines);
    if (chunk) yield chunk;
  }

  async *generate(requestConfig: IEngineConfig, data: IAPIOptions) {
    const resp = await this.#makeRequest(requestConfig, data);
    yield* this.#streamChunks(resp);
  }
}
