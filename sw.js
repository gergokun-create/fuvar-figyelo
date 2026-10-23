// Service worker: az app héja offline is betölt. A GitHub API-t soha nem gyorsítótárazzuk.
const VERSION = 'ff-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/store.js', 'js/notify.js', 'js/ui.js', 'js/format.js',
  'js/core/text.js', 'js/core/tz.js', 'js/core/dates.js', 'js/core/tabular.js', 'js/core/detect.js', 'js/core/records.js',
  'js/core/sync.js', 'js/core/schedule.js', 'js/core/github.js', 'js/core/ntfy.js',
  'js/views/napok.js', 'js/views/feltoltes.js', 'js/views/fuvar.js', 'js/views/archivum.js', 'js/views/beallitasok.js',
];
const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    // hálózat először (friss kód), offline esetén gyorsítótár
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  } else if (url.href === SHEETJS) {
    // rögzített verzió: elég egyszer letölteni
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res;
    })));
  }
});
