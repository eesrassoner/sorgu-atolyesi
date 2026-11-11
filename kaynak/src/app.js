// ═══════════════ Sorgu Atölyesi ═══════════════
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const metin = h => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent; };
const SEVIYE = { 1: 'Kolay', 2: 'Orta', 3: 'Zor' };
const DIL = { sql: 'SQL', python: 'Python' };
const karistir = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
function scriptYukle(src) { return new Promise((ok, red) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => red(new Error('Kütüphane indirilemedi: ' + src)); document.head.appendChild(s); }); }
const bekle = ms => new Promise(r => setTimeout(r, ms));

// ─── Kalıcı ilerleme (bu tarayıcıda) ───
const DEPO_KEY = 'sorgu-atolyesi-v1';
let depo = { cozuldu: {}, tahmin: {}, taslak: {} };
try { const d = JSON.parse(localStorage.getItem(DEPO_KEY)); if (d) depo = Object.assign(depo, d); } catch (e) { }
function kaydet() { try { localStorage.setItem(DEPO_KEY, JSON.stringify(depo)); } catch (e) { } }

// ─── Veri setleri ───
const VS = {
  hr: { ad: 'İK Attrition', tablolar: HR_VERI, sorular: HR_SORULAR.concat(NP_SORULAR), hazir: true },
  ornek: { ad: 'Örnek Mağaza', tablolar: ornekVeriUret(), sorular: SORULAR, hazir: true },
  yuklenen: null
};
const HAZIR = ['hr', 'ornek'];
function varsayilanKod(key) {
  const t = Object.keys(VS[key].tablolar)[0];
  if (key === 'ornek') return { sql: "SELECT *\nFROM siparisler\nLIMIT 20;", python: "# DataFrame'ler hazır: musteriler, urunler, siparisler\nsiparisler.head(10)" };
  if (key === 'hr') return { sql: "SELECT EmployeeNumber, Age, Department, JobRole, MonthlyIncome, Attrition\nFROM hr\nLIMIT 20;", python: "# DataFrame'ler hazır: hr, egitim_kod, memnuniyet_kod\nhr.head(10)" };
  return { sql: `SELECT *\nFROM "${t}"\nLIMIT 20;`, python: `${t}.head(10)` };
}
const S = {
  view: 'alistirma', veriSeti: 'hr',
  filtre: { dil: 'sql', seviye: 0, kategori: '' },
  aktifId: { hr: 'h01', ornek: 's01', yuklenen: null },
  tahminId: 't01', tahminDil: 'sql',
  serbestDil: 'sql', serbestKod: null,
  gecmis: [], mulakat: null, teorik: null, claude: null, uretiliyor: false
};

// ─── Claude (sayfa içinden) ───
(async () => {
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      const s = await window.claude.use('sample');
      if (s) { S.claude = s; yenidenCiz(); }
    }
  } catch (e) { }
})();
async function claudeSor(input, opts = {}) {
  if (!S.claude) throw { code: 'yok', message: 'Claude bu görünümde kullanılamıyor.' };
  try { return await S.claude(input, { modelTier: 'default', cache: false, ...opts }); }
  catch (e) { if (e && e.code === 'not_granted') { S.claude = null; } throw e; }
}
async function claudeJson(input, opts = {}) {
  if (!S.claude) throw { code: 'yok', message: 'Claude bu görünümde kullanılamıyor.' };
  try { return await S.claude.json(input, { modelTier: 'default', ...opts }); }
  catch (e) { if (e && e.code === 'not_granted') { S.claude = null; } throw e; }
}
function claudeHata(e) {
  if (!e) return 'Bilinmeyen bir hata oluştu.';
  if (e.code === 'rate_limited') return 'Claude şu an çok yoğun. Birkaç dakika sonra tekrar dene.';
  if (e.code === 'not_granted') return 'Claude\'a erişim izni verilmedi. Bu özelliği kullanmak için izin istendiğinde onay vermen gerekiyor.';
  return e.message || String(e);
}

// ═══════════════ SQL motoru ═══════════════
let SQLlib = null;
const sqlHazir = (window.initSqlJs ? Promise.resolve() : scriptYukle('https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-asm.js'))
  .then(() => initSqlJs()).then(s => { SQLlib = s; }).catch(e => { console.error(e); });
const dbCache = {};
function dbOlustur(tablolar) {
  const db = new SQLlib.Database();
  for (const [ad, t] of Object.entries(tablolar)) {
    db.run(`CREATE TABLE "${ad}" (${t.columns.map((c, i) => `"${c}" ${t.types[i] || ''}`).join(', ')})`);
    const st = db.prepare(`INSERT INTO "${ad}" VALUES (${t.columns.map(() => '?').join(',')})`);
    db.run('BEGIN');
    for (const r of t.rows) st.run(r);
    db.run('COMMIT');
    st.free();
  }
  return db;
}
function dbAl(key) {
  if (!dbCache[key]) { const db = dbOlustur(VS[key].tablolar); dbCache[key] = { bytes: db.export(), oyun: db }; }
  return dbCache[key];
}
function dbSifirla(key) { if (dbCache[key]) { try { dbCache[key].oyun.close(); } catch (e) { } dbCache[key].oyun = new SQLlib.Database(dbCache[key].bytes); } }
function sqlExec(db, kod) {
  const t0 = performance.now();
  try {
    const r = db.exec(kod);
    const ms = Math.round(performance.now() - t0);
    const son = r[r.length - 1];
    if (!son) return { ok: true, table: null, ms, mesaj: `Sorgu çalıştı, sonuç tablosu dönmedi (${db.getRowsModified()} satır etkilendi).` };
    return { ok: true, table: { columns: son.columns, rows: son.values, total: son.values.length }, ms };
  } catch (e) { return { ok: false, error: e.message, ms: Math.round(performance.now() - t0) }; }
}

// ═══════════════ Python motoru (Pyodide) ═══════════════
const PY_KAYNAKLAR = [new URL('pyodide/', location.href).href, 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'];
const PY_EK = '.wasm';
const PY_PAKETLER = ['six', 'python_dateutil', 'pytz', 'numpy', 'pandas'];
let pyAsama = '';
function pyAsamaAyarla(t) { pyAsama = t; $$('.py-asama').forEach(el => el.textContent = t); }
const pyBekleHTML = () => `<div class="yukleniyor"><span class="py-asama">${esc(pyAsama || 'Python ortamı hazırlanıyor…')}</span></div>`;
function sureli(p, ms, ad) { let t; return Promise.race([p, new Promise((_, red) => { t = setTimeout(() => red(new Error(`${ad} ${Math.round(ms / 1000)} saniyede yüklenemedi`)), ms); })]).finally(() => clearTimeout(t)); }
function hataHTML(e) {
  const m = (e && e.message) || String(e);
  const py = m.startsWith('Python ortamı yüklenemedi');
  return `<div class="hata-kutu">${esc(m)}${py ? '<div><button class="btn kucuk-btn" data-py-tekrar>Tekrar dene</button></div>' : ''}</div>`;
}
document.addEventListener('click', e => { if (e.target.closest('[data-py-tekrar]') || (e.target.closest('#pyDurum') && pyDurum === 'hata')) { pyAsama = ''; pyHazirla().catch(() => { }); yenidenCiz(); } });
let pyodide = null, pyHazirP = null, pyYukluVS = null, pyDurum = 'yok', pyTipler = {};
function pyDurumAyarla(d) { pyDurum = d; const el = $('#pyDurum'); if (el) { el.dataset.durum = d; el.textContent = { yok: 'Python: kapalı', yukleniyor: 'Python hazırlanıyor…', hazir: 'Python hazır', hata: 'Python yüklenemedi · tekrar dene' }[d]; el.style.cursor = d === 'hata' ? 'pointer' : ''; } }
function pyHazirla() {
  if (!pyHazirP) {
    pyHazirP = (async () => {
      pyDurumAyarla('yukleniyor');
      let son = null;
      for (const kok of PY_KAYNAKLAR) {
        try {
          pyAsamaAyarla('Python motoru indiriliyor (1/3)…');
          if (!window.loadPyodide) await sureli(scriptYukle(kok + 'pyodide.js'), 45000, 'Python motoru');
          pyAsamaAyarla('Python motoru başlatılıyor (2/3)…');
          const yerel = kok === PY_KAYNAKLAR[0];
          pyodide = await sureli(loadPyodide(yerel ? { indexURL: kok, stdLibURL: kok + 'python_stdlib' + PY_EK } : { indexURL: kok }), 120000, 'Python motoru');
          pyAsamaAyarla('pandas ve NumPy yükleniyor (3/3)…');
          if (yerel) {
            const site = pyodide.runPython('import site; site.getsitepackages()[0]');
            for (const ad of PY_PAKETLER) {
              const buf = await sureli(fetch(kok + 'paket-' + ad + PY_EK).then(r => { if (!r.ok) throw new Error(`${ad} paketi indirilemedi (${r.status})`); return r.arrayBuffer(); }), 90000, ad);
              await pyodide.unpackArchive(buf, 'wheel', { extractDir: site });
            }
            pyodide.runPython('import importlib; importlib.invalidate_caches()');
          } else await sureli(pyodide.loadPackage(['pandas']), 150000, 'pandas');
          pyodide.runPython(HELPER_PY);
          pyAsamaAyarla('Python hazır');
          pyDurumAyarla('hazir');
          return;
        } catch (e) {
          son = e; console.warn('Python kaynağı kullanılamadı:', kok, e);
          pyodide = null; try { delete window.loadPyodide; } catch (x) { window.loadPyodide = undefined; }
        }
      }
      throw son || new Error('bilinmeyen hata');
    })().catch(e => { pyDurumAyarla('hata'); pyAsama = ''; pyHazirP = null; throw new Error('Python ortamı yüklenemedi: ' + ((e && e.message) || e) + '. Sayfayı yenileyip tekrar deneyebilirsin.'); });
  }
  return pyHazirP;
}
function pyVeriYukle(key) {
  if (pyYukluVS === key) return;
  const f = pyodide.globals.get('_yukle');
  pyTipler = JSON.parse(f(JSON.stringify(VS[key].tablolar)));
  f.destroy();
  pyYukluVS = key;
}
async function pyExec(kod) {
  await pyHazirla();
  pyVeriYukle(S.veriSeti);
  const t0 = performance.now();
  const f = pyodide.globals.get('_calistir');
  const out = JSON.parse(f(kod));
  f.destroy();
  out.ms = Math.round(performance.now() - t0);
  if (out.ok && !out.table && !out.stdout) out.mesaj = 'Kod çalıştı ama gösterilecek bir sonuç yok. Sonucu sonuc değişkenine ata ya da son satıra ifadeyi yaz.';
  return out;
}

// Ortak çalıştırıcı. temiz=true: soru kontrolünde, oyun alanındaki değişikliklerden etkilenmeyen taze veri.
async function calistir(dil, kod, temiz = false) {
  if (dil === 'sql') {
    await sqlHazir;
    if (temiz) { const db = new SQLlib.Database(dbAl(S.veriSeti).bytes); try { return sqlExec(db, kod); } finally { db.close(); } }
    return sqlExec(dbAl(S.veriSeti).oyun, kod);
  }
  return pyExec(kod);
}
const beklenenCache = {};
async function beklenenAl(q) {
  const k = S.veriSeti + ':' + q.id;
  if (!beklenenCache[k]) beklenenCache[k] = await calistir(q.dil, q.cozum, true);
  return beklenenCache[k];
}

// ═══════════════ Çıktı karşılaştırma ═══════════════
function nk(v) {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'boolean') return v ? '1.00' : '0.00';
  if (typeof v === 'number') { if (!isFinite(v)) return '∅'; return (Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100).toFixed(2); }
  let s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return nk(parseFloat(s));
  return s.replace(/^(\d{4}-\d{2}-\d{2})[T ]00:00:00(\.0+)?$/, '$1');
}
function karsilastir(bek, gel, sirali) {
  if (!gel || !gel.columns) return { dogru: false, mesaj: 'Çıktı yok. SQL\'de sorgunun bir SELECT ile bitmesi, Python\'da sonucun <code>sonuc</code> değişkeninde olması gerekiyor.' };
  if (bek.rows.length !== gel.rows.length) return { dogru: false, mesaj: `Satır sayısı tutmuyor: beklenen <b>${bek.rows.length}</b>, senin çıktında <b>${gel.rows.length}</b>.` };
  if (bek.columns.length !== gel.columns.length) return { dogru: false, mesaj: `Sütun sayısı tutmuyor: beklenen <b>${bek.columns.length}</b> (${bek.columns.map(c => `<code>${esc(c)}</code>`).join(', ')}), senin çıktında <b>${gel.columns.length}</b>.` };
  const sutunAnahtar = (t, j) => t.rows.map(r => nk(r[j])).sort().join('\u0001');
  const bA = bek.columns.map((_, j) => sutunAnahtar(bek, j));
  const gA = gel.columns.map((_, j) => sutunAnahtar(gel, j));
  const aday = bA.map(a => gA.map((g, j) => g === a ? j : -1).filter(j => j >= 0));
  const eksik = aday.findIndex(a => a.length === 0);
  if (eksik >= 0) return { dogru: false, mesaj: `<code>${esc(bek.columns[eksik])}</code> sütununun değerleri beklenenle eşleşmiyor.` };
  const satirlar = (t, harita) => t.rows.map(r => harita.map(j => nk(r[j])).join('\u0001'));
  const bS = satirlar(bek, bek.columns.map((_, j) => j));
  let sirasiYanlis = false, deneme = 0, bulunan = null;
  const kullanildi = new Set(), harita = [];
  (function ara(i) {
    if (bulunan || deneme > 4000) return;
    if (i === aday.length) {
      deneme++;
      const gS = satirlar(gel, harita);
      if (sirali) { if (gS.every((s, k) => s === bS[k])) bulunan = [...harita]; else if ([...gS].sort().join('\n') === [...bS].sort().join('\n')) sirasiYanlis = true; }
      else if ([...gS].sort().join('\n') === [...bS].sort().join('\n')) bulunan = [...harita];
      return;
    }
    for (const j of aday[i]) { if (kullanildi.has(j)) continue; kullanildi.add(j); harita.push(j); ara(i + 1); harita.pop(); kullanildi.delete(j); }
  })(0);
  if (!bulunan) return { dogru: false, mesaj: sirasiYanlis ? 'Değerler doğru ama <b>sıralama</b> farklı. Bu soruda sıralama önemli.' : 'Sütunlar tek tek doğru görünüyor ama satırlar birbiriyle eşleşmiyor. Değerler yanlış satırlarda olabilir.' };
  const farkli = bek.columns.filter((c, i) => String(c).toLowerCase() !== String(gel.columns[bulunan[i]]).toLowerCase());
  return { dogru: true, mesaj: 'Doğru! Çıktın beklenenle aynı.' + (farkli.length ? ` <span class="kucuk">Sütun adların farklı (${farkli.map(c => `<code>${esc(c)}</code>`).join(', ')} bekleniyordu), değerler doğru.</span>` : '') };
}

