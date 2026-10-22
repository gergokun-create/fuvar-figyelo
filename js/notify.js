// Az app maga ütemezi be az ntfy-ba a ránézéseket és az összesítőket, és visszavonja a
// lemondottakat (törölt ránézés, Lerakva státusz, archiválás). Minden adatváltozás után lefut.

import { state, mutate, onChange } from './store.js';
import { planNtfy } from './core/schedule.js';
import { createNtfy } from './core/ntfy.js';
import { hash } from './core/text.js';

const LS_KEY = 'ff.ntfy.osszesitok';
const appUrl = () => location.origin + location.pathname;

function loadSums() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } }
function saveSums(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* */ } }

export const ntfyState = { hiba: null, utolso: null };

let timer = null, running = false, again = false;
export function scheduleSync(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(syncNtfy, delay);
}

export async function syncNtfy() {
  const topic = state.config.ntfyTopic;
  if (!topic) return;
  if (running) { again = true; return; }
  running = true;
  try {
    const n = createNtfy({ topic });
    const plan = planNtfy({ data: state.data, settings: state.settings, sent: state.sent.elkuldve || {}, now: new Date(), appUrl: appUrl() });
    const sums = loadSums(), nextSums = {};
    const published = [], cancelled = [];
    for (const c of plan.cancel) {
      await n.cancel(c.seq);
      cancelled.push(c);
    }
    for (const p of plan.publish) {
      if (!p.reminder) {
        // összesítő: csak akkor küldjük újra (cseréljük le), ha a tartalma vagy időpontja változott
        const h = hash(JSON.stringify([p.at, p.cim, p.uzenet, p.link]));
        nextSums[p.seq] = h;
        if (sums[p.seq] === h) continue;
      }
      await n.publish(p);
      if (p.reminder) published.push(p);
    }
    saveSums(nextSums);
    if (published.length || cancelled.length) {
      const at = new Date().toISOString();
      mutate('data', (d) => {
        for (const p of published) {
          const e = d.fuvarok[p.fuvarId]?.emlekeztetok?.find((x) => x.id === p.emlId);
          if (e) e.ntfy = { seq: p.seq, at };
        }
        for (const c of cancelled) {
          const e = d.fuvarok[c.fuvarId]?.emlekeztetok?.find((x) => x.id === c.emlId);
          if (e) e.ntfyVisszavonva = at;
        }
        return d;
      }, `ntfy: ${published.length} beütemezve, ${cancelled.length} visszavonva`);
    }
    ntfyState.hiba = null; ntfyState.utolso = new Date().toISOString();
  } catch (e) {
    ntfyState.hiba = e instanceof TypeError ? 'Az ntfy nem érhető el (nincs internet?)' : e.message;
    scheduleSync(60e3); // később újrapróbálja
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(); }
  }
}

export async function sendTestPush() {
  const n = createNtfy({ topic: state.config.ntfyTopic });
  await n.publish({ tipus: 'teszt', cim: 'Fuvar Figyelő – teszt', uzenet: 'A push értesítés működik.', link: appUrl() });
}

export function startNtfySync() {
  onChange(() => scheduleSync());
  scheduleSync(500);
  // az összesítők időablaka (3 nap) halad: óránként frissítünk, ha nyitva az app
  setInterval(() => scheduleSync(0), 60 * 60e3);
}
