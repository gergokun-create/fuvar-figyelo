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
