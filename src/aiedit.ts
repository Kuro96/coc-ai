import { workspace, Disposable } from 'coc.nvim';

import { IAPIOptions, IEngineConfig, IMessage } from './interface';
import { Engine } from './engine';
import { Task } from './task';
import { parseTaskRole } from './roles';
import { breakUndoSequence } from './utils';

const { nvim } = workspace;

export class AIEdit implements Task, Disposable {
  config: IEngineConfig;
  bufnr: number = -1;
  linenr: number = -1;
  currLine = '';
  #engine: Engine;

  constructor(public task: 'edit'|'complete' = 'edit') {
    this.#engine = new Engine(task);
    this.config = this.#engine.config;
  }

  get engine(): Engine { return this.#engine }

  async run(selection: string, rawPrompt: string) {
    this.bufnr = await nvim.call('bufnr', '%');
    this.linenr = await nvim.call('line', '.');
    this.currLine = await nvim.call('getline', '.');

    const sep = selection === '' || rawPrompt === '' ? '' : ':\n';
    let { prompt, options } = parseTaskRole(rawPrompt, this.task);
    prompt = prompt + sep + selection;  // role.prompt + user prompt + selection

    let mergedConfig = this.engine.mergeOptions(options); // in case no options offerd
    let messages: IMessage[] = [{role: "system", content: mergedConfig.initialPrompt}];
    if (prompt) messages.push({ role: "user", content: prompt });
    const data: IAPIOptions = {
      model: mergedConfig.model,
      messages: messages,
      max_tokens: mergedConfig.maxTokens,
      temperature: mergedConfig.temperature,
      stream: true,
    }

    let resp = this.engine.generate(mergedConfig, data)
    let reasonBlock = '';
    for await (const chunk of resp) {
      if (chunk.type === 'reasoning_content') {
        reasonBlock += chunk.content.replace(/\n/g, ' ');
        await nvim.call('setbufline', [this.bufnr, this.linenr, `"""${reasonBlock}"""`]);
        nvim.redrawVim();
      } else {
        if (reasonBlock) {
          await this.breakUndoSequence();
          reasonBlock = '';
        }
        this.append(chunk.content);
        this.currLine = await nvim.call('getline', '.');
      }
    }
    await this.breakUndoSequence();
  };

  append(value: string) {
    const newlines = value.split(/\r?\n/);
    const lastline = this.currLine + newlines[0];
    const append = newlines.slice(1);
    nvim.pauseNotification();
    nvim.call('setbufline', [this.bufnr, this.linenr, lastline], true);
    if (append.length) {
      nvim.call('appendbufline', [this.bufnr, this.linenr, append], true);
      this.linenr += append.length;
    }
    nvim.command(`normal! ${this.linenr}G$`, true);
    nvim.resumeNotification(true, true);
  }

  async breakUndoSequence() {
    const currBufnr = await nvim.call('bufnr', '%');
    if (currBufnr != this.bufnr) {
      const winid: number = await nvim.call('bufwinid', this.bufnr);
      await nvim.call('win_gotoid', winid);
    }
    await breakUndoSequence();
    if (currBufnr != this.bufnr) {
      const currWinid = await nvim.call('bufwinid', '%');
      await nvim.call('win_gotoid', currWinid);
    }
  }

  dispose() {}
}
