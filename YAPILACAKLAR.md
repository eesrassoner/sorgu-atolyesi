# Yapılacaklar

Esra'nın sonraya bıraktığı istekler. Bir madde bitince buradan sil ve commit mesajında belirt.

- [ ] **Editördeki başlangıç yazısı placeholder olsun.** Şu an soru açılınca editörün içine gerçek metin olarak yazılıyor:
  Python'da `# Cevabını sonuc değişkenine ata` + `sonuc = `, SQL'de `-- Sorgunu buraya yaz`.
  İstenen: bu yazılar soluk renkte placeholder olarak görünsün, editöre tıklayınca (odaklanınca) kaybolsun, silmek gerekmesin.
  Not: `kaynak/src/app.js` içinde `soruCalismaCiz` → `baslangic` değişkeni; editör `editorKur` ile kuruluyor (textarea + satır numarası). Odakta gizlemek için `textarea:focus::placeholder { color: transparent; }`. Kayıtlı taslaklar (`depo.taslak`) hâlâ eski başlangıç metnini içerebilir: taslak tam olarak eski başlangıç metnine eşitse boş say.
