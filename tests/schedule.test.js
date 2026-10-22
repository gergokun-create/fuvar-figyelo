import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDue, quickTimes, nextReminder } from '../js/core/schedule.js';
import { createClient } from '../js/core/github.js';
import { run } from '../scheduler/run.mjs';

const stop = (datum, extra = {}) => ({ datum, ido: null, idoIg: null, hely: '', orszag: '', irsz: '', varos: 'Wien', ...extra });
const trip = (id, lerakas, extra = {}) => ({
  id, kulcs: 'M:' + id, statusz: 'tervezett', archivalt: false, naplo: [], emlekeztetok: [],
  src: { megbizasszam: id, rendszam: `R-${id}`, rendszamNorm: `R${id}`, fuvarozo: 'F', megbizo: `Megbízó ${id}`, megjegyzes: '',
    felrakas: stop('2026-10-20'), lerakas: stop(lerakas) },
  ...extra,
});
const dataOf = (...trips) => ({ verzio: 1, fuvarok: Object.fromEntries(trips.map((t) => [t.id, t])), feltoltesek: [] });
const kinds = (due) => due.map((d) => d.kulcs);

test('gyorsgombok: +óra valódi eltelt idő, holnap 8:00 helyi idő (DST-váltáskor is)', () => {
  // szombat 2026.10.24. 20:00 nyári idő; másnap (vasárnap) már téli idő
  const now = new Date('2026-10-24T18:00:00Z');
  const q = Object.fromEntries(quickTimes(now).map((x) => [x.cimke, x.at]));
  assert.equal(q['+1 óra'], '2026-10-24T19:00:00.000Z');
  assert.equal(q['+4 óra'], '2026-10-24T22:00:00.000Z');
  assert.equal(q['holnap 8:00'], '2026-10-25T07:00:00.000Z', 'téli időben 8:00 = 07:00 UTC');
  // tavaszi váltás: 2026.03.28. -> 29. 8:00 nyári idő = 06:00 UTC
  assert.equal(quickTimes(new Date('2026-03-28T12:00:00Z'))[3].at, '2026-03-29T06:00:00.000Z');
});

test('esedékes emlékeztető, kimaradt futás pótlása, lerakott/archivált nem kap', () => {
  const a = trip('A', '2026-10-23', { emlekeztetok: [{ id: 'e1', at: '2026-10-22T08:00:00Z', jegyzet: 'hívd fel' }, { id: 'e2', at: '2026-10-22T12:00:00Z', jegyzet: '' }] });
  const b = trip('B', '2026-10-23', { statusz: 'lerakva', emlekeztetok: [{ id: 'e3', at: '2026-10-22T08:00:00Z' }] });
  const c = trip('C', '2026-10-23', { archivalt: true, emlekeztetok: [{ id: 'e4', at: '2026-10-22T08:00:00Z' }] });
  const d = trip('D', '2026-10-23', { emlekeztetok: [{ id: 'e5', at: '2026-10-22T08:00:00Z', lemondva: '2026-10-22T07:00:00Z' }] });
  // 11:10 helyi idő (09:10 UTC): e1 esedékes (1 óra 10 perc késéssel), e2 még nem
  const due = computeDue({ data: dataOf(a, b, c, d), now: new Date('2026-10-22T09:10:00Z'), settings: { reggeliOsszesito: '23:00', estiOsszesito: '23:00' }, appUrl: 'https://x.github.io/fuvar-figyelo/' });
  assert.deepEqual(kinds(due), ['e:A:e1']);
  assert.equal(due[0].cim, 'Ránézés: R-A');
  assert.match(due[0].uzenet, /Megbízó A – hívd fel/);
  assert.match(due[0].uzenet, /késve, esedékes volt: 10:00/);
  assert.equal(due[0].link, 'https://x.github.io/fuvar-figyelo/#/fuvar/A');
  // már elküldött nem megy ki újra
  assert.deepEqual(computeDue({ data: dataOf(a), sent: { 'e:A:e1': { at: 'x' } }, now: new Date('2026-10-22T09:10:00Z'), settings: { reggeliOsszesito: '23:00', estiOsszesito: '23:00' } }), []);
});

