// Feltöltés: fájl / beillesztés -> munkalap és formátum -> hozzárendelés -> előnézet -> mentés.
import { h, mount, select, toast } from '../ui.js';
import { state, mutate } from '../store.js';
import { readWorkbook, readPasted } from '../core/tabular.js';
import { rankSheets, detect, FIELDS, makeFormat } from '../core/detect.js';
import { buildRecords } from '../core/records.js';
import { diff, applyDiff } from '../core/sync.js';
import { randomId, isBlank, clean } from '../core/text.js';
import { stopText, fieldValue } from '../format.js';
import { parseDateCell, parseTimeCell } from '../core/dates.js';
import { huDate } from '../core/tz.js';

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
let XLSX = null;
async function loadXlsx() {
  if (!XLSX) XLSX = await import(SHEETJS_URL);
  return XLSX;
}

const SOURCE_LABEL = { fejlec: 'fejléc', gyenge: 'bizonytalan', tartalom: 'tartalom alapján', mentett: 'mentett formátum' };

/** A folyamatban lévő feltöltés állapota (oldalváltáskor megmarad). */
let up = null;

function colName(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function handleFile(file) {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const isCsv = /\.(csv|txt|tsv)$/i.test(file.name);
    if (!isCsv && !/\.(xlsx|xlsm|xls)$/i.test(file.name)) throw new Error('Csak .xlsx, .xls vagy .csv fájl tölthető fel.');
    const X = isCsv ? null : await loadXlsx();
    start(file.name, readWorkbook(X, buf, file.name));
  } catch (e) {
    toast('Nem sikerült beolvasni: ' + (e.message || e), 'error');
  }
}

function handlePaste(text) {
  if (!text || !text.trim()) { toast('Üres a beillesztett szöveg.', 'error'); return; }
  start('Beillesztett cellák', readPasted(text));
}

function start(fileName, wb) {
  const ranked = rankSheets(wb.sheets, state.formats.formatumok);
  up = { fileName, wb, ranked, mode: 'teljes', saveFormat: true, mappingEdited: false, twoRow: false };
  setSheet(ranked[0].index);
}

function setSheet(index, forceHeader) {
  up.sheetIndex = index;
  const rows = up.wb.sheets[index].rows;
  up.detection = detect(rows, state.formats.formatumok, forceHeader ? { forceHeader } : {});
  up.mapping = { ...up.detection.mapping };
  up.mappingEdited = !!forceHeader;
  up.step = up.detection.savedFormat && !forceHeader ? 'preview' : 'map';
  up.formatName = up.detection.savedFormat?.nev || defaultFormatName();
  rebuild();
}

function defaultFormatName() {
  const base = up.fileName.replace(/\.(xlsx|xls|xlsm|csv|txt)$/i, '');
  const sheet = up.wb.sheets.length > 1 ? ` – ${up.wb.sheets[up.sheetIndex].name}` : '';
  return (base + sheet).slice(0, 60);
}

function rebuild() {
  const rows = up.wb.sheets[up.sheetIndex].rows;
  up.built = buildRecords(rows, up.detection, up.mapping, { date1904: up.wb.date1904 });
  up.preview = diff(state.data, up.built.records, { mode: up.mode, errors: up.built.errors });
}

async function save(rerender) {
  const { built, mode, detection, mapping } = up;
  const meta = { id: randomId(8), fajlnev: up.fileName };
  const needFormat = up.saveFormat && (!detection.savedFormat || up.mappingEdited);
  try {
    if (needFormat) {
      const existing = state.formats.formatumok.find((f) => f.ujjlenyomat === detection.fingerprint);
      const fmt = makeFormat(detection, mapping, up.formatName || defaultFormatName(), existing?.id || randomId(8));
      mutate('formats', (d) => {
        d.formatumok = (d.formatumok || []).filter((f) => f.ujjlenyomat !== fmt.ujjlenyomat);
        d.formatumok.push(fmt);
        return d;
      }, `Formátum mentése: ${fmt.nev}`);
    }
    const now = new Date();
    // a diffet a (friss) adaton számoljuk újra, így ütközés után is helyes
    const p = mutate('data', (d) => applyDiff(d, diff(d, built.records, { mode, errors: built.errors }), meta, now),
      `Feltöltés: ${up.preview.uj.length} új, ${up.preview.valtozott.length} változott, ${up.preview.kikerult.length} kikerült`);
    const summary = `Mentve: ${up.preview.uj.length} új, ${up.preview.valtozott.length + up.preview.ujraeledt.length} változott, ${up.preview.kikerult.length} archiválva.`;
    up = null;
    toast(summary, 'ok');
    location.hash = '#/napok';
    await p;
  } catch (e) {
    toast('Mentési hiba: ' + e.message, 'error');
    rerender();
  }
}

