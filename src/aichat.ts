import { events, window, workspace, Disposable } from 'coc.nvim';
import * as toml from '@iarna/toml';

import {
  IAPIOptions,
  IChatPreset,
  IEngineConfig,
  IMessage,
  IOptions,
} from './interface';
import { Engine } from './engine';
import { Task } from './task';
import { parseTaskRole } from './roles';
import {
  breakUndoSequence,
  moveToBottom,
  moveToLineEnd,
  resolveIncludeMessage,
  CHAT_TABLE,
  REASON_START,
  REASON_FINISH,
} from './utils';

const { nvim } = workspace;

const chatPreset: IChatPreset = {
  preset_below: 'below new {}',
  preset_tab: 'tabnew {}',
  preset_right:
    'rightbelow 55vnew {} | setlocal noequalalways | setlocal winfixwidth',
};

export class AIChats implements Disposable {
  capacity: number;
  #chats: Map<number, AIChat>;
  #bufnrs: Array<number>;
  #nextIndex: number;
  #disposable: Disposable;

  constructor(capacity: number = 10) {
    this.capacity = capacity;
    this.#nextIndex = 1;
    this.#bufnrs = new Array();
    this.#chats = new Map();

    this.#disposable = events.on('BufUnload', (bufnr) => {
      this.#removeChat(bufnr);
    });
  }

  /**
   * Updates the chat in the internal buffer and chat collections.
   * If the chat already exists in the buffer list, it moves it to the end.
   * Otherwise, it adds the chat to the chat map and buffer list.
   *
   * @param {AIChat} chat - The chat object to update.
   */
  #updateChat(chat: AIChat) {
    const i = this.#bufnrs.indexOf(chat.bufnr);
    if (i !== -1) {
      this.#bufnrs.splice(i, 1);
    }
    this.#chats.set(chat.bufnr, chat);
    this.#bufnrs.push(chat.bufnr);
  }

  #removeChat(bufnr: number) {
    const i = this.#bufnrs.indexOf(bufnr);
    if (i !== -1) {
      this.#chats.delete(bufnr);
      this.#bufnrs.splice(i, 1);
    }
  }

  includes(bufnr: number) {
    return this.#bufnrs.includes(bufnr);
  }

  async getChat({
    bufnr,
    init = false,
  }: {
    bufnr?: number;
    init?: boolean;
  }): Promise<AIChat> {
    let chat: AIChat;
    if (bufnr !== undefined) {
      if (this.#chats.has(bufnr)) {
        chat = this.#chats.get(bufnr)!;
        if (init) chat.show();
        this.#updateChat(chat);
      } else {
        throw Error(`bufnr: ${bufnr} not registered in AIChats`);
      }
    } else {
      if (this.#bufnrs.length) {
        bufnr = this.#bufnrs[this.#bufnrs.length - 1];
        chat = this.#chats.get(bufnr)!;
        if (init) chat.show();
      } else {
        chat = await this.newChat();
      }
    }
    if (chat.bufnr === -1) {
      window.showErrorMessage(
        'Failed to associate AIChat with existing window, ' +
          'is there any AIChat created outside coc-ai?',
      );
    }

    return this.#chats.get(chat.bufnr)!;
  }

  async newChat(name?: string) {
    if (name === undefined) {
      name =
        this.#nextIndex === 1
          ? '>>> AI chat'
          : `>>> AI chat ${this.#nextIndex}`;
    }
    const chat = await AIChat.create(name);
    this.#nextIndex += 1;
    this.#updateChat(chat);
    return chat;
  }

  dispose(): void {
    this.#disposable.dispose();
    for (let chat of this.#chats.values()) {
      chat.dispose();
    }
    this.#chats.clear();
    this.#bufnrs.length = 0;
  }
}

export async function hideChat(aichats: AIChats) {
  const bufnr = (await nvim.call('bufnr', '%')) as number;
  try {
    (await aichats.getChat({ bufnr })).hide();
  } catch {}
}

export class AIChat implements Task, Disposable {
  created = false;
  lines: string[] = [''];
  config: IEngineConfig;
  #bufnr: number = -1;
  #engine: Engine;
  #autoScroll: boolean;
  #keepOpen: boolean;
  #openChatCMD: string;
  #populatesOptions: boolean;
  #codeSyntaxEnabled: boolean;
  #autoTitle: boolean;

