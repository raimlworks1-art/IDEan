import React, { useState, useRef, useEffect } from 'react';
import {
  Scissors,
  Copy,
  ClipboardPaste,
  Save,
  CheckSquare,
  Search,
  Replace,
  IndentIncrease,
  IndentDecrease,
  MessageSquareCode,
  MessageSquareOff,
  CopyPlus,
  Trash2,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
} from 'lucide-react';

export type ToolbarActionType =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'save'
  | 'selectAll'
  | 'find'
  | 'replace'
  | 'indent'
  | 'outdent'
  | 'comment'
  | 'uncomment'
  | 'duplicateLine'
  | 'deleteLine'
  | 'moveLineUp'
  | 'moveLineDown'
  | 'insert;'
  | 'insert|'
  | 'insert:'
  | 'insert()'
  | 'insert{}'
  | 'insert[]'
  | 'insert""';

interface EditorToolbarProps {
  onAction: (action: ToolbarActionType) => void;
  isFindOpen: boolean;
  isReplaceOpen: boolean;
  isDirty: boolean;
}

interface ActionConfig {
  id: ToolbarActionType;
  label: string;
  shortLabel?: string;
  tooltip: string;
  icon?: React.ReactNode;
  isMono?: boolean;
  group: 'clipboard' | 'search' | 'indent' | 'lines' | 'symbols';
}

