"""Sorgu Atölyesi derleme betiği.

Kullanım (repo kökünden):
    python3 kaynak/build.py
Üretir:
    index.html, sw.js, manifest.webmanifest   -> repo kökü (iPad / GitHub Pages sürümü)
    kaynak/cikti/claude-ai.html               -> claude.ai artifact sürümü (git'e girmez)

Python motoru, kütüphaneler, fontlar ve ikonlar repo kökünde düz (klasörsüz) durur.
"""
import json, re, os, glob, hashlib, shutil

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(KOK, 'kaynak', 'src')
CIKTI = os.path.join(KOK, 'kaynak', 'cikti')


def birlestir():
    t = open(os.path.join(SRC, 'template.html'), encoding='utf-8').read()
    for k, f in [('/*DATA*/', 'data.js'), ('/*BANK*/', 'bank.js'), ('/*HRDATA*/', 'hr_data.js'),
                 ('/*HRBANK*/', 'hr_bank.js'), ('/*NPBANK*/', 'np_bank.js'), ('/*APP*/', 'app.js')]:
        s = open(os.path.join(SRC, f), encoding='utf-8').read()
        s = re.sub(r"\nif \(typeof module !== 'undefined'\).*\n?", "\n", s)
        assert '</script' not in s, f
        t = t.replace(k, s)
    return t.replace('/*HELPER*/', json.dumps(open(os.path.join(SRC, 'helper.py'), encoding='utf-8').read()))


PWA_BAS = '''<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#2453c8">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sorgu Atölyesi">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" href="icon-192.png">
'''

PWA_KAYIT = '''<script>
(function () {
  if (!('serviceWorker' in navigator)) return;
  var sag = document.querySelector('.ust-sag');
  var hap = document.createElement('span'); hap.className = 'hap'; hap.id = 'cevrimdisi';
  hap.textContent = 'Çevrimdışı: hazırlanıyor…'; sag.appendChild(hap);
  var yaz = function (t, renk) { hap.textContent = t; if (renk) hap.style.color = renk; };
  navigator.serviceWorker.register('./sw.js').then(function (reg) {
    reg.addEventListener('updatefound', function () {
      var yeni = reg.installing;
      if (!yeni || !navigator.serviceWorker.controller) return;
      yeni.addEventListener('statechange', function () { if (yeni.state === 'activated') yaz('Yeni sürüm indi · uygulamayı kapatıp aç', 'var(--uyari)'); });
    });
    return navigator.serviceWorker.ready;
  }).then(function () {
    yaz('Çevrimdışı kullanıma hazır', 'var(--iyi)');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }).catch(function (e) { yaz('Çevrimdışı kurulamadı', 'var(--kotu)'); console.warn(e); });
})();
</script>
'''

SW = """// Sorgu Atölyesi service worker: tüm dosyaları cihaza kaydeder, sonra internetsiz çalışır.
const SURUM = '__SURUM__';
const DOSYALAR = __DOSYALAR__;
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
"""


def pwa(t):
    t = re.sub(r'<link rel="preconnect"[^>]*>\n', '', t)
    t = re.sub(r'<link href="https://fonts.googleapis.com[^>]*>', '<link rel="stylesheet" href="fonts.css">', t)
    t = t.replace('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-asm.js', 'sql-asm.js')
    t = t.replace('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'xlsx.full.min.js')
    a = "const PY_KAYNAKLAR = [new URL('pyodide/', location.href).href, 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'];"
    assert a in t, 'PY_KAYNAKLAR satırı bulunamadı'
    t = t.replace(a, "const PY_KAYNAKLAR = [new URL('./', location.href).href];")
    t = t.replace('<title>Sorgu Atölyesi</title>\n', '<title>Sorgu Atölyesi</title>\n' + PWA_BAS, 1)
    t = t.replace('</body>', PWA_KAYIT + '</body>')
    assert 'fonts.googleapis' not in t and 'cdnjs' not in t
    return t


def main():
    t = birlestir()
    os.makedirs(CIKTI, exist_ok=True)
    open(os.path.join(CIKTI, 'claude-ai.html'), 'w', encoding='utf-8').write(t)
    open(os.path.join(KOK, 'index.html'), 'w', encoding='utf-8').write(pwa(t))
    for f in glob.glob(os.path.join(SRC, 'ikon', '*.png')):
        shutil.copy(f, os.path.join(KOK, os.path.basename(f)))
    m = {"name": "Sorgu Atölyesi", "short_name": "Sorgu Atölyesi", "description": "SQL, pandas ve NumPy alıştırma uygulaması",
         "start_url": "./", "scope": "./", "display": "standalone", "background_color": "#f2f4f7", "theme_color": "#2453c8", "lang": "tr",
         "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
                   {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
                   {"src": "icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}
    json.dump(m, open(os.path.join(KOK, 'manifest.webmanifest'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    haric = ('sw.js', 'index.html', 'manifest.webmanifest', '.md', '.nojekyll', '.gitignore')
    varlik = sorted(os.path.basename(f) for f in glob.glob(os.path.join(KOK, '*'))
                    if os.path.isfile(f) and not f.endswith(haric))
    dosyalar = ['./', 'index.html', 'manifest.webmanifest'] + varlik
    h = hashlib.sha256()
    for f in dosyalar[1:]:
        h.update(open(os.path.join(KOK, f), 'rb').read())
    surum = 'sa-' + h.hexdigest()[:10]
    sw = SW.replace('__SURUM__', surum).replace('__DOSYALAR__', json.dumps(dosyalar, indent=1))
    open(os.path.join(KOK, 'sw.js'), 'w', encoding='utf-8').write(sw)
    print('Derlendi:', surum, '-', len(dosyalar), 'dosya önbellekte')


if __name__ == '__main__':
    main()
