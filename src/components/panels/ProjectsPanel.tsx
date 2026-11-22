import React, { useEffect, useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode2,
  FilePlus2,
  FolderPlus,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  Plus,
  Save,
  HardDrive,
  GitBranch,
  RefreshCw,
  Lock,
  Search,
  Loader2,
  FolderPlus as NewProjectIcon,
  MoreHorizontal,
  Copy,
  Scissors,
  ClipboardPaste,
  CopyPlus,
} from 'lucide-react';
import { FileItem, FolderItem, GitAuth, LanguageMode, Project, ProjectNode } from '../../types/ide';
import { listRepos, RepoSummary } from '../../utils/github';
import { DiskFile, DiskHandle, pickFolderFromDisk } from '../../utils/diskImport';
import { LANGUAGE_OPTIONS, ext_for_mode, mode_for_name } from '../../utils/languages';

interface ProjectsPanelProps {
  projects: Project[];
  activeProject: Project;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (name: string, language: LanguageMode) => void;
  onDeleteProject: (projectId: string) => void;
  auth: GitAuth | null;
  onClone: (ownerRepo: string) => Promise<string>;
  onOpenGit: () => void;
  onImportProject: (
    name: string,
    files: DiskFile[],
    handle: DiskHandle | undefined,
    skipped: number
  ) => void;
  onSelectFile: (fileId: string) => void;
  onCreateFile: (name: string, parentId: string | null, language: LanguageMode) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameNode: (nodeId: string, newName: string) => void;
  onDeleteNode: (nodeId: string) => void;
  clipboard: { name: string; mode: 'copy' | 'cut'; is_folder: boolean } | null;
  onCopyNode: (nodeId: string) => void;
  onCutNode: (nodeId: string) => void;
  onPasteNode: (targetParentId: string | null) => void;
  onDuplicateNode: (nodeId: string) => void;
  onClearClipboard: () => void;
  onToggleFolder: (folderId: string) => void;
  onSaveAll: () => void;
  onClosePanel: () => void;
}

