import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { loadSample, byField, sample } from './helpers.js';
import { readWorkbook, readPasted, parseDelimited, decodeText } from '../js/core/tabular.js';
import { detect, makeFormat, columnKeys, fingerprintOf } from '../js/core/detect.js';
import { buildRecords } from '../js/core/records.js';

test('magyar minta: címsor a fejléc fölött, egyesített cella, összesítő sor', () => {
  const s = loadSample('minta-1-alap.xlsx');
  assert.equal(s.best.name, 'Fuvarok', 'a fuvarlistát kell ajánlania, nem a jegyzetlapot');
  assert.equal(s.detection.headerRow, 3);
  assert.ok(s.detection.confident);
  assert.deepEqual(byField(s.detection), {
    megbizasszam: 'Megbízásszám', rendszam: 'Rendszám (vontató/pótkocsi)', fuvarozo: 'Fuvarozó', megbizo: 'Megbízó',
    felrakas_datum: 'Felrakás dátuma', felrakas_hely: 'Felrakó', lerakas_datum: 'Lerakás dátuma',
    lerakas_ido: 'Lerakás ideje', lerakas_hely: 'Lerakó',
  });
  assert.equal(s.records.length, 5);
  assert.equal(s.errors.length, 1);
  assert.equal(s.errors[0].rekord.megbizasszam, 'M-26-1006');
  assert.match(s.errors[0].okok[0], /holnapután/);
  assert.equal(s.skipped.osszesito, 1);
  const r1 = s.records[0];
  assert.equal(r1.rendszam, 'ABC-123 / XYZ-987');
  assert.equal(r1.rendszamNorm, 'ABC123');
  assert.equal(r1.lerakas.datum, '2026-10-22');
  assert.equal(r1.lerakas.ido, '08:00');
  assert.equal(r1.lerakas.idoIg, '12:00');
  // egyesített fuvarozó cella kitöltve
  assert.equal(s.records[1].fuvarozo, 'Gyors Kft.');
  assert.equal(s.records[1].lerakas.ido, '14:30');
  assert.equal(s.records[2].lerakas.ido, '09:00');
});

