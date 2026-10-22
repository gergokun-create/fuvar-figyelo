// Minta-Excel/CSV fájlok előállítása a tesztekhez és a kipróbáláshoz: npm run samples
import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../samples/', import.meta.url));
mkdirSync(dir, { recursive: true });

const serial = (iso, time) => {
  const [y, m, d] = iso.split('-').map(Number);
  let s = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  if (time) { const [h, mi] = time.split(':').map(Number); s += (h * 60 + mi) / 1440; }
  return s;
};

function sheet(aoa, { dateCols = [], dateTimeCols = [], timeCols = [], merges = [], from = 0 } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = from; r < aoa.length; r++) {
    for (const c of dateCols) { const a = XLSX.utils.encode_cell({ r, c }); if (typeof ws[a]?.v === 'number') ws[a].z = 'yyyy.mm.dd'; }
    for (const c of dateTimeCols) { const a = XLSX.utils.encode_cell({ r, c }); if (typeof ws[a]?.v === 'number') ws[a].z = 'yyyy.mm.dd hh:mm'; }
    for (const c of timeCols) { const a = XLSX.utils.encode_cell({ r, c }); if (typeof ws[a]?.v === 'number') ws[a].z = 'hh:mm'; }
  }
  ws['!merges'] = merges.map(([sr, sc, er, ec]) => ({ s: { r: sr, c: sc }, e: { r: er, c: ec } }));
  return ws;
}

function save(name, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [n, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, n);
  writeFileSync(dir + name, XLSX.write(wb, { type: 'buffer', bookType: name.endsWith('.xls') ? 'biff8' : 'xlsx' }));
  console.log('kész:', name);
}

// 1) Magyar fejlécek, címsor a fejléc fölött, Excel sorszám-dátumok, egyesített fuvarozó-cella,
//    üres sor és összesítő sor; plusz egy második, lényegtelen munkalap.
const H1 = ['Megbízásszám', 'Rendszám (vontató/pótkocsi)', 'Fuvarozó', 'Megbízó', 'Felrakás dátuma', 'Felrakó',
  'Lerakás dátuma', 'Lerakás ideje', 'Lerakó'];
const rows1 = [
  ['NH Cargo – heti fuvarlista', null, null, null, null, null, null, null, null],
  ['Készült: 2026.10.21.', null, null, null, null, null, null, null, null],
  [],
  H1,
  ['M-26-1001', 'ABC-123 / XYZ-987', 'Gyors Kft.', 'Alfa Zrt.', serial('2026-10-20'), 'HU-2040 Budaörs', serial('2026-10-22'), '08:00-12:00', 'DE-80331 München'],
  ['M-26-1002', 'RTX 456', null, 'Béta Kft.', serial('2026-10-21'), 'HU-9027 Győr', serial('2026-10-22', '14:30'), null, 'AT-1100 Wien'],
  ['M-26-1003', 'KLM-789', 'Trans Bt.', 'Alfa Zrt.', serial('2026-10-21'), 'HU-1117 Budapest', serial('2026-10-23'), serial('2026-10-23', '09:00') % 1, 'IT-20121 Milano'],
  [],
  ['M-26-1004', 'AA BB-123', 'Trans Bt.', 'Gamma Kft.', serial('2026-10-19'), 'HU-6000 Kecskemét', serial('2026-10-21'), null, 'SK-81101 Bratislava'],
  ['M-26-1005', 'PQR-321', 'Gyors Kft.', 'Delta Zrt.', serial('2026-10-22'), 'HU-4025 Debrecen', serial('2026-10-26'), '06:00-10:00', 'PL-00-001 Warszawa'],
  ['M-26-1006', 'NOP-555', 'Gyors Kft.', 'Béta Kft.', serial('2026-10-22'), 'HU-7621 Pécs', 'holnapután', null, 'HR-10000 Zagreb'],
  [],
  ['Összesen: 6 fuvar', null, null, null, null, null, null, null, null],
];
save('minta-1-alap.xlsx', [
  ['Fuvarok', sheet(rows1, { dateCols: [4], dateTimeCols: [6], timeCols: [7], from: 4,
    merges: [[0, 0, 0, 8], [4, 2, 5, 2]] })],
  ['Jegyzetek', sheet([['Ide jönnek a jegyzetek'], ['Valami'], [42]])],
]);

// 2) Az 1. lista újrafeltöltve: 1002 lerakása új napra került, 1004 kikerült, 1007 új,
//    1003-nál más a lerakó, a 1006 javítva.
const rows2 = [
  H1,
  ['M-26-1001', 'ABC-123 / XYZ-987', 'Gyors Kft.', 'Alfa Zrt.', serial('2026-10-20'), 'HU-2040 Budaörs', serial('2026-10-22'), '08:00-12:00', 'DE-80331 München'],
  ['M-26-1002', 'RTX 456', 'Gyors Kft.', 'Béta Kft.', serial('2026-10-21'), 'HU-9027 Győr', serial('2026-10-24', '10:00'), null, 'AT-1100 Wien'],
  ['M-26-1003', 'KLM-789', 'Trans Bt.', 'Alfa Zrt.', serial('2026-10-21'), 'HU-1117 Budapest', serial('2026-10-23'), serial('2026-10-23', '09:00') % 1, 'IT-37121 Verona'],
  ['M-26-1005', 'PQR-321', 'Gyors Kft.', 'Delta Zrt.', serial('2026-10-22'), 'HU-4025 Debrecen', serial('2026-10-26'), '06:00-10:00', 'PL-00-001 Warszawa'],
  ['M-26-1006', 'NOP-555', 'Gyors Kft.', 'Béta Kft.', serial('2026-10-22'), 'HU-7621 Pécs', serial('2026-10-24'), null, 'HR-10000 Zagreb'],
  ['M-26-1007', 'XYZ-111', 'Új Fuvar Kft.', 'Epszilon Kft.', serial('2026-10-22'), 'HU-8000 Székesfehérvár', serial('2026-10-23'), '13:00-16:00', 'CZ-60200 Brno'],
];
save('minta-1-ujra.xlsx', [['Fuvarok', sheet(rows2, { dateCols: [4], dateTimeCols: [6], timeCols: [7], from: 1 })]]);

