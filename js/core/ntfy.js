// ntfy kliens (böngésző és Node): azonnali és időzített küldés, visszavonás sequence ID alapján.
// Ugyanazzal a sequence ID-val újraküldve az ntfy a még ki nem kézbesített üzenetet lecseréli,
// így az időzítés idempotens.

export const NTFY_SERVER = 'https://ntfy.sh';

/** ntfy-kompatibilis sequence ID: "e:abc:x1" -> "ff-e-abc-x1" */
export function seqFor(kulcs) {
  return ('ff-' + kulcs.replace(/[^A-Za-z0-9_-]+/g, '-')).slice(0, 64);
}

export function createNtfy({ topic, server = NTFY_SERVER, fetchImpl = globalThis.fetch }) {
  const base = server.replace(/\/$/, '');

  /** at: ISO időpont az időzített kézbesítéshez (elhagyva: azonnal). */
  async function publish({ cim, uzenet, link, tipus, seq, at }) {
    const body = {
      topic, title: cim, message: uzenet,
      tags: [tipus === 'emlekezteto' ? 'alarm_clock' : tipus === 'teszt' ? 'white_check_mark' : 'truck'],
      priority: tipus === 'emlekezteto' ? 4 : 3,
      ...(link ? { click: link, actions: [{ action: 'view', label: 'Megnyitás', url: link }] } : {}),
      ...(seq ? { sequence_id: seq } : {}),
      ...(at ? { delay: String(Math.floor(new Date(at).getTime() / 1000)) } : {}),
    };
    const res = await fetchImpl(base + '/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
  }

  /** Időzített üzenet visszavonása (ha már nincs ilyen, az sem hiba). */
  async function cancel(seq) {
    const res = await fetchImpl(`${base}/${encodeURIComponent(topic)}/${encodeURIComponent(seq)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`ntfy HTTP ${res.status}`);
  }

  return { name: 'ntfy', publish, cancel, send: (m) => publish(m) };
}