// ═══════════════ Görsel yardımcılar ═══════════════
const SQL_KW = new Set('SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN LEFT RIGHT INNER OUTER FULL CROSS GROUP BY ORDER HAVING LIMIT OFFSET DISTINCT CASE WHEN THEN ELSE END WITH UNION ALL EXISTS BETWEEN LIKE DESC ASC OVER PARTITION VALUES CAST INTEGER REAL TEXT INSERT INTO UPDATE SET DELETE CREATE TABLE DROP ROWS RANGE PRECEDING FOLLOWING UNBOUNDED CURRENT ROW'.split(' '));
const SQL_FN = new Set('COUNT SUM AVG MIN MAX ROUND COALESCE NULLIF IFNULL ROW_NUMBER RANK DENSE_RANK NTILE LAG LEAD FIRST_VALUE LAST_VALUE STRFTIME JULIANDAY DATE LOWER UPPER SUBSTR LENGTH TRIM ABS'.split(' '));
const PY_KW = new Set('import from as def return if elif else for in while not and or is None True False lambda with try except class pass break continue print len range'.split(' '));
function renklendir(kod, dil) {
  const re = dil === 'sql' ? /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)|([\s\S])/g : /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)|([\s\S])/g;
  let out = '', m;
  while ((m = re.exec(kod))) {
    if (m[1]) out += `<span class="h-yorum">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="h-metin">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="h-sayi">${m[3]}</span>`;
    else if (m[4]) {
      const w = m[4];
      if (dil === 'sql' && SQL_KW.has(w.toUpperCase())) out += `<span class="h-kw">${w}</span>`;
      else if (dil === 'sql' && SQL_FN.has(w.toUpperCase())) out += `<span class="h-fn">${w}</span>`;
      else if (dil !== 'sql' && PY_KW.has(w)) out += `<span class="h-kw">${w}</span>`;
      else out += esc(w);
    } else out += esc(m[5]);
  }
  return out;
}
const kodBlok = (kod, dil) => `<pre class="kod-blok"><code>${renklendir(kod, dil)}</code></pre>`;
function hucre(v) {
  if (v === null || v === undefined) return '<td class="null">NULL</td>';
  if (typeof v === 'number') { const s = Number.isInteger(v) ? String(v) : String(+v.toFixed(4)); return `<td class="say">${s}</td>`; }
  if (typeof v === 'boolean') return `<td>${v ? 'True' : 'False'}</td>`;
  if (v === '') return '<td class="null">(boş)</td>';
  return `<td>${esc(v)}</td>`;
}
function tabloHTML(t, max = 200) {
  if (!t || !t.columns) return '';
  const satir = t.rows.slice(0, max);
  return `<div class="tablo-kap"><table class="sonuc"><thead><tr>${t.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${satir.map(r => `<tr>${r.map(hucre).join('')}</tr>`).join('')}</tbody></table></div>
  <div class="tablo-alt">${t.total ?? t.rows.length} satır × ${t.columns.length} sütun${(t.total ?? t.rows.length) > max ? ` · ilk ${max} satır gösteriliyor` : ''}</div>`;
}
function ciktiHTML(r) {
  if (!r) return '';
  let h = '';
  if (r.stdout) h += `<div class="konsol"><div class="konsol-baslik">print çıktısı</div><pre>${esc(r.stdout)}</pre></div>`;
  if (!r.ok) h += `<div class="hata-kutu"><b>Hata</b><pre>${esc(r.error)}</pre></div>`;
  else if (r.table) h += tabloHTML(r.table);
  else if (r.mesaj) h += `<div class="bilgi">${esc(r.mesaj)}</div>`;
  if (r.ms !== undefined && r.ok) h += `<div class="sure">${r.ms} ms</div>`;
  return h;
}
function mdLite(s) {
  let h = esc(s);
  h = h.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, c) => `<pre class="kod-blok"><code>${c}</code></pre>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  h = h.split(/\n{2,}/).map(p => /^\s*[-•*] /m.test(p) && !p.includes('<pre') ? '<ul>' + p.split('\n').filter(Boolean).map(l => `<li>${l.replace(/^\s*[-•*] /, '')}</li>`).join('') + '</ul>' : p.includes('<pre') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  return h;
}

// ═══════════════ Editör ═══════════════
let aktifEditor = null;
function editorKur(host, { deger = '', dil = 'sql', calistir: onRun, degisti, yukseklik = 200, yerTutucu = '' }) {
  host.innerHTML = `<div class="editor" style="--h:${yukseklik}px"><pre class="gutter" aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="${dil === 'sql' ? 'SQL sorgusu' : 'Python kodu'}"></textarea></div>`;
  const ta = $('textarea', host), gut = $('.gutter', host);
  const guncelle = () => { const n = ta.value.split('\n').length; gut.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); gut.scrollTop = ta.scrollTop; };
  const ekle = t => { ta.focus(); if (!document.execCommand('insertText', false, t)) { ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end'); } guncelle(); degisti && degisti(ta.value); };
  ta.value = deger; ta.placeholder = yerTutucu; guncelle();
  ta.addEventListener('input', () => { guncelle(); degisti && degisti(ta.value); });
  ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; });
  ta.addEventListener('focus', () => { aktifEditor = api; });
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onRun && onRun(); return; }
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ekle('    '); return; }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault(); const bas = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const bosluk = (ta.value.slice(bas).match(/^ {1,4}/) || [''])[0].length;
      if (bosluk) { const s = ta.selectionStart; ta.setSelectionRange(bas, bas + bosluk); document.execCommand('delete') || ta.setRangeText('', bas, bas + bosluk); ta.setSelectionRange(Math.max(bas, s - bosluk), Math.max(bas, s - bosluk)); guncelle(); }
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      const bas = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const satir = ta.value.slice(bas, ta.selectionStart);
      let girinti = (satir.match(/^\s*/) || [''])[0];
      if (dil === 'python' && /:\s*$/.test(satir)) girinti += '    ';
      if (girinti) { e.preventDefault(); ekle('\n' + girinti); }
    }
  });
  const api = { get: () => ta.value, set: v => { ta.value = v; guncelle(); degisti && degisti(v); }, ekle, odak: () => ta.focus(), dil };
  aktifEditor = api;
  return api;
}

// ═══════════════ Şema paneli ═══════════════
function semaHTML(dil) {
  const vs = VS[S.veriSeti];
  const pyTip = dil === 'python' && pyYukluVS === S.veriSeti;
  return `<div class="sema-baslik"><span>Tablolar</span><span class="kucuk">${dil === 'python' ? 'DataFrame olarak hazır' : 'SQLite'}</span></div>` +
    Object.entries(vs.tablolar).map(([ad, t]) => `<details class="sema-tablo" open><summary><button class="ekle-btn tablo-ad" data-ekle="${esc(ad)}" title="Editöre ekle">${esc(ad)}</button><span class="kucuk">${t.rows.length} satır</span></summary><ul>${t.columns.map((c, i) => {
      const tip = pyTip ? ((pyTipler[ad] || []).find(x => x[0] === c) || [, ''])[1] : t.types[i];
      return `<li><button class="ekle-btn" data-ekle="${esc(c)}" title="Editöre ekle">${esc(c)}</button><span class="tip">${esc(String(tip || '').toLowerCase())}</span></li>`;
    }).join('')}</ul></details>`).join('') + `<p class="kucuk sema-not">İsme tıklayınca imlecin olduğu yere eklenir.${dil === 'python' ? ' Tarih sütunları datetime tipinde gelir.' : ''}</p>`;
}
document.addEventListener('click', e => { const b = e.target.closest('.ekle-btn'); if (b && aktifEditor) { e.preventDefault(); aktifEditor.ekle(b.dataset.ekle); } });

// ═══════════════ Üst bar ═══════════════
function ilerlemeMetni() {
  const qs = VS[S.veriSeti] ? VS[S.veriSeti].sorular : [];
  const say = d => { const l = qs.filter(q => q.dil === d); return `${l.filter(q => depo.cozuldu[q.id]).length}/${l.length}`; };
  return `SQL ${say('sql')} · Python ${say('python')}`;
}
function ustCiz() {
  $$('.nav-btn').forEach(b => b.setAttribute('aria-current', b.dataset.view === S.view ? 'page' : 'false'));
  const sel = $('#vsSec');
  sel.innerHTML = HAZIR.map(k => `<option value="${k}">${esc(VS[k].ad)}</option>`).join('') + (VS.yuklenen ? `<option value="yuklenen">${esc(VS.yuklenen.ad)}</option>` : '');
  sel.value = S.veriSeti;
  $('#ilerleme').textContent = ilerlemeMetni();
  pyDurumAyarla(pyDurum);
}
$('#vsSec').addEventListener('change', e => { veriSetiDegistir(e.target.value); });
function veriSetiDegistir(k) { S.veriSeti = k; S.mulakat = null; S.filtre.kategori = ''; S.serbestKod = varsayilanKod(k); yenidenCiz(); }
$$('.nav-btn').forEach(b => b.addEventListener('click', () => git(b.dataset.view)));
const VIEWLER = ['alistirma', 'tahmin', 'mulakat', 'serbest', 'veri'];
function git(v) { if (location.hash !== '#' + v) location.hash = v; else { S.view = v; yenidenCiz(); } }
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWLER.includes(v)) { S.view = v; yenidenCiz(); } });
let sayacInterval = null;
function yenidenCiz() {
  if (sayacInterval && !(S.view === 'mulakat' && S.mulakat && S.mulakat.durum === 'devam')) { clearInterval(sayacInterval); sayacInterval = null; }
  ustCiz();
  const ana = $('#ana');
  ana.dataset.view = S.view;
  ({ alistirma: alistirmaCiz, tahmin: tahminCiz, mulakat: mulakatCiz, serbest: serbestCiz, veri: veriCiz })[S.view]();
}

// ═══════════════ ALIŞTIRMALAR ═══════════════
function filtreliSorular() {
  const vs = VS[S.veriSeti]; const f = S.filtre;
  return vs.sorular.filter(q => q.dil === f.dil && (!f.seviye || q.seviye === f.seviye) && (!f.kategori || q.kategori === f.kategori))
    .sort((a, b) => a.seviye - b.seviye);
}
function alistirmaCiz() {
  const vs = VS[S.veriSeti];
  const ana = $('#ana');
  if (!vs.sorular.length) { ana.innerHTML = bosSoruHTML(); bosSoruBagla(); return; }
  if (!vs.sorular.some(q => q.dil === S.filtre.dil)) S.filtre.dil = vs.sorular[0].dil;
  const liste = filtreliSorular();
  const kategoriler = [...new Set(vs.sorular.filter(q => q.dil === S.filtre.dil).map(q => q.kategori))];
  let aktif = vs.sorular.find(q => q.id === S.aktifId[S.veriSeti] && q.dil === S.filtre.dil) || liste[0];
  if (aktif) S.aktifId[S.veriSeti] = aktif.id;
  ana.innerHTML = `
  <div class="uc-kolon">
    <aside class="soru-liste" aria-label="Soru listesi">
      <div class="seg" role="tablist">${['sql', 'python'].map(d => `<button role="tab" class="seg-btn dil-${d}" aria-selected="${S.filtre.dil === d}" data-dil="${d}">${DIL[d]}</button>`).join('')}</div>
      <div class="filtreler">
        <div class="chipler">${[0, 1, 2, 3].map(l => `<button class="chip ${S.filtre.seviye === l ? 'secili' : ''}" data-seviye="${l}">${l ? SEVIYE[l] : 'Tümü'}</button>`).join('')}</div>
        <label class="gizli" for="katSec">Kategori</label>
        <select id="katSec"><option value="">Tüm kategoriler</option>${kategoriler.map(k => `<option ${S.filtre.kategori === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      </div>
      <ol class="sorular">${liste.map((q, i) => `<li><button class="soru-satir ${aktif && q.id === aktif.id ? 'aktif' : ''}" data-id="${q.id}">
        <span class="no">${depo.cozuldu[q.id] ? '<span class="tik" aria-label="çözüldü">✓</span>' : i + 1}</span>
        <span class="ad">${esc(q.baslik)}<span class="kat">${esc(q.kategori)}</span></span>
        <span class="sev sev-${q.seviye}">${SEVIYE[q.seviye]}</span></button></li>`).join('') || '<li class="kucuk bos-not">Bu filtreye uyan soru yok.</li>'}</ol>
    </aside>
    <section class="calisma" id="calisma"></section>
    <aside class="sema" id="sema">${semaHTML(S.filtre.dil)}</aside>
  </div>`;
  $$('.seg-btn', ana).forEach(b => b.onclick = () => { S.filtre.dil = b.dataset.dil; S.filtre.kategori = ''; if (b.dataset.dil === 'python') pyHazirla().then(() => { pyVeriYukle(S.veriSeti); const s = $('#sema'); if (s && S.view === 'alistirma') s.innerHTML = semaHTML('python'); }).catch(() => { }); alistirmaCiz(); });
  $$('.chip[data-seviye]', ana).forEach(b => b.onclick = () => { S.filtre.seviye = +b.dataset.seviye; alistirmaCiz(); });
  $('#katSec').onchange = e => { S.filtre.kategori = e.target.value; alistirmaCiz(); };
  $$('.soru-satir', ana).forEach(b => b.onclick = () => { S.aktifId[S.veriSeti] = b.dataset.id; alistirmaCiz(); });
  if (aktif) soruCalismaCiz($('#calisma'), aktif, { mod: 'alistirma', liste });
}

// Tek bir sorunun çalışma alanı (alıştırma + mülakat ortak)
function soruCalismaCiz(host, q, { mod, liste, onKontrol }) {
  const mulakat = mod === 'mulakat';
  const idx = liste ? liste.findIndex(x => x.id === q.id) : -1;
  const yerTutucu = q.dil === 'sql' ? '-- Sorgunu buraya yaz' : '# Cevabını sonuc değişkenine ata\nsonuc = ...';
  // Eski sürümde başlangıç yazısı editöre gerçek metin olarak konuyordu; değiştirilmemiş eski taslaklar boş sayılır.
  const ESKI_BASLANGIC = ['-- Sorgunu buraya yaz\n', '# Cevabını sonuc değişkenine ata\nsonuc = '];
  let ilkKod = (mulakat ? S.mulakat.kod[q.id] : depo.taslak[q.id]) ?? '';
  if (ESKI_BASLANGIC.includes(ilkKod)) ilkKod = '';
  host.innerHTML = `
    <div class="soru-kart">
      <div class="rozetler"><span class="rozet dil-${q.dil}">${DIL[q.dil]}</span><span class="rozet sev-${q.seviye}">${SEVIYE[q.seviye]}</span><span class="rozet">${esc(q.kategori)}</span>${q.sirali ? '<span class="rozet uyari">Sıralama önemli</span>' : ''}</div>
      <h2>${esc(q.baslik)}</h2>
      <div class="soru-metni">${q.soru}</div>
      <details class="beklenen" open><summary>Beklenen çıktı</summary><div id="beklenen" class="beklenen-ic">${q.dil === 'python' && pyDurum !== 'hazir' ? pyBekleHTML() : '<div class="yukleniyor">Hesaplanıyor…</div>'}</div></details>
    </div>
    <div class="editor-alan">
      <div id="ed"></div>
      <div class="arac-cubugu">
        <button class="btn birincil" id="btnCalistir">Çalıştır <kbd>Ctrl</kbd><kbd>Enter</kbd></button>
        <button class="btn vurgu" id="btnKontrol">Kontrol et</button>
        ${mulakat ? '' : `<span class="ayrac"></span>
        <button class="btn hafif" id="btnIpucu">İpucu</button>
        <button class="btn hafif" id="btnCevap">Cevabı göster</button>
        <button class="btn hafif" id="btnNeden">Neden böyle?</button>`}
      </div>
    </div>
    <div id="karar"></div>
    <div id="ekKutular"></div>
    <div class="cikti" id="cikti"><div class="cikti-bos">Çıktın burada görünecek. Önce <b>Çalıştır</b> ile sonucu gör, emin olunca <b>Kontrol et</b>.</div></div>
    ${!mulakat && liste ? `<div class="gezinme">
      <button class="btn hafif" id="onceki" ${idx <= 0 ? 'disabled' : ''}>← Önceki soru</button>
      <button class="btn hafif" id="sonraki" ${idx < 0 || idx >= liste.length - 1 ? 'disabled' : ''}>Sonraki soru →</button></div>` : ''}`;
  const taslakKey = (mulakat ? 'm_' : '') + q.id;
  const ed = editorKur($('#ed', host), {
    deger: ilkKod, yerTutucu, dil: q.dil, calistir: () => calistirTik(),
    degisti: v => { if (mulakat) S.mulakat.kod[q.id] = v; else { depo.taslak[q.id] = v; kaydetGecikmeli(); } }
  });
  let sonCikti = null;
  beklenenAl(q).then(r => {
    const b = $('#beklenen', host); if (!b) return;
    if (!r.ok) b.innerHTML = `<div class="hata-kutu">Beklenen çıktı hesaplanamadı: ${esc(r.error)}</div>`;
    else b.innerHTML = tabloHTML(r.table, 8);
  }).catch(e => { const b = $('#beklenen', host); if (b) b.innerHTML = hataHTML(e); });

  async function calistirTik() {
    const c = $('#cikti', host);
    if (!ed.get().trim()) { c.innerHTML = `<div class="bilgi">Editör boş. Önce ${q.dil === 'sql' ? 'sorgunu' : 'kodunu'} yaz.</div>`; return null; }
    c.innerHTML = q.dil === 'python' && pyDurum !== 'hazir' ? pyBekleHTML() : '<div class="yukleniyor">Çalışıyor…</div>';
    await bekle(16);
    try { sonCikti = await calistir(q.dil, ed.get(), true); c.innerHTML = ciktiHTML(sonCikti); }
    catch (e) { c.innerHTML = hataHTML(e); }
    return sonCikti;
  }
  async function kontrolTik() {
    const k = $('#karar', host);
    if (!ed.get().trim()) { k.innerHTML = `<div class="bilgi">Editör boş. Önce ${q.dil === 'sql' ? 'sorgunu' : 'kodunu'} yaz, sonra kontrol et.</div>`; return; }
    k.innerHTML = '<div class="yukleniyor">Kontrol ediliyor…</div>';
    const [bek, gel] = await Promise.all([beklenenAl(q), calistirTik()]);
    let sonuc;
    if (!gel || !gel.ok) sonuc = { dogru: false, mesaj: 'Kodun hata verdi. Aşağıdaki hata mesajına bak.' };
    else if (!bek.ok) sonuc = { dogru: false, mesaj: 'Beklenen çıktı hesaplanamadığı için kontrol yapılamadı.' };
    else sonuc = karsilastir(bek.table, gel.table, q.sirali);
    if (sonuc.dogru && !mulakat) { depo.cozuldu[q.id] = true; kaydet(); ustCiz(); const li = $(`.soru-satir[data-id="${q.id}"] .no`); if (li) li.innerHTML = '<span class="tik" aria-label="çözüldü">✓</span>'; }
    k.innerHTML = `<div class="karar ${sonuc.dogru ? 'dogru' : 'yanlis'}" role="status"><span class="karar-ikon" aria-hidden="true">${sonuc.dogru ? '✓' : '✕'}</span><div>${sonuc.mesaj}
      ${!sonuc.dogru && !mulakat && S.claude ? '<div><button class="btn kucuk-btn" id="btnHata">Claude hatamı açıklasın</button></div>' : ''}</div></div>`;
    const hb = $('#btnHata', host); if (hb) hb.onclick = () => hataAcikla(q, ed.get(), gel, bek, sonuc);
    onKontrol && onKontrol(sonuc.dogru);
  }
  function kutu(id, baslik, ic) {
    const ek = $('#ekKutular', host);
    let el = $('#' + id, ek);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'ek-kutu ' + id; ek.appendChild(el); }
    el.innerHTML = `<div class="ek-baslik">${baslik}</div>${ic}`;
    return el;
  }
  function cevapGoster() {
    const el = kutu('kCevap', 'Örnek çözüm', kodBlok(q.cozum, q.dil) + '<button class="btn kucuk-btn" data-kopyala>Editöre aktar</button>');
    $('[data-kopyala]', el).onclick = () => { ed.set(q.cozum); ed.odak(); };
  }
  $('#btnCalistir', host).onclick = calistirTik;
  $('#btnKontrol', host).onclick = kontrolTik;
  if (!mulakat) {
    $('#btnIpucu', host).onclick = () => kutu('kIpucu', 'İpucu', `<p>${q.ipucu || 'Bu soru için ipucu yok.'}</p>`);
    $('#btnCevap', host).onclick = cevapGoster;
    $('#btnNeden', host).onclick = () => { cevapGoster(); kutu('kNeden', 'Neden böyle yazıldı?', `<div class="aciklama">${q.aciklama || '<p>Açıklama yok.</p>'}</div>`); };
    const o = $('#onceki', host), s = $('#sonraki', host);
    if (o) o.onclick = () => { S.aktifId[S.veriSeti] = liste[idx - 1].id; alistirmaCiz(); };
    if (s) s.onclick = () => { S.aktifId[S.veriSeti] = liste[idx + 1].id; alistirmaCiz(); };
  }
  return { ed };
}
let kaydetT = null;
function kaydetGecikmeli() { clearTimeout(kaydetT); kaydetT = setTimeout(kaydet, 600); }

