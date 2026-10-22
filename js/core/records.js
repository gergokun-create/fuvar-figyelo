// Sorok + oszlop-hozzárendelés -> fuvarrekordok, hibás és kihagyott sorok.

import { clean, isBlank, normText, primaryPlate } from './text.js';
import { parseDateCell, parseTimeCell } from './dates.js';

const SUMMARY_RE = /^(osszes|osszesen|mindosszesen|total|grandtotal|subtotal|sum|summa|reszosszeg|darab|db)/;

function isSummaryRow(row, mapping) {
  const texts = row.filter((v) => typeof v === 'string').map(normText);
  if (texts.some((t) => SUMMARY_RE.test(t))) return true;
  // nincs azonosító és dátum, csak néhány szám -> összesítő
  const key = ['rendszam', 'megbizasszam', 'lerakas_datum'].map((f) => (mapping[f] !== undefined ? row[mapping[f]] : null));
  if (key.every(isBlank)) {
    const filled = row.filter((v) => !isBlank(v));
    return filled.length > 0 && filled.every((v) => typeof v === 'number' || /^[\d\s.,]+$/.test(String(v)));
  }
  return false;
}

function isRepeatedHeader(row, columns) {
  let same = 0, filled = 0;
  for (const c of columns) {
    const v = row[c.index];
    if (isBlank(v)) continue;
    filled++;
    if (normText(v) === normText(c.label) || normText(c.label).endsWith(normText(v))) same++;
  }
  return filled > 1 && same / filled > 0.6;
}

function cell(row, mapping, field) {
  const c = mapping[field];
  return c === undefined || c === null || c === '' ? null : row[Number(c)] ?? null;
}

function stop(row, mapping, prefix, opts, problems, label) {
  const raw = cell(row, mapping, `${prefix}_datum`);
  const col = mapping[`${prefix}_datum`];
  const pd = isBlank(raw) ? null : parseDateCell(raw, { date1904: opts.date1904, slashOrder: opts.slashOrders?.[col] });
  if (!isBlank(raw) && !pd) problems.push(`Érthetetlen ${label} dátum: „${clean(raw)}”`);
  const t = parseTimeCell(cell(row, mapping, `${prefix}_ido`));
  return {
    datum: pd?.date || null,
    ido: t.time || pd?.time || null,
    idoIg: t.timeTo || pd?.timeTo || null,
    hely: clean(cell(row, mapping, `${prefix}_hely`)),
    orszag: clean(cell(row, mapping, `${prefix}_orszag`)),
    irsz: clean(cell(row, mapping, `${prefix}_irsz`)),
    varos: clean(cell(row, mapping, `${prefix}_varos`)),
  };
}

/**
 * @returns {{ records: object[], errors: {sor:number, okok:string[], rekord?:object}[], skipped: {ures:number, osszesito:number, fejlec:number} }}
 * A sorszám (sor) az Excel-beli 1-től számozott sor.
 */
export function buildRecords(rows, detection, mapping, opts = {}) {
  const records = [], errors = [];
  const skipped = { ures: 0, osszesito: 0, fejlec: 0 };
  const o = { date1904: opts.date1904, slashOrders: detection.slashOrders || {} };
  for (let r = detection.dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.every(isBlank)) { skipped.ures++; continue; }
    if (isRepeatedHeader(row, detection.columns)) { skipped.fejlec++; continue; }
    if (isSummaryRow(row, mapping)) { skipped.osszesito++; continue; }

    const problems = [];
    const rendszam = clean(cell(row, mapping, 'rendszam'));
    const rec = {
      sor: r + 1,
      megbizasszam: clean(cell(row, mapping, 'megbizasszam')),
      rendszam,
      rendszamNorm: primaryPlate(rendszam),
      fuvarozo: clean(cell(row, mapping, 'fuvarozo')),
      megbizo: clean(cell(row, mapping, 'megbizo')),
      megjegyzes: clean(cell(row, mapping, 'megjegyzes')),
      felrakas: stop(row, mapping, 'felrakas', o, problems, 'felrakási'),
      lerakas: stop(row, mapping, 'lerakas', o, problems, 'lerakási'),
    };
    if (!rec.megbizasszam && !rec.rendszam) problems.push('Nincs se megbízásszám, se rendszám');
    if (!rec.lerakas.datum && !problems.some((p) => p.includes('lerakási'))) problems.push('Hiányzik a lerakás dátuma');
    if (problems.length) errors.push({ sor: r + 1, okok: problems, rekord: rec });
    else records.push(rec);
  }
  return { records, errors, skipped };
}

/** Hely megjelenítése: "HU-1117 Budapest, Raktár u. 5." */
export function placeText(p) {
  if (!p) return '';
  const loc = [p.orszag && p.irsz ? `${p.orszag}-${p.irsz}` : p.orszag || p.irsz, p.varos].filter(Boolean).join(' ');
  if (p.hely && loc && !normText(p.hely).includes(normText(p.varos || '~'))) return `${loc}, ${p.hely}`;
  return p.hely || loc;
}
