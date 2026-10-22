// Állapot és tárolás. GitHub-kapcsolattal a privát repóba ír (Contents API), anélkül helyi módban
// a böngészőben tárol. Minden módosítás egy újra alkalmazható függvény, így ütközéskor (409)
// a friss távoli adatra újra lefuttatható.

import { createClient } from './core/github.js';
import { emptyData } from './core/sync.js';
import { DEFAULT_SETTINGS } from './core/schedule.js';

export const FILES = {
  data: 'data/fuvarok.json',
  formats: 'data/formatumok.json',
  settings: 'data/beallitasok.json',
  sent: 'state/elkuldve.json',
};
const EMPTY = {
  data: emptyData,
  formats: () => ({ verzio: 1, formatumok: [] }),
  settings: () => ({ verzio: 1, ...DEFAULT_SETTINGS }),
  sent: () => ({ verzio: 1, elkuldve: {} }),
};

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* tele / tiltott */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

const listeners = new Set();
export const state = {
  config: LS.get('ff.config', { owner: '', repo: 'fuvar-figyelo-data', branch: 'main', token: '' }),
  data: LS.get('ff.cache.data') || emptyData(),
  formats: LS.get('ff.cache.formats') || EMPTY.formats(),
  settings: LS.get('ff.cache.settings') || EMPTY.settings(),
  sent: LS.get('ff.cache.sent') || EMPTY.sent(),
  sha: {},
  pending: 0,
  status: 'helyi', // 'helyi' | 'betoltes' | 'kesz' | 'hiba'
  error: null,
  loadedAt: null,
};

export const remoteEnabled = () => !!(state.config.owner && state.config.repo && state.config.token);
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn(state));

function client() {
  const { owner, repo, branch, token } = state.config;
  return createClient({ owner, repo, branch: branch || 'main', token });
}

function cache(name) { LS.set(`ff.cache.${name}`, state[name]); }

export function saveConfig(cfg) {
  state.config = { ...state.config, ...cfg };
  LS.set('ff.config', state.config);
  emit();
}

/** Minden fájl betöltése a GitHubról. */
export async function loadAll() {
  if (!remoteEnabled()) { state.status = 'helyi'; emit(); return; }
  state.status = 'betoltes'; emit();
  try {
    const c = client();
    const res = await Promise.all(Object.entries(FILES).map(async ([name, path]) => [name, await c.readJson(path)]));
    for (const [name, { data, sha }] of res) {
      state[name] = data || EMPTY[name]();
      state.sha[name] = sha;
      (state.remote ||= {})[name] = data ? structuredClone(data) : null;
      cache(name);
    }
    state.status = 'kesz'; state.error = null; state.loadedAt = new Date().toISOString();
  } catch (e) {
    state.status = 'hiba'; state.error = humanError(e);
  }
  emit();
}

const queues = {};

/**
 * Módosítás: azonnal alkalmazzuk helyben, majd sorban kiírjuk. fn(adat) -> új adat; tisztán
 * az adatból dolgozzon, mert ütközéskor a friss távoli adatra is lefut.
 */
export function mutate(name, fn, message) {
  if (name === 'sent') throw new Error('Az elkuldve.json-t csak az ütemező írja.');
  state[name] = fn(structuredClone(state[name]));
  cache(name);
  emit();
  if (!remoteEnabled()) return Promise.resolve();
  state.pending++; emit();
  const run = async () => {
    try {
      const c = client();
      // az utolsó ismert távoli állapotból indulunk; ha közben más is írt, az update újraolvas
      const initial = state.sha[name] !== undefined && state.remote?.[name]
        ? { data: state.remote[name], sha: state.sha[name] } : undefined;
      const res = await c.update(FILES[name], (remote) => fn(remote || EMPTY[name]()), { message, initial });
      (state.remote ||= {})[name] = res.data;
      state[name] = res.data; state.sha[name] = res.sha; cache(name);
      state.error = null; state.status = 'kesz';
    } catch (e) {
      state.status = 'hiba'; state.error = 'Mentés sikertelen: ' + humanError(e);
    } finally {
      state.pending--; emit();
    }
  };
  queues[name] = (queues[name] || Promise.resolve()).then(run);
  return queues[name];
}

export async function testConnection(cfg) {
  const c = createClient({ ...state.config, ...cfg });
  return c.checkAccess();
}

export async function sendTestPush() {
  await client().dispatchWorkflow('utemezo.yml', { teszt: 'true' });
}

export function humanError(e) {
  if (!e) return '';
  if (e.status === 401) return 'Érvénytelen vagy lejárt token (401).';
  if (e.status === 403) return 'Nincs jogosultság (403). Ellenőrizd a token jogosultságait.';
  if (e.status === 404) return 'Nem található (404). Ellenőrizd a tulajdonos/repó nevét és a token hozzáférését.';
  if (e instanceof TypeError) return 'Hálózati hiba – nincs internet?';
  return e.message || String(e);
}

/** Helyi mód adatai a GitHubra (első bekapcsoláskor), ha a távoli még üres. */
export async function pushLocalIfRemoteEmpty(localSnapshot) {
  const c = client();
  for (const name of ['data', 'formats', 'settings']) {
    const remote = await c.readJson(FILES[name]);
    if (remote.data) continue;
    const local = localSnapshot[name];
    if (name === 'data' && !Object.keys(local.fuvarok || {}).length && !(local.feltoltesek || []).length) continue;
    if (name === 'formats' && !(local.formatumok || []).length) continue;
    await c.writeJson(FILES[name], local, null, `Kezdeti feltöltés: ${FILES[name]}`);
  }
}

export function forgetToken() {
  saveConfig({ token: '' });
  for (const n of Object.keys(FILES)) LS.del(`ff.cache.${n}`);
  state.data = emptyData(); state.formats = EMPTY.formats(); state.settings = EMPTY.settings(); state.sent = EMPTY.sent();
  state.status = 'helyi';
  emit();
}
