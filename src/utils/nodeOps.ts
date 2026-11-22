import { FileItem, FolderItem, Project, ProjectNode } from '../types/ide';

export interface NodeClipboard {
  project_id: string;
  node_id: string;
  mode: 'copy' | 'cut';
}

export interface PasteResult {
  projects: Project[];
  ok: boolean;
  notice: string;
  clear_clipboard: boolean;
}

export function collect_subtree_ids(nodes: ProjectNode[], root_id: string): Set<string> {
  const ids = new Set<string>([root_id]);
  let added = true;
  while (added) {
    added = false;
    for (const n of nodes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        added = true;
      }
    }
  }
  return ids;
}

export function unique_sibling_name(
  nodes: ProjectNode[],
  parent_id: string | null,
  name: string,
  is_folder: boolean,
  ignore_id?: string
): string {
  const taken = new Set(
    nodes.filter((n) => n.parentId === parent_id && n.id !== ignore_id).map((n) => n.name.toLowerCase())
  );
  if (!taken.has(name.toLowerCase())) return name;
  const dot = is_folder ? -1 : name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = `${base} copy${n === 1 ? '' : ` ${n}`}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function remove_subtree(project: Project, root_id: string): Project {
  const to_delete = collect_subtree_ids(project.nodes, root_id);
  const remaining_nodes = project.nodes.filter((n) => !to_delete.has(n.id));
  const remaining_files = remaining_nodes.filter((n): n is FileItem => n.type === 'file');
  const remaining_open = project.openFileIds.filter((id) => !to_delete.has(id));
  const next_active = to_delete.has(project.activeFileId)
    ? remaining_open[0] || remaining_files[0]?.id || ''
    : project.activeFileId;
  return {
    ...project,
    nodes: remaining_nodes,
    openFileIds:
      remaining_open.length > 0 ? remaining_open : remaining_files[0] ? [remaining_files[0].id] : [],
    activeFileId: next_active,
    stagedFileIds: project.stagedFileIds.filter((id) => !to_delete.has(id)),
  };
}

const fail = (projects: Project[], notice: string): PasteResult => ({
  projects,
  ok: false,
  notice,
  clear_clipboard: false,
});

export function paste_node(
  projects: Project[],
  clip: NodeClipboard,
  dest_project_id: string,
  target_parent_id: string | null,
  dest_is_disk: boolean,
  stamp: number
): PasteResult {
  const src = projects.find((p) => p.id === clip.project_id);
  const dest = projects.find((p) => p.id === dest_project_id);
  if (!src || !dest) return fail(projects, 'Nothing to paste');
  const root = src.nodes.find((n) => n.id === clip.node_id);
  if (!root) return fail(projects, 'The copied item no longer exists');
  if (target_parent_id) {
    const parent = dest.nodes.find((n) => n.id === target_parent_id && n.type === 'folder');
    if (!parent) return fail(projects, 'Target folder not found');
  }
  const is_folder = root.type === 'folder';

  const open_target = (nodes: ProjectNode[]): ProjectNode[] =>
    nodes.map((n) => (n.type === 'folder' && n.id === target_parent_id ? { ...n, isOpen: true } : n));

  if (clip.mode === 'cut' && src.id === dest.id) {
    if (target_parent_id && collect_subtree_ids(src.nodes, root.id).has(target_parent_id)) {
      return fail(projects, "Can't move a folder into itself");
    }
    if (root.parentId === target_parent_id) return fail(projects, 'Already in that folder');
    const new_name = unique_sibling_name(dest.nodes, target_parent_id, root.name, is_folder, root.id);
    const moved_ids = collect_subtree_ids(dest.nodes, root.id);
    const moved = dest.nodes.map((n): ProjectNode => {
      const is_root = n.id === root.id;
      if (n.type === 'file' && moved_ids.has(n.id)) {
        const base: FileItem = dest_is_disk ? { ...n, savedContent: '' } : n;
        return is_root ? { ...base, parentId: target_parent_id, name: new_name } : base;
      }
      return is_root ? { ...n, parentId: target_parent_id, name: new_name } : n;
    });
    return {
      projects: projects.map((p) => (p.id === dest.id ? { ...p, nodes: open_target(moved) } : p)),
      ok: true,
      notice: `Moved ${new_name}`,
      clear_clipboard: true,
    };
  }

  const new_root_name = unique_sibling_name(dest.nodes, target_parent_id, root.name, is_folder);
  const ids = collect_subtree_ids(src.nodes, root.id);
  const id_map = new Map<string, string>();
  let counter = 0;
  for (const n of src.nodes) {
    if (ids.has(n.id)) {
      id_map.set(n.id, `${n.type}-${stamp}-${counter++}-${Math.random().toString(36).slice(2, 6)}`);
    }
  }
  const clones: ProjectNode[] = [];
  for (const n of src.nodes) {
    if (!ids.has(n.id)) continue;
    const is_root = n.id === root.id;
    const id = id_map.get(n.id) as string;
    const parentId = is_root ? target_parent_id : (id_map.get(n.parentId as string) as string);
    const name = is_root ? new_root_name : n.name;
    if (n.type === 'file') {
      const file: FileItem = {
        ...n,
        id,
        parentId,
        name,
        savedContent: dest_is_disk ? '' : n.content,
        lastModified: stamp,
        undoStack: [],
        redoStack: [],
      };
      clones.push(file);
    } else {
      const folder: FolderItem = { ...n, id, parentId, name, isOpen: true };
      clones.push(folder);
    }
  }
  const new_root_id = id_map.get(root.id) as string;
  const next_dest: Project = {
    ...dest,
    nodes: [...open_target(dest.nodes), ...clones],
    openFileIds: is_folder ? dest.openFileIds : [...dest.openFileIds, new_root_id],
    activeFileId: is_folder ? dest.activeFileId : new_root_id,
  };
  const moved_out = clip.mode === 'cut';
  const next_src = moved_out ? remove_subtree(src, root.id) : src;
  return {
    projects: projects.map((p) => {
      if (p.id === dest.id) return moved_out && src.id === dest.id ? p : next_dest;
      if (p.id === src.id && moved_out) return next_src;
      return p;
    }),
    ok: true,
    notice: moved_out ? `Moved ${new_root_name}` : `Pasted ${new_root_name}`,
    clear_clipboard: moved_out,
  };
}
