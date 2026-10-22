// Szinkronizálás: a feltöltött lista összevetése a tárolt fuvarokkal (előnézet + alkalmazás).
// A felhasználói adatokat (statusz, naplo, emlekeztetok) a frissítés soha nem írja felül.

import { normText, hash } from './text.js';

export const STATUSZOK = {
  tervezett: 'Tervezett',
  uton: 'Úton',
  lerakva: 'Lerakva',
  problema: 'Probléma',
};

export function emptyData() {
  return { verzio: 1, fuvarok: {}, feltoltesek: [] };
}

/** Azonosító kulcs: megbízásszám, ha van; különben rendszám + megbízó + felrakás dátuma. */
export function identityKey(rec) {
  if (rec.megbizasszam) return 'M:' + normText(rec.megbizasszam);
  return `R:${rec.rendszamNorm}|${normText(rec.megbizo)}|${rec.felrakas?.datum || ''}`;
}

export function idForKey(key) {
  return hash(key) + hash('x' + key).slice(0, 3);
}

/** Az összehasonlított (fájlból jövő) mezők, megjelenítési névvel. */
export const COMPARED = [
  ['megbizasszam', 'Megbízásszám'], ['rendszam', 'Rendszám'], ['fuvarozo', 'Fuvarozó'], ['megbizo', 'Megbízó'],
  ['megjegyzes', 'Megjegyzés (fájl)'],
  ['felrakas.datum', 'Felrakás dátuma'], ['felrakas.ido', 'Felrakás ideje'], ['felrakas.idoIg', 'Felrakás idősáv vége'],
  ['felrakas.hely', 'Felrakó hely'], ['felrakas.orszag', 'Felrakó ország'], ['felrakas.irsz', 'Felrakó irsz.'],
  ['felrakas.varos', 'Felrakó város'],
  ['lerakas.datum', 'Lerakás dátuma'], ['lerakas.ido', 'Lerakás ideje'], ['lerakas.idoIg', 'Lerakás idősáv vége'],
  ['lerakas.hely', 'Lerakó hely'], ['lerakas.orszag', 'Lerakó ország'], ['lerakas.irsz', 'Lerakó irsz.'],
  ['lerakas.varos', 'Lerakó város'],
];

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

function srcOf(rec) {
  const { sor, ...rest } = rec;
  return structuredClone(rest);
}

export function changedFields(oldSrc, newSrc) {
  const out = [];
  for (const [path, label] of COMPARED) {
    const a = get(oldSrc, path) ?? '', b = get(newSrc, path) ?? '';
    if (String(a) !== String(b)) out.push({ mezo: path, nev: label, regi: a, uj: b });
  }
  return out;
}

/**
 * Előnézet: mi változna, ha alkalmaznánk.
 * @param data a tárolt állapot
 * @param records a feltöltésből épített rekordok
 * @param errors hibás sorok (ezek kulcsát is "jelenlévőnek" tekintjük, hogy ne archiváljuk tévesen)
 * @param mode 'teljes' | 'hozzaadas'
 */
