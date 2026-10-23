// Emlékeztetők és összesítők Budapest helyi ideje szerint.
// - planNtfy: mit kell előre beütemezni az ntfy-ba, és mit kell visszavonni (app és ütemező is hívja);
// - computeDue: mit kell most azonnal elküldeni (pótlás, illetve időzítést nem ismerő értesítők, pl. Telegram).

import { localParts, zonedToUtc, addDays, weekday, huDateLong, huDate } from './tz.js';
import { placeText } from './records.js';
import { seqFor } from './ntfy.js';

export const DEFAULT_SETTINGS = { reggeliOsszesito: '07:30', estiOsszesito: '17:00' };

// az ntfy.sh legfeljebb 3 nappal előre fogad időzítést, legalább 10 mp-cel
export const MAX_AHEAD_MS = 71 * 3600e3;
export const MIN_AHEAD_MS = 20e3;

/** Gyorsgombok időpontjai (UTC ISO). Az "+N óra" valódi eltelt idő, a "holnap 8:00" helyi idő. */
export function quickTimes(now = new Date()) {
  const t = now.getTime();
  const today = localParts(now).date;
  return [
    { cimke: '+1 óra', at: new Date(t + 3600e3).toISOString() },
    { cimke: '+2 óra', at: new Date(t + 7200e3).toISOString() },
    { cimke: '+4 óra', at: new Date(t + 14400e3).toISOString() },
    { cimke: 'holnap 8:00', at: zonedToUtc(addDays(today, 1), '08:00').toISOString() },
  ];
}

/** Nem kap több emlékeztetőt a lerakott vagy archivált fuvar. */
export function remindersBlocked(f) {
  return !!f.archivalt || f.statusz === 'lerakva';
}

export const reminderKey = (f, e) => `e:${f.id}:${e.id}`;

export function activeReminders(f) {
  return (f.emlekeztetok || []).filter((e) => !e.torolve && !e.lemondva);
}

/** Az ntfy-ban (az app vagy az ütemező által) be van-e ütemezve. */
export function isScheduled(f, e, sent = {}) {
  return !!e.ntfy || sent[reminderKey(f, e)]?.allapot === 'utemezve';
}

/** A következő (még el nem küldött) ránézés. sent: az elkuldve.json "elkuldve" objektuma (ha ismert). */
export function nextReminder(f, sent = {}, now = new Date()) {
  if (remindersBlocked(f)) return null;
  return activeReminders(f)
    .filter((e) => {
      const s = sent[reminderKey(f, e)];
      if (s && s.allapot !== 'utemezve') return false; // már kiment
      if (isScheduled(f, e, sent) && new Date(e.at) <= now) return false; // az ntfy kézbesítette
      return true;
    })
    .sort((a, b) => a.at.localeCompare(b.at))[0] || null;
}

