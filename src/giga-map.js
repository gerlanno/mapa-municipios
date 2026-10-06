/*!
 * GigaMap — mapa coroplético do Brasil por UF/município (SVG puro, zero dependências).
 *
 *   const map = new GigaMap('#mapa', { geo: BUNDLE  // ou geoBase: './data/geo'
 *                                    , metric: { label: 'Circuitos' } });
 *   map.setData({ '2304400': 120, '2300101': { value: 8, extra: 'qualquer coisa' } });
 *   map.on('select', info => console.log(info));
 *   map.showUF('CE');
 *   map.addPoints([{ lat: -3.73, lon: -38.52, value: 1 }]);
 *
 * Chave dos dados = código IBGE de 7 dígitos do município. Na visão Brasil os
 * valores são agregados por UF (metric.aggregate: 'sum' | 'mean' | 'max' | 'count' | fn).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GigaMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var UF_BY_CODE = {
    11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI',
    23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES',
    33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF'
  };
  var RAMPS = {
    blue: ['#e8f1fb', '#c2daf3', '#93bde8', '#5f9bd9', '#2f77c4', '#1556a3', '#0b3a78'],
    heat: ['#fff3d6', '#ffd98a', '#fdb25a', '#f68a3c', '#e4572e', '#b5301f', '#7a1414'],
    green: ['#e9f6ec', '#c4e7cc', '#92d0a2', '#5cb578', '#2f9657', '#1b7340', '#0d4d2a'],
    purple: ['#f1ecfa', '#d9cdf0', '#bba5e3', '#9a7dd2', '#7753bd', '#56349b', '#391f70']
  };
  var CAT_PALETTE = ['#1565c0', '#e53935', '#2e9e57', '#f59f00', '#8e44ad', '#00897b', '#6d4c41', '#546e7a'];

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function fmtDefault(v) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
  function norm(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function GigaMap(target, opts) {
    opts = opts || {};
    this.host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.host) throw new Error('GigaMap: container não encontrado');
    this.o = {
      geo: opts.geo || null,
      geoBase: opts.geoBase || null,
      mode: opts.mode || 'heat',            // 'heat' (escala numérica) | 'category'
      categories: opts.categories || null,   // { chave: { label, color } }
      drillOnClick: opts.drillOnClick !== false,
      maxZoom: opts.maxZoom || 40,
      controls: opts.controls !== false,
      legend: opts.legend !== false,
      labels: opts.labels !== false,         // sigla das UFs na visão Brasil
      noDataColor: opts.noDataColor || null,   // padrão: var(--gm-nodata) do tema
      theme: opts.theme || null,               // 'light' | 'dark' | null (segue o sistema)
      tooltip: opts.tooltip || null,
      emptyText: opts.emptyText || 'Sem dados'
    };
    this.metric = Object.assign({ label: 'Valor', scale: 'quantile', ramp: 'blue', aggregate: 'sum', format: fmtDefault, domain: null }, opts.metric || {});
    this.data = {};
    this._agg = {};
    this._geoCache = {};
    this._ev = {};
    this.view = null;
    this.t = { x: 0, y: 0, k: 1 };
    this.points = [];
    this._pointStyle = {};
    this._build();
    this._bind();
    /** Promise resolvida quando a visão inicial estiver desenhada (útil com geoBase). */
    this.ready = opts.view !== false ? this.showBrasil() : Promise.resolve();
  }

  var P = GigaMap.prototype;
  GigaMap.RAMPS = RAMPS;
  GigaMap.UF_BY_CODE = UF_BY_CODE;

  /* ------------------------------------------------------------ DOM */
  P._build = function () {
    var root = this.root = h('div', 'gm-root', this.host);
    if (this.o.noDataColor) root.style.setProperty('--gm-nodata', this.o.noDataColor);
    if (this.o.theme) root.setAttribute('data-theme', this.o.theme);
    var svg = this.svg = el('svg', { class: 'gm-svg', role: 'group', 'aria-label': 'Mapa do Brasil', preserveAspectRatio: 'xMidYMid meet' }, root);
    this.gVp = el('g', { class: 'gm-viewport' }, svg);
    this.gShapes = el('g', { class: 'gm-shapes' }, this.gVp);
    this.gHL = el('g', { class: 'gm-hl' }, this.gVp);
    this.hlHover = el('path', { class: 'gm-hl-hover', fill: 'none', 'vector-effect': 'non-scaling-stroke' }, this.gHL);
    this.hlSel = el('path', { class: 'gm-hl-sel', fill: 'none', 'vector-effect': 'non-scaling-stroke' }, this.gHL);
    this.gPoints = el('g', { class: 'gm-points' }, this.gVp);
    this.gLabels = el('g', { class: 'gm-labels' }, this.gVp);
    this.tip = h('div', 'gm-tip', root);
    this.tip.hidden = true;
    this.legendEl = h('div', 'gm-legend', root);
    if (!this.o.legend) this.legendEl.hidden = true;
    if (this.o.controls) {
      var c = this.ctrl = h('div', 'gm-ctrl', root);
      var self = this;
      [['+', 'Aumentar zoom', function () { self.zoomBy(1.6); }],
       ['−', 'Diminuir zoom', function () { self.zoomBy(1 / 1.6); }],
       ['⇱', 'Redefinir zoom', function () { self.resetZoom(); }]].forEach(function (b) {
        var btn = h('button', 'gm-btn', c, b[0]);
        btn.type = 'button'; btn.title = b[1]; btn.setAttribute('aria-label', b[1]);
        btn.addEventListener('click', b[2]);
      });
    }
  };

  /* ------------------------------------------------------- eventos */
  P.on = function (n, fn) { (this._ev[n] = this._ev[n] || []).push(fn); return this; };
  P.off = function (n, fn) { this._ev[n] = (this._ev[n] || []).filter(function (f) { return f !== fn; }); return this; };
  P.emit = function (n, a) { (this._ev[n] || []).slice().forEach(function (f) { f(a); }); };

  P._bind = function () {
    var self = this, svg = this.svg, ptrs = new Map(), drag = null, pinch = null;

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      self._cancelAnim();
      var f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      self._zoomAt(self._toView(e.clientX, e.clientY), f);
    }, { passive: false });

    svg.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      self._cancelAnim();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, tx: self.t.x, ty: self.t.y, moved: false };
      if (ptrs.size === 2) {
        var a = Array.from(ptrs.values());
        pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), k: self.t.k };
        if (drag) drag.moved = true;
      }
    });
    svg.addEventListener('pointermove', function (e) {
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) {
        var a = Array.from(ptrs.values());
        var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        var mid = self._toView((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
        self._zoomAt(mid, (pinch.k * d / pinch.d) / self.t.k);
        return;
      }
      if (drag && e.pointerId === drag.id) {
        var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          try { svg.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
          svg.classList.add('gm-dragging');
          self._hideTip(); self._setHover(null);
        }
        if (drag.moved) {
          var s = self._pxToView();
          self.t.x = drag.tx + dx * s.x; self.t.y = drag.ty + dy * s.y;
          self._applyT();
          return;
        }
      }
      if (!drag || !drag.moved) self._hoverMove(e);
    });
    function end(e) {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (drag && e.pointerId === drag.id) {
        if (drag.moved) { self._justDragged = true; setTimeout(function () { self._justDragged = false; }, 0); }
        svg.classList.remove('gm-dragging');
        try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
        drag = null;
      }
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { self._hideTip(); self._setHover(null); } });

    svg.addEventListener('click', function (e) {
      if (self._justDragged) return;
      var p = e.target.closest && e.target.closest('path[data-id]');
      if (p) self._activate(p.getAttribute('data-id'));
      else if (self.selected) self.clearSelection();
    });
    svg.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var p = e.target.closest && e.target.closest('path[data-id]');
      if (p) { e.preventDefault(); self._activate(p.getAttribute('data-id')); }
    });
  };

  /* ---------------------------------------------------- geometrias */
  P._getView = function (key) {
    var self = this;
    if (this.o.geo) {
      var v = key === 'BR' ? this.o.geo.brasil : this.o.geo.ufs[key];
      return v ? Promise.resolve(v) : Promise.reject(new Error('GigaMap: visão não encontrada: ' + key));
    }
    if (!this.o.geoBase) return Promise.reject(new Error('GigaMap: informe geo ou geoBase'));
    if (this._geoCache[key]) return this._geoCache[key];
    var url = this.o.geoBase.replace(/\/$/, '') + (key === 'BR' ? '/brasil.json' : '/uf/' + key + '.json');
    return (this._geoCache[key] = fetch(url).then(function (r) {
      if (!r.ok) throw new Error('GigaMap: falha ao carregar ' + url);
      return r.json();
    }).catch(function (e) { delete self._geoCache[key]; throw e; }));
  };

  P.showBrasil = function () { return this._show('BR'); };
  P.showUF = function (uf) { return this._show(String(uf).toUpperCase()); };

  P._show = function (key) {
    var self = this;
    // geometria embutida: troca de visão síncrona (view já definido ao retornar)
    if (this.o.geo) {
      var v = key === 'BR' ? this.o.geo.brasil : this.o.geo.ufs[key];
      if (!v) return Promise.reject(new Error('GigaMap: visão não encontrada: ' + key));
      this._setView(v);
      return Promise.resolve(v);
    }
    return this._getView(key).then(function (v) { self._setView(v); return v; });
  };

  P._setView = function (v) {
    this.view = v;
    this.selected = null;
    this._render();
    this.t = { x: 0, y: 0, k: 1 };
    this._applyT();
    this.emit('navigate', { level: v.level, uf: v.level === 'uf' ? v.view : null, view: v });
  };

  P._render = function () {
    var v = this.view, self = this;
    this.svg.setAttribute('viewBox', v.viewBox.join(' '));
    this.svg.setAttribute('aria-label', v.level === 'uf' ? 'Mapa de municípios — ' + v.view : 'Mapa do Brasil por estado');
    this.gShapes.textContent = '';
    this.byId = {};
    var frag = document.createDocumentFragment();
    v.features.forEach(function (f) {
      var p = el('path', {
        d: f.d, 'data-id': f.id, class: 'gm-shape', 'vector-effect': 'non-scaling-stroke',
        tabindex: 0, role: 'button'
      });
      self.byId[f.id] = { f: f, node: p };
      frag.appendChild(p);
    });
    this.gShapes.appendChild(frag);
    this.hlHover.removeAttribute('d'); this.hlSel.removeAttribute('d');
    this._paint();
    this._renderLabels();
    this._renderPoints();
  };

  P._renderLabels = function () {
    var self = this;
    this.gLabels.textContent = '';
    this.labelNodes = [];
    if (!this.o.labels || this.view.level !== 'brasil') return;
    this.view.features.forEach(function (f) {
      var t = el('text', { class: 'gm-label', x: f.c[0], y: f.c[1], 'text-anchor': 'middle', 'dominant-baseline': 'central' }, self.gLabels);
      t.textContent = f.id;
      self.labelNodes.push(t);
    });
  };

  /* ------------------------------------------------------- dados */
  P.setData = function (data, metric) {
    this.data = {};
    for (var id in data) {
      var d = data[id];
      if (d === null || d === undefined) continue;
      if (typeof d === 'object') {
        var o = Object.assign({}, d);
        if (o.value !== undefined && o.value !== null) o.value = Number(o.value);
        this.data[id] = o;
      } else if (typeof d === 'string' && this.o.mode === 'category') this.data[id] = { category: d };
      else this.data[id] = { value: Number(d) };
    }
    if (metric) this.setMetric(metric, true);
    this._aggregate();
    if (this.view) this._paint();
    return this;
  };

  P.setMetric = function (m, silent) {
    this.metric = Object.assign({}, this.metric, m || {});
    if (m && m.mode) this.o.mode = m.mode;
    if (m && m.categories) this.o.categories = m.categories;
    if (!silent) { this._aggregate(); if (this.view) this._paint(); }
    return this;
  };

  P._aggregate = function () {
    var by = {}, agg = this.metric.aggregate;
    for (var id in this.data) {
      var uf = UF_BY_CODE[String(id).slice(0, 2)];
      if (!uf) continue;
      (by[uf] = by[uf] || []).push(this.data[id]);
    }
    var out = {};
    for (var uf2 in by) {
      var arr = by[uf2];
      if (this.o.mode === 'category') {
        var cnt = {}, best = null;
        arr.forEach(function (d) { if (d.category != null) { cnt[d.category] = (cnt[d.category] || 0) + 1; if (best === null || cnt[d.category] > cnt[best]) best = d.category; } });
        out[uf2] = { category: best, n: arr.length };
        continue;
      }
      var vals = arr.map(function (d) { return d.value; }).filter(Number.isFinite);
      if (!vals.length) continue;
      var v;
      if (typeof agg === 'function') v = agg(vals, arr);
      else if (agg === 'mean') v = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      else if (agg === 'max') v = Math.max.apply(null, vals);
      else if (agg === 'count') v = vals.length;
      else v = vals.reduce(function (a, b) { return a + b; }, 0);
      out[uf2] = { value: v, n: arr.length };
    }
    this._agg = out;
  };

  P._lookup = function (id) {
    return this.view && this.view.level === 'brasil' ? this._agg[id] : this.data[id];
  };

  /* ---------------------------------------------------- escala/cor */
  P._ramp = function () {
    var r = this.metric.ramp;
    return typeof r === 'string' ? (RAMPS[r] || RAMPS.blue) : r;
  };

  P._buildScale = function (vals) {
    var m = this.metric, ramp = this._ramp(), n = ramp.length;
    var vs = vals.filter(Number.isFinite).sort(function (a, b) { return a - b; });
    if (!vs.length) return null;
    var lo = m.domain ? m.domain[0] : vs[0], hi = m.domain ? m.domain[1] : vs[vs.length - 1];
    var edges = [], i;
    if (m.scale === 'quantile') {
      for (i = 0; i <= n; i++) edges.push(vs[Math.min(vs.length - 1, Math.floor(i * vs.length / n))]);
      edges[0] = lo; edges[n] = hi;
    } else {
      var f = m.scale === 'sqrt' ? Math.sqrt : m.scale === 'log' ? Math.log1p : function (x) { return x; };
      var g = m.scale === 'sqrt' ? function (x) { return x * x; } : m.scale === 'log' ? Math.expm1 : function (x) { return x; };
      var a = f(lo), b = f(hi);
      for (i = 0; i <= n; i++) edges.push(g(a + (b - a) * i / n));
    }
    var uniq = [edges[0]];
    for (i = 1; i < edges.length; i++) if (edges[i] > uniq[uniq.length - 1]) uniq.push(edges[i]);
    if (uniq.length < 2) uniq.push(uniq[0]);
    var k = uniq.length - 1;
    var classes = [];
    for (i = 0; i < k; i++) {
      classes.push({ lo: uniq[i], hi: uniq[i + 1], color: ramp[Math.round(i * (n - 1) / Math.max(k - 1, 1))] });
    }
    return {
      classes: classes,
      color: function (v) {
        for (var j = k - 1; j >= 0; j--) if (v >= classes[j].lo) return classes[j].color;
        return classes[0].color;
      }
    };
  };

  P._catColor = function (key) {
    var c = this.o.categories && this.o.categories[key];
    if (c && c.color) return c.color;
    if (!this._autoCat) this._autoCat = {};
    if (!this._autoCat[key]) this._autoCat[key] = CAT_PALETTE[Object.keys(this._autoCat).length % CAT_PALETTE.length];
    return this._autoCat[key];
  };

  P._paint = function () {
    var self = this, ids = Object.keys(this.byId), mode = this.o.mode;
    var scale = null, catCount = {};
    if (mode === 'heat') {
      var vals = [];
      ids.forEach(function (id) { var d = self._lookup(id); if (d && Number.isFinite(d.value)) vals.push(d.value); });
      scale = this._buildScale(vals);
    }
    var withData = 0;
    ids.forEach(function (id) {
      var d = self._lookup(id), node = self.byId[id].node, color = null;
      if (d) {
        if (mode === 'category') {
          if (d.category != null) { color = self._catColor(d.category); catCount[d.category] = (catCount[d.category] || 0) + 1; withData++; }
        } else if (scale && Number.isFinite(d.value)) { color = scale.color(d.value); withData++; }
      }
      // sem dados: cor vem do CSS (--gm-nodata), que acompanha o tema claro/escuro
      if (color) node.setAttribute('fill', color); else node.removeAttribute('fill');
      node.classList.toggle('gm-nd', !color);
      node.setAttribute('aria-label', self._ariaFor(id));
    });
    this._scale = scale;
    this._renderLegend(scale, catCount, withData, ids.length);
  };

  P._ariaFor = function (id) {
    var info = this._info(id), t = info.nome;
    if (info.category != null) t += ': ' + ((this.o.categories && this.o.categories[info.category] && this.o.categories[info.category].label) || info.category);
    else if (Number.isFinite(info.value)) t += ': ' + this.metric.format(info.value) + ' ' + (this.metric.label || '');
    else t += ': ' + this.o.emptyText;
    return t;
  };

  P._renderLegend = function (scale, catCount, withData, total) {
    var L = this.legendEl, self = this;
    if (!this.o.legend) return;
    L.textContent = '';
    h('div', 'gm-legend-title', L, this.o.mode === 'category' ? (this.metric.label || 'Categoria') : (this.metric.label || 'Valor'));
    if (this.o.mode === 'category') {
      Object.keys(catCount).sort(function (a, b) { return catCount[b] - catCount[a]; }).forEach(function (k) {
        var row = h('div', 'gm-legend-row', L);
        var sw = h('span', 'gm-sw', row); sw.style.background = self._catColor(k);
        h('span', 'gm-legend-lbl', row, (self.o.categories && self.o.categories[k] && self.o.categories[k].label) || k);
        h('span', 'gm-legend-n', row, catCount[k] + (self.view.level === 'uf' ? ' mun.' : ' UFs'));
      });
    } else if (scale) {
      var cls = scale.classes;
      // valores inteiros: faixas sem sobreposição (2–5, 6–12 …) em vez de 2–6, 6–12
      var allInt = cls.every(function (c) { return Number.isInteger(c.lo) && Number.isInteger(c.hi); });
      cls.forEach(function (c, i) {
        var row = h('div', 'gm-legend-row', L);
        var sw = h('span', 'gm-sw', row); sw.style.background = c.color;
        var hi = c.hi;
        if (allInt && i < cls.length - 1) hi = Math.max(c.lo, cls[i + 1].lo - 1);
        var txt = c.lo === hi ? self.metric.format(c.lo) : self.metric.format(c.lo) + ' – ' + self.metric.format(hi);
        h('span', 'gm-legend-lbl', row, txt);
      });
    }
    var nd = h('div', 'gm-legend-row gm-legend-nd', L);
    h('span', 'gm-sw gm-sw-nd', nd);
    h('span', 'gm-legend-lbl', nd, this.o.emptyText + ' (' + (total - withData) + ')');
  };

  /* ----------------------------------------------------- seleção */
  P._info = function (id) {
    var rec = this.byId && this.byId[id];
    var f = rec ? rec.f : { id: id, nome: id, uf: '' };
    var d = this._lookup(id) || {};
    return Object.assign({}, d, { id: id, nome: f.nome, uf: f.uf, level: this.view.level, value: d.value, category: d.category, raw: d, feature: f });
  };

  P._activate = function (id) {
    if (this.view.level === 'brasil' && this.o.drillOnClick) {
      this.emit('select', this._info(id));
      this.showUF(id);
      return;
    }
    this.select(id);
  };

  P.select = function (id, opts) {
    var rec = this.byId[id];
    if (!rec) return this;
    this.selected = id;
    this.hlSel.setAttribute('d', rec.f.d);
    this.emit('select', this._info(id));
    if (opts && opts.zoom) this.zoomTo(id);
    return this;
  };

  P.clearSelection = function () {
    this.selected = null;
    this.hlSel.removeAttribute('d');
    this.emit('select', null);
    return this;
  };

  P._setHover = function (id) {
    if (id === this._hoverId) return;
    this._hoverId = id;
    if (id && this.byId[id]) this.hlHover.setAttribute('d', this.byId[id].f.d);
    else this.hlHover.removeAttribute('d');
  };

  P._hoverMove = function (e) {
    var p = e.target.closest && e.target.closest('path[data-id]');
    if (!p) { this._hideTip(); this._setHover(null); return; }
    var id = p.getAttribute('data-id');
    this._setHover(id);
    var info = this._info(id), t = this.tip;
    t.textContent = '';
    if (this.o.tooltip) {
      var out = this.o.tooltip(info);
      if (out instanceof Node) t.appendChild(out); else t.innerHTML = out;
    } else {
      h('strong', null, t, info.nome + (info.level === 'uf' ? ' · ' + info.uf : ''));
      if (info.category != null) h('div', null, t, (this.o.categories && this.o.categories[info.category] && this.o.categories[info.category].label) || info.category);
      else if (Number.isFinite(info.value)) h('div', null, t, (this.metric.label || '') + ': ' + this.metric.format(info.value));
      else h('div', 'gm-tip-nd', t, this.o.emptyText);
    }
    t.hidden = false;
    var r = this.root.getBoundingClientRect(), x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    var tw = t.offsetWidth, th = t.offsetHeight;
    if (x + tw > r.width - 6) x = e.clientX - r.left - tw - 14;
    if (y + th > r.height - 6) y = e.clientY - r.top - th - 14;
    t.style.transform = 'translate(' + Math.max(4, x) + 'px,' + Math.max(4, y) + 'px)';
    this.emit('hover', info);
  };
  P._hideTip = function () { this.tip.hidden = true; };

  /* ------------------------------------------------- zoom e pan */
  P._toView = function (cx, cy) {
    var pt = this.svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    var m = this.svg.getScreenCTM();
    var q = m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
    return { x: q.x, y: q.y };
  };
  P._pxToView = function () {
    var m = this.svg.getScreenCTM();
    return m ? { x: 1 / m.a, y: 1 / m.d } : { x: 1, y: 1 };
  };
  P._clampT = function (t) {
    var vb = this.view.viewBox, W = vb[2], H = vb[3], m = 0.12;
    if (t.k <= 1.0001) { t.k = 1; t.x = 0; t.y = 0; return t; }
    t.x = clamp(t.x, W - W * t.k - m * W, m * W);
    t.y = clamp(t.y, H - H * t.k - m * H, m * H);
    return t;
  };
  P._applyT = function () {
    this._clampT(this.t);
    this.gVp.setAttribute('transform', 'translate(' + this.t.x.toFixed(2) + ' ' + this.t.y.toFixed(2) + ') scale(' + this.t.k.toFixed(4) + ')');
    var self = this;
    if (!this._raf) this._raf = requestAnimationFrame(function () { self._raf = 0; self._counterScale(); });
    this.emit('zoom', { k: this.t.k });
  };
  P._counterScale = function () {
    var k = this.t.k, base = this._pointStyle.radius || 3.2;
    var circles = this.gPoints.children, i;
    for (i = 0; i < circles.length; i++) circles[i].setAttribute('r', (circles[i]._r || base) / k);
    if (this.labelNodes) for (i = 0; i < this.labelNodes.length; i++) this.labelNodes[i].style.fontSize = (13 / k).toFixed(2) + 'px';
  };
  P._zoomAt = function (pt, f) {
    var nk = clamp(this.t.k * f, 1, this.o.maxZoom), r = nk / this.t.k;
    this.t.x = pt.x - (pt.x - this.t.x) * r;
    this.t.y = pt.y - (pt.y - this.t.y) * r;
    this.t.k = nk;
    this._applyT();
  };
  P.zoomBy = function (f) {
    var vb = this.view.viewBox;
    this._animateTo(this._zoomedT({ x: vb[2] / 2, y: vb[3] / 2 }, f));
    return this;
  };
  P._zoomedT = function (pt, f) {
    var nk = clamp(this.t.k * f, 1, this.o.maxZoom), r = nk / this.t.k;
    return { x: pt.x - (pt.x - this.t.x) * r, y: pt.y - (pt.y - this.t.y) * r, k: nk };
  };
  P.resetZoom = function () { this._animateTo({ x: 0, y: 0, k: 1 }); this.clearSelection(); return this; };
  P.zoomTo = function (id, pad) {
    var rec = this.byId[id]; if (!rec) return this;
    var b = rec.f.bbox, vb = this.view.viewBox;
    var w = Math.max(b[2] - b[0], 1), hh = Math.max(b[3] - b[1], 1);
    var k = clamp(Math.min(vb[2] / w, vb[3] / hh) * (pad || 0.55), 1, this.o.maxZoom);
    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    this._animateTo({ x: vb[2] / 2 - cx * k, y: vb[3] / 2 - cy * k, k: k });
    return this;
  };
  P._cancelAnim = function () { if (this._anim) { cancelAnimationFrame(this._anim); this._anim = 0; } };
  P._animateTo = function (to) {
    var self = this, from = { x: this.t.x, y: this.t.y, k: this.t.k }, t0 = performance.now(), D = 320;
    this._clampT(to);
    this._cancelAnim();
    (function step(now) {
      var p = clamp((now - t0) / D, 0, 1), e = ease(p);
      // interpola k em escala logarítmica p/ zoom suave
      var k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * e);
      self.t = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: k };
      self._applyT();
      if (p < 1) self._anim = requestAnimationFrame(step); else self._anim = 0;
    })(t0);
  };

  /* ----------------------------------------------------- pontos */
  /** pontos: [{lat, lon, value?, color?, label?, id?}]; opts: {radius, color, opacity, sizeBy} */
  P.addPoints = function (pts, opts) {
    this.points = pts || [];
    this._pointStyle = Object.assign({ radius: 3.2, color: '#e4572e', opacity: 0.8 }, opts || {});
    this._renderPoints();
    return this;
  };
  P.clearPoints = function () { this.points = []; this.gPoints.textContent = ''; return this; };
  P.project = function (lon, lat) {
    var p = this.view.projection;
    return [(lon - p.lon_min) * p.k * p.s + p.pad, (p.lat_max - lat) * p.s + p.pad];
  };
  P._renderPoints = function () {
    this.gPoints.textContent = '';
    if (!this.points.length || !this.view) return;
    var vb = this.view.viewBox, st = this._pointStyle, frag = document.createDocumentFragment(), self = this;
    this.points.forEach(function (p) {
      var xy = self.project(p.lon, p.lat);
      if (xy[0] < 0 || xy[1] < 0 || xy[0] > vb[2] || xy[1] > vb[3]) return;
      var c = el('circle', { cx: xy[0].toFixed(1), cy: xy[1].toFixed(1), r: st.radius, fill: p.color || st.color, 'fill-opacity': st.opacity, class: 'gm-pt' });
      c._r = p.radius || (st.sizeBy && Number.isFinite(p.value) ? Math.max(1.6, Math.min(9, st.radius * Math.sqrt(p.value))) : st.radius);
      if (p.label) { var t = el('title', null, c); t.textContent = p.label; }
      frag.appendChild(c);
    });
    this.gPoints.appendChild(frag);
    this._counterScale();
  };

  /* ------------------------------------------------------ utils */
  P.getFeatures = function () { return this.view ? this.view.features : []; };
  P.find = function (q, limit) {
    var n = norm(q), out = [];
    this.getFeatures().forEach(function (f) { if (out.length < (limit || 10) && norm(f.nome).indexOf(n) >= 0) out.push(f); });
    return out;
  };
  P.destroy = function () { this._cancelAnim(); this.host.removeChild(this.root); };
  GigaMap.normalize = norm;

  return GigaMap;
});
