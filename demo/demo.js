/* Demo do GigaMap — TODOS os dados abaixo são FICTÍCIOS (gerados com semente fixa). */
(function () {
  'use strict';
  var GEO = window.__GEO__;
  var $ = function (s) { return document.querySelector(s); };
  var nf = function (v) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); };

  /* ---------- gerador pseudo-aleatório determinístico ---------- */
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var rnd = mulberry32(2026);

  var TECH = { fibra: { label: 'Fibra óptica', color: '#1565c0' }, radio: { label: 'Rádio', color: '#f59f00' }, satelite: { label: 'Satélite', color: '#8e44ad' }, metro: { label: 'Metro Ethernet', color: '#00897b' } };
  var techKeys = Object.keys(TECH);

  /* ---------- dados mock por município ---------- */
  var MOCK = {}, NAMES = [];
  Object.keys(GEO.ufs).forEach(function (uf) {
    var ufCover = 0.35 + rnd() * 0.55, ufScale = 0.5 + rnd() * 2.2;
    GEO.ufs[uf].features.forEach(function (f) {
      NAMES.push({ id: f.id, nome: f.nome, uf: uf, key: GigaMap.normalize(f.nome) });
      if (rnd() > ufCover) return;
      var size = Math.max(1, Math.round(Math.exp(rnd() * 4.2) * ufScale * (rnd() < 0.04 ? 6 : 1)));
      var fib = rnd(), rad = rnd() * (1 - fib), sat = rnd() * 0.08, met = Math.max(0, 1 - fib - rad - sat);
      var mix = { fibra: fib, radio: rad, satelite: sat, metro: met }, tot = fib + rad + sat + met;
      var best = techKeys.reduce(function (a, k) { return mix[k] > mix[a] ? k : a; }, 'fibra');
      var clientes = Math.max(1, Math.round(size * (0.35 + rnd() * 0.6)));
      MOCK[f.id] = {
        circuitos: size, clientes: clientes,
        sla: Math.round((2 + rnd() * rnd() * 30) * 10) / 10,   // % de circuitos com SLA estourado
        tickets: Math.round(size * rnd() * 0.25),
        tecnologia: best,
        mix: techKeys.map(function (k) { return { k: k, n: Math.round(size * mix[k] / tot) }; })
      };
    });
  });

  /* ---------- métricas disponíveis ---------- */
  var METRICS = {
    circuitos: { label: 'Circuitos', ramp: 'blue', scale: 'quantile', aggregate: 'sum', format: nf },
    clientes: { label: 'Clientes', ramp: 'green', scale: 'quantile', aggregate: 'sum', format: nf },
    sla: { label: '% circuitos com SLA estourado', ramp: 'heat', scale: 'linear', format: function (v) { return v.toFixed(1).replace('.', ',') + '%'; },
      aggregate: function (vals, arr) { var w = 0, s = 0; arr.forEach(function (d) { if (Number.isFinite(d.value)) { w += d.circuitos; s += d.value * d.circuitos; } }); return w ? s / w : NaN; } },
    tickets: { label: 'Tickets abertos', ramp: 'purple', scale: 'quantile', aggregate: 'sum', format: nf },
    tecnologia: { label: 'Tecnologia predominante', mode: 'category' }
  };

  function dataFor(metric) {
    var out = {};
    Object.keys(MOCK).forEach(function (id) {
      var m = MOCK[id], d = Object.assign({}, m);
      if (metric === 'tecnologia') d.category = m.tecnologia; else d.value = m[metric];
      out[id] = d;
    });
    return out;
  }

  /* ---------- mapa ---------- */
  var current = 'circuitos';
  var map = new GigaMap('#map', {
    geo: GEO, mode: 'heat', metric: METRICS.circuitos, categories: TECH, labels: true,
    tooltip: function (i) {
      var box = document.createElement('div'), b = document.createElement('strong');
      b.textContent = i.nome + (i.level === 'uf' ? ' · ' + i.uf : ''); box.appendChild(b);
      var r = i.raw || {};
      var line = function (t) { var d = document.createElement('div'); d.textContent = t; box.appendChild(d); };
      if (i.level === 'uf') {
        if (r.circuitos !== undefined) {
          line('Circuitos: ' + nf(r.circuitos));
          if (current !== 'circuitos' && Number.isFinite(i.value)) line(METRICS[current].label + ': ' + METRICS[current].format(i.value));
        } else if (Number.isFinite(i.value)) line(METRICS[current].label + ': ' + METRICS[current].format(i.value));
        else if (i.category != null) line(TECH[i.category].label);
        else line('Sem circuitos');
      } else {
        var s = ufTotals(i.id);
        if (s.circuitos) { line('Circuitos: ' + nf(s.circuitos) + ' · Clientes: ' + nf(s.clientes)); line('Municípios atendidos: ' + s.n); }
        else line('Sem circuitos');
      }
      return box;
    }
  });
  map.setData(dataFor('circuitos'));

  function ufTotals(uf) {
    var s = { circuitos: 0, clientes: 0, tickets: 0, n: 0, slaW: 0 };
    Object.keys(MOCK).forEach(function (id) {
      if (GigaMap.UF_BY_CODE[id.slice(0, 2)] !== uf) return;
      var m = MOCK[id]; s.circuitos += m.circuitos; s.clientes += m.clientes; s.tickets += m.tickets; s.n++; s.slaW += m.sla * m.circuitos;
    });
    s.sla = s.circuitos ? s.slaW / s.circuitos : 0;
    return s;
  }

  /* ---------- UI ---------- */
  var sel = $('#metric');
  Object.keys(METRICS).forEach(function (k) { var o = document.createElement('option'); o.value = k; o.textContent = METRICS[k].label; sel.appendChild(o); });
  sel.addEventListener('change', function () {
    current = sel.value;
    var m = METRICS[current];
    map.setMetric(m.mode ? { mode: 'category', label: m.label } : Object.assign({ mode: 'heat' }, m), true);
    map.setData(dataFor(current));
    renderSide();
  });

  var crumb = $('#crumb');
  function renderCrumb() {
    crumb.textContent = '';
    var a = document.createElement('button'); a.type = 'button'; a.className = 'crumb-btn'; a.textContent = 'Brasil';
    a.addEventListener('click', function () { map.showBrasil(); });
    crumb.appendChild(a);
    if (map.view.level === 'uf') { var s = document.createElement('span'); s.textContent = ' › ' + map.view.view; crumb.appendChild(s); }
  }

  map.on('navigate', function () { renderCrumb(); renderSide(); refreshPoints(); });
  map.on('select', function (i) { if (i && i.level === 'uf') showDetail(i); else if (!i) renderSide(); });

  /* ---------- painel lateral ---------- */
  var side = $('#side');
  function h(tag, cls, parent, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; if (parent) parent.appendChild(n); return n; }

  function kpis(parent, s) {
    var g = h('div', 'kpis', parent);
    [['Circuitos', nf(s.circuitos)], ['Clientes', nf(s.clientes)], ['Tickets abertos', nf(s.tickets)], ['SLA estourado', s.sla.toFixed(1).replace('.', ',') + '%']].forEach(function (k) {
      var c = h('div', 'kpi', g); h('div', 'kpi-v', c, k[1]); h('div', 'kpi-l', c, k[0]);
    });
  }

  function renderSide() {
    side.textContent = '';
    var v = map.view, ids = Object.keys(map.byId), tot = { circuitos: 0, clientes: 0, tickets: 0, slaW: 0, n: 0 };
    if (v.level === 'uf') {
      ids.forEach(function (id) { var m = MOCK[id]; if (m) { tot.circuitos += m.circuitos; tot.clientes += m.clientes; tot.tickets += m.tickets; tot.slaW += m.sla * m.circuitos; tot.n++; } });
    } else {
      Object.keys(MOCK).forEach(function (id) { var m = MOCK[id]; tot.circuitos += m.circuitos; tot.clientes += m.clientes; tot.tickets += m.tickets; tot.slaW += m.sla * m.circuitos; tot.n++; });
    }
    tot.sla = tot.circuitos ? tot.slaW / tot.circuitos : 0;
    h('h2', null, side, v.level === 'uf' ? 'Estado: ' + v.view : 'Brasil');
    h('p', 'muted', side, tot.n + ' municípios com circuitos' + (v.level === 'uf' ? ' de ' + ids.length : ''));
    kpis(side, tot);

    h('h3', null, side, v.level === 'uf' ? 'Top municípios' : 'Top estados');
    var rows = [];
    if (v.level === 'uf') ids.forEach(function (id) { if (MOCK[id]) rows.push({ id: id, nome: map.byId[id].f.nome, v: MOCK[id].circuitos }); });
    else Object.keys(GEO.ufs).forEach(function (uf) { var s = ufTotals(uf); if (s.circuitos) rows.push({ id: uf, nome: uf, v: s.circuitos }); });
    rows.sort(function (a, b) { return b.v - a.v; });
    var max = rows.length ? rows[0].v : 1, ol = h('ol', 'rank', side);
    rows.slice(0, 10).forEach(function (r) {
      var li = h('li', null, ol), b = h('button', 'rank-btn', li); b.type = 'button';
      h('span', 'rank-n', b, r.nome); h('span', 'rank-v', b, nf(r.v));
      var bar = h('span', 'rank-bar', b); bar.style.width = Math.max(3, r.v / max * 100) + '%';
      b.addEventListener('click', function () { v.level === 'uf' ? (map.select(r.id, { zoom: true })) : map.showUF(r.id); });
    });
    h('p', 'note', side, 'Dados fictícios gerados para demonstração. Em produção, a chave de junção é o código IBGE do município.');
  }

  function showDetail(i) {
    side.textContent = '';
    var back = h('button', 'link', side, '← voltar ao ranking'); back.type = 'button';
    back.addEventListener('click', function () { map.clearSelection(); });
    h('h2', null, side, i.nome); h('p', 'muted', side, i.uf + ' · código IBGE ' + i.id);
    var m = MOCK[i.id];
    if (!m) { h('p', null, side, 'Nenhum circuito neste município.'); return; }
    kpis(side, { circuitos: m.circuitos, clientes: m.clientes, tickets: m.tickets, sla: m.sla });
    h('h3', null, side, 'Circuitos por tecnologia');
    var wrap = h('div', 'mix', side);
    m.mix.filter(function (x) { return x.n > 0; }).forEach(function (x) {
      var row = h('div', 'mix-row', wrap); h('span', 'mix-l', row, TECH[x.k].label);
      var track = h('span', 'mix-track', row), bar = h('span', 'mix-bar', track);
      bar.style.width = (x.n / m.circuitos * 100) + '%'; bar.style.background = TECH[x.k].color;
      h('span', 'mix-n', row, nf(x.n));
    });
    h('h3', null, side, 'Principais clientes (fictício)');
    var ol = h('ol', 'rank', side), rr = mulberry32(parseInt(i.id, 10)), left = m.circuitos;
    ['Cliente Alfa S.A.', 'Rede Beta Ltda', 'Gama Serviços', 'Delta Comércio'].slice(0, Math.min(4, m.clientes)).forEach(function (nome) {
      var n = Math.max(1, Math.round(left * (0.3 + rr() * 0.3))); left = Math.max(0, left - n);
      var li = h('li', null, ol), row = h('div', 'rank-btn static', li); h('span', 'rank-n', row, nome); h('span', 'rank-v', row, nf(n) + ' circ.');
    });
  }

  /* ---------- busca ---------- */
  var q = $('#q'), dl = $('#dl');
  q.addEventListener('input', function () {
    var n = GigaMap.normalize(q.value); dl.textContent = '';
    if (n.length < 2) return;
    NAMES.filter(function (x) { return x.key.indexOf(n) >= 0; }).slice(0, 12).forEach(function (x) {
      var o = document.createElement('option'); o.value = x.nome + ' — ' + x.uf; dl.appendChild(o);
    });
  });
  q.addEventListener('change', function () {
    var m = q.value.match(/^(.*) — ([A-Z]{2})$/); if (!m) return;
    var hit = NAMES.filter(function (x) { return x.nome === m[1] && x.uf === m[2]; })[0]; if (!hit) return;
    (map.view.view === hit.uf ? Promise.resolve() : map.showUF(hit.uf)).then(function () { map.select(hit.id, { zoom: true }); showDetail(map._info(hit.id)); });
    q.value = '';
  });

  /* ---------- pontos (circuitos individuais, demo) ---------- */
  var chk = $('#pts');
  function refreshPoints() {
    map.clearPoints();
    if (!chk.checked || map.view.level !== 'uf') return;
    var p = map.view.projection, pts = [], r = mulberry32(7), budget = 3500;
    var inv = function (x, y) { return { lon: (x - p.pad) / (p.k * p.s) + p.lon_min, lat: p.lat_max - (y - p.pad) / p.s }; };
    Object.keys(map.byId).forEach(function (id) {
      var m = MOCK[id]; if (!m || budget <= 0) return;
      var rec = map.byId[id], b = rec.f.bbox, n = Math.min(m.circuitos, 14), tries = 0;
      while (n > 0 && tries++ < 80) {
        var x = b[0] + r() * (b[2] - b[0]), y = b[1] + r() * (b[3] - b[1]);
        if (rec.node.isPointInFill(new DOMPoint(x, y))) { var ll = inv(x, y); pts.push({ lat: ll.lat, lon: ll.lon, color: TECH[techKeys[Math.floor(r() * techKeys.length)]].color, label: rec.f.nome }); n--; budget--; }
      }
    });
    map.addPoints(pts, { radius: 2.6, opacity: 0.9 });
  }
  chk.addEventListener('change', refreshPoints);

  renderCrumb(); renderSide();
  window.__map = map; // útil p/ depurar no console
})();