// 3) Angol fejlécek, más oszlopsorrend, szöveges dátumok többféle alakban.
const rows3 = [
  ['Truck', 'Customer', 'Carrier', 'Order no.', 'Loading', 'Unloading', 'Delivery time', 'Destination city', 'Destination country'],
  ['WE 123AB', 'Omega GmbH', 'Fast Lines', 'ORD-7781', '2026.10.21', '22.10.2026', '08:00-12:00', 'Lyon', 'FR'],
  ['WE-456CD', 'Omega GmbH', 'Fast Lines', 'ORD-7782', '2026. 10. 21.', '10/23/2026', '14:00', 'Paris', 'FR'],
  ['B AB 1234', 'Sigma AG', 'Rollers', 'ORD-7783', '2026-10-22', '2026-10-24 09:30', null, 'Berlin', 'DE'],
  ['SN-KL-77', 'Sigma AG', 'Rollers', 'ORD-7784', '21.10.2026 16:00', '2026. 10. 26. 07:00-09:00', null, 'Dresden', 'DE'],
];
save('minta-2-angol.xlsx', [['Orders', sheet(rows3)]]);

// 4) Kétsoros fejléc egyesített "Felrakó" / "Lerakó" csoportcímmel, megbízásszám nélkül.
const rows4 = [
  ['Rendszám', 'Alvállalkozó', 'Ügyfél', 'Felrakó', null, null, 'Lerakó', null, null],
  [null, null, null, 'Dátum', 'Ország', 'Város', 'Dátum', 'Ország', 'Város'],
  ['MNB-001', 'Kelet Trans', 'Zeta Kft.', serial('2026-10-21'), 'HU', 'Szeged', serial('2026-10-22'), 'RO', 'Arad'],
  ['MNB-002', 'Kelet Trans', 'Zeta Kft.', serial('2026-10-22'), 'HU', 'Szeged', serial('2026-10-23'), 'RS', 'Novi Sad'],
  ['MNB-003', 'Nyugat Log', 'Éta Bt.', serial('2026-10-22'), 'HU', 'Sopron', serial('2026-10-27'), 'AT', 'Graz'],
];
save('minta-3-ketsoros.xlsx', [['Lista', sheet(rows4, { dateCols: [3, 6], from: 2,
  merges: [[0, 0, 1, 0], [0, 1, 1, 1], [0, 2, 1, 2], [0, 3, 0, 5], [0, 6, 0, 8]] })]]);

// 5) Régi .xls formátum ugyanazzal a tartalommal, mint az angol minta.
save('minta-2-angol.xls', [['Orders', sheet(rows3)]]);

// 6) CSV pontosvesszővel, Windows-1250 kódolással (magyar Excel-export), a téli
//    időszámításra váltás (2026.10.25.) körüli időpontokkal.
const csv = [
  'Rendelésszám;Plate;Partner;Fuvarozó;Felrakás;Lerakás dátuma;Lerakó város',
  'DST-1;DST-001;Őrség Kft.;Hétvége Bt.;2026.10.24 22:00;2026.10.25 02:30;Győr',
  'DST-2;DST-002;Őrség Kft.;Hétvége Bt.;2026.10.25;2026.10.26 08:00;Pécs',
  'DST-3;DST-003;Árvíztűrő Zrt.;Tükörfúró Kft.;2026.03.28;2026.03.29 02:30;Szolnok',
].join('\r\n');
writeFileSync(dir + 'minta-4-dst-win1250.csv', encode1250(csv));
console.log('kész: minta-4-dst-win1250.csv');

// 7) Beillesztéshez: Excelből másolt cellák (tabulátorral tagolva)
const tsv = [
  ['Ref', 'Rendszám', 'Carrier', 'Ügyfél', 'Loading', 'Delivery date', 'Lerakó'],
  ['P-1', 'TSV-101', 'Paste Kft.', 'Kappa Zrt.', '2026.10.22', '2026.10.23 08:00-10:00', 'Budapest'],
  ['P-2', 'TSV-102', 'Paste Kft.', 'Kappa Zrt.', '2026.10.22', '2026.10.27', 'Szeged'],
].map((r) => r.join('\t')).join('\n');
writeFileSync(dir + 'minta-5-beillesztes.txt', tsv);
console.log('kész: minta-5-beillesztes.txt');

function encode1250(s) {
  const map = { 'á': 0xe1, 'é': 0xe9, 'í': 0xed, 'ó': 0xf3, 'ö': 0xf6, 'ő': 0xf5, 'ú': 0xfa, 'ü': 0xfc, 'ű': 0xfb,
    'Á': 0xc1, 'É': 0xc9, 'Í': 0xcd, 'Ó': 0xd3, 'Ö': 0xd6, 'Ő': 0xd5, 'Ú': 0xda, 'Ü': 0xdc, 'Ű': 0xdb };
  return Uint8Array.from([...s].map((ch) => map[ch] ?? ch.charCodeAt(0)));
}
