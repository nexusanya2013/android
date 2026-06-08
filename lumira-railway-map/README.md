# TCDD Railway Map — SAP Lumira Designer 2.4 SDK Bileşeni

Hafif, hızlı ve **bağımlılıksız** bir özel harita bileşeni. Demiryolu ağını
katman katman gösterir; veri kaynağından bağlanan ölçüleri (measure) **hat kesimi
bazında** dağıtarak renklendirir; katmanlar dropdown / onay kutusu kontrolüyle
açılıp kapatılır. Bir hat kesiminin üzerine gelince o segmente ait **tüm** ölçü
değerleri tek bir bilgi balonunda listelenir.

> **Neden bağımlılıksız?** Harici hiçbir kütüphane yoktur — Leaflet, Google Maps
> veya API anahtarı gerekmez. Saf JavaScript + HTML5 Canvas. Bu sayede hızlı
> açılır, offline çalışır ve üçüncü taraf bir API'nin kullanımdan kaldırılmasından
> etkilenmez. (İsteğe bağlı XYZ tile arka planı tarayıcı tarafından çekilir;
> erişim yoksa düz zemine düşer.)

---

## 1. Mantık — veri nasıl haritaya dönüşür?

```
 ┌─────────────┐   ┌──────────────────┐   ┌───────────────────────┐
 │  Veri Kaynağı│   │  Ağ Kaynağı       │   │  Özellikler (cfg)      │
 │  metadata +  │   │  URL veya inline  │   │  renk, kalınlık, zoom… │
 │  tuples/data │   │  GeoJSON/KML/…    │   │                        │
 └──────┬───────┘   └────────┬─────────┘   └───────────┬───────────┘
        │                    │                         │
        │            parseNetwork()            afterUpdate() ayarları
        │          (format → GeoJSON)                    │
        ▼                    ▼                            ▼
 buildMeasureMaps()   normalizeGeoJson()          MapEngine (Canvas)
 ölçü → { segId:değer} özellikler + bbox          projeksiyon/pan/zoom
        │                    │                            │
        └────────┬───────────┘                            │
                 ▼                                         │
          rebuildLayers()  ── segId ↔ feature.id eşleştir ─┘
                 │
                 ├─ Katman 0: Tüm demiryolu ağı (taban)
                 ├─ Katman 1: 1. ölçü  (renk rampası)   ← aç/kapat
                 ├─ Katman 2: 2. ölçü  (renk rampası)   ← aç/kapat
                 └─ … (her ölçü ayrı katman)
```

**Birleştirme (join) kuralı:** veri kaynağındaki hat kesim boyutunun üye
**anahtarı (key)** — veya metni — ağdaki feature'ın **Segment Id** değerine eşit
olduğunda ölçü o segmente yazılır. Bir segmentin değeri yoksa soluk gri çizilir.

## 2. Klasör yapısı

```
com.tcdd.railmap/
├── META-INF/MANIFEST.MF        OSGi bundle tanımı
├── plugin.xml                  SDK extension point kaydı
├── contribution.xml            bileşen + özellikler (+ her birinde tooltip) + olaylar
├── contribution.ztl            BIAL script arayüzü
└── res/
    ├── icon.png
    └── js/
        ├── railmap-core.js     bağımlılıksız Canvas motoru + format ayrıştırıcılar
        └── component.js        SDK tutkalı (veri bağlama, katmanlar, UI, tooltip)
samples/
└── railway-network.sample.geojson   örnek hat kesim ağı
build.sh                        dağıtılabilir JAR üretir
```

## 3. Derleme ve kurulum (Lumira Designer 2.4)

**A) Hazır JAR (en hızlı).** `dist/com.tcdd.railmap_*.jar` dosyasını Lumira
Designer'da `Tools ▸ Install Extension to SAP Lumira Designer…` ile yükleyin,
Designer'ı yeniden başlatın.

**B) Kaynaktan JAR üret.**
```bash
bash build.sh        # -> dist/com.tcdd.railmap_<versiyon>.jar
```

