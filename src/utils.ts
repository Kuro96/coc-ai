import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'fast-glob';
import { workspace, window } from 'coc.nvim';
import { transferableAbortController } from 'util';
import { IMessage } from './interface';

const { nvim } = workspace;

// Workaround: Unable to acquire native controller directly
const controller = transferableAbortController();
export const AbortController = controller.constructor as typeof globalThis.AbortController;

export const CHAT_TABLE = 'chat-options';
export const REASON_START = '<think>';
export const REASON_FINISH = '</think>';

export class KnownError extends Error {}

export async function breakUndoSequence() {
  await nvim.command('let &ul=&ul');
}

export function mergeDefault<T>(defaultConfig: T, updates: Partial<T>): T {
  const isObject = (obj: any): obj is object => obj && typeof obj === 'object' && !Array.isArray(obj);
  const merge = (target: any, source: any): any => {
    if (isObject(target) && isObject(source)) {
      for (const key in source) {
        if (source.hasOwnProperty(key)) {
          if (isObject(source[key])) {
            if (!target[key]) Object.assign(target, { [key]: {} });
            merge(target[key], source[key]);
          } else {
            if (key.includes('rompt') || source[key] !== '') {
              target[key] = source[key];
            }
          }
        }
      }
    }
    return target;
  };

  const cleanedConfig = JSON.parse(JSON.stringify(defaultConfig));
  return merge(cleanedConfig, updates);
}

export function resolveIncludeMessage(message: IMessage) {
  message.role = 'user';
  let paths: Array<string|null> = message.content.split('\n');
  message.content = '';
  const pwd = workspace.root;
  for (const i in paths) {
    if (!paths[i]) continue;
    let p = path.resolve(paths[i]);
    if (!path.isAbsolute(p)) {
      p = path.join(pwd, p);
    }
    if (p.includes('**')) {
      paths[i] = null;
      paths.push(...glob.sync(p));
    }
  }
  for (const p of paths.filter(p => p !== null)) {
    if (fs.lstatSync(p).isDirectory()) continue;
    try {
      message.content += `\n\n==> ${p} <==\n` + fs.readFileSync(p, 'utf-8');
    } catch (error) {
      message.content += `\n\n==> ${p} <==\nBinary file, cannot display`;
    }
  }
  return message
}

export function handleCompletionError(error: Error) {
  if (error instanceof KnownError) {
    window.showInformationMessage(error.message, 'error');
  } else if (error.name === 'AbortError') {
    window.showInformationMessage('Request timeout...', 'error');
  } else if (error.name === 'FetchError') {
    window.showInformationMessage(`HTTPError ${error.message}`, 'error');
  } else {
    throw error;
  }
}

export function sleep(interval: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, interval);
  })
}

export async function moveToBottom(bufnr: number) {
  const winid: number = await nvim.call('bufwinid', bufnr);
  await nvim.call('win_execute', [winid, 'normal! G$']);
}

export async function moveToLineEnd(bufnr: number, line?: number) {
  const winid: number = await nvim.call('bufwinid', bufnr);
  const cmd = line ? `normal! ${line}G$` : 'normal!$';
  await nvim.call('win_execute', [winid, cmd]);
}

export async function setBufferLines(bufnr: number, lines: string[]) {
  if (workspace.isNvim) {
    await nvim.call('nvim_buf_set_lines', [bufnr, 0, -1, false, lines]);
  } else {
    await nvim.call('deletebufline', [bufnr, 1, '$']);
    await nvim.call('setbufline', [bufnr, 1, lines]);
  }
}

export async function getBufferLines(bufnr: number): Promise<string[]> {
  if (workspace.isNvim) {
    return await nvim.call('nvim_buf_get_lines', [bufnr, 0, -1, false]) as string[];
  }
  return await nvim.call('getbufline', [bufnr, 1, '$']) as string[];
}
