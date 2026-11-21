import React, { useState, useMemo, useRef } from 'react';
import {
  GitBranch,
  GitCommitHorizontal,
  Plus,
  Minus,
  RotateCcw,
  Check,
  X,
  FileDiff,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  LogOut,
  Download,
  UploadCloud,
  Loader2,
} from 'lucide-react';
import { FileItem, GitAuth, Project } from '../../types/ide';
import {
  DeviceCode,
  isOAuthConfigured,
  loadOAuthConfig,
  pollDeviceToken,
  saveOAuthConfig,
  startDeviceFlow,
} from '../../utils/github';

export interface GitChangeItem {
  fileId: string;
  name: string;
  status: 'M' | 'A' | 'D';
  oldContent: string;
  newContent: string;
}

interface GitPanelProps {
  activeProject: Project;
  onStageFile: (fileId: string) => void;
  onUnstageFile: (fileId: string) => void;
  onStageAll: (fileIds: string[]) => void;
  onUnstageAll: () => void;
  onDiscardChanges: (fileId: string, oldContent: string, status: 'M' | 'A' | 'D') => void;
  onCommit: (message: string) => void;
  onSelectFile: (fileId: string) => void;
  onClosePanel: () => void;
  auth: GitAuth | null;
  onLogin: (token: string) => Promise<string>;
  onLogout: () => void;
  onClone: (ownerRepo: string) => Promise<string>;
  onPublish: (repoName: string, isPrivate: boolean) => Promise<string>;
  onPush: () => Promise<string>;
  onPull: () => Promise<string>;
}

function computeSimpleDiff(oldText: string, newText: string) {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];
  const diffRows: { type: 'same' | 'add' | 'del'; text: string; lineNo: number }[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n && o !== undefined) {
      // Only keep context near changes
      diffRows.push({ type: 'same', text: o, lineNo: i + 1 });
    } else {
      if (o !== undefined) {
        diffRows.push({ type: 'del', text: o, lineNo: i + 1 });
      }
      if (n !== undefined) {
        diffRows.push({ type: 'add', text: n, lineNo: i + 1 });
      }
    }
  }

  // Filter to show changed lines plus 1 line of surrounding context
  return diffRows.filter((row, idx, arr) => {
    if (row.type !== 'same') return true;
    const prevChanged = arr[idx - 1] && arr[idx - 1].type !== 'same';
    const nextChanged = arr[idx + 1] && arr[idx + 1].type !== 'same';
    return prevChanged || nextChanged;
  });
}

