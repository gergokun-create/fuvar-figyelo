// Beállítások: GitHub-kapcsolat, összesítők időpontja, teszt push, formátumok, feltöltési napló.
import { h, mount, select, toast } from '../ui.js';
import { state, mutate, saveConfig, loadAll, testConnection, sendTestPush, remoteEnabled, humanError,
  pushLocalIfRemoteEmpty, forgetToken } from '../store.js';
import { FIELDS, columnKeys } from '../core/detect.js';
import { DEFAULT_SETTINGS } from '../core/schedule.js';
import { uploadLogTable } from './feltoltes.js';

let editing = null; // éppen szerkesztett formátum id-ja

export function render(root) {
  const rerender = () => render(root);
  const c = state.config;
  const owner = h('input', { value: c.owner, placeholder: 'pl. gergokun-create', autocomplete: 'off' });
  const repo = h('input', { value: c.repo, placeholder: 'fuvar-figyelo-data', autocomplete: 'off' });
  const branch = h('input', { value: c.branch || 'main', autocomplete: 'off' });
  const token = h('input', { type: 'password', value: c.token, placeholder: 'github_pat_…', autocomplete: 'off' });

  const connect = async () => {
    const cfg = { owner: owner.value.trim(), repo: repo.value.trim(), branch: branch.value.trim() || 'main', token: token.value.trim() };
    if (!cfg.owner || !cfg.repo || !cfg.token) { toast('Add meg a tulajdonost, a repót és a tokent.', 'error'); return; }
    try {
      const info = await testConnection(cfg);
      if (!info.private) { toast(`A(z) ${info.fullName} repó NYILVÁNOS! Az adatok csak privát repóba kerülhetnek.`, 'error'); return; }
      if (!info.push) { toast('A tokennek nincs írási joga (Contents: Read and write).', 'error'); return; }
      const local = { data: state.data, formats: state.formats, settings: state.settings };
      const wasLocal = !remoteEnabled();
      saveConfig(cfg);
      if (wasLocal) await pushLocalIfRemoteEmpty(local);
      await loadAll();
      toast(`Kapcsolódva: ${info.fullName} (privát)`, 'ok');
    } catch (e) {
      toast('Kapcsolódás sikertelen: ' + humanError(e), 'error');
    }
    rerender();
  };

  const st = { ...DEFAULT_SETTINGS, ...state.settings };
  const morning = h('input', { type: 'time', value: st.reggeliOsszesito });
  const evening = h('input', { type: 'time', value: st.estiOsszesito });

  mount(root,
    h('section', { class: 'card stack' },
      h('h2', {}, 'GitHub-kapcsolat (privát adat-repó)'),
      remoteEnabled()
        ? h('div', { class: `alert ${state.status === 'hiba' ? 'bad' : 'ok'}` },
          state.status === 'hiba' ? state.error : `Kapcsolódva: ${c.owner}/${c.repo}. Az adatok minden eszközön elérhetők.`)
        : h('div', { class: 'alert warn' }, 'Helyi mód: az adatok csak ebben a böngészőben vannak, és nem megy ki push értesítés. Add meg a privát repót és a tokent.'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Tulajdonos (GitHub felhasználónév)', owner),
        h('label', { class: 'field' }, 'Privát adat-repó', repo),
        h('label', { class: 'field' }, 'Ág', branch),
        h('label', { class: 'field' }, 'Fine-grained token', token)),
      h('p', { class: 'muted small' }, 'A token csak ebben a böngészőben (localStorage) tárolódik. Jogosultság: csak a fuvar-figyelo-data repó, Contents: Read and write, Actions: Read and write (a teszt push gombhoz).'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: connect }, 'Mentés és kapcsolódás'),
        remoteEnabled() ? h('button', { onclick: async () => { await loadAll(); toast('Frissítve', 'ok'); } }, 'Adatok újratöltése') : null,
        remoteEnabled() ? h('button', { class: 'danger', onclick: () => {
          if (confirm('Elfelejtsem a tokent ezen az eszközön? (A GitHubon lévő adatok megmaradnak.)')) { forgetToken(); rerender(); }
        } }, 'Token elfelejtése') : null)),

    h('section', { class: 'card stack' },
      h('h2', {}, 'Értesítések'),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Reggeli összesítő a mai lerakókról', morning),
        h('label', { class: 'field' }, 'Esti összesítő a holnapi lerakókról', evening)),
      h('div', { class: 'row' },
        h('button', { onclick: () => {
          const a = morning.value || DEFAULT_SETTINGS.reggeliOsszesito, b = evening.value || DEFAULT_SETTINGS.estiOsszesito;
          mutate('settings', (d) => ({ ...d, reggeliOsszesito: a, estiOsszesito: b }), 'Összesítők időpontja');
          toast('Időpontok mentve', 'ok');
        } }, 'Időpontok mentése'),
        h('button', { disabled: !remoteEnabled(), onclick: async () => {
          try { await sendTestPush(); toast('Teszt elindítva – 1–2 percen belül megérkezik a push.', 'ok'); }
          catch (e) { toast('Nem sikerült elindítani: ' + humanError(e) + ' (Actions: Read and write jog kell.)', 'error'); }
        } }, '🔔 Teszt push küldése')),
      h('p', { class: 'muted small' }, 'Az ütemező hétfőtől szombatig kb. 5 és 21 óra között fut. A GitHub ütemezett futásai 5–15 percet késhetnek.')),

    formatsCard(rerender),

    h('section', { class: 'card stack' },
      h('h2', {}, 'Feltöltési napló'),
      (state.data.feltoltesek || []).length ? uploadLogTable(state.data.feltoltesek.slice(0, 50)) : h('p', { class: 'muted' }, 'Még nincs feltöltés.')),

    h('section', { class: 'card stack' },
      h('h2', {}, 'Adatok'),
      h('div', { class: 'row' },
        h('button', { onclick: () => {
          const blob = new Blob([JSON.stringify({ fuvarok: state.data, formatumok: state.formats, beallitasok: state.settings }, null, 1)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `fuvar-figyelo-mentes-${new Date().toISOString().slice(0, 10)}.json` });
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } }, 'Biztonsági mentés letöltése (JSON)')),
      h('p', { class: 'muted small' }, `${Object.keys(state.data.fuvarok).length} fuvar tárolva (ebből ${Object.values(state.data.fuvarok).filter((f) => f.archivalt).length} archivált).`)));
}