test('reggeli összesítő 7:30-tól, téli és nyári időben is helyi idő szerint', () => {
  const data = dataOf(trip('A', '2026-10-22'), trip('B', '2026-10-21'), trip('C', '2026-10-23'));
  // nyári idő: 7:20 helyi = 05:20 UTC -> még nem
  assert.deepEqual(kinds(computeDue({ data, now: new Date('2026-10-22T05:20:00Z') })), []);
  // 7:40 helyi = 05:40 UTC -> igen
  const due = computeDue({ data, now: new Date('2026-10-22T05:40:00Z') });
  assert.deepEqual(kinds(due), ['reggel:2026-10-22']);
  assert.match(due[0].cim, /Mai lerakók \(1\)/);
  assert.match(due[0].uzenet, /Lejárt, de nincs lerakva: 1/);
  // téli idő (2026.10.26.): 7:40 helyi = 06:40 UTC; 05:40 UTC = 6:40 helyi -> még nem
  const w = dataOf(trip('A', '2026-10-26'));
  assert.deepEqual(kinds(computeDue({ data: w, now: new Date('2026-10-26T05:40:00Z') })), []);
  assert.deepEqual(kinds(computeDue({ data: w, now: new Date('2026-10-26T06:40:00Z') })), ['reggel:2026-10-26']);
});

test('esti összesítő a holnapi lerakókról; szombaton vasárnap + hétfő', () => {
  const data = dataOf(trip('A', '2026-10-23'), trip('B', '2026-10-23', { statusz: 'lerakva' }), trip('C', '2026-10-26'), trip('D', '2026-10-25'));
  const thu = computeDue({ data, now: new Date('2026-10-22T15:05:00Z'), sent: { 'reggel:2026-10-22': {} } });
  assert.deepEqual(kinds(thu), ['este:2026-10-22']);
  assert.match(thu[0].cim, /Ezekre nézz rá holnap \(1\)/);
  // szombat 17:05 nyári idő
  const sat = computeDue({ data, now: new Date('2026-10-24T15:05:00Z'), sent: { 'reggel:2026-10-24': {} } });
  assert.match(sat[0].cim, /vasárnap és hétfő \(2\)/);
  // beállítható időpont
  assert.deepEqual(kinds(computeDue({ data, now: new Date('2026-10-22T15:05:00Z'), settings: { estiOsszesito: '18:00' }, sent: { 'reggel:2026-10-22': {} } })), []);
});

test('következő ránézés: lerakott fuvarnál nincs', () => {
  const f = trip('A', '2026-10-23', { emlekeztetok: [{ id: 'b', at: '2026-10-22T12:00:00Z' }, { id: 'a', at: '2026-10-22T10:00:00Z' }] });
  assert.equal(nextReminder(f).id, 'a');
  assert.equal(nextReminder(f, { 'e:A:a': {} }).id, 'b');
  assert.equal(nextReminder({ ...f, statusz: 'lerakva' }), null);
});

// --- ütemező futás memóriabeli GitHub-bal ---

function fakeRepo(files) {
  const store = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { data: v, sha: 's0' }]));
  let n = 0;
  const client = {
    store,
    async readJson(path) { const f = store[path]; return f ? { data: structuredClone(f.data), sha: f.sha } : { data: null, sha: null }; },
    async update(path, fn, { initial } = {}) {
      let cur = initial || (await this.readJson(path));
      for (;;) {
        const next = await fn(cur.data ? structuredClone(cur.data) : null);
        const real = store[path];
        if ((real?.sha || null) !== cur.sha) { cur = await this.readJson(path); continue; } // 409
        store[path] = { data: next, sha: 's' + ++n };
        return { data: next, sha: store[path].sha, written: true };
      }
    },
  };
  return client;
}

test('ütemező: lefoglal, küld, véglegesít; második futás semmit nem küld újra', async () => {
  const data = dataOf(trip('A', '2026-10-23', { emlekeztetok: [{ id: 'e1', at: '2026-10-22T08:00:00Z', jegyzet: 'x' }] }));
  const client = fakeRepo({ 'data/fuvarok.json': data, 'data/beallitasok.json': { reggeliOsszesito: '07:30', estiOsszesito: '17:00' } });
  const sent = [];
  const notifiers = [{ name: 'fake', send: async (m) => { sent.push(m.kulcs); } }];
  const logs = [];
  const now = new Date('2026-10-22T08:05:00Z');
  await run({ env: { APP_URL: 'https://a/' }, now, client, notifiers, log: (s) => logs.push(s) });
  assert.deepEqual(sent.sort(), ['e:A:e1', 'reggel:2026-10-22']);
  assert.equal(client.store['state/elkuldve.json'].data.elkuldve['e:A:e1'].allapot, 'elkuldve');
  await run({ env: {}, now: new Date('2026-10-22T08:25:00Z'), client, notifiers, log: () => {} });
  assert.equal(sent.length, 2, 'nem küld kétszer');
  // a napló nem tartalmaz fuvaradatot
  assert.ok(logs.every((l) => !/R-A|Megbízó/.test(l)), logs.join('\n'));
});

