import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'fast-glob';
import { workspace, window } from 'coc.nvim';
import { transferableAbortController } from 'util';

const { nvim } = workspace;

// Workaround: Unable to acquire native controller directly
const controller = transferableAbortController();
export const AbortController = controller.constructor as typeof globalThis.AbortController;

export const ReasonStart = '---reason start---';
export const ReasonFinish = '---reason finish---';

export class KnownError extends Error {}

export async function breakUndoSequence() {
  await nvim.command('let &ul=&ul');
}

export function mergeDefault<T>(defaultConfig: T, updates: Partial<T>): T {
  const cleanedConfig = Object.keys(updates).reduce((cfg, key) => {
    const value = updates[key as keyof T];
    if (value !== '') cfg[key] = value; // not override in case of prompt or something alike
    return cfg;
  }, JSON.parse(JSON.stringify(defaultConfig)));
  return cleanedConfig;
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
