/* ══════════════════════════════════════════════════════════════════════
   RESULTADOS DO LAUDO DE PRODUTO ACABADO — FQ e microbiologia

   Pedido do usuário (28/09): "preciso ter a opção de preencher os
   resultados obtidos, dentro do sistema, não para ser preenchido no papel,
   se não não adianta em nada".

   Antes, o Relatório de Análise de PA saía assim:
   - Seção 3 (FQ): resultado da análise do bulk do lote; SEM bulk analisado
     (lote anterior à Manipulação, ou bulk sem ensaio), resultado em branco
     para escrever à caneta;
   - Seção 6 (micro): resultados FIXOS no modelo ("Ausente", "< 1 × 10³")
     impressos mesmo que ninguém tivesse feito a análise -- documento de BPF
     afirmando um resultado que não existe.

   Agora os dois blocos são preenchidos no laudo e gravados com ele
   (`qualidade.resultadosPa`). O impresso só mostra o que foi digitado:
   campo vazio continua vazio -- pendência visível, nunca resultado inventado.

   Funções PURAS: sem DOM, sem Firebase.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaudoPaResultados = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function texto(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }

  // Os cinco parâmetros do modelo oficial, quando não há bulk analisado nem
  // especificação cadastrada.
  var FQ_PADRAO = [
    {parametro: 'Aspecto', especificacao: 'Conforme padrão', metodo: 'Análise visual'},
    {parametro: 'Cor', especificacao: 'Conforme padrão', metodo: 'Análise visual'},
    {parametro: 'Odor', especificacao: 'Característico', metodo: 'Análise olfativa'},
    {parametro: 'pH (25°C)', especificacao: '', metodo: 'pHmetro calibrado'},
    {parametro: 'Densidade', especificacao: '', metodo: 'Picnômetro / densímetro'}
  ];

  // Tabela do modelo oficial (Tipo II, RDC 907/2024). Sem resultado: ele é
  // da análise, não do modelo.
  var MICRO_PADRAO = [
    {analise: 'Contagem de Microrganismos Mesófilos Aeróbios Totais', metodo: 'USP',
      especificacao: '≤ 1 × 10³ UFC/g ou mL', opcoes: ['< 1 × 10³ UFC/mL ou g', '> 1 × 10³ UFC/mL ou g']},
    {analise: 'Ausência de Pseudomonas aeruginosa', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', opcoes: ['Ausente', 'Presente']},
    {analise: 'Ausência de Staphylococcus aureus', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', opcoes: ['Ausente', 'Presente']},
    {analise: 'Ausência de coliformes totais e fecais', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', opcoes: ['Ausente', 'Presente']}
  ];
  // Resultado que reprova (o primeiro da lista é sempre o conforme).
  function microConforme(linha) {
    var r = texto(linha && linha.resultado);
    if (!r) return null;
    var base = MICRO_PADRAO.find(function(m) { return m.analise === (linha && linha.analise); });
    if (!base) return null;
    if (r === base.opcoes[0]) return true;
    if (base.opcoes.indexOf(r) > 0) return false;
    return null; // texto livre: quem julga é a analista
  }

  function cnc(c) { return c === 'C' ? 'Conforme' : c === 'NC' ? 'Não conforme' : ''; }

  // "pH (25°C)", "PH" e "ph" são o mesmo parâmetro.
  function chave(nome) {
    return texto(nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
  }

  /* Linhas iniciais do FQ.
     - Os PARÂMETROS vêm da especificação cadastrada do produto; sem ela, os
       cinco do modelo oficial.
     - Os RESULTADOS vêm da análise do bulk do mesmo lote
       (manipulacao.analise.ensaios), que é onde pH e densidade são medidos:
       cada ensaio do bulk preenche a linha de mesmo nome, marcada 'bulk'; o
       que o bulk mediu e a lista não tem entra no fim.
     Assim um bulk que só mediu densidade não esconde aspecto, cor, odor e
     pH -- eles ficam para o laudo preencher. */
  function fqInicial(ensaiosBulk, itensEspec, faixaTexto) {
    var espec = itensEspec || {};
    var linhas = Object.keys(espec).length
      ? Object.keys(espec).map(function(k) {
          var e = espec[k] || {};
          return {parametro: texto(e.ensaio),
            especificacao: texto(e.especificacaoTexto || (typeof faixaTexto === 'function' ? faixaTexto(e) : '')),
            metodo: texto(e.metodo), resultado: '', origem: 'laudo'};
        })
      : FQ_PADRAO.map(function(p) { return Object.assign({resultado: '', origem: 'laudo'}, p); });
    var bulk = ensaiosBulk || {};
    Object.keys(bulk).forEach(function(k) {
      var e = bulk[k] || {};
      var valor = e.valor != null && e.valor !== '' ? String(e.valor) : cnc(e.cnc);
      var alvo = linhas.find(function(l) { return chave(l.parametro) === chave(e.ensaio); });
      if (!alvo) {
        alvo = {parametro: texto(e.ensaio), especificacao: '', metodo: '', resultado: '', origem: 'laudo'};
        linhas.push(alvo);
      }
      if (!alvo.especificacao) alvo.especificacao = texto(e.especificacaoTexto || e.faixa);
      if (!alvo.metodo) alvo.metodo = texto(e.metodo);
      if (valor) { alvo.resultado = valor; alvo.origem = 'bulk'; }
    });
    return linhas;
  }

  function microInicial() {
    return {realizada: true, linhas: MICRO_PADRAO.map(function(m) {
      return {analise: m.analise, metodo: m.metodo, especificacao: m.especificacao, resultado: ''};
    }), laboratorio: '', laudoExterno: '', justificativa: ''};
  }

  /* O que ainda falta e o que reprova. Falta é AVISO (a tela pergunta antes
     de liberar); micro "Presente"/"> 1 × 10³" é impedimento, igual ao
     defeito crítico do CK-7. */
  function avaliar(fq, micro) {
    var pendentes = [], impedimentos = [];
    (fq || []).forEach(function(l) {
      if (texto(l.parametro) && !texto(l.resultado)) pendentes.push('FQ: ' + texto(l.parametro));
    });
    var m = micro || {};
    if (m.realizada === false) {
      if (!texto(m.justificativa)) pendentes.push('Microbiologia: justificativa da dispensa');
    } else {
      (m.linhas || []).forEach(function(l) {
        var c = microConforme(l);
        if (!texto(l.resultado)) pendentes.push('Micro: ' + texto(l.analise));
        else if (c === false) impedimentos.push(texto(l.analise) + ': ' + texto(l.resultado));
      });
    }
    return {pendentes: pendentes, impedimentos: impedimentos, completo: !pendentes.length, bloqueia: impedimentos.length > 0};
  }

  // O que vai gravado no laudo (sem campos de tela, só o documento).
  function registro(fq, micro) {
    var m = micro || {};
    return {
      fq: (fq || []).filter(function(l) { return texto(l.parametro); }).map(function(l) {
        return {parametro: texto(l.parametro), especificacao: texto(l.especificacao), metodo: texto(l.metodo),
          resultado: texto(l.resultado), origem: l.origem === 'bulk' ? 'bulk' : 'laudo'};
      }),
      micro: m.realizada === false
        ? {realizada: false, justificativa: texto(m.justificativa, 1000)}
        : {realizada: true, laboratorio: texto(m.laboratorio), laudoExterno: texto(m.laudoExterno),
            linhas: (m.linhas || []).map(function(l) {
              return {analise: texto(l.analise), metodo: texto(l.metodo), especificacao: texto(l.especificacao),
                resultado: texto(l.resultado)};
            })}
    };
  }

  return {
    FQ_PADRAO: FQ_PADRAO, MICRO_PADRAO: MICRO_PADRAO,
    fqInicial: fqInicial, microInicial: microInicial, microConforme: microConforme,
    avaliar: avaliar, registro: registro
  };
});
