/* Perdas item a item por etapa (2026-09-25).
   Pedido do usuário: "ao finalizar uma OP, solicitar o apontamento de perdas
   item por item -- na manipulação, cada item da fórmula; na rotulagem, frascos
   e rótulos (os insumos envolvidos); no envase, o produto acabado (a fórmula
   pronta) e cada insumo: frascos + rótulos + válvula + qualquer outro".

   Antes: lista livre com categorias fixas (Frascos, Rótulos, ...) e o
   material era opcional -- sem material a perda não descontava estoque e não
   dava para saber QUAL frasco se perdeu. Agora a lista vem dos insumos da
   própria OP (materiaisConsumo; OP antiga sem ele usa o BOM do SKU), e cada
   perda nasce com o material.

   Funções PURAS. Formato gravado = o de sempre em perdas/{lote}/{id}.perdas
   ({tipo, quantidade, especificacao, materialCodigo, materialNome}), então
   Histórico, e-mail de OP encerrada, dossiê e Relatório de Pedido continuam
   lendo sem mudança: `tipo` é a categoria de antes (derivada do material) e
   `especificacao` leva o nome do material. Campos novos só somam: `unidade`,
   `etapa` e, para o produto, `produto: true`.

   Produto perdido no envase vem em duas formas, porque acontecem de jeitos
   diferentes na linha: unidades envasadas descartadas (frasco cheio que caiu,
   vazou, saiu fora de peso) e bulk perdido fora do frasco, em kg (purga da
   linha, derramamento, sobra no tanque). O bulk não é item de estoque -- as
   matérias-primas já saíram na pesagem --, então essas duas perdas são
   registro, não baixa. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PerdasEtapa = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TIPO_UN_ENVASADA = 'Produto envasado (un)';
  var TIPO_BULK_KG = 'Bulk (kg)';

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var x = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(num(v) * 1000) / 1000; }
  // Texto que vai para e-mail/dossiê: número no formato brasileiro.
  function br(v) { return String(arred(v)).replace('.', ','); }
  function semAcento(s) { return txt(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase(); }

  // Categoria de antes (PERDAS_TIPOS de form.html), pelo nome do material.
  // É o que mantém os agregados antigos (Histórico, benchmark por SKU,
  // Relatório de Pedido) comparáveis com o que já foi lançado.
  function tipoDoMaterial(nome, codigo) {
    var s = semAcento(nome);
    if (/ROTULO|ETIQUETA|SLEEVE/.test(s)) return 'Rótulos';
    if (/CARTUCHO/.test(s)) return 'Cartuchos';
    if (/DISPLAY/.test(s)) return 'Display';
    if (/CAIXA|MASTER|EMBARQUE/.test(s)) return 'Caixa de Embarque';
    if (/VALV|TAMPA|BOMBA|PUMP|SPRAY|GATILHO|BATOQUE|APLICADOR|CONTA.?GOTAS|GOTEJADOR|BULBO|RETENTOR|SPOT|PINCEL|TAMPINHA/.test(s)) return 'Tampas/Válvulas';
    if (/FRASCO|POTE|BISNAGA|VIDRO|AMPOLA|TUBO|REFIL/.test(s)) return 'Frascos';
    var c = semAcento(codigo);
    if (/^ES/.test(c)) return 'Rótulos';
    if (/^ET/.test(c)) return 'Caixa de Embarque';
    return 'Outro';
  }

  // Insumos de embalagem da OP. materiaisConsumo é a verdade da OP (pode ter
  // sido editado na emissão); OP antiga, sem ele, usa o BOM do SKU.
  function embalagensDaOp(op, bomItens, materiais) {
    var lista = [];
    var vistos = {};
    function add(codigo, nome, unidade) {
      codigo = txt(codigo);
      if (!codigo || vistos[codigo]) return;
      vistos[codigo] = true;
      var m = materialPorCodigo(materiais, codigo);
      lista.push({ materialCodigo: codigo, materialNome: txt(nome) || (m && m.mpNome) || codigo,
        unidade: txt(unidade) || (m && m.unidade) || 'un', tipo: tipoDoMaterial(nome || (m && m.mpNome), codigo) });
    }
    var mc = (op && op.materiaisConsumo) || null;
    if (mc && Object.keys(mc).length) {
      Object.keys(mc).forEach(function (k) {
        var it = mc[k] || {};
        if (it.origem === 'bom') add(it.mpCodigo, it.mpNome, it.unidade);
      });
    } else {
      (bomItens || []).slice().sort(function (a, b) { return num(a.posicao) - num(b.posicao); })
        .forEach(function (it) { add(it.materialCodigo, it.materialNome, null); });
    }
    return lista;
  }
  function materialPorCodigo(materiais, codigo) {
    if (!materiais) return null;
    if (materiais[codigo]) return materiais[codigo];
    var k = Object.keys(materiais).find(function (x) { return materiais[x] && materiais[x].mpCodigo === codigo; });
    return k ? materiais[k] : null;
  }

  // Envase: todos os insumos do BOM. Rotulagem: o que passa pela rotuladora
  // (rótulo e o frasco que o recebe) em cima; o resto fica em "outros",
  // recolhido -- ainda dá para lançar, sem poluir a tela.
  var ORDEM = { 'Frascos': 1, 'Rótulos': 2, 'Tampas/Válvulas': 3, 'Cartuchos': 4, 'Display': 5, 'Caixa de Embarque': 6, 'Outro': 7 };
  function insumosDaEtapa(etapa, op, bomItens, materiais) {
    var todos = embalagensDaOp(op, bomItens, materiais).sort(function (a, b) { return (ORDEM[a.tipo] || 9) - (ORDEM[b.tipo] || 9); });
    if (etapa === 'rotulagem') {
      var doRotulo = function (i) { return i.tipo === 'Rótulos' || i.tipo === 'Frascos'; };
      return { principais: todos.filter(doRotulo), outros: todos.filter(function (i) { return !doRotulo(i); }) };
    }
    return { principais: todos, outros: [] };
  }
  function etapaDoSetor(tipo) { return tipo === 'rotulagem' ? 'rotulagem' : 'envase'; }

  // Peso de uma unidade envasada (kg), para mostrar o equivalente entre
  // unidades descartadas e kg de bulk. Só com dado de verdade: o que a OP
  // calculou na emissão, senão volume × densidade do cadastro. Sem isso, não
  // converte (inventar densidade é o erro que o repo já pagou caro).
  function kgPorUnidade(op, produto) {
    var g = num(op && op.pesoTeoricoUnG);
    if (g > 0) return g / 1000;
    var ml = num(op && op.volumeTeoricoUnMl), d = num(op && op.densidadeGranelUsada);
    if (ml > 0 && d > 0) return ml * d / 1000;
    var p = produto || {};
    var dens = num(p.densidadeGranel), vol = num(p.volume), un = semAcento(p.unidadeVolume);
    if (!(dens > 0) || !(vol > 0)) return null;
    var litros = un === 'L' || un === 'LT' || un === 'LITRO' || un === 'LITROS' ? vol : (un === 'ML' || !un ? vol / 1000 : null);
    return litros ? litros * dens * (1 + num(p.overfillPct) / 100) : null;
  }

  // Monta a lista gravada. linhas: [{materialCodigo, materialNome, unidade,
  // tipo, qtd}] (da tabela); produto: {unidades, bulkKg}; extras: entradas da
  // lista livre ("+ Outra perda"), já no formato antigo.
  function montarPerdas(etapa, linhas, produto, extras, kgUn) {
    var out = [];
    (linhas || []).forEach(function (l) {
      var q = arred(l.qtd);
      if (!(q > 0)) return;
      out.push({ tipo: l.tipo || tipoDoMaterial(l.materialNome, l.materialCodigo), quantidade: q,
        especificacao: l.materialNome || l.materialCodigo, materialCodigo: l.materialCodigo,
        materialNome: l.materialNome || null, unidade: l.unidade || 'un', etapa: etapa });
    });
    var p = produto || {};
    var un = arred(p.unidades), kg = arred(p.bulkKg);
    if (un > 0) {
      var e = { tipo: TIPO_UN_ENVASADA, quantidade: un, unidade: 'un', produto: true, etapa: etapa,
        especificacao: 'unidades envasadas descartadas' + (kgUn ? ' (≈ ' + br(un * kgUn) + ' kg de bulk)' : '') };
      if (kgUn) e.kgEquivalente = arred(un * kgUn);
      out.push(e);
    }
    if (kg > 0) {
      out.push({ tipo: TIPO_BULK_KG, quantidade: kg, unidade: 'kg', produto: true, etapa: etapa,
        especificacao: 'bulk perdido fora do frasco' + (kgUn ? ' (≈ ' + Math.round(kg / kgUn) + ' un)' : '') });
    }
    (extras || []).forEach(function (x) { if (x && x.tipo && num(x.quantidade) > 0) out.push(x); });
    return out;
  }

  // Quantidade informada inválida (negativa ou texto) -- a tela avisa em vez
  // de gravar zero calado.
  function validarLinhas(linhas, produto) {
    var erros = [];
    (linhas || []).forEach(function (l) {
      var bruto = txt(l.qtd);
      if (bruto === '') return;
      var x = Number(bruto.replace(',', '.'));
      if (!isFinite(x) || x < 0) erros.push((l.materialNome || l.materialCodigo) + ': quantidade inválida.');
    });
    ['unidades', 'bulkKg'].forEach(function (c) {
      var bruto = txt((produto || {})[c]);
      if (bruto === '') return;
      var x = Number(bruto.replace(',', '.'));
      if (!isFinite(x) || x < 0) erros.push((c === 'unidades' ? 'Unidades envasadas descartadas' : 'Bulk perdido') + ': quantidade inválida.');
    });
    return { ok: !erros.length, erros: erros };
  }

  // Perdas por matéria-prima na manipulação (kg): o que foi pesado e NÃO foi
  // para o tacho. Não pode passar do pesado da MP.
  function validarPerdasMp(linhas, perdas) {
    var erros = [];
    (linhas || []).forEach(function (l) {
      var bruto = txt((perdas || {})[l.itemKey]);
      if (bruto === '') return;
      var x = Number(bruto.replace(',', '.'));
      if (!isFinite(x) || x < 0) erros.push((l.nome || l.codigo) + ': perda inválida.');
      else if (l.pesado != null && x > num(l.pesado) + 1e-9) erros.push((l.nome || l.codigo) + ': perda (' + x + ') maior que o pesado (' + num(l.pesado) + ').');
    });
    return { ok: !erros.length, erros: erros };
  }
  function limparPerdasMp(perdas) {
    var out = {};
    Object.keys(perdas || {}).forEach(function (k) { var x = arred(perdas[k]); if (x > 0) out[k] = x; });
    return out;
  }

  return { tipoDoMaterial: tipoDoMaterial, embalagensDaOp: embalagensDaOp, insumosDaEtapa: insumosDaEtapa,
    etapaDoSetor: etapaDoSetor, kgPorUnidade: kgPorUnidade, montarPerdas: montarPerdas, validarLinhas: validarLinhas,
    validarPerdasMp: validarPerdasMp, limparPerdasMp: limparPerdasMp,
    TIPO_UN_ENVASADA: TIPO_UN_ENVASADA, TIPO_BULK_KG: TIPO_BULK_KG };
});
