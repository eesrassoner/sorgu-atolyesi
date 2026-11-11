"""Tüm soru bankasını doğrular: her SQL çözümü SQLite'ta, her Python çözümü pandas ile çalışmalı ve boş olmayan sonuç vermeli.

Kullanım (repo kökünden):  python3 kaynak/test/dogrula.py
Gerekenler: node, python3, pandas, numpy
"""
import json, os, sqlite3, subprocess, sys

KOK = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(KOK, 'kaynak', 'src')
sys.path.insert(0, SRC)
import helper  # noqa: E402

js = """
const {ornekVeriUret} = require('./data.js'); const b = require('./bank.js');
const {HR_VERI} = require('./hr_data.js'); const {HR_SORULAR} = require('./hr_bank.js'); const {NP_SORULAR} = require('./np_bank.js');
process.stdout.write(JSON.stringify({ornek: {veri: ornekVeriUret(), sorular: b.SORULAR}, hr: {veri: HR_VERI, sorular: HR_SORULAR.concat(NP_SORULAR)}, tahmin: b.TAHMINLER}));
"""
d = json.loads(subprocess.run(['node', '-e', js], cwd=SRC, capture_output=True, text=True, check=True).stdout)

hata = 0
idler = set()
for ad in ['ornek', 'hr']:
    veri, sorular = d[ad]['veri'], d[ad]['sorular']
    db = sqlite3.connect(':memory:')
    for t, o in veri.items():
        db.execute(f'CREATE TABLE "{t}" ({", ".join(f"{c} {o["types"][i]}" for i, c in enumerate(o["columns"]))})')
        db.executemany(f'INSERT INTO "{t}" VALUES ({",".join("?" * len(o["columns"]))})', o['rows'])
    helper._yukle(json.dumps(veri))
    for q in sorular:
        if q['id'] in idler:
            print('TEKRAR EDEN ID', q['id']); hata += 1
        idler.add(q['id'])
        try:
            if q['dil'] == 'sql':
                n = len(db.execute(q['cozum']).fetchall())
            else:
                r = json.loads(helper._calistir(q['cozum']))
                if not r['ok']:
                    raise RuntimeError(r['error'])
                n = r['table']['total'] if r['table'] else 0
            if n == 0:
                raise RuntimeError('boş sonuç')
        except Exception as e:
            print(f'HATA {ad}/{q["id"]} {q["baslik"]}: {e}'); hata += 1
    print(f'{ad}: {len(sorular)} soru kontrol edildi')
for t in d['tahmin']:
    if t['dil'] == 'python':
        r = json.loads(helper._calistir(t['kod']))
        if not r['ok']:
            print('HATA tahmin', t['id'], r['error']); hata += 1
print('SONUÇ:', 'tamam' if hata == 0 else f'{hata} hata')
sys.exit(1 if hata else 0)
