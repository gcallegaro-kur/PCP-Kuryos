'use strict';
/* O que comprar -- tela. Regras em shared/necessidade-pedidos.js (puro, testado em
   run_necessidade_pedidos_test.js). Aqui só lê o banco, desenha, e (única escrita)
   cria a solicitação de compra com o que FALTA. */
(function() {
  var db = firebase.database();
  var NP = NecessidadePedidos;
  var D = {pedidos: null, produtos: null, formulas: null, bom: null, materiais: null, estoque: null, ops: null, pedidosCompra: null, solicitacoes: null};
  var abertos = [], diag = {}, res = null;
  var S = {q: '', cli: '', sel: [], ordem: [], estado: '', qm: '', abertoMat: {}, mostrarPed: 60};

  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function fmt(n, un) {
    var v = num(n), c = (un === 'kg' || un === 'l' || un === 'g') ? 3 : 2;
    return v.toLocaleString('pt-BR', {maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : c});
  }
  function dataBR(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—'; }
  function norm(s) { return NP.norm(s); }
  function plural(n, a, b) { return n === 1 ? a : b; }

  var COR = {coberto: 'var(--c-est)', caminho: 'var(--c-cam)', andamento: 'var(--c-and)', falta: 'var(--c-fal)'};
  var ROT = {coberto: 'Coberto pelo estoque', caminho: 'Coberto, aguardando chegada', andamento: 'Já em compra', falta: 'Falta comprar'};
  var TIPOS = {MPGR: 'Matéria-prima', MPES: 'Fragrância/essência', EP: 'Embalagem primária', ES: 'Embalagem secundária', ET: 'Embalagem terciária', MU: 'Uso e consumo'};

  /* ── URL: o link guarda os pedidos escolhidos ── */
  function lerUrl() {
    var p = new URLSearchParams(location.search).get('p');
    if (p) S.sel = p.split(',').filter(Boolean);
    S.ordem = S.sel.slice();
  }
  function gravarUrl() {
    try { history.replaceState(null, '', S.sel.length ? '?p=' + S.sel.map(encodeURIComponent).join(',') : location.pathname); } catch (x) { /* ok */ }
  }

  function pronto() { for (var k in D) if (D[k] == null) return false; return true; }
  var t0 = null;
  function agendar() { clearTimeout(t0); t0 = setTimeout(recalcular, 60); }

  function fnApp() {
    return {explodir: explodirMateriaisNecessarios, melhorFormula: melhorFormulaDoProduto, chaveVersao: chaveVersao, bomDaVersao: bomDaVersao, semControle: materialSemControleEstoque};
  }
  function base(sel, ordem) {
    return {pedidos: D.pedidos, selecionados: sel, ordem: ordem, produtos: D.produtos, formulas: D.formulas, bom: D.bom, materiais: D.materiais, estoque: D.estoque,
      ops: D.ops, pedidosCompra: D.pedidosCompra, solicitacoes: D.solicitacoes, fn: fnApp(), PE: PropriedadeEstoque};
  }
  function recalcular() {
    if (!pronto()) return;
    abertos = NP.pedidosAbertos(D.pedidos, isConcluido);
    // Diagnóstico de todos os pedidos abertos: quais não dá para calcular e por quê.
    diag = {};
    NP.calcular(base(abertos.map(function(p) { return p.key; }), null)).pedidos.forEach(function(p) { diag[p.key] = {ok: p.ok, erro: p.erro, semAprovada: p.semAprovada}; });
    var validas = {}; abertos.forEach(function(p) { validas[p.key] = 1; });
    S.sel = S.sel.filter(function(k) { return validas[k]; });
    S.ordem = S.ordem.filter(function(k) { return validas[k]; });
    S.sel.forEach(function(k) { if (S.ordem.indexOf(k) < 0) S.ordem.push(k); });
    el('sDot').classList.add('on'); el('sTxt').textContent = 'Ao vivo';
    render();
  }

  /* ── Passo 1: escolha de pedidos ── */
  function renderEscolha() {
    var clis = {}; abertos.forEach(function(p) { if (p.cliente) clis[p.cliente] = 1; });
    var htmlC = '<option value="">Todos os clientes</option>' + Object.keys(clis).sort().map(function(c) { return '<option value="' + e(c) + '"' + (S.cli === c ? ' selected' : '') + '>' + e(c) + '</option>'; }).join('');
    if (el('fCli').getAttribute('data-h') !== htmlC) { el('fCli').innerHTML = htmlC; el('fCli').setAttribute('data-h', htmlC); }
    var toks = norm(S.q).split(' ').filter(Boolean);
    var lista = abertos.filter(function(p) {
      if (S.cli && p.cliente !== S.cli) return false;
      var alvo = norm([p.id, p.sku, p.produto, p.cliente].join(' '));
      return toks.every(function(t) { return alvo.indexOf(t) >= 0; });
    });
    // Os que dá para calcular vêm primeiro; os sem cadastro completo ficam no fim (mesma ordem dentro de cada grupo).
    lista = lista.filter(function(p) { return (diag[p.key] || {}).ok !== false; }).concat(lista.filter(function(p) { return (diag[p.key] || {}).ok === false; }));
    window.__visiveis = lista.filter(function(p) { return (diag[p.key] || {}).ok !== false; }).map(function(p) { return p.key; });
    var corte = lista.slice(0, S.mostrarPed);
    el('pgrade').innerHTML = corte.length ? corte.map(function(p) {
      var d = diag[p.key] || {}, on = S.sel.indexOf(p.key) >= 0;
      return '<button type="button" class="pc' + (on ? ' on' : '') + (d.ok === false ? ' nao' : '') + '" data-k="' + e(p.key) + '" aria-pressed="' + on + '">' +
        '<b>Pedido ' + e(p.id) + '</b> <span class="mut" style="color:var(--ink-mute);font-size:12px">· ' + e(p.sku) + '</span>' +
        '<div class="l">' + e(p.produto) + '</div><div class="l">' + e(p.cliente) + '</div>' +
        '<div class="m"><span>' + fmt(p.saldo) + ' un a produzir</span><span>' + (p.entrega ? 'entrega ' + dataBR(p.entrega) : 'sem data') + '</span>' + (p.prioridade != null ? '<span>prio ' + p.prioridade + '</span>' : '') + '</div>' +
        (d.ok === false ? '<div style="margin-top:5px"><span class="tg mute" title="' + e(d.erro) + '">⚠ não dá para calcular</span></div>' : '') + '</button>';
    }).join('') + (lista.length > corte.length ? '<button type="button" class="btn" id="btnMaisPed" style="grid-column:1/-1">Mostrar mais (' + (lista.length - corte.length) + ')</button>' : '') :
      '<div class="vazio" style="grid-column:1/-1"><b>Nenhum pedido encontrado</b>Só aparecem pedidos em aberto, com saldo a produzir.</div>';
    el('pgrade').querySelectorAll('[data-k]').forEach(function(b) { b.onclick = function() { alternar(b.getAttribute('data-k')); }; });
    if (el('btnMaisPed')) el('btnMaisPed').onclick = function() { S.mostrarPed += 60; renderEscolha(); };
    var nao = abertos.filter(function(p) { return (diag[p.key] || {}).ok === false; }).length;
    el('passo1d').textContent = (nao ? nao + ' dos ' + abertos.length + ' pedidos não entram na conta por falta de cadastro (aparecem no fim, em cinza). ' : '') + (S.sel.length ? S.sel.length + ' ' + plural(S.sel.length, 'pedido escolhido', 'pedidos escolhidos') + ' de ' + abertos.length + ' em aberto.' : abertos.length + ' pedidos em aberto. Clique nos que quer atender; dá para marcar vários.');
  }
  function alternar(k) {
    var i = S.sel.indexOf(k);
    if (i >= 0) { S.sel.splice(i, 1); S.ordem = S.ordem.filter(function(x) { return x !== k; }); }
    else { S.sel.push(k); S.ordem.push(k); }
    gravarUrl(); render();
  }

  /* ── Passo 2 e 3: resultado ── */
  function barraEmpilhada(l) {
    var tot = l.necessario || 1;
    var seg = [['doEstoque', 'var(--c-est)'], ['caminho', 'var(--c-cam)'], ['andamento', 'var(--c-and)'], ['falta', 'var(--c-fal)']];
    return '<div class="mbar">' + seg.map(function(s) { var v = l[s[0]]; return v > 0 ? '<i style="width:' + (v / tot * 100).toFixed(2) + '%;background:' + s[1] + '"></i>' : ''; }).join('') + '</div>';
  }
  function legendaMat(l) {
    var un = l.unidade;
    var it = [['Estoque', l.doEstoque, 'var(--c-est)'], ['A caminho', l.caminho, 'var(--c-cam)'], ['Em compra', l.andamento, 'var(--c-and)'], ['Falta', l.falta, 'var(--c-fal)']];
    return '<div class="mleg">' + it.filter(function(x) { return x[1] > 0; }).map(function(x) { return '<span style="--cor:' + x[2] + '">' + x[0] + ' <b>' + fmt(x[1], un) + '</b></span>'; }).join('') + '</div>';
  }
  function resumoMat(l) {
    var un = e(l.unidade);
    if (l.estado === 'falta') return '<div class="mres falta"><b>Falta ' + fmt(l.falta, l.unidade) + '</b><small>' + un + ' · precisa de ' + fmt(l.necessario, l.unidade) + '</small></div>';
    if (l.estado === 'andamento') return '<div class="mres andamento"><b>Já em compra</b><small>' + fmt(l.andamento, l.unidade) + ' ' + un + ' pedidos/solicitados</small></div>';
    if (l.estado === 'caminho') {
      var tarde = l.porPedido.some(function(p) { return p.atrasa; });
      var datas = l.porPedido.map(function(p) { return p.chegaEm; }).filter(Boolean).sort();
      return '<div class="mres caminho"><b>Chega ' + (datas.length ? dataBR(datas[datas.length - 1]) : 'sem data') + '</b><small>' + (tarde ? '⚠ depois da entrega do pedido' : 'a caminho') + '</small></div>';
    }
    return '<div class="mres coberto"><b>✓ Coberto</b><small>' + fmt(l.necessario, l.unidade) + ' ' + un + ' em estoque</small></div>';
  }
  function selosMat(l) {
    var s = [];
    if (l.concorrentes > 1) s.push('<span class="tg info" title="Mais de um pedido escolhido usa este material">' + l.concorrentes + ' pedidos disputam</span>');
    if (l.negativo) s.push('<span class="tg bad" title="O saldo do sistema está negativo: a base de estoque ainda não é confiável">saldo negativo</span>');
    else if (l.semRegistro) s.push('<span class="tg warn" title="Sem registro de saldo: calculado como zero">sem saldo registrado</span>');
    else if (!l.contado) s.push('<span class="tg mute" title="Este item ainda não passou pela contagem do Dia D">ainda não contado</span>');
    if (l.porPedido.some(function(p) { return p.atrasa; })) s.push('<span class="tg bad">chega tarde</span>');
    return s.join(' ');
  }
  function detalheMat(l) {
    var un = l.unidade, h = '<div class="det">';
    var porque = l.origem === 'formula' ? 'Vem da <b>fórmula</b>: percentual do material sobre a massa do lote (quantidade de peças × peso de cada uma, com overfill e perda do cadastro).' : 'Vem da <b>BOM</b>: quantidade por peça × peças a produzir' + (l.necessario ? ' (unidade inteira, arredondada para cima).' : '.');
    h += '<h4>Por que precisa disso</h4><div class="exp">' + porque + '</div>';
    h += '<h4>Como cada pedido é atendido (na ordem de atendimento)</h4><table><thead><tr><th>Pedido</th><th class="n">Precisa</th><th class="n">Estoque</th><th class="n">A caminho</th><th class="n">Em compra</th><th class="n">Falta</th></tr></thead><tbody>' +
      l.porPedido.map(function(p) {
        return '<tr><td><b>' + e(p.id) + '</b></td><td class="n">' + fmt(p.necessario, un) + '</td><td class="n">' + fmt(p.doEstoque, un) + '</td><td class="n">' + (p.qCaminho ? fmt(p.qCaminho, un) + (p.chegaEm ? '<div style="font-size:10.5px;color:' + (p.atrasa ? 'var(--bad)' : 'var(--ink-mute)') + '">' + dataBR(p.chegaEm) + (p.atrasa ? ' (tarde)' : '') + '</div>' : '') : '—') + '</td><td class="n">' + (p.qAndamento ? fmt(p.qAndamento, un) : '—') + '</td><td class="n" style="color:' + (p.falta > 0 ? 'var(--bad)' : 'inherit') + ';font-weight:' + (p.falta > 0 ? 700 : 400) + '">' + (p.falta > 0 ? fmt(p.falta, un) : '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
    h += '<h4>Estoque</h4><div class="exp">Saldo no sistema <b>' + fmt(l.estoque.atual, un) + '</b> · reservado por OPs de outros pedidos <b>' + fmt(Math.max(0, l.estoque.empenhado - l.estoque.proprio), un) + '</b> · reservado pelas OPs destes pedidos <b>' + fmt(l.estoque.proprio, un) + '</b> (já separado para eles).' +
      (Object.keys(l.estoque.porCliente).length ? ' Parte do saldo é de cliente e só serve ao pedido dele.' : '') + '</div>';
    if (l.chegadas.length) {
      h += '<h4>Compras desse material</h4><table><thead><tr><th>Documento</th><th>Situação</th><th class="n">Quantidade</th><th>Previsão</th></tr></thead><tbody>' + l.chegadas.map(function(c) {
        return '<tr><td><b>' + e(c.pc) + '</b>' + (c.fornecedor ? ' <span style="color:var(--ink-mute)">' + e(c.fornecedor) + '</span>' : '') + '</td><td>' + (c.aberto ? 'ainda não enviado' : 'enviado ao fornecedor') + (c.remessaCliente ? ' · remessa do cliente' : '') + '</td><td class="n">' + fmt(c.qtd, un) + '</td><td>' + (c.data ? dataBR(c.data) : '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    return h + '</div>';
  }

  function renderResultado() {
    var box = el('resultado');
    if (!S.sel.length) { box.innerHTML = ''; el('acao').hidden = true; res = null; return; }
    res = NP.calcular(base(S.sel, S.ordem));
    var r = res.resumo, tot = r.materiais || 1;
    var h = '<div class="passo"><span class="n">2</span><div><h2>O que isso significa</h2><div class="d">A foto geral dos ' + S.sel.length + ' ' + plural(S.sel.length, 'pedido', 'pedidos') + ' escolhidos.</div></div></div>';
    h += '<div class="hero"><div class="card"><h3>' + r.materiais + ' ' + plural(r.materiais, 'material', 'materiais') + ' para atender ' + (S.sel.length === 1 ? 'este pedido' : 'estes ' + S.sel.length + ' pedidos') + '</h3>' +
      '<div class="sub" style="margin:0">' + (r.falta ? '<b style="color:var(--bad)">' + r.falta + ' ' + plural(r.falta, 'precisa', 'precisam') + ' ser comprados</b>' : '<b style="color:var(--ok)">Nada precisa ser comprado agora.</b>') + (r.andamento ? ' · ' + r.andamento + ' já em compra' : '') + (r.caminho ? ' · ' + r.caminho + ' a caminho' : '') + '.</div>' +
      '<div class="stack">' + ['coberto', 'caminho', 'andamento', 'falta'].map(function(k) { return r[k] ? '<i style="width:' + (r[k] / tot * 100).toFixed(2) + '%;background:' + COR[k] + '"></i>' : ''; }).join('') + '</div>' +
      '<div class="legenda">' + ['falta', 'andamento', 'caminho', 'coberto'].map(function(k) { return '<button type="button" class="lg' + (S.estado === k ? ' on' : '') + '" data-est="' + k + '"><i style="background:' + COR[k] + '"></i>' + ROT[k] + ' <b>' + r[k] + '</b></button>'; }).join('') + '</div></div>';
    // cartões dos pedidos na ordem de atendimento
    h += '<div class="card"><h3 style="margin:0 0 8px;font-size:15px">Pedidos, na ordem de atendimento</h3><div class="pedcards">' + res.pedidos.map(function(p, i) {
      if (!p.ok) return '<div class="ped"><span class="ord" style="background:var(--ink-mute)">' + (i + 1) + '</span><div class="t"><b>Pedido ' + e(p.id) + '</b><span class="tg mute">não calculado</span></div><div class="tx">' + e(p.erro) + '</div><div class="tx">Corrija em Cadastros › Produtos / Fórmulas e BOM para entrar na conta.</div></div>';
      var pronto = p.pctProntoJa, cob = Math.max(0, p.pctCoberto - p.pctProntoJa), fal = Math.max(0, 100 - p.pctCoberto);
      var trava = p.faltam.slice(0, 3).map(function(f) { return e(f.nome); }).join(', ');
      return '<div class="ped"><span class="ord">' + (i + 1) + '</span><div class="t"><b>Pedido ' + e(p.id) + ' <span style="font-weight:500;color:var(--ink-mute)">· ' + e(p.sku) + '</span></b><span class="mv"><button type="button" data-sobe="' + e(p.key) + '" title="Atender antes" aria-label="Atender antes">▲</button><button type="button" data-desce="' + e(p.key) + '" title="Atender depois" aria-label="Atender depois">▼</button></span></div>' +
        '<div class="prog" title="Pronto com o estoque ' + pronto + '% · coberto com chegadas/compras ' + cob + '% · falta ' + fal + '%"><i style="width:' + pronto + '%;background:var(--c-est)"></i><i style="width:' + cob + '%;background:var(--c-cam)"></i><i style="width:' + fal + '%;background:var(--c-fal)"></i></div>' +
        '<div class="tx"><b>' + p.pctProntoJa + '%</b> dos materiais prontos no estoque · <b>' + p.pctCoberto + '%</b> cobertos com o que está chegando' + (p.entrega ? ' · entrega ' + dataBR(p.entrega) : '') +
        (p.faltam.length ? '<br>Trava em: <b>' + trava + '</b>' + (p.faltam.length > 3 ? ' e mais ' + (p.faltam.length - 3) : '') : '<br><span style="color:var(--ok)">Tudo coberto.</span>') + (p.chegaTarde ? '<br><span style="color:var(--bad)">⚠ ' + p.chegaTarde + ' ' + plural(p.chegaTarde, 'material chega', 'materiais chegam') + ' depois da entrega</span>' : '') + (p.semAprovada ? '<br><span style="color:var(--warn)">Fórmula ainda sem aprovação completa.</span>' : '') + '</div></div>';
    }).join('') + '</div></div></div>';
    if (r.naoConfiaveis) {
      h += '<div class="aviso warn"><b>Atenção ao estoque:</b> ' + r.naoConfiaveis + ' ' + plural(r.naoConfiaveis, 'material está', 'materiais estão') + ' com saldo negativo ou sem registro. Enquanto o Dia D não termina, o sistema pode achar que falta o que na verdade existe no galpão. Confira os marcados antes de enviar a compra.</div>';
    }
    if (r.semFormula) {
      h += '<div class="aviso info"><b>' + r.semFormula + ' ' + plural(r.semFormula, 'pedido não entrou', 'pedidos não entraram') + ' na conta</b> por falta de dados no cadastro (veja o motivo em cada cartão acima).</div>';
    }
    // materiais
    var lista = res.materiais.filter(function(l) {
      if (S.estado && l.estado !== S.estado) return false;
      var toks = norm(S.qm).split(' ').filter(Boolean), alvo = norm(l.nome + ' ' + l.codigo);
      return toks.every(function(t) { return alvo.indexOf(t) >= 0; });
    });
    h += '<div class="passo"><span class="n">3</span><div><h2>Material por material</h2><div class="d">Clique num material para ver a conta, quem disputa e as compras já feitas.</div></div></div>';
    h += '<div class="mfil"><div class="busca"><span>🔍</span><input type="search" id="qm" value="' + e(S.qm) + '" placeholder="Filtrar materiais…" aria-label="Filtrar materiais"></div>' +
      (S.estado ? '<button type="button" class="btn sm" id="limpaEst">✕ ' + ROT[S.estado] + '</button>' : '') + '<button type="button" class="btn sm" id="btnCsv">⬇ Exportar CSV</button></div>';
    if (!lista.length) h += '<div class="card vazio"><b>Nenhum material com esses filtros</b></div>';
    var grupoAnt = null;
    lista.forEach(function(l) {
      var g = S.estado || S.qm ? null : ROT[l.estado];
      if (g !== grupoAnt) { grupoAnt = g; if (g) h += '<div class="grp">' + g + '</div>'; }
      var aberto = !!S.abertoMat[l.codigo];
      h += '<div class="mat ' + l.estado + '"><button type="button" class="mhd" data-m="' + e(l.codigo) + '" aria-expanded="' + aberto + '"><div><div class="nm">' + e(l.nome) + '</div><div class="cd">' + e(l.codigo) + ' · ' + e(TIPOS[l.tipo] || l.tipo) + ' · ' + selosMat(l) + '</div></div>' +
        '<div>' + barraEmpilhada(l) + legendaMat(l) + '</div>' + resumoMat(l) + '</button>' + (aberto ? detalheMat(l) : '') + '</div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('[data-est]').forEach(function(b) { b.onclick = function() { S.estado = S.estado === b.getAttribute('data-est') ? '' : b.getAttribute('data-est'); renderResultado(); }; });
    box.querySelectorAll('[data-m]').forEach(function(b) { b.onclick = function() { var c = b.getAttribute('data-m'); S.abertoMat[c] = !S.abertoMat[c]; renderResultado(); }; });
    box.querySelectorAll('[data-sobe]').forEach(function(b) { b.onclick = function() { mover(b.getAttribute('data-sobe'), -1); }; });
    box.querySelectorAll('[data-desce]').forEach(function(b) { b.onclick = function() { mover(b.getAttribute('data-desce'), 1); }; });
    if (el('qm')) { el('qm').oninput = function() { S.qm = el('qm').value; clearTimeout(window.__tqm); window.__tqm = setTimeout(function() { var pos = el('qm') ? el('qm').selectionStart : 0; renderResultado(); if (el('qm')) { el('qm').focus(); el('qm').setSelectionRange(pos, pos); } }, 120); }; }
    if (el('limpaEst')) el('limpaEst').onclick = function() { S.estado = ''; renderResultado(); };
    if (el('btnCsv')) el('btnCsv').onclick = exportarCsv;
    // barra de ação
    var itens = NP.itensParaSolicitar(res);
    var ac = el('acao'); ac.hidden = false;
    ac.innerHTML = '<div class="t">' + (itens.length ? '<b>' + itens.length + ' ' + plural(itens.length, 'item falta', 'itens faltam') + ' comprar</b> para atender ' + (S.sel.length === 1 ? 'o pedido' : 'os ' + S.sel.length + ' pedidos') + '. O que já está em compra ou a caminho não entra.' : '<b style="color:var(--ok)">Nada a comprar</b> para os pedidos escolhidos.') + '</div>' +
      '<button type="button" class="btn pri" id="btnSolicitar"' + (itens.length ? '' : ' disabled') + '>🛒 Solicitar compra do que falta</button>';
    el('btnSolicitar').onclick = abrirSolicitacao;
  }
  function mover(k, d) {
    var ord = res.ordem.slice(), i = ord.indexOf(k), j = i + d;
    if (i < 0 || j < 0 || j >= ord.length) return;
    ord.splice(i, 1); ord.splice(j, 0, k);
    S.ordem = ord; renderResultado();
  }

  /* ── Solicitação de compra ── */
  var itensSol = [];
  function toast(msg, erro) {
    var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function() { t.remove(); }, 6000);
  }
  function abrirSolicitacao() {
    itensSol = NP.itensParaSolicitar(res);
    if (!itensSol.length) return;
    var f = document.createElement('div'); f.className = 'mfundo'; f.id = 'mSol';
    f.innerHTML = '<div class="modal" role="dialog" aria-label="Solicitar compra"><h3>Solicitar compra</h3><div class="sub">Vai para Compras como solicitação <b>pendente</b>. Ajuste as quantidades ou desmarque o que não quer pedir agora.</div>' +
      itensSol.map(function(it, i) {
        return '<div class="sl"><input type="checkbox" data-u="' + i + '" checked aria-label="Incluir"><div><b>' + e(it.materialNome) + '</b><small>' + e(it.materialCodigo) + ' · precisa ' + fmt(it.necessario, it.unidade) + '</small></div><input type="number" min="0" step="any" data-q="' + i + '" value="' + it.qtd + '" aria-label="Quantidade"><span style="font-size:12px;color:var(--ink-mute)">' + e(it.unidade) + '</span></div>';
      }).join('') +
      '<label style="display:block;margin-top:12px;font-size:12px;font-weight:700">Justificativa</label><textarea id="solJust" rows="2">Falta apurada em "O que comprar" para os pedidos ' + e(res.pedidos.map(function(p) { return p.id; }).join(', ')) + '.</textarea>' +
      '<div class="ac"><button type="button" class="btn" id="solCancel">Cancelar</button><button type="button" class="btn pri" id="solOk">Enviar a Compras</button></div></div>';
    document.body.appendChild(f);
    el('solCancel').onclick = function() { f.remove(); };
    f.addEventListener('mousedown', function(ev) { if (ev.target === f) f.remove(); });
    el('solOk').onclick = enviarSolicitacao;
  }
  function enviarSolicitacao() {
    var escolhidos = [];
    document.querySelectorAll('#mSol [data-u]').forEach(function(c) {
      if (!c.checked) return;
      var i = Number(c.getAttribute('data-u')), q = parseFloat(document.querySelector('#mSol [data-q="' + i + '"]').value);
      if (q > 0) escolhidos.push({it: itensSol[i], qtd: q});
    });
    if (!escolhidos.length) { toast('Marque ao menos um item com quantidade maior que zero.', true); return; }
    var btn = el('solOk'); btn.disabled = true;
    var autor = (window.currentUser && (window.currentUser.nome || window.currentUser.email)) || 'Sistema';
    var itens = {};
    escolhidos.forEach(function(x) {
      itens[db.ref('solicitacoes_compra').push().key] = {materialCodigo: x.it.materialCodigo, materialNome: x.it.materialNome, qtd: x.qtd, unidade: x.it.unidade || '', obs: x.it.obs};
    });
    var keys = res.pedidos.filter(function(p) { return p.ok; }).map(function(p) { return p.key; });
    nextSequential(db, 'config/contadores/solicitacaoCompra', 'SC', 4).then(function(seq) {
      var key = db.ref('solicitacoes_compra').push().key, up = {};
      up['solicitacoes_compra/' + key] = {
        numero: seq.numero, numeroFormatado: seq.formatado, itens: itens, justificativa: el('solJust').value.trim(),
        solicitante: autor, status: 'PENDENTE', aprovacao: null, rejeicao: null, criadoPor: autor, criadoEm: new Date().toISOString(),
        origemMatriz: true, origemTela: 'o_que_comprar', pedidoKeys: keys, pedidoOrigemKey: keys[0] || null
      };
      return db.ref().update(up).then(function() { return seq; });
    }).then(function(seq) {
      var m = el('mSol'); if (m) m.remove();
      toast('Solicitação ' + seq.formatado + ' enviada a Compras com ' + escolhidos.length + ' ' + plural(escolhidos.length, 'item', 'itens') + '.');
    }).catch(function(err) { btn.disabled = false; toast('Não foi possível enviar: ' + (err && err.message || err), true); });
  }

  function exportarCsv() {
    var cab = ['Código', 'Material', 'Unidade', 'Precisa', 'Do estoque', 'A caminho', 'Em compra', 'Falta comprar', 'Situação', 'Pedidos'];
    var lin = res.materiais.map(function(l) { return [l.codigo, l.nome, l.unidade, l.necessario, l.doEstoque, l.caminho, l.andamento, l.falta, ROT[l.estado], l.porPedido.map(function(p) { return p.id; }).join(' | ')]; });
    var csv = [cab].concat(lin).map(function(l) { return l.map(function(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'}));
    a.download = 'o-que-comprar-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function render() { renderEscolha(); renderResultado(); }

  el('q').addEventListener('input', function() { clearTimeout(window.__tq); var v = el('q').value; window.__tq = setTimeout(function() { S.q = v; S.mostrarPed = 60; renderEscolha(); }, 100); });
  el('fCli').onchange = function() { S.cli = el('fCli').value; S.mostrarPed = 60; renderEscolha(); };
  el('btnTodos').onclick = function() { (window.__visiveis || []).forEach(function(k) { if (S.sel.indexOf(k) < 0) { S.sel.push(k); S.ordem.push(k); } }); gravarUrl(); render(); };
  el('btnNenhum').onclick = function() { S.sel = []; S.ordem = []; gravarUrl(); render(); };

  lerUrl();
  function falha() { el('sTxt').textContent = 'Sem conexão'; }
  [['pedidos', 'pedidos'], ['produtos', 'produtos'], ['formulas', 'formulas'], ['bom', 'bom'], ['materiais', 'materiais'], ['estoque', 'estoque'], ['ops', 'ops'], ['pedidos_compra', 'pedidosCompra'], ['solicitacoes_compra', 'solicitacoes']].forEach(function(p) {
    dbOnValue(db.ref(p[0]), function(s) { D[p[1]] = s.val() || {}; agendar(); }, {onError: falha});
  });
})();
