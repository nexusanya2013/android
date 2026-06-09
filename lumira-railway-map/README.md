# TCDD Railway Map — SAP Lumira Designer 2.4 SDK Bileşeni

Hafif, hızlı ve **bağımlılıksız** profesyonel bir harita/analitik bileşeni.
Demiryolu ağını katman katman gösterir; ölçüleri **hat kesimi bazında** dağıtır;
her katman **ayrı bir render tipi** (çizgi / nokta / işaretçi / balon / ısı
haritası) ve **ayrı bir veri kaynağı/ölçü** kullanabilir. Sürükle-bırak ile
yerel dosya yüklenir; sınıflandırma, kategorik renk, etiket/ok/akış, legend,
ölçek, arama, PNG dışa aktarım ve çoklu altlık (basemap) içerir.

> **Bağımsız çalışır:** Leaflet / Google Maps / API anahtarı yoktur — saf
> JavaScript + HTML5 Canvas. Hızlı açılır, offline çalışır, bir 3. taraf API'nin
> kalkmasından etkilenmez. (İsteğe bağlı XYZ tile altlığı tarayıcıdan çekilir.)
>
> **TCDD verisine hazır:** varsayılan `Segment Id = Hat_kesim`, `Name = Tanim`.

---

## 1. Veri akışı

```
 Veri kaynakları                     Ağ kaynağı (URL / inline / sürükle-bırak)
 Data / B / C / D (metadata+tuples)  GeoJSON · TopoJSON · KML · GPX · JSON
        │ parseSource() + aggregate          │ parseNetwork() → GeoJSON
        ▼                                     ▼  normalizeGeoJson() (+anchor)
  {ölçü: {Hat_kesim: değer}} ── join (key↔id) ──► feature
        │                                     │
        ▼                                     ▼
  rebuildLayers(): taban + her ölçü/kaynak için katman + yüklenen katmanlar
        │  sembol: ramp/graduated/categorical/width · tip: line/point/marker/bubble/heatmap
        ▼
  MapEngine (Canvas): pan/zoom/box-zoom, casing, ok, akış, etiket, legend, arama…
```

## 2. Kurulum

`Tools ▸ Install Extension to SAP Lumira Designer…` ile `dist/com.tcdd.railmap_*.jar`
yüklenir, Designer yeniden başlatılır. Palet: **TcddMaps ▸ Railway Map**.
Kaynaktan: `bash build.sh`.

## 3. Hızlı başlangıç

1. Bileşeni ekleyin. **Network Source URL** (veya **inline** / sürükle-bırak).
2. **Segment Id Property** = `Hat_kesim`, **Segment Name Property** = `Tanim`.
3. **Data Source** → satırlarda hat kesim boyutu, sütunlarda ölçüler.
4. **Segment Dimension** → hat kesim boyutunun teknik adı.

## 4. Katman tipleri (her katman ayrı)

`Layer Type` (genel) veya katman kontrolündeki tip seçici / `setLayerType(id,type)`:

| Tip | Açıklama |
|-----|----------|
| **line / multiline** | hat çizimi (varsayılan); casing, ok, akış, etiket destekler |
| **point** | her hat kesiminin temsilî noktasında daire |
| **marker** | harita iğnesi (pin) |
| **bubble** | değere orantılı daire (alan-orantılı) |
| **heatmap** | yoğunluk ısı haritası (değer ağırlıklı; bağımlılıksız) |

## 5. Sembolizasyon (renk)