function tabloOzet(t, n = 8) {
  if (!t || !t.columns) return '(tablo yok)';
  return [t.columns.join(' | '), ...t.rows.slice(0, n).map(r => r.map(v => v === null ? 'NULL' : typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : v).join(' | '))].join('\n') + `\n(${t.total ?? t.rows.length} satır × ${t.columns.length} sütun)`;
}
function semaOzet() {
  return Object.entries(VS[S.veriSeti].tablolar).map(([ad, t]) => `${ad}(${t.columns.map((c, i) => `${c} ${t.types[i]}`).join(', ')}) — ${t.rows.length} satır`).join('\n');
}
async function hataAcikla(q, kod, gel, bek, sonuc) {
  const el = document.createElement('div');
  el.className = 'ek-kutu kClaude';
  el.innerHTML = '<div class="ek-baslik">Claude\'un yorumu</div><div class="claude-metin"><div class="yukleniyor">Kodun inceleniyor…</div></div>';
  const ek = $('#ekKutular'); const eski = $('.kClaude', ek); if (eski) eski.remove(); ek.prepend(el);
  const hedef = $('.claude-metin', el);
  const prompt = `Sen sabırlı bir veri analizi eğitmenisin. Öğrencin bir ${q.dil === 'sql' ? 'SQL (SQLite)' : 'Python (pandas)'} alıştırmasında yanlış cevap verdi. Türkçe, kısa ve öğretici bir geri bildirim ver:
- Kodundaki asıl hatayı ya da eksik düşünceyi açıkça söyle (neden yanlış sonuç ürettiğini).
- Doğru yöne götüren 1-2 somut ipucu ver.
- Tam çözümü YAZMA. En fazla tek satırlık küçük bir parça gösterebilirsin.
- En fazla 150 kelime. Markdown olarak sadece **kalın**, \`kod\` ve - madde kullan.

Tablolar:
${semaOzet()}
${q.dil === 'python' ? 'Python\'da her tablo aynı isimle bir DataFrame; sonuç `sonuc` değişkeninden okunur.' : ''}

Soru: ${metin(q.soru)}
${q.sirali ? '(Bu soruda satır sırası önemli.)' : ''}

Beklenen çıktı (ilk satırlar):
${bek && bek.ok ? tabloOzet(bek.table) : '-'}

Öğrencinin kodu:
${kod}

Öğrencinin çıktısı:
${gel && gel.ok ? tabloOzet(gel.table) : 'HATA: ' + (gel ? gel.error : '-')}

Otomatik kontrolün mesajı: ${metin(sonuc.mesaj)}`;
  try { const r = await claudeSor(prompt, { onText: ({ text }) => { hedef.innerHTML = mdLite(text); } }); hedef.innerHTML = mdLite(r.text); }
  catch (e) { hedef.innerHTML = `<div class="hata-kutu">${esc(claudeHata(e))}</div>`; }
}

