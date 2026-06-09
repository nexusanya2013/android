// ============================================================================
//  TCDD Crosstab Grid - Additional Properties Sheet (design-time editor)
//  ---------------------------------------------------------------------------
//  Renders inside Lumira Designer's properties panel. Reads the bound data
//  source's fields (published by the component into the "availableFields"
//  property) and lets the designer pick row dimensions, a column dimension and
//  measures (with per-measure cell viz + sparkline/pie) by their DISPLAY names
//  — no technical names typed — plus all appearance/format/interaction options.
//  Writes values back via firePropertiesChanged.
// ============================================================================
sap.designstudio.sdk.PropertyPage.subclass("com.tcdd.crosstab.CrosstabPropertyPage", function () {
	var that = this, P = {}, built = false, fields = { dims: [], measures: [] };
	var rowUI = [], measUI = [], controls = {}, colDimSel = null, fieldsBox = null;

	var RAMPS = ["blue", "heat", "traffic", "rdylgn", "redblue", "viridis", "cool", "green", "purple", "gray"];
	// simple controls: [id, label, type, options?]
	var SECTIONS = [
		["Görünüm", [
			["title", "Başlık", "text"], ["subtitle", "Alt başlık", "text"],
			["theme", "Tema", "select", [["dark", "Koyu"], ["light", "Açık"]]],
			["density", "Yoğunluk", "select", [["compact", "Sıkışık"], ["normal", "Normal"], ["comfortable", "Geniş"]]],
			["gridLines", "Izgara", "select", [["rows", "Yatay"], ["both", "Yatay+Dikey"], ["none", "Yok"]]],
			["accentColor", "Vurgu rengi", "text"], ["headerUppercase", "Başlık BÜYÜK", "check"],
			["zebra", "Zebra", "check"], ["stickyHeader", "Sabit başlık", "check"],
			["freezeFirstColumn", "İlk sütun dondur", "check"], ["showRowNumbers", "Satır no", "check"],
			["showToolbar", "Araç çubuğu", "check"], ["showFieldChooser", "⚙ Alanlar düğmesi", "check"]
		]],
		["Biçim", [
			["decimals", "Ondalık (-1=oto)", "num"], ["unit", "Birim", "text"],
			["thousandSep", "Binlik ayırıcı", "check"], ["compact", "Kısalt (B/M)", "check"], ["nullText", "Boş metin", "text"]
		]],
		["Hücre Gösterimi", [
			["cellViz", "Varsayılan tip", "select", [["value", "Sayı"], ["bar", "Bar"], ["heat", "Isı"], ["dot", "Nokta"], ["pill", "Etiket"]]],
			["heatRamp", "Isı rampası", "select", ramps()],
			["barColor", "Bar rengi", "text"], ["negativeColor", "Negatif renk", "text"],
			["colorScope", "Renk kapsamı", "select", [["column", "Sütun"], ["table", "Tablo"]]]
		]],
		["Sparkline", [
			["sparkType", "Tip", "select", [["line", "Çizgi"], ["area", "Alan"], ["bar", "Bar"]]],
			["sparkColor", "Renk", "text"], ["sparkTitle", "Başlık", "text"]
		]],
		["Pasta / Donut", [
			["pieType", "Tip", "select", [["donut", "Donut"], ["pie", "Pasta"]]],
			["pieTitle", "Başlık", "text"], ["pieColors", "Renkler (csv)", "text"]
		]],
		["Toplam", [
			["showColumnTotals", "Toplam satırı", "check"],
			["totalAggregation", "Hesap", "select", [["sum", "Toplam"], ["avg", "Ortalama"], ["min", "Min"], ["max", "Max"]]],
			["totalsLabel", "Etiket", "text"]
		]],
		["Etkileşim", [
			["sortable", "Sıralanabilir", "check"], ["defaultSortColumn", "Varsayılan sıra (ölçü)", "text"],
			["defaultSortDir", "Yön", "select", [["desc", "Azalan"], ["asc", "Artan"]]],
			["searchable", "Arama", "check"], ["selectable", "Seçim", "check"], ["exportable", "CSV", "check"],
			["pageSize", "Sayfa boyutu (0=hepsi)", "num"]
		]]
	];
	function ramps() { var o = []; for (var i = 0; i < RAMPS.length; i++) { o.push([RAMPS[i], RAMPS[i]]); } return o; }

	// ---- property accessors (framework reads/writes these) ----
	var PROPS = ["rowDimensions", "columnDimension", "measureFilter", "availableFields", "columnConfig", "sparkColumns", "pieColumns",
		"title", "subtitle", "theme", "density", "gridLines", "accentColor", "headerUppercase", "zebra", "stickyHeader", "freezeFirstColumn",
		"showRowNumbers", "showToolbar", "showFieldChooser", "decimals", "unit", "thousandSep", "compact", "nullText",
		"cellViz", "heatRamp", "barColor", "negativeColor", "colorScope", "sparkType", "sparkColor", "sparkTitle", "pieType", "pieTitle", "pieColors",
		"showColumnTotals", "totalAggregation", "totalsLabel", "sortable", "defaultSortColumn", "defaultSortDir", "searchable", "selectable", "exportable", "pageSize"];
	(function () { for (var i = 0; i < PROPS.length; i++) { (function (n) { that[n] = function (v) { if (v === undefined) { return P[n]; } P[n] = v; sync(n); return that; }; })(PROPS[i]); } })();

	// ---- helpers ----
	function el(t, c, p) { var e = document.createElement(t); if (c) { e.className = c; } if (p) { p.appendChild(e); } return e; }
	function txt(n, s) { n.appendChild(document.createTextNode(s == null ? "" : "" + s)); return n; }
	function clear(n) { while (n && n.firstChild) { n.removeChild(n.firstChild); } }
	function csv(s) { var a = ("" + (s || "")).split(/[,;]/), o = []; for (var i = 0; i < a.length; i++) { var v = a[i].replace(/^\s+|\s+$/g, ""); if (v) { o.push(v); } } return o; }
	function jget(s) { try { var o = JSON.parse(s || "{}"); return (o && typeof o === "object") ? o : {}; } catch (e) { return {}; } }
	function has(arr, key, text) { return arr.indexOf(key) >= 0 || arr.indexOf(text) >= 0; }
	function commit(name) { try { that.firePropertiesChanged([name]); } catch (e) { } }

	this.init = function () {
		var root = document.getElementById("tcxaps"); clear(root);
		// fields section first
		var fs = section(root, "Alanlar (Veri)"); fieldsBox = fs;
		// simple sections
		for (var s = 0; s < SECTIONS.length; s++) {
			var bd = section(root, SECTIONS[s][0]), defs = SECTIONS[s][1];
			for (var i = 0; i < defs.length; i++) { buildControl(bd, defs[i]); }
		}
		built = true;
		// apply already-received values
		for (var p in P) { if (P.hasOwnProperty(p)) { sync(p); } }
		buildFields();
	};

	function section(root, title) {
		var sec = el("div", "aps-sec", root), h = el("h4", null, sec); txt(h, title);
		var car = el("span", null, h); car.innerHTML = "▾";
		var bd = el("div", "aps-bd", sec);
		h.onclick = function () { var col = bd.className.indexOf("collapsed") >= 0; bd.className = col ? "aps-bd" : "aps-bd collapsed"; car.innerHTML = col ? "▾" : "▸"; };
		return bd;
	}

	function buildControl(bd, def) {
		var id = def[0], label = def[1], type = def[2], opts = def[3], row = el("div", "aps-row", bd), c;
		if (type === "check") {
			c = el("input", null, row); c.type = "checkbox"; txt(el("label", "lbl", row), label);
			c.onchange = function () { P[id] = c.checked; commit(id); };
		} else {
			txt(el("label", "lbl", row), label);
			if (type === "select") { c = el("select", null, row); for (var i = 0; i < opts.length; i++) { var o = el("option", null, c); o.value = opts[i][0]; txt(o, opts[i][1]); } }
			else { c = el("input", null, row); c.type = (type === "num") ? "number" : "text"; }
			c.onchange = function () { P[id] = (type === "num") ? parseFloat(c.value) : c.value; commit(id); };
		}
		controls[id] = { el: c, type: type };
	}

	function setControl(ctrl, val) {
		if (!ctrl) { return; }
		if (ctrl.type === "check") { ctrl.el.checked = (val === true || val === "true"); }
		else { ctrl.el.value = (val == null ? "" : val); }
	}

	function sync(name) {
		if (!built) { return; }
		if (name === "availableFields") { fields = parseFields(P.availableFields); buildFields(); return; }
		if (name === "rowDimensions" || name === "columnDimension" || name === "measureFilter" || name === "sparkColumns" || name === "pieColumns" || name === "columnConfig") { buildFields(); return; }
		if (controls[name]) { setControl(controls[name], P[name]); }
	}
	function parseFields(s) { try { var o = JSON.parse(s || "{}"); return { dims: o.dims || [], measures: o.measures || [] }; } catch (e) { return { dims: [], measures: [] }; } }

	// ---- the field picker (dims / column dim / measures) ----
	function buildFields() {
		if (!fieldsBox) { return; }
		clear(fieldsBox); rowUI = []; measUI = [];
		var dims = fields.dims || [], meas = fields.measures || [];
		if (!dims.length && !meas.length) { txt(el("div", "aps-note", fieldsBox), "Bir veri kaynağı bağlayın — alanlar burada listelenecek."); return; }
		var rowSel = csv(P.rowDimensions), measSel = csv(P.measureFilter), sparkSel = csv(P.sparkColumns), pieSel = csv(P.pieColumns), cc = jget(P.columnConfig);

		txt(el("div", "aps-h", fieldsBox), "Satır Boyutları");
		for (var i = 0; i < dims.length; i++) {
			(function (d) {
				var r = el("label", "aps-citem", fieldsBox), cb = el("input", null, r); cb.type = "checkbox";
				cb.checked = rowSel.length ? has(rowSel, d.key, d.text) : (i === 0 ? false : false) || rowSel.length === 0;
				txt(el("span", null, r), d.text);
				cb.onchange = recomputeRows; rowUI.push({ key: d.key, cb: cb });
			})(dims[i]);
		}

		txt(el("div", "aps-h", fieldsBox), "Sütun Boyutu (çapraz)");
		colDimSel = el("select", null, fieldsBox); var none = el("option", null, colDimSel); none.value = ""; txt(none, "(Yok)");
		for (i = 0; i < dims.length; i++) { var o = el("option", null, colDimSel); o.value = dims[i].key; txt(o, dims[i].text); if (P.columnDimension === dims[i].key) { o.selected = true; } }
		colDimSel.onchange = function () { P.columnDimension = colDimSel.value; commit("columnDimension"); };

		txt(el("div", "aps-h", fieldsBox), "Ölçüler");
		for (i = 0; i < meas.length; i++) {
			(function (m) {
				var row = el("div", "aps-mrow", fieldsBox);
				var cb = el("input", null, row); cb.type = "checkbox"; cb.checked = measSel.length ? has(measSel, m.key, m.text) : true;
				txt(el("span", "aps-mname", row), m.text);
				var vs = el("select", null, row); [["value", "Sayı"], ["bar", "Bar"], ["heat", "Isı"], ["dot", "Nokta"], ["pill", "Etiket"]].forEach(function (p) { var op = el("option", null, vs); op.value = p[0]; txt(op, p[1]); });
				var cur = (cc[m.key] && cc[m.key].viz) || (cc[m.text] && cc[m.text].viz) || P.cellViz || "value"; vs.value = cur;
				var sp = el("input", null, row); sp.type = "checkbox"; sp.checked = has(sparkSel, m.key, m.text); txt(el("span", "aps-tag", row), "spark");
				var pi = el("input", null, row); pi.type = "checkbox"; pi.checked = has(pieSel, m.key, m.text); txt(el("span", "aps-tag", row), "pasta");
				cb.onchange = recomputeMeasures; vs.onchange = recomputeMeasures; sp.onchange = recomputeMeasures; pi.onchange = recomputeMeasures;
				measUI.push({ m: m, cb: cb, vs: vs, sp: sp, pi: pi });
			})(meas[i]);
		}
	}
	function recomputeRows() {
		var r = []; for (var i = 0; i < rowUI.length; i++) { if (rowUI[i].cb.checked) { r.push(rowUI[i].key); } }
		P.rowDimensions = r.join(","); commit("rowDimensions");
	}
	function recomputeMeasures() {
		var meas = [], spark = [], pie = [], cc = jget(P.columnConfig);
		for (var i = 0; i < measUI.length; i++) {
			var u = measUI[i]; if (u.cb.checked) { meas.push(u.m.key); }
			var prev = cc[u.m.key] || cc[u.m.text] || {}; prev.viz = u.vs.value; cc[u.m.key] = prev;
			if (u.sp.checked) { spark.push(u.m.key); }
			if (u.pi.checked) { pie.push(u.m.key); }
		}
		P.measureFilter = meas.join(","); commit("measureFilter");
		P.sparkColumns = spark.join(","); commit("sparkColumns");
		P.pieColumns = pie.join(","); commit("pieColumns");
		P.columnConfig = JSON.stringify(cc); commit("columnConfig");
	}
});