`Symbology`: **ramp** (sürekli) · **graduated** (sınıflı: quantile/equal/**jenks**) ·
**categorical** (ayrık) · **width** (kalınlık). Legend sembolojiye göre uyarlanır.

## 6. Çok ölçü / çok kaynak — her katman farklı olabilir

* **Aynı kaynak, çok ölçü:** her ölçü ayrı katman; her birinin kendi tipi/rampası.
* **Ölçüler arası geçiş:** bir kaynakta >1 ölçü varsa katman kontrolünde **ölçü
  açılır seçicisi** çıkar (▣ Tümü ile hepsini gösterebilirsiniz).
* **Farklı veri kaynakları:** ana `Data Source`'a ek **Data Source B / C / D**
  bağlayın (tamamen farklı kaynaklar olabilir). `Binding Config (JSON)`:
  ```json
  { "B": { "title":"Bütçe", "segDim":"ZHATKESIM", "ramp":"blue", "type":"bubble" },
    "C": { "title":"Geçen Yıl", "ramp":"gray", "type":"line" } }
  ```
* **Tam esneklik (script):** her kaynağı okuyup ayrı katmana besleyin:
  `setLayerData("butce","Bütçe", jsonString, "blue", "bubble")`.

> Not: Lumira'da `metadata` çoğunlukla ortaktır; farklı kaynakların etiket
> eşleşmesini garanti için slot başına `segDim` verin veya script yolunu kullanın.

## 7. Dosya yükleme → ayrı katmanlar

Araç çubuğundaki ⬆ düğmesi veya **sürükle-bırak** ile yerel dosya yükleyin
(GeoJSON/TopoJSON/KML/GPX/JSON, çoklu seçim). **Upload Mode**:
`layer` (her dosya ayrı katman) · `base` (taban ağı değiştir) · `append` (tabana ekle).
Tamamen tarayıcı tarafında, oturum içidir (kaydedilmez).

## 8. Etkileşim & arayüz

Pan (sürükle) · zoom (tekerlek/çift-tık/+−/klavye) · **kutu-zoom (Shift+sürükle)**.
Araç çubuğu: sığdır · yükle · ara · PNG · tam ekran. Ayrıca altlık seçici,
katman kontrolü (checkbox/radio/dropdown + tip & ölçü seçicileri), legend,
ölçek çubuğu, koordinat, başlık/alt başlık, **light/dark** tema.
**Tooltip:** segmentin tüm ölçü değerleri (renk noktalı) + seçili feature alanları.

## 9. Script (BIAL) API — özet

```javascript
// katman / ölçü / tip
RAILWAYMAP_1.setActiveMeasure("Tonaj");
RAILWAYMAP_1.showOnlyLayer("Gecikme");   RAILWAYMAP_1.setLayerVisible("Bütçe", true);
RAILWAYMAP_1.setLayerType("Tonaj","bubble");      // line|point|marker|bubble|heatmap
RAILWAYMAP_1.setLayerOpacity("Tonaj", 70);
RAILWAYMAP_1.getMeasures();   RAILWAYMAP_1.getVisibleLayers();

// sembol / sınıf / dekor
RAILWAYMAP_1.setSymbology("graduated");  RAILWAYMAP_1.setClassification("jenks", 6);
RAILWAYMAP_1.setArrows(true);  RAILWAYMAP_1.setFlowAnimation(true);  RAILWAYMAP_1.setLabelsOn(true);

// script-besili / ek geometri katmanları
RAILWAYMAP_1.setLayerData("bakim","Bakım", json, "heat", "bubble");
RAILWAYMAP_1.addNetworkLayer("baglanti","Bağlantı Hatları", geojsonString, "auto");
RAILWAYMAP_1.removeNetworkLayer("baglanti");   RAILWAYMAP_1.clearUploads();

// altlık / seçim / arama / dışa aktarım / navigasyon
RAILWAYMAP_1.setBasemap("carto-dark");
RAILWAYMAP_1.selectSegment("132-H-2773");  RAILWAYMAP_1.clearSelection();
RAILWAYMAP_1.search("Sivas");   RAILWAYMAP_1.exportPng();
RAILWAYMAP_1.zoomToSegment("SVS-ERZ-06");  RAILWAYMAP_1.fitToNetwork();
RAILWAYMAP_1.setView(39.93, 32.85, 7);  RAILWAYMAP_1.getZoom();
```

## 10. Olaylar

* **onSelect** — hat kesimine tıklayınca (`selectedSegment/Name/Layer`).
* **onLayerToggle** — katman aç/kapat (`selectedLayer`).
* **onDoubleClick** — haritada çift tık.
* **onViewChange** — pan/zoom sonrası (gecikmeli); `centerLat/centerLng/currentZoom`.

## 11. Özellik grupları (tasarımcı panelinde tooltipli)

`1-Veri (Data, B, C, D, Binding Config) · 2-Ağ · 3-Katmanlar · 4-Sembol (+ tip,
bubble/heat, seçiciler) · 5-Harita Görünümü · 6-Altlık · 7-Stil · 8-Etiket/Ok/Akış ·
9-Biçim · 10-Legend/İpucu · 11-Arayüz · 12-Seçim · 13-Olaylar`

Rampalar: `traffic, rdylgn, blue, green, heat, purple, viridis, cool, gray`.
Altlıklar: `osm, carto-light, carto-dark, carto-voyager, none, custom`.

## 12. Notlar & kalite

* **CORS:** URL'den çekilen ağ farklı kaynaktaysa sunucu
  `Access-Control-Allow-Origin` göndermeli; mümkün değilse **inline**/yükleme kullanın.
* **Performans:** görünmeyen feature elenir (bbox), çizim `requestAnimationFrame`
  ile birleşir, tile önbelleği sınırlanır, akış animasyonu yalnız etkinken döner,
  jenks büyük veride otomatik örneklenir.
* **PNG dışa aktarım** vektör + zemini içerir (tile'lar CORS taint'i önlemek için hariç).
* **Test:** parser'lar, sınıflandırma/jenks, render tipleri, çok-kaynak bağlama,
  ölçü seçici, yükleme ve uçtan uca akış Node testleriyle doğrulanmıştır (38 onay).