export const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onCreateProject,
  onImportProject,
  onDeleteProject,
  auth,
  onClone,
  onOpenGit,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onRenameNode,
  onDeleteNode,
  clipboard,
  onCopyNode,
  onCutNode,
  onPasteNode,
  onDuplicateNode,
  onClearClipboard,
  onToggleFolder,
  onSaveAll,
  onClosePanel,
}) => {
  const [creatingType, setCreatingType] = useState<'file' | 'folder' | null>(null);
  const [showProjectChooser, setShowProjectChooser] = useState(false);
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [projName, setProjName] = useState('');
  const [projLang, setProjLang] = useState<LanguageMode>('luau');
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);

  // GitHub section
  const [githubOpen, setGithubOpen] = useState(true);
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoFilter, setRepoFilter] = useState('');
  const [cloningRepo, setCloningRepo] = useState<string | null>(null);
  const [githubMsg, setGithubMsg] = useState<{ text: string; error: boolean } | null>(null);

  const loadRepos = async () => {
    if (!auth) return;
    setReposLoading(true);
    setGithubMsg(null);
    try {
      setRepos(await listRepos(auth.token));
    } catch (err) {
      setGithubMsg({ text: (err as Error).message || 'Could not load repositories', error: true });
    } finally {
      setReposLoading(false);
    }
  };

  // Load repos when logged in; clear when logged out
  useEffect(() => {
    if (auth) {
      void loadRepos();
    } else {
      setRepos(null);
      setGithubMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.login]);

  const cloneRepo = async (fullName: string) => {
    setCloningRepo(fullName);
    setGithubMsg(null);
    try {
      const msg = await onClone(fullName);
      setGithubMsg({ text: msg, error: false });
    } catch (err) {
      setGithubMsg({ text: (err as Error).message || 'Clone failed', error: true });
    } finally {
      setCloningRepo(null);
    }
  };

  const clonedMap = new Map<string, string>(); // "owner/repo" lowercase -> project id
  projects.forEach((p) => {
    if (p.remote) clonedMap.set(`${p.remote.owner}/${p.remote.repo}`.toLowerCase(), p.id);
  });
  const visibleRepos = (repos || []).filter((r) =>
    r.full_name.toLowerCase().includes(repoFilter.trim().toLowerCase())
  );
  const [targetParentId, setTargetParentId] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newFileExt, setNewFileExt] = useState<LanguageMode>('luau');

  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const [confirmDeleteNodeId, setConfirmDeleteNodeId] = useState<string | null>(null);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const startCreateFile = (parentId: string | null = null) => {
    setCreatingType('file');
    setTargetParentId(parentId);
    setNewItemName('NewModule');
    setNewFileExt('luau');
  };

  const startCreateFolder = (parentId: string | null = null) => {
    setCreatingType('folder');
    setTargetParentId(parentId);
    setNewItemName('modules');
  };

  const handleConfirmCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newItemName.trim();
    if (!trimmed) return;

    if (creatingType === 'file') {
      let finalName = trimmed;
      let lang: LanguageMode = newFileExt;
      const by_name = mode_for_name(finalName);
      if (by_name) {
        lang = by_name;
      } else if (/\.[^./\\]+$/.test(finalName) || newFileExt === 'other') {
        lang = 'other';
      } else {
        finalName = `${finalName}.${ext_for_mode(newFileExt)}`;
      }
      onCreateFile(finalName, targetParentId, lang);
    } else if (creatingType === 'folder') {
      onCreateFolder(trimmed, targetParentId);
    }

    setCreatingType(null);
    setNewItemName('');
  };

  const confirmNewProject = () => {
    const trimmed = projName.trim();
    if (!trimmed) return;
    onCreateProject(trimmed, projLang);
    setShowNewProjectDialog(false);
    setProjName('');
  };

  const openFromDisk = async () => {
    setShowProjectChooser(false);
    setImportError(null);
    try {
      const folder = await pickFolderFromDisk();
      if (!folder) return;
      onImportProject(folder.name, folder.files, folder.handle, folder.skipped);
    } catch {
      setImportError('Could not read that folder.');
    }
  };

  const submitRename = (nodeId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRenameNode(nodeId, trimmed);
    }
    setRenamingNodeId(null);
  };

  const close_menu = () => {
    setMenuNodeId(null);
    setConfirmDeleteNodeId(null);
  };

  const toggle_menu = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteNodeId(null);
    setMenuNodeId((prev) => (prev === nodeId ? null : nodeId));
  };

  const render_menu = (node: ProjectNode, is_folder: boolean, depth: number): React.ReactNode => {
    if (menuNodeId !== node.id) return null;
    const confirming = confirmDeleteNodeId === node.id;
    const action = (
      key: string,
      label: string,
      icon: React.ReactNode,
      on_click: () => void,
      danger = false
    ) => (
      <button
        key={key}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          on_click();
        }}
        className={`h-7 px-2 rounded border text-[11px] flex items-center gap-1 transition-colors ${
          danger
            ? 'border-[#5A3A37] text-[#C87D75] bg-[#2A1F1E]'
            : 'border-[#2F2F30] text-[#E6E6E8] bg-[#161617] hover:bg-[#2E2E2F]'
        }`}
      >
        {icon}
        <span>{label}</span>
      </button>
    );
    return (
      <div
        style={{ paddingLeft: `${depth * 14 + (is_folder ? 10 : 22)}px` }}
        className="pr-2 py-1 flex flex-wrap gap-1"
      >
        {action('rename', 'Rename', <Pencil className="w-3 h-3" />, () => {
          setRenamingNodeId(node.id);
          setRenameValue(node.name);
          close_menu();
        })}
        {action('copy', 'Copy', <Copy className="w-3 h-3" />, () => {
          onCopyNode(node.id);
          close_menu();
        })}
        {action('cut', 'Cut', <Scissors className="w-3 h-3" />, () => {
          onCutNode(node.id);
          close_menu();
        })}
        {clipboard &&
          action('paste', is_folder ? 'Paste inside' : 'Paste here', <ClipboardPaste className="w-3 h-3" />, () => {
            onPasteNode(is_folder ? node.id : node.parentId);
            close_menu();
          })}
        {action('duplicate', 'Duplicate', <CopyPlus className="w-3 h-3" />, () => {
          onDuplicateNode(node.id);
          close_menu();
        })}
        {is_folder &&
          action('new-file', 'New file', <FilePlus2 className="w-3 h-3" />, () => {
            startCreateFile(node.id);
            close_menu();
          })}
        {is_folder &&
          action('new-folder', 'New folder', <FolderPlus className="w-3 h-3" />, () => {
            startCreateFolder(node.id);
            close_menu();
          })}
        {action(
          'delete',
          confirming ? 'Tap again to delete' : 'Delete',
          <Trash2 className="w-3 h-3" />,
          () => {
            if (confirming) {
              onDeleteNode(node.id);
              close_menu();
            } else {
              setConfirmDeleteNodeId(node.id);
            }
          },
          true
        )}
      </div>
    );
  };

  const more_button = (node: ProjectNode) => (
    <button
      type="button"
      onClick={(e) => toggle_menu(node.id, e)}
      title="Actions: rename, copy, cut, paste, duplicate, delete"
      aria-label="File actions"
      className={`p-1.5 rounded shrink-0 transition-colors ${
        menuNodeId === node.id ? 'text-[#E6E6E8] bg-[#2E2E2F]' : 'text-[#A6A6AA] hover:text-[#E6E6E8]'
      }`}
    >
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );

  const renderTreeNodes = (parentId: string | null, depth = 0): React.ReactNode => {
    const children = activeProject.nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    if (!activeProject.id) return null;
    if (children.length === 0 && depth === 0) {
      return (
        <div className="px-3 py-6 text-center text-[12px] text-[#707073]">
          No files in this project yet. Create a file above.
        </div>
      );
    }

    return children.map((node) => {
      const isRenaming = renamingNodeId === node.id;

      if (node.type === 'folder') {
        const folder = node as FolderItem;
        return (
          <div key={folder.id}>
            <div
              style={{ paddingLeft: `${depth * 14 + 10}px` }}
              onClick={() => onToggleFolder(folder.id)}
              className="group h-7 pr-2 flex items-center justify-between text-[12px] text-[#A6A6AA] hover:bg-[#292929] hover:text-[#E6E6E8] cursor-pointer rounded-xs transition-colors"
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {folder.isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[#707073] shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-[#707073] shrink-0" />
                )}
                {folder.isOpen ? (
                  <FolderOpen className="w-3.5 h-3.5 text-[#B4B4B8] shrink-0" />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-[#B4B4B8] shrink-0" />
                )}
                {isRenaming ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(folder.id);
                      if (e.key === 'Escape') setRenamingNodeId(null);
                    }}
                    onBlur={() => submitRename(folder.id)}
                    autoFocus
                    className="bg-[#161617] text-[#E6E6E8] text-[12px] px-1.5 py-0.5 rounded border border-[#3E3E40] outline-none w-full"
                  />
                ) : (
                  <span className="truncate font-medium">{folder.name}</span>
                )}
              </div>

              {!isRenaming && more_button(folder)}
            </div>

            {render_menu(folder, true, depth)}

            {folder.isOpen && renderTreeNodes(folder.id, depth + 1)}
          </div>
        );
      }

      const file = node as FileItem;
      const isActive = activeProject.activeFileId === file.id;
      const isDirty = file.content !== file.savedContent;
      const dotIdx = file.name.lastIndexOf('.');
      const base = dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name;
      const ext = dotIdx > 0 ? file.name.slice(dotIdx) : '';

      return (
        <div key={file.id}>
        <div
          style={{ paddingLeft: `${depth * 14 + 22}px` }}
          onClick={() => onSelectFile(file.id)}
          className={`group h-7 pr-2 flex items-center justify-between text-[12px] cursor-pointer rounded-xs transition-colors ${
            isActive
              ? 'bg-[#2E2E2F] text-[#E6E6E8]'
              : 'text-[#A6A6AA] hover:bg-[#292929] hover:text-[#E6E6E8]'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <FileCode2
              className={`w-3.5 h-3.5 shrink-0 ${
                file.language === 'luau' ? 'text-[#B4B4B8]' : 'text-[#9DB4B8]'
              }`}
            />
            {isRenaming ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename(file.id);
                  if (e.key === 'Escape') setRenamingNodeId(null);
                }}
                onBlur={() => submitRename(file.id)}
                autoFocus
                className="bg-[#161617] text-[#E6E6E8] text-[12px] px-1.5 py-0.5 rounded border border-[#3E3E40] outline-none w-full"
              />
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <span className="truncate">{base}</span>
                <span className="text-[10px] font-mono-code text-[#707073] shrink-0">{ext}</span>
                {isDirty && (
                  <span
                    title="Unsaved changes"
                    className="w-1.5 h-1.5 rounded-full bg-[#C9C9CC] shrink-0 ml-0.5"
                  />
                )}
              </div>
            )}
          </div>

          {!isRenaming && more_button(file)}
        </div>
        {render_menu(file, false, depth)}
        </div>
      );
    });
  };

  return (
    <aside className="w-72 max-w-[85vw] h-full bg-[#222223] border-r border-[#2F2F30] flex flex-col select-none shrink-0 z-30">
      {/* Panel Header */}
      <div className="h-9 px-3 border-b border-[#2F2F30] flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A6A6AA]">
          Projects & Files
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSaveAll}
            title="Save all files in project"
            className="p-1 text-[#A6A6AA] hover:text-[#E6E6E8] hover:bg-[#2E2E2F] rounded transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
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

      {/* Project Selector Strip */}
      <div className="p-2.5 border-b border-[#2F2F30] bg-[#1B1B1C]/50 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#707073]">Active Workspace</span>
          <button
            type="button"
            onClick={() => setShowProjectChooser((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-[#B4B4B8] hover:text-[#E6E6E8] transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>New Project</span>
          </button>
        </div>

        {showProjectChooser && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setShowProjectChooser(false);
                setProjName('');
                setProjLang('luau');
                setShowNewProjectDialog(true);
              }}
              className="flex flex-col items-start gap-1 p-2 rounded border border-[#2F2F30] bg-[#161617] hover:bg-[#2E2E2F] text-left transition-colors"
            >
              <NewProjectIcon className="w-4 h-4 text-[#B4B4B8]" />
              <span className="text-[12px] text-[#E6E6E8] font-medium">New project</span>
              <span className="text-[10px] text-[#707073] leading-tight">
                Saved in the app directory
              </span>
            </button>
            <button
              type="button"
              onClick={openFromDisk}
              className="flex flex-col items-start gap-1 p-2 rounded border border-[#2F2F30] bg-[#161617] hover:bg-[#2E2E2F] text-left transition-colors"
            >
              <HardDrive className="w-4 h-4 text-[#B4B4B8]" />
              <span className="text-[12px] text-[#E6E6E8] font-medium">From disk</span>
              <span className="text-[10px] text-[#707073] leading-tight">
                Open a folder directory
              </span>
            </button>
          </div>
        )}
        {importError && <p className="text-[11px] text-[#C87D75]">{importError}</p>}

        <div className="flex flex-col gap-1">
          {projects.map((proj) => {
            const isSelected = proj.id === activeProject.id;
            return (
              <button
                key={proj.id}
                type="button"
                onClick={() => onSelectProject(proj.id)}
                className={`w-full px-2.5 py-1.5 rounded text-left truncate text-[12px] font-medium border transition-colors ${
                  isSelected
                    ? 'bg-[#2E2E2F] text-[#E6E6E8] border-[#3E3E40]'
                    : 'bg-[#161617] text-[#A6A6AA] border-[#2F2F30] hover:text-[#E6E6E8]'
                }`}
              >
                {proj.name}
              </button>
            );
          })}
        </div>
        {activeProject.id ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-[#707073] truncate">{activeProject.description}</p>
            <button
              type="button"
              onClick={() => {
                if (confirmDeleteProject) {
                  onDeleteProject(activeProject.id);
                  setConfirmDeleteProject(false);
                } else {
                  setConfirmDeleteProject(true);
                  setTimeout(() => setConfirmDeleteProject(false), 3000);
                }
              }}
              title="Remove this project from S. Box (files on disk are not deleted)"
              className={`shrink-0 flex items-center gap-1 text-[11px] transition-colors ${
                confirmDeleteProject ? 'text-[#C87D75]' : 'text-[#707073] hover:text-[#C87D75]'
              }`}
            >
              <Trash2 className="w-3 h-3" />
              <span>{confirmDeleteProject ? 'Tap to confirm' : 'Remove'}</span>
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-[#707073]">No projects yet. Use New Project above.</p>
        )}
      </div>

      {/* GitHub section */}
      <div className="border-b border-[#2F2F30]">
        <button
          type="button"
          onClick={() => setGithubOpen((v) => !v)}
          className="w-full px-2.5 py-2 flex items-center justify-between text-[11px] font-medium text-[#A6A6AA] hover:text-[#E6E6E8]"
        >
          <span className="flex items-center gap-1.5">
            {githubOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-[#707073]" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-[#707073]" />
            )}
            <GitBranch className="w-3.5 h-3.5 text-[#B4B4B8]" />
            <span>GitHub</span>
            {auth && <span className="font-mono-code text-[10px] text-[#707073]">@{auth.login}</span>}
          </span>
          {auth && repos && <span className="text-[10px] text-[#707073]">{repos.length}</span>}
        </button>

        {githubOpen && (
          <div className="px-2.5 pb-2.5 space-y-2">
            {!auth ? (
              <div className="space-y-1.5">
                <p className="text-[11px] text-[#707073] leading-snug">
                  Log in to GitHub to see your repositories here.
                </p>
                <button
                  type="button"
                  onClick={onOpenGit}
                  className="w-full h-7 rounded text-[12px] border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[#E6E6E8] transition-colors"
                >
                  Log in
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-3 h-3 text-[#707073] absolute left-2 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={repoFilter}
                      onChange={(e) => setRepoFilter(e.target.value)}
                      placeholder="Filter repositories"
                      className="w-full bg-[#161617] border border-[#2F2F30] focus:border-[#3E3E40] rounded pl-6 pr-2 py-1 text-[12px] text-[#E6E6E8] placeholder-[#707073] outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadRepos()}
                    disabled={reposLoading}
                    title="Refresh repositories"
                    className="h-[26px] w-7 shrink-0 rounded border border-[#2F2F30] bg-[#161617] hover:bg-[#2E2E2F] text-[#A6A6AA] hover:text-[#E6E6E8] flex items-center justify-center disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3 h-3 ${reposLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div className="max-h-44 overflow-y-auto space-y-0.5">
                  {reposLoading && !repos && (
                    <p className="text-[11px] text-[#707073] py-2 text-center">Loading repositories…</p>
                  )}
                  {repos && visibleRepos.length === 0 && (
                    <p className="text-[11px] text-[#707073] py-2 text-center">
                      {repos.length === 0 ? 'No repositories found.' : 'No matches.'}
                    </p>
                  )}
                  {visibleRepos.map((r) => {
                    const clonedId = clonedMap.get(r.full_name.toLowerCase());
                    const isCloning = cloningRepo === r.full_name;
                    return (
                      <button
                        key={r.full_name}
                        type="button"
                        disabled={cloningRepo !== null}
                        onClick={() => (clonedId ? onSelectProject(clonedId) : void cloneRepo(r.full_name))}
                        title={
                          clonedId
                            ? 'Already in S. Box. Tap to switch to it'
                            : r.description || 'Tap to clone as a new project'
                        }
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-xs text-left hover:bg-[#292929] disabled:opacity-60 transition-colors"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          {r.private ? (
                            <Lock className="w-3 h-3 text-[#707073] shrink-0" />
                          ) : (
                            <GitBranch className="w-3 h-3 text-[#707073] shrink-0" />
                          )}
                          <span className="text-[12px] text-[#E6E6E8] truncate">{r.full_name}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-[#707073]">
                          {isCloning ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : clonedId ? (
                            'Open'
                          ) : (
                            'Clone'
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {githubMsg && (
              <p
                className={`text-[11px] leading-snug break-words ${
                  githubMsg.error ? 'text-[#C87D75]' : 'text-[#84A98C]'
                }`}
              >
                {githubMsg.text}
              </p>
            )}
          </div>
        )}
      </div>

      {/* File & Folder Creation Actions */}
      {activeProject.id && (
      <div className="px-2.5 py-2 border-b border-[#2F2F30] flex items-center justify-between">
        <span className="text-[11px] font-mono-code text-[#A6A6AA] truncate">
          /{activeProject.name}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => startCreateFile(null)}
            title="Create new file"
            className="px-2 py-1 rounded bg-[#161617] hover:bg-[#2E2E2F] border border-[#2F2F30] text-[11px] text-[#E6E6E8] flex items-center gap-1 transition-colors"
          >
            <FilePlus2 className="w-3 h-3 text-[#B4B4B8]" />
            <span>New File</span>
          </button>
          <button
            type="button"
            onClick={() => startCreateFolder(null)}
            title="Create new folder"
            className="p-1 rounded bg-[#161617] hover:bg-[#2E2E2F] border border-[#2F2F30] text-[#A6A6AA] hover:text-[#E6E6E8] transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      )}

      {/* Inline Creation Form */}
      {creatingType && (
        <form
          onSubmit={handleConfirmCreate}
          className="p-2.5 bg-[#161617] border-b border-[#2F2F30] space-y-2"
        >
          <div className="flex items-center justify-between text-[11px] text-[#B4B4B8]">
            <span>{creatingType === 'file' ? 'Create File' : 'Create Folder'}</span>
            <button
              type="button"
              onClick={() => setCreatingType(null)}
              className="text-[#707073] hover:text-[#E6E6E8]"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={creatingType === 'file' ? 'ModuleName' : 'Folder name'}
              autoFocus
              className="flex-1 bg-[#222223] border border-[#3E3E40] rounded px-2 py-1 text-[12px] text-[#E6E6E8] outline-none focus:border-[#B4B4B8]"
            />

            {creatingType === 'file' && (
              <select
                value={newFileExt}
                onChange={(e) => setNewFileExt(e.target.value as LanguageMode)}
                className="bg-[#222223] border border-[#3E3E40] rounded px-1.5 py-1 text-[11px] font-mono-code text-[#B4B4B8] outline-none"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.mode} value={o.mode}>
                    {o.ext ? `.${o.ext}` : 'other'}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setCreatingType(null)}
              className="px-2 py-1 text-[11px] text-[#A6A6AA] hover:text-[#E6E6E8]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-2.5 py-1 rounded bg-[#2E2E2F] hover:bg-[#3E3E40] border border-[#3E3E40] text-[11px] text-[#E6E6E8] flex items-center gap-1"
            >
              <Check className="w-3 h-3" />
              <span>Create</span>
            </button>
          </div>
        </form>
      )}

      {clipboard && (
        <div className="px-2.5 py-1.5 border-b border-[#2F2F30] bg-[#1F1F20] flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate text-[#A6A6AA]">
            {clipboard.mode === 'cut' ? 'Cut' : 'Copied'}: <span className="text-[#E6E6E8]">{clipboard.name}</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onPasteNode(null)}
              className="h-6 px-2 rounded border border-[#3E3E40] bg-[#2E2E2F] text-[#E6E6E8] flex items-center gap-1"
            >
              <ClipboardPaste className="w-3 h-3" />
              <span>Paste in root</span>
            </button>
            <button
              type="button"
              onClick={onClearClipboard}
              title="Clear clipboard"
              className="h-6 w-6 rounded flex items-center justify-center text-[#707073] hover:text-[#E6E6E8]"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-1.5 px-1 space-y-0.5">
        {renderTreeNodes(null, 0)}
      </div>

      {/* New Project dialog: name + language, Cancel / Confirm */}
      {showNewProjectDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowNewProjectDialog(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              confirmNewProject();
            }}
            className="w-full max-w-[320px] rounded-lg border border-[#3E3E40] bg-[#222223] p-4 shadow-2xl space-y-3"
          >
            <h2 className="text-[13px] font-semibold text-[#E6E6E8]">New project</h2>

            <label className="block space-y-1">
              <span className="text-[11px] text-[#A6A6AA]">Name</span>
              <input
                type="text"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                placeholder="My project"
                autoFocus
                className="w-full bg-[#161617] border border-[#3E3E40] rounded px-2.5 py-1.5 text-[13px] text-[#E6E6E8] outline-none focus:border-[#B4B4B8]"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] text-[#A6A6AA]">Language</span>
              <select
                value={projLang}
                onChange={(e) => setProjLang(e.target.value as LanguageMode)}
                className="w-full bg-[#161617] border border-[#3E3E40] rounded px-2 py-1.5 text-[13px] text-[#E6E6E8] outline-none focus:border-[#B4B4B8]"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.mode} value={o.mode}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowNewProjectDialog(false)}
                className="px-3 py-1.5 rounded text-[12px] text-[#A6A6AA] hover:text-[#E6E6E8] hover:bg-[#2E2E2F] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!projName.trim()}
                className="px-3 py-1.5 rounded border border-[#3E3E40] bg-[#2E2E2F] text-[12px] text-[#E6E6E8] hover:bg-[#3E3E40] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Confirm
              </button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
};
