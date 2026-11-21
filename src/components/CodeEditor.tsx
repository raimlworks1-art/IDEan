import React, { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from 'react';
import {
  ChevronDown,
  ChevronRight,
  X,
  Plus,
  Search,
  Replace,
  ArrowUp,
  ArrowDown,
  CaseSensitive,
  Scissors,
  Copy,
  ClipboardPaste,
  CheckSquare,
  MessageSquareCode,
  CopyPlus,
  Trash2,
  IndentIncrease,
  IndentDecrease,
} from 'lucide-react';
import { FileItem, LanguageMode, SyntaxDiagnostic, Token } from '../types/ide';
import {
  LineToken,
  comment_marker_for,
  detect_lang_id,
  is_lua_family,
  lang_label,
  tokenize_window,
} from '../utils/languages';
import {
  tokenizeLua,
  getTokenColorClass,
  findMatchingBracket,
  computeFoldRegions,
} from '../utils/luaTokenizer';
import {
  indentLines,
  outdentLines,
  commentLines,
  uncommentLines,
  toggleCommentLines,
  duplicateLines,
  deleteLines,
  moveLineUp,
  moveLineDown,
  insertTokenOrPair,
  handleSmartEnter,
  EditOperationResult,
} from '../utils/editorCommands';
import { ToolbarActionType } from './EditorToolbar';

interface CodeEditorProps {
  activeFile: FileItem;
  openFiles: FileItem[];
  onSelectFile: (fileId: string) => void;
  onCloseTab: (fileId: string, e: React.MouseEvent) => void;
  onQuickNewFile: () => void;
  onChangeContent: (
    newContent: string,
    selectionStart: number,
    selectionEnd: number,
    pushHistory?: boolean
  ) => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  isFindOpen: boolean;
  isReplaceOpen: boolean;
  onCloseFind: () => void;
  onToggleReplaceMode: () => void;
  externalCommandRef: React.MutableRefObject<((action: ToolbarActionType) => void) | null>;
  diagnostics: SyntaxDiagnostic[];
  autosaveEnabled: boolean;
  onToggleAutosave: () => void;
  onLanguageChange: (lang: LanguageMode) => void;
}

interface FoldedEntry {
  id: string;
  markerText: string;
  originalText: string;
  lineCount: number;
  label: string;
}

const LINE_HEIGHT = 22;
const EDITOR_PADDING_TOP = 16;
const EDITOR_PADDING_BOTTOM = 136;
const EDITOR_PADDING_LEFT = 8;
const GUTTER_WIDTH = 44;
const APPROX_CHAR_WIDTH = 8.1;

const WINDOW_OVERSCAN = 60;
const WINDOW_KEEP_MARGIN = 20;
const SYNC_TOKENIZE_CHARS = 120000;
const LUA_RICH_MAX_CHARS = 60000;
const EXACT_STATE_CHARS = 200000;
const ROW_MODE_MAX_LINES = 10000;
const ROW_MODE_MAX_CHARS = 400000;
const FOLD_MAX_CHARS = 400000;
const BRACKET_MAX_CHARS = 600000;

const BRACKET_CLASS = 'bg-[#3E3E40] text-[#E6E6E8] ring-1 ring-[#B4B4B8]/70 rounded-[2px]';

function line_col_at(text: string, pos: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  let i = text.indexOf('\n');
  while (i !== -1 && i < pos) {
    line++;
    last = i;
    i = text.indexOf('\n', i + 1);
  }
  return { line, col: pos - last - 1 };
}

function same_tokens(a: LineToken[], b: LineToken[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text || a[i].type !== b[i].type) return false;
  }
  return true;
}

function group_lua_tokens(tokens: Token[], line_count: number): LineToken[][] {
  const out: LineToken[][] = Array.from({ length: line_count }, () => []);
  let line = 0;
  for (const t of tokens) {
    const parts = t.value.split('\n');
    for (let k = 0; k < parts.length; k++) {
      if (k > 0) line++;
      if (parts[k].length > 0 && line < line_count) out[line].push({ text: parts[k], type: t.type });
    }
  }
  return out;
}

interface LineRowProps {
  text: string;
  display_num: number;
  is_current: boolean;
  tokens: LineToken[] | undefined;
  fold_start: { endLine: number; label: string; kind: string } | undefined;
  index: number;
  folded: FoldedEntry | undefined;
  bracket_cols: number[] | undefined;
  on_fold: (start: number, end: number, label: string) => void;
  on_unfold: (entry: FoldedEntry) => void;
}

function render_line_nodes(
  text: string,
  tokens: LineToken[] | undefined,
  folded: FoldedEntry | undefined,
  bracket_cols: number[] | undefined
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const clean = (value: string) => (value.includes('\r') ? value.replace(/\r/g, '') : value);
  const pieces: LineToken[] = tokens && tokens.length > 0 ? tokens : text.length > 0 ? [{ text, type: 'identifier' }] : [];
  let col = 0;
  pieces.forEach((tok, ti) => {
    const class_name = getTokenColorClass(tok.type);
    const start = col;
    const end = col + tok.text.length;
    col = end;

    if (folded && tok.type === 'comment' && tok.text === folded.markerText) {
      nodes.push(
        <span
          key={ti}
          className="inline-flex items-center px-1.5 py-0 rounded bg-[#2E2E2F] text-[#B4B4B8] border border-[#3E3E40] text-[11px]"
        >
          {tok.text}
        </span>
      );
      return;
    }

    const can_mark = tok.type === 'punctuation' || tok.type === 'table-brace';
    const hits = can_mark && bracket_cols ? bracket_cols.filter((c) => c >= start && c < end).sort((a, b) => a - b) : [];
    if (hits.length === 0) {
      nodes.push(
        <span key={ti} className={class_name}>
          {clean(tok.text)}
        </span>
      );
      return;
    }
    let cursor = 0;
    hits.forEach((c, hi) => {
      const rel = c - start;
      if (rel > cursor) {
        nodes.push(
          <span key={`${ti}-a${hi}`} className={class_name}>
            {tok.text.slice(cursor, rel)}
          </span>
        );
      }
      nodes.push(
        <span key={`${ti}-b${hi}`} className={`${class_name} ${BRACKET_CLASS}`}>
          {tok.text[rel]}
        </span>
      );
      cursor = rel + 1;
    });
    if (cursor < tok.text.length) {
      nodes.push(
        <span key={`${ti}-z`} className={class_name}>
          {tok.text.slice(cursor)}
        </span>
      );
    }
  });
  return nodes;
}

