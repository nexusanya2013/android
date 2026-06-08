# TCDD Railway Map — SAP Lumira Designer 2.4 SDK Bileşeni

Hafif, hızlı ve **bağımlılıksız** bir profesyonel harita/analitik bileşeni.
Demiryolu ağını katman katman gösterir; veri kaynağından bağlanan ölçüleri
**hat kesimi bazında** dağıtır; sürekli renk, **sınıflı (graduated)**, **kategorik**
veya **kalınlık (width)** sembolojisiyle görselleştirir; katmanları dropdown /
onay kutusu / radyo ile yönetir; yön okları, animasyonlu akış, etiketler, legend,
ölçek çubuğu, arama, PNG dışa aktarım ve çoklu altlık (basemap) sunar.

> **Bağımsız çalışır:** Leaflet / Google Maps / API anahtarı yoktur. Saf
> JavaScript + HTML5 Canvas → hızlı açılır, offline çalışır, üçüncü taraf bir
> API'nin kullanımdan kalkmasından etkilenmez. İsteğe bağlı XYZ tile altlığı
> tarayıcı tarafından çekilir; erişim yoksa düz zemine düşer.
>
> **TCDD verisine hazır:** varsayılan `Segment Id = Hat_kesim`,
> `Segment Name = Tanim` (ör. `hat_kesim_veri_.geojson`).

---

## 1. Veri akışı (mantık)

```
 Veri Kaynağı (metadata+tuples)         Ağ Kaynağı (URL/inline, çok format)
        │ buildMeasureMaps()                    │ parseNetwork() → GeoJSON
        │ (+aggregate: sum/avg/…)               │ normalizeGeoJson()
        ▼                                       ▼
   {ölçü: {Hat_kesim: değer}}  ── join ──►  feature.id (Hat_kesim)
        │                       (key↔id)
        ▼
   rebuildLayers() + sembGoloji (ramp/graduated/categorical/width)
        ├─ Katman 0: Tüm ağ (taban)
        ├─ Katman 1..N: her ölçü (renk/sınıf/kalınlık)  ← aç/kapat
        ▼
   MapEngine (Canvas): pan/zoom, casing, ok, akış, etiket, legend, arama…
```

## 2. Klasör yapısı

```
com.tcdd.railmap/
├── META-INF/MANIFEST.MF      OSGi bundle
├── plugin.xml                SDK extension point
├── contribution.xml          bileşen + ~70 özellik (her birinde Türkçe tooltip)
├── contribution.ztl          BIAL script arayüzü (tüm get/set + metotlar)
└── res/
    ├── icon.png
    └── js/
        ├── railmap-core.js   Canvas motoru + format ayrıştırıcılar + sınıflandırma
        └── component.js      SDK tutkalı (veri, katman, sembGoloji, arayüz)
samples/railway-network.sample.geojson   Hat_kesim/Tanim örnek ağ
build.sh                      dağıtılabilir JAR üretir
```

## 3. Kurulum

`Tools ▸ Install Extension to SAP Lumira Designer…` ile `dist/com.tcdd.railmap_*.jar`
dosyasını yükleyin, Designer'ı yeniden başlatın. Bileşen: **TcddMaps ▸ Railway Map**.
Kaynaktan üretmek için: `bash build.sh`.

## 4. Hızlı başlangıç

1. Bileşeni tuvale ekleyin.
2. **Network Source URL** → ağ dosyanız (ör. `https://bopwin.tcdd.gov.tr/convertedson.json`)
   veya **Network (inline)**. **Network Format** = `auto`.
3. **Segment Id Property** = `Hat_kesim`, **Segment Name Property** = `Tanim` (varsayılan).
4. **Data Source** → satırlarda hat kesim boyutu, sütunlarda ölçüler.
5. **Segment Dimension** → hat kesim boyutunun teknik adı.

## 5. Desteklenen ağ formatları

| Format | Algılama | Notlar |
|--------|----------|--------|
| GeoJSON | `FeatureCollection`/`Feature` | LineString, MultiLineString, Polygon, Point |
| TopoJSON | `type:"Topology"` | arc çözümü (delta+quantize) |
| KML | `<kml>`/`<Placemark>` | LineString/Polygon/Point, `<ExtendedData>` → özellik |
| GPX | `<gpx>` | `trk/trkseg/trkpt`, `rte`, `wpt` |
| Düz JSON | dizi `[…]` | `[{"Hat_kesim","Tanim","coordinates":[[lng,lat]…]}]` |

