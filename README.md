# TCDD Railway Map — SAP Lumira Designer 2.4 SDK Component

Hafif, hızlı ve **bağımlılıksız** bir özel harita bileşeni. Demiryolu ağını
katman katman gösterir; veri kaynağından bağlanan ölçüleri (measure) hat kesimi
bazında dağıtarak renklendirir; katmanlar dropdown / onay kutusu kontrolüyle
açılıp kapatılır.

> Harici hiçbir kütüphane yoktur — Leaflet, Google Maps veya API anahtarı
> gerekmez. Saf JavaScript + HTML5 Canvas. Bu sayede hızlı açılır, offline
> çalışır ve üçüncü taraf bir API'nin kullanımdan kaldırılmasından etkilenmez.
> (İsteğe bağlı XYZ tile arka planı tarayıcı tarafından çekilir; erişim yoksa
> düz zemine düşer.)

---

## 1. Klasör yapısı

```
com.tcdd.railmap/
├── META-INF/MANIFEST.MF        OSGi bundle tanımı
├── plugin.xml                  SDK extension point kaydı
├── contribution.xml            bileşen + özellikler + olaylar
├── contribution.ztl            BIAL script arayüzü
└── res/
    ├── icon.png
    └── js/
        ├── railmap-core.js     bağımlılıksız Canvas harita motoru
        └── component.js        SDK tutkalı (veri bağlama, katmanlar, UI)
samples/
└── railway-network.sample.geojson   örnek hat kesim ağı
```

## 2. Derleme ve kurulum (Lumira Designer 2.4)

İki yol vardır:

**A) Hazır JAR'ı yüklemek (en hızlı).** `dist/` altındaki
`com.tcdd.railmap_*.jar` dosyasını Lumira Designer'da
`Tools ▸ Install Extension to SAP Lumira Designer…` ile yükleyin (veya BI
Platform için `.jar`'ı ilgili extension klasörüne kopyalayın) ve Designer'ı
yeniden başlatın.

**B) Eclipse SDK ile.** Klasörü mevcut SDK çalışma alanınıza
(`com.sap.ip.bi.zen.rt.components.sdk.eclipse` bağımlılığı kurulu) bir plug-in
projesi olarak alın, `Export ▸ Deployable plug-ins and fragments` ile JAR
üretin.

JAR'ı bu repodan yeniden üretmek için:

```bash
bash build.sh          # dist/com.tcdd.railmap_<versiyon>.jar üretir
```

Kurduktan sonra bileşen, bileşen listesinde **TcddMaps ▸ Railway Map**
altında görünür.

## 3. Hızlı başlangıç

1. Bileşeni tuvale (canvas) ekleyin.
2. **Network GeoJSON URL** → demiryolu ağı GeoJSON'unuzun adresi
   (ör. `https://bopwin.tcdd.gov.tr/convertedson.json`). Alternatif olarak
   **Network GeoJSON (inline)** alanına GeoJSON metnini yapıştırın.
3. **Segment Id Property** → GeoJSON feature içinde hat kesimini benzersiz
   tanımlayan alan adı (varsayılan `id`). **Segment Name Property** → etiket
   alanı (varsayılan `name`).
4. **Data Source** özelliğine bir veri kaynağı bağlayın. Satırlarda hat kesim
   boyutu (dimension), sütunlarda bir veya daha çok ölçü (measure) olsun.
5. **Segment Dimension** → hat kesim boyutunun teknik adı. Bu boyutun üye
   anahtarı (key) GeoJSON'daki Segment Id ile eşleşir.

> Her measure otomatik olarak **ayrı bir katman** olur. Katman kontrolünden
> (sağ üst) açıp kapatabilirsiniz. En altta her zaman tüm ağı gösteren temel
> katman bulunur.

## 4. Veri modeli — measure'lar nasıl katmana dönüşür

Bileşen `databound="true"` olduğundan SDK iki değer sağlar:

* `metadata` → `{ dimensions: [{ key, text, containsMeasures, members:[{key,text}] }] }`
* `data` (ResultCellList) → `{ tuples: [[üyeIndeksi…]], data: [değer] }`

Bileşen, ölçü (measure) boyutundaki her üyeyi bir **katman** olarak üretir ve
değeri, hat kesim boyutunun üye anahtarını GeoJSON `Segment Id` ile eşleştirerek
ilgili segmente atar. Eşleşme hem üye **key** hem **text** üzerinden denenir.