**C) Eclipse SDK.** Klasörü `com.sap.ip.bi.zen.rt.components.sdk.eclipse`
bağımlılığı kurulu çalışma alanına plug-in projesi olarak alın,
`Export ▸ Deployable plug-ins and fragments` ile JAR üretin.

Kurulumdan sonra bileşen, paletin **TcddMaps ▸ Railway Map** altında görünür.

## 4. Hızlı başlangıç

1. Bileşeni tuvale ekleyin.
2. **Network Source URL** → ağ dosyanız (ör. `https://bopwin.tcdd.gov.tr/convertedson.json`).
   Alternatif: **Network (inline)** alanına dosyanın içeriğini yapıştırın.
3. **Network Format** → genellikle `auto`. Gerekirse `geojson/topojson/kml/gpx/json`.
4. **Segment Id Property** → feature içinde hat kesimini tanımlayan alan (vars. `id`).
5. **Data Source** → satırlarda hat kesim boyutu, sütunlarda ölçüler.
6. **Segment Dimension** → hat kesim boyutunun teknik adı.

Her ölçü otomatik olarak ayrı bir katman olur; sağ üstteki kontrolden aç/kapat.

## 5. Desteklenen ağ formatları

| Format | Nasıl algılanır | Notlar |
|--------|-----------------|--------|
| **GeoJSON** | `type:"FeatureCollection"`/`"Feature"` | LineString, MultiLineString, Polygon, Point |
| **TopoJSON** | `type:"Topology"` | arc'lar (delta+quantize) çözülür; daha küçük dosya |
| **KML** | `<kml>` / `<Placemark>` | `<LineString>`, `<Polygon>`, `<Point>`, `<ExtendedData>` → özellikler |
| **GPX** | `<gpx>` | `<trk>/<trkseg>/<trkpt>`, `<rte>`, `<wpt>` |
| **Düz JSON** | dizi `[ … ]` | `[{ "id","name","coordinates":[[lng,lat]…] }]` veya `{lat,lng}` noktalar |

`Network Format = auto` ise içeriğe bakılarak otomatik seçilir. Koordinatlar
WGS84 `[boylam, enlem]` olmalıdır; bileşen içeride Web Mercator'a dönüştürür.

## 6. Veri modeli (örnekle)

Bileşen `databound="true"` olduğundan SDK iki değer sağlar:

```
metadata = { dimensions: [
   { key:"ZHATKESIM", containsMeasures:false, members:[{key:"ANK-IST",text:"Ankara-İstanbul"}, …] },
   { key:"MEASURES",  containsMeasures:true,  members:[{text:"Tonaj"},{text:"Gecikme"}] }
]}
data = { tuples:[[0,0],[0,1],[1,0],[1,1]], data:[100, 5, 50, 9] }
```

Bu durumda:
* **Tonaj** katmanı → `{ "ANK-IST":100, "ANK-IZM":50 }`
* **Gecikme** katmanı → `{ "ANK-IST":5, "ANK-IZM":9 }`

ve değerler `ANK-IST`, `ANK-IZM` Segment Id'leriyle eşleşen feature'lara yazılır.

## 7. İki çalışma şekli

* **Çok measure → çok katman (kodsuz):** tek veri kaynağına birden çok ölçü
  bağlayın; her biri ayrı, gizlenip gösterilebilen katman olur.
* **Tek katman, measure'ı kodla değişir:** sayfa açıldıktan sonra
  `setActiveMeasure("Tonaj")` ile görünen ölçüyü değiştirin; ya da
  `setLayerData(...)` ile her katmana tamamen bağımsız veri besleyin.

## 8. Tooltip — "her alan için açıklama"

Bir hat kesiminin üzerine gelince bilgi balonu şunları gösterir:
* Hat kesiminin adı (+ ID),
* **bağlı her ölçünün** o segmentteki değeri, çizimdeki renk noktasıyla,
* `Tooltip Properties` ile seçilen ek feature alanları.

`Tooltip Shows All Measures` kapatılırsa yalnızca ad gösterilir.

## 9. Script (BIAL) API

