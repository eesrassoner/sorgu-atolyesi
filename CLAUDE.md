# Sorgu Atölyesi — çalışma talimatları

Esra'nın SQL / pandas / NumPy alıştırma uygulaması. Kullanıcıyla Türkçe konuş.

## Yapı
- Repo kökü = GitHub Pages ile yayınlanan iPad (PWA, çevrimdışı) sürümü. Tüm varlıklar kökte **düz** durur (klasör yok): Pyodide (`pyodide.js`, `pyodide.asm.*`, `python_stdlib.wasm`, `paket-*.wasm` = yeniden sıkıştırılmış wheel'ler), `sql-asm.js`, `xlsx.full.min.js`, fontlar, ikonlar. Bunları elle düzenleme.
- `kaynak/src/` = tek doğruluk kaynağı:
  - `bank.js` — Örnek Mağaza soruları (`SORULAR`), Tahmin Et (`TAHMINLER`), teorik mülakat (`TEORIK_TEST`, `TEORIK_ACIK`)
  - `hr_bank.js` — İK Attrition SQL/pandas soruları, `np_bank.js` — NumPy soruları
  - `data.js` (örnek veri üretici), `hr_data.js` (IBM HR verisi + `egitim_kod`, `memnuniyet_kod`)
  - `app.js` (arayüz), `helper.py` (Pyodide içinde çalışan çıktı dönüştürücü), `template.html` (CSS + iskelet)
- `index.html`, `sw.js`, `manifest.webmanifest` **üretilir** — elle düzenleme, `kaynak/build.py` çalıştır.

## Yapılacaklar
Bekleyen istekler `YAPILACAKLAR.md` dosyasında. Kullanıcı "yapılacaklar listesindekileri yap" derse oradan başla.

## Soru ekleme akışı
1. İlgili bankaya soru ekle. Alanlar: `id` (benzersiz), `dil` (`sql`|`python`), `seviye` (1-3), `kategori`, `baslik`, `soru` (HTML), `ipucu`, `cozum`, `aciklama` (HTML, öğretici), isteğe bağlı `sirali: true`.
   - SQL çözümleri SQLite lehçesinde. Python çözümleri sonucu `sonuc` değişkenine atar; tablolar aynı isimli DataFrame olarak hazırdır.
   - Sıralı sorularda eşitliği bozan ikinci kriter ekle. Açıklamadaki her sayısal yorumu gerçek sonuçla karşılaştır.
2. `python3 kaynak/test/dogrula.py` → "SONUÇ: tamam" olmalı.
3. `python3 kaynak/build.py` → kök dosyaları + `kaynak/cikti/claude-ai.html` üretilir.
4. Commit + push (GitHub Pages ~1-2 dk'da güncellenir; iPad uygulaması internete bağlıyken açılınca yeni sürümü indirir).
5. claude.ai sürümünü de güncelle: `kaynak/cikti/claude-ai.html` dosyasını artifact'e `index.html` olarak yayınla (publish_files, mode "patch"). Artifact: "Sorgu Atölyesi", slug `5720ef7e-3add-4b1b-b28e-96b536e1eab0`. Artifact'in Pyodide dosyaları `pyodide/` alt yolunda zaten yüklü; sadece `index.html` değişir. `sample` yeteneği tanımlı (Claude ile soru üretme/değerlendirme).
