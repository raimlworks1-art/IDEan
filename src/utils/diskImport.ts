// Folder import ("From disk") using the File System Access API when available,
// with a <input webkitdirectory> fallback for browsers that lack it.

export interface DiskFile {
  path: string; // relative to the picked folder, e.g. "src/main.cpp"
  content: string;
}

export interface DiskFolder {
  name: string;
  files: DiskFile[];
  handle?: FileSystemDirectoryHandle;
  skipped: number;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', '.idea', '.vscode', 'dist', 'build', '__pycache__']);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|7z|rar|exe|dll|so|dylib|o|a|obj|class|jar|woff2?|ttf|otf|mp3|mp4|wav|ogg|mov|avi|rbxl|rbxm|bin|dat)$/i;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MB
const MAX_FILES = 500;

// Handles survive only for the current session (they can't live in localStorage)
const handles = new Map<string, FileSystemDirectoryHandle>();
export const registerDiskHandle = (projectId: string, h: FileSystemDirectoryHandle) =>
  handles.set(projectId, h);
export const hasDiskHandle = (projectId: string) => handles.has(projectId);

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
  const root = handles.get(projectId);
  if (!root) return false;
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
