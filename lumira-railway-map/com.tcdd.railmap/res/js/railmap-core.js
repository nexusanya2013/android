// ============================================================================
//  TCDD Railway Map - core engine  (loaded before component.js)
//  ---------------------------------------------------------------------------
//  A small, dependency-free, Canvas based "slippy map":
//    * Web Mercator (EPSG:3857) projection, pan + zoom (mouse / wheel / touch)
//    * optional XYZ raster tile basemap (browser fetches tiles; degrades to a
//      plain background colour when no tile URL is configured -> works offline)
//    * any number of GeoJSON vector layers (LineString / MultiLineString /
//      Polygon / Point), each independently styleable and toggleable
//    * per-segment colouring via colour ramps (for measure distribution)
//    * hit testing (hover + click) returning the nearest feature
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
			gray:    ["#f0f0f0", "#969696", "#252525"]
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
		// t in [0,1] -> interpolated colour across the ramp's stops
		function rampColor(name, t) {
			var stops = RAMPS[("" + name).toLowerCase()] || RAMPS.blue;
			if (t == null || isNaN(t)) { return stops[0]; }
			t = t < 0 ? 0 : (t > 1 ? 1 : t);
			if (stops.length === 1) { return stops[0]; }
			var seg = t * (stops.length - 1);
			var i = Math.floor(seg);
			if (i >= stops.length - 1) { return stops[stops.length - 1]; }
			var f = seg - i, a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
			return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
		}
		function rampStops(name) { return RAMPS[("" + name).toLowerCase()] || RAMPS.blue; }

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
		// Returns an array of feature objects: {id, name, props, lines:[[ [lng,lat] ]], points:[[lng,lat]], bbox:[minLng,minLat,maxLng,maxLat]}
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
				var feat = {
					id: (id == null ? null : "" + id),
					name: (nameProp && props[nameProp] != null) ? ("" + props[nameProp]) : null,
					props: props, lines: lines, points: points, bbox: bboxOf(lines, points)
				};
				out.push(feat);
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
			var b = [Infinity, Infinity, -Infinity, -Infinity], i, j, p;
			for (i = 0; i < lines.length; i++) { for (j = 0; j < lines[i].length; j++) { p = lines[i][j]; ext(b, p); } }
			for (i = 0; i < points.length; i++) { ext(b, points[i]); }
			return b;
		}
		function ext(b, p) {
			if (!p || p.length < 2) { return; }
			if (p[0] < b[0]) { b[0] = p[0]; } if (p[1] < b[1]) { b[1] = p[1]; }
			if (p[0] > b[2]) { b[2] = p[0]; } if (p[1] > b[3]) { b[3] = p[1]; }
		}

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
			this.tile = null;            // {url, subs:[], opacity}
			this.tileCache = {};
			this.layers = [];            // bottom -> top
			this.listeners = { click: [], hover: [], move: [] };
			this.selected = null;        // {layerId, featureId}
			this._raf = null;
			this._hoverKey = null;
			this._build();
		}

		MapEngine.prototype._build = function () {
			var c = this.container;
			c.style.position = c.style.position || "relative";
			c.style.overflow = "hidden";
			var cv = document.createElement("canvas");
			cv.style.position = "absolute";
			cv.style.left = "0px"; cv.style.top = "0px";
			cv.style.cursor = "grab";
			cv.style.outline = "none";
			c.appendChild(cv);
			this.canvas = cv;
			this.ctx = cv.getContext("2d");
			this._bindEvents();
			this.resize();
		};

		MapEngine.prototype.resize = function () {
			var w = this.container.clientWidth || 600, h = this.container.clientHeight || 400;
			var dpr = window.devicePixelRatio || 1;
			this.cssW = w; this.cssH = h; this.dpr = dpr;
			this.canvas.width = Math.round(w * dpr);
			this.canvas.height = Math.round(h * dpr);
			this.canvas.style.width = w + "px";
			this.canvas.style.height = h + "px";
			this.scheduleRender();
		};

		// --- view -----------------------------------------------------------
		MapEngine.prototype.setView = function (lat, lng, zoom) {
			if (lat != null) { this.center.lat = lat; }
			if (lng != null) { this.center.lng = lng; }
			if (zoom != null) { this.zoom = this._clampZoom(zoom); }
			this.scheduleRender();
		};
		MapEngine.prototype._clampZoom = function (z) { return Math.max(this.minZoom, Math.min(this.maxZoom, Math.round(z))); };
		MapEngine.prototype.setBackground = function (color) { this.bg = color || "#eef2f5"; this.scheduleRender(); };
		MapEngine.prototype.setTile = function (url, subs, opacity) {
			if (!url) { this.tile = null; }
			else { this.tile = { url: url, subs: (subs && subs.length) ? subs : ["a", "b", "c"], opacity: (opacity == null ? 1 : opacity) }; }
			this.tileCache = {};
			this.scheduleRender();
		};

		// --- layers ----------------------------------------------------------
		// layer = {id, title, features:[...], visible, styleFn(feature)->{color,weight,opacity}, weight, color, dashed}
		MapEngine.prototype.addLayer = function (layer) {
			layer.visible = layer.visible !== false;
			this.layers.push(layer);
			this.scheduleRender();
			return layer;
		};
		MapEngine.prototype.clearLayers = function () { this.layers = []; this.selected = null; this.scheduleRender(); };
		MapEngine.prototype.getLayer = function (id) { for (var i = 0; i < this.layers.length; i++) { if (this.layers[i].id === id) { return this.layers[i]; } } return null; };
		MapEngine.prototype.setLayerVisible = function (id, vis) { var l = this.getLayer(id); if (l) { l.visible = !!vis; this.scheduleRender(); } };

		MapEngine.prototype.setSelected = function (layerId, featureId) {
			this.selected = (featureId == null) ? null : { layerId: layerId, featureId: "" + featureId };
			this.scheduleRender();
		};

		MapEngine.prototype.allBounds = function () {
			var b = [Infinity, Infinity, -Infinity, -Infinity], i, j, fb;
			for (i = 0; i < this.layers.length; i++) {
				var fs = this.layers[i].features || [];
				for (j = 0; j < fs.length; j++) {
					fb = fs[j].bbox;
					if (fb[0] < b[0]) { b[0] = fb[0]; } if (fb[1] < b[1]) { b[1] = fb[1]; }
					if (fb[2] > b[2]) { b[2] = fb[2]; } if (fb[3] > b[3]) { b[3] = fb[3]; }
				}
			}
			return isFinite(b[0]) ? b : null;
		};

		MapEngine.prototype.fitBounds = function (b, padding) {
			if (!b || !isFinite(b[0])) { return; }
			padding = padding == null ? 24 : padding;
			var w = Math.max(1, this.cssW - 2 * padding), h = Math.max(1, this.cssH - 2 * padding);
			var best = this.minZoom;
			for (var z = this.maxZoom; z >= this.minZoom; z--) {
				var scale = TILE * Math.pow(2, z);
				var x0 = lngToWorldX(b[0], scale), x1 = lngToWorldX(b[2], scale);
				var y0 = latToWorldY(b[3], scale), y1 = latToWorldY(b[1], scale);
				if (Math.abs(x1 - x0) <= w && Math.abs(y1 - y0) <= h) { best = z; break; }
			}
			this.zoom = this._clampZoom(best);
			this.center.lng = (b[0] + b[2]) / 2;
			this.center.lat = (b[1] + b[3]) / 2;
			this.scheduleRender();
		};

		// --- projection helpers (current view) -------------------------------
		MapEngine.prototype._origin = function () {
			var scale = TILE * Math.pow(2, this.zoom);
			return {
				scale: scale,
				ox: lngToWorldX(this.center.lng, scale) - this.cssW / 2,
				oy: latToWorldY(this.center.lat, scale) - this.cssH / 2
			};
		};
		MapEngine.prototype.project = function (lng, lat, o) {
			o = o || this._origin();
			return { x: lngToWorldX(lng, o.scale) - o.ox, y: latToWorldY(lat, o.scale) - o.oy };
		};
		MapEngine.prototype.unproject = function (x, y) {
			var o = this._origin();
			return { lng: worldXToLng(x + o.ox, o.scale), lat: worldYToLat(y + o.oy, o.scale) };
		};

		// --- render ----------------------------------------------------------
		MapEngine.prototype.scheduleRender = function () {
			if (this._raf) { return; }
			var self = this;
			this._raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
				self._raf = null; self._draw();
			});
		};

		MapEngine.prototype._draw = function () {
			var ctx = this.ctx;
			ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
			ctx.clearRect(0, 0, this.cssW, this.cssH);
			ctx.fillStyle = this.bg;
			ctx.fillRect(0, 0, this.cssW, this.cssH);
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
					var wx = ((tx % n) + n) % n;
					var url = this._tileUrl(wx, ty, z);
					var img = this._tileImage(url);
					var sx = tx * TILE - o.ox, sy = ty * TILE - o.oy;
					if (img && img.complete && img.naturalWidth) {
						ctx.drawImage(img, Math.round(sx), Math.round(sy), TILE, TILE);
					}
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
			img = new Image();
			img.crossOrigin = "anonymous";
			var self = this;
			img.onload = function () { self.scheduleRender(); };
			img.onerror = function () { img._failed = true; };
			img.src = url;
			this.tileCache[url] = img;
			return img;
		};

		MapEngine.prototype._drawLayers = function (ctx) {
			var o = this._origin();
			var viewMinLng = worldXToLng(o.ox, o.scale), viewMaxLng = worldXToLng(o.ox + this.cssW, o.scale);
			var viewMaxLat = worldYToLat(o.oy, o.scale), viewMinLat = worldYToLat(o.oy + this.cssH, o.scale);
			ctx.lineJoin = "round"; ctx.lineCap = "round";
			for (var li = 0; li < this.layers.length; li++) {
				var layer = this.layers[li];
				if (!layer.visible) { continue; }
				var fs = layer.features || [];
				for (var fi = 0; fi < fs.length; fi++) {
					var f = fs[fi];
					var bb = f.bbox;
					if (bb[2] < viewMinLng || bb[0] > viewMaxLng || bb[3] < viewMinLat || bb[1] > viewMaxLat) { continue; }
					var st = layer.styleFn ? layer.styleFn(f) : null;
					if (st === false) { continue; }
					st = st || {};
					var sel = this.selected && this.selected.layerId === layer.id && this.selected.featureId === f.id;
					var color = sel && layer.highlightColor ? layer.highlightColor : (st.color || layer.color || "#5a6b7b");
					var weight = (sel ? (st.weight || layer.weight || 3) + 2 : (st.weight || layer.weight || 3));
					ctx.globalAlpha = st.opacity != null ? st.opacity : 1;
					ctx.strokeStyle = color;
					ctx.lineWidth = weight;
					if (st.dashed || layer.dashed) { if (ctx.setLineDash) { ctx.setLineDash([6, 5]); } } else if (ctx.setLineDash) { ctx.setLineDash([]); }
					this._strokeFeature(ctx, f, o);
					// points
					if (f.points.length) {
						ctx.fillStyle = color;
						for (var pi = 0; pi < f.points.length; pi++) {
							var pp = this.project(f.points[pi][0], f.points[pi][1], o);
							ctx.beginPath(); ctx.arc(pp.x, pp.y, Math.max(3, weight), 0, 2 * Math.PI); ctx.fill();
						}
					}
				}
			}
			ctx.globalAlpha = 1;
			if (ctx.setLineDash) { ctx.setLineDash([]); }
		};
		MapEngine.prototype._strokeFeature = function (ctx, f, o) {
			for (var i = 0; i < f.lines.length; i++) {
				var line = f.lines[i];
				if (line.length < 2) { continue; }
				ctx.beginPath();
				var p = this.project(line[0][0], line[0][1], o);
				ctx.moveTo(p.x, p.y);
				for (var j = 1; j < line.length; j++) { p = this.project(line[j][0], line[j][1], o); ctx.lineTo(p.x, p.y); }
				ctx.stroke();
			}
		};

		// --- hit testing -----------------------------------------------------
		MapEngine.prototype.featureAt = function (px, py, tol) {
			tol = tol || 7;
			var o = this._origin(), best = null, bestD = tol;
			for (var li = this.layers.length - 1; li >= 0; li--) {       // top -> bottom
				var layer = this.layers[li];
				if (!layer.visible) { continue; }
				var fs = layer.features || [];
				for (var fi = 0; fi < fs.length; fi++) {
					var f = fs[fi], d = this._distToFeature(f, px, py, o);
					if (d < bestD) { bestD = d; best = { layer: layer, feature: f, dist: d }; }
				}
				if (best) { return best; }                                // first hit on topmost layer wins
			}
			return best;
		};
		MapEngine.prototype._distToFeature = function (f, px, py, o) {
			var min = Infinity, i, j, a, b, d;
			for (i = 0; i < f.lines.length; i++) {
				var line = f.lines[i];
				for (j = 0; j < line.length - 1; j++) {
					a = this.project(line[j][0], line[j][1], o);
					b = this.project(line[j + 1][0], line[j + 1][1], o);
					d = segDist(px, py, a.x, a.y, b.x, b.y);
					if (d < min) { min = d; }
				}
			}
			for (i = 0; i < f.points.length; i++) { a = this.project(f.points[i][0], f.points[i][1], o); d = Math.sqrt((px - a.x) * (px - a.x) + (py - a.y) * (py - a.y)); if (d < min) { min = d; } }
			return min;
		};
		function segDist(px, py, x1, y1, x2, y2) {
			var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
			if (l2 === 0) { return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1)); }
			var t = ((px - x1) * dx + (py - y1) * dy) / l2;
			t = t < 0 ? 0 : (t > 1 ? 1 : t);
			var qx = x1 + t * dx, qy = y1 + t * dy;
			return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
		}

		// --- events ----------------------------------------------------------
		MapEngine.prototype.on = function (type, cb) { if (this.listeners[type]) { this.listeners[type].push(cb); } return this; };
		MapEngine.prototype._emit = function (type, arg) { var ls = this.listeners[type] || []; for (var i = 0; i < ls.length; i++) { try { ls[i](arg); } catch (e) { } } };

		MapEngine.prototype._bindEvents = function () {
			var self = this, cv = this.canvas;
			var dragging = false, moved = false, lastX = 0, lastY = 0;

			function localXY(e) {
				var r = cv.getBoundingClientRect();
				var t = (e.touches && e.touches[0]) || e;
				return { x: t.clientX - r.left, y: t.clientY - r.top };
			}
			function down(e) {
				var p = localXY(e); dragging = true; moved = false; lastX = p.x; lastY = p.y; cv.style.cursor = "grabbing";
			}
			function move(e) {
				var p = localXY(e);
				if (dragging) {
					var dx = p.x - lastX, dy = p.y - lastY;
					if (Math.abs(dx) + Math.abs(dy) > 2) { moved = true; }
					lastX = p.x; lastY = p.y;
					self._panByPixels(dx, dy);
				} else {
					var hit = self.featureAt(p.x, p.y);
					var key = hit ? (hit.layer.id + "::" + hit.feature.id) : null;
					if (key !== self._hoverKey) {
						self._hoverKey = key;
						cv.style.cursor = hit ? "pointer" : "grab";
						self._emit("hover", hit ? { layer: hit.layer, feature: hit.feature, x: p.x, y: p.y } : null);
					} else if (hit) {
						self._emit("hover", { layer: hit.layer, feature: hit.feature, x: p.x, y: p.y, moveOnly: true });
					}
				}
			}
			function up(e) {
				if (dragging && !moved) {
					var p = localXY(e), hit = self.featureAt(p.x, p.y);
					self._emit("click", hit ? { layer: hit.layer, feature: hit.feature, x: p.x, y: p.y } : null);
				}
				dragging = false; cv.style.cursor = "grab";
			}

			cv.addEventListener("mousedown", down);
			window.addEventListener("mousemove", move);
			window.addEventListener("mouseup", up);
			cv.addEventListener("mousemove", move);
			cv.addEventListener("mouseleave", function () { if (!dragging && self._hoverKey) { self._hoverKey = null; self._emit("hover", null); } });

			cv.addEventListener("touchstart", function (e) { down(e); }, { passive: true });
			cv.addEventListener("touchmove", function (e) { move(e); if (dragging) { e.preventDefault(); } }, { passive: false });
			cv.addEventListener("touchend", function (e) { dragging = false; });

			cv.addEventListener("wheel", function (e) {
				e.preventDefault();
				var p = localXY(e);
				self._zoomAround(p.x, p.y, e.deltaY < 0 ? 1 : -1);
			}, { passive: false });
			cv.addEventListener("dblclick", function (e) { var p = localXY(e); self._zoomAround(p.x, p.y, 1); });

			this._teardown = function () {
				window.removeEventListener("mousemove", move);
				window.removeEventListener("mouseup", up);
			};
		};

		MapEngine.prototype._panByPixels = function (dx, dy) {
			var o = this._origin();
			var cx = lngToWorldX(this.center.lng, o.scale) - dx;
			var cy = latToWorldY(this.center.lat, o.scale) - dy;
			this.center.lng = worldXToLng(cx, o.scale);
			this.center.lat = worldYToLat(cy, o.scale);
			this.scheduleRender();
			this._emit("move", null);
		};
		MapEngine.prototype._zoomAround = function (px, py, delta) {
			var nz = this._clampZoom(this.zoom + delta);
			if (nz === this.zoom) { return; }
			var before = this.unproject(px, py);
			this.zoom = nz;
			var o = this._origin();
			// keep the point under the cursor stable
			var target = this.project(before.lng, before.lat, o);
			this._panByPixels(target.x - px, target.y - py);
			this._emit("move", null);
		};
		MapEngine.prototype.zoomIn = function () { this._zoomAround(this.cssW / 2, this.cssH / 2, 1); };
		MapEngine.prototype.zoomOut = function () { this._zoomAround(this.cssW / 2, this.cssH / 2, -1); };

		MapEngine.prototype.destroy = function () {
			if (this._teardown) { this._teardown(); }
			if (this.canvas && this.canvas.parentNode) { this.canvas.parentNode.removeChild(this.canvas); }
		};

		return {
			MapEngine: MapEngine,
			rampColor: rampColor,
			rampStops: rampStops,
			RAMPS: RAMPS,
			normalizeGeoJson: normalizeGeoJson
		};
	})();
}
