// Archívum: a listából kikerült fuvarok, kereshetően.
import { h, mount, debounce } from '../ui.js';
import { state } from '../store.js';
import { normText } from '../core/text.js';
import { tripCard, searchText } from './napok.js';

let q = '';

export function render(root) {
  const archived = Object.values(state.data.fuvarok).filter((f) => f.archivalt)
    .sort((a, b) => (b.archivaltAt || '').localeCompare(a.archivaltAt || ''));
  const list = h('div');
  const draw = () => {
    const nq = normText(q);
    const hits = archived.filter((f) => !nq || searchText(f).includes(nq));
    mount(list, hits.length ? hits.slice(0, 300).map((f) => tripCard(f)) : h('p', { class: 'empty' },
      archived.length ? 'Nincs találat.' : 'Az archívum üres. Ide kerülnek a „Teljes lista” feltöltéskor kikerült fuvarok.'),
    hits.length > 300 ? h('p', { class: 'muted small' }, `Az első 300 találat látszik (${hits.length}-ból). Szűkítsd a keresést.`) : null);
  };
  const onInput = debounce((v) => { q = v; draw(); }, 150);
  mount(root,
    h('div', { class: 'row', style: { marginBottom: '1rem' } },
      h('input', { class: 'grow', type: 'search', value: q, placeholder: 'Keresés az archívumban…', oninput: (e) => onInput(e.target.value) }),
      h('span', { class: 'muted small' }, `${archived.length} archivált fuvar`)),
    h('p', { class: 'muted small' }, 'Ha egy archivált fuvar újra megjelenik egy feltöltésben, az előzményeivel együtt visszakerül.'),
    list);
  draw();
}
