/* Tela do painel de movimentações do WMS (27/10/2026). Regras em
   shared/painel-movimentos.js; aqui só o desenho e os cliques.

   Lê movimentos_estoque inteiro (~1 MB, o mesmo que o Kardex já carrega) e
   só quando a aba abre pela primeira vez. Fica ao vivo: movimento novo
   aparece sem recarregar.

   Tudo filtra tudo: indicador liga/desliga a natureza, barra do dia fixa o
   dia, barra do ranking fixa endereço/item/pessoa; os filtros fixados
   aparecem como etiquetas com ✕. A linha do tempo é a visão em tabela do
   gráfico (cores nunca são a única pista: ícone + rótulo em cada linha). */
(function(root) {
  'use strict';
  var P = root.PainelMovimentos;
  var PERIODOS = [{d: 1, r: 'Hoje'}, {d: 7, r: '7 dias'}, {d: 30, r: '30 dias'}, {d: 90, r: '90 dias'}, {d: 0, r: 'Tudo'}];
  var LIMITE_PASSO = 150;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; });
  }
  function fmt(n) { return Number(n || 0).toLocaleString('pt-BR', {maximumFractionDigits: 3}); }
  function hojeLocal() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function diaCurto(dia) { return dia ? dia.slice(8, 10) + '/' + dia.slice(5, 7) : ''; }
  function diaLongo(dia) {
    if (!dia) return 'Sem data';
    var hoje = hojeLocal(), ontem = new Date(Date.parse(hoje + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    var sem = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(dia + 'T12:00:00Z').getUTCDay()];
    var base = diaCurto(dia) + '/' + dia.slice(0, 4);
    return dia === hoje ? 'Hoje, ' + base : dia === ontem ? 'Ontem, ' + base : sem.charAt(0).toUpperCase() + sem.slice(1) + ', ' + base;
  }
  function hora(iso) { var t = Date.parse(iso); return isFinite(t) ? new Date(t).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : ''; }
  function plural(n, um, varios) { return fmt(n) + ' ' + (n === 1 ? um : varios); }

  function iniciar(o) {
    var box = o.container, db = o.db, kardexUrl = o.kardexUrl || 'kardex.html';
    var st = {dias: 7, naturezas: {}, busca: '', itemTipo: '', espelho: false, dia: '', endereco: '', item: '', autor: '', limite: LIMITE_PASSO};
    var todos = [], carregado = false, atualizadoEm = null;

    box.classList.add('pm-root');
    box.innerHTML =
      '<div class="pm-barra">' +
        '<div class="pm-periodos" role="group" aria-label="Período">' + PERIODOS.map(function(p) {
          return '<button type="button" class="pm-chip" data-dias="' + p.d + '">' + p.r + '</button>';
        }).join('') + '</div>' +
        '<input type="search" class="pm-busca" id="pmBusca" placeholder="Buscar item, lote, endereço, OP, pessoa..." aria-label="Buscar movimentos">' +
        '<select class="pm-select" id="pmTipoItem" aria-label="Tipo de item"><option value="">Material e produto</option><option value="material">Só materiais</option><option value="produto">Só produto acabado</option></select>' +
        '<label class="pm-check" title="A baixa por lote (FEFO) repete o consumo de produção: ligue para ver de qual lote e endereço saiu"><input type="checkbox" id="pmEspelho"> Baixas por lote</label>' +
        '<span class="pm-vivo" id="pmVivo"><span class="pm-vivo-dot"></span>Carregando…</span>' +
        '<button type="button" class="pm-btn" id="pmExportar">⬇ Exportar</button>' +
      '</div>' +
      '<div class="pm-fixados" id="pmFixados"></div>' +
      '<div class="pm-kpis" id="pmKpis"></div>' +
      '<div class="pm-card pm-grafico-card">' +
        '<div class="pm-card-cab"><div><div class="pm-titulo">Movimentos por dia</div><div class="pm-sub" id="pmGrafSub"></div></div>' +
        '<div class="pm-legenda" id="pmLegenda"></div></div>' +
        '<div class="pm-grafico" id="pmGrafico"></div><div class="pm-tooltip" id="pmTooltip" role="tooltip"></div>' +
      '</div>' +
      '<div class="pm-rankings">' +
        '<div class="pm-card"><div class="pm-titulo">Endereços mais movimentados</div><div class="pm-sub">transferência conta na origem e no destino</div><div id="pmRankEnd"></div></div>' +
        '<div class="pm-card"><div class="pm-titulo">Itens mais movimentados</div><div class="pm-sub">clique para ver só o item</div><div id="pmRankItem"></div></div>' +
        '<div class="pm-card"><div class="pm-titulo">Quem movimentou</div><div class="pm-sub">"Automático" = gravado pelo apontamento</div><div id="pmRankAutor"></div></div>' +
      '</div>' +
      '<div class="pm-card"><div class="pm-card-cab"><div><div class="pm-titulo">Linha do tempo</div><div class="pm-sub">clique num movimento para abrir o Kardex do item</div></div></div><div id="pmLinha"></div></div>';

    var $ = function(id) { return box.querySelector('#' + id); };

    function filtroAtual() {
      var per = st.dia ? {de: st.dia, ate: st.dia} : P.periodo(st.dias, hojeLocal());
      return {de: per.de, ate: per.ate, naturezas: st.naturezas, busca: st.busca, itemTipo: st.itemTipo,
        espelho: st.espelho, endereco: st.endereco, item: st.item, autor: st.autor};
    }

    function render() {
      box.querySelectorAll('[data-dias]').forEach(function(b) {
        var on = !st.dia && Number(b.dataset.dias) === st.dias;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (!carregado) return;
      var f = filtroAtual();
      var lista = P.filtrar(todos, f);
      // Indicadores e gráfico ignoram o filtro de natureza (senão os desligados
      // sumiriam e não daria para religar), mas respeitam todo o resto.
      var semNat = P.filtrar(todos, Object.assign({}, f, {naturezas: {}}));
      var perEixo = st.dia ? {de: st.dia, ate: st.dia} : P.periodo(st.dias, hojeLocal());
      var rSemNat = P.resumo(semNat, perEixo.de ? perEixo : null);
      // Cada ranking ignora o PRÓPRIO filtro (dá para trocar de endereço sem
      // soltar antes) e respeita todos os outros.
      function semCampo(campo) { var g = Object.assign({}, f); g[campo] = ''; return P.resumo(P.filtrar(todos, g), null); }
      renderFixados();
      renderKpis(rSemNat);
      renderGrafico(rSemNat);
      renderRanking('pmRankEnd', semCampo('endereco').enderecos, 'endereco');
      renderRanking('pmRankItem', semCampo('item').itensTop, 'item');
      renderRanking('pmRankAutor', semCampo('autor').autores, 'autor');
      renderLinha(lista);
    }

    function natsAtivas() { return Object.keys(st.naturezas).filter(function(k) { return st.naturezas[k]; }); }
    function natLigada(k) { var a = natsAtivas(); return !a.length || a.indexOf(k) >= 0; }

    function renderFixados() {
      var chips = [];
      if (st.dia) chips.push(['dia', 'Dia ' + diaCurto(st.dia)]);
      if (st.endereco) chips.push(['endereco', 'Endereço ' + st.endereco]);
      if (st.item) chips.push(['item', 'Item ' + st.item]);
      if (st.autor) chips.push(['autor', 'Por ' + st.autor]);
      $('pmFixados').innerHTML = chips.length ? '<span class="pm-sub">Filtrando:</span>' + chips.map(function(c) {
        return '<button type="button" class="pm-fixo" data-soltar="' + c[0] + '" title="Tirar este filtro">' + esc(c[1]) + ' <span aria-hidden="true">✕</span></button>';
      }).join('') + (chips.length > 1 ? '<button type="button" class="pm-link" data-soltar="tudo">limpar tudo</button>' : '') : '';
    }

    function renderKpis(r) {
      var ativas = natsAtivas();
      $('pmKpis').innerHTML =
        '<div class="pm-kpi pm-kpi-total"><div class="pm-kpi-rot">Movimentos</div><div class="pm-kpi-val">' + fmt(r.total) + '</div>' +
        '<div class="pm-kpi-sub">' + plural(r.itens, 'item', 'itens') + (r.picoDia && r.picoDia.total ? ' · pico ' + diaCurto(r.picoDia.dia) + ' (' + fmt(r.picoDia.total) + ')' : '') + '</div></div>' +
        r.naturezas.map(function(n) {
          var on = ativas.indexOf(n.k) >= 0, apagado = ativas.length && !on;
          return '<button type="button" class="pm-kpi pm-kpi-nat' + (on ? ' on' : '') + (apagado ? ' off' : '') + (n.n ? '' : ' zero') + '" data-nat="' + n.k + '" aria-pressed="' + (on ? 'true' : 'false') + '" title="' + (on ? 'Mostrar todas as naturezas' : 'Ver só ' + esc(n.rotulo.toLowerCase())) + '">' +
            '<div class="pm-kpi-rot"><span class="pm-ico pm-s' + n.slot + '" aria-hidden="true">' + n.icone + '</span>' + esc(n.rotulo) + '</div>' +
            '<div class="pm-kpi-val">' + fmt(n.n) + '</div><div class="pm-kpi-sub">' + plural(n.itens, 'item', 'itens') + '</div></button>';
        }).join('');
    }

    function renderLegenda() {
      $('pmLegenda').innerHTML = P.NATUREZAS.map(function(n) {
        return '<span class="pm-leg' + (natLigada(n.k) ? '' : ' off') + '"><span class="pm-sw pm-s' + n.slot + '"></span>' + esc(n.rotulo) + '</span>';
      }).join('');
    }

    var serieAtual = [];
    function renderGrafico(r) {
      renderLegenda();
      serieAtual = r.serie;
      var g = $('pmGrafico');
      var total = r.serie.reduce(function(s, d) { return s + d.total; }, 0);
      $('pmGrafSub').textContent = r.serie.length ? plural(total, 'movimento', 'movimentos') + ' em ' + plural(r.serie.length, 'dia', 'dias') +
        (r.serie.length > 1 ? ' · clique numa barra para ver só o dia' : '') : '';
      if (!r.serie.length || !total) { g.innerHTML = '<div class="pm-vazio">Nenhum movimento no período.</div>'; return; }
      var W = Math.max(g.clientWidth || 600, 280), H = 210, padL = 34, padR = 6, padT = 10, padB = 24;
      var maxV = 0;
      r.serie.forEach(function(d) {
        var v = P.NATUREZAS.reduce(function(s, n) { return s + (natLigada(n.k) ? d.porNat[n.k] : 0); }, 0);
        if (v > maxV) maxV = v;
      });
      var passo = escalaPasso(maxV || 1), topo = Math.ceil((maxV || 1) / passo) * passo;
      var plotW = W - padL - padR, plotH = H - padT - padB, n = r.serie.length;
      var slot = plotW / n, barW = Math.max(2, Math.min(28, slot * 0.72));
      var y = function(v) { return padT + plotH - v / topo * plotH; };
      var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Movimentos por dia, empilhados por natureza">';
      for (var t = 0; t <= topo; t += passo) {
        svg += '<line class="pm-grade" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>' +
          '<text class="pm-eixo" x="' + (padL - 6) + '" y="' + (y(t) + 3.5) + '" text-anchor="end">' + fmt(t) + '</text>';
      }
      var cadaRotulo = Math.max(1, Math.ceil(46 / slot));
      r.serie.forEach(function(d, i) {
        var cx = padL + slot * i + slot / 2, x = cx - barW / 2, base = padT + plotH;
        var segs = P.NATUREZAS.filter(function(nn) { return natLigada(nn.k) && d.porNat[nn.k] > 0; });
        segs.forEach(function(nn, j) {
          var h = d.porNat[nn.k] / topo * plotH, topoSeg = base - h;
          var gap = j < segs.length - 1 && h > 3 ? 2 : 0; // 2px de superfície entre segmentos
          var hh = Math.max(h - gap, 1);
          svg += j === segs.length - 1
            ? '<path class="pm-s' + nn.slot + '" d="' + topoArredondado(x, topoSeg, barW, hh, Math.min(4, barW / 2, hh)) + '"/>'
            : '<rect class="pm-s' + nn.slot + '" x="' + x + '" y="' + (topoSeg + gap) + '" width="' + barW + '" height="' + hh + '"/>';
          base = topoSeg;
        });
        // Rótulo a cada N dias, contado a partir do ÚLTIMO (hoje sempre aparece).
        if ((n - 1 - i) % cadaRotulo === 0) {
          svg += '<text class="pm-eixo" x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle">' + diaCurto(d.dia) + '</text>';
        }
        svg += '<rect class="pm-alvo" data-i="' + i + '" x="' + (padL + slot * i) + '" y="' + padT + '" width="' + slot + '" height="' + plotH + '"/>';
      });
      svg += '<line class="pm-base" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + plotH) + '" y2="' + (padT + plotH) + '"/></svg>';
      g.innerHTML = svg;
    }
    function escalaPasso(max) {
      var bruto = max / 4, mag = Math.pow(10, Math.floor(Math.log10(bruto))), r = bruto / mag;
      return Math.max(1, (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag);
    }
    function topoArredondado(x, y, w, h, r) {
      return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
    }

    function mostrarTooltip(i, ev) {
      var d = serieAtual[i], tip = $('pmTooltip');
      if (!d) return;
      var linhas = P.NATUREZAS.filter(function(n) { return natLigada(n.k) && d.porNat[n.k]; }).map(function(n) {
        return '<div class="pm-tip-l"><span class="pm-sw pm-s' + n.slot + '"></span>' + esc(n.rotulo) + '<b>' + fmt(d.porNat[n.k]) + '</b></div>';
      }).join('');
      var tot = P.NATUREZAS.reduce(function(s, n) { return s + (natLigada(n.k) ? d.porNat[n.k] : 0); }, 0);
      tip.innerHTML = '<div class="pm-tip-t">' + esc(diaLongo(d.dia)) + '</div>' + (linhas || '<div class="pm-sub">Sem movimentos</div>') +
        (tot ? '<div class="pm-tip-tot">Total <b>' + fmt(tot) + '</b></div>' : '');
      var card = box.querySelector('.pm-grafico-card').getBoundingClientRect();
      tip.style.display = 'block';
      var x = ev.clientX - card.left + 14, yy = ev.clientY - card.top + 10;
      if (x + tip.offsetWidth > card.width - 8) x = ev.clientX - card.left - tip.offsetWidth - 14;
      tip.style.left = Math.max(8, x) + 'px'; tip.style.top = yy + 'px';
      box.querySelectorAll('.pm-alvo.on').forEach(function(a) { a.classList.remove('on'); });
      var alvo = box.querySelector('.pm-alvo[data-i="' + i + '"]'); if (alvo) alvo.classList.add('on');
    }

    function renderRanking(id, itens, campo) {
      var el = $(id);
      if (!itens.length) { el.innerHTML = '<div class="pm-vazio pm-vazio-p">Nada no filtro.</div>'; return; }
      var max = itens[0].n;
      el.innerHTML = '<ol class="pm-rank">' + itens.map(function(x) {
        var on = st[campo] === x.chave;
        return '<li><button type="button" class="pm-rank-b' + (on ? ' on' : '') + '" data-fixar="' + campo + '" data-valor="' + esc(x.chave) + '" title="' + (on ? 'Tirar o filtro' : 'Filtrar por ' + esc(x.rotulo)) + '">' +
          '<span class="pm-rank-r">' + esc(x.rotulo) + '</span><span class="pm-rank-n">' + fmt(x.n) + '</span>' +
          '<span class="pm-rank-trilho"><span class="pm-rank-barra" style="width:' + Math.max(2, x.n / max * 100).toFixed(1) + '%"></span></span></button></li>';
      }).join('') + '</ol>';
    }

    function renderLinha(lista) {
      var el = $('pmLinha');
      if (!lista.length) { el.innerHTML = '<div class="pm-vazio">Nenhum movimento com esses filtros.</div>'; return; }
      var visiveis = lista.slice(0, st.limite);
      el.innerHTML = P.porDia(visiveis).map(function(g) {
        var noDia = lista.filter(function(e) { return e.dia === g.dia; }).length;
        return '<div class="pm-dia"><div class="pm-dia-cab">' + esc(diaLongo(g.dia)) + '<span>' + plural(noDia, 'movimento', 'movimentos') + '</span></div>' +
          g.eventos.map(linhaEvento).join('') + '</div>';
      }).join('') +
      (lista.length > visiveis.length ? '<button type="button" class="pm-btn pm-mais" id="pmMais">Mostrar mais ' + fmt(Math.min(LIMITE_PASSO, lista.length - visiveis.length)) +
        ' (de ' + fmt(lista.length - visiveis.length) + ' restantes)</button>' : '');
    }
    function linhaEvento(e) {
      var nat = P.POR_K[e.natureza];
      var sinal = e.qtd > 0 ? '+' : '';
      var qtd = e.natureza === 'QUALIDADE' ? '' : (e.natureza === 'TRANSFERENCIA' ? fmt(Math.abs(e.qtd)) : sinal + fmt(e.qtd)) + (e.qtd || e.natureza !== 'TRANSFERENCIA' ? ' ' + esc(e.unidade) : '');
      if (e.natureza === 'TRANSFERENCIA' && !e.qtd) qtd = 'palete inteiro';
      var onde = e.de ? '<span class="pm-end">' + esc(e.de) + '</span> → <span class="pm-end">' + esc(e.para) + '</span>'
        : (e.endereco ? '<span class="pm-end">' + esc(e.endereco) + '</span>' : '');
      var lote = e.lote && e.lote.charAt(0) !== '-' ? 'lote ' + esc(e.lote) : '';
      var ref = e.opKey || (e.ref && !e.de && e.ref.length <= 40 && e.ref.charAt(0) !== '-' ? e.ref : '');
      var href = kardexUrl + '?item=' + encodeURIComponent(e.codigo);
      return '<a class="pm-ev' + (e.espelho ? ' pm-ev-espelho' : '') + '" href="' + esc(href) + '">' +
        '<span class="pm-ev-hora">' + hora(e.em) + '</span>' +
        '<span class="pm-ico pm-s' + nat.slot + '" title="' + esc(nat.rotulo) + '" aria-hidden="true">' + nat.icone + '</span>' +
        '<span class="pm-ev-corpo"><span class="pm-ev-item"><b>' + esc(e.codigo) + '</b> ' + esc(e.nome) + '</span>' +
          '<span class="pm-ev-det">' + esc(e.tipoRotulo) + (ref ? ' · ' + esc(ref) : '') + (lote ? ' · ' + lote : '') + (onde ? ' · ' + onde : '') + '</span></span>' +
        '<span class="pm-ev-qtd' + (e.qtd < 0 && e.natureza !== 'TRANSFERENCIA' ? ' neg' : '') + '">' + qtd + '</span>' +
        '<span class="pm-ev-quem">' + esc(e.autor) + '</span></a>';
    }

    // ── Eventos ───────────────────────────────────────────────────────
    box.addEventListener('click', function(ev) {
      var b;
      if ((b = ev.target.closest('[data-dias]'))) { st.dias = Number(b.dataset.dias); st.dia = ''; st.limite = LIMITE_PASSO; render(); return; }
      if ((b = ev.target.closest('[data-nat]'))) {
        var k = b.dataset.nat, unica = natsAtivas().length === 1 && st.naturezas[k];
        st.naturezas = unica ? {} : (function() { var o = {}; o[k] = true; return o; })();
        st.limite = LIMITE_PASSO; render(); return;
      }
      if ((b = ev.target.closest('[data-fixar]'))) {
        var campo = b.dataset.fixar;
        st[campo] = st[campo] === b.dataset.valor ? '' : b.dataset.valor;
        st.limite = LIMITE_PASSO; render(); return;
      }
      if ((b = ev.target.closest('[data-soltar]'))) {
        if (b.dataset.soltar === 'tudo') { st.dia = st.endereco = st.item = st.autor = ''; } else st[b.dataset.soltar] = '';
        st.limite = LIMITE_PASSO; render(); return;
      }
      if ((b = ev.target.closest('.pm-alvo'))) {
        var d = serieAtual[Number(b.dataset.i)];
        if (d && serieAtual.length > 1) { st.dia = d.dia; st.limite = LIMITE_PASSO; $('pmTooltip').style.display = 'none'; render(); }
        return;
      }
      if (ev.target.closest('#pmMais')) { st.limite += LIMITE_PASSO; render(); return; }
      if (ev.target.closest('#pmExportar')) exportar();
    });
    var grafico = $('pmGrafico');
    grafico.addEventListener('mousemove', function(ev) {
      var a = ev.target.closest('.pm-alvo');
      if (a) mostrarTooltip(Number(a.dataset.i), ev); else esconderTip();
    });
    grafico.addEventListener('mouseleave', esconderTip);
    function esconderTip() {
      $('pmTooltip').style.display = 'none';
      box.querySelectorAll('.pm-alvo.on').forEach(function(a) { a.classList.remove('on'); });
    }
    var tBusca = null;
    $('pmBusca').addEventListener('input', function() {
      clearTimeout(tBusca);
      tBusca = setTimeout(function() { st.busca = $('pmBusca').value; st.limite = LIMITE_PASSO; render(); }, 180);
    });
    $('pmTipoItem').addEventListener('change', function() { st.itemTipo = this.value; st.limite = LIMITE_PASSO; render(); });
    $('pmEspelho').addEventListener('change', function() { st.espelho = this.checked; st.limite = LIMITE_PASSO; render(); });
    if (typeof ResizeObserver === 'function') {
      var largura = 0;
      new ResizeObserver(function() {
        var w = grafico.clientWidth;
        if (carregado && w && Math.abs(w - largura) > 20) { largura = w; render(); }
      }).observe(grafico);
    }

    function exportar() {
      var lista = P.filtrar(todos, filtroAtual());
      if (!lista.length) return;
      var blob = new Blob(['﻿' + P.csv(lista)], {type: 'text/csv;charset=utf-8'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'movimentacoes-wms-' + hojeLocal() + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    }

    function marcarVivo() {
      var el = $('pmVivo');
      el.innerHTML = '<span class="pm-vivo-dot on"></span>Ao vivo · ' + (atualizadoEm ? atualizadoEm.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'}) : '');
      el.title = 'Movimento novo aparece aqui sem recarregar a página';
    }

    render();
    function aoChegar(snap) {
      todos = P.eventos(snap.val() || {}, {fusoMin: new Date().getTimezoneOffset()});
      carregado = true; atualizadoEm = new Date();
      marcarVivo();
      render();
    }
    function aoFalhar(err) { $('pmVivo').textContent = 'Sem acesso aos movimentos: ' + (err && err.message || err); }
    // dbOnValue (shared/utils.js) tenta de novo na corrida do login ao abrir a página já nesta aba.
    if (typeof root.dbOnValue === 'function') root.dbOnValue(db.ref('movimentos_estoque'), aoChegar, {onError: aoFalhar});
    else db.ref('movimentos_estoque').on('value', aoChegar, aoFalhar);
    return {render: render, estado: st};
  }

  root.PainelMovimentosTela = {iniciar: iniciar};
})(typeof globalThis !== 'undefined' ? globalThis : this);
