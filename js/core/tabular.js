// Táblázatos bemenet -> sorok (tömbök tömbje). CSV/TSV saját értelmezővel
// (a dátumok szövegként maradnak), Excel a kívülről átadott SheetJS-szel.

/** Bájtok dekódolása: UTF-8, ha érvényes, különben Windows-1250 (magyar Excel CSV). */
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
  } catch {
    try { return new TextDecoder('windows-1250').decode(u8); } catch { return new TextDecoder('latin1').decode(u8); }
  }
}

/** Elválasztó kitalálása az első néhány sorból: tab, pontosvessző vagy vessző. */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of ['\t', ';', ',', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const max = Math.max(0, ...counts);
    const consistent = counts.filter((c) => c === max).length;
    const score = max > 0 ? consistent * 10 + max : 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

/** CSV/TSV értelmezése idézőjelek kezelésével (több soros cellák is). */
export function parseDelimited(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"' && cell === '') {
      q = true;
    } else if (c === d) {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => (v.trim() === '' ? null : v.trim())));
}

/** Munkalap -> sorok, az egyesített cellák értékét a teljes tartományba kitöltve. */
export function sheetToRows(XLSX, ws) {
  if (!ws || !ws['!ref']) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const range = XLSX.utils.decode_range(ws['!ref']);
  const off = range.s.r; // sheet_to_json a !ref elejétől indul
  const coff = range.s.c;
  for (const m of ws['!merges'] || []) {
    const v = rows[m.s.r - off]?.[m.s.c - coff] ?? null;
    if (v === null) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      const rr = r - off;
      if (!rows[rr]) rows[rr] = [];
      for (let c = m.s.c; c <= m.e.c; c++) {
        const cc = c - coff;
        if (rows[rr][cc] === null || rows[rr][cc] === undefined) rows[rr][cc] = v;
      }
    }
  }
  return rows.map((r) => Array.from(r || [], (v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null)));
}

/**
 * Fájl beolvasása munkalapokká: [{ name, rows }] és a 1904-es dátumrendszer jelzője.
 * A CSV-t magunk olvassuk, így a "10/22/2026" stb. szöveg marad, nem tippel a SheetJS.
 */
export function readWorkbook(XLSX, data, fileName = '') {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv')) {
    return { sheets: [{ name: 'CSV', rows: parseDelimited(decodeText(data)) }], date1904: false };
  }
  const wb = XLSX.read(data, { type: 'array', cellDates: false, cellNF: false, dense: false });
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const sheets = wb.SheetNames.map((name) => ({ name, rows: sheetToRows(XLSX, wb.Sheets[name]) }));
  return { sheets, date1904 };
}

/** Excelből másolt cellák (tabulátorral tagolt szöveg). */
export function readPasted(text) {
  const d = text.includes('\t') ? '\t' : detectDelimiter(text);
  return { sheets: [{ name: 'Beillesztett', rows: parseDelimited(text, d) }], date1904: false };
}
