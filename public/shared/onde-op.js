/* Onde está a OP (pedido do usuário, 30/09): "quando tentarem apontar uma OP
   no envase, caso não disponível, deve mostrar onde está (manipulando,
   aguardando qualidade...)". Antes a OP bloqueada simplesmente sumia da lista
   de alocação, e o operador ficava sem saber se ela existia, se estava na
   Manipulação ou na Qualidade, ou aberta em outra linha.

   onde(op, {tipo, Manipulacao}) -> {disponivel, codigo, setor, texto}
     tipo: 'linha' (envase, padrão) ou 'rotulagem'. A rotulagem não depende do
     bulk (rotula frasco antes do envase), então só olha status e alocação.
   A regra de liberação do bulk continua sendo Manipulacao.podeEnvasar -- este
   módulo só traduz o bloqueio em "onde está".
   Testado em run_onde_op_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OndeOp = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dataHora(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function separacao(op) {
    if (op.separacaoConcluida) return 'materiais já separados';
    if (op.separacaoParcial) return 'separação de materiais parcial';
    return 'separação de materiais ainda não feita';
  }

  // Estado do bulk -> onde a OP está. Setor é o que o operador procura
  // ("está na Manipulação", "está na Qualidade").
  var BULK = {
    CORRECAO_ABERTA: ['MANIPULACAO', 'Manipulação', 'correção do bulk aberta, aguardando nova pesagem'],
    AGUARDANDO_PESAGEM: ['MANIPULACAO', 'Manipulação', 'aguardando pesagem'],
    PESADO: ['MANIPULACAO', 'Manipulação', 'pesada, aguardando conferência da pesagem'],
    CONFERIDO: ['MANIPULACAO', 'Manipulação', 'pesagem conferida, aguardando manipular'],
    EM_MANIPULACAO: ['MANIPULACAO', 'Manipulação', 'manipulando o bulk'],
    AGUARDANDO_CQ: ['QUALIDADE', 'Qualidade', 'bulk aguardando análise'],
    REPROVADO: ['QUALIDADE', 'Qualidade', 'bulk reprovado, aguardando decisão/correção']
  };

  function onde(op, opcoes) {
    var o = opcoes || {};
    var tipo = o.tipo === 'rotulagem' ? 'rotulagem' : 'linha';
    var M = o.Manipulacao || (typeof Manipulacao !== 'undefined' ? Manipulacao : null); // eslint-disable-line no-undef
    if (!op) return {disponivel: false, codigo: 'NAO_ENCONTRADA', setor: '', texto: 'OP não encontrada — confirme se já foi emitida.'};
    var status = String(op.status || '');
    if (status === 'Cancelado') {
      return {disponivel: false, codigo: 'CANCELADA', setor: 'PCP', texto: 'Cancelada' + (op.motivoCancelamento ? ' (' + op.motivoCancelamento + ')' : '')};
    }
    if (status === 'Aguardando Confirmação') {
      return {disponivel: false, codigo: 'AGUARDANDO_PCP', setor: 'PCP', texto: 'Já fechada — aguardando confirmação do PCP'};
    }
    if (status === 'Concluído') return {disponivel: false, codigo: 'CONCLUIDA', setor: 'PCP', texto: 'Já concluída'};
    var campoIni = tipo === 'rotulagem' ? 'abertaDesdeRot' : 'abertaDesde';
    var campoNome = tipo === 'rotulagem' ? 'abertaRotulagem' : 'abertaLinha';
    if (op[campoIni]) {
      var quando = dataHora(op[campoIni]);
      return {disponivel: false, codigo: 'ABERTA', setor: op[campoNome] || '',
        texto: 'Já está aberta ' + (op[campoNome] ? 'na ' + op[campoNome] : (tipo === 'rotulagem' ? 'na rotulagem' : 'em uma linha')) + (quando ? ' desde ' + quando : '')};
    }
    if (tipo === 'linha' && M) {
      var r = M.podeEnvasar(op);
      if (!r.ok) {
        var b = r.estado && BULK[r.estado];
        if (b) return {disponivel: false, codigo: b[0], setor: b[1], texto: 'Na ' + b[1] + ' — ' + b[2]};
        return {disponivel: false, codigo: 'SEM_BULK', setor: 'Manipulação',
          texto: 'Ainda não entrou na Manipulação (' + separacao(op) + ')'};
      }
    }
    return {disponivel: true, codigo: 'DISPONIVEL', setor: '', texto: 'Disponível'};
  }

  // Resumo por setor para a linha de aviso da lista: "3 na Manipulação,
  // 1 na Qualidade".
  function resumo(situacoes) {
    var cont = {}, ordem = [];
    (situacoes || []).forEach(function(s) {
      if (!s || s.disponivel) return;
      var chave = s.codigo === 'ABERTA' ? 'aberta em outra linha' : s.codigo === 'SEM_BULK' ? 'sem bulk iniciado'
        : s.setor ? 'na ' + s.setor : s.codigo.toLowerCase();
      if (!(chave in cont)) { cont[chave] = 0; ordem.push(chave); }
      cont[chave]++;
    });
    return ordem.map(function(k) { return cont[k] + ' ' + k; }).join(', ');
  }

  return {onde: onde, resumo: resumo};
});