export function render(root) {
  const rerender = () => render(root);

  const fileInput = h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv',
    onchange: async (e) => { const f = e.target.files[0]; if (f) { await handleFile(f); rerender(); } } });
  const drop = h('label', { class: 'drop', tabindex: 0 },
    h('strong', {}, 'Húzd ide az Excel- vagy CSV-fájlt'),
    h('span', { class: 'muted' }, 'vagy koppints ide a kiválasztáshoz (.xlsx, .xls, .csv)'),
    fileInput);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) { await handleFile(f); rerender(); }
  });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });

  const paste = h('textarea', { placeholder: 'Vagy másold ki a cellákat Excelből (fejléccel együtt), és illeszd be ide…', rows: 4,
    onpaste: (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (text && text.includes('\t')) { e.preventDefault(); handlePaste(text); rerender(); }
    } });

  const sourceCard = h('section', { class: 'card stack' },
    h('h2', {}, 'Friss lista feltöltése'),
    drop,
    h('details', { open: !up },
      h('summary', {}, 'Beillesztés Excelből'),
      h('div', { class: 'stack' }, paste,
        h('button', { onclick: () => { handlePaste(paste.value); rerender(); } }, 'Beillesztett cellák feldolgozása'))));

  if (!up) {
    mount(root, sourceCard, lastUploads());
    return;
  }
  mount(root, sourceCard, formatCard(rerender), up.step === 'map' ? mappingCard(rerender) : null,
    up.step === 'preview' ? previewCard(rerender) : null);
}

function lastUploads() {
  const list = state.data.feltoltesek || [];
  if (!list.length) return h('p', { class: 'muted' }, 'Még nem volt feltöltés. Próbáld ki a samples mappa minta-fájljaival.');
  return h('section', { class: 'card' }, h('h3', {}, 'Legutóbbi feltöltések'), uploadLogTable(list.slice(0, 5)));
}

export function uploadLogTable(list) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Időpont', 'Fájl', 'Mód', 'Új', 'Változott', 'Kikerült', 'Hibás'].map((t) => h('th', {}, t)))),
    h('tbody', {}, list.map((u) => h('tr', {},
      h('td', { class: 'mono' }, new Date(u.at).toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', dateStyle: 'short', timeStyle: 'short' })),
      h('td', {}, u.fajlnev),
      h('td', {}, u.mod === 'teljes' ? 'Teljes lista' : 'Hozzáadás'),
      h('td', {}, u.uj), h('td', {}, u.valtozott + (u.ujraeledt || 0)), h('td', {}, u.kikerult), h('td', {}, u.hibas ?? 0))))));
}

function formatCard(rerender) {
  const d = up.detection;
  const rows = up.wb.sheets[up.sheetIndex].rows;
  const sheetSel = up.wb.sheets.length > 1
    ? h('label', { class: 'field' }, 'Munkalap',
      select(up.ranked.map((r, i) => [r.index, `${r.name}${i === 0 ? ' (javasolt)' : ''} – ${r.dataRows} sor`]), up.sheetIndex,
        { onchange: (e) => { setSheet(Number(e.target.value)); rerender(); } }))
    : null;

  const headerOpts = [];
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const preview = (rows[r] || []).filter((v) => !isBlank(v)).slice(0, 4).map(clean).join(' | ');
    headerOpts.push([r, `${r + 1}. sor: ${preview.slice(0, 70) || '(üres)'}`]);
  }
  const headerSel = h('label', { class: 'field' }, 'Fejlécsor',
    select(headerOpts, d.headerRow, { onchange: (e) => {
      const r = Number(e.target.value);
      setSheet(up.sheetIndex, { top: up.twoRow && r > 0 ? r - 1 : r, bottom: r }); rerender();
    } }));
  const twoRow = h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: d.headerTop !== d.headerRow,
    onchange: (e) => { up.twoRow = e.target.checked; const r = d.headerRow;
      setSheet(up.sheetIndex, { top: up.twoRow && r > 0 ? r - 1 : r, bottom: r }); rerender(); } }), 'kétsoros fejléc (a fölötte lévő sorral együtt)');

  let status;
  if (d.savedFormat) status = h('div', { class: 'alert ok' }, `Ismert formátum: „${d.savedFormat.nev}” – a mentett hozzárendelést alkalmaztam.`);
  else if (!d.ok) status = h('div', { class: 'alert bad' }, d.warnings.join(' '), ' Válaszd ki a fejlécsort, majd rendeld hozzá az oszlopokat.');
  else if (d.confident) status = h('div', { class: 'alert info' }, 'Új formátum – minden fontos oszlopot felismertem. Ellenőrizd, és mentsd el a hozzárendelést.');
  else status = h('div', { class: 'alert warn' }, 'Új vagy bizonytalan formátum – ellenőrizd a hozzárendelést.', d.warnings.map((w) => h('div', { class: 'small' }, w)));

  return h('section', { class: 'card stack' },
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, up.fileName),
      h('button', { class: 'ghost', onclick: () => { up = null; rerender(); } }, 'Mégse')),
    h('div', { class: 'grid2' }, sheetSel, h('div', {}, headerSel, twoRow)),
    status,
    up.step === 'preview' ? h('button', { onclick: () => { up.step = 'map'; rerender(); } }, 'Hozzárendelés módosítása') : null);
}

