// Formátumfelismerés: fejlécsor keresése, oszlop-hozzárendelés szinonimák és tartalom
// alapján, formátum-ujjlenyomat.

import { normText, hash, isBlank, clean, looksLikePlate } from './text.js';
import { looksLikeDate, inferSlashOrder } from './dates.js';

const placeSyn = (pre, en) => ({
  hely: [`${pre}o`, `${pre}ohely`, `${pre}asihely`, `${pre}ashely`, `${pre}ocim`, `${pre}ascim`, `${pre}asicim`,
    `${pre}ohelyszin`, `${pre}asihelyszin`, ...en.flatMap((e) => [`${e}place`, `${e}address`, `${e}location`])],
  orszag: [`${pre}oorszag`, `${pre}asorszag`, `${pre}asiorszag`, ...en.map((e) => `${e}country`)],
  irsz: [`${pre}oiranyitoszam`, `${pre}oirsz`, `${pre}asiranyitoszam`, `${pre}asiiranyitoszam`, `${pre}asirsz`,
    `${pre}asiirsz`, ...en.flatMap((e) => [`${e}zip`, `${e}postcode`, `${e}postalcode`, `${e}zipcode`])],
  varos: [`${pre}ovaros`, `${pre}asvaros`, `${pre}asivaros`, `${pre}otelepules`, `${pre}astelepules`,
    `${pre}asitelepules`, ...en.flatMap((e) => [`${e}city`, `${e}town`])],
});

const FEL = placeSyn('felrak', ['loading', 'pickup', 'origin']);
const LE = placeSyn('lerak', ['unloading', 'delivery', 'destination']);

