import React from 'react';
import { Undo2, Redo2, FolderKanban, Puzzle, GitBranch } from 'lucide-react';
import { FileItem, LanguageMode, NavPanel } from '../types/ide';
import { LANGUAGE_OPTIONS, mode_for_name } from '../utils/languages';

interface TopHeaderProps {
  activeFile: FileItem | null;
  activePanel: NavPanel;
  onTogglePanel: (panel: Exclude<NavPanel, null>) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onLanguageChange: (lang: LanguageMode) => void;
  gitChangesCount: number;
  onRenameActiveFile?: () => void;
}

function formatEditedTime(timestamp?: number): string {
  if (!timestamp) return 'Not edited';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return 'Edited just now';
  if (diffSec < 60) return `Edited ${diffSec}s ago`;

  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `Edited ${hh}:${mm}:${ss}`;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeFile,
  activePanel,
  onTogglePanel,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onLanguageChange,
  gitChangesCount,
  onRenameActiveFile,
}) => {
  // Show the name of the file currently open; fall back to the app name when nothing is open
  const hasFile = Boolean(activeFile);
  const fullName = activeFile?.name || '???';
  const lastDotIdx = fullName.lastIndexOf('.');
  const baseName = hasFile && lastDotIdx > 0 ? fullName.slice(0, lastDotIdx) : fullName;
  const extension = hasFile && lastDotIdx > 0 ? fullName.slice(lastDotIdx) : '';

  const isDirty = activeFile ? activeFile.content !== activeFile.savedContent : false;
  const currentLang: LanguageMode = activeFile?.language || 'other';
  const effective_lang: LanguageMode =
    currentLang === 'other' && activeFile ? mode_for_name(activeFile.name) ?? 'other' : currentLang;

  return (
    <header className="h-11 min-h-[44px] w-full bg-[#222223] px-3 flex items-center justify-between gap-2 select-none z-20">
      {/* LEFT SIDE: File Name, Extension, Unsaved Changes Indicator, Language Selector */}
      <div className="flex items-center gap-2 min-w-0 shrink">
        <div
          onClick={onRenameActiveFile}
          title={hasFile ? `${fullName} (click to open Projects)` : 'S. Box'}
          className="flex items-center gap-1.5 min-w-0 cursor-pointer group px-1 py-1 rounded hover:bg-[#292929] transition-colors duration-150"
        >
          <span className="text-[13px] font-medium text-[#E6E6E8] truncate max-w-[110px] sm:max-w-[220px]">
            {baseName}
          </span>
          {extension && (
            <span className="text-[11px] font-mono-code px-1.5 py-0.5 rounded bg-[#161617] text-[#B4B4B8] border border-[#2F2F30] shrink-0">
              {extension}
            </span>
          )}
          {isDirty && (
            <span
              title="Unsaved changes"
              aria-label="Unsaved changes"
              className="w-2 h-2 rounded-full bg-[#C9C9CC] shrink-0 ml-0.5 transition-transform duration-150"
            />
          )}
        </div>

        {/* Language selector */}
        <select
          value={effective_lang}
          onChange={(e) => onLanguageChange(e.target.value as LanguageMode)}
          title="Switch the language of the open file"
          className="hidden sm:block bg-[#161617] border border-[#2F2F30] rounded px-1.5 py-1 text-[11px] font-mono-code text-[#B4B4B8] outline-none shrink-0"
        >
          {LANGUAGE_OPTIONS.map((o) => (
            <option key={o.mode} value={o.mode}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* CENTER: Main Navigation Buttons (Projects | Plugins | Git) */}
      <nav
        aria-label="Main IDE Navigation"
        className="flex items-center justify-center gap-0.5 bg-[#161617] p-0.5 rounded border border-[#2F2F30] min-w-0 overflow-x-auto no-scrollbar"
      >
        <button
          type="button"
          onClick={() => onTogglePanel('projects')}
          className={`flex items-center gap-1 px-2 py-1 shrink-0 rounded-xs text-[12px] font-medium transition-colors duration-120 ${
            activePanel === 'projects'
              ? 'bg-[#2E2E2F] text-[#E6E6E8] shadow-2xs'
              : 'text-[#A6A6AA] hover:text-[#E6E6E8] hover:bg-[#222223]'
          }`}
        >
          <FolderKanban className="w-3.5 h-3.5 text-[#B4B4B8]" />
          <span>Projects</span>
        </button>

        <button
          type="button"
          onClick={() => onTogglePanel('plugins')}
          className={`flex items-center gap-1 px-2 py-1 shrink-0 rounded-xs text-[12px] font-medium transition-colors duration-120 ${
            activePanel === 'plugins'
              ? 'bg-[#2E2E2F] text-[#E6E6E8] shadow-2xs'
              : 'text-[#A6A6AA] hover:text-[#E6E6E8] hover:bg-[#222223]'
          }`}
        >
          <Puzzle className="w-3.5 h-3.5 text-[#A6A6AA]" />
          <span>Plugins</span>
        </button>

        <button
          type="button"
          onClick={() => onTogglePanel('git')}
          className={`flex items-center gap-1 px-2 py-1 shrink-0 rounded-xs text-[12px] font-medium transition-colors duration-120 ${
            activePanel === 'git'
              ? 'bg-[#2E2E2F] text-[#E6E6E8] shadow-2xs'
              : 'text-[#A6A6AA] hover:text-[#E6E6E8] hover:bg-[#222223]'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5 text-[#B4B4B8]" />
          <span>Git</span>
          {gitChangesCount > 0 && (
            <span className="ml-0.5 px-1.5 py-0 text-[10px] font-mono-code rounded-full bg-[#2E2E2F] text-[#C9C9CC] border border-[#3E3E40]">
              {gitChangesCount}
            </span>
          )}
        </button>
      </nav>

      {/* RIGHT SIDE: Last Edited Timestamp + Small Undo & Redo Icon Buttons */}
      <div className="flex items-center justify-end gap-2 shrink-0">
        <span
          className="hidden md:inline-block text-[11px] font-mono-code text-[#707073] truncate"
          title={
            activeFile?.lastModified
              ? `Last modified: ${new Date(activeFile.lastModified).toLocaleString()}`
              : 'No edits yet'
          }
        >
          {formatEditedTime(activeFile?.lastModified)}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className={`w-7 h-7 flex items-center justify-center rounded border border-transparent transition-colors duration-120 ${
              canUndo
                ? 'text-[#E6E6E8] hover:bg-[#2E2E2F] hover:border-[#3E3E40] active:bg-[#383839]'
                : 'text-[#707073]/40 cursor-not-allowed'
            }`}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
            aria-label="Redo"
            className={`w-7 h-7 flex items-center justify-center rounded border border-transparent transition-colors duration-120 ${
              canRedo
                ? 'text-[#E6E6E8] hover:bg-[#2E2E2F] hover:border-[#3E3E40] active:bg-[#383839]'
                : 'text-[#707073]/40 cursor-not-allowed'
            }`}
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