WGS84 `[boylam, enlem]` beklenir (içeride Web Mercator'a dönüştürülür).

## 6. Sembolizasyon

`Symbology` özelliği veya `setSymbology(...)`:

| Mod | Açıklama |
|-----|----------|
| **ramp** | sürekli renk geçişi (min–max) |
| **graduated** | sınıflı renk; `Class Method` = quantile / equal / **jenks** (doğal kırılımlar), `Class Count` |
| **categorical** | ayrık değerlere ayrı renkler |
| **width** | değere göre çizgi kalınlığı (`Min/Max Width`) |

Legend, seçilen sembolojiye göre kendini uyarlar (gradient / sınıf aralıkları /
kategori listesi / kalınlık örneği).

## 7. Katman bazında ayar (kodsuz)

`Per-layer Config (JSON)` ile her ölçüye ayrı ayar:

```json
{
  "Tonaj":   { "ramp":"heat", "symbology":"graduated", "classMethod":"jenks", "classCount":6, "arrows":true, "labels":true, "opacity":85 },
  "Gecikme": { "ramp":"rdylgn", "symbology":"width", "minWidth":2, "maxWidth":16, "flow":true }
}
```

## 8. Çalışma anı (script / BIAL)

```javascript
// Aktif ölçü / katman
RAILWAYMAP_1.setActiveMeasure("Tonaj");
RAILWAYMAP_1.showOnlyLayer("Gecikme");
RAILWAYMAP_1.showLayer("Tonaj");  RAILWAYMAP_1.hideLayer("Demiryolu Ağı");
RAILWAYMAP_1.setLayerOpacity("Tonaj", 70);
RAILWAYMAP_1.getMeasures();            // "Tonaj,Gecikme,Hız"

// Sembolizasyon canlı değişimi
RAILWAYMAP_1.setSymbology("graduated");
RAILWAYMAP_1.setClassification("jenks", 6);
RAILWAYMAP_1.setArrows(true); RAILWAYMAP_1.setFlowAnimation(true);
RAILWAYMAP_1.setLabelsOn(true); RAILWAYMAP_1.setCasing(true);

// Script ile katman besleme
RAILWAYMAP_1.setLayerData("bakim","Bakım",'[{"segment":"ANK-ESK-01","value":0.8}]',"heat");
RAILWAYMAP_1.removeLayer("bakim");

// Altlık / seçim / arama / dışa aktarım
RAILWAYMAP_1.setBasemap("carto-dark");
RAILWAYMAP_1.selectSegment("ANK-KAY-04");  RAILWAYMAP_1.clearSelection();
RAILWAYMAP_1.search("Sivas");              // ilk eşleşmeye gider, id döner
RAILWAYMAP_1.exportPng();                  // PNG indirir

// Navigasyon
RAILWAYMAP_1.zoomToSegment("SVS-ERZ-06");
RAILWAYMAP_1.fitToNetwork();
RAILWAYMAP_1.setView(39.93, 32.85, 7);
RAILWAYMAP_1.getZoom(); RAILWAYMAP_1.getCenterLat(); RAILWAYMAP_1.getCenterLng();
```

## 9. Etkileşim & arayüz

* **Pan**: sürükle · **Zoom**: tekerlek / çift tık / +- düğmeleri / `+ -` tuşları ·
  **Kutu-zoom**: Shift + sürükle · **Klavye**: ok tuşları kaydırır.
* **Araç çubuğu** (sol üst): tüm ağa sığdır, ara, PNG indir, tam ekran.
* **Altlık kutusu**, **katman kontrolü** (checkbox/radio/dropdown), **legend**,
  **ölçek çubuğu**, **koordinat** göstergesi, **başlık/alt başlık**, **light/dark** tema.
* **Tooltip**: bir hat kesimine gelince adı, ID'si ve **tüm ölçü değerleri** renk
  noktalarıyla; `Tooltip Properties` ile ek feature alanları.

## 10. Olaylar

* **onSelect** — hat kesimine tıklayınca (`selectedSegment/Name/Layer`).
* **onLayerToggle** — katman açılıp kapatılınca (`selectedLayer`).
* **onDoubleClick** — haritada çift tık.
* **onViewChange** — pan/zoom sonrası (gecikmeli); `centerLat/centerLng/currentZoom`.

## 11. Özellik grupları (tasarımcı panelinde tooltipli)

`1-Veri · 2-Ağ · 3-Katmanlar · 4-Sembol · 5-Harita Görünümü · 6-Altlık ·
7-Stil · 8-Etiket/Ok/Akış · 9-Biçim · 10-Legend/İpucu · 11-Arayüz ·
12-Seçim · 13-Olaylar`

Renk rampaları: `traffic, rdylgn, blue, green, heat, purple, viridis, cool, gray`.
Altlıklar: `osm, carto-light, carto-dark, carto-voyager, none, custom`.

## 12. Notlar

* **CORS:** URL'den çekilen ağ farklı kaynaktaysa sunucu
  `Access-Control-Allow-Origin` göndermelidir; mümkün değilse **inline** kullanın.
* **Performans:** görünmeyen feature'lar elenir (bbox kırpma), çizim
  `requestAnimationFrame` ile birleşir; akış animasyonu yalnız etkinken çalışır;
  jenks büyük veride otomatik örneklenir.
* **PNG dışa aktarım** vektör + zemini içerir (tile'lar CORS taint'i önlemek için
  dışarıda bırakılır).
* **Test:** format ayrıştırıcıları, sınıflandırma/jenks ve uçtan uca bileşen akışı
  Node testleriyle doğrulanmıştır.
