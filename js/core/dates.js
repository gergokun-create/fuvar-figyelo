// Dátum- és időértelmezés sokféle formátumból.
// Eredmény: { date: 'YYYY-MM-DD' | null, time: 'HH:MM' | null, timeTo: 'HH:MM' | null }

import { normText } from './text.js';

const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

function mk(y, m, d) {
  if (y < 100) y += 2000;
  return validDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Excel sorszám-dátum -> { date, time } (1900-as vagy 1904-es rendszer). */
export function fromExcelSerial(n, date1904 = false) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(n * 86400000);
  const t = new Date(base + ms);
  // perc pontosságra kerekítve
  const mins = Math.round((n - Math.floor(n)) * 1440);
  const date = Math.floor(n) > 0 ? t.toISOString().slice(0, 10) : null;
  const time = mins > 0 && mins < 1440 ? `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` : null;
  return { date, time };
}

const MONTHS = {
  jan: 1, januar: 1, january: 1,
  feb: 2, febr: 2, februar: 2, february: 2,
  mar: 3, marc: 3, marcius: 3, march: 3,
  apr: 4, aprilis: 4, april: 4,
  maj: 5, majus: 5, may: 5,
  jun: 6, junius: 6, june: 6,
  jul: 7, julius: 7, july: 7,
  aug: 8, augusztus: 8, august: 8,
  szept: 9, szep: 9, sep: 9, sept: 9, szeptember: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const TIME_RE = /(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?(?:\s*(?:-|–|—|tól|ig|to)\s*(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?)?/;

function parseTimeText(s) {
  const m = s.match(TIME_RE);
  if (!m) {
    // "8-12" vagy "8h-12h" óraintervallum
    const h = s.match(/^\s*(\d{1,2})\s*h?\s*[-–]\s*(\d{1,2})\s*h?\s*$/);
    if (h && +h[1] < 24 && +h[2] <= 24) return { time: `${pad(+h[1])}:00`, timeTo: `${pad(+h[2])}:00` };
    return { time: null, timeTo: null };
  }
  const h1 = +m[1], m1 = +m[2];
  if (h1 > 23 || m1 > 59) return { time: null, timeTo: null };
  let timeTo = null;
  if (m[3] !== undefined) {
    const h2 = +m[3], m2 = +m[4];
    if (h2 <= 24 && m2 <= 59) timeTo = `${pad(h2)}:${pad(m2)}`;
  }
  return { time: `${pad(h1)}:${pad(m1)}`, timeTo };
}

/**
 * Szöveges dátum értelmezése.
 * opts.slashOrder: 'MDY' | 'DMY' – a perjeles alak értelmezése, ha kétértelmű (alapból MDY).
 */
export function parseDateText(str, opts = {}) {
  const s = String(str).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let date = null, rest = '';
  let m;

  if ((m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?(?:[T\s]+(.*))?$/))) {
    date = mk(+m[1], +m[2], +m[3]); rest = m[4] || '';
  } else if ((m = s.match(/^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4}|\d{2})\.?(?:\s+(.*))?$/))) {
    date = mk(+m[3], +m[2], +m[1]); rest = m[4] || '';
  } else if ((m = s.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})(?:\s+(.*))?$/))) {
    date = mk(+m[3], +m[2], +m[1]); rest = m[4] || '';
  } else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:,?\s+(.*))?$/))) {
    const a = +m[1], b = +m[2];
    let order = opts.slashOrder || 'MDY';
    if (a > 12) order = 'DMY'; else if (b > 12) order = 'MDY';
    date = order === 'DMY' ? mk(+m[3], b, a) : mk(+m[3], a, b);
    rest = m[4] || '';
  } else if ((m = s.match(/^(\d{4})\.?\s*([A-Za-zÀ-ž]+)\.?\s*(\d{1,2})\.?(?:,?\s+(.*))?$/))) {
    const mo = MONTHS[normText(m[2])];
    if (mo) { date = mk(+m[1], mo, +m[3]); rest = m[4] || ''; }
  } else if ((m = s.match(/^(\d{1,2})\.?\s*([A-Za-zÀ-ž]+)\.?,?\s*(\d{4})(?:,?\s+(.*))?$/))) {
    const mo = MONTHS[normText(m[2])];
    if (mo) { date = mk(+m[3], mo, +m[1]); rest = m[4] || ''; }
  } else if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(.*))?$/))) {
    const mo = MONTHS[normText(m[1])];
    if (mo) { date = mk(+m[3], mo, +m[2]); rest = m[4] || ''; }
  }
  if (!date) return null;
  const t = rest ? parseTimeText(rest) : { time: null, timeTo: null };
  return { date, ...t };
}

/** Egy cellaérték értelmezése dátumként (szám = Excel-sorszám, Date, vagy szöveg). */
export function parseDateCell(v, opts = {}) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return {
      date: `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`,
      time: v.getHours() || v.getMinutes() ? `${pad(v.getHours())}:${pad(v.getMinutes())}` : null,
      timeTo: null,
    };
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // 1954 – 2119 között értelmes
    const r = fromExcelSerial(v, opts.date1904);
    return r.date ? { date: r.date, time: r.time, timeTo: null } : null;
  }
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDateCell(Number(s), opts);
  return parseDateText(s, opts);
}

/** Időpont/idősáv cella: 0.5 -> 12:00, "08:00-12:00", "8:30". */
export function parseTimeCell(v) {
  if (v === null || v === undefined || v === '') return { time: null, timeTo: null };
  if (typeof v === 'number') {
    const frac = v - Math.floor(v);
    if (frac === 0 && v >= 1) return { time: null, timeTo: null };
    const mins = Math.round(frac * 1440);
    return { time: `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`, timeTo: null };
  }
  if (v instanceof Date) return { time: `${pad(v.getHours())}:${pad(v.getMinutes())}`, timeTo: null };
  return parseTimeText(String(v));
}

/** Dátumnak tűnik-e egy cella (tartalom alapú oszlopfelismeréshez). */
export function looksLikeDate(v, opts) {
  return parseDateCell(v, opts) !== null;
}

/** Egy oszlop perjeles dátumainak sorrendje: ha bármelyik első tag > 12, DMY. */
export function inferSlashOrder(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  if (dmy > mdy) return 'DMY';
  return 'MDY';
}