const PlainRow = React.memo(function PlainRow({ text }: { text: string }) {
  return (
    <div
      className="editor-typography"
      style={{
        minHeight: `${LINE_HEIGHT}px`,
        padding: `0 ${EDITOR_PADDING_LEFT}px 0 ${GUTTER_WIDTH + EDITOR_PADDING_LEFT}px`,
      }}
    >
      {text.includes('\r') ? text.replace(/\r/g, '') : text}
    </div>
  );
});

const LineRow = React.memo(function LineRow(props: LineRowProps) {
  const { text, display_num, is_current, tokens, fold_start, index, folded, bracket_cols, on_fold, on_unfold } = props;
  return (
    <div style={{ display: 'flex', minHeight: `${LINE_HEIGHT}px` }} className={is_current ? 'bg-[#242425]' : undefined}>
      <div
        aria-hidden="true"
        style={{
          width: `${GUTTER_WIDTH}px`,
          minWidth: `${GUTTER_WIDTH}px`,
          flex: 'none',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          fontSize: '12px',
          lineHeight: `${LINE_HEIGHT}px`,
          userSelect: 'none',
        }}
        className={`pr-1.5 pl-1 font-mono-code ${
          is_current ? 'text-[#E6E6E8] font-medium border-l-2 border-l-[#B4B4B8]' : 'text-[#707073]'
        }`}
      >
        <div
          style={{ width: '12px', height: `${LINE_HEIGHT}px`, pointerEvents: 'auto' }}
          className="flex items-center justify-center"
        >
          {folded ? (
            <button
              type="button"
              onClick={() => on_unfold(folded)}
              title={`Expand folded block (${folded.lineCount} lines)`}
              className="text-[#B4B4B8] hover:text-[#E6E6E8]"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          ) : fold_start ? (
            <button
              type="button"
              onClick={() => on_fold(index, fold_start.endLine, fold_start.label)}
              title={`Fold ${fold_start.kind} block (lines ${index + 1}–${fold_start.endLine + 1})`}
              className="text-[#707073] hover:text-[#E6E6E8]"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          ) : null}
        </div>
        <span>{display_num}</span>
      </div>
      <div
        className="editor-typography"
        style={{ flex: '1 1 0%', minWidth: 0, padding: `0 ${EDITOR_PADDING_LEFT}px` }}
      >
        {render_line_nodes(text, tokens, folded, bracket_cols)}
      </div>
    </div>
  );
});

