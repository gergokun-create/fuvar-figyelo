import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSample } from './helpers.js';
import { diff, applyDiff, emptyData, identityKey, idForKey } from '../js/core/sync.js';

const meta = (id, fajlnev) => ({ id, fajlnev });
const T1 = new Date('2026-10-21T08:00:00Z');
const T2 = new Date('2026-10-22T08:00:00Z');

function firstUpload() {
  const s = loadSample('minta-1-alap.xlsx');
  const p = diff(emptyData(), s.records, { errors: s.errors });
  return { s, p, data: applyDiff(emptyData(), p, meta('u1', 'minta-1-alap.xlsx'), T1) };
}

test('első feltöltés: minden új, a hibás sor jelölve', () => {
  const { p, data } = firstUpload();
  assert.equal(p.uj.length, 5);
  assert.equal(p.hibas.length, 1);
  assert.equal(Object.keys(data.fuvarok).length, 5);
  assert.equal(data.feltoltesek[0].uj, 5);
  assert.equal(data.feltoltesek[0].fajlnev, 'minta-1-alap.xlsx');
});

test('újrafeltöltés teljes listával: új, változott, kikerült; felhasználói adat megmarad', () => {
  const { data } = firstUpload();
  // felhasználói adatok az 1002-es fuvarhoz és a kikerülő 1004-hez
  const id1002 = idForKey('M:m261002'), id1004 = idForKey('M:m261004');
  data.fuvarok[id1002].statusz = 'uton';
  data.fuvarok[id1002].naplo.push({ at: T1.toISOString(), tipus: 'jegyzet', szoveg: 'Sofőr hívva' });
  data.fuvarok[id1002].emlekeztetok.push({ id: 'e1', at: '2026-10-22T10:00:00Z', jegyzet: 'hívd' });
  data.fuvarok[id1004].emlekeztetok.push({ id: 'e2', at: '2026-10-22T10:00:00Z', jegyzet: 'x' });

  const s2 = loadSample('minta-1-ujra.xlsx');
  const p = diff(data, s2.records, { errors: s2.errors, mode: 'teljes' });
  // az 1006 az első feltöltésben hibás sor volt, ezért most újként jön
  assert.deepEqual(p.uj.map((x) => x.rekord.megbizasszam), ['M-26-1006', 'M-26-1007']);
  const changed = Object.fromEntries(p.valtozott.map((x) => [x.rekord.megbizasszam, x.valtozasok.map((c) => c.mezo)]));
  assert.deepEqual(changed['M-26-1002'], ['lerakas.datum', 'lerakas.ido']);
  assert.deepEqual(changed['M-26-1003'], ['lerakas.hely']);
  assert.deepEqual(p.kikerult.map((x) => x.regi.src.megbizasszam), ['M-26-1004']);

  const d2 = applyDiff(data, p, meta('u2', 'minta-1-ujra.xlsx'), T2);
  const f = d2.fuvarok[id1002];
  assert.equal(f.src.lerakas.datum, '2026-10-24', 'új napra került');
  assert.equal(f.statusz, 'uton', 'a státusz nem íródik felül');
  assert.ok(f.naplo.some((n) => n.szoveg === 'Sofőr hívva'));
  assert.equal(f.emlekeztetok.length, 1);
  assert.equal(f.jelolo.tipus, 'valtozott');
  assert.equal(f.jelolo.feltoltesId, 'u2');

  const k = d2.fuvarok[id1004];
  assert.equal(k.archivalt, true);
  assert.ok(k.emlekeztetok[0].lemondva, 'a függő emlékeztető megszűnik');
  assert.equal(d2.feltoltesek[0].kikerult, 1);
  assert.equal(d2.feltoltesek.length, 2);
});

test('csak hozzáadás/frissítés módban semmi nem kerül archívumba', () => {
  const { data } = firstUpload();
  const s2 = loadSample('minta-1-ujra.xlsx');
  const p = diff(data, s2.records, { errors: s2.errors, mode: 'hozzaadas' });
  assert.equal(p.kikerult.length, 0);
  const d2 = applyDiff(data, p, meta('u2', 'x'), T2);
  assert.equal(Object.values(d2.fuvarok).filter((f) => f.archivalt).length, 0);
});

test('archivált fuvar újra megjelenik: feléled az előzményeivel', () => {
  const { s, data } = firstUpload();
  const id1004 = idForKey('M:m261004');
  data.fuvarok[id1004].naplo.push({ at: T1.toISOString(), tipus: 'jegyzet', szoveg: 'fontos' });
  const s2 = loadSample('minta-1-ujra.xlsx');
  const d2 = applyDiff(data, diff(data, s2.records, { errors: s2.errors }), meta('u2', 'b'), T2);
  assert.equal(d2.fuvarok[id1004].archivalt, true);
  const p3 = diff(d2, s.records, { errors: s.errors });
  assert.deepEqual(p3.ujraeledt.map((x) => x.id), [id1004]);
  const d3 = applyDiff(d2, p3, meta('u3', 'c'), new Date('2026-10-23T08:00:00Z'));
  assert.equal(d3.fuvarok[id1004].archivalt, false);
  assert.ok(d3.fuvarok[id1004].naplo.some((n) => n.szoveg === 'fontos'));
  assert.equal(d3.fuvarok[id1004].jelolo.tipus, 'ujraeledt');
});

test('hibás, de azonosítható sor nem archiválja a meglévő fuvart', () => {
  const { data } = firstUpload();
  const s = loadSample('minta-1-alap.xlsx');
  const recs = s.records.filter((r) => r.megbizasszam !== 'M-26-1001');
  const bad = { sor: 5, okok: ['Érthetetlen lerakási dátum'], rekord: { ...s.records[0], lerakas: { datum: null } } };
  const p = diff(data, recs, { errors: [bad, ...s.errors] });
  assert.equal(p.kikerult.length, 0);
});

test('azonosítás megbízásszám nélkül: rendszám + megbízó + felrakás dátuma', () => {
  const s = loadSample('minta-3-ketsoros.xlsx');
  assert.equal(identityKey(s.records[0]), 'R:MNB001|zetakft|2026-10-21');
  // rendszám más írásmóddal is ugyanaz a fuvar
  const data = applyDiff(emptyData(), diff(emptyData(), s.records), meta('u1', 'a'), T1);
  const again = s.records.map((r) => ({ ...r, rendszam: r.rendszam.replace('-', ' ').toLowerCase(), rendszamNorm: r.rendszamNorm }));
  const p = diff(data, again);
  assert.equal(p.uj.length, 0);
  assert.equal(p.valtozott.length, 3);
  assert.deepEqual(p.valtozott[0].valtozasok.map((c) => c.mezo), ['rendszam']);
});

test('ismétlődő azonosító egy feltöltésen belül', () => {
  const s = loadSample('minta-2-angol.xlsx');
  const p = diff(emptyData(), [...s.records, { ...s.records[0], sor: 99 }]);
  assert.equal(p.duplikalt.length, 1);
  assert.equal(p.duplikalt[0].sor, 99);
});

test('figyelmeztet, ha a teljes lista mód a fuvarok többségét archiválná', () => {
  const { data, s } = firstUpload();
  const p = diff(data, s.records.slice(0, 1));
  assert.ok(p.figyelmeztetes);
});
