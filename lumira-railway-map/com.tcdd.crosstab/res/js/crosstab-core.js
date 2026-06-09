// ============================================================================
//  TCDD Crosstab Grid - core engine  (loaded before component.js)
//  ---------------------------------------------------------------------------
//  Dependency-free helpers for a modern data grid / crosstab:
//    * normalize(metadata, resultCellList, opts) -> {rowDimTitles, columns, rows}
//      from the verified Design Studio data model
//      (meta.dimensions[d]={key,text,containsMeasures,members:[{key,text}]},
//       ds.tuples[i][d]=member index, ds.data[i]=value)
//    * number formatting, colour ramps + class breaks, contrast
//    * inline SVG builders: sparkline (line/area/bar) and pie/donut
//  ES5 / IE10+ safe. No external library.
// ============================================================================
if (!window.TCDDGrid) {
	window.TCDDGrid = (function () {

		// ---- colour ramps ----------------------------------------------------
		var RAMPS = {
			traffic: ["#1a9850", "#fee08b", "#d73027"], rdylgn: ["#d73027", "#fee08b", "#1a9850"],
			blue: ["#deebf7", "#3182bd", "#08306b"], green: ["#e5f5e0", "#74c476", "#00441b"],
			heat: ["#ffffb2", "#fd8d3c", "#bd0026"], purple: ["#efedf5", "#9e9ac8", "#54278f"],
			viridis: ["#440154", "#21908d", "#fde725"], cool: ["#2c7fb8", "#7fcdbb", "#edf8b1"],
			redblue: ["#d7301f", "#f7f7f7", "#2166ac"], gray: ["#f0f0f0", "#969696", "#252525"]
		};
		var CATPAL = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab"];
		function hexToRgb(h) { h = ("" + h).replace("#", ""); if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); } return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
		function rgbToHex(r, g, b) { function hx(x) { x = Math.max(0, Math.min(255, Math.round(x))); var t = x.toString(16); return t.length < 2 ? "0" + t : t; } return "#" + hx(r) + hx(g) + hx(b); }
		function rampColor(name, t) {
			var s = RAMPS[("" + name).toLowerCase()] || RAMPS.blue;
			if (t == null || isNaN(t)) { return s[0]; } t = t < 0 ? 0 : (t > 1 ? 1 : t);
			if (s.length === 1) { return s[0]; }
			var seg = t * (s.length - 1), i = Math.floor(seg); if (i >= s.length - 1) { return s[s.length - 1]; }
			var f = seg - i, a = hexToRgb(s[i]), b = hexToRgb(s[i + 1]);
			return rgbToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
		}
		function categoryColor(i) { return CATPAL[((i % CATPAL.length) + CATPAL.length) % CATPAL.length]; }
		function contrast(hex) { try { var c = hexToRgb(hex); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 150 ? "#10212e" : "#f4f9fd"; } catch (e) { return "#10212e"; } }

		// ---- number formatting ----------------------------------------------
		function isNum(v) { return v != null && v !== "" && !isNaN(parseFloat(v)) && isFinite(v); }
		function fmt(v, o) {
			o = o || {};
			if (v == null || v === "") { return o.nullText != null ? o.nullText : ""; }
			if (typeof v === "string" && !isNum(v)) { return v; }            // e.g. "DIF0"
			var n = Number(v), d = (o.decimals == null ? -1 : o.decimals), s;
			if (o.compact && Math.abs(n) >= 1000) {
				var a = Math.abs(n);
				if (a >= 1e9) { s = (n / 1e9).toFixed(1) + " Mr"; } else if (a >= 1e6) { s = (n / 1e6).toFixed(1) + " M"; } else { s = (n / 1e3).toFixed(1) + " B"; }
				return s + (o.unit ? " " + o.unit : "");
			}
			if (d >= 0) { s = n.toFixed(d); } else { s = "" + (Math.round(n * 100) / 100); }
			if (o.thousandSep) { var p = s.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "."); s = (d >= 0) ? p.join(",") : p.join("."); }
			return s + (o.unit ? " " + o.unit : "");
		}

		// ---- classification (for legends / breaks) ---------------------------
		function stats(vals) { var mn = Infinity, mx = -Infinity, sum = 0, c = 0; for (var i = 0; i < vals.length; i++) { var v = vals[i]; if (isNum(v)) { v = +v; if (v < mn) { mn = v; } if (v > mx) { mx = v; } sum += v; c++; } } return { min: isFinite(mn) ? mn : 0, max: isFinite(mx) ? mx : 1, sum: sum, avg: c ? sum / c : 0, count: c }; }

		// ---- inline SVG: sparkline -------------------------------------------
		function sparkSVG(vals, o) {
			o = o || {}; var w = o.w || 86, h = o.h || 24, pad = 2, type = (o.type || "line").toLowerCase(), col = o.color || "#37a3d6";
			var pts = []; for (var i = 0; i < vals.length; i++) { if (isNum(vals[i])) { pts.push(+vals[i]); } else { pts.push(null); } }
			var nums = pts.filter(function (x) { return x != null; }); if (nums.length < 1) { return ""; }
			var mn = Math.min.apply(null, nums), mx = Math.max.apply(null, nums), rng = (mx - mn) || 1;
			var n = pts.length, dx = n > 1 ? (w - 2 * pad) / (n - 1) : 0;
			function X(i) { return pad + i * dx; } function Y(v) { return h - pad - (v - mn) / rng * (h - 2 * pad); }
			var svg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block">';
			if (type === "bar") {
				var bw = Math.max(1, dx * 0.7);
				for (i = 0; i < n; i++) { if (pts[i] == null) { continue; } var yv = Y(pts[i]); svg += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + yv.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (h - pad - yv).toFixed(1) + '" rx="1" fill="' + col + '"/>'; }
			} else {
				var d = "", started = false;
				for (i = 0; i < n; i++) { if (pts[i] == null) { continue; } d += (started ? "L" : "M") + X(i).toFixed(1) + "," + Y(pts[i]).toFixed(1) + " "; started = true; }
				if (type === "area") { var last = -1; for (i = n - 1; i >= 0; i--) { if (pts[i] != null) { last = i; break; } } var first = -1; for (i = 0; i < n; i++) { if (pts[i] != null) { first = i; break; } } if (first >= 0) { var ad = d + "L" + X(last).toFixed(1) + "," + (h - pad) + " L" + X(first).toFixed(1) + "," + (h - pad) + " Z"; svg += '<path d="' + ad + '" fill="' + col + '" fill-opacity="0.18"/>'; } }
				svg += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6"/>';
				var li = -1; for (i = n - 1; i >= 0; i--) { if (pts[i] != null) { li = i; break; } } if (li >= 0) { svg += '<circle cx="' + X(li).toFixed(1) + '" cy="' + Y(pts[li]).toFixed(1) + '" r="2" fill="' + col + '"/>'; }
			}
			return svg + '</svg>';
		}

		// ---- inline SVG: pie / donut -----------------------------------------
		function arc(cx, cy, r, a0, a1) { var s = pol(cx, cy, r, a1), e = pol(cx, cy, r, a0), big = (a1 - a0) % (2 * Math.PI) > Math.PI ? 1 : 0; return "M" + s.x.toFixed(2) + " " + s.y.toFixed(2) + " A" + r + " " + r + " 0 " + big + " 0 " + e.x.toFixed(2) + " " + e.y.toFixed(2); }
		function pol(cx, cy, r, a) { return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; }
		function donutSVG(vals, o) {
			o = o || {}; var w = o.w || 26, h = o.h || 26, type = (o.type || "donut").toLowerCase();
			var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 1, ir = type === "pie" ? 0 : R * 0.58;
			var tot = 0, i; for (i = 0; i < vals.length; i++) { if (isNum(vals[i]) && +vals[i] > 0) { tot += +vals[i]; } }
			if (tot <= 0) { return ""; }
			var svg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block">', a0 = -Math.PI / 2;
			for (i = 0; i < vals.length; i++) {
				var v = isNum(vals[i]) ? +vals[i] : 0; if (v <= 0) { continue; }
				var a1 = a0 + (v / tot) * 2 * Math.PI, col = (o.colors && o.colors[i]) || categoryColor(i);
				if (a1 - a0 >= 2 * Math.PI - 1e-6) { svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + col + '"/>'; }
				else {
					var o1 = pol(cx, cy, R, a0), o2 = pol(cx, cy, R, a1), big = (a1 - a0) > Math.PI ? 1 : 0;
					var p = "M" + o1.x.toFixed(2) + " " + o1.y.toFixed(2) + " A" + R + " " + R + " 0 " + big + " 1 " + o2.x.toFixed(2) + " " + o2.y.toFixed(2);
					if (ir > 0) { var i2 = pol(cx, cy, ir, a1), i1 = pol(cx, cy, ir, a0); p += " L" + i2.x.toFixed(2) + " " + i2.y.toFixed(2) + " A" + ir + " " + ir + " 0 " + big + " 0 " + i1.x.toFixed(2) + " " + i1.y.toFixed(2) + " Z"; }
					else { p += " L" + cx + " " + cy + " Z"; }
					svg += '<path d="' + p + '" fill="' + col + '"/>';
				}
				a0 = a1;
			}
			return svg + '</svg>';
		}

		// ====================================================================
		//  normalize: result set -> grid model
		//  opts: { rowDimKeys:[], columnDimKey:"", measureFilter:[] }
		// ====================================================================
		function indexOfMember(members, token) {
			for (var i = 0; i < members.length; i++) { if (("" + members[i].text) === token || ("" + members[i].key) === token) { return i; } }
			return -1;
		}
		function normalize(meta, ds, opts) {
			opts = opts || {};
			var out = { rowDimTitles: [], columns: [], rows: [] };
			if (!meta || !meta.dimensions) { return out; }
			var dims = meta.dimensions, measureDim = -1, nonMeasure = [], i;
			for (i = 0; i < dims.length; i++) { if (dims[i].containsMeasures) { measureDim = i; } else { nonMeasure.push(i); } }

			// resolve row dims & optional column dim
			var colDim = -1;
			if (opts.columnDimKey) { for (i = 0; i < dims.length; i++) { if (dims[i].key === opts.columnDimKey && !dims[i].containsMeasures) { colDim = i; } } }
			var rowDims;
			if (opts.rowDimKeys && opts.rowDimKeys.length) {
				rowDims = []; for (var r = 0; r < opts.rowDimKeys.length; r++) { for (i = 0; i < dims.length; i++) { if (dims[i].key === opts.rowDimKeys[r]) { rowDims.push(i); } } }
			} else { rowDims = []; for (i = 0; i < nonMeasure.length; i++) { if (nonMeasure[i] !== colDim) { rowDims.push(nonMeasure[i]); } } }
			for (i = 0; i < rowDims.length; i++) { out.rowDimTitles.push(dims[rowDims[i]].text || dims[rowDims[i]].key || ("Boyut " + (i + 1))); }

			// measures (filter/order)
			var measures = (measureDim >= 0) ? dims[measureDim].members : [{ text: "Değer", key: "m0" }];
			var mIdx = [];
			if (opts.measureFilter && opts.measureFilter.length) { for (var f = 0; f < opts.measureFilter.length; f++) { var k = indexOfMember(measures, opts.measureFilter[f]); if (k >= 0) { mIdx.push(k); } } }
			else { for (i = 0; i < measures.length; i++) { mIdx.push(i); } }

			// columns
			var colMembers = colDim >= 0 ? dims[colDim].members : [null];
			var colKeyMap = {};
			for (var mi = 0; mi < mIdx.length; mi++) {
				for (var ci = 0; ci < colMembers.length; ci++) {
					var mm = measures[mIdx[mi]];
					var mName = mm.text != null ? mm.text : mm.key;
					var mKey = mm.key != null ? ("" + mm.key) : mName;
					var label = colDim >= 0 ? (mIdx.length > 1 ? mName + " · " + colMembers[ci].text : colMembers[ci].text) : mName;
					var key = "c_" + mIdx[mi] + "_" + ci;
					out.columns.push({ key: key, label: label, measure: mName, measureKey: mKey, measureIdx: mIdx[mi], colIdx: colDim >= 0 ? ci : -1 });
					colKeyMap[mIdx[mi] + "|" + (colDim >= 0 ? ci : -1)] = key;
				}
			}

			// rows from tuples
			var rowMap = {}, order = [];
			var tuples = ds && ds.tuples, data = ds && ds.data;
			if (tuples && tuples.length && data) {
				for (i = 0; i < tuples.length; i++) {
					var t = tuples[i];
					var rk = [], headers = [], ok = true;
					for (var d = 0; d < rowDims.length; d++) { var mem = dims[rowDims[d]].members[t[rowDims[d]]]; if (!mem) { ok = false; break; } rk.push(t[rowDims[d]]); headers.push(mem.text != null ? mem.text : mem.key); }
					if (!ok) { continue; }
					var rowKey = rk.join("");
					if (!rowMap[rowKey]) { rowMap[rowKey] = { key: rowKey, headers: headers, cells: {} }; order.push(rowKey); }
					var measureMember = (measureDim >= 0) ? t[measureDim] : mIdx[0];
					var colMember = (colDim >= 0) ? t[colDim] : -1;
					var ck = colKeyMap[measureMember + "|" + colMember];
					if (ck != null) { rowMap[rowKey].cells[ck] = data[i]; }
				}
			} else if (data && data.length) {                                 // flat fallback
				for (i = 0; i < data.length; i++) { var key2 = "" + i; rowMap[key2] = { key: key2, headers: ["" + (i + 1)], cells: {} }; rowMap[key2].cells[out.columns[0] ? out.columns[0].key : "c0"] = data[i]; order.push(key2); }
				if (!out.rowDimTitles.length) { out.rowDimTitles = ["#"]; }
			}
			for (i = 0; i < order.length; i++) { out.rows.push(rowMap[order[i]]); }
			return out;
		}

		return {
			RAMPS: RAMPS, rampColor: rampColor, categoryColor: categoryColor, contrast: contrast,
			isNum: isNum, fmt: fmt, stats: stats, sparkSVG: sparkSVG, donutSVG: donutSVG, normalize: normalize
		};
	})();
}
