// Egy fuvar részletei: státusz, ránézés-emlékeztetők, jegyzetek és napló.
import { h, mount, toast, STATUS_CLASS } from '../ui.js';
import { state, mutate } from '../store.js';
import { STATUSZOK } from '../core/sync.js';
import { quickTimes, remindersBlocked, activeReminders, reminderKey } from '../core/schedule.js';
import { zonedToUtc, localParts, huDateTimeShort } from '../core/tz.js';
import { randomId } from '../core/text.js';
import { placeText } from '../core/records.js';
import { stopWhen, statusLabel, whenText } from '../format.js';
import { badge } from './napok.js';

// a műveletek tiszta függvények az adaton, így ütközés után újra alkalmazhatók
const onTrip = (id, fn) => (d) => { const f = d.fuvarok[id]; if (f) fn(f); return d; };

function setStatus(id, statusz) {
  const at = new Date().toISOString();
  return mutate('data', onTrip(id, (f) => {
    if (f.statusz === statusz) return;
    const prev = f.statusz;
    f.statusz = statusz;
    let cancelled = 0;
    if (statusz === 'lerakva') {
      for (const e of f.emlekeztetok || []) if (!e.torolve && !e.lemondva && e.at > at) { e.lemondva = at; cancelled++; }
    }
    (f.naplo ||= []).push({ at, tipus: 'statusz', szoveg: `Státusz: ${STATUSZOK[prev]} → ${STATUSZOK[statusz]}`
      + (cancelled ? ` (${cancelled} függő emlékeztető megszűnt)` : '') });
  }), `Státusz: ${statusz}`);
}

function addReminder(id, atIso, jegyzet) {
  const now = new Date().toISOString();
  const rid = randomId(8);
  return mutate('data', onTrip(id, (f) => {
    (f.emlekeztetok ||= []).push({ id: rid, at: atIso, jegyzet: jegyzet || '', letrehozva: now });
    (f.naplo ||= []).push({ at: now, tipus: 'emlekezteto',
      szoveg: `Ránézés beállítva: ${huDateTimeShort(atIso)}${jegyzet ? ' – ' + jegyzet : ''}` });
  }), 'Emlékeztető');
}

function addNote(id, szoveg) {
  const at = new Date().toISOString();
  return mutate('data', onTrip(id, (f) => { (f.naplo ||= []).push({ at, tipus: 'jegyzet', szoveg }); }), 'Jegyzet');
}

function deleteReminder(id, rid) {
  const at = new Date().toISOString();
  return mutate('data', onTrip(id, (f) => {
    const e = (f.emlekeztetok || []).find((x) => x.id === rid);
    if (!e || e.torolve) return;
    e.torolve = at;
    (f.naplo ||= []).push({ at, tipus: 'emlekezteto', szoveg: `Ránézés törölve: ${huDateTimeShort(e.at)}` });
  }), 'Emlékeztető törlése');
}

