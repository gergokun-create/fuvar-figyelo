// Emlékeztetők és összesítők: mi esedékes egy adott pillanatban (Budapest helyi ideje szerint).
// Az app (gyorsgombok, következő ránézés) és az ütemező (értesítések) is ezt használja.

import { localParts, zonedToUtc, addDays, weekday, huDateLong, huDate } from './tz.js';
import { placeText } from './records.js';

export const DEFAULT_SETTINGS = { reggeliOsszesito: '07:30', estiOsszesito: '17:00' };

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

/** A következő (még el nem küldött) ránézés. sent: az elkuldve.json "elkuldve" objektuma (ha ismert). */
export function nextReminder(f, sent = {}) {
  if (remindersBlocked(f)) return null;
  return activeReminders(f)
    .filter((e) => !sent[reminderKey(f, e)])
    .sort((a, b) => a.at.localeCompare(b.at))[0] || null;
}

const stopTime = (s) => [s?.ido, s?.idoIg].filter(Boolean).join('–');

function line(f, { withDate = false } = {}) {
  const s = f.src;
  const when = [withDate ? huDate(s.lerakas.datum) : '', stopTime(s.lerakas)].filter(Boolean).join(' ');
  const parts = [s.rendszam || s.megbizasszam, s.megbizo, placeText(s.lerakas), when].filter(Boolean);
  return '• ' + parts.join(' – ') + (f.statusz === 'lerakva' ? ' ✓' : f.statusz === 'problema' ? ' ⚠' : '');
}

function clip(lines, max = 25) {
  return lines.length > max ? [...lines.slice(0, max), `… és még ${lines.length - max}`] : lines;
}

const sortByTime = (a, b) => (a.src.lerakas.ido || '99').localeCompare(b.src.lerakas.ido || '99');

/**
 * Esedékes értesítések.
 * @returns {{kulcs:string, tipus:string, cim:string, uzenet:string, link:string, fuvarId?:string}[]}
 */
export function computeDue({ data, settings = {}, sent = {}, now = new Date(), appUrl = '' }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const out = [];
  const nowIso = now.toISOString();
  const lp = localParts(now);
  const fuvarok = Object.values(data?.fuvarok || {});
  const link = (id) => (appUrl ? `${appUrl.replace(/[#/]+$/, '')}/#/fuvar/${encodeURIComponent(id)}` : '');

  // 1) emlékeztetők – a kimaradt futások esedékes elemeit is pótolja
  for (const f of fuvarok) {
    if (remindersBlocked(f)) continue;
    for (const e of activeReminders(f)) {
      const kulcs = reminderKey(f, e);
      if (e.at > nowIso || sent[kulcs]) continue;
      const lateMin = Math.round((now - new Date(e.at)) / 60000);
      const s = f.src;
      const le = [placeText(s.lerakas), huDate(s.lerakas.datum), stopTime(s.lerakas)].filter(Boolean).join(' ');
      out.push({
        kulcs, tipus: 'emlekezteto', fuvarId: f.id,
        cim: `Ránézés: ${s.rendszam || s.megbizasszam}`,
        uzenet: [
          [s.megbizo, e.jegyzet].filter(Boolean).join(' – '),
          le ? `Le: ${le}` : '',
          lateMin > 30 ? `(késve, esedékes volt: ${localParts(e.at).time})` : '',
        ].filter(Boolean).join('\n'),
        link: link(f.id),
      });
    }
  }

  const aktiv = fuvarok.filter((f) => !f.archivalt);
  const today = lp.date;

  // 2) reggeli összesítő a mai lerakókról
  const mKey = `reggel:${today}`;
  if (lp.time >= cfg.reggeliOsszesito && lp.time < '22:00' && !sent[mKey]) {
    const ma = aktiv.filter((f) => f.src.lerakas.datum === today).sort(sortByTime);
    const lejart = aktiv.filter((f) => f.src.lerakas.datum && f.src.lerakas.datum < today && f.statusz !== 'lerakva');
    const lines = clip(ma.map((f) => line(f)));
    if (lejart.length) lines.push('', `Lejárt, de nincs lerakva: ${lejart.length}`, ...clip(lejart.map((f) => line(f, { withDate: true })), 10));
    out.push({
      kulcs: mKey, tipus: 'reggeli',
      cim: ma.length ? `Mai lerakók (${ma.length}) – ${huDateLong(today)}` : `Ma nincs lerakó – ${huDateLong(today)}`,
      uzenet: lines.join('\n') || 'Nincs mai lerakás.',
      link: appUrl ? `${appUrl.replace(/[#/]+$/, '')}/#/napok` : '',
    });
  }

  // 3) esti összesítő a holnapi lerakókról (szombaton vasárnap + hétfő, mert vasárnap nincs futás)
  const eKey = `este:${today}`;
  if (lp.time >= cfg.estiOsszesito && lp.time < '23:30' && !sent[eKey]) {
    const days = [addDays(today, 1)];
    if (weekday(days[0]) === 7) days.push(addDays(today, 2));
    const holnap = aktiv.filter((f) => days.includes(f.src.lerakas.datum) && f.statusz !== 'lerakva')
      .sort((a, b) => a.src.lerakas.datum.localeCompare(b.src.lerakas.datum) || sortByTime(a, b));
    const label = days.length > 1 ? 'vasárnap és hétfő' : 'holnap';
    out.push({
      kulcs: eKey, tipus: 'esti',
      cim: holnap.length ? `Ezekre nézz rá ${label} (${holnap.length})` : `${label[0].toUpperCase() + label.slice(1)} nincs lerakó`,
      uzenet: clip(holnap.map((f) => line(f, { withDate: days.length > 1 }))).join('\n') || 'Nincs teendő.',
      link: appUrl ? `${appUrl.replace(/[#/]+$/, '')}/#/napok` : '',
    });
  }
  return out;
}

/** 45 napnál régebbi küldési bejegyzések törlése. */
export function pruneSent(sent, now = new Date()) {
  const limit = new Date(now.getTime() - 45 * 86400e3).toISOString();
  return Object.fromEntries(Object.entries(sent).filter(([, v]) => (v?.at || '') >= limit));
}