function mappingCard(rerender) {
  const d = up.detection;
  const rows = up.wb.sheets[up.sheetIndex].rows;
  const colOpts = [['', '— nincs —'], ...d.columns.filter((c) => c.label).map((c) => [c.index, `${colName(c.index)}: ${c.label}`])];
  // mintaértékek; dátummezőnél az értelmezett alak, hogy látszódjon, jól olvasom-e
  const samplesOf = (ci, field) => {
    const out = [];
    for (let r = d.dataStart; r < rows.length && out.length < 3; r++) {
      const v = rows[r]?.[ci];
      if (isBlank(v)) continue;
      if (field.endsWith('_datum')) {
        const p = parseDateCell(v, { date1904: up.wb.date1904, slashOrder: d.slashOrders?.[ci] });
        out.push(p ? [huDate(p.date), p.time, p.timeTo && `–${p.timeTo}`].filter(Boolean).join(' ') : `${clean(v)} (?)`);
      } else if (field.endsWith('_ido')) {
        const t = parseTimeCell(v);
        out.push(t.time ? t.time + (t.timeTo ? `–${t.timeTo}` : '') : clean(v));
      } else out.push(clean(v));
    }
    return out.join(' · ');
  };
  const used = {};
  for (const [f, c] of Object.entries(up.mapping)) (used[c] ||= []).push(f);

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'map-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Mező'), h('th', {}, 'Oszlop a fájlban'), h('th', {}, 'Minta'), h('th', {}, ''))),
    h('tbody', {}, FIELDS.map((f) => {
      const c = up.mapping[f.key];
      const src = d.sources[f.key];
      const dup = c !== undefined && used[c]?.length > 1;
      return h('tr', {},
        h('td', {}, f.label, ['lerakas_datum'].includes(f.key) ? h('span', { class: 'muted' }, ' *') : null),
        h('td', {}, select(colOpts, c ?? '', { onchange: (e) => {
          const v = e.target.value;
          if (v === '') delete up.mapping[f.key]; else up.mapping[f.key] = Number(v);
          delete up.detection.sources[f.key];
          up.mappingEdited = true; rerender();
        } })),
        h('td', { class: 'samples' }, c !== undefined ? samplesOf(c, f.key) : ''),
        h('td', {}, dup ? h('span', { class: 'chip s-prob' }, 'kétszer') : src ? h('span', { class: `chip b-src${src === 'fejlec' || src === 'mentett' ? '' : ' weak'}` }, SOURCE_LABEL[src]) : null));
    }))));

  const ok = up.mapping.lerakas_datum !== undefined && (up.mapping.rendszam !== undefined || up.mapping.megbizasszam !== undefined);
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Oszlopok hozzárendelése'),
    h('p', { class: 'muted small' }, 'Kötelező: lerakás dátuma, valamint rendszám vagy megbízásszám. Az azonosítás a megbízásszámmal történik, ha van; különben rendszám + megbízó + felrakás dátuma.'),
    table,
    h('div', { class: 'row' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: up.saveFormat, onchange: (e) => { up.saveFormat = e.target.checked; } }), 'Formátum megjegyzése, név:'),
      h('input', { class: 'grow', value: up.formatName, maxlength: 60, oninput: (e) => { up.formatName = e.target.value; } })),
    h('button', { class: 'primary', disabled: !ok, onclick: () => { rebuild(); up.step = 'preview'; rerender(); } }, 'Tovább az előnézethez'));
}