const stopTime = (s) => [s?.ido, s?.idoIg].filter(Boolean).join('–');
const baseUrl = (appUrl) => (appUrl || '').replace(/[#/]+$/, '');

/** Egy összesítő-sor; stop: 'felrakas' | 'lerakas' – melyik esemény helyét és idejét mutatja. */
function line(f, { withDate = false, stop = 'lerakas' } = {}) {
  const s = f.src, st = s[stop] || {};
  const when = [withDate ? huDate(st.datum) : '', stopTime(st)].filter(Boolean).join(' ');
  const parts = [s.rendszam || s.megbizasszam, s.megbizo, placeText(st), when].filter(Boolean);
  return '• ' + parts.join(' – ') + (f.statusz === 'lerakva' ? ' ✓' : f.statusz === 'problema' ? ' ⚠' : '');
}

function clip(lines, max = 25) {
  return lines.length > max ? [...lines.slice(0, max), `… és még ${lines.length - max}`] : lines;
}

const byStop = (stop) => (a, b) => (a.src[stop]?.datum || '').localeCompare(b.src[stop]?.datum || '')
  || (a.src[stop]?.ido || '99').localeCompare(b.src[stop]?.ido || '99');

/** Felrakók és lerakók adott napokon, külön listában. A már elindult (Úton) vagy lerakott fuvar felrakása nem teendő. */
function stopsOn(aktiv, days, { skipDone = false } = {}) {
  const fel = aktiv.filter((f) => days.includes(f.src.felrakas?.datum) && !['uton', 'lerakva'].includes(f.statusz))
    .sort(byStop('felrakas'));
  const le = aktiv.filter((f) => days.includes(f.src.lerakas.datum) && !(skipDone && f.statusz === 'lerakva'))
    .sort(byStop('lerakas'));
  return { fel, le };
}

const countText = ({ fel, le }) => [fel.length && `${fel.length} felrakás`, le.length && `${le.length} lerakás`].filter(Boolean).join(', ');

function sections({ fel, le }, withDate) {
  const out = [];
  if (fel.length) out.push(`Felrakás (${fel.length}):`, ...clip(fel.map((f) => line(f, { withDate, stop: 'felrakas' }))));
  if (le.length) out.push(...(out.length ? [''] : []), `Lerakás (${le.length}):`, ...clip(le.map((f) => line(f, { withDate }))));
  return out;
}

/** Emlékeztető üzenet. lateFrom: ha késve megy ki, az eredeti időpont jelzése. */
export function reminderMessage(f, e, appUrl = '', { late = false } = {}) {
  const s = f.src;
  const le = [placeText(s.lerakas), huDate(s.lerakas.datum), stopTime(s.lerakas)].filter(Boolean).join(' ');
  return {
    kulcs: reminderKey(f, e), tipus: 'emlekezteto', fuvarId: f.id,
    cim: `Ránézés: ${s.rendszam || s.megbizasszam}`,
    uzenet: [
      [s.megbizo, e.jegyzet].filter(Boolean).join(' – '),
      le ? `Le: ${le}` : '',
      late ? `(késve, esedékes volt: ${localParts(e.at).time})` : '',
    ].filter(Boolean).join('\n'),
    link: appUrl ? `${baseUrl(appUrl)}/#/fuvar/${encodeURIComponent(f.id)}` : '',
  };
}

/** Reggeli összesítő egy adott napra: a mai felrakók és lerakók külön, plusz a lejártak. */
export function morningSummary(data, date, appUrl = '') {
  const aktiv = Object.values(data?.fuvarok || {}).filter((f) => !f.archivalt);
  const ma = stopsOn(aktiv, [date]);
  const lejart = aktiv.filter((f) => f.src.lerakas.datum && f.src.lerakas.datum < date && f.statusz !== 'lerakva');
  const lines = sections(ma, false);
  if (lejart.length) lines.push(...(lines.length ? [''] : []), `Lejárt, de nincs lerakva (${lejart.length}):`, ...clip(lejart.map((f) => line(f, { withDate: true })), 10));
  const n = countText(ma);
  return {
    kulcs: `reggel:${date}`, tipus: 'reggeli',
    cim: n ? `Ma: ${n} – ${huDateLong(date)}` : `Ma nincs felrakás és lerakás – ${huDateLong(date)}`,
    uzenet: lines.join('\n') || 'Nincs mai felrakás és lerakás.',
    link: appUrl ? `${baseUrl(appUrl)}/#/napok` : '',
  };
}

/** Esti összesítő: a következő napi felrakók és lerakók külön (szombaton vasárnap + hétfő, mert vasárnap nincs összesítő). */
export function eveningSummary(data, date, appUrl = '') {
  const aktiv = Object.values(data?.fuvarok || {}).filter((f) => !f.archivalt);
  const days = [addDays(date, 1)];
  if (weekday(days[0]) === 7) days.push(addDays(date, 2));
  const holnap = stopsOn(aktiv, days, { skipDone: true });
  const label = days.length > 1 ? 'Vasárnap és hétfő' : 'Holnap';
  const n = countText(holnap);
  return {
    kulcs: `este:${date}`, tipus: 'esti',
    cim: n ? `${label}: ${n} – ezekre nézz rá` : `${label} nincs felrakás és lerakás`,
    uzenet: sections(holnap, days.length > 1).join('\n') || 'Nincs teendő.',
    link: appUrl ? `${baseUrl(appUrl)}/#/napok` : '',
  };
}

/**
 * Az ntfy időzítési terve.
 * @returns {{ publish: object[], cancel: {seq:string, kulcs:string, fuvarId:string, emlId:string}[] }}
 *   publish elemei: üzenet + seq + at; a reminder:true elemeket fel kell jegyezni, hogy ne ütemezzük újra.
 */
export function planNtfy({ data, settings = {}, sent = {}, now = new Date(), appUrl = '' }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const t = now.getTime();
  const inWindow = (iso) => { const d = new Date(iso).getTime() - t; return d >= MIN_AHEAD_MS && d <= MAX_AHEAD_MS; };
  const publish = [], cancel = [];

  for (const f of Object.values(data?.fuvarok || {})) {
    const blocked = remindersBlocked(f);
    for (const e of f.emlekeztetok || []) {
      const kulcs = reminderKey(f, e);
      const s = sent[kulcs];
      const scheduled = isScheduled(f, e, sent);
      const dead = blocked || e.torolve || e.lemondva;
      if (dead) {
        // lemondott / lerakott / archivált: a még ki nem kézbesített időzítést vissza kell vonni
        if (scheduled && !e.ntfyVisszavonva && s?.allapot !== 'visszavonva' && new Date(e.at).getTime() > t) {
          cancel.push({ seq: seqFor(kulcs), kulcs, fuvarId: f.id, emlId: e.id });
        }
        continue;
      }
      if (scheduled || s || !inWindow(e.at)) continue;
      publish.push({ ...reminderMessage(f, e, appUrl), seq: seqFor(kulcs), at: e.at, reminder: true, emlId: e.id });
    }
  }

  // összesítők a következő 3 napra, hétfőtől szombatig; ugyanaz a seq -> frissített tartalommal lecseréli
  const today = localParts(now).date;
  for (let i = 0; i <= 3; i++) {
    const d = addDays(today, i);
    if (weekday(d) === 7) continue;
    const m = zonedToUtc(d, cfg.reggeliOsszesito).toISOString();
    if (inWindow(m)) { const msg = morningSummary(data, d, appUrl); publish.push({ ...msg, seq: seqFor(msg.kulcs), at: m }); }
    const ev = zonedToUtc(d, cfg.estiOsszesito).toISOString();
    if (inWindow(ev)) { const msg = eveningSummary(data, d, appUrl); publish.push({ ...msg, seq: seqFor(msg.kulcs), at: ev }); }
  }
  return { publish, cancel };
}

/**
 * Most azonnal küldendő értesítések: esedékes, de nem beütemezett emlékeztetők (pótlás) és –
 * opts.summaries esetén – az esedékes összesítők (időzítést nem ismerő értesítőknek).
 */
export function computeDue({ data, settings = {}, sent = {}, now = new Date(), appUrl = '', summaries = true }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const out = [];
  const nowIso = now.toISOString();
  const lp = localParts(now);

  for (const f of Object.values(data?.fuvarok || {})) {
    if (remindersBlocked(f)) continue;
    for (const e of activeReminders(f)) {
      if (e.at > nowIso || sent[reminderKey(f, e)] || isScheduled(f, e, sent)) continue;
      out.push(reminderMessage(f, e, appUrl, { late: (now - new Date(e.at)) / 60000 > 30 }));
    }
  }
  if (!summaries) return out;

  const today = lp.date;
  if (lp.time >= cfg.reggeliOsszesito && lp.time < '22:00' && !sent[`reggel:${today}`]) out.push(morningSummary(data, today, appUrl));
  if (lp.time >= cfg.estiOsszesito && lp.time < '23:30' && !sent[`este:${today}`]) out.push(eveningSummary(data, today, appUrl));
  return out;
}

/** 45 napnál régebbi küldési bejegyzések törlése. */
export function pruneSent(sent, now = new Date()) {
  const limit = new Date(now.getTime() - 45 * 86400e3).toISOString();
  return Object.fromEntries(Object.entries(sent).filter(([, v]) => (v?.at || '') >= limit));
}