test('angol fejlécek, más sorrend, szöveges dátumok', () => {
  const s = loadSample('minta-2-angol.xlsx');
  assert.ok(s.detection.confident);
  const m = byField(s.detection);
  assert.equal(m.rendszam, 'Truck');
  assert.equal(m.megbizo, 'Customer');
  assert.equal(m.fuvarozo, 'Carrier');
  assert.equal(m.megbizasszam, 'Order no.');
  assert.equal(m.felrakas_datum, 'Loading');
  assert.equal(m.lerakas_datum, 'Unloading');
  assert.equal(m.lerakas_ido, 'Delivery time');
  assert.equal(m.lerakas_varos, 'Destination city');
  assert.equal(m.lerakas_orszag, 'Destination country');
  assert.equal(s.errors.length, 0);
  assert.deepEqual(s.records.map((r) => r.lerakas.datum), ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-26']);
  assert.deepEqual(s.records.map((r) => r.felrakas.datum), ['2026-10-21', '2026-10-21', '2026-10-22', '2026-10-21']);
  assert.equal(s.records[2].lerakas.ido, '09:30');
  assert.equal(s.records[3].lerakas.ido, '07:00');
  assert.equal(s.records[3].lerakas.idoIg, '09:00');
});

test('régi .xls formátum ugyanúgy olvasható', () => {
  const a = loadSample('minta-2-angol.xls');
  const b = loadSample('minta-2-angol.xlsx');
  assert.deepEqual(a.records, b.records);
  assert.equal(a.detection.fingerprint, b.detection.fingerprint);
});

test('kétsoros, egyesített fejléc megbízásszám nélkül', () => {
  const s = loadSample('minta-3-ketsoros.xlsx');
  const m = byField(s.detection);
  assert.equal(s.detection.headerRow, 1);
  assert.equal(m.rendszam, 'Rendszám');
  assert.equal(m.fuvarozo, 'Alvállalkozó');
  assert.equal(m.megbizo, 'Ügyfél');
  assert.equal(m.felrakas_datum, 'Felrakó Dátum');
  assert.equal(m.felrakas_orszag, 'Felrakó Ország');
  assert.equal(m.lerakas_varos, 'Lerakó Város');
  assert.equal(s.records.length, 3);
  assert.equal(s.records[1].lerakas.varos, 'Novi Sad');
});

test('CSV Windows-1250 kódolással és pontosvesszővel', () => {
  const s = loadSample('minta-4-dst-win1250.csv');
  assert.equal(s.records.length, 3);
  assert.equal(s.records[0].megbizo, 'Őrség Kft.');
  assert.equal(s.records[2].megbizo, 'Árvíztűrő Zrt.');
  assert.equal(s.records[0].lerakas.ido, '02:30');
  assert.equal(byField(s.detection).megbizasszam, 'Rendelésszám');
  assert.equal(byField(s.detection).rendszam, 'Plate');
});

test('Excelből beillesztett cellák (TSV)', () => {
  const txt = readFileSync(sample('minta-5-beillesztes.txt'), 'utf8');
  const wb = readPasted(txt);
  const d = detect(wb.sheets[0].rows);
  const { records } = buildRecords(wb.sheets[0].rows, d, d.mapping);
  assert.equal(records.length, 2);
  assert.equal(records[0].lerakas.ido, '08:00');
  assert.equal(records[0].lerakas.idoIg, '10:00');
  assert.equal(byField(d).lerakas_datum, 'Delivery date');
});

test('CSV idézőjelekkel és több soros cellával', () => {
  const rows = parseDelimited('a;b\n"x;y";"több\nsor"\n"idéz""et";2', ';');
  assert.deepEqual(rows, [['a', 'b'], ['x;y', 'több\nsor'], ['idéz"et', '2']]);
  assert.equal(decodeText(new TextEncoder().encode('﻿árvíz')), 'árvíz');
});

test('tartalom alapú felismerés ismeretlen fejlécekkel, bizonytalan -> kérdez', () => {
  const rows = [
    ['Azon', 'Kocsi', 'Cég', 'Indul', 'Érkezik'],
    ['1', 'ABC-123', 'Alfa', '2026.10.21', '2026.10.22'],
    ['2', 'DEF-456', 'Béta', '2026.10.21', '2026.10.23'],
    ['3', 'GHI-789', 'Alfa', '2026.10.22', '2026.10.24'],
  ];
  // a fejlécsorban nincs ismert név -> nem talál fejlécet magabiztosan
  const d = detect(rows);
  assert.equal(d.confident, false);
});

test('tartalom alapján rendszám és lerakás dátum pótlása', () => {
  const rows = [
    ['Megbízó', 'Felrakás', 'Kocsi', 'Érkezik'],
    ['Alfa', '2026.10.21', 'ABC-123', '2026.10.22'],
    ['Béta', '2026.10.21', 'DEF-456', '2026.10.23'],
  ];
  const d = detect(rows);
  assert.equal(d.sources.rendszam, 'tartalom');
  assert.equal(d.columns[d.mapping.rendszam].label, 'Kocsi');
  assert.equal(d.columns[d.mapping.lerakas_datum].label, 'Érkezik');
  assert.equal(d.confident, false, 'tartalom alapján felismert oszlopnál meg kell erősíteni');
});

test('elmentett formátum: ugyanilyen szerkezetnél kérdés nélkül alkalmazza', () => {
  const rows = [
    ['Kis cím'],
    ['Azon', 'Kocsi', 'Cég', 'Indul', 'Érkezik'],
    ['1', 'ABC-123', 'Alfa', '2026.10.21', '2026.10.22'],
  ];
  // a hozzárendelő lépés a fejlécsor kézi megadása után ilyen felismerést kap
  const labels = rows[1];
  const keys = columnKeys(labels);
  const manual = { columns: labels.map((label, index) => ({ index, label, key: keys[index] })), fingerprint: fingerprintOf(keys) };
  const mapping = { megbizasszam: 0, rendszam: 1, megbizo: 2, felrakas_datum: 3, lerakas_datum: 4 };
  const fmt = makeFormat(manual, mapping, 'Saját', 'x1');
  assert.deepEqual(fmt.hozzarendeles, { megbizasszam: 'azon', rendszam: 'kocsi', megbizo: 'ceg', felrakas_datum: 'indul', lerakas_datum: 'erkezik' });
  // más címsorral, más pozícióban is felismeri
  const withSaved = detect([['Más cím', 'x'], [], ...rows.slice(1), ['2', 'DEF-456', 'Béta', '2026.10.22', '2026.10.25']], [fmt]);
  assert.ok(withSaved.savedFormat);
  assert.ok(withSaved.confident);
  assert.equal(withSaved.headerRow, 2);
  assert.equal(withSaved.columns[withSaved.mapping.lerakas_datum].label, 'Érkezik');
  const { records } = buildRecords([['Más cím', 'x'], [], ...rows.slice(1)], withSaved, withSaved.mapping);
  assert.equal(records[0].rendszam, 'ABC-123');
});

test('ujjlenyomat: fejlécek normalizált listája, kis-nagybetű és ékezet független', () => {
  const a = detect([['Rendszám', 'Lerakás dátuma', 'Megbízó'], ['ABC-123', '2026.10.22', 'X']]);
  const b = detect([['RENDSZAM', 'lerakas  datuma', 'megbízó'], ['ABC-123', '2026.10.22', 'X']]);
  assert.equal(a.fingerprint, b.fingerprint);
  const c = detect([['Rendszám', 'Megbízó', 'Lerakás dátuma'], ['ABC-123', 'X', '2026.10.22']]);
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test('a SheetJS-ből jövő munkafüzet több lapját rangsorolja', () => {
  const wb = readWorkbook(XLSX, readFileSync(sample('minta-1-alap.xlsx')), 'minta-1-alap.xlsx');
  assert.deepEqual(wb.sheets.map((s) => s.name), ['Fuvarok', 'Jegyzetek']);
});
