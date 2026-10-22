import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from '../js/core/tabular.js';
import { rankSheets } from '../js/core/detect.js';
import { buildRecords } from '../js/core/records.js';

export const sample = (name) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url));

export function loadSample(name, savedFormats = []) {
  const wb = readWorkbook(XLSX, readFileSync(sample(name)), name);
  const ranked = rankSheets(wb.sheets, savedFormats);
  const best = ranked[0];
  const rows = wb.sheets[best.index].rows;
  const built = buildRecords(rows, best.detection, best.detection.mapping, { date1904: wb.date1904 });
  return { wb, ranked, best, rows, detection: best.detection, ...built };
}

export const byField = (det) =>
  Object.fromEntries(Object.entries(det.mapping).map(([f, c]) => [f, det.columns[c].label]));
