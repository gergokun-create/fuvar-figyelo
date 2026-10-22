// GitHub Contents API kliens: JSON-fájlok olvasása és sha-alapú írása ütközéskezeléssel.
// Böngészőben és Node 20+-ban is fut (globális fetch).

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function createClient({ owner, repo, branch = 'main', token, fetchImpl = globalThis.fetch }) {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function req(method, path, body) {
    const res = await fetchImpl(base + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* nem JSON */ }
    if (!res.ok) throw new GitHubError(res.status, json?.message || `HTTP ${res.status}`);
    return json;
  }

  /** JSON-fájl beolvasása: { data, sha } vagy { data: null, sha: null }, ha nem létezik. */
  async function readJson(path) {
    try {
      const meta = await req('GET', `/contents/${path}?ref=${encodeURIComponent(branch)}`);
      let content = meta.content;
      if (!content && meta.sha) {
        // 1 MB fölött a Contents API nem adja vissza a tartalmat -> blob API
        const blob = await req('GET', `/git/blobs/${meta.sha}`);
        content = blob.content;
      }
      return { data: content ? JSON.parse(b64decodeUtf8(content)) : null, sha: meta.sha };
    } catch (e) {
      if (e.status === 404) return { data: null, sha: null };
      throw e;
    }
  }

  async function writeJson(path, data, sha, message) {
    const body = {
      message: message || `Frissítés: ${path}`,
      content: b64encodeUtf8(JSON.stringify(data, null, 1) + '\n'),
      branch,
      ...(sha ? { sha } : {}),
    };
    const res = await req('PUT', `/contents/${path}`, body);
    return res.content.sha;
  }

  /**
   * Olvas-módosít-ír ciklus: ütközésnél (409, vagy 422 sha-hiba) újraolvas, a módosítást
   * újra alkalmazza a friss adatra, és újra ír. mutate(data|null) -> új adat (vagy undefined: nincs írás).
   */
  async function update(path, mutate, { message, retries = 4, initial } = {}) {
    let cur = initial || (await readJson(path));
    for (let attempt = 0; ; attempt++) {
      const next = await mutate(cur.data === null ? null : structuredClone(cur.data));
      if (next === undefined) return { data: cur.data, sha: cur.sha, written: false };
      try {
        const sha = await writeJson(path, next, cur.sha, message);
        return { data: next, sha, written: true };
      } catch (e) {
        const conflict = e.status === 409 || (e.status === 422 && /sha/i.test(e.message));
        if (!conflict || attempt >= retries) throw e;
        cur = await readJson(path);
      }
    }
  }

  async function dispatchWorkflow(file, inputs = {}) {
    await req('POST', `/actions/workflows/${encodeURIComponent(file)}/dispatches`, { ref: branch, inputs });
  }

  async function checkAccess() {
    const r = await req('GET', '');
    return { private: r.private, fullName: r.full_name, push: !!r.permissions?.push };
  }

  return { readJson, writeJson, update, dispatchWorkflow, checkAccess };
}
