/* Conciliação de pedidos: Produzido = Expedido + Em estoque.

   Regras decididas pelo usuário em 2026-09-14:
   - Toda unidade produzida está em um de DOIS lugares: EM ESTOQUE ou
     EXPEDIDA. "Expedido" tem motivo: expedido de fato, furto ou descarte --
     os três tiraram a mercadoria do galpão.
   - Retrabalho e devolução NÃO são saída: a unidade volta a ficar em estoque
     (e depois pode ser expedida). Na planilha legado elas ainda não viraram
     palete no WMS, então entram como estoque de origem "planilha".
   - Só a conta EXATA é OK. Exceção: quando a Logística já apontou a
     divergência na Conferência de PA (conciliação com motivo), a diferença
     apontada entra na conta -- eles já disseram o que aconteceu.
   - Pedido produzido sem nenhum registro de saída nem de estoque fica
     "sem registro" (neutro), não divergente: provavelmente é anterior à
     planilha ou ficou fora dela.

   Fontes (todas legíveis por qualquer usuário logado):
     pedidos/{k}.produzido                     produzido (apontamento)
     expedicoes_comerciais/{c}/itens           legado da planilha e fluxo novo
     estoque_lotes/{item}/{lote}.saldoLote     paletes de PA no WMS
     solicitacoes_descarte/{s}                 descarte concluído
     conferencias_pa/{op}.conciliacao          divergência apontada
     ops/{op}.skuPedidoKey                     ponte lote/conferência -> pedido

   A chave do pedido é RESOLVIDA (com/sem zero à esquerda) pela mesma regra da
   Expedição -- a base tem os dois formatos de verdade. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./expedicao.js'));
  else root.ConciliacaoPedidos = factory(root.ExpedicaoPA);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(ExpedicaoPA) {
  'use strict';

  /* DEVOLVIDO entra NEGATIVO (GAP-02, 23/09): a devolução recebida estorna o
     expedido, e a unidade volta para o estoque como palete de devolução. Sem
     o estorno ela contaria duas vezes -- na carga e no palete. Retrabalho NÃO
     entra na conta (é o mesmo lote voltando para a linha): só é informado. */
  /* Corte do sistema completo (WMS + Conferência de PA em produção, 10/09/2026).
     O que foi produzido antes veio da planilha: não tem palete, conferência
     nem saída por lote, e quase tudo já foi expedido. É consulta, não ação
     (decisão do usuário, 15/10/2026). */
  var CORTE = '2026-09-10';
  var MOTIVOS_EXPEDIDO = {EXPEDIDO: 'Expedido', FURTO: 'Furto', DESCARTE: 'Descarte', DEVOLVIDO: 'Devolvido (estorno)'};
  var ORIGENS_ESTOQUE = {WMS: 'Paletes no WMS', RETRABALHO: 'Retrabalho (planilha)', DEVOLUCAO: 'Devolução (planilha)'};
  // tipoLegado da planilha -> [lado da conta, motivo/origem]. O que não está
  // aqui (SEM_STATUS) não é classificável e fica de fora da conta.
  var LEGADO = {
    EXPEDIDO: ['expedido', 'EXPEDIDO'], FURTO: ['expedido', 'FURTO'],
    RETRABALHO: ['estoque', 'RETRABALHO'], DEVOLUCAO: ['estoque', 'DEVOLUCAO']
  };

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(n(v) * 1000) / 1000; }

  function novo(produzido) {
    return {
      produzido: arred(produzido),
      expedido: {total: 0, motivos: {}},
      estoque: {total: 0, origens: {}},
      divergenciaApontada: {total: 0, ocorrencias: []},
      esperado: 0, contabilizado: 0, diferenca: 0, situacao: 'SEM_PRODUCAO',
      // Informação ao lado da conta (pedido do usuário em 23/09): quanto voltou
      // do cliente e quanto foi para retrabalho. Não somam no contabilizado.
      devolvido: {total: 0, ocorrencias: []},
      retrabalho: {total: 0, ocorrencias: []},
      // A MESMA conta, quebrada por OP (pedido do usuário em 22/09: "ver o
      // que está expedido OP por OP, inclusive na conferência, mostrando o
      // que tem em estoque OP por OP"). Toda saída e todo palete de PA
      // sabem de qual OP vieram; o que não souber cai em SEM_OP.
      porOp: {},
      // PA concluído depois do corte que a Logística ainda não conferiu, e
      // pedido histórico (ver CORTE). Preenchidos em calcular().
      aguardandoPA: 0, legado: false
    };
  }
  var SEM_OP = 'SEM_OP';
  function baldeOp(r, opKey, opLote) {
    var k = opKey || SEM_OP;
    if (!r.porOp[k]) {
      r.porOp[k] = {
        opKey: opKey || null, opLote: opLote || opKey || null, produzido: 0,
        expedido: {total: 0, motivos: {}}, estoque: {total: 0, origens: {}},
        divergenciaApontada: {total: 0, ocorrencias: []},
        esperado: 0, contabilizado: 0, diferenca: 0, situacao: 'SEM_PRODUCAO'
      };
    }
    if (opLote && !r.porOp[k].opLote) r.porOp[k].opLote = opLote;
    return r.porOp[k];
  }
  function somar(lado, chave, qtd) {
    var q = arred(qtd);
    if (!q) return;
    var mapa = lado.motivos || lado.origens;
    mapa[chave] = arred((mapa[chave] || 0) + q);
    lado.total = arred(lado.total + q);
  }

  function calcular(base) {
    base = base || {};
    var pedidos = base.pedidos || {}, ops = base.ops || {}, lotes = base.estoque_lotes || {};
    var resolver = function(k) { return ExpedicaoPA.resolverChavePedido(pedidos, k); };
    var porPedido = {}, semVinculo = {expedido: 0, estoque: 0, naoClassificado: 0};

    Object.keys(pedidos).forEach(function(k) { porPedido[k] = novo((pedidos[k] || {}).produzido); });

    function chaveDe(registro) {
      var r = registro || {};
      var op = r.opKey ? ops[r.opKey] : null;
      var k = resolver(r.pedidoKey || r.skuPedidoKey || (op && op.skuPedidoKey) || '');
      return porPedido[k] ? k : null;
    }
    // Rótulo do lote: o que o registro trouxe, senão o da OP, senão a chave.
    function loteDe(registro) {
      var r = registro || {};
      var op = r.opKey ? ops[r.opKey] : null;
      return r.opLote || r.loteOrigem || (op && op.lote) || r.opKey || null;
    }

    // Produzido por OP: vem da própria OP. A soma das OPs pode não bater com
    // pedidos/{k}.produzido (retrabalho, OP de outro pedido apontada aqui) --
    // por isso o total do pedido continua sendo o do pedido, e a diferença
    // aparece na linha "sem OP".
    Object.keys(ops).forEach(function(opKey) {
      var op = ops[opKey] || {};
      var k = resolver(op.skuPedidoKey || '');
      if (!porPedido[k] || !(n(op.produzido) > 0)) return;
      baldeOp(porPedido[k], opKey, op.lote).produzido = arred(n(op.produzido));
    });

    // ── Cargas: legado da planilha e fluxo novo ────────────────────────
    Object.keys(base.expedicoes_comerciais || {}).forEach(function(ck) {
      var c = base.expedicoes_comerciais[ck] || {};
      if (!c.legado && /cancel/i.test(c.status || '')) return;
      Object.keys(c.itens || {}).forEach(function(ik) {
        var i = c.itens[ik] || {}, qtd = n(i.qtd);
        if (!(qtd > 0)) return;
        var destino = c.legado ? LEGADO[c.tipoLegado] : ['expedido', 'EXPEDIDO'];
        if (!destino) { semVinculo.naoClassificado = arred(semVinculo.naoClassificado + qtd); return; }
        var k = chaveDe(i);
        if (!k) { semVinculo[destino[0]] = arred(semVinculo[destino[0]] + qtd); return; }
        somar(porPedido[k][destino[0]], destino[1], qtd);
        somar(baldeOp(porPedido[k], i.opKey, loteDe(i))[destino[0]], destino[1], qtd);
      });
    });

    // ── Devoluções recebidas: estorno do expedido ─────────────────────
    Object.keys(base.devolucoes_cliente || {}).forEach(function(dk) {
      var d = base.devolucoes_cliente[dk] || {};
      if (d.status !== 'RECEBIDA') return;
      (Array.isArray(d.itens) ? d.itens : Object.values(d.itens || {})).forEach(function(i) {
        var qtd = n(i && i.qtdRecebida);
        if (!(qtd > 0)) return;
        var k = chaveDe(i);
        if (!k) { semVinculo.expedido = arred(semVinculo.expedido - qtd); return; }
        somar(porPedido[k].expedido, 'DEVOLVIDO', -qtd);
        somar(baldeOp(porPedido[k], i.opKey, loteDe(i)).expedido, 'DEVOLVIDO', -qtd);
        porPedido[k].devolvido.total = arred(porPedido[k].devolvido.total + qtd);
        porPedido[k].devolvido.ocorrencias.push({devKey: dk, numero: d.numero || dk, qtd: qtd, opLote: loteDe(i)});
      });
    });

    // ── Retrabalho: só informação ─────────────────────────────────────
    Object.keys(ops).forEach(function(rk) {
      var rt = ops[rk] || {};
      if (rt.tipoOrdem !== 'RETRABALHO' || rt.status === 'Cancelado') return;
      var origem = ops[rt.retrabalhoDeOpKey] || {};
      var k = chaveDe({opKey: rt.retrabalhoDeOpKey, skuPedidoKey: origem.skuPedidoKey});
      if (!k) return;
      var qtd = n(rt.qtdPlanejada);
      porPedido[k].retrabalho.total = arred(porPedido[k].retrabalho.total + qtd);
      porPedido[k].retrabalho.ocorrencias.push({opKey: rk, lote: rt.lote || rk, qtd: qtd, status: rt.status || ''});
    });

    // ── Paletes de PA com saldo no WMS ─────────────────────────────────
    Object.keys(lotes).forEach(function(itemKey) {
      Object.keys(lotes[itemKey] || {}).forEach(function(loteKey) {
        var l = lotes[itemKey][loteKey] || {};
        if (l.itemTipo !== 'produto' || !(n(l.saldoLote) > 0)) return;
        var k = chaveDe(l);
        if (!k) { semVinculo.estoque = arred(semVinculo.estoque + n(l.saldoLote)); return; }
        somar(porPedido[k].estoque, 'WMS', l.saldoLote);
        somar(baldeOp(porPedido[k], l.opKey, loteDe(l)).estoque, 'WMS', l.saldoLote);
      });
    });

    // ── Descarte concluído de produto acabado ─────────────────────────
    Object.keys(base.solicitacoes_descarte || {}).forEach(function(sk) {
      var s = base.solicitacoes_descarte[sk] || {};
      if (s.status !== 'CONCLUIDO' || !(n(s.quantidadeDestinada) > 0)) return;
      var l = (lotes[s.itemKey] || {})[s.loteKey] || {};
      if ((s.itemTipo || l.itemTipo) !== 'produto') return;
      var k = chaveDe(l);
      if (!k) { semVinculo.expedido = arred(semVinculo.expedido + n(s.quantidadeDestinada)); return; }
      somar(porPedido[k].expedido, 'DESCARTE', s.quantidadeDestinada);
      somar(baldeOp(porPedido[k], l.opKey, loteDe(l)).expedido, 'DESCARTE', s.quantidadeDestinada);
    });

    // ── Divergência apontada pela Logística ───────────────────────────
    Object.keys(base.conferencias_pa || {}).forEach(function(opKey) {
      var conf = base.conferencias_pa[opKey] || {};
      if (!conf.finalizadoEm || !conf.conciliacao) return;
      var dif = arred(conf.conciliacao.diferenca != null ? conf.conciliacao.diferenca : conf.divergencia);
      if (!dif) return;
      var k = chaveDe({opKey: opKey});
      if (!k) return;
      var ocorrencia = {opKey: opKey, opLote: conf.opLote || opKey, diferenca: dif,
        motivo: conf.conciliacao.motivo || null, observacao: conf.conciliacao.observacao || null,
        rnc: conf.rncNumero || null};
      var d = porPedido[k].divergenciaApontada;
      d.total = arred(d.total + dif);
      d.ocorrencias.push(ocorrencia);
      var bo = baldeOp(porPedido[k], opKey, conf.opLote);
      bo.divergenciaApontada.total = arred(bo.divergenciaApontada.total + dif);
      bo.divergenciaApontada.ocorrencias.push(ocorrencia);
    });

    Object.keys(porPedido).forEach(function(k) {
      fechar(porPedido[k]);
      Object.keys(porPedido[k].porOp).forEach(function(o) { fechar(porPedido[k].porOp[o]); });
    });

    // ── Aguardando conferência de PA e legado ─────────────────────────
    var confs = base.conferencias_pa || {}, info = {};
    Object.keys(ops).forEach(function(opKey) {
      var op = ops[opKey] || {};
      var k = resolver(op.skuPedidoKey || '');
      if (!porPedido[k] || op.status === 'Cancelado') return;
      var i = info[k] = info[k] || {emissaoMax: '', aberta: false, pendente: 0};
      var emissao = String(op.dataEmissao || '').slice(0, 10);
      if (emissao > i.emissaoMax) i.emissaoMax = emissao;
      if (op.status !== 'Concluído') i.aberta = true;
      // Concluída depois do corte, sem conferência finalizada: o que ainda não
      // virou saída nem estoque é fila da Logística, não divergência.
      var concluida = op.status === 'Concluído' || op.status === 'Aguardando Confirmação';
      var conferida = !!(confs[opKey] && confs[opKey].finalizadoEm);
      if (concluida && !conferida && emissao >= CORTE && n(op.produzido) > 0) {
        var b = porPedido[k].porOp[opKey];
        var coberto = b ? b.contabilizado - b.divergenciaApontada.total : 0;
        i.pendente = arred(i.pendente + Math.max(n(op.produzido) - coberto, 0));
      }
    });
    Object.keys(porPedido).forEach(function(k) {
      var r = porPedido[k], i = info[k] || {emissaoMax: '', aberta: false, pendente: 0};
      var ultAp = String((pedidos[k] || {}).ultimoApontamento || '').slice(0, 10);
      r.aguardandoPA = i.pendente;
      r.legado = n(r.produzido) > 0 && !i.aberta && i.emissaoMax < CORTE && ultAp < CORTE;
      classificar(r);
    });
    return {porPedido: porPedido, semVinculo: semVinculo};
  }

  // Esperado = produzido corrigido pelo que a Logística apontou.
  function fechar(r) {
    r.esperado = arred(r.produzido + r.divergenciaApontada.total);
    r.contabilizado = arred(r.expedido.total + r.estoque.total);
    r.diferenca = arred(r.contabilizado - r.esperado);
    if (!r.produzido && !r.contabilizado) r.situacao = 'SEM_PRODUCAO';
    else if (r.produzido > 0 && !r.contabilizado) r.situacao = 'SEM_REGISTRO';
    else if (r.diferenca !== 0) r.situacao = 'DIVERGENTE';
    else r.situacao = r.divergenciaApontada.ocorrencias.length ? 'OK_APONTADA' : 'OK';
    return r;
  }

  /* Reclassifica o que NÃO é acionável hoje:
       AGUARDA_CONFERENCIA  a falta é toda de PA concluído que a Logística ainda
                            não conferiu -- some sozinha quando conferirem;
       LEGADO               pedido histórico (anterior ao corte, sem OP aberta
                            nem apontamento novo) -- só consulta.
     Divergência que sobra além disso continua DIVERGENTE. */
  function classificar(r) {
    if ((r.situacao === 'DIVERGENTE' || r.situacao === 'SEM_REGISTRO') && r.diferenca < 0 && r.aguardandoPA > 0 &&
        (-r.diferenca) - r.aguardandoPA <= 0.5) {
      r.situacao = 'AGUARDA_CONFERENCIA';
    } else if ((r.situacao === 'DIVERGENTE' || r.situacao === 'SEM_REGISTRO') && r.legado) {
      r.situacao = 'LEGADO';
    }
    return r;
  }

  // Soma vários pedidos (itens de um pedido comercial). A situação é a PIOR
  // dos itens: somar diferenças de sinais opostos esconderia divergência.
  var GRAVIDADE = {SEM_PRODUCAO: 0, OK: 1, LEGADO: 1.5, OK_APONTADA: 2, AGUARDA_CONFERENCIA: 2.5, SEM_REGISTRO: 3, DIVERGENTE: 4};
  function agregar(resultados) {
    var total = novo(0), pior = 'SEM_PRODUCAO', itens = 0;
    (resultados || []).forEach(function(r) {
      if (!r) return;
      itens++;
      total.produzido = arred(total.produzido + r.produzido);
      Object.keys(r.expedido.motivos).forEach(function(m) { somar(total.expedido, m, r.expedido.motivos[m]); });
      Object.keys(r.estoque.origens).forEach(function(o) { somar(total.estoque, o, r.estoque.origens[o]); });
      total.aguardandoPA = arred(total.aguardandoPA + n(r.aguardandoPA));
      total.divergenciaApontada.total = arred(total.divergenciaApontada.total + r.divergenciaApontada.total);
      total.divergenciaApontada.ocorrencias = total.divergenciaApontada.ocorrencias.concat(r.divergenciaApontada.ocorrencias);
      ['devolvido', 'retrabalho'].forEach(function(c) {
        if (!r[c]) return;
        total[c].total = arred(total[c].total + r[c].total);
        total[c].ocorrencias = total[c].ocorrencias.concat(r[c].ocorrencias);
      });
      // Cada OP é de um SKU só, mas somar é o certo caso a mesma OP apareça
      // em dois itens do pedido.
      Object.keys(r.porOp || {}).forEach(function(o) {
        var de = r.porOp[o], para = baldeOp(total, de.opKey, de.opLote);
        para.produzido = arred(para.produzido + de.produzido);
        Object.keys(de.expedido.motivos).forEach(function(m) { somar(para.expedido, m, de.expedido.motivos[m]); });
        Object.keys(de.estoque.origens).forEach(function(g) { somar(para.estoque, g, de.estoque.origens[g]); });
        para.divergenciaApontada.total = arred(para.divergenciaApontada.total + de.divergenciaApontada.total);
        para.divergenciaApontada.ocorrencias = para.divergenciaApontada.ocorrencias.concat(de.divergenciaApontada.ocorrencias);
        fechar(para);
      });
      if (GRAVIDADE[r.situacao] > GRAVIDADE[pior]) pior = r.situacao;
    });
    fechar(total);
    total.situacao = itens ? pior : 'SEM_PRODUCAO';
    return total;
  }

  /* As linhas da quebra por OP, na ordem do lote (mais novo em cima), com a
     linha "sem OP" sempre por último. `restante` é o que o pedido tem e as
     OPs não explicam -- produzido do pedido menos a soma das OPs. */
  function linhasPorOp(r) {
    if (!r) return {linhas: [], restanteProduzido: 0};
    var chaves = Object.keys(r.porOp || {});
    var linhas = chaves.map(function(k) { return r.porOp[k]; }).sort(function(a, b) {
      if (!a.opKey) return 1;
      if (!b.opKey) return -1;
      return String(b.opLote || '').localeCompare(String(a.opLote || ''));
    });
    var somaProduzido = linhas.reduce(function(t, l) { return t + n(l.produzido); }, 0);
    return {linhas: linhas, restanteProduzido: arred(n(r.produzido) - somaProduzido)};
  }

  function fmt(v) { return arred(v).toLocaleString('pt-BR'); }
  function sinal(v) { return (v > 0 ? '+' : '') + fmt(v); }

  // Texto do selo e do detalhe (hover). Sem HTML: quem desenha escapa.
  function descrever(r) {
    var rotulo = {
      OK: 'OK', OK_APONTADA: 'OK · divergência apontada', SEM_REGISTRO: 'Sem registro de saída',
      SEM_PRODUCAO: '—', DIVERGENTE: 'Diferença ' + sinal(r.diferenca),
      AGUARDA_CONFERENCIA: 'Aguardando conferência de PA (' + fmt(r.aguardandoPA) + ' un.)',
      LEGADO: 'Legado · saída não registrada'
    }[r.situacao];
    var linhas = ['Produzido: ' + fmt(r.produzido)];
    r.divergenciaApontada.ocorrencias.forEach(function(o) {
      linhas.push('  Apontado na Conferência (OP ' + o.opLote + '): ' + sinal(o.diferenca) +
        (o.motivo ? ' · ' + o.motivo : '') + (o.rnc ? ' · ' + o.rnc : ''));
    });
    if (r.divergenciaApontada.ocorrencias.length) linhas.push('Esperado: ' + fmt(r.esperado));
    linhas.push('Expedido: ' + fmt(r.expedido.total));
    Object.keys(MOTIVOS_EXPEDIDO).forEach(function(m) {
      if (r.expedido.motivos[m]) linhas.push('  ' + MOTIVOS_EXPEDIDO[m] + ': ' + fmt(r.expedido.motivos[m]));
    });
    linhas.push('Em estoque: ' + fmt(r.estoque.total));
    Object.keys(ORIGENS_ESTOQUE).forEach(function(o) {
      if (r.estoque.origens[o]) linhas.push('  ' + ORIGENS_ESTOQUE[o] + ': ' + fmt(r.estoque.origens[o]));
    });
    linhas.push('Expedido + Em estoque: ' + fmt(r.contabilizado));
    if (r.devolvido && r.devolvido.total) linhas.push('Devolvido pelo cliente (já estornado do expedido): ' + fmt(r.devolvido.total));
    if (r.retrabalho && r.retrabalho.total) linhas.push('Em retrabalho (informativo, não soma): ' + fmt(r.retrabalho.total) +
      ' · ' + r.retrabalho.ocorrencias.map(function(o) { return o.lote; }).join(', '));
    // Por que não fecha: as causas que a base de 14/10/2026 mostrou. Só
    // aparecem quando a conta não está OK, e só as que valem para este caso.
    if (r.situacao === 'DIVERGENTE' || r.situacao === 'SEM_REGISTRO') {
      var nOpsComProducao = Object.keys(r.porOp || {}).filter(function(o) { return r.porOp[o].opKey; }).length;
      var somaOps = Object.keys(r.porOp || {}).reduce(function(t, o) { return t + n(r.porOp[o].produzido); }, 0);
      var gap = arred(r.produzido - somaOps);
      if (nOpsComProducao && Math.abs(gap) >= 1) linhas.push('Causa possível: o produzido do pedido (' + fmt(r.produzido) +
        ') difere da soma das OPs vinculadas (' + fmt(somaOps) + ') em ' + sinal(gap) +
        ' — pedido ajustado à mão/conciliado com o cliente, ou produção creditada em outro pedido.');
      if (!nOpsComProducao && r.produzido > 0) linhas.push('Causa possível: nenhuma OP aponta para este pedido (produção legada ou creditada sem OP).');
      if (r.diferenca < 0 && !r.estoque.total) linhas.push('Causa possível: sem paletes de produto acabado no WMS (estoque ainda não inventariado) e saída sem registro neste pedido.');
    }
    if (r.situacao === 'AGUARDA_CONFERENCIA') linhas.push('A Logística ainda não conferiu o PA destas OPs (' + fmt(r.aguardandoPA) + ' un.). A diferença some quando os paletes forem declarados.');
    if (r.situacao === 'LEGADO') linhas.push('Pedido anterior a 10/09/2026 (planilha): sem palete nem saída por lote. Serve para consulta; não pede ação.');
    if (r.situacao === 'DIVERGENTE') linhas.push(r.diferenca > 0
      ? 'Saídas + estoque passam do produzido em ' + fmt(r.diferenca)
      : 'Faltam ' + fmt(-r.diferenca) + ' un. sem destino registrado');
    return {rotulo: rotulo, detalhe: linhas.join('\n')};
  }

  return {calcular: calcular, classificar: classificar, CORTE: CORTE, agregar: agregar, descrever: descrever, fechar: fechar,
    linhasPorOp: linhasPorOp, SEM_OP: SEM_OP,
    MOTIVOS_EXPEDIDO: MOTIVOS_EXPEDIDO, ORIGENS_ESTOQUE: ORIGENS_ESTOQUE};
});