Renk: her katman bir renk rampası alır (`Layer Color Ramps` sırasına göre).
Değerler katman içinde min–max aralığına göre normalize edilip rampaya eşlenir.
Mevcut rampalar: `traffic, rdylgn, blue, green, heat, purple, gray`.

## 5. Katmanları çalışma anında yönetme (script / BIAL)

```javascript
// Belirli bir measure katmanını yalnız başına göster (aktif measure'ı değiştir)
RAILWAYMAP_1.setActiveMeasure("Tonaj");
RAILWAYMAP_1.showOnlyLayer("Gecikme");

// Tek tek aç / kapat
RAILWAYMAP_1.showLayer("Tonaj");
RAILWAYMAP_1.hideLayer("Demiryolu Ağı");
RAILWAYMAP_1.toggleLayer("Hız");
RAILWAYMAP_1.setLayerVisible("Tonaj", true);

// Bağlı measure'ların listesi
var measures = RAILWAYMAP_1.getMeasures();          // "Tonaj,Gecikme,Hız"

// Bir katmanı tamamen script ile besle (veri kaynağı gerekmez)
RAILWAYMAP_1.setLayerData(
  "bakim", "Bakım Skoru",
  '[{"segment":"ANK-IST","value":0.8},{"segment":"ANK-IZM","value":0.3}]',
  "heat");
RAILWAYMAP_1.removeLayer("bakim");

// Navigasyon
RAILWAYMAP_1.zoomToSegment("ANK-SVS");
RAILWAYMAP_1.fitToNetwork();
RAILWAYMAP_1.setView(39.93, 32.85, 7);

// Seçim (onSelect olayında okunur)
var seg  = RAILWAYMAP_1.getSelectedSegment();        // "ANK-IST"
var name = RAILWAYMAP_1.getSelectedSegmentName();    // "Ankara - Istanbul"
```

### İki çalışma şekli

* **Çok measure → çok katman (kodsuz):** Tek veri kaynağına birden çok measure
  bağlayın; her biri ayrı, gizlenip gösterilebilen katman olur.
* **Tek katman, measure'ı kodla değişir:** `setActiveMeasure("…")` (veya
  `showOnlyLayer`) ile sayfa açıldıktan sonra görünen ölçüyü anında
  değiştirirsiniz; istenirse `setLayerData(...)` ile her katmana tamamen
  bağımsız veri beslersiniz.

## 6. Olaylar

* **onSelect** — bir hat kesimine tıklanınca tetiklenir.
  `selectedSegment`, `selectedSegmentName`, `selectedLayer` güncellenir.
* **onLayerToggle** — kullanıcı katman kontrolünden bir katmanı açıp kapatınca
  tetiklenir. `selectedLayer` son değiştirilen katmanı verir.

## 7. Önemli özellikler (özet)

| Grup | Özellik | Açıklama |
|------|---------|----------|
| Data | Data Source, Segment Dimension | veri bağlama ve birleştirme anahtarı |
| Network | Network GeoJSON URL / inline, Segment Id/Name Property | ağ kaynağı |
| Layers | Base Layer Title/Visible, Layer Color Ramps, Visible Layers, Show/Collapse Layer Control | katman davranışı |
| Map View | Initial Lat/Lng/Zoom, Min/Max Zoom, Fit To Network On Load | başlangıç görünümü |
| Base Tiles | Tile Layer URL, Tile Subdomains, Tile Opacity, Background Color | arka plan |
| Styling | Default/Highlight Color, Line/Base Line Weight, Show Legend/Tooltip/Zoom Control | görsel |

## 8. Notlar

* GeoJSON'u URL'den çekerken tarayıcı **CORS** kurallarına tabidir. GeoJSON,
  rapor ile aynı kaynaktan sunulmuyorsa sunucunun
  `Access-Control-Allow-Origin` başlığı göndermesi gerekir. CORS yapılandırması
  mümkün değilse GeoJSON'u **inline** özelliğine gömün.
* Coğrafi koordinatlar WGS84 (EPSG:4326, `[boylam, enlem]`) olmalıdır; bileşen
  içeride Web Mercator'a dönüştürür.
* Çok büyük ağlarda performans için, görünürde olmayan feature'lar çizimde
  elenir (bbox kırpma) ve çizim `requestAnimationFrame` ile birleştirilir.