function previewCard(rerender) {
  const p = up.preview;
  const modeRadio = (val, label, hint) => h('label', { class: 'check' },
    h('input', { type: 'radio', name: 'mode', value: val, checked: up.mode === val, onchange: () => { up.mode = val; rebuild(); rerender(); } }),
    h('span', {}, h('b', {}, label), h('span', { class: 'muted small' }, ' – ' + hint)));

  const count = (cls, n, label) => h('div', { class: `count ${cls}` }, h('b', {}, n), label);
  const tripCells = (r) => [
    h('td', {}, h('b', {}, r.rendszam || '–'), r.megbizasszam ? h('div', { class: 'muted small' }, r.megbizasszam) : null),
    h('td', {}, r.megbizo || '–', r.fuvarozo ? h('div', { class: 'muted small' }, r.fuvarozo) : null),
    h('td', {}, stopText(r.felrakas) || '–'),
    h('td', {}, stopText(r.lerakas) || '–'),
  ];
  const head = h('thead', {}, h('tr', {}, ['Rendszám', 'Megbízó / fuvarozó', 'Felrakás', 'Lerakás'].map((t) => h('th', {}, t))));
  const tbl = (items, extra) => h('div', { class: 'table-wrap' }, h('table', {}, head, h('tbody', {}, items.map((x) => [
    h('tr', {}, tripCells(x.rekord || x.regi.src)),
    extra ? extra(x) : null,
  ]))));
  const changes = (x) => x.valtozasok?.length ? h('tr', {}, h('td', { colspan: 4 },
    x.valtozasok.map((c) => h('div', { class: 'small' }, `${c.nev}: `, h('span', { class: 'old' }, fieldValue(c.mezo, c.regi)), ' → ',
      h('span', { class: 'chg' }, fieldValue(c.mezo, c.uj)))))) : null;

  const section = (title, items, body, open = true) => items.length
    ? h('details', { open }, h('summary', {}, `${title} (${items.length})`), body) : null;

  const errs = [...p.hibas.map((e) => ({ sor: e.sor, ok: e.okok.join('; '), r: e.rekord })),
    ...p.duplikalt.map((d) => ({ sor: d.sor, ok: `Ugyanaz az azonosító, mint a ${d.elsoSor}. sorban – kihagyva` }))];
  const sk = up.built.skipped;
  const skippedTxt = [sk.ures && `${sk.ures} üres`, sk.osszesito && `${sk.osszesito} összesítő`, sk.fejlec && `${sk.fejlec} ismételt fejléc`].filter(Boolean).join(', ');

  return h('section', { class: 'card stack' },
    h('h2', {}, 'Változások előnézete'),
    h('div', { class: 'stack' },
      modeRadio('teljes', 'Teljes lista', 'ami nincs a fájlban, archiválódik, a függő emlékeztetői megszűnnek'),
      modeRadio('hozzaadas', 'Csak hozzáadás/frissítés', 'semmi nem kerül archívumba')),
    h('div', { class: 'counts' },
      count('uj', p.uj.length, 'új'), count('valt', p.valtozott.length, 'változott'),
      p.ujraeledt.length ? count('ujra', p.ujraeledt.length, 'újra megjelent') : null,
      count('ki', p.kikerult.length, up.mode === 'teljes' ? 'kikerül (archív)' : 'kikerül'),
      count('', p.valtozatlan.length, 'változatlan'), count('hiba', errs.length, 'hibás sor')),
    skippedTxt ? h('p', { class: 'muted small' }, `Kihagyott sorok: ${skippedTxt}.`) : null,
    p.figyelmeztetes ? h('div', { class: 'alert warn' }, p.figyelmeztetes) : null,
    section('Új fuvarok', p.uj, tbl(p.uj)),
    section('Változott fuvarok', p.valtozott, tbl(p.valtozott, changes)),
    section('Újra megjelent (archívumból visszakerül)', p.ujraeledt, tbl(p.ujraeledt, changes)),
    section('Kikerül a listából → archívum', p.kikerult, tbl(p.kikerult)),
    errs.length ? h('details', { open: true }, h('summary', {}, `Hibás sorok – nem kerülnek be (${errs.length})`),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Sor'), h('th', {}, 'Hiba'), h('th', {}, 'Tartalom'))),
        h('tbody', {}, errs.map((e) => h('tr', { class: 'err-row' }, h('td', {}, e.sor), h('td', {}, e.ok),
          h('td', { class: 'small' }, e.r ? [e.r.megbizasszam, e.r.rendszam, e.r.megbizo].filter(Boolean).join(' · ') : ''))))))) : null,
    p.valtozatlan.length && !p.uj.length && !p.valtozott.length && !p.kikerult.length && !p.ujraeledt.length
      ? h('div', { class: 'alert info' }, 'Nincs változás a tárolt állapothoz képest.') : null,
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => save(rerender) }, 'Mentés'),
      h('span', { class: 'muted small' }, 'A feltöltött fájlt nem tárolom, csak a feldolgozott adatot.')));
}
