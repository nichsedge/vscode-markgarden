import Module from 'module';

export class EventEmitter<T = any> {
  public event: (listener: (e: T) => any) => { dispose(): void };
  constructor() {
    this.event = () => ({ dispose() {} });
  }
  fire(_data?: T): void {}
  dispose(): void {}
}

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  constructor(public start: any, public end: any) {}
}

export class Location {
  constructor(public uri: any, public range: any) {}
}

export class DocumentLink {
  public tooltip: string = '';
  constructor(public range: any, public target: any) {}
}

export class CompletionItem {
  public insertText: any;
  public documentation: any;
  public detail: any;
  public filterText: any;
  constructor(public label: any, public kind?: any) {
    this.insertText = label;
  }
}

export const CompletionItemKind = {
  Property: 9,
  Keyword: 13,
  Folder: 18,
  Reference: 17,
  Value: 11,
  EnumMember: 19,
  File: 17
};

export class SnippetString {
  constructor(public value: any) {}
}

export const TextEdit = {
  replace: (range: any, text: any) => ({ range, text })
};

export class WorkspaceEdit {
  public edits: any[] = [];
  replace(uri: any, range: any, text: any) {
    this.edits.push({ uri, range, text });
  }
}

export class MarkdownString {
  public isTrusted: boolean = false;
  public supportHtml: boolean = false;
  constructor(public value: string = '') {}
  appendMarkdown(str: string) {
    this.value += str;
  }
}

export const Uri = {
  file: (p: string) => ({ fsPath: p, path: p, toString: () => `file://${p}` }),
  parse: (s: string) => ({ fsPath: s, path: s, toString: () => s })
};

export const __appliedWorkspaceBatches: any[] = [];

export const workspace = {
  workspaceFolders: [] as any[],
  getWorkspaceFolder: (_uri?: any) => null as any,
  getConfiguration: (_section?: string) => ({ get: (_k: string, d: any) => d }),
  applyEdit: (edit: any) => {
    try {
      if (!Array.isArray((Module.prototype as any).__appliedWorkspaceBatches)) {
        (Module.prototype as any).__appliedWorkspaceBatches = [];
      }
      (Module.prototype as any).__appliedWorkspaceBatches.push(edit.edits);
    } catch {
      // ignore
    }
    __appliedWorkspaceBatches.push(edit.edits);
    return Promise.resolve(true);
  }
};

export const window = {
  activeTextEditor: undefined as any,
  showInformationMessage: () => {},
  showWarningMessage: () => {},
  showErrorMessage: () => {},
  createTextEditorDecorationType: (_options: any) => ({ dispose: () => {} })
};

export const commands = {};

export const languages = {
  createDiagnosticCollection: () => {
    const map = new Map();
    return {
      set: (uri: any, diags: any) => map.set(uri, diags),
      delete: (uri: any) => map.delete(uri),
      get: (uri: any) => map.get(uri) || [],
      _map: map
    };
  }
};

export class Diagnostic {
  public source: string = '';
  public code: string = '';
  constructor(public range: any, public message: string, public severity: number) {}
}

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

export class ThemeIcon {
  constructor(public id: string) {}
}

export class TreeItem {
  public iconPath: any;
  public description: any;
  public contextValue: any;
  public command: any;
  constructor(public label: any, public collapsibleState?: any) {}
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 };
