/* Progresso de uma OP no Controle de OPs.

   Pedido do usuário (2026-09-29): a barra principal deve mostrar só o PRODUTO
   ACABADO (pronto para expedir ou já expedido) -- antes ela mostrava o que a
   rotulagem apontou, que não é PA: a Logística ainda não conferiu o palete.
   Ao passar o mouse, o progresso de CADA etapa ("manipulação 500/500 kg;
   rotulagem 1.500/1.500 un; envase 1.450/1.500 un ...").

   PA = estoque (paletes conferidos com saldo) + expedido, exatamente a conta
   da Conciliação de pedidos (shared/conciliacao-pedidos.js, `porOp`). Não se
   recalcula por outro caminho: o número da barra é o mesmo do Pedidos.

   Função pura, sem DOM e sem banco: testada em run_progresso_op_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./manipulacao.js'));
  else root.ProgressoOp = factory(root.Manipulacao);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Manipulacao) {
  'use strict';

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(n(v) * 1000) / 1000; }
  function pct(valor, meta) { return meta > 0 ? Math.round(valor / meta * 100) : 0; }

  // Mesma leitura de getProduzido (utils.js): OP antiga só tinha `produzido`,
  // que era sempre a Linha.
  function produzidoLinha(op) { return op.produzidoLinha != null ? n(op.produzidoLinha) : n(op.produzido); }

  /* O bulk em kg. `rendimento` só existe com a manipulação fechada; antes
     disso o que há é o pesado. Sem fase de manipulação (kit, bulk do cliente)
     não há etapa a mostrar -- devolve null. */
  function etapaManipulacao(op) {
    var f = Manipulacao && Manipulacao.fase(op);
    if (!f) return null;
    var r = Manipulacao.resumoManipulacao(f.previstos || {}, f);
    var meta = arred(r.previstoTotal);
    var fechada = r.rendimento != null;
    var valor = fechada ? r.rendimento : r.pesadoTotal;
    return {chave: 'manipulacao', rotulo: 'Manipulação', unidade: 'kg', valor: arred(valor), meta: meta,
      pct: pct(valor, meta), detalhe: fechada ? null : 'pesado, ainda em manipulação'};
  }

  function etapaUn(chave, rotulo, valor, meta, detalhe) {
    valor = n(valor);   // campo ausente (ex.: OP sem rotulagem) é 0, não NaN
    return {chave: chave, rotulo: rotulo, unidade: 'un', valor: arred(valor), meta: meta, pct: pct(valor, meta), detalhe: detalhe || null};
  }

  /* Estoque de PA por OP, separado pela decisão da Qualidade (o mesmo critério
     da Expedição: só LIBERADO_EXPEDICAO/APROVADO_CONCESSAO pode sair).
     Palete legado (importado da planilha) nunca passou pelo laudo: conta como
     liberado, como a Expedição já faz. */
  var LIBERADOS = {LIBERADO_EXPEDICAO: 1, APROVADO_CONCESSAO: 1};
  var REPROVADOS = {REPROVADO: 1, AGUARDANDO_DESCARTE: 1};
  function paletesPorOp(estoqueLotes) {
    var out = {};
    Object.keys(estoqueLotes || {}).forEach(function(item) {
      Object.keys(estoqueLotes[item] || {}).forEach(function(k) {
        var l = estoqueLotes[item][k] || {};
        var saldo = n(l.saldoLote);
        if (l.itemTipo !== 'produto' || !(saldo > 0) || !l.opKey) return;
        var o = out[l.opKey] = out[l.opKey] || {liberado: 0, pendente: 0, reprovado: 0};
        var legado = l.origemTipo === 'legado_planilha' && l.legado === true;
        var campo = (legado || LIBERADOS[l.status]) ? 'liberado' : REPROVADOS[l.status] ? 'reprovado' : 'pendente';
        o[campo] = arred(o[campo] + saldo);
      });
    });
    return out;
  }

  /* `bucket` é o `porOp` da conciliação para esta OP (ou null: sem palete nem
     saída ainda). `carregando` = a conciliação ainda não chegou -- nesse caso o
     PA fica indefinido em vez de virar um zero que pareceria "nada produzido". */
  function calcular(op, bucket, carregando, qualidade) {
    op = op || {};
    var meta = n(op.qtdPlanejada);
    var estoque = bucket ? n(bucket.estoque.total) : 0;
    var expedido = bucket ? n(bucket.expedido.total) : 0;
    var pa = arred(estoque + expedido);
    // Divisão do estoque pela Qualidade. O que a conciliação conta e os paletes
    // não explicam (ex.: estoque de planilha sem OP no palete) entra como
    // liberado -- não há laudo a esperar. Reprovado/pendente nunca passam de estoque.
    var q = qualidade || {liberado: 0, pendente: 0, reprovado: 0};
    var pendente = Math.min(estoque, arred(q.pendente));
    var reprovado = Math.min(estoque - pendente, arred(q.reprovado));
    var liberadoEstoque = arred(estoque - pendente - reprovado);
    var liberado = arred(liberadoEstoque + expedido);

    var etapas = [];
    var man = etapaManipulacao(op);
    if (man) etapas.push(man);
    etapas.push(etapaUn('envase', 'Envase', produzidoLinha(op), meta));
    etapas.push(etapaUn('rotulagem', 'Rotulagem', op.produzidoRotulagem, meta));
    if (n(op.produzidoPosto) > 0) etapas.push(etapaUn('posto', 'Posto de trabalho', op.produzidoPosto, meta));
    if (!carregando) {
      etapas.push(etapaUn('pa', 'Produto acabado (conferido)', pa, meta));
      etapas.push(etapaUn('liberado', '  ↳ Liberado (Qualidade)', liberado, meta, 'em estoque ' + fmt(liberadoEstoque) + ' + expedido ' + fmt(expedido)));
      if (pendente > 0) etapas.push(etapaUn('pendente', '  ↳ Aguardando a Qualidade', pendente, meta));
      if (reprovado > 0) etapas.push(etapaUn('reprovado', '  ↳ Reprovado', reprovado, meta));
      etapas.push(etapaUn('expedido', 'Expedido', expedido, meta));
    }
    return {
      carregando: !!carregando, planejado: meta,
      pa: carregando ? null : pa, estoque: estoque, expedido: expedido,
      liberado: carregando ? null : liberado, pendente: carregando ? null : pendente, reprovado: carregando ? null : reprovado,
      pct: carregando ? null : pct(pa, meta), etapas: etapas
    };
  }

  function fmt(v) { return Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 3}); }

  /* Texto do title (hover): uma linha por etapa. */
  function tooltip(prog) {
    var linhas = prog.etapas.map(function(e) {
      var base = e.rotulo + ': ' + fmt(e.valor) + (e.meta > 0 ? ' / ' + fmt(e.meta) : '') + ' ' + e.unidade +
        (e.meta > 0 ? ' (' + e.pct + '%)' : '');
      return e.detalhe ? base + ' — ' + e.detalhe : base;
    });
    if (prog.carregando) linhas.push('Produto acabado: carregando…');
    return linhas.join('\n');
  }

  return {calcular: calcular, paletesPorOp: paletesPorOp, tooltip: tooltip, fmt: fmt};
});