```javascript
// Görünür ölçüyü değiştir (tek katman mantığı)
RAILWAYMAP_1.setActiveMeasure("Tonaj");
RAILWAYMAP_1.showOnlyLayer("Gecikme");

// Tek tek aç/kapat
RAILWAYMAP_1.showLayer("Tonaj");
RAILWAYMAP_1.hideLayer("Demiryolu Ağı");
RAILWAYMAP_1.toggleLayer("Hız");
RAILWAYMAP_1.setLayerVisible("Tonaj", true);

// Bilgi
RAILWAYMAP_1.getMeasures();          // "Tonaj,Gecikme,Hız"
RAILWAYMAP_1.getVisibleLayers();     // o an görünen katmanlar
RAILWAYMAP_1.getLayerIds();

// Katmanı tamamen script ile besle
RAILWAYMAP_1.setLayerData("bakim","Bakım Skoru",
  '[{"segment":"ANK-IST","value":0.8},{"segment":"ANK-IZM","value":0.3}]', "heat");
RAILWAYMAP_1.removeLayer("bakim");

// Navigasyon
RAILWAYMAP_1.zoomToSegment("ANK-SVS");
RAILWAYMAP_1.fitToNetwork();
RAILWAYMAP_1.setView(39.93, 32.85, 7);
RAILWAYMAP_1.refresh();              // ağı yeniden yükle

// Seçim (onSelect içinde)
RAILWAYMAP_1.getSelectedSegment();       // "ANK-IST"
RAILWAYMAP_1.getSelectedSegmentName();   // "Ankara - İstanbul"
RAILWAYMAP_1.getSelectedLayer();
```

Tüm yapılandırma özelliklerinin de `get…/set…` karşılığı vardır
(`contribution.ztl`).

## 10. Olaylar

* **onSelect** — bir hat kesimine tıklanınca; `selectedSegment`,
  `selectedSegmentName`, `selectedLayer` güncellenir.
* **onLayerToggle** — katman kontrolünden bir katman açılıp kapatılınca;
  `selectedLayer` son değişen katmanı verir.

## 11. Özellik referansı (gruplara göre)

Her özelliğin tasarımcıda üzerine gelince çıkan açıklaması (`tooltip`) vardır.

| Grup | Özellikler |
|------|-----------|
| 1 – Veri | Data Source, Segment Dimension |
| 2 – Ağ | Network Source URL, Network Format, Network (inline), Segment Id/Name Property |
| 3 – Katmanlar | Base Layer Title/Visible, Layer Color Ramps, Visible Layers, Show/Collapse/Title Layer Control |
| 4 – Harita Görünümü | Initial Lat/Lng/Zoom, Min/Max Zoom, Fit To Network On Load |
| 5 – Arka Plan | Tile Layer URL, Tile Subdomains, Tile Opacity, Background Color |
| 6 – Stil | Default/Highlight Color, Line/Base Line Weight, Show Legend, Legend Title |
| 7 – İpucu | Show Tooltip, Tooltip Shows All Measures, Tooltip Properties |
| 8 – Genel | Show Zoom Control |
| 9 – Seçim | Selected Segment / Name / Layer |

Renk rampaları: `traffic, rdylgn, blue, green, heat, purple, gray`.

## 12. Notlar

* **CORS:** GeoJSON/KML'i URL'den çekerken tarayıcı CORS kurallarına tabidir.
  Dosya, rapor ile aynı kaynaktan sunulmuyorsa sunucu
  `Access-Control-Allow-Origin` başlığı göndermelidir. Mümkün değilse içeriği
  **inline** özelliğine gömün.
* **Performans:** görünmeyen feature'lar çizimde elenir (bbox kırpma) ve çizim
  `requestAnimationFrame` ile birleştirilir; binlerce hat kesimi akıcı çalışır.
* **Test:** ayrıştırıcılar ve bileşen çalışma akışı Node tabanlı testlerle
  doğrulanmıştır (GeoJSON/TopoJSON/KML/GPX/JSON + uçtan uca katman kurulumu).
