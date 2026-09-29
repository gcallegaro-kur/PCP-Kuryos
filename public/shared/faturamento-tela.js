'use strict';
/* FATURAMENTO DE CARGAS (2ª de 3 telas da expedição de vendas, 29/09).
   Carga agendada chega aqui: solicita-se o faturamento ao Financeiro (e-mail
   com cópia à diretoria, pelo servidor) e registra-se a NF emitida. Com a NF,
   a carga passa ao Acompanhamento (cargas.html), onde é carregada e sai.
   Callable: faturamentoCargaPA (functions/faturamento_carga.js) -- a mesma de
   antes; só a tela mudou. */
(function() {
  var db = firebase.database(), fn = firebase.functions();
  var agendas = {}, formAberto = null, ocupado = false, solicitacaoIds = {};
  var destaque = new URLSearchParams(location.search).get('carga');
  var destaqueRolado = false;
  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function num(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function brl(v) { return Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}); }
  function dataBR(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—'; }
  function hoje() { return new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'}); }
  function aviso(html, erro) { var r = el('resultado'); r.className = 'notice' + (erro ? ' error' : ''); r.innerHTML = html; }
  var EMAIL = {ENVIADO: 'e-mail enviado ao Financeiro', ENVIANDO: 'enviando e-mail…', SEM_DESTINATARIOS: 'e-mail NÃO enviado: configure o e-mail do Financeiro', ERRO: 'falha no envio do e-mail'};

  function itensHTML(a) {
    var sol = CargasPA.ultimaSolicitacao(a);
    var porPalete = {};
    ((sol && sol.itens) || []).forEach(function(i) { porPalete[i.itemKey + '/' + i.loteKey] = i; });
    var linhas = (a.paletes || []).map(function(p) {
      var i = porPalete[p.itemKey + '/' + p.loteKey] || {};
      return '<tr><td>' + e(p.identificadorPalete || p.loteKey) + '</td><td><b>' + e(p.sku) + '</b> ' + e(p.descricao || '') + '</td>' +
        '<td>' + e(p.pedidoNumero || '—') + (i.numeroPedidoCliente ? '<div class="sub">PC cliente ' + e(i.numeroPedidoCliente) + '</div>' : '') + '</td>' +
        '<td>' + e(i.lote || '—') + (i.validade ? '<div class="sub">val. ' + dataBR(i.validade) + '</div>' : '') + '</td>' +
        '<td class="num">' + num(p.quantidade) + '</td>' +
        '<td class="num">' + (i.precoUnitario ? brl(i.precoUnitario) : '—') + '</td><td class="num">' + (i.valor ? brl(i.valor) : '—') + '</td></tr>';
    }).join('');
    var t = CargasPA.totais(a);
    return '<table class="carga-itens"><thead><tr><th>Palete</th><th>Produto</th><th>Pedido</th><th>Lote</th><th class="num">Unidades</th><th class="num">Preço un.</th><th class="num">Valor</th></tr></thead><tbody>' + linhas + '</tbody>' +
      '<tfoot><tr><td colspan="4"><b>Total</b>' + (sol && sol.totalPesoKg ? ' · ' + num(sol.totalPesoKg) + ' kg' : '') + '</td><td class="num"><b>' + num(t.unidades) + '</b></td><td></td><td class="num"><b>' + (sol && sol.totalValor ? brl(sol.totalValor) : '—') + '</b></td></tr></tfoot></table>' +
      (!sol ? '<div class="sub">Preços e valores aparecem ao solicitar o faturamento (vêm do pedido).</div>' : sol.itensSemPreco ? '<div class="sub" style="color:#b42318">' + sol.itensSemPreco + ' item(ns) sem preço no pedido.</div>' : '');
  }

  function nfHTML(a) {
    var lista = CargasPA.nfs(a);
    if (!lista.length) return '';
    return lista.map(function(x) {
      return '<div class="carga-nf"><div><b>NF</b>' + e(x.texto) + '</div><div><b>Valor</b>' + brl(x.valor) + '</div><div><b>Emitida em</b>' + dataBR(x.emitidaEm) + '</div>' +
        '<div><b>Chave NF-e</b>' + e(x.chaveNfe || '—') + '</div><div><b>Registrada por</b>' + e(x.registradoPor || '—') + '</div></div>';
    }).join('');
  }

  function solicitacaoHTML(a) {
    var f = a.faturamento || {}, sol = CargasPA.ultimaSolicitacao(a);
    if (!sol) return '';
    var em = sol.email || {};
    return '<div class="sub">Solicitado em ' + dataBR(sol.em) + ' por ' + e(sol.por) + (sol.observacoes ? ' · "' + e(sol.observacoes) + '"' : '') +
      (em.status ? ' · <span' + (em.status === 'ENVIADO' ? '' : ' style="color:#b42318"') + '>' + e(EMAIL[em.status] || em.status) + '</span>' : '') + '</div>';
  }

  function formHTML(k, a) {
    if (!formAberto || formAberto.key !== k) return '';
    var v = formAberto.valores;
    if (formAberto.tipo === 'SOLICITAR') {
      return '<div class="carga-form" data-form="' + e(k) + '"><h3>Solicitar faturamento ao Financeiro</h3>' +
        '<p class="sub">O Financeiro recebe por e-mail (cópia à diretoria) os paletes, lotes, validades, preços e o total desta carga.</p>' +
        '<label for="f_obs">Observações para o Financeiro (opcional)</label><textarea id="f_obs" data-campo="observacoes" rows="2" maxlength="2000">' + e(v.observacoes || '') + '</textarea>' +
        '<p class="carga-erro" id="f_erro">' + e(formAberto.erro || '') + '</p><div class="carga-acoes"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" data-enviar="SOLICITAR">Enviar solicitação</button></div></div>';
    }
    return '<div class="carga-form" data-form="' + e(k) + '"><h3>Registrar NF' + (CargasPA.faturada(a) ? ' adicional' : '') + '</h3>' +
      '<p class="sub">A NF vale para todas as viagens desta carga: o que não couber no veículo segue depois com a mesma nota.</p>' +
      '<div class="fields"><div><label for="f_numero">Número da NF *</label><input id="f_numero" data-campo="numero" inputmode="numeric" maxlength="30" value="' + e(v.numero || '') + '"></div>' +
      '<div><label for="f_serie">Série</label><input id="f_serie" data-campo="serie" maxlength="10" value="' + e(v.serie || '') + '"></div>' +
      '<div><label for="f_valor">Valor da NF (R$)</label><input id="f_valor" data-campo="valor" type="number" min="0" step="0.01" value="' + e(v.valor == null ? '' : v.valor) + '"></div>' +
      '<div><label for="f_emitida">Emitida em</label><input id="f_emitida" data-campo="emitidaEm" type="date" value="' + e(v.emitidaEm || '') + '"></div></div>' +
      '<label for="f_chave" style="margin-top:8px">Chave NF-e</label><input id="f_chave" data-campo="chaveNfe" maxlength="44" inputmode="numeric" placeholder="44 dígitos, se disponível" value="' + e(v.chaveNfe || '') + '">' +
      '<p class="carga-erro" id="f_erro">' + e(formAberto.erro || '') + '</p><div class="carga-acoes"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn" data-enviar="REGISTRAR_NF">Registrar NF</button></div></div>';
  }

  function cardHTML(a) {
    var k = a._key, et = CargasPA.etapa(a), ac = CargasPA.acoes(a), t = CargasPA.totais(a);
    var pedidos = Object.keys(a.pedidos || {}).map(function(x) { return a.pedidos[x]; }).join(', ');
    return '<article class="carga-card' + (k === destaque ? ' destaque' : '') + '" data-carga="' + e(k) + '">' +
      '<div class="carga-topo"><div><h3>' + e(a.cliente) + '</h3><div class="carga-meta">Pedido(s) ' + e(pedidos || '—') + ' · ' +
        (a.tipo === 'COLETA' ? 'Coleta FOB' : 'Entrega CIF') + ' em <b>' + dataBR(a.dataAgendada) + '</b>' + (a.janela ? ' ' + e(a.janela) : '') +
        ' · ' + num(t.paletes) + ' palete(s) · ' + num(t.unidades) + ' un<br>' + e([a.transportadora || 'Transportadora a definir', a.motorista, a.placa].filter(Boolean).join(' · ')) +
        (a.enderecoEntrega ? '<br>Destino: ' + e(typeof a.enderecoEntrega === 'string' ? a.enderecoEntrega : JSON.stringify(a.enderecoEntrega)) : '') + '</div></div>' +
        '<span class="etapa-tag etapa-' + et.cor + '">' + e(et.curto) + '</span></div>' +
      solicitacaoHTML(a) + nfHTML(a) + itensHTML(a) +
      // Com o formulário aberto, as ações ficam só nele (sem botão repetido).
      (formAberto && formAberto.key === k ? '' : '<div class="carga-acoes">' +
        (ac.solicitarFaturamento ? '<button class="btn" data-abrir-form="SOLICITAR" data-k="' + e(k) + '">Solicitar faturamento</button>' : '') +
        (ac.registrarNf ? '<button class="btn' + (ac.solicitarFaturamento ? ' ghost' : '') + '" data-abrir-form="REGISTRAR_NF" data-k="' + e(k) + '">' + (CargasPA.faturada(a) ? 'Registrar outra NF' : 'Registrar NF') + '</button>' : '') +
        '<a class="btn ghost" href="cargas.html?carga=' + encodeURIComponent(k) + '">' + (CargasPA.faturada(a) ? 'Ir para o Acompanhamento →' : 'Acompanhar') + '</a>' +
      '</div>') + formHTML(k, a) + '</article>';
  }

  function render() {
    CargasFluxo.render(el('fluxoCargas'), 'faturamento.html', agendas);
    var filtro = el('filtro').value, busca = el('busca').value;
    var lista = CargasPA.listar(agendas, filtro === 'faturadas' ? 'ativas' : filtro, busca);
    if (filtro === 'faturadas') lista = lista.filter(function(a) { return CargasPA.faturada(a); });
    var c = CargasPA.contagem(agendas);
    el('resumoFat').textContent = num(c.AGENDADA) + ' sem solicitação · ' + num(c.FATURAMENTO_SOLICITADO) + ' aguardando NF · ' + num(c.FATURADA + c.AGUARDANDO_EMBARQUE) + ' faturada(s) ainda não expedida(s)';
    el('listaFat').innerHTML = lista.map(cardHTML).join('') || '<div class="cargas-vazio">' + (filtro === 'faturamento'
      ? 'Nenhuma carga esperando faturamento. Cargas novas chegam aqui quando são agendadas em <a href="expedicao.html">Montar carga</a>.'
      : 'Nenhuma carga neste filtro.') + '</div>';
    ligar();
    if (destaque && !destaqueRolado) {
      var card = document.querySelector('[data-carga="' + CSS.escape(destaque) + '"]');
      if (card) { destaqueRolado = true; card.scrollIntoView({block: 'center'}); }
    }
  }

  function ligar() {
    document.querySelectorAll('[data-abrir-form]').forEach(function(b) {
      b.onclick = function() {
        var k = b.dataset.k, a = agendas[k], tipo = b.dataset.abrirForm, sol = CargasPA.ultimaSolicitacao(a);
        formAberto = {key: k, tipo: tipo, valores: tipo === 'REGISTRAR_NF'
          ? {emitidaEm: hoje(), valor: sol && sol.totalValor && !CargasPA.faturada(a) ? sol.totalValor : ''}
          : {}};
        render();
        var f = document.querySelector('[data-form] input, [data-form] textarea');
        if (f) f.focus();
      };
    });
    document.querySelectorAll('[data-form] [data-campo]').forEach(function(inp) {
      inp.addEventListener('input', function() { formAberto.valores[inp.dataset.campo] = inp.value; });
    });
    document.querySelectorAll('[data-form] [data-fechar]').forEach(function(b) { b.onclick = function() { if (!ocupado) { formAberto = null; render(); } }; });
    document.querySelectorAll('[data-form] [data-enviar]').forEach(function(b) { b.onclick = function() { enviar(b.dataset.enviar, b); }; });
  }

  async function enviar(acao, botao) {
    if (ocupado || !formAberto) return;
    var k = formAberto.key, a = agendas[k], v = formAberto.valores, erro = el('f_erro');
    if (!a) return;
    var dados = {agendaKey: k, revisao: a.revisao, acao: acao};
    if (acao === 'SOLICITAR') {
      // Mesmo id se a rede falhar e a pessoa repetir: o servidor não duplica.
      dados.solicitacaoId = solicitacaoIds[k] || (solicitacaoIds[k] = crypto.randomUUID().replace(/[^A-Za-z0-9_-]/g, ''));
      dados.observacoes = v.observacoes || '';
    } else {
      if (!String(v.numero || '').trim()) { formAberto.erro = 'Informe o número da NF.'; erro.textContent = formAberto.erro; return; }
      dados.nf = {numero: String(v.numero).trim(), serie: String(v.serie || '').trim(), valor: v.valor === '' || v.valor == null ? '' : v.valor,
        emitidaEm: v.emitidaEm || '', chaveNfe: String(v.chaveNfe || '').trim()};
    }
    ocupado = true; botao.disabled = true; botao.textContent = 'Enviando…';
    try {
      await fn.httpsCallable('faturamentoCargaPA')(dados);
      formAberto = null;
      if (acao === 'SOLICITAR') {
        delete solicitacaoIds[k];
        aviso('Faturamento solicitado ao Financeiro para <b>' + e(a.cliente) + '</b>. Quando a NF sair, registre-a aqui.');
      } else {
        aviso('NF ' + e(dados.nf.numero) + ' registrada. A carga de <b>' + e(a.cliente) + '</b> está pronta para carregar: <a href="cargas.html?carga=' + encodeURIComponent(k) + '"><b>Acompanhamento de cargas →</b></a>');
      }
    } catch (err) {
      if (formAberto) formAberto.erro = err.message || 'Não foi possível concluir. Confira a carga e tente de novo.';
    } finally {
      ocupado = false;
      render();
    }
  }

  // Aberta por link de uma carga específica: mostra todas as ativas, para
  // ela aparecer mesmo já faturada.
  if (destaque) el('filtro').value = 'ativas';
  el('filtro').onchange = render;
  el('busca').oninput = render;
  dbOnValue(db.ref('agendamentos_expedicao'), function(s) { agendas = s.val() || {}; render(); });
})();