  constructor(public name = '>>> AI chat') {
    this.#engine = new Engine('chat');
    this.config = this.#engine.config;
    this.#autoScroll = this.config.autoScroll!;
    this.#keepOpen = this.config.scratchBufferKeepOpen!;
    this.#openChatCMD = this.config.openChatCommand!;
    this.#populatesOptions = this.config.populatesOptions!;
    this.#codeSyntaxEnabled = this.config.codeSyntaxEnabled!;
    this.#autoTitle = this.config.autoTitle ?? false;
  }

  static async create(name = '>>> AI chat') {
    const chat = new AIChat(name);
    await chat.show();
    return chat;
  }

  async parseContent() {
    const indexHeaderEnd = await this.#getRoleLineIndex(); // starts from 0
    const chatOptions = await this.#parseChatHeaderOptions(indexHeaderEnd);
    const indexMsgStart = indexHeaderEnd + 1;
    const messages = await this.#parseChatMessages(indexMsgStart);
    if (this.#populatesOptions && indexHeaderEnd === 0) this.populateOptions();

    return { messages, chatOptions };
  }

  async initializeIfEmpty() {
    if (!this.#populatesOptions) return;
    const lines = await nvim.call('getbufline', [this.name, 1, '$']);
    if (lines.length <= 1 && lines[0].trim() === '') {
      await this.populateOptions();
    }
  }

  async populateOptions() {
    let options: IOptions = {
      model: this.engine.config.model,
      endpointUrl: this.engine.config.endpointUrl,
      requiresAuth: this.engine.config.requiresAuth,
      tokenPath: this.engine.config.tokenPath,
      proxy: this.engine.config.proxy,
      maxTokens: this.engine.config.maxTokens,
      temperature: this.engine.config.temperature,
      initialPrompt: this.engine.config.initialPrompt,
    };
    let headers = toml.stringify(options as any).split('\n');
    headers.unshift(`[${CHAT_TABLE}]`);
    await nvim.call('appendbufline', [this.name, 0, headers]);
  }

  async #generateTitle(messages: IMessage[]) {
    const prompt =
      'Summarize the following conversation into a short title (max 5 words). Do not use quotes. Do not use any intro or outro.';
    const titleMessages: IMessage[] = [
      ...messages,
      { role: 'user', content: prompt },
    ];

    const requestData: IAPIOptions = {
      model: this.engine.config.model,
      messages: titleMessages,
      max_tokens: 50,
      temperature: 0.7,
      stream: false,
    };

    try {
      let title = await this.engine.execute(this.engine.config, requestData);
      title = title.trim().replace(/["']/g, '').replace(/\n/g, ' ');
      if (title) {
        const newName = `>>> AI chat: ${title}`;
        await nvim.command(`keepalt file ${newName.replace(/\s/g, '\\ ')}`);
        this.name = newName;
      }
    } catch (e) {
      // Ignore title generation errors
    }
  }

  async run(selection: string, rawPrompt: string) {
    const sep = selection === '' || rawPrompt === '' ? '' : ':\n';
    let { prompt, options } = parseTaskRole(rawPrompt, 'chat');
    prompt = prompt + sep + selection; // role.prompt + user prompt + selection

    const { messages, chatOptions } = await this.parseContent();
    this.syncLines();
    let lastMessage = messages.pop();
    if (lastMessage) {
      if (lastMessage.role !== 'user') {
        messages.push(lastMessage);
        await this.appendBlock('>>> user');
      } else if (lastMessage.content.trim() !== '') {
        messages.push(lastMessage);
      }
    } else {
      await this.appendBlock('>>> user');
    }

    if (prompt) messages.push({ role: 'user', content: prompt });
    if (messages[messages.length - 1].role !== 'user') {
      window.showInformationMessage(
        'No new incoming user message found, skipped.',
      );
      this.breakUndoSequence();
      return;
    }
    if (prompt) await this.appendBlock(prompt);

    let mergedConfig: IEngineConfig;
    if (chatOptions) mergedConfig = this.engine.mergeOptions(chatOptions);
    mergedConfig = this.engine.mergeOptions(options); // in case no options offerd

    messages.unshift({ role: 'system', content: mergedConfig.initialPrompt });
    const data: IAPIOptions = {
      model: mergedConfig.model,
      messages: messages,
      max_tokens: mergedConfig.maxTokens,
      temperature: mergedConfig.temperature,
      stream: true,
    };

    let resp = this.engine.generate(mergedConfig, data);
    await this.appendBlock('<<< assistant');
    let isReasoning = false;
    let fullResponse = '';
    try {
      for await (const chunk of resp) {
        if (chunk.type === 'reasoning_content') {
          if (!isReasoning) {
            await this.appendBlock(REASON_START);
            isReasoning = true;
          }
          this.append(chunk.content);
        } else {
          if (isReasoning) {
            await this.appendBlock(REASON_FINISH);
            isReasoning = false;
          }
          this.append(chunk.content);
          fullResponse += chunk.content;
        }
      }
      if (isReasoning) {
        await this.appendBlock(REASON_FINISH);
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) throw e;
    } finally {
      await this.appendBlock('>>> user');
      await this.breakUndoSequence();

      // Auto-title if enabled and likely the first turn (default name)
      if (
        this.#autoTitle &&
        this.name.match(/^>>> AI chat( \d+)?$/) &&
        messages.length <= 3 // system + user + assistant (we just added assistant)
      ) {
        // We need the assistant's response in the messages for the summary
        // The 'messages' array currently has system + user. We need to append the assistant response.
        const historyForTitle: IMessage[] = [
          ...messages.filter((m) => m.role !== 'system'), // Exclude system prompt for shorter context? Or keep it. Let's exclude to save tokens/focus on topic.
          { role: 'assistant', content: fullResponse },
        ];
        // Run asynchronously
        this.#generateTitle(historyForTitle);
      }
    }
  }

  get engine(): Engine {
    return this.#engine;
  }

  get bufnr() {
    return this.#bufnr;
  }

  set bufnr(value: number) {
    this.#bufnr = value;
  }

  append(value: string) {
    let idx = this.lines.length - 1;
    let newlines = value.split(/\r?\n/);
    let lastline = this.lines[idx] + newlines[0];
    this.lines[idx] = lastline;
    let append = newlines.slice(1);
    this.lines = this.lines.concat(append);
    if (!this.created) return;
    nvim.pauseNotification();
    nvim.call('setbufline', [this.name, '$', lastline], true);
    if (append.length) {
      nvim.call('appendbufline', [this.name, '$', append], true);
      if (this.#autoScroll) moveToBottom(this.bufnr);
    } else {
      if (this.#autoScroll) moveToLineEnd(this.bufnr);
    }
    nvim.resumeNotification(true, true);
  }

  async appendBlock(value: string) {
    // too expensive for `getbufline(this.name, line('$', bufwinid(this.bufnr))-1, '$')`
    if ((await nvim.call('getbufoneline', [this.name, '$'])) && value) {
      this.append('\n\n');
    }
    this.append(value + '\n\n');
  }

  async #getRoleLineIndex() {
    let lines: string[] = await nvim.call('getbufline', [this.name, 1, '$']);
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('>>>')) {
        idx = i;
        break;
      }
    }
    return idx;
  }

  async #parseChatHeaderOptions(end: number | null) {
    try {
      let lines: string[] = await nvim.call('getbufline', [
        this.name,
        1,
        end ?? '$',
      ]);
      const options: IOptions = toml.parse(lines.join('\n'));
      return options;
    } catch (error) {
      window.showInformationMessage('Invalid [chat-options]', 'error');
    }
  }

  async #parseChatMessages(start: number | null) {
    const lines: string[] = await nvim.call('getbufline', [
      this.name,
      start ?? 1,
      '$',
    ]);
    let messages: IMessage[] = [];
    let isReasoning = false;
    for (const line of lines) {
      if (line.startsWith('>>> system')) {
        messages.push({ role: 'system', content: '' });
        continue;
      }
      if (line.startsWith('>>> user')) {
        messages.push({ role: 'user', content: '' });
        continue;
      }
      if (line.startsWith('>>> include')) {
        messages.push({ role: 'include', content: '' });
        continue;
      }
      if (line.startsWith('<<< assistant')) {
        messages.push({ role: 'assistant', content: '' });
        continue;
      }
      if (!messages.length) continue;
      if (line.trim() === REASON_START) isReasoning = true;
      if (line.trim() === REASON_FINISH) {
        isReasoning = false;
        continue;
      }
      if (isReasoning) continue;
      messages[messages.length - 1].content += '\n' + line;
    }

    for (const message of messages) {
      message.content = message.content.trim();
      if (message.role === 'include') resolveIncludeMessage(message);
    }
    return messages;
  }

