import React, { useState } from 'react';
import { Puzzle, X, RefreshCw } from 'lucide-react';

interface PluginsPanelProps {
  onClosePanel: () => void;
}

export const PluginsPanel: React.FC<PluginsPanelProps> = ({ onClosePanel }) => {
  const [scanning, setScanning] = useState(false);

  const handleRefresh = () => {
    setScanning(true);
    setTimeout(() => setScanning(false), 350);
  };

  return (
    <aside className="w-full h-full min-h-0 bg-[#222223] border-b border-[#2F2F30] flex flex-col select-none shrink-0 z-30">
      {/* Header */}
      <div className="h-9 px-3 border-b border-[#2F2F30] flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A6AA]">
          Plugins
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleRefresh}
            title="Scan plugin directory"
            className="p-1 text-[#707073] hover:text-[#E6E6E8] hover:bg-[#2E2E2F] rounded transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin text-[#B4B4B8]' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onClosePanel}
            title="Close panel"
            className="p-1 text-[#707073] hover:text-[#E6E6E8] hover:bg-[#2E2E2F] rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Empty State Body */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-10 h-10 rounded-full bg-[#161617] border border-[#2F2F30] flex items-center justify-center mb-3">
          <Puzzle className="w-4 h-4 text-[#707073]" />
        </div>
        <p className="text-[13px] font-medium text-[#E6E6E8]">No plugins installed yet.</p>
        <p className="mt-1.5 text-[11px] text-[#707073] leading-relaxed max-w-[210px]">
          Lua &amp; Luau language support, syntax highlighting, and code folding are built into the core editor.
        </p>
      </div>

      {/* Footer Info */}
      <div className="px-3 py-2 border-t border-[#2F2F30] bg-[#161617]/60 flex items-center justify-between text-[10px] font-mono-code text-[#707073]">
        <span>Host API v1.4</span>
        <span>0 active</span>
      </div>
    </aside>
  );
};
