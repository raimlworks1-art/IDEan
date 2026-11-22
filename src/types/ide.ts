export type LanguageMode =
  | 'lua'
  | 'luau'
  | 'other'
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'html'
  | 'css'
  | 'c'
  | 'cpp'
  | 'csharp';

export type ProjectSource = 'app' | 'disk' | 'github';

export interface ProjectRemote {
  owner: string;
  repo: string;
  branch: string;
  pushedCommitId?: string; // local commit id last pushed/pulled
  syncedPaths?: string[]; // file paths known to exist on the remote
}

export interface GitAuth {
  token: string;
  login: string;
  name: string | null;
  avatar: string;
}

export type NavPanel = 'projects' | 'plugins' | 'git' | null;

export interface HistoryEntry {
  content: string;
  selectionStart: number;
  selectionEnd: number;
  timestamp: number;
}

export interface FileItem {
  id: string;
  name: string; // e.g. "StateScheduler.luau"
  parentId: string | null; // null if in project root, or folder id
  type: 'file';
  language: LanguageMode;
  content: string;
  savedContent: string; // content last saved by user
  lastModified: number;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  cursorPosition?: number;
  scrollTop?: number;
}

export interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
  type: 'folder';
  isOpen: boolean;
}

export type ProjectNode = FileItem | FolderItem;

export interface GitCommit {
  id: string;
  hash: string;
  message: string;
  timestamp: number;
  author: string;
  snapshot: Record<string, { name: string; path: string; content: string }>; // keyed by file id
}

export interface Project {
  id: string;
  name: string;
  description: string;
  language?: LanguageMode; // project language chosen at creation
  source?: ProjectSource; // 'app' = app directory, 'disk' = imported folder, 'github' = cloned
  remote?: ProjectRemote;
  nodes: ProjectNode[];
  openFileIds: string[];
  activeFileId: string;
  stagedFileIds: string[];
  commits: GitCommit[];
}

export type TokenType =
  | 'keyword'
  | 'luau-keyword'
  | 'directive'
  | 'builtin'
  | 'function'
  | 'type'
  | 'generic'
  | 'string'
  | 'interp-string'
  | 'number'
  | 'boolean'
  | 'nil'
  | 'comment'
  | 'operator'
  | 'punctuation'
  | 'table-brace'
  | 'property'
  | 'identifier'
  | 'whitespace';

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

export interface FoldRegion {
  startLine: number; // 0-indexed
  endLine: number;   // 0-indexed
  kind: 'function' | 'block' | 'table' | 'comment' | 'type';
  label: string;
}

export interface SyntaxDiagnostic {
  line: number; // 1-indexed
  message: string;
  severity: 'warning' | 'error';
}