export function diff(data, records, { mode = 'teljes', errors = [] } = {}) {
  const uj = [], valtozott = [], valtozatlan = [], ujraeledt = [], kikerult = [], duplikalt = [];
  const seen = new Map();
  for (const rec of records) {
    const key = identityKey(rec);
    if (seen.has(key)) { duplikalt.push({ sor: rec.sor, elsoSor: seen.get(key), kulcs: key }); continue; }
    seen.set(key, rec.sor);
    const id = idForKey(key);
    const old = data.fuvarok[id];
    if (!old) { uj.push({ id, kulcs: key, rekord: rec }); continue; }
    const changes = changedFields(old.src, srcOf(rec));
    const item = { id, kulcs: key, rekord: rec, valtozasok: changes, regi: old };
    if (old.archivalt) ujraeledt.push(item);
    else if (changes.length) valtozott.push(item);
    else valtozatlan.push(item);
  }
  // hibás, de azonosítható sorok: ne kerüljenek ki
  const protectedIds = new Set();
  for (const e of errors) {
    if (!e.rekord || (!e.rekord.megbizasszam && !e.rekord.rendszam)) continue;
    protectedIds.add(idForKey(identityKey(e.rekord)));
  }
  if (mode === 'teljes') {
    const present = new Set([...seen.keys()].map(idForKey));
    for (const f of Object.values(data.fuvarok)) {
      if (f.archivalt || present.has(f.id) || protectedIds.has(f.id)) continue;
      kikerult.push({ id: f.id, regi: f });
    }
  }
  const aktiv = Object.values(data.fuvarok).filter((f) => !f.archivalt).length;
  const figyelmeztetes = mode === 'teljes' && aktiv >= 4 && kikerult.length / aktiv > 0.5
    ? `A jelenlegi ${aktiv} aktív fuvarból ${kikerult.length} archiválódna. Biztosan a teljes listát töltötted fel?`
    : null;
  return { mode, uj, valtozott, valtozatlan, ujraeledt, kikerult, duplikalt, hibas: errors, figyelmeztetes };
}

/** Az előnézet alkalmazása; új adatobjektumot ad vissza. */
export function applyDiff(data, preview, meta, now = new Date()) {
  const out = structuredClone(data);
  const at = now.toISOString();
  const feltoltesId = meta.id;
  const log = (f, szoveg) => (f.naplo ||= []).push({ at, tipus: 'rendszer', szoveg });

  for (const { id, kulcs, rekord } of preview.uj) {
    out.fuvarok[id] = {
      id, kulcs, src: srcOf(rekord), statusz: 'tervezett', archivalt: false,
      naplo: [{ at, tipus: 'rendszer', szoveg: `Új fuvar a feltöltésből (${meta.fajlnev}).` }],
      emlekeztetok: [], elsoLatva: at, utolsoLatva: at,
      jelolo: { feltoltesId, tipus: 'uj', mezok: [] },
    };
  }
  for (const { id, rekord, valtozasok } of [...preview.valtozott, ...preview.ujraeledt]) {
    const f = out.fuvarok[id];
    const wasArchived = f.archivalt;
    f.src = srcOf(rekord);
    f.utolsoLatva = at;
    if (wasArchived) {
      f.archivalt = false; delete f.archivaltAt;
      log(f, 'Újra megjelent egy feltöltésben, visszakerült az aktív fuvarok közé.');
    }
    if (valtozasok.length) {
      log(f, 'Változás a feltöltésben: ' + valtozasok.map((c) => `${c.nev}: ${c.regi || '–'} → ${c.uj || '–'}`).join('; '));
    }
    f.jelolo = { feltoltesId, tipus: wasArchived ? 'ujraeledt' : 'valtozott', mezok: valtozasok.map((c) => c.mezo) };
  }
  for (const { id } of preview.valtozatlan) {
    out.fuvarok[id].utolsoLatva = at;
  }
  for (const { id } of preview.kikerult) {
    const f = out.fuvarok[id];
    f.archivalt = true; f.archivaltAt = at;
    let cancelled = 0;
    for (const e of f.emlekeztetok || []) {
      if (!e.torolve && !e.lemondva) { e.lemondva = at; cancelled++; }
    }
    log(f, 'Kikerült a feltöltött listából, archiválva.' + (cancelled ? ` ${cancelled} függő emlékeztető megszűnt.` : ''));
  }
  out.feltoltesek = [
    {
      id: feltoltesId, at, fajlnev: meta.fajlnev, mod: preview.mode,
      uj: preview.uj.length, valtozott: preview.valtozott.length, kikerult: preview.kikerult.length,
      ujraeledt: preview.ujraeledt.length, hibas: preview.hibas.length,
    },
    ...(out.feltoltesek || []),
  ].slice(0, 200);
  return out;
}
