// Örnek Mağaza veri seti: sabit tohumla üretilir, her açılışta aynı data.
function ornekVeriUret() {
  let seed = 20241111;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const wpick = (a, w) => { let r = rnd() * w.reduce((x, y) => x + y, 0); for (let i = 0; i < a.length; i++) { r -= w[i]; if (r < 0) return a[i]; } return a[a.length - 1]; };
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const randDate = (a, b) => new Date(a.getTime() + Math.floor(rnd() * ((b - a) / 864e5 + 1)) * 864e5);

  const adlarK = ['Ayşe', 'Zeynep', 'Elif', 'Merve', 'Esra', 'Selin', 'Deniz', 'Burcu', 'Ece', 'Gizem', 'Seda', 'Derya', 'Nazlı', 'Pınar', 'İrem', 'Büşra'];
  const adlarE = ['Mehmet', 'Ahmet', 'Mustafa', 'Emre', 'Can', 'Burak', 'Kerem', 'Murat', 'Onur', 'Serkan', 'Oğuz', 'Barış', 'Tolga', 'Cem', 'Umut', 'Kaan'];
  const soyadlar = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Öztürk', 'Aydın', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Koç', 'Kurt', 'Özdemir', 'Polat', 'Erdem', 'Tekin'];
  const sehirler = ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Eskişehir'];
  const sehirW = [30, 16, 13, 9, 9, 7, 8, 8];

  const musteriler = [];
  for (let i = 1; i <= 80; i++) {
    const cins = rnd() < 0.55 ? 'K' : 'E';
    musteriler.push({
      musteri_id: i,
      ad_soyad: `${pick(cins === 'K' ? adlarK : adlarE)} ${pick(soyadlar)}`,
      cinsiyet: cins,
      yas: rnd() < 0.07 ? null : 18 + Math.floor(rnd() * 48),
      sehir: rnd() < 0.05 ? null : wpick(sehirler, sehirW),
      kayit_tarihi: fmt(randDate(new Date(Date.UTC(2022, 0, 1)), new Date(Date.UTC(2024, 5, 30)))),
      uyelik: wpick(['Standart', 'Gold', 'Platinum'], [60, 28, 12])
    });
  }

  const urunHam = [
    ['Koşu Ayakkabısı Pro', 'Ayakkabı', 'Velox', 2849.9], ['Günlük Sneaker', 'Ayakkabı', 'Urbo', 1799.5], ['Deri Bot', 'Ayakkabı', 'Taşkın', 3299], ['Spor Terlik', 'Ayakkabı', 'Velox', 449.9],
    ['Basketbol Ayakkabısı', 'Ayakkabı', 'Hoopa', 3599.9], ['Klasik Loafer', 'Ayakkabı', 'Taşkın', 2299], ['Yürüyüş Botu', 'Ayakkabı', 'Patika', 2699.5],
    ['Pamuklu Tişört', 'Giyim', 'Urbo', 349.9], ['Spor Eşofman Altı', 'Giyim', 'Velox', 899.9], ['Kapüşonlu Sweatshirt', 'Giyim', 'Urbo', 1149], ['Rüzgarlık Mont', 'Giyim', 'Patika', 1899.9],
    ['Spor Tayt', 'Giyim', 'Velox', 649.5], ['Keten Gömlek', 'Giyim', 'Taşkın', 799],
    ['Sırt Çantası', 'Çanta', 'Patika', 1249.9], ['Spor Çanta', 'Çanta', 'Velox', 999.5], ['Deri Cüzdan', 'Çanta', 'Taşkın', 599.9], ['Laptop Çantası', 'Çanta', 'Urbo', 1399],
    ['Spor Çorap 3lü', 'Aksesuar', 'Velox', 189.9], ['Beyzbol Şapkası', 'Aksesuar', 'Hoopa', 299.5], ['Akıllı Bileklik', 'Aksesuar', 'Urbo', 1599.9], ['Matara 750ml', 'Aksesuar', 'Patika', 249],
    ['Yoga Matı', 'Spor Ekipmanı', 'Velox', 549.9], ['Dambıl Seti', 'Spor Ekipmanı', 'Hoopa', 1749], ['Basketbol Topu', 'Spor Ekipmanı', 'Hoopa', 699.9]
  ];
  const urunler = urunHam.map((u, i) => ({ urun_id: 101 + i, urun_adi: u[0], kategori: u[1], marka: u[2], fiyat: u[3] }));
  const urunW = urunler.map(u => u.fiyat < 700 ? 5 : u.fiyat < 1500 ? 4 : u.fiyat < 2500 ? 3 : 2);

  // Bazı müşteriler hiç sipariş vermez (LEFT JOIN alıştırmaları için)
  const siparissiz = new Set([7, 19, 33, 46, 58, 64, 71, 77]);
  const aktif = musteriler.filter(m => !siparissiz.has(m.musteri_id));
  const aktifW = aktif.map(() => 0.3 + rnd() * 2.2);
  const siparisler = [];
  const bitis = new Date(Date.UTC(2024, 11, 31));
  for (let i = 1; i <= 640; i++) {
    const m = wpick(aktif, aktifW);
    const kayit = new Date(m.kayit_tarihi + 'T00:00:00Z');
    const bas = kayit > new Date(Date.UTC(2023, 0, 1)) ? kayit : new Date(Date.UTC(2023, 0, 1));
    const u = wpick(urunler, urunW);
    const adet = wpick([1, 2, 3], [70, 22, 8]);
    const ind = wpick([0, 0.1, 0.2, 0.3], [55, 25, 14, 6]);
    siparisler.push({
      siparis_id: 10000 + i,
      musteri_id: m.musteri_id,
      urun_id: u.urun_id,
      siparis_tarihi: fmt(randDate(bas, bitis)),
      adet,
      indirim_orani: ind,
      tutar: Math.round(u.fiyat * adet * (1 - ind) * 100) / 100,
      kanal: wpick(['Online', 'Mobil', 'Mağaza'], [38, 34, 28]),
      durum: wpick(['Tamamlandı', 'İptal', 'İade'], [85, 8, 7])
    });
  }
  // sipariş id'leri tarih sırasına göre olsun
  siparisler.sort((a, b) => a.siparis_tarihi < b.siparis_tarihi ? -1 : a.siparis_tarihi > b.siparis_tarihi ? 1 : a.siparis_id - b.siparis_id);
  siparisler.forEach((s, i) => s.siparis_id = 10001 + i);

  const tablo = (rows, tipler) => ({ columns: Object.keys(rows[0]), types: tipler, rows: rows.map(r => Object.values(r)) });
  return {
    musteriler: tablo(musteriler, ['INTEGER', 'TEXT', 'TEXT', 'INTEGER', 'TEXT', 'TEXT', 'TEXT']),
    urunler: tablo(urunler, ['INTEGER', 'TEXT', 'TEXT', 'TEXT', 'REAL']),
    siparisler: tablo(siparisler, ['INTEGER', 'INTEGER', 'INTEGER', 'TEXT', 'INTEGER', 'REAL', 'REAL', 'TEXT', 'TEXT'])
  };
}
if (typeof module !== 'undefined') module.exports = { ornekVeriUret };
