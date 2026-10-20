/* Liberação de linha pela Qualidade (19/10/2026) -- PLANO_QUALIDADE.md, A3.
   CK-4 Assepsia da linha de envase + CK-5 Setup / First article, por OP.

   Fluxo (spec do CQ 3.3/3.4 + POP 035):
     CK-4  EXECUCAO (operador/líder limpa e registra)
           → AGUARDANDO_QUALIDADE (Qualidade verifica) → APROVADO | REPROVADO
           ou DISPENSADA pela regra do POP 035 (mesma fórmula, mesmo dia, < 15 lotes)
     CK-5  só abre com o CK-4 aprovado ou dispensado
           EXECUCAO (Qualidade: line clearance, insumos, máquina, first article)
           → AGUARDANDO_LIDER (líder da linha assina com o próprio login) → APROVADO
           ou REPROVADO (com motivo; nova tentativa abre outra inspeção)
   A OP está liberada para produzir quando o CK-5 está APROVADO.

   Gravação:
     inspecoes_cq/{id}            a inspeção (modelo, versão usada, respostas, etapas)
     liberacao_linha/{opKey}      índice da OP: {linha, ck4:{id,status,dispensa}, ck5:{id,status}}
     assepsia_linhas/{linhaKey}   última assepsia da linha e quantos lotes desde ela
   Funções PURAS, testadas em run_liberacao_linha_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./checklists.js'));
  else root.LiberacaoLinha = factory(root.Checklists);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Checklists) {
  'use strict';

  var LIMITE_LOTES_PADRAO = 15; // POP 035: mesma fórmula, até 15 lotes sem lavar
  var ROTULO = {
    PENDENTE: 'Pendente', EXECUCAO: 'Em preenchimento', AGUARDANDO_QUALIDADE: 'Aguardando a Qualidade',
    AGUARDANDO_LIDER: 'Aguardando o líder', APROVADO: 'Liberado', REPROVADO: 'Reprovado', DISPENSADA: 'Dispensada (POP 035)'
  };

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function chave(s) { return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' '); }
  function chaveLinha(linha) { return chave(linha).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'SEM_LINHA'; }
  // Dia civil em Brasília (a fábrica), para "início de cada dia de operação".
  function diaBR(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /* Precisa de assepsia completa (CK-4) antes desta OP?
     reg = assepsia_linhas/{linha}; ativosLinha = equipamentos da linha.
     Regra do POP 035: sempre na troca de produto e no início de cada dia de
     operação; mesma fórmula, até `limite` lotes seguidos. Equipamento que
     voltou de manutenção depois da última assepsia também obriga. Na dúvida
     (sem registro) pede -- é o lado seguro. A "mesma fórmula" é comparada
     pelo SKU: dois SKUs com a mesma fórmula contam como troca (conservador). */
  function precisaAssepsia(op, reg, agoraIso, o) {
    o = o || {};
    var limite = o.limite > 0 ? o.limite : LIMITE_LOTES_PADRAO;
    var u = reg && reg.ultima;
    if (!u || !u.em) return {precisa: true, motivo: 'Primeira assepsia registrada desta linha.'};
    if (diaBR(u.em) !== diaBR(agoraIso)) return {precisa: true, motivo: 'Início do dia de operação (POP 035).'};
    if (chave(u.sku) !== chave(op && op.sku)) return {precisa: true, motivo: 'Troca de produto: a última assepsia foi para ' + (u.sku || '—') + '.'};
    var lotes = Number(reg.lotesDesde) || 0;
    if (lotes >= limite) return {precisa: true, motivo: lotes + ' lotes desde a última assepsia (limite ' + limite + ').'};
    var voltou = (o.ativosLinha || []).filter(function(a) { return a.situacaoDesde && a.situacaoDesde > u.em && a.situacao === 'OPERACIONAL'; });
    if (voltou.length) return {precisa: true, motivo: 'Equipamento voltou de manutenção: ' + voltou.map(function(a) { return a.codigo; }).join(', ') + '.'};
    var parado = (o.ativosLinha || []).filter(function(a) { return a.situacao === 'EM_MANUTENCAO'; });
    return {precisa: false, motivo: 'Mesma fórmula, mesmo dia: ' + lotes + ' de ' + limite + ' lotes desde a assepsia.' +
      (parado.length ? ' Atenção: ' + parado.map(function(a) { return a.codigo; }).join(', ') + ' em manutenção.' : '')};
  }

  /* Situação da OP: o que falta para a linha estar liberada. lib = liberacao_linha/{op};
     insp = {id: inspeção}. */
  function situacaoOp(lib, insp) {
    lib = lib || {};
    var i4 = lib.ck4 && lib.ck4.id ? (insp || {})[lib.ck4.id] : null;
    var i5 = lib.ck5 && lib.ck5.id ? (insp || {})[lib.ck5.id] : null;
    // Sem as inspeções carregadas (apontamento), vale o status copiado no índice.
    var s4 = lib.ck4 && lib.ck4.status === 'DISPENSADA' ? 'DISPENSADA' : (i4 ? i4.status : (lib.ck4 && lib.ck4.status) || 'PENDENTE');
    var s5 = i5 ? i5.status : (lib.ck5 && lib.ck5.status) || 'PENDENTE';
    var ck4ok = s4 === 'APROVADO' || s4 === 'DISPENSADA';
    var liberada = ck4ok && s5 === 'APROVADO';
    var falta = liberada ? null
      : !ck4ok ? (s4 === 'REPROVADO' ? 'Assepsia da linha reprovada: refazer a limpeza.' : s4 === 'AGUARDANDO_QUALIDADE' ? 'Assepsia aguardando a verificação da Qualidade.' : 'Falta a assepsia da linha (CK-4).')
      : s5 === 'AGUARDANDO_LIDER' ? 'First article aprovado; falta a assinatura do líder da linha.'
      : s5 === 'REPROVADO' ? 'First article reprovado: corrigir e fazer nova inspeção.'
      : 'Falta o setup / first article da Qualidade (CK-5).';
    return {ck4: s4, ck5: s5, ck4Liberado: ck4ok, liberada: liberada, falta: falta, insp4: i4, insp5: i5};
  }

  // Inspeção nova, presa à versão do modelo em uso.
  function novaInspecao(modeloId, modelo, ctx) {
    var v = Checklists.versaoAtual(modelo);
    if (!v) return {erro: 'O checklist ' + ((modelo && modelo.codigo) || '') + ' não tem versão publicada. A Qualidade precisa publicar o modelo antes.'};
    return {registro: {
      modeloId: modeloId, modeloCodigo: modelo.codigo, modeloNome: modelo.nome, versao: v.numero,
      opKey: ctx.opKey, lote: ctx.lote || null, sku: ctx.sku || null, produto: ctx.produto || null, linha: ctx.linha || null,
      nominal: ctx.nominal == null ? null : ctx.nominal, status: 'EXECUCAO', respostas: {},
      criadaEm: ctx.agora, criadaPor: ctx.por || null, tentativa: ctx.tentativa || 1
    }, itens: v.itens};
  }

  /* Transições. Todas devolvem {erro} ou {updates} com caminhos planos (um
     update só, atômico). `itens` = os da versão usada pela inspeção. */
  function base(id) { return 'inspecoes_cq/' + id + '/'; }

  function concluirExecucao(id, insp, itens, o) {
    if (insp.status !== 'EXECUCAO') return {erro: 'Esta etapa já foi concluída.'};
    var aval = Checklists.avaliar(itens, insp.respostas, {papel: 'EXECUTOR'});
    if (aval.pendentes.length) return {erro: 'Faltam ' + aval.pendentes.length + ' pergunta(s) da limpeza.'};
    if (aval.faltaFoto.length) return {erro: 'Falta foto em ' + aval.faltaFoto.length + ' pergunta(s).'};
    if (aval.ncs.length) return {erro: 'Há etapa da limpeza marcada como não feita ou fora do limite. Complete a limpeza antes de chamar a Qualidade.'};
    var u = {};
    u[base(id) + 'status'] = 'AGUARDANDO_QUALIDADE';
    u[base(id) + 'execucao'] = {por: o.por || null, uid: o.uid || null, em: o.agora};
    u['liberacao_linha/' + insp.opKey + '/ck4/status'] = 'AGUARDANDO_QUALIDADE';
    return {updates: u};
  }

  /* A Qualidade decide. CK-4: aprova (atualiza a assepsia da linha) ou
     reprova. CK-5: aprova o first article -> aguarda o líder; ou reprova.
     Aprovar exige tudo respondido e nenhum NC; reprovar exige motivo. */
  function decidirQualidade(id, insp, itens, decisao, o) {
    o = o || {};
    var esperado = insp.modeloCodigo === 'CK-4' ? 'AGUARDANDO_QUALIDADE' : 'EXECUCAO';
    if (insp.status !== esperado) return {erro: insp.modeloCodigo === 'CK-4' && insp.status === 'EXECUCAO' ? 'A limpeza ainda não foi concluída por quem executa.' : 'Esta inspeção não está aguardando a Qualidade.'};
    var aval = Checklists.avaliar(itens, insp.respostas, {nominalProduto: insp.nominal});
    var ck = insp.modeloCodigo === 'CK-4' ? 'ck4' : 'ck5';
    var u = {};
    u[base(id) + 'verificacao'] = {por: o.por || null, uid: o.uid || null, em: o.agora};
    u[base(id) + 'resultado'] = {pendentes: aval.pendentes.length, ncs: aval.ncs, criticosNC: aval.criticosNC};
    if (decisao === 'REPROVAR') {
      if (!txt(o.motivo)) return {erro: 'Escreva o motivo da reprovação e a ação a tomar.'};
      u[base(id) + 'status'] = 'REPROVADO';
      u[base(id) + 'motivoReprovacao'] = txt(o.motivo);
      u['liberacao_linha/' + insp.opKey + '/' + ck + '/status'] = 'REPROVADO';
      return {updates: u};
    }
    if (aval.pendentes.length) return {erro: 'Faltam ' + aval.pendentes.length + ' pergunta(s) para liberar.'};
    if (aval.faltaFoto.length) return {erro: 'Falta foto em ' + aval.faltaFoto.length + ' pergunta(s).'};
    if (aval.ncs.length) return {erro: 'Há ' + aval.ncs.length + ' item(ns) não conforme(s): não dá para liberar. Corrija ou reprove com o motivo.'};
    if (ck === 'ck4') {
      u[base(id) + 'status'] = 'APROVADO';
      u['liberacao_linha/' + insp.opKey + '/ck4/status'] = 'APROVADO';
      var lk = chaveLinha(insp.linha);
      u['assepsia_linhas/' + lk + '/linha'] = insp.linha || null;
      u['assepsia_linhas/' + lk + '/ultima'] = {inspecaoId: id, em: o.agora, sku: insp.sku || null, lote: insp.lote || null};
      u['assepsia_linhas/' + lk + '/lotesDesde'] = 0;
    } else {
      u[base(id) + 'status'] = 'AGUARDANDO_LIDER';
      u['liberacao_linha/' + insp.opKey + '/ck5/status'] = 'AGUARDANDO_LIDER';
    }
    return {updates: u};
  }

  /* O líder da linha assina com o próprio login (spec 3.4, etapa 7). Não pode
     ser a mesma pessoa que aprovou pela Qualidade. Liberado: conta mais um
     lote desde a assepsia (regra dos 15). */
  function assinarLider(id, insp, o) {
    o = o || {};
    if (insp.status !== 'AGUARDANDO_LIDER') return {erro: 'O first article ainda não foi aprovado pela Qualidade.'};
    if (o.uid && insp.verificacao && insp.verificacao.uid === o.uid) return {erro: 'A assinatura do líder tem que ser de outra pessoa (quem aprovou foi a Qualidade).'};
    var u = {};
    u[base(id) + 'status'] = 'APROVADO';
    u[base(id) + 'lider'] = {por: o.por || null, uid: o.uid || null, em: o.agora};
    u['liberacao_linha/' + insp.opKey + '/ck5/status'] = 'APROVADO';
    u['liberacao_linha/' + insp.opKey + '/liberadaEm'] = o.agora;
    var lk = chaveLinha(insp.linha);
    u['assepsia_linhas/' + lk + '/lotesDesde'] = (Number(o.lotesDesdeAtual) || 0) + 1;
    return {updates: u};
  }

  // Assepsia dispensada pela regra (registrada, para auditoria).
  function dispensarAssepsia(opKey, linha, motivo, o) {
    var u = {};
    u['liberacao_linha/' + opKey + '/linha'] = linha || null;
    u['liberacao_linha/' + opKey + '/ck4'] = {status: 'DISPENSADA', motivo: motivo, em: o.agora, por: o.por || null};
    return {updates: u};
  }

  /* Portão da ALOCAÇÃO (20/10, pedido do usuário: "o correto seria ela ser
     necessária antes de alocar uma nova OP"). A linha só recebe a OP nova
     limpa: assepsia aprovada para esta OP, ou dispensada pela regra do POP 035
     (mesma fórmula, mesmo dia, dentro do limite). O first article fica para
     depois -- ele precisa do setup da OP nova (codificação, insumos dela).
     Devolve {ok, motivo?, aviso?, dispensa?}: `dispensa` = o motivo a gravar
     quando a regra dispensa e ainda não há registro (auditoria). */
  function podeAlocar(op, lib, reg, agoraIso, o, trava) {
    if (op && (op.tipoOrdem === 'RETRABALHO' || op.tipo === 'RETRABALHO')) return {ok: true};
    var ck4 = (lib && lib.ck4) || {};
    if (ck4.status === 'APROVADO' || ck4.status === 'DISPENSADA') return {ok: true};
    var pa = precisaAssepsia(op, reg, agoraIso, o);
    if (!pa.precisa) return {ok: true, dispensa: pa.motivo};
    var falta = 'a linha precisa de assepsia antes de receber esta OP (' + pa.motivo.replace(/\.$/, '') + ')' +
      (ck4.status ? ' — assepsia ' + (ROTULO[ck4.status] || ck4.status).toLowerCase() : '') + '.';
    return trava ? {ok: false, motivo: falta} : {ok: true, aviso: falta};
  }

  /* Portão do envase (form.html). trava = chave em Ajustes. Sem trava, só
     avisa. OP de retrabalho não tem setup de envase próprio: passa. */
  function podeProduzir(op, lib, insp, trava) {
    if (op && (op.tipoOrdem === 'RETRABALHO' || op.tipo === 'RETRABALHO')) return {ok: true, aviso: null};
    var s = situacaoOp(lib, insp);
    if (s.liberada) return {ok: true, aviso: null};
    return trava ? {ok: false, motivo: s.falta} : {ok: true, aviso: s.falta};
  }

  /* Peso nominal do produto em gramas, para o first article: produto em g/kg
     já é massa; em ml/L vira massa pela densidade. Sem densidade, null (a
     inspetora informa). */
  function nominalGramas(produto) {
    if (!produto) return null;
    var vol = Number(produto.volume), un = txt(produto.unidadeVolume).toLowerCase(), d = Number(produto.densidadeGranel);
    if (!(vol > 0)) return null;
    if (un === 'g') return vol;
    if (un === 'kg') return vol * 1000;
    if (!(d > 0)) return null;
    if (un === 'ml') return Math.round(vol * d * 100) / 100;
    if (un === 'l') return Math.round(vol * 1000 * d * 100) / 100;
    return null;
  }

  return {
    LIMITE_LOTES_PADRAO: LIMITE_LOTES_PADRAO, ROTULO: ROTULO, chaveLinha: chaveLinha, diaBR: diaBR,
    precisaAssepsia: precisaAssepsia, situacaoOp: situacaoOp, novaInspecao: novaInspecao,
    concluirExecucao: concluirExecucao, decidirQualidade: decidirQualidade, assinarLider: assinarLider,
    dispensarAssepsia: dispensarAssepsia, podeAlocar: podeAlocar, podeProduzir: podeProduzir, nominalGramas: nominalGramas
  };
});