// ═══════════════ TAHMİN ET ═══════════════
function tahminCiz() {
  const ana = $('#ana');
  const liste = TAHMINLER.filter(t => t.dil === S.tahminDil);
  let t = liste.find(x => x.id === S.tahminId) || liste[0];
  S.tahminId = t.id;
  const dogruSay = TAHMINLER.filter(x => depo.tahmin[x.id] === true).length;
  ana.innerHTML = `
  <div class="iki-kolon">
    <aside class="soru-liste">
      <div class="seg" role="tablist">${['sql', 'python'].map(d => `<button role="tab" class="seg-btn dil-${d}" aria-selected="${S.tahminDil === d}" data-dil="${d}">${DIL[d]}</button>`).join('')}</div>
      <p class="kucuk liste-not">Kodu çalıştırmadan, sonucunu tahmin et. Küçük, kendi içinde verisi olan örnekler. Doğru tahmin: <b>${dogruSay}/${TAHMINLER.length}</b></p>
      <ol class="sorular">${liste.map((x, i) => `<li><button class="soru-satir ${x.id === t.id ? 'aktif' : ''}" data-id="${x.id}">
        <span class="no">${depo.tahmin[x.id] === true ? '<span class="tik">✓</span>' : depo.tahmin[x.id] === false ? '<span class="carpi">✕</span>' : i + 1}</span>
        <span class="ad">${esc(x.konu)}</span></button></li>`).join('')}</ol>
    </aside>
    <section class="calisma">
      <div class="soru-kart">
        <div class="rozetler"><span class="rozet dil-${t.dil}">${DIL[t.dil]}</span><span class="rozet">${esc(t.konu)}</span></div>
        <h2>Bu kod ne döndürür?</h2>
        ${kodBlok(t.kod, t.dil)}
        <div class="soru-metni">${t.soru}</div>
        <div class="secenekler" role="group" aria-label="Seçenekler">${t.secenekler.map((s, i) => `<button class="secenek" data-i="${i}"><span class="harf">${'ABCD'[i]}</span>${esc(s)}</button>`).join('')}</div>
      </div>
      <div id="tahminSonuc"></div>
      <div class="gezinme"><button class="btn hafif" id="tOnceki" ${liste.indexOf(t) <= 0 ? 'disabled' : ''}>← Önceki</button><button class="btn hafif" id="tSonraki" ${liste.indexOf(t) >= liste.length - 1 ? 'disabled' : ''}>Sonraki →</button></div>
    </section>
  </div>`;
  $$('.seg-btn', ana).forEach(b => b.onclick = () => { S.tahminDil = b.dataset.dil; S.tahminId = null; tahminCiz(); });
  $$('.soru-satir', ana).forEach(b => b.onclick = () => { S.tahminId = b.dataset.id; tahminCiz(); });
  const i = liste.indexOf(t);
  $('#tOnceki').onclick = () => { S.tahminId = liste[i - 1].id; tahminCiz(); };
  $('#tSonraki').onclick = () => { S.tahminId = liste[i + 1].id; tahminCiz(); };
  $$('.secenek', ana).forEach(b => b.onclick = async () => {
    const sec = +b.dataset.i, dogru = sec === t.dogru;
    if (depo.tahmin[t.id] === undefined) { depo.tahmin[t.id] = dogru; kaydet(); }
    $$('.secenek', ana).forEach(x => { x.disabled = true; const k = +x.dataset.i; if (k === t.dogru) x.classList.add('dogru'); else if (k === sec) x.classList.add('yanlis'); });
    const s = $('#tahminSonuc');
    s.innerHTML = `<div class="karar ${dogru ? 'dogru' : 'yanlis'}"><span class="karar-ikon">${dogru ? '✓' : '✕'}</span><div>${dogru ? 'Doğru tahmin!' : `Doğru cevap: <b>${esc(t.secenekler[t.dogru])}</b>`}</div></div>
      <div class="ek-kutu"><div class="ek-baslik">Neden?</div><div class="aciklama">${t.aciklama}</div></div>
      <div class="ek-kutu"><div class="ek-baslik">Kodu çalıştırınca gerçek çıktı</div><div id="tCikti">${t.dil === 'python' && pyDurum !== 'hazir' ? pyBekleHTML() : '<div class="yukleniyor">Çalışıyor…</div>'}</div></div>`;
    await bekle(16);
    try { const r = await calistir(t.dil, t.kod, true); const c = $('#tCikti'); if (c) c.innerHTML = ciktiHTML(r); }
    catch (e) { const c = $('#tCikti'); if (c) c.innerHTML = hataHTML(e); }
    const li = $(`.soru-satir[data-id="${t.id}"] .no`); if (li) li.innerHTML = depo.tahmin[t.id] ? '<span class="tik">✓</span>' : '<span class="carpi">✕</span>';
  });
}

