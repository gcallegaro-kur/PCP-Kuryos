/* DADOS OBRIGATÓRIOS PARA EMITIR NF (2026-10-23)

   Pedido do usuário: "na emissão de nf, para conseguir emitir corretamente,
   precisamos ter a data de fabricação e validade do lote, como informação
   obrigatória, além das quantidades de caixas totais, caixas parciais, sku e
   peso". Motor puro: a tela e a function passam o que leram.

   O QUE ESTAVA ERRADO, medido na solicitação real de 23/10 (carga Miss Rose,
   3 itens, NF 012): SKU, lote, caixas, caixa parcial e peso saíam certos;
   a validade saía VAZIA nos três e a data de fabricação não existia.

   RAIZ DA VALIDADE VAZIA: o código lia `lote.validade`. O campo no banco é
   `dataValidade` -- o nome que estoque.html, kardex.html, descarte.html,
   estoque_setor.html e conteudo-posicao.js usam. `lote.validade` existia em
   0 dos 176 lotes. O mesmo nome errado estava na trava "Palete vencido" e na
   ordenação FEFO de expedicao.js/expedicao_regras.js -- ou seja, nada impedia
   expedir vencido. Corrigido no mesmo commit.

   FABRICAÇÃO NÃO SE DIGITA: a regra já existia no laudo de CQ
   (qualidade.html) e está reproduzida aqui -- fim real da OP; sem ela, a
   emissão. NUNCA "hoje": a data de fabricação do lote não é a data em que
   alguém pediu o faturamento. Medido: cobertura de 100% nos 99 lotes de PA.

   VALIDADE tem duas fontes, nesta ordem: `lote.dataValidade` (o que o lote
   declara vence) e, na falta, fabricação + `produto.prazoValidadeMeses`.
   Medido em 23/10: cobertura de 60%, porque 19 dos 35 SKUs com lote em
   estoque não têm prazo de validade no cadastro. Por decisão do usuário a
   falta TRAVA a solicitação e aponta o cadastro do SKU -- é lá que o dado
   nasce, e preenchido uma vez serve a todo lote futuro daquele produto.

   Cada data carrega a ORIGEM (`origens`), para uma auditoria saber se veio do
   lote, da OP ou de cálculo. Dado fiscal sem procedência não se defende. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DadosNF = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function texto(v) { return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v)); }
  /* Só a data, sem hora. A OP grava ISO com hora; a NF quer o dia. */
  function dia(v) {
    var s = texto(v).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  /* Soma meses sem escorregar de fuso: ancora ao meio-dia UTC. Dia 31 em mês
     de 30 cai no dia 1 do mês seguinte, que é o comportamento do JS -- aceito,
     porque validade é prazo comercial, não vencimento contratual ao dia. */
  function somarMeses(iso, meses) {
    var base = dia(iso), m = n(meses);
    if (!base || m <= 0) return '';
    var d = new Date(base + 'T12:00:00Z');
    if (isNaN(d.getTime())) return '';
    d.setUTCMonth(d.getUTCMonth() + m);
    return d.toISOString().slice(0, 10);
  }

  /* Onde cada falta se corrige. A mensagem tem de dizer o lugar, senão o
     bloqueio é um beco sem saída -- a mesma lição do "Acesso Negado" que
     passou a nomear o módulo que falta. */
  var ONDE = {
    SKU: 'O lote não tem código de item. Confira o lote na Conferência de PA.',
    FABRICACAO: 'Sem data de fabricação: o lote não a tem gravada e a OP não tem fim real nem emissão. Encerre a OP ou grave a data no lote.',
    VALIDADE: 'Cadastros › Produtos › este SKU › "Prazo de validade (meses)". Preenchido uma vez, vale para todo lote futuro deste produto.',
    VALIDADE_SEM_FAB: 'A validade depende da fabricação, que também está faltando.',
    CAIXAS: 'O lote não tem a contagem de caixas fechadas. Confira o lote na Conferência de PA.',
    UNIDADES_CAIXA: 'Sem unidades por caixa: grave no lote (Conferência de PA) ou em Cadastros › Produtos › "Unidades por caixa".',
    PESO: 'Sem peso: Cadastros › Produtos › este SKU › "Kg por caixa". Ou grave o peso total no lote.'
  };

  /* ctx = {lote, op, produto, quantidade}
     `quantidade` é o que vai nesta carga (pode ser menos que o lote inteiro).
     Devolve os campos da NF + `origens` + `faltas`. */
  function derivar(ctx) {
    var c = ctx || {}, lote = c.lote || {}, op = c.op || {}, produto = c.produto || {};
    var origens = {}, faltas = [];

    var sku = texto(lote.itemCodigo) || texto(c.sku);
    if (sku) origens.sku = lote.itemCodigo ? 'lote' : 'carga';

    // ── Fabricação: lote, senão a OP. Nunca hoje. ──────────────────────
    var fabricacao = dia(lote.dataFabricacao);
    if (fabricacao) origens.dataFabricacao = 'lote';
    else {
      fabricacao = dia(op.dataFimReal);
      if (fabricacao) origens.dataFabricacao = 'OP (fim real)';
      else {
        fabricacao = dia(op.dataEmissao);
        if (fabricacao) origens.dataFabricacao = 'OP (emissão)';
        else {
          fabricacao = dia(op.dataInicioReal);
          if (fabricacao) origens.dataFabricacao = 'OP (início real)';
        }
      }
    }

    // ── Validade: o que o lote declara, senão fabricação + prazo ───────
    var validade = dia(lote.dataValidade);
    if (validade) origens.validade = 'lote';
    else {
      validade = somarMeses(fabricacao, produto.prazoValidadeMeses);
      if (validade) origens.validade = 'fabricação + ' + n(produto.prazoValidadeMeses) + ' meses do cadastro';
    }

    // ── Caixas ─────────────────────────────────────────────────────────
    var unidades = c.quantidade === undefined ? n(lote.saldoLote) : n(c.quantidade);
    var unidadesPorCaixa = n(lote.unidadesPorCaixa) || n(produto.unCx) || n(produto.unidadesPorCaixa);
    if (unidadesPorCaixa) origens.unidadesPorCaixa = n(lote.unidadesPorCaixa) ? 'lote' : 'cadastro do produto';

    /* `caixasFechadas` e `unidadesCaixaParcial` descrevem o LOTE inteiro.
       Quando a carga leva o lote todo, valem direto. Quando leva parte, a
       quebra tem de sair da quantidade embarcada -- senão a NF declara as
       caixas do lote e expede outra coisa. */
    var loteInteiro = n(lote.saldoLote) === 0 || unidades >= n(lote.qtdOriginal) || unidades >= n(lote.saldoLote);
    var temContagem = lote.caixasFechadas !== undefined && lote.caixasFechadas !== null;
    var caixasFechadas, unidadesCaixaParcial;
    if (loteInteiro && temContagem) {
      caixasFechadas = n(lote.caixasFechadas);
      unidadesCaixaParcial = n(lote.unidadesCaixaParcial);
      origens.caixas = 'contagem do lote';
    } else if (unidadesPorCaixa) {
      caixasFechadas = Math.floor(unidades / unidadesPorCaixa);
      unidadesCaixaParcial = unidades - caixasFechadas * unidadesPorCaixa;
      origens.caixas = 'calculado da quantidade embarcada';
    } else {
      caixasFechadas = temContagem ? n(lote.caixasFechadas) : null;
      unidadesCaixaParcial = n(lote.unidadesCaixaParcial);
      if (caixasFechadas !== null) origens.caixas = 'contagem do lote';
    }
    var caixasParciais = unidadesCaixaParcial > 0 ? 1 : 0;
    var volumes = (caixasFechadas || 0) + caixasParciais;

    // ── Peso ───────────────────────────────────────────────────────────
    /* Mantém a conta que já estava em produção: a caixa parcial conta como um
       VOLUME cheio de peso. Superestima (medido em 23/10: 444,6 kg onde o
       proporcional daria 436,8). Não mudei por conta própria -- é número
       declarado em nota fiscal, e `kgCaixa` pode ser peso bruto da caixa
       fechada, caso em que o proporcional subestimaria a embalagem.
       Registrado em MELHORIAS_FUTURAS.md para o usuário decidir. */
    var kgPorCaixa = n(lote.pesoPorCaixaKg) || n(produto.kgCaixa);
    var pesoKg = n(lote.pesoTotalKg);
    if (pesoKg) origens.pesoKg = 'lote';
    else if (kgPorCaixa && volumes) {
      pesoKg = Math.round(volumes * kgPorCaixa * 1000) / 1000;
      origens.pesoKg = (n(lote.pesoPorCaixaKg) ? 'lote' : 'cadastro') + ': ' + volumes + ' volume(s) x ' + kgPorCaixa + ' kg';
    }

    // ── O que falta ────────────────────────────────────────────────────
    if (!sku) faltas.push({campo: 'sku', rotulo: 'SKU', onde: ONDE.SKU});
    if (!fabricacao) faltas.push({campo: 'dataFabricacao', rotulo: 'Data de fabricação', onde: ONDE.FABRICACAO});
    if (!validade) {
      faltas.push({campo: 'validade', rotulo: 'Validade',
        onde: fabricacao ? ONDE.VALIDADE : ONDE.VALIDADE_SEM_FAB, sku: sku});
    }
    if (caixasFechadas === null) faltas.push({campo: 'caixasFechadas', rotulo: 'Caixas fechadas', onde: ONDE.CAIXAS});
    if (!unidadesPorCaixa) faltas.push({campo: 'unidadesPorCaixa', rotulo: 'Unidades por caixa', onde: ONDE.UNIDADES_CAIXA, sku: sku});
    if (!pesoKg) faltas.push({campo: 'pesoKg', rotulo: 'Peso', onde: ONDE.PESO, sku: sku});

    return {
      sku: sku,
      lote: texto(lote.opLote) || texto(lote.loteOrigem) || '',
      dataFabricacao: fabricacao,
      validade: validade,
      caixasFechadas: caixasFechadas === null ? 0 : caixasFechadas,
      unidadesCaixaParcial: unidadesCaixaParcial,
      caixasParciais: caixasParciais,
      volumes: volumes,
      unidadesPorCaixa: unidadesPorCaixa,
      unidades: unidades,
      pesoKg: pesoKg,
      origens: origens,
      faltas: faltas,
      completo: faltas.length === 0
    };
  }

  /* Vencido pelo campo CERTO. Era `lote.validade`, que não existe -- por isso
     a trava nunca disparou. Aceita os dois nomes para não depender de qual
     tela gravou o lote. */
  function validadeDoLote(lote) {
    var l = lote || {};
    return dia(l.dataValidade) || dia(l.validade) || '';
  }
  function vencido(lote, hoje) {
    var v = validadeDoLote(lote);
    return !!v && !!dia(hoje) && v < dia(hoje);
  }

  /* A carga inteira: o que sai na NF e o que impede de solicitar.
     paletes = [{itemKey, loteKey, quantidade, sku, identificadorPalete}]
     base = {estoque_lotes, ops, produtos} */
  function validarCarga(paletes, base, hoje) {
    var b = base || {}, lotes = b.estoque_lotes || {}, ops = b.ops || {}, produtos = b.produtos || {};
    var porSku = {};
    Object.keys(produtos).forEach(function(k) {
      var p = produtos[k];
      if (p && p.sku) porSku[p.sku] = p;
    });
    var itens = (paletes || []).map(function(ap) {
      var lote = ((lotes[ap.itemKey] || {})[ap.loteKey]) || {};
      var op = lote.opKey && ops[lote.opKey] ? ops[lote.opKey] : null;
      if (!op && lote.opLote) {
        var k = Object.keys(ops).find(function(x) { return ops[x] && ops[x].lote === lote.opLote; });
        op = k ? ops[k] : null;
      }
      var sku = texto(lote.itemCodigo) || texto(ap.sku);
      var produto = porSku[sku] || produtos[sku] || {};
      var d = derivar({lote: lote, op: op, produto: produto, quantidade: ap.quantidade, sku: sku});
      return Object.assign({
        itemKey: ap.itemKey, loteKey: ap.loteKey,
        identificadorPalete: texto(lote.identificadorPalete) || texto(ap.identificadorPalete) || ap.loteKey,
        vencido: vencido(lote, hoje)
      }, d);
    });
    var pendencias = itens.filter(function(i) { return i.faltas.length; });
    // Agrupado por SKU: 12 paletes do mesmo produto são UM cadastro a corrigir,
    // não 12 problemas. É o que torna o bloqueio acionável.
    var porSkuFalta = {};
    pendencias.forEach(function(i) {
      i.faltas.forEach(function(f) {
        if (!f.sku) return;
        var ch = f.sku + '|' + f.campo;
        if (!porSkuFalta[ch]) porSkuFalta[ch] = {sku: f.sku, campo: f.campo, rotulo: f.rotulo, onde: f.onde, paletes: []};
        porSkuFalta[ch].paletes.push(i.identificadorPalete);
      });
    });
    return {
      itens: itens,
      pendencias: pendencias,
      porCadastro: Object.keys(porSkuFalta).map(function(k) { return porSkuFalta[k]; })
        .sort(function(a, b) { return a.sku.localeCompare(b.sku) || a.campo.localeCompare(b.campo); }),
      vencidos: itens.filter(function(i) { return i.vencido; }),
      ok: pendencias.length === 0,
      totalPesoKg: Math.round(itens.reduce(function(t, i) { return t + n(i.pesoKg); }, 0) * 1000) / 1000,
      totalVolumes: itens.reduce(function(t, i) { return t + n(i.volumes); }, 0),
      totalUnidades: itens.reduce(function(t, i) { return t + n(i.unidades); }, 0)
    };
  }

  /* Fila de cadastro: quais SKUs com lote em estoque vão travar faturamento.
     Serve para o ADM/PCP corrigir ANTES de alguém bater no bloqueio no
     balcão -- com a decisão de travar, avisar antes deixa de ser cortesia. */
  function skusAConfigurar(base) {
    var b = base || {}, lotes = b.estoque_lotes || {}, produtos = b.produtos || {};
    var porSku = {};
    Object.keys(produtos).forEach(function(k) {
      var p = produtos[k];
      if (p && p.sku) porSku[p.sku] = p;
    });
    var achados = {};
    Object.keys(lotes).forEach(function(item) {
      var filhos = lotes[item] || {};
      Object.keys(filhos).forEach(function(lk) {
        var l = filhos[lk];
        if (!l || typeof l !== 'object') return;
        if (!(n(l.saldoLote) > 0)) return;            // só o que ainda pode sair
        if (!l.opLote && !l.opKey) return;            // PA de OP, não material recebido
        var sku = texto(l.itemCodigo);
        if (!sku) return;
        var p = porSku[sku] || produtos[sku] || {};
        var faltam = [];
        if (!n(p.prazoValidadeMeses) && !dia(l.dataValidade)) faltam.push('prazo de validade');
        if (!n(p.kgCaixa) && !n(l.pesoPorCaixaKg) && !n(l.pesoTotalKg)) faltam.push('kg por caixa');
        if (!faltam.length) return;
        if (!achados[sku]) achados[sku] = {sku: sku, descricao: texto(l.itemNome), faltam: faltam, lotes: 0, unidades: 0};
        achados[sku].lotes++;
        achados[sku].unidades += n(l.saldoLote);
      });
    });
    return Object.keys(achados).map(function(k) { return achados[k]; })
      .sort(function(a, b) { return b.unidades - a.unidades || a.sku.localeCompare(b.sku); });
  }

  return {
    derivar: derivar,
    validarCarga: validarCarga,
    validadeDoLote: validadeDoLote,
    vencido: vencido,
    skusAConfigurar: skusAConfigurar,
    somarMeses: somarMeses
  };
});
