/* ══════════════════════════════════════════════════════════════════════
   ENCERRAMENTO DE PEDIDO (08/10/2026)

   Decisões do usuário:
   - "ok, ambos": PCP (tela Pedidos) e Comercial encerram;
   - 95% produzido "pode ser só aviso": a linha fica "pronta para encerrar",
     não some sozinha. Concluída de verdade = encerrada, ou 100% produzida.
   Antes: botão por linha (7 cliques no pedido 05 da Febella -- 3 linhas
   ficaram abertas), sem motivo, sem quem/quando, e o "Salvar" com status
   "Automático" reabria em silêncio.
   Aqui: encerra o pedido INTEIRO ou uma linha, motivo obrigatório, grava
   quem/quando/origem e quanto ficou sem produzir; reabrir exige motivo.
   Histórico em pedidos/{key}/encerramentoHistorico.
   Funções puras (testadas em node) + diálogo (navegador).
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EncerramentoPedido = api;
})(typeof window !== 'undefined' ? window : this, function() {
  'use strict';

  var LIMIAR_PRONTO = 95;
  var MOTIVOS = {
    ATENDIDO_TOLERANCIA: 'Atendido dentro da tolerância',
    CLIENTE_ACEITOU_MENOS: 'Cliente aceitou receber menos',
    SALDO_CANCELADO_CLIENTE: 'Saldo cancelado pelo cliente',
    OUTRO: 'Outro'
  };
  var ORIGENS = {PCP: 'PCP', COMERCIAL: 'Comercial'};

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function esc(v) { return txt(v).replace(/[&<>"']/g, function(c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }

  function percentual(p) { return p && num(p.qtdTotal) > 0 ? Math.round(num(p.produzido) / num(p.qtdTotal) * 100) : 0; }

  /* encerrado | concluido | pronto | andamento.
     concluido: status "Concluído" (apontamento ao bater 100%, ou importação) ou 100% produzido. */
  function situacao(p) {
    if (!p) return 'andamento';
    if (txt(p.statusManual).toLowerCase() === 'encerrado') return 'encerrado';
    if (txt(p.status).toLowerCase().indexOf('conclu') === 0) return 'concluido';
    var pc = percentual(p);
    if (num(p.qtdTotal) > 0 && num(p.produzido) >= num(p.qtdTotal)) return 'concluido';
    if (pc >= LIMIAR_PRONTO) return 'pronto';
    return 'andamento';
  }

  // Linhas (SKUs) de um pedido comercial: chave "{id}__SKU" ou parentPedidoId/id igual.
  function linhasDoPedido(pedidos, pedidoId) {
    var id = txt(pedidoId);
    if (!id) return [];
    return Object.keys(pedidos || {}).filter(function(k) {
      var p = pedidos[k];
      if (!p) return false;
      return k.indexOf(id + '__') === 0 || txt(p.parentPedidoId) === id || (!p.parentPedidoId && txt(p.id) === id);
    }).sort();
  }

  function idHistorico(agora, sufixo) { return 'h' + String(Date.parse(agora) || Date.now()) + (sufixo || ''); }

  /* Monta o update de encerramento. opcoes: {motivoTipo, texto, por, origem, agora}.
     Devolve {ok, erro, updates, linhas:[{key, sku, produto, saldo}]}. Linhas já
     encerradas ficam de fora (não regrava quem/quando de quem encerrou antes). */
  function montarEncerramento(pedidos, keys, opcoes) {
    var o = opcoes || {}, agora = o.agora || new Date().toISOString();
    if (!MOTIVOS[o.motivoTipo]) return {ok: false, erro: 'Escolha o motivo do encerramento.'};
    if (o.motivoTipo === 'OUTRO' && !txt(o.texto)) return {ok: false, erro: 'Descreva o motivo.'};
    if (!txt(o.por)) return {ok: false, erro: 'Usuário não identificado.'};
    var updates = {}, linhas = [];
    (keys || []).forEach(function(k, i) {
      var p = (pedidos || {})[k];
      // Já encerrada ou concluída (100% / Concluído): nada a encerrar.
      if (!p || situacao(p) === 'encerrado' || situacao(p) === 'concluido') return;
      var saldo = Math.max(0, num(p.qtdTotal) - num(p.produzido));
      var reg = {motivoTipo: o.motivoTipo, motivo: MOTIVOS[o.motivoTipo], texto: txt(o.texto) || null,
        por: txt(o.por), origem: ORIGENS[o.origem] ? o.origem : 'PCP', em: agora,
        qtdTotal: num(p.qtdTotal), produzido: num(p.produzido), saldoNaoProduzido: saldo};
      updates['pedidos/' + k + '/statusManual'] = 'encerrado';
      updates['pedidos/' + k + '/encerramento'] = reg;
      updates['pedidos/' + k + '/encerramentoHistorico/' + idHistorico(agora, '-' + i)] = Object.assign({acao: 'ENCERRADO'}, reg);
      linhas.push({key: k, sku: txt(p.sku), produto: txt(p.produto), saldo: saldo});
    });
    if (!linhas.length) return {ok: false, erro: 'Nada a encerrar: as linhas já estão encerradas ou concluídas.'};
    return {ok: true, updates: updates, linhas: linhas};
  }

  /* Reabrir: só linhas encerradas; motivo obrigatório. Cancelamento comercial
     (canceladoPorComercial) não reabre por aqui -- é decisão do Comercial. */
  function montarReabertura(pedidos, keys, opcoes) {
    var o = opcoes || {}, agora = o.agora || new Date().toISOString();
    if (!txt(o.texto)) return {ok: false, erro: 'Informe o motivo da reabertura.'};
    if (!txt(o.por)) return {ok: false, erro: 'Usuário não identificado.'};
    var updates = {}, linhas = [];
    (keys || []).forEach(function(k, i) {
      var p = (pedidos || {})[k];
      if (!p || situacao(p) !== 'encerrado') return;
      if (p.canceladoPorComercial && o.origem !== 'COMERCIAL') return;
      updates['pedidos/' + k + '/statusManual'] = null;
      updates['pedidos/' + k + '/encerramento'] = null;
      updates['pedidos/' + k + '/canceladoPorComercial'] = null;
      updates['pedidos/' + k + '/encerramentoHistorico/' + idHistorico(agora, '-r' + i)] = {acao: 'REABERTO', texto: txt(o.texto),
        por: txt(o.por), origem: ORIGENS[o.origem] ? o.origem : 'PCP', em: agora};
      linhas.push({key: k, sku: txt(p.sku), produto: txt(p.produto)});
    });
    if (!linhas.length) return {ok: false, erro: 'Nenhuma linha encerrada para reabrir' + (o.origem !== 'COMERCIAL' ? ' (cancelamento do Comercial só o Comercial reabre).' : '.')};
    return {ok: true, updates: updates, linhas: linhas};
  }

  // Texto curto do encerramento para título/hover.
  function descricao(p) {
    var e = p && p.encerramento;
    if (!e) return p && p.canceladoPorComercial ? 'Saldo cancelado pelo Comercial' : '';
    var d = String(e.em || '').slice(0, 10).split('-').reverse().join('/');
    return 'Encerrado por ' + (e.por || '?') + ' (' + (ORIGENS[e.origem] || e.origem || '') + ') em ' + d + ': ' + (e.motivo || '') +
      (e.texto ? ' — ' + e.texto : '') + (e.saldoNaoProduzido ? '. Ficaram ' + Number(e.saldoNaoProduzido).toLocaleString('pt-BR') + ' un sem produzir.' : '.');
  }

  /* ── Diálogo (navegador) ──
     cfg: {db, pedidos, pedidoId, keyLinha (opcional), acao:'encerrar'|'reabrir',
           por, origem:'PCP'|'COMERCIAL', aposGravar(linhas) -> Promise|undefined, aoConcluir(msg)} */
  function abrirDialogo(cfg) {
    var doc = document, c = cfg || {}, reabrir = c.acao === 'reabrir';
    var antigo = doc.getElementById('encPedDlg'); if (antigo) antigo.remove();
    var pedidos = c.pedidos || {};
    var todas = linhasDoPedido(pedidos, c.pedidoId);
    if (c.keyLinha && todas.indexOf(c.keyLinha) < 0) todas.push(c.keyLinha);
    var alvoTodas = todas.filter(function(k) { return reabrir ? situacao(pedidos[k]) === 'encerrado' : (situacao(pedidos[k]) === 'andamento' || situacao(pedidos[k]) === 'pronto'); });
    var linhaP = c.keyLinha ? pedidos[c.keyLinha] : null;
    function linhaTxt(k) {
      var p = pedidos[k] || {};
      return esc(p.produto || p.sku || k) + ' — ' + num(p.produzido).toLocaleString('pt-BR') + ' / ' + num(p.qtdTotal).toLocaleString('pt-BR') + ' (' + percentual(p) + '%)';
    }
    var bg = doc.createElement('div');
    bg.id = 'encPedDlg';
    bg.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px');
    var escopo = '';
    if (c.keyLinha && alvoTodas.length > 1) {
      escopo = '<fieldset style="border:0;padding:0;margin:0 0 10px"><legend style="font-weight:700;font-size:13px;margin-bottom:4px">O que ' + (reabrir ? 'reabrir' : 'encerrar') + '</legend>' +
        '<label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:4px"><input type="radio" name="encEscopo" value="linha" checked> Só esta linha: ' + linhaTxt(c.keyLinha) + '</label>' +
        '<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="radio" name="encEscopo" value="todas"> Todas as ' + alvoTodas.length + ' linhas ' + (reabrir ? 'encerradas' : 'abertas') + ' do pedido #' + esc(c.pedidoId) + '</label></fieldset>';
    } else {
      var lista = c.keyLinha ? [c.keyLinha] : alvoTodas;
      escopo = '<div style="font-size:13px;margin-bottom:10px"><b>' + (lista.length === 1 ? 'Linha' : lista.length + ' linhas') + ' do pedido #' + esc(c.pedidoId) + ':</b><ul style="margin:4px 0 0 18px;padding:0">' +
        lista.map(function(k) { return '<li>' + linhaTxt(k) + '</li>'; }).join('') + '</ul></div>';
    }
    var motivos = Object.keys(MOTIVOS).map(function(k) { return '<option value="' + k + '">' + MOTIVOS[k] + '</option>'; }).join('');
    bg.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="encPedTit" style="background:var(--card,var(--surface,#fff));color:var(--text,#111);border-radius:10px;max-width:560px;width:100%;max-height:92vh;overflow:auto;padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.3)">' +
      '<h3 id="encPedTit" style="margin:0 0 10px;font-size:17px">' + (reabrir ? '↩ Reabrir pedido #' : '⬛ Encerrar pedido #') + esc(c.pedidoId) + '</h3>' +
      (!(c.keyLinha || alvoTodas.length) ? '<p>Nada a ' + (reabrir ? 'reabrir' : 'encerrar') + ' neste pedido.</p>' : escopo +
      (reabrir ? '' : '<label style="display:block;font-size:13px;font-weight:700;margin-bottom:4px" for="encMotivo">Motivo *</label><select id="encMotivo" style="width:100%;margin-bottom:8px"><option value="">— escolha —</option>' + motivos + '</select>') +
      '<label style="display:block;font-size:13px;font-weight:700;margin-bottom:4px" for="encTexto">' + (reabrir ? 'Motivo da reabertura *' : 'Detalhe <span id="encTextoObrig" style="font-weight:400">(obrigatório em "Outro")</span>') + '</label>' +
      '<textarea id="encTexto" rows="2" style="width:100%;box-sizing:border-box" placeholder="' + (reabrir ? 'Ex.: cliente pediu o saldo de volta' : 'Ex.: cliente aceitou 9.549 de 10.000') + '"></textarea>' +
      (reabrir ? '' : '<div style="font-size:12px;color:var(--muted,#666);margin-top:6px">Fica gravado quem encerrou, quando e quanto ficou sem produzir. A linha deixa de pedir produção e material.</div>')) +
      '<div id="encErro" role="alert" style="display:none;color:var(--danger,#b91c1c);font-size:13px;margin-top:8px"></div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px"><button type="button" class="btn btn-ghost ghost" id="encCancelar">Cancelar</button>' +
      ((c.keyLinha || alvoTodas.length) ? '<button type="button" class="btn ' + (reabrir ? 'btn-primary' : 'btn-danger danger') + '" id="encConfirmar">' + (reabrir ? 'Reabrir' : 'Encerrar') + '</button>' : '') + '</div></div>';
    doc.body.appendChild(bg);
    function $(id) { return doc.getElementById(id); }
    function fechar() { bg.remove(); }
    $('encCancelar').onclick = fechar;
    bg.addEventListener('click', function(e) { if (e.target === bg) fechar(); });
    var btn = $('encConfirmar');
    if (!btn) return;
    btn.onclick = function() {
      var esc2 = doc.querySelector('input[name="encEscopo"]:checked');
      var keys = c.keyLinha && !(esc2 && esc2.value === 'todas') ? [c.keyLinha] : alvoTodas;
      var opc = {motivoTipo: reabrir ? null : $('encMotivo').value, texto: $('encTexto').value, por: c.por, origem: c.origem};
      var r = reabrir ? montarReabertura(pedidos, keys, opc) : montarEncerramento(pedidos, keys, opc);
      if (!r.ok) { $('encErro').textContent = r.erro; $('encErro').style.display = ''; return; }
      btn.disabled = true;
      c.db.ref().update(r.updates).then(function() {
        return c.aposGravar ? c.aposGravar(r.linhas) : null;
      }).then(function() {
        fechar();
        if (c.aoConcluir) c.aoConcluir((reabrir ? 'Reaberta' : 'Encerrada') + (r.linhas.length === 1 ? ' 1 linha' : 's ' + r.linhas.length + ' linhas') + ' do pedido #' + c.pedidoId + '.');
      }).catch(function(e) {
        btn.disabled = false;
        $('encErro').textContent = 'Não foi possível gravar: ' + (e && e.message || e) + (/permission/i.test(String(e && e.message)) ? ' (seu usuário não pode encerrar pedido: só PCP e Comercial).' : '');
        $('encErro').style.display = '';
      });
    };
  }

  return {LIMIAR_PRONTO: LIMIAR_PRONTO, MOTIVOS: MOTIVOS, ORIGENS: ORIGENS, percentual: percentual, situacao: situacao,
    linhasDoPedido: linhasDoPedido, montarEncerramento: montarEncerramento, montarReabertura: montarReabertura,
    descricao: descricao, abrirDialogo: abrirDialogo};
});