const TOOLBAR_ACTIONS: ActionConfig[] = [
  {
    id: 'cut',
    label: 'Cut',
    tooltip: 'Cut selected text or current line to clipboard (Ctrl+X)',
    icon: <Scissors className="w-3 h-3" />,
    group: 'clipboard',
  },
  {
    id: 'copy',
    label: 'Copy',
    tooltip: 'Copy selected text or current line to clipboard (Ctrl+C)',
    icon: <Copy className="w-3 h-3" />,
    group: 'clipboard',
  },
  {
    id: 'paste',
    label: 'Paste',
    tooltip: 'Paste clipboard contents at cursor position (Ctrl+V)',
    icon: <ClipboardPaste className="w-3 h-3" />,
    group: 'clipboard',
  },
  {
    id: 'save',
    label: 'Save',
    tooltip: 'Save changes to current file (Ctrl+S)',
    icon: <Save className="w-3 h-3" />,
    group: 'clipboard',
  },
  {
    id: 'selectAll',
    label: 'Select All',
    tooltip: 'Select all code in the current editor buffer (Ctrl+A)',
    icon: <CheckSquare className="w-3 h-3" />,
    group: 'clipboard',
  },
  {
    id: 'find',
    label: 'Find',
    tooltip: 'Find text in current file (Ctrl+F)',
    icon: <Search className="w-3 h-3" />,
    group: 'search',
  },
  {
    id: 'replace',
    label: 'Replace',
    tooltip: 'Find and replace text in current file (Ctrl+H)',
    icon: <Replace className="w-3 h-3" />,
    group: 'search',
  },
  {
    id: 'indent',
    label: 'Indent',
    tooltip: 'Indent current line or selected lines by 2 spaces (Tab)',
    icon: <IndentIncrease className="w-3 h-3" />,
    group: 'indent',
  },
  {
    id: 'outdent',
    label: 'Outdent',
    tooltip: 'Outdent current line or selected lines by 2 spaces (Shift+Tab)',
    icon: <IndentDecrease className="w-3 h-3" />,
    group: 'indent',
  },
  {
    id: 'comment',
    label: 'Comment',
    tooltip: 'Prefix current or selected lines with Lua comment "-- " (Ctrl+/)',
    icon: <MessageSquareCode className="w-3 h-3" />,
    group: 'indent',
  },
  {
    id: 'uncomment',
    label: 'Uncomment',
    tooltip: 'Remove leading "--" comment prefix from selected lines',
    icon: <MessageSquareOff className="w-3 h-3" />,
    group: 'indent',
  },
  {
    id: 'duplicateLine',
    label: 'Duplicate Line',
    shortLabel: 'Dup Line',
    tooltip: 'Duplicate current line or selected block downward (Shift+Alt+Down)',
    icon: <CopyPlus className="w-3 h-3" />,
    group: 'lines',
  },
  {
    id: 'deleteLine',
    label: 'Delete Line',
    shortLabel: 'Del Line',
    tooltip: 'Delete the entire current line or selected lines (Ctrl+Shift+K)',
    icon: <Trash2 className="w-3 h-3" />,
    group: 'lines',
  },
  {
    id: 'moveLineUp',
    label: 'Move Line Up',
    shortLabel: 'Line Up',
    tooltip: 'Move current line or selected lines up one row (Alt+Up)',
    icon: <ArrowUp className="w-3 h-3" />,
    group: 'lines',
  },
  {
    id: 'moveLineDown',
    label: 'Move Line Down',
    shortLabel: 'Line Down',
    tooltip: 'Move current line or selected lines down one row (Alt+Down)',
    icon: <ArrowDown className="w-3 h-3" />,
    group: 'lines',
  },
  {
    id: 'insert;',
    label: ';',
    tooltip: 'Insert semicolon ";" statement separator at cursor',
    isMono: true,
    group: 'symbols',
  },
  {
    id: 'insert|',
    label: '|',
    tooltip: 'Insert pipe "|" Luau union type operator at cursor',
    isMono: true,
    group: 'symbols',
  },
  {
    id: 'insert:',
    label: ':',
    tooltip: 'Insert colon ":" method call or Luau type annotation separator',
    isMono: true,
    group: 'symbols',
  },
  {
    id: 'insert()',
    label: '()',
    tooltip: 'Insert parentheses "()" or wrap current selection',
    isMono: true,
    group: 'symbols',
  },
  {
    id: 'insert{}',
    label: '{}',
    tooltip: 'Insert table curly braces "{}" or wrap current selection',
    isMono: true,
    group: 'symbols',
  },
  {
    id: 'insert[]',
    label: '[]',
    tooltip: 'Insert square brackets "[]" or wrap current selection',
    isMono: true,
    group: 'symbols',
  },
  {
    id: 'insert""',
    label: '""',
    tooltip: 'Insert double quotes \'""\' or wrap current selection as string',
    isMono: true,
    group: 'symbols',
  },
];

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  onAction,
  isFindOpen,
  isReplaceOpen,
  isDirty,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const [hoveredTooltip, setHoveredTooltip] = useState<{ text: string; x: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    if (moreOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreOpen]);

  const renderToolbarButton = (item: ActionConfig) => {
    const isActive =
      (item.id === 'find' && isFindOpen && !isReplaceOpen) ||
      (item.id === 'replace' && isReplaceOpen);

    const highlightSave = item.id === 'save' && isDirty;

    return (
      <button
        key={item.id}
        type="button"
        onMouseDown={(e) => {
          // Keep focus & selection inside the code editor textarea
          e.preventDefault();
        }}
        onClick={() => onAction(item.id)}
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoveredTooltip({ text: item.tooltip, x: Math.max(12, Math.min(window.innerWidth - 280, rect.left)) });
        }}
        onMouseLeave={() => setHoveredTooltip(null)}
        title={item.tooltip}
        aria-label={item.tooltip}
        className={`h-6 px-2 rounded-xs flex items-center gap-1 text-[11px] shrink-0 border transition-colors duration-100 ${
          item.isMono ? 'font-mono-code text-[11.5px] px-2 font-medium' : 'font-normal'
        } ${
          isActive
            ? 'bg-[#2E2E2F] text-[#E6E6E8] border-[#3E3E40]'
            : highlightSave
            ? 'bg-[#292929] text-[#C9C9CC] border-[#3E3E40] hover:bg-[#2E2E2F]'
            : 'bg-transparent text-[#A6A6AA] border-transparent hover:bg-[#292929] hover:text-[#E6E6E8] hover:border-[#2F2F30] active:bg-[#383839]'
        }`}
      >
        {item.icon}
        <span>{item.shortLabel || item.label}</span>
      </button>
    );
  };

  const groups: ActionConfig['group'][] = ['clipboard', 'search', 'indent', 'lines', 'symbols'];

  return (
    <div className="relative w-full bg-[#1E1E1F] select-none z-10">
      <div className="h-9 min-h-[36px] px-2 flex items-center justify-between gap-1">
        {/* Scrollable compact action strip with all 22 coding actions */}
        <div className="flex items-center gap-0.5 overflow-x-auto thin-scrollbar py-1 flex-1">
          {groups.map((grp, gIdx) => {
            const items = TOOLBAR_ACTIONS.filter((a) => a.group === grp);
            return (
              <React.Fragment key={grp}>
                {gIdx > 0 && (
                  <div className="h-3.5 w-px bg-[#2F2F30] mx-1 shrink-0" aria-hidden="true" />
                )}
                {items.map(renderToolbarButton)}
              </React.Fragment>
            );
          })}
        </div>

        {/* "More" Quick Menu button on the right for compact/grouped access */}
        <div className="relative shrink-0 pl-1 border-l border-[#2F2F30]" ref={moreRef}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMoreOpen((prev) => !prev)}
            title="More editor actions & quick reference"
            className={`h-6 px-2 rounded-xs flex items-center gap-1 text-[11px] border transition-colors duration-100 ${
              moreOpen
                ? 'bg-[#2E2E2F] text-[#E6E6E8] border-[#3E3E40]'
                : 'text-[#A6A6AA] border-transparent hover:bg-[#292929] hover:text-[#E6E6E8]'
            }`}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
            <span>More</span>
          </button>

          {moreOpen && (
            <div className="absolute right-0 top-8 w-64 bg-[#222223] border border-[#3E3E40] rounded shadow-xl py-1.5 z-50 max-h-[75vh] overflow-y-auto">
              <div className="px-3 py-1 text-[10px] font-mono-code uppercase tracking-wider text-[#707073]">
                All Coding Actions
              </div>
              {TOOLBAR_ACTIONS.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onAction(act.id);
                    setMoreOpen(false);
                  }}
                  title={act.tooltip}
                  className="w-full px-3 py-1.5 text-left flex items-center justify-between text-[12px] text-[#E6E6E8] hover:bg-[#2E2E2F] transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-4 flex items-center justify-center text-[#A6A6AA]">
                      {act.icon || <span className="font-mono-code text-[11px]">{act.label}</span>}
                    </span>
                    <span>{act.id.startsWith('insert') ? `Insert "${act.label}"` : act.label}</span>
                  </span>
                  <span className="text-[10px] text-[#707073] font-mono-code truncate max-w-[95px]">
                    {act.tooltip.match(/\(([^)]+)\)$/)?.[1] || ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Subtle status tooltip pill when hovering toolbar buttons */}
      {hoveredTooltip && (
        <div
          style={{ left: hoveredTooltip.x }}
          className="hidden sm:block fixed top-[82px] pointer-events-none z-50 px-2.5 py-1 rounded bg-[#161617] border border-[#3E3E40] text-[11px] text-[#E6E6E8] shadow-lg whitespace-nowrap"
        >
          {hoveredTooltip.text}
        </div>
      )}
    </div>
  );
};
