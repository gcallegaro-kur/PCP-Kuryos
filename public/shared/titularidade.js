/* Alterar titularidade do estoque (24/10/2026).

   Pedido do usuário: "para mudar a titularidade do item, como posso fazer?" --
   só admin/diretoria. Hoje a titularidade (de quem é o material) nasce no
   Pedido de Compra e trava no recebimento; depois não havia caminho.

   O dono vive em DOIS lugares, e este módulo muda os dois juntos:
     - no lote:      estoque_lotes/{item}/{lote}/propriedade  (KURYOS | CLIENTE)
     - no agregado:  estoque/{item}/porCliente/{cliente}/saldoAtual
                     (o geral da Kuryos é o total menos a soma dos clientes;
                      saldoAtual, o total físico, NUNCA muda aqui)
   O DESTINO (para qual cliente/pedido o material foi comprado) é outra coisa
   e não é tocado: troca de dono não é troca de pedido.

   Duas situações:
     - COM LOTE: a quantidade sai de um lote. Inteira = o lote muda de dono no
       mesmo lugar. Parcial = o lote se divide em dois, no MESMO endereço, e o
       pedaço novo nasce com o novo dono (mesmo lote interno, validade,
       quarentena e destino).
     - SEM LOTE: parte do saldo que nunca foi endereçado (caso do ET-00069):
       só o agregado muda. Limitado ao que do dono atual não está em lotes.

   Função PURA: recebe `base` (a raiz do banco, ou o que ela precisa ter) e
   devolve os caminhos a gravar. Quem grava é a Cloud Function
   `alterarTitularidadeEstoque`, dentro de uma transaction, depois de checar
   quem pediu. `functions/titularidade.js` é cópia byte a byte (o teste falha
   se divergirem). */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    var PE;
    try { PE = require('./propriedade_estoque'); } catch (e) { PE = require('./propriedade-estoque'); }
    module.exports = factory(PE);
  } else root.Titularidade = factory(root.PropriedadeEstoque);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(PE) {
  'use strict';

  function texto(v) { return String(v == null ? '' : v).trim(); }
  function arred(v) { return Math.round(Number(v) * 1000) / 1000; }
  function falhar(msg, code) { throw Object.assign(new Error(msg), {code: code || 'failed-precondition'}); }
  function mesmo(a, b) { return a.tipo === b.tipo && (a.tipo === 'KURYOS' || a.clienteKey === b.clienteKey); }
  function chaveSegura(k) { return /^[A-Za-z0-9_-]{4,80}$/.test(String(k || '')); }
  function propriedadeDe(dono) {
    return dono.tipo === 'CLIENTE' ? {tipo: 'CLIENTE', clienteKey: dono.clienteKey, clienteNome: dono.clienteNome || dono.clienteKey} : {tipo: 'KURYOS'};
  }
  function nomeDoDono(dono, base) {
    if (dono.tipo !== 'CLIENTE') return 'Kuryos (estoque geral)';
    var c = ((base || {}).clientes || {})[dono.clienteKey] || {};
    return dono.clienteNome || c.nome || c.nomeFantasia || dono.clienteKey;
  }

  /* d: {itemKey, loteKey|null, qtd, novoDono: {tipo, clienteKey}, donoAtual (só sem lote),
         motivo, operacaoKey, novoLoteKey (parcial), movKey}
     ctx: {autor, uid, agora}
     -> {updates, ja, resumo, de, para, qtd, parcial, novoLoteKey} ou lança Error com .code */
  function preparar(base, d, ctx) {
    base = base || {}; d = d || {}; ctx = ctx || {};
    var itemKey = texto(d.itemKey);
    if (!itemKey || /[.#$\[\]\/]/.test(itemKey)) falhar('Item inválido.', 'invalid-argument');
    if (!chaveSegura(d.operacaoKey) || !chaveSegura(d.movKey)) falhar('Identificador da operação ausente. Recarregue a página e tente de novo.', 'invalid-argument');
    var est = (base.estoque || {})[itemKey];
    if (!est) falhar('Este item não tem saldo registrado em estoque.');
    var trocas = est.trocasTitularidade || {};
    if (trocas[d.operacaoKey]) return {updates: {}, ja: true, resumo: 'Esta troca já tinha sido feita.', qtd: trocas[d.operacaoKey].qtd};

    var q = Number(String(d.qtd == null ? '' : d.qtd).replace(',', '.'));
    if (!(q > 0)) falhar('Informe uma quantidade maior que zero.', 'invalid-argument');
    q = arred(q);
    var motivo = texto(d.motivo);
    if (motivo.length < 5) falhar('Informe o motivo da troca (pelo menos 5 caracteres).', 'invalid-argument');

    var nd = d.novoDono || {}, novo;
    if (nd.tipo === 'KURYOS') novo = {tipo: 'KURYOS', clienteKey: null, clienteNome: null};
    else if (nd.tipo === 'CLIENTE') {
      var c = (base.clientes || {})[nd.clienteKey];
      if (!nd.clienteKey || !c) falhar('Cliente não encontrado no cadastro.', 'invalid-argument');
      novo = {tipo: 'CLIENTE', clienteKey: nd.clienteKey, clienteNome: c.nome || c.nomeFantasia || nd.clienteKey};
    } else falhar('Escolha o novo dono do material.', 'invalid-argument');

    var lotes = (base.estoque_lotes || {})[itemKey] || {};
    var lote = d.loteKey ? lotes[d.loteKey] : null, atual, parcial = false, saldoLote = 0;
    if (d.loteKey) {
      if (!lote) falhar('O lote não existe mais. Atualize a tela.');
      if (lote.itemTipo && lote.itemTipo !== 'material') falhar('Titularidade vale para material; produto acabado não muda de dono por aqui.');
      saldoLote = Number(lote.saldoLote) || 0;
      if (q > saldoLote + 0.0005) falhar('A quantidade (' + q + ') passa do saldo do lote (' + saldoLote + ').');
      atual = PE.donoDoLote(lote);
      parcial = q < saldoLote - 0.0005;
      if (parcial && !chaveSegura(d.novoLoteKey)) falhar('Identificador do novo lote ausente. Recarregue a página.', 'invalid-argument');
      if (parcial && lotes[d.novoLoteKey]) falhar('Identificador do novo lote já existe. Tente de novo.');
    } else {
      var da = d.donoAtual || {};
      atual = da.tipo === 'CLIENTE' && da.clienteKey ? {tipo: 'CLIENTE', clienteKey: da.clienteKey, clienteNome: null} : {tipo: 'KURYOS', clienteKey: null, clienteNome: null};
    }
    if (mesmo(atual, novo)) falhar('O material já é de ' + nomeDoDono(novo, base) + '.');

    var partes = PE.saldoPorDono(est);
    var parteAtual = atual.tipo === 'CLIENTE' ? (partes.porCliente[atual.clienteKey] || 0) : partes.geral;
    if (parteAtual + 0.0005 < q) {
      falhar('O estoque do item registra só ' + parteAtual + ' de ' + nomeDoDono(atual, base) + ', menos que ' + q + '. Corrija o saldo (Ajustar Saldo) antes de trocar a titularidade.');
    }
    if (!d.loteKey) {
      var emLotes = 0;
      Object.keys(lotes).forEach(function(k) {
        var l = lotes[k] || {}, s = Number(l.saldoLote) || 0;
        if (s > 0 && mesmo(PE.donoDoLote(l), atual)) emLotes += s;
      });
      var livre = arred(parteAtual - emLotes);
      if (q > livre + 0.0005) falhar('Só ' + livre + ' de ' + nomeDoDono(atual, base) + ' estão sem lote. O resto está em lotes endereçados: troque pelo lote.');
    }

    var upd = {}, agora = ctx.agora;
    var raiz = 'estoque/' + itemKey;
    if (atual.tipo === 'CLIENTE') upd[raiz + '/porCliente/' + atual.clienteKey + '/saldoAtual'] = arred(parteAtual - q);
    if (novo.tipo === 'CLIENTE') {
      upd[raiz + '/porCliente/' + novo.clienteKey + '/saldoAtual'] = arred((partes.porCliente[novo.clienteKey] || 0) + q);
      upd[raiz + '/porCliente/' + novo.clienteKey + '/clienteNome'] = novo.clienteNome;
    }
    upd[raiz + '/ultimaAtualizacao'] = agora;

    var novaProp = propriedadeDe(novo), antigaProp = propriedadeDe(Object.assign({}, atual, {clienteNome: nomeDoDono(atual, base)}));
    var novoLoteKey = null;
    if (d.loteKey) {
      var rl = 'estoque_lotes/' + itemKey + '/' + d.loteKey;
      if (!parcial) {
        upd[rl + '/propriedade'] = novaProp; upd[rl + '/atualizadoEm'] = agora;
      } else {
        novoLoteKey = d.novoLoteKey;
        upd[rl + '/saldoLote'] = arred(saldoLote - q); upd[rl + '/atualizadoEm'] = agora;
        var copia = Object.assign({}, lote, {saldoLote: q, qtdOriginal: q, propriedade: novaProp, origemTipo: 'titularidade', origemRef: d.loteKey,
          criadoEm: agora, atualizadoEm: agora, criadoPor: ctx.autor || null});
        delete copia.recebimento; delete copia.aguardandoEnderecoDefinitivo;
        upd['estoque_lotes/' + itemKey + '/' + novoLoteKey] = copia;
      }
    }

    var de = nomeDoDono(atual, base), para = nomeDoDono(novo, base);
    var ref = de + ' -> ' + para + ' · ' + motivo;
    upd['movimentos_estoque/' + itemKey + '/' + d.movKey] = {
      tipo: 'troca_titularidade', motivo: 'TROCA DE TITULARIDADE', qtd: q, saldoApos: null, ref: ref,
      loteKey: d.loteKey || null, enderecoKey: lote ? (lote.enderecoKey || null) : null, propriedade: novaProp, dePropriedade: antigaProp,
      itemTipo: 'material', itemCodigo: est.materialCodigo || itemKey, itemNome: est.materialNome || null, unidade: est.unidade || null,
      autor: ctx.autor || null, em: agora
    };
    upd[raiz + '/trocasTitularidade/' + d.operacaoKey] = {
      de: antigaProp, para: novaProp, qtd: q, loteKey: d.loteKey || null, novoLoteKey: novoLoteKey, semLote: !d.loteKey,
      motivo: motivo, por: ctx.autor || null, uid: ctx.uid || null, em: agora
    };
    var un = est.unidade || '';
    var resumo = q + ' ' + un + ' de ' + (est.materialCodigo || itemKey) + (d.loteKey ? ' (lote ' + (lote.loteInterno || d.loteKey) + (parcial ? ', dividindo o lote' : '') + ')' : ' (saldo sem lote)') +
      ': ' + de + ' → ' + para + '.';
    return {updates: upd, ja: false, resumo: resumo, de: de, para: para, qtd: q, parcial: parcial, novoLoteKey: novoLoteKey};
  }

  return {preparar: preparar, nomeDoDono: nomeDoDono};
});
