# İstasyon Bazlı Yük Taşımaları — En Yoğun 20 İstasyon

İki ayrı SAP `ZANALYSIS_PATTERN` çıktısını birleştirip, gelen + giden yük toplamı
en yüksek 20 istasyonu sıralayan Excel raporunu üretir.

Çıktı: `Istasyon_Bazli_Yuk_Ilk20.xlsx` (depo kökü)

## Kaynak dosyalar

| Dosya | İçerik | Yıllar | İstasyon |
|---|---|---|---|
| `ZANALYSIS_PATTERN_NEW_3.xls` | İstasyon Bazlı Yük Taşımaları | 2013-2016 | 307 |
| `ZANALYSIS_PATTERN__<zaman damgası>.xls` | İstasyona Göre Yük Taşımaları | 2017-2026 | 334 |

Uzantıları `.xls` olsa da bu dosyalar gerçekte **MHTML** (SAP web export) biçimindedir;
`quoted-printable` çözülüp içindeki HTML tablosu ayrıştırılır. Sayısal değerler
hücrelerin `x:num` özniteliğinden okunur, biçimlendirilmiş metinden değil.

Kaynak dosyalar depoda tutulmaz. Yolları şu sırayla aranır:

1. `ZANALYSIS_ESKI` / `ZANALYSIS_YENI` ortam değişkenleri (tam dosya yolu)
2. `ZANALYSIS_DIR` ortam değişkenindeki klasör
3. Bu klasörün altındaki `kaynak/` dizini

## Kullanım

```bash
pip install openpyxl

export ZANALYSIS_DIR=/kaynak/dosyalarin/oldugu/klasor

python3 verify.py      # kaynakların iç tutarlılığını denetler
python3 build.py       # Excel raporunu üretir
python3 crosscheck.py  # sonucu bağımsız bir yöntemle doğrular
```

`ZANALYSIS_OUT` ile çıktı yolu değiştirilebilir.

## Üretilen sayfalar

| Sayfa | İçerik |
|---|---|
| **İlk 20 İstasyon** | Sıralı özet: Giden, Gelen, Toplam, Pay %, Kümülatif %, dönem kırılımı + çubuk grafik |
| **İlk 20 - Yıl Bazında** | İlk 20 istasyonun 2013-2026 yıllık dökümü (Giden / Gelen / Toplam) |
| **Tüm İstasyonlar (Birleşik)** | 351 istasyonun birleştirilmiş ham verisi — diğer sayfalar buraya formülle bağlıdır |
| **Yöntem ve Notlar** | Birleştirme kuralları, varsayımlar, doğrulama kayıtları |

## Yöntem

- **Sıralama ölçütü:** `TOPLAM = Giden + Gelen` (Netton, TON).
- **Mükerrer sayım yok:** İki dosyanın yıl aralıkları çakışmaz (2013-2016 / 2017-2026),
  bu yüzden birleştirme yan yana eklemedir.
- **İsim eşleştirme:** İstasyon adları Türkçe büyük/küçük harf kuralları (I/İ/ı/i) ve
  aksanlar normalize edilerek eşleştirilir. Tespit edilen tek yazım farkı
  `Islahiye` ↔ `İslahiye`; aynı istasyon kabul edilip birleştirilmiştir.
- **Mükerrer satır:** Eski dosyada `Azot` adıyla iki ayrı satır vardır
  (442.056,46 ve 599,11 Netton); aynı ad altında toplanmıştır.
- **Ayrı tutulanlar:** `Mersin` / `Mersin Liman` ve `Haydarpaşa` / `Haydarpaşa Liman`
  kaynakta ayrı kayıt olduğu için ayrı istasyon bırakılmıştır.
- **2026 kısmi yıldır** (çıktı 07.08.2026 tarihlidir); tam yıllarla karşılaştırırken
  dikkate alınmalıdır.

### Ölçünün yorumu

Bir sevkiyat çıkış istasyonunda `Giden`, varış istasyonunda `Gelen` olarak sayılır.
Dolayısıyla `Giden + Gelen` bir **istasyonun toplam yük trafiğidir**; tüm istasyon
toplamı (726.890.012 Netton) ülke genelinde taşınan net tonajın yaklaşık iki katına
denk gelir. `Pay %` sütunu bu toplam içindeki payı gösterir.

## Doğrulama

`verify.py` kaynakların kendi ara toplamlarına karşı denetler:

- her satırda `Sonuç = Giden + Gelen` → **0 hata**
- her satırda `Toplam sonuç = yıllık Sonuç toplamı` → **0 hata**
- eski dosyanın kendi `Toplam sonuç` satırı 207.025.948,53 Netton; hesaplanan değerle
  birebir örtüşür (yeni dosyada genel toplam satırı yoktur, satır/sütun bazlı iç
  tutarlılık kontrolü uygulanır)

`crosscheck.py` bağımsız bir yol izler: `build.py`'nin colspan/rowspan ızgara
çözümlemesi yerine ham HTML'den regex ile satırları çeker ve sıralamayı dosyaların
**kendi `Toplam sonuç` sütunundan** yapar. Her iki yöntem 351 istasyonun tamamında
ve ilk 20 sıralamasında birebir aynı sonucu verir (genel toplam farkı < 0,01 Netton).

## Not

20. sıra (`Yarımca`, 7.836.865,77) ile 21. sıra (`Gümüş`, 7.816.223,76) arasındaki
fark yalnızca **%0,26**'dır. Kesim noktası bu nedenle hassastır; kaynak veride küçük
bir revizyon bu iki istasyonun yerini değiştirebilir.
