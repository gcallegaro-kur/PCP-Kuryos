/* Padrão de nome do material (24/10/2026).

   Decisão do usuário no saneamento do cadastro: "vale especificar ao máximo,
   sempre". Medido na base: 14 grupos de embalagens com nome idêntico (101
   códigos — 26 chamados só "FRASCO", 15 "TAMPA", 8 "VÁLVULA"), e dois códigos de
   sobretampa com o mesmo nome. Quem está no chão e quem compra não tem como
   saber qual código é qual, e a baixa de estoque cai no errado.

   Regra, para embalagem (EP/ES/ET):
     TIPO + descrição + medida + fornecedor/molde  (ex.: "FRASCO R.24/410 HIDRA C/RECRAVE
     BODY SPLASH 200ML")
       - pelo menos 3 palavras e 15 caracteres;
       - não pode ser só o tipo (FRASCO, TAMPA, VÁLVULA…);
       - precisa ter ao menos um número (capacidade, rosca, medida);
       - não pode repetir o nome de OUTRO código de embalagem (sem acento/caixa).
   Para os demais tipos: pelo menos 4 caracteres e não repetir o nome de outro
   código do mesmo tipo.
   Função pura; o cadastro (cadastros.html) bloqueia o salvar com as mensagens. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NomeMaterial = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var EMBALAGEM = {EP: 1, ES: 1, ET: 1};
  var GENERICOS = {FRASCO: 1, TAMPA: 1, VALVULA: 1, SOBRETAMPA: 1, INATIVO: 1, BISNAGA: 1, ROTULO: 1, CAIXA: 1, CARTUCHO: 1, POTE: 1, SLEEVE: 1, TESTE: 1};

  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  /* nome: o que foi digitado; tipo: EP/ES/ET/MPGR/…; codigoAtual: código do material
     que está sendo editado (null se for novo); materiais: mapa do cadastro.
     -> {ok, erros: [texto]} */
  function validar(nome, tipo, codigoAtual, materiais) {
    var erros = [], n = norm(nome), palavras = n ? n.split(' ') : [];
    var emb = !!EMBALAGEM[tipo];
    if (!n) return {ok: false, erros: ['Informe o nome do material.']};
    if (GENERICOS[n]) erros.push('"' + String(nome).trim() + '" é só o tipo do item. Descreva: tipo + descrição + medida + fornecedor/molde.');
    if (emb) {
      if (palavras.length < 3 || n.length < 15) erros.push('Nome curto demais para uma embalagem (mínimo 3 palavras e 15 caracteres). Use: tipo + descrição + medida + fornecedor/molde.');
      if (!/[0-9]/.test(n)) erros.push('Falta a medida: inclua capacidade, rosca ou dimensão (ex.: 200ML, R.24/410, 406X306X184).');
    } else if (n.length < 4) erros.push('Nome curto demais (mínimo 4 caracteres).');
    var vistos = [];
    Object.keys(materiais || {}).forEach(function(k) {
      var m = materiais[k] || {};
      if ((m.mpCodigo || k) === codigoAtual) return;
      if (emb ? !EMBALAGEM[m.tipo] : m.tipo !== tipo) return;
      if (norm(m.mpNome) === n) vistos.push(m.mpCodigo || k);
    });
    if (vistos.length) erros.push('Já existe ' + (vistos.length > 1 ? 'material' : 'o material') + ' com este nome: ' + vistos.slice(0, 5).join(', ') +
      '. Diferencie (medida, fornecedor, molde) ou use o código que já existe.');
    return {ok: !erros.length, erros: erros};
  }

  return {validar: validar, norm: norm};
});
