/* ══════════════════════════════════════════════════════════════════════
   CARGAS DE PA — em que etapa está cada carga agendada

   Pedido do usuário (29/09): a tela única da Expedição misturava
   agendamento, faturamento e saída ("não está fluido, está meio
   conflitante"). Separada em três:
     1. Expedição (expedicao.html)      — monta e agenda a carga;
     2. Faturamento (faturamento.html)  — solicita ao Financeiro e registra a NF;
     3. Acompanhamento (cargas.html)    — a carga até sair, com a NF quando
                                          emitida, o carregamento e as viagens.
   As três leem agendamentos_expedicao/{k}; este módulo é a régua comum de
   "em que pé está a carga". Funções PURAS, sem DOM nem Firebase.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CargasPA = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var ATIVAS = ['AGENDADO', 'EXPEDIDO_PARCIAL'];
  var ETAPAS = {
    AGENDADA: {rotulo: 'Agendada — faturamento não solicitado', curto: 'Agendada', ordem: 1, cor: 'cinza'},
    FATURAMENTO_SOLICITADO: {rotulo: 'Faturamento solicitado — aguardando NF', curto: 'Aguardando NF', ordem: 2, cor: 'laranja'},
    FATURADA: {rotulo: 'Faturada — pronta para carregar', curto: 'Pronta para carregar', ordem: 3, cor: 'azul'},
    AGUARDANDO_EMBARQUE: {rotulo: 'Saiu em parte — saldo aguardando embarque', curto: 'Aguardando embarque', ordem: 4, cor: 'laranja'},
    EXPEDIDA: {rotulo: 'Expedida', curto: 'Expedida', ordem: 5, cor: 'verde'},
    CANCELADA: {rotulo: 'Cancelada', curto: 'Cancelada', ordem: 6, cor: 'vermelho'}
  };

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function pendente(p) { return Math.max(n(p && p.quantidade) - n(p && p.embarcado), 0); }
  function ativa(a) { return !!a && ATIVAS.indexOf(a.status) !== -1; }
  function fat(a) { return (a && a.faturamento) || {}; }

  function nfs(a) {
    var lista = fat(a).nfs || {};
    return Object.keys(lista).map(function(k) { return lista[k]; }).filter(Boolean)
      .sort(function(x, y) { return String(x.registradoEm || '').localeCompare(String(y.registradoEm || '')); })
      .map(function(x) {
        return {numero: x.numero, serie: x.serie || '', valor: n(x.valor), emitidaEm: x.emitidaEm || '',
          chaveNfe: x.chaveNfe || '', registradoPor: x.registradoPor || '', registradoEm: x.registradoEm || '',
          texto: x.numero + (x.serie ? '/' + x.serie : '')};
      });
  }
  function faturada(a) { return fat(a).status === 'FATURADO' && nfs(a).length > 0; }

  function etapa(a) {
    var c;
    if (!a) c = 'AGENDADA';
    else if (a.status === 'CANCELADO') c = 'CANCELADA';
    else if (a.status === 'EXPEDIDO') c = 'EXPEDIDA';
    else if (a.status === 'EXPEDIDO_PARCIAL') c = 'AGUARDANDO_EMBARQUE';
    else if (faturada(a)) c = 'FATURADA';
    else if (fat(a).status === 'SOLICITADO') c = 'FATURAMENTO_SOLICITADO';
    else c = 'AGENDADA';
    return Object.assign({codigo: c}, ETAPAS[c]);
  }

  // O que cada tela pode fazer com a carga -- a mesma regra do servidor,
  // dita antes do clique.
  function acoes(a) {
    var e = etapa(a).codigo, f = fat(a);
    return {
      // Faturamento: carga que ainda não saiu. Carga já faturada aceita outra
      // NF (por pedido, por exemplo), como o servidor já permite.
      solicitarFaturamento: e === 'AGENDADA',
      registrarNf: e === 'AGENDADA' || e === 'FATURAMENTO_SOLICITADO' || e === 'FATURADA' || e === 'AGUARDANDO_EMBARQUE',
      // Saída física só com NF: a carga não roda sem nota (usuário, 29/09:
      // "uma vez agendada a carga, ele vai para a página de faturamento").
      carregar: e === 'FATURADA' || e === 'AGUARDANDO_EMBARQUE',
      editarTransporte: ativa(a),
      cancelar: a && a.status === 'AGENDADO' && f.status !== 'FATURADO'
    };
  }

  function totais(a) {
    var ps = (a && a.paletes) || [];
    var t = {paletes: ps.length, unidades: 0, embarcado: 0, pendente: 0, viagens: Object.keys((a && a.viagens) || {}).length};
    ps.forEach(function(p) { t.unidades += n(p.quantidade); t.embarcado += n(p.embarcado); t.pendente += pendente(p); });
    return t;
  }

  function ultimaSolicitacao(a) {
    var s = fat(a).solicitacoes || {};
    var lista = Object.keys(s).map(function(k) { return s[k]; }).filter(Boolean)
      .sort(function(x, y) { return String(x.em || '').localeCompare(String(y.em || '')); });
    return lista[lista.length - 1] || null;
  }

  /* Linha do tempo da carga, do agendamento à última viagem. */
  function linhaDoTempo(a) {
    if (!a) return [];
    var ev = [];
    var add = function(em, tipo, texto, por) { if (em) ev.push({em: em, tipo: tipo, texto: texto, por: por || ''}); };
    add(a.criadoEm, 'AGENDADA', 'Carga agendada para ' + (a.dataAgendada || '—') + (a.janela ? ' ' + a.janela : ''), a.criadoPor);
    var sols = fat(a).solicitacoes || {};
    Object.keys(sols).forEach(function(k) {
      var s = sols[k] || {};
      add(s.em, 'FATURAMENTO_SOLICITADO', 'Faturamento solicitado ao Financeiro' + (s.totalValor ? ' (R$ ' + n(s.totalValor).toFixed(2).replace('.', ',') + ')' : ''), s.por);
    });
    nfs(a).forEach(function(x) {
      add(x.registradoEm, 'NF', 'NF ' + x.texto + ' registrada' + (x.emitidaEm ? ', emitida em ' + x.emitidaEm : ''), x.registradoPor);
    });
    var vs = (a.viagens) || {};
    Object.keys(vs).forEach(function(k) {
      var v = vs[k] || {};
      add(v.em, 'VIAGEM', 'Viagem ' + v.viagem + ': ' + n(v.unidades).toLocaleString('pt-BR') + ' un saíram' +
        (v.placa ? ' (placa ' + v.placa + ')' : '') + (v.aguardandoEmbarque ? ' · ' + n(v.aguardandoEmbarque).toLocaleString('pt-BR') + ' un aguardando embarque' : ''), v.por);
    });
    if (a.cancelamento) add(a.cancelamento.em, 'CANCELADA', 'Cancelada: ' + (a.cancelamento.motivo || ''), a.cancelamento.por);
    return ev.sort(function(x, y) { return String(x.em).localeCompare(String(y.em)); });
  }

  function textoBusca(a) {
    return [a.cliente, Object.keys(a.pedidos || {}).map(function(k) { return a.pedidos[k]; }).join(' '), a.transportadora, a.motorista, a.placa,
      nfs(a).map(function(x) { return x.texto; }).join(' '),
      ((a.paletes) || []).map(function(p) { return [p.sku, p.descricao, p.identificadorPalete].join(' '); }).join(' ')]
      .join(' ').toLocaleLowerCase('pt-BR');
  }

  /* Lista para as telas. filtro: 'ativas' | 'faturamento' (o que o
     Faturamento tem a fazer) | um código de etapa | 'todas'. */
  function listar(agendas, filtro, busca) {
    var q = String(busca || '').toLocaleLowerCase('pt-BR').trim();
    return Object.keys(agendas || {}).map(function(k) { return Object.assign({_key: k}, agendas[k]); })
      .filter(function(a) {
        var e = etapa(a).codigo;
        var ok = filtro === 'todas' ? true
          : filtro === 'ativas' ? ativa(a)
          : filtro === 'faturamento' ? (e === 'AGENDADA' || e === 'FATURAMENTO_SOLICITADO')
          : e === filtro;
        return ok && (!q || textoBusca(a).indexOf(q) !== -1);
      })
      .sort(function(x, y) {
        var ex = etapa(x).ordem, ey = etapa(y).ordem;
        if (ativa(x) !== ativa(y)) return ativa(x) ? -1 : 1;
        if (!ativa(x)) return String(y.atualizadoEm || '').localeCompare(String(x.atualizadoEm || ''));
        return String(x.dataAgendada || '').localeCompare(String(y.dataAgendada || '')) || ex - ey;
      });
  }

  function contagem(agendas) {
    var c = {};
    Object.keys(ETAPAS).forEach(function(k) { c[k] = 0; });
    Object.keys(agendas || {}).forEach(function(k) { c[etapa(agendas[k]).codigo]++; });
    return c;
  }

  return {ATIVAS: ATIVAS, ETAPAS: ETAPAS, pendente: pendente, ativa: ativa, nfs: nfs, faturada: faturada,
    etapa: etapa, acoes: acoes, totais: totais, ultimaSolicitacao: ultimaSolicitacao, linhaDoTempo: linhaDoTempo,
    listar: listar, contagem: contagem};
});
