/* CK-7 — Inspeção de Produto Acabado (liberação de palete).

   Achado do usuário (2026-09-17): a fila de PA abria o plano de inspeção do
   GRANEL (aspecto, cor, odor, pH, densidade, teor de álcool) para liberar um
   palete. São os 211 registros de `especificacoes`, importados do Gerador de
   OPs -- análise de tacho, que a inspetora não tem como fazer diante de um
   palete pronto. E nada perguntava sobre o que importa no produto acabado:
   rótulo, impressão de lote e validade, vedação, peso e caixa.

   Este módulo é o roteiro do produto acabado. A análise de granel continua
   existindo, no lugar dela (fase de manipulação do mesmo lote).

   Regras vindas da spec do CQ (ERP_Kuryos_Modulo_CQ v1.1) e dos comentários
   da Qualidade da Kuryos na revisão de 17/09:
   - amostragem √N+1 sobre o total de CAIXAS do palete, tirando de topo, meio
     e fundo ("pode seguir regra de raiz de n + 1", Qualidade);
   - peso/volume individual por unidade amostrada, com média e mínimo contra
     o nominal; tolerância de -3% (INMETRO). Envase manual tem deriva, então
     a média sozinha esconde unidade fora da faixa;
   - torquímetro NÃO é usado hoje ("não usamos", Qualidade): a vedação é
     verificada à mão e o torque medido só aparece quando o parâmetro do
     produto liga, para quando houver instrumento calibrado;
   - retenção de PA: validade + 1 ano ("geralmente +1 ano após vencido, com
     FQ uma vez ao ano -- shelf life", Qualidade), não os 6 meses da spec.

   Defeito CRÍTICO bloqueia a liberação -- rótulo errado, lote ilegível ou
   vazamento não são desvio negociável: viram retenção ou retrabalho. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InspecaoPA = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var TOLERANCIA_PADRAO = 3; // -3% INMETRO
  var RETENCAO_MESES_APOS_VALIDADE = 12;

  /* Quantas unidades entram na PESAGEM. Não se confunde com a amostragem
     de ASPECTO (√N+1 sobre as CAIXAS do palete, acima): o Relatório de
     Análise oficial da Kuryos diz, em duas linhas seguidas, "Amostragem
     Aspecto: √N + 1" e "Análise de Peso: 32 amostras". A tela seguia a
     amostragem de caixas também pra pesagem, e a inspetora acabava com 4 ou
     5 campos onde o laudo pede 32.

     32 é o PADRÃO, não um teto: o usuário pediu a quantidade em aberto
     (2026-09-21), porque lote pequeno não justifica 32 pesagens e lote
     problemático pede mais. Quem define é quem está com a balança na mão. */
  var UNIDADES_PESAGEM_PADRAO = 32;

  /* Lista de pesos com o tamanho pedido, preservando o que já foi digitado.
     Encolher descarta do fim pra frente -- é a única ordem que não embaralha
     a numeração das unidades já pesadas. */
  function redimensionarPesos(pesos, quantidade) {
    var atual = Array.isArray(pesos) ? pesos.slice() : [];
    var alvo = Math.max(Math.floor(n(quantidade) || 0), 0);
    while (atual.length > alvo) atual.pop();
    while (atual.length < alvo) atual.push(null);
    return atual;
  }

  // Roteiro padrão: igual para todos os SKUs. O que varia por produto são os
  // PARÂMETROS (conteúdo nominal, unidades por caixa, códigos de barras).
  var PLANO_PADRAO = [
    {id: 'op_encerrada', secao: 'Identificação', texto: 'OP encerrada e quantidade do palete confere com a conferência', severidade: 'CRITICO'},
    {id: 'produto_variante', secao: 'Identificação', texto: 'Produto e variante conferem com a OP', severidade: 'CRITICO'},
    {id: 'lote_validade_op', secao: 'Identificação', texto: 'Lote e validade impressos conferem com a OP', severidade: 'CRITICO'},

    {id: 'palete_integro', secao: 'Palete', texto: 'Palete íntegro, bem montado e estável', severidade: 'MAIOR'},
    {id: 'palete_filme', secao: 'Palete', texto: 'Filme aplicado corretamente', severidade: 'MENOR'},
    {id: 'palete_etiqueta', secao: 'Palete', texto: 'Etiqueta do palete presente e legível', severidade: 'MAIOR'},

    {id: 'rotulo_correto', secao: 'Unidade (amostra)', texto: 'Rótulo correto para a variante', severidade: 'CRITICO'},
    {id: 'rotulo_aplicacao', secao: 'Unidade (amostra)', texto: 'Rótulo alinhado e aderido, sem bolhas, rasgos ou sujidade', severidade: 'MAIOR'},
    {id: 'impressao_legivel', secao: 'Unidade (amostra)', texto: 'Impressão de lote e validade legível na unidade', severidade: 'CRITICO'},
    {id: 'ean_produto', secao: 'Unidade (amostra)', texto: 'Código de barras do produto confere e é lido', severidade: 'MAIOR', mostraParametro: 'eanProduto'},
    {id: 'tampa_valvula', secao: 'Unidade (amostra)', texto: 'Tampa e válvula montadas e funcionando', severidade: 'CRITICO'},
    {id: 'vedacao', secao: 'Unidade (amostra)', texto: 'Vedação: sem vazamento com o frasco deitado', severidade: 'CRITICO'},
    {id: 'torque', secao: 'Unidade (amostra)', texto: 'Torque de fechamento medido', severidade: 'MAIOR', tipo: 'NUMERO', exigeParametro: 'torqueAtivo',
      ajuda: 'Só aparece quando o produto tiver torque especificado e houver torquímetro calibrado.'},
    {id: 'frasco_limpo', secao: 'Unidade (amostra)', texto: 'Frasco limpo, sem resíduo de produto ou cola', severidade: 'MENOR'},
    {id: 'aspecto_produto', secao: 'Unidade (amostra)', texto: 'Aspecto do produto no frasco: cor, limpidez e ausência de partículas', severidade: 'MAIOR'},

    {id: 'caixa_correta', secao: 'Caixa', texto: 'Caixa master correta para o produto', severidade: 'MAIOR'},
    {id: 'ean_caixa', secao: 'Caixa', texto: 'Código de barras da caixa confere', severidade: 'MENOR', mostraParametro: 'eanCaixa'},
    {id: 'qtd_por_caixa', secao: 'Caixa', texto: 'Quantidade por caixa confere com a especificação', severidade: 'CRITICO', mostraParametro: 'unidadesPorCaixa'},
    {id: 'identificacao_caixa', secao: 'Caixa', texto: 'Identificação da caixa: produto, lote, validade e quantidade', severidade: 'MAIOR'},
    {id: 'fechamento_caixa', secao: 'Caixa', texto: 'Fechamento e fita adequados', severidade: 'MENOR'},

    {id: 'retencao', secao: 'Retenção', texto: 'Amostra de retenção coletada e identificada', severidade: 'MAIOR'}
  ];

  function n(v) { var x = Number(v); return isFinite(x) ? x : null; }
  function arred(v, casas) { var f = Math.pow(10, casas == null ? 3 : casas); return Math.round(Number(v) * f) / f; }

  /* Amostragem √N+1 sobre as caixas do palete (regra confirmada pela
     Qualidade). Palete pequeno nunca pede mais caixas do que tem; palete de
     1 caixa é a própria caixa. */
  function amostragem(caixas) {
    var N = Math.max(Math.floor(n(caixas) || 0), 0);
    if (!N) return {caixas: 0, amostra: 0, posicoes: [], texto: 'Palete sem caixas fechadas informadas.'};
    var nAmostra = Math.min(Math.ceil(Math.sqrt(N)) + 1, N);
    var posicoes = nAmostra >= 3 ? ['Topo', 'Meio', 'Fundo'] : (nAmostra === 2 ? ['Topo', 'Fundo'] : ['Meio']);
    return {
      caixas: N, amostra: nAmostra, posicoes: posicoes,
      texto: nAmostra + ' de ' + N + ' caixa(s) — √N+1, distribuídas em ' + posicoes.join(', ').toLowerCase()
    };
  }

  // Parâmetros do produto (parametros_pa/{sku}), com defaults seguros.
  function parametros(registro) {
    var p = registro || {};
    return {
      conteudoNominal: n(p.conteudoNominal),
      unidadeMedida: p.unidadeMedida || 'g',
      unidadesPorCaixa: n(p.unidadesPorCaixa),
      eanProduto: p.eanProduto || '',
      eanCaixa: p.eanCaixa || '',
      toleranciaPct: n(p.toleranciaPct) != null ? n(p.toleranciaPct) : TOLERANCIA_PADRAO,
      torqueAtivo: p.torqueAtivo === true,
      torqueMin: n(p.torqueMin), torqueMax: n(p.torqueMax)
    };
  }
  function faltamParametros(par) {
    var falta = [];
    if (par.conteudoNominal == null) falta.push('conteúdo nominal');
    if (par.unidadesPorCaixa == null) falta.push('unidades por caixa');
    return falta;
  }

  /* Pesagem individual. Média abaixo do nominal reprova (conteúdo líquido
     médio); unidade abaixo de nominal-tolerância reprova (unidade isolada
     fora do limite INMETRO). Acima do nominal não reprova: é doação. */
  function avaliarPesos(pesos, par) {
    var lista = (pesos || []).map(n).filter(function(v) { return v != null && v > 0; });
    var nominal = par.conteudoNominal;
    var limite = nominal != null ? arred(nominal * (1 - par.toleranciaPct / 100)) : null;
    if (!lista.length) {
      return {n: 0, media: null, minimo: null, maximo: null, limiteIndividual: limite, foraLimite: [], mediaAbaixo: false, conforme: null, pendente: true};
    }
    var soma = lista.reduce(function(s, v) { return s + v; }, 0);
    var media = arred(soma / lista.length);
    var minimo = Math.min.apply(null, lista), maximo = Math.max.apply(null, lista);
    var foraLimite = limite != null ? lista.filter(function(v) { return v < limite; }) : [];
    var mediaAbaixo = nominal != null && media < nominal;
    return {
      n: lista.length, media: media, minimo: minimo, maximo: maximo, limiteIndividual: limite,
      foraLimite: foraLimite, mediaAbaixo: mediaAbaixo, pendente: false,
      conforme: nominal == null ? null : (!mediaAbaixo && !foraLimite.length)
    };
  }

  // Itens do plano que valem para este produto (torque só quando ligado).
  function itensAplicaveis(par) {
    return PLANO_PADRAO.filter(function(i) { return !i.exigeParametro || par[i.exigeParametro] === true; });
  }

  /* respostas: {itemId: {cnc: 'C'|'NC'|'NA', valor?, observacao?}}
     Retorna as linhas prontas para a tela e o veredito. */
  function avaliar(respostas, pesos, parametrosRegistro, opts) {
    var par = parametros(parametrosRegistro);
    var o = opts || {};
    var linhas = itensAplicaveis(par).map(function(item) {
      var r = (respostas || {})[item.id] || {};
      var cnc = r.cnc || '';
      var valor = r.valor === '' || r.valor == null ? null : n(r.valor);
      var conforme = cnc === 'C' ? true : cnc === 'NC' ? false : null;
      var motivo = '';
      if (item.tipo === 'NUMERO' && valor != null && (par.torqueMin != null || par.torqueMax != null)) {
        var fora = (par.torqueMin != null && valor < par.torqueMin) || (par.torqueMax != null && valor > par.torqueMax);
        if (fora) { conforme = false; motivo = 'Fora da faixa especificada.'; }
        else if (cnc !== 'NC') { conforme = true; }
      }
      return {
        id: item.id, secao: item.secao, texto: item.texto, severidade: item.severidade,
        tipo: item.tipo || 'CNC', ajuda: item.ajuda || null,
        referencia: item.mostraParametro ? par[item.mostraParametro] : null,
        cnc: cnc, valor: valor, observacao: r.observacao || '', conforme: conforme, motivo: motivo
      };
    });

    var pesagem = avaliarPesos(pesos, par);
    var naoConformes = linhas.filter(function(l) { return l.conforme === false; });
    var criticosNC = naoConformes.filter(function(l) { return l.severidade === 'CRITICO'; });
    var pendentes = linhas.filter(function(l) { return l.conforme == null && l.cnc !== 'NA'; });
    var naoAplicaveis = linhas.filter(function(l) { return l.cnc === 'NA'; });
    var amostra = amostragem(o.caixas);
    var falta = faltamParametros(par);

    var impedimentos = [];
    if (criticosNC.length) impedimentos.push(criticosNC.length + ' item(ns) crítico(s) não conforme(s)');
    if (pesagem.conforme === false) {
      impedimentos.push(pesagem.mediaAbaixo
        ? 'média de peso abaixo do nominal'
        : pesagem.foraLimite.length + ' unidade(s) abaixo do limite de ' + pesagem.limiteIndividual + par.unidadeMedida);
    }

    return {
      parametros: par, faltamParametros: falta, linhas: linhas, amostragem: amostra, pesagem: pesagem,
      conformes: linhas.filter(function(l) { return l.conforme === true; }).length,
      naoConformes: naoConformes.length, criticosNC: criticosNC.length,
      pendentes: pendentes.length, naoAplicaveis: naoAplicaveis.length,
      maiorNC: naoConformes.filter(function(l) { return l.severidade === 'MAIOR'; }).length,
      menorNC: naoConformes.filter(function(l) { return l.severidade === 'MENOR'; }).length,
      // Crítico e peso fora travam a liberação. O resto é decisão da inspetora.
      bloqueia: impedimentos.length > 0, impedimentos: impedimentos,
      completo: !pendentes.length && !pesagem.pendente,
      classificacaoRnc: criticosNC.length ? 'CRITICA' : (naoConformes.filter(function(l) { return l.severidade === 'MAIOR'; }).length ? 'MAIOR' : 'MENOR')
    };
  }

  // Retenção de PA: validade + 12 meses (Qualidade, 17/09).
  function prazoRetencao(dataValidade) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dataValidade || ''))) return null;
    var p = String(dataValidade).split('-');
    var d = new Date(Date.UTC(+p[0] + Math.floor(RETENCAO_MESES_APOS_VALIDADE / 12), +p[1] - 1 + (RETENCAO_MESES_APOS_VALIDADE % 12), +p[2]));
    return d.toISOString().slice(0, 10);
  }

  // O que fica gravado no laudo (registro de análise do palete).
  function registro(aval, extras) {
    var e = extras || {};
    var itens = {};
    aval.linhas.forEach(function(l) {
      itens[l.id] = {texto: l.texto, secao: l.secao, severidade: l.severidade, cnc: l.cnc || null,
        valor: l.valor, conforme: l.conforme, observacao: l.observacao || null};
    });
    return {
      versaoPlano: 'CK7-2026-09',
      itens: itens,
      amostragem: {caixasPalete: aval.amostragem.caixas, caixasAmostradas: aval.amostragem.amostra, regra: '√N+1', posicoes: aval.amostragem.posicoes},
      pesagem: {
        unidades: aval.pesagem.n, pesos: (e.pesos || []).map(n).filter(function(v) { return v != null && v > 0; }),
        media: aval.pesagem.media, minimo: aval.pesagem.minimo, maximo: aval.pesagem.maximo,
        nominal: aval.parametros.conteudoNominal, unidade: aval.parametros.unidadeMedida,
        toleranciaPct: aval.parametros.toleranciaPct, limiteIndividual: aval.pesagem.limiteIndividual,
        conforme: aval.pesagem.conforme
      },
      retencao: {unidades: n(e.retencaoUnidades), local: e.retencaoLocal || null, guardarAte: prazoRetencao(e.dataValidade)},
      laboratorio: e.laboratorio || null,
      resumo: aval.conformes + 'C / ' + aval.naoConformes + 'NC / ' + aval.pendentes + ' pend.' +
        (aval.naoAplicaveis ? ' / ' + aval.naoAplicaveis + ' NA' : ''),
      criticosNC: aval.criticosNC, impedimentos: aval.impedimentos
    };
  }

  return {
    PLANO_PADRAO: PLANO_PADRAO, TOLERANCIA_PADRAO: TOLERANCIA_PADRAO,
    RETENCAO_MESES_APOS_VALIDADE: RETENCAO_MESES_APOS_VALIDADE,
    UNIDADES_PESAGEM_PADRAO: UNIDADES_PESAGEM_PADRAO, redimensionarPesos: redimensionarPesos,
    amostragem: amostragem, parametros: parametros, faltamParametros: faltamParametros,
    avaliarPesos: avaliarPesos, itensAplicaveis: itensAplicaveis, avaliar: avaliar,
    prazoRetencao: prazoRetencao, registro: registro
  };
});