function formatsCard(rerender) {
  const list = state.formats.formatumok || [];
  return h('section', { class: 'card stack' },
    h('h2', {}, 'Elmentett formátumok'),
    h('p', { class: 'muted small' }, 'Ha ugyanilyen fejlécű fájlt töltesz fel, a hozzárendelést kérdés nélkül alkalmazom.'),
    list.length ? list.map((f) => editing === f.id ? formatEditor(f, rerender) : h('div', { class: 'rem' },
      h('div', {}, h('b', {}, f.nev), h('div', { class: 'muted small' }, `${Object.keys(f.hozzarendeles).length} mező · ${f.fejlecek.filter(Boolean).slice(0, 6).join(', ')}${f.fejlecek.length > 6 ? '…' : ''}`)),
      h('div', { class: 'row' },
        h('button', { onclick: () => { editing = f.id; rerender(); } }, 'Szerkesztés'),
        h('button', { class: 'danger', onclick: () => {
          if (!confirm(`Törlöd a(z) „${f.nev}” formátumot?`)) return;
          mutate('formats', (d) => { d.formatumok = d.formatumok.filter((x) => x.id !== f.id); return d; }, `Formátum törlése: ${f.nev}`);
          rerender();
        } }, 'Törlés'))))
      : h('p', { class: 'muted' }, 'Még nincs elmentett formátum. Az első feltöltéskor jön létre.'));
}

function formatEditor(f, rerender) {
  const keys = columnKeys(f.fejlecek);
  const opts = [['', '— nincs —'], ...keys.map((k, i) => [k, f.fejlecek[i] || `(${i + 1}. oszlop)`])];
  const name = h('input', { value: f.nev, maxlength: 60 });
  const draft = { ...f.hozzarendeles };
  return h('div', { class: 'card stack', style: { background: 'var(--bg)' } },
    h('label', { class: 'field' }, 'Név', name),
    h('div', { class: 'table-wrap' }, h('table', { class: 'map-table' }, h('tbody', {}, FIELDS.map((fd) => h('tr', {},
      h('td', {}, fd.label),
      h('td', {}, select(opts, draft[fd.key] || '', { onchange: (e) => { if (e.target.value) draft[fd.key] = e.target.value; else delete draft[fd.key]; } }))))))),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => {
        const nev = name.value.trim() || f.nev;
        mutate('formats', (d) => {
          const x = d.formatumok.find((y) => y.id === f.id);
          if (x) { x.nev = nev; x.hozzarendeles = draft; x.modositva = new Date().toISOString(); }
          return d;
        }, `Formátum módosítása: ${nev}`);
        editing = null; rerender(); toast('Formátum mentve', 'ok');
      } }, 'Mentés'),
      h('button', { onclick: () => { editing = null; rerender(); } }, 'Mégse')));
}
