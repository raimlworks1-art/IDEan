// Minimal GitHub client (REST + Git Data API). Runs entirely in the browser with
// a personal access token; api.github.com allows CORS so no backend is needed.

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface RemoteFile {
  path: string;
  content: string;
}

const API = 'https://api.github.com';
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 500;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|7z|rar|exe|dll|so|dylib|o|a|obj|class|jar|woff2?|ttf|otf|mp3|mp4|wav|ogg|mov|avi|rbxl|rbxm|bin|dat)$/i;

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { message?: string }).message || '';
    } catch {
      /* ignore */
    }
    const err = new Error(detail || `GitHub error ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const validateToken = (token: string) => gh<GitHubUser>(token, '/user');

export async function createRepo(
  token: string,
  name: string,
  isPrivate: boolean
): Promise<{ owner: string; repo: string; branch: string }> {
  const r = await gh<{ name: string; owner: { login: string }; default_branch: string }>(
    token,
    '/user/repos',
    {
      method: 'POST',
      body: JSON.stringify({ name, private: isPrivate, auto_init: true }),
    }
  );
  return { owner: r.owner.login, repo: r.name, branch: r.default_branch || 'main' };
}

export async function getDefaultBranch(token: string, owner: string, repo: string) {
  const r = await gh<{ default_branch: string }>(token, `/repos/${owner}/${repo}`);
  return r.default_branch;
}

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

async function getBranchTree(token: string, owner: string, repo: string, branch: string) {
  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  const commitSha = ref.object.sha;
  const commit = await gh<{ tree: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/commits/${commitSha}`
  );
  const tree = await gh<{ tree: TreeEntry[]; truncated: boolean }>(
    token,
    `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`
  );
  return { commitSha, treeSha: commit.tree.sha, entries: tree.tree.filter((e) => e.type === 'blob') };
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Download all text files of a branch (used by Clone and Pull). */
export async function fetchRemoteFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ files: RemoteFile[]; skipped: number }> {
  const { entries } = await getBranchTree(token, owner, repo, branch);
  let skipped = 0;
  const wanted = entries.filter((e) => {
    if (BINARY_EXT.test(e.path) || (e.size ?? 0) > MAX_FILE_BYTES) {
      skipped++;
      return false;
    }
    return true;
  });
  if (wanted.length > MAX_FILES) skipped += wanted.length - MAX_FILES;
  const limited = wanted.slice(0, MAX_FILES);

  const results = await mapLimit(limited, 6, async (e) => {
    const blob = await gh<{ content: string; encoding: string }>(
      token,
      `/repos/${owner}/${repo}/git/blobs/${e.sha}`
    );
    const text = blob.encoding === 'base64' ? decodeBase64Utf8(blob.content) : blob.content;
    if (text.slice(0, 4000).includes('\u0000')) {
      skipped++;
      return null;
    }
    return { path: e.path, content: text } as RemoteFile;
  });
  return { files: results.filter((r): r is RemoteFile => r !== null), skipped };
}

async function gitBlobSha(content: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const body = new TextEncoder().encode(content);
  const head = new TextEncoder().encode(`blob ${body.length}\u0000`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head, 0);
  all.set(body, head.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface PushResult {
  upToDate: boolean;
  changed: number;
  deleted: number;
}

/** Push a snapshot of files as ONE commit on top of the remote branch. */
export async function pushFiles(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: RemoteFile[],
  previouslySyncedPaths: string[],
  message: string
): Promise<PushResult> {
  const base = await getBranchTree(token, owner, repo, branch);
  const remoteMap = new Map(base.entries.map((e) => [e.path, e.sha]));

  const toUpload: RemoteFile[] = [];
  for (const f of files) {
    const localSha = await gitBlobSha(f.content);
    if (!localSha || remoteMap.get(f.path) !== localSha) toUpload.push(f);
  }

  const currentPaths = new Set(files.map((f) => f.path));
  const toDelete = previouslySyncedPaths.filter((p) => !currentPaths.has(p) && remoteMap.has(p));

  if (toUpload.length === 0 && toDelete.length === 0) {
    return { upToDate: true, changed: 0, deleted: 0 };
  }

  const uploaded = await mapLimit(toUpload, 6, async (f) => {
    const blob = await gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
    });
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha as string | null };
  });
  const deletions = toDelete.map((p) => ({ path: p, mode: '100644', type: 'blob', sha: null as string | null }));

  const tree = await gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: base.treeSha, tree: [...uploaded, ...deletions] }),
  });
  const commit = await gh<{ sha: string }>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [base.commitSha] }),
  });
  await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha }),
  });
  return { upToDate: false, changed: toUpload.length, deleted: toDelete.length };
}

