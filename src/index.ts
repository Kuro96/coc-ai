import path from 'path';
import { commands, ExtensionContext, workspace } from 'coc.nvim';

import { AIChats, hideChat } from './aichat';
import { AIEdit } from './aiedit';
import { getRoles } from './roles';

const config = workspace.getConfiguration('coc-ai');
const { nvim } = workspace;

export async function activate(context: ExtensionContext) {
  const enabled = config.get<boolean>('enabled', true);
  if (!enabled) { return };
  const directory = path.resolve(__dirname, '..').replace(/'/g, "''");
  nvim.command(`execute 'noa set rtp+='.fnameescape('${directory}')`, true)
  nvim.command(`source ${directory}/plugin/*.vim`, true)
  console.debug('coc-ai loaded!');

  const aichats = new AIChats();
  const aiedit = new AIEdit();
  const aicomplete = new AIEdit('complete');
  context.subscriptions.push(
    commands.registerCommand('coc-ai.chat', async (selection: string, rawPrompt: string) => {
      const bufList = await nvim.call('tabpagebuflist') as number[];
      const bufnr = bufList.filter(x => aichats.includes(x)).pop();
      const aichat = await aichats.getChat({ bufnr, init: bufnr ? false : true });
      await aichat.run(selection, rawPrompt);
    }),
    commands.registerCommand('coc-ai.newChat', async (selection: string, rawPrompt: string) => {
      const aichat =await aichats.newChat();
      await aichat.run(selection, rawPrompt);
    }),
    commands.registerCommand('coc-ai.edit', async (selection: string, rawPrompt: string, range?: any) => {
      await aiedit.run(selection, rawPrompt, range);
    }),
    commands.registerCommand('coc-ai.editApply', async () => {
      await aiedit.apply();
    }),
    commands.registerCommand('coc-ai.editClose', async () => {
      await aiedit.close();
    }),
    commands.registerCommand('coc-ai.complete', async (selection: string, rawPrompt: string) => {
      const linenr = await nvim.call('line', '.');
      await aicomplete.run(selection, rawPrompt);
      await nvim.command(`normal! ${linenr}G$`);
      nvim.redrawVim();
    }),
    commands.registerCommand('coc-ai.attachChat', async() => {
      const name = await nvim.call('bufname', '%');
      await aichats.newChat(name);
    }),
    commands.registerCommand('coc-ai.show', async () => {
      await aichats.getChat({ init: true });
    }),
    commands.registerCommand('coc-ai.stop', async () => {
      aichats.getChat({}) // Assume we always interrupt the most recent one
        .then(chat => chat.abort())
        .catch(e => console.error(e));
    }),
    commands.registerCommand('coc-ai.roleComplete', () => {
      return Object.keys(getRoles() ?? {});
    }),
    workspace.registerAutocmd({
      event: 'BufWinLeave',
      pattern: '>>>?AI?chat*',
      callback: async () => { await hideChat(aichats) },
    }),
  );
}
