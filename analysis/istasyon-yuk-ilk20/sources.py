#!/usr/bin/env python3
"""Kaynak dosya yollarinin tek noktadan cozumlenmesi.

Kaynak SAP ciktilari repoda tutulmaz. Yollar su sirayla aranir:
  1. ZANALYSIS_ESKI / ZANALYSIS_YENI ortam degiskenleri (tam dosya yolu)
  2. ZANALYSIS_DIR ortam degiskenindeki klasorde isim kalibiyla eslesen dosyalar
  3. Bu betigin yanindaki 'kaynak/' klasoru
"""
import glob
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# (ortam degiskeni, klasor icinde aranacak kalip, aciklama)
SPECS = [
    ('ZANALYSIS_ESKI', '*ZANALYSIS_PATTERN_NEW_3*.xls',
     'İstasyon Bazlı Yük Taşımaları (eski yıllar)'),
    ('ZANALYSIS_YENI', '*ZANALYSIS_PATTERN__*.xls',
     'İstasyona Göre Yük Taşımaları (yeni yıllar)'),
]


def _resolve(env_key, pattern, desc):
    p = os.environ.get(env_key)
    if p:
        if not os.path.isfile(p):
            raise SystemExit(f'{env_key}={p} bulunamadı.')
        return p
    root = os.environ.get('ZANALYSIS_DIR') or os.path.join(HERE, 'kaynak')
    hits = sorted(glob.glob(os.path.join(root, pattern)))
    if not hits:
        raise SystemExit(
            f'Kaynak bulunamadı: {desc}\n'
            f'  aranan: {os.path.join(root, pattern)}\n'
            f'  çözüm : {env_key}=<dosya yolu> ya da ZANALYSIS_DIR=<klasör> verin.')
    return hits[-1]


def source_files():
    """[(yol, dosya_adi), ...] — sirayla YENI (2017+) sonra ESKI (2013-2016)."""
    eski = _resolve(*SPECS[0])
    yeni = _resolve(*SPECS[1])
    return [(yeni, os.path.basename(yeni)), (eski, os.path.basename(eski))]


if __name__ == '__main__':
    for p, n in source_files():
        print(f'{n}\n  -> {p}')
