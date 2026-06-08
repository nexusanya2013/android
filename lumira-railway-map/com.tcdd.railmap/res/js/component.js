// ============================================================================
//  TCDD Railway Map - SDK component glue
//  ---------------------------------------------------------------------------
//  Binds the dependency-free Canvas engine (railmap-core.js) to the Lumira
//  Designer SDK: property accessors, data-source parsing (metadata + tuples),
//  measure -> layer distribution over railway segments, layer control
//  (dropdown / checkboxes), legend, tooltip, selection events, and a rich
//  BIAL scripting API (see contribution.ztl).
// ============================================================================
sap.designstudio.sdk.Component.subclass("com.tcdd.railmap.RailwayMap", function () {

	var that = this;

	// ---- configuration state (defaults mirror contribution.xml) ----------
	var cfg = {
		segmentDimension: "", segmentIdProperty: "id", segmentNameProperty: "name",
		networkUrl: "", networkGeoJson: "",
		baseLayerTitle: "Demiryolu Ağı", baseLayerVisible: true,
		layerColors: "traffic,blue,rdylgn,heat,purple", visibleLayers: "",
		showLayerControl: true, layerControlCollapsed: true, layerControlTitle: "Katmanlar",
		initialLat: 39.2, initialLng: 35.2, initialZoom: 6, minZoom: 2, maxZoom: 18,
		fitNetworkOnLoad: true,
		tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", tileSubdomains: "a,b,c", tileOpacity: 100,
		backgroundColor: "#eef2f5", defaultColor: "#5a6b7b",
		lineWeight: 4, baseLineWeight: 2, highlightColor: "#ff7f0e",
		showLegend: true, legendTitle: "", showTooltip: true, showZoomControl: true,
		selectedSegment: "", selectedSegmentName: "", selectedLayer: ""
	};

	var meta = null;            // metadata {dimensions:[...]}
	var ds = null;              // data binding ResultCellList {tuples, data}
	var engine = null;
	var baseFeatures = [];      // normalised GeoJSON features (shared geometry)
	var measureOrder = [];      // measure titles, in source order
	var scriptLayers = {};      // id -> values map, for setLayerData()-driven layers
	var loadedNetworkKey = null;
	var needData = false, needNetwork = false;
	var ui = {};                // dom refs: control, legend, tip, zoom

	// ---- small dom helpers ----------------------------------------------
	function el(tag, css, parent) {
		var e = document.createElement(tag);
		if (css) { e.style.cssText = css; }
		if (parent) { parent.appendChild(e); }
		return e;
	}
	function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } }
	function fnum(v) {
		if (v == null || isNaN(v)) { return "-"; }
		var n = Number(v), a = Math.abs(n);
		if (a >= 1e9) { return (n / 1e9).toFixed(1) + " Mr"; }
		if (a >= 1e6) { return (n / 1e6).toFixed(1) + " M"; }
		if (a >= 1e3) { return (n / 1e3).toFixed(1) + " B"; }
		return (Math.round(n * 100) / 100) + "";
	}
	function ramps() {
		var a = ("" + cfg.layerColors).split(/[,;]/), o = [];
		for (var i = 0; i < a.length; i++) { var s = a[i].replace(/\s/g, ""); if (s) { o.push(s); } }
		return o.length ? o : ["blue"];
	}

	// ======================================================================
	//  lifecycle
	// ======================================================================
	this.init = function () {
		var host = this.$()[0];
		host.style.position = "relative";
		host.style.width = "100%";
		host.style.height = "100%";
		host.style.background = cfg.backgroundColor;
		host.style.font = "12px Arial,Helvetica,sans-serif";

		engine = new TCDDRailMap.MapEngine(host, {
			lat: cfg.initialLat, lng: cfg.initialLng, zoom: cfg.initialZoom,
			minZoom: cfg.minZoom, maxZoom: cfg.maxZoom, background: cfg.backgroundColor
		});
		applyTile();

		engine.on("click", onEngineClick);
		engine.on("hover", onEngineHover);
		engine.on("move", function () { /* keep legend/control fixed */ });

		buildOverlays(host);
		needNetwork = true;
	};

	this.afterUpdate = function () {
		if (!engine) { return; }
		// engine sizing follows the SDK-managed host div
		engine.minZoom = cfg.minZoom; engine.maxZoom = cfg.maxZoom;
		engine.setBackground(cfg.backgroundColor);
		engine.resize();
		applyTile();

		if (needNetwork) { needNetwork = false; ensureNetwork(); }
		else if (needData) { needData = false; rebuildLayers(); }

		syncOverlayVisibility();
	};

	function applyTile() {
		var subs = ("" + cfg.tileSubdomains).split(/[,;]/);
		engine.setTile(cfg.tileUrl, subs, Math.max(0, Math.min(1, (cfg.tileOpacity == null ? 100 : cfg.tileOpacity) / 100)));
	}

	// ======================================================================
	//  network loading
	// ======================================================================
	function ensureNetwork() {
		var key = cfg.networkGeoJson ? ("inline:" + cfg.networkGeoJson.length) : ("url:" + cfg.networkUrl);
		if (key === loadedNetworkKey && baseFeatures.length) { rebuildLayers(); return; }
		loadedNetworkKey = key;

		if (cfg.networkGeoJson && ("" + cfg.networkGeoJson).replace(/\s/g, "").length) {
			try { setNetworkGeoJson(JSON.parse(cfg.networkGeoJson)); } catch (e) { showStatus("Geçersiz inline GeoJSON"); }
			return;
		}
		if (!cfg.networkUrl) { showStatus("Ağ GeoJSON kaynağı tanımlı değil"); return; }
		showStatus("Demiryolu ağı yükleniyor…");
		try {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", cfg.networkUrl, true);
			xhr.onreadystatechange = function () {
				if (xhr.readyState !== 4) { return; }
				if (xhr.status >= 200 && xhr.status < 300) {
					try { setNetworkGeoJson(JSON.parse(xhr.responseText)); }
					catch (e) { showStatus("GeoJSON ayrıştırılamadı"); }
				} else { showStatus("Ağ yüklenemedi (HTTP " + xhr.status + ")"); }
			};
			xhr.send();
		} catch (e) { showStatus("Ağ isteği başarısız"); }
	}

	function setNetworkGeoJson(gj) {
		baseFeatures = TCDDRailMap.normalizeGeoJson(gj, cfg.segmentIdProperty, cfg.segmentNameProperty);
		hideStatus();
		rebuildLayers();
		if (cfg.fitNetworkOnLoad) { engine.fitBounds(engine.allBounds()); }
	}

	// ======================================================================
	//  data-source parsing  (metadata + tuples + data)
	//  -> measureMaps: { measureTitle: { segKey|segText : value } } in order
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

		for (i = 0; i < ds.tuples.length; i++) {
			var t = ds.tuples[i];
			var segMember = dims[segDim] && dims[segDim].members[t[segDim]];
			if (!segMember) { continue; }
			var mTitle = "Değer";
			if (measureDim >= 0) { var mm = dims[measureDim].members[t[measureDim]]; mTitle = (mm && (mm.text != null ? mm.text : mm.key)) || "Değer"; }
			var v = parseFloat(ds.data[i]);
			if (isNaN(v)) { continue; }
			if (!maps[mTitle]) { maps[mTitle] = {}; measureOrder.push(mTitle); }
			if (segMember.key != null) { maps[mTitle]["" + segMember.key] = v; }
			if (segMember.text != null) { maps[mTitle]["" + segMember.text] = v; }
		}
		return maps;
	}

	// ======================================================================
	//  layer (re)build
	// ======================================================================
	function rebuildLayers() {
		if (!engine) { return; }
		engine.clearLayers();
		if (!baseFeatures.length) { syncOverlayVisibility(); return; }

		// 1) base network layer (bottom)
		engine.addLayer({
			id: "__base__", title: cfg.baseLayerTitle, kind: "base",
			features: baseFeatures, visible: cfg.baseLayerVisible,
			color: cfg.defaultColor, weight: cfg.baseLineWeight, highlightColor: cfg.highlightColor,
			styleFn: function (f) { return { color: cfg.defaultColor, weight: cfg.baseLineWeight }; }
		});

		// 2) measure layers from the bound data source
		var maps = buildMeasureMaps();
		var rs = ramps(), visList = parseVisibleList();
		for (var k = 0; k < measureOrder.length; k++) {
			addMeasureLayer(measureOrder[k], maps[measureOrder[k]], rs[k % rs.length], decideVisible(measureOrder[k], k, visList));
		}

		// 3) script-driven layers (setLayerData)
		var si = measureOrder.length;
		for (var id in scriptLayers) {
			if (scriptLayers.hasOwnProperty(id)) {
				var sl = scriptLayers[id];
				addMeasureLayer(sl.title || id, sl.values, sl.ramp || rs[si % rs.length], sl.visible !== false, id);
				si++;
			}
		}

		buildLayerControl();
		buildLegend();
		engine.scheduleRender();
		syncOverlayVisibility();
	}

	function addMeasureLayer(title, values, ramp, visible, forceId) {
		var min = Infinity, max = -Infinity, key;
		for (key in values) { if (values.hasOwnProperty(key)) { var v = values[key]; if (v < min) { min = v; } if (v > max) { max = v; } } }
		if (!isFinite(min)) { min = 0; max = 1; }
		var layer = {
			id: forceId || ("m::" + title), title: title, kind: "measure",
			features: baseFeatures, visible: visible, ramp: ramp, min: min, max: max, values: values,
			weight: cfg.lineWeight, color: TCDDRailMap.rampColor(ramp, 1), highlightColor: cfg.highlightColor
		};
		layer.styleFn = function (f) {
			var val = values[f.id];
			if (f.id == null || val == null) { return { color: "#dfe3e6", weight: cfg.baseLineWeight, opacity: 0.4 }; }
			var t = (max > min) ? (val - min) / (max - min) : 0.5;
			return { color: TCDDRailMap.rampColor(ramp, t), weight: cfg.lineWeight };
		};
		engine.addLayer(layer);
		return layer;
	}

	function parseVisibleList() {
		var a = ("" + cfg.visibleLayers).split(/[,;]/), o = {};
		for (var i = 0; i < a.length; i++) { var s = a[i].replace(/^\s+|\s+$/g, ""); if (s) { o[s] = true; } }
		return o;
	}
	function decideVisible(title, idx, visList) {
		var hasList = false, k; for (k in visList) { if (visList.hasOwnProperty(k)) { hasList = true; break; } }
		if (hasList) { return !!(visList[title] || visList["m::" + title]); }
		return idx === 0;   // default: show the first measure layer only
	}

	// ======================================================================
	//  overlays: layer control, legend, tooltip, zoom buttons
	// ======================================================================
	function buildOverlays(host) {
		ui.control = el("div", "position:absolute;top:8px;right:8px;z-index:5;background:rgba(255,255,255,.94);" +
			"border:1px solid #cfd8e0;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.18);font-size:12px;color:#2a3540;max-width:240px;", host);
		ui.legend = el("div", "position:absolute;left:8px;bottom:8px;z-index:5;background:rgba(255,255,255,.94);" +
			"border:1px solid #cfd8e0;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.18);padding:6px 8px;color:#2a3540;", host);
		ui.tip = el("div", "position:absolute;z-index:7;pointer-events:none;display:none;background:rgba(20,28,36,.92);" +
			"color:#fff;padding:4px 7px;border-radius:4px;font-size:11px;white-space:nowrap;max-width:260px;", host);
		ui.zoom = el("div", "position:absolute;right:8px;bottom:8px;z-index:5;display:flex;flex-direction:column;", host);
		var zin = el("button", zbtn(), ui.zoom); zin.innerHTML = "+";
		var zout = el("button", zbtn() + "border-top:none;border-radius:0 0 5px 5px;", ui.zoom); zout.innerHTML = "&minus;";
		zin.style.borderRadius = "5px 5px 0 0";
		zin.onclick = function () { engine.zoomIn(); }; zout.onclick = function () { engine.zoomOut(); };
		ui.status = el("div", "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;background:rgba(255,255,255,.9);" +
			"border:1px solid #cfd8e0;border-radius:6px;padding:8px 14px;color:#48586a;display:none;", host);
	}
	function zbtn() { return "width:30px;height:30px;border:1px solid #cfd8e0;background:#fff;color:#2a3540;font-size:18px;line-height:1;cursor:pointer;padding:0;"; }

	function syncOverlayVisibility() {
		if (!ui.control) { return; }
		ui.control.style.display = (cfg.showLayerControl && engine.layers.length) ? "" : "none";
		ui.legend.style.display = cfg.showLegend ? "" : "none";
		ui.zoom.style.display = cfg.showZoomControl ? "" : "none";
	}

	function buildLayerControl() {
		var c = ui.control; clear(c);
		var collapsed = cfg.layerControlCollapsed;
		var head = el("div", "padding:6px 9px;font-weight:bold;border-bottom:1px solid #e3e9ee;" +
			(collapsed ? "cursor:pointer;display:flex;align-items:center;justify-content:space-between;" : ""), c);
		head.appendChild(document.createTextNode(cfg.layerControlTitle || "Katmanlar"));
		var body = el("div", "padding:5px 9px 7px;", c);

		if (collapsed) {
			var caret = el("span", "margin-left:8px;font-size:10px;", head); caret.innerHTML = "&#9662;";
			body.style.display = "none";
			head.onclick = function () {
				var open = body.style.display === "none";
				body.style.display = open ? "" : "none";
				caret.innerHTML = open ? "&#9652;" : "&#9662;";
			};
		}
		for (var i = 0; i < engine.layers.length; i++) { body.appendChild(layerRow(engine.layers[i])); }
	}
	function layerRow(layer) {
		var row = el("label", "display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;line-height:1.3;");
		var cb = el("input", "margin:0;", row); cb.type = "checkbox"; cb.checked = !!layer.visible;
		var sw = el("span", "display:inline-block;width:18px;height:6px;border-radius:2px;flex:none;" +
			"background:" + swatch(layer) + ";", row);
		var lab = el("span", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;", row);
		lab.appendChild(document.createTextNode(layer.title || layer.id));
		cb.onchange = function () {
			engine.setLayerVisible(layer.id, cb.checked);
			cfg.selectedLayer = layer.id;
			that.firePropertiesChangedAndEvent(["selectedLayer"], "onLayerToggle");
			buildLegend();
		};
		return row;
	}
	function swatch(layer) {
		if (layer.kind === "measure") {
			var s = TCDDRailMap.rampStops(layer.ramp);
			return "linear-gradient(90deg," + s.join(",") + ")";
		}
		return layer.color || cfg.defaultColor;
	}

	function buildLegend() {
		var lg = ui.legend; clear(lg);
		// pick topmost visible measure layer
		var ml = null;
		for (var i = engine.layers.length - 1; i >= 0; i--) { if (engine.layers[i].visible && engine.layers[i].kind === "measure") { ml = engine.layers[i]; break; } }
		if (!ml) { lg.style.display = "none"; return; }
		lg.style.display = cfg.showLegend ? "" : "none";
		var title = cfg.legendTitle || ml.title;
		var t = el("div", "font-weight:bold;margin-bottom:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", lg);
		t.appendChild(document.createTextNode(title));
		var stops = TCDDRailMap.rampStops(ml.ramp);
		el("div", "width:160px;height:10px;border-radius:3px;border:1px solid #c7d0d8;background:linear-gradient(90deg," + stops.join(",") + ");", lg);
		var row = el("div", "display:flex;justify-content:space-between;font-size:10px;color:#5a6b7b;margin-top:2px;width:160px;", lg);
		var lo = el("span", null, row); lo.appendChild(document.createTextNode(fnum(ml.min)));
		var hi = el("span", null, row); hi.appendChild(document.createTextNode(fnum(ml.max)));
	}

	function showStatus(msg) { if (ui.status) { ui.status.style.display = ""; clear(ui.status); ui.status.appendChild(document.createTextNode(msg)); } }
	function hideStatus() { if (ui.status) { ui.status.style.display = "none"; } }

	// ======================================================================
	//  interaction
	// ======================================================================
	function onEngineClick(hit) {
		if (!hit) { return; }
		var f = hit.feature;
		cfg.selectedSegment = f.id != null ? f.id : "";
		cfg.selectedSegmentName = f.name != null ? f.name : (f.id != null ? f.id : "");
		cfg.selectedLayer = hit.layer.id;
		engine.setSelected(hit.layer.id, f.id);
		that.firePropertiesChangedAndEvent(["selectedSegment", "selectedSegmentName", "selectedLayer"], "onSelect");
	}
	function onEngineHover(hit) {
		if (!cfg.showTooltip || !hit) { if (ui.tip) { ui.tip.style.display = "none"; } return; }
		var f = hit.feature, txt = f.name != null ? f.name : (f.id != null ? f.id : "Segment");
		if (hit.layer.kind === "measure" && f.id != null && hit.layer.values[f.id] != null) {
			txt += " — " + hit.layer.title + ": " + fnum(hit.layer.values[f.id]);
		}
		clear(ui.tip); ui.tip.appendChild(document.createTextNode(txt));
		ui.tip.style.display = "";
		var x = hit.x + 12, y = hit.y + 12;
		if (x + ui.tip.offsetWidth > engine.cssW) { x = hit.x - ui.tip.offsetWidth - 12; }
		if (y + ui.tip.offsetHeight > engine.cssH) { y = hit.y - ui.tip.offsetHeight - 12; }
		ui.tip.style.left = x + "px"; ui.tip.style.top = y + "px";
	}

	// ======================================================================
	//  BIAL scripting API  (declared in contribution.ztl)
	// ======================================================================
	this.setLayerVisible = function (id, visible) {
		var l = resolveLayer(id); if (l) { engine.setLayerVisible(l.id, visible); buildSync(); }
		return this;
	};
	this.showLayer = function (id) { return this.setLayerVisible(id, true); };
	this.hideLayer = function (id) { return this.setLayerVisible(id, false); };
	this.toggleLayer = function (id) { var l = resolveLayer(id); if (l) { this.setLayerVisible(l.id, !l.visible); } return this; };
	// show exactly one measure layer (the "switch active measure at runtime" use-case)
	this.showOnlyLayer = function (id) {
		var target = resolveLayer(id);
		for (var i = 0; i < engine.layers.length; i++) {
			var L = engine.layers[i];
			if (L.kind === "base") { continue; }
			engine.setLayerVisible(L.id, target && L.id === target.id);
		}
		if (target) { cfg.selectedLayer = target.id; }
		buildSync();
		return this;
	};
	this.setActiveMeasure = function (name) { return this.showOnlyLayer(name); };
	this.getMeasures = function () { return measureOrder.join(","); };
	this.getLayerIds = function () { var o = []; for (var i = 0; i < engine.layers.length; i++) { o.push(engine.layers[i].id); } return o.join(","); };
	this.getVisibleLayers = function () { var o = []; for (var i = 0; i < engine.layers.length; i++) { if (engine.layers[i].visible) { o.push(engine.layers[i].title); } } return o.join(","); };

	// feed an arbitrary layer from script: data = JSON string, either
	// {"segId":value,...} or [{"segment":"x","value":1},...]
	this.setLayerData = function (id, title, dataJson, ramp) {
		var values = {};
		try {
			var parsed = (typeof dataJson === "string") ? JSON.parse(dataJson) : dataJson;
			if (parsed instanceof Array) { for (var i = 0; i < parsed.length; i++) { var r = parsed[i]; if (r && r.segment != null) { values["" + r.segment] = parseFloat(r.value); } } }
			else if (parsed) { for (var k in parsed) { if (parsed.hasOwnProperty(k)) { values[k] = parseFloat(parsed[k]); } } }
		} catch (e) { return this; }
		scriptLayers[id] = { title: title || id, values: values, ramp: ramp || "", visible: true };
		rebuildLayers();
		return this;
	};
	this.removeLayer = function (id) {
		if (scriptLayers[id]) { delete scriptLayers[id]; rebuildLayers(); }
		return this;
	};

	this.zoomToSegment = function (segId) {
		for (var i = 0; i < baseFeatures.length; i++) { if (baseFeatures[i].id === ("" + segId)) { engine.fitBounds(baseFeatures[i].bbox, 60); return this; } }
		return this;
	};
	this.fitToNetwork = function () { engine.fitBounds(engine.allBounds()); return this; };
	this.setView = function (lat, lng, zoom) { engine.setView(lat, lng, zoom); return this; };
	this.refresh = function () { ensureNetwork(); return this; };

	function resolveLayer(id) {
		var l = engine.getLayer(id); if (l) { return l; }
		l = engine.getLayer("m::" + id); if (l) { return l; }
		for (var i = 0; i < engine.layers.length; i++) { if (engine.layers[i].title === id) { return engine.layers[i]; } }
		return null;
	}
	function buildSync() { buildLayerControl(); buildLegend(); engine.scheduleRender(); }

	// ======================================================================
	//  property accessors  (Lumira calls this.<prop>(value) to set/get)
	// ======================================================================
	function accessor(name, after) {
		that[name] = function (value) {
			if (value === undefined) { return cfg[name]; }
			cfg[name] = value;
			if (after) { after(value); }
			return that;
		};
	}
	// plain config properties (re-styled on next afterUpdate)
	var plain = ["segmentDimension", "segmentIdProperty", "segmentNameProperty",
		"baseLayerTitle", "layerColors", "visibleLayers", "layerControlTitle",
		"legendTitle", "selectedSegment", "selectedSegmentName", "selectedLayer",
		"initialLat", "initialLng", "initialZoom", "minZoom", "maxZoom",
		"lineWeight", "baseLineWeight", "tileOpacity",
		"baseLayerVisible", "showLayerControl", "layerControlCollapsed",
		"showLegend", "showTooltip", "showZoomControl", "fitNetworkOnLoad",
		"backgroundColor", "defaultColor", "highlightColor", "tileUrl", "tileSubdomains"];
	for (var pi = 0; pi < plain.length; pi++) { accessor(plain[pi]); }

	// properties that require a rebuild / reload
	accessor("networkUrl", function () { needNetwork = true; });
	accessor("networkGeoJson", function () { needNetwork = true; });

	this.metadata = function (value) { if (value === undefined) { return meta; } meta = value; needData = true; return this; };
	this.data = function (value) { if (value === undefined) { return ds; } ds = value; needData = true; return this; };
});
