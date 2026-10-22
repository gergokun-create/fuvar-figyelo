// Ütemező: a privát adat-repó GitHub Actions workflow-ja futtatja naponta néhányszor.
// Az emlékeztetőket és összesítőket alapvetően az ntfy kézbesíti időzítve (az app ütemezi be őket);
// ez a futás biztonsági háló:
//  - beütemezi, amit az app még nem tudott (pl. 3 napnál távolabbi ránézés, frissített összesítők);
//  - visszavonja a lemondott / lerakott / archivált fuvarok még ki nem kézbesített emlékeztetőit;
//  - azonnal elküldi a lekésett, sehová be nem ütemezett emlékeztetőket;
//  - Telegramra (ami nem tud időzíteni) elküldi az esedékes összesítőket.
// Idempotens: a közvetlen küldéseket küldés előtt lefoglalja, az ntfy-időzítés sequence ID-val lecserélhető.
// A naplóba nem ír fuvaradatot.

import { createClient } from '../js/core/github.js';
import { computeDue, planNtfy, pruneSent } from '../js/core/schedule.js';
import { localParts } from '../js/core/tz.js';
import { fromEnv, sendAll } from './notifiers.mjs';

export const FILES = { data: 'data/fuvarok.json', settings: 'data/beallitasok.json', sent: 'state/elkuldve.json' };

export async function run({ env = process.env, now = new Date(), client, notifiers, log = console.log } = {}) {
  if (!client) {
    const [owner, repo] = (env.GITHUB_REPOSITORY || '').split('/');
    if (!owner || !repo || !env.GITHUB_TOKEN) throw new Error('GITHUB_REPOSITORY és GITHUB_TOKEN szükséges.');
    client = createClient({ owner, repo, branch: env.DATA_BRANCH || 'main', token: env.GITHUB_TOKEN });
  }
  notifiers ||= fromEnv(env);
  if (!notifiers.length) throw new Error('Nincs beállított értesítő: add meg az NTFY_TOPIC vagy a TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID secretet.');
  const ntfy = notifiers.find((n) => n.publish && n.cancel) || null;
  const direct = notifiers.filter((n) => n !== ntfy); // időzítést nem ismerő értesítők
  const lp = localParts(now);
  log(`Futás: ${lp.date} ${lp.time} (Budapest), értesítők: ${notifiers.map((n) => n.name).join(', ')}`);

  if (env.TESZT === 'true') {
    const r = await sendAll(notifiers, {
      tipus: 'teszt', cim: 'Fuvar Figyelő – teszt',
      uzenet: `A push értesítés működik. (${lp.date} ${lp.time})`, link: env.APP_URL || '',
    });
    log(r.ok ? 'Teszt értesítés elküldve.' : `Teszt értesítés sikertelen: ${r.errors.join('; ')}`);
    if (!r.ok) throw new Error('A teszt értesítés nem ment ki.');
  }

  const [{ data }, { data: settings }, sentFile] = await Promise.all([
    client.readJson(FILES.data), client.readJson(FILES.settings), client.readJson(FILES.sent),
  ]);
  const sent0 = sentFile.data?.elkuldve || {};
  const appUrl = env.APP_URL || '';
  const at = now.toISOString();
  const marks = {}; // kulcs -> új állapot az elkuldve.json-ban

  // 1) ntfy: időzítés és visszavonás
  let scheduled = 0, cancelled = 0, summaries = 0;
  if (ntfy) {
    const plan = planNtfy({ data, settings: settings || {}, sent: sent0, now, appUrl });
    for (const c of plan.cancel) {
      try { await ntfy.cancel(c.seq); marks[c.kulcs] = { at, allapot: 'visszavonva' }; cancelled++; }
      catch (e) { log(`Hiba visszavonáskor: ${e.message}`); }
    }
    for (const p of plan.publish) {
      try {
        await ntfy.publish(p);
        if (p.reminder) { marks[p.kulcs] = { at, allapot: 'utemezve', ido: p.at }; scheduled++; } else summaries++;
      } catch (e) { log(`Hiba időzítéskor (${p.tipus}): ${e.message}`); }
    }
  }

  // 2) közvetlen küldés: lekésett emlékeztetők mindenhová, összesítők csak a nem időzítő értesítőkre
  const dueReminders = computeDue({ data, settings: settings || {}, sent: { ...sent0, ...marks }, now, appUrl, summaries: false });
  const dueSummaries = direct.length
    ? computeDue({ data, settings: settings || {}, sent: { ...sent0, ...marks }, now, appUrl }).filter((d) => d.tipus !== 'emlekezteto')
    : [];
  const due = [...dueReminders.map((d) => ({ d, to: notifiers })), ...dueSummaries.map((d) => ({ d, to: direct }))];

  const claim = `${env.GITHUB_RUN_ID || 'helyi'}-${now.getTime()}`;
  let state = sentFile;
  if (due.length || Object.keys(marks).length) {
    // lefoglalás + az időzítések feljegyzése
    state = await client.update(FILES.sent, (s) => {
      s ||= { verzio: 1, elkuldve: {} };
      s.elkuldve = pruneSent(s.elkuldve || {}, now);
      Object.assign(s.elkuldve, marks);
      for (const { d } of due) if (!s.elkuldve[d.kulcs]) s.elkuldve[d.kulcs] = { at, allapot: 'folyamatban', tipus: d.tipus, futas: claim };
      return s;
    }, { message: 'Ütemező: időzítések és lefoglalások', initial: sentFile });
  }
  const mine = due.filter(({ d }) => state.data?.elkuldve?.[d.kulcs]?.futas === claim);

  const results = [];
  for (const { d, to } of mine) {
    const r = await sendAll(to, d);
    results.push({ kulcs: d.kulcs, tipus: d.tipus, ok: r.ok });
    if (r.errors.length) log(`Hiba (${d.tipus}): ${r.errors.join('; ')}`);
  }
  if (results.length) {
    await client.update(FILES.sent, (s) => {
      s ||= { verzio: 1, elkuldve: {} };
      for (const r of results) {
        if (s.elkuldve[r.kulcs]?.futas !== claim) continue;
        if (r.ok) s.elkuldve[r.kulcs] = { ...s.elkuldve[r.kulcs], allapot: 'elkuldve', elkuldve: new Date().toISOString() };
        else delete s.elkuldve[r.kulcs];
      }
      return s;
    }, { message: 'Ütemező: elküldött értesítések', initial: state });
  }

  const failed = results.filter((r) => !r.ok).length;
  log(`ntfy: ${scheduled} emlékeztető beütemezve, ${summaries} összesítő frissítve, ${cancelled} visszavonva; `
    + `azonnal elküldve: ${results.length - failed}, sikertelen: ${failed}.`);
  return { sent: results.length - failed, failed, scheduled, cancelled, summaries };
}

// közvetlen futtatás: node scheduler/run.mjs
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scheduler/run.mjs')) {
  run().then((r) => { if (r.failed) process.exitCode = 1; }).catch((e) => {
    console.error('Hiba:', e.status ? `GitHub ${e.status}` : '', e.message);
    process.exitCode = 1;
  });
}
