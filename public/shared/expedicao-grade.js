(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExpedicaoGrade = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function numero(v) { return Number(v).toLocaleString('pt-BR'); }
  function composicao(p) {
    p = p || {};
    var caixas = Number(p.caixasFechadas), multiplo = Number(p.unidadesPorCaixa), parcial = Number(p.unidadesCaixaParcial || 0);
    var total = Number(p.saldoLote != null ? p.saldoLote : p.qtdUnidades);
    var valida = Number.isInteger(caixas) && caixas >= 0 && Number.isInteger(parcial) && parcial >= 0 &&
      Number.isInteger(total) && total > 0 && (caixas === 0 || Number.isInteger(multiplo) && multiplo > 0) &&
      (multiplo <= 0 || parcial < multiplo) && caixas * multiplo + parcial === total;
    if (!valida) return {valida: false, total: Number.isFinite(total) ? total : null, volumes: null,
      texto: 'Composição a conferir', resumo: (Number.isFinite(total) ? numero(total) + ' un · ' : '') + 'composição a conferir'};
    var partes = [];
    if (caixas > 0) partes.push(numero(caixas) + ' cx × ' + numero(multiplo));
    if (parcial > 0) partes.push('1 parcial com ' + numero(parcial));
    var texto = partes.join(' + ');
    return {valida: true, caixas: caixas, multiplo: multiplo || null, parcial: parcial,
      total: total, volumes: caixas + (parcial > 0 ? 1 : 0), texto: texto, resumo: texto + ' = ' + numero(total) + ' un'};
  }
  function dia(v) {
    var s = String(v || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var n = Date.parse(s + 'T12:00:00Z');
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s ? n : null;
  }
  function diasEstoque(entrada, saidaOuHoje) {
    var a = dia(entrada), b = dia(saidaOuHoje);
    return a == null || b == null || b < a ? null : Math.round((b - a) / 86400000);
  }
  function totais(paletes) {
    return (paletes || []).reduce(function(t, p) {
      var c = composicao(p);
      t.paletes++; t.unidades += c.total || 0;
      if (c.valida) { t.caixasFechadas += c.caixas; t.caixasParciais += c.parcial > 0 ? 1 : 0; t.volumes += c.volumes; }
      else t.composicoesPendentes++;
      return t;
    }, {paletes: 0, unidades: 0, caixasFechadas: 0, caixasParciais: 0, volumes: 0, composicoesPendentes: 0});
  }
  return {composicao: composicao, diasEstoque: diasEstoque, totais: totais};
});
