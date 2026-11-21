import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  FileItem,
  FolderItem,
  GitAuth,
  GitCommit,
  LanguageMode,
  NavPanel,
  Project,
  ProjectNode,
} from './types/ide';
import { TopHeader } from './components/TopHeader';
import { EditorToolbar, ToolbarActionType } from './components/EditorToolbar';
import { CodeEditor } from './components/CodeEditor';
import { ProjectsPanel } from './components/panels/ProjectsPanel';
import { PluginsPanel } from './components/panels/PluginsPanel';
import { GitPanel } from './components/panels/GitPanel';
import { validateLuaSyntax } from './utils/luaTokenizer';
import { DiskFile, registerDiskHandle, hasDiskHandle, writeBackToDisk } from './utils/diskImport';
import {
  validateToken,
  createRepo,
  getDefaultBranch,
  fetchRemoteFiles,
  pushFiles,
} from './utils/github';

const AUTH_KEY = 'sbox_github_auth_v1';

const EMPTY_PROJECT: Project = {
  id: '',
  name: '',
  description: '',
  nodes: [],
  openFileIds: [],
  activeFileId: '',
  stagedFileIds: [],
  commits: [],
};

function loadAuth(): GitAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) {
      const a = JSON.parse(raw) as GitAuth;
      if (a && a.token && a.login) return a;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Insert or update files (by path) in a node list, creating folders as needed. */
function mergeFiles(
  existing: ProjectNode[],
  files: { path: string; content: string }[],
  now: number,
  projectLang: LanguageMode = 'other'
): ProjectNode[] {
  const nodes: ProjectNode[] = existing.map((n) => ({ ...n }));
  const folderIds = new Map<string, string>();
  for (const n of nodes) {
    if (n.type === 'folder') folderIds.set(getNodePath(nodes, n), n.id);
  }
  let counter = 0;
  const ensureFolder = (folderPath: string): string | null => {
    if (!folderPath) return null;
    const hit = folderIds.get(folderPath);
    if (hit) return hit;
    const parts = folderPath.split('/');
    const parentId = ensureFolder(parts.slice(0, -1).join('/'));
    const id = `folder-${now}-${counter++}-${Math.random().toString(36).slice(2, 6)}`;
    folderIds.set(folderPath, id);
    nodes.push({ id, name: parts[parts.length - 1], parentId, type: 'folder', isOpen: parentId === null });
    return id;
  };
  const byPath = new Map<string, number>();
  nodes.forEach((n, i) => {
    if (n.type === 'file') byPath.set(getNodePath(nodes, n), i);
  });
  for (const f of files) {
    const idx = byPath.get(f.path);
    if (idx !== undefined) {
      const n = nodes[idx] as FileItem;
      nodes[idx] = { ...n, content: f.content, savedContent: f.content, lastModified: now, undoStack: [], redoStack: [] };
      continue;
    }
    const parts = f.path.split('/');
    const fileName = parts[parts.length - 1];
    const parentId = ensureFolder(parts.slice(0, -1).join('/'));
    nodes.push({
      id: `file-${now}-${counter++}-${Math.random().toString(36).slice(2, 6)}`,
      name: fileName,
      parentId,
      type: 'file',
      // Projects set to Other never highlight, whatever the file extension is
      language: projectLang === 'other' ? 'other' : inferLanguage(fileName, projectLang),
      content: f.content,
      savedContent: f.content,
      lastModified: now,
      undoStack: [],
      redoStack: [],
    });
  }
  return nodes;
}

function snapshotOf(nodes: ProjectNode[]) {
  const snap: Record<string, { name: string; path: string; content: string }> = {};
  for (const n of nodes) {
    if (n.type === 'file') snap[n.id] = { name: n.name, path: getNodePath(nodes, n), content: n.content };
  }
  return snap;
}

const inferLanguage = (name: string, fallback: LanguageMode): LanguageMode => {
  if (/\.luau$/i.test(name)) return 'luau';
  if (/\.lua$/i.test(name)) return 'lua';
  return fallback === 'other' ? 'other' : fallback;
};

// Resolve "folder/sub/file.ext" for a node
const getNodePath = (nodes: ProjectNode[], node: ProjectNode): string => {
  const parts = [node.name];
  let parent = node.parentId;
  while (parent) {
    const f = nodes.find((n) => n.id === parent);
    if (!f) break;
    parts.unshift(f.name);
    parent = f.parentId;
  }
  return parts.join('/');
};

const STORAGE_KEY = 'sbox_ide_workspace_v2';

interface PersistedWorkspace {
  projects: Project[];
  activeProjectId: string;
  autosaveEnabled: boolean;
}

function loadInitialWorkspace(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedWorkspace;
      if (parsed && Array.isArray(parsed.projects)) {
        // Projects set to Other must never highlight: normalize any older files
        parsed.projects = parsed.projects.map((p) =>
          p.language === 'other' || (p.source && p.source !== 'app')
            ? {
                ...p,
                nodes: p.nodes.map((n) =>
                  n.type === 'file' && n.language !== 'other' ? { ...n, language: 'other' as const } : n
                ),
              }
            : p
        );
        return parsed;
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return {
    projects: [],
    activeProjectId: '',
    autosaveEnabled: false,
  };
}

export function App() {
  const initial = useMemo(() => loadInitialWorkspace(), []);

  const [projects, setProjects] = useState<Project[]>(initial.projects);
  const [activeProjectId, setActiveProjectId] = useState<string>(initial.activeProjectId);
  const [activePanel, setActivePanel] = useState<NavPanel>(null);
  const [auth, setAuth] = useState<GitAuth | null>(() => loadAuth());

  const [isFindOpen, setIsFindOpen] = useState(false);
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState<boolean>(initial.autosaveEnabled);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Mobile on-screen keyboard visualViewport height tracking (Section 8)
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  const editorCommandRef = useRef<((action: ToolbarActionType) => void) | null>(null);

  // Persist workspace & remember last opened file
  useEffect(() => {
    try {
      const payload: PersistedWorkspace = {
        projects,
        activeProjectId,
        autosaveEnabled,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [projects, activeProjectId, autosaveEnabled]);

  // Listen to visualViewport for mobile on-screen keyboard responsiveness
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      setViewportHeight(vv.height);
      // Keep window anchored at top so editor stays in upper portion of screen
      if (window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    handleResize();
    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);
    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
    };
  }, []);

  // Active project & active file lookup
  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === activeProjectId) || projects[0] || EMPTY_PROJECT;
  }, [projects, activeProjectId]);

  const hasProject = projects.length > 0;

  const allProjectFiles = useMemo(() => {
    return activeProject.nodes.filter((n): n is FileItem => n.type === 'file');
  }, [activeProject.nodes]);

  const activeFile = useMemo<FileItem>(() => {
    const found = allProjectFiles.find((f) => f.id === activeProject.activeFileId);
    if (found) return found;
    if (allProjectFiles.length > 0) return allProjectFiles[0];
    // Fallback empty file if user deleted all files in project
    return {
      id: 'fallback-file',
      name: 'main.luau',
      parentId: null,
      type: 'file',
      language: 'luau',
      content: '--!strict\n',
      savedContent: '--!strict\n',
      lastModified: Date.now(),
      undoStack: [],
      redoStack: [],
    };
  }, [allProjectFiles, activeProject.activeFileId]);

  const openFiles = useMemo(() => {
    const list = activeProject.openFileIds
      .map((id) => allProjectFiles.find((f) => f.id === id))
      .filter((f): f is FileItem => Boolean(f));
    if (list.length === 0 && activeFile) {
      return [activeFile];
    }
    return list;
  }, [activeProject.openFileIds, allProjectFiles, activeFile]);

  const showTransientNotice = useCallback((msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 2000);
  }, []);

  // Helper to update active project
  const updateActiveProject = useCallback(
    (updater: (proj: Project) => Project) => {
      setProjects((prev) =>
        prev.map((proj) => (proj.id === activeProject.id ? updater(proj) : proj))
      );
    },
    [activeProject.id]
  );

  // Update content of active file with Undo/Redo stack management
  const handleChangeContent = useCallback(
    (
      newContent: string,
      selectionStart: number,
      selectionEnd: number,
      pushHistory = true
    ) => {
      const now = Date.now();
      updateActiveProject((proj) => {
        const exists = proj.nodes.some((n) => n.id === activeFile.id);
        if (!exists && activeFile.id === 'fallback-file') {
          const createdFile: FileItem = {
            ...activeFile,
            id: `file-${now}`,
            content: newContent,
            savedContent: autosaveEnabled ? newContent : activeFile.savedContent,
            lastModified: now,
            undoStack: [
              {
                content: activeFile.content,
                selectionStart: 0,
                selectionEnd: 0,
                timestamp: now,
              },
            ],
            redoStack: [],
          };
          return {
            ...proj,
            nodes: [...proj.nodes, createdFile],
            openFileIds: [createdFile.id],
            activeFileId: createdFile.id,
          };
        }

        return {
          ...proj,
          nodes: proj.nodes.map((node) => {
            if (node.type !== 'file' || node.id !== activeFile.id) return node;
            if (node.content === newContent) return node;

            const nextUndo = pushHistory
              ? [
                  ...node.undoStack.slice(-79),
                  {
                    content: node.content,
                    selectionStart,
                    selectionEnd,
                    timestamp: now,
                  },
                ]
              : node.undoStack;

            return {
              ...node,
              content: newContent,
              savedContent: autosaveEnabled ? newContent : node.savedContent,
              lastModified: now,
              undoStack: nextUndo,
              redoStack: pushHistory ? [] : node.redoStack,
            };
          }),
        };
      });
    },
    [activeFile, autosaveEnabled, updateActiveProject]
  );

  // Undo operation
  const handleUndo = useCallback(() => {
    if (!activeFile || activeFile.undoStack.length === 0) return;
    const now = Date.now();
    updateActiveProject((proj) => ({
      ...proj,
      nodes: proj.nodes.map((node) => {
        if (node.type !== 'file' || node.id !== activeFile.id) return node;
        if (node.undoStack.length === 0) return node;

        const previousEntry = node.undoStack[node.undoStack.length - 1];
        const remainingUndo = node.undoStack.slice(0, -1);
        const nextRedo = [
          ...node.redoStack,
          {
            content: node.content,
            selectionStart: previousEntry.selectionStart,
            selectionEnd: previousEntry.selectionEnd,
            timestamp: now,
          },
        ];

        return {
          ...node,
          content: previousEntry.content,
          savedContent: autosaveEnabled ? previousEntry.content : node.savedContent,
          lastModified: now,
          undoStack: remainingUndo,
          redoStack: nextRedo,
        };
      }),
    }));
  }, [activeFile, autosaveEnabled, updateActiveProject]);

  // Redo operation
  const handleRedo = useCallback(() => {
    if (!activeFile || activeFile.redoStack.length === 0) return;
    const now = Date.now();
    updateActiveProject((proj) => ({
      ...proj,
      nodes: proj.nodes.map((node) => {
        if (node.type !== 'file' || node.id !== activeFile.id) return node;
        if (node.redoStack.length === 0) return node;

        const nextEntry = node.redoStack[node.redoStack.length - 1];
        const remainingRedo = node.redoStack.slice(0, -1);
        const nextUndo = [
          ...node.undoStack,
          {
            content: node.content,
            selectionStart: nextEntry.selectionStart,
            selectionEnd: nextEntry.selectionEnd,
            timestamp: now,
          },
        ];

        return {
          ...node,
          content: nextEntry.content,
          savedContent: autosaveEnabled ? nextEntry.content : node.savedContent,
          lastModified: now,
          undoStack: nextUndo,
          redoStack: remainingRedo,
        };
      }),
    }));
  }, [activeFile, autosaveEnabled, updateActiveProject]);

  // Save current file
  const handleSaveActiveFile = useCallback(() => {
    updateActiveProject((proj) => ({
      ...proj,
      nodes: proj.nodes.map((node) => {
        if (node.type !== 'file' || node.id !== activeFile.id) return node;
        return {
          ...node,
          savedContent: node.content,
        };
      }),
    }));
    if (hasDiskHandle(activeProject.id)) {
      const node = activeProject.nodes.find((n) => n.id === activeFile.id);
      if (node) {
        void writeBackToDisk(
          activeProject.id,
          getNodePath(activeProject.nodes, node),
          activeFile.content
        );
      }
    }
    showTransientNotice(`Saved ${activeFile.name}`);
  }, [
    activeFile.id,
    activeFile.name,
    activeFile.content,
    activeProject.id,
    activeProject.nodes,
    updateActiveProject,
    showTransientNotice,
  ]);

  // Save all files in project
  const handleSaveAllFiles = useCallback(() => {
    updateActiveProject((proj) => ({
      ...proj,
      nodes: proj.nodes.map((node) =>
        node.type === 'file' ? { ...node, savedContent: node.content } : node
      ),
    }));
    if (hasDiskHandle(activeProject.id)) {
      for (const f of allProjectFiles) {
        if (f.content !== f.savedContent) {
          void writeBackToDisk(activeProject.id, getNodePath(activeProject.nodes, f), f.content);
        }
      }
    }
    showTransientNotice('All project files saved');
  }, [activeProject.id, activeProject.nodes, allProjectFiles, updateActiveProject, showTransientNotice]);

  // Switch between Lua and Luau for active file (Section 6)
  const handleLanguageChange = useCallback(
    (newLang: LanguageMode) => {
      updateActiveProject((proj) => ({
        ...proj,
        nodes: proj.nodes.map((node) => {
          if (node.type !== 'file' || node.id !== activeFile.id) return node;
          // 'other' keeps the file name as-is (any extension); Lua/Luau swap the extension
          const updatedName =
            newLang === 'other'
              ? node.name
              : `${node.name.replace(/\.[^./\\]+$/, '')}.${newLang}`;
          return {
            ...node,
            language: newLang,
            name: updatedName,
          };
        }),
      }));
      showTransientNotice(
        `Switched mode to ${newLang === 'luau' ? 'Luau' : newLang === 'lua' ? 'Lua 5.4' : 'Other (plain text)'}`
      );
    },
    [activeFile.id, updateActiveProject, showTransientNotice]
  );

  // Toggle Top Navigation Panel (Projects | Plugins | Git)
  const handleTogglePanel = useCallback((panel: Exclude<NavPanel, null>) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  // Toolbar Actions dispatcher
  const handleToolbarAction = useCallback(
    (action: ToolbarActionType) => {
      if (action === 'find') {
        setIsFindOpen((prev) => {
          if (prev && !isReplaceOpen) return false;
          setIsReplaceOpen(false);
          return true;
        });
        return;
      }
      if (action === 'replace') {
        setIsFindOpen((prev) => {
          if (prev && isReplaceOpen) return false;
          setIsReplaceOpen(true);
          return true;
        });
        return;
      }
      if (editorCommandRef.current) {
        editorCommandRef.current(action);
      }
    },
    [isReplaceOpen]
  );

  // Global keyboard shortcuts for Find (Ctrl+F) and Replace (Ctrl+H)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsFindOpen(true);
      } else if (isMod && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setIsFindOpen(true);
        setIsReplaceOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // File & Project Management Operations (Section 9)
  const handleSelectFile = useCallback(
    (fileId: string) => {
      updateActiveProject((proj) => {
        const isOpen = proj.openFileIds.includes(fileId);
        return {
          ...proj,
          activeFileId: fileId,
          openFileIds: isOpen ? proj.openFileIds : [...proj.openFileIds, fileId],
        };
      });
    },
    [updateActiveProject]
  );

  const handleCloseTab = useCallback(
    (fileId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      updateActiveProject((proj) => {
        const remaining = proj.openFileIds.filter((id) => id !== fileId);
        if (remaining.length === 0) return proj;
        const nextActive =
          proj.activeFileId === fileId ? remaining[remaining.length - 1] : proj.activeFileId;
        return {
          ...proj,
          openFileIds: remaining,
          activeFileId: nextActive,
        };
      });
    },
    [updateActiveProject]
  );

  const handleCreateFile = useCallback(
    (name: string, parentId: string | null, requestedLanguage: LanguageMode) => {
      const id = `file-${Date.now()}`;
      const language: LanguageMode =
        activeProject.language === 'other' ? 'other' : requestedLanguage;
      const starterTemplate =
        language === 'other'
          ? ''
          : language === 'luau'
          ? `--!strict\n-- ${name}\n\nlocal Module = {}\n\nfunction Module.init(): boolean\n  return true\nend\n\nreturn Module\n`
          : `-- ${name}\n\nlocal Module = {}\n\nfunction Module.init()\n  return true\nend\n\nreturn Module\n`;

      const newFile: FileItem = {
        id,
        name,
        parentId,
        type: 'file',
        language,
        content: starterTemplate,
        savedContent: starterTemplate,
        lastModified: Date.now(),
        undoStack: [],
        redoStack: [],
      };

      updateActiveProject((proj) => ({
        ...proj,
        nodes: [...proj.nodes, newFile],
        openFileIds: [...proj.openFileIds, id],
        activeFileId: id,
      }));
      showTransientNotice(`Created ${name}`);
    },
    [activeProject.language, updateActiveProject, showTransientNotice]
  );

  const handleQuickNewFile = useCallback(() => {
    const count = allProjectFiles.length + 1;
    const lang: LanguageMode = activeProject.language || 'luau';
    const ext = lang === 'other' ? 'txt' : lang;
    handleCreateFile(`Script${count}.${ext}`, null, lang);
  }, [allProjectFiles.length, activeProject.language, handleCreateFile]);

  const handleCreateFolder = useCallback(
    (name: string, parentId: string | null) => {
      const newFolder: FolderItem = {
        id: `folder-${Date.now()}`,
        name,
        parentId,
        type: 'folder',
        isOpen: true,
      };
      updateActiveProject((proj) => ({
        ...proj,
        nodes: [...proj.nodes, newFolder],
      }));
      showTransientNotice(`Created folder ${name}`);
    },
    [updateActiveProject, showTransientNotice]
  );

  const handleRenameNode = useCallback(
    (nodeId: string, newName: string) => {
      updateActiveProject((proj) => ({
        ...proj,
        nodes: proj.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          if (n.type === 'file' && activeProject.language === 'other') {
            return { ...n, name: newName, language: 'other' as const };
          }
          if (n.type === 'file') {
            let finalName = newName;
            let lang: LanguageMode = n.language;
            if (/\.luau$/i.test(finalName)) lang = 'luau';
            else if (/\.lua$/i.test(finalName)) lang = 'lua';
            else if (lang !== 'other' && !/\.[^./\\]+$/.test(finalName)) finalName = `${finalName}.${lang}`;
            else if (/\.[^./\\]+$/.test(finalName)) lang = 'other';
            return { ...n, name: finalName, language: lang };
          }
          return { ...n, name: newName };
        }),
      }));
    },
    [activeProject.language, updateActiveProject]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      updateActiveProject((proj) => {
        // Also collect child nodes if deleting a folder
        const toDelete = new Set<string>([nodeId]);
        let added = true;
        while (added) {
          added = false;
          for (const n of proj.nodes) {
            if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
              toDelete.add(n.id);
              added = true;
            }
          }
        }

        const remainingNodes = proj.nodes.filter((n) => !toDelete.has(n.id));
        const remainingFiles = remainingNodes.filter((n): n is FileItem => n.type === 'file');
        const remainingOpen = proj.openFileIds.filter((id) => !toDelete.has(id));
        const nextActive = toDelete.has(proj.activeFileId)
          ? remainingOpen[0] || remainingFiles[0]?.id || ''
          : proj.activeFileId;

        return {
          ...proj,
          nodes: remainingNodes,
          openFileIds:
            remainingOpen.length > 0
              ? remainingOpen
              : remainingFiles[0]
              ? [remainingFiles[0].id]
              : [],
          activeFileId: nextActive,
        };
      });
      showTransientNotice('Deleted item');
    },
    [updateActiveProject, showTransientNotice]
  );

  const handleToggleFolder = useCallback(
    (folderId: string) => {
      updateActiveProject((proj) => ({
        ...proj,
        nodes: proj.nodes.map((n) =>
          n.type === 'folder' && n.id === folderId ? { ...n, isOpen: !n.isOpen } : n
        ),
      }));
    },
    [updateActiveProject]
  );

  const handleCreateProject = useCallback(
    (name: string, language: LanguageMode) => {
      const now = Date.now();
      const starterFileId = `file-${now}`;
      const starterName =
        language === 'luau' ? 'init.luau' : language === 'lua' ? 'init.lua' : 'main.txt';
      const starterCode =
        language === 'luau'
          ? `--!strict\n-- ${name} Entry Point\n\nprint("Hello from ${name}")\n`
          : language === 'lua'
          ? `-- ${name} Entry Point\n\nprint("Hello from ${name}")\n`
          : '';
      const starterFile: FileItem = {
        id: starterFileId,
        name: starterName,
        parentId: null,
        type: 'file',
        language,
        content: starterCode,
        savedContent: starterCode,
        lastModified: now,
        undoStack: [],
        redoStack: [],
      };

      const langLabel = language === 'luau' ? 'Luau' : language === 'lua' ? 'Lua' : 'Other';
      const newProj: Project = {
        id: `proj-${now}`,
        name,
        description: `${langLabel} project`,
        language,
        source: 'app',
        nodes: [starterFile],
        openFileIds: [starterFileId],
        activeFileId: starterFileId,
        stagedFileIds: [],
        commits: [],
      };

      setProjects((prev) => [...prev, newProj]);
      setActiveProjectId(newProj.id);
      showTransientNotice(`Created project ${name}`);
    },
    [showTransientNotice]
  );

  // Import a folder picked from disk: language is always "other", name = folder name
  const handleImportProject = useCallback(
    (
      folderName: string,
      files: DiskFile[],
      handle: FileSystemDirectoryHandle | undefined,
      skipped: number
    ) => {
      const now = Date.now();
      const projId = `proj-${now}`;
      const nodes = mergeFiles([], files, now);
      const firstRootFile = nodes.find((n) => n.type === 'file' && n.parentId === null);
      const firstId = firstRootFile?.id || nodes.find((n) => n.type === 'file')?.id || '';

      const newProj: Project = {
        id: projId,
        name: folderName,
        description: `From disk · ${files.length} file${files.length === 1 ? '' : 's'}`,
        language: 'other',
        source: 'disk',
        nodes,
        openFileIds: firstId ? [firstId] : [],
        activeFileId: firstId,
        stagedFileIds: [],
        commits: [],
      };

      if (handle) registerDiskHandle(projId, handle);
      setProjects((prev) => [...prev, newProj]);
      setActiveProjectId(projId);
      showTransientNotice(
        `Opened ${folderName} (${files.length} files${skipped ? `, ${skipped} skipped` : ''})`
      );
    },
    [showTransientNotice]
  );

  const handleDeleteProject = useCallback(
    (projectId: string) => {
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setActiveProjectId((cur) => (cur === projectId ? '' : cur));
      showTransientNotice('Project removed');
    },
    [showTransientNotice]
  );

  // ---------- GitHub: login / clone / publish / push / pull ----------
  const handleLogin = useCallback(async (token: string) => {
    const user = await validateToken(token.trim());
    const next: GitAuth = {
      token: token.trim(),
      login: user.login,
      name: user.name,
      avatar: user.avatar_url,
    };
    setAuth(next);
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    return `Signed in as ${user.login}`;
  }, []);

  const handleLogout = useCallback(() => {
    setAuth(null);
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      // ignore
    }
    showTransientNotice('Signed out');
  }, [showTransientNotice]);

  const updateProjectById = useCallback((id: string, updater: (p: Project) => Project) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? updater(p) : p)));
  }, []);

  const handleClone = useCallback(
    async (input: string) => {
      if (!auth) throw new Error('Sign in first');
      const m = input
        .trim()
        .replace(/^https?:\/\/github\.com\//i, '')
        .replace(/\.git$/i, '')
        .replace(/\/+$/, '')
        .match(/^([\w.-]+)\/([\w.-]+)$/);
      if (!m) throw new Error('Use the format owner/repo');
      const [, owner, repo] = m;
      const branch = await getDefaultBranch(auth.token, owner, repo);
      const { files, skipped } = await fetchRemoteFiles(auth.token, owner, repo, branch);
      const now = Date.now();
      const nodes = mergeFiles([], files, now);
      const firstFile = nodes.find((n) => n.type === 'file' && n.parentId === null) ||
        nodes.find((n) => n.type === 'file');
      const commitId = `commit-${now}`;
      const newProj: Project = {
        id: `proj-${now}`,
        name: repo,
        description: `${owner}/${repo} · ${branch}`,
        language: 'other',
        source: 'github',
        remote: { owner, repo, branch, pushedCommitId: commitId, syncedPaths: files.map((f) => f.path) },
        nodes,
        openFileIds: firstFile ? [firstFile.id] : [],
        activeFileId: firstFile?.id || '',
        stagedFileIds: [],
        commits: [
          {
            id: commitId,
            hash: Math.random().toString(16).slice(2, 9),
            message: `clone: ${owner}/${repo}`,
            timestamp: now,
            author: auth.login,
            snapshot: snapshotOf(nodes),
          },
        ],
      };
      setProjects((prev) => [...prev, newProj]);
      setActiveProjectId(newProj.id);
      return `Cloned ${owner}/${repo} (${files.length} files${skipped ? `, ${skipped} skipped` : ''})`;
    },
    [auth]
  );

  const pushHead = async (proj: Project, owner: string, repo: string, branch: string) => {
    if (!auth) throw new Error('Sign in first');
    const head = proj.commits[0];
    if (!head) throw new Error('Make a commit first');
    const files = Object.values(head.snapshot).map((s) => ({ path: s.path, content: s.content }));
    const result = await pushFiles(
      auth.token,
      owner,
      repo,
      branch,
      files,
      proj.remote?.syncedPaths || [],
      head.message
    );
    updateProjectById(proj.id, (p) => ({
      ...p,
      remote: {
        owner,
        repo,
        branch,
        pushedCommitId: head.id,
        syncedPaths: files.map((f) => f.path),
      },
    }));
    return result.upToDate
      ? 'Already up to date'
      : `Pushed ${result.changed} changed${result.deleted ? `, ${result.deleted} deleted` : ''} to ${owner}/${repo}`;
  };

  const handlePublish = useCallback(
    async (repoName: string, isPrivate: boolean) => {
      if (!auth) throw new Error('Sign in first');
      const proj = activeProject;
      if (!proj.id) throw new Error('Open a project first');
      if (proj.commits.length === 0) throw new Error('Make a commit first');
      const { owner, repo, branch } = await createRepo(auth.token, repoName.trim(), isPrivate);
      const msg = await pushHead(proj, owner, repo, branch);
      updateProjectById(proj.id, (p) => ({ ...p, source: p.source === 'disk' ? 'disk' : p.source }));
      return `Published to ${owner}/${repo}. ${msg}`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth, activeProject]
  );

  const handlePush = useCallback(async () => {
    const proj = activeProject;
    if (!proj.remote) throw new Error('No remote linked');
    return pushHead(proj, proj.remote.owner, proj.remote.repo, proj.remote.branch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, activeProject]);

  const handlePull = useCallback(async () => {
    if (!auth) throw new Error('Sign in first');
    const proj = activeProject;
    if (!proj.remote) throw new Error('No remote linked');
    const head = proj.commits[0]?.snapshot || {};
    const dirty = proj.nodes.some(
      (n) => n.type === 'file' && (!head[n.id] || head[n.id].content !== n.content)
    );
    if (dirty) throw new Error('Commit or discard your changes before pulling');
    const { owner, repo, branch } = proj.remote;
    const { files } = await fetchRemoteFiles(auth.token, owner, repo, branch);
    const now = Date.now();
    const remotePaths = new Set(files.map((f) => f.path));
    const synced = new Set(proj.remote.syncedPaths || []);

    // drop local files that were removed upstream
    const withoutRemoved = proj.nodes.filter((n) => {
      if (n.type !== 'file') return true;
      const p = getNodePath(proj.nodes, n);
      return !(synced.has(p) && !remotePaths.has(p));
    });
    const nodes = mergeFiles(withoutRemoved, files, now, proj.language || 'other');
    const snap = snapshotOf(nodes);
    const changed = JSON.stringify(snap) !== JSON.stringify(head);
    const commitId = `commit-${now}`;
    const fileIds = nodes.filter((n) => n.type === 'file').map((n) => n.id);
    updateProjectById(proj.id, (p) => ({
      ...p,
      nodes,
      stagedFileIds: [],
      openFileIds: p.openFileIds.filter((id) => fileIds.includes(id)),
      activeFileId: fileIds.includes(p.activeFileId) ? p.activeFileId : fileIds[0] || '',
      remote: { owner, repo, branch, pushedCommitId: changed ? commitId : p.commits[0]?.id, syncedPaths: files.map((f) => f.path) },
      commits: changed
        ? [
            {
              id: commitId,
              hash: Math.random().toString(16).slice(2, 9),
              message: `pull: ${owner}/${repo}@${branch}`,
              timestamp: now,
              author: auth.login,
              snapshot: snap,
            },
            ...p.commits,
          ]
        : p.commits,
    }));
    return changed ? `Pulled ${files.length} files from ${owner}/${repo}` : 'Already up to date';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, activeProject]);

  // Git Operations
  const gitChangesCount = useMemo(() => {
    const head = activeProject.commits[0]?.snapshot || {};
    let count = 0;
    const seen = new Set<string>();
    for (const f of allProjectFiles) {
      seen.add(f.id);
      if (!head[f.id] || head[f.id].content !== f.content) {
        count++;
      }
    }
    for (const id of Object.keys(head)) {
      if (!seen.has(id)) count++;
    }
    return count;
  }, [activeProject.commits, allProjectFiles]);

  const handleStageFile = useCallback(
    (fileId: string) => {
      updateActiveProject((proj) => ({
        ...proj,
        stagedFileIds: proj.stagedFileIds.includes(fileId)
          ? proj.stagedFileIds
          : [...proj.stagedFileIds, fileId],
      }));
    },
    [updateActiveProject]
  );

  const handleUnstageFile = useCallback(
    (fileId: string) => {
      updateActiveProject((proj) => ({
        ...proj,
        stagedFileIds: proj.stagedFileIds.filter((id) => id !== fileId),
      }));
    },
    [updateActiveProject]
  );

  const handleStageAll = useCallback(
    (fileIds: string[]) => {
      updateActiveProject((proj) => ({
        ...proj,
        stagedFileIds: Array.from(new Set([...proj.stagedFileIds, ...fileIds])),
      }));
    },
    [updateActiveProject]
  );

  const handleUnstageAll = useCallback(() => {
    updateActiveProject((proj) => ({
      ...proj,
      stagedFileIds: [],
    }));
  }, [updateActiveProject]);

  const handleDiscardChanges = useCallback(
    (fileId: string, oldContent: string, status: 'M' | 'A' | 'D') => {
      if (status === 'A') {
        handleDeleteNode(fileId);
        return;
      }
      if (status === 'M') {
        updateActiveProject((proj) => ({
          ...proj,
          nodes: proj.nodes.map((n) =>
            n.type === 'file' && n.id === fileId
              ? {
                  ...n,
                  content: oldContent,
                  savedContent: oldContent,
                  lastModified: Date.now(),
                }
              : n
          ),
        }));
        showTransientNotice('Discarded changes');
      }
    },
    [handleDeleteNode, updateActiveProject, showTransientNotice]
  );

  const handleCommit = useCallback(
    (message: string) => {
      const now = Date.now();
      updateActiveProject((proj) => {
        const prevSnap = proj.commits[0]?.snapshot || {};
        const nextSnap: Record<string, { name: string; path: string; content: string }> = {
          ...prevSnap,
        };

        const commitOnlyStaged = proj.stagedFileIds.length > 0;
        const currentFiles = proj.nodes.filter((n): n is FileItem => n.type === 'file');
        const currentMap = new Map<string, FileItem>();
        currentFiles.forEach((f) => currentMap.set(f.id, f));

        if (commitOnlyStaged) {
          for (const stagedId of proj.stagedFileIds) {
            const f = currentMap.get(stagedId);
            if (f) {
              nextSnap[stagedId] = {
                name: f.name,
                path: getNodePath(proj.nodes, f),
                content: f.content,
              };
            } else {
              delete nextSnap[stagedId];
            }
          }
        } else {
          // Commit all working changes
          Object.keys(nextSnap).forEach((k) => delete nextSnap[k]);
          for (const f of currentFiles) {
            nextSnap[f.id] = {
              name: f.name,
              path: getNodePath(proj.nodes, f),
              content: f.content,
            };
          }
        }

        const newCommit: GitCommit = {
          id: `commit-${now}`,
          hash: Math.random().toString(16).slice(2, 9),
          message,
          timestamp: now,
          author: auth?.login || 'dev@sbox.local',
          snapshot: nextSnap,
        };

        // Also mark committed files as saved
        const updatedNodes: ProjectNode[] = proj.nodes.map((n) => {
          if (n.type !== 'file') return n;
          if (!commitOnlyStaged || proj.stagedFileIds.includes(n.id)) {
            return { ...n, savedContent: n.content };
          }
          return n;
        });

        return {
          ...proj,
          nodes: updatedNodes,
          stagedFileIds: [],
          commits: [newCommit, ...proj.commits],
        };
      });
      showTransientNotice('Committed changes to main');
    },
    [updateActiveProject, showTransientNotice, auth]
  );

  // Syntax diagnostics for current buffer
  const diagnostics = useMemo(
    () => validateLuaSyntax(activeFile.content, activeFile.language),
    [activeFile.content, activeFile.language]
  );

  return (
    <div
      style={{
        height: viewportHeight ? `${viewportHeight}px` : '100dvh',
      }}
      className="w-screen max-w-full bg-[#1B1B1C] text-[#E6E6E8] flex flex-col overflow-hidden relative"
    >
      {/* 1. TOP HEADER: File Name | Projects | Plugins | Git | Last Edited | Undo | Redo */}
      <TopHeader
        activeFile={hasProject && allProjectFiles.length > 0 ? activeFile : null}
        activePanel={activePanel}
        onTogglePanel={handleTogglePanel}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={activeFile.undoStack.length > 0}
        canRedo={activeFile.redoStack.length > 0}
        onLanguageChange={handleLanguageChange}
        gitChangesCount={gitChangesCount}
        onRenameActiveFile={() => setActivePanel('projects')}
      />

      {/* 2. DIVIDER: Thin gray horizontal line */}
      <div className="h-px w-full bg-[#2F2F30] shrink-0" />

      {/* 3. EDITOR TOOLBAR: Cut | Copy | Paste | Save | Find | Replace | Indent | Outdent | ; | | | : | More */}
      <EditorToolbar
        onAction={handleToolbarAction}
        isFindOpen={isFindOpen}
        isReplaceOpen={isReplaceOpen}
        isDirty={activeFile.content !== activeFile.savedContent}
      />

      {/* 4. DIVIDER: Thin gray horizontal line */}
      <div className="h-px w-full bg-[#2F2F30] shrink-0" />

      {/* 5. MAIN WORKSPACE: Optional Side Panel + Main Code Editor (Line Numbers | Code Editor) */}
      <div className="flex-1 flex min-h-0 min-w-0 relative overflow-hidden">
        {/* Side Panels (Projects, Plugins, Git) */}
        {activePanel && (
          <>
            {/* Mobile backdrop overlay when panel is open on small screens */}
            <div
              onClick={() => setActivePanel(null)}
              className="md:hidden fixed inset-0 top-[82px] bg-black/40 z-20"
            />
            <div className="fixed md:static top-[82px] bottom-0 left-0 z-30 h-[calc(100%-82px)] md:h-full flex">
              {activePanel === 'projects' && (
                <ProjectsPanel
                  projects={projects}
                  activeProject={activeProject}
                  onSelectProject={(id) => setActiveProjectId(id)}
                  onCreateProject={handleCreateProject}
                  onImportProject={handleImportProject}
                  onDeleteProject={handleDeleteProject}
                  auth={auth}
                  onClone={handleClone}
                  onOpenGit={() => setActivePanel('git')}
                  onSelectFile={(id) => {
                    handleSelectFile(id);
                    if (window.innerWidth < 768) setActivePanel(null);
                  }}
                  onCreateFile={handleCreateFile}
                  onCreateFolder={handleCreateFolder}
                  onRenameNode={handleRenameNode}
                  onDeleteNode={handleDeleteNode}
                  onToggleFolder={handleToggleFolder}
                  onSaveAll={handleSaveAllFiles}
                  onClosePanel={() => setActivePanel(null)}
                />
              )}

              {activePanel === 'plugins' && (
                <PluginsPanel onClosePanel={() => setActivePanel(null)} />
              )}

              {activePanel === 'git' && (
                <GitPanel
                  activeProject={activeProject}
                  onStageFile={handleStageFile}
                  onUnstageFile={handleUnstageFile}
                  onStageAll={handleStageAll}
                  onUnstageAll={handleUnstageAll}
                  onDiscardChanges={handleDiscardChanges}
                  onCommit={handleCommit}
                  onSelectFile={handleSelectFile}
                  onClosePanel={() => setActivePanel(null)}
                  auth={auth}
                  onLogin={handleLogin}
                  onLogout={handleLogout}
                  onClone={handleClone}
                  onPublish={handlePublish}
                  onPush={handlePush}
                  onPull={handlePull}
                />
              )}
            </div>
          </>
        )}

        {/* MAIN EDITOR: Line Numbers | Code Editor */}
        {hasProject ? (
        <CodeEditor
          activeFile={activeFile}
          openFiles={openFiles}
          onSelectFile={handleSelectFile}
          onCloseTab={handleCloseTab}
          onQuickNewFile={handleQuickNewFile}
          onChangeContent={handleChangeContent}
          onSave={handleSaveActiveFile}
          onUndo={handleUndo}
          onRedo={handleRedo}
          isFindOpen={isFindOpen}
          isReplaceOpen={isReplaceOpen}
          onCloseFind={() => {
            setIsFindOpen(false);
            setIsReplaceOpen(false);
          }}
          onToggleReplaceMode={() => {
            setIsFindOpen(true);
            setIsReplaceOpen((prev) => !prev);
          }}
          externalCommandRef={editorCommandRef}
          diagnostics={diagnostics}
          autosaveEnabled={autosaveEnabled}
          onToggleAutosave={() => {
            setAutosaveEnabled((prev) => {
              const next = !prev;
              showTransientNotice(`Autosave ${next ? 'enabled' : 'disabled'}`);
              return next;
            });
          }}
          onLanguageChange={handleLanguageChange}
        />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center bg-[#1B1B1C]">
            <p className="text-[14px] text-[#E6E6E8] font-medium">No projects yet</p>
            <p className="text-[12px] text-[#707073] max-w-[260px]">
              Create a new project, open a folder from disk, or clone a repo from GitHub.
            </p>
            <button
              type="button"
              onClick={() => setActivePanel('projects')}
              className="px-3 py-1.5 rounded border border-[#3E3E40] bg-[#2E2E2F] hover:bg-[#3E3E40] text-[12px] text-[#E6E6E8] transition-colors"
            >
              Open Projects
            </button>
          </div>
        )}
      </div>

      {/* Subtle Toast Notice */}
      {statusNotice && (
        <div className="fixed bottom-8 right-4 z-50 px-3 py-1.5 rounded bg-[#222223] border border-[#3E3E40] text-[11.5px] text-[#E6E6E8] shadow-lg pointer-events-none">
          {statusNotice}
        </div>
      )}
    </div>
  );
}
export default App;