test('ütemező: sikertelen küldés foglalása törlődik, a következő futás újrapróbálja', async () => {
  const data = dataOf(trip('A', '2026-10-23', { emlekeztetok: [{ id: 'e1', at: '2026-10-22T08:00:00Z' }] }));
  const client = fakeRepo({ 'data/fuvarok.json': data, 'data/beallitasok.json': { reggeliOsszesito: '23:00', estiOsszesito: '23:00' } });
  let fail = true; const sent = [];
  const notifiers = [{ name: 'fake', send: async (m) => { if (fail) throw new Error('HTTP 500'); sent.push(m.kulcs); } }];
  const r1 = await run({ env: {}, now: new Date('2026-10-22T08:05:00Z'), client, notifiers, log: () => {} });
  assert.equal(r1.failed, 1);
  assert.equal(client.store['state/elkuldve.json'].data.elkuldve['e:A:e1'], undefined);
  fail = false;
  await run({ env: {}, now: new Date('2026-10-22T08:25:00Z'), client, notifiers, log: () => {} });
  assert.deepEqual(sent, ['e:A:e1']);
});

test('GitHub kliens: 409 ütközésnél újraolvas, újra alkalmazza a módosítást és újraír', async () => {
  let remote = { data: { n: 1, items: ['a'] }, sha: 'sha1' };
  let puts = 0;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  const fetchImpl = async (url, opts) => {
    const res = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
    if (opts.method === 'GET') return res(200, { content: b64(remote.data), sha: remote.sha });
    const body = JSON.parse(opts.body);
    puts++;
    if (puts === 1) {
      // közben valaki más írt
      remote = { data: { n: 1, items: ['a', 'masik'] }, sha: 'sha2' };
      return res(409, { message: 'is at sha2 but expected sha1' });
    }
    if (body.sha !== remote.sha) return res(409, { message: 'conflict' });
    remote = { data: JSON.parse(Buffer.from(body.content, 'base64').toString()), sha: 'sha3' };
    return res(200, { content: { sha: 'sha3' } });
  };
  const c = createClient({ owner: 'o', repo: 'r', token: 't', fetchImpl });
  const out = await c.update('data/x.json', (d) => { d.items.push('enyem'); return d; });
  assert.equal(puts, 2);
  assert.deepEqual(remote.data.items, ['a', 'masik', 'enyem'], 'mindkét módosítás megmarad');
  assert.equal(out.sha, 'sha3');
});

// --- ntfy időzítés és visszavonás ---
import { planNtfy } from '../js/core/schedule.js';
import { seqFor } from '../js/core/ntfy.js';

test('planNtfy: 3 napon belüli ránézést beütemez, távolabbit és beütemezettet nem', () => {
  const now = new Date('2026-10-22T08:00:00Z');
  const f = trip('A', '2026-10-23', { emlekeztetok: [
    { id: 'e1', at: '2026-10-22T10:00:00Z' },                       // 2 óra múlva -> igen
    { id: 'e2', at: '2026-10-27T10:00:00Z' },                       // 5 nap múlva -> majd később
    { id: 'e3', at: '2026-10-22T11:00:00Z', ntfy: { seq: 'x' } },   // már beütemezve
    { id: 'e4', at: '2026-10-22T07:00:00Z' },                       // múltbeli -> computeDue pótolja
  ] });
  const p = planNtfy({ data: dataOf(f), now, settings: { reggeliOsszesito: '07:30', estiOsszesito: '17:00' } });
  const rem = p.publish.filter((x) => x.reminder);
  assert.deepEqual(rem.map((x) => x.emlId), ['e1']);
  assert.equal(rem[0].seq, seqFor('e:A:e1'));
  assert.equal(rem[0].at, '2026-10-22T10:00:00Z');
  assert.deepEqual(p.cancel, []);
  // múltbeli, be nem ütemezett: azonnali pótlás
  assert.ok(computeDue({ data: dataOf(f), now, summaries: false }).some((d) => d.kulcs === 'e:A:e4'));
  assert.ok(!computeDue({ data: dataOf(f), now: new Date('2026-10-22T12:00:00Z'), summaries: false }).some((d) => d.kulcs === 'e:A:e3'),
    'a beütemezettet az ntfy kézbesíti, nem küldjük újra');
});

