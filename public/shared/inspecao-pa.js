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

  /* PESAGEM PELAS REGRAS DO INMETRO (decisão do usuário, 25/09: "seguir
     todas as regras necessárias e vigentes"). Pré-medido de conteúdo
     nominal igual: Portaria INMETRO 249/2021 -- mesma base da OIML R87.
     Três critérios, todos obrigatórios para aprovar o lote:
       1. média:      x̄ >= Qn − k·s
       2. individual: no máximo c unidades abaixo de Qn − T (c do plano)
       3. nenhuma unidade abaixo de Qn − 2T
     T é a tolerância individual da tabela da Portaria, por faixa de Qn --
     não um percentual único. Os −3% fixos que a tela usava só valem entre
     300 e 500 g/ml; em 200 ml o INMETRO admite 9 ml, em 50 ml, 4,5 ml.

     PRODUTO DECLARADO EM ml: o INMETRO mede volume pela massa líquida
     dividida pela densidade. A inspetora pesa em gramas (balança tarada com
     a embalagem vazia -- confirmado pelo usuário), então nominal, T e 2T
     são convertidos para gramas pela densidade do lote. Antes a tela
     comparava 170 g de perfume (0,85 g/ml) com "200" e reprovava tudo -- e
     um creme de 1,05 passava mesmo com falta. */
  var TABELA_TOLERANCIA = [ // [Qn até, tipo, valor]; faixas se encontram nos limites
    [50, 'PCT', 9], [100, 'ABS', 4.5], [200, 'PCT', 4.5], [300, 'ABS', 9],
    [500, 'PCT', 3], [1000, 'ABS', 15], [10000, 'PCT', 1.5], [15000, 'ABS', 150],
    [50000, 'PCT', 1]
  ];
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

  /* CRITÉRIO DA MÉDIA (decisão do usuário, 23/09): até então a média tinha
     de ser >= nominal, sem tolerância nenhuma, enquanto a tela só mostrava o
     -3% da unidade -- média de 197 g num nominal de 200 g bloqueava e parecia
     erro. Agora vale o critério do INMETRO para pré-medidos (Portaria
     249/2021, mesmo da OIML R87): x̄ >= Qn - k·s, com s o desvio-padrão da
     amostra e k = t(99,5%; n-1) / √n. É a fórmula por trás da tabela da
     Portaria (n=5: 2,059; 13: 0,847; 20: 0,640; 32: 0,485; 80: 0,295), então
     vale para qualquer quantidade que a inspetora pesar. */
  var T_995 = [null, 63.657, 9.925, 5.841, 4.604, 4.032, 3.707, 3.499, 3.355, 3.250, 3.169,
    3.106, 3.055, 3.012, 2.977, 2.947, 2.921, 2.898, 2.878, 2.861, 2.845,
    2.831, 2.819, 2.807, 2.797, 2.787, 2.779, 2.771, 2.763, 2.756, 2.750];
  var T_995_LONGE = [[30, 2.750], [40, 2.704], [50, 2.678], [60, 2.660], [80, 2.639], [120, 2.617], [1e9, 2.576]];
  function t995(gl) {
    if (!(gl >= 1)) return null;
    if (gl <= 30) return T_995[Math.floor(gl)];
    for (var i = 1; i < T_995_LONGE.length; i++) {
      var a = T_995_LONGE[i - 1], b = T_995_LONGE[i];
      if (gl <= b[0]) return b[0] >= 1e9 ? b[1] : a[1] + (b[1] - a[1]) * (gl - a[0]) / (b[0] - a[0]);
    }
    return 2.576;
  }
  function kInmetro(nAmostra) {
    var t = t995(nAmostra - 1);
    return t == null ? null : Math.round(t / Math.sqrt(nAmostra) * 1000) / 1000;
  }

  // Tolerância individual T (mesma unidade de Qn). Percentual é arredondado
  // PARA CIMA ao décimo, como manda a Portaria.
  function toleranciaInmetro(qn) {
    var q = n(qn);
    if (!(q > 0) || q > 50000) return null;
    for (var i = 0; i < TABELA_TOLERANCIA.length; i++) {
      var f = TABELA_TOLERANCIA[i];
      if (q <= f[0]) return f[1] === 'ABS' ? f[2] : Math.ceil(arred(q * f[2] / 100, 6) * 10) / 10;
    }
    return null;
  }

  /* Plano de amostragem do INMETRO por tamanho do lote: n unidades e c,
     quantas podem ficar abaixo de Qn − T. A inspetora pode pesar outra
     quantidade (21/09: "quantidade em aberto"); o c usado é o do maior
     plano que a amostra pesada cobre -- nunca mais tolerante do que o
     plano que ela de fato cumpriu. */
  var PLANO_INMETRO = [
    {loteAte: 50, n: 5, c: 0}, {loteAte: 149, n: 13, c: 1}, {loteAte: 4000, n: 20, c: 1},
    {loteAte: 10000, n: 32, c: 2}, {loteAte: Infinity, n: 80, c: 5}
  ];
  function planoPorLote(tamanhoLote) {
    var N = Math.floor(n(tamanhoLote) || 0);
    if (N <= 0) return null;
    for (var i = 0; i < PLANO_INMETRO.length; i++) {
      var p = PLANO_INMETRO[i];
      if (N <= p.loteAte) return {lote: N, n: Math.min(p.n, N), c: p.c, k: kInmetro(Math.min(p.n, N))};
    }
    return null;
  }
  function aceitacaoPorAmostra(nPesado) {
    var c = 0;
    PLANO_INMETRO.forEach(function(p) { if (nPesado >= p.n) c = p.c; });
    return c;
  }

  /* Densidade usada na pesagem de produto em ml. Ordem decidida com o
     usuário (25/09): a medida na hora do laudo (nova amostragem) vence a da
     análise do bulk do mesmo lote, que vence a do cadastro -- cadastro é
     valor de projeto, não medida do lote, e só serve de último recurso. */
  var ORIGENS_DENSIDADE = {LAUDO: 'medida no laudo', BULK: 'análise do bulk do lote', CADASTRO: 'cadastro do produto'};
  function densidadeValida(v) {
    var x = n(typeof v === 'string' ? v.trim().replace(',', '.') : v);
    return x != null && x >= 0.3 && x <= 3 ? x : null;
  }
  function densidadeParaPesagem(fontes) {
    var f = fontes || {};
    var ordem = [['LAUDO', f.laudo], ['BULK', f.bulk], ['CADASTRO', f.cadastro]];
    for (var i = 0; i < ordem.length; i++) {
      if (ordem[i][1] === '' || ordem[i][1] == null) continue;
      var v = densidadeValida(ordem[i][1]);
      if (v != null) return {valor: v, origem: ordem[i][0], texto: ORIGENS_DENSIDADE[ordem[i][0]]};
    }
    return {valor: null, origem: null, texto: null};
  }
  // Densidade apontada na análise físico-química do bulk (ensaio "Densidade").
  function densidadeDoBulk(ensaios) {
    var achada = null;
    Object.keys(ensaios || {}).forEach(function(k) {
      var e = ensaios[k] || {};
      if (achada == null && /densidade/i.test(String(e.ensaio || k))) achada = densidadeValida(e.valor);
    });
    return achada;
  }

  /* Pesagem individual, sempre em GRAMAS de conteúdo líquido. Produto em
     ml converte nominal, T e 2T pela densidade; sem densidade não há como
     julgar e a pesagem fica `semDensidade` -- a tela pede a medida em vez
     de adivinhar. Abaixo de 5 unidades (a menor amostra do plano do
     INMETRO) k explode -- n=2 dá k=45 e qualquer média passaria --, então
     a média tem de ser >= nominal e a tela pede mais pesagens. Acima do
     nominal não reprova: é doação. */
  var N_MIN_CRITERIO_MEDIA = 5;
  function avaliarPesos(pesos, par, densidade) {
    var lista = (pesos || []).map(n).filter(function(v) { return v != null && v > 0; });
    var qn = par.conteudoNominal;
    var emVolume = String(par.unidadeMedida || '').toLowerCase() === 'ml';
    var dens = emVolume && densidade ? densidadeValida(densidade.valor) : null;
    var fator = emVolume ? dens : 1;
    var T = toleranciaInmetro(qn);
    var r = {
      unidadeDeclarada: emVolume ? 'ml' : 'g', nominalDeclarado: qn, tolerancia: T,
      densidade: dens, origemDensidade: dens ? (densidade.origem || null) : null,
      semDensidade: emVolume && qn != null && !dens,
      nominal: null, toleranciaMassa: null, limiteIndividual: null, limiteT2: null,
      n: lista.length, media: null, minimo: null, maximo: null, limiteMedia: null, desvioPadrao: null, k: null,
      c: aceitacaoPorAmostra(lista.length), foraLimite: [], abaixoT2: [], mediaAbaixo: false,
      conforme: null, pendente: !lista.length
    };
    if (qn != null && fator && T != null) {
      r.nominal = arred(qn * fator);
      r.toleranciaMassa = arred(T * fator);
      r.limiteIndividual = arred(qn * fator - T * fator);
      r.limiteT2 = arred(qn * fator - 2 * T * fator);
    }
    if (!lista.length) return r;
    var soma = lista.reduce(function(acc, v) { return acc + v; }, 0);
    r.media = arred(soma / lista.length);
    r.minimo = Math.min.apply(null, lista);
    r.maximo = Math.max.apply(null, lista);
    var s = null;
    if (lista.length >= N_MIN_CRITERIO_MEDIA) {
      var m = soma / lista.length;
      s = Math.sqrt(lista.reduce(function(acc, v) { return acc + (v - m) * (v - m); }, 0) / (lista.length - 1));
      r.k = kInmetro(lista.length);
      r.desvioPadrao = arred(s);
    }
    if (r.nominal == null) return r;
    r.limiteMedia = arred(r.k != null ? r.nominal - r.k * s : r.nominal);
    r.foraLimite = lista.filter(function(v) { return v < r.limiteIndividual; });
    r.abaixoT2 = lista.filter(function(v) { return v < r.limiteT2; });
    r.mediaAbaixo = r.media < r.limiteMedia;
    r.conforme = !r.mediaAbaixo && r.foraLimite.length <= r.c && !r.abaixoT2.length;
    return r;
  }

  // Itens do plano que valem para este produto (torque só quando ligado).
  function itensAplicaveis(par) {
    return PLANO_PADRAO.filter(function(i) { return !i.exigeParametro || par[i.exigeParametro] === true; });
  }

  /* respostas: {itemId: {cnc: 'C'|'NC'|'NA', valor?, observacao?}}
     Retorna as linhas prontas para a tela e o veredito. */
  // opts: {caixas, densidade: {valor, origem}, tamanhoLote}
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

    var pesagem = avaliarPesos(pesos, par, o.densidade);
    var plano = planoPorLote(o.tamanhoLote);
    var naoConformes = linhas.filter(function(l) { return l.conforme === false; });
    var criticosNC = naoConformes.filter(function(l) { return l.severidade === 'CRITICO'; });
    var pendentes = linhas.filter(function(l) { return l.conforme == null && l.cnc !== 'NA'; });
    var naoAplicaveis = linhas.filter(function(l) { return l.cnc === 'NA'; });
    var amostra = amostragem(o.caixas);
    var falta = faltamParametros(par);
    var avisos = [];
    if (pesagem.origemDensidade === 'CADASTRO') avisos.push('densidade do cadastro, não medida neste lote — meça a densidade da amostra e informe no laudo');
    if (plano && !pesagem.pendente && pesagem.n < plano.n) avisos.push('o plano do INMETRO para lote de ' + plano.lote + ' unidades pede ' + plano.n + ' pesagens (há ' + pesagem.n + ')');

    var impedimentos = [];
    if (criticosNC.length) impedimentos.push(criticosNC.length + ' item(ns) crítico(s) não conforme(s)');
    if (pesagem.semDensidade && !pesagem.pendente) {
      impedimentos.push('produto declarado em ml sem densidade do lote — informe a densidade medida para converter o peso');
    }
    if (pesagem.conforme === false) {
      if (pesagem.mediaAbaixo) {
        impedimentos.push('média de peso ' + pesagem.media + 'g abaixo do mínimo para a média (' + pesagem.limiteMedia + 'g' +
          (pesagem.k != null ? ' = nominal − k·s, INMETRO' : ' = nominal; com menos de ' + N_MIN_CRITERIO_MEDIA + ' unidades não se aplica o critério do INMETRO — pese mais') + ')');
      }
      if (pesagem.abaixoT2.length) {
        impedimentos.push(pesagem.abaixoT2.length + ' unidade(s) abaixo de ' + pesagem.limiteT2 + ' g (nominal − 2T): o INMETRO não admite nenhuma');
      }
      if (pesagem.foraLimite.length > pesagem.c) {
        impedimentos.push(pesagem.foraLimite.length + ' unidade(s) abaixo de ' + pesagem.limiteIndividual +
          ' g (nominal − T); com ' + pesagem.n + ' pesagens o INMETRO admite ' + pesagem.c);
      }
    }

    return {
      parametros: par, faltamParametros: falta, linhas: linhas, amostragem: amostra, pesagem: pesagem,
      planoPesagem: plano, avisos: avisos,
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
      versaoPlano: 'CK7-2026-09b',
      itens: itens,
      amostragem: {caixasPalete: aval.amostragem.caixas, caixasAmostradas: aval.amostragem.amostra, regra: '√N+1', posicoes: aval.amostragem.posicoes},
      pesagem: {
        unidades: aval.pesagem.n, pesos: (e.pesos || []).map(n).filter(function(v) { return v != null && v > 0; }),
        media: aval.pesagem.media, minimo: aval.pesagem.minimo, maximo: aval.pesagem.maximo,
        // Pesos, média e limites em GRAMAS de conteúdo líquido. `nominal` é
        // o nominal em gramas (convertido pela densidade quando declarado em
        // ml); o do rótulo fica em nominalDeclarado/unidadeDeclarada.
        unidade: 'g', nominal: aval.pesagem.nominal,
        nominalDeclarado: aval.pesagem.nominalDeclarado, unidadeDeclarada: aval.pesagem.unidadeDeclarada,
        densidade: aval.pesagem.densidade, origemDensidade: aval.pesagem.origemDensidade,
        tolerancia: aval.pesagem.tolerancia, toleranciaMassa: aval.pesagem.toleranciaMassa,
        limiteIndividual: aval.pesagem.limiteIndividual, limiteT2: aval.pesagem.limiteT2,
        limiteMedia: aval.pesagem.limiteMedia, desvioPadrao: aval.pesagem.desvioPadrao, k: aval.pesagem.k,
        c: aval.pesagem.c, foraLimite: aval.pesagem.foraLimite.length, abaixoT2: aval.pesagem.abaixoT2.length,
        planoLote: aval.planoPesagem || null,
        criterio: 'Portaria INMETRO 249/2021: x̄ >= Qn - k·s; no máximo c abaixo de Qn - T; nenhuma abaixo de Qn - 2T',
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
    PLANO_PADRAO: PLANO_PADRAO,
    toleranciaInmetro: toleranciaInmetro, planoPorLote: planoPorLote, aceitacaoPorAmostra: aceitacaoPorAmostra,
    densidadeParaPesagem: densidadeParaPesagem, densidadeDoBulk: densidadeDoBulk, densidadeValida: densidadeValida,
    kInmetro: kInmetro, N_MIN_CRITERIO_MEDIA: N_MIN_CRITERIO_MEDIA,
    RETENCAO_MESES_APOS_VALIDADE: RETENCAO_MESES_APOS_VALIDADE,
    UNIDADES_PESAGEM_PADRAO: UNIDADES_PESAGEM_PADRAO, redimensionarPesos: redimensionarPesos,
    amostragem: amostragem, parametros: parametros, faltamParametros: faltamParametros,
    avaliarPesos: avaliarPesos, itensAplicaveis: itensAplicaveis, avaliar: avaliar,
    prazoRetencao: prazoRetencao, registro: registro
  };
});
