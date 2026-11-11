// Sorgu Atölyesi service worker: tüm dosyaları cihaza kaydeder, sonra internetsiz çalışır.
const SURUM = 'sa-83370b2d0d';
const DOSYALAR = [
 "./",
 "index.html",
 "manifest.webmanifest",
 "ikon/apple-touch-icon.png",
 "ikon/icon-192.png",
 "ikon/icon-512.png",
 "ikon/icon-maskable-512.png",
 "lib/fonts/bricolage-grotesque-latin-600-normal.woff2",
 "lib/fonts/bricolage-grotesque-latin-700-normal.woff2",
 "lib/fonts/bricolage-grotesque-latin-ext-600-normal.woff2",
 "lib/fonts/bricolage-grotesque-latin-ext-700-normal.woff2",
 "lib/fonts/fonts.css",
 "lib/fonts/ibm-plex-sans-latin-400-normal.woff2",
 "lib/fonts/ibm-plex-sans-latin-500-normal.woff2",
 "lib/fonts/ibm-plex-sans-latin-600-normal.woff2",
 "lib/fonts/ibm-plex-sans-latin-ext-400-normal.woff2",
 "lib/fonts/ibm-plex-sans-latin-ext-500-normal.woff2",
 "lib/fonts/ibm-plex-sans-latin-ext-600-normal.woff2",
 "lib/fonts/jetbrains-mono-latin-400-normal.woff2",
 "lib/fonts/jetbrains-mono-latin-500-normal.woff2",
 "lib/fonts/jetbrains-mono-latin-ext-400-normal.woff2",
 "lib/fonts/jetbrains-mono-latin-ext-500-normal.woff2",
 "lib/sql-asm.js",
 "lib/xlsx.full.min.js",
 "pyodide/paket-numpy.wasm",
 "pyodide/paket-pandas.wasm",
 "pyodide/paket-python_dateutil.wasm",
 "pyodide/paket-pytz.wasm",
 "pyodide/paket-six.wasm",
 "pyodide/pyodide-lock.json",
 "pyodide/pyodide.asm.js",
 "pyodide/pyodide.asm.wasm",
 "pyodide/pyodide.js",
 "pyodide/python_stdlib.wasm"
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(DOSYALAR)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sa-') && k !== SURUM).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.open(SURUM).then(c => c.match(e.request, { ignoreSearch: true }).then(r => {
    if (r) return r;
    if (e.request.mode === 'navigate') return c.match('./index.html');
    return fetch(e.request);
  })));
});
