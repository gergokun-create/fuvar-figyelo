// Ütemező: a privát adat-repó GitHub Actions workflow-ja futtatja kb. 15–30 percenként.
// Budapest helyi ideje szerint eldönti, mi esedékes, elküldi, és feljegyzi a state/elkuldve.json-ba.
// Idempotens: minden értesítést küldés ELŐTT lefoglal (így semmi nem megy ki kétszer), a kimaradt
// futások esedékes elemeit pedig a következő futás pótolja. A naplóba nem ír fuvaradatot.

import { createClient } from '../js/core/github.js';
import { computeDue, pruneSent } from '../js/core/schedule.js';
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
  const due = computeDue({ data, settings: settings || {}, sent: sentFile.data?.elkuldve || {}, now, appUrl: env.APP_URL || '' });
  if (!due.length) { log('Nincs esedékes értesítés.'); return { sent: 0, failed: 0 }; }

  // 1) lefoglalás: csak az kerül küldésre, amit ez a futás foglalt le
  const claim = `${env.GITHUB_RUN_ID || 'helyi'}-${now.getTime()}`;
  const at = now.toISOString();
  const claimed = await client.update(FILES.sent, (s) => {
    s ||= { verzio: 1, elkuldve: {} };
    s.elkuldve = pruneSent(s.elkuldve || {}, now);
    for (const d of due) if (!s.elkuldve[d.kulcs]) s.elkuldve[d.kulcs] = { at, allapot: 'folyamatban', tipus: d.tipus, futas: claim };
    return s;
  }, { message: 'Ütemező: értesítések lefoglalása', initial: sentFile });
  const mine = due.filter((d) => claimed.data.elkuldve[d.kulcs]?.futas === claim);

  // 2) küldés
  const results = [];
  for (const d of mine) {
    const r = await sendAll(notifiers, d);
    results.push({ kulcs: d.kulcs, tipus: d.tipus, ok: r.ok });
    if (r.errors.length) log(`Hiba (${d.tipus}): ${r.errors.join('; ')}`);
  }

  // 3) véglegesítés: a sikeresek "elkuldve", a sikertelenek foglalása törlődik (a következő futás újrapróbálja)
  await client.update(FILES.sent, (s) => {
    s ||= { verzio: 1, elkuldve: {} };
    for (const r of results) {
      if (s.elkuldve[r.kulcs]?.futas !== claim) continue;
      if (r.ok) s.elkuldve[r.kulcs] = { ...s.elkuldve[r.kulcs], allapot: 'elkuldve', elkuldve: new Date().toISOString() };
      else delete s.elkuldve[r.kulcs];
    }
    return s;
  }, { message: 'Ütemező: elküldött értesítések', initial: claimed });

  const by = {};
  for (const r of results) if (r.ok) by[r.tipus] = (by[r.tipus] || 0) + 1;
  const failed = results.filter((r) => !r.ok).length;
  log(`Elküldve: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ') || '0'}; sikertelen: ${failed}.`);
  return { sent: results.length - failed, failed };
}

// közvetlen futtatás: node scheduler/run.mjs
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scheduler/run.mjs')) {
  run().then((r) => { if (r.failed) process.exitCode = 1; }).catch((e) => {
    console.error('Hiba:', e.status ? `GitHub ${e.status}` : '', e.message);
    process.exitCode = 1;
  });
}
