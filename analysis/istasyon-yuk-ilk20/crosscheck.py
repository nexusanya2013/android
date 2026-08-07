#!/usr/bin/env python3
"""Bagimsiz dogrulama.

parse.py izgara/colspan cozumlemesi kullanir. Burada bambaska bir yol izlenir:
ham HTML'den regex ile satir satir hucreler cekilir ve siralama, dosyalarin
KENDI 'Toplam sonuc' sutunundan (her satirin son hucresi) yapilir.
Iki yontem ayni ilk 20'yi vermelidir.
"""
import re
import html as htmlmod
import collections
import unicodedata

from parse import decode_mhtml
from build import norm, display, order, tot_of, TOP, GRAND

BASE = '/root/.claude/uploads/9a9eebf4-fc9e-568a-8805-2a4866e685c3/'
FILES = [BASE + 'fef7ddf6-ZANALYSIS_PATTERN__20260807T105517.750.xls',
         BASE + '30aa1bf0-ZANALYSIS_PATTERN_NEW_3.xls']

TR_RE = re.compile(r'<tr>(.*?)</tr>', re.S)
TD_RE = re.compile(r'<td\b([^>]*)>(.*?)</td>', re.S)
XNUM_RE = re.compile(r'x:num="([^"]*)"')

alt = collections.defaultdict(float)   # istasyon -> dosyanin Toplam sonuc degeri
rowcount = 0
skipped = []

for path in FILES:
    doc = decode_mhtml(path)
    # sadece en buyuk tablo bloguna bak
    tables = re.findall(r'<table>(.*?)</table>', doc, re.S)
    body = max(tables, key=len)
    for tr in TR_RE.findall(body):
        cells = TD_RE.findall(tr)
        if not cells:
            continue
        name = htmlmod.unescape(re.sub(r'<[^>]+>', '', cells[0][1])).replace('\xa0', ' ').strip()
        # baslik satirlarini ve toplam satirini ele
        if not name or name in ('Takvim yılı', 'Gelen Giden Ayracı', 'İstasyon'):
            skipped.append(name)
            continue
        if name.startswith('Toplam sonuç') or name.startswith('Genel sonuç'):
            skipped.append(name)
            continue
        m = XNUM_RE.search(cells[-1][0])          # son hucre = Toplam sonuc
        if m:
            alt[norm(name)] += float(m.group(1))
        rowcount += 1

print(f'bagimsiz yontem: {rowcount} veri satiri, {len(alt)} birlesik istasyon')
print(f'atlanan basliklar: {sorted(set(skipped))}')

alt_order = sorted(alt, key=lambda k: (-alt[k], k))
alt_grand = sum(alt.values())

print(f'\ngenel toplam  ana yontem: {GRAND:,.2f}')
print(f'genel toplam bagimsiz    : {alt_grand:,.2f}   fark: {GRAND-alt_grand:,.4f}')

print('\n=== ILK 20 KARSILASTIRMA ===')
ok = True
for i in range(20):
    a, b = TOP[i], alt_order[i]
    same = (a == b) and abs(tot_of[a] - alt[b]) < 0.02
    ok &= same
    flag = 'OK ' if same else '>>> FARK'
    print(f'{flag} {i+1:>2}. {display[a]:<24} {tot_of[a]:>16,.2f} | '
          f'{display[b]:<24} {alt[b]:>16,.2f}')

print('\nTUM istasyonlarda deger farki kontrolu:')
diffs = [(k, tot_of[k], alt.get(k, 0.0)) for k in tot_of
         if abs(tot_of[k] - alt.get(k, 0.0)) > 0.02]
print(f'  esiği asan istasyon sayisi: {len(diffs)}')
for k, x, y in diffs[:10]:
    print(f'   {display[k]:<24} ana {x:,.2f}  bagimsiz {y:,.2f}')

print(f'\nanahtar kumeleri ayni mi: {set(tot_of) == set(alt)}')
print(f'\nSONUC: {"ILK 20 IKI YONTEMDE DE AYNI" if ok else "UYUSMAZLIK VAR"}')
