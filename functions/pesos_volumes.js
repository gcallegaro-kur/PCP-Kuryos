/* Peso de cada volume no recebimento (pedido da Logística, 20/10/2026).

   Primeiro a etiqueta passou a dividir o total igualmente entre os volumes
   (330 kg em 7 = 47,15 / 47,14). Mas o recebimento real nem sempre é igual:
   neste caso eram 6 volumes de 50 kg e 1 de 30. Aqui a Logística DIGITA como
   chegou e o sistema confere com o total:

       6x50 + 30        ->  [50, 50, 50, 50, 50, 50, 30]   (7 volumes, 330)
       50 50 50 30      ->  [50, 50, 50, 30]
       6 x 47,5; 45     ->  [47,5 ×6, 45]

   Separadores de volume: "+", ";" ou espaço. A vírgula é DECIMAL (47,5);
   "N x V" repete V, N vezes. Funções puras, sem DOM, para tela, servidor
   (functions/recebimento.js valida o mesmo) e etiqueta. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PesosVolumes = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var LIMITE_VOLUMES = 9999;
  var TOLERANCIA = 0.0005;

  function arred(v) { return Math.round(Number(v) * 1000) / 1000; }
  function numeroBR(s) {
    var t = String(s || '').trim();
    if (!/^\d+([.,]\d+)?$/.test(t)) return NaN;
    return Number(t.replace(',', '.'));
  }

  /* Texto -> {ok, pesos:[...], erro}. Vazio = {ok:true, pesos:null} (sem
     pesos informados: a etiqueta divide igual). */
  function interpretar(texto) {
    var t = String(texto == null ? '' : texto).trim();
    if (!t) return {ok: true, pesos: null, erro: null};
    // "50, 50" (vírgula + espaço) separa; "47,5" (vírgula colada) é decimal.
    t = t.replace(/,\s+/g, ' ').replace(/\s*[x×*]\s*/gi, 'x').replace(/\s*\+\s*/g, '+').replace(/\s*;\s*/g, ';');
    var partes = t.split(/[+;\s]+/).filter(Boolean), pesos = [];
    for (var i = 0; i < partes.length; i++) {
      var p = partes[i], m = /^(\d+)x(.+)$/i.exec(p), vezes = 1, valor;
      if (m) { vezes = Number(m[1]); valor = numeroBR(m[2]); }
      else valor = numeroBR(p);
      if (!isFinite(valor) || valor <= 0) return {ok: false, pesos: null, erro: 'Não entendi "' + p + '". Use, por exemplo: 6x50 + 30'};
      if (!(vezes >= 1) || pesos.length + vezes > LIMITE_VOLUMES) return {ok: false, pesos: null, erro: 'Quantidade de volumes inválida em "' + p + '".'};
      for (var k = 0; k < vezes; k++) pesos.push(valor);
    }
    return {ok: true, pesos: pesos, erro: null};
  }

  /* Confere os pesos com o total e com o nº de volumes. */
  function conferir(pesos, total, volumes) {
    if (!pesos || !pesos.length) return {ok: true, informado: false, soma: null, diferenca: 0, erro: null};
    var soma = arred(pesos.reduce(function(t, v) { return t + Number(v); }, 0)), dif = arred(Number(total) - soma);
    var erro = null;
    if (volumes != null && Number(volumes) !== pesos.length) erro = 'Os pesos descrevem ' + pesos.length + ' volume(s), mas o campo de volumes tem ' + volumes + '.';
    else if (Math.abs(dif) > TOLERANCIA) erro = 'Os pesos somam ' + soma + ' e a quantidade é ' + total + ' (' + (dif > 0 ? 'faltam ' : 'sobram ') + Math.abs(dif) + ').';
    return {ok: !erro, informado: true, soma: soma, diferenca: dif, erro: erro};
  }

  /* "6 × 50 + 1 × 30 = 330 kg": agrupa pesos iguais consecutivos. */
  function resumo(pesos, unidade) {
    if (!pesos || !pesos.length) return '';
    var grupos = [];
    pesos.forEach(function(p) {
      var g = grupos[grupos.length - 1];
      if (g && g.valor === p) g.n++; else grupos.push({valor: p, n: 1});
    });
    var f = function(v) { return Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 3}); };
    var soma = arred(pesos.reduce(function(t, v) { return t + Number(v); }, 0));
    return grupos.map(function(g) { return g.n + ' × ' + f(g.valor); }).join(' + ') + ' = ' + f(soma) + (unidade ? ' ' + unidade : '');
  }

  /* O que o servidor aceita: lista de números > 0, do tamanho dos volumes,
     somando o total. Devolve {pesos|null, erro|null}. */
  function validarLista(lista, total, volumes) {
    if (lista == null) return {pesos: null, erro: null};
    if (!Array.isArray(lista) || !lista.length || lista.length > LIMITE_VOLUMES) return {pesos: null, erro: 'Pesos dos volumes inválidos.'};
    var pesos = lista.map(Number);
    if (pesos.some(function(v) { return !isFinite(v) || v <= 0; })) return {pesos: null, erro: 'Cada volume deve ter peso maior que zero.'};
    var c = conferir(pesos, total, volumes);
    return c.ok ? {pesos: pesos.map(arred), erro: null} : {pesos: null, erro: c.erro};
  }

  return {interpretar: interpretar, conferir: conferir, resumo: resumo, validarLista: validarLista};
});