export function render(root, id) {
  const f = state.data.fuvarok[id];
  if (!f) {
    mount(root, h('div', { class: 'card empty' }, h('p', {}, 'Ez a fuvar nem található (lehet, hogy még töltődnek az adatok).'),
      h('a', { class: 'btn', href: '#/napok' }, 'Vissza a napokhoz')));
    return;
  }
  const s = f.src;
  const now = new Date();
  const blocked = remindersBlocked(f);
  const note = h('textarea', { placeholder: 'Rövid jegyzet (pl. „sofőr szerint 14h-ra ér oda”)', rows: 2, maxlength: 500 });
  const takeNote = () => { const v = note.value.trim(); note.value = ''; return v; };

  const remind = async (atIso) => {
    const j = takeNote();
    if (new Date(atIso) <= new Date()) { toast('A ránézés ideje a jövőben legyen.', 'error'); return; }
    addReminder(id, atIso, j);
    toast(`Ránézés: ${whenText(atIso)}`, 'ok');
  };

  const nowLocal = localParts(new Date(Date.now() + 3600e3));
  const custom = h('input', { type: 'datetime-local', value: `${nowLocal.date}T${nowLocal.time}`, 'aria-label': 'Egyedi időpont' });

  const sentMap = state.sent.elkuldve || {};
  const rems = activeReminders(f).sort((a, b) => a.at.localeCompare(b.at));
  const past = (f.emlekeztetok || []).filter((e) => e.torolve || e.lemondva);

  const back = history.length > 1 ? h('button', { class: 'ghost', onclick: () => history.back() }, '← Vissza')
    : h('a', { class: 'btn ghost', href: '#/napok' }, '← Napok');

  mount(root,
    h('div', { class: 'row', style: { marginBottom: '.5rem' } }, back),
    h('section', { class: 'card stack' },
      h('div', { class: 'row' },
        h('h1', { class: 'grow', style: { fontSize: '1.4rem', margin: 0 } }, s.rendszam || s.megbizasszam || '–'),
        badge(f),
        f.archivalt ? h('span', { class: 'chip s-prob' }, 'Archivált') : null,
        h('span', { class: `chip ${STATUS_CLASS[f.statusz]}` }, statusLabel(f.statusz))),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Megbízásszám'), h('dd', {}, s.megbizasszam || '–'),
        h('dt', {}, 'Megbízó'), h('dd', {}, s.megbizo || '–'),
        h('dt', {}, 'Fuvarozó'), h('dd', {}, s.fuvarozo || '–'),
        h('dt', {}, 'Felrakás'), h('dd', {}, stopWhen(s.felrakas) || '–', h('div', { class: 'muted' }, placeText(s.felrakas))),
        h('dt', {}, 'Lerakás'), h('dd', {}, h('b', {}, stopWhen(s.lerakas) || '–'), h('div', { class: 'muted' }, placeText(s.lerakas))),
        s.megjegyzes ? [h('dt', {}, 'Megjegyzés (fájl)'), h('dd', {}, s.megjegyzes)] : null)),

    h('section', { class: 'card stack' },
      h('h2', {}, 'Státusz'),
      h('div', { class: 'status-btns' }, Object.entries(STATUSZOK).map(([k, label]) =>
        h('button', { class: `${f.statusz === k ? 'on ' : ''}`, onclick: () => { setStatus(id, k); } },
          h('span', { class: `chip ${STATUS_CLASS[k]}` }, label))))),

    h('section', { class: 'card stack' },
      h('h2', {}, 'Ránézés és jegyzet'),
      blocked ? h('div', { class: 'alert info' }, f.archivalt ? 'Archivált fuvarhoz nem megy ki emlékeztető.' : 'Lerakott fuvarhoz nem megy ki több emlékeztető.') : null,
      note,
      h('div', { class: 'quick' },
        quickTimes(now).map((q) => h('button', { disabled: blocked, onclick: () => remind(q.at) }, '⏰ ' + q.cimke)),
        h('button', { onclick: () => { const v = takeNote(); if (!v) { toast('Írj be egy jegyzetet.', 'error'); return; } addNote(id, v); toast('Jegyzet mentve', 'ok'); } }, 'Csak jegyzet mentése')),
      h('div', { class: 'row' }, custom,
        h('button', { disabled: blocked, onclick: () => {
          if (!custom.value) return;
          const [d, t] = custom.value.split('T');
          remind(zonedToUtc(d, t.slice(0, 5)).toISOString());
        } }, 'Egyedi időpont beállítása')),
      h('p', { class: 'muted small' }, 'Az időpontok Budapest helyi ideje szerint értendők. A GitHub ütemező 5–15 percet késhet.'),
      rems.length ? h('div', {}, h('h3', {}, 'Beállított ránézések'), rems.map((e) => {
        const sent = sentMap[reminderKey(f, e)];
        return h('div', { class: 'rem' },
          h('div', {}, h('b', { class: 'mono' }, whenText(e.at)), e.jegyzet ? ` – ${e.jegyzet}` : '',
            sent ? h('span', { class: 'chip s-le', style: { marginLeft: '.4rem' } }, 'elküldve')
              : new Date(e.at) <= now ? h('span', { class: 'chip s-uton', style: { marginLeft: '.4rem' } }, 'küldésre vár') : null),
          sent ? null : h('button', { class: 'ghost danger', onclick: () => deleteReminder(id, e.id), 'aria-label': 'Törlés' }, 'Törlés'));
      })) : null,
      past.length ? h('details', {}, h('summary', { class: 'small' }, `Törölt / megszűnt ránézések (${past.length})`),
        past.map((e) => h('div', { class: 'small muted' }, `${huDateTimeShort(e.at)} ${e.jegyzet ? '– ' + e.jegyzet : ''} (${e.torolve ? 'törölve' : 'megszűnt'})`))) : null),

    h('section', { class: 'card' },
      h('h2', {}, 'Napló'),
      h('ul', { class: 'log' }, [...(f.naplo || [])].reverse().map((n) => h('li', {},
        h('time', {}, new Date(n.at).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', dateStyle: 'medium', timeStyle: 'short' })),
        h('span', { class: n.tipus === 'rendszer' ? 'sys' : '' }, n.szoveg))))));
}
