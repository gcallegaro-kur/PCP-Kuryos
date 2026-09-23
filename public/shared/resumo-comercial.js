/* Resumo do pedido / orçamento: o documento inteiro numa tela só, e o
   mesmo conteúdo pronto para imprimir ou salvar em PDF.

   Pedido do usuário (2026-09-22): "dentro de Pedidos e Orçamentos, ter a
   opção de visualizar o pdf do pedido, através de um botão, abrir um resumo
   do pedido (até podendo editar - cuidado com toda a cadeia que a edição
   desenrola, para não quebrar em momento algum)".

   ONDE A EDIÇÃO É SEGURA -- é o cerne deste módulo:
   - ORÇAMENTO em elaboração ou enviado: edita aqui mesmo. Ele não cria
     demanda, compra nem OP ("não cria demanda, compra ou OP", tela do
     Comercial), então a cadeia tem uma ponta só.
   - ORÇAMENTO aceito: bloqueado. O aceite já abriu solicitação de cadastro
     de produto; mexer no item aqui deixaria a tarefa órfã. Gera outro.
   - PEDIDO comercial: NUNCA edita por aqui. Ele já desdobrou em
     `pedidos/{id__SKU}` (backlog do PCP), OP emitida, programação, MRP,
     conciliação de expedido e e-mail à diretoria. Quem edita é a Gestão
     Comercial, que tem versão, motivo, trava por produção/expedição já
     feita (`shared/pedido-edicao.js`) e registro na timeline. Este módulo
     manda para lá em vez de abrir um segundo caminho de escrita.

   Funções puras (sem DOM, sem Firebase), testadas em
   run_resumo_comercial_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ResumoComercial = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function texto(v) { return String(v == null ? '' : v).trim(); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(n(v) * 100) / 100; }
  function lista(v) { return Array.isArray(v) ? v.filter(Boolean) : Object.keys(v || {}).map(function(k) { return v[k]; }).filter(Boolean); }
  function moeda(v) { return n(v).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}); }
  function num(v) { return n(v).toLocaleString('pt-BR'); }
  function data(v) {
    var t = texto(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10).split('-').reverse().join('/');
    return t || '—';
  }

  var STATUS = {
    LIBERADO_PCP: 'Liberado ao PCP', EM_ELABORACAO: 'Em elaboração', ENVIADO: 'Enviado ao cliente',
    ACEITO: 'Aceite registrado', CANCELADO: 'Cancelado', ENCERRADO: 'Encerrado'
  };

  function ehOrcamento(doc) { return texto((doc || {}).tipo).toUpperCase() === 'ORCAMENTO'; }

  /* O documento normalizado. `contexto` (opcional) traz o andamento do PCP:
     {pedidosPorSku: {SKU: {qtdTotal, produzido}}, conciliacao: resultado da
     conciliação} -- é o que transforma o resumo num raio-X do pedido. */
  function resumo(doc, chave, contexto) {
    var d = doc || {}, ctx = contexto || {};
    var orc = ehOrcamento(d);
    var itens = lista(d.itens).map(function(i, idx) {
      var qtd = n(i.qtd), unit = n(i.valorUnitario), desc = n(i.desconto);
      var sku = texto(i.sku);
      var and = sku ? (ctx.pedidosPorSku || {})[sku] : null;
      return {
        indice: idx, sku: sku || null, descricao: texto(i.descricao) || texto(i.especificacao) || '(sem descrição)',
        especificacao: texto(i.especificacao) || null,
        qtd: qtd, valorUnitario: unit, desconto: desc, total: arred(qtd * unit - desc),
        // Andamento só existe para pedido: orçamento não vira demanda.
        produzido: and ? n(and.produzido) : null,
        saldo: and ? Math.max(0, arred(qtd - n(and.produzido))) : null,
        semCadastro: orc && !sku
      };
    });
    var totalItens = arred(itens.reduce(function(s, i) { return s + i.total; }, 0));
    return {
      chave: texto(chave) || texto(d.numeroFormatado) || null,
      tipo: orc ? 'ORCAMENTO' : 'PEDIDO',
      rotuloTipo: orc ? 'Orçamento' : 'Pedido comercial',
      numero: texto(d.numeroFormatado) || texto(chave) || '—',
      status: texto(d.status) || null,
      rotuloStatus: STATUS[texto(d.status)] || texto(d.status) || '—',
      cliente: texto(d.cliente) || '—',
      cnpj: texto(d.cnpj) || texto((d.clienteCadastro || {}).cnpj) || null,
      contato: texto(d.contato) || texto((d.contatoSelecionado || {}).nome) || null,
      telefone: texto(d.telefone) || texto((d.contatoSelecionado || {}).telefone) || null,
      email: texto(d.email) || texto((d.contatoSelecionado || {}).email) || null,
      dataPedido: texto(d.dataPedido) || null,
      validade: texto(d.validade) || null,
      previsaoEntrega: texto(d.previsaoComercialEntrega) || null,
      numeroPedidoCliente: texto(d.numeroPedidoCliente) || null,
      percentualNF: d.percentualNF == null ? null : n(d.percentualNF),
      frete: {tipo: texto((d.frete || {}).tipo) || null, prazo: texto((d.frete || {}).prazo) || null,
        enderecoEntrega: texto((d.frete || {}).enderecoEntrega) || texto(d.enderecoEntrega) || null},
      enderecoFaturamento: texto(d.enderecoFaturamento) || null,
      prazoPagamento: texto(d.prazoPagamento) || null,
      observacoes: texto(d.observacoes) || null,
      evidencia: texto(d.evidencia) || null,
      itens: itens,
      qtdTotal: arred(itens.reduce(function(s, i) { return s + i.qtd; }, 0)),
      // O total gravado manda (é o que foi acordado); o somado aparece
      // quando os dois discordam, em vez de escolher um em silêncio.
      total: d.totalValor != null ? arred(d.totalValor) : totalItens,
      totalSomado: totalItens,
      totalDivergente: d.totalValor != null && Math.abs(arred(d.totalValor) - totalItens) >= 0.01,
      produzidoTotal: itens.some(function(i) { return i.produzido != null; })
        ? arred(itens.reduce(function(s, i) { return s + n(i.produzido); }, 0)) : null,
      versao: n(d.versao) || 1,
      criadoEm: texto(d.criadoEm) || null, criadoPor: texto(d.criadoPor) || null,
      historico: lista(d.historico).map(function(h) {
        return {em: texto(h.em) || texto(h.data) || null, tipo: texto(h.tipo) || texto(h.status) || null,
          descricao: texto(h.descricao) || texto(h.texto) || '', por: texto(h.por) || texto(h.usuario) || null};
      }).sort(function(a, b) { return String(a.em || '').localeCompare(String(b.em || '')); })
    };
  }

  /* Onde a edição pode acontecer sem quebrar a cadeia. Devolve o que a tela
     deve oferecer, e por quê -- o "porquê" aparece para o usuário. */
  function acaoEdicao(r) {
    if (!r) return {modo: 'BLOQUEADO', motivo: 'Documento não encontrado.'};
    if (r.tipo === 'ORCAMENTO') {
      if (r.status === 'ACEITO') {
        return {modo: 'BLOQUEADO', motivo: 'O aceite já foi registrado e abriu as solicitações de cadastro de produto. ' +
          'Para mudar valor ou quantidade, gere um novo orçamento — editar este deixaria as tarefas de cadastro apontando para um item que mudou.'};
      }
      return {modo: 'INLINE', motivo: 'Orçamento não gera demanda, compra nem OP: pode ser corrigido aqui mesmo.'};
    }
    if (r.status === 'CANCELADO') return {modo: 'BLOQUEADO', motivo: 'Pedido cancelado não é editado.'};
    return {modo: 'GESTAO', destino: 'gestao_comercial.html?tab=pedidos&pedido=' + encodeURIComponent(r.chave || ''),
      motivo: 'Este pedido já virou backlog do PCP, OP, programação e conciliação de expedição. A edição acontece na Gestão Comercial, ' +
        'que grava versão e motivo, avisa a diretoria e não deixa a quantidade cair abaixo do que já foi produzido ou expedido.'};
  }

  // Campos que a edição de ORÇAMENTO aceita mudar (o resto é histórico).
  var CAMPOS_ORCAMENTO = ['cliente', 'cnpj', 'contato', 'email', 'validade', 'prazoPagamento', 'observacoes', 'evidencia'];

  /* Valida a edição de um orçamento antes de gravar. Mesma disciplina da
     tela: item sem descrição ou sem quantidade não passa, e o total é
     recalculado aqui (nunca vem da tela). */
  function validarOrcamento(atual, edicao) {
    var e = edicao || {}, erros = [];
    var itens = lista(e.itens).map(function(i) {
      return {descricao: texto(i.descricao), especificacao: texto(i.especificacao),
        qtd: n(i.qtd), valorUnitario: n(i.valorUnitario), desconto: n(i.desconto)};
    });
    if (!texto(e.cliente)) erros.push('Informe o cliente ou prospecto.');
    if (!texto(e.validade)) erros.push('Informe a validade da proposta.');
    if (!itens.length) erros.push('O orçamento precisa de pelo menos um item.');
    itens.forEach(function(i, idx) {
      if (!i.descricao) erros.push('Item ' + (idx + 1) + ': informe a descrição.');
      if (!(i.qtd > 0)) erros.push('Item ' + (idx + 1) + ': quantidade tem que ser maior que zero.');
      if (i.desconto > i.qtd * i.valorUnitario) erros.push('Item ' + (idx + 1) + ': o desconto passa do valor do item.');
    });
    var total = arred(itens.reduce(function(s, i) { return s + i.qtd * i.valorUnitario - i.desconto; }, 0));
    var a = atual || {};
    var mudancas = [];
    CAMPOS_ORCAMENTO.forEach(function(c) {
      var de = texto(a[c]), para = texto(e[c]);
      if (de !== para) mudancas.push({campo: c, de: de || null, para: para || null});
    });
    var antes = lista(a.itens);
    if (antes.length !== itens.length) mudancas.push({campo: 'itens', de: antes.length + ' item(ns)', para: itens.length + ' item(ns)'});
    else itens.forEach(function(i, idx) {
      var b = antes[idx] || {};
      if (texto(b.descricao) !== i.descricao || n(b.qtd) !== i.qtd || n(b.valorUnitario) !== i.valorUnitario || n(b.desconto) !== i.desconto) {
        mudancas.push({campo: 'item ' + (idx + 1), de: texto(b.descricao) + ' · ' + num(b.qtd) + ' × ' + moeda(b.valorUnitario),
          para: i.descricao + ' · ' + num(i.qtd) + ' × ' + moeda(i.valorUnitario)});
      }
    });
    return {ok: !erros.length, erros: erros, itens: itens, total: total, mudancas: mudancas};
  }

  // O que gravar: caminhos planos, como o RTDB exige.
  function atualizacoesOrcamento(chave, edicao, validado, quem, agora) {
    var u = {}, base = 'orcamentos/' + chave + '/';
    CAMPOS_ORCAMENTO.forEach(function(c) { u[base + c] = texto(edicao[c]) || null; });
    u[base + 'itens'] = validado.itens;
    u[base + 'totalValor'] = validado.total;
    u[base + 'atualizadoEm'] = agora;
    u[base + 'atualizadoPor'] = quem || null;
    u[base + 'historico/' + new Date(agora).getTime()] = {
      tipo: 'EDITADO', em: agora, por: quem || null,
      descricao: 'Orçamento editado: ' + validado.mudancas.map(function(m) { return m.campo; }).join(', ')
    };
    return u;
  }

  // ── Impressão: o mesmo resumo, em papel ────────────────────────────────
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }
  function linhaCampo(rot, val) {
    return val ? '<div class="campo"><span>' + esc(rot) + '</span><b>' + esc(val) + '</b></div>' : '';
  }
  function htmlImpressao(r, opcoes) {
    var o = opcoes || {};
    var itens = r.itens.map(function(i) {
      return '<tr><td>' + esc(i.sku || '—') + '</td><td>' + esc(i.descricao) +
        (i.especificacao ? '<br><small>' + esc(i.especificacao) + '</small>' : '') + '</td>' +
        '<td class="n">' + num(i.qtd) + '</td><td class="n">' + moeda(i.valorUnitario) + '</td>' +
        '<td class="n">' + (i.desconto ? '-' + moeda(i.desconto) : '—') + '</td>' +
        '<td class="n">' + moeda(i.total) + '</td>' +
        (r.produzidoTotal != null ? '<td class="n">' + (i.produzido == null ? '—' : num(i.produzido)) + '</td>' : '') + '</tr>';
    }).join('');
    return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>' + esc(r.rotuloTipo + ' ' + r.numero) + '</title>' +
      '<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111;padding:48px;max-width:880px;margin:auto}' +
      'header{border-bottom:3px solid #0a1c69;padding-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start}' +
      'h1{font-size:26px;margin:0;color:#0a1c69}h2{font-size:17px;margin:22px 0 6px}small{color:#667085}' +
      '.campos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 18px;margin-top:14px}' +
      '.campo{font-size:12px}.campo span{display:block;color:#667085;text-transform:uppercase;font-size:9.5px;letter-spacing:.4px}' +
      'table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12.5px}' +
      'th,td{padding:8px 6px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}' +
      'th{font-size:9.5px;text-transform:uppercase;color:#667085}.n{text-align:right;white-space:nowrap}' +
      '.total{text-align:right;font-size:20px;font-weight:700;margin-top:16px}' +
      '.obs{margin-top:16px;font-size:12px;white-space:pre-wrap}' +
      '.hist{margin-top:18px;font-size:11.5px;color:#444}.hist div{padding:2px 0;border-bottom:1px dotted #e5e7eb}' +
      '@media print{body{padding:14px}}</style>' +
      '<header><div><h1>Kuryos</h1><small>' + esc(r.rotuloTipo) + (r.versao > 1 ? ' · versão ' + r.versao : '') + '</small></div>' +
      '<div style="text-align:right"><b style="font-size:18px">' + esc(r.numero) + '</b><br><small>' + esc(r.rotuloStatus) + '</small></div></header>' +
      '<h2>' + esc(r.cliente) + '</h2>' +
      '<div class="campos">' +
        linhaCampo('CNPJ', r.cnpj) + linhaCampo('Contato', r.contato) + linhaCampo('Telefone', r.telefone) +
        linhaCampo('E-mail', r.email) + linhaCampo(r.tipo === 'ORCAMENTO' ? 'Validade' : 'Data do pedido', data(r.tipo === 'ORCAMENTO' ? r.validade : r.dataPedido)) +
        linhaCampo('Pedido do cliente', r.numeroPedidoCliente) + linhaCampo('Previsão de entrega', r.previsaoEntrega ? data(r.previsaoEntrega) : '') +
        linhaCampo('Pagamento', r.prazoPagamento) + linhaCampo('% com NF', r.percentualNF == null ? '' : r.percentualNF + '%') +
        linhaCampo('Frete', r.frete.tipo) + linhaCampo('Prazo do frete', r.frete.prazo) +
        linhaCampo('Entrega', r.frete.enderecoEntrega) + linhaCampo('Faturamento', r.enderecoFaturamento) +
      '</div>' +
      '<table><thead><tr><th>SKU</th><th>Produto</th><th class="n">Qtd.</th><th class="n">Preço un.</th><th class="n">Desconto</th><th class="n">Total</th>' +
        (r.produzidoTotal != null ? '<th class="n">Produzido</th>' : '') + '</tr></thead><tbody>' + itens + '</tbody></table>' +
      '<div class="total">' + moeda(r.total) + '</div>' +
      (r.observacoes ? '<div class="obs"><b>Observações:</b> ' + esc(r.observacoes) + '</div>' : '') +
      (r.evidencia ? '<div class="obs"><b>Evidência:</b> ' + esc(r.evidencia) + '</div>' : '') +
      (o.semHistorico || !r.historico.length ? '' : '<div class="hist"><b>Histórico</b>' + r.historico.map(function(h) {
        return '<div>' + esc(data(h.em)) + ' · ' + esc(h.tipo || '') + ' — ' + esc(h.descricao) + (h.por ? ' (' + esc(h.por) + ')' : '') + '</div>';
      }).join('') + '</div>') +
      '<p><small>Documento emitido em ' + esc(o.emitidoEm || '') + (o.emitidoPor ? ' por ' + esc(o.emitidoPor) : '') + '</small></p></html>';
  }

  return {
    resumo: resumo, acaoEdicao: acaoEdicao, validarOrcamento: validarOrcamento,
    atualizacoesOrcamento: atualizacoesOrcamento, htmlImpressao: htmlImpressao,
    CAMPOS_ORCAMENTO: CAMPOS_ORCAMENTO, STATUS: STATUS,
    fmt: {moeda: moeda, num: num, data: data, esc: esc}
  };
});
