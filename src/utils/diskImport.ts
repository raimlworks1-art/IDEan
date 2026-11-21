import { Capacitor, registerPlugin } from '@capacitor/core';

// Folder import ("From disk") using the File System Access API when available,
// with a <input webkitdirectory> fallback for browsers that lack it.

export interface DiskFile {
  path: string; // relative to the picked folder, e.g. "src/main.cpp"
  content: string;
}

export type DiskHandle = FileSystemDirectoryHandle | { native_tree: string } | { native_file: string };

export interface DiskFolder {
  name: string;
  files: DiskFile[];
  handle?: DiskHandle;
  skipped: number;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', '.idea', '.vscode', 'dist', 'build', '__pycache__']);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|7z|rar|exe|dll|so|dylib|o|a|obj|class|jar|woff2?|ttf|otf|mp3|mp4|wav|ogg|mov|avi|rbxl|rbxm|bin|dat)$/i;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MB
const MAX_FILES = 500;

// Handles survive only for the current session (they can't live in localStorage)
const handles = new Map<string, DiskHandle>();
const TREES_KEY = 'sbox_disk_trees';
const FILES_KEY = 'sbox_disk_files';

interface NativeFolder {
  name: string;
  tree_uri: string;
  files: DiskFile[];
  skipped: number;
}

export interface OpenedFile {
  uri: string;
  name: string;
  content?: string;
  error?: string;
}

interface DiskAccessApi {
  pick_folder(): Promise<NativeFolder>;
  write_file(opts: { tree_uri: string; path: string; content: string }): Promise<void>;
  write_uri(opts: { uri: string; content: string }): Promise<void>;
  addListener(
    event: 'file_opened',
    handler: (info: OpenedFile) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const DiskAccess = registerPlugin<DiskAccessApi>('DiskAccess');

function load_map(key: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

function save_entry(key: string, projectId: string, value: string) {
  const map = load_map(key);
  map[projectId] = value;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    return;
  }
}

export const registerDiskHandle = (projectId: string, h: DiskHandle) => {
  handles.set(projectId, h);
  if ('native_tree' in h) save_entry(TREES_KEY, projectId, h.native_tree);
  if ('native_file' in h) save_entry(FILES_KEY, projectId, h.native_file);
};

function get_handle(projectId: string): DiskHandle | undefined {
  const known = handles.get(projectId);
  if (known) return known;
  const tree = load_map(TREES_KEY)[projectId];
  if (tree) return { native_tree: tree };
  const file = load_map(FILES_KEY)[projectId];
  return file ? { native_file: file } : undefined;
}

export const hasDiskHandle = (projectId: string) => get_handle(projectId) !== undefined;

function looksBinary(text: string): boolean {
  return text.slice(0, 4000).includes('\u0000');
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: DiskFile[],
  stats: { skipped: number }
): Promise<void> {
  // @ts-expect-error async iterator on directory handles
  for await (const [name, entry] of dir.entries() as AsyncIterable<[string, FileSystemHandle]>) {
    if (out.length >= MAX_FILES) {
      stats.skipped++;
      continue;
    }
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(name)) continue;
      await walk(entry as FileSystemDirectoryHandle, `${prefix}${name}/`, out, stats);
    } else {
      if (BINARY_EXT.test(name)) {
        stats.skipped++;
        continue;
      }
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        if (file.size > MAX_FILE_BYTES) {
          stats.skipped++;
          continue;
        }
        const text = await file.text();
        if (looksBinary(text)) {
          stats.skipped++;
          continue;
        }
        out.push({ path: `${prefix}${name}`, content: text });
      } catch {
        stats.skipped++;
      }
    }
  }
}

function pickWithInput(): Promise<DiskFolder | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    let settled = false;
    const finish = (v: DiskFolder | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('cancel', () => finish(null));
    input.addEventListener('change', async () => {
      const list = Array.from(input.files || []);
      if (list.length === 0) return finish(null);
      const first = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      const rootName = first.split('/')[0] || 'Folder';
      const files: DiskFile[] = [];
      let skipped = 0;
      for (const f of list) {
        const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)
          .split('/')
          .slice(1)
          .join('/');
        const parts = rel.split('/');
        if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) continue;
        if (BINARY_EXT.test(f.name) || f.size > MAX_FILE_BYTES || files.length >= MAX_FILES) {
          skipped++;
          continue;
        }
        try {
          const text = await f.text();
          if (looksBinary(text)) {
            skipped++;
            continue;
          }
          files.push({ path: rel, content: text });
        } catch {
          skipped++;
        }
      }
      finish({ name: rootName, files, skipped });
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickFolderFromDisk(): Promise<DiskFolder | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await DiskAccess.pick_folder();
      return { name: res.name, files: res.files, handle: { native_tree: res.tree_uri }, skipped: res.skipped };
    } catch (err) {
      if ((err as { message?: string })?.message === 'cancelled') return null;
      throw err;
    }
  }
  const w = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof w.showDirectoryPicker === 'function') {
    try {
      const handle = await w.showDirectoryPicker({ mode: 'readwrite' });
      const files: DiskFile[] = [];
      const stats = { skipped: 0 };
      await walk(handle, '', files, stats);
      return { name: handle.name, files, handle, skipped: stats.skipped };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      // Picker blocked (e.g. inside an iframe) -> fall back to the input method
    }
  }
  return pickWithInput();
}

export async function writeBackToDisk(
  projectId: string,
  path: string,
  content: string
): Promise<boolean> {
  const root = get_handle(projectId);
  if (!root) return false;
  if ('native_tree' in root) {
    try {
      await DiskAccess.write_file({ tree_uri: root.native_tree, path, content });
      return true;
    } catch {
      return false;
    }
  }
  if ('native_file' in root) {
    try {
      await DiskAccess.write_uri({ uri: root.native_file, content });
      return true;
    } catch {
      return false;
    }
  }
  try {
    const parts = path.split('/');
    let dir = root;
    for (const p of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(p, { create: true });
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
    return true;
  } catch {
    return false;
  }
}
