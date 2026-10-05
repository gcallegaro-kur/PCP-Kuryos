/* Conciliação da rotulagem (05/10/2026) -- SEM TRAVA, só informa.

   A rotulagem vem ANTES do envase: transforma frasco vazio em FRASCO ROTULADO
   (produto intermediário) e o envase só roda com esse estoque. Dito pelo
   usuário: "o apontamento da rotulagem tem que conciliar a partir da quantidade
   de produto envasado + sobra de frasco rotulado apontada pela produção +
   perdas apontadas pela produção".

       rotulado  =  envasado  +  perdas (frasco rotulado perdido no envase)  +  sobra declarada
       saldo em linha  =  rotulado − envasado − perdas        (o que está "em estoque" para o envase)
       diferença       =  saldo em linha − sobra declarada    (o que ninguém explicou)

   Perdas que entram na conta: do ENVASE, o frasco (já rotulado) e o produto
   envasado descartado. Perda da própria ROTULAGEM (frasco ou rótulo estragado
   ao rotular) não entra: esse frasco nunca virou "rotulado" e não está no
   apontamento da rotulagem.

   Hoje não existe trava: o PCP pode confirmar/concluir mesmo com diferença; em
   algum momento a ideia é travar (por isso `tolerancia()` já existe, mas ninguém
   a usa para bloquear).

   Funções puras, testadas em run_conciliacao_rotulagem_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConciliacaoRotulagem = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var PERCENTUAL_TOLERANCIA = 0.5;   // % do rotulado; só informativo
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function txt(v) { return String(v == null ? '' : v).trim(); }

  function tolerancia(rotulado) { return Math.max(1, Math.round(num(rotulado) * PERCENTUAL_TOLERANCIA / 100)); }

  /* perdas = lista de registros de perdas/{lote} ({perdas:[{tipo, quantidade, etapa, produto}]}) ou
     a lista de itens já achatada. */
  function perdasDoEnvase(perdas) {
    var itens = [];
    (perdas || []).forEach(function(r) {
      if (r && Array.isArray(r.perdas)) itens = itens.concat(r.perdas); else if (r && r.tipo) itens.push(r);
    });
    var frascos = 0, produto = 0, rotulagem = 0;
    itens.forEach(function(p) {
      var etapa = txt(p.etapa).toLowerCase(), q = num(p.quantidade), tipo = txt(p.tipo);
      if (etapa === 'rotulagem') { rotulagem += q; return; }
      if (p.produto && tipo === 'Bulk (kg)') return;              // bulk fora do frasco: kg, não conta frasco
      if (p.produto || tipo === 'Produto envasado (un)') { produto += q; return; }
      if (tipo === 'Frascos') frascos += q;
    });
    return {frascos: frascos, produto: produto, rotulagem: rotulagem, total: frascos + produto};
  }

  /* op = registro da OP; perdas = registros de perdas da OP; retidos = registros de material_processo da OP. */
  function conciliar(op, perdas, retidos) {
    var o = op || {};
    var rotulado = num(o.produzidoRotulagem), envasado = num(o.produzidoLinha != null ? o.produzidoLinha : o.produzido);
    var p = perdasDoEnvase(perdas);
    var sobra = 0;
    (retidos || []).forEach(function(r) { if (r && r.tipo === 'FRASCO_ROTULADO' && r.status !== 'CANCELADO') sobra += num(r.qtd); });
    var declarou = !!(o.contagemSobras && Object.keys(o.contagemSobras).length);
    var temRotulagem = rotulado > 0 || !!(o.abertaDesdeRot || o.setupInicioRot || o.setupFimRot);
    var usado = envasado + p.total;
    var saldo = rotulado - usado;                     // em estoque (ou perdido sem apontar)
    var dif = saldo - sobra;
    var tol = tolerancia(rotulado);
    var estado;
    if (!temRotulagem && !envasado) estado = 'sem_dados';
    else if (!(rotulado > 0)) estado = envasado > 0 ? 'nao_apontada' : 'sem_dados';   // envasou e a rotulagem não apontou
    else if (dif < -tol) estado = 'envasou_mais';     // envasado + perdas > rotulado
    else if (Math.abs(dif) <= tol) estado = declarou || sobra > 0 || saldo <= tol ? 'conciliada' : 'em_estoque';
    else estado = declarou || !(o.abertaDesdeRot || o.abertaDesde) ? 'divergente' : 'em_estoque';
    // OP ainda rodando: o saldo positivo é estoque intermediário legítimo, não divergência.
    if (estado === 'divergente' && (o.abertaDesdeRot || o.abertaDesde) && !declarou) estado = 'em_estoque';
    return {
      rotulado: rotulado, envasado: envasado, perdasEnvase: p.total, perdasFrascos: p.frascos, perdasProduto: p.produto, perdasRotulagem: p.rotulagem,
      sobraDeclarada: sobra, declarou: declarou, saldoEmLinha: Math.max(0, saldo), diferenca: dif, tolerancia: tol, estado: estado
    };
  }

  var ROTULOS = {
    conciliada: {tom: 'ok', texto: '✓ Rotulagem conciliada'},
    em_estoque: {tom: 'info', texto: 'frascos rotulados em estoque'},
    divergente: {tom: 'aviso', texto: 'rotulagem com diferença'},
    envasou_mais: {tom: 'aviso', texto: 'envasou mais do que rotulou'},
    nao_apontada: {tom: 'aviso', texto: 'rotulagem sem apontamento'},
    sem_dados: {tom: 'mute', texto: ''}
  };
  function fmt(n) { return Number(n).toLocaleString('pt-BR', {maximumFractionDigits: 0}); }
  function resumo(c) {
    var r = ROTULOS[c.estado] || ROTULOS.sem_dados, texto = r.texto;
    if (c.estado === 'em_estoque') texto = fmt(c.saldoEmLinha) + ' ' + r.texto;
    else if (c.estado === 'divergente') texto = r.texto + ': ' + (c.diferenca > 0 ? 'faltam explicar ' : 'sobram ') + fmt(Math.abs(c.diferenca)) + ' un';
    else if (c.estado === 'envasou_mais') texto = r.texto + ' (' + fmt(Math.abs(c.diferenca)) + ' un)';
    return {tom: r.tom, texto: texto,
      detalhe: 'Rotulado ' + fmt(c.rotulado) + ' = envasado ' + fmt(c.envasado) + ' + perdas (frasco rotulado) ' + fmt(c.perdasEnvase) + ' + sobra declarada ' + fmt(c.sobraDeclarada) + ' · diferença ' + fmt(c.diferenca) + ' (tolerância informativa ' + fmt(c.tolerancia) + ')'};
  }

  return {conciliar: conciliar, perdasDoEnvase: perdasDoEnvase, tolerancia: tolerancia, resumo: resumo, ROTULOS: ROTULOS, PERCENTUAL_TOLERANCIA: PERCENTUAL_TOLERANCIA};
});
