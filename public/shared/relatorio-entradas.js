/* Relatório de entradas de materiais (27/10/2026) — Logística › Histórico.
   Pedido do usuário: "quero um relatório melhor de entradas de materiais
   ... me baseando na tela agendamentos > histórico, onde temos poucas
   informações". O cartão antigo mostrava PC, NF, AK, lote do fornecedor e
   quantidade. O resto já estava gravado e ninguém via: situação no CQ,
   validade, endereço e saldo atuais, pedido × recebido, dono do material,
   notas do veículo/embalagem e devoluções.

   Uma linha por item recebido (pedidos_compra/{pc}/recebimentos/{rec}/
   itensRecebidos/{linha}), cruzada com o lote que ela criou
   (estoque_lotes/{item}/{loteKey}) e com o item do PC. Funções puras; a
   tela (logistica.html) só desenha. Testado em run_relatorio_entradas_test.js.

   Total sempre POR UNIDADE: as entradas misturam un, kg, rolo e L
   (mesma armadilha do Kardex) e um número só somaria kg com unidade. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RelatorioEntradas = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // Situação do lote no CQ, a partir de estoque_lotes/.../status (o que vale
  // para usar o material), com a decisão do laudo como detalhe.
  var CQ = {
    AGUARDANDO: {rotulo: 'Aguardando CQ', cor: 'orange'},
    INSPECAO_TOTAL: {rotulo: 'Inspeção total', cor: 'orange'},
    LIBERADO: {rotulo: 'Liberado', cor: 'green'},
    CONCESSAO: {rotulo: 'Liberado c/ concessão', cor: 'purple'},
    REPROVADO: {rotulo: 'Reprovado', cor: 'red'},
    BLOQUEADO: {rotulo: 'Bloqueado', cor: 'red'},
    CANCELADO: {rotulo: 'Cancelado', cor: 'gray'},
    SEM_LOTE: {rotulo: 'Sem lote', cor: 'gray'}
  };
  var ORDEM_CQ = ['AGUARDANDO', 'INSPECAO_TOTAL', 'LIBERADO', 'CONCESSAO', 'REPROVADO', 'BLOQUEADO', 'CANCELADO', 'SEM_LOTE'];
  var TIPOS = {MATERIA_PRIMA: 'Matéria-prima', EMBALAGEM: 'Embalagem'};
  var DIA_MS = 86400000;

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function normalizar(s) {
    return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
  }
  // Mesma regra de sanitizeKey (shared/utils.js), que nomeia o nó do item em estoque_lotes.
  function chaveItem(codigo) {
    return txt(codigo).replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);
  }

  function situacaoCq(lote, recCancelado) {
    if (recCancelado) return 'CANCELADO';
    if (!lote) return 'SEM_LOTE';
    var st = txt(lote.status), dec = txt((lote.qualidade || {}).decisao);
    if (st === 'CANCELADO') return 'CANCELADO';
    if (st === 'REPROVADO' || dec === 'REPROVADO') return 'REPROVADO';
    if (st === 'BLOQUEADO') return 'BLOQUEADO';
    if (st === 'APROVADO_CONCESSAO' || dec === 'APROVADO_CONCESSAO') return 'CONCESSAO';
    if (dec === 'INSPECAO_TOTAL') return 'INSPECAO_TOTAL';
    if (st === 'QUARENTENA') return 'AGUARDANDO';
    // Liberado e o que vem depois (consumido, expedido): o CQ já liberou.
    return dec || st ? 'LIBERADO' : 'AGUARDANDO';
  }

  function dono(q, lote) {
    var p = (lote && lote.propriedade) || (q && q.propriedade) || null;
    if (p && p.tipo === 'CLIENTE') return txt(p.clienteNome) || 'Cliente';
    return 'Kuryos';
  }

  /* base = {pedidosCompra, estoqueLotes, agora (ms)}. Devolve as linhas, da
     entrada mais recente para a mais antiga. */
  function linhas(base) {
    var pcs = (base && base.pedidosCompra) || {}, lotes = (base && base.estoqueLotes) || {};
    var agora = base && base.agora != null ? base.agora : Date.now();
    var out = [];
    Object.keys(pcs).forEach(function(pcKey) {
      var pc = pcs[pcKey] || {}, recs = pc.recebimentos || {};
      Object.keys(recs).forEach(function(recKey) {
        var rec = recs[recKey] || {}, cancelado = rec.status === 'CANCELADO';
        var data = rec.data || rec.criadoEm || '';
        Object.keys(rec.itensRecebidos || {}).forEach(function(linhaKey) {
          var l = rec.itensRecebidos[linhaKey] || {}, q = l.entradaQualidade || {};
          var lote = l.loteKey ? (lotes[chaveItem(l.materialCodigo)] || {})[l.loteKey] || null : null;
          var itemPc = (pc.itens || {})[l.itemKey] || null;
          var cq = situacaoCq(lote, cancelado);
          var dataMs = Date.parse(data);
          var qtd = n(l.qtdRecebidaAgora);
          out.push({
            pcKey: pcKey, recKey: recKey, linhaKey: linhaKey,
            data: data, dia: txt(data).slice(0, 10),
            pc: pc.numeroFormatado || pcKey,
            origem: pc.origemNome || pc.fornecedorNome || q.fornecedorNome || 'Origem não informada',
            origemTipo: pc.origemTipo || 'FORNECEDOR',
            nf: txt(rec.notaFiscal || q.notaFiscal),
            recebidoPor: rec.recebidoPor || q.recebidoPor || '',
            recCancelado: cancelado,
            codigo: l.materialCodigo || q.skuInterno || '',
            material: l.materialNome || q.identificacaoMaterial || '',
            tipo: q.tipoMaterial || '',
            qtd: qtd, unidade: l.unidade || '',
            devolvido: n(l.qtdDevolvida),
            // Pedido × recebido do item do PC, na unidade de estoque.
            qtdPedida: itemPc ? n(itemPc.qtdEmUnidadeEstoque || itemPc.qtd) : null,
            qtdRecebidaPc: itemPc ? n(itemPc.qtdRecebida) : null,
            loteInterno: q.loteInterno || (lote && lote.loteInterno) || '',
            loteFornecedor: q.loteOrigem || '',
            validade: txt((lote && lote.dataValidade) || q.dataValidade).slice(0, 10),
            volumes: n(q.qtdVolumes) || null,
            amostra: n(q.qtdAmostragem) || null,
            notaVeiculo: q.condicoesVeiculo != null ? n(q.condicoesVeiculo) : null,
            notaEmbalagem: q.condicoesEmbalagem != null ? n(q.condicoesEmbalagem) : null,
            certificado: !!q.certificadoFornecedor,
            dono: dono(q, lote),
            enderecoAtual: (lote && lote.enderecoCodigo) || q.enderecoCodigo || '',
            saldoLote: lote ? n(lote.saldoLote) : null,
            cq: cq,
            cqRotulo: CQ[cq].rotulo,
            inspecionadoEm: lote && lote.qualidade ? txt(lote.qualidade.dataInspecao || lote.qualidade.inspecionadoEm).slice(0, 10) : '',
            diasEsperandoCq: (cq === 'AGUARDANDO' || cq === 'INSPECAO_TOTAL') && isFinite(dataMs) ? Math.max(0, Math.floor((agora - dataMs) / DIA_MS)) : null,
            observacoes: rec.observacoes || ''
          });
        });
      });
    });
    return out.sort(function(a, b) {
      return String(b.data).localeCompare(String(a.data)) || String(a.codigo).localeCompare(String(b.codigo));
    });
  }

  function textoBusca(r) {
    return [r.pc, r.origem, r.nf, r.codigo, r.material, r.loteInterno, r.loteFornecedor,
      r.recebidoPor, r.enderecoAtual, r.dono, r.observacoes].join(' ');
  }

  /* f = {busca, de, ate (AAAA-MM-DD, inclusivos), origem, tipo, cq, dono,
     cancelados (true inclui recebimentos cancelados)} */
  function filtrar(rows, f) {
    f = f || {};
    var termos = normalizar(f.busca).split(' ').filter(Boolean);
    return (rows || []).filter(function(r) {
      if (!f.cancelados && r.recCancelado) return false;
      if (f.de && (!r.dia || r.dia < f.de)) return false;
      if (f.ate && (!r.dia || r.dia > f.ate)) return false;
      if (f.origem && normalizar(r.origem) !== normalizar(f.origem)) return false;
      if (f.tipo && r.tipo !== f.tipo) return false;
      if (f.cq && r.cq !== f.cq) return false;
      if (f.dono && normalizar(r.dono) !== normalizar(f.dono)) return false;
      if (termos.length) {
        var t = normalizar(textoBusca(r));
        if (!termos.every(function(x) { return t.indexOf(x) >= 0; })) return false;
      }
      return true;
    });
  }

  function opcoes(rows, campo) {
    var vistos = {}, out = [];
    (rows || []).forEach(function(r) {
      var v = txt(r[campo]), k = normalizar(v);
      if (k && !vistos[k]) { vistos[k] = true; out.push(v); }
    });
    return out.sort(function(a, b) { return normalizar(a).localeCompare(normalizar(b)); });
  }

  function resumo(rows) {
    var recs = {}, origens = {}, porUnidade = {}, porCq = {};
    var r = {itens: 0, recebimentos: 0, origens: 0, porUnidade: [], porCq: porCq,
      aguardandoCq: 0, maisAntigoCqDias: null, problemas: 0, devolucoes: 0, mpSemValidade: 0};
    (rows || []).forEach(function(x) {
      r.itens++;
      recs[x.pcKey + '/' + x.recKey] = true;
      origens[normalizar(x.origem)] = true;
      if (!x.recCancelado) {
        var u = x.unidade || '—';
        porUnidade[u] = (porUnidade[u] || 0) + x.qtd;
      }
      porCq[x.cq] = (porCq[x.cq] || 0) + 1;
      if (x.cq === 'AGUARDANDO' || x.cq === 'INSPECAO_TOTAL') {
        r.aguardandoCq++;
        if (x.diasEsperandoCq != null && (r.maisAntigoCqDias == null || x.diasEsperandoCq > r.maisAntigoCqDias)) r.maisAntigoCqDias = x.diasEsperandoCq;
      }
      if (x.cq === 'REPROVADO' || x.cq === 'BLOQUEADO') r.problemas++;
      if (x.devolvido > 0) r.devolucoes++;
      if (x.tipo === 'MATERIA_PRIMA' && !x.validade && !x.recCancelado) r.mpSemValidade++;
    });
    r.recebimentos = Object.keys(recs).length;
    r.origens = Object.keys(origens).length;
    r.porUnidade = Object.keys(porUnidade).sort().map(function(u) { return {unidade: u, qtd: porUnidade[u]}; });
    return r;
  }

  // CSV para o Excel brasileiro: ";" e vírgula decimal, com BOM na tela.
  var COLUNAS_CSV = [
    ['Data', function(r) { return r.dia ? r.dia.split('-').reverse().join('/') : ''; }],
    ['PC', 'pc'], ['Origem', 'origem'], ['NF', 'nf'], ['Código', 'codigo'], ['Material', 'material'],
    ['Tipo', function(r) { return TIPOS[r.tipo] || r.tipo; }],
    ['Qtd recebida', 'qtd'], ['Unidade', 'unidade'], ['Devolvido', 'devolvido'],
    ['Qtd pedida (PC)', 'qtdPedida'], ['Recebido no PC', 'qtdRecebidaPc'],
    ['Lote interno', 'loteInterno'], ['Lote fornecedor', 'loteFornecedor'],
    ['Validade', function(r) { return r.validade ? r.validade.split('-').reverse().join('/') : ''; }],
    ['Situação CQ', 'cqRotulo'], ['Dias aguardando CQ', 'diasEsperandoCq'],
    ['Endereço atual', 'enderecoAtual'], ['Saldo do lote', 'saldoLote'], ['Dono', 'dono'],
    ['Volumes', 'volumes'], ['Nota veículo', 'notaVeiculo'], ['Nota embalagem', 'notaEmbalagem'],
    ['Certificado', function(r) { return r.certificado ? 'Sim' : 'Não'; }],
    ['Recebido por', 'recebidoPor'], ['Recebimento cancelado', function(r) { return r.recCancelado ? 'Sim' : ''; }]
  ];
  function celula(v) {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    var s = String(v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(rows) {
    var cab = COLUNAS_CSV.map(function(c) { return c[0]; }).join(';');
    return [cab].concat((rows || []).map(function(r) {
      return COLUNAS_CSV.map(function(c) { return celula(typeof c[1] === 'function' ? c[1](r) : r[c[1]]); }).join(';');
    })).join('\r\n');
  }

  return {CQ: CQ, ORDEM_CQ: ORDEM_CQ, TIPOS: TIPOS, chaveItem: chaveItem, situacaoCq: situacaoCq,
    linhas: linhas, filtrar: filtrar, opcoes: opcoes, resumo: resumo, csv: csv, normalizar: normalizar};
});