// ═══════════════ MÜLAKAT ═══════════════
function mulakatCiz() {
  const ana = $('#ana');
  if (S.mulakat && S.mulakat.durum === 'devam') return kodMulakatCiz();
  if (S.mulakat && S.mulakat.durum === 'bitti') return kodSonucCiz();
  if (S.teorik && S.teorik.durum === 'devam') return teorikCiz();
  if (S.teorik && S.teorik.durum === 'bitti') return teorikSonucCiz();
  const sorular = VS[S.veriSeti].sorular;
  ana.innerHTML = `
  <div class="mulakat-giris">
    <div class="giris-baslik"><h1>Mülakat provası</h1><p>İki farklı mod var. Kod mülakatında süre işler ve ipucu yoktur. Teorik mülakatta test soruları ve açık uçlu sorular gelir.</p></div>
    <div class="mod-kartlar">
      <form class="mod-kart" id="kodForm">
        <div class="mod-ust"><span class="mod-etiket">Mod 1</span><h2>Kod mülakatı</h2><p>Kolaydan zora sıralı sorular, süre sınırı, sonunda karne. Sorular <b>${esc(VS[S.veriSeti].ad)}</b> verisinden.</p></div>
        <fieldset><legend>Dil</legend><div class="radyo">${[['sql', 'SQL'], ['python', 'Python'], ['karisik', 'Karışık']].map(([v, l], i) => `<label><input type="radio" name="dil" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
        <fieldset><legend>Soru sayısı</legend><div class="radyo">${[3, 5, 8].map(n => `<label><input type="radio" name="n" value="${n}" ${n === 5 ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></fieldset>
        <fieldset><legend>Süre</legend><div class="radyo">${[15, 25, 40].map(n => `<label><input type="radio" name="sure" value="${n}" ${n === 25 ? 'checked' : ''}><span>${n} dk</span></label>`).join('')}</div></fieldset>
        <button class="btn birincil genis" type="submit" ${sorular.length ? '' : 'disabled'}>Kod mülakatını başlat</button>
        ${sorular.length ? '' : '<p class="kucuk">Bu veri seti için henüz soru yok. Veri sekmesinden soru üretebilirsin.</p>'}
      </form>
      <form class="mod-kart" id="teoForm">
        <div class="mod-ust"><span class="mod-etiket">Mod 2</span><h2>Teorik mülakat</h2><p>Kavram soruları: test soruları anında puanlanır. Açık uçlu sorularda cevabını yazarsın, ${S.claude ? 'Claude değerlendirir' : 'anahtar noktalarla karşılaştırırsın'}.</p></div>
        <fieldset><legend>Alan</legend><div class="radyo">${[['karisik', 'Karışık'], ['sql', 'SQL'], ['python', 'Python'], ['genel', 'Analitik']].map(([v, l], i) => `<label><input type="radio" name="alan" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
        <fieldset><legend>İçerik</legend><div class="radyo">${[['ikisi', 'Test + açık uçlu'], ['test', 'Sadece test'], ['acik', 'Sadece açık uçlu']].map(([v, l], i) => `<label><input type="radio" name="tur" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
        <button class="btn birincil genis" type="submit">Teorik mülakatı başlat</button>
      </form>
    </div>
  </div>`;
  $('#kodForm').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    const dil = f.get('dil'), n = +f.get('n'), dk = +f.get('sure');
    let havuz = sorular.filter(q => dil === 'karisik' || q.dil === dil);
    if (!havuz.length) havuz = sorular;
    const plan = n <= 3 ? [1, 2, 3] : n <= 5 ? [1, 2, 2, 3, 3] : [1, 1, 2, 2, 2, 3, 3, 3];
    const secilen = [], kul = new Set();
    for (const l of plan) { const c = karistir(havuz.filter(q => q.seviye === l && !kul.has(q.id)))[0] || karistir(havuz.filter(q => !kul.has(q.id)))[0]; if (c) { secilen.push(c); kul.add(c.id); } }
    secilen.sort((a, b) => a.seviye - b.seviye);
    if (secilen.some(q => q.dil === 'python')) pyHazirla().catch(() => { });
    S.mulakat = { durum: 'devam', sorular: secilen, i: 0, sonuc: {}, kod: {}, bitis: Date.now() + dk * 60000, baslangic: Date.now(), dk };
    mulakatCiz();
  };
  $('#teoForm').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target);
    const alan = f.get('alan'), tur = f.get('tur');
    const uy = x => alan === 'karisik' || x.alan === alan;
    const test = tur === 'acik' ? [] : karistir(TEORIK_TEST.filter(uy)).slice(0, 8);
    const acik = tur === 'test' ? [] : karistir(TEORIK_ACIK.filter(uy)).slice(0, tur === 'acik' ? 4 : 2);
    S.teorik = { durum: 'devam', sorular: [...test.map(x => ({ ...x, tip: 'test' })), ...acik.map(x => ({ ...x, tip: 'acik' }))], i: 0, cevap: {} };
    mulakatCiz();
  };
}
function sureYaz(ms) { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function kodMulakatCiz() {
  const M = S.mulakat, q = M.sorular[M.i], ana = $('#ana');
  ana.innerHTML = `
  <div class="mulakat-ust">
    <div class="ilerleme-noktalar">${M.sorular.map((x, k) => `<button class="nokta ${k === M.i ? 'aktif' : ''} ${M.sonuc[x.id] === true ? 'ok' : M.sonuc[x.id] === false ? 'hayir' : ''}" data-k="${k}" aria-label="Soru ${k + 1}">${k + 1}</button>`).join('')}</div>
    <div class="sayac" id="sayac" aria-live="off">${sureYaz(M.bitis - Date.now())}</div>
    <button class="btn hafif" id="bitir">Mülakatı bitir</button>
  </div>
  <div class="iki-kolon mulakat-govde"><section class="calisma" id="calisma"></section><aside class="sema" id="sema">${semaHTML(q.dil)}</aside></div>
  <div class="gezinme"><button class="btn hafif" id="mOnceki" ${M.i === 0 ? 'disabled' : ''}>← Önceki</button><button class="btn" id="mSonraki">${M.i === M.sorular.length - 1 ? 'Bitir ve karneyi gör' : 'Sonraki soru →'}</button></div>`;
  soruCalismaCiz($('#calisma'), q, { mod: 'mulakat', onKontrol: d => { if (M.sonuc[q.id] !== true) M.sonuc[q.id] = d; const n = $(`.nokta[data-k="${M.i}"]`); if (n) { n.classList.toggle('ok', M.sonuc[q.id] === true); n.classList.toggle('hayir', M.sonuc[q.id] === false); } } });
  $$('.nokta', ana).forEach(b => b.onclick = () => { M.i = +b.dataset.k; kodMulakatCiz(); });
  $('#mOnceki').onclick = () => { M.i--; kodMulakatCiz(); };
  $('#mSonraki').onclick = () => { if (M.i === M.sorular.length - 1) mulakatBitir(); else { M.i++; kodMulakatCiz(); } };
  $('#bitir').onclick = mulakatBitir;
  clearInterval(sayacInterval);
  sayacInterval = setInterval(() => { const kalan = M.bitis - Date.now(); const el = $('#sayac'); if (el) { el.textContent = sureYaz(kalan); el.classList.toggle('az', kalan < 120000); } if (kalan <= 0) mulakatBitir(true); }, 500);
}
function mulakatBitir(sureDoldu) {
  const M = S.mulakat; if (!M || M.durum !== 'devam') return;
  clearInterval(sayacInterval); sayacInterval = null;
  M.durum = 'bitti'; M.gecen = Math.min(Date.now(), M.bitis) - M.baslangic; M.sureDoldu = !!sureDoldu;
  M.sorular.forEach(q => { if (M.sonuc[q.id] === true) { depo.cozuldu[q.id] = true; } }); kaydet();
  mulakatCiz();
}
function kodSonucCiz() {
  const M = S.mulakat, ana = $('#ana');
  const dogru = M.sorular.filter(q => M.sonuc[q.id] === true).length;
  const kat = {};
  M.sorular.forEach(q => { kat[q.kategori] = kat[q.kategori] || [0, 0]; kat[q.kategori][1]++; if (M.sonuc[q.id] === true) kat[q.kategori][0]++; });
  const oran = dogru / M.sorular.length;
  ana.innerHTML = `
  <div class="karne">
    <div class="karne-ust">
      <div><span class="mod-etiket">Kod mülakatı karnesi</span><h1>${dogru} / ${M.sorular.length} doğru</h1>
      <p>${M.sureDoldu ? 'Süre doldu. ' : ''}Geçen süre: <b>${sureYaz(M.gecen)}</b> / ${M.dk} dk. ${oran === 1 ? 'Tüm sorular doğru, harika iş.' : oran >= 0.6 ? 'İyi bir sonuç. Kaçırdığın soruların açıklamalarına bak.' : 'Zorlandığın konuları Alıştırmalar\'dan tekrar etmek iyi olur.'}</p></div>
      <div class="karne-skor" style="--oran:${oran}"><span>%${Math.round(oran * 100)}</span></div>
    </div>
    <div class="kat-ozet">${Object.entries(kat).map(([k, [a, b]]) => `<span class="chip ${a === b ? 'ok' : a === 0 ? 'hayir' : ''}">${esc(k)} <b>${a}/${b}</b></span>`).join('')}</div>
    <div class="karne-liste">${M.sorular.map((q, k) => `
      <details class="karne-satir ${M.sonuc[q.id] === true ? 'ok' : M.sonuc[q.id] === false ? 'hayir' : 'bos'}">
        <summary><span class="durum-ikon">${M.sonuc[q.id] === true ? '✓' : M.sonuc[q.id] === false ? '✕' : '–'}</span><span class="ad">${k + 1}. ${esc(q.baslik)}</span><span class="rozet dil-${q.dil}">${DIL[q.dil]}</span><span class="sev sev-${q.seviye}">${SEVIYE[q.seviye]}</span><span class="kucuk">${M.sonuc[q.id] === undefined ? 'kontrol edilmedi' : ''}</span></summary>
        <div class="karne-detay"><div class="soru-metni">${q.soru}</div>
          ${M.kod[q.id] ? `<div class="ek-baslik">Senin cevabın</div>${kodBlok(M.kod[q.id], q.dil)}` : ''}
          <div class="ek-baslik">Örnek çözüm</div>${kodBlok(q.cozum, q.dil)}
          <div class="ek-baslik">Neden böyle?</div><div class="aciklama">${q.aciklama}</div></div>
      </details>`).join('')}</div>
    <div class="gezinme"><button class="btn" id="yeniM">Yeni mülakat</button><button class="btn hafif" id="alistirmaGit">Alıştırmalara dön</button></div>
  </div>`;
  $('#yeniM').onclick = () => { S.mulakat = null; mulakatCiz(); };
  $('#alistirmaGit').onclick = () => { S.mulakat = null; git('alistirma'); };
}
function teorikCiz() {
  const T = S.teorik, q = T.sorular[T.i], ana = $('#ana'), c = T.cevap[q.id];
  const alanAd = { sql: 'SQL', python: 'Python', genel: 'Analitik düşünme' }[q.alan];
  ana.innerHTML = `
  <div class="teorik">
    <div class="mulakat-ust"><div class="ilerleme-noktalar">${T.sorular.map((x, k) => `<button class="nokta ${k === T.i ? 'aktif' : ''} ${T.cevap[x.id] ? (T.cevap[x.id].dogru === true || (T.cevap[x.id].puan ?? 0) >= 6 ? 'ok' : T.cevap[x.id].dogru === false || T.cevap[x.id].puan !== undefined ? 'hayir' : 'cevap') : ''}" data-k="${k}" aria-label="Soru ${k + 1}">${k + 1}</button>`).join('')}</div>
    <span class="kucuk">${q.tip === 'test' ? 'Test sorusu' : 'Açık uçlu'} · ${alanAd}</span><button class="btn hafif" id="tBitir">Bitir</button></div>
    <div class="soru-kart teorik-kart">
      <h2>${esc(q.soru)}</h2>
      ${q.tip === 'test' ? `<div class="secenekler dikey">${q.secenekler.map((s, i) => `<button class="secenek ${c ? (i === q.dogru ? 'dogru' : i === c.sec ? 'yanlis' : '') : ''}" data-i="${i}" ${c ? 'disabled' : ''}><span class="harf">${'ABCD'[i]}</span>${esc(s)}</button>`).join('')}</div>
        ${c ? `<div class="karar ${c.dogru ? 'dogru' : 'yanlis'}"><span class="karar-ikon">${c.dogru ? '✓' : '✕'}</span><div>${c.dogru ? 'Doğru.' : 'Yanlış.'} ${esc(q.aciklama)}</div></div>` : ''}`
      : `<label class="gizli" for="acikCevap">Cevabın</label><textarea id="acikCevap" class="acik-cevap" placeholder="Cevabını mülakattaymış gibi yaz. Madde madde de yazabilirsin.">${esc(c ? c.metin : '')}</textarea>
        <div class="arac-cubugu">${S.claude ? '<button class="btn birincil" id="degerlendir">Claude değerlendirsin</button>' : ''}<button class="btn hafif" id="anahtar">Anahtar noktaları göster</button></div>
        <div id="degerSonuc">${c && c.puan !== undefined ? degerHTML(c) : ''}</div>
        <div id="anahtarKutu">${c && c.anahtarAcik ? anahtarHTML(q) : ''}</div>`}
    </div>
    <div class="gezinme"><button class="btn hafif" id="tOnc" ${T.i === 0 ? 'disabled' : ''}>← Önceki</button><button class="btn" id="tSon">${T.i === T.sorular.length - 1 ? 'Bitir ve sonucu gör' : 'Sonraki →'}</button></div>
  </div>`;
  $$('.nokta', ana).forEach(b => b.onclick = () => { acikKaydet(); T.i = +b.dataset.k; teorikCiz(); });
  $('#tOnc').onclick = () => { acikKaydet(); T.i--; teorikCiz(); };
  $('#tSon').onclick = () => { acikKaydet(); if (T.i === T.sorular.length - 1) { T.durum = 'bitti'; teorikSonucCiz(); } else { T.i++; teorikCiz(); } };
  $('#tBitir').onclick = () => { acikKaydet(); T.durum = 'bitti'; teorikSonucCiz(); };
  function acikKaydet() { const ta = $('#acikCevap'); if (ta) { T.cevap[q.id] = Object.assign(T.cevap[q.id] || {}, { metin: ta.value }); } }
  if (q.tip === 'test') $$('.secenek', ana).forEach(b => b.onclick = () => { const sec = +b.dataset.i; T.cevap[q.id] = { sec, dogru: sec === q.dogru }; teorikCiz(); });
  else {
    $('#anahtar').onclick = () => { acikKaydet(); T.cevap[q.id].anahtarAcik = true; $('#anahtarKutu').innerHTML = anahtarHTML(q); };
    const d = $('#degerlendir');
    if (d) d.onclick = async () => {
      acikKaydet(); const cevap = T.cevap[q.id].metin.trim();
      if (cevap.length < 15) { $('#degerSonuc').innerHTML = '<div class="bilgi">Değerlendirme için biraz daha uzun bir cevap yaz.</div>'; return; }
      d.disabled = true; $('#degerSonuc').innerHTML = '<div class="yukleniyor">Claude cevabını değerlendiriyor…</div>';
      try {
        const r = await claudeJson(`Bir veri analisti mülakatında adayın cevabını değerlendiren deneyimli bir mülakatçısın. Türkçe yanıt ver.
Soru: ${q.soru}
Değerlendirme için anahtar noktalar (rubrik): ${q.anahtar.map(a => '- ' + a).join('\n')}
Adayın cevabı:
"""${cevap}"""

0-10 arası puan ver (anahtar noktaların kapsamı, doğruluk, netlik, iş bağlamı). Adil ama talepkar ol. Yanlış bir bilgi varsa açıkça belirt.
Sadece şu JSON\'u döndür: {"puan": sayı, "ozet": "1-2 cümle genel değerlendirme", "guclu": ["..."], "eksik": ["eksik ya da hatalı noktalar"], "ornek_cumle": "cevabı güçlendirecek, mülakatta söylenebilecek tek bir örnek cümle"}`);
        T.cevap[q.id] = Object.assign(T.cevap[q.id], { puan: Math.max(0, Math.min(10, +r.puan || 0)), ozet: r.ozet, guclu: r.guclu || [], eksik: r.eksik || [], ornek: r.ornek_cumle });
        $('#degerSonuc').innerHTML = degerHTML(T.cevap[q.id]);
        const n = $(`.nokta[data-k="${T.i}"]`); if (n) n.classList.add(T.cevap[q.id].puan >= 6 ? 'ok' : 'hayir');
      } catch (e) { $('#degerSonuc').innerHTML = `<div class="hata-kutu">${esc(claudeHata(e))}</div>`; }
      d.disabled = false;
    };
  }
}
function degerHTML(c) {
  return `<div class="deger"><div class="deger-puan ${c.puan >= 7 ? 'iyi' : c.puan >= 5 ? 'orta' : 'zayif'}"><b>${c.puan}</b><span>/10</span></div><div>
    <p>${esc(c.ozet || '')}</p>
    ${c.guclu.length ? `<div class="ek-baslik">Güçlü yanlar</div><ul>${c.guclu.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${c.eksik.length ? `<div class="ek-baslik">Eksik / geliştirilecek</div><ul>${c.eksik.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${c.ornek ? `<div class="ek-baslik">Şöyle de söyleyebilirsin</div><p class="alinti">${esc(c.ornek)}</p>` : ''}</div></div>`;
}
const anahtarHTML = q => `<div class="ek-kutu"><div class="ek-baslik">İyi bir cevapta olması gerekenler</div><ul>${q.anahtar.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>`;
function teorikSonucCiz() {
  const T = S.teorik, ana = $('#ana');
  const test = T.sorular.filter(q => q.tip === 'test'), acik = T.sorular.filter(q => q.tip === 'acik');
  const td = test.filter(q => T.cevap[q.id] && T.cevap[q.id].dogru).length;
  const puanlar = acik.map(q => T.cevap[q.id] && T.cevap[q.id].puan).filter(p => p !== undefined);
  ana.innerHTML = `
  <div class="karne">
    <div class="karne-ust"><div><span class="mod-etiket">Teorik mülakat sonucu</span>
      <h1>${test.length ? `Test: ${td} / ${test.length}` : ''}${test.length && acik.length ? ' · ' : ''}${acik.length ? `Açık uçlu: ${puanlar.length ? (puanlar.reduce((a, b) => a + b, 0) / puanlar.length).toFixed(1) + ' / 10' : 'puanlanmadı'}` : ''}</h1>
      <p>Aşağıda her sorunun doğru cevabı ve açıklaması var.</p></div></div>
    <div class="karne-liste">${T.sorular.map((q, k) => {
      const c = T.cevap[q.id];
      const ok = q.tip === 'test' ? c && c.dogru : c && c.puan >= 6;
      const durum = !c || (q.tip === 'acik' && c.puan === undefined) ? 'bos' : ok ? 'ok' : 'hayir';
      return `<details class="karne-satir ${durum}"><summary><span class="durum-ikon">${durum === 'ok' ? '✓' : durum === 'hayir' ? '✕' : '–'}</span><span class="ad">${k + 1}. ${esc(q.soru)}</span>${q.tip === 'acik' && c && c.puan !== undefined ? `<b>${c.puan}/10</b>` : ''}</summary>
      <div class="karne-detay">${q.tip === 'test' ? `<p>Doğru cevap: <b>${esc(q.secenekler[q.dogru])}</b>${c && !c.dogru ? `<br><span class="kucuk">Senin cevabın: ${esc(q.secenekler[c.sec])}</span>` : ''}</p><p>${esc(q.aciklama)}</p>`
        : `${c && c.metin ? `<div class="ek-baslik">Senin cevabın</div><p class="alinti">${esc(c.metin)}</p>` : ''}${c && c.puan !== undefined ? degerHTML(c) : ''}${anahtarHTML(q)}`}</div></details>`;
    }).join('')}</div>
    <div class="gezinme"><button class="btn" id="yeniT">Yeni teorik mülakat</button></div>
  </div>`;
  $('#yeniT').onclick = () => { S.teorik = null; mulakatCiz(); };
}

// ═══════════════ SERBEST ALAN ═══════════════
const ORNEKLER = {
  hr: {
    sql: [['İlk 20 satır', 'SELECT EmployeeNumber, Age, Department, JobRole, MonthlyIncome, Attrition\nFROM hr\nLIMIT 20;'], ['Sütunlar', "SELECT name, type FROM pragma_table_info('hr');"], ['Attrition dağılımı', 'SELECT Attrition, COUNT(*) AS adet\nFROM hr\nGROUP BY Attrition;'], ['Kod tabloları', 'SELECT * FROM egitim_kod;']],
    python: [['İlk 10 satır', 'hr.head(10)'], ['Özet istatistik', 'hr.describe().T'], ['Veri tipleri', 'hr.dtypes'], ['Farklı değer sayısı', 'hr.nunique().sort_values()'], ['NumPy dizisi', 'gelir = hr["MonthlyIncome"].to_numpy()\nprint(type(gelir), gelir.dtype, gelir.shape)\ngelir[:10]']]
  },
  ornek: {
  sql: [['İlk 20 sipariş', 'SELECT *\nFROM siparisler\nLIMIT 20;'], ['Tablo yapısı', "SELECT name, type FROM pragma_table_info('siparisler');"], ['Durum dağılımı', 'SELECT durum, COUNT(*) AS adet\nFROM siparisler\nGROUP BY durum\nORDER BY adet DESC;']],
  python: [['İlk 10 satır', 'siparisler.head(10)'], ['Bilgi özeti', 'siparisler.describe()'], ['Veri tipleri', 'siparisler.dtypes'], ['Eksik değerler', 'musteriler.isnull().sum()']]
  }
};
function serbestCiz() {
  const ana = $('#ana'), d = S.serbestDil, vs = VS[S.veriSeti];
  const ilkTablo = Object.keys(vs.tablolar)[0];
  if (!S.serbestKod) S.serbestKod = varsayilanKod(S.veriSeti);
  const ornek = ORNEKLER[S.veriSeti] ? ORNEKLER[S.veriSeti][d] : (d === 'sql' ? [['İlk 20 satır', `SELECT *\nFROM "${ilkTablo}"\nLIMIT 20;`], ['Satır sayısı', `SELECT COUNT(*) FROM "${ilkTablo}";`]] : [['İlk 10 satır', `${ilkTablo}.head(10)`], ['Özet', `${ilkTablo}.describe()`], ['Eksik değerler', `${ilkTablo}.isnull().sum()`]]);
  ana.innerHTML = `
  <div class="iki-kolon serbest">
    <section class="calisma">
      <div class="serbest-ust">
        <div class="seg" role="tablist">${['sql', 'python'].map(x => `<button role="tab" class="seg-btn dil-${x}" aria-selected="${d === x}" data-dil="${x}">${DIL[x]}</button>`).join('')}</div>
        <div class="ornekler"><span class="kucuk">Hazır:</span>${ornek.map(([a], i) => `<button class="chip" data-o="${i}">${esc(a)}</button>`).join('')}</div>
      </div>
      <div class="editor-alan"><div id="ed"></div>
        <div class="arac-cubugu"><button class="btn birincil" id="sCalistir">Çalıştır <kbd>Ctrl</kbd><kbd>Enter</kbd></button>
        ${d === 'sql' ? '<button class="btn hafif" id="sSifirla" title="CREATE/UPDATE/DELETE ile yaptığın değişiklikleri geri alır">Veriyi sıfırla</button>' : '<span class="kucuk">Her çalıştırmada tablolar orijinal haliyle gelir. Değişken saklamak için hepsini aynı hücrede yaz.</span>'}</div></div>
      <div class="cikti" id="cikti"><div class="cikti-bos">Serbest alan: istediğin sorguyu yaz, sonucu gör. Burada kontrol yok, sadece keşif.</div></div>
      ${S.gecmis.filter(g => g.dil === d).length ? `<div class="gecmis"><div class="ek-baslik">Son çalıştırdıkların</div><ul>${S.gecmis.filter(g => g.dil === d).slice(0, 8).map((g, i) => `<li><button class="gecmis-btn" data-g="${S.gecmis.indexOf(g)}"><code>${esc(g.kod.replace(/\s+/g, ' ').slice(0, 90))}</code></button></li>`).join('')}</ul></div>` : ''}
    </section>
    <aside class="sema" id="sema">${semaHTML(d)}</aside>
  </div>`;
  const ed = editorKur($('#ed'), { deger: S.serbestKod[d], dil: d, yukseklik: 240, calistir: () => run(), degisti: v => { S.serbestKod[d] = v; } });
  async function run() {
    const c = $('#cikti'); c.innerHTML = d === 'python' && pyDurum !== 'hazir' ? pyBekleHTML() : '<div class="yukleniyor">Çalışıyor…</div>';
    await bekle(16);
    try {
      const r = await calistir(d, ed.get(), false); c.innerHTML = ciktiHTML(r);
      const k = ed.get().trim(); if (k) { S.gecmis = [{ dil: d, kod: k }, ...S.gecmis.filter(g => !(g.dil === d && g.kod === k))].slice(0, 30); }
      if (d === 'python') { const s = $('#sema'); if (s) s.innerHTML = semaHTML('python'); }
    } catch (e) { c.innerHTML = hataHTML(e); }
  }
  $('#sCalistir').onclick = run;
  const sf = $('#sSifirla'); if (sf) sf.onclick = async () => { await sqlHazir; dbSifirla(S.veriSeti); $('#cikti').innerHTML = '<div class="bilgi">Veri orijinal haline döndü.</div>'; };
  $$('.seg-btn', ana).forEach(b => b.onclick = () => { S.serbestDil = b.dataset.dil; if (b.dataset.dil === 'python') pyHazirla().catch(() => { }); serbestCiz(); });
  $$('.chip[data-o]', ana).forEach(b => b.onclick = () => { ed.set(ornek[+b.dataset.o][1]); run(); });
  $$('.gecmis-btn', ana).forEach(b => b.onclick = () => { ed.set(S.gecmis[+b.dataset.g].kod); ed.odak(); });
}

// ═══════════════ VERİ ═══════════════
function bosSoruHTML() {
  return `<div class="bos-durum"><h2>${esc(VS[S.veriSeti].ad)} için henüz soru yok</h2>
    <p>Yüklediğin veriyle Serbest Alan\'da hemen sorgu yazabilirsin. Alıştırma ve mülakat soruları için Claude bu veriye özel, kolaydan zora sorular üretebilir.</p>
    <div class="arac-cubugu"><button class="btn birincil" data-git="veri">Soru üret</button><button class="btn hafif" data-git="serbest">Serbest Alan\'a git</button></div></div>`;
}
function bosSoruBagla() { $$('[data-git]').forEach(b => b.onclick = () => git(b.dataset.git)); }
function veriCiz() {
  const ana = $('#ana'), Y = VS.yuklenen;
  const ornekT = VS.ornek.tablolar;
  ana.innerHTML = `
  <div class="veri-sayfa">
    <div class="veri-kartlar">
      <article class="veri-kart ${S.veriSeti === 'hr' ? 'secili' : ''}">
        <div class="mod-ust"><span class="mod-etiket">Hazır veri · senin yüklediğin</span><h2>İK Attrition</h2>
        <p>IBM HR Attrition verisi: ${VS.hr.tablolar.hr.rows.length} çalışan, ${VS.hr.tablolar.hr.columns.length} sütun, eksik değer yok. JOIN alıştırmaları için verinin kod sözlüğünden iki küçük tablo eklendi: eğitim seviyeleri (1-5) ve memnuniyet puanları (1-4).</p></div>
        <ul class="tablo-ozet">${Object.entries(VS.hr.tablolar).map(([a, t]) => `<li><code>${a}</code><span>${t.columns.length} sütun · ${t.rows.length} satır</span></li>`).join('')}</ul>
        <p class="kucuk">${VS.hr.sorular.filter(q => q.dil === 'sql').length} SQL + ${VS.hr.sorular.filter(q => q.dil === 'python' && q.kategori !== 'NumPy').length} pandas + ${VS.hr.sorular.filter(q => q.kategori === 'NumPy').length} NumPy sorusu hazır.</p>
        ${S.veriSeti === 'hr' ? '<span class="aktif-etiket">Şu an bu veriyle çalışıyorsun</span>' : '<button class="btn" data-vs="hr">Bu veriyle çalış</button>'}
      </article>
      <article class="veri-kart ${S.veriSeti === 'ornek' ? 'secili' : ''}">
        <div class="mod-ust"><span class="mod-etiket">Hazır veri</span><h2>Örnek Mağaza</h2>
        <p>Bir spor ve giyim perakendecisinin 2023-2024 verisi: ${ornekT.musteriler.rows.length} müşteri, ${ornekT.urunler.rows.length} ürün, ${ornekT.siparisler.rows.length} sipariş. İçinde bilerek bırakılmış eksik değerler ve hiç sipariş vermemiş müşteriler var.</p></div>
        <ul class="tablo-ozet">${Object.entries(ornekT).map(([a, t]) => `<li><code>${a}</code><span>${t.columns.length} sütun · ${t.rows.length} satır</span></li>`).join('')}</ul>
        <p class="kucuk">${SORULAR.filter(q => q.dil === 'sql').length} SQL + ${SORULAR.filter(q => q.dil === 'python').length} Python sorusu hazır.</p>
        ${S.veriSeti === 'ornek' ? '<span class="aktif-etiket">Şu an bu veriyle çalışıyorsun</span>' : '<button class="btn" data-vs="ornek">Bu veriyle çalış</button>'}
      </article>
      <article class="veri-kart ${S.veriSeti === 'yuklenen' ? 'secili' : ''}">
        <div class="mod-ust"><span class="mod-etiket">Kendi verin</span><h2>${Y ? esc(Y.ad) : 'Excel ya da CSV yükle'}</h2>
        <p>${Y ? `${Object.keys(Y.tablolar).length} tablo yüklendi. Her sayfa ayrı bir tablo oldu.` : 'Excel\'deki her sayfa ayrı bir tabloya dönüşür. İlk satır sütun adı olarak okunur. Veri sadece bu tarayıcı sekmesinde işlenir, sayfayı yenileyince tekrar yüklemen gerekir.'}</p></div>
        <label class="birak" id="birak" tabindex="0"><input type="file" id="dosya" accept=".xlsx,.xls,.csv,.xlsm" hidden>
          <span class="birak-ic"><b>${Y ? 'Başka bir dosya yükle' : 'Dosyayı buraya bırak'}</b><span class="kucuk">ya da tıklayıp seç · .xlsx, .xls, .csv</span></span></label>
        <div id="yukDurum"></div>
        ${Y ? `<ul class="tablo-ozet">${Object.entries(Y.tablolar).map(([a, t]) => `<li><code>${esc(a)}</code><span>${t.columns.length} sütun · ${t.rows.length} satır</span></li>`).join('')}</ul>
          ${S.veriSeti === 'yuklenen' ? '<span class="aktif-etiket">Şu an bu veriyle çalışıyorsun</span>' : '<button class="btn" data-vs="yuklenen">Bu veriyle çalış</button>'}` : ''}
      </article>
    </div>
    ${Y ? uretPanelHTML() : ''}
    ${Y ? `<section class="onizleme"><h2>Yüklenen tablolar</h2>${Object.entries(Y.tablolar).map(([a, t]) => `<details ${Object.keys(Y.tablolar).length === 1 ? 'open' : ''}><summary><code>${esc(a)}</code> <span class="kucuk">${t.columns.map((c, i) => `${esc(c)}:${t.types[i].toLowerCase()}`).join(', ')}</span></summary>${tabloHTML({ columns: t.columns, rows: t.rows.slice(0, 6), total: t.rows.length }, 6)}</details>`).join('')}</section>` : ''}
  </div>`;
  $$('[data-vs]', ana).forEach(b => b.onclick = () => veriSetiDegistir(b.dataset.vs));
  const inp = $('#dosya'), bir = $('#birak');
  inp.onchange = () => inp.files[0] && dosyaYukle(inp.files[0]);
  bir.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  bir.addEventListener('dragover', e => { e.preventDefault(); bir.classList.add('ustunde'); });
  bir.addEventListener('dragleave', () => bir.classList.remove('ustunde'));
  bir.addEventListener('drop', e => { e.preventDefault(); bir.classList.remove('ustunde'); const f = e.dataTransfer.files[0]; if (f) dosyaYukle(f); });
  const u = $('#uretForm'); if (u) u.onsubmit = e => { e.preventDefault(); const f = new FormData(u); soruUret(f.get('dil'), +f.get('adet')); };
}
function uretPanelHTML() {
  const Y = VS.yuklenen;
  const sql = Y.sorular.filter(q => q.dil === 'sql').length, py = Y.sorular.filter(q => q.dil === 'python').length;
  return `<section class="uret-panel">
    <div><h2>Bu veriye özel sorular</h2>
    <p>${Y.sorular.length ? `Şu an <b>${sql} SQL</b> ve <b>${py} Python</b> sorusu var. Yeni ürettiklerin listeye eklenir.` : 'Claude tablolarının yapısına ve örnek satırlarına bakıp kolaydan zora sorular hazırlar. Her sorunun çözümü veride çalıştırılarak doğrulanır, çalışmayanlar elenir.'}</p></div>
    ${S.claude ? `<form id="uretForm" class="uret-form">
      <fieldset><legend>Dil</legend><div class="radyo">${[['ikisi', 'SQL + Python'], ['sql', 'SQL'], ['python', 'Python']].map(([v, l], i) => `<label><input type="radio" name="dil" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
      <fieldset><legend>Adet</legend><div class="radyo">${[6, 10, 14].map(n => `<label><input type="radio" name="adet" value="${n}" ${n === 10 ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></fieldset>
      <button class="btn birincil" type="submit" ${S.uretiliyor ? 'disabled' : ''}>${S.uretiliyor ? 'Üretiliyor…' : 'Soruları üret'}</button>
    </form><div id="uretDurum"></div>` : '<div class="bilgi">Soru üretmek için Claude erişimi gerekiyor. Bu görünümde kullanılamıyor. Sayfayı claude.ai üzerinden açtığında ve izin verdiğinde bu bölüm etkinleşir. O zamana kadar Serbest Alan\'da bu veriyle sorgu yazabilirsin.</div>'}
  </section>`;
}
const trHarf = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u' };
function adTemizle(s, yedek) {
  let a = String(s ?? '').trim().replace(/[çğıöşüÇĞİÖŞÜ]/g, c => trHarf[c]).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!a) a = yedek; if (/^\d/.test(a)) a = 'c_' + a;
  if (['select', 'from', 'where', 'group', 'order', 'table', 'index', 'by', 'case', 'when', 'end', 'limit', 'join', 'on', 'as', 'and', 'or', 'not', 'null', 'in', 'is', 'having', 'values', 'class', 'def', 'pd', 'np', 'sonuc', 'lambda', 'import'].includes(a)) a += '_';
  return a;
}
async function dosyaYukle(f) {
  const d = $('#yukDurum');
  d.innerHTML = '<div class="yukleniyor">Dosya okunuyor…</div>';
  await bekle(16);
  try {
    if (!window.XLSX) await scriptYukle('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const tablolar = {}; const uyarilar = [];
    const pad = n => String(n).padStart(2, '0');
    const tarihYaz = v => { const s = `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`; return (v.getHours() || v.getMinutes() || v.getSeconds()) ? `${s} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}` : s; };
    for (const sn of wb.SheetNames) {
      const ham = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: false });
      if (!ham.length || !ham[0] || !ham[0].some(x => x !== null && x !== '')) continue;
      let baslik = ham[0].map((h, i) => adTemizle(h, `sutun_${i + 1}`));
      const gor = {}; baslik = baslik.map(h => { if (gor[h]) { gor[h]++; return `${h}_${gor[h]}`; } gor[h] = 1; return h; });
      let satirlar = ham.slice(1).map(r => baslik.map((_, i) => { let v = r[i]; if (v === undefined || v === '') v = null; if (v instanceof Date) v = tarihYaz(v); if (typeof v === 'boolean') v = v ? 1 : 0; return v; }));
      satirlar = satirlar.filter(r => r.some(v => v !== null));
      if (satirlar.length > 100000) { uyarilar.push(`${sn}: ilk 100.000 satır alındı (toplam ${satirlar.length}).`); satirlar = satirlar.slice(0, 100000); }
      const tipler = baslik.map((_, i) => { const dolu = satirlar.map(r => r[i]).filter(v => v !== null); if (!dolu.length) return 'TEXT'; if (dolu.every(v => typeof v === 'number')) return dolu.every(Number.isInteger) ? 'INTEGER' : 'REAL'; return 'TEXT'; });
      satirlar = satirlar.map(r => r.map((v, i) => tipler[i] === 'TEXT' && v !== null ? String(v) : v));
      let tad = adTemizle(wb.SheetNames.length === 1 && /\.csv$/i.test(f.name) ? f.name.replace(/\.[^.]+$/, '') : sn, 'tablo');
      while (tablolar[tad]) tad += '_2';
      tablolar[tad] = { columns: baslik, types: tipler, rows: satirlar };
    }
    if (!Object.keys(tablolar).length) throw new Error('Dosyada okunabilir bir tablo bulunamadı. İlk satırın sütun adları olduğundan emin ol.');
    VS.yuklenen = { ad: f.name.replace(/\.[^.]+$/, ''), tablolar, sorular: [] };
    delete dbCache.yuklenen; Object.keys(beklenenCache).filter(k => k.startsWith('yuklenen:')).forEach(k => delete beklenenCache[k]);
    if (pyYukluVS === 'yuklenen') pyYukluVS = null;
    S.aktifId.yuklenen = null;
    await sqlHazir; dbAl('yuklenen');
    S.veriSeti = 'yuklenen';
    S.serbestKod = varsayilanKod('yuklenen');
    yenidenCiz();
    if (uyarilar.length) $('#yukDurum').innerHTML = `<div class="bilgi">${uyarilar.map(esc).join('<br>')}</div>`;
  } catch (e) { d.innerHTML = `<div class="hata-kutu">Dosya okunamadı: ${esc(e.message || e)}</div>`; }
}
function veriOzetiPrompt(tablolar) {
  return Object.entries(tablolar).map(([ad, t]) => {
    const sut = t.columns.map((c, i) => {
      const deg = t.rows.map(r => r[i]); const dolu = deg.filter(v => v !== null);
      let ek = `boş: ${deg.length - dolu.length}`;
      if (t.types[i] !== 'TEXT' && dolu.length) ek += `, min: ${Math.min(...dolu)}, max: ${Math.max(...dolu)}`;
      else { const farkli = [...new Set(dolu)]; ek += `, farklı değer: ${farkli.length}${farkli.length <= 12 ? ` (${farkli.slice(0, 12).join(' / ')})` : `, örnek: ${farkli.slice(0, 4).join(' / ')}`}`; }
      return `  - ${c} ${t.types[i]} [${ek}]`;
    }).join('\n');
    return `Tablo: ${ad} (${t.rows.length} satır)\n${sut}\nİlk 4 satır:\n${t.rows.slice(0, 4).map(r => '  ' + JSON.stringify(r)).join('\n')}`;
  }).join('\n\n');
}
async function soruUret(dil, adet) {
  const Y = VS.yuklenen; if (!Y || S.uretiliyor) return;
  S.uretiliyor = true; const durum = () => $('#uretDurum');
  const btn = $('#uretForm button[type=submit]'); if (btn) { btn.disabled = true; btn.textContent = 'Üretiliyor…'; }
  durum().innerHTML = '<div class="yukleniyor">Claude veriyi inceleyip soruları hazırlıyor. Bu 30-60 saniye sürebilir…</div>';
  const dilMetni = dil === 'ikisi' ? `yaklaşık yarısı SQL, yarısı Python (pandas)` : dil === 'sql' ? 'hepsi SQL' : 'hepsi Python (pandas)';
  const mevcut = Y.sorular.map(q => `- ${q.baslik}`).join('\n');
  const prompt = `Bir veri analistinin SQL ve Python pratiği yapması için alıştırma soruları hazırlıyorsun. Tüm metinler Türkçe olsun.

VERİ:
${veriOzetiPrompt(Y.tablolar)}

KURALLAR:
- Toplam ${adet} soru üret, ${dilMetni}. Kolaydan zora sırala: yaklaşık üçte biri seviye 1 (temel SELECT/filtre/sıralama), üçte biri seviye 2 (GROUP BY, JOIN, CASE, tarih), üçte biri seviye 3 (window function, CTE, alt sorgu; pandas'ta merge, pivot_table, transform, rank).
- SQL çözümleri SQLite lehçesinde olmalı (tarih için strftime/julianday, QUALIFY yok). Tablo ve sütun adlarını aynen kullan.
- Python çözümlerinde her tablo aynı isimde bir pandas DataFrame olarak hazır; pd ve np import edilmiş. YYYY-MM-DD formatındaki tarih sütunları datetime tipinde gelir. Sonuç mutlaka \`sonuc\` değişkenine atanmalı.
- Her soru gerçek bir iş sorusu gibi olsun, verinin anlamına uygun olsun.
- Soru metninde beklenen sütun adlarını <code>...</code> ile belirt, yuvarlama gerekiyorsa söyle (örn. 2 ondalık).
- Sonuç boş olmamalı, deterministik olmalı. Sıralama önemliyse sirali=true yap ve eşitliği bozacak ikinci bir sıralama kriteri ekle.
- Tablolar arasında JOIN için ortak anahtar yoksa JOIN sorusu üretme.
- aciklama alanı öğretici olsun: sorgunun neden böyle yazıldığını, adımların mantığını ve sık yapılan hatayı anlat (2-4 kısa paragraf). HTML olarak <p>, <ul>, <li>, <code>, <b> kullan.
${mevcut ? `- Şu sorular zaten var, bunları tekrar etme:\n${mevcut}` : ''}

Sadece şu JSON'u döndür:
{"sorular":[{"dil":"sql"|"python","seviye":1|2|3,"kategori":"kısa kategori adı","baslik":"kısa başlık","soru":"soru metni (HTML: <code> kullanılabilir)","ipucu":"tek cümlelik ipucu","cozum":"çalışan çözüm kodu","aciklama":"HTML açıklama","sirali":true|false}]}`;
  try {
    const r = await claudeJson(prompt, { modelTier: 'complex' });
    const gelen = (r && r.sorular) || (Array.isArray(r) ? r : []);
    if (!gelen.length) throw new Error('Claude geçerli bir soru listesi döndürmedi. Tekrar dene.');
    durum().innerHTML = `<div class="yukleniyor">${gelen.length} soru geldi. Çözümler veride çalıştırılarak doğrulanıyor…</div>`;
    const onceki = S.veriSeti; S.veriSeti = 'yuklenen';
    const tag = Date.now().toString(36);
    const gecen = [], elenen = [];
    for (const [i, q0] of gelen.entries()) {
      const q = { id: `u${tag}_${i}`, dil: q0.dil === 'python' ? 'python' : 'sql', seviye: [1, 2, 3].includes(+q0.seviye) ? +q0.seviye : 2, kategori: String(q0.kategori || 'Genel'), baslik: String(q0.baslik || `Soru ${i + 1}`), soru: String(q0.soru || ''), ipucu: String(q0.ipucu || ''), cozum: String(q0.cozum || ''), aciklama: String(q0.aciklama || ''), sirali: !!q0.sirali };
      if (!q.cozum || !q.soru) { elenen.push(q.baslik); continue; }
      try {
        if (q.dil === 'python') durum().innerHTML = `<div class="yukleniyor">Python soruları doğrulanıyor${pyDurum !== 'hazir' ? ' (Python ortamı hazırlanıyor)' : ''}…</div>`;
        await bekle(10);
        const sonuc = await calistir(q.dil, q.cozum, true);
        if (sonuc.ok && sonuc.table && sonuc.table.rows.length) { beklenenCache['yuklenen:' + q.id] = sonuc; gecen.push(q); } else elenen.push(q.baslik);
      } catch (e) { elenen.push(q.baslik); }
    }
    S.veriSeti = onceki;
    Y.sorular.push(...gecen);
    S.uretiliyor = false;
    if (S.view === 'veri') veriCiz();
    ustCiz();
    const d = durum();
    if (d) d.innerHTML = `<div class="karar ${gecen.length ? 'dogru' : 'yanlis'}"><span class="karar-ikon">${gecen.length ? '✓' : '✕'}</span><div>${gecen.length} soru eklendi.${elenen.length ? ` ${elenen.length} tanesinin çözümü veride çalışmadığı için elendi.` : ''} ${gecen.length ? '<button class="btn kucuk-btn" data-git="alistirma">Alıştırmalara git</button>' : ''}</div></div>`;
    $$('[data-git]').forEach(b => b.onclick = () => { if (S.veriSeti !== 'yuklenen') S.veriSeti = 'yuklenen'; S.filtre = { dil: gecen[0] ? gecen[0].dil : 'sql', seviye: 0, kategori: '' }; git(b.dataset.git); });
  } catch (e) {
    S.uretiliyor = false;
    if (S.view === 'veri') veriCiz();
    const d = durum(); if (d) d.innerHTML = `<div class="hata-kutu">${esc(claudeHata(e))}</div>`;
  }
}

// ─── Başlat ───
(function baslat() {
  const v = location.hash.slice(1);
  if (VIEWLER.includes(v)) S.view = v;
  yenidenCiz();
  sqlHazir.then(() => { if (!SQLlib) { $('#ana').insertAdjacentHTML('afterbegin', '<div class="hata-kutu">SQL motoru yüklenemedi. Sayfayı yenilemeyi dene.</div>'); } });
})();
