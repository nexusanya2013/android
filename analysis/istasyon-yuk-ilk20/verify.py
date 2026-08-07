#!/usr/bin/env python3
"""Ayristirmanin dogrulugunu dosyanin kendi ara toplamlariyla capraz kontrol eder."""
from parse import parse_file
from sources import source_files

TOL = 0.02

for p, lab in source_files():
    d = parse_file(p, lab)
    grid, colmap, ncols = d['grid'], d['colmap'], d['ncols']
    bad_sonuc = bad_total = rows = 0
    dup = {}
    for r in range(d['first_data_row'], d['nrows']):
        name = grid[r][0][0]
        if not name:
            continue
        rows += 1
        dup[name] = dup.get(name, 0) + 1
        vals = {}
        for c in range(1, ncols):
            vals[colmap[c]] = grid[r][c][1]
        # 1) her yil icin Sonuc == Giden + Gelen
        for y in d['years']:
            g = vals.get((y, 'Giden')) or 0.0
            gl = vals.get((y, 'Gelen')) or 0.0
            s = vals.get((y, 'Sonuç'))
            s = 0.0 if s is None else s
            if abs((g + gl) - s) > TOL:
                bad_sonuc += 1
        # 2) Toplam sonuc == yillik Sonuc'larin toplami
        tk = [k for k in vals if k[0].startswith('Toplam')]
        if tk:
            t = vals[tk[0]] or 0.0
            ssum = sum((vals.get((y, 'Sonuç')) or 0.0) for y in d['years'])
            if abs(t - ssum) > TOL:
                bad_total += 1
    print(f"--- {lab}: {rows} satir")
    print(f"    Sonuc != Giden+Gelen olan hucre grubu: {bad_sonuc}")
    print(f"    Toplam sonuc != yil toplami olan satir : {bad_total}")
    print(f"    tekrar eden istasyon adi: "
          f"{ {k: v for k, v in dup.items() if v > 1} }")
