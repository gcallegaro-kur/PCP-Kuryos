/* Especificação de matéria-prima: o plano de ensaios que o CQ preenche na
   PRÓPRIA análise do lote, e o casamento dos laudos antigos do laboratório
   com o cadastro de materiais.

   Decisões do usuário (2026-09-23):
   - "vamos deixar o cadastro acontecer na análise da qualidade" — a spec
     nasce no laudo, não numa tela de cadastro que ninguém alimenta.
   - Plano fixo: Aspecto físico, Cor, Odor, pH, Densidade e Teor alcoólico,
     "podendo ser NA caso não seja aplicável à MP em questão".
   - "mesmas specs para todos os fornecedores" — a especificação é do
     MATERIAL, não do fornecedor nem do cliente.
   - Os códigos do laboratório NÃO batem com os do sistema (o laudo do
     álcool traz MPAL002; no sistema é MPGR-00127), então o casamento é
     por NOME, com similaridade e nível de confiança.

   Grava em `especificacoes/{CODIGO}__v{n}` — a mesma chave que
   `especificacaoVigente` (utils.js) já lê para produto, então o laudo, a
   impressão e o plano de inspeção funcionam sem mexer no motor.

   Funções puras, testadas em run_spec_material_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpecMaterial = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // O plano padrão. `chave` é estável (não muda se o rótulo mudar).
  var PLANO_MP = [
    {chave: 'aspecto', ensaio: 'Aspecto físico', metodo: 'Visual'},
    {chave: 'cor', ensaio: 'Cor', metodo: 'Visual'},
    {chave: 'odor', ensaio: 'Odor', metodo: 'Olfativo'},
    {chave: 'ph', ensaio: 'pH', metodo: 'Potenciométrico', numerico: true},
    {chave: 'densidade', ensaio: 'Densidade', metodo: 'Densímetro', numerico: true},
    {chave: 'teor_alcoolico', ensaio: 'Teor alcoólico', metodo: 'ASTM D1296', numerico: true}
  ];
  var NA = 'NA';

  function texto(v) { return String(v == null ? '' : v).trim(); }
  function n(v) { var x = Number(String(v).replace(',', '.')); return isFinite(x) ? x : null; }
  function normalizar(v) {
    return texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Palavras que não distinguem material nenhum: entram no nome mas não
  // devem puxar a similaridade para cima.
  var VAZIAS = ['DE', 'DA', 'DO', 'E', 'A', 'O', 'EM', 'COM', 'PARA', 'LTDA', 'KG', 'ML', 'L'];
  function palavras(v) {
    return normalizar(v).split(' ').filter(function(p) { return p && VAZIAS.indexOf(p) < 0; });
  }

  /* Similaridade por palavras (Jaccard ponderado pelo tamanho): "ALCOOL
     CEREAIS" x "ALCOOL DE CEREAIS 96" dá alto; "ALCOOL 96" x "ALCOOL
     CETOESTEARILICO" dá baixo. Simples e auditável -- dá para explicar à
     analista por que casou. */
  function similaridade(a, b) {
    var pa = palavras(a), pb = palavras(b);
    if (!pa.length || !pb.length) return 0;
    var setB = {};
    pb.forEach(function(p) { setB[p] = true; });
    var comuns = 0;
    pa.forEach(function(p) {
      if (setB[p]) { comuns++; return; }
      // Prefixo de 5+ letras conta como meio acerto (CETOESTEARILICO x
      // CETOESTEARÍLICO já normalizado, ALCOOL x ALCOOLS).
      var achou = pb.some(function(q) {
        var m = Math.min(p.length, q.length);
        return m >= 5 && p.slice(0, m) === q.slice(0, m);
      });
      if (achou) comuns += 0.5;
    });
    return comuns / Math.max(pa.length, pb.length);
  }

  /* Acha o material do sistema para um nome de laudo. Só olha MP (MPGR,
     MPES, MU): embalagem tem outro formulário. Devolve também o segundo
     colocado -- quando os dois ficam perto, o caso vira revisão manual em
     vez de um palpite com cara de certeza. */
  function casarMaterial(nomeLaudo, materiais, opcoes) {
    var o = opcoes || {};
    var minimo = o.minimo == null ? 0.6 : o.minimo;
    var candidatos = [];
    Object.keys(materiais || {}).forEach(function(k) {
      var m = materiais[k] || {};
      if (!/^(MPGR|MPES|MU)$/.test(texto(m.tipo))) return;
      var nome = texto(m.mpNome || m.nome || m.descricao);
      if (!nome) return;
      var s = similaridade(nomeLaudo, nome);
      if (s > 0) candidatos.push({codigo: texto(m.mpCodigo) || k, nome: nome, score: Math.round(s * 100) / 100});
    });
    candidatos.sort(function(a, b) { return b.score - a.score || a.nome.localeCompare(b.nome); });
    var melhor = candidatos[0], segundo = candidatos[1];
    if (!melhor || melhor.score < minimo) return {achou: false, candidatos: candidatos.slice(0, 3)};
    var confianca = melhor.score >= 0.999 ? 'EXATO'
      : (segundo && melhor.score - segundo.score < 0.1) ? 'AMBIGUO'
      : melhor.score >= 0.8 ? 'ALTA' : 'MEDIA';
    return {achou: confianca !== 'AMBIGUO', confianca: confianca, escolhido: melhor,
      segundo: segundo || null, candidatos: candidatos.slice(0, 3)};
  }

  /* O plano de uma MP: o padrão, preenchido com o que veio do laudo (ou do
     que a analista digitou). O que não se aplica fica NA -- decisão do
     usuário -- e NA nunca reprova um lote. */
  function planoDoMaterial(itensGravados) {
    var atuais = itensGravados || {};
    return PLANO_MP.map(function(p) {
      var g = atuais[p.chave] || {};
      var espec = texto(g.especificacaoTexto);
      return {
        chave: p.chave, ensaio: p.ensaio,
        especificacaoTexto: espec || NA,
        metodo: texto(g.metodo) || p.metodo,
        minimo: g.minimo == null ? null : n(g.minimo),
        maximo: g.maximo == null ? null : n(g.maximo),
        critico: !!g.critico,
        numerico: !!p.numerico,
        aplicavel: !!espec && espec.toUpperCase() !== NA
      };
    });
  }

  function validarPlano(linhas) {
    var erros = [], aplicaveis = 0;
    (linhas || []).forEach(function(l) {
      var espec = texto(l.especificacaoTexto);
      if (!espec) { erros.push(l.ensaio + ': preencha a especificação ou marque NA.'); return; }
      if (espec.toUpperCase() === NA) return;
      aplicaveis++;
      var min = l.minimo == null || l.minimo === '' ? null : n(l.minimo);
      var max = l.maximo == null || l.maximo === '' ? null : n(l.maximo);
      if (min != null && max != null && min > max) erros.push(l.ensaio + ': o mínimo é maior que o máximo.');
    });
    if (!aplicaveis) erros.push('Pelo menos um ensaio precisa valer para esta matéria-prima — todos em NA não é especificação.');
    return {ok: !erros.length, erros: erros, aplicaveis: aplicaveis};
  }

  /* O que gravar. Versão nova a cada edição: a especificação vigente muda,
     mas o laudo antigo continua apontando para a versão com que foi feito. */
  function atualizacoes(codigo, linhas, contexto) {
    var c = contexto || {};
    var versao = (Number(c.versaoAtual) || 0) + 1;
    var itens = {};
    (linhas || []).forEach(function(l) {
      var espec = texto(l.especificacaoTexto) || NA;
      itens[l.chave] = {
        ensaio: l.ensaio, especificacaoTexto: espec, metodo: texto(l.metodo) || null,
        minimo: l.minimo == null || l.minimo === '' ? null : n(l.minimo),
        maximo: l.maximo == null || l.maximo === '' ? null : n(l.maximo),
        critico: !!l.critico,
        aplicavel: espec.toUpperCase() !== NA
      };
    });
    var u = {};
    u['especificacoes/' + codigo + '__v' + versao] = {
      codProduto: codigo, versao: 'v' + versao, tipoItem: 'MATERIAL', status: 'APROVADA',
      origem: c.origem || 'ANALISE_CQ', criadoEm: c.agora || null, criadoPor: c.por || null,
      itens: itens
    };
    return {updates: u, versao: versao, chave: codigo + '__v' + versao};
  }

  return {
    PLANO_MP: PLANO_MP, NA: NA,
    normalizar: normalizar, similaridade: similaridade, casarMaterial: casarMaterial,
    planoDoMaterial: planoDoMaterial, validarPlano: validarPlano, atualizacoes: atualizacoes
  };
});
