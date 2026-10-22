// Időzóna-segédek Europe/Budapest szerint, Intl API-val (DST-biztos).

export const TZ = 'Europe/Budapest';

const fmtCache = new Map();
function partsFmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return fmtCache.get(tz);
}

const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Egy UTC időpont helyi részei: {y,m,d,hh,mm,ss,wd(1=hétfő), date:'YYYY-MM-DD', time:'HH:MM'} */
export function localParts(instant, tz = TZ) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const p = {};
  for (const { type, value } of partsFmt(tz).formatToParts(d)) p[type] = value;
  const r = { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second, wd: WD[p.weekday] };
  r.date = `${p.year}-${p.month}-${p.day}`;
  r.time = `${p.hour}:${p.minute}`;
  return r;
}

/** Az időzóna eltolása percben az adott pillanatban (Budapest: +60 vagy +120). */
export function offsetMinutes(instant, tz = TZ) {
  const t = instant instanceof Date ? instant.getTime() : +new Date(instant);
  const p = localParts(t, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000);
}

/**
 * Helyi falióra-idő -> UTC Date. Ha az idő a tavaszi ugrásba esik (nem létezik),
 * előre tolja; ha az őszi kétszer előforduló órába esik, az elsőt (nyári) adja.
 */
export function zonedToUtc(dateStr, timeStr = '00:00', tz = TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // az átállás előtti eltolással indulunk, így kétértelmű időnél a korábbit kapjuk
  const t1 = guess - offsetMinutes(guess - 120 * 60000, tz) * 60000;
  const t2 = guess - offsetMinutes(t1, tz) * 60000;
  const want = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const back = localParts(t2, tz);
  if (back.date === dateStr && back.time === want) return new Date(t2);
  // nem létező helyi idő (tavaszi ugrás): előre tolva, pl. 02:30 -> 03:30
  return new Date(t1);
}

/** 'YYYY-MM-DD' + n nap (naptári napok, DST-független). */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function todayLocal(now = new Date(), tz = TZ) {
  return localParts(now, tz).date;
}

/** Hét napja 'YYYY-MM-DD'-ből (1=hétfő … 7=vasárnap). */
export function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

const HU_DAYS = ['', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];
const HU_MONTHS = ['', 'jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];

export function huDayName(dateStr) { return HU_DAYS[weekday(dateStr)]; }

/** "okt. 22., csütörtök" */
export function huDateLong(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${HU_MONTHS[m]} ${d}., ${huDayName(dateStr)}`;
}

/** "2026.10.22." */
export function huDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.replace(/-/g, '.') + '.';
}

/** UTC ISO -> "10.22. 14:30" helyi idő szerint */
export function huDateTimeShort(iso, tz = TZ) {
  const p = localParts(iso, tz);
  return `${String(p.m).padStart(2, '0')}.${String(p.d).padStart(2, '0')}. ${p.time}`;
}
