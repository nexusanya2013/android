#!/usr/bin/env python3
"""SAP ZANALYSIS_PATTERN (MHTML .xls) ayristirici."""
import quopri
import re
import html as htmlmod
from html.parser import HTMLParser


def decode_mhtml(path):
    raw = open(path, 'rb').read()
    body = raw.split(b'--NEXTMIME')[1].split(b'\r\n\r\n', 1)[1]
    return quopri.decodestring(body).decode('utf-8', 'replace')


class TableGrabber(HTMLParser):
    """Tum <table>'lari satir/hucre listesine cevirir.

    Hucre = (metin, x:num degeri veya None, colspan, rowspan)
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._tbl = None
        self._row = None
        self._cell = None
        self._buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'table':
            self._tbl = []
        elif tag == 'tr' and self._tbl is not None:
            self._row = []
        elif tag in ('td', 'th') and self._row is not None:
            xnum = a.get('x:num')
            self._cell = [None,
                          float(xnum) if xnum not in (None, '') else None,
                          int(a.get('colspan', 1) or 1),
                          int(a.get('rowspan', 1) or 1)]
            self._buf = []

    def handle_data(self, data):
        if self._cell is not None:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self._cell is not None:
            self._cell[0] = ''.join(self._buf).replace('\xa0', ' ').strip()
            self._row.append(tuple(self._cell))
            self._cell = None
            self._buf = []
        elif tag == 'tr' and self._row is not None:
            self._tbl.append(self._row)
            self._row = None
        elif tag == 'table' and self._tbl is not None:
            self.tables.append(self._tbl)
            self._tbl = None


def expand(rows):
    """colspan/rowspan'i acarak duzgun bir izgara uretir."""
    grid = {}
    for r, row in enumerate(rows):
        c = 0
        for text, num, cs, rs in row:
            while (r, c) in grid:
                c += 1
            for dr in range(rs):
                for dc in range(cs):
                    grid[(r + dr, c + dc)] = (text, num)
            c += cs
    nrows = len(rows)
    ncols = (max(c for _, c in grid) + 1) if grid else 0
    return [[grid.get((r, c), ('', None)) for c in range(ncols)]
            for r in range(nrows)], nrows, ncols


def parse_file(path, label):
    doc = decode_mhtml(path)
    g = TableGrabber()
    g.feed(doc)
    # En cok satiri olan tabloyu veri tablosu kabul et
    data_tbl = max(g.tables, key=len)
    grid, nrows, ncols = expand(data_tbl)

    # Baslik satirlarini bul
    def cell(r, c):
        return grid[r][c][0]

    year_row = flow_row = unit_row = None
    for r in range(min(8, nrows)):
        t = cell(r, 0)
        if t.startswith('Takvim'):
            year_row = r
        elif 'Ayrac' in t or 'Ayrac' in t.replace('ı', 'i'):
            flow_row = t and r
        elif t == 'İstasyon':
            unit_row = r
    assert year_row is not None and flow_row is not None, (path, 'baslik bulunamadi')
    first_data_row = (unit_row if unit_row is not None else flow_row) + 1

    # Sutun -> (yil, akis) haritasi
    colmap = {}
    for c in range(1, ncols):
        y = cell(year_row, c)
        f = cell(flow_row, c)
        colmap[c] = (y, f)

    records = []          # (istasyon, yil, giden, gelen)
    file_total_row = None  # dosyanin kendi 'Toplam sonuc' satiri (dogrulama icin)

    for r in range(first_data_row, nrows):
        name = cell(r, 0)
        if not name:
            continue
        vals = {}
        for c in range(1, ncols):
            y, f = colmap[c]
            n = grid[r][c][1]
            if n is not None:
                vals[(y, f)] = n
        if name.startswith('Toplam sonuç') or name.startswith('Genel sonuç'):
            file_total_row = vals
            continue
        for (y, f), v in vals.items():
            if f not in ('Giden', 'Gelen'):
                continue
            records.append((name, y, f, v))

    years = sorted({y for (y, f) in colmap.values()
                    if re.fullmatch(r'\d{4}', y)})
    return {
        'label': label,
        'path': path,
        'years': years,
        'ncols': ncols,
        'nrows': nrows,
        'records': records,
        'file_total_row': file_total_row,
        'colmap': colmap,
        'grid': grid,
        'first_data_row': first_data_row,
    }


if __name__ == '__main__':
    from sources import source_files
    for p, lab in source_files():
        d = parse_file(p, lab)
        stations = {r[0] for r in d['records']}
        print(f"--- {lab}")
        print("  yillar:", d['years'])
        print("  sutun/satir:", d['ncols'], d['nrows'], "veri baslangic:", d['first_data_row'])
        print("  istasyon sayisi:", len(stations))
        print("  kayit sayisi:", len(d['records']))
        print("  Toplam sonuc satiri var mi:", d['file_total_row'] is not None)
        tot = sum(v for _, _, _, v in d['records'])
        print(f"  Giden+Gelen toplami: {tot:,.2f}")
        if d['file_total_row']:
            ft = sum(v for (y, f), v in d['file_total_row'].items() if f in ('Giden', 'Gelen'))
            print(f"  Dosyanin Toplam sonuc satiri: {ft:,.2f}  fark: {tot-ft:,.4f}")