export const CodeEditor: React.FC<CodeEditorProps> = ({
  activeFile,
  openFiles,
  onSelectFile,
  onCloseTab,
  onQuickNewFile,
  onChangeContent,
  onSave,
  onUndo,
  onRedo,
  isFindOpen,
  isReplaceOpen,
  onCloseFind,
  onToggleReplaceMode,
  externalCommandRef,
  diagnostics,
  autosaveEnabled,
  onToggleAutosave,
  onLanguageChange,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const rows_ref = useRef<HTMLDivElement>(null);
  const char_width_ref = useRef(APPROX_CHAR_WIDTH);
  const raf_ref = useRef(0);
  const fold_actions_ref = useRef<{
    fold: (start: number, end: number, label: string) => void;
    unfold: (entry: FoldedEntry) => void;
  } | null>(null);
  const prev_rich_ref = useRef<LineToken[][] | null>(null);
  const prev_win_ref = useRef<{ first: number; tokens: (LineToken[] | undefined)[] } | null>(null);

  // Track cursor & selection state
  const [cursorState, setCursorState] = useState<{
    selStart: number;
    selEnd: number;
    line: number;
    col: number;
  }>({
    selStart: 0,
    selEnd: 0,
    line: 1,
    col: 1,
  });

  // Internal clipboard fallback for environments where navigator.clipboard is restricted
  const internalClipboardRef = useRef<string>('');

  // Code folding storage: maps fold marker string -> FoldedEntry
  const [foldedEntries, setFoldedEntries] = useState<Record<string, FoldedEntry>>({});

  // Find & Replace state
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);

  // Custom Context Menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [scroll_area_height, set_scroll_area_height] = useState(0);

  const code = activeFile.content;
  const language = activeFile.language;
  const lang_id = useMemo(() => detect_lang_id(activeFile.name, language), [activeFile.name, language]);
  const lua_family = is_lua_family(lang_id);
  const commentMarker = comment_marker_for(lang_id);
  const [win, set_win] = useState({ start: 0, end: WINDOW_OVERSCAN * 2 });
  const win_ref = useRef(win);
  win_ref.current = win;

  // Reset folds when switching files
  useEffect(() => {
    setFoldedEntries({});
  }, [activeFile.id]);

  // Focus Find input when Find bar opens
  useEffect(() => {
    if (isFindOpen) {
      setTimeout(() => findInputRef.current?.focus(), 20);
    }
  }, [isFindOpen, isReplaceOpen]);

  // Compute lines
  const lines = useMemo(() => code.split('\n'), [code]);

  const plain_big = lines.length > ROW_MODE_MAX_LINES || code.length > ROW_MODE_MAX_CHARS;
  const deferred_big = useDeferredValue(code.length > SYNC_TOKENIZE_CHARS ? code : '');
  const deferred_code = code.length > SYNC_TOKENIZE_CHARS ? deferred_big : code;

  // Compute foldable regions
  const foldRegions = useMemo(
    () =>
      !lua_family || plain_big || deferred_code.length > FOLD_MAX_CHARS ? [] : computeFoldRegions(deferred_code),
    [deferred_code, lua_family, plain_big]
  );
  const foldStartMap = useMemo(() => {
    const map = new Map<number, { endLine: number; label: string; kind: string }>();
    for (const r of foldRegions) {
      if (!map.has(r.startLine)) {
        map.set(r.startLine, { endLine: r.endLine, label: r.label, kind: r.kind });
      }
    }
    return map;
  }, [foldRegions]);

  // Compute true display line numbers accounting for any collapsed fold markers
  const displayLineNumbers = useMemo(() => {
    const entries = Object.values(foldedEntries);
    if (entries.length === 0) return null;
    const nums: { displayNum: number; foldEntry?: FoldedEntry }[] = [];
    let currentLineNum = 1;
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      let matchedFold: FoldedEntry | undefined;
      for (const entry of entries) {
        if (lineText.includes(entry.markerText)) {
          matchedFold = entry;
          break;
        }
      }
      nums.push({ displayNum: currentLineNum, foldEntry: matchedFold });
      if (matchedFold) {
        currentLineNum += matchedFold.lineCount;
      } else {
        currentLineNum += 1;
      }
    }
    return nums;
  }, [lines, foldedEntries]);

  // Compute search matches
  const searchMatches = useMemo(() => {
    if (!isFindOpen || !findQuery) return [];
    const results: { start: number; end: number }[] = [];
    const haystack = caseSensitive ? code : code.toLowerCase();
    const needle = caseSensitive ? findQuery : findQuery.toLowerCase();
    if (!needle) return [];

    let idx = 0;
    while (idx <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, idx);
      if (found === -1) break;
      results.push({ start: found, end: found + needle.length });
      idx = found + Math.max(1, needle.length);
    }
    return results;
  }, [code, findQuery, caseSensitive, isFindOpen]);

  // Keep activeMatchIdx in range
  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveMatchIdx(0);
    } else if (activeMatchIdx >= searchMatches.length) {
      setActiveMatchIdx(0);
    }
  }, [searchMatches.length, activeMatchIdx]);

  // Compute matching brackets at current cursor position
  const matchedBrackets = useMemo(() => {
    if (plain_big || code.length > BRACKET_MAX_CHARS) return null;
    if (cursorState.selStart !== cursorState.selEnd) return null;
    return findMatchingBracket(code, cursorState.selStart);
  }, [code, cursorState.selStart, cursorState.selEnd, plain_big]);

  const bracket_map = useMemo(() => {
    if (!matchedBrackets) return null;
    const map = new Map<number, number[]>();
    for (const offset of matchedBrackets) {
      const at = line_col_at(code, offset);
      const list = map.get(at.line - 1);
      if (list) list.push(at.col);
      else map.set(at.line - 1, [at.col]);
    }
    return map;
  }, [code, matchedBrackets]);

  /**
   * Intelligent Cursor-Following Scroll Engine (Section 7)
   * Keeps cursor visible when creating new lines or approaching bottom/top edges,
   * while avoiding unnecessary jumps when editing lines comfortably in view.
   */
  const ensureCursorVisible = useCallback(
    (targetOffset: number, textContent: string, forceSmooth = false) => {
      const scrollEl = scrollContainerRef.current;
      if (!scrollEl) return;

      const at = line_col_at(textContent, targetOffset);
      const lineIdx = at.line - 1;

      let cursorTop = EDITOR_PADDING_TOP + lineIdx * LINE_HEIGHT;
      const row_el = rows_ref.current?.children[lineIdx] as HTMLElement | undefined;
      if (row_el) {
        cursorTop = row_el.offsetTop;
        const cols = Math.max(
          1,
          Math.floor((scrollEl.clientWidth - GUTTER_WIDTH - EDITOR_PADDING_LEFT * 2) / char_width_ref.current)
        );
        const row_count = Math.max(1, Math.round(row_el.offsetHeight / LINE_HEIGHT));
        cursorTop += Math.min(Math.floor(at.col / cols), row_count - 1) * LINE_HEIGHT;
      }
      const cursorBottom = cursorTop + LINE_HEIGHT;

      const viewportHeight = scrollEl.clientHeight;
      const currentScrollTop = scrollEl.scrollTop;

      const bottomBuffer = Math.min(72, Math.max(LINE_HEIGHT * 2, Math.floor(viewportHeight * 0.22)));
      const topBuffer = 32;

      if (lineIdx < 10 && currentScrollTop === 0 && cursorBottom <= viewportHeight - bottomBuffer) {
        return;
      }
      if (cursorBottom > currentScrollTop + viewportHeight - bottomBuffer) {
        const desiredScrollTop = cursorBottom - viewportHeight + bottomBuffer + 8;
        if (forceSmooth) {
          scrollEl.scrollTo({ top: desiredScrollTop, behavior: 'smooth' });
        } else {
          scrollEl.scrollTop = desiredScrollTop;
        }
      } else if (cursorTop < currentScrollTop + topBuffer) {
        scrollEl.scrollTop = Math.max(0, cursorTop - topBuffer);
      }
    },
    []
  );

  // Synchronize cursor state from textarea
  const syncCursorFromTextarea = useCallback(
    (ensureVisible = false, overrideText?: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const currentText = overrideText !== undefined ? overrideText : ta.value;
      const selStart = ta.selectionStart ?? 0;
      const selEnd = ta.selectionEnd ?? 0;

      const at = line_col_at(currentText, selEnd);
      const line = at.line;
      const col = at.col + 1;

      setCursorState({ selStart, selEnd, line, col });

      if (ensureVisible) {
        ensureCursorVisible(selEnd, currentText);
      }
    },
    [ensureCursorVisible]
  );

  // Apply an EditOperationResult to the editor and restore selection + scroll
  const applyEditResult = useCallback(
    (result: EditOperationResult, pushHistory = true) => {
      onChangeContent(result.newText, result.selectionStart, result.selectionEnd, pushHistory);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(result.selectionStart, result.selectionEnd);
          const at = line_col_at(result.newText, result.selectionEnd);
          setCursorState({
            selStart: result.selectionStart,
            selEnd: result.selectionEnd,
            line: at.line,
            col: at.col + 1,
          });
          ensureCursorVisible(result.selectionEnd, result.newText);
        }
      });
    },
    [onChangeContent, ensureCursorVisible]
  );

  // Fold / Unfold a block at startLine
  const handleFoldBlock = (startLine: number, endLine: number, label: string) => {
    const currentLines = code.split('\n');
    if (startLine < 0 || endLine >= currentLines.length || endLine <= startLine) return;

    const foldId = `${Date.now().toString(36)}_${startLine}`;
    const hiddenCount = endLine - startLine + 1;
    const markerText = `--[[▸ folded:${foldId} (${hiddenCount - 1} lines)]]`;
    const originalBlock = currentLines.slice(startLine, endLine + 1).join('\n');
    const collapsedLine = `${currentLines[startLine]} ${markerText}`;

    setFoldedEntries((prev) => ({
      ...prev,
      [foldId]: {
        id: foldId,
        markerText,
        originalText: originalBlock,
        lineCount: hiddenCount,
        label,
      },
    }));

    const nextLines = [
      ...currentLines.slice(0, startLine),
      collapsedLine,
      ...currentLines.slice(endLine + 1),
    ];
    const nextCode = nextLines.join('\n');
    onChangeContent(nextCode, cursorState.selStart, cursorState.selStart, false);
  };

  const handleUnfoldBlock = (entry: FoldedEntry) => {
    const currentLines = code.split('\n');
    const lineIdx = currentLines.findIndex((l) => l.includes(entry.markerText));
    if (lineIdx === -1) return;

    const nextLines = [
      ...currentLines.slice(0, lineIdx),
      entry.originalText,
      ...currentLines.slice(lineIdx + 1),
    ];
    const nextCode = nextLines.join('\n');

    setFoldedEntries((prev) => {
      const copy = { ...prev };
      delete copy[entry.id];
      return copy;
    });

    onChangeContent(nextCode, cursorState.selStart, cursorState.selStart, false);
  };

  // Execute toolbar or context-menu actions
  const executeEditorAction = useCallback(
    async (action: ToolbarActionType) => {
      const ta = textareaRef.current;
      const selStart = ta ? ta.selectionStart : cursorState.selStart;
      const selEnd = ta ? ta.selectionEnd : cursorState.selEnd;

      switch (action) {
        case 'cut': {
          let targetStart = selStart;
          let targetEnd = selEnd;
          if (selStart === selEnd) {
            // If no selection, cut current line
            targetStart = code.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;
            targetEnd = code.indexOf('\n', selStart);
            if (targetEnd === -1) targetEnd = code.length;
            else targetEnd += 1;
          }
          const cutSlice = code.slice(targetStart, targetEnd);
          internalClipboardRef.current = cutSlice;
          try {
            await navigator.clipboard.writeText(cutSlice);
          } catch {
            // Fallback to internalClipboardRef
          }
          const newText = code.slice(0, targetStart) + code.slice(targetEnd);
          applyEditResult({
            newText,
            selectionStart: targetStart,
            selectionEnd: targetStart,
          });
          break;
        }
        case 'copy': {
          let targetStart = selStart;
          let targetEnd = selEnd;
          if (selStart === selEnd) {
            targetStart = code.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;
            targetEnd = code.indexOf('\n', selStart);
            if (targetEnd === -1) targetEnd = code.length;
          }
          const copySlice = code.slice(targetStart, targetEnd);
          internalClipboardRef.current = copySlice;
          try {
            await navigator.clipboard.writeText(copySlice);
          } catch {
            // Fallback stored in internalClipboardRef
          }
          if (ta) ta.focus();
          break;
        }
        case 'paste': {
          let clipText = internalClipboardRef.current;
          try {
            const sysClip = await navigator.clipboard.readText();
            if (sysClip) clipText = sysClip;
          } catch {
            // Use internalClipboardRef
          }
          if (clipText) {
            const newText = code.slice(0, selStart) + clipText + code.slice(selEnd);
            const newCursor = selStart + clipText.length;
            applyEditResult({
              newText,
              selectionStart: newCursor,
              selectionEnd: newCursor,
            });
          }
          break;
        }
        case 'save': {
          onSave();
          if (ta) ta.focus();
          break;
        }
        case 'selectAll': {
          if (ta) {
            ta.focus();
            ta.setSelectionRange(0, code.length);
            syncCursorFromTextarea(false);
          }
          break;
        }
        case 'find': {
          if (!isFindOpen) {
            onToggleReplaceMode(); // handled by parent
          }
          setTimeout(() => findInputRef.current?.focus(), 20);
          break;
        }
        case 'replace': {
          onToggleReplaceMode();
          setTimeout(() => findInputRef.current?.focus(), 20);
          break;
        }
        case 'indent':
          applyEditResult(indentLines(code, selStart, selEnd));
          break;
        case 'outdent':
          applyEditResult(outdentLines(code, selStart, selEnd));
          break;
        case 'comment':
          applyEditResult(commentLines(code, selStart, selEnd, commentMarker));
          break;
        case 'uncomment':
          applyEditResult(uncommentLines(code, selStart, selEnd, commentMarker));
          break;
        case 'duplicateLine':
          applyEditResult(duplicateLines(code, selStart, selEnd));
          break;
        case 'deleteLine':
          applyEditResult(deleteLines(code, selStart, selEnd));
          break;
        case 'moveLineUp':
          applyEditResult(moveLineUp(code, selStart, selEnd));
          break;
        case 'moveLineDown':
          applyEditResult(moveLineDown(code, selStart, selEnd));
          break;
        case 'insert;':
          applyEditResult(insertTokenOrPair(code, selStart, selEnd, ';'));
          break;
        case 'insert|':
          applyEditResult(insertTokenOrPair(code, selStart, selEnd, '|'));
          break;
        case 'insert:':
          applyEditResult(insertTokenOrPair(code, selStart, selEnd, ':'));
          break;
        case 'insert()':
          applyEditResult(insertTokenOrPair(code, selStart, selEnd, '()'));
          break;
        case 'insert{}':
          applyEditResult(insertTokenOrPair(code, selStart, selEnd, '{}'));
          break;
        case 'insert[]':
          applyEditResult(insertTokenOrPair(code, selStart, selEnd, '[]'));
          break;
        case 'insert""':
          applyEditResult(insertTokenOrPair(code, selStart, selEnd, '""'));
          break;
      }
    },
    [
      code,
      cursorState.selStart,
      cursorState.selEnd,
      applyEditResult,
      onSave,
      isFindOpen,
      onToggleReplaceMode,
      syncCursorFromTextarea,
    ]
  );

  // Expose command handler to parent toolbar
  useEffect(() => {
    externalCommandRef.current = executeEditorAction;
  }, [externalCommandRef, executeEditorAction]);

  // Keyboard shortcuts and Smart Editing in textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const selStart = ta.selectionStart;
    const selEnd = ta.selectionEnd;
    const isMod = e.ctrlKey || e.metaKey;

    // Undo / Redo
    if (isMod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      onUndo();
      return;
    }
    if (
      (isMod && e.key.toLowerCase() === 'y') ||
      (isMod && e.shiftKey && e.key.toLowerCase() === 'z')
    ) {
      e.preventDefault();
      onRedo();
      return;
    }

    // Save (Ctrl/Cmd + S)
    if (isMod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
      return;
    }

    // Toggle Comment (Ctrl/Cmd + /)
    if (isMod && e.key === '/') {
      e.preventDefault();
      applyEditResult(toggleCommentLines(code, selStart, selEnd, commentMarker));
      return;
    }

    // Delete Line (Ctrl+Shift+K)
    if (isMod && e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      applyEditResult(deleteLines(code, selStart, selEnd));
      return;
    }

    // Duplicate Line (Shift+Alt+ArrowDown)
    if (e.shiftKey && e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      applyEditResult(duplicateLines(code, selStart, selEnd));
      return;
    }

    // Move Line Up / Down (Alt+ArrowUp / Alt+ArrowDown)
    if (e.altKey && !e.shiftKey && e.key === 'ArrowUp') {
      e.preventDefault();
      applyEditResult(moveLineUp(code, selStart, selEnd));
      return;
    }
    if (e.altKey && !e.shiftKey && e.key === 'ArrowDown') {
      e.preventDefault();
      applyEditResult(moveLineDown(code, selStart, selEnd));
      return;
    }

    // Tab / Shift+Tab Indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        applyEditResult(outdentLines(code, selStart, selEnd));
      } else if (selStart !== selEnd) {
        applyEditResult(indentLines(code, selStart, selEnd));
      } else {
        // Insert 2 spaces at cursor
        const newText = code.slice(0, selStart) + '  ' + code.slice(selEnd);
        applyEditResult({
          newText,
          selectionStart: selStart + 2,
          selectionEnd: selStart + 2,
        });
      }
      return;
    }

    // Smart Enter with Automatic Indentation
    if (e.key === 'Enter' && !isMod && !e.shiftKey) {
      e.preventDefault();
      const res = handleSmartEnter(code, selStart, selEnd, !lua_family);
      applyEditResult(res);
      return;
    }

    // Auto-close brackets & quotes
    const pairs: Record<string, string> = {
      '(': ')',
      '{': '}',
      '[': ']',
      '"': '"',
      "'": "'",
      '`': '`',
    };

    if (pairs[e.key] && !isMod && !e.altKey) {
      const closeChar = pairs[e.key];
      // If user types closing quote when already sitting right before it, skip over
      if (
        (e.key === '"' || e.key === "'" || e.key === '`') &&
        selStart === selEnd &&
        code[selStart] === e.key
      ) {
        e.preventDefault();
        ta.setSelectionRange(selStart + 1, selStart + 1);
        syncCursorFromTextarea(true);
        return;
      }

      if (selStart !== selEnd) {
        e.preventDefault();
        const selected = code.slice(selStart, selEnd);
        const wrapped = e.key + selected + closeChar;
        applyEditResult({
          newText: code.slice(0, selStart) + wrapped + code.slice(selEnd),
          selectionStart: selStart + 1,
          selectionEnd: selEnd + 1,
        });
        return;
      } else {
        const nextCh = code[selStart] || '';
        if (!/[A-Za-z0-9_]/.test(nextCh)) {
          e.preventDefault();
          const newText = code.slice(0, selStart) + e.key + closeChar + code.slice(selEnd);
          applyEditResult({
            newText,
            selectionStart: selStart + 1,
            selectionEnd: selStart + 1,
          });
          return;
        }
      }
    }

    // Skip over closing bracket if typed right before it
    if ((e.key === ')' || e.key === '}' || e.key === ']') && selStart === selEnd && code[selStart] === e.key) {
      e.preventDefault();
      ta.setSelectionRange(selStart + 1, selStart + 1);
      syncCursorFromTextarea(true);
      return;
    }
  };

  // Find & Replace Navigation and Replacement
  const navigateSearchMatch = (direction: 1 | -1) => {
    if (searchMatches.length === 0) return;
    const nextIdx = (activeMatchIdx + direction + searchMatches.length) % searchMatches.length;
    setActiveMatchIdx(nextIdx);
    const match = searchMatches[nextIdx];
    if (match && textareaRef.current) {
      ensureCursorVisible(match.end, code, true);
    }
  };

  const handleReplaceSingle = () => {
    if (searchMatches.length === 0) return;
    const match = searchMatches[activeMatchIdx] || searchMatches[0];
    if (!match) return;

    const newText = code.slice(0, match.start) + replaceQuery + code.slice(match.end);
    const newCursor = match.start + replaceQuery.length;
    onChangeContent(newText, newCursor, newCursor, true);
    ensureCursorVisible(newCursor, newText);
  };

  const handleReplaceAll = () => {
    if (searchMatches.length === 0 || !findQuery) return;
    let updated = '';
    let lastIndex = 0;
    for (const m of searchMatches) {
      updated += code.slice(lastIndex, m.start) + replaceQuery;
      lastIndex = m.end;
    }
    updated += code.slice(lastIndex);
    onChangeContent(updated, 0, 0, true);
  };

  const tok_code = code.length <= SYNC_TOKENIZE_CHARS ? code : deferred_code;
  const tok_lines = useMemo(() => (tok_code === code ? lines : tok_code.split('\n')), [tok_code, code, lines]);

  const line_tokens = useMemo(() => {
    if (plain_big || lang_id === 'plain') return null;
    if (lua_family && tok_code.length <= LUA_RICH_MAX_CHARS) {
      const grouped = group_lua_tokens(
        tokenizeLua(tok_code, lang_id === 'luau' ? 'luau' : 'lua'),
        tok_lines.length
      );
      const prev = prev_rich_ref.current;
      if (prev) {
        for (let i = 0; i < grouped.length; i++) {
          const before = prev[i];
          if (before && same_tokens(before, grouped[i])) grouped[i] = before;
        }
      }
      prev_rich_ref.current = grouped;
      return { rich: grouped, first: 0, tokens: [] as (LineToken[] | undefined)[] };
    }
    const w = tokenize_window(tok_lines, lang_id, win.start, win.end, EXACT_STATE_CHARS);
    const prev = prev_win_ref.current;
    if (prev) {
      for (let k = 0; k < w.tokens.length; k++) {
        const before = prev.tokens[w.first + k - prev.first];
        const now = w.tokens[k];
        if (before && now && same_tokens(before, now)) w.tokens[k] = before;
      }
    }
    prev_win_ref.current = { first: w.first, tokens: w.tokens };
    return { rich: null, first: w.first, tokens: w.tokens };
  }, [tok_code, tok_lines, lang_id, lua_family, plain_big, win.start, win.end]);

  const tokens_for = (idx: number): LineToken[] | undefined => {
    if (!line_tokens) return undefined;
    if (tok_lines !== lines && tok_lines[idx] !== lines[idx]) return undefined;
    if (line_tokens.rich) return line_tokens.rich[idx];
    const k = idx - line_tokens.first;
    return k >= 0 && k < line_tokens.tokens.length ? line_tokens.tokens[k] : undefined;
  };

  const update_window = useCallback(() => {
    const sc = scrollContainerRef.current;
    const rows = rows_ref.current;
    if (!sc || !rows) return;
    const count = rows.children.length;
    if (count === 0) return;
    const top = sc.scrollTop;
    const bottom = top + sc.clientHeight;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const el = rows.children[mid] as HTMLElement;
      if (el.offsetTop + el.offsetHeight < top) lo = mid + 1;
      else hi = mid;
    }
    const first = lo;
    hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const el = rows.children[mid] as HTMLElement;
      if (el.offsetTop > bottom) hi = mid - 1;
      else lo = mid;
    }
    const last = lo;
    const cur = win_ref.current;
    const covered =
      (cur.start <= Math.max(0, first - WINDOW_KEEP_MARGIN) || cur.start === 0) &&
      (cur.end >= Math.min(count - 1, last + WINDOW_KEEP_MARGIN) || cur.end >= count - 1);
    if (covered) return;
    set_win({
      start: Math.max(0, first - WINDOW_OVERSCAN),
      end: Math.min(count - 1, last + WINDOW_OVERSCAN),
    });
  }, []);

  const schedule_window_update = useCallback(() => {
    if (raf_ref.current) return;
    raf_ref.current = requestAnimationFrame(() => {
      raf_ref.current = 0;
      update_window();
    });
  }, [update_window]);

  useEffect(() => {
    set_win({ start: 0, end: WINDOW_OVERSCAN * 2 });
    prev_rich_ref.current = null;
    prev_win_ref.current = null;
    schedule_window_update();
  }, [activeFile.id, schedule_window_update]);

  useEffect(() => {
    schedule_window_update();
  }, [lines.length, plain_big, schedule_window_update]);

  fold_actions_ref.current = { fold: handleFoldBlock, unfold: handleUnfoldBlock };
  const on_fold = useCallback(
    (start: number, end: number, label: string) => fold_actions_ref.current?.fold(start, end, label),
    []
  );
  const on_unfold = useCallback((entry: FoldedEntry) => fold_actions_ref.current?.unfold(entry), []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const measure = () => {
      set_scroll_area_height(el.clientHeight);
      schedule_window_update();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [schedule_window_update]);

  useEffect(() => {
    const measure_char = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      const cs = getComputedStyle(ta);
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
      const w = ctx.measureText('M'.repeat(64)).width / 64;
      if (w > 0) char_width_ref.current = w;
    };
    measure_char();
    void document.fonts?.ready.then(measure_char);
  }, []);

  // Close context menu on click anywhere
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', closeMenu);
    }
    return () => window.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#1B1B1C] relative overflow-hidden">
      {/* 1. Compact File Tabs Strip */}
      <div className="h-7 min-h-[28px] bg-[#161617] border-b border-[#2F2F30] flex items-center justify-between px-1.5 select-none overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
          {openFiles.map((file) => {
            const isTabActive = file.id === activeFile.id;
            const isTabDirty = file.content !== file.savedContent;
            return (
              <div
                key={file.id}
                onClick={() => onSelectFile(file.id)}
                className={`group h-6 px-2.5 rounded-t-xs flex items-center gap-1.5 text-[11.5px] cursor-pointer border-t border-x transition-colors shrink-0 ${
                  isTabActive
                    ? 'bg-[#1B1B1C] text-[#E6E6E8] border-[#2F2F30]'
                    : 'bg-transparent text-[#707073] border-transparent hover:text-[#A6A6AA] hover:bg-[#222223]'
                }`}
              >
                <span className="truncate max-w-[140px]">{file.name}</span>
                {isTabDirty && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#C9C9CC] shrink-0"
                    title="Unsaved changes"
                  />
                )}
                {openFiles.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => onCloseTab(file.id, e)}
                    title="Close tab"
                    className="opacity-60 group-hover:opacity-100 hover:text-[#E6E6E8] p-0.5 rounded"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={onQuickNewFile}
            title="Create new file"
            className="h-6 w-6 flex items-center justify-center text-[#707073] hover:text-[#E6E6E8] hover:bg-[#222223] rounded-xs transition-colors shrink-0 ml-0.5"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Folded blocks quick restore button if any folds are active */}
        {Object.keys(foldedEntries).length > 0 && (
          <div className="flex items-center gap-1 shrink-0 pl-2">
            {Object.values(foldedEntries).map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => handleUnfoldBlock(entry)}
                className="px-1.5 py-0.5 text-[10px] font-mono-code rounded bg-[#2E2E2F] text-[#B4B4B8] hover:text-[#E6E6E8] border border-[#3E3E40]"
              >
                Expand {entry.lineCount} lines
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. Collapsible Find & Replace Bar */}
      {isFindOpen && (
        <div className="bg-[#222223] border-b border-[#2F2F30] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 z-20">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            {/* Find Input */}
            <div className="flex items-center bg-[#161617] border border-[#3E3E40] rounded px-2 h-7 w-48 sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#707073] mr-1.5 shrink-0" />
              <input
                ref={findInputRef}
                type="text"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    navigateSearchMatch(e.shiftKey ? -1 : 1);
                  } else if (e.key === 'Escape') {
                    onCloseFind();
                  }
                }}
                placeholder="Find in file..."
                className="bg-transparent text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none w-full font-mono-code"
              />
              <button
                type="button"
                onClick={() => setCaseSensitive((p) => !p)}
                title="Match Case"
                className={`p-0.5 rounded ml-1 ${
                  caseSensitive ? 'bg-[#2E2E2F] text-[#B4B4B8]' : 'text-[#707073] hover:text-[#A6A6AA]'
                }`}
              >
                <CaseSensitive className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="text-[11px] font-mono-code text-[#A6A6AA] min-w-[54px]">
              {searchMatches.length > 0
                ? `${activeMatchIdx + 1} of ${searchMatches.length}`
                : findQuery
                ? '0 results'
                : ''}
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => navigateSearchMatch(-1)}
                disabled={searchMatches.length === 0}
                title="Previous match (Shift+Enter)"
                className="w-6 h-6 flex items-center justify-center rounded bg-[#161617] border border-[#2F2F30] text-[#A6A6AA] hover:text-[#E6E6E8] disabled:opacity-40"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => navigateSearchMatch(1)}
                disabled={searchMatches.length === 0}
                title="Next match (Enter)"
                className="w-6 h-6 flex items-center justify-center rounded bg-[#161617] border border-[#2F2F30] text-[#A6A6AA] hover:text-[#E6E6E8] disabled:opacity-40"
              >
                <ArrowDown className="w-3 h-3" />
              </button>
            </div>

            {/* Replace Input */}
            {isReplaceOpen && (
              <div className="flex items-center gap-1.5">
                <div className="flex items-center bg-[#161617] border border-[#3E3E40] rounded px-2 h-7 w-44 sm:w-52">
                  <Replace className="w-3.5 h-3.5 text-[#707073] mr-1.5 shrink-0" />
                  <input
                    type="text"
                    value={replaceQuery}
                    onChange={(e) => setReplaceQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleReplaceSingle();
                      }
                    }}
                    placeholder="Replace with..."
                    className="bg-transparent text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none w-full font-mono-code"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleReplaceSingle}
                  disabled={searchMatches.length === 0}
                  className="h-7 px-2 rounded bg-[#292929] hover:bg-[#2E2E2F] border border-[#3E3E40] text-[11px] text-[#E6E6E8] disabled:opacity-40"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={handleReplaceAll}
                  disabled={searchMatches.length === 0}
                  className="h-7 px-2 rounded bg-[#292929] hover:bg-[#2E2E2F] border border-[#3E3E40] text-[11px] text-[#E6E6E8] disabled:opacity-40"
                >
                  Replace All
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onCloseFind}
            title="Close Find & Replace (Esc)"
            className="p-1 text-[#707073] hover:text-[#E6E6E8] rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3. Main Synchronized Editor Viewport (Gutter + Code Canvas) */}
      <div
        ref={scrollContainerRef}
        onScroll={schedule_window_update}
        className="flex-1 w-full overflow-y-auto overflow-x-hidden relative bg-[#1B1B1C]"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            x: Math.min(window.innerWidth - 210, e.clientX),
            y: Math.min(window.innerHeight - 280, e.clientY),
          });
        }}
      >
        <div className="relative w-full" style={{ minHeight: `${scroll_area_height}px` }}>
          <div
            aria-hidden="true"
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${GUTTER_WIDTH}px` }}
            className="bg-[#161617] border-r border-[#2F2F30]"
          />

          {plain_big ? (
            <pre
              aria-hidden="true"
              className="editor-typography m-0 relative text-[#E6E6E8]"
              style={{
                pointerEvents: 'none',
                zIndex: 1,
                padding: `${EDITOR_PADDING_TOP}px ${EDITOR_PADDING_LEFT}px ${EDITOR_PADDING_BOTTOM}px ${
                  GUTTER_WIDTH + EDITOR_PADDING_LEFT
                }px`,
              }}
            >
              {code + '\u200b'}
            </pre>
          ) : (
            <div
              ref={rows_ref}
              style={{
                position: 'relative',
                zIndex: 1,
                pointerEvents: 'none',
                paddingTop: `${EDITOR_PADDING_TOP}px`,
                paddingBottom: `${EDITOR_PADDING_BOTTOM}px`,
              }}
            >
              {lines.map((text, idx) => {
                if (idx < win.start - WINDOW_KEEP_MARGIN || idx > win.end + WINDOW_KEEP_MARGIN) {
                  return <PlainRow key={idx} text={text} />;
                }
                const info = displayLineNumbers ? displayLineNumbers[idx] : undefined;
                return (
                  <LineRow
                    key={idx}
                    index={idx}
                    text={text}
                    display_num={info ? info.displayNum : idx + 1}
                    is_current={cursorState.line === idx + 1}
                    tokens={tokens_for(idx)}
                    fold_start={foldStartMap.get(idx)}
                    folded={info?.foldEntry}
                    bracket_cols={bracket_map?.get(idx)}
                    on_fold={on_fold}
                    on_unfold={on_unfold}
                  />
                );
              })}
            </div>
          )}

          {isFindOpen && searchMatches.length > 0 && (
            <pre
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                left: `${GUTTER_WIDTH}px`,
                right: 0,
                zIndex: 2,
                padding: `${EDITOR_PADDING_TOP}px ${EDITOR_PADDING_LEFT}px ${EDITOR_PADDING_BOTTOM}px`,
              }}
              className="editor-typography m-0 pointer-events-none select-none text-transparent"
            >
              <code>
                {(() => {
                  const segments: React.ReactNode[] = [];
                  let cursor = 0;
                  searchMatches.forEach((m, i) => {
                    if (m.start > cursor) {
                      segments.push(code.slice(cursor, m.start));
                    }
                    const isCurrent = i === activeMatchIdx;
                    segments.push(
                      <mark
                        key={i}
                        className={
                          isCurrent
                            ? 'bg-[#C9C9CC]/55 text-transparent ring-1 ring-[#C9C9CC] rounded-[2px]'
                            : 'bg-[#C9C9CC]/25 text-transparent rounded-[2px]'
                        }
                      >
                        {code.slice(m.start, m.end)}
                      </mark>
                    );
                    cursor = m.end;
                  });
                  if (cursor < code.length) {
                    segments.push(code.slice(cursor));
                  }
                  return segments;
                })()}
              </code>
            </pre>
          )}

          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => {
              const newVal = e.target.value;
              const selStart = e.target.selectionStart ?? 0;
              const selEnd = e.target.selectionEnd ?? 0;
              onChangeContent(newVal, selStart, selEnd, true);
              syncCursorFromTextarea(true, newVal);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={() => syncCursorFromTextarea(true)}
            onClick={() => syncCursorFromTextarea(false)}
            onSelect={() => syncCursorFromTextarea(false)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            data-gramm="false"
            aria-label="Code Editor"
            style={{
              position: 'absolute',
              top: 0,
              left: `${GUTTER_WIDTH}px`,
              width: `calc(100% - ${GUTTER_WIDTH}px)`,
              height: '100%',
              zIndex: 3,
              padding: `${EDITOR_PADDING_TOP}px ${EDITOR_PADDING_LEFT}px ${EDITOR_PADDING_BOTTOM}px`,
            }}
            className="editor-typography m-0 bg-transparent text-transparent caret-[#E6E6E8] resize-none border-0 outline-none overflow-hidden selection:bg-[#383839]/80"
          />
        </div>
      </div>

      {/* 4. Ultra-Slim Minimalist Status Bar */}
      <footer className="h-6 min-h-[24px] bg-[#161617] border-t border-[#2F2F30] px-3 flex items-center justify-between text-[11px] font-mono-code text-[#707073] select-none shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[#A6A6AA]">
            Ln {cursorState.line}, Col {cursorState.col}
          </span>
          <span className="hidden sm:inline text-[#707073]">|</span>
          <span className="hidden sm:inline">{lines.length} lines</span>

          {plain_big && (
            <span className="truncate text-[#C9C9CC]" title="Highlighting and line numbers are off for very large files">
              ● Large file
            </span>
          )}
          {lua_family && diagnostics.length > 0 ? (
            <span
              className="truncate text-[#C9C9CC] flex items-center gap-1"
              title={diagnostics[0].message}
            >
              <span>● Ln {diagnostics[0].line}:</span>
              <span className="truncate max-w-[260px]">{diagnostics[0].message}</span>
            </span>
          ) : lua_family ? (
            <span className="hidden md:inline text-[#84A98C]">● Syntax OK</span>
          ) : null}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleAutosave}
            title="Toggle automatic saving"
            className={`hover:text-[#E6E6E8] transition-colors ${
              autosaveEnabled ? 'text-[#B4B4B8]' : 'text-[#707073]'
            }`}
          >
            Autosave: {autosaveEnabled ? 'On' : 'Off'}
          </button>
          <span className="hidden sm:inline">Spaces: 2</span>
          <span className="hidden sm:inline">UTF-8</span>
          <button
            type="button"
            onClick={() => {
              if (lua_family || lang_id === 'plain') {
                onLanguageChange(language === 'luau' ? 'lua' : language === 'lua' ? 'other' : 'luau');
              }
            }}
            title={
              lua_family || lang_id === 'plain'
                ? 'Click to cycle language: Luau → Lua → Other (plain text)'
                : 'Language is detected from the file extension'
            }
            className="text-[#B4B4B8] hover:text-[#E6E6E8] font-medium"
          >
            {lang_label(lang_id)}
          </button>
        </div>
      </footer>

      {/* 5. Custom Context Menu on Right-Click */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed w-52 bg-[#222223] border border-[#3E3E40] rounded shadow-2xl py-1 z-50 text-[12px] text-[#E6E6E8] select-none"
        >
          <button
            type="button"
            onClick={() => executeEditorAction('cut')}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <Scissors className="w-3.5 h-3.5 text-[#A6A6AA]" />
              Cut
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Ctrl+X</span>
          </button>
          <button
            type="button"
            onClick={() => executeEditorAction('copy')}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-[#A6A6AA]" />
              Copy
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Ctrl+C</span>
          </button>
          <button
            type="button"
            onClick={() => executeEditorAction('paste')}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <ClipboardPaste className="w-3.5 h-3.5 text-[#A6A6AA]" />
              Paste
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Ctrl+V</span>
          </button>
          <button
            type="button"
            onClick={() => executeEditorAction('selectAll')}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <CheckSquare className="w-3.5 h-3.5 text-[#A6A6AA]" />
              Select All
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Ctrl+A</span>
          </button>
          <div className="my-1 h-px bg-[#2F2F30]" />
          <button
            type="button"
            onClick={() => executeEditorAction('comment')}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <MessageSquareCode className="w-3.5 h-3.5 text-[#A6A6AA]" />
              Comment Line
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Ctrl+/</span>
          </button>
          <button
            type="button"
            onClick={() => executeEditorAction('indent')}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <IndentIncrease className="w-3.5 h-3.5 text-[#A6A6AA]" />
              Indent
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Tab</span>
          </button>
          <button
            type="button"
            onClick={() => executeEditorAction('outdent')}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <IndentDecrease className="w-3.5 h-3.5 text-[#A6A6AA]" />
              Outdent
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Shift+Tab</span>
          </button>
          <div className="my-1 h-px bg-[#2F2F30]" />
          <button
            type="button"
            onClick={() => executeEditorAction('duplicateLine')}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <CopyPlus className="w-3.5 h-3.5 text-[#A6A6AA]" />
              Duplicate Line
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Shift+Alt+↓</span>
          </button>
          <button
            type="button"
            onClick={() => executeEditorAction('deleteLine')}
            className="w-full px-3 py-1.5 flex items-center justify-between text-[#C88D85] hover:bg-[#2E2E2F]"
          >
            <span className="flex items-center gap-2">
              <Trash2 className="w-3.5 h-3.5" />
              Delete Line
            </span>
            <span className="text-[10px] font-mono-code text-[#707073]">Ctrl+Shift+K</span>
          </button>
        </div>
      )}
    </div>
  );
};
