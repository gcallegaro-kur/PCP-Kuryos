/* Estoque por setor da Operação (2026-09-23), SÓ CONSULTA.

   Pedido do usuário: cada setor vê o estoque da sua área --
   Produção: "estoque WMS da fábrica, principalmente para verem onde está o
   material empenhado para as OPs"; Manipulação: "estoque da manipulação, com
   WMS"; Rotulagem: "estoque da sala de rótulos, com WMS". Movimentar fica
   para a Fase 2 (Guardar / Mover); aqui nada grava.

   Um setor é um conjunto de ÁREAS de endereço (Cadastros › Áreas de
   Endereço). O mapeamento vem de config/operacao/areasPorSetor/{setor} e,
   enquanto o admin não configurar, das áreas que já existem com o nome
   óbvio. Funções puras: a tela (estoque_setor.html) só lê o banco e desenha. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EstoqueSetor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var SETORES = {
    producao: {rotulo: 'Produção', titulo: 'Estoque da Fábrica'},
    manipulacao: {rotulo: 'Manipulação', titulo: 'Estoque da Manipulação'},
    rotulagem: {rotulo: 'Rotulagem', titulo: 'Estoque dos Rótulos'}
  };
  // Áreas já cadastradas em produção (seed de cadastros.html) com o nome de
  // cada setor. "MANIPULAÇÃO" ainda não existe: entra quando for criada.
  var AREAS_PADRAO = {
    producao: ['FÁBRICA'],
    manipulacao: ['MANIPULAÇÃO', 'MATÉRIA PRIMA'],
    rotulagem: ['RÓTULOS']
  };
  var DIAS_ALERTA_VALIDADE = 30;

  // Compara nomes de área sem acento/caixa/espaço: "Rótulos" = "RÓTULOS".
  function normalizarArea(nome) {
    return String(nome == null ? '' : nome).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .trim().replace(/\s+/g, ' ').toUpperCase();
  }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }

  function areasDoSetor(setor, configOperacao) {
    var cfg = configOperacao && configOperacao.areasPorSetor && configOperacao.areasPorSetor[setor];
    var lista = Array.isArray(cfg) ? cfg : (cfg && typeof cfg === 'object' ? Object.keys(cfg).filter(function(k) { return cfg[k]; }).map(function(k) { return cfg[k] === true ? k : cfg[k]; }) : null);
    if (lista && lista.length) return lista.map(String);
    return (AREAS_PADRAO[setor] || []).slice();
  }
  function configurado(setor, configOperacao) {
    var cfg = configOperacao && configOperacao.areasPorSetor && configOperacao.areasPorSetor[setor];
    return !!(cfg && (Array.isArray(cfg) ? cfg.length : Object.keys(cfg).length));
  }

  // 'vencido' | 'vence' (até 30 dias) | 'ok' | null (sem validade).
  function situacaoValidade(dataValidade, hojeIso) {
    if (!dataValidade) return null;
    var v = new Date(String(dataValidade).length === 10 ? dataValidade + 'T12:00:00' : dataValidade);
    var h = new Date((hojeIso || new Date().toISOString()).slice(0, 10) + 'T12:00:00');
    if (isNaN(v.getTime()) || isNaN(h.getTime())) return null;
    var dias = Math.round((v - h) / 86400000);
    if (dias < 0) return 'vencido';
    if (dias <= DIAS_ALERTA_VALIDADE) return 'vence';
    return 'ok';
  }

  function linhaDoLote(itemKey, loteKey, l, end, hojeIso) {
    return {
      itemKey: itemKey, loteKey: loteKey, itemTipo: l.itemTipo || 'material',
      itemCodigo: l.itemCodigo || itemKey, itemNome: l.itemNome || '', unidade: l.unidade || '',
      loteInterno: l.loteInterno || '', loteOrigem: l.loteOrigem || '',
      dataValidade: l.dataValidade || null, validade: situacaoValidade(l.dataValidade, hojeIso),
      saldo: num(l.saldoLote), status: l.status || 'LIBERADO',
      enderecoKey: l.enderecoKey || null,
      enderecoCodigo: (end && end.codigo) || l.enderecoCodigo || l.enderecoKey || '',
      area: (end && end.area) || '',
      separadoPara: l.origemTipo === 'separacao_op' ? (l.origemRef || null) : null
    };
  }

  /* Tudo o que está guardado nos endereços das áreas do setor, com saldo. */
  function lotesDoSetor(estoqueLotes, enderecos, areas, hojeIso) {
    var alvo = {};
    (areas || []).forEach(function(a) { alvo[normalizarArea(a)] = true; });
    var out = [];
    Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
      var lotes = estoqueLotes[itemKey] || {};
      Object.keys(lotes).forEach(function(loteKey) {
        var l = lotes[loteKey];
        if (!l || num(l.saldoLote) <= 0 || !l.enderecoKey) return;
        var end = (enderecos || {})[l.enderecoKey];
        if (!end || !alvo[normalizarArea(end.area)]) return;
        out.push(linhaDoLote(itemKey, loteKey, l, end, hojeIso));
      });
    });
    return out.sort(function(a, b) {
      return String(a.enderecoCodigo).localeCompare(String(b.enderecoCodigo), 'pt-BR', {numeric: true}) ||
        String(a.itemCodigo).localeCompare(String(b.itemCodigo)) ||
        String(a.dataValidade || '9999').localeCompare(String(b.dataValidade || '9999'));
    });
  }

  function filtrar(linhas, busca) {
    var t = normalizarArea(busca);
    if (!t) return linhas;
    return linhas.filter(function(l) {
      return normalizarArea([l.itemCodigo, l.itemNome, l.loteInterno, l.loteOrigem, l.enderecoCodigo, l.separadoPara].join(' ')).indexOf(t) >= 0;
    });
  }

  // Resumo do topo: posições ocupadas, itens distintos e alertas de validade.
  function resumo(linhas) {
    var ends = {}, itens = {};
    var vencidos = 0, vencendo = 0;
    linhas.forEach(function(l) {
      ends[l.enderecoCodigo] = 1; itens[l.itemCodigo] = 1;
      if (l.validade === 'vencido') vencidos++;
      else if (l.validade === 'vence') vencendo++;
    });
    return {lotes: linhas.length, posicoes: Object.keys(ends).length, itens: Object.keys(itens).length, vencidos: vencidos, vencendo: vencendo};
  }

  /* MATERIAL DAS OPs (Produção): para cada OP em andamento, o que ela consome
     (materiaisConsumo, gravado na emissão), quanto ainda está empenhado
     (estoque/{m}/empenhos/{lote}) e ONDE o material está -- primeiro o que a
     Separação já levou para esta OP, depois o resto na ordem FEFO. Só leitura. */
  var STATUS_FORA = {'Concluído': 1, 'Cancelado': 1};
  function opsEmAndamento(ops, limite) {
    return Object.keys(ops || {}).map(function(k) { return Object.assign({key: k}, ops[k]); })
      .filter(function(o) { return o && o.lote && !STATUS_FORA[o.status] && o.materiaisConsumo; })
      .sort(function(a, b) {
        var pa = a.status === 'Em Produção' ? 0 : 1, pb = b.status === 'Em Produção' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return String(b.dataEmissao || '').localeCompare(String(a.dataEmissao || ''));
      })
      .slice(0, limite || 40);
  }

  function posicoesDoMaterial(mpCodigo, loteOp, estoqueLotes, enderecos, hojeIso) {
    var itemKey = sanitize(mpCodigo);
    var lotes = (estoqueLotes || {})[itemKey] || {};
    return Object.keys(lotes).map(function(k) {
      var l = lotes[k];
      if (!l || num(l.saldoLote) <= 0 || !l.enderecoKey) return null;
      var r = linhaDoLote(itemKey, k, l, (enderecos || {})[l.enderecoKey], hojeIso);
      r.separadoParaEstaOp = !!(r.separadoPara && r.separadoPara === loteOp);
      return r;
    }).filter(Boolean).filter(function(r) {
      // Separado para OUTRA OP não é opção para esta.
      return !r.separadoPara || r.separadoParaEstaOp;
    }).sort(function(a, b) {
      if (a.separadoParaEstaOp !== b.separadoParaEstaOp) return a.separadoParaEstaOp ? -1 : 1;
      return String(a.dataValidade || '9999').localeCompare(String(b.dataValidade || '9999'));
    });
  }

  function materiaisDaOp(op, estoque, estoqueLotes, enderecos, hojeIso) {
    var loteKey = sanitize(op.lote);
    return Object.keys(op.materiaisConsumo || {}).map(function(k) {
      var it = op.materiaisConsumo[k] || {};
      if (!it.mpCodigo) return null;
      var est = (estoque || {})[sanitize(it.mpCodigo)] || {};
      var emp = (est.empenhos || {})[loteKey];
      var posicoes = posicoesDoMaterial(it.mpCodigo, op.lote, estoqueLotes, enderecos, hojeIso);
      return {
        mpCodigo: it.mpCodigo, mpNome: it.mpNome || est.materialNome || '', unidade: it.unidade || '',
        necessario: num(it.quantidade), empenhado: emp ? num(emp.qtdEmpenhada) : 0,
        separado: posicoes.filter(function(p) { return p.separadoParaEstaOp; }).reduce(function(s, p) { return s + p.saldo; }, 0),
        posicoes: posicoes
      };
    }).filter(Boolean).sort(function(a, b) { return a.mpCodigo.localeCompare(b.mpCodigo); });
  }

  // Mesma sanitizeKey de utils.js (repetida para o módulo rodar no Node).
  function sanitize(str) {
    if (!str) return '';
    return String(str).trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
  }

  return {
    SETORES: SETORES, AREAS_PADRAO: AREAS_PADRAO, DIAS_ALERTA_VALIDADE: DIAS_ALERTA_VALIDADE,
    normalizarArea: normalizarArea, areasDoSetor: areasDoSetor, configurado: configurado,
    situacaoValidade: situacaoValidade, lotesDoSetor: lotesDoSetor, filtrar: filtrar, resumo: resumo,
    opsEmAndamento: opsEmAndamento, posicoesDoMaterial: posicoesDoMaterial, materiaisDaOp: materiaisDaOp
  };
});
