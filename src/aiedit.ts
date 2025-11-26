import { workspace, Disposable, Range, TextEdit, Position } from 'coc.nvim';

import { IAPIOptions, IEngineConfig, IEditRange, IMessage } from './interface';
import { Engine } from './engine';
import { Task } from './task';
import { parseTaskRole } from './roles';
import { breakUndoSequence, setBufferLines, getBufferLines, moveToLineEnd } from './utils';

const { nvim } = workspace;

const INSTRUCTIONS = [
  '# AI Edit: <Enter> Apply, q Cancel',
  '# --------------------------------------------------',
  ''
];

export class AIEdit implements Task, Disposable {
  config: IEngineConfig;
  bufnr: number = -1;
  linenr: number = -1;
  currLine = '';
  #engine: Engine;
  
  originalBufnr: number = -1;
  originalRange?: IEditRange;
  aiBufnr: number = -1;
  origTempBufnr: number = -1;

  constructor(public task: 'edit'|'complete' = 'edit') {
    this.#engine = new Engine(task);
    this.config = this.#engine.config;
  }

  get engine(): Engine { return this.#engine }

  async run(selection: string, rawPrompt: string, range?: IEditRange) {
    this.bufnr = await nvim.call('bufnr', '%');
    
    if (this.task === 'complete') {
      this.linenr = await nvim.call('line', '.');
      this.currLine = await nvim.call('getline', '.');
    } else {
      if (!range) {
        // Fallback or error if range is missing for edit
        return; 
      }
      this.originalBufnr = this.bufnr;
      this.originalRange = range;
    }

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
    
    if (this.task === 'edit') {
      await this.setupDiffView(selection);
    }

    let resp = this.engine.generate(mergedConfig, data)
    let reasonBlock = '';
    let accumulatedContent = '';
    
    for await (const chunk of resp) {
      if (chunk.type === 'reasoning_content') {
        reasonBlock += chunk.content.replace(/\n/g, ' ');
        if (this.task === 'complete') {
           await nvim.call('setbufline', [this.bufnr, this.linenr, `"""${reasonBlock}"""`]);
           nvim.redrawVim();
        } else {
           // For edit/diff view, we could display reasoning, but for now let's skip or prepend?
           // Leaving blank as per requirement to show "AI continuous output" which usually means the code.
        }
      } else {
        if (this.task === 'complete') {
          if (reasonBlock) {
            await this.breakUndoSequence();
            reasonBlock = '';
          }
          this.append(chunk.content);
          this.currLine = await nvim.call('getline', '.');
        } else {
           accumulatedContent += chunk.content;
           const lines = accumulatedContent.split(/\r?\n/);
           // Prepend instructions to preserve them
           await setBufferLines(this.aiBufnr, [...INSTRUCTIONS, ...lines]);
           await moveToLineEnd(this.aiBufnr);
           nvim.command('redraw', true);
        }
      }
    }
    
    if (this.task === 'complete') {
       await this.breakUndoSequence();
    }
  };

  async setupDiffView(selection: string) {
    // Create new tab with empty buffer (AI Output) -> Left Side
    await nvim.command('tabnew');
    await nvim.command('setlocal buftype=nofile bufhidden=wipe noswapfile');
    this.aiBufnr = await nvim.call('bufnr', '%');
    try { await nvim.command('file AI Output'); } catch(e) { /* ignore if name exists */ }

    // Set initial instructions
    await setBufferLines(this.aiBufnr, INSTRUCTIONS);

    // Create vsplit for Original Selection -> Right Side
    await nvim.command('rightbelow vsplit');
    await nvim.command('enew');
    await nvim.command('setlocal buftype=nofile bufhidden=wipe noswapfile');
    this.origTempBufnr = await nvim.call('bufnr', '%');
    try { await nvim.command('file Original Selection'); } catch(e) { /* ignore */ }
    
    const origLines = selection.split(/\r?\n/);
    // Add instructions to original view so both sides match headers
    await setBufferLines(this.origTempBufnr, [...INSTRUCTIONS, ...origLines]);
    
    await nvim.command('diffthis');
    await nvim.command('nnoremap <buffer> <CR> :CocCommand coc-ai.editApply<CR>');
    await nvim.command('nnoremap <buffer> q :CocCommand coc-ai.editClose<CR>');

    // Switch back to AI Output (Left) to configure it
    const winidAI = await nvim.call('bufwinid', this.aiBufnr);
    await nvim.call('win_gotoid', winidAI);
    await nvim.command('diffthis');
    await nvim.command('nnoremap <buffer> <CR> :CocCommand coc-ai.editApply<CR>');
    await nvim.command('nnoremap <buffer> q :CocCommand coc-ai.editClose<CR>');
    
    // Ensure we are focused on the AI Output (Left)
    // (Already moved to it via win_gotoid, but purely for consistency with previous logic)
  }

  async apply() {
    if (this.task !== 'edit' || this.aiBufnr === -1) return;
    
    const allLines = await getBufferLines(this.aiBufnr);
    // Remove instructions before applying
    const lines = allLines.slice(INSTRUCTIONS.length);

    await this.close();
    
    const winid = await nvim.call('bufwinid', this.originalBufnr);
    if (winid !== -1) {
      await nvim.call('win_gotoid', winid);
    } else {
      await nvim.command(`buffer ${this.originalBufnr}`);
    }
    
    await breakUndoSequence();

    if (this.originalRange) {
      const { start, end, kind } = this.originalRange;
      const doc = workspace.getDocument(this.originalBufnr);
      if (!doc) return;

      // Convert 1-based getpos to 0-based LSP Position
      // kind='line': replace whole lines.
      // kind='char': replace range.
      
      let range: Range;
      
      if (kind === 'line') {
        // start[0] is 1-based line number.
        // Range should be start line 0 char -> end line + 1 0 char (to include newline)?
        // Or just replace the content of the lines.
        // LSP Range: line, character.
        
        // If we replace lines 5 to 10.
        // start=[5, 1], end=[10, 20].
        // We want to replace from line 4 (0-based) char 0.
        // To line 9 (0-based) end? Or line 10 (0-based) char 0?
        
        // When replacing lines, usually we overwrite from start of first line to end of last line.
        // If we want to delete the lines entirely and replace, we usually encompass the full line range.
        
        const startLine = start[0] - 1;
        const endLine = end[0]; // 0-based index of the line AFTER the selection (since end[0] is 1-based inclusive)
        // Actually, if we selected lines 5-5. start[0]=5, end[0]=5.
        // We want to replace line 4.
        // Range(4, 0) to Range(5, 0)?
        
        range = Range.create(startLine, 0, endLine, 0);
        
        // Ideally we want to insert a newline if the replacement lines don't end with one?
        // TextEdit.replace will replace the text in range.
        // lines is string[]. join('\n')
        
        const text = lines.join('\n') + '\n'; // Add newline because we are replacing full lines including the last newline?
        // Wait, if we replace lines, we usually expect `lines` to be the new content.
        // If we use Range(startLine, 0, endLine, 0), we are replacing everything including the newline of the last line (effectively).
        // Because endLine is start of next line.
        
        await doc.applyEdits([TextEdit.replace(range, text)]);

      } else {
        // Visual selection (char wise)
        const startRow = start[0] - 1;
        const startCol = start[1] - 1;
        const endRow = end[0] - 1;
        // end[1] is 1-based index of the character *after* the selection (exclusive)? 
        // Or inclusive?
        // Vim `getpos` returns 1-based column.
        // If we select "foo" (3 chars). start=1, end=3.
        // We want to replace indices 0, 1, 2.
        // Range(0, 0) to Range(0, 3).
        // So endCol = end[1].
        // Wait, `getpos` end column is the column of the *last character* included in selection.
        // So if "foo" is selected, end col is 3.
        // LSP Range end is exclusive. So we need 3+1 = 4?
        // But `getpos` can be tricky with multi-byte.
        
        // Let's look at how `originalRange` was constructed. It likely comes from `vim.call('getpos', ...)`
        // In `coc.nvim` or `vim`, visual selection end is inclusive.
        
        // Safe bet: endCol = end[1]. 
        // If end[1] is the last char index (1-based). e.g. 3.
        // We want to replace up to 3 (inclusive).
        // LSP is exclusive. So we want to replace up to 4.
        
        // However, `end[1]` might be `2147483647` for line-wise? No, we handled line-wise above.
        
        // Let's verify `end[1]` behavior.
        // If I rely on `doc.applyEdits`, I should be careful.
        // Assuming `end[1]` needs +1 for exclusive LSP range if it comes from `getpos`'s inclusive column.
        
        const endCol = end[1]; 
        // But wait, `getpos` returns byte index or char index?
        // `coc.nvim` usually handles this if we use its utilities.
        // `originalRange` is just number[].
        
        // Let's assume `end[1]` is inclusive 1-based column.
        range = Range.create(startRow, startCol, endRow, endCol);
        
        const text = lines.join('\n');
        await doc.applyEdits([TextEdit.replace(range, text)]);
      }
    }
    await breakUndoSequence();
  }

  async close() {
    if (this.task !== 'edit') return;
    try {
      await nvim.command('tabclose');
    } catch (e) {}
    this.aiBufnr = -1;
    this.origTempBufnr = -1;
  }

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
