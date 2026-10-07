'use strict';
/* Consulta de Estoque (01/10/2026) -- tela. Regras em shared/consulta-estoque.js
   (funções puras, testadas em run_consulta_estoque_test.js). Aqui só lê o banco,
   desenha e guarda o estado na URL. Nada grava. */
(function() {
  var db = firebase.database();
  var CE = ConsultaEstoque;
  var TAM_PAGINA = 150;

  var dados = {estoque: null, materiais: null, lotes: null, ops: null, produtos: null, bom: null, formulas: null, mp: null, bombonas: null, clientes: null, perdas: {}, validacoes: {}};
  var estInter = null;
  var rows = [], inter = null, usos = null, usosCarregando = false;
  var estado = {q: '', grupo: '', tag: '', cliente: '', ordem: 'nome', desc: false, aba: 'itens', denso: false, qI: '', estadoI: '', mostrar: TAM_PAGINA};
  var selecionado = null, focoIdx = -1, visiveis = [], ultimaCarga = null;

  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function fmt(n, c) { return CE.fmt(n, c); }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function dataBR(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—'; }
  function relativo(iso) {
    var d = new Date(iso); if (isNaN(d)) return '—';
    var s = (Date.now() - d.getTime()) / 1000;
    if (s < 90) return 'agora';
    if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'há ' + Math.round(s / 3600) + ' h';
    if (s < 86400 * 30) return 'há ' + Math.round(s / 86400) + ' d';
    return d.toLocaleDateString('pt-BR');
  }
  function plural(n, um, varios) { return n === 1 ? um : varios; }

  /* ── Estado na URL: o link da busca pode ser mandado para alguém ── */
  var PARAMS = {q: 'q', grupo: 'g', tag: 't', cliente: 'c', aba: 'aba', ordem: 'o'};
  function lerUrl() {
    var u = new URLSearchParams(location.search);
    Object.keys(PARAMS).forEach(function(k) { var v = u.get(PARAMS[k]); if (v != null) estado[k] = v; });
    if (estado.aba !== 'inter') estado.aba = 'itens';
  }
  function gravarUrl() {
    var u = new URLSearchParams();
    Object.keys(PARAMS).forEach(function(k) {
      var padrao = k === 'ordem' ? 'nome' : k === 'aba' ? 'itens' : '';
      if (estado[k] && estado[k] !== padrao) u.set(PARAMS[k], estado[k]);
    });
    try { history.replaceState(null, '', u.toString() ? '?' + u.toString() : location.pathname); } catch (x) { /* sem URL: segue */ }
  }

  /* ── Montagem dos dados ── */
  function recalcular() {
    if (!dados.estoque || !dados.materiais || !dados.lotes) return;
    rows = CE.linhas({estoque: dados.estoque, materiais: dados.materiais, lotes: dados.lotes, incluirCatalogo: true,
      produtos: dados.produtos || {}, clientes: dados.clientes || {}});
    if (dados.ops && dados.produtos && dados.bom) {
      inter = CE.intermediarios({ops: dados.ops, estoque: dados.estoque, materiais: dados.materiais, bom: dados.bom, produtos: dados.produtos, materialProcesso: dados.mp || {}, bombonas: dados.bombonas || {}});
    }
    if (dados.ops && dados.produtos) estInter = CE.estoqueIntermediario({ops: dados.ops, produtos: dados.produtos, materialProcesso: dados.mp || {}, perdas: dados.perdas || {}, validacoes: dados.validacoes || {}});
    ultimaCarga = new Date();
    el('sDot').classList.add('on'); el('sTxt').textContent = 'Ao vivo';
    render();
  }

  /* ── Render: KPIs ── */
  function renderKpis() {
    var k = CE.kpis(rows), t = inter ? inter.totais : null;
    var itens = [
      {id: 'comSaldo', n: k.comSaldo, r: 'Itens com saldo', s: 'de ' + k.itens + ' com movimento', cls: 'ok', tag: 'comSaldo'},
      {id: 'falta', n: k.faltando + k.negativos, r: 'Sem saldo para as OPs', s: k.negativos + ' negativos · ' + k.faltando + ' empenhados a mais', cls: (k.faltando + k.negativos) ? 'bad' : '', tag: (k.negativos >= k.faltando ? 'negativo' : 'falta'), duplo: true},
      {id: 'vencendo', n: k.vencendo + k.vencidos, r: 'Vencendo ou vencidos', s: 'validade em até ' + CE.DIAS_VENCENDO + ' dias', cls: (k.vencendo + k.vencidos) ? 'warn' : '', tag: k.vencidos ? 'vencido' : 'vencendo'},
      {id: 'quarentena', n: k.quarentena, r: 'Em quarentena', s: 'aguardando a Qualidade', cls: k.quarentena ? 'warn' : '', tag: 'quarentena'},
      {id: 'inter', n: t ? fmt(t.bulkKg, 0) + ' kg' : '…', r: 'Bulk aguardando envase', s: t ? t.prontas + ' OPs com embalagem · ' + t.bloqueadas + ' travadas' : 'carregando OPs', cls: '', aba: 'inter'}
    ];
    el('kpis').innerHTML = itens.map(function(i) {
      var on = i.aba ? estado.aba === 'inter' : (estado.tag === i.tag || (i.id === 'falta' && (estado.tag === 'negativo' || estado.tag === 'falta')));
      return '<button type="button" class="kpi ' + i.cls + (on ? ' on' : '') + '" data-kpi="' + i.id + '"><b>' + (typeof i.n === 'number' ? fmt(i.n, 0) : e(i.n)) + '</b><span>' + e(i.r) + '</span><small>' + e(i.s) + '</small></button>';
    }).join('');
    el('kpis').querySelectorAll('[data-kpi]').forEach(function(b) {
      b.onclick = function() {
        var i = itens.filter(function(x) { return x.id === b.getAttribute('data-kpi'); })[0];
        if (i.aba) { irParaAba('inter'); return; }
        irParaAba('itens');
        var ja = estado.tag === i.tag || (i.id === 'falta' && (estado.tag === 'negativo' || estado.tag === 'falta'));
        estado.tag = ja ? '' : i.tag; estado.mostrar = TAM_PAGINA; render();
      };
    });
  }

  /* ── Render: filtros ── */
  var TAGS = [
    {t: 'comSaldo', r: 'Com saldo'}, {t: 'contado', r: '📋 Já contado (Dia D)'}, {t: 'naoContado', r: 'Ainda não contado'}, {t: 'semControle', r: 'Sem controle de estoque'}, {t: 'ok', r: '✓ Tudo certo'}, {t: 'empenhado', r: 'Empenhado'}, {t: 'falta', r: 'Empenho maior que o saldo'},
    {t: 'negativo', r: 'Saldo negativo'}, {t: 'zerado', r: 'Zerado'}, {t: 'quarentena', r: 'Em quarentena'}, {t: 'vencendo', r: 'Vencendo'}, {t: 'vencido', r: 'Vencido'}
  ];
  var CLASSE_TAG = {semControle: 'mute', negativo: 'bad', falta: 'bad', vencido: 'bad', zerado: 'mute', vencendo: 'warn', quarentena: 'info', empenhado: 'mute', ok: 'ok'};
  var ROTULO_TAG = {semControle: 'Sem controle', negativo: 'Negativo', falta: 'Empenho > saldo', vencido: 'Vencido', zerado: 'Zerado', vencendo: 'Vencendo', quarentena: 'Quarentena', empenhado: 'Empenhado', ok: 'OK'};

  function filtroAtual() { return {busca: estado.q, grupo: estado.grupo, tag: estado.tag, cliente: estado.cliente}; }

  function renderFiltros() {
    var c = CE.contagens(rows, filtroAtual());
    var grupos = CE.ORDEM_GRUPOS.filter(function(g) { return g !== 'OUTRO' || c.grupo[g]; });
    el('fGrupo').innerHTML = '<span class="rot">Tipo</span><button type="button" class="chip' + (!estado.grupo ? ' on' : '') + '" data-g="">Todos</button>' +
      grupos.map(function(g) {
        var n = c.grupo[g] || 0;
        return '<button type="button" class="chip' + (estado.grupo === g ? ' on' : '') + (!n && estado.grupo !== g ? ' vazio' : '') + '" data-g="' + g + '">' + e(CE.GRUPOS[g].rotulo) + ' <span class="c">' + n + '</span></button>';
      }).join('');
    el('fTag').innerHTML = '<span class="rot">Situação</span><button type="button" class="chip' + (!estado.tag ? ' on' : '') + '" data-t="">Qualquer</button>' +
      TAGS.map(function(x) {
        var n = c.tag[x.t] || 0;
        return '<button type="button" class="chip' + (estado.tag === x.t ? ' on' : '') + (!n && estado.tag !== x.t ? ' vazio' : '') + '" data-t="' + x.t + '">' + e(x.r) + ' <span class="c">' + n + '</span></button>';
      }).join('');
    el('fGrupo').querySelectorAll('[data-g]').forEach(function(b) { b.onclick = function() { estado.grupo = b.getAttribute('data-g'); estado.mostrar = TAM_PAGINA; render(); }; });
    el('fTag').querySelectorAll('[data-t]').forEach(function(b) { b.onclick = function() { estado.tag = b.getAttribute('data-t'); estado.mostrar = TAM_PAGINA; render(); }; });
    var cli = CE.clientesDoEstoque(rows), sel = el('fCliente');
    var htmlC = '<option value="">Todos os clientes</option><option value="__KURYOS"' + (estado.cliente === '__KURYOS' ? ' selected' : '') + '>Estoque geral da Kuryos</option>' +
      cli.map(function(x) { return '<option value="' + e(x.chave) + '"' + (estado.cliente === x.chave ? ' selected' : '') + '>' + e(x.nome) + '</option>'; }).join('');
    if (sel.getAttribute('data-h') !== htmlC) { sel.innerHTML = htmlC; sel.setAttribute('data-h', htmlC); }
    sel.value = estado.cliente;
    el('fOrdem').value = estado.ordem;
    return c;
  }

  /* ── Render: tabela ── */
  function barra(r) {
    if (!(r.atual > 0)) return '';
    var emp = Math.min(r.empenhado, r.atual), q = Math.min(r.quarentena, Math.max(0, r.atual - emp));
    var disp = Math.max(0, r.atual - emp - q);
    var pc = function(v) { return (v / r.atual * 100).toFixed(1) + '%'; };
    return '<div class="bar" title="Disponível ' + fmt(disp) + ' · empenhado ' + fmt(emp) + ' · quarentena ' + fmt(q) + '"><i class="d" style="width:' + pc(disp) + '"></i><i class="e" style="width:' + pc(emp) + '"></i><i class="q" style="width:' + pc(q) + '"></i></div>';
  }
  function validadeCelula(r) {
    if (r.proxDias == null) return '<span class="mut">—</span>';
    var cls = r.proxDias < 0 ? 'bad' : r.proxDias <= CE.DIAS_VENCENDO ? 'warn' : 'mute';
    var txt = r.proxDias < 0 ? 'venceu há ' + (-r.proxDias) + ' d' : r.proxDias === 0 ? 'vence hoje' : 'em ' + r.proxDias + ' d';
    return '<span class="tg ' + cls + '">' + txt + '</span><div class="mut sub2" style="font-size:11px">' + dataBR(r.proxValidade) + '</div>';
  }
  function linhaHtml(r, i) {
    var gp = CE.GRUPOS[r.grupo];
    var tags = r.tags.map(function(t) { return '<span class="tg ' + CLASSE_TAG[t] + '">' + ROTULO_TAG[t] + '</span>'; }).join('') || (r.semRegistro ? '<span class="tg mute">Sem registro de saldo</span>' : '');
    var onde = r.enderecos.length ? e(r.enderecos.slice(0, 2).join(', ')) + (r.enderecos.length > 2 ? ' <span class="mut">+' + (r.enderecos.length - 2) + '</span>' : '') : '<span class="mut">—</span>';
    var donos = r.clientes.length ? '<div class="mut sub2" style="font-size:11px">do cliente: ' + e(r.clientes.map(function(k) { return r.porCliente[k] ? r.porCliente[k].nome : k; }).slice(0, 2).join(', ')) + '</div>' : '';
    return '<tr data-i="' + i + '" data-c="' + e(r.codigo) + '" class="' + (selecionado === r.codigo ? 'sel' : '') + '">' +
      '<td><div class="item"><span class="barra-nivel ' + r.nivel + '"></span><div><div class="nome">' + e(r.nome) + '<span class="gp" style="background:' + gp.cor + '">' + e(gp.curto) + '</span></div><div class="cod">' + e(r.codigo) + '</div></div></div></td>' +
      '<td class="num"><div class="saldo ' + (r.atual < 0 ? 'neg' : '') + '">' + fmt(r.atual) + '<small>' + e(r.unidade) + '</small></div>' + barra(r) + '</td>' +
      '<td class="num hide-m"><div class="saldo ' + (r.disponivel < 0 ? 'neg' : '') + '">' + fmt(r.disponivel) + '</div>' + (r.empenhado > 0 ? '<div class="mut sub2" style="font-size:11px">' + fmt(r.empenhado) + ' empenhado</div>' : '') + '</td>' +
      '<td>' + tags + donos + '</td>' +
      '<td class="hide-m">' + validadeCelula(r) + '</td>' +
      '<td class="hide-m" style="font-size:12px">' + onde + '</td>' +
      '<td class="hide-m mut" style="font-size:12px">' + (r.atualizadoEm ? relativo(r.atualizadoEm) : '—') + (r.contado ? '<div class="sub2" style="font-size:11px;color:var(--ce-ok);white-space:nowrap">✓ contado ' + relativo(r.contadoEm) + '</div>' : '') + '</td></tr>';
  }
  function renderTabela(c) {
    var lista = CE.ordenar(CE.filtrar(rows, filtroAtual()), estado.ordem, estado.desc);
    visiveis = lista;
    var mostrar = lista.slice(0, estado.mostrar);
    el('corpo').innerHTML = mostrar.length ? mostrar.map(linhaHtml).join('') +
      (lista.length > mostrar.length ? '<tr><td colspan="7" class="mais"><button type="button" class="btn" id="btnMais">Mostrar mais ' + Math.min(TAM_PAGINA, lista.length - mostrar.length) + ' (faltam ' + (lista.length - mostrar.length) + ')</button></td></tr>' : '')
      : '<tr><td colspan="7"><div class="vazia"><b>Nada encontrado</b>' + (estado.q ? 'Nenhum item com “' + e(estado.q) + '”. Tente menos palavras ou o código do material.' : 'Nenhum item com esses filtros.') + '<div style="margin-top:10px"><button type="button" class="btn" id="btnLimpar2">Limpar filtros</button></div></div></td></tr>';
    var filtrado = estado.q || estado.grupo || estado.tag || estado.cliente;
    el('resumoTxt').innerHTML = '<b>' + fmt(lista.length, 0) + '</b> ' + plural(lista.length, 'item', 'itens') + (filtrado ? ' com os filtros atuais' : ' no estoque') +
      (ultimaCarga ? ' · atualizado ' + relativo(ultimaCarga.toISOString()) : '');
    el('limparBox').innerHTML = filtrado ? '<button type="button" class="linklike" id="btnLimpar">✕ Limpar filtros</button>' : '';
    ['btnLimpar', 'btnLimpar2'].forEach(function(id) { if (el(id)) el(id).onclick = limparFiltros; });
    if (el('btnMais')) el('btnMais').onclick = function() { estado.mostrar += TAM_PAGINA; renderTabela(c); };
    el('nItens').textContent = String(CE.kpis(rows).itens);
    el('corpo').querySelectorAll('tr[data-c]').forEach(function(tr) {
      tr.onclick = function() { focoIdx = Number(tr.getAttribute('data-i')); abrirDrawer(tr.getAttribute('data-c')); };
    });
    document.querySelectorAll('thead th[data-o]').forEach(function(th) {
      var o = th.getAttribute('data-o'), base = th.getAttribute('data-t') || th.textContent.replace(/[▲▼]/g, '').trim();
      th.setAttribute('data-t', base);
      th.innerHTML = e(base) + (estado.ordem === o ? '<span class="seta">' + (estado.desc ? '▼' : '▲') + '</span>' : '');
    });
  }
  function limparFiltros() { estado.q = ''; estado.grupo = ''; estado.tag = ''; estado.cliente = ''; estado.mostrar = TAM_PAGINA; el('q').value = ''; render(); }

  /* ── Drawer de detalhe ── */
  function carregarUsos() {
    if (usos || usosCarregando) return;
    usosCarregando = true;
    var f = null, b = null, p = null;
    function pronto() { if (f && b && p) { usos = OndeUsado.indice({formulas: f, bom: b, produtos: p}); usosCarregando = false; if (selecionado) renderDrawer(); } }
    db.ref('formulas').once('value').then(function(s) { f = s.val() || {}; pronto(); });
    db.ref('bom').once('value').then(function(s) { b = s.val() || {}; pronto(); });
    db.ref('produtos').once('value').then(function(s) { p = s.val() || {}; pronto(); });
  }
  function abrirDrawer(codigo) {
    selecionado = codigo; renderDrawer();
    el('drawer').classList.add('on'); el('fundo').classList.add('on'); el('drawer').setAttribute('aria-hidden', 'false');
    carregarUsos();
    el('corpo').querySelectorAll('tr').forEach(function(tr) { tr.classList.toggle('sel', tr.getAttribute('data-c') === codigo); });
  }
  function fecharDrawer() {
    selecionado = null;
    el('drawer').classList.remove('on'); el('fundo').classList.remove('on'); el('drawer').setAttribute('aria-hidden', 'true');
    el('corpo').querySelectorAll('tr.sel').forEach(function(tr) { tr.classList.remove('sel'); });
  }
  function renderDrawer() {
    var r = rows.filter(function(x) { return x.codigo === selecionado; })[0];
    if (!r) { fecharDrawer(); return; }
    var gp = CE.GRUPOS[r.grupo], u = r.unidade;
    var h = '<div class="dr-topo"><div><h2>' + e(r.nome) + '</h2><div class="cod"><span class="gp" style="background:' + gp.cor + ';margin:0 6px 0 0">' + e(gp.rotulo) + '</span>' + e(r.codigo) + ' · ' + e(u) + '</div></div><button type="button" class="dr-x" id="drX" aria-label="Fechar">×</button></div><div class="dr-corpo">';
    h += '<div class="tiles"><div class="tile' + (r.atual < 0 ? ' bad' : '') + '"><b>' + fmt(r.atual) + '</b><span>Saldo atual (' + e(u) + ')</span></div>' +
      '<div class="tile"><b>' + fmt(r.empenhado) + '</b><span>Empenhado para OPs</span></div>' +
      '<div class="tile' + (r.disponivel < 0 ? ' bad' : '') + '"><b>' + fmt(r.disponivel) + '</b><span>Disponível</span></div></div>';
    // Recado em português claro: o que a situação significa e o que fazer.
    if (r.semControle) h += '<div class="alerta info"><b>Este material não controla estoque</b> (ex.: água). Continua na fórmula e na pesagem, mas não dá baixa, não é reservado e não entra na compra.</div>';
    else if (r.atual < 0) h += '<div class="alerta bad"><b>Saldo negativo.</b> O sistema já baixou mais do que entrou. Quase sempre é entrada que nunca foi lançada: conte o físico e faça um <b>Ajuste de saldo</b> no Estoque/WMS.</div>';
    else if (r.disponivel < 0) h += '<div class="alerta bad"><b>As OPs reservaram ' + fmt(r.empenhado) + ' e só há ' + fmt(r.atual) + '.</b> Faltam ' + fmt(-r.disponivel) + ' ' + e(u) + ' para atender tudo o que está programado.</div>';
    if (r.vencido > 0) h += '<div class="alerta bad"><b>' + fmt(r.vencido) + ' ' + e(u) + ' vencidos.</b> Não podem ser usados: verifique o descarte.</div>';
    else if (r.vencendo > 0) h += '<div class="alerta warn"><b>' + fmt(r.vencendo) + ' ' + e(u) + ' vencem em até ' + CE.DIAS_VENCENDO + ' dias.</b> Use primeiro (a lista de lotes abaixo já está na ordem de validade).</div>';
    if (r.quarentena > 0) h += '<div class="alerta info"><b>' + fmt(r.quarentena) + ' ' + e(u) + ' em quarentena</b>, aguardando a liberação da Qualidade. Não contam como utilizáveis até lá.</div>';
    if (r.semEndereco > 0) h += '<div class="alerta warn"><b>' + fmt(r.semEndereco) + ' ' + e(u) + ' sem lote/endereço.</b> O saldo agregado é maior que a soma dos lotes endereçados: falta guardar ou endereçar no WMS.</div>';

    var cl = Object.keys(r.porCliente);
    if (cl.length) {
      h += '<div class="secao"><h3>De quem é</h3><table class="mini"><tbody>' +
        cl.map(function(k) { return '<tr><td>👤 ' + e(r.porCliente[k].nome) + '</td><td style="text-align:right"><b>' + fmt(r.porCliente[k].saldo) + '</b> ' + e(u) + '</td></tr>'; }).join('') +
        '<tr><td>🏭 Estoque geral da Kuryos</td><td style="text-align:right"><b>' + fmt(r.geral) + '</b> ' + e(u) + '</td></tr></tbody></table>' +
        '<div class="dica" style="margin-top:6px">Material do cliente só pode ser usado em produtos dele.</div></div>';
    }
    if (r.lotes.length) {
      h += '<div class="secao"><h3>Lotes e endereços (' + r.lotes.length + ')</h3><table class="mini"><thead><tr><th>Lote</th><th>Onde</th><th>Validade</th><th style="text-align:right">Saldo</th></tr></thead><tbody>' +
        r.lotes.slice(0, 40).map(function(l) {
          var st = l.status === 'QUARENTENA' ? '<span class="tg info">quarentena</span>' : l.status === 'REPROVADO' ? '<span class="tg bad">reprovado</span>' : l.vencido ? '<span class="tg bad">vencido</span>' : l.vencendo ? '<span class="tg warn">' + l.dias + ' d</span>' : '';
          return '<tr><td><b>' + e(l.lote) + '</b>' + (l.loteFornecedor ? '<div class="mut" style="font-size:11px">forn.: ' + e(l.loteFornecedor) + '</div>' : '') + (l.dono ? '<div class="mut" style="font-size:11px">' + e(l.dono) + '</div>' : '') + '</td><td>' + (e(l.endereco) || '<span class="mut">—</span>') + '</td><td>' + dataBR(l.validade) + ' ' + st + '</td><td style="text-align:right"><b>' + fmt(l.saldo) + '</b></td></tr>';
        }).join('') + '</tbody></table>' + (r.lotes.length > 40 ? '<div class="dica">Mostrando 40 de ' + r.lotes.length + '.</div>' : '') + '</div>';
    } else if (!r.produto) {
      h += '<div class="secao"><h3>Lotes e endereços</h3><div class="dica">Nenhum lote endereçado. O saldo existe só no agregado (ajuste manual ou entrada antiga).</div></div>';
    }
    if (r.empenhos.length) {
      h += '<div class="secao"><h3>Reservado para as OPs (' + r.empenhos.length + ')</h3><table class="mini"><tbody>' +
        r.empenhos.slice(0, 15).map(function(x) { return '<tr><td><b>' + e(x.lote) + '</b>' + (x.sku ? ' <span class="mut">' + e(x.sku) + '</span>' : '') + '</td><td style="text-align:right">' + fmt(x.qtd) + ' ' + e(u) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (!r.produto) {
      h += '<div class="secao"><h3>Onde é usado</h3>';
      if (!usos) h += '<div class="dica">Carregando fórmulas e BOMs…</div>';
      else {
        var lst = usos[r.codigo] || [];
        h += lst.length ? '<table class="mini"><tbody>' + lst.slice(0, 12).map(function(x) {
          return '<tr><td><b>' + e(x.sku) + '</b> <span class="mut">' + e(x.descricao) + '</span></td><td style="text-align:right"><span class="tg mute">' + e(x.via) + '</span></td></tr>';
        }).join('') + '</tbody></table>' + (lst.length > 12 ? '<div class="dica">+ ' + (lst.length - 12) + ' produtos.</div>' : '') : '<div class="dica">Nenhuma fórmula ou BOM vigente usa este material.</div>';
      }
      h += '</div>';
    }
    if (r.ultimaMov) {
      var tp = {ajuste_manual: 'Ajuste manual', recebimento: 'Recebimento', consumo: 'Consumo de OP'}[r.ultimaMov.tipo] || r.ultimaMov.tipo.replace(/_/g, ' ');
      h += '<div class="secao"><h3>Última movimentação</h3><div class="dica"><b>' + e(tp) + '</b> de ' + (r.ultimaMov.qtd > 0 ? '+' : '') + fmt(r.ultimaMov.qtd) + ' ' + e(u) + ' · ' + relativo(r.ultimaMov.em) + (r.ultimaMov.ref ? ' · “' + e(r.ultimaMov.ref) + '”' : '') + '</div></div>';
    }
    h += '<div class="dr-links"><a class="btn pri" href="kardex.html?item=' + encodeURIComponent(r.codigo) + '">Ver histórico (Kardex)</a><a class="btn" href="estoque.html?tab=agregado">Ajustar no Estoque/WMS</a><button type="button" class="btn" id="btnCopia">Copiar código</button></div></div>';
    el('drawer').innerHTML = h;
    el('drX').onclick = fecharDrawer;
    el('btnCopia').onclick = function() { try { navigator.clipboard.writeText(r.codigo); el('btnCopia').textContent = 'Copiado ✓'; } catch (x) { /* sem clipboard */ } };
  }

  /* ── Intermediários ── */
  var ESTADOS_INTER = [
    {k: 'pronto', r: 'Pode envasar tudo', cls: 'ok', tg: 'Embalagem completa'},
    {k: 'parcial', r: 'Envasa em parte', cls: 'warn', tg: 'Embalagem parcial'},
    {k: 'bloqueado', r: 'Travado por embalagem', cls: 'bad', tg: 'Falta embalagem'},
    {k: 'sem_bom', r: 'Sem BOM', cls: 'mute', tg: 'Sem BOM'}
  ];
  function estadoInter(a) { var s = a.casamento.estado; return s === 'sem_peso' || s === 'sem_bulk' ? 'sem_bom' : s; }
  function cartaoInter(a) {
    var c = a.casamento, est = estadoInter(a), meta = ESTADOS_INTER.filter(function(x) { return x.k === est; })[0] || ESTADOS_INTER[3];
    var alvo = c.alvo == null ? 0 : c.alvo, pct = alvo > 0 ? Math.min(100, c.pode / alvo * 100) : 0;
    var peso = a.pesoG > 0 ? fmt(a.pesoG, 1) + ' g/peça' + (a.pesoFonte === 'estimado' ? ' (estimado)' : '') : 'peso não cadastrado';
    var h = '<div class="cartao ' + est + '"><div class="topo"><div><h4>' + e(a.produto || a.sku) + '</h4><div class="meta">OP <b>' + e(a.lote) + '</b> · ' + e(a.cliente) + (a.status ? ' · ' + e(a.status) : '') + '</div></div><span class="tg ' + meta.cls + '">' + meta.tg + '</span></div>';
    h += '<div class="meta" style="margin-top:8px">🧪 <b>' + fmt(a.bulkKg, 1) + ' kg</b> de bulk ' + (a.liberado ? 'liberado' : '<span class="tg warn">ainda não liberado pela Qualidade</span>') + ' · ' + peso +
      (a.bombonas.length ? ' · em ' + e(a.bombonas.map(function(b) { return b.codigo; }).join(', ')) : '') + '</div>';
    if (alvo > 0 && c.itens.length) {
      h += '<div class="prog ' + est + '"><i style="width:' + pct.toFixed(1) + '%"></i></div><div class="prog-leg"><span>Dá para envasar <b>' + fmt(c.pode, 0) + '</b> un com a embalagem em estoque</span><span class="mut">meta ' + fmt(alvo, 0) + ' un</span></div>';
    }
    if (c.gargalo) {
      h += '<div class="gargalo">⛔ <b>Trava em: ' + e(c.gargalo.nome) + '.</b> Há ' + fmt(c.gargalo.usavel, 0) + ' utilizáveis' + (c.gargalo.outrosEmpenhos ? ' (' + fmt(c.gargalo.outrosEmpenhos, 0) + ' reservados para outras OPs)' : '') + (c.gargalo.deOutroCliente ? ' (' + fmt(c.gargalo.deOutroCliente, 0) + ' são de outro cliente)' : '') + ' e faltam <b>' + fmt(c.gargalo.falta, 0) + '</b>.</div>';
    } else if (est === 'pronto') {
      h += '<div class="gargalo ok">✓ Embalagem suficiente para envasar todo o bulk. Pode programar o envase.</div>';
    }
    if (est === 'sem_bom' && c.estado === 'sem_peso') h += '<div class="gargalo" style="background:var(--ce-mute-bg);color:var(--ink-soft)">Não consigo converter kg em peças: o produto não tem peso/volume e densidade cadastrados.</div>';
    if (c.itens.length) {
      h += '<div class="comp">' + c.itens.map(function(i) {
        var p = i.precisa > 0 ? Math.min(100, Math.floor(i.usavel) / i.precisa * 100) : 100;
        return '<div class="l ' + (i.bloqueia && i.falta > 0 ? 'falta' : '') + (i.bloqueia ? '' : ' nb') + '" title="' + e(i.codigo) + (i.bloqueia ? '' : ' — entra depois do envase (não trava)') + '"><span class="n">' + e(i.nome) + '</span><span class="b"><i style="width:' + p.toFixed(0) + '%"></i></span><span class="q">' + fmt(Math.floor(i.usavel), 0) + ' / ' + fmt(i.precisa, 0) + '</span></div>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }
  function renderInter() {
    if (!inter) { el('gradeInter').innerHTML = '<div class="vazia"><b>Carregando OPs…</b>Cruzando manipulações com o estoque de embalagens.</div>'; return; }
    renderEstInter();
    var t = inter.totais;
    el('comoInter').innerHTML = '<b>Como ler esta tela.</b> Cada cartão é uma OP cujo bulk já foi manipulado e ainda não virou produto. Tiro do bulk o que já foi envasado, converto os kg em peças pelo peso de cada uma e confronto com a BOM da OP: a <b>peça só fecha se TODA embalagem de envase (frasco, válvula, rótulo…) existir</b>. O que está reservado para outras OPs e o estoque que é de outro cliente <b>não entram</b>. A caixa de embarque aparece em cinza porque só entra depois. Lembrete: enquanto a contagem do “Dia D” não terminar, muita embalagem aparece como zero.';
    el('nInter').textContent = String(t.ops + inter.retidos.length);
    var fil = inter.aguardando.filter(function(a) { return a.bulkKg > 0; });
    var cont = {}; fil.forEach(function(a) { var k = estadoInter(a); cont[k] = (cont[k] || 0) + 1; });
    el('fEstado').innerHTML = '<span class="rot">Situação</span><button type="button" class="chip' + (!estado.estadoI ? ' on' : '') + '" data-ei="">Todas <span class="c">' + fil.length + '</span></button>' +
      ESTADOS_INTER.map(function(x) { return '<button type="button" class="chip' + (estado.estadoI === x.k ? ' on' : '') + (!cont[x.k] && estado.estadoI !== x.k ? ' vazio' : '') + '" data-ei="' + x.k + '">' + e(x.r) + ' <span class="c">' + (cont[x.k] || 0) + '</span></button>'; }).join('');
    el('fEstado').querySelectorAll('[data-ei]').forEach(function(b) { b.onclick = function() { estado.estadoI = b.getAttribute('data-ei'); renderInter(); }; });
    var toks = CE.norm(estado.qI).split(' ').filter(Boolean);
    var lista = fil.filter(function(a) {
      if (estado.estadoI && estadoInter(a) !== estado.estadoI) return false;
      var alvo = CE.norm([a.lote, a.produto, a.sku, a.cliente, a.casamento.itens.map(function(i) { return i.nome; }).join(' ')].join(' '));
      return toks.every(function(tk) { return alvo.indexOf(tk) >= 0; });
    });
    el('resumoInter').innerHTML = '<b>' + lista.length + '</b> ' + plural(lista.length, 'OP', 'OPs') + ' com bulk aguardando · <b>' + fmt(t.bulkKg, 0) + ' kg</b> no total';
    el('gradeInter').innerHTML = lista.length ? lista.map(cartaoInter).join('') : '<div class="vazia" style="grid-column:1/-1"><b>Nenhuma OP com bulk aguardando envase</b>Quando uma manipulação for liberada e ainda não envasada, ela aparece aqui já casada com as embalagens.</div>';
    renderRetidos();
  }
  function renderEstInter() {
    var box = el('estInter'); if (!box) return;
    if (!estInter) { box.innerHTML = '<div class="vazia"><b>Carregando…</b></div>'; return; }
    var t = estInter.totais;
    if (!estInter.linhas.length) { box.innerHTML = '<div class="tabela"><div class="vazia"><b>Nenhum intermediário em estoque</b>Aparece aqui o bulk manipulado e os frascos rotulados que ainda não foram envasados.</div></div>'; return; }
    var kg = function(v) { return v > 0 ? fmt(v, 1) + ' kg' : '<span class="mut">—</span>'; };
    var un = function(v) { return v > 0 ? fmt(v, 0) + ' un' : '<span class="mut">—</span>'; };
    box.innerHTML = '<div class="kpis" style="margin:0 0 10px"><div class="kpi ok" style="cursor:default"><b>' + fmt(t.bulkLiberadoKg, 1) + ' kg</b><span>Bulk liberado</span><small>pronto para envasar</small></div>' +
      '<div class="kpi warn" style="cursor:default"><b>' + fmt(t.bulkAguardandoKg, 1) + ' kg</b><span>Bulk aguardando Qualidade</span><small>ainda não liberado</small></div>' +
      '<div class="kpi ok" style="cursor:default"><b>' + fmt(t.frascosLiberados, 0) + '</b><span>Frascos rotulados liberados</span><small>prontos para o envase</small></div>' +
      '<div class="kpi warn" style="cursor:default"><b>' + fmt(t.frascosAguardando, 0) + '</b><span>Frascos rotulados aguardando Qualidade</span><small><a class="linklike" href="material_processo.html?aba=sobras">validar na Qualidade</a></small></div></div>' +
      '<div class="tabela"><table><thead><tr><th>Produto</th><th>Cliente</th><th class="num">Bulk liberado</th><th class="num">Bulk aguardando</th><th class="num">Frascos liberados</th><th class="num">Frascos aguardando</th><th>De onde vem</th></tr></thead><tbody>' +
      estInter.linhas.map(function(l) {
        var ops = l.ops.map(function(o) { return '<span class="tg mute" title="' + e((o.bulkKg > 0 ? fmt(o.bulkKg, 1) + ' kg de bulk' : '') + (o.frascos > 0 ? ' · ' + fmt(o.frascos, 0) + ' frascos (' + o.origemFrascos + ')' : '')) + '">OP ' + e(o.lote) + '</span>'; }).join(' ');
        return '<tr style="cursor:default"><td><b>' + e(l.produto || l.sku) + '</b><div class="mut" style="font-size:11.5px">' + e(l.sku) + '</div></td><td>' + e(l.cliente) + '</td><td class="num"><b>' + kg(l.bulkLiberadoKg) + '</b></td><td class="num">' + kg(l.bulkAguardandoKg) + '</td><td class="num"><b>' + un(l.frascosLiberados) + '</b></td><td class="num">' + un(l.frascosAguardando) + (l.frascosReprovados ? '<div class="tg bad" style="margin-top:3px">' + fmt(l.frascosReprovados, 0) + ' reprovados</div>' : '') + '</td><td>' + ops + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  var ROTULO_TIPO = {BULK: '🧪 Bulk', FRASCO_ROTULADO: '🏷️ Frascos rotulados', FRASCO_VAZIO: 'Frascos vazios', ROTULO: 'Rótulos', VALVULA: 'Válvulas'};
  function renderRetidos() {
    var r = inter ? inter.retidos : [];
    if (!r.length) { el('retidos').innerHTML = '<div class="tabela"><div class="vazia"><b>Nada retido no momento</b>Quando a produção declarar sobras ao encerrar ou devolver uma OP à fila, aparecem aqui.</div></div>'; return; }
    el('retidos').innerHTML = '<div class="tabela"><table><thead><tr><th>O que é</th><th class="num">Quantidade</th><th>OP / produto</th><th>De quem é</th><th>Onde</th><th>Para fechar o produto</th></tr></thead><tbody>' + r.map(function(x) {
      var c = x.casamento, fecha = '<span class="mut">—</span>';
      if (c) {
        if (c.estado === 'pronto') fecha = '<span class="tg ok">Embalagem completa</span>' + (x.tipo === 'BULK' ? ' <span class="mut">dá ' + fmt(c.pode, 0) + ' un</span>' : '');
        else if (c.gargalo) fecha = '<span class="tg bad">Falta ' + e(c.gargalo.nome) + '</span> <span class="mut">(' + fmt(c.gargalo.falta, 0) + ')</span>';
        else if (c.estado === 'sem_peso') fecha = '<span class="mut">sem peso cadastrado</span>';
        else if (c.estado === 'sem_bom') fecha = '<span class="mut">sem BOM</span>';
      }
      return '<tr style="cursor:default"><td><b>' + (ROTULO_TIPO[x.tipo] || e(x.tipo)) + '</b></td><td class="num"><span class="saldo">' + fmt(x.qtd) + '<small>' + e(x.unidade) + '</small></span></td><td>' + e(x.lote) + '<div class="mut" style="font-size:11px">' + e(x.produto) + '</div></td><td>' + (x.dono ? e(x.dono) : '<span class="mut">—</span>') + '</td><td>' + (x.recipiente ? e(x.recipiente) : e(x.local) || '<span class="mut">sem recipiente</span>') + '</td><td>' + fecha + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  /* ── Abas, render geral, atalhos ── */
  function irParaAba(qual) {
    estado.aba = qual;
    el('abaItens').classList.toggle('on', qual === 'itens'); el('abaInter').classList.toggle('on', qual === 'inter');
    el('abaItens').setAttribute('aria-selected', qual === 'itens'); el('abaInter').setAttribute('aria-selected', qual === 'inter');
    el('pItens').hidden = qual !== 'itens'; el('pInter').hidden = qual !== 'inter';
    gravarUrl(); renderKpis(); if (qual === 'inter') renderInter();
  }
  function render() {
    var c = renderFiltros();
    renderTabela(c);
    renderKpis();
    if (estado.aba === 'inter' || inter) { if (estado.aba === 'inter') renderInter(); else el('nInter').textContent = String(inter.totais.ops + inter.retidos.length); }
    el('qLimpa').hidden = !estado.q;
    document.body.classList.toggle('denso', estado.denso);
    gravarUrl();
    if (selecionado) renderDrawer();
  }

  function exportarCsv() {
    var lista = visiveis.length ? visiveis : rows;
    var cab = ['Código', 'Item', 'Tipo', 'Unidade', 'Saldo', 'Empenhado', 'Disponível', 'Em quarentena', 'Próxima validade', 'Endereços', 'Clientes (dono)', 'Situação'];
    var lin = lista.map(function(r) {
      return [r.codigo, r.nome, CE.GRUPOS[r.grupo].rotulo, r.unidade, r.atual, r.empenhado, r.disponivel, r.quarentena, r.proxValidade, r.enderecos.join(' | '),
        r.clientes.map(function(k) { return r.porCliente[k] ? r.porCliente[k].nome : k; }).join(' | '), r.tags.map(function(t) { return ROTULO_TAG[t]; }).join(' | ')];
    });
    var csv = [cab].concat(lin).map(function(l) { return l.map(function(v) { var s = String(v == null ? '' : v).replace(/\./g, function() { return '.'; }); return '"' + s.replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    var blob = new Blob(['﻿' + csv], {type: 'text/csv;charset=utf-8'});
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'estoque-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  var timer = null;
  el('q').addEventListener('input', function() { clearTimeout(timer); var v = el('q').value; timer = setTimeout(function() { estado.q = v; estado.mostrar = TAM_PAGINA; focoIdx = -1; render(); }, 90); });
  el('qLimpa').onclick = function() { el('q').value = ''; estado.q = ''; render(); el('q').focus(); };
  el('qI').addEventListener('input', function() { estado.qI = el('qI').value; renderInter(); });
  el('fCliente').onchange = function() { estado.cliente = el('fCliente').value; estado.mostrar = TAM_PAGINA; render(); };
  el('fOrdem').onchange = function() { estado.ordem = el('fOrdem').value; estado.desc = false; render(); };
  el('abaItens').onclick = function() { irParaAba('itens'); };
  el('abaInter').onclick = function() { irParaAba('inter'); };
  el('fundo').onclick = fecharDrawer;
  el('btnCsv').onclick = exportarCsv;
  el('btnDens').onclick = function() { estado.denso = !estado.denso; el('btnDens').textContent = estado.denso ? '↕ Confortável' : '↕ Compacto'; try { localStorage.setItem('ce-denso', estado.denso ? '1' : '0'); } catch (x) { /* sem storage */ } render(); };
  document.querySelectorAll('thead th[data-o]').forEach(function(th) {
    th.onclick = function() { var o = th.getAttribute('data-o'); if (estado.ordem === o) estado.desc = !estado.desc; else { estado.ordem = o; estado.desc = o === 'atual' || o === 'atualizado'; } render(); };
  });
  document.addEventListener('keydown', function(ev) {
    var alvo = ev.target, digitando = alvo && /^(INPUT|SELECT|TEXTAREA)$/.test(alvo.tagName);
    if (ev.key === 'Escape') { if (selecionado) { fecharDrawer(); ev.preventDefault(); } else if (digitando && alvo.id === 'q' && estado.q) { el('q').value = ''; estado.q = ''; render(); } return; }
    if (ev.key === '/' && !digitando) { ev.preventDefault(); irParaAba('itens'); el('q').focus(); el('q').select(); return; }
    if (estado.aba !== 'itens' || (digitando && alvo.id !== 'q')) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      var trs = el('corpo').querySelectorAll('tr[data-c]'); if (!trs.length) return;
      ev.preventDefault();
      focoIdx = ev.key === 'ArrowDown' ? Math.min(trs.length - 1, focoIdx + 1) : Math.max(0, focoIdx - 1);
      trs.forEach(function(t) { t.classList.remove('foco'); });
      trs[focoIdx].classList.add('foco'); trs[focoIdx].scrollIntoView({block: 'nearest'});
      if (selecionado) abrirDrawer(trs[focoIdx].getAttribute('data-c'));
    } else if (ev.key === 'Enter' && focoIdx >= 0 && !selecionado) {
      var t = el('corpo').querySelectorAll('tr[data-c]')[focoIdx]; if (t) { ev.preventDefault(); abrirDrawer(t.getAttribute('data-c')); }
    }
  });

  lerUrl();
  try { estado.denso = localStorage.getItem('ce-denso') === '1'; } catch (x) { /* sem storage */ }
  el('q').value = estado.q; el('btnDens').textContent = estado.denso ? '↕ Confortável' : '↕ Compacto';
  irParaAba(estado.aba);

  // Itens primeiro (o que a pessoa vê); OPs e BOMs chegam logo depois, sem travar a tela.
  function falha() { el('sTxt').textContent = 'Sem conexão'; }
  dbOnValue(db.ref('estoque'), function(s) { dados.estoque = s.val() || {}; recalcular(); }, {onError: falha});
  dbOnValue(db.ref('materiais'), function(s) { dados.materiais = s.val() || {}; recalcular(); }, {onError: falha});
  dbOnValue(db.ref('estoque_lotes'), function(s) { dados.lotes = s.val() || {}; recalcular(); }, {onError: falha});
  dbOnValue(db.ref('ops'), function(s) { dados.ops = s.val() || {}; recalcular(); });
  dbOnValue(db.ref('produtos'), function(s) { dados.produtos = s.val() || {}; recalcular(); });
  dbOnValue(db.ref('bom'), function(s) { dados.bom = s.val() || {}; recalcular(); });
  dbOnValue(db.ref('material_processo'), function(s) { dados.mp = s.val() || {}; recalcular(); });
  dbOnValue(db.ref('perdas'), function(s) { dados.perdas = s.val() || {}; recalcular(); });
  dbOnValue(db.ref('qualidade_intermediarios'), function(s) { dados.validacoes = s.val() || {}; recalcular(); });
  dbOnValue(db.ref('bombonas_bulk'), function(s) { dados.bombonas = s.val() || {}; recalcular(); });
  // Cadastro de clientes: unifica o cliente do produto acabado com o dos materiais (06/10).
  dbOnValue(db.ref('clientes'), function(s) { dados.clientes = s.val() || {}; recalcular(); });
  setInterval(function() { if (rows.length) { var c = el('resumoTxt'); if (c) renderTabela(); } }, 60000);
})();
