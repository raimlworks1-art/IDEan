import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
import { FileItem, LanguageMode, SyntaxDiagnostic } from '../types/ide';
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
const EDITOR_PADDING_LEFT = 20;
const APPROX_CHAR_WIDTH = 8.1;

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

  const code = activeFile.content;
  const language = activeFile.language;
  const commentMarker = language === 'other' ? '//' : '--';

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

  // Compute foldable regions
  const foldRegions = useMemo(
    () => (language === 'other' ? [] : computeFoldRegions(code)),
    [code, language]
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
    const nums: { displayNum: number; foldEntry?: FoldedEntry }[] = [];
    let currentLineNum = 1;
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      let matchedFold: FoldedEntry | undefined;
      for (const entry of Object.values(foldedEntries)) {
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
    if (cursorState.selStart !== cursorState.selEnd) return null;
    return findMatchingBracket(code, cursorState.selStart);
  }, [code, cursorState.selStart, cursorState.selEnd]);

  /**
   * Intelligent Cursor-Following Scroll Engine (Section 7)
   * Keeps cursor visible when creating new lines or approaching bottom/top edges,
   * while avoiding unnecessary jumps when editing lines comfortably in view.
   */
  const ensureCursorVisible = useCallback(
    (targetOffset: number, textContent: string, forceSmooth = false) => {
      const scrollEl = scrollContainerRef.current;
      if (!scrollEl) return;

      const textBefore = textContent.slice(0, targetOffset);
      const linesBefore = textBefore.split('\n');
      const lineIdx = linesBefore.length - 1;
      const colIdx = linesBefore[linesBefore.length - 1].length;

      const cursorTop = EDITOR_PADDING_TOP + lineIdx * LINE_HEIGHT;
      const cursorBottom = cursorTop + LINE_HEIGHT;

      const viewportHeight = scrollEl.clientHeight;
      const currentScrollTop = scrollEl.scrollTop;

      // Safe zones: 3 lines (66px) from bottom, 1.5 lines (33px) from top
      const bottomBuffer = Math.min(72, Math.max(LINE_HEIGHT * 2, Math.floor(viewportHeight * 0.22)));
      const topBuffer = 32;

      // First 10 lines rule: maintain calm top viewport when editing near top and viewport fits 10+ lines
      if (
        lineIdx < 10 &&
        currentScrollTop === 0 &&
        cursorBottom <= viewportHeight - bottomBuffer
      ) {
        // Keep scrollTop at 0
      } else if (cursorBottom > currentScrollTop + viewportHeight - bottomBuffer) {
        // Cursor is approaching or below the bottom of the visible editor area -> scroll down
        const desiredScrollTop = cursorBottom - viewportHeight + bottomBuffer + 8;
        if (forceSmooth) {
          scrollEl.scrollTo({ top: desiredScrollTop, behavior: 'smooth' });
        } else {
          scrollEl.scrollTop = desiredScrollTop;
        }
      } else if (cursorTop < currentScrollTop + topBuffer) {
        // Cursor moved above top visible safe zone -> scroll up
        const desiredScrollTop = Math.max(0, cursorTop - topBuffer);
        scrollEl.scrollTop = desiredScrollTop;
      }

      // Horizontal scroll tracking
      const gutterWidth = 52;
      const cursorLeft = EDITOR_PADDING_LEFT + colIdx * APPROX_CHAR_WIDTH;
      const visibleCodeWidth = Math.max(120, scrollEl.clientWidth - gutterWidth);
      const currentScrollLeft = scrollEl.scrollLeft;

      if (colIdx <= 4) {
        if (currentScrollLeft > 0) scrollEl.scrollLeft = 0;
      } else if (cursorLeft > currentScrollLeft + visibleCodeWidth - 48) {
        scrollEl.scrollLeft = cursorLeft - visibleCodeWidth + 64;
      } else if (cursorLeft < currentScrollLeft + 24) {
        scrollEl.scrollLeft = Math.max(0, cursorLeft - 32);
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

      const before = currentText.slice(0, selEnd);
      const splitLines = before.split('\n');
      const line = splitLines.length;
      const col = splitLines[splitLines.length - 1].length + 1;

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
          const before = result.newText.slice(0, result.selectionEnd);
          const splitLines = before.split('\n');
          setCursorState({
            selStart: result.selectionStart,
            selEnd: result.selectionEnd,
            line: splitLines.length,
            col: splitLines[splitLines.length - 1].length + 1,
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
      const res = handleSmartEnter(code, selStart, selEnd, language === 'other');
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

  // Tokenize full code for the syntax-highlighted mirror layer
  const tokens = useMemo(() => tokenizeLua(code, language), [code, language]);

  // Render tokens with bracket matching & folded block pills
  const renderedSyntaxNodes = useMemo(() => {
    const bracketSet = new Set<number>();
    if (matchedBrackets) {
      bracketSet.add(matchedBrackets[0]);
      bracketSet.add(matchedBrackets[1]);
    }

    return tokens.map((token, idx) => {
      const colorClass = getTokenColorClass(token.type);

      // Check if this comment token is a folded block marker
      if (token.type === 'comment' && token.value.startsWith('--[[▸ folded:')) {
        const foldEntry = Object.values(foldedEntries).find((e) => e.markerText === token.value);
        if (foldEntry) {
          return (
            <span
              key={idx}
              className="inline-flex items-center px-1.5 py-0 rounded bg-[#2E2E2F] text-[#B4B4B8] border border-[#3E3E40] text-[11px]"
            >
              {token.value}
            </span>
          );
        }
      }

      // Check if this token contains one of the matched brackets
      if (
        matchedBrackets &&
        (token.start <= matchedBrackets[0] && matchedBrackets[0] < token.end ||
          token.start <= matchedBrackets[1] && matchedBrackets[1] < token.end)
      ) {
        // Usually bracket tokens have length 1
        if (token.value.length === 1 && bracketSet.has(token.start)) {
          return (
            <span
              key={idx}
              className={`${colorClass} bg-[#3E3E40] text-[#E6E6E8] ring-1 ring-[#B4B4B8]/70 rounded-[2px]`}
            >
              {token.value}
            </span>
          );
        }
      }

      return (
        <span key={idx} className={colorClass}>
          {token.value}
        </span>
      );
    });
  }, [tokens, matchedBrackets, foldedEntries]);

  // Calculate max line width so horizontal scrolling works cleanly without wrapping
  const maxLineChars = useMemo(() => {
    let max = 40;
    for (const l of lines) {
      if (l.length > max) max = l.length;
    }
    return max;
  }, [lines]);

  const contentHeightPx = Math.max(320, lines.length * LINE_HEIGHT + EDITOR_PADDING_TOP * 2 + 160);
  const contentWidthPx = Math.max(300, maxLineChars * APPROX_CHAR_WIDTH + EDITOR_PADDING_LEFT * 2 + 64);

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
        className="flex-1 w-full overflow-auto relative bg-[#1B1B1C]"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            x: Math.min(window.innerWidth - 210, e.clientX),
            y: Math.min(window.innerHeight - 280, e.clientY),
          });
        }}
      >
        <div
          className="flex min-w-full relative"
          style={{ minHeight: `${contentHeightPx}px` }}
        >
          {/* LEFT: Synchronized Line Numbers Gutter (Sticky horizontally, scrolls vertically in lockstep) */}
          <div
            aria-hidden="true"
            style={{
              paddingTop: `${EDITOR_PADDING_TOP}px`,
              paddingBottom: `${EDITOR_PADDING_TOP}px`,
            }}
            className="sticky left-0 z-10 w-[54px] min-w-[54px] bg-[#161617] border-r border-[#2F2F30] select-none shrink-0"
          >
            {lines.map((_, idx) => {
              const lineNumberInfo = displayLineNumbers[idx];
              const isCurrentLine = cursorState.line === idx + 1;
              const foldStart = foldStartMap.get(idx);
              const foldedHere = lineNumberInfo?.foldEntry;

              return (
                <div
                  key={idx}
                  style={{ height: `${LINE_HEIGHT}px`, lineHeight: `${LINE_HEIGHT}px` }}
                  className={`pr-2 pl-1.5 flex items-center justify-between font-mono-code text-[12px] transition-colors ${
                    isCurrentLine
                      ? 'bg-[#242425] text-[#E6E6E8] font-medium border-l-2 border-l-[#B4B4B8]'
                      : 'text-[#707073]'
                  }`}
                >
                  {/* Code Folding Toggle Button */}
                  <div className="w-3.5 h-full flex items-center justify-center">
                    {foldedHere ? (
                      <button
                        type="button"
                        onClick={() => handleUnfoldBlock(foldedHere)}
                        title={`Expand folded block (${foldedHere.lineCount} lines)`}
                        className="text-[#B4B4B8] hover:text-[#E6E6E8]"
                      >
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    ) : foldStart ? (
                      <button
                        type="button"
                        onClick={() =>
                          handleFoldBlock(idx, foldStart.endLine, foldStart.label)
                        }
                        title={`Fold ${foldStart.kind} block (lines ${idx + 1}–${foldStart.endLine + 1})`}
                        className="text-[#707073] hover:text-[#E6E6E8]"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    ) : null}
                  </div>

                  <span>{lineNumberInfo ? lineNumberInfo.displayNum : idx + 1}</span>
                </div>
              );
            })}
          </div>

          {/* RIGHT: Main Code Canvas with Active Line Highlight, Syntax Mirror, and Transparent Textarea */}
          <div
            className="relative flex-1"
            style={{
              minWidth: `${contentWidthPx}px`,
              height: `${contentHeightPx}px`,
            }}
          >
            {/* Active Line Highlight Band */}
            <div
              aria-hidden="true"
              style={{
                top: `${EDITOR_PADDING_TOP + (cursorState.line - 1) * LINE_HEIGHT}px`,
                height: `${LINE_HEIGHT}px`,
              }}
              className="absolute left-0 right-0 bg-[#242425] pointer-events-none z-0"
            />

            {/* Search Matches Highlight Backdrop Layer */}
            {isFindOpen && searchMatches.length > 0 && (
              <pre
                aria-hidden="true"
                style={{
                  paddingTop: `${EDITOR_PADDING_TOP}px`,
                  paddingBottom: `${EDITOR_PADDING_TOP}px`,
                  paddingLeft: `${EDITOR_PADDING_LEFT}px`,
                  paddingRight: `${EDITOR_PADDING_LEFT}px`,
                }}
                className="editor-typography m-0 pointer-events-none select-none absolute inset-0 text-transparent z-0"
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

            {/* Syntax Highlighted Mirror Layer */}
            <pre
              aria-hidden="true"
              style={{
                paddingTop: `${EDITOR_PADDING_TOP}px`,
                paddingBottom: `${EDITOR_PADDING_TOP}px`,
                paddingLeft: `${EDITOR_PADDING_LEFT}px`,
                paddingRight: `${EDITOR_PADDING_LEFT}px`,
              }}
              className="editor-typography m-0 pointer-events-none select-none relative z-1 min-h-full"
            >
              <code>{renderedSyntaxNodes}</code>
            </pre>

            {/* Interactive Transparent Textarea (Handles native input, blinking caret, and selection) */}
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
                paddingTop: `${EDITOR_PADDING_TOP}px`,
                paddingBottom: `${EDITOR_PADDING_TOP}px`,
                paddingLeft: `${EDITOR_PADDING_LEFT}px`,
                paddingRight: `${EDITOR_PADDING_LEFT}px`,
              }}
              className="editor-typography absolute inset-0 w-full h-full m-0 bg-transparent text-transparent caret-[#E6E6E8] resize-none border-0 outline-none overflow-hidden z-2 selection:bg-[#383839]/80"
            />
          </div>
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

          {diagnostics.length > 0 ? (
            <span
              className="truncate text-[#C9C9CC] flex items-center gap-1"
              title={diagnostics[0].message}
            >
              <span>● Ln {diagnostics[0].line}:</span>
              <span className="truncate max-w-[260px]">{diagnostics[0].message}</span>
            </span>
          ) : (
            <span className="hidden md:inline text-[#84A98C]">● Syntax OK</span>
          )}
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
            onClick={() =>
              onLanguageChange(language === 'luau' ? 'lua' : language === 'lua' ? 'other' : 'luau')
            }
            title="Click to cycle language: Luau → Lua → Other (plain text)"
            className="text-[#B4B4B8] hover:text-[#E6E6E8] font-medium"
          >
            {language === 'luau' ? 'Luau (--!strict)' : language === 'lua' ? 'Lua 5.4' : 'Other (plain)'}
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
