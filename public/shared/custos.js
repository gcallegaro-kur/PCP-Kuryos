/* Motor de custo de produto — funções PURAS.
 *
 * Nada aqui lê banco, escreve banco ou toca no DOM. Recebe dado, devolve
 * número com procedência. É o mesmo padrão do motor de MRP em utils.js e do
 * `calcularCustoItemCotacao`, pelo mesmo motivo: custo errado sai plausível,
 * então tem que dar pra testar a conta isolada da tela.
 *
 * A REGRA QUE MANDA EM TUDO AQUI: material sem preço nunca vale zero.
 * Zero não deixa a ficha incompleta, deixa a ficha BARATA -- e a margem sai
 * alta, errada e convincente. Mesma disciplina do balde BACKLOG do MRP: o
 * buraco aparece, não some. Toda função devolve `completo`, `semCusto[]` e a
 * procedência de cada linha; quem chama decide se pode mostrar o número.
 *
 * Ver PLANO_CUSTOS.md para o porquê de cada decisão.
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Custos = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // Procedência de um número de custo. Carimbada linha a linha, porque uma
  // ficha misturando preço pago e preço-alvo sem dizer qual é qual vale menos
  // que ficha nenhuma.
  var PROCEDENCIA = {
    PAGO: 'PAGO',            // preço efetivamente pago num Pedido de Compra
    COTADO: 'COTADO',        // proposta de fornecedor, ainda não comprada
    MANUAL: 'MANUAL',        // digitado por alguém, sem documento por trás
    ESTIMADO: 'ESTIMADO',    // derivado (ex.: tempo de batelada por faixa de massa)
    SEM_CUSTO: 'SEM_CUSTO'   // não existe preço -- NUNCA vira zero
  };

  // Natureza de custo. Vem do prefixo do código do material, que é a mesma
  // taxonomia de TIPO_LABELS em cadastros.html. Existe aqui por um motivo
  // específico: é o "plano de contas gerencial" mínimo. Qualquer financeiro
  // que a Kuryos comprar depois vai pedir para onde cada real foi -- e o
  // mapeamento fica trivial se a natureza já estiver carimbada na origem.
  var NATUREZA = {
    MPGR: 'MATERIA_PRIMA',
    MPES: 'MATERIA_PRIMA',
    EP: 'EMBALAGEM',
    ES: 'EMBALAGEM',
    ET: 'EMBALAGEM',
    MU: 'USO_E_CONSUMO'
  };

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function norm(c) { return String(c == null ? '' : c).trim().toUpperCase(); }
  function un(u) { return String(u == null ? '' : u).trim().toUpperCase(); }

  function naturezaDoMaterial(material) {
    var t = norm(material && material.tipo);
    if (NATUREZA[t]) return NATUREZA[t];
    var cod = norm(material && material.mpCodigo);
    var pref = cod.split('-')[0];
    return NATUREZA[pref] || 'OUTROS';
  }

  /* Índice código -> {key, material}. O cadastro é chaveado por uma key
     sanitizada, mas fórmula e BOM referenciam pelo `mpCodigo`. Medido em
     produção: 841 itens de fórmula têm código e os 841 existem no cadastro,
     então o índice por código é confiável -- mas a função devolve `null` em
     vez de chutar quando não acha. */
  function indexarMateriais(materiais) {
    var idx = {};
    Object.keys(materiais || {}).forEach(function(key) {
      var m = materiais[key];
      if (!m) return;
      var cod = norm(m.mpCodigo);
      if (cod) idx[cod] = { key: key, material: m };
    });
    return idx;
  }

  /* Preço de um material, na unidade em que o material é cadastrado.
     `precos` é o nó `custos_precos` chaveado pela MESMA key do cadastro de
     materiais -- e não pelo mpCodigo, porque a key é o que não muda quando
     alguém corrige o código. */
  function precoDoMaterial(codigo, idx, precos) {
    var cod = norm(codigo);
    var achado = idx[cod];
    if (!achado) {
      return { valor: null, fonte: PROCEDENCIA.SEM_CUSTO, motivo: 'material não existe no cadastro', codigo: cod };
    }
    var p = (precos || {})[achado.key];
    if (!p || !(num(p.valor) > 0)) {
      return { valor: null, fonte: PROCEDENCIA.SEM_CUSTO, motivo: 'sem preço cadastrado',
        codigo: cod, key: achado.key, material: achado.material };
    }
    return {
      valor: num(p.valor),
      // A unidade do PREÇO é a unidade do cadastro do material salvo se quem
      // digitou disse outra coisa. Guardar as duas separadas é o que impede o
      // erro de 11,67x que o motor de cotação já documentou: aplicar fator de
      // conversão onde a unidade já era a mesma.
      unidade: un(p.unidade || achado.material.unidade),
      fonte: p.fonte || PROCEDENCIA.MANUAL,
      ref: p.ref || null,
      codigo: cod, key: achado.key, material: achado.material
    };
  }

  /* Converte um preço para R$/kg. Só aceita o que é convertível SEM
     suposição: kg direto, g por 1000. Litro/ml exigiriam a densidade do
     próprio material (existe em 8 de 911 cadastros) -- sem ela a conversão é
     um chute, e um chute aqui vira custo de fórmula inteiro errado. */
  function precoPorKg(preco) {
    if (!preco || preco.valor == null) return { valor: null, motivo: 'sem preço' };
    var u = un(preco.unidade);
    if (u === 'KG') return { valor: preco.valor };
    if (u === 'G') return { valor: preco.valor * 1000 };
    if (u === 'L' || u === 'ML') {
      var d = num(preco.material && preco.material.densidade);
      if (!(d > 0)) return { valor: null, motivo: 'preço em ' + u + ' e material sem densidade cadastrada' };
      // R$/L ÷ (kg/L) = R$/kg ; ml converte pra litro antes.
      var porLitro = u === 'ML' ? preco.valor * 1000 : preco.valor;
      return { valor: porLitro / d };
    }
    return { valor: null, motivo: 'preço em "' + (preco.unidade || '—') + '", que não converte para kg' };
  }

  /* Custo de UM QUILO de fórmula.
     A fórmula é % m/m, então este número NÃO depende de densidade nenhuma --
     densidade só entra depois, para ir de kg para unidade envasada. Medido:
     densidade existe em 6 de 377 produtos, então desacoplar os dois é o que
     permite entregar custo de fórmula hoje em vez de esperar 371 cadastros. */
  function custoPorKgFormula(formula, idx, precos) {
    var itens = Object.keys(((formula || {}).itens) || {}).map(function(k) { return formula.itens[k]; });
    var linhas = [], semCusto = [], incompativeis = [];
    var custo = 0, pctComPreco = 0, pctTotal = 0;

    itens.forEach(function(it) {
      var pct = num(it.percentualMM);
      pctTotal += pct;
      var preco = precoDoMaterial(it.mpCodigo, idx, precos);
      var porKg = precoPorKg(preco);
      var linha = {
        codigo: norm(it.mpCodigo), nome: it.mpNome || null, fase: it.fase || null,
        percentualMM: pct, precoPorKg: porKg.valor,
        custoNoKg: porKg.valor != null ? (pct / 100) * porKg.valor : null,
        fonte: porKg.valor != null ? preco.fonte : PROCEDENCIA.SEM_CUSTO,
        natureza: preco.material ? naturezaDoMaterial(preco.material) : null,
        motivo: porKg.valor != null ? null : (porKg.motivo || preco.motivo)
      };
      linhas.push(linha);
      if (linha.custoNoKg != null) { custo += linha.custoNoKg; pctComPreco += pct; }
      else if (preco.valor != null) incompativeis.push(linha);
      else semCusto.push(linha);
    });

    return {
      // `custoPorKg` é o custo da PARTE conhecida, e por isso vem sempre
      // junto de `completo` e de `pctCobertoMM` -- a tela não pode exibir um
      // sem os outros.
      //
      // NULL, e não 0, quando NADA foi precificado. Devolver 0 aqui foi um
      // bug real, pego pelo harness da tela contra a base de produção: com a
      // base sem nenhum preço, granel 0 + embalagem 0 davam um
      // `custoMaterialPorPeca` de R$ 0,00 que a ficha exibia como total. É
      // exatamente o "sem preço virou zero" que este módulo existe para
      // impedir, e os testes sintéticos não pegaram porque toda fixture
      // parcial tinha pelo menos um item com preço.
      custoPorKg: (itens.length && pctComPreco > 0) ? custo : null,
      completo: itens.length > 0 && semCusto.length === 0 && incompativeis.length === 0,
      pctCobertoMM: pctTotal > 0 ? (pctComPreco / pctTotal) * 100 : 0,
      somaPercentual: pctTotal,
      linhas: linhas, semCusto: semCusto, incompativeis: incompativeis
    };
  }

  /* Massa de granel em UMA peça, em kg.
     Mesma matemática de explodirMateriaisNecessarios() em utils.js -- volume
     nominal, overfill, perda de processo e densidade. Repetida aqui em vez de
     importada porque este módulo é standalone (roda em Node no teste sem
     carregar os 254 KB do utils.js); se as duas divergirem, utils.js é a
     referência.

     Densidade ausente ou -1 devolve `ok: false` com motivo, NUNCA um número.
     O marcador -1 de cadastros importados já gerou consumo negativo de
     fórmula uma vez (ver baixarEstoqueConsumo em form.html). */
  function massaGranelPorPeca(produto) {
    var p = produto || {};
    var vol = num(p.volume);
    var unidadeVol = String(p.unidadeVolume || 'ml').toLowerCase();
    var litros;
    if (unidadeVol === 'ml') litros = vol / 1000;
    else if (unidadeVol === 'l') litros = vol;
    else return { ok: false, kg: null, motivo: 'unidade de volume "' + (p.unidadeVolume || '—') + '" não reconhecida' };
    if (!(litros > 0)) return { ok: false, kg: null, motivo: 'produto sem volume nominal' };

    var densidade = num(p.densidadeGranel);
    if (!(densidade > 0)) return { ok: false, kg: null, motivo: 'produto sem densidade de granel cadastrada' };

    var overfill = num(p.overfillPct);
    var perda = num(p.perdaProcessoPct);
    var volumeFinalL = litros * (1 + overfill / 100);
    var volumeGranelL = volumeFinalL * (1 + perda / 100);
    return { ok: true, kg: volumeGranelL * densidade, volumeGranelL: volumeGranelL, densidade: densidade };
  }

  /* Custo de embalagem por peça, a partir do BOM.
     `qtdPorPeca` está na unidade do próprio material, e o preço também --
     então aqui a multiplicação é direta e NÃO há conversão. Se um dia
     aparecer preço numa unidade diferente da do cadastro, a linha vai para
     `incompativeis` em vez de ser multiplicada assim mesmo. */
  function custoEmbalagemPorPeca(bomVersao, idx, precos) {
    var itens = Object.keys(((bomVersao || {}).itens) || {}).map(function(k) { return bomVersao.itens[k]; });
    var linhas = [], semCusto = [], incompativeis = [];
    var custo = 0, custeadas = 0;

    itens.forEach(function(it) {
      var qtd = num(it.qtdPorPeca);
      var preco = precoDoMaterial(it.materialCodigo, idx, precos);
      var unidadeCadastro = un(preco.material && preco.material.unidade);
      var mesmaUnidade = !preco.unidade || !unidadeCadastro || preco.unidade === unidadeCadastro;
      var podeCustear = preco.valor != null && mesmaUnidade && qtd > 0;
      var linha = {
        codigo: norm(it.materialCodigo), nome: it.materialNome || null,
        qtdPorPeca: qtd, unidade: unidadeCadastro || null,
        precoUnitario: preco.valor, custoNaPeca: podeCustear ? qtd * preco.valor : null,
        fonte: podeCustear ? preco.fonte : PROCEDENCIA.SEM_CUSTO,
        natureza: preco.material ? naturezaDoMaterial(preco.material) : null,
        motivo: podeCustear ? null
          : (preco.valor == null ? preco.motivo
            : (!mesmaUnidade ? 'preço em ' + preco.unidade + ' e cadastro em ' + unidadeCadastro
              : 'BOM sem quantidade por peça'))
      };
      linhas.push(linha);
      if (linha.custoNaPeca != null) { custo += linha.custoNaPeca; custeadas++; }
      else if (preco.valor != null) incompativeis.push(linha);
      else semCusto.push(linha);
    });

    return {
      // Mesma regra do granel: null quando nenhuma linha foi custeada. Zero
      // aqui vira "embalagem de graça" somada a um total plausível.
      custoPorPeca: (itens.length && custeadas > 0) ? custo : null,
      completo: itens.length > 0 && semCusto.length === 0 && incompativeis.length === 0,
      linhasCusteadas: custeadas,
      linhas: linhas, semCusto: semCusto, incompativeis: incompativeis
    };
  }

  /* Ficha de custo de um produto.
   *
   * `taxaConversao` é OPCIONAL de propósito: o custo de conversão (folha +
   * custo fixo rateado por hora-padrão) entra como camada separada e plugável,
   * para que o rateio possa ser desenhado depois sem reescrever a ficha.
   * Sem ela, `custoUnitario` é null e `custoMaterialPorPeca` continua válido --
   * a ficha diz o que sabe e o que não sabe, em vez de fingir um total.
   *
   * taxaConversao esperada: { custoHoraPadrao, procedencia }
   * prodHoraRef vem do produto (peças/hora) -- medido em 321 de 377 produtos.
   */
  function fichaCustoProduto(args) {
    var a = args || {};
    var produto = a.produto || {};
    var idx = a.idxMateriais || {};
    var precos = a.precos || {};

    var granelKg = custoPorKgFormula(a.formula, idx, precos);
    var massa = massaGranelPorPeca(produto);
    var granelPorPeca = (granelKg.custoPorKg != null && massa.ok) ? granelKg.custoPorKg * massa.kg : null;
    var embalagem = custoEmbalagemPorPeca(a.bom, idx, precos);

    var avisos = [];
    if (!massa.ok) avisos.push('Granel por unidade indisponível: ' + massa.motivo + '. O custo por kg da fórmula continua válido.');
    if (granelKg.somaPercentual > 0 && (granelKg.somaPercentual < 99 || granelKg.somaPercentual > 101)) {
      avisos.push('Fórmula soma ' + (Math.round(granelKg.somaPercentual * 10) / 10) + '% em vez de 100%.');
    }
    if (!a.formula && !a.bom) avisos.push('Produto sem fórmula e sem BOM cadastrados.');

    // Conversão: horas-padrão da peça x custo da hora-padrão. A base é
    // prodHoraRef e NUNCA a duração da OP -- medido em produção, duração de OP
    // é tempo de calendário e dá 123% a 243% de ocupação (ver PLANO_CUSTOS.md).
    var conversao = null;
    var taxa = a.taxaConversao;
    var prodHora = num(produto.prodHoraRef);
    if (taxa && num(taxa.custoHoraPadrao) > 0) {
      if (prodHora > 0) {
        conversao = {
          horasPorPeca: 1 / prodHora,
          custoPorPeca: num(taxa.custoHoraPadrao) / prodHora,
          custoHoraPadrao: num(taxa.custoHoraPadrao),
          fonte: taxa.procedencia || PROCEDENCIA.ESTIMADO
        };
      } else {
        avisos.push('Conversão não calculada: produto sem prodHoraRef.');
      }
    }

    var materialCompleto = granelKg.completo && embalagem.completo && massa.ok;
    // TOTAL só existe quando NADA falta. Somar granel parcial com embalagem
    // parcial produz um número que parece total, é sempre menor que o
    // verdadeiro, e vira margem alta e falsa -- o erro mais caro que uma
    // ficha de custo pode cometer. As partes seguem disponíveis em
    // `granel.custoPorPeca` e `embalagem.custoPorPeca` para quem quiser
    // mostrar o parcial COM o aviso de incompleto ao lado.
    var custoMaterialPorPeca = materialCompleto
      ? granelPorPeca + embalagem.custoPorPeca : null;
    var custoUnitario = (custoMaterialPorPeca != null && conversao)
      ? custoMaterialPorPeca + conversao.custoPorPeca : null;

    var semCusto = granelKg.semCusto.concat(embalagem.semCusto).map(function(l) { return l.codigo; });

    return {
      sku: produto.sku || a.sku || null,
      competencia: a.competencia || null,
      granel: {
        custoPorKg: granelKg.custoPorKg, custoPorPeca: granelPorPeca,
        massaKgPorPeca: massa.ok ? massa.kg : null,
        completo: granelKg.completo, pctCobertoMM: granelKg.pctCobertoMM,
        linhas: granelKg.linhas, semCusto: granelKg.semCusto, incompativeis: granelKg.incompativeis
      },
      embalagem: embalagem,
      conversao: conversao,
      custoMaterialPorPeca: custoMaterialPorPeca,
      custoUnitario: custoUnitario,
      // `completo` exige material E conversão. Ficha sem conversão é ficha de
      // material, não custo do produto -- e a tela precisa dizer isso.
      completo: materialCompleto && !!conversao,
      materialCompleto: materialCompleto,
      semCusto: semCusto,
      avisos: avisos
    };
  }

  /* Fila de cadastro de preço ordenada por EXPOSIÇÃO.
   *
   * Exposição = quantas unidades produzidas no período dependem daquele
   * material. É o que transforma "preencher 911 materiais" em "preencher 83":
   * medido na base, 83 materiais cobrem 80% da exposição de 12 meses.
   *
   * Devolve a fila já com o ganho marginal de cada preço, para a tela poder
   * dizer "digite este e você cobre mais 6%".
   */
  function filaPrecosPorExposicao(args) {
    var a = args || {};
    var volPorSku = a.volumePorSku || {};
    var formulaPorSku = a.formulaPorSku || {};
    var bomPorSku = a.bomPorSku || {};
    var idx = a.idxMateriais || {};
    var precos = a.precos || {};

    var exposicao = {};
    function somar(codigo, qtd) {
      var cod = norm(codigo);
      if (!cod || !idx[cod]) return;
      exposicao[cod] = (exposicao[cod] || 0) + qtd;
    }
    Object.keys(volPorSku).forEach(function(sku) {
      var q = num(volPorSku[sku]);
      if (!(q > 0)) return;
      var f = formulaPorSku[norm(sku)];
      if (f) Object.keys(f.itens || {}).forEach(function(k) { somar(f.itens[k].mpCodigo, q); });
      var b = bomPorSku[norm(sku)];
      if (b) Object.keys(b.itens || {}).forEach(function(k) { somar(b.itens[k].materialCodigo, q); });
    });

    var total = Object.keys(exposicao).reduce(function(s, c) { return s + exposicao[c]; }, 0);
    var fila = Object.keys(exposicao).map(function(cod) {
      var achado = idx[cod];
      var p = precoDoMaterial(cod, idx, precos);
      return {
        codigo: cod,
        nome: achado.material.mpNome || null,
        tipo: achado.material.tipo || null,
        natureza: naturezaDoMaterial(achado.material),
        unidade: un(achado.material.unidade) || null,
        key: achado.key,
        exposicao: exposicao[cod],
        exposicaoPct: total > 0 ? (exposicao[cod] / total) * 100 : 0,
        temPreco: p.valor != null,
        fonte: p.valor != null ? p.fonte : PROCEDENCIA.SEM_CUSTO
      };
    }).sort(function(x, y) { return y.exposicao - x.exposicao; });

    // Acumulado sobre a fila INTEIRA (com e sem preço), porque o que interessa
    // é "quanto do universo eu cubro se descer até aqui", não a posição
    // relativa entre os que faltam.
    var acc = 0;
    fila.forEach(function(f) { acc += f.exposicaoPct; f.acumuladoPct = acc; });

    var cobertos = fila.filter(function(f) { return f.temPreco; });
    return {
      fila: fila,
      pendentes: fila.filter(function(f) { return !f.temPreco; }),
      totalMateriais: fila.length,
      comPreco: cobertos.length,
      coberturaPct: cobertos.reduce(function(s, f) { return s + f.exposicaoPct; }, 0)
    };
  }

  /* Quantos materiais faltam para cobrir X% da exposição. É o número que
     torna o cadastro um plano em vez de um mutirão. */
  function materiaisParaCobrir(fila, alvoPct) {
    var acc = 0, i = 0;
    while (i < fila.length && acc < alvoPct) { acc += fila[i].exposicaoPct; i++; }
    return i;
  }

  /* Plano de cadastro de preço orientado a FICHA FECHADA.
   *
   * Por que existe, e por que a fila por exposição não basta: uma ficha só
   * fecha quando TODOS os materiais daquele SKU têm preço. Medido na base
   * real: os 83 materiais que cobrem 80% da exposição fecham apenas 9 SKUs,
   * 29,5% do volume -- porque cada SKU tem uma cauda de material raro que
   * mora lá no fim da fila por exposição. Ordenar por exposição otimiza a
   * métrica errada.
   *
   * Aqui a ordenação é gulosa por VOLUME DESBLOQUEADO POR PREÇO DIGITADO:
   * a cada rodada escolhe o SKU com melhor razão volume/preços-faltantes,
   * e os preços que ele adiciona barateiam os SKUs seguintes (material
   * compartilhado já fica pago). É o mesmo raciocínio de set cover.
   */
  function planoCadastroPorSku(args) {
    var a = args || {};
    var volPorSku = a.volumePorSku || {};
    var formulaPorSku = a.formulaPorSku || {};
    var bomPorSku = a.bomPorSku || {};
    var idx = a.idxMateriais || {};
    var precos = a.precos || {};

    // Materiais exigidos por SKU, só os que existem no cadastro (nos órfãos
    // não dá para cadastrar preço -- são problema de cadastro, não de fila).
    var exigidos = {}, orfaosPorSku = {};
    Object.keys(volPorSku).forEach(function(skuBruto) {
      var sku = norm(skuBruto);
      var set = {}, orfaos = [];
      function juntar(codigo) {
        var cod = norm(codigo);
        if (!cod) return;
        if (idx[cod]) set[cod] = true; else orfaos.push(cod);
      }
      var f = formulaPorSku[sku];
      if (f) Object.keys(f.itens || {}).forEach(function(k) { juntar(f.itens[k].mpCodigo); });
      var b = bomPorSku[sku];
      if (b) Object.keys(b.itens || {}).forEach(function(k) { juntar(b.itens[k].materialCodigo); });
      if (f || b) { exigidos[sku] = Object.keys(set); orfaosPorSku[sku] = orfaos; }
    });

    var volumeTotal = Object.keys(volPorSku).reduce(function(s, k) { return s + num(volPorSku[k]); }, 0);

    // Já pagos: o que tem preço hoje.
    var pago = {};
    Object.keys(idx).forEach(function(cod) {
      if (precoDoMaterial(cod, idx, precos).valor != null) pago[cod] = true;
    });

    var restantes = Object.keys(exigidos).filter(function(sku) {
      // SKU com órfão nunca fecha por cadastro de preço -- sai do plano e é
      // reportado à parte, senão o plano prometeria um fechamento impossível.
      return orfaosPorSku[sku].length === 0 && exigidos[sku].length > 0;
    });
    var bloqueados = Object.keys(exigidos).filter(function(sku) { return orfaosPorSku[sku].length > 0; })
      .map(function(sku) {
        return { sku: sku, volume: num(volPorSku[sku]), orfaos: orfaosPorSku[sku] };
      }).sort(function(x, y) { return y.volume - x.volume; });

    var sequencia = [], marcos = [], skusFechados = [];
    var volumeCoberto = 0;
    var guarda = 0;

    while (restantes.length && guarda++ < 5000) {
      var melhor = null;
      restantes.forEach(function(sku) {
        var faltam = exigidos[sku].filter(function(c) { return !pago[c]; });
        var vol = num(volPorSku[sku]);
        // Custo 0 = já está fechado: ganho infinito, entra primeiro.
        var ganho = faltam.length === 0 ? Infinity : vol / faltam.length;
        if (!melhor || ganho > melhor.ganho || (ganho === melhor.ganho && vol > melhor.volume)) {
          melhor = { sku: sku, volume: vol, faltam: faltam, ganho: ganho };
        }
      });
      if (!melhor) break;

      melhor.faltam.forEach(function(cod) {
        pago[cod] = true;
        var m = idx[cod].material;
        sequencia.push({
          codigo: cod, key: idx[cod].key, nome: m.mpNome || null,
          tipo: m.tipo || null, unidade: un(m.unidade) || null,
          natureza: naturezaDoMaterial(m),
          desbloqueouSku: melhor.sku
        });
      });
      volumeCoberto += melhor.volume;
      skusFechados.push({ sku: melhor.sku, volume: melhor.volume, precosNovos: melhor.faltam.length });
      marcos.push({
        precos: sequencia.length,
        skusCompletos: skusFechados.length,
        volumeCobertoPct: volumeTotal > 0 ? (volumeCoberto / volumeTotal) * 100 : 0
      });
      restantes = restantes.filter(function(s) { return s !== melhor.sku; });
    }

    return {
      sequencia: sequencia,
      skusFechados: skusFechados,
      marcos: marcos,
      bloqueadosPorCadastro: bloqueados,
      volumeTotal: volumeTotal,
      precosNecessarios: sequencia.length
    };
  }

  /* Quantos preços para fechar X% do volume, segundo o plano por SKU. */
  function precosParaVolume(marcos, alvoPct) {
    for (var i = 0; i < marcos.length; i++) {
      if (marcos[i].volumeCobertoPct >= alvoPct) return marcos[i].precos;
    }
    return marcos.length ? marcos[marcos.length - 1].precos : 0;
  }

  return {
    PROCEDENCIA: PROCEDENCIA,
    NATUREZA: NATUREZA,
    naturezaDoMaterial: naturezaDoMaterial,
    indexarMateriais: indexarMateriais,
    precoDoMaterial: precoDoMaterial,
    precoPorKg: precoPorKg,
    custoPorKgFormula: custoPorKgFormula,
    massaGranelPorPeca: massaGranelPorPeca,
    custoEmbalagemPorPeca: custoEmbalagemPorPeca,
    fichaCustoProduto: fichaCustoProduto,
    filaPrecosPorExposicao: filaPrecosPorExposicao,
    materiaisParaCobrir: materiaisParaCobrir,
    planoCadastroPorSku: planoCadastroPorSku,
    precosParaVolume: precosParaVolume
  };
});
