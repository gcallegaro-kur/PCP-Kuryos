/* Calendário de agendamentos da Logística (2026-09-17).

   Pedido do usuário: "uma tela como se fosse um calendário dentro do
   agendamento da logística". Junta numa vista só o que hoje fica em duas abas:
     ENTRADA  pedidos_compra/{k}/agendamento (entrega do fornecedor ou coleta
              programada pela Kuryos) -- ou, sem agendamento, a previsão de
              entrega de Compras (dataPrevistaEntrega), marcada como PREVISTO
     SAIDA    agendamentos_expedicao/{k} (cargas de PA da Expedição), com o
              faturamento e o saldo aguardando embarque

   Situações: AGENDADO, ATRASADO (data passou e não foi concluído), PREVISTO
   (só previsão de Compras), PARCIAL (recebido/expedido em parte), CONCLUIDO.
   Motor puro: a tela passa os nós lidos e desenha. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalendarioLogistica = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  var JANELAS = {manha: 'Manhã', tarde: 'Tarde', dia_todo: 'Dia todo'};

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function data10(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
  function ms(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function somarDias(d, k) { return iso(ms(d) + k * 86400000); }
  // Segunda = 0 ... domingo = 6.
  function diaSemana(d) { return (new Date(ms(d)).getUTCDay() + 6) % 7; }

  // Janela da saída é texto livre ("08h–12h"); vira faixa quando dá pra saber.
  function faixaJanela(janela) {
    var j = String(janela || '').toLowerCase().trim();
    if (JANELAS[j]) return j;
    var h = /(\d{1,2})\s*(h|:)/.exec(j);
    if (h) return Number(h[1]) < 12 ? 'manha' : 'tarde';
    if (/manh/.test(j)) return 'manha';
    if (/tard/.test(j)) return 'tarde';
    return 'dia_todo';
  }

  function progressoPc(p) {
    var itens = Object.values((p && p.itens) || {});
    var pedido = itens.reduce(function(t, i) { return t + n(i.qtd); }, 0);
    var recebido = itens.reduce(function(t, i) { return t + Math.min(n(i.qtdRecebida), n(i.qtd)); }, 0);
    return {itens: itens.length, pedido: pedido, recebido: recebido, pct: pedido ? Math.round(recebido / pedido * 100) : 0};
  }

  /* opts: {hoje, incluirPrevistos=true, incluirConcluidos=false, nomeOrigem(p)} */
  function eventos(pedidosCompra, agendasExpedicao, opts) {
    opts = opts || {};
    var hoje = data10(opts.hoje) || iso(Date.now());
    var incluirPrevistos = opts.incluirPrevistos !== false, incluirConcluidos = !!opts.incluirConcluidos;
    var nomeOrigem = opts.nomeOrigem || function(p) { return p.origemNome || p.fornecedorNome || 'Origem não informada'; };
    var lista = [];

    Object.keys(pedidosCompra || {}).forEach(function(k) {
      var p = pedidosCompra[k] || {};
      var ag = p.agendamento || null;
      var status = String(p.status || '');
      if (/CANCELAD/i.test(status)) return;
      var concluido = /RECEBIDO_TOTAL|RECEBIDO$|CONCLUID/i.test(status);
      var pendente = status === 'ENVIADO' || status === 'RECEBIDO_PARCIAL';
      if (!concluido && !pendente) return;
      var data = ag && data10(ag.dataAgendada), previsto = false;
      if (!data && pendente && incluirPrevistos && data10(p.dataPrevistaEntrega)) { data = data10(p.dataPrevistaEntrega); previsto = true; }
      if (!data) return;
      var prog = progressoPc(p);
      var situacao = concluido ? 'CONCLUIDO' : previsto ? 'PREVISTO' : data < hoje ? 'ATRASADO' : status === 'RECEBIDO_PARCIAL' ? 'PARCIAL' : 'AGENDADO';
      if (situacao === 'CONCLUIDO' && !incluirConcluidos) return;
      var coletaKuryos = ag ? ag.responsavelTransporte === 'KURYOS' || ag.acaoLogistica === 'PROGRAMAR_COLETA' : false;
      lista.push({
        id: 'pc:' + k, tipo: 'ENTRADA', ref: k, data: data, faixa: ag ? faixaJanela(ag.janela) : 'dia_todo',
        janela: ag ? (JANELAS[ag.janela] || ag.janela || '') : '', situacao: situacao,
        titulo: nomeOrigem(p), numero: p.numeroFormatado || k,
        subtitulo: (previsto ? 'Previsão de Compras' : coletaKuryos ? 'Coleta Kuryos' : 'Entrega do fornecedor') + ' · ' + prog.itens + ' item(ns)',
        detalhes: {transportadora: ag && ag.transportadora || '', placa: ag && ag.placa || '', motorista: ag && ag.motorista || '',
          observacoes: ag && ag.observacoes || '', progresso: prog, coleta: ag && ag.coleta || null, statusPc: status,
          agendadoPor: ag && ag.agendadoPor || ''}
      });
    });

    Object.keys(agendasExpedicao || {}).forEach(function(k) {
      var a = agendasExpedicao[k] || {};
      if (a.status === 'CANCELADO') return;
      var concluido = a.status === 'EXPEDIDO', parcial = a.status === 'EXPEDIDO_PARCIAL';
      if (!concluido && !parcial && a.status !== 'AGENDADO') return;
      var data = data10(a.dataAgendada);
      if (concluido) {
        var viagens = Object.values(a.viagens || {}).map(function(v) { return data10(v.data); }).filter(Boolean).sort();
        data = viagens.length ? viagens[viagens.length - 1] : data;
        if (!incluirConcluidos) return;
      }
      if (!data) return;
      var paletes = a.paletes || [];
      var total = paletes.reduce(function(t, p) { return t + n(p.quantidade); }, 0);
      var falta = paletes.reduce(function(t, p) { return t + Math.max(n(p.quantidade) - n(p.embarcado), 0); }, 0);
      var fat = a.faturamento || {};
      var situacao = concluido ? 'CONCLUIDO' : parcial ? 'PARCIAL' : data < hoje ? 'ATRASADO' : 'AGENDADO';
      lista.push({
        id: 'pa:' + k, tipo: 'SAIDA', ref: k, data: data, faixa: faixaJanela(a.janela), janela: a.janela || '', situacao: situacao,
        titulo: a.cliente || 'Cliente', numero: Object.values(a.pedidos || {}).join(', '),
        subtitulo: (a.tipo === 'COLETA' ? 'Coleta FOB' : 'Entrega CIF') + ' · ' + paletes.length + ' palete(s) · ' + total.toLocaleString('pt-BR') + ' un',
        detalhes: {transportadora: a.transportadora || '', placa: a.placa || '', motorista: a.motorista || '', observacoes: a.observacoes || '',
          faturamento: fat.status || 'NAO_SOLICITADO', nfs: Object.values(fat.nfs || {}).map(function(x) { return x.numero + (x.serie ? '/' + x.serie : ''); }),
          aguardandoEmbarque: parcial ? falta : 0, viagens: Object.keys(a.viagens || {}).length, enderecoEntrega: a.enderecoEntrega || '',
          contatoCliente: a.contatoCliente || null, totalUnidades: total}
      });
    });

    var ordemFaixa = {manha: 0, tarde: 1, dia_todo: 2};
    return lista.sort(function(x, y) {
      return x.data.localeCompare(y.data) || ordemFaixa[x.faixa] - ordemFaixa[y.faixa] || x.tipo.localeCompare(y.tipo) || x.titulo.localeCompare(y.titulo);
    });
  }

  function filtrar(lista, filtros) {
    filtros = filtros || {};
    return lista.filter(function(e) {
      if (filtros.entradas === false && e.tipo === 'ENTRADA') return false;
      if (filtros.saidas === false && e.tipo === 'SAIDA') return false;
      return true;
    });
  }

  function porDia(lista) {
    var mapa = {};
    lista.forEach(function(e) { (mapa[e.data] = mapa[e.data] || []).push(e); });
    return mapa;
  }

  // Semanas (segunda a domingo) que cobrem o mês; dias de fora marcados.
  function gradeMes(ano, mes0) {
    var primeiro = iso(Date.UTC(ano, mes0, 1));
    var ultimo = iso(Date.UTC(ano, mes0 + 1, 0));
    var inicio = somarDias(primeiro, -diaSemana(primeiro));
    var fim = somarDias(ultimo, 6 - diaSemana(ultimo));
    var semanas = [], d = inicio;
    while (d <= fim) {
      var semana = [];
      for (var i = 0; i < 7; i++) { semana.push({data: d, doMes: +d.slice(5, 7) === mes0 + 1, dia: +d.slice(8, 10)}); d = somarDias(d, 1); }
      semanas.push(semana);
    }
    return {titulo: MESES[mes0] + ' de ' + ano, inicio: inicio, fim: fim, semanas: semanas};
  }

  function gradeSemana(dataRef) {
    var inicio = somarDias(dataRef, -diaSemana(dataRef));
    var dias = [];
    for (var i = 0; i < 7; i++) {
      var d = somarDias(inicio, i);
      dias.push({data: d, rotulo: DIAS[i] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7)});
    }
    var fim = dias[6].data;
    var titulo = inicio.slice(8, 10) + '/' + inicio.slice(5, 7) + ' a ' + fim.slice(8, 10) + '/' + fim.slice(5, 7) + '/' + fim.slice(0, 4);
    return {titulo: titulo, inicio: inicio, fim: fim, dias: dias};
  }

  function resumo(lista) {
    return lista.reduce(function(t, e) {
      t[e.tipo === 'ENTRADA' ? 'entradas' : 'saidas']++;
      if (e.situacao === 'ATRASADO') t.atrasados++;
      if (e.situacao === 'PARCIAL') t.parciais++;
      return t;
    }, {entradas: 0, saidas: 0, atrasados: 0, parciais: 0});
  }

  return {eventos: eventos, filtrar: filtrar, porDia: porDia, gradeMes: gradeMes, gradeSemana: gradeSemana, resumo: resumo,
    faixaJanela: faixaJanela, somarDias: somarDias, diaSemana: diaSemana, MESES: MESES, DIAS: DIAS, JANELAS: JANELAS};
});