  clearContents(keep?: number): void {
    this.lines = keep ? this.lines.slice(-keep) : [''];
    if (!this.created) return;
    nvim.pauseNotification();
    nvim.call('deletebufline', [this.name, 1, '$'], true);
    if (this.lines.length) {
      nvim.call('appendbufline', [this.name, '$', this.lines], true);
    }
    nvim.resumeNotification(true, true);
  }

  /*  If not keep open, clear AIChat contents. */
  hide() {
    if (!this.#keepOpen) {
      this.abort();
      this.clearContents();
      this.created = false;
    }
  }

  async #tryResumeWindow() {
    const winid: number = await nvim.call('bufwinid', [this.name]);
    if (winid !== -1) {
      await nvim.call('win_gotoid', winid);
      if (this.#bufnr === -1) {
        return 'detached';
      } else {
        return 'attached';
      }
    }
    return false;
  }

  /**
   * Create or resume the chat window, keeping synced with buffer.
   * @param preserveFocus - If true, the focus will be preserved on the current window after showing the chat window.
   * @param cmd - The command to use for displaying the chat window. Defaults to 'preset_below'.
   */
  async show(preserveFocus?: boolean) {
    const isChat =
      (await nvim.call('bufname', '%')) === this.name ? true : false;
    preserveFocus = preserveFocus ?? this.config.preserveFocus!;
    const status = await this.#tryResumeWindow();
    if (!status) {
      const command =
        this.#openChatCMD in chatPreset
          ? chatPreset[this.#openChatCMD].replace(/{}/, this.name)
          : `${this.#openChatCMD} ${this.name}`;
      window.showInformationMessage(command);
      await nvim.command(command);

      this.bufnr = await nvim.call('bufnr', '%');

      if (!this.name.endsWith('.aichat')) {
        await nvim.command('setlocal buftype=nofile noswapfile ft=aichat');
        if (this.#keepOpen) {
          await nvim.command('setlocal bufhidden=hide');
        } else {
          await nvim.command('setlocal bufhidden=wipe');
        }
      }
      if (this.#codeSyntaxEnabled) {
        await nvim.call('setbufvar', [
          this.bufnr,
          'coc_ai_chat_syntax_enabled',
          1,
        ]);
      } else {
        await nvim.call('setbufvar', [
          this.bufnr,
          'coc_ai_chat_syntax_enabled',
          0,
        ]);
      }
      this.created = true;
    } else if (status === 'detached') {
      this.bufnr = await nvim.call('bufnr', '%');
      this.created = true;
    }

    this.syncLines();
    if (preserveFocus && !isChat) await nvim.command('wincmd p');
  }

  async syncLines() {
    const contents: string[] = await nvim.call('getbufline', [
      this.bufnr,
      1,
      '$',
    ]);
    this.lines = contents.length ? contents : [''];
  }

  async abort() {
    if (!this.#engine.controller.signal.aborted)
      this.#engine.controller.abort();
  }

  /**
   * Breaks the undo sequence in the current buffer.
   * NOTE: If the current buffer is not the target buffer, it temporarily switches to the target buffer,
   * breaks the undo sequence, and then returns to the original window.
   */
  async breakUndoSequence() {
    const currBufnr = await nvim.call('bufnr', '%');
    if (currBufnr != this.bufnr) await this.#tryResumeWindow();
    await breakUndoSequence();
    if (currBufnr != this.bufnr) {
      const currWinid = await nvim.call('bufwinid', currBufnr);
      await nvim.call('win_gotoid', currWinid);
    }
  }

  dispose() {}
}
