import {
  CompletionItemProvider,
  TextDocument,
  Position,
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionList,
  CompletionItemKind,
  Range,
  workspace,
  TextEdit,
} from 'coc.nvim';
import { Engine } from './engine';
import { IAPIOptions, IMessage } from './interface';

interface ICachedCompletion {
  position: Position;
  documentVersion: number;
  item: CompletionItem;
}

export class AICompletionProvider implements CompletionItemProvider {
  private engine: Engine;
  private currentRequestTimeout: NodeJS.Timeout | null = null;
  private cachedCompletion: ICachedCompletion | null = null;

  constructor() {
    this.engine = new Engine('tab');
  }

  async provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: CompletionContext,
  ): Promise<CompletionItem[] | CompletionList> {
    // 0. Check Enabled
    if (this.engine.config.enabled === false) {
      return [];
    }

    // 1. Check Cache
    if (this.cachedCompletion) {
      const {
        position: cachedPos,
        documentVersion: cachedVer,
        item,
      } = this.cachedCompletion;

      if (
        document.version === cachedVer &&
        position.line === cachedPos.line &&
        position.character === cachedPos.character
      ) {
        this.cachedCompletion = null;
        return [item];
      }
      if (document.version > cachedVer) {
        this.cachedCompletion = null;
      }
    }

    // 2. Schedule Background Fetch
    this.scheduleFetch(document, position);

    // 3. Return immediately to not block
    return [];
  }

  private scheduleFetch(document: TextDocument, position: Position) {
    if (this.currentRequestTimeout) {
      clearTimeout(this.currentRequestTimeout);
    }

    this.currentRequestTimeout = setTimeout(async () => {
      await this.fetchCompletion(document, position);
    }, 500);
  }

  private async buildContext(
    document: TextDocument,
    position: Position,
  ): Promise<string> {
    const maxTotalChars = this.engine.config.maxContextSize || 4096;
    const includeOpenBuffers = this.engine.config.includeOpenBuffers ?? true;

    // Reserve ~70% for current file context
    const currentFileBudget = Math.floor(maxTotalChars * 0.7);
    const otherFilesBudget = maxTotalChars - currentFileBudget;

    // --- 1. Current File Context ---
    const offset = document.offsetAt(position);
    const text = document.getText();

    const halfBudget = Math.floor(currentFileBudget / 2);
    const start = Math.max(0, offset - halfBudget);
    const end = Math.min(text.length, offset + halfBudget);

    const prefix = text.slice(start, offset);
    const suffix = text.slice(offset, end);

    // Construct main block
    // We include file path comment if possible
    const relPath = workspace.asRelativePath(document.uri);
    let prompt = `
// File: ${relPath} (Current)
${prefix}<CURSOR>${suffix}`;

    // --- 2. Other Open Buffers (Optional) ---
    if (includeOpenBuffers && otherFilesBudget > 0) {
      let otherContext = '';
      let usedChars = 0;

      const currentUri = document.uri;
      const currentLangId = document.languageId;

      // Get all documents
      const docs = workspace.documents;

      // Sort: prefer same language, prefer recently used (not easily tracking history here, so order by buffer ID or just array order)
      const relevantDocs = docs.filter(
        (d) => d.uri !== currentUri && d.languageId === currentLangId,
      );

      for (const doc of relevantDocs) {
        if (usedChars >= otherFilesBudget) break;

        const content = doc.textDocument.getText();
        const docRelPath = workspace.asRelativePath(doc.uri);
        // Take top N chars or some relevant part?
        // Taking the whole file might be too much. Let's take first 500 chars + last 500 chars?
        // Or just the first 1000 chars.

        const snippetSize = Math.min(
          1000,
          Math.floor(otherFilesBudget / (relevantDocs.length || 1)),
        );
        const snippet = content.slice(0, snippetSize); // Simplified: just take the header/imports/definitions

        otherContext += `
// File: ${docRelPath}
${snippet}
...
`;
        usedChars += snippet.length;
      }

      // Prepend other context
      if (otherContext) {
        prompt = otherContext + '\n' + prompt;
      }
    }

    return prompt;
  }

  private async fetchCompletion(document: TextDocument, position: Position) {
    const currentDoc = workspace.getDocument(document.uri);
    if (!currentDoc) return;

    const mode = await workspace.nvim.call('mode');
    if (mode !== 'i') return;

    // --- Prepare Request ---
    const promptContent = await this.buildContext(document, position);

    const messages: IMessage[] = [
      { role: 'system', content: this.engine.config.initialPrompt },
      { role: 'user', content: promptContent },
    ];

    const requestData: IAPIOptions = {
      model: this.engine.config.model,
      messages: messages,
      max_tokens: this.engine.config.maxTokens,
      temperature: this.engine.config.temperature,
      stream: false,
    };

    let completionText = '';
    try {
      completionText = await this.engine.execute(
        this.engine.config,
        requestData,
      );
    } catch (error) {
      return;
    }

    if (!completionText.trim()) return;

    // --- Process Result ---
    const firstLine = completionText.split('\n')[0];
    const label =
      firstLine.length > 30 ? firstLine.slice(0, 30) + '...' : firstLine;

    const lineText = document.getText(
      Range.create(position.line, 0, position.line, position.character),
    );
    const match = lineText.match(/["\'\w$]+$/); // Fixed regex to include $ and quotes
    const prefixWord = match ? match[0] : '';

    const startCharacter = position.character - prefixWord.length;
    const replaceRange = Range.create(
      position.line,
      startCharacter,
      position.line,
      position.character,
    );

    const item: CompletionItem = {
      label: `✨ ${label}`,
      kind: CompletionItemKind.Text,
      insertText: completionText,
      textEdit: TextEdit.replace(replaceRange, prefixWord + completionText),
      detail: 'AI Suggestion',
      documentation: completionText,
      preselect: true,
      sortText: '0000',
      filterText: prefixWord + completionText,
    };

    // --- Cache & Trigger ---
    this.cachedCompletion = {
      position,
      documentVersion: document.version,
      item,
    };

    const currentMode = await workspace.nvim.call('mode');
    if (currentMode === 'i') {
      await workspace.nvim.call('coc#start');
    }
  }
}
