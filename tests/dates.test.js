import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateCell, parseTimeCell, fromExcelSerial } from '../js/core/dates.js';
import { normText, normPlate, primaryPlate, looksLikePlate } from '../js/core/text.js';
import { zonedToUtc, localParts, offsetMinutes, addDays } from '../js/core/tz.js';

test('dátumformátumok', () => {
  const cases = {
    '2026.10.22': '2026-10-22',
    '2026. 10. 22.': '2026-10-22',
    '2026-10-22': '2026-10-22',
    '22.10.2026': '2026-10-22',
    '22.10.26': '2026-10-22',
    '10/22/2026': '2026-10-22',
    '22/10/2026': '2026-10-22',
    '2026. október 22.': '2026-10-22',
    '22 Oct 2026': '2026-10-22',
    'Oct 22, 2026': '2026-10-22',
    '2026-10-22T14:30:00': '2026-10-22',
  };
  for (const [s, want] of Object.entries(cases)) assert.equal(parseDateCell(s)?.date, want, s);
});

test('dátum időponttal és idősávval', () => {
  assert.deepEqual(parseDateCell('2026.10.22 14:30'), { date: '2026-10-22', time: '14:30', timeTo: null });
  assert.deepEqual(parseDateCell('2026. 10. 26. 07:00-09:00'), { date: '2026-10-26', time: '07:00', timeTo: '09:00' });
  assert.deepEqual(parseDateCell('22.10.2026 8:00'), { date: '2026-10-22', time: '08:00', timeTo: null });
  assert.deepEqual(parseTimeCell('08:00-12:00'), { time: '08:00', timeTo: '12:00' });
  assert.deepEqual(parseTimeCell('8-12'), { time: '08:00', timeTo: '12:00' });
  assert.deepEqual(parseTimeCell(0.375), { time: '09:00', timeTo: null });
});

test('Excel sorszám-dátum', () => {
  assert.deepEqual(fromExcelSerial(46317), { date: '2026-10-22', time: null });
  assert.deepEqual(fromExcelSerial(46317.604166667), { date: '2026-10-22', time: '14:30' });
  assert.equal(parseDateCell(46317).date, '2026-10-22');
  assert.equal(parseDateCell('46317').date, '2026-10-22');
  assert.equal(parseDateCell(44855, { date1904: true }).date, '2026-10-22');
});

test('érvénytelen dátumok', () => {
  for (const s of ['holnapután', '2026.13.01', '31.02.2026', 'abc', 12, '']) assert.equal(parseDateCell(s), null, String(s));
});

test('perjeles sorrend kétértelmű esetben', () => {
  assert.equal(parseDateCell('05/06/2026').date, '2026-05-06');
  assert.equal(parseDateCell('05/06/2026', { slashOrder: 'DMY' }).date, '2026-06-05');
});

test('normalizálás', () => {
  assert.equal(normText('  Lerakás  dátuma '), 'lerakasdatuma');
  assert.equal(normText('Rendszám (vontató/pótkocsi)'), 'rendszamvontatopotkocsi');
  assert.equal(normPlate('abc-123'), 'ABC123');
  assert.equal(normPlate('AA BB-123'), 'AABB123');
  assert.equal(primaryPlate('ABC-123 / XYZ-987'), 'ABC123');
  assert.ok(looksLikePlate('WE 123AB'));
  assert.ok(!looksLikePlate('Alfa Zrt.'));
  assert.ok(!looksLikePlate('2026.10.22'));
});

test('Budapest időzóna: nyári és téli idő', () => {
  // 2026.10.25. 03:00 nyári idő -> 02:00 téli idő
  assert.equal(zonedToUtc('2026-10-24', '08:00').toISOString(), '2026-10-24T06:00:00.000Z');
  assert.equal(zonedToUtc('2026-10-26', '08:00').toISOString(), '2026-10-26T07:00:00.000Z');
  // kétértelmű 02:30 (kétszer van) -> az első, nyári
  assert.equal(zonedToUtc('2026-10-25', '02:30').toISOString(), '2026-10-25T00:30:00.000Z');
  // nem létező 02:30 tavasszal -> 03:30 nyári idő
  assert.equal(zonedToUtc('2026-03-29', '02:30').toISOString(), '2026-03-29T01:30:00.000Z');
  assert.equal(zonedToUtc('2026-03-29', '08:00').toISOString(), '2026-03-29T06:00:00.000Z');
  assert.equal(offsetMinutes(new Date('2026-07-01T12:00:00Z')), 120);
  assert.equal(offsetMinutes(new Date('2026-12-01T12:00:00Z')), 60);
  assert.equal(localParts(new Date('2026-10-25T01:30:00Z')).time, '02:30');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
