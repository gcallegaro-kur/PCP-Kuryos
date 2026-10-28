/* Painel de movimentações do WMS (27/10/2026) — Estoque/WMS › Histórico de
   Movimentações. Pedido do usuário: "algo dinâmico, visual, até mais
   ilustrativo e que transmita a informação que preciso de forma precisa e
   rápida". Antes a aba era só um campo que mandava para o Kardex de UM item.

   Fonte: o mesmo log append-only do Kardex, movimentos_estoque/{item}/{id}.
   Tipo, rótulo e natureza vêm de shared/kardex.js (uma tabela só no sistema).

   Três decisões que fazem o número ser preciso:
   - CONTA MOVIMENTOS, NÃO QUANTIDADE. O log mistura un, kg, L e rolo; somar
     "quantidade movimentada" entre itens seria um número sem significado
     (mesma armadilha do relatório de entradas e do Kardex geral). Quantidade
     aparece só por movimento, com a unidade dele.
   - A baixa de lote FEFO ('consumo') é o ESPELHO do consumo de produção: o
     apontamento grava 'consumo_producao' no saldo do item e 'consumo' em
     cada lote baixado. Contar os dois dobra o consumo. Fica fora por padrão
     (dá para ligar e ver de qual lote/endereço saiu).
   - Movimento sem autor é do sistema (apontamento de produção grava o
     consumo e a perda sem nome): aparece como "Automático", não some.

   Funções puras; a tela é shared/painel-movimentos-tela.js. Testado em
   run_painel_movimentos_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kardex.js'));
  else root.PainelMovimentos = factory(root.Kardex);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Kardex) {
  'use strict';

  // Ordem FIXA das naturezas = ordem das cores (validada para daltonismo).
  var NATUREZAS = [
    {k: 'ENTRADA', rotulo: 'Entradas', icone: '↓', sinal: 1},
    {k: 'SAIDA', rotulo: 'Saídas', icone: '↑', sinal: -1},
    {k: 'CONSUMO', rotulo: 'Consumos', icone: '⚙', sinal: -1},
    {k: 'AJUSTE', rotulo: 'Ajustes', icone: '±', sinal: 0},
    {k: 'QUALIDADE', rotulo: 'Laudos do CQ', icone: '✓', sinal: 0},
    {k: 'TRANSFERENCIA', rotulo: 'Transferências', icone: '⇄', sinal: 0},
    {k: 'PERDA', rotulo: 'Perdas', icone: '✕', sinal: -1}
  ];
  var POR_K = {};
  NATUREZAS.forEach(function(x, i) { x.slot = i + 1; POR_K[x.k] = x; });
  var ESPELHO = {consumo: true};
  var AUTOMATICO = 'Automático';
  var DIA_MS = 86400000;

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function normalizar(s) {
    return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  }
  function natureza(tipo) {
    var n = Kardex ? Kardex.tipoInfo(tipo).natureza : 'AJUSTE';
    return POR_K[n] ? n : 'AJUSTE'; // contagem e tipos novos ficam com os ajustes
  }
  function rotuloTipo(tipo) { return Kardex ? Kardex.tipoInfo(tipo).rotulo : txt(tipo); }

  /* Endereço legível. O log guarda ora o código (GAL-4.1.2), ora a chave
     (GAL-4-1-2, ponto vira hífen no RTDB). Converte a chave de volta:
     prefixo de letras + hífen + o resto com pontos. */
  function endereco(v) {
    var s = txt(v);
    if (!s || s.indexOf('.') >= 0) return s;
    var m = /^([A-Za-z]+)-(\d+(?:-\d+)+)$/.exec(s);
    return m ? m[1] + '-' + m[2].replace(/-/g, '.') : s;
  }
  // Transferência: ref "GAL-4-3-5 -> GAL-4-1-2".
  function trajeto(m) {
    var p = /^\s*(\S+)\s*->\s*(\S+)\s*$/.exec(txt(m.ref));
    return p ? {de: endereco(p[1]), para: endereco(p[2])} : null;
  }
  function diaLocal(iso, fusoMin) {
    var ms = Date.parse(iso);
    if (!isFinite(ms)) return '';
    return new Date(ms - (fusoMin || 0) * 60000).toISOString().slice(0, 10);
  }

  /* movs = movimentos_estoque inteiro. opts.fusoMin = getTimezoneOffset() da
     tela (o dia é o do armazém, não o UTC). Mais recente primeiro. */
  function eventos(movs, opts) {
    var fuso = (opts && opts.fusoMin) || 0, out = [];
    Object.keys(movs || {}).forEach(function(itemKey) {
      var v = movs[itemKey] || {};
      Object.keys(v).forEach(function(id) {
        var m = v[id];
        if (!m || typeof m !== 'object') return;
        var nat = natureza(m.tipo), tr = m.tipo === 'transferencia' ? trajeto(m) : null;
        var end = endereco(m.enderecoCodigo || m.enderecoKey);
        out.push({
          id: id, itemKey: itemKey, em: txt(m.em), dia: diaLocal(m.em, fuso),
          tipo: txt(m.tipo), tipoRotulo: rotuloTipo(m.tipo), natureza: nat,
          qtd: num(m.qtd), unidade: txt(m.unidade),
          codigo: txt(m.itemCodigo) || itemKey, nome: txt(m.itemNome), itemTipo: m.itemTipo === 'produto' ? 'produto' : 'material',
          lote: txt(m.loteKey), endereco: tr ? tr.para : end, de: tr ? tr.de : '', para: tr ? tr.para : '',
          autor: txt(m.autor) || AUTOMATICO, motivo: txt(m.motivo), ref: txt(m.ref), opKey: txt(m.opKey),
          espelho: !!ESPELHO[m.tipo]
        });
      });
    });
    // Consumo automático não grava o nome do item: completa com o de outro movimento dele.
    var nomes = {};
    out.forEach(function(e) { if (e.nome && !nomes[e.itemKey]) nomes[e.itemKey] = e.nome; });
    out.forEach(function(e) { if (!e.nome) e.nome = nomes[e.itemKey] || ''; });
    return out.sort(function(a, b) { return b.em.localeCompare(a.em) || a.id.localeCompare(b.id); });
  }

  // Período relativo: últimos N dias INCLUINDO hoje (N=1 = só hoje).
  function periodo(dias, hojeDia) {
    if (!dias) return {de: '', ate: ''};
    var fim = Date.parse(hojeDia + 'T12:00:00Z');
    return {de: new Date(fim - (dias - 1) * DIA_MS).toISOString().slice(0, 10), ate: hojeDia};
  }

  function textoBusca(e) {
    return [e.codigo, e.nome, e.lote, e.endereco, e.de, e.para, e.autor, e.motivo, e.ref, e.opKey, e.tipoRotulo].join(' ');
  }

  /* f = {de, ate, naturezas: {K: true} (vazio = todas), busca, itemTipo,
     endereco, item, autor, espelho (true inclui a baixa FEFO)} */
  function filtrar(evs, f) {
    f = f || {};
    var nats = f.naturezas && Object.keys(f.naturezas).filter(function(k) { return f.naturezas[k]; });
    var termos = normalizar(f.busca).split(' ').filter(Boolean);
    return (evs || []).filter(function(e) {
      if (!f.espelho && e.espelho) return false;
      if (f.de && (!e.dia || e.dia < f.de)) return false;
      if (f.ate && (!e.dia || e.dia > f.ate)) return false;
      if (nats && nats.length && nats.indexOf(e.natureza) < 0) return false;
      if (f.itemTipo && e.itemTipo !== f.itemTipo) return false;
      if (f.endereco && e.endereco !== f.endereco && e.de !== f.endereco) return false;
      if (f.item && e.codigo !== f.item) return false;
      if (f.autor && e.autor !== f.autor) return false;
      if (termos.length) {
        var t = normalizar(textoBusca(e));
        if (!termos.every(function(x) { return t.indexOf(x) >= 0; })) return false;
      }
      return true;
    });
  }

  function ranking(mapa, limite) {
    return Object.keys(mapa).map(function(k) { return {chave: k, rotulo: mapa[k].rotulo, n: mapa[k].n}; })
      .sort(function(a, b) { return b.n - a.n || a.rotulo.localeCompare(b.rotulo); }).slice(0, limite || 8);
  }

  /* Resumo do conjunto filtrado. `dias` = {de, ate} para montar o eixo do
     tempo contínuo (dia sem movimento aparece como zero, não some). Sem
     período, o eixo vai do primeiro ao último movimento. */
  function resumo(evs, dias) {
    var porNat = {}, itensNat = {}, porDia = {}, ends = {}, itens = {}, autores = {}, itensTodos = {};
    NATUREZAS.forEach(function(x) { porNat[x.k] = 0; itensNat[x.k] = {}; });
    (evs || []).forEach(function(e) {
      porNat[e.natureza]++;
      itensNat[e.natureza][e.codigo] = true;
      itensTodos[e.codigo] = true;
      if (e.dia) {
        porDia[e.dia] = porDia[e.dia] || {};
        porDia[e.dia][e.natureza] = (porDia[e.dia][e.natureza] || 0) + 1;
      }
      // Endereço: transferência toca origem e destino.
      [e.de, e.endereco].filter(function(x, i, a) { return x && a.indexOf(x) === i; }).forEach(function(x) {
        ends[x] = ends[x] || {rotulo: x, n: 0}; ends[x].n++;
      });
      itens[e.codigo] = itens[e.codigo] || {rotulo: e.codigo, n: 0};
      itens[e.codigo].n++;
      // Consumo automático não grava o nome; qualquer movimento do item que traga, completa.
      if (e.nome && itens[e.codigo].rotulo === e.codigo) itens[e.codigo].rotulo = e.codigo + ' — ' + e.nome;
      autores[e.autor] = autores[e.autor] || {rotulo: e.autor, n: 0}; autores[e.autor].n++;
    });
    var diasComMov = Object.keys(porDia).sort();
    var de = (dias && dias.de) || diasComMov[0] || '', ate = (dias && dias.ate) || diasComMov[diasComMov.length - 1] || '';
    var serie = [];
    if (de && ate) {
      for (var t = Date.parse(de + 'T12:00:00Z'), fim = Date.parse(ate + 'T12:00:00Z'); t <= fim && serie.length < 400; t += DIA_MS) {
        var d = new Date(t).toISOString().slice(0, 10), linha = {dia: d, total: 0, porNat: {}};
        NATUREZAS.forEach(function(x) { var c = (porDia[d] || {})[x.k] || 0; linha.porNat[x.k] = c; linha.total += c; });
        serie.push(linha);
      }
    }
    return {
      total: (evs || []).length,
      itens: Object.keys(itensTodos).length,
      naturezas: NATUREZAS.map(function(x) { return {k: x.k, rotulo: x.rotulo, icone: x.icone, slot: x.slot, n: porNat[x.k], itens: Object.keys(itensNat[x.k]).length}; }),
      serie: serie,
      picoDia: serie.reduce(function(p, s) { return s.total > (p ? p.total : -1) ? s : p; }, null),
      enderecos: ranking(ends), itensTop: ranking(itens), autores: ranking(autores)
    };
  }

  // Agrupa a linha do tempo por dia (a tela desenha um cabeçalho por dia).
  function porDia(evs) {
    var grupos = [], atual = null;
    (evs || []).forEach(function(e) {
      if (!atual || atual.dia !== e.dia) { atual = {dia: e.dia, eventos: []}; grupos.push(atual); }
      atual.eventos.push(e);
    });
    return grupos;
  }

  function csv(evs) {
    function q(v) {
      if (v == null) return '';
      if (typeof v === 'number') return String(v).replace('.', ',');
      var s = String(v);
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var cab = ['Data/hora', 'Natureza', 'Movimento', 'Código', 'Item', 'Tipo de item', 'Quantidade', 'Unidade',
      'Lote', 'Endereço', 'De', 'Para', 'Quem', 'Motivo', 'Referência'];
    return [cab.join(';')].concat((evs || []).map(function(e) {
      return [e.em, POR_K[e.natureza].rotulo, e.tipoRotulo, e.codigo, e.nome, e.itemTipo === 'produto' ? 'Produto acabado' : 'Material',
        e.qtd, e.unidade, e.lote, e.endereco, e.de, e.para, e.autor, e.motivo, e.ref].map(q).join(';');
    })).join('\r\n');
  }

  return {NATUREZAS: NATUREZAS, POR_K: POR_K, AUTOMATICO: AUTOMATICO, natureza: natureza, endereco: endereco,
    eventos: eventos, periodo: periodo, filtrar: filtrar, resumo: resumo, porDia: porDia, csv: csv, normalizar: normalizar};
});
