// Szöveg-normalizálás és kis segédfüggvények (böngészőben és Node-ban is fut).

/** Kisbetű, ékezet nélkül, csak betű és szám marad. "Lerakás dátuma" -> "lerakasdatuma" */
export function normText(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Rendszám összehasonlításhoz: nagybetű, szóköz és kötőjel nélkül. */
export function normPlate(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[\s\-–.]+/g, '');
}

/** Az első (vontató) rendszám normalizálva: "ABC-123 / XYZ-456" -> "ABC123" */
export function primaryPlate(v) {
  const first = String(v ?? '').split(/[\/,;+]|\s{2,}/)[0];
  return normPlate(first);
}

/** Rendszám-formátumnak tűnik-e (EU-s rendszámok durva mintája). */
export function looksLikePlate(v) {
  if (v === null || v === undefined || typeof v === 'number') return false;
  const s = String(v).trim();
  if (s.length < 4 || s.length > 30) return false;
  const p = primaryPlate(s);
  if (p.length < 4 || p.length > 10) return false;
  return /[A-Z]/.test(p) && /[0-9]/.test(p) && /^[A-Z0-9]+$/.test(p);
}

/** Egyszerű, stabil 32 bites FNV-1a hash, base36-ban. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export function clean(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

export function randomId(len = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}
