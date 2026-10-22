// Fuvar Figyelő – keret: útválasztás, állapotjelző, frissítés, service worker.
import { state, onChange, loadAll, remoteEnabled } from './store.js';
import * as napok from './views/napok.js';
import * as feltoltes from './views/feltoltes.js';
import * as fuvar from './views/fuvar.js';
import * as archivum from './views/archivum.js';
import * as beallitasok from './views/beallitasok.js';
import { startNtfySync } from './notify.js';

const view = document.getElementById('view');
const statusEl = document.getElementById('sync-status');

function route() {
  const [, name = 'napok', arg] = (location.hash || '#/napok').split('/');
  return { name, arg: arg ? decodeURIComponent(arg) : null };
}

function render() {
  const { name, arg } = route();
  for (const a of document.querySelectorAll('#tabs a')) {
    a.classList.toggle('active', a.dataset.tab === name || (name === 'fuvar' && a.dataset.tab === 'napok'));
  }
  if (name === 'feltoltes') feltoltes.render(view);
  else if (name === 'fuvar' && arg) fuvar.render(view, arg);
  else if (name === 'archivum') archivum.render(view);
  else if (name === 'beallitasok') beallitasok.render(view);
  else napok.render(view);
  renderStatus();
}

function renderStatus() {
  let txt = '', bad = false;
  if (!remoteEnabled()) txt = 'helyi mód';
  else if (state.pending) txt = 'mentés…';
  else if (state.status === 'betoltes') txt = 'betöltés…';
  else if (state.status === 'hiba') { txt = '⚠ hiba'; bad = true; }
  else txt = '✓ szinkronban';
  statusEl.textContent = txt;
  statusEl.title = state.error || '';
  statusEl.classList.toggle('bad', bad);
}

// Adatváltozáskor újrarajzolunk – de ha épp gépel valaki, megvárjuk, míg elhagyja a mezőt.
let dirty = false;
const editing = () => view.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
onChange(() => {
  renderStatus();
  if (editing()) { dirty = true; return; }
  render();
});
view.addEventListener('focusout', () => setTimeout(() => { if (dirty && !editing()) { dirty = false; render(); } }, 50));

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  const scroll = !(lastHash.startsWith('#/fuvar') && location.hash.startsWith('#/napok'));
  lastHash = location.hash;
  render();
  if (scroll) window.scrollTo(0, 0);
});
window.addEventListener('beforeunload', (e) => { if (state.pending) { e.preventDefault(); e.returnValue = ''; } });

// frissítés: induláskor, visszatéréskor és 5 percenként (ha látható az oldal)
document.addEventListener('visibilitychange', () => { if (!document.hidden && remoteEnabled() && !state.pending) loadAll(); });
setInterval(() => { if (!document.hidden && remoteEnabled() && !state.pending && !editing()) loadAll(); }, 5 * 60e3);
// a "ma/holnap" csoportok és az esedékesség percenként frissüljenek
setInterval(() => { if (!editing() && ['napok', 'fuvar'].includes(route().name)) render(); }, 60e3);

render();
loadAll();
startNtfySync();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
