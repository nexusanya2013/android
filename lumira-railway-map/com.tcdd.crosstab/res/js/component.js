// ============================================================================
//  TCDD Crosstab Grid - SDK component
//  ---------------------------------------------------------------------------
//  A modern, dependency-free data grid / crosstab for Lumira Designer 2.4.
//  Bind a data source (dimensions in rows, measures in columns); every column
//  can render as plain value, in-cell data bar, conditional heat colour, with
//  trend arrows; add per-row sparkline (line/area/bar) and pie/donut columns;
//  sort, search, totals, CSV export, light/dark themes, number formatting.
// ============================================================================
sap.designstudio.sdk.Component.subclass("com.tcdd.crosstab.Crosstab", function () {

	var that = this, G = null;
	var cfg = {
		// data
		rowDimensions: "", columnDimension: "", measureFilter: "",
		// chrome
		title: "", subtitle: "", theme: "dark", density: "normal", zebra: true, stickyHeader: true,
		freezeFirstColumn: true, showRowNumbers: false, showToolbar: true,
		// totals
		showColumnTotals: false, totalAggregation: "sum", totalsLabel: "Toplam",
		// format
		decimals: -1, unit: "", thousandSep: true, compact: false, nullText: "—",
		// cell viz (defaults)
		cellViz: "value", heatRamp: "blue", barColor: "#37a3d6", negativeColor: "#e15759", colorScope: "column",
		thresholds: "", columnConfig: "",
		// sparkline column
		sparkColumns: "", sparkType: "line", sparkColor: "#37a3d6", sparkTitle: "Trend",
		// pie/donut column
		pieColumns: "", pieType: "donut", pieTitle: "Dağılım", pieColors: "",
		// interaction
		sortable: true, defaultSortColumn: "", defaultSortDir: "desc", searchable: true,
		selectable: true, exportable: true, pageSize: 0,
		// outputs
		selectedRow: "", selectedRowKey: "", selectedColumn: "", selectedValue: ""
	};
	var meta = null, ds = null, model = null, ui = {}, sortState = null, query = "", page = 0, selKey = null;

	function el(t, c, p) { var e = document.createElement(t); if (c) { e.className = c; } if (p) { p.appendChild(e); } return e; }
	function txt(n, s) { n.appendChild(document.createTextNode(s == null ? "" : "" + s)); return n; }
	function clear(n) { while (n && n.firstChild) { n.removeChild(n.firstChild); } }
	function csv(s) { var a = ("" + (s || "")).split(/[,;]/), o = []; for (var i = 0; i < a.length; i++) { var v = a[i].replace(/^\s+|\s+$/g, ""); if (v) { o.push(v); } } return o; }
	function jget(s) { try { var o = JSON.parse(s || "{}"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
	function jarr(s) { try { var o = JSON.parse(s || "[]"); return o instanceof Array ? o : []; } catch (e) { return []; } }

	// ===================== lifecycle =====================
	this.init = function () {
		G = window.TCDDGrid;
		injectStyle();
		var host = this.$()[0];
		ui.host = host; host.style.width = "100%"; host.style.height = "100%"; host.style.overflow = "hidden";
		ui.root = el("div", "tcx", host);
		ui.toolbar = el("div", "tcx-toolbar", ui.root);
		ui.scroll = el("div", "tcx-scroll", ui.root);
		ui.pager = el("div", "tcx-pager", ui.root);
	};
	this.afterUpdate = function () { if (!G) { return; } applyTheme(); render(); };

	function applyTheme() {
		ui.root.className = "tcx tcx-" + (cfg.theme === "light" ? "light" : "dark") + " d-" + (cfg.density || "normal");
	}

	// ===================== data =====================
	function buildModel() {
		model = G.normalize(meta, ds, { rowDimKeys: csv(cfg.rowDimensions), columnDimKey: cfg.columnDimension, measureFilter: csv(cfg.measureFilter) });
		// derive numeric stats per column + table
		var all = [];
		for (var c = 0; c < model.columns.length; c++) {
			var col = model.columns[c], vals = [];
			for (var r = 0; r < model.rows.length; r++) { vals.push(model.rows[r].cells[col.key]); all.push(model.rows[r].cells[col.key]); }
			col.stats = G.stats(vals);
		}
		model.tableStats = G.stats(all);
	}

	function resolveCol(col) {
		var cc = jget(cfg.columnConfig), o = cc[col.measure] || cc[col.label] || {};
		return {
			viz: ("" + (o.viz || cfg.cellViz)).toLowerCase(),
			ramp: o.ramp || cfg.heatRamp, barColor: o.color || o.barColor || cfg.barColor,
			decimals: o.decimals != null ? o.decimals : cfg.decimals, unit: o.unit != null ? o.unit : cfg.unit,
			thousandSep: o.thousandSep != null ? o.thousandSep : cfg.thousandSep, compact: o.compact != null ? o.compact : cfg.compact,
			align: o.align || "right", trend: ("" + (o.trend || "none")).toLowerCase(), trendGood: ("" + (o.trendGood || "up")).toLowerCase(),
			thresholds: o.thresholds || jarr(cfg.thresholds), title: o.title || col.label, scope: o.scope || cfg.colorScope
		};
	}
	function fmtOpts(rc) { return { decimals: rc.decimals, unit: rc.unit, thousandSep: rc.thousandSep, compact: rc.compact, nullText: cfg.nullText }; }

	function matchThreshold(thr, v) {
		if (!thr || !thr.length || !G.isNum(v)) { return null; }
		v = +v;
		for (var i = 0; i < thr.length; i++) {
			var t = thr[i], op = t.op || ">=", a = parseFloat(t.value), b = parseFloat(t.value2), m = false;
			if (op === ">") { m = v > a; } else if (op === ">=") { m = v >= a; } else if (op === "<") { m = v < a; }
			else if (op === "<=") { m = v <= a; } else if (op === "==") { m = v === a; } else if (op === "!=") { m = v !== a; }
			else if (op === "between") { m = v >= a && v <= b; }
			if (m) { return t; }
		}
		return null;
	}

	// baseline value for a trend arrow within a row
	function baselineFor(row, col, rc, colIndex) {
		if (rc.trend === "prev") { for (var i = colIndex - 1; i >= 0; i--) { var v = row.cells[model.columns[i].key]; if (G.isNum(v)) { return +v; } } return null; }
		if (rc.trend === "first") { for (var j = 0; j < model.columns.length; j++) { var w = row.cells[model.columns[j].key]; if (G.isNum(w)) { return +w; } } return null; }
		// trend == a measure name
		for (var k = 0; k < model.columns.length; k++) { if (model.columns[k].measure === rc.trend) { var u = row.cells[model.columns[k].key]; return G.isNum(u) ? +u : null; } }
		return null;
	}

	// ===================== render =====================
	function render() { buildModel(); initSort(); buildToolbar(); renderBody(); }
	function initSort() {
		if (sortState !== null || !cfg.defaultSortColumn) { return; }
		for (var c = 0; c < model.columns.length; c++) { if (model.columns[c].measure === cfg.defaultSortColumn || model.columns[c].label === cfg.defaultSortColumn) { sortState = { type: "col", idx: 0, key: model.columns[c].key, dir: cfg.defaultSortDir === "asc" ? "asc" : "desc" }; return; } }
	}
	function renderBody() {
		clear(ui.scroll); clear(ui.pager);
		if (!model.columns.length && !model.rows.length) { txt(el("div", "tcx-empty", ui.scroll), "Veri kaynağı bağlayın (satırlarda boyut, sütunlarda ölçü)."); return; }
		var rows = sortRows(filterRows(model.rows));
		var total = rows.length, ps = cfg.pageSize | 0;
		if (ps > 0) { var maxp = Math.max(0, Math.ceil(total / ps) - 1); if (page > maxp) { page = maxp; } rows = rows.slice(page * ps, page * ps + ps); }
		var table = el("table", null, ui.scroll);
		buildHead(table); buildBody(table, rows);
		if (cfg.showColumnTotals) { buildTotals(table); }
		if (ps > 0) { buildPager(total, ps); }
	}

	function filterRows(rows) {
		var q = ("" + query).replace(/^\s+|\s+$/g, "").toLowerCase(); if (!q) { return rows.slice(); }
		var out = [];
		for (var i = 0; i < rows.length; i++) {
			var hay = rows[i].headers.join(" ").toLowerCase();
			if (hay.indexOf(q) < 0) { for (var c = 0; c < model.columns.length; c++) { var v = rows[i].cells[model.columns[c].key]; if (v != null && ("" + v).toLowerCase().indexOf(q) >= 0) { hay += " " + v; break; } } }
			if (hay.indexOf(q) >= 0) { out.push(rows[i]); }
		}
		return out;
	}
	function sortRows(rows) {
		if (!sortState) { return rows; }
		var s = sortState, dir = s.dir === "asc" ? 1 : -1, out = rows.slice();
		out.sort(function (a, b) {
			var av, bv;
			if (s.type === "head") { av = a.headers[s.idx] || ""; bv = b.headers[s.idx] || ""; return av < bv ? -dir : av > bv ? dir : 0; }
			av = a.cells[s.key]; bv = b.cells[s.key];
			var an = G.isNum(av), bn = G.isNum(bv);
			if (an && bn) { return (+av - +bv) * dir; }
			if (an) { return -dir; } if (bn) { return dir; }
			av = av == null ? "" : "" + av; bv = bv == null ? "" : "" + bv; return av < bv ? -dir : av > bv ? dir : 0;
		});
		return out;
	}

	function buildToolbar() {
		clear(ui.toolbar);
		if (!cfg.showToolbar) { ui.toolbar.style.display = "none"; return; }
		ui.toolbar.style.display = "";
		var left = el("div", "tcx-tl", ui.toolbar);
		if (cfg.title) { txt(el("div", "tcx-title", left), cfg.title); }
		if (cfg.subtitle) { txt(el("div", "tcx-sub", left), cfg.subtitle); }
		var right = el("div", "tcx-tr", ui.toolbar);
		if (cfg.searchable) {
			var inp = el("input", "tcx-search", right); inp.type = "text"; inp.placeholder = "🔍 Ara…"; inp.value = query;
			inp.oninput = function () { query = inp.value; page = 0; renderBody(); };   // body only -> input keeps focus
		}
		if (cfg.exportable) { var b = el("button", "tcx-btn", right); txt(b, "⤓ CSV"); b.onclick = exportCSV; }
	}

	function buildHead(table) {
		var thead = el("thead", null, table), tr = el("tr", null, thead), i;
		if (cfg.showRowNumbers) { var th0 = el("th", "tcx-rn", tr); txt(th0, "#"); }
		for (i = 0; i < model.rowDimTitles.length; i++) {
			var th = el("th", "tcx-rh" + (cfg.freezeFirstColumn && i === 0 ? " tcx-freeze" : ""), tr); txt(th, model.rowDimTitles[i]);
			if (cfg.sortable) { th.className += " tcx-sort"; th.appendChild(sortCaret("head", i, null)); (function (idx) { th.onclick = function () { toggleSort("head", idx, null); }; })(i); }
		}
		for (i = 0; i < model.columns.length; i++) {
			var col = model.columns[i], rc = resolveCol(col), c = el("th", "tcx-num", tr); txt(c, rc.title);
			if (cfg.sortable) { c.className += " tcx-sort"; c.appendChild(sortCaret("col", i, col.key)); (function (k) { c.onclick = function () { toggleSort("col", 0, k); }; })(col.key); }
		}
		if (csv(cfg.sparkColumns).length) { txt(el("th", "tcx-ctr", tr), cfg.sparkTitle || "Trend"); }
		if (csv(cfg.pieColumns).length) { txt(el("th", "tcx-ctr", tr), cfg.pieTitle || "Dağılım"); }
	}
	function sortCaret(type, idx, key) {
		var s = el("span", "tcx-caret"); var active = sortState && sortState.type === type && (type === "head" ? sortState.idx === idx : sortState.key === key);
		s.innerHTML = active ? (sortState.dir === "asc" ? "▲" : "▼") : "⇅"; if (!active) { s.style.opacity = ".35"; } return s;
	}
	function toggleSort(type, idx, key) {
		if (sortState && sortState.type === type && (type === "head" ? sortState.idx === idx : sortState.key === key)) { sortState.dir = sortState.dir === "asc" ? "desc" : "asc"; }
		else { sortState = { type: type, idx: idx, key: key, dir: type === "head" ? "asc" : "desc" }; }
		renderBody();
	}

	function buildBody(table, rows) {
		var tbody = el("tbody", null, table), sparks = csv(cfg.sparkColumns), pies = csv(cfg.pieColumns), pieCols = csv(cfg.pieColors);
		for (var r = 0; r < rows.length; r++) {
			var row = rows[r], tr = el("tr", (selKey === row.key ? "tcx-selrow" : "") + (cfg.zebra && r % 2 ? " tcx-zebra" : ""), tbody);
			if (cfg.showRowNumbers) { txt(el("td", "tcx-rn", tr), (r + 1)); }
			for (var h = 0; h < row.headers.length; h++) { var rh = el("td", "tcx-rh" + (cfg.freezeFirstColumn && h === 0 ? " tcx-freeze" : ""), tr); txt(rh, row.headers[h]); }
			for (var c = 0; c < model.columns.length; c++) { tr.appendChild(buildCell(row, model.columns[c], c)); }
			if (sparks.length) { var sc = el("td", "tcx-ctr", tr); sc.innerHTML = G.sparkSVG(collect(row, sparks), { type: cfg.sparkType, color: cfg.sparkColor }); }
			if (pies.length) { var pc = el("td", "tcx-ctr", tr); var pv = collect(row, pies); pc.innerHTML = G.donutSVG(pv, { type: cfg.pieType, colors: pieCols.length ? pieCols : null }); pc.title = pieTip(pies, pv); }
			(function (rw) { tr.onclick = function () { selectRow(rw); }; })(row);
		}
	}
	function collect(row, measures) {
		var out = [];
		for (var m = 0; m < measures.length; m++) { var found = null; for (var c = 0; c < model.columns.length; c++) { if (model.columns[c].measure === measures[m]) { found = row.cells[model.columns[c].key]; break; } } out.push(found); }
		return out;
	}
	function pieTip(measures, vals) { var s = []; for (var i = 0; i < measures.length; i++) { s.push(measures[i] + ": " + (vals[i] == null ? "—" : vals[i])); } return s.join("  ·  "); }

	function buildCell(row, col, colIndex) {
		var rc = resolveCol(col), v = row.cells[col.key], td = el("td", "tcx-num tcx-cell");
		td.style.textAlign = rc.align;
		var numeric = G.isNum(v);
		var thr = matchThreshold(rc.thresholds, v);

		if (rc.viz === "heat" && numeric) {
			var st = rc.scope === "table" ? model.tableStats : col.stats, t = (st.max > st.min) ? (+v - st.min) / (st.max - st.min) : 0.5;
			var bg = G.rampColor(rc.ramp, t); td.style.background = bg; td.style.color = G.contrast(bg);
		}
		if (thr) { if (thr.bg) { td.style.background = thr.bg; td.style.color = thr.color || G.contrast(thr.bg); } else if (thr.color) { td.style.color = thr.color; } }

		if (rc.viz === "bar" && numeric) {
			var stb = rc.scope === "table" ? model.tableStats : col.stats, mx = Math.max(Math.abs(stb.min), Math.abs(stb.max)) || 1;
			var wrap = el("div", "tcx-bar", td), tr2 = el("div", "tcx-bar-track", wrap);
			var bar = el("div", "tcx-bar-fill", tr2); bar.style.width = Math.min(100, Math.abs(+v) / mx * 100) + "%";
			bar.style.background = (+v < 0 ? cfg.negativeColor : rc.barColor);
			var lab = el("span", "tcx-bar-val", wrap); txt(lab, G.fmt(v, fmtOpts(rc)));
		} else {
			var span = el("span", null, td); txt(span, G.fmt(v, fmtOpts(rc)));
			if (rc.trend !== "none" && numeric) {
				var base = baselineFor(row, col, rc, colIndex);
				if (base != null) {
					var up = (+v > base), eq = (+v === base), good = rc.trendGood === "down" ? !up : up;
					var ar = el("span", "tcx-tr", td); ar.innerHTML = eq ? "▬" : (up ? "▲" : "▼");
					ar.style.color = eq ? "#8aa0b3" : (good ? "#3ddc84" : "#ff6b6b");
				}
			}
		}
		(function (rw, cl, val) { td.onclick = function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } selectCell(rw, cl, val); }; })(row, col, v);
		return td;
	}

	function buildTotals(table) {
		var tf = el("tfoot", null, table), tr = el("tr", "tcx-totals", tf), span = model.rowDimTitles.length + (cfg.showRowNumbers ? 1 : 0);
		var first = el("td", "tcx-rh", tr); first.colSpan = span; txt(first, cfg.totalsLabel || "Toplam");
		for (var c = 0; c < model.columns.length; c++) {
			var col = model.columns[c], rc = resolveCol(col), td = el("td", "tcx-num", tr);
			var val = cfg.totalAggregation === "avg" ? col.stats.avg : cfg.totalAggregation === "min" ? col.stats.min : cfg.totalAggregation === "max" ? col.stats.max : col.stats.sum;
			txt(td, col.stats.count ? G.fmt(val, fmtOpts(rc)) : "");
		}
		if (csv(cfg.sparkColumns).length) { el("td", null, tr); }
		if (csv(cfg.pieColumns).length) { el("td", null, tr); }
	}

	function buildPager(total, ps) {
		var pages = Math.max(1, Math.ceil(total / ps));
		var info = el("span", "tcx-pinfo", ui.pager); txt(info, (page + 1) + " / " + pages + "  ·  " + total + " satır");
		var prev = el("button", "tcx-btn", ui.pager); txt(prev, "‹ Önceki"); prev.disabled = page <= 0; prev.onclick = function () { if (page > 0) { page--; renderBody(); } };
		var next = el("button", "tcx-btn", ui.pager); txt(next, "Sonraki ›"); next.disabled = page >= pages - 1; next.onclick = function () { if (page < pages - 1) { page++; renderBody(); } };
	}

	// ===================== interaction =====================
	function selectRow(row) { if (!cfg.selectable) { return; } selKey = row.key; cfg.selectedRow = row.headers.join(" / "); cfg.selectedRowKey = row.key; cfg.selectedColumn = ""; cfg.selectedValue = ""; markSel(); that.firePropertiesChangedAndEvent(["selectedRow", "selectedRowKey", "selectedColumn", "selectedValue"], "onSelect"); }
	function selectCell(row, col, v) { if (!cfg.selectable) { return; } selKey = row.key; cfg.selectedRow = row.headers.join(" / "); cfg.selectedRowKey = row.key; cfg.selectedColumn = col.label; cfg.selectedValue = (v == null ? "" : "" + v); markSel(); that.firePropertiesChangedAndEvent(["selectedRow", "selectedRowKey", "selectedColumn", "selectedValue"], "onSelect"); }
	function markSel() {
		var trs = ui.scroll.getElementsByTagName ? ui.scroll.getElementsByTagName("tr") : [];
		for (var i = 0; i < trs.length; i++) { var cn = (" " + (trs[i].className || "") + " ").replace(" tcx-selrow ", " "); trs[i].className = cn.replace(/^\s+|\s+$/g, ""); }
		renderBody();
	}

	function exportCSV() {
		var rows = sortRows(filterRows(model.rows)), sep = ";", lines = [];
		var head = []; for (var i = 0; i < model.rowDimTitles.length; i++) { head.push(q(model.rowDimTitles[i])); }
		for (i = 0; i < model.columns.length; i++) { head.push(q(model.columns[i].label)); }
		lines.push(head.join(sep));
		for (var r = 0; r < rows.length; r++) {
			var line = []; for (i = 0; i < rows[r].headers.length; i++) { line.push(q(rows[r].headers[i])); }
			for (i = 0; i < model.columns.length; i++) { var v = rows[r].cells[model.columns[i].key]; line.push(q(v == null ? "" : v)); }
			lines.push(line.join(sep));
		}
		var csvStr = "﻿" + lines.join("\r\n");
		try { var a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csvStr); a.download = (cfg.title || "crosstab") + ".csv"; document.body.appendChild(a); a.click(); document.body.removeChild(a); } catch (e) { }
		return csvStr;
	}
	function q(v) { v = "" + v; return /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

	// ===================== style =====================
	function injectStyle() {
		if (document.getElementById("tcx-style")) { return; }
		var css =
			".tcx{height:100%;display:flex;flex-direction:column;font-family:Segoe UI,Arial,sans-serif;border-radius:8px;overflow:hidden;box-sizing:border-box}" +
			".tcx-dark{--bg:#0c1f31;--panel:#102537;--head:#13314a;--fg:#dfeaf3;--sub:#9fb6c9;--line:#21425c;--hover:#16344c;--accent:#37a3d6;--zebra:#0e2233;--sel:#1d4a66}" +
			".tcx-light{--bg:#fff;--panel:#fff;--head:#eef3f7;--fg:#243240;--sub:#5a6b7b;--line:#dfe6ec;--hover:#eef6fc;--accent:#1f7fb0;--zebra:#f6f9fb;--sel:#d9eefb}" +
			".tcx{background:var(--bg);color:var(--fg)}" +
			".tcx-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--panel);border-bottom:1px solid var(--line)}" +
			".tcx-title{font-size:14px;font-weight:700}.tcx-sub{font-size:11px;color:var(--sub)}.tcx-tr{display:flex;gap:8px;align-items:center}" +
			".tcx-search{background:var(--bg);border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:5px 9px;font-size:12px;outline:none;min-width:170px}" +
			".tcx-btn{background:var(--accent);color:#06202e;border:none;border-radius:6px;padding:5px 10px;font-size:12px;font-weight:700;cursor:pointer}.tcx-btn:disabled{opacity:.45;cursor:default}" +
			".tcx-scroll{flex:1;overflow:auto}" +
			".tcx table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}" +
			".tcx th,.tcx td{padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}" +
			".tcx.d-compact th,.tcx.d-compact td{padding:3px 8px;font-size:11px}.tcx.d-comfortable th,.tcx.d-comfortable td{padding:11px 12px;font-size:13px}" +
			".tcx thead th{position:sticky;top:0;background:var(--head);color:var(--sub);text-transform:uppercase;font-size:10px;letter-spacing:.5px;z-index:3;text-align:left}" +
			".tcx thead th.tcx-num{text-align:right}.tcx thead th.tcx-ctr{text-align:center}" +
			".tcx-sort{cursor:pointer;user-select:none}.tcx-caret{margin-left:5px;font-size:9px}" +
			".tcx td.tcx-num{text-align:right;font-variant-numeric:tabular-nums}" +
			".tcx td.tcx-rh{font-weight:600}.tcx-rn{color:var(--sub);text-align:right}" +
			".tcx-freeze{position:sticky;left:0;background:var(--panel);z-index:2}" +
			".tcx tbody tr:hover td{background:var(--hover)}.tcx tr.tcx-zebra td{background:var(--zebra)}" +
			".tcx tr.tcx-selrow td{background:var(--sel) !important}" +
			".tcx-cell{cursor:pointer}.tcx-tr{margin-left:6px;font-size:10px}" +
			".tcx-bar{display:flex;align-items:center;gap:6px;justify-content:flex-end}.tcx-bar-track{flex:1;height:14px;background:rgba(127,150,170,.18);border-radius:3px;overflow:hidden;min-width:40px}.tcx-bar-fill{height:100%;border-radius:3px}.tcx-bar-val{min-width:42px;text-align:right}" +
			".tcx tfoot td{position:sticky;bottom:0;background:var(--head);font-weight:700;border-top:2px solid var(--accent)}" +
			".tcx-pager{display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--panel);border-top:1px solid var(--line);font-size:12px}.tcx-pinfo{color:var(--sub);margin-right:auto}" +
			".tcx-empty{padding:40px;text-align:center;color:var(--sub)}";
		var st = document.createElement("style"); st.id = "tcx-style"; st.type = "text/css";
		if (st.styleSheet) { st.styleSheet.cssText = css; } else { st.appendChild(document.createTextNode(css)); }
		(document.head || document.getElementsByTagName("head")[0] || document.documentElement).appendChild(st);
	}

	// ===================== accessors =====================
	function accessor(name) { that[name] = function (v) { if (v === undefined) { return cfg[name]; } cfg[name] = v; return that; }; }
	var props = ["rowDimensions", "columnDimension", "measureFilter", "title", "subtitle", "theme", "density", "zebra", "stickyHeader",
		"freezeFirstColumn", "showRowNumbers", "showToolbar", "showColumnTotals", "totalAggregation", "totalsLabel",
		"decimals", "unit", "thousandSep", "compact", "nullText", "cellViz", "heatRamp", "barColor", "negativeColor", "colorScope",
		"thresholds", "columnConfig", "sparkColumns", "sparkType", "sparkColor", "sparkTitle", "pieColumns", "pieType", "pieTitle", "pieColors",
		"sortable", "defaultSortColumn", "defaultSortDir", "searchable", "selectable", "exportable", "pageSize",
		"selectedRow", "selectedRowKey", "selectedColumn", "selectedValue"];
	for (var i = 0; i < props.length; i++) { accessor(props[i]); }
	this.metadata = function (v) { if (v === undefined) { return meta; } meta = v; return this; };
	this.data = function (v) { if (v === undefined) { return ds; } ds = v; return this; };

	// scripting helpers
	this.getSelectedRow = function () { return cfg.selectedRow; };
	this.getSelectedValue = function () { return cfg.selectedValue; };
	this.clearSelection = function () { selKey = null; cfg.selectedRow = ""; cfg.selectedRowKey = ""; cfg.selectedColumn = ""; cfg.selectedValue = ""; renderBody(); return this; };
	this.setSearch = function (q) { query = q == null ? "" : "" + q; page = 0; renderBody(); return this; };
	this.exportCSV = function () { return exportCSV(); };
	this.sortBy = function (measure, dir) { for (var c = 0; c < (model ? model.columns.length : 0); c++) { if (model.columns[c].measure === measure || model.columns[c].label === measure) { sortState = { type: "col", idx: 0, key: model.columns[c].key, dir: dir === "asc" ? "asc" : "desc" }; renderBody(); break; } } return this; };
});