/** A felismert mezők, megjelenítési névvel és szinonimákkal (normalizált alakban). */
export const FIELDS = [
  { key: 'megbizasszam', label: 'Megbízásszám', syn: ['megbizasszam', 'megbizasszama', 'megbizas', 'megbizasiszam',
    'rendelesszam', 'rendeles', 'megrendelesszam', 'ref', 'refszam', 'referencia', 'reference', 'orderno', 'ordernumber',
    'ordernr', 'order', 'fuvarszam', 'fuvarazonosito'] },
  { key: 'rendszam', label: 'Rendszám', syn: ['rendszam', 'rendszamvontatopotkocsi', 'rendszamok', 'rendszamvontato',
    'vontatopotkocsi', 'vontato', 'plate', 'plates', 'platenumber', 'licenseplate', 'licenceplate', 'truck', 'truckplate',
    'vehicle', 'registration', 'gepjarmu', 'jarmu', 'kamion', 'auto'] },
  { key: 'fuvarozo', label: 'Fuvarozó', syn: ['fuvarozo', 'alvallalkozo', 'carrier', 'haulier', 'subcontractor',
    'fuvarozoceg', 'szallito'] },
  { key: 'megbizo', label: 'Megbízó', syn: ['megbizo', 'ugyfel', 'partner', 'customer', 'client', 'megrendelo',
    'vevo', 'shipper'] },
  { key: 'felrakas_datum', label: 'Felrakás dátuma', syn: ['felrakas', 'felrakasdatuma', 'felrakasdatum', 'felrakodatum',
    'felraknap', 'felrakasnap', 'felrakasinap', 'loading', 'loadingdate',
    'pickup', 'pickupdate', 'loaddate'] },
  { key: 'felrakas_ido', label: 'Felrakás ideje / idősáv', syn: ['felrakasido', 'felrakasideje', 'felrakasidopontja', 'felrakoido', 'felrakasidopont',
    'felrakasidosav', 'felrakasiidopont', 'felrakasiidosav', 'felrakoidosav', 'loadingtime', 'loadingslot',
    'pickuptime', 'pickupslot'] },
  { key: 'felrakas_hely', label: 'Felrakó hely', syn: FEL.hely },
  { key: 'felrakas_orszag', label: 'Felrakó ország', syn: FEL.orszag },
  { key: 'felrakas_irsz', label: 'Felrakó irányítószám', syn: FEL.irsz },
  { key: 'felrakas_varos', label: 'Felrakó város', syn: FEL.varos },
  { key: 'lerakas_datum', label: 'Lerakás dátuma', syn: ['lerakas', 'lerakasdatuma', 'lerakasdatum', 'lerakodatum',
    'leraknap', 'lerakasnap', 'lerakasinap', 'unloading', 'unloadingdate',
    'deliverydate', 'delivery', 'unloaddate', 'erkezes', 'eta'] },
  { key: 'lerakas_ido', label: 'Lerakás ideje / idősáv', syn: ['lerakasido', 'lerakasideje', 'lerakasidopontja', 'lerakoido', 'lerakasidopont',
    'lerakasidosav', 'lerakasiidopont', 'lerakasiidosav', 'lerakoidosav', 'unloadingtime', 'unloadingslot',
    'deliverytime', 'deliveryslot'] },
  { key: 'lerakas_hely', label: 'Lerakó hely', syn: LE.hely },
  { key: 'lerakas_orszag', label: 'Lerakó ország', syn: LE.orszag },
  { key: 'lerakas_irsz', label: 'Lerakó irányítószám', syn: LE.irsz },
  { key: 'lerakas_varos', label: 'Lerakó város', syn: LE.varos },
  { key: 'megjegyzes', label: 'Megjegyzés (fájlból)', syn: ['megjegyzes', 'megjegyzesek', 'note', 'notes', 'comment',
    'comments', 'remark', 'remarks', 'info'] },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
const DATE_FIELDS = ['felrakas_datum', 'lerakas_datum'];

// a szinonimák szóköz/ékezet nélküli alakja -> mező
const EXACT = new Map();
for (const f of FIELDS) for (const s of f.syn) if (!EXACT.has(s)) EXACT.set(s, f.key);

/** Egy normalizált fejléc illeszkedése: [{field, score}] (3 = pontos, 1 = részleges). */
export function matchHeader(norm) {
  if (!norm) return [];
  const out = [];
  const ex = EXACT.get(norm);
  if (ex) out.push({ field: ex, score: 3 });
  for (const f of FIELDS) {
    if (f.key === ex) continue;
    let best = 0;
    for (const s of f.syn) {
      if (s.length < 4) continue;
      if (norm.startsWith(s) || (s.length >= 6 && norm.includes(s))) best = Math.max(best, s.length / Math.max(norm.length, 1));
    }
    if (best > 0) out.push({ field: f.key, score: Math.min(1, 0.4 + best) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Fejléccímkék egy vagy két sorból (a felső sor pl. egyesített "Felrakó" csoportcím). */
function headerLabels(rows, top, bottom) {
  const width = Math.max(rows[top]?.length || 0, rows[bottom]?.length || 0);
  const labels = [];
  for (let c = 0; c < width; c++) {
    const a = top === bottom ? null : rows[top]?.[c];
    const b = rows[bottom]?.[c];
    const parts = [a, b].filter((v) => !isBlank(v)).map(clean);
    // ha a két sor ugyanazt tartalmazza (függőlegesen egyesített cella), ne duplázzuk
    labels.push(parts.length === 2 && normText(parts[0]) === normText(parts[1]) ? parts[0] : parts.join(' '));
  }
  return labels;
}

function scoreLabels(labels) {
  let s = 0;
  const seen = new Set();
  for (const l of labels) {
    const m = matchHeader(normText(l))[0];
    if (!m) continue;
    // ugyanarra a mezőre illeszkedő további oszlop nem számít
    if (!seen.has(m.field)) s += m.score >= 3 ? 1 : 0.4;
    seen.add(m.field);
  }
  return s;
}

/** Egyedi oszlopkulcsok: normalizált fejléc, ismétlődés esetén "#2", "#3". */
export function columnKeys(labels) {
  const count = {};
  return labels.map((l, i) => {
    const n = normText(l) || `oszlop${i + 1}`;
    count[n] = (count[n] || 0) + 1;
    return count[n] > 1 ? `${n}#${count[n]}` : n;
  });
}

export function fingerprintOf(keys) {
  const meaningful = keys.filter((k) => !/^oszlop\d+$/.test(k));
  return 'f' + hash(meaningful.join('|')) + '-' + meaningful.length;
}

/** A fejlécsor (vagy kétsoros fejléc) megkeresése az első 40 sorban. */
export function findHeader(rows, savedFormats = [], force = null) {
  const limit = Math.min(rows.length, 40);
  const byFp = new Map(savedFormats.map((f) => [f.ujjlenyomat, f]));
  let best = null;
  for (let r = 0; r < limit; r++) {
    if (!force && (!rows[r] || rows[r].every(isBlank))) continue;
    const cands = force ? (r === 0 ? [[force.top, force.bottom]] : []) : [[r, r]];
    if (!force && r > 0 && rows[r - 1] && !rows[r - 1].every(isBlank)) cands.push([r - 1, r]);
    for (const [top, bottom] of cands) {
      const labels = headerLabels(rows, top, bottom);
      const keys = columnKeys(labels);
      const fp = fingerprintOf(keys);
      const saved = byFp.get(fp);
      // kétsoros fejléc csak akkor, ha érdemben jobb (különben a cím + fejléc összeolvadna)
      let score = saved ? 100 : scoreLabels(labels) - (top !== bottom ? 0.6 : 0);
      if (!best || score > best.score + 1e-9) best = { top, bottom, labels, keys, fingerprint: fp, score, saved };
    }
  }
  return best;
}

function sampleColumn(rows, start, c, n = 60) {
  const out = [];
  for (let r = start; r < rows.length && out.length < n; r++) {
    const v = rows[r]?.[c];
    if (!isBlank(v)) out.push(v);
  }
  return out;
}

function ratio(values, pred) {
  if (!values.length) return 0;
  return values.filter(pred).length / values.length;
}

/**
 * Teljes felismerés egy munkalapra.
 * Visszaad: { headerTop, headerRow, dataStart, columns:[{index,label,key}], mapping:{field:colIndex},
 *   sources:{field:'fejlec'|'gyenge'|'tartalom'|'mentett'}, confident, warnings[], fingerprint, savedFormat, score, slashOrders }
 */
export function detect(rows, savedFormats = [], opts = {}) {
  const h = findHeader(rows, savedFormats, opts.forceHeader);
  if (!h || (h.score < 1 && !opts.forceHeader)) {
    return { ok: false, warnings: ['Nem találtam fejlécsort ismert oszlopnevekkel.'], score: h?.score || 0,
      headerTop: h?.top ?? 0, headerRow: h?.bottom ?? 0, dataStart: (h?.bottom ?? 0) + 1,
      columns: (h?.labels || []).map((label, index) => ({ index, label, key: h.keys[index] })), mapping: {}, sources: {},
      confident: false, fingerprint: h?.fingerprint, slashOrders: {} };
  }
  const dataStart = h.bottom + 1;
  const columns = h.labels.map((label, index) => ({ index, label, key: h.keys[index] }));
  const samples = columns.map((c) => sampleColumn(rows, dataStart, c.index));
  const slashOrders = {};
  columns.forEach((c, i) => { slashOrders[c.index] = inferSlashOrder(samples[i]); });
  const dateRatio = samples.map((s, i) => ratio(s, (v) => looksLikeDate(v, { slashOrder: slashOrders[i] })));
  const plateRatio = samples.map((s) => ratio(s, looksLikePlate));

  const mapping = {}, sources = {}, warnings = [];

  if (h.saved) {
    const idx = Object.fromEntries(columns.map((c) => [c.key, c.index]));
    for (const [field, key] of Object.entries(h.saved.hozzarendeles)) {
      if (key && idx[key] !== undefined) { mapping[field] = idx[key]; sources[field] = 'mentett'; }
    }
    return { ok: true, headerTop: h.top, headerRow: h.bottom, dataStart, columns, mapping, sources, confident: true,
      warnings, fingerprint: h.fingerprint, savedFormat: h.saved, score: 100, slashOrders };
  }

  // fejléc alapján: mohó hozzárendelés pontszám szerint
  const cands = [];
  for (const c of columns) {
    for (const m of matchHeader(normText(c.label))) {
      let score = m.score;
      // a tartalom megerősít vagy gyengít
      if (DATE_FIELDS.includes(m.field)) score += dateRatio[c.index] >= 0.6 ? 0.5 : samples[c.index].length ? -1.5 : 0;
      if (m.field === 'rendszam') score += plateRatio[c.index] >= 0.6 ? 0.5 : samples[c.index].length ? -1 : 0;
      cands.push({ col: c.index, field: m.field, score, exact: m.score >= 3 });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const usedCols = new Set();
  for (const k of cands) {
    if (k.score < 0.6 || usedCols.has(k.col) || mapping[k.field] !== undefined) continue;
    mapping[k.field] = k.col; sources[k.field] = k.exact ? 'fejlec' : 'gyenge'; usedCols.add(k.col);
  }

  // "Lerakás ideje" oszlop, ami valójában teljes dátumot tartalmaz -> dátum
  for (const p of ['felrakas', 'lerakas']) {
    const c = mapping[`${p}_ido`];
    if (mapping[`${p}_datum`] === undefined && c !== undefined && dateRatio[c] >= 0.6) {
      mapping[`${p}_datum`] = c; sources[`${p}_datum`] = sources[`${p}_ido`];
      delete mapping[`${p}_ido`]; delete sources[`${p}_ido`];
    }
  }

  // tartalom alapján: rendszám
  if (mapping.rendszam === undefined) {
    const best = columns.filter((c) => !usedCols.has(c.index)).sort((a, b) => plateRatio[b.index] - plateRatio[a.index])[0];
    if (best && plateRatio[best.index] >= 0.7) {
      mapping.rendszam = best.index; sources.rendszam = 'tartalom'; usedCols.add(best.index);
    }
  }
  // tartalom alapján: dátumok
  const freeDates = columns.filter((c) => !usedCols.has(c.index) && dateRatio[c.index] >= 0.8).map((c) => c.index);
  if (mapping.lerakas_datum === undefined && mapping.felrakas_datum !== undefined && freeDates.length === 1) {
    mapping.lerakas_datum = freeDates[0]; sources.lerakas_datum = 'tartalom';
  } else if (mapping.lerakas_datum === undefined && mapping.felrakas_datum === undefined && freeDates.length === 2) {
    mapping.felrakas_datum = freeDates[0]; sources.felrakas_datum = 'tartalom';
    mapping.lerakas_datum = freeDates[1]; sources.lerakas_datum = 'tartalom';
  }

  for (const f of DATE_FIELDS) {
    const c = mapping[f];
    if (c !== undefined && samples[c].length && dateRatio[c] < 0.6) {
      warnings.push(`A(z) „${columns[c].label}” oszlop (${FIELD_BY_KEY[f].label}) értékei nagyrészt nem dátumok.`);
    }
  }
  if (mapping.lerakas_datum === undefined) warnings.push('Nem találtam a lerakás dátumát tartalmazó oszlopot.');
  if (mapping.rendszam === undefined && mapping.megbizasszam === undefined) {
    warnings.push('Nem találtam se rendszám, se megbízásszám oszlopot.');
  }

  const required = ['lerakas_datum'];
  const idOk = ['rendszam', 'megbizasszam'].some((f) => sources[f] === 'fejlec');
  const confident = warnings.length === 0 && idOk && required.every((f) => sources[f] === 'fejlec')
    && Object.values(sources).every((s) => s === 'fejlec');

  return { ok: true, headerTop: h.top, headerRow: h.bottom, dataStart, columns, mapping, sources, confident,
    warnings, fingerprint: h.fingerprint, savedFormat: null, score: h.score, slashOrders };
}

/** Több munkalap közül a legvalószínűbb kiválasztása. */
export function rankSheets(sheets, savedFormats = []) {
  return sheets
    .map((s, i) => {
      const d = detect(s.rows, savedFormats);
      const dataRows = s.rows.slice(d.dataStart).filter((r) => r && r.some((v) => !isBlank(v))).length;
      return { index: i, name: s.name, detection: d, dataRows, score: d.score + Math.min(dataRows, 50) / 100 };
    })
    .sort((a, b) => b.score - a.score);
}

/** Elmenthető formátum-objektum egy felismerésből és (esetleg kézzel módosított) hozzárendelésből. */
export function makeFormat(detection, mapping, name, id) {
  const hozzarendeles = {};
  for (const [field, col] of Object.entries(mapping)) {
    if (col === null || col === undefined || col === '') continue;
    const c = detection.columns.find((x) => x.index === Number(col));
    if (c) hozzarendeles[field] = c.key;
  }
  return {
    id,
    nev: name,
    ujjlenyomat: detection.fingerprint,
    fejlecek: detection.columns.map((c) => c.label),
    hozzarendeles,
    letrehozva: new Date().toISOString(),
  };
}