export interface RepoSummary {
  full_name: string;
  name: string;
  private: boolean;
  description: string | null;
  updated_at: string;
  language: string | null;
}

/** The signed-in user's repos (owned, collaborator, org), most recently updated first. */
export async function listRepos(token: string): Promise<RepoSummary[]> {
  const all: RepoSummary[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await gh<RepoSummary[]>(
      token,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// ---------- Browser login (OAuth Device Flow) ----------
// GitHub's OAuth endpoints don't allow direct browser (CORS) requests and the web
// flow needs a client secret, so the app talks to a tiny proxy you host (see
// github-oauth-worker.js). Device flow needs only the OAuth App's Client ID.

export interface OAuthConfig {
  clientId: string;
  proxy: string; // e.g. https://sbox-oauth.yourname.workers.dev
}

const OAUTH_CFG_KEY = 'sbox_oauth_cfg_v1';

export function loadOAuthConfig(): OAuthConfig {
  try {
    const raw = localStorage.getItem(OAUTH_CFG_KEY);
    if (raw) {
      const c = JSON.parse(raw) as OAuthConfig;
      return { clientId: c.clientId || '', proxy: c.proxy || '' };
    }
  } catch {
    /* ignore */
  }
  return { clientId: '', proxy: '' };
}

export function saveOAuthConfig(cfg: OAuthConfig) {
  try {
    localStorage.setItem(
      OAUTH_CFG_KEY,
      JSON.stringify({ clientId: cfg.clientId.trim(), proxy: cfg.proxy.trim().replace(/\/+$/, '') })
    );
  } catch {
    /* ignore */
  }
}

export const isOAuthConfigured = (c: OAuthConfig) => Boolean(c.clientId.trim() && c.proxy.trim());

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

async function oauthPost<T>(cfg: OAuthConfig, path: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(`${cfg.proxy.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Login service error ${res.status}`);
  return (await res.json()) as T;
}

export async function startDeviceFlow(cfg: OAuthConfig): Promise<DeviceCode> {
  const r = await oauthPost<DeviceCode & { error?: string; error_description?: string }>(
    cfg,
    '/login/device/code',
    { client_id: cfg.clientId.trim(), scope: 'repo' }
  );
  if (r.error) {
    throw new Error(
      r.error === 'device_flow_disabled'
        ? 'Enable "Device Flow" in your GitHub OAuth App settings'
        : r.error_description || r.error
    );
  }
  return r;
}

/** Polls until the user approves in the browser. Resolves with the access token. */
export async function pollDeviceToken(
  cfg: OAuthConfig,
  dc: DeviceCode,
  signal: AbortSignal
): Promise<string> {
  let interval = Math.max(dc.interval || 5, 1);
  const deadline = Date.now() + dc.expires_in * 1000;
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('cancelled'));
      });
    });

  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const r = await oauthPost<{ access_token?: string; error?: string }>(
      cfg,
      '/login/oauth/access_token',
      {
        client_id: cfg.clientId.trim(),
        device_code: dc.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }
    );
    if (r.access_token) return r.access_token;
    if (r.error === 'authorization_pending') continue;
    if (r.error === 'slow_down') {
      interval += 5;
      continue;
    }
    if (r.error === 'access_denied') throw new Error('Login was denied');
    if (r.error === 'expired_token') break;
    throw new Error(r.error || 'Login failed');
  }
  throw new Error('Login code expired. Try again.');
}
