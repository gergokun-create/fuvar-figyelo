// Napok nézet: fuvarok a lerakás dátuma szerint csoportosítva, kereséssel és szűrőkkel.
import { h, mount, select, debounce, STATUS_CLASS } from '../ui.js';
import { state } from '../store.js';
import { todayLocal, addDays, huDateLong } from '../core/tz.js';
import { nextReminder } from '../core/schedule.js';
import { STATUSZOK } from '../core/sync.js';
import { normText } from '../core/text.js';
import { stopText, statusLabel, whenText } from '../format.js';
import { COMPARED } from '../core/sync.js';

const filters = { q: '', fuvarozo: '', megbizo: '', statusz: '', csakJelolt: false };

export function searchText(f) {
  const s = f.src;
  return normText([s.rendszam, s.megbizasszam, s.fuvarozo, s.megbizo, s.megjegyzes, stopText(s.felrakas), stopText(s.lerakas),
    ...(f.naplo || []).filter((n) => n.tipus !== 'rendszer').map((n) => n.szoveg)].join(' '));
}

export function badge(f) {
  const last = state.data.feltoltesek?.[0]?.id;
  if (!f.jelolo || f.jelolo.feltoltesId !== last) return null;
  if (f.jelolo.tipus === 'uj') return h('span', { class: 'chip b-uj' }, 'Új');
  if (f.jelolo.tipus === 'ujraeledt') return h('span', { class: 'chip b-ujra' }, 'Újra listán');
  if (f.jelolo.mezok?.length) return h('span', { class: 'chip b-valt' }, 'Változott');
  return null;
}

const LABEL = Object.fromEntries(COMPARED);

export function tripCard(f, now = new Date()) {
  const s = f.src;
  const next = nextReminder(f, state.sent.elkuldve);
  const due = next && new Date(next.at) <= now;
  const changed = state.data.feltoltesek?.[0]?.id === f.jelolo?.feltoltesId && f.jelolo?.tipus === 'valtozott'
    ? f.jelolo.mezok.map((m) => LABEL[m]).filter(Boolean) : [];
  const hl = (prefix) => changed.length && f.jelolo.mezok.some((m) => m.startsWith(prefix)) ? 'chg' : null;
  return h('a', { class: `trip${f.statusz === 'lerakva' ? ' lerakva' : ''}`, href: `#/fuvar/${encodeURIComponent(f.id)}` },
    h('div', {},
      h('div', { class: 'row' }, h('span', { class: 'plate' }, s.rendszam || s.megbizasszam || '–'), badge(f)),
      h('div', { class: 'who' }, [s.megbizo, s.fuvarozo].filter(Boolean).join(' · '), s.megbizasszam && s.rendszam ? ` · ${s.megbizasszam}` : '')),
    h('div', { class: 'side' },
      h('span', { class: `chip ${STATUS_CLASS[f.statusz]}` }, statusLabel(f.statusz)),
      next ? h('span', { class: `next${due ? ' due' : ''}` }, (due ? '⏰ esedékes: ' : '⏰ ') + whenText(next.at, now)) : null),
    h('div', { class: 'route' },
      h('span', {}, 'Fel'), h('span', { class: hl('felrakas') }, stopText(s.felrakas) || '–'),
      h('span', {}, 'Le'), h('span', { class: hl('lerakas') }, stopText(s.lerakas) || '–')),
    changed.length ? h('div', { class: 'small muted', style: { gridColumn: '1 / -1' } }, 'Változott: ' + changed.join(', ')) : null);
}

function applyFilters(list) {
  const q = normText(filters.q);
  return list.filter((f) => (!q || searchText(f).includes(q))
    && (!filters.fuvarozo || f.src.fuvarozo === filters.fuvarozo)
    && (!filters.megbizo || f.src.megbizo === filters.megbizo)
    && (!filters.statusz || f.statusz === filters.statusz)
    && (!filters.csakJelolt || badge(f)));
}

const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'hu'));

