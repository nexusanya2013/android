// ============================================================================
//  TCDD Railway Map - SDK component glue
//  ===========================================================================
//  Connects the dependency-free Canvas engine (railmap-core.js) to the Lumira
//  Designer SDK. Data flow:
//    1. PROPERTIES  Lumira sets each property via this.<id>(value) -> cfg
//    2. NETWORK     base network loaded (GeoJSON/TopoJSON/KML/GPX/JSON)
//    3. DATA        bound data source (metadata + tuples) -> per-measure maps
//                   (with aggregation when several rows hit one segment)
//    4. LAYERS      base network + one layer per measure; symbology = colour
//                   ramp / graduated classes / categorical / width
//    5. UI          toolbar, basemap switcher, layer control, legend, scale
//                   bar, coordinates, title, tooltip, search
//    6. EVENTS/API  onSelect / onLayerToggle / onDoubleClick / onViewChange
//                   plus a rich BIAL API (contribution.ztl)
// ============================================================================
sap.designstudio.sdk.Component.subclass("com.tcdd.railmap.RailwayMap", function () {

	var that = this;
	var R = null;   // TCDDRailMap namespace (resolved in init)

	// ---- 1. configuration (defaults mirror contribution.xml) -------------
	var cfg = {
		// data + network  (defaults match TCDD "hat_kesim_veri_" GeoJSON)
		segmentDimension: "", segmentIdProperty: "Hat_kesim", segmentNameProperty: "Tanim",
		networkUrl: "", networkGeoJson: "", networkFormat: "auto", aggregate: "last",
		// layers
		baseLayerTitle: "Demiryolu Ağı", baseLayerVisible: true,
		layerColors: "traffic,blue,rdylgn,heat,purple,viridis", visibleLayers: "",
		showLayerControl: true, layerControlCollapsed: true, layerControlTitle: "Katmanlar", layerControlMode: "checkbox",
		// symbology
		symbology: "ramp", classMethod: "quantile", classCount: 5, minWidth: 2, maxWidth: 14, layerConfig: "",
		// map view
		initialLat: 39.2, initialLng: 35.2, initialZoom: 6, minZoom: 2, maxZoom: 18, fitNetworkOnLoad: true,
		// basemap / tiles
		basemap: "osm", tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", tileSubdomains: "a,b,c", tileOpacity: 100, backgroundColor: "#eef2f5",
		// styling
		defaultColor: "#5a6b7b", lineWeight: 4, baseLineWeight: 2, highlightColor: "#ff7f0e",
		lineCasing: true, layerOpacity: 100, pointRadius: 5,
		showArrows: false, arrowSpacing: 90, flowAnimation: false,
		showLabels: false, labelMode: "name", labelMinZoom: 8,
		// formatting
		valueDecimals: -1, valueUnit: "", thousandSep: true,
		// legend / tooltip
		showLegend: true, legendTitle: "", showTooltip: true, tooltipShowMeasures: true, tooltipProperties: "",
		// chrome
		showToolbar: true, showSearch: true, showScaleBar: true, showCoordinates: false,
		showZoomControl: true, showBasemapControl: true, uiTheme: "light", title: "", subtitle: "",
		allowUpload: true, uploadMode: "layer",
		// outputs
		selectedSegment: "", selectedSegmentName: "", selectedLayer: "",
		centerLat: 39.2, centerLng: 35.2, currentZoom: 6
	};

	var meta = null, ds = null, engine = null;
	var baseFeatures = [], measureOrder = [], scriptLayers = {};
	var uploadedLayers = [], _uploadSeq = 0;        // file/script added geometry layers
	var loadedNetworkKey = null, needData = false, needNetwork = false;
	var ui = {}, vcTimer = null;
	var UPCOLORS = ["#e15759", "#4e79a7", "#59a14f", "#b07aa1", "#9c755f", "#edc949", "#ff9da7", "#76b7b2"];

	// ---- helpers ---------------------------------------------------------
	function el(tag, css, parent) { var e = document.createElement(tag); if (css) { e.style.cssText = css; } if (parent) { parent.appendChild(e); } return e; }
	function txt(node, s) { node.appendChild(document.createTextNode(s == null ? "" : "" + s)); return node; }
	function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } }
	function csv(s) { var a = ("" + (s || "")).split(/[,;]/), o = []; for (var i = 0; i < a.length; i++) { var v = a[i].replace(/^\s+|\s+$/g, ""); if (v) { o.push(v); } } return o; }
	function ramps() { var o = csv(cfg.layerColors); return o.length ? o : ["blue"]; }
	function tileOpacityFrac() { return Math.max(0, Math.min(1, (cfg.tileOpacity == null ? 100 : cfg.tileOpacity) / 100)); }
	function num(v, d) { v = parseFloat(v); return isNaN(v) ? d : v; }

	function fmt(v) {
		if (v == null || isNaN(v)) { return "-"; }
		var n = Number(v), s, d = cfg.valueDecimals;
		if (d != null && d >= 0) {
			s = n.toFixed(d);
			if (cfg.thousandSep) { var pr = s.split("."); pr[0] = pr[0].replace(/\B(?=(\d{3})+(?!\d))/g, "."); s = pr.join(","); }
		} else {                                                       // auto-compact
			var a = Math.abs(n);
			if (a >= 1e9) { s = (n / 1e9).toFixed(1) + " Mr"; }
			else if (a >= 1e6) { s = (n / 1e6).toFixed(1) + " M"; }
			else if (a >= 1e3) { s = (n / 1e3).toFixed(1) + " B"; }
			else { s = "" + (Math.round(n * 100) / 100); }
		}
		return s + (cfg.valueUnit ? (" " + cfg.valueUnit) : "");
	}

	// theme palette for the floating panels
	function theme() {
		return cfg.uiTheme === "dark"
			? { bg: "rgba(26,32,40,.93)", bd: "#3a4654", fg: "#e6edf3", sub: "#9fb3c8", hair: "#2c3742", btn: "#222b35" }
			: { bg: "rgba(255,255,255,.95)", bd: "#cfd8e0", fg: "#2a3540", sub: "#5a6b7b", hair: "#e3e9ee", btn: "#ffffff" };
	}
	function panel(css) { var t = theme(); return "position:absolute;z-index:5;background:" + t.bg + ";border:1px solid " + t.bd + ";border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.18);color:" + t.fg + ";font-size:12px;" + (css || ""); }

	// ======================================================================
	//  lifecycle
	// ======================================================================
	this.init = function () {
		R = window.TCDDRailMap;
		var host = this.$()[0];
		host.style.position = "relative"; host.style.width = "100%"; host.style.height = "100%";
		host.style.background = cfg.backgroundColor; host.style.font = "12px Arial,Helvetica,sans-serif";
		ui.host = host;

		engine = new R.MapEngine(host, { lat: cfg.initialLat, lng: cfg.initialLng, zoom: cfg.initialZoom, minZoom: cfg.minZoom, maxZoom: cfg.maxZoom, background: cfg.backgroundColor });
		applyBasemap();
		engine.on("click", onClick);
		engine.on("dblclick", onDblClick);
		engine.on("hover", onHover);
		engine.on("viewchange", onViewChange);

		buildChrome(host);
		buildZoomButtons();
		bindCoordReadout();
		bindUpload(host);

		if (window.ResizeObserver) { ui.ro = new ResizeObserver(function () { if (engine) { engine.resize(); } }); ui.ro.observe(host); }
		else if (window.addEventListener) { window.addEventListener("resize", function () { if (engine) { engine.resize(); } }); }

		needNetwork = true;
	};

	this.afterUpdate = function () {
		if (!engine) { return; }
		engine.minZoom = cfg.minZoom; engine.maxZoom = cfg.maxZoom;
		engine.setBackground(cfg.backgroundColor);
		engine.resize();
		applyBasemap();

		if (needNetwork) { needNetwork = false; ensureNetwork(); }
		else if (needData) { needData = false; rebuildLayers(); }
		else { layoutOverlays(); }
	};

	function applyBasemap() {
		var name = ("" + cfg.basemap).toLowerCase();
		if (name && name !== "custom" && R.BASEMAPS[name]) { var b = R.BASEMAPS[name]; engine.setTile(b.url, b.subs, tileOpacityFrac()); }
		else { engine.setTile(cfg.tileUrl, csv(cfg.tileSubdomains), tileOpacityFrac()); }
	}

	// ======================================================================
	//  2. network loading
	// ======================================================================
	function ensureNetwork() {
		var key = (cfg.networkGeoJson ? ("inline:" + cfg.networkGeoJson.length) : ("url:" + cfg.networkUrl)) + "|" + cfg.networkFormat + "|" + cfg.segmentIdProperty + "|" + cfg.segmentNameProperty;
		if (key === loadedNetworkKey && baseFeatures.length) { rebuildLayers(); return; }
		loadedNetworkKey = key;

		var inline = ("" + (cfg.networkGeoJson || "")).replace(/^\s+|\s+$/g, "");
		if (inline.length) { parseAndSet(inline); return; }
		if (!cfg.networkUrl) { status("Ağ kaynağı tanımlı değil (URL veya inline)"); return; }
		status("Demiryolu ağı yükleniyor…");
		try {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", cfg.networkUrl, true);
			xhr.onreadystatechange = function () {
				if (xhr.readyState !== 4) { return; }
				if (xhr.status >= 200 && xhr.status < 300) { parseAndSet(xhr.responseText); }
				else { status("Ağ yüklenemedi (HTTP " + xhr.status + ")"); }
			};
			xhr.send();
		} catch (e) { status("Ağ isteği başarısız: " + e.message); }
	}
	function parseAndSet(raw, fmt) {
		var gj, f = fmt || cfg.networkFormat;
		try { gj = R.parseNetwork(raw, f); }
		catch (e) { status("Ağ ayrıştırılamadı (" + f + "): " + e.message); return; }
		baseFeatures = R.normalizeGeoJson(gj, cfg.segmentIdProperty, cfg.segmentNameProperty);
		if (!baseFeatures.length) { status("Ağ boş ya da çizgi/nokta içermiyor"); return; }
		hideStatus();
		rebuildLayers();
		if (cfg.fitNetworkOnLoad) { engine.fitBounds(engine.allBounds()); }
	}

	// --- file upload / drag & drop (fully client-side, session only) ------
	function formatFromName(n) { n = ("" + n).toLowerCase(); if (/\.kml$/.test(n)) { return "kml"; } if (/\.gpx$/.test(n)) { return "gpx"; } if (/\.topojson$/.test(n)) { return "topojson"; } if (/\.geojson$/.test(n)) { return "geojson"; } return "auto"; }
	function stripExt(n) { return ("" + n).replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""); }
	function parseToFeatures(raw, fmt) { return R.normalizeGeoJson(R.parseNetwork(raw, fmt || "auto"), cfg.segmentIdProperty, cfg.segmentNameProperty); }
	function removeUpload(id) { for (var i = 0; i < uploadedLayers.length; i++) { if (uploadedLayers[i].id === id || uploadedLayers[i].id === "up::" + id || uploadedLayers[i].title === id) { uploadedLayers.splice(i, 1); return true; } } return false; }

	// raw text -> a layer. Honours Upload Mode: layer | base | append
	function addNetworkFromText(raw, fmt, title, fname) {
		var feats;
		try { feats = parseToFeatures(raw, fmt); }
		catch (e) { status("Ayrıştırılamadı (" + (fmt || "auto") + "): " + e.message); return false; }
		if (!feats.length) { status("Dosya boş ya da çizgi/nokta içermiyor"); return false; }
		var mode = ("" + cfg.uploadMode).toLowerCase();
		if (mode === "base") { baseFeatures = feats; loadedNetworkKey = "upload:" + (fname || title); }
		else if (mode === "append") { baseFeatures = baseFeatures.concat(feats); }
		else { _uploadSeq++; uploadedLayers.push({ id: "up::" + _uploadSeq, title: stripExt(title) || ("Katman " + _uploadSeq), features: feats, color: UPCOLORS[(uploadedLayers.length) % UPCOLORS.length], weight: cfg.baseLineWeight + 1, visible: true }); }
		hideStatus();
		return true;
	}
	function handleFiles(files) {
		if (!files || !files.length) { return; }
		if (typeof FileReader === "undefined") { status("Bu tarayıcı dosya okumayı desteklemiyor"); return; }
		var pending = files.length, changed = false;
		status((files.length > 1 ? (files.length + " dosya") : files[0].name) + " okunuyor …");
		for (var i = 0; i < files.length; i++) {
			(function (file) {
				try {
					var fr = new FileReader();
					fr.onload = function () { if (addNetworkFromText("" + fr.result, formatFromName(file.name), file.name, file.name)) { changed = true; } done(); };
					fr.onerror = function () { status("Dosya okunamadı: " + file.name); done(); };
					fr.readAsText(file);
				} catch (e) { status("Yükleme başarısız: " + e.message); done(); }
			})(files[i]);
		}
		function done() { if (--pending <= 0 && changed) { rebuildLayers(); if (cfg.fitNetworkOnLoad) { engine.fitBounds(engine.allBounds()); } } }
	}
	function bindUpload(host) {
		if (!host.addEventListener) { return; }
		host.addEventListener("dragover", function (e) { if (!cfg.allowUpload) { return; } e.preventDefault(); if (ui.drop) { ui.drop.style.display = ""; } });
		host.addEventListener("dragleave", function () { if (ui.drop) { ui.drop.style.display = "none"; } });
		host.addEventListener("drop", function (e) { if (!cfg.allowUpload) { return; } e.preventDefault(); if (ui.drop) { ui.drop.style.display = "none"; } var dt = e.dataTransfer; if (dt && dt.files && dt.files.length) { handleFiles(dt.files); } });
	}

	// ======================================================================
	//  3. data parsing  (metadata + tuples + data, with aggregation)
	// ======================================================================
	function buildMeasureMaps() {
		measureOrder = [];
		var maps = {};
		if (!meta || !meta.dimensions || !ds || !ds.tuples || !ds.data) { return maps; }
		var dims = meta.dimensions, measureDim = -1, segDim = -1, i;
		for (i = 0; i < dims.length; i++) {
			if (dims[i].containsMeasures) { measureDim = i; }
			if (cfg.segmentDimension && dims[i].key === cfg.segmentDimension) { segDim = i; }
		}
		if (segDim < 0) { for (i = 0; i < dims.length; i++) { if (!dims[i].containsMeasures) { segDim = i; break; } } }
		if (segDim < 0) { segDim = 0; }

		var acc = {}, method = ("" + cfg.aggregate).toLowerCase();   // acc[m][seg] = {v,c}
		for (i = 0; i < ds.tuples.length; i++) {
			var t = ds.tuples[i], segMember = dims[segDim] && dims[segDim].members[t[segDim]];
			if (!segMember) { continue; }
			var mTitle = "Değer";
			if (measureDim >= 0) { var mm = dims[measureDim].members[t[measureDim]]; mTitle = (mm && (mm.text != null ? mm.text : mm.key)) || "Değer"; }
			var v = parseFloat(ds.data[i]); if (isNaN(v)) { continue; }
			if (!acc[mTitle]) { acc[mTitle] = {}; measureOrder.push(mTitle); }
			var keys = [];
			if (segMember.key != null) { keys.push("" + segMember.key); }
			if (segMember.text != null && ("" + segMember.text) !== ("" + segMember.key)) { keys.push("" + segMember.text); }
			for (var kk = 0; kk < keys.length; kk++) { aggregate(acc[mTitle], keys[kk], v, method); }
		}
		for (var m in acc) { if (acc.hasOwnProperty(m)) { maps[m] = finalize(acc[m], method); } }
		return maps;
	}
	function aggregate(store, key, v, method) {
		var s = store[key];
		if (!s) { store[key] = { v: v, c: 1, mn: v, mx: v, last: v }; return; }
		s.c++; s.last = v; s.v += v; if (v < s.mn) { s.mn = v; } if (v > s.mx) { s.mx = v; }
	}
	function finalize(store, method) {
		var out = {};
		for (var k in store) {
			if (!store.hasOwnProperty(k)) { continue; }
			var s = store[k];
			out[k] = method === "sum" ? s.v : method === "avg" ? s.v / s.c : method === "min" ? s.mn : method === "max" ? s.mx : method === "count" ? s.c : s.last;
		}
		return out;
	}

	// ======================================================================
	//  4. layer (re)build  + symbology
	// ======================================================================
	function layerOverrides() { try { var o = JSON.parse(cfg.layerConfig || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }

	function rebuildLayers() {
		if (!engine) { return; }
		engine.clearLayers();
		if (!baseFeatures.length && !uploadedLayers.length) { layoutOverlays(); return; }

		// base network (bottom) — measures distribute over this geometry
		if (baseFeatures.length) {
			engine.addLayer({
				id: "__base__", title: cfg.baseLayerTitle, kind: "base", features: baseFeatures, visible: cfg.baseLayerVisible,
				color: cfg.defaultColor, weight: cfg.baseLineWeight, highlightColor: cfg.highlightColor,
				styleFn: function () { return { color: cfg.defaultColor, weight: cfg.baseLineWeight }; }
			});
		}

		// uploaded / script-added geometry layers — each its own colour, toggleable
		for (var u = 0; u < uploadedLayers.length; u++) {
			var up = uploadedLayers[u];
			engine.addLayer({
				id: up.id, title: up.title, kind: "upload", features: up.features, visible: up.visible !== false,
				color: up.color, weight: up.weight || (cfg.baseLineWeight + 1), highlightColor: cfg.highlightColor,
				casing: cfg.lineCasing, pointRadius: cfg.pointRadius, pointStroke: true,
				styleFn: (function (c, w) { return function () { return { color: c, weight: w }; }; })(up.color, up.weight || (cfg.baseLineWeight + 1))
			});
		}

		// measure layers (need base geometry to colour)
		if (baseFeatures.length) {
			var maps = buildMeasureMaps(), rs = ramps(), ov = layerOverrides(), visList = parseVisibleList(), i;
			for (i = 0; i < measureOrder.length; i++) { addMeasureLayer(measureOrder[i], maps[measureOrder[i]], rs[i % rs.length], decideVisible(measureOrder[i], i, visList), null, ov[measureOrder[i]]); }
			var si = measureOrder.length;
			for (var id in scriptLayers) { if (scriptLayers.hasOwnProperty(id)) { var sl = scriptLayers[id]; addMeasureLayer(sl.title || id, sl.values, sl.ramp || rs[si % rs.length], sl.visible !== false, id, sl.cfg); si++; } }
		}

		layoutOverlays();
		engine.scheduleRender();
	}

	function addMeasureLayer(title, values, ramp, visible, forceId, over) {
		over = over || {};
		var sym = ("" + (over.symbology || cfg.symbology)).toLowerCase();
		var lyrRamp = over.ramp || ramp;
		var weight = num(over.weight, cfg.lineWeight);
		var sorted = R.sortedValues(values), min = sorted.length ? sorted[0] : 0, max = sorted.length ? sorted[sorted.length - 1] : 1;

		var layer = {
			id: forceId || ("m::" + title), title: title, kind: "measure", features: baseFeatures, visible: visible,
			ramp: lyrRamp, symbology: sym, min: min, max: max, values: values, weight: weight,
			color: R.rampColor(lyrRamp, 1), highlightColor: cfg.highlightColor,
			opacity: num(over.opacity, cfg.layerOpacity) / 100,
			casing: over.casing != null ? !!over.casing : cfg.lineCasing,
			arrows: over.arrows != null ? !!over.arrows : cfg.showArrows, arrowSpacing: num(over.arrowSpacing, cfg.arrowSpacing),
			dash: over.dash || (sym === "flow" ? [10, 8] : null), dashAnimate: over.flow != null ? !!over.flow : cfg.flowAnimation,
			pointRadius: num(over.pointRadius, cfg.pointRadius), pointStroke: true,
			labels: over.labels != null ? !!over.labels : cfg.showLabels, labelMinZoom: num(over.labelMinZoom, cfg.labelMinZoom),
			labelColor: cfg.uiTheme === "dark" ? "#e6edf3" : "#26333f"
		};
		if (layer.dashAnimate && !layer.dash) { layer.dash = [10, 8]; }

		// label content
		var labelMode = ("" + (over.labelMode || cfg.labelMode)).toLowerCase();
		layer.labelFn = function (f) {
			if (labelMode === "id") { return f.id; }
			if (labelMode === "value") { var v = values[f.id]; return v == null ? "" : fmt(v); }
			return f.name != null ? f.name : f.id;
		};

		// symbology -> per-feature style
		if (sym === "categorical") {
			var cats = distinctSorted(values), catMap = {}, legend = [];
			for (var c = 0; c < cats.length; c++) { var col = R.categoryColor(c); catMap[cats[c]] = col; legend.push({ value: cats[c], color: col }); }
			layer.legend = { type: "category", items: legend };
			layer.styleFn = function (f) { var v = values[f.id]; if (f.id == null || v == null) { return faint(); } return { color: catMap[v], weight: weight }; };
		} else if (sym === "graduated") {
			var n = Math.max(2, num(over.classCount, cfg.classCount));
			var edges = R.classify(sorted, over.classMethod || cfg.classMethod, n);
			layer.legend = { type: "classes", ramp: lyrRamp, edges: edges, n: n };
			layer.styleFn = function (f) { var v = values[f.id]; if (f.id == null || v == null) { return faint(); } var idx = R.classIndex(edges, v); return { color: R.rampColor(lyrRamp, n <= 1 ? 0.5 : idx / (n - 1)), weight: weight }; };
		} else if (sym === "width") {
			var wmin = num(over.minWidth, cfg.minWidth), wmax = num(over.maxWidth, cfg.maxWidth);
			layer.legend = { type: "width", ramp: lyrRamp, min: min, max: max, wmin: wmin, wmax: wmax };
			layer.styleFn = function (f) { var v = values[f.id]; if (f.id == null || v == null) { return faint(); } var t = (max > min) ? (v - min) / (max - min) : 0.5; return { color: R.rampColor(lyrRamp, t), weight: wmin + t * (wmax - wmin) }; };
		} else {                                                       // ramp (continuous)
			layer.legend = { type: "ramp", ramp: lyrRamp, min: min, max: max };
			layer.styleFn = function (f) { var v = values[f.id]; if (f.id == null || v == null) { return faint(); } var t = (max > min) ? (v - min) / (max - min) : 0.5; return { color: R.rampColor(lyrRamp, t), weight: weight }; };
		}
		engine.addLayer(layer);
		return layer;
	}
	function faint() { return { color: "#dfe3e6", weight: cfg.baseLineWeight, opacity: 0.4 }; }
	function distinctSorted(values) { var seen = {}, a = []; for (var k in values) { if (values.hasOwnProperty(k)) { var v = values[k]; if (!seen[v]) { seen[v] = 1; a.push(v); } } } a.sort(function (x, y) { return x - y; }); return a; }

	function parseVisibleList() { var a = csv(cfg.visibleLayers), o = {}; for (var i = 0; i < a.length; i++) { o[a[i]] = true; } return o; }
	function decideVisible(title, idx, visList) { var has = false, k; for (k in visList) { if (visList.hasOwnProperty(k)) { has = true; break; } } if (has) { return !!(visList[title] || visList["m::" + title]); } return idx === 0; }

	// ======================================================================
	//  5. chrome (built once) + overlays (rebuilt on demand)
	// ======================================================================
	function buildChrome(host) {
		ui.title = el("div", panel("top:8px;left:50%;transform:translateX(-50%);padding:5px 12px;text-align:center;display:none;"), host);
		ui.toolbar = el("div", "position:absolute;top:8px;left:8px;z-index:6;display:flex;flex-direction:column;gap:4px;", host);
		ui.search = el("div", panel("top:8px;left:46px;padding:5px;display:none;"), host);
		ui.basemap = el("div", panel("top:44px;left:46px;padding:4px 6px;display:none;"), host);
		ui.control = el("div", panel("top:8px;right:8px;max-width:250px;"), host);
		ui.legend = el("div", panel("left:8px;bottom:8px;padding:6px 8px;"), host);
		ui.scale = el("div", "position:absolute;right:46px;bottom:10px;z-index:5;font-size:10px;color:" + theme().fg + ";text-align:center;", host);
		ui.coords = el("div", panel("left:50%;bottom:8px;transform:translateX(-50%);padding:2px 8px;font-size:10px;display:none;"), host);
		ui.tip = el("div", "position:absolute;z-index:8;pointer-events:none;display:none;background:rgba(20,28,36,.94);color:#fff;padding:6px 8px;border-radius:5px;font-size:11px;line-height:1.5;max-width:300px;box-shadow:0 2px 8px rgba(0,0,0,.3);", host);
		ui.zoom = el("div", "position:absolute;right:8px;bottom:8px;z-index:6;display:flex;flex-direction:column;", host);
		ui.status = el("div", panel("left:50%;top:50%;transform:translate(-50%,-50%);z-index:7;padding:8px 14px;display:none;"), host);
		ui.drop = el("div", "position:absolute;inset:0;left:0;top:0;right:0;bottom:0;z-index:10;display:none;align-items:center;justify-content:center;" +
			"background:rgba(43,140,190,.12);border:3px dashed #2b8cbe;color:#1c4a63;font-weight:bold;font-size:14px;pointer-events:none;", host);
		txt(ui.drop, "Ağ dosyasını bırakın (GeoJSON / TopoJSON / KML / GPX / JSON)");
		ui.fileInput = el("input", "display:none;", host);
		ui.fileInput.type = "file";
		ui.fileInput.multiple = true;
		ui.fileInput.accept = ".geojson,.json,.topojson,.kml,.gpx,.txt,application/json,application/vnd.google-earth.kml+xml";
		ui.fileInput.onchange = function () { if (ui.fileInput.files && ui.fileInput.files.length) { handleFiles(ui.fileInput.files); } ui.fileInput.value = ""; };
	}

	function layoutOverlays() {
		var t = theme();
		// re-skin panels for theme
		eachPanel(function (p) { if (p) { p.style.background = t.bg; p.style.borderColor = t.bd; p.style.color = t.fg; } });
		buildToolbar(); buildBasemapControl(); buildLayerControl(); buildLegend(); buildZoomButtons(); updateScale(); buildTitle();
		ui.coords.style.display = cfg.showCoordinates ? "" : "none";
		ui.scale.style.display = cfg.showScaleBar ? "" : "none";
		ui.zoom.style.display = cfg.showZoomControl ? "" : "none";
		ui.control.style.display = (cfg.showLayerControl && engine.layers.length) ? "" : "none";
		ui.toolbar.style.display = cfg.showToolbar ? "" : "none";
	}
	function eachPanel(fn) { fn(ui.title); fn(ui.search); fn(ui.basemap); fn(ui.control); fn(ui.legend); fn(ui.coords); fn(ui.status); }

	function buildTitle() {
		clear(ui.title);
		if (!cfg.title && !cfg.subtitle) { ui.title.style.display = "none"; return; }
		ui.title.style.display = "";
		if (cfg.title) { txt(el("div", "font-weight:bold;font-size:13px;", ui.title), cfg.title); }
		if (cfg.subtitle) { txt(el("div", "font-size:11px;color:" + theme().sub + ";", ui.title), cfg.subtitle); }
	}

	function tbBtn(parent, label, title) { var b = el("button", "width:30px;height:30px;border:1px solid " + theme().bd + ";background:" + theme().btn + ";color:" + theme().fg + ";font-size:15px;line-height:1;cursor:pointer;border-radius:5px;padding:0;", parent); b.innerHTML = label; b.title = title; return b; }
	function buildToolbar() {
		clear(ui.toolbar);
		tbBtn(ui.toolbar, "&#8962;", "Tüm ağa sığdır").onclick = function () { engine.fitBounds(engine.allBounds()); };
		if (cfg.allowUpload) { tbBtn(ui.toolbar, "&#11014;", "Ağ dosyası yükle (GeoJSON/TopoJSON/KML/GPX/JSON)").onclick = function () { if (ui.fileInput) { ui.fileInput.click(); } }; }
		if (cfg.showSearch) { tbBtn(ui.toolbar, "&#128269;", "Ara").onclick = function () { ui.search.style.display = ui.search.style.display === "none" ? "" : "none"; if (ui.search.style.display === "") { buildSearch(); var inp = ui.search.firstChild; if (inp && inp.focus) { inp.focus(); } } }; }
		tbBtn(ui.toolbar, "&#9974;", "PNG indir").onclick = exportPng;
		tbBtn(ui.toolbar, "&#11036;", "Tam ekran").onclick = toggleFullscreen;
	}

	function buildSearch() {
		clear(ui.search);
		var inp = el("input", "border:1px solid " + theme().bd + ";border-radius:4px;padding:3px 6px;font-size:12px;width:160px;", ui.search);
		inp.type = "text"; inp.placeholder = "Hat kesimi ara…";
		inp.onkeydown = function (e) { if (e.keyCode === 13) { doSearch(inp.value); } };
		var go = el("button", "margin-left:4px;border:1px solid " + theme().bd + ";background:" + theme().btn + ";border-radius:4px;cursor:pointer;padding:3px 8px;color:" + theme().fg + ";", ui.search); txt(go, "Git");
		go.onclick = function () { doSearch(inp.value); };
	}
	function doSearch(q) {
		q = ("" + q).replace(/^\s+|\s+$/g, "").toLowerCase(); if (!q) { return; }
		for (var i = 0; i < baseFeatures.length; i++) {
			var f = baseFeatures[i], hay = ((f.name || "") + " " + (f.id || "")).toLowerCase();
			if (hay.indexOf(q) >= 0) { selectFeature(f, engine.layers[0]); engine.fitBounds(f.bbox, 60); return; }
		}
		status("Eşleşme yok: " + q); setTimeout(hideStatus, 1200);
	}

	function buildBasemapControl() {
		clear(ui.basemap);
		if (!cfg.showBasemapControl) { ui.basemap.style.display = "none"; return; }
		ui.basemap.style.display = "";
		txt(el("span", "margin-right:5px;color:" + theme().sub + ";", ui.basemap), "Altlık:");
		var sel = el("select", "border:1px solid " + theme().bd + ";border-radius:4px;background:" + theme().btn + ";color:" + theme().fg + ";font-size:11px;", ui.basemap);
		var names = ["osm", "carto-light", "carto-dark", "carto-voyager", "none"], cur = ("" + cfg.basemap).toLowerCase();
		if (cur === "custom") { var oc = el("option", null, sel); oc.value = "custom"; txt(oc, "Özel"); oc.selected = true; }
		for (var i = 0; i < names.length; i++) { var o = el("option", null, sel); o.value = names[i]; txt(o, R.BASEMAPS[names[i]].label); if (names[i] === cur) { o.selected = true; } }
		sel.onchange = function () { cfg.basemap = sel.value; applyBasemap(); };
	}

	// --- layer control (checkbox / radio / dropdown) ---------------------
	function buildLayerControl() {
		var c = ui.control; clear(c);
		var collapsed = cfg.layerControlCollapsed, t = theme();
		var head = el("div", "padding:6px 9px;font-weight:bold;border-bottom:1px solid " + t.hair + ";" + (collapsed ? "cursor:pointer;display:flex;align-items:center;justify-content:space-between;" : ""), c);
		txt(head, cfg.layerControlTitle || "Katmanlar");
		var body = el("div", "padding:5px 9px 7px;", c);
		if (collapsed) {
			var caret = el("span", "margin-left:8px;font-size:10px;", head); caret.innerHTML = "&#9662;";
			body.style.display = "none";
			head.onclick = function () { var open = body.style.display === "none"; body.style.display = open ? "" : "none"; caret.innerHTML = open ? "&#9652;" : "&#9662;"; };
		}
		var mode = ("" + cfg.layerControlMode).toLowerCase();
		if (mode === "dropdown") { buildDropdownControl(body); }
		else { for (var i = 0; i < engine.layers.length; i++) { body.appendChild(layerRow(engine.layers[i], mode === "radio")); } }
	}
	function buildDropdownControl(body) {
		var base = engine.getLayer("__base__");
		if (base) { body.appendChild(layerRow(base, false)); }
		var sel = el("select", "width:100%;margin-top:4px;border:1px solid " + theme().bd + ";border-radius:4px;background:" + theme().btn + ";color:" + theme().fg + ";font-size:12px;padding:2px;", body);
		var active = null;
		for (var i = 0; i < engine.layers.length; i++) {
			var L = engine.layers[i]; if (L.kind !== "measure") { continue; }
			var o = el("option", null, sel); o.value = L.id; txt(o, L.title); if (L.visible && !active) { o.selected = true; active = L.id; }
		}
		sel.onchange = function () { that.showOnlyLayer(sel.value); };
	}
	function layerRow(layer, radio) {
		var row = el("label", "display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;line-height:1.3;");
		var inp = el("input", "margin:0;", row); inp.type = radio && layer.kind === "measure" ? "radio" : "checkbox";
		if (inp.type === "radio") { inp.name = "tcddrm_measure"; }
		inp.checked = !!layer.visible;
		el("span", "display:inline-block;width:18px;height:6px;border-radius:2px;flex:none;background:" + swatch(layer) + ";", row);
		txt(el("span", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px;", row), layer.title || layer.id);
		inp.onchange = function () {
			if (inp.type === "radio") { that.showOnlyLayer(layer.id); }
			else { engine.setLayerVisible(layer.id, inp.checked); cfg.selectedLayer = layer.id; fireToggle(); buildLegend(); }
		};
		return row;
	}
	function swatch(layer) {
		if (layer.kind === "measure") {
			if (layer.symbology === "categorical" && layer.legend && layer.legend.items && layer.legend.items.length) { var c = []; for (var i = 0; i < Math.min(4, layer.legend.items.length); i++) { c.push(layer.legend.items[i].color); } return "linear-gradient(90deg," + c.join(",") + ")"; }
			return "linear-gradient(90deg," + R.rampStops(layer.ramp).join(",") + ")";
		}
		return layer.color || cfg.defaultColor;
	}

	// --- legend (symbology aware) ----------------------------------------
	function buildLegend() {
		var lg = ui.legend; clear(lg);
		var ml = null;
		for (var i = engine.layers.length - 1; i >= 0; i--) { if (engine.layers[i].visible && engine.layers[i].kind === "measure") { ml = engine.layers[i]; break; } }
		if (!ml || !cfg.showLegend) { lg.style.display = "none"; return; }
		lg.style.display = "";
		txt(el("div", "font-weight:bold;margin-bottom:4px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", lg), cfg.legendTitle || ml.title);
		var lt = ml.legend ? ml.legend.type : "ramp";
		if (lt === "category") { legendCategory(lg, ml); }
		else if (lt === "classes") { legendClasses(lg, ml); }
		else if (lt === "width") { legendWidth(lg, ml); }
		else { legendRamp(lg, ml); }
	}
	function legendRamp(lg, ml) {
		el("div", "width:170px;height:10px;border-radius:3px;border:1px solid #c7d0d8;background:linear-gradient(90deg," + R.rampStops(ml.ramp).join(",") + ");", lg);
		var row = el("div", "display:flex;justify-content:space-between;font-size:10px;color:" + theme().sub + ";margin-top:2px;width:170px;", lg);
		txt(el("span", null, row), fmt(ml.min)); txt(el("span", null, row), fmt(ml.max));
	}
	function legendClasses(lg, ml) {
		var e = ml.legend.edges, n = ml.legend.n;
		for (var i = 0; i < n; i++) {
			var r = el("div", "display:flex;align-items:center;gap:6px;margin:1px 0;", lg);
			el("span", "width:16px;height:10px;border-radius:2px;flex:none;background:" + R.rampColor(ml.ramp, n <= 1 ? 0.5 : i / (n - 1)) + ";", r);
			txt(el("span", "font-size:10px;color:" + theme().sub + ";", r), fmt(e[i]) + " – " + fmt(e[i + 1]));
		}
	}
	function legendCategory(lg, ml) {
		var its = ml.legend.items;
		for (var i = 0; i < Math.min(its.length, 12); i++) {
			var r = el("div", "display:flex;align-items:center;gap:6px;margin:1px 0;", lg);
			el("span", "width:16px;height:10px;border-radius:2px;flex:none;background:" + its[i].color + ";", r);
			txt(el("span", "font-size:10px;color:" + theme().sub + ";", r), fmt(its[i].value));
		}
		if (its.length > 12) { txt(el("div", "font-size:10px;color:" + theme().sub + ";", lg), "… +" + (its.length - 12)); }
	}
	function legendWidth(lg, ml) {
		var box = el("div", "display:flex;flex-direction:column;gap:3px;", lg);
		var r1 = el("div", "display:flex;align-items:center;gap:6px;", box);
		el("span", "width:24px;height:" + Math.max(2, ml.legend.wmin) + "px;background:" + R.rampColor(ml.ramp, 0) + ";flex:none;", r1); txt(el("span", "font-size:10px;color:" + theme().sub + ";", r1), fmt(ml.min));
		var r2 = el("div", "display:flex;align-items:center;gap:6px;", box);
		el("span", "width:24px;height:" + Math.max(2, ml.legend.wmax) + "px;background:" + R.rampColor(ml.ramp, 1) + ";flex:none;", r2); txt(el("span", "font-size:10px;color:" + theme().sub + ";", r2), fmt(ml.max));
	}

	// --- scale bar + coordinates -----------------------------------------
	function updateScale() {
		if (!cfg.showScaleBar || !engine.cssW) { return; }
		var mpp = engine.metersPerPixel(), maxM = mpp * 90, nice = niceRound(maxM), px = Math.round(nice / mpp);
		clear(ui.scale);
		var lbl = nice >= 1000 ? (nice / 1000) + " km" : nice + " m";
		txt(el("div", null, ui.scale), lbl);
		el("div", "height:5px;width:" + px + "px;border:1px solid " + theme().fg + ";border-top:none;", ui.scale);
	}
	function niceRound(x) { if (x <= 0) { return 1; } var p = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), f = x / p; var n = f >= 5 ? 5 : f >= 2 ? 2 : 1; return n * p; }
	function bindCoordReadout() {
		engine.canvas.addEventListener("mousemove", function (e) {
			if (!cfg.showCoordinates) { return; }
			var r = engine.canvas.getBoundingClientRect(), ll = engine.unproject(e.clientX - r.left, e.clientY - r.top);
			clear(ui.coords); txt(ui.coords, ll.lat.toFixed(4) + ", " + ll.lng.toFixed(4));
		});
	}

	function status(msg) { if (ui.status) { ui.status.style.display = ""; clear(ui.status); txt(ui.status, msg); } }
	function hideStatus() { if (ui.status) { ui.status.style.display = "none"; } }

	function buildZoomButtons() {
		clear(ui.zoom);
		var zin = el("button", zbtn() + "border-radius:5px 5px 0 0;", ui.zoom); zin.innerHTML = "+"; zin.title = "Yakınlaştır";
		var zout = el("button", zbtn() + "border-top:none;border-radius:0 0 5px 5px;", ui.zoom); zout.innerHTML = "&minus;"; zout.title = "Uzaklaştır";
		zin.onclick = function () { engine.zoomIn(); }; zout.onclick = function () { engine.zoomOut(); };
	}
	function zbtn() { return "width:30px;height:30px;border:1px solid " + theme().bd + ";background:" + theme().btn + ";color:" + theme().fg + ";font-size:18px;line-height:1;cursor:pointer;padding:0;"; }

	// ======================================================================
	//  6. interaction + events
	// ======================================================================
	function onClick(hit) { if (hit) { selectFeature(hit.feature, hit.layer); } }
	function selectFeature(f, layer) {
		cfg.selectedSegment = f.id != null ? f.id : "";
		cfg.selectedSegmentName = f.name != null ? f.name : (f.id != null ? f.id : "");
		cfg.selectedLayer = layer ? layer.id : "";
		engine.setSelected(layer ? layer.id : null, f.id);
		that.firePropertiesChangedAndEvent(["selectedSegment", "selectedSegmentName", "selectedLayer"], "onSelect");
	}
	function onDblClick(hit) { that.firePropertiesChangedAndEvent([], "onDoubleClick"); }
	function fireToggle() { that.firePropertiesChangedAndEvent(["selectedLayer"], "onLayerToggle"); }
	function onViewChange(v) {
		cfg.centerLat = v.lat; cfg.centerLng = v.lng; cfg.currentZoom = v.zoom;
		updateScale();
		if (vcTimer) { clearTimeout(vcTimer); }
		vcTimer = setTimeout(function () { that.firePropertiesChangedAndEvent(["centerLat", "centerLng", "currentZoom"], "onViewChange"); }, 300);
	}

	function onHover(hit) {
		if (!cfg.showTooltip || !hit) { if (ui.tip) { ui.tip.style.display = "none"; } return; }
		if (!hit.moveOnly) { fillTooltip(hit.feature); }
		ui.tip.style.display = "";
		var x = hit.x + 14, y = hit.y + 14;
		if (x + ui.tip.offsetWidth > engine.cssW) { x = hit.x - ui.tip.offsetWidth - 14; }
		if (y + ui.tip.offsetHeight > engine.cssH) { y = hit.y - ui.tip.offsetHeight - 14; }
		ui.tip.style.left = Math.max(2, x) + "px"; ui.tip.style.top = Math.max(2, y) + "px";
	}
	function fillTooltip(f) {
		var tip = ui.tip; clear(tip);
		txt(el("div", "font-weight:bold;margin-bottom:3px;", tip), f.name != null ? f.name : (f.id != null ? f.id : "Segment"));
		if (f.name != null && f.id != null && ("" + f.name) !== ("" + f.id)) { txt(el("div", "color:#aeb8c2;font-size:10px;margin-bottom:3px;", tip), "ID: " + f.id); }
		var rows = 0, i;
		if (cfg.tooltipShowMeasures) {
			for (i = 0; i < engine.layers.length; i++) { var L = engine.layers[i]; if (L.kind !== "measure") { continue; } var v = (f.id != null) ? L.values[f.id] : null; if (v == null) { continue; } tip.appendChild(tipRow(L.styleFn(f).color, L.title, fmt(v))); rows++; }
		}
		var props = csv(cfg.tooltipProperties);
		for (i = 0; i < props.length; i++) { if (f.props && f.props[props[i]] != null) { tip.appendChild(tipRow(null, props[i], "" + f.props[props[i]])); rows++; } }
		// no measures/explicit props matched -> show a few of the feature's own attributes
		if (!rows && f.props) {
			var shown = 0;
			for (var pk in f.props) {
				if (!f.props.hasOwnProperty(pk) || pk === cfg.segmentIdProperty || pk === cfg.segmentNameProperty || f.props[pk] == null) { continue; }
				tip.appendChild(tipRow(null, pk, "" + f.props[pk])); rows++; if (++shown >= 6) { break; }
			}
		}
		if (!rows) { txt(el("div", "color:#aeb8c2;font-size:10px;", tip), "Ek veri yok"); }
	}
	function tipRow(color, label, value) {
		var r = el("div", "display:flex;align-items:center;gap:6px;");
		el("span", "display:inline-block;width:9px;height:9px;border-radius:50%;flex:none;background:" + (color || "transparent") + ";", r);
		txt(el("span", "color:#c9d3dc;", r), label + ":");
		txt(el("span", "margin-left:auto;font-weight:bold;padding-left:8px;", r), value);
		return r;
	}

	function exportPng() {
		var data = engine.snapshot();
		if (!data) { status("PNG dışa aktarılamadı"); setTimeout(hideStatus, 1500); return data; }
		try { var a = document.createElement("a"); a.href = data; a.download = "demiryolu-haritasi.png"; document.body.appendChild(a); a.click(); document.body.removeChild(a); } catch (e) { }
		return data;
	}
	function toggleFullscreen() {
		var h = ui.host;
		try {
			var doc = document, fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
			if (!fsEl) { (h.requestFullscreen || h.webkitRequestFullscreen || function () { }).call(h); }
			else { (doc.exitFullscreen || doc.webkitExitFullscreen || function () { }).call(doc); }
			setTimeout(function () { engine.resize(); }, 250);
		} catch (e) { }
	}

	// ======================================================================
	//  BIAL scripting API
	// ======================================================================
	this.setLayerVisible = function (id, visible) { var l = resolveLayer(id); if (l) { engine.setLayerVisible(l.id, visible); buildSync(); } return this; };
	this.showLayer = function (id) { return this.setLayerVisible(id, true); };
	this.hideLayer = function (id) { return this.setLayerVisible(id, false); };
	this.toggleLayer = function (id) { var l = resolveLayer(id); if (l) { this.setLayerVisible(l.id, !l.visible); } return this; };
	this.showOnlyLayer = function (id) { var tgt = resolveLayer(id); for (var i = 0; i < engine.layers.length; i++) { var L = engine.layers[i]; if (L.kind === "base") { continue; } engine.setLayerVisible(L.id, tgt && L.id === tgt.id); } if (tgt) { cfg.selectedLayer = tgt.id; } buildSync(); fireToggle(); return this; };
	this.setActiveMeasure = function (name) { return this.showOnlyLayer(name); };
	this.getMeasures = function () { return measureOrder.join(","); };
	this.getLayerIds = function () { var o = []; for (var i = 0; i < engine.layers.length; i++) { o.push(engine.layers[i].id); } return o.join(","); };
	this.getVisibleLayers = function () { var o = []; for (var i = 0; i < engine.layers.length; i++) { if (engine.layers[i].visible) { o.push(engine.layers[i].title); } } return o.join(","); };
	this.setLayerOpacity = function (id, pct) { var l = resolveLayer(id); if (l) { l.opacity = Math.max(0, Math.min(1, pct / 100)); engine.scheduleRender(); } return this; };

	this.setSymbology = function (mode) { cfg.symbology = mode; rebuildLayers(); return this; };
	this.setClassification = function (method, count) { cfg.classMethod = method; if (count) { cfg.classCount = count | 0; } rebuildLayers(); return this; };
	this.setArrows = function (on) { cfg.showArrows = !!on; rebuildLayers(); return this; };
	this.setFlowAnimation = function (on) { cfg.flowAnimation = !!on; rebuildLayers(); return this; };
	this.setLabels = function (on) { cfg.showLabels = !!on; rebuildLayers(); return this; };
	this.setCasing = function (on) { cfg.lineCasing = !!on; rebuildLayers(); return this; };

	this.setLayerData = function (id, title, dataJson, ramp) {
		var values = {};
		try { var parsed = (typeof dataJson === "string") ? JSON.parse(dataJson) : dataJson; if (parsed instanceof Array) { for (var i = 0; i < parsed.length; i++) { var r = parsed[i]; if (r && r.segment != null) { values["" + r.segment] = parseFloat(r.value); } } } else if (parsed) { for (var k in parsed) { if (parsed.hasOwnProperty(k)) { values[k] = parseFloat(parsed[k]); } } } } catch (e) { return this; }
		scriptLayers[id] = { title: title || id, values: values, ramp: ramp || "", visible: true }; rebuildLayers(); return this;
	};
	this.removeLayer = function (id) { if (scriptLayers[id]) { delete scriptLayers[id]; rebuildLayers(); } return this; };

	// add a geometry layer from a raw string (any format) as its own toggleable layer
	this.addNetworkLayer = function (id, title, raw, format) {
		var feats; try { feats = parseToFeatures(raw, format || "auto"); } catch (e) { return this; }
		if (!feats.length) { return this; }
		removeUpload("up::" + id);
		_uploadSeq++;
		uploadedLayers.push({ id: "up::" + id, title: title || id, features: feats, color: UPCOLORS[(uploadedLayers.length) % UPCOLORS.length], weight: cfg.baseLineWeight + 1, visible: true });
		rebuildLayers(); if (cfg.fitNetworkOnLoad) { engine.fitBounds(engine.allBounds()); }
		return this;
	};
	this.removeNetworkLayer = function (id) { if (removeUpload(id)) { rebuildLayers(); } return this; };
	this.clearUploads = function () { uploadedLayers = []; rebuildLayers(); return this; };

	this.setBasemap = function (name) { cfg.basemap = name; applyBasemap(); buildBasemapControl(); return this; };
	this.selectSegment = function (id) { for (var i = 0; i < baseFeatures.length; i++) { if (baseFeatures[i].id === ("" + id)) { selectFeature(baseFeatures[i], engine.layers[0]); return this; } } return this; };
	this.clearSelection = function () { cfg.selectedSegment = ""; cfg.selectedSegmentName = ""; engine.setSelected(null, null); return this; };
	this.search = function (q) { doSearch(q); return cfg.selectedSegment; };
	this.exportPng = function () { return exportPng(); };

	this.zoomToSegment = function (segId) { for (var i = 0; i < baseFeatures.length; i++) { if (baseFeatures[i].id === ("" + segId)) { engine.fitBounds(baseFeatures[i].bbox, 60); return this; } } return this; };
	this.fitToNetwork = function () { engine.fitBounds(engine.allBounds()); return this; };
	this.setView = function (lat, lng, zoom) { engine.setView(lat, lng, zoom); return this; };
	this.getCenterLat = function () { return engine.getCenter().lat; };
	this.getCenterLng = function () { return engine.getCenter().lng; };
	this.getZoom = function () { return engine.getZoom(); };
	this.refresh = function () { loadedNetworkKey = null; ensureNetwork(); return this; };

	function resolveLayer(id) { var l = engine.getLayer(id); if (l) { return l; } l = engine.getLayer("m::" + id); if (l) { return l; } for (var i = 0; i < engine.layers.length; i++) { if (engine.layers[i].title === id) { return engine.layers[i]; } } return null; }
	function buildSync() { buildLayerControl(); buildLegend(); engine.scheduleRender(); }

	// ======================================================================
	//  property accessors
	// ======================================================================
	function accessor(name, after) { that[name] = function (value) { if (value === undefined) { return cfg[name]; } cfg[name] = value; if (after) { after(value); } return that; }; }
	function restyle() { needData = true; }
	function reload() { needNetwork = true; }

	var plain = ["baseLayerTitle", "layerControlTitle", "layerControlMode", "legendTitle", "selectedSegment", "selectedSegmentName", "selectedLayer",
		"initialLat", "initialLng", "initialZoom", "minZoom", "maxZoom", "tileOpacity", "tileUrl", "tileSubdomains", "basemap",
		"showLayerControl", "layerControlCollapsed", "showLegend", "showTooltip", "tooltipShowMeasures", "tooltipProperties",
		"showZoomControl", "showToolbar", "showSearch", "showScaleBar", "showCoordinates", "showBasemapControl", "allowUpload", "uploadMode",
		"fitNetworkOnLoad", "backgroundColor", "highlightColor", "uiTheme", "title", "subtitle", "valueUnit",
		"centerLat", "centerLng", "currentZoom"];
	for (var pi = 0; pi < plain.length; pi++) { accessor(plain[pi]); }

	var styled = ["segmentDimension", "aggregate", "layerColors", "visibleLayers", "baseLayerVisible",
		"defaultColor", "lineWeight", "baseLineWeight", "lineCasing", "layerOpacity", "pointRadius",
		"symbology", "classMethod", "classCount", "minWidth", "maxWidth", "layerConfig",
		"showArrows", "arrowSpacing", "flowAnimation", "showLabels", "labelMode", "labelMinZoom",
		"valueDecimals", "thousandSep"];
	for (var si = 0; si < styled.length; si++) { accessor(styled[si], restyle); }

	accessor("segmentIdProperty", reload); accessor("segmentNameProperty", reload);
	accessor("networkUrl", reload); accessor("networkGeoJson", reload); accessor("networkFormat", reload);

	this.metadata = function (value) { if (value === undefined) { return meta; } meta = value; needData = true; return this; };
	this.data = function (value) { if (value === undefined) { return ds; } ds = value; needData = true; return this; };
});
