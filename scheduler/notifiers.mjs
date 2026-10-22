// Cserélhető értesítő modulok. Mindegyik: { name, send({cim, uzenet, link, tipus}) }.
// A környezeti változók alapján az összes beállított értesítőn kimegy az üzenet.

export function ntfy({ topic, server = 'https://ntfy.sh', fetchImpl = fetch }) {
  return {
    name: 'ntfy',
    async send({ cim, uzenet, link, tipus }) {
      // JSON-közzététel: így az ékezetes cím is gond nélkül átmegy
      const res = await fetchImpl(server.replace(/\/$/, '') + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic, title: cim, message: uzenet,
          ...(link ? { click: link, actions: [{ action: 'view', label: 'Megnyitás', url: link }] } : {}),
          tags: [tipus === 'emlekezteto' ? 'alarm_clock' : tipus === 'teszt' ? 'white_check_mark' : 'truck'],
          priority: tipus === 'emlekezteto' ? 4 : 3,
        }),
      });
      if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
    },
  };
}

export function telegram({ token, chatId, fetchImpl = fetch }) {
  return {
    name: 'telegram',
    async send({ cim, uzenet, link }) {
      // a hálózati hibaüzenet tartalmazhatná az URL-t (benne a tokennel), ezért általános hibát adunk
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `${cim}\n\n${uzenet}`,
          disable_web_page_preview: true,
          ...(link && link.startsWith('https://') ? { reply_markup: { inline_keyboard: [[{ text: 'Megnyitás', url: link }]] } } : {}),
        }),
      }).catch(() => { throw new Error('Telegram: hálózati hiba'); });
      if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
    },
  };
}

/** Az env alapján beállított értesítők listája. */
export function fromEnv(env = process.env, fetchImpl = fetch) {
  const list = [];
  if (env.NTFY_TOPIC) list.push(ntfy({ topic: env.NTFY_TOPIC, server: env.NTFY_SERVER || undefined, fetchImpl }));
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    list.push(telegram({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, fetchImpl }));
  }
  return list;
}

/** Küldés az összes értesítőn; akkor sikeres, ha legalább egyen kiment. */
export async function sendAll(notifiers, msg) {
  const errors = [];
  let ok = 0;
  for (const n of notifiers) {
    try { await n.send(msg); ok++; } catch (e) { errors.push(`${n.name}: ${e.message}`); }
  }
  return { ok: ok > 0, errors };
}