export const GitPanel: React.FC<GitPanelProps> = ({
  activeProject,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onDiscardChanges,
  onCommit,
  onSelectFile,
  onClosePanel,
  auth,
  onLogin,
  onLogout,
  onClone,
  onPublish,
  onPush,
  onPull,
}) => {
  const [tokenInput, setTokenInput] = useState('');
  const [cloneInput, setCloneInput] = useState('');
  const [repoName, setRepoName] = useState('');
  const [repoPrivate, setRepoPrivate] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [oauthCfg, setOauthCfg] = useState(() => loadOAuthConfig());
  const [showSetup, setShowSetup] = useState(false);
  const [showTokenLogin, setShowTokenLogin] = useState(false);
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancelBrowserLogin = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDevice(null);
    setBusy(null);
  };

  const startBrowserLogin = async () => {
    setRemoteMsg(null);
    setBusy('login');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const dc = await startDeviceFlow(oauthCfg);
      setDevice(dc);
      try {
        await navigator.clipboard?.writeText(dc.user_code);
      } catch {
        /* clipboard may be blocked */
      }
      window.open(dc.verification_uri, '_blank', 'noopener');
      const token = await pollDeviceToken(oauthCfg, dc, ctrl.signal);
      const msg = await onLogin(token);
      setRemoteMsg({ text: msg, error: false });
    } catch (err) {
      const m = (err as Error).message;
      if (m !== 'cancelled') setRemoteMsg({ text: m || 'Login failed', error: true });
    } finally {
      setDevice(null);
      setBusy(null);
      abortRef.current = null;
    }
  };
  const [remoteMsg, setRemoteMsg] = useState<{ text: string; error: boolean } | null>(null);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setRemoteMsg(null);
    try {
      const text = await fn();
      setRemoteMsg({ text, error: false });
    } catch (err) {
      setRemoteMsg({ text: (err as Error).message || 'Something went wrong', error: true });
    } finally {
      setBusy(null);
    }
  };

  const hasProject = Boolean(activeProject.id);
  const remote = activeProject.remote;
  const head = activeProject.commits[0];
  const unpushed = Boolean(remote && head && remote.pushedCommitId !== head.id);

  const [commitMessage, setCommitMessage] = useState('');
  const [inspectedFileId, setInspectedFileId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);

  const headSnapshot = useMemo(() => {
    return activeProject.commits[0]?.snapshot || {};
  }, [activeProject.commits]);

  const changes = useMemo<GitChangeItem[]>(() => {
    const list: GitChangeItem[] = [];
    const currentFiles = activeProject.nodes.filter((n): n is FileItem => n.type === 'file');
    const seenIds = new Set<string>();

    for (const file of currentFiles) {
      seenIds.add(file.id);
      const snap = headSnapshot[file.id];
      if (!snap) {
        list.push({
          fileId: file.id,
          name: file.name,
          status: 'A',
          oldContent: '',
          newContent: file.content,
        });
      } else if (snap.content !== file.content) {
        list.push({
          fileId: file.id,
          name: file.name,
          status: 'M',
          oldContent: snap.content,
          newContent: file.content,
        });
      }
    }

    for (const [id, snap] of Object.entries(headSnapshot)) {
      if (!seenIds.has(id)) {
        list.push({
          fileId: id,
          name: snap.name,
          status: 'D',
          oldContent: snap.content,
          newContent: '',
        });
      }
    }

    return list;
  }, [activeProject.nodes, headSnapshot]);

  const stagedChanges = changes.filter((c) => activeProject.stagedFileIds.includes(c.fileId));
  const unstagedChanges = changes.filter((c) => !activeProject.stagedFileIds.includes(c.fileId));

  const handleCommitSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    if (changes.length === 0) return;
    onCommit(commitMessage.trim());
    setCommitMessage('');
    setInspectedFileId(null);
  };

  const renderChangeRow = (item: GitChangeItem, isStaged: boolean) => {
    const isInspecting = inspectedFileId === item.fileId;
    const statusBadgeColor =
      item.status === 'M'
        ? 'text-[#C9C9CC]'
        : item.status === 'A'
        ? 'text-[#84A98C]'
        : 'text-[#C87D75]';

    return (
      <div key={item.fileId} className="border-b border-[#2F2F30]/50 last:border-none">
        <div className="group h-7 px-2 flex items-center justify-between text-[12px] hover:bg-[#292929] rounded-xs transition-colors">
          <div
            onClick={() => {
              setInspectedFileId(isInspecting ? null : item.fileId);
              if (item.status !== 'D') onSelectFile(item.fileId);
            }}
            className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
          >
            <FileDiff className="w-3.5 h-3.5 text-[#A6A6AA] shrink-0" />
            <span className="truncate text-[#E6E6E8]">{item.name}</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!isStaged && (
              <button
                type="button"
                onClick={() => onDiscardChanges(item.fileId, item.oldContent, item.status)}
                title="Discard changes (revert to HEAD)"
                className="opacity-0 group-hover:opacity-100 p-1 text-[#707073] hover:text-[#C87D75] rounded"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            )}

            {isStaged ? (
              <button
                type="button"
                onClick={() => onUnstageFile(item.fileId)}
                title="Unstage file"
                className="p-1 text-[#A6A6AA] hover:text-[#E6E6E8] rounded"
              >
                <Minus className="w-3 h-3" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStageFile(item.fileId)}
                title="Stage file"
                className="p-1 text-[#A6A6AA] hover:text-[#E6E6E8] rounded"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}

            <span className={`w-4 text-right font-mono-code text-[11px] font-semibold ${statusBadgeColor}`}>
              {item.status}
            </span>
          </div>
        </div>

        {/* Inline Unified Diff Preview */}
        {isInspecting && (
          <div className="mx-2 mb-2 p-2 rounded bg-[#161617] border border-[#2F2F30] max-h-40 overflow-y-auto font-mono-code text-[10.5px] space-y-0.5">
            {computeSimpleDiff(item.oldContent, item.newContent)
              .slice(0, 24)
              .map((row, idx) => (
                <div
                  key={idx}
                  className={`px-1.5 py-0.5 rounded-xs whitespace-pre overflow-x-auto ${
                    row.type === 'add'
                      ? 'bg-[#84A98C]/15 text-[#A3B18A]'
                      : row.type === 'del'
                      ? 'bg-[#C87D75]/15 text-[#C88D85]'
                      : 'text-[#707073]'
                  }`}
                >
                  <span className="inline-block w-5 text-[#707073] select-none">{row.lineNo}</span>
                  <span className="inline-block w-3 select-none">
                    {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
                  </span>
                  <span>{row.text}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-full h-full min-h-0 bg-[#222223] border-b border-[#2F2F30] flex flex-col select-none shrink-0 z-30">
      {/* Header */}
      <div className="h-9 px-3 border-b border-[#2F2F30] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A6AA]">
            Source Control
          </span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#161617] border border-[#2F2F30] text-[10px] font-mono-code text-[#B4B4B8]">
            <GitBranch className="w-2.5 h-2.5" />
            {remote?.branch || 'main'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClosePanel}
          title="Close panel"
          className="p-1 text-[#707073] hover:text-[#E6E6E8] hover:bg-[#2E2E2F] rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* GitHub account & remote */}
      <div className="p-2.5 border-b border-[#2F2F30] space-y-2">
        {!auth ? (
          <div className="space-y-2">
            <span className="text-[11px] font-medium text-[#A6A6AA]">GitHub account</span>

            {device ? (
              <div className="space-y-2 rounded border border-[#2F2F30] bg-[#161617] p-2.5 text-center">
                <p className="text-[11px] text-[#A6A6AA]">
                  Enter this code on GitHub (copied to your clipboard):
                </p>
                <div className="text-[20px] font-mono-code font-semibold tracking-[0.2em] text-[#E6E6E8] select-text">
                  {device.user_code}
                </div>
                <button
                  type="button"
                  onClick={() => window.open(device.verification_uri, '_blank', 'noopener')}
                  className="w-full h-7 rounded text-[12px] border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8]"
                >
                  Open github.com/login/device
                </button>
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#707073]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Waiting for you to approve…</span>
                </div>
                <button
                  type="button"
                  onClick={cancelBrowserLogin}
                  className="text-[11px] text-[#707073] hover:text-[#E6E6E8]"
                >
                  Cancel
                </button>
              </div>
            ) : isOAuthConfigured(oauthCfg) ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void startBrowserLogin()}
                className="w-full h-8 rounded text-[12px] font-medium border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8] disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {busy === 'login' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Log in with GitHub</span>
              </button>
            ) : (
              <p className="text-[11px] leading-snug text-[#707073]">
                Browser login needs a one-time setup (Client ID + login proxy).
              </p>
            )}

            {!device && (
              <div className="flex items-center gap-3 text-[11px]">
                <button
                  type="button"
                  onClick={() => setShowSetup((v) => !v)}
                  className="text-[#A6A6AA] hover:text-[#E6E6E8]"
                >
                  {showSetup ? 'Hide setup' : isOAuthConfigured(oauthCfg) ? 'Login setup' : 'Set up'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowTokenLogin((v) => !v)}
                  className="text-[#707073] hover:text-[#E6E6E8]"
                >
                  {showTokenLogin ? 'Hide token login' : 'Use a token instead'}
                </button>
              </div>
            )}

            {showSetup && !device && (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={oauthCfg.clientId}
                  onChange={(e) => setOauthCfg({ ...oauthCfg, clientId: e.target.value })}
                  onBlur={() => saveOAuthConfig(oauthCfg)}
                  placeholder="OAuth App Client ID"
                  className="w-full bg-[#161617] border border-[#2F2F30] focus:border-[#3E3E40] rounded px-2 py-1.5 text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none"
                />
                <input
                  type="url"
                  value={oauthCfg.proxy}
                  onChange={(e) => setOauthCfg({ ...oauthCfg, proxy: e.target.value })}
                  onBlur={() => saveOAuthConfig(oauthCfg)}
                  placeholder="Login proxy URL (https://…workers.dev)"
                  className="w-full bg-[#161617] border border-[#2F2F30] focus:border-[#3E3E40] rounded px-2 py-1.5 text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none"
                />
                <p className="text-[10px] leading-snug text-[#707073]">
                  1) github.com/settings/developers → New OAuth App, tick “Enable Device Flow”, copy the
                  Client ID. 2) Deploy github-oauth-worker.js as a Cloudflare Worker and paste its URL.
                  Saved on this device.
                </p>
              </div>
            )}

            {showTokenLogin && !device && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!tokenInput.trim()) return;
                  void run('login', async () => {
                    const msg = await onLogin(tokenInput);
                    setTokenInput('');
                    return msg;
                  });
                }}
                className="space-y-1.5"
              >
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Personal access token"
                  autoComplete="off"
                  className="w-full bg-[#161617] border border-[#2F2F30] focus:border-[#3E3E40] rounded px-2 py-1.5 text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none"
                />
                <button
                  type="submit"
                  disabled={!tokenInput.trim() || busy !== null}
                  className="w-full h-7 rounded text-[12px] font-medium border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Log in with token
                </button>
              </form>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={auth.avatar}
                  alt=""
                  className="w-6 h-6 rounded-full border border-[#3E3E40] shrink-0"
                />
                <div className="min-w-0 leading-tight">
                  <div className="text-[12px] text-[#E6E6E8] truncate">{auth.name || auth.login}</div>
                  <div className="text-[10px] font-mono-code text-[#707073] truncate">@{auth.login}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onLogout}
                title="Log out"
                className="shrink-0 flex items-center gap-1 text-[11px] text-[#707073] hover:text-[#E6E6E8]"
              >
                <LogOut className="w-3 h-3" />
                <span>Log out</span>
              </button>
            </div>

            {hasProject && remote && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-mono-code text-[#A6A6AA] truncate">
                  {remote.owner}/{remote.repo}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void run('pull', onPull)}
                    className="h-7 rounded text-[12px] border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8] disabled:opacity-40 flex items-center justify-center gap-1"
                  >
                    {busy === 'pull' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDown className="w-3.5 h-3.5" />}
                    <span>Pull</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null || !head}
                    onClick={() => void run('push', onPush)}
                    className="h-7 rounded text-[12px] border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8] disabled:opacity-40 flex items-center justify-center gap-1"
                  >
                    {busy === 'push' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
                    <span>Push{unpushed ? ' •' : ''}</span>
                  </button>
                </div>
              </div>
            )}

            {hasProject && !remote && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = (repoName.trim() || activeProject.name).replace(/\s+/g, '-');
                  void run('publish', () => onPublish(name, repoPrivate));
                }}
                className="space-y-1.5"
              >
                <span className="text-[11px] font-medium text-[#A6A6AA]">Publish to GitHub</span>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder={activeProject.name || 'repository-name'}
                  className="w-full bg-[#161617] border border-[#2F2F30] focus:border-[#3E3E40] rounded px-2 py-1.5 text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none"
                />
                <label className="flex items-center gap-1.5 text-[11px] text-[#A6A6AA]">
                  <input
                    type="checkbox"
                    checked={repoPrivate}
                    onChange={(e) => setRepoPrivate(e.target.checked)}
                    className="accent-[#B4B4B8]"
                  />
                  Private repository
                </label>
                <button
                  type="submit"
                  disabled={busy !== null || !head}
                  title={head ? 'Create the repo and push your latest commit' : 'Make a commit first'}
                  className="w-full h-7 rounded text-[12px] border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {busy === 'publish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                  <span>{head ? 'Publish' : 'Commit first to publish'}</span>
                </button>
              </form>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!cloneInput.trim()) return;
                void run('clone', async () => {
                  const msg = await onClone(cloneInput);
                  setCloneInput('');
                  return msg;
                });
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={cloneInput}
                onChange={(e) => setCloneInput(e.target.value)}
                placeholder="Clone: owner/repo"
                className="flex-1 min-w-0 bg-[#161617] border border-[#2F2F30] focus:border-[#3E3E40] rounded px-2 py-1 text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none"
              />
              <button
                type="submit"
                disabled={!cloneInput.trim() || busy !== null}
                title="Clone repository as a new project"
                className="h-[26px] w-8 shrink-0 rounded border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8] disabled:opacity-40 flex items-center justify-center"
              >
                {busy === 'clone' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              </button>
            </form>
          </>
        )}

        {remoteMsg && (
          <p className={`text-[11px] leading-snug break-words ${remoteMsg.error ? 'text-[#C87D75]' : 'text-[#84A98C]'}`}>
            {remoteMsg.text}
          </p>
        )}
      </div>

      {/* Commit Box */}
      <form onSubmit={handleCommitSubmit} className="p-2.5 border-b border-[#2F2F30] space-y-2">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Commit message (e.g., feat: refine Luau types)"
          rows={2}
          className="w-full bg-[#161617] border border-[#2F2F30] focus:border-[#3E3E40] rounded p-2 text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none resize-none"
        />
        <button
          type="submit"
          disabled={!commitMessage.trim() || changes.length === 0}
          className={`w-full h-7 rounded text-[12px] font-medium flex items-center justify-center gap-1.5 border transition-colors ${
            commitMessage.trim() && changes.length > 0
              ? 'bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8] border-[#3E3E40]'
              : 'bg-[#161617] text-[#707073] border-[#2F2F30] cursor-not-allowed'
          }`}
        >
          <Check className="w-3.5 h-3.5" />
          <span>
            {stagedChanges.length > 0
              ? `Commit ${stagedChanges.length} Staged`
              : `Commit All (${changes.length})`}
          </span>
        </button>
      </form>

      {/* Changes & History Scrollable Body */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#2F2F30]">
        {/* Staged Changes */}
        {stagedChanges.length > 0 && (
          <div className="py-2">
            <div className="px-3 pb-1 flex items-center justify-between text-[11px] text-[#A6A6AA]">
              <span className="font-medium">Staged Changes ({stagedChanges.length})</span>
              <button
                type="button"
                onClick={onUnstageAll}
                className="text-[10px] text-[#707073] hover:text-[#E6E6E8]"
              >
                Unstage All
              </button>
            </div>
            <div className="px-1">{stagedChanges.map((item) => renderChangeRow(item, true))}</div>
          </div>
        )}

        {/* Working Tree Changes */}
        <div className="py-2">
          <div className="px-3 pb-1 flex items-center justify-between text-[11px] text-[#A6A6AA]">
            <span className="font-medium">Changes ({unstagedChanges.length})</span>
            {unstagedChanges.length > 0 && (
              <button
                type="button"
                onClick={() => onStageAll(unstagedChanges.map((c) => c.fileId))}
                className="text-[10px] text-[#B4B4B8] hover:text-[#E6E6E8]"
              >
                Stage All
              </button>
            )}
          </div>

          {changes.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-[#707073] text-center">
              Working tree clean. Edit a file to see changes here.
            </div>
          ) : (
            <div className="px-1">{unstagedChanges.map((item) => renderChangeRow(item, false))}</div>
          )}
        </div>

        {/* Commit History */}
        <div className="py-2">
          <button
            type="button"
            onClick={() => setHistoryOpen((p) => !p)}
            className="w-full px-3 py-1 flex items-center justify-between text-[11px] font-medium text-[#A6A6AA] hover:text-[#E6E6E8]"
          >
            <span className="flex items-center gap-1">
              {historyOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#707073]" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#707073]" />
              )}
              <span>Commits ({activeProject.commits.length})</span>
            </span>
          </button>

          {historyOpen && (
            <div className="mt-1 px-2.5 space-y-1.5">
              {activeProject.commits.map((commit, idx) => (
                <div
                  key={commit.id}
                  className="p-2 rounded bg-[#161617] border border-[#2F2F30] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-[11px] font-mono-code text-[#B4B4B8]">
                      <GitCommitHorizontal className="w-3 h-3" />
                      {commit.hash}
                      {idx === 0 && (
                        <span className="ml-1 px-1 py-0 text-[9px] rounded bg-[#2E2E2F] text-[#C9C9CC]">
                          HEAD
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-mono-code text-[#707073]">
                      {new Date(commit.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-[#E6E6E8] leading-snug">{commit.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
