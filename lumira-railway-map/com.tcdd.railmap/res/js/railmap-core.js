// ============================================================================
//  TCDD Railway Map - core engine  (loaded before component.js)
//  ---------------------------------------------------------------------------
//  A dependency-free, Canvas based "slippy map" tuned for railway analytics:
//    * Web Mercator (EPSG:3857) projection; pan / wheel-zoom / box-zoom (shift)
//      / dblclick-zoom / keyboard; touch pan & pinch-friendly.
//    * optional XYZ raster basemap (browser fetches tiles) with presets;
//      degrades to a flat background colour offline.
//    * any number of vector layers (LineString/MultiLineString/Polygon/Point),
//      each with casing, dash, animated "flow" dashes, direction arrows,
//      labels, per-feature style, opacity, hover emphasis and selection.
//    * data symbology helpers: colour ramps, classification (equal / quantile /
//      natural-breaks Jenks) and categorical palettes.
//    * hit testing, getBounds/center/zoom, scale (m/px), and PNG snapshot.
//  No Leaflet, no Google Maps, no API key. ES5 / IE10+ safe.
// ============================================================================
if (!window.TCDDRailMap) {
	window.TCDDRailMap = (function () {

		// ---- colour ramps ---------------------------------------------------
		var RAMPS = {
			traffic: ["#1a9850", "#fee08b", "#d73027"],
			rdylgn:  ["#d73027", "#fee08b", "#1a9850"],
			blue:    ["#deebf7", "#3182bd", "#08306b"],
			green:   ["#e5f5e0", "#74c476", "#00441b"],
			heat:    ["#ffffb2", "#fd8d3c", "#bd0026"],
			purple:  ["#efedf5", "#9e9ac8", "#54278f"],
			viridis: ["#440154", "#21908d", "#fde725"],
			cool:    ["#2c7fb8", "#7fcdbb", "#edf8b1"],
			gray:    ["#f0f0f0", "#969696", "#252525"]
		};
		// distinct palette for categorical symbology
		var CATPAL = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab", "#1f77b4", "#ff7f0e"];
		// basemap presets (end-user browser fetches the tiles)
		var BASEMAPS = {
			osm:            { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", subs: ["a", "b", "c"], label: "OpenStreetMap" },
			"carto-light":  { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", subs: ["a", "b", "c", "d"], label: "Carto Light" },
			"carto-dark":   { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", subs: ["a", "b", "c", "d"], label: "Carto Dark" },
			"carto-voyager":{ url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", subs: ["a", "b", "c", "d"], label: "Carto Voyager" },
			none:           { url: "", subs: [], label: "Yok (offline)" }
		};

		function hexToRgb(h) {
			h = ("" + h).replace("#", "");
			if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
			return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
		}
		function rgbToHex(r, g, b) {
			function hx(x) { x = Math.max(0, Math.min(255, Math.round(x))); var t = x.toString(16); return t.length < 2 ? "0" + t : t; }
			return "#" + hx(r) + hx(g) + hx(b);
		}
		function rampColor(name, t) {
			var stops = RAMPS[("" + name).toLowerCase()] || RAMPS.blue;
			if (t == null || isNaN(t)) { return stops[0]; }
			t = t < 0 ? 0 : (t > 1 ? 1 : t);
			if (stops.length === 1) { return stops[0]; }
			var seg = t * (stops.length - 1), i = Math.floor(seg);
			if (i >= stops.length - 1) { return stops[stops.length - 1]; }
			var f = seg - i, a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
			return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
		}
		function rampStops(name) { return RAMPS[("" + name).toLowerCase()] || RAMPS.blue; }
		function categoryColor(i) { return CATPAL[((i % CATPAL.length) + CATPAL.length) % CATPAL.length]; }

		// ---- classification --------------------------------------------------
		function sortedValues(values) {
			var a = [], k;
			for (k in values) { if (values.hasOwnProperty(k)) { var v = values[k]; if (v != null && !isNaN(v)) { a.push(+v); } } }
			a.sort(function (x, y) { return x - y; });
			return a;
		}
		function quantile(sorted, p) {
			if (!sorted.length) { return 0; }
			var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
			if (lo === hi) { return sorted[lo]; }
			return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
		}
		// returns class edges (length n+1): [min, b1, ..., max]
		function classify(sorted, method, n) {
			n = Math.max(1, n | 0);
			if (!sorted.length) { return [0, 1]; }
			var min = sorted[0], max = sorted[sorted.length - 1], i, edges;
			if (min === max) { edges = []; for (i = 0; i <= n; i++) { edges.push(min); } return edges; }
			method = ("" + (method || "quantile")).toLowerCase();
			if (method === "equal") { edges = []; for (i = 0; i <= n; i++) { edges.push(min + (max - min) * i / n); } return edges; }
			if (method === "jenks") { return jenksBreaks(sorted, n); }
			edges = [min]; for (i = 1; i < n; i++) { edges.push(quantile(sorted, i / n)); } edges.push(max); return edges;   // quantile
		}
		function classIndex(edges, value) {
			var n = edges.length - 1;
			for (var i = 1; i < n; i++) { if (value < edges[i]) { return i - 1; } }
			return n - 1;
		}
		// Fisher-Jenks natural breaks (subsampled for large inputs to stay fast)
		function jenksBreaks(data, nClasses) {
			if (data.length > 1200) {                                  // subsample preserving distribution
				var step = data.length / 1000, s = [];
				for (var x = 0; x < data.length; x += step) { s.push(data[Math.floor(x)]); }
				s[s.length] = data[data.length - 1]; data = s;
			}
			var n = data.length;
			if (nClasses >= n) { var e = [data[0]]; for (var q = 1; q <= nClasses; q++) { e.push(data[Math.min(n - 1, q - 1)]); } return e; }
			var lc = [], op = [], i, j;
			for (i = 0; i <= n; i++) { lc.push([]); op.push([]); for (j = 0; j <= nClasses; j++) { lc[i].push(0); op[i].push(0); } }
			for (i = 1; i <= nClasses; i++) { lc[1][i] = 1; op[1][i] = 0; for (j = 2; j <= n; j++) { lc[j][i] = Infinity; } }
			var v = 0;
			for (var l = 2; l <= n; l++) {
				var s1 = 0, s2 = 0, w = 0;
				for (var m = 1; m <= l; m++) {
					var i3 = l - m + 1, val = data[i3 - 1];
					s2 += val * val; s1 += val; w++;
					v = s2 - (s1 * s1) / w;
					var i4 = i3 - 1;
					if (i4 !== 0) { for (var jj = 2; jj <= nClasses; jj++) { if (lc[l][jj] >= (v + lc[i4][jj - 1])) { op[l][jj] = i3; lc[l][jj] = v + lc[i4][jj - 1]; } } }
				}
				lc[l][1] = v; op[l][1] = 1;
			}
			var k = n, kclass = []; for (i = 0; i <= nClasses; i++) { kclass.push(0); }
			kclass[nClasses] = data[n - 1]; kclass[0] = data[0];
			var cn = nClasses;
			while (cn > 1) { var idx = op[k][cn] - 2; kclass[cn - 1] = data[idx < 0 ? 0 : idx]; k = op[k][cn] - 1; cn--; }
			return kclass;
		}

		function metersPerPixel(lat, zoom) { return 156543.03392804097 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom); }
		function hyp(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }

		// ---- Web Mercator projection ----------------------------------------
		var TILE = 256;
		function lngToWorldX(lng, scale) { return (lng + 180) / 360 * scale; }
		function latToWorldY(lat, scale) {
			var s = Math.sin(lat * Math.PI / 180);
			s = s < -0.9999 ? -0.9999 : (s > 0.9999 ? 0.9999 : s);
			return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale;
		}
		function worldXToLng(x, scale) { return x / scale * 360 - 180; }
		function worldYToLat(y, scale) {
			var n = Math.PI - 2 * Math.PI * y / scale;
			return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
		}

		// ---- GeoJSON normalisation ------------------------------------------
		function normalizeGeoJson(gj, idProp, nameProp) {
			var out = [];
			if (!gj) { return out; }
			var feats = [];
			if (gj.type === "FeatureCollection" && gj.features) { feats = gj.features; }
			else if (gj.type === "Feature") { feats = [gj]; }
			else if (gj.type && gj.coordinates) { feats = [{ type: "Feature", geometry: gj, properties: {} }]; }
			for (var i = 0; i < feats.length; i++) {
				var f = feats[i] || {}, g = f.geometry, props = f.properties || {};
				if (!g) { continue; }
				var lines = [], points = [];
				collectGeometry(g, lines, points);
				if (!lines.length && !points.length) { continue; }
				var id = props[idProp];
				if (id == null && f.id != null) { id = f.id; }
				out.push({
					id: (id == null ? null : "" + id),
					name: (nameProp && props[nameProp] != null) ? ("" + props[nameProp]) : null,
					props: props, lines: lines, points: points, bbox: bboxOf(lines, points),
					anchor: anchorOf(lines, points)                 // representative [lng,lat] for point/marker/bubble/heat
				});
			}
			return out;
		}
		function collectGeometry(g, lines, points) {
			if (!g || !g.type) { return; }
			var c = g.coordinates;
			switch (g.type) {
				case "LineString": if (c && c.length) { lines.push(c); } break;
				case "MultiLineString": for (var i = 0; i < (c || []).length; i++) { if (c[i] && c[i].length) { lines.push(c[i]); } } break;
				case "Polygon": for (var j = 0; j < (c || []).length; j++) { if (c[j] && c[j].length) { lines.push(c[j]); } } break;
				case "MultiPolygon": for (var k = 0; k < (c || []).length; k++) { for (var l = 0; l < c[k].length; l++) { if (c[k][l] && c[k][l].length) { lines.push(c[k][l]); } } } break;
				case "Point": if (c) { points.push(c); } break;
				case "MultiPoint": for (var m = 0; m < (c || []).length; m++) { points.push(c[m]); } break;
				case "GeometryCollection": for (var n = 0; n < (g.geometries || []).length; n++) { collectGeometry(g.geometries[n], lines, points); } break;
			}
		}
		function bboxOf(lines, points) {
			var b = [Infinity, Infinity, -Infinity, -Infinity], i, j;
			for (i = 0; i < lines.length; i++) { for (j = 0; j < lines[i].length; j++) { ext(b, lines[i][j]); } }
			for (i = 0; i < points.length; i++) { ext(b, points[i]); }
			return b;
		}
		function ext(b, p) {
			if (!p || p.length < 2) { return; }
			if (p[0] < b[0]) { b[0] = p[0]; } if (p[1] < b[1]) { b[1] = p[1]; }
			if (p[0] > b[2]) { b[2] = p[0]; } if (p[1] > b[3]) { b[3] = p[1]; }
		}
		// representative point: first point geometry, else middle vertex of the longest line
		function anchorOf(lines, points) {
			if (points.length) { return points[0]; }
			if (lines.length) { var best = lines[0]; for (var i = 1; i < lines.length; i++) { if (lines[i].length > best.length) { best = lines[i]; } } return best[Math.floor(best.length / 2)]; }
			return null;
		}

		// ====================================================================
		//  Multi-format network parsing  (GeoJSON / TopoJSON / KML / GPX / JSON)
		// ====================================================================
		function detectFormat(raw) {
			if (raw == null) { return "geojson"; }
			if (typeof raw === "object") { return (raw.type === "Topology") ? "topojson" : "geojson"; }
			var s = ("" + raw).replace(/^﻿/, "").replace(/^\s+/, "");
			if (s.charAt(0) === "<") { if (/<gpx[\s>]/i.test(s)) { return "gpx"; } return "kml"; }
			try {
				var o = JSON.parse(s);
				if (o && o.type === "Topology") { return "topojson"; }
				if (o && (o.type === "FeatureCollection" || o.type === "Feature" || o.coordinates)) { return "geojson"; }
				return "json";
			} catch (e) { return "geojson"; }
		}
		function parseNetwork(raw, format) {
			format = (format && format !== "auto") ? ("" + format).toLowerCase() : detectFormat(raw);
			switch (format) {
				case "kml": return kmlToGeoJson(raw);
				case "gpx": return gpxToGeoJson(raw);
				case "topojson": return topojsonToGeoJson(typeof raw === "string" ? JSON.parse(raw) : raw);
				case "json": return plainJsonToGeoJson(typeof raw === "string" ? JSON.parse(raw) : raw);
				default: return (typeof raw === "string") ? JSON.parse(raw) : raw;
			}
		}
		function xmlDoc(str) {
			if (typeof DOMParser === "undefined") { throw new Error("DOMParser yok (XML ayrıştırılamıyor)"); }
			return new DOMParser().parseFromString("" + str, "text/xml");
		}
		function tags(node, name) { return node.getElementsByTagNameNS ? node.getElementsByTagNameNS("*", name) : node.getElementsByTagName(name); }
		function textOf(node, name) { var t = tags(node, name); return t.length ? trim(t[0].textContent) : null; }
		function trim(s) { return s == null ? null : ("" + s).replace(/^\s+|\s+$/g, ""); }
		function parseCoordList(txt) {
			var out = [], toks = trim(("" + txt).replace(/\s+/g, " ")).split(" ");
			for (var i = 0; i < toks.length; i++) {
				if (!toks[i]) { continue; }
				var c = toks[i].split(","), lng = parseFloat(c[0]), lat = parseFloat(c[1]);
				if (!isNaN(lng) && !isNaN(lat)) { out.push([lng, lat]); }
			}
			return out;
		}
		function kmlToGeoJson(str) {
			var doc = xmlDoc(str), feats = [], pms = tags(doc, "Placemark");
			for (var i = 0; i < pms.length; i++) {
				var pm = pms[i], props = {}, nm = textOf(pm, "name");
				if (nm != null) { props.name = nm; }
				var ds = tags(pm, "Data");
				for (var d = 0; d < ds.length; d++) { var k = ds[d].getAttribute("name"); if (k) { props[k] = textOf(ds[d], "value"); } }
				var sds = tags(pm, "SimpleData");
				for (var s = 0; s < sds.length; s++) { var k2 = sds[s].getAttribute("name"); if (k2) { props[k2] = trim(sds[s].textContent); } }
				var geoms = [];
				pushKmlLines(pm, "LineString", geoms);
				pushKmlPolys(pm, geoms);
				var pts = tags(pm, "Point");
				for (var p = 0; p < pts.length; p++) { var pc = parseCoordList(textOf(pts[p], "coordinates")); if (pc.length) { geoms.push({ type: "Point", coordinates: pc[0] }); } }
				for (var g = 0; g < geoms.length; g++) { feats.push({ type: "Feature", properties: clone(props), geometry: geoms[g] }); }
			}
			return { type: "FeatureCollection", features: feats };
		}
		function pushKmlLines(pm, tag, out) {
			var ls = tags(pm, tag);
			for (var i = 0; i < ls.length; i++) { var c = parseCoordList(textOf(ls[i], "coordinates")); if (c.length > 1) { out.push({ type: "LineString", coordinates: c }); } }
		}
		function pushKmlPolys(pm, out) {
			var polys = tags(pm, "Polygon");
			for (var i = 0; i < polys.length; i++) {
				var rings = [], lr = tags(polys[i], "LinearRing");
				for (var r = 0; r < lr.length; r++) { var rc = parseCoordList(textOf(lr[r], "coordinates")); if (rc.length) { rings.push(rc); } }
				if (rings.length) { out.push({ type: "Polygon", coordinates: rings }); }
			}
		}
		function gpxToGeoJson(str) {
			var doc = xmlDoc(str), feats = [], i;
			var trks = tags(doc, "trk");
			for (i = 0; i < trks.length; i++) {
				var lines = [], segs = tags(trks[i], "trkseg");
				for (var s = 0; s < segs.length; s++) { var ln = gpxPts(segs[s], "trkpt"); if (ln.length) { lines.push(ln); } }
				if (lines.length) { feats.push(gpxFeature(textOf(trks[i], "name"), lines)); }
			}
			var rtes = tags(doc, "rte");
			for (i = 0; i < rtes.length; i++) { var rl = gpxPts(rtes[i], "rtept"); if (rl.length) { feats.push(gpxFeature(textOf(rtes[i], "name"), [rl])); } }
			var wpts = tags(doc, "wpt");
			for (i = 0; i < wpts.length; i++) { var w = gpxPt(wpts[i]); if (w) { feats.push({ type: "Feature", properties: { name: textOf(wpts[i], "name") }, geometry: { type: "Point", coordinates: w } }); } }
			return { type: "FeatureCollection", features: feats };
		}
		function gpxPt(node) { var lat = parseFloat(node.getAttribute("lat")), lon = parseFloat(node.getAttribute("lon")); return (isNaN(lat) || isNaN(lon)) ? null : [lon, lat]; }
		function gpxPts(parent, tag) { var out = [], pts = tags(parent, tag); for (var i = 0; i < pts.length; i++) { var c = gpxPt(pts[i]); if (c) { out.push(c); } } return out; }
		function gpxFeature(name, lines) {
			var geom = lines.length > 1 ? { type: "MultiLineString", coordinates: lines } : { type: "LineString", coordinates: lines[0] };
			return { type: "Feature", properties: { name: name }, geometry: geom };
		}
		function topojsonToGeoJson(topo) {
			var feats = [];
			if (!topo || !topo.objects) { return { type: "FeatureCollection", features: feats }; }
			var arcs = topo.arcs || [], tr = topo.transform;
			function decodeArc(idx) {
				var rev = idx < 0; if (rev) { idx = ~idx; }
				var arc = arcs[idx] || [], out = [], x = 0, y = 0;
				for (var i = 0; i < arc.length; i++) {
					if (tr) { x += arc[i][0]; y += arc[i][1]; out.push([x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]]); }
					else { out.push([arc[i][0], arc[i][1]]); }
				}
				if (rev) { out.reverse(); }
				return out;
			}
			function stitch(idxs) { var line = [], i; for (i = 0; i < idxs.length; i++) { var dec = decodeArc(idxs[i]); if (i > 0) { dec = dec.slice(1); } line = line.concat(dec); } return line; }
			function pt(p) { return tr ? [p[0] * tr.scale[0] + tr.translate[0], p[1] * tr.scale[1] + tr.translate[1]] : p; }
			function geom(g) {
				switch (g.type) {
					case "LineString": return { type: "LineString", coordinates: stitch(g.arcs) };
					case "MultiLineString": return { type: "MultiLineString", coordinates: mapArr(g.arcs, stitch) };
					case "Polygon": return { type: "Polygon", coordinates: mapArr(g.arcs, stitch) };
					case "MultiPolygon": return { type: "MultiPolygon", coordinates: mapArr(g.arcs, function (poly) { return mapArr(poly, stitch); }) };
					case "Point": return { type: "Point", coordinates: pt(g.coordinates) };
					case "MultiPoint": return { type: "MultiPoint", coordinates: mapArr(g.coordinates, pt) };
				}
				return null;
			}
			for (var key in topo.objects) {
				if (!topo.objects.hasOwnProperty(key)) { continue; }
				var obj = topo.objects[key], gs = (obj.type === "GeometryCollection") ? obj.geometries : [obj];
				for (var i = 0; i < gs.length; i++) { var gj = geom(gs[i]); if (gj) { feats.push({ type: "Feature", id: gs[i].id, properties: gs[i].properties || {}, geometry: gj }); } }
			}
			return { type: "FeatureCollection", features: feats };
		}
		function mapArr(a, fn) { var o = []; for (var i = 0; i < a.length; i++) { o.push(fn(a[i])); } return o; }
		function plainJsonToGeoJson(obj) {
			var feats = [], arr = (obj instanceof Array) ? obj : (obj && obj.features) ? obj.features : (obj && obj.segments) ? obj.segments : [];
			for (var i = 0; i < arr.length; i++) {
				var it = arr[i] || {}, coords = it.coordinates || it.coords || it.path || it.line, line = null;
				if (coords && coords.length) {
					line = [];
					for (var j = 0; j < coords.length; j++) {
						var c = coords[j];
						if (c instanceof Array) { line.push([+c[0], +c[1]]); }
						else if (c && c.lng != null) { line.push([+c.lng, +c.lat]); }
						else if (c && c.lon != null) { line.push([+c.lon, +c.lat]); }
					}
				}
				var props = it.properties || {};
				if (it.id != null) { props.id = it.id; }
				if (it.name != null) { props.name = it.name; }
				if (line && line.length > 1) { feats.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: line } }); }
				else if (it.lat != null && (it.lng != null || it.lon != null)) { feats.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [+(it.lng != null ? it.lng : it.lon), +it.lat] } }); }
			}
			return { type: "FeatureCollection", features: feats };
		}
		function clone(o) { var n = {}; for (var k in o) { if (o.hasOwnProperty(k)) { n[k] = o[k]; } } return n; }

		// ====================================================================
		//  MapEngine
		// ====================================================================
		function MapEngine(container, opts) {
			opts = opts || {};
			this.container = container;
			this.center = { lat: opts.lat != null ? opts.lat : 39.2, lng: opts.lng != null ? opts.lng : 35.2 };
			this.zoom = opts.zoom != null ? opts.zoom : 6;
			this.minZoom = opts.minZoom != null ? opts.minZoom : 2;
			this.maxZoom = opts.maxZoom != null ? opts.maxZoom : 18;
			this.bg = opts.background || "#eef2f5";
			this.hoverEmphasis = opts.hoverEmphasis !== false;
			this.tile = null;
			this.tileCache = {};
			this.layers = [];
			this.listeners = { click: [], hover: [], move: [], dblclick: [], viewchange: [], box: [] };
			this.selected = null;
			this._raf = null; this._hoverKey = null; this._hover = null;
			this._dashOffset = 0; this._animOn = false; this._animId = null;
			this._build();
		}

		MapEngine.prototype._build = function () {
			var c = this.container;
			c.style.position = c.style.position || "relative";
			c.style.overflow = "hidden";
			var cv = document.createElement("canvas");
			cv.style.position = "absolute"; cv.style.left = "0px"; cv.style.top = "0px";
			cv.style.cursor = "grab"; cv.style.outline = "none";
			if (cv.setAttribute) { cv.setAttribute("tabindex", "0"); }
			c.appendChild(cv);
			this.canvas = cv;
			this.ctx = cv.getContext("2d");
			this.boxDiv = document.createElement("div");
			this.boxDiv.style.cssText = "position:absolute;border:1px dashed #2b8cbe;background:rgba(43,140,190,.12);display:none;z-index:9;pointer-events:none;";
			c.appendChild(this.boxDiv);
			this._bindEvents();
			this.resize();
		};

		MapEngine.prototype.resize = function () {
			var w = this.container.clientWidth || 600, h = this.container.clientHeight || 400;
			var dpr = window.devicePixelRatio || 1;
			this.cssW = w; this.cssH = h; this.dpr = dpr;
			this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
			this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
			this.scheduleRender();
		};

		// --- view -----------------------------------------------------------
		MapEngine.prototype.setView = function (lat, lng, zoom) {
			if (lat != null) { this.center.lat = lat; }
			if (lng != null) { this.center.lng = lng; }
			if (zoom != null) { this.zoom = this._clampZoom(zoom); }
			this.scheduleRender(); this._emit("viewchange", this.getView());
		};
		MapEngine.prototype.getView = function () { return { lat: this.center.lat, lng: this.center.lng, zoom: this.zoom }; };
		MapEngine.prototype.getCenter = function () { return { lat: this.center.lat, lng: this.center.lng }; };
		MapEngine.prototype.getZoom = function () { return this.zoom; };
		MapEngine.prototype.getBounds = function () {
			var o = this._origin();
			return { west: worldXToLng(o.ox, o.scale), east: worldXToLng(o.ox + this.cssW, o.scale), north: worldYToLat(o.oy, o.scale), south: worldYToLat(o.oy + this.cssH, o.scale) };
		};
		MapEngine.prototype.metersPerPixel = function () { return metersPerPixel(this.center.lat, this.zoom); };
		MapEngine.prototype._clampZoom = function (z) { return Math.max(this.minZoom, Math.min(this.maxZoom, Math.round(z))); };
		MapEngine.prototype.setBackground = function (color) { this.bg = color || "#eef2f5"; this.scheduleRender(); };
		MapEngine.prototype.setTile = function (url, subs, opacity) {
			if (!url) { this.tile = null; }
			else { this.tile = { url: url, subs: (subs && subs.length) ? subs : ["a", "b", "c"], opacity: (opacity == null ? 1 : opacity) }; }
			this.tileCache = {}; this._tileKeys = [];
			this.scheduleRender();
		};

		// --- layers ----------------------------------------------------------
		MapEngine.prototype.addLayer = function (layer) {
			layer.visible = layer.visible !== false;
			this.layers.push(layer);
			this._maybeAnim();
			this.scheduleRender();
			return layer;
		};
		MapEngine.prototype.clearLayers = function () { this.layers = []; this.selected = null; this._maybeAnim(); this.scheduleRender(); };
		MapEngine.prototype.getLayer = function (id) { for (var i = 0; i < this.layers.length; i++) { if (this.layers[i].id === id) { return this.layers[i]; } } return null; };
		MapEngine.prototype.setLayerVisible = function (id, vis) { var l = this.getLayer(id); if (l) { l.visible = !!vis; this._maybeAnim(); this.scheduleRender(); } };
		MapEngine.prototype.setSelected = function (layerId, featureId) { this.selected = (featureId == null) ? null : { layerId: layerId, featureId: "" + featureId }; this.scheduleRender(); };

		MapEngine.prototype.allBounds = function () {
			var b = [Infinity, Infinity, -Infinity, -Infinity], i, j, fb;
			for (i = 0; i < this.layers.length; i++) {
				var fs = this.layers[i].features || [];
				for (j = 0; j < fs.length; j++) { fb = fs[j].bbox; if (fb[0] < b[0]) { b[0] = fb[0]; } if (fb[1] < b[1]) { b[1] = fb[1]; } if (fb[2] > b[2]) { b[2] = fb[2]; } if (fb[3] > b[3]) { b[3] = fb[3]; } }
			}
			return isFinite(b[0]) ? b : null;
		};
		MapEngine.prototype.fitBounds = function (b, padding) {
			if (!b || !isFinite(b[0])) { return; }
			padding = padding == null ? 24 : padding;
			var w = Math.max(1, this.cssW - 2 * padding), h = Math.max(1, this.cssH - 2 * padding), best = this.minZoom;
			for (var z = this.maxZoom; z >= this.minZoom; z--) {
				var scale = TILE * Math.pow(2, z);
				var x0 = lngToWorldX(b[0], scale), x1 = lngToWorldX(b[2], scale);
				var y0 = latToWorldY(b[3], scale), y1 = latToWorldY(b[1], scale);
				if (Math.abs(x1 - x0) <= w && Math.abs(y1 - y0) <= h) { best = z; break; }
			}
			this.zoom = this._clampZoom(best);
			this.center.lng = (b[0] + b[2]) / 2; this.center.lat = (b[1] + b[3]) / 2;
			this.scheduleRender(); this._emit("viewchange", this.getView());
		};

		// --- projection helpers ---------------------------------------------
		MapEngine.prototype._origin = function () {
			var scale = TILE * Math.pow(2, this.zoom);
			return { scale: scale, ox: lngToWorldX(this.center.lng, scale) - this.cssW / 2, oy: latToWorldY(this.center.lat, scale) - this.cssH / 2 };
		};
		MapEngine.prototype.project = function (lng, lat, o) { o = o || this._origin(); return { x: lngToWorldX(lng, o.scale) - o.ox, y: latToWorldY(lat, o.scale) - o.oy }; };
		MapEngine.prototype.unproject = function (x, y) { var o = this._origin(); return { lng: worldXToLng(x + o.ox, o.scale), lat: worldYToLat(y + o.oy, o.scale) }; };
		MapEngine.prototype._projLine = function (line, o) { var p = []; for (var i = 0; i < line.length; i++) { p.push(this.project(line[i][0], line[i][1], o)); } return p; };

		// --- render ----------------------------------------------------------
		MapEngine.prototype.scheduleRender = function () {
			if (this._raf || this._animOn) { return; }
			var self = this;
			this._raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { self._raf = null; self._draw(); });
		};
		MapEngine.prototype._draw = function () {
			var ctx = this.ctx;
			ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
			ctx.clearRect(0, 0, this.cssW, this.cssH);
			ctx.fillStyle = this.bg; ctx.fillRect(0, 0, this.cssW, this.cssH);
			this._drawTiles(ctx);
			this._drawLayers(ctx);
		};

		MapEngine.prototype._drawTiles = function (ctx) {
			if (!this.tile) { return; }
			var z = this.zoom, scale = TILE * Math.pow(2, z), n = Math.pow(2, z);
			var o = { scale: scale, ox: lngToWorldX(this.center.lng, scale) - this.cssW / 2, oy: latToWorldY(this.center.lat, scale) - this.cssH / 2 };
			var x0 = Math.floor(o.ox / TILE), x1 = Math.floor((o.ox + this.cssW) / TILE);
			var y0 = Math.floor(o.oy / TILE), y1 = Math.floor((o.oy + this.cssH) / TILE);
			ctx.globalAlpha = this.tile.opacity;
			for (var tx = x0; tx <= x1; tx++) {
				for (var ty = y0; ty <= y1; ty++) {
					if (ty < 0 || ty >= n) { continue; }
					var wx = ((tx % n) + n) % n, img = this._tileImage(this._tileUrl(wx, ty, z));
					var sx = tx * TILE - o.ox, sy = ty * TILE - o.oy;
					if (img && img.complete && img.naturalWidth) { ctx.drawImage(img, Math.round(sx), Math.round(sy), TILE, TILE); }
				}
			}
			ctx.globalAlpha = 1;
		};
		MapEngine.prototype._tileUrl = function (x, y, z) {
			var s = this.tile.subs[((x + y) % this.tile.subs.length + this.tile.subs.length) % this.tile.subs.length];
			return this.tile.url.replace("{s}", s).replace("{z}", z).replace("{x}", x).replace("{y}", y);
		};
		MapEngine.prototype._tileImage = function (url) {
			var img = this.tileCache[url];
			if (img) { return img; }
			this._tileKeys = this._tileKeys || [];
			if (this._tileKeys.length > 400) {                          // cap cache to avoid unbounded growth
				var drop = this._tileKeys.splice(0, 120);
				for (var d = 0; d < drop.length; d++) { delete this.tileCache[drop[d]]; }
			}
			img = new Image(); img.crossOrigin = "anonymous";
			var self = this;
			img.onload = function () { self.scheduleRender(); };
			img.onerror = function () { img._failed = true; };
			img.src = url; this.tileCache[url] = img; this._tileKeys.push(url);
			return img;
		};

		MapEngine.prototype._drawLayers = function (ctx) {
			var o = this._origin();
			var vMinLng = worldXToLng(o.ox, o.scale), vMaxLng = worldXToLng(o.ox + this.cssW, o.scale);
			var vMaxLat = worldYToLat(o.oy, o.scale), vMinLat = worldYToLat(o.oy + this.cssH, o.scale);
			ctx.lineJoin = "round"; ctx.lineCap = "round";
			var labelQueue = [];
			for (var li = 0; li < this.layers.length; li++) {
				var layer = this.layers[li];
				if (!layer.visible) { continue; }
				var type = layer.type || "line";
				if (type === "heatmap") { this._drawHeatmap(ctx, layer, o, vMinLng, vMinLat, vMaxLng, vMaxLat); continue; }
				var fs = layer.features || [], layerAlpha = layer.opacity != null ? layer.opacity : 1;
				for (var fi = 0; fi < fs.length; fi++) {
					var f = fs[fi], bb = f.bbox;
					if (bb[2] < vMinLng || bb[0] > vMaxLng || bb[3] < vMinLat || bb[1] > vMaxLat) { continue; }
					var st = layer.styleFn ? layer.styleFn(f) : null;
					if (st === false) { continue; }
					st = st || {};
					var sel = this.selected && this.selected.layerId === layer.id && this.selected.featureId === f.id;
					var hov = this.hoverEmphasis && this._hover && this._hover.layerId === layer.id && this._hover.featureId === f.id;
					var color = (sel && layer.highlightColor) ? layer.highlightColor : (st.color || layer.color || "#5a6b7b");
					var weight = (st.weight || layer.weight || 3) + (sel ? 2.5 : 0) + (hov ? 1.5 : 0);
					var alpha = (st.opacity != null ? st.opacity : 1) * layerAlpha;

					if (type === "point" || type === "marker" || type === "bubble") {
						// symbol at the representative point(s)
						var anchors = f.points.length ? f.points : (f.anchor ? [f.anchor] : []);
						for (var sIdx = 0; sIdx < anchors.length; sIdx++) {
							var sp = this.project(anchors[sIdx][0], anchors[sIdx][1], o);
							if (type === "marker") { this._pin(ctx, sp.x, sp.y, (layer.pointRadius || 7) + (sel || hov ? 2 : 0), color, alpha); }
							else if (type === "bubble") { var br = this._bubbleR(layer, f) + (sel || hov ? 2 : 0); ctx.globalAlpha = alpha * 0.75; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sp.x, sp.y, br, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = alpha; ctx.lineWidth = 1.2; ctx.strokeStyle = color; if (ctx.setLineDash) { ctx.setLineDash([]); } ctx.stroke(); }
							else { var rr = (layer.pointRadius || 6) + (sel || hov ? 2 : 0); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sp.x, sp.y, rr, 0, 2 * Math.PI); ctx.fill(); if (layer.pointStroke !== false) { ctx.lineWidth = 1.4; ctx.strokeStyle = "#fff"; if (ctx.setLineDash) { ctx.setLineDash([]); } ctx.stroke(); } }
						}
					} else {
						// line / multiline
						var proj = [];
						for (var pl = 0; pl < f.lines.length; pl++) { if (f.lines[pl].length > 1) { proj.push(this._projLine(f.lines[pl], o)); } }
						if ((layer.casing || st.casing) && proj.length) {
							ctx.globalAlpha = alpha; ctx.strokeStyle = layer.casingColor || "#ffffff";
							ctx.lineWidth = weight + (layer.casingWidth || 2) * 2; if (ctx.setLineDash) { ctx.setLineDash([]); }
							this._strokeProj(ctx, proj);
						}
						ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = weight;
						var dash = st.dash || layer.dash;
						if (ctx.setLineDash) { ctx.setLineDash(dash || []); ctx.lineDashOffset = (layer.dashAnimate ? this._dashOffset : 0); }
						this._strokeProj(ctx, proj);
						if (ctx.setLineDash) { ctx.lineDashOffset = 0; }
						if ((layer.arrows || st.arrows) && proj.length) {
							ctx.globalAlpha = alpha; ctx.fillStyle = layer.arrowColor || color;
							for (var ai = 0; ai < proj.length; ai++) { this._arrows(ctx, proj[ai], layer.arrowSpacing || 90, (weight + 6)); }
						}
						if (f.points.length) {
							ctx.globalAlpha = alpha; ctx.fillStyle = st.color || layer.pointColor || color;
							var pr = layer.pointRadius || Math.max(3, weight);
							for (var pi = 0; pi < f.points.length; pi++) { var pp = this.project(f.points[pi][0], f.points[pi][1], o); ctx.beginPath(); ctx.arc(pp.x, pp.y, pr, 0, 2 * Math.PI); ctx.fill(); }
						}
					}

					// label (anchor based) drawn last
					if (layer.labels && this.zoom >= (layer.labelMinZoom || 0) && f.anchor) {
						var lab = layer.labelFn ? layer.labelFn(f) : (f.name != null ? f.name : f.id);
						if (lab != null && ("" + lab).length) { var ap = this.project(f.anchor[0], f.anchor[1], o); labelQueue.push({ x: ap.x, y: ap.y, text: "" + lab, color: layer.labelColor || "#26333f" }); }
					}
				}
			}
			ctx.globalAlpha = 1; if (ctx.setLineDash) { ctx.setLineDash([]); }
			if (labelQueue.length) {
				ctx.font = "11px Arial,Helvetica,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
				ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineJoin = "round";
				for (var q = 0; q < labelQueue.length; q++) { var L = labelQueue[q]; if (ctx.strokeText) { ctx.strokeText(L.text, L.x, L.y); } ctx.fillStyle = L.color; ctx.fillText(L.text, L.x, L.y); }
			}
		};
		MapEngine.prototype._bubbleR = function (layer, f) {
			var mn = layer.bubbleMin || 4, mx = layer.bubbleMax || 26;
			var v = layer.valueAt ? layer.valueAt(f) : null;
			if (v == null || isNaN(v) || !(layer.max > layer.min)) { return mn; }
			var t = (v - layer.min) / (layer.max - layer.min); t = t < 0 ? 0 : (t > 1 ? 1 : t);
			return mn + Math.sqrt(t) * (mx - mn);                       // area-proportional
		};
		MapEngine.prototype._pin = function (ctx, x, y, r, color, alpha) {
			ctx.globalAlpha = alpha; ctx.fillStyle = color;
			ctx.beginPath(); ctx.arc(x, y - 2 * r, r, 0, 2 * Math.PI); ctx.fill();
			ctx.beginPath(); ctx.moveTo(x - r * 0.72, y - 2 * r + r * 0.45); ctx.lineTo(x, y); ctx.lineTo(x + r * 0.72, y - 2 * r + r * 0.45); ctx.closePath(); ctx.fill();
			ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y - 2 * r, r * 0.4, 0, 2 * Math.PI); ctx.fill();
		};
		// self-contained density heatmap from feature anchors (weight = layer.valueAt)
		MapEngine.prototype._heatLUT = function (ramp) {
			ramp = ramp || "heat";
			this._lutCache = this._lutCache || {};
			if (this._lutCache[ramp]) { return this._lutCache[ramp]; }
			var lut = new Array(256 * 3);
			for (var i = 0; i < 256; i++) { var c = hexToRgb(rampColor(ramp, i / 255)); lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2]; }
			this._lutCache[ramp] = lut; return lut;
		};
		MapEngine.prototype._drawHeatmap = function (ctx, layer, o, vMinLng, vMinLat, vMaxLng, vMaxLat) {
			var fs = layer.features || [], pts = [], maxW = 0, radius = layer.heatRadius || 26, i;
			for (i = 0; i < fs.length; i++) {
				var f = fs[i], a = f.anchor; if (!a) { continue; }
				if (a[0] < vMinLng || a[0] > vMaxLng || a[1] < vMinLat || a[1] > vMaxLat) { continue; }
				var sp = this.project(a[0], a[1], o);
				var w = layer.valueAt ? layer.valueAt(f) : 1; if (w == null || isNaN(w)) { w = 1; }
				if (w > maxW) { maxW = w; }
				pts.push({ x: sp.x, y: sp.y, w: w });
			}
			if (!pts.length) { return; }
			if (maxW <= 0) { maxW = 1; }
			if (typeof document === "undefined") { return; }
			var cv = document.createElement("canvas"); cv.width = this.cssW; cv.height = this.cssH;
			var g = cv.getContext("2d"); if (!g) { return; }
			g.globalCompositeOperation = "lighter";
			for (i = 0; i < pts.length; i++) {
				var p = pts[i], alpha = Math.max(0.05, Math.min(1, p.w / maxW));
				var grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
				grad.addColorStop(0, "rgba(0,0,0," + alpha + ")"); grad.addColorStop(1, "rgba(0,0,0,0)");
				g.fillStyle = grad; g.beginPath(); g.arc(p.x, p.y, radius, 0, 2 * Math.PI); g.fill();
			}
			g.globalCompositeOperation = "source-over";
			try {
				var img = g.getImageData(0, 0, this.cssW, this.cssH), d = img.data, lut = this._heatLUT(layer.heatRamp);
				for (i = 0; i < d.length; i += 4) { var al = d[i + 3]; if (!al) { continue; } var idx = al * 3; d[i] = lut[idx]; d[i + 1] = lut[idx + 1]; d[i + 2] = lut[idx + 2]; }
				g.putImageData(img, 0, 0);
				ctx.globalAlpha = layer.opacity != null ? layer.opacity : 0.85; ctx.drawImage(cv, 0, 0, this.cssW, this.cssH); ctx.globalAlpha = 1;
			} catch (e) { /* getImageData may be unavailable in some sandboxes */ }
		};
		MapEngine.prototype._strokeProj = function (ctx, proj) {
			for (var i = 0; i < proj.length; i++) {
				var pts = proj[i]; if (pts.length < 2) { continue; }
				ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
				for (var j = 1; j < pts.length; j++) { ctx.lineTo(pts[j].x, pts[j].y); }
				ctx.stroke();
			}
		};
		MapEngine.prototype._arrows = function (ctx, pts, spacing, size) {
			var gdist = 0, next = spacing / 2;
			for (var i = 0; i < pts.length - 1; i++) {
				var ax = pts[i].x, ay = pts[i].y, bx = pts[i + 1].x, by = pts[i + 1].y;
				var segLen = hyp(bx - ax, by - ay); if (segLen < 1) { continue; }
				var ang = Math.atan2(by - ay, bx - ax);
				while (next <= gdist + segLen) {
					var t = (next - gdist) / segLen, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
					var h = Math.min(8, size);
					ctx.beginPath(); ctx.moveTo(px, py);
					ctx.lineTo(px - h * Math.cos(ang - 0.5), py - h * Math.sin(ang - 0.5));
					ctx.lineTo(px - h * Math.cos(ang + 0.5), py - h * Math.sin(ang + 0.5));
					ctx.closePath(); ctx.fill();
					next += spacing;
				}
				gdist += segLen;
			}
		};
		function midOfProj(proj) {
			var best = proj[0], bestLen = -1;
			for (var i = 0; i < proj.length; i++) {
				var pts = proj[i], len = 0;
				for (var j = 1; j < pts.length; j++) { len += hyp(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y); }
				if (len > bestLen) { bestLen = len; best = pts; }
			}
			return best[Math.floor(best.length / 2)];
		}

		// --- animation (flow dashes) ----------------------------------------
		MapEngine.prototype._maybeAnim = function () {
			var need = false;
			for (var i = 0; i < this.layers.length; i++) { if (this.layers[i].visible && this.layers[i].dashAnimate) { need = true; break; } }
			if (need && !this._animOn) { this._animOn = true; this._animStep(); }
			else if (!need) { this._animOn = false; }
		};
		MapEngine.prototype._animStep = function () {
			if (!this._animOn) { this._animId = null; return; }
			this._dashOffset -= 0.9;
			this._draw();
			var self = this;
			this._animId = (window.requestAnimationFrame || function (f) { return setTimeout(f, 33); })(function () { self._animStep(); });
		};

		// --- hit testing -----------------------------------------------------
		MapEngine.prototype.featureAt = function (px, py, tol) {
			tol = tol || 7;
			var o = this._origin(), best = null;
			for (var li = this.layers.length - 1; li >= 0; li--) {
				var layer = this.layers[li];
				if (!layer.visible || layer.type === "heatmap") { continue; }
				var fs = layer.features || [], pointy = (layer.type === "point" || layer.type === "marker" || layer.type === "bubble"), bestD = tol, lb = null;
				for (var fi = 0; fi < fs.length; fi++) {
					var f = fs[fi], d;
					if (pointy) {
						if (!f.anchor) { continue; }
						var sp = this.project(f.anchor[0], f.anchor[1], o), rad = (layer.type === "bubble") ? this._bubbleR(layer, f) : (layer.pointRadius || 7);
						d = hyp(px - sp.x, py - sp.y) - rad;          // inside the symbol -> negative
					} else { d = this._distToFeature(f, px, py, o); }
					if (d < bestD) { bestD = d; lb = { layer: layer, feature: f, dist: d }; }
				}
				if (lb) { return lb; }
			}
			return best;
		};
		MapEngine.prototype._distToFeature = function (f, px, py, o) {
			var min = Infinity, i, j, a, b, d;
			for (i = 0; i < f.lines.length; i++) {
				var line = f.lines[i];
				for (j = 0; j < line.length - 1; j++) { a = this.project(line[j][0], line[j][1], o); b = this.project(line[j + 1][0], line[j + 1][1], o); d = segDist(px, py, a.x, a.y, b.x, b.y); if (d < min) { min = d; } }
			}
			for (i = 0; i < f.points.length; i++) { a = this.project(f.points[i][0], f.points[i][1], o); d = hyp(px - a.x, py - a.y); if (d < min) { min = d; } }
			return min;
		};
		function segDist(px, py, x1, y1, x2, y2) {
			var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
			if (l2 === 0) { return hyp(px - x1, py - y1); }
			var t = ((px - x1) * dx + (py - y1) * dy) / l2; t = t < 0 ? 0 : (t > 1 ? 1 : t);
			return hyp(px - (x1 + t * dx), py - (y1 + t * dy));
		}

		// --- events ----------------------------------------------------------
		MapEngine.prototype.on = function (type, cb) { if (this.listeners[type]) { this.listeners[type].push(cb); } return this; };
		MapEngine.prototype._emit = function (type, arg) { var ls = this.listeners[type] || []; for (var i = 0; i < ls.length; i++) { try { ls[i](arg); } catch (e) { } } };
		MapEngine.prototype._setHover = function (hit, p) {
			var key = hit ? (hit.layer.id + "::" + hit.feature.id) : null;
			if (key !== this._hoverKey) {
				this._hoverKey = key;
				this._hover = hit ? { layerId: hit.layer.id, featureId: hit.feature.id } : null;
				this.canvas.style.cursor = hit ? "pointer" : "grab";
				if (this.hoverEmphasis) { this.scheduleRender(); }
				this._emit("hover", hit ? { layer: hit.layer, feature: hit.feature, x: p.x, y: p.y } : null);
			} else if (hit) { this._emit("hover", { layer: hit.layer, feature: hit.feature, x: p.x, y: p.y, moveOnly: true }); }
		};

		MapEngine.prototype._bindEvents = function () {
			var self = this, cv = this.canvas;
			var dragging = false, moved = false, boxing = false, lastX = 0, lastY = 0, bsX = 0, bsY = 0;
			function localXY(e) { var r = cv.getBoundingClientRect(); var t = (e.touches && e.touches[0]) || e; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
			function down(e) {
				var p = localXY(e);
				if (e.shiftKey) { boxing = true; bsX = p.x; bsY = p.y; self.boxDiv.style.display = ""; self.boxDiv.style.left = p.x + "px"; self.boxDiv.style.top = p.y + "px"; self.boxDiv.style.width = "0px"; self.boxDiv.style.height = "0px"; return; }
				dragging = true; moved = false; lastX = p.x; lastY = p.y; cv.style.cursor = "grabbing";
			}
			function move(e) {
				var p = localXY(e);
				if (boxing) { self.boxDiv.style.left = Math.min(bsX, p.x) + "px"; self.boxDiv.style.top = Math.min(bsY, p.y) + "px"; self.boxDiv.style.width = Math.abs(p.x - bsX) + "px"; self.boxDiv.style.height = Math.abs(p.y - bsY) + "px"; return; }
				if (dragging) { var dx = p.x - lastX, dy = p.y - lastY; if (Math.abs(dx) + Math.abs(dy) > 2) { moved = true; } lastX = p.x; lastY = p.y; self._panByPixels(dx, dy); }
				else { self._setHover(self.featureAt(p.x, p.y), p); }
			}
			function up(e) {
				if (boxing) {
					boxing = false; self.boxDiv.style.display = "none";
					var p = localXY(e), a = self.unproject(Math.min(bsX, p.x), Math.min(bsY, p.y)), b = self.unproject(Math.max(bsX, p.x), Math.max(bsY, p.y));
					if (Math.abs(p.x - bsX) > 6 && Math.abs(p.y - bsY) > 6) { self.fitBounds([Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)], 0); self._emit("box", null); }
					return;
				}
				if (dragging && !moved) { var q = localXY(e); self._emit("click", wrapHit(self.featureAt(q.x, q.y), q)); }
				dragging = false; cv.style.cursor = "grab";
			}
			function wrapHit(hit, p) { return hit ? { layer: hit.layer, feature: hit.feature, x: p.x, y: p.y } : null; }

			cv.addEventListener("mousedown", down);
			window.addEventListener("mousemove", move);
			window.addEventListener("mouseup", up);
			cv.addEventListener("mousemove", move);
			cv.addEventListener("mouseleave", function () { if (!dragging && self._hoverKey) { self._hoverKey = null; self._hover = null; if (self.hoverEmphasis) { self.scheduleRender(); } self._emit("hover", null); } });
			cv.addEventListener("touchstart", function (e) { down(e); }, { passive: true });
			cv.addEventListener("touchmove", function (e) { move(e); if (dragging) { e.preventDefault(); } }, { passive: false });
			cv.addEventListener("touchend", function () { dragging = false; });
			cv.addEventListener("wheel", function (e) { e.preventDefault(); var p = localXY(e); self._zoomAround(p.x, p.y, e.deltaY < 0 ? 1 : -1); }, { passive: false });
			cv.addEventListener("dblclick", function (e) { var p = localXY(e); self._emit("dblclick", wrapHit(self.featureAt(p.x, p.y), p)); self._zoomAround(p.x, p.y, 1); });
			cv.addEventListener("keydown", function (e) {
				var k = e.keyCode, step = 80;
				if (k === 37) { self._panByPixels(step, 0); } else if (k === 39) { self._panByPixels(-step, 0); }
				else if (k === 38) { self._panByPixels(0, step); } else if (k === 40) { self._panByPixels(0, -step); }
				else if (k === 187 || k === 107) { self.zoomIn(); } else if (k === 189 || k === 109) { self.zoomOut(); }
				else { return; }
				e.preventDefault();
			});
			this._teardown = function () { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
		};

		MapEngine.prototype._panByPixels = function (dx, dy) {
			var o = this._origin();
			this.center.lng = worldXToLng(lngToWorldX(this.center.lng, o.scale) - dx, o.scale);
			this.center.lat = worldYToLat(latToWorldY(this.center.lat, o.scale) - dy, o.scale);
			this.scheduleRender(); this._emit("move", null); this._emit("viewchange", this.getView());
		};
		MapEngine.prototype._zoomAround = function (px, py, delta) {
			var nz = this._clampZoom(this.zoom + delta);
			if (nz === this.zoom) { return; }
			var before = this.unproject(px, py);
			this.zoom = nz;
			var target = this.project(before.lng, before.lat, this._origin());
			this._panByPixels(target.x - px, target.y - py);
		};
		MapEngine.prototype.zoomIn = function () { this._zoomAround(this.cssW / 2, this.cssH / 2, 1); };
		MapEngine.prototype.zoomOut = function () { this._zoomAround(this.cssW / 2, this.cssH / 2, -1); };

		// --- PNG snapshot (vectors + background; tiles skipped to avoid taint)
		MapEngine.prototype.snapshot = function () {
			try {
				var c = document.createElement("canvas"); c.width = this.canvas.width; c.height = this.canvas.height;
				var tctx = c.getContext("2d"), realCtx = this.ctx, realTile = this.tile;
				this.ctx = tctx; this.tile = null;
				tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
				tctx.fillStyle = this.bg; tctx.fillRect(0, 0, this.cssW, this.cssH);
				this._drawLayers(tctx);
				this.ctx = realCtx; this.tile = realTile;
				return c.toDataURL("image/png");
			} catch (e) { return null; }
		};

		MapEngine.prototype.destroy = function () {
			this._animOn = false;
			if (this._teardown) { this._teardown(); }
			if (this.canvas && this.canvas.parentNode) { this.canvas.parentNode.removeChild(this.canvas); }
			if (this.boxDiv && this.boxDiv.parentNode) { this.boxDiv.parentNode.removeChild(this.boxDiv); }
		};

		return {
			MapEngine: MapEngine,
			rampColor: rampColor, rampStops: rampStops, RAMPS: RAMPS,
			categoryColor: categoryColor, CATPAL: CATPAL, BASEMAPS: BASEMAPS,
			classify: classify, classIndex: classIndex, quantile: quantile, sortedValues: sortedValues,
			metersPerPixel: metersPerPixel,
			normalizeGeoJson: normalizeGeoJson,
			parseNetwork: parseNetwork, detectFormat: detectFormat,
			kmlToGeoJson: kmlToGeoJson, gpxToGeoJson: gpxToGeoJson,
			topojsonToGeoJson: topojsonToGeoJson, plainJsonToGeoJson: plainJsonToGeoJson
		};
	})();
}
