/* Exportação dos cadastros para planilha (pedido do usuário, 15/10/2026:
   "exportar cadastros, lista de produtos, fórmulas e BOMs ... comparar ... vou
   ter que ajustar muita coisa, queria ajustar em lote").

   Funções puras: montar(base) devolve as abas {nome, colunas, linhas}; quem
   desenha o arquivo (cadastros.html) só entrega isso à lib de planilha.

   Desenho para AJUSTE EM LOTE:
   - uma linha por ITEM de fórmula / BOM / especificação (formato "longo"), com
     as chaves do banco nas primeiras colunas (chave, item). Quem for importar
     de volta localiza o registro pela chave — por isso essas colunas não
     devem ser editadas;
   - as colunas com prefixo "cad_" são só leitura: trazem o que o cadastro de
     materiais diz sobre o código usado (nome, tipo, ativo), para comparar a
     fórmula/BOM com o cadastro lado a lado;
   - a aba "Conferência" lista o que a comparação já achou de errado. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExportarCadastros = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function txt(v) { return v == null ? '' : String(v); }
  function norm(s) { return txt(s).toUpperCase().replace(/\s+/g, ' ').trim(); }
  function obj(v) { return v && typeof v === 'object' ? v : {}; }
  function ehMapaDeObjetos(v) {
    var ks = Object.keys(v);
    return ks.length > 0 && ks.every(function(k) { return v[k] && typeof v[k] === 'object'; });
  }

  /* Achata um registro em {coluna: valor escalar}. Objeto simples vira
     "pai_filho"; lista vira texto com " | "; mapa de objetos (fornecedores de
     um material, contatos de um cliente) vira um texto legível. */
  function achatar(registro, prefixo, saida) {
    saida = saida || {};
    Object.keys(obj(registro)).forEach(function(k) {
      var v = registro[k], col = prefixo ? prefixo + '_' + k : k;
      if (v == null) { saida[col] = ''; return; }
      if (Array.isArray(v)) {
        saida[col] = v.map(function(x) { return x && typeof x === 'object' ? JSON.stringify(x) : txt(x); }).join(' | ');
      } else if (typeof v === 'object') {
        if (ehMapaDeObjetos(v)) {
          saida[col] = Object.keys(v).map(function(c) {
            var o = v[c];
            return c + ': ' + Object.keys(o).filter(function(f) { return o[f] !== '' && o[f] != null; })
              .map(function(f) { return typeof o[f] === 'object' ? f + '=' + JSON.stringify(o[f]) : f + '=' + o[f]; }).join(', ');
          }).join(' | ');
        } else achatar(v, col, saida);
      } else if (typeof v === 'boolean') saida[col] = v ? 'SIM' : 'NÃO';
      else saida[col] = v;
    });
    return saida;
  }

  /* Colunas: as de `prioridade` primeiro (se existirem), depois as demais em
     ordem alfabética — registros diferentes têm campos diferentes e nada pode
     ficar de fora da exportação. */
  function aba(nome, registros, prioridade, extras) {
    var set = {}, linhasObj = registros.map(function(r) {
      var o = r.dados;
      Object.keys(o).forEach(function(c) { set[c] = true; });
      return o;
    });
    var cols = (prioridade || []).filter(function(c) { return set[c]; });
    Object.keys(set).sort().forEach(function(c) { if (cols.indexOf(c) < 0) cols.push(c); });
    return {
      nome: nome, colunas: cols,
      linhas: linhasObj.map(function(o) { return cols.map(function(c) { return o[c] == null ? '' : o[c]; }); })
    };
  }

  function montar(base) {
    base = base || {};
    var produtos = obj(base.produtos), materiais = obj(base.materiais), clientes = obj(base.clientes);
    var fornecedores = obj(base.fornecedores), formulas = obj(base.formulas), boms = obj(base.bom);
    var specs = obj(base.especificacoes);

    var materialPorCod = {};
    Object.keys(materiais).forEach(function(k) {
      var m = materiais[k] || {};
      materialPorCod[m.mpCodigo || k] = m;
    });
    /* Fórmula/BOM/Especificação apontam o produto por um código que nem sempre
       é a chave do nó: pode ser o SKU, um SKU anterior (skusAnteriores) e vem
       às vezes em caixa diferente (".../V1" x ".../v1"). Tudo resolve para a
       chave do produto, comparando em maiúsculas. */
    var chaveProduto = {};
    Object.keys(produtos).forEach(function(k) {
      var p = produtos[k] || {};
      [k, p.sku].concat(Array.isArray(p.skusAnteriores) ? p.skusAnteriores : txt(p.skusAnteriores).split(/[|,;]/))
        .forEach(function(c) { c = norm(c); if (c && !chaveProduto[c]) chaveProduto[c] = k; });
    });
    function resolveProduto(cod) { return chaveProduto[norm(cod)] || ''; }
    var produtoPorCod = new Proxy({}, {get: function(_, cod) { var k = resolveProduto(cod); return k ? produtos[k] : undefined; }});
    function descProduto(cod) { var p = produtoPorCod[cod]; return p ? txt(p.descricao) : ''; }
    function clienteProduto(cod) { var p = produtoPorCod[cod]; return p ? txt(p.cliente) : ''; }

    // ── Contagens por produto (fórmula/BOM) ────────────────────────────
    var nForm = {}, nBom = {};
    Object.keys(formulas).forEach(function(k) { var c = resolveProduto((formulas[k] || {}).codProduto); nForm[c] = (nForm[c] || 0) + 1; });
    Object.keys(boms).forEach(function(k) { var c = resolveProduto((boms[k] || {}).codProduto); nBom[c] = (nBom[c] || 0) + 1; });

    // ── Abas de cadastro ────────────────────────────────────────────────
    var abaProdutos = aba('Produtos', Object.keys(produtos).map(function(k) {
      var d = achatar(produtos[k]);
      d.chave = k;
      d.versoes_formula = nForm[k] || 0;
      d.versoes_bom = nBom[k] || 0;
      return {dados: d};
    }), ['chave', 'sku', 'descricao', 'cliente', 'clienteKey', 'codCliente', 'ativo', 'categoria', 'subcategoria',
         'linhaProduto', 'volume', 'unidadeVolume', 'viscosidade', 'unCx', 'kgCaixa', 'lotePadrao', 'lp', 'prodHoraRef',
         'densidadeGranel', 'overfillPct', 'perdaLinhaPct', 'perdaProcessoPct', 'prazoValidadeMeses', 'ean13', 'dum14',
         'msAnvisa', 'versoes_formula', 'versoes_bom']);

    var abaMateriais = aba('Materiais', Object.keys(materiais).map(function(k) {
      var d = achatar(materiais[k]); d.chave = k; return {dados: d};
    }), ['chave', 'mpCodigo', 'mpNome', 'tipo', 'ativo', 'unidade', 'unidadeCompra', 'fatorConversao', 'controlado',
         'controlaEstoque', 'cor', 'especificacoesTecnicas', 'fornecedores']);

    var abaClientes = aba('Clientes', Object.keys(clientes).map(function(k) {
      var d = achatar(clientes[k]); d.chave = k; return {dados: d};
    }), ['chave', 'codigo', 'nome', 'ativo', 'cnpj', 'cidade', 'uf', 'condicaoPagamento']);

    var abaFornecedores = aba('Fornecedores', Object.keys(fornecedores).map(function(k) {
      var d = achatar(fornecedores[k]); d.chave = k; return {dados: d};
    }), ['chave', 'razaoSocial', 'nomeFantasia', 'ativo', 'cnpj', 'cidade', 'uf', 'tipo', 'tipos']);

    // ── Fórmulas: uma linha por item ───────────────────────────────────
    var linhasFormula = [];
    Object.keys(formulas).sort().forEach(function(k) {
      var f = formulas[k] || {}, itens = obj(f.itens), ks = Object.keys(itens);
      var cab = {chave: k, codProduto: txt(f.codProduto), produto: descProduto(f.codProduto), cliente: clienteProduto(f.codProduto),
        versao: txt(f.versao), status: txt(f.status), somaPercentual: f.somaPercentual != null ? f.somaPercentual : '',
        aprovadoPD: txt(f.aprovadoPD), aprovadoQualidade: txt(f.aprovadoQualidade), dataAprovacao: txt(f.dataAprovacao)};
      (ks.length ? ks : [null]).forEach(function(ik) {
        var it = ik ? obj(itens[ik]) : {}, cod = txt(it.mpCodigo), mat = materialPorCod[cod];
        var d = Object.assign({}, cab, {
          item: ik || '', fase: txt(it.fase), ordemAdicao: it.ordemAdicao != null ? it.ordemAdicao : '',
          mpCodigo: cod, mpNome: txt(it.mpNome), percentualMM: it.percentualMM != null ? it.percentualMM : '',
          cad_nome: mat ? txt(mat.mpNome) : (cod ? 'NÃO CADASTRADO' : ''), cad_tipo: mat ? txt(mat.tipo) : '',
          cad_ativo: mat ? (mat.ativo === false ? 'NÃO' : 'SIM') : '',
          cad_nome_confere: cod ? (mat ? (norm(mat.mpNome) === norm(it.mpNome) ? 'SIM' : 'NÃO') : 'NÃO') : ''
        });
        Object.keys(f).forEach(function(c) {
          if (['itens', 'codProduto', 'versao', 'status', 'somaPercentual', 'aprovadoPD', 'aprovadoQualidade', 'dataAprovacao'].indexOf(c) < 0 && typeof f[c] !== 'object') d['f_' + c] = f[c];
        });
        linhasFormula.push({dados: d});
      });
    });
    var abaFormulas = aba('Fórmulas', linhasFormula, ['chave', 'item', 'codProduto', 'produto', 'cliente', 'versao', 'status',
      'somaPercentual', 'fase', 'ordemAdicao', 'mpCodigo', 'mpNome', 'percentualMM', 'cad_nome', 'cad_nome_confere', 'cad_tipo',
      'cad_ativo', 'aprovadoPD', 'aprovadoQualidade', 'dataAprovacao']);

    // ── BOM: uma linha por componente ───────────────────────────────────
    var linhasBom = [];
    Object.keys(boms).sort().forEach(function(k) {
      var b = boms[k] || {}, itens = obj(b.itens), ks = Object.keys(itens);
      var cab = {chave: k, codProduto: txt(b.codProduto), produto: descProduto(b.codProduto), cliente: clienteProduto(b.codProduto),
        versao: txt(b.versao), status: txt(b.status), aprovadoPCP: txt(b.aprovadoPCP), aprovadoComercial: txt(b.aprovadoComercial),
        obsoletoEm: txt(b.obsoletoEm), obsoletoMotivo: txt(b.obsoletoMotivo)};
      (ks.length ? ks : [null]).forEach(function(ik) {
        var it = ik ? obj(itens[ik]) : {}, cod = txt(it.materialCodigo), mat = materialPorCod[cod];
        linhasBom.push({dados: Object.assign({}, cab, {
          item: ik || '', posicao: it.posicao != null ? it.posicao : '', materialCodigo: cod, materialNome: txt(it.materialNome),
          qtdPorPeca: it.qtdPorPeca != null ? it.qtdPorPeca : '',
          cad_nome: mat ? txt(mat.mpNome) : (cod ? 'NÃO CADASTRADO' : ''), cad_tipo: mat ? txt(mat.tipo) : '',
          cad_ativo: mat ? (mat.ativo === false ? 'NÃO' : 'SIM') : '',
          cad_nome_confere: cod ? (mat ? (norm(mat.mpNome) === norm(it.materialNome) ? 'SIM' : 'NÃO') : 'NÃO') : ''
        })});
      });
    });
    var abaBom = aba('BOM', linhasBom, ['chave', 'item', 'codProduto', 'produto', 'cliente', 'versao', 'status', 'posicao',
      'materialCodigo', 'materialNome', 'qtdPorPeca', 'cad_nome', 'cad_nome_confere', 'cad_tipo', 'cad_ativo', 'aprovadoPCP',
      'aprovadoComercial', 'obsoletoEm', 'obsoletoMotivo']);

    // ── Especificações: uma linha por ensaio ───────────────────────────
    var linhasSpec = [];
    Object.keys(specs).sort().forEach(function(k) {
      var s = specs[k] || {}, itens = obj(s.itens), ks = Object.keys(itens);
      var cab = {chave: k, codProduto: txt(s.codProduto), produto: descProduto(s.codProduto), versao: txt(s.versao),
        status: txt(s.status), aprovadoPD: txt(s.aprovadoPD), aprovadoQualidade: txt(s.aprovadoQualidade)};
      (ks.length ? ks : [null]).forEach(function(ik) {
        var it = ik ? obj(itens[ik]) : {};
        linhasSpec.push({dados: Object.assign({}, cab, {item: ik || '', ensaio: txt(it.ensaio),
          especificacaoTexto: txt(it.especificacaoTexto), minimo: txt(it.minimo), maximo: txt(it.maximo),
          metodo: txt(it.metodo), critico: it.critico === true ? 'SIM' : (it.critico === false ? 'NÃO' : '')})});
      });
    });
    var abaSpecs = aba('Especificações', linhasSpec, ['chave', 'item', 'codProduto', 'produto', 'versao', 'status', 'ensaio',
      'especificacaoTexto', 'minimo', 'maximo', 'metodo', 'critico', 'aprovadoPD', 'aprovadoQualidade']);

    // ── Conferência: o que a comparação já achou ───────────────────────
    var achados = [];
    function achado(tipo, chave, cod, versao, item, detalhe) {
      achados.push([tipo, chave, cod, descProduto(cod), versao, item, detalhe]);
    }
    Object.keys(formulas).sort().forEach(function(k) {
      var f = formulas[k] || {}, itens = obj(f.itens), soma = 0, ks = Object.keys(itens);
      if (!produtoPorCod[f.codProduto]) achado('Fórmula de produto inexistente', k, f.codProduto, f.versao, '', 'codProduto não existe em Produtos');
      if (!ks.length) achado('Fórmula sem itens', k, f.codProduto, f.versao, '', 'versão sem nenhum ingrediente');
      ks.forEach(function(ik) {
        var it = itens[ik] || {}, mat = materialPorCod[it.mpCodigo];
        soma += n(it.percentualMM);
        if (!it.mpCodigo) achado('Fórmula: item sem código', k, f.codProduto, f.versao, ik, 'ingrediente sem mpCodigo (' + txt(it.mpNome) + ')');
        else if (!mat) achado('Fórmula: material não cadastrado', k, f.codProduto, f.versao, ik, it.mpCodigo + ' — ' + txt(it.mpNome));
        else {
          if (norm(mat.mpNome) !== norm(it.mpNome)) achado('Fórmula: nome diferente do cadastro', k, f.codProduto, f.versao, ik,
            it.mpCodigo + ': fórmula "' + txt(it.mpNome) + '" x cadastro "' + txt(mat.mpNome) + '"');
          if (mat.ativo === false) achado('Fórmula: material inativo', k, f.codProduto, f.versao, ik, it.mpCodigo + ' — ' + txt(mat.mpNome));
        }
        if (!(n(it.percentualMM) > 0)) achado('Fórmula: percentual zerado', k, f.codProduto, f.versao, ik, txt(it.mpCodigo) + ' sem percentual');
      });
      if (ks.length && Math.abs(soma - 100) > 0.01) achado('Fórmula: soma diferente de 100%', k, f.codProduto, f.versao, '',
        'soma = ' + (Math.round(soma * 10000) / 10000) + '%');
    });
    Object.keys(boms).sort().forEach(function(k) {
      var b = boms[k] || {}, itens = obj(b.itens), ks = Object.keys(itens), vistos = {};
      if (!produtoPorCod[b.codProduto]) achado('BOM de produto inexistente', k, b.codProduto, b.versao, '', 'codProduto não existe em Produtos');
      if (!ks.length) achado('BOM sem componentes', k, b.codProduto, b.versao, '', 'versão sem nenhum componente');
      ks.forEach(function(ik) {
        var it = itens[ik] || {}, mat = materialPorCod[it.materialCodigo];
        if (!it.materialCodigo) achado('BOM: item sem código', k, b.codProduto, b.versao, ik, 'componente sem código (' + txt(it.materialNome) + ')');
        else if (!mat) achado('BOM: material não cadastrado', k, b.codProduto, b.versao, ik, it.materialCodigo + ' — ' + txt(it.materialNome));
        else {
          if (norm(mat.mpNome) !== norm(it.materialNome)) achado('BOM: nome diferente do cadastro', k, b.codProduto, b.versao, ik,
            it.materialCodigo + ': BOM "' + txt(it.materialNome) + '" x cadastro "' + txt(mat.mpNome) + '"');
          if (mat.ativo === false) achado('BOM: material inativo', k, b.codProduto, b.versao, ik, it.materialCodigo + ' — ' + txt(mat.mpNome));
        }
        if (!(n(it.qtdPorPeca) > 0)) achado('BOM: quantidade por peça zerada', k, b.codProduto, b.versao, ik, txt(it.materialCodigo) + ' sem qtdPorPeca');
        if (it.materialCodigo) {
          if (vistos[it.materialCodigo]) achado('BOM: componente repetido', k, b.codProduto, b.versao, ik, it.materialCodigo + ' aparece mais de uma vez');
          vistos[it.materialCodigo] = true;
        }
      });
    });
    Object.keys(produtos).sort().forEach(function(k) {
      var p = produtos[k] || {};
      if (p.ativo === 'Inativo' || p.ativo === false) return;
      if (!nForm[k]) achado('Produto ativo sem fórmula', k, k, '', '', txt(p.descricao));
      if (!nBom[k]) achado('Produto ativo sem BOM', k, k, '', '', txt(p.descricao));
      if (!(n(p.prodHoraRef) > 0)) achado('Produto ativo sem produtividade (prodHoraRef)', k, k, '', '', txt(p.descricao));
      if (!p.clienteKey || !clientes[p.clienteKey]) achado('Produto com cliente não vinculado', k, k, '', '', txt(p.cliente) + ' (clienteKey: ' + txt(p.clienteKey) + ')');
    });
    achados.sort(function(a, b) { return a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]); });
    var abaConf = {nome: 'Conferência', colunas: ['tipo', 'chave', 'codProduto', 'produto', 'versao', 'item', 'detalhe'], linhas: achados};

    var resumo = {};
    achados.forEach(function(a) { resumo[a[0]] = (resumo[a[0]] || 0) + 1; });
    var leia = {nome: 'Leia-me', colunas: ['Como usar'], linhas: [
      ['Exportado em ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' (UTC), direto do banco de produção.'],
      ['Produtos, Materiais, Clientes e Fornecedores: uma linha por registro. Fórmulas, BOM e Especificações: uma linha por item.'],
      ['NÃO altere as colunas "chave" e "item": identificam o registro no banco para a importação em lote.'],
      ['Colunas "cad_*" (fórmulas e BOM) mostram o que o cadastro de Materiais diz sobre o código — são só para comparar.'],
      ['A aba "Conferência" lista o que a comparação já achou de errado (' + achados.length + ' ocorrências em ' + Object.keys(resumo).length + ' tipos).']
    ].concat(Object.keys(resumo).sort().map(function(t) { return ['   ' + t + ': ' + resumo[t]]; }))};

    return {abas: [leia, abaConf, abaProdutos, abaMateriais, abaFormulas, abaBom, abaSpecs, abaClientes, abaFornecedores],
      totais: {conferencia: achados.length}};
  }

  return {montar: montar, achatar: achatar};
});