test('planNtfy: lemondott, lerakott és archivált fuvar beütemezett ránézését visszavonja', () => {
  const now = new Date('2026-10-22T08:00:00Z');
  const sch = { ntfy: { seq: 's' } };
  const data = dataOf(
    trip('A', '2026-10-23', { emlekeztetok: [{ id: 'e1', at: '2026-10-22T12:00:00Z', torolve: 'x', ...sch }] }),
    trip('B', '2026-10-23', { statusz: 'lerakva', emlekeztetok: [{ id: 'e2', at: '2026-10-22T12:00:00Z', ...sch }] }),
    trip('C', '2026-10-23', { archivalt: true, emlekeztetok: [{ id: 'e3', at: '2026-10-22T12:00:00Z', lemondva: 'x', ...sch }] }),
    trip('D', '2026-10-23', { emlekeztetok: [{ id: 'e4', at: '2026-10-22T12:00:00Z', torolve: 'x', ...sch, ntfyVisszavonva: 'x' }] }),
    trip('E', '2026-10-23', { emlekeztetok: [{ id: 'e5', at: '2026-10-22T12:00:00Z', torolve: 'x' }] }), // sosem volt beütemezve
    trip('F', '2026-10-23', { emlekeztetok: [{ id: 'e6', at: '2026-10-22T06:00:00Z', torolve: 'x', ...sch }] }), // már kézbesült
  );
  // az ütemező által beütemezett is visszavonódik
  const data2 = dataOf(trip('G', '2026-10-23', { statusz: 'lerakva', emlekeztetok: [{ id: 'e7', at: '2026-10-22T12:00:00Z' }] }));
  const p = planNtfy({ data, now });
  assert.deepEqual(p.cancel.map((c) => c.kulcs).sort(), ['e:A:e1', 'e:B:e2', 'e:C:e3']);
  assert.ok(p.publish.every((x) => !x.reminder));
  const p2 = planNtfy({ data: data2, now, sent: { 'e:G:e7': { allapot: 'utemezve' } } });
  assert.deepEqual(p2.cancel.map((c) => c.seq), [seqFor('e:G:e7')]);
  assert.deepEqual(planNtfy({ data: data2, now, sent: { 'e:G:e7': { allapot: 'visszavonva' } } }).cancel, []);
});

test('planNtfy: összesítők a következő 3 napra, helyi idő szerint, vasárnap nélkül, DST-váltáson át', () => {
  // csütörtök 2026.10.22. 09:00 helyi; a vasárnapi (25.) váltás után 7:30 = 06:30 UTC
  const p = planNtfy({ data: dataOf(trip('A', '2026-10-23')), now: new Date('2026-10-22T07:00:00Z') });
  const s = Object.fromEntries(p.publish.filter((x) => !x.reminder).map((x) => [x.kulcs, x.at]));
  assert.deepEqual(Object.keys(s), ['este:2026-10-22', 'reggel:2026-10-23', 'este:2026-10-23', 'reggel:2026-10-24', 'este:2026-10-24']);
  assert.equal(s['este:2026-10-22'], '2026-10-22T15:00:00.000Z');
  assert.equal(s['reggel:2026-10-24'], '2026-10-24T05:30:00.000Z');
  const later = planNtfy({ data: dataOf(), now: new Date('2026-10-23T12:00:00Z') });
  const at = Object.fromEntries(later.publish.map((x) => [x.kulcs, x.at]));
  assert.equal(at['reggel:2026-10-26'], '2026-10-26T06:30:00.000Z', 'téli időben 7:30 = 06:30 UTC');
  assert.ok(!Object.keys(at).some((k) => k.endsWith('2026-10-25')), 'vasárnap nincs összesítő');
});

test('ütemező ntfy-jal: beütemez, visszavon, feljegyez; másodszor nem ütemez újra', async () => {
  const now = new Date('2026-10-22T05:30:00Z');
  const data = dataOf(
    trip('A', '2026-10-23', { emlekeztetok: [{ id: 'e1', at: '2026-10-24T09:00:00Z' }] }),
    trip('B', '2026-10-23', { statusz: 'lerakva', emlekeztetok: [{ id: 'e2', at: '2026-10-22T09:00:00Z', ntfy: { seq: 'x' } }] }),
  );
  const client = fakeRepo({ 'data/fuvarok.json': data, 'data/beallitasok.json': {} });
  const calls = [];
  const ntfy = { name: 'ntfy', publish: async (m) => calls.push(['pub', m.kulcs]), cancel: async (s) => calls.push(['del', s]), send: async (m) => calls.push(['send', m.kulcs]) };
  const r = await run({ env: {}, now, client, notifiers: [ntfy], log: () => {} });
  assert.equal(r.scheduled, 1);
  assert.equal(r.cancelled, 1);
  assert.ok(calls.some((c) => c[0] === 'pub' && c[1] === 'e:A:e1'));
  assert.ok(calls.some((c) => c[0] === 'del' && c[1] === seqFor('e:B:e2')));
  assert.ok(!calls.some((c) => c[0] === 'send'), 'az ntfy-ra nem megy közvetlen összesítő');
  const st = client.store['state/elkuldve.json'].data.elkuldve;
  assert.equal(st['e:A:e1'].allapot, 'utemezve');
  assert.equal(st['e:B:e2'].allapot, 'visszavonva');
  calls.length = 0;
  const r2 = await run({ env: {}, now: new Date('2026-10-22T15:00:00Z'), client, notifiers: [ntfy], log: () => {} });
  assert.equal(r2.scheduled, 0);
  assert.equal(r2.cancelled, 0);
});
