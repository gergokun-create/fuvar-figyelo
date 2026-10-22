// Megjelenítési formázók a nézetekhez.
import { huDate, huDateTimeShort, localParts } from './core/tz.js';
import { placeText } from './core/records.js';
import { STATUSZOK } from './core/sync.js';

export const statusLabel = (s) => STATUSZOK[s] || s;

export function stopWhen(s) {
  if (!s) return '';
  const t = [s.ido, s.idoIg].filter(Boolean).join('–');
  return [huDate(s.datum), t].filter(Boolean).join(' ');
}

export function stopText(s) {
  return [stopWhen(s), placeText(s)].filter(Boolean).join(' · ');
}

/** Emlékeztető időpont barátságosan: "ma 14:30", "holnap 08:00", "10.24. 08:00". */
export function whenText(iso, now = new Date()) {
  const p = localParts(iso), n = localParts(now);
  const tomorrow = localParts(new Date(now.getTime() + 86400e3)).date;
  if (p.date === n.date) return `ma ${p.time}`;
  if (p.date === tomorrow) return `holnap ${p.time}`;
  return huDateTimeShort(iso);
}

export function fieldValue(path, v) {
  if (v === '' || v === null || v === undefined) return '–';
  if (path.endsWith('.datum')) return huDate(v);
  return String(v);
}
