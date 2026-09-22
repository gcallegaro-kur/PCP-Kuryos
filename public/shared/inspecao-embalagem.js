/* F009 — Recebimento e análise de EMBALAGENS (POP 041).

   O formulário existe em papel e está em `06. Laboratório/01. CQ/08. LAUDOS
   DE EMBALAGENS/F 0009 - Inspeção de embalagens - Rev 01`. Os 13 parâmetros
   e a tabela dimensional abaixo são os dele, na mesma ordem — não é um
   checklist novo inventado aqui.

   Por que embalagem tem roteiro PRÓPRIO, separado de matéria-prima: o que
   se analisa é outro. MP tem ensaio de laboratório (aspecto, cor, odor, pH,
   teor) e já vive em `especificacoes/{material}__v1`, com 1.323 ensaios
   cadastrados. Embalagem tem defeito de molde e medida — rachadura, furo,
   rebarba, rosqueamento, vedação — e uma tabela de medidas contra a ficha
   técnica do fornecedor. Rodar um no formulário do outro é o que fazia a
   inspetora deixar campo em branco (mesmo motivo do CK-7 nascer em 17/09,
   quando o palete de PA abria o plano de ensaio do granel).

   SEVERIDADE é acréscimo do sistema, não do papel: o F009 só tem
   Aprovado/Reprovado. Ela existe aqui porque a RNC automática precisa de
   classificação e porque rachadura e furo não são desvio negociável —
   embalagem que vaza contamina o produto e para a linha.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InspecaoEmbalagem = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // Ordem e nomes do F009. Não reordenar: a inspetora confere com o papel.
  var PLANO_F009 = [
    {id: 'rachaduras', texto: 'Rachaduras', severidade: 'CRITICO'},
    {id: 'furos', texto: 'Furos', severidade: 'CRITICO'},
    {id: 'manchas', texto: 'Manchas', severidade: 'MENOR'},
    {id: 'bolhas', texto: 'Bolhas', severidade: 'MENOR'},
    {id: 'rebarbas', texto: 'Rebarbas', severidade: 'MENOR'},
    {id: 'cor', texto: 'Cor', severidade: 'MAIOR'},
    {id: 'impressao', texto: 'Impressão', severidade: 'MAIOR'},
    {id: 'encaixe', texto: 'Encaixe', severidade: 'MAIOR'},
    {id: 'rosqueamento', texto: 'Rosqueamento', severidade: 'MAIOR'},
    {id: 'funcionamento', texto: 'Funcionamento', severidade: 'CRITICO'},
    {id: 'compatibilidade', texto: 'Compatibilidade', severidade: 'CRITICO'},
    {id: 'temperatura', texto: 'Temperatura', severidade: 'MAIOR'},
    {id: 'vedacao', texto: 'Vedação', severidade: 'CRITICO'}
  ];

  // Colunas da tabela dimensional do F009.
  var MEDIDAS = [
    {id: 'altura', texto: 'Altura'},
    {id: 'largura', texto: 'Largura'},
    {id: 'comprimento', texto: 'Comprimento'},
    {id: 'volume', texto: 'Volume'}
  ];

  /* O papel tem 12 linhas impressas. Aqui é só o PADRÃO: o usuário pediu a
     amostragem em aberto (21/09) e vale o mesmo raciocínio da pesagem de
     PA — lote pequeno não justifica 12 medidas, lote suspeito pede mais. */
  var AMOSTRAS_PADRAO = 12;

  function n(v) { var x = Number(v); return isFinite(x) ? x : null; }

  /* Lista de amostras dimensionais do tamanho pedido, preservando o que já
     foi medido. Encolher descarta do fim pra frente -- é a única ordem que
     não embaralha a numeração das amostras já registradas. */
  function redimensionarAmostras(amostras, quantidade) {
    var atual = Array.isArray(amostras) ? amostras.slice() : [];
    var alvo = Math.max(Math.floor(n(quantidade) || 0), 0);
    while (atual.length > alvo) atual.pop();
    while (atual.length < alvo) atual.push({});
    return atual;
  }

  // Linhas com alguma medida preenchida -- as vazias não vão para o laudo.
  function amostrasPreenchidas(amostras) {
    return (amostras || []).filter(function(a) {
      return MEDIDAS.some(function(m) { return n((a || {})[m.id]) != null; });
    });
  }

  /* respostas: {itemId: {cnc: 'C'|'NC'|'NA', observacao?}}
     Devolve as linhas prontas para a tela e o veredito. Mesma forma de
     retorno do InspecaoPA.avaliar, de propósito: a tela de Qualidade
     desenha os dois com o mesmo código. */
  function avaliar(respostas, amostras) {
    var linhas = PLANO_F009.map(function(item) {
      var r = (respostas || {})[item.id] || {};
      var c = r.cnc || '';
      return {
        id: item.id, texto: item.texto, severidade: item.severidade, secao: 'Parâmetros',
        tipo: 'CNC', cnc: c, observacao: r.observacao || '',
        conforme: c === 'C' ? true : c === 'NC' ? false : null, motivo: ''
      };
    });
    var naoConformes = linhas.filter(function(l) { return l.conforme === false; });
    var criticosNC = naoConformes.filter(function(l) { return l.severidade === 'CRITICO'; });
    var pendentes = linhas.filter(function(l) { return l.conforme == null && l.cnc !== 'NA'; });
    var medidas = amostrasPreenchidas(amostras);

    var impedimentos = [];
    if (criticosNC.length) {
      impedimentos.push(criticosNC.length + ' parâmetro(s) crítico(s) não conforme(s): ' +
        criticosNC.map(function(l) { return l.texto.toLowerCase(); }).join(', '));
    }
    return {
      linhas: linhas,
      conformes: linhas.filter(function(l) { return l.conforme === true; }).length,
      naoConformes: naoConformes.length, criticosNC: criticosNC.length,
      maiorNC: naoConformes.filter(function(l) { return l.severidade === 'MAIOR'; }).length,
      menorNC: naoConformes.filter(function(l) { return l.severidade === 'MENOR'; }).length,
      pendentes: pendentes.length,
      naoAplicaveis: linhas.filter(function(l) { return l.cnc === 'NA'; }).length,
      medidas: medidas.length,
      // Rachadura, furo, vedação, funcionamento e compatibilidade travam:
      // embalagem que vaza contamina o produto. O resto é decisão da
      // inspetora, igual ao CK-7.
      bloqueia: impedimentos.length > 0, impedimentos: impedimentos,
      completo: !pendentes.length,
      classificacaoRnc: criticosNC.length ? 'CRITICA'
        : (naoConformes.filter(function(l) { return l.severidade === 'MAIOR'; }).length ? 'MAIOR' : 'MENOR')
    };
  }

  // O que fica gravado no laudo.
  function registro(aval, extras) {
    var e = extras || {};
    var itens = {};
    aval.linhas.forEach(function(l) {
      itens[l.id] = {texto: l.texto, severidade: l.severidade, cnc: l.cnc || null,
        conforme: l.conforme, observacao: l.observacao || null};
    });
    return {
      versaoPlano: 'F009-REV01',
      itens: itens,
      dimensional: amostrasPreenchidas(e.amostras).map(function(a) {
        var linha = {};
        MEDIDAS.forEach(function(m) { linha[m.id] = n(a[m.id]); });
        return linha;
      }),
      fichaTecnica: e.fichaTecnica || null,
      resumo: aval.conformes + 'C / ' + aval.naoConformes + 'NC / ' + aval.pendentes + ' pend.' +
        (aval.naoAplicaveis ? ' / ' + aval.naoAplicaveis + ' NA' : ''),
      criticosNC: aval.criticosNC, impedimentos: aval.impedimentos
    };
  }

  return {
    PLANO_F009: PLANO_F009, MEDIDAS: MEDIDAS, AMOSTRAS_PADRAO: AMOSTRAS_PADRAO,
    redimensionarAmostras: redimensionarAmostras, amostrasPreenchidas: amostrasPreenchidas,
    avaliar: avaliar, registro: registro
  };
});
