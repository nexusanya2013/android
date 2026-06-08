// ============================================================================
//  TCDD Railway Map - SDK component glue
//  ===========================================================================
//  Connects the dependency-free Canvas engine (railmap-core.js) to the Lumira
//  Designer SDK. Responsibilities, in order of the data flow:
//
//    1. PROPERTIES   Lumira sets each property by calling this.<id>(value).
//                    All values are kept in `cfg`; some flag a reload/rebuild.
//    2. NETWORK      The base railway network is loaded from a URL or inline
//                    text, in any supported format (GeoJSON / TopoJSON / KML /
//                    GPX / plain JSON) and normalised to internal features.
//    3. DATA         The bound data source (metadata + tuples + data) is parsed
//                    into per-measure value maps keyed by segment.
//    4. LAYERS       The base network becomes the bottom layer; every measure
//                    becomes its own colour-ramped, toggleable layer on top.
//    5. UI           Layer control (dropdown/checkboxes), legend, hover tooltip
//                    (lists every measure value for the segment), zoom buttons.
//    6. EVENTS/API   Click selection fires onSelect; the layer control fires
//                    onLayerToggle; a BIAL API (contribution.ztl) drives the
//                    map at runtime (e.g. setActiveMeasure).
// ============================================================================
sap.designstudio.sdk.Component.subclass("com.tcdd.railmap.RailwayMap", function () {

	var that = this;

	// ---- 1. configuration state (defaults mirror contribution.xml) -------
	var cfg = {
		// data
		segmentDimension: "", segmentIdProperty: "id", segmentNameProperty: "name",
		// network
		networkUrl: "", networkGeoJson: "", networkFormat: "auto",
		// layers
		baseLayerTitle: "Demiryolu Ağı", baseLayerVisible: true,
		layerColors: "traffic,blue,rdylgn,heat,purple,green", visibleLayers: "",
		showLayerControl: true, layerControlCollapsed: true, layerControlTitle: "Katmanlar",
		// map view
		initialLat: 39.2, initialLng: 35.2, initialZoom: 6, minZoom: 2, maxZoom: 18,
		fitNetworkOnLoad: true,
		// base tiles
		tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", tileSubdomains: "a,b,c", tileOpacity: 100,
		backgroundColor: "#eef2f5",
		// styling
		defaultColor: "#5a6b7b", lineWeight: 4, baseLineWeight: 2, highlightColor: "#ff7f0e",
		showLegend: true, legendTitle: "",
		// tooltip
		showTooltip: true, tooltipShowMeasures: true, tooltipProperties: "",
		// misc
		showZoomControl: true,
		// selection (outputs)
		selectedSegment: "", selectedSegmentName: "", selectedLayer: ""
	};

	var meta = null;            // metadata {dimensions:[...]}
	var ds = null;              // data binding ResultCellList {tuples, data}
	var engine = null;
	var baseFeatures = [];      // normalised GeoJSON features (shared geometry)
	var measureOrder = [];      // measure titles, in source order
	var scriptLayers = {};      // id -> {title,values,ramp,visible} for setLayerData()
	var loadedNetworkKey = null;
	var needData = false, needNetwork = false;
	var ui = {};                // dom refs: control, legend, tip, zoom, status
	var resizeObs = null;

	// ---- small helpers ---------------------------------------------------
	function el(tag, css, parent) { var e = document.createElement(tag); if (css) { e.style.cssText = css; } if (parent) { parent.appendChild(e); } return e; }
	function txt(node, s) { node.appendChild(document.createTextNode(s == null ? "" : "" + s)); return node; }
	function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } }
	function fnum(v) {
		if (v == null || isNaN(v)) { return "-"; }
		var n = Number(v), a = Math.abs(n);
		if (a >= 1e9) { return (n / 1e9).toFixed(1) + " Mr"; }
		if (a >= 1e6) { return (n / 1e6).toFixed(1) + " M"; }
		if (a >= 1e3) { return (n / 1e3).toFixed(1) + " B"; }
		return "" + (Math.round(n * 100) / 100);
	}
	function csv(s) { var a = ("" + (s || "")).split(/[,;]/), o = []; for (var i = 0; i < a.length; i++) { var v = a[i].replace(/^\s+|\s+$/g, ""); if (v) { o.push(v); } } return o; }
	function ramps() { var o = csv(cfg.layerColors); return o.length ? o : ["blue"]; }

	// ======================================================================
	//  lifecycle
	// ======================================================================
	this.init = function () {
		var host = this.$()[0];
		host.style.position = "relative";
		host.style.width = "100%"; host.style.height = "100%";
		host.style.background = cfg.backgroundColor;
		host.style.font = "12px Arial,Helvetica,sans-serif";

		engine = new TCDDRailMap.MapEngine(host, {
			lat: cfg.initialLat, lng: cfg.initialLng, zoom: cfg.initialZoom,
			minZoom: cfg.minZoom, maxZoom: cfg.maxZoom, background: cfg.backgroundColor
		});
		applyTile();
		engine.on("click", onEngineClick);
		engine.on("hover", onEngineHover);

		buildOverlays(host);

		// keep the canvas in sync with container resizes (dashboard layout / window)
		if (window.ResizeObserver) { resizeObs = new ResizeObserver(function () { if (engine) { engine.resize(); } }); resizeObs.observe(host); }
		else if (window.addEventListener) { window.addEventListener("resize", function () { if (engine) { engine.resize(); } }); }

		needNetwork = true;
	};

	this.afterUpdate = function () {
		if (!engine) { return; }
		engine.minZoom = cfg.minZoom; engine.maxZoom = cfg.maxZoom;
		engine.setBackground(cfg.backgroundColor);
		engine.resize();
		applyTile();

		if (needNetwork) { needNetwork = false; ensureNetwork(); }
		else if (needData) { needData = false; rebuildLayers(); }

		syncOverlayVisibility();
	};

	function applyTile() {
		engine.setTile(cfg.tileUrl, csv(cfg.tileSubdomains), Math.max(0, Math.min(1, (cfg.tileOpacity == null ? 100 : cfg.tileOpacity) / 100)));
	}

	// ======================================================================
	//  2. network loading (multi-format)
	// ======================================================================
	function ensureNetwork() {
		var key = (cfg.networkGeoJson ? ("inline:" + cfg.networkGeoJson.length) : ("url:" + cfg.networkUrl)) + "|" + cfg.networkFormat +
			"|" + cfg.segmentIdProperty + "|" + cfg.segmentNameProperty;
		if (key === loadedNetworkKey && baseFeatures.length) { rebuildLayers(); return; }
		loadedNetworkKey = key;

		var inline = ("" + (cfg.networkGeoJson || "")).replace(/^\s+|\s+$/g, "");
		if (inline.length) { parseAndSet(inline); return; }
		if (!cfg.networkUrl) { showStatus("Ağ kaynağı tanımlı değil (URL veya inline)"); return; }

		showStatus("Demiryolu ağı yükleniyor…");
		try {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", cfg.networkUrl, true);
			xhr.onreadystatechange = function () {
				if (xhr.readyState !== 4) { return; }
				if (xhr.status >= 200 && xhr.status < 300) { parseAndSet(xhr.responseText); }
				else { showStatus("Ağ yüklenemedi (HTTP " + xhr.status + ")"); }
			};
			xhr.send();
		} catch (e) { showStatus("Ağ isteği başarısız: " + e.message); }
	}

	function parseAndSet(raw) {
		var gj;
		try { gj = TCDDRailMap.parseNetwork(raw, cfg.networkFormat); }
		catch (e) { showStatus("Ağ ayrıştırılamadı (" + cfg.networkFormat + "): " + e.message); return; }
		baseFeatures = TCDDRailMap.normalizeGeoJson(gj, cfg.segmentIdProperty, cfg.segmentNameProperty);
		if (!baseFeatures.length) { showStatus("Ağ boş ya da çizgi/nokta içermiyor"); return; }
		hideStatus();
		rebuildLayers();
		if (cfg.fitNetworkOnLoad) { engine.fitBounds(engine.allBounds()); }
	}

	// ======================================================================
	//  3. data-source parsing  (metadata + tuples + data)
	//  -> { measureTitle : { segKey|segText : value } } in source order
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
			if (segMember.key != null) { maps[mTitle]["" + segMember.key] = v; }       // join by member key …
			if (segMember.text != null) { maps[mTitle]["" + segMember.text] = v; }      // … or by member text
		}
		return maps;
	}

	// ======================================================================
	//  4. layer (re)build
	// ======================================================================
	function rebuildLayers() {
		if (!engine) { return; }
		engine.clearLayers();
		if (!baseFeatures.length) { syncOverlayVisibility(); return; }

		// (a) base network layer (bottom)
		engine.addLayer({
			id: "__base__", title: cfg.baseLayerTitle, kind: "base",
			features: baseFeatures, visible: cfg.baseLayerVisible,
			color: cfg.defaultColor, weight: cfg.baseLineWeight, highlightColor: cfg.highlightColor,
			styleFn: function () { return { color: cfg.defaultColor, weight: cfg.baseLineWeight }; }
		});

		// (b) one layer per bound measure
		var maps = buildMeasureMaps(), rs = ramps(), visList = parseVisibleList();
		for (var k = 0; k < measureOrder.length; k++) {
			addMeasureLayer(measureOrder[k], maps[measureOrder[k]], rs[k % rs.length], decideVisible(measureOrder[k], k, visList));
		}

		// (c) script-driven layers (setLayerData)
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

	function parseVisibleList() { var a = csv(cfg.visibleLayers), o = {}; for (var i = 0; i < a.length; i++) { o[a[i]] = true; } return o; }
	function decideVisible(title, idx, visList) {
		var has = false, k; for (k in visList) { if (visList.hasOwnProperty(k)) { has = true; break; } }
		if (has) { return !!(visList[title] || visList["m::" + title]); }
		return idx === 0;                                         // default: show first measure only
	}

	// ======================================================================
	//  5. overlays: layer control, legend, tooltip, zoom, status
	// ======================================================================
	function buildOverlays(host) {
		ui.control = el("div", panelCss() + "top:8px;right:8px;max-width:240px;", host);
		ui.legend = el("div", panelCss() + "left:8px;bottom:8px;padding:6px 8px;", host);
		ui.tip = el("div", "position:absolute;z-index:8;pointer-events:none;display:none;background:rgba(20,28,36,.94);" +
			"color:#fff;padding:6px 8px;border-radius:5px;font-size:11px;line-height:1.5;max-width:280px;box-shadow:0 2px 8px rgba(0,0,0,.3);", host);
		ui.zoom = el("div", "position:absolute;right:8px;bottom:8px;z-index:5;display:flex;flex-direction:column;", host);
		var zin = el("button", zbtn() + "border-radius:5px 5px 0 0;", ui.zoom); zin.innerHTML = "+"; zin.title = "Yakınlaştır";
		var zout = el("button", zbtn() + "border-top:none;border-radius:0 0 5px 5px;", ui.zoom); zout.innerHTML = "&minus;"; zout.title = "Uzaklaştır";
		zin.onclick = function () { engine.zoomIn(); }; zout.onclick = function () { engine.zoomOut(); };
		ui.status = el("div", panelCss(true) + "left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 14px;color:#48586a;display:none;", host);
	}
	function panelCss(center) { return "position:absolute;z-index:" + (center ? 6 : 5) + ";background:rgba(255,255,255,.95);border:1px solid #cfd8e0;" +
		"border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.18);font-size:12px;color:#2a3540;"; }
	function zbtn() { return "width:30px;height:30px;border:1px solid #cfd8e0;background:#fff;color:#2a3540;font-size:18px;line-height:1;cursor:pointer;padding:0;"; }

	function syncOverlayVisibility() {
		if (!ui.control) { return; }
		ui.control.style.display = (cfg.showLayerControl && engine.layers.length) ? "" : "none";
		ui.legend.style.display = cfg.showLegend ? "" : "none";
		ui.zoom.style.display = cfg.showZoomControl ? "" : "none";
	}

	// --- layer control ---------------------------------------------------
	function buildLayerControl() {
		var c = ui.control; clear(c);
		var collapsed = cfg.layerControlCollapsed;
		var head = el("div", "padding:6px 9px;font-weight:bold;border-bottom:1px solid #e3e9ee;" +
			(collapsed ? "cursor:pointer;display:flex;align-items:center;justify-content:space-between;" : ""), c);
		txt(head, cfg.layerControlTitle || "Katmanlar");
		var body = el("div", "padding:5px 9px 7px;", c);
		if (collapsed) {
			var caret = el("span", "margin-left:8px;font-size:10px;", head); caret.innerHTML = "&#9662;";
			body.style.display = "none";
			head.onclick = function () { var open = body.style.display === "none"; body.style.display = open ? "" : "none"; caret.innerHTML = open ? "&#9652;" : "&#9662;"; };
		}
		for (var i = 0; i < engine.layers.length; i++) { body.appendChild(layerRow(engine.layers[i])); }
	}
	function layerRow(layer) {
		var row = el("label", "display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;line-height:1.3;");
		var cb = el("input", "margin:0;", row); cb.type = "checkbox"; cb.checked = !!layer.visible;
		el("span", "display:inline-block;width:18px;height:6px;border-radius:2px;flex:none;background:" + swatch(layer) + ";", row);
		txt(el("span", "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;", row), layer.title || layer.id);
		cb.onchange = function () {
			engine.setLayerVisible(layer.id, cb.checked);
			cfg.selectedLayer = layer.id;
			that.firePropertiesChangedAndEvent(["selectedLayer"], "onLayerToggle");
			buildLegend();
		};
		return row;
	}
	function swatch(layer) {
		if (layer.kind === "measure") { return "linear-gradient(90deg," + TCDDRailMap.rampStops(layer.ramp).join(",") + ")"; }
		return layer.color || cfg.defaultColor;
	}

	// --- legend (topmost visible measure layer) --------------------------
	function buildLegend() {
		var lg = ui.legend; clear(lg);
		var ml = null;
		for (var i = engine.layers.length - 1; i >= 0; i--) { if (engine.layers[i].visible && engine.layers[i].kind === "measure") { ml = engine.layers[i]; break; } }
		if (!ml) { lg.style.display = "none"; return; }
		lg.style.display = cfg.showLegend ? "" : "none";
		txt(el("div", "font-weight:bold;margin-bottom:4px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;", lg), cfg.legendTitle || ml.title);
		el("div", "width:160px;height:10px;border-radius:3px;border:1px solid #c7d0d8;background:linear-gradient(90deg," + TCDDRailMap.rampStops(ml.ramp).join(",") + ");", lg);
		var row = el("div", "display:flex;justify-content:space-between;font-size:10px;color:#5a6b7b;margin-top:2px;width:160px;", lg);
		txt(el("span", null, row), fnum(ml.min));
		txt(el("span", null, row), fnum(ml.max));
	}

	function showStatus(msg) { if (ui.status) { ui.status.style.display = ""; clear(ui.status); txt(ui.status, msg); } }
	function hideStatus() { if (ui.status) { ui.status.style.display = "none"; } }

	// ======================================================================
	//  6. interaction (selection + rich tooltip)
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
		if (!hit.moveOnly) { fillTooltip(hit.feature); }
		ui.tip.style.display = "";
		var x = hit.x + 14, y = hit.y + 14;
		if (x + ui.tip.offsetWidth > engine.cssW) { x = hit.x - ui.tip.offsetWidth - 14; }
		if (y + ui.tip.offsetHeight > engine.cssH) { y = hit.y - ui.tip.offsetHeight - 14; }
		ui.tip.style.left = Math.max(2, x) + "px"; ui.tip.style.top = Math.max(2, y) + "px";
	}

	// builds the hover tooltip: segment header + EVERY measure value (colour
	// coded as drawn) + any selected GeoJSON properties -> "her alan için açıklama"
	function fillTooltip(f) {
		var tip = ui.tip; clear(tip);
		var header = el("div", "font-weight:bold;margin-bottom:3px;", tip);
		txt(header, f.name != null ? f.name : (f.id != null ? f.id : "Segment"));
		if (f.name != null && f.id != null && ("" + f.name) !== ("" + f.id)) {
			txt(el("div", "color:#aeb8c2;font-size:10px;margin-bottom:3px;", tip), "ID: " + f.id);
		}
		var rows = 0;
		if (cfg.tooltipShowMeasures) {
			for (var i = 0; i < engine.layers.length; i++) {
				var L = engine.layers[i];
				if (L.kind !== "measure") { continue; }
				var val = (f.id != null) ? L.values[f.id] : null;
				if (val == null) { continue; }
				tip.appendChild(tipRow(L.styleFn(f).color, L.title, fnum(val)));
				rows++;
			}
		}
		var props = csv(cfg.tooltipProperties);
		for (var p = 0; p < props.length; p++) {
			if (f.props && f.props[props[p]] != null) { tip.appendChild(tipRow(null, props[p], "" + f.props[props[p]])); rows++; }
		}
		if (!rows) { txt(el("div", "color:#aeb8c2;font-size:10px;", tip), "Bu segment için veri yok"); }
	}
	function tipRow(color, label, value) {
		var r = el("div", "display:flex;align-items:center;gap:6px;");
		if (color) { el("span", "display:inline-block;width:9px;height:9px;border-radius:50%;flex:none;background:" + color + ";", r); }
		else { el("span", "display:inline-block;width:9px;flex:none;", r); }    // spacer keeps labels aligned
		txt(el("span", "color:#c9d3dc;", r), label + ":");
		txt(el("span", "margin-left:auto;font-weight:bold;padding-left:8px;", r), value);
		return r;
	}

	// ======================================================================
	//  BIAL scripting API  (declared in contribution.ztl)
	// ======================================================================
	this.setLayerVisible = function (id, visible) { var l = resolveLayer(id); if (l) { engine.setLayerVisible(l.id, visible); buildSync(); } return this; };
	this.showLayer = function (id) { return this.setLayerVisible(id, true); };
	this.hideLayer = function (id) { return this.setLayerVisible(id, false); };
	this.toggleLayer = function (id) { var l = resolveLayer(id); if (l) { this.setLayerVisible(l.id, !l.visible); } return this; };
	// show exactly one measure layer, hide the others -> switches the active measure at runtime
	this.showOnlyLayer = function (id) {
		var target = resolveLayer(id);
		for (var i = 0; i < engine.layers.length; i++) { var L = engine.layers[i]; if (L.kind === "base") { continue; } engine.setLayerVisible(L.id, target && L.id === target.id); }
		if (target) { cfg.selectedLayer = target.id; }
		buildSync();
		return this;
	};
	this.setActiveMeasure = function (name) { return this.showOnlyLayer(name); };
	this.getMeasures = function () { return measureOrder.join(","); };
	this.getLayerIds = function () { var o = []; for (var i = 0; i < engine.layers.length; i++) { o.push(engine.layers[i].id); } return o.join(","); };
	this.getVisibleLayers = function () { var o = []; for (var i = 0; i < engine.layers.length; i++) { if (engine.layers[i].visible) { o.push(engine.layers[i].title); } } return o.join(","); };

	// feed an arbitrary layer from script: dataJson = {"segId":value,...} or [{"segment":"x","value":1},...]
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
	this.removeLayer = function (id) { if (scriptLayers[id]) { delete scriptLayers[id]; rebuildLayers(); } return this; };

	this.zoomToSegment = function (segId) { for (var i = 0; i < baseFeatures.length; i++) { if (baseFeatures[i].id === ("" + segId)) { engine.fitBounds(baseFeatures[i].bbox, 60); return this; } } return this; };
	this.fitToNetwork = function () { engine.fitBounds(engine.allBounds()); return this; };
	this.setView = function (lat, lng, zoom) { engine.setView(lat, lng, zoom); return this; };
	this.refresh = function () { loadedNetworkKey = null; ensureNetwork(); return this; };

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
		that[name] = function (value) { if (value === undefined) { return cfg[name]; } cfg[name] = value; if (after) { after(value); } return that; };
	}
	var plain = ["segmentDimension", "segmentIdProperty", "segmentNameProperty",
		"baseLayerTitle", "layerColors", "visibleLayers", "layerControlTitle",
		"legendTitle", "selectedSegment", "selectedSegmentName", "selectedLayer",
		"initialLat", "initialLng", "initialZoom", "minZoom", "maxZoom",
		"lineWeight", "baseLineWeight", "tileOpacity",
		"baseLayerVisible", "showLayerControl", "layerControlCollapsed",
		"showLegend", "showTooltip", "tooltipShowMeasures", "tooltipProperties",
		"showZoomControl", "fitNetworkOnLoad",
		"backgroundColor", "defaultColor", "highlightColor", "tileUrl", "tileSubdomains"];
	for (var pi = 0; pi < plain.length; pi++) { accessor(plain[pi]); }

	// properties that require a network reload
	accessor("networkUrl", function () { needNetwork = true; });
	accessor("networkGeoJson", function () { needNetwork = true; });
	accessor("networkFormat", function () { needNetwork = true; });

	this.metadata = function (value) { if (value === undefined) { return meta; } meta = value; needData = true; return this; };
	this.data = function (value) { if (value === undefined) { return ds; } ds = value; needData = true; return this; };
});