export function render(root) {
  const now = new Date();
  const today = todayLocal(now);
  const tomorrow = addDays(today, 1);
  const active = Object.values(state.data.fuvarok).filter((f) => !f.archivalt);

  const listEl = h('div');
  const draw = () => {
    const list = applyFilters(active);
    const groups = new Map();
    const add = (key, title, f, cls = '') => { if (!groups.has(key)) groups.set(key, { title, cls, items: [] }); groups.get(key).items.push(f); };
    const overdue = [], done = [], nodate = [];
    for (const f of list) {
      const d = f.src.lerakas.datum;
      if (!d) nodate.push(f);
      else if (d < today) (f.statusz === 'lerakva' ? done : overdue).push(f);
    }
    if (overdue.length) overdue.forEach((f) => add('0', 'Lejárt, de nincs lerakva', f, 'overdue'));
    const future = list.filter((f) => f.src.lerakas.datum && f.src.lerakas.datum >= today)
      .sort((a, b) => a.src.lerakas.datum.localeCompare(b.src.lerakas.datum));
    for (const f of future) {
      const d = f.src.lerakas.datum;
      const title = d === today ? `Ma – ${huDateLong(d)}` : d === tomorrow ? `Holnap – ${huDateLong(d)}` : huDateLong(d);
      add(d, title, f);
    }
    nodate.forEach((f) => add('~', 'Lerakási dátum nélkül', f));
    const sortIn = (a, b) => (a.src.lerakas.datum || '').localeCompare(b.src.lerakas.datum || '')
      || (a.src.lerakas.ido || '99').localeCompare(b.src.lerakas.ido || '99') || (a.src.rendszam || '').localeCompare(b.src.rendszam || '');
    const blocks = [];
    if (!groups.has(today) && !filters.q) blocks.push(dayBlock({ title: `Ma – ${huDateLong(today)}`, items: [] }, now));
    for (const [key, g] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      g.items.sort(sortIn);
      blocks.push(dayBlock(g, now));
      if (key === today && !groups.has(tomorrow) && !filters.q) blocks.push(dayBlock({ title: `Holnap – ${huDateLong(tomorrow)}`, items: [] }, now));
    }
    if (done.length) {
      blocks.push(h('details', { class: 'day' }, h('summary', {}, `Korábbi, már lerakott (${done.length})`),
        done.sort(sortIn).reverse().map((f) => tripCard(f, now))));
    }
    if (!active.length) {
      mount(listEl, h('div', { class: 'empty card' }, h('p', {}, 'Még nincs követett fuvar.'),
        h('a', { class: 'btn', href: '#/feltoltes' }, 'Lista feltöltése')));
    } else if (!list.length) {
      mount(listEl, h('div', { class: 'empty' }, 'Nincs a szűrésnek megfelelő fuvar.'));
    } else mount(listEl, blocks);
  };

  const onSearch = debounce((v) => { filters.q = v; draw(); }, 150);
  const toolbar = h('div', { class: 'toolbar' },
    h('input', { type: 'search', placeholder: 'Keresés: rendszám, megbízó, hely, jegyzet…', value: filters.q,
      oninput: (e) => onSearch(e.target.value), 'aria-label': 'Keresés' }),
    select([['', 'Minden fuvarozó'], ...uniq(active.map((f) => f.src.fuvarozo)).map((v) => [v, v])], filters.fuvarozo,
      { onchange: (e) => { filters.fuvarozo = e.target.value; draw(); }, 'aria-label': 'Fuvarozó' }),
    select([['', 'Minden megbízó'], ...uniq(active.map((f) => f.src.megbizo)).map((v) => [v, v])], filters.megbizo,
      { onchange: (e) => { filters.megbizo = e.target.value; draw(); }, 'aria-label': 'Megbízó' }),
    select([['', 'Minden státusz'], ...Object.entries(STATUSZOK)], filters.statusz,
      { onchange: (e) => { filters.statusz = e.target.value; draw(); }, 'aria-label': 'Státusz' }));
  const onlyMarked = h('label', { class: 'check small', style: { marginBottom: '1rem' } },
    h('input', { type: 'checkbox', checked: filters.csakJelolt, onchange: (e) => { filters.csakJelolt = e.target.checked; draw(); } }),
    'csak a legutóbbi feltöltésben új / változott');

  mount(root, toolbar, onlyMarked, listEl);
  draw();
}

function dayBlock(g, now) {
  return h('section', { class: `day ${g.cls || ''}` },
    h('div', { class: 'day-head' }, h('h2', {}, g.title), h('span', { class: 'n' }, `${g.items.length} fuvar`)),
    g.items.length ? g.items.map((f) => tripCard(f, now)) : h('p', { class: 'muted small' }, 'Nincs lerakás.'));
}
