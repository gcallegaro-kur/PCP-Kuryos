/* Sequência por setor — a fila de cada setor, na ordem do PCP, com início
   e fim estimados.

   Pedido do usuário (29/09): "uma tela de consulta de próximas ordens que
   serão feitas, cada setor poderá consultar (separação - logística; envase;
   manipulação; e rotulagem)". Decisões dele na mesma conversa:
   - a ordem é do SETOR inteiro, não de uma pessoa;
   - as ordens nascem no Emitir OP -- a OP já traz as fichas de cada setor,
     então aqui não se cria registro novo: a etapa de cada setor é LIDA da
     OP (separacaoConcluida, fase da manipulação, produzidoLinha,
     produzidoRotulagem). Guardar uma cópia do estado criaria duas verdades;
   - o PCP ordena à mão, e a ordem aparece no Planejamento com a estimativa
     de término, que se atualiza a cada apontamento: programação por linha
     de envase, por rotuladora e da manipulação (por reator, no futuro).

   O que é gravado é só a decisão do PCP:
     sequenciamento/ordem/{setor}/{opKey} = {recurso, posicao}
     sequenciamento/ritmos/{setor}/{recursoKey} = {unPorHora | horasPorLote | horasPorOp}

   Funções puras, testadas em run_sequencia_setor_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SequenciaSetor = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  /* `ritmo` é o parâmetro que o PCP informa quando o cadastro não tem de
     onde tirar: rotuladora em un/h, manipulação em horas por lote,
     separação em horas por OP. O envase usa o prodHoraRef do produto. */
  var SETORES = {
    separacao: {rotulo: 'Separação', recursoUnico: 'Separação', ritmo: 'horasPorOp', ritmoRotulo: 'h por OP'},
    manipulacao: {rotulo: 'Manipulação', recursoUnico: 'Manipulação', ritmo: 'horasPorLote', ritmoRotulo: 'h por lote'},
    envase: {rotulo: 'Envase', semRecurso: 'Sem linha', ritmo: 'unPorHora', ritmoRotulo: 'un/h'},
    rotulagem: {rotulo: 'Rotulagem', semRecurso: 'Sem rotuladora', ritmo: 'unPorHora', ritmoRotulo: 'un/h'}
  };
  var ORDEM_SETORES = ['separacao', 'manipulacao', 'envase', 'rotulagem'];

  // Manipulação termina quando o bulk vai para a Qualidade; daí em diante
  // (análise, liberado, reprovado) não é mais trabalho do setor.
  var MANIPULACAO_FORA_DO_SETOR = {AGUARDANDO_CQ: true, LIBERADO: true, REPROVADO: true};

  function n(v) { var x = Number(v); return isFinite(x) ? x : null; }
  function txt(v) { return String(v == null ? '' : v).trim(); }
  function chave(v) { return txt(v).replace(/[.#$\[\]\/]/g, '_') || '_'; }

  function opAtiva(op) {
    var st = txt(op && op.status);
    return !!op && st !== 'Concluído' && st !== 'Cancelado' && st !== 'Aguardando Confirmação';
  }
  function ehRetrabalho(op) { return !!op && (op.tipoOrdem === 'RETRABALHO' || op.tipo === 'RETRABALHO'); }
  function produzidoLinha(op) { return n(op.produzidoLinha) != null ? n(op.produzidoLinha) : (n(op.produzido) || 0); }

  /* A etapa de um setor numa OP, ou null quando não se aplica ou já saiu
     do setor. ctx.temRotulagem(op): a OP leva rótulo (a tela resolve pela
     lista de materiais da OP, shared/perdas-etapa.js). */
  function etapa(setor, op, ctx) {
    var c = ctx || {};
    if (!opAtiva(op)) return null;
    var qtd = n(op.qtdPlanejada) || 0;
    if (setor === 'separacao') {
      if (op.separacaoConcluida) return null;
      return {emAndamento: !!op.separacaoParcial, restante: 1, unidade: 'OP',
        status: op.separacaoParcial ? 'Separação parcial' : 'A separar'};
    }
    if (setor === 'manipulacao') {
      if (!txt(op.formulaVersao) || ehRetrabalho(op)) return null;
      var fase = op.manipulacao || null;
      var st = fase ? (txt(fase.status) || 'AGUARDANDO_PESAGEM') : null;
      if (st && MANIPULACAO_FORA_DO_SETOR[st]) return null;
      // OP antiga, de antes do módulo, que já envasou: o bulk foi feito por fora.
      if (!fase && (produzidoLinha(op) > 0 || op.setupFim)) return null;
      return {emAndamento: !!st, restante: 1, unidade: 'lote',
        status: st ? (c.rotuloManipulacao ? c.rotuloManipulacao(st) : st) : 'Não iniciada'};
    }
    if (setor === 'envase') {
      var faltaEnv = Math.max(qtd - produzidoLinha(op), 0);
      if (!faltaEnv) return null;
      return {emAndamento: !!op.abertaDesde, restante: faltaEnv, unidade: 'un',
        status: op.abertaDesde ? 'Envasando' : (produzidoLinha(op) > 0 ? 'Envase parcial' : 'A envasar')};
    }
    if (setor === 'rotulagem') {
      if (!(c.temRotulagem && c.temRotulagem(op))) return null;
      var feito = n(op.produzidoRotulagem) || 0;
      var faltaRot = Math.max(qtd - feito, 0);
      if (!faltaRot) return null;
      return {emAndamento: !!op.abertaDesdeRot, restante: faltaRot, unidade: 'un',
        status: op.abertaDesdeRot ? 'Rotulando' : (feito > 0 ? 'Rotulagem parcial' : 'A rotular')};
    }
    return null;
  }

  /* Recurso onde a ordem está. O que está RODANDO vence o plano: se a
     rotuladora 2 abriu a OP que o PCP pôs na 1, a fila mostra a 2. */
  function recursoDe(setor, op, decisao) {
    var d = decisao || {};
    var cfg = SETORES[setor];
    if (cfg.recursoUnico) return txt(d.recurso) || cfg.recursoUnico;
    if (setor === 'envase') return (op.abertaDesde && txt(op.abertaLinha)) || txt(d.recurso) || txt(op.linha) || cfg.semRecurso;
    return (op.abertaDesdeRot && txt(op.abertaRotulagem)) || txt(d.recurso) || cfg.semRecurso;
  }

  function comparar(a, b) {
    if (a.emAndamento !== b.emAndamento) return a.emAndamento ? -1 : 1;
    // Envase já programado na grade horária do Planejamento: a grade é a
    // programação detalhada e manda na ordem -- a sequência não a contradiz.
    if (!!a.naGrade !== !!b.naGrade) return a.naGrade ? -1 : 1;
    if (a.naGrade && b.naGrade && a.dataInicioPlanejada !== b.dataInicioPlanejada) {
      return a.dataInicioPlanejada < b.dataInicioPlanejada ? -1 : 1;
    }
    var pa = a.posicao == null ? Infinity : a.posicao, pb = b.posicao == null ? Infinity : b.posicao;
    if (pa !== pb) return pa - pb;
    var ea = txt(a.dataEmissao), eb = txt(b.dataEmissao);
    if (ea !== eb) return ea < eb ? -1 : 1;
    return a.lote < b.lote ? -1 : a.lote > b.lote ? 1 : 0;
  }

  /* Fila do setor: [{recurso, itens: [...]}], recursos na ordem do cadastro
     (ctx.recursos[setor]) e, no fim, os que só aparecem nas OPs (ex.: "Sem
     linha"). `ordem` = sequenciamento/ordem/{setor}. */
  function fila(setor, ops, ordem, ctx) {
    var c = ctx || {};
    var decisoes = ordem || {};
    var porRecurso = {};
    Object.keys(ops || {}).forEach(function(opKey) {
      var op = ops[opKey];
      var e = etapa(setor, op, c);
      if (!e) return;
      var d = decisoes[opKey] || {};
      var recurso = recursoDe(setor, op, d);
      var naGrade = setor === 'envase' && !e.emAndamento && !!txt(op.dataInicioPlanejada);
      (porRecurso[recurso] = porRecurso[recurso] || []).push({
        opKey: opKey, lote: txt(op.lote) || opKey, produto: txt(op.produto || op.produtoNome), sku: txt(op.sku),
        cliente: txt(op.cliente), qtdPlanejada: n(op.qtdPlanejada) || 0,
        restante: e.restante, unidade: e.unidade, emAndamento: e.emAndamento, status: e.status,
        recurso: recurso, posicao: n(d.posicao), naGrade: naGrade,
        dataInicioPlanejada: txt(op.dataInicioPlanejada) || null, dataEmissao: txt(op.dataEmissao) || null
      });
    });
    var nomes = ((c.recursos || {})[setor] || []).map(txt).filter(Boolean);
    if (SETORES[setor].recursoUnico && nomes.indexOf(SETORES[setor].recursoUnico) < 0) nomes.unshift(SETORES[setor].recursoUnico);
    Object.keys(porRecurso).sort().forEach(function(r) { if (nomes.indexOf(r) < 0) nomes.push(r); });
    return nomes.map(function(r) {
      var itens = (porRecurso[r] || []).sort(comparar);
      itens.forEach(function(it, i) { it.ordem = i + 1; it.movel = !it.emAndamento && !it.naGrade; });
      return {recurso: r, itens: itens};
    }).filter(function(g) { return g.itens.length || nomes.indexOf(g.recurso) >= 0; });
  }

  /* Mover uma ordem uma casa (delta -1/+1) dentro do recurso. Devolve os
     caminhos a gravar -- PLANOS, nunca um objeto aninhado (update aninhado
     no RTDB apaga o resto do nó; já custou caro aqui). Renumera só as
     móveis: em andamento e já na grade não são do PCP reordenar aqui. */
  function mover(grupo, opKey, delta, setor) {
    var moveis = grupo.itens.filter(function(i) { return i.movel; }).map(function(i) { return i.opKey; });
    var idx = moveis.indexOf(opKey);
    var alvo = idx + delta;
    if (idx < 0 || alvo < 0 || alvo >= moveis.length) return null;
    moveis.splice(alvo, 0, moveis.splice(idx, 1)[0]);
    var u = {};
    moveis.forEach(function(k, i) {
      u['sequenciamento/ordem/' + setor + '/' + k + '/posicao'] = i + 1;
      u['sequenciamento/ordem/' + setor + '/' + k + '/recurso'] = grupo.recurso;
    });
    return u;
  }
  // Mandar a ordem para outro recurso: entra no fim da fila de lá.
  function trocarRecurso(grupoDestino, opKey, setor) {
    var ultimo = 0;
    (grupoDestino && grupoDestino.itens || []).forEach(function(i) { if (i.posicao != null && i.posicao > ultimo) ultimo = i.posicao; });
    var u = {};
    u['sequenciamento/ordem/' + setor + '/' + opKey + '/recurso'] = grupoDestino.recurso;
    u['sequenciamento/ordem/' + setor + '/' + opKey + '/posicao'] = Math.max(ultimo, (grupoDestino.itens || []).length) + 1;
    return u;
  }

  /* Duração de uma ordem, em horas. Envase: prodHoraRef do produto; se a
     linha também tem ritmo informado, vale o MENOR -- capacidade sempre
     pelo valor conservador (apontamento lança lote inteiro como se fosse
     uma hora e infla a média; prazo que não se cumpre é pior que folga). */
  function duracao(setor, item, ritmos, ctx) {
    var r = ((ritmos || {})[setor] || {})[chave(item.recurso)] || {};
    if (setor === 'separacao' || setor === 'manipulacao') {
      var h = n(r[SETORES[setor].ritmo]);
      return h > 0 ? {horas: h * item.restante, fonte: 'ritmo do recurso'} : null;
    }
    var cands = [];
    if (setor === 'envase') {
      var ref = ctx && ctx.prodHoraRef ? n(ctx.prodHoraRef(item)) : null;
      if (ref > 0) cands.push({v: ref, fonte: 'prodHoraRef do produto'});
    }
    if (n(r.unPorHora) > 0) cands.push({v: n(r.unPorHora), fonte: 'ritmo do recurso'});
    if (!cands.length) return null;
    cands.sort(function(a, b) { return a.v - b.v; });
    return {horas: item.restante / cands[0].v, fonte: cands[0].fonte, unPorHora: cands[0].v};
  }

  /* ── Calendário: horas de trabalho do turno ──
     Mesma regra de horasEPausasDoDia (planejamento.html): turnos do
     cadastro (ou o turno fixo), fim diferente às sextas, pausa fora, dias
     da semana e feriados do Planejamento, turnos extras somados. */
  function horaNum(hhmm, arredCima) {
    var p = txt(hhmm).split(':');
    var h = parseInt(p[0], 10);
    if (isNaN(h)) return null;
    return h + (arredCima && parseInt(p[1] || '0', 10) > 0 ? 1 : 0);
  }
  function faixa(ini, fimExcl) {
    var out = [], h = ((ini % 24) + 24) % 24, fim = ((fimExcl % 24) + 24) % 24, guard = 0;
    while (h !== fim && guard < 24) { out.push(h); h = (h + 1) % 24; guard++; }
    return out;
  }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function horasUteisDoDia(data, cal) {
    var c = cal || {};
    var dow = data.getDay() === 0 ? 7 : data.getDay();
    var dias = c.diasSemana && c.diasSemana.length ? c.diasSemana : [1, 2, 3, 4, 5];
    var ativas = {}, pausas = {};
    var util = dias.indexOf(dow) >= 0 && !(c.feriados && c.feriados[ymd(data)]);
    if (util) {
      var turnos = c.modo === 'fixo' && c.turnoFixo ? [c.turnoFixo] : (c.turnos || []);
      turnos.forEach(function(t) {
        var ini = horaNum((c.horarios || {})[t]);
        var fim = horaNum((dow === 5 && (c.fimSexta || {})[t]) || (c.fim || {})[t], true);
        if (ini == null || fim == null) return;
        faixa(ini, fim).forEach(function(h) { ativas[h] = true; });
        var p = (c.pausas || {})[t];
        if (p && p.inicio && p.fim) faixa(horaNum(p.inicio), horaNum(p.fim, true)).forEach(function(h) { pausas[h] = true; });
      });
    }
    if (typeof c.extrasDoDia === 'function') {
      var ex = c.extrasDoDia(data) || {};
      (ex.horasAtivas || []).forEach(function(h) { ativas[horaNum(h)] = true; });
      (ex.pausas || []).forEach(function(h) { pausas[horaNum(h)] = true; });
    }
    return Object.keys(ativas).map(Number).filter(function(h) { return !pausas[h]; }).sort(function(a, b) { return a - b; });
  }

  /* Avança `horas` de trabalho a partir de `inicio`. Com horas = 0 devolve
     o primeiro instante útil (a ordem não começa às 3h da manhã). Sem
     nenhuma hora útil em 400 dias (turno não cadastrado), devolve null --
     estimar sobre um calendário vazio seria inventar prazo. */
  function avancar(inicio, horas, cal) {
    var resto = Math.max(horas, 0) * 60;
    var t = new Date(inicio.getTime());
    var dia = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    for (var i = 0; i < 400; i++) {
      var hs = horasUteisDoDia(dia, cal);
      for (var j = 0; j < hs.length; j++) {
        var slotIni = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), hs[j]);
        var slotFim = new Date(slotIni.getTime() + 3600000);
        if (slotFim <= t) continue;
        var s = slotIni > t ? slotIni : t;
        var livre = (slotFim - s) / 60000;
        if (resto <= livre) return new Date(s.getTime() + resto * 60000);
        resto -= livre;
        t = slotFim;
      }
      dia = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1);
    }
    return null;
  }

  /* Estimativa da fila de UM recurso, encadeada: cada ordem começa quando a
     anterior termina (a em andamento, agora). Uma ordem sem ritmo quebra a
     corrente -- as de trás ficam sem estimativa, com o motivo, em vez de
     um horário inventado. O que falta sai dos apontamentos, então a
     estimativa se refaz sozinha a cada apontamento. */
  function estimar(grupo, agora, ritmos, cal, ctx, setor, liberacao) {
    var cursor = agora, quebrou = null;
    grupo.itens.forEach(function(it) {
      it.inicioEstimado = null; it.fimEstimado = null; it.semEstimativa = null; it.fonteRitmo = null;
      it.aguarda = null; it.ressalva = null;
      if (quebrou) { it.semEstimativa = 'depende de ' + quebrou; return; }
      var d = duracao(setor, it, ritmos, ctx);
      if (!d) {
        it.semEstimativa = setor === 'envase' ? 'produto sem prodHoraRef e linha sem ritmo' : 'informe o ritmo (' + SETORES[setor].ritmoRotulo + ')';
        quebrou = 'OP ' + it.lote + ' sem ritmo';
        return;
      }
      var desde = cursor;
      if (it.naGrade) {
        var g = new Date(it.dataInicioPlanejada);
        if (!isNaN(g) && g > desde) desde = g;
      }
      // Etapa anterior da MESMA OP ainda por fazer: não começa antes dela.
      var lib = !it.emAndamento && liberacao && liberacao[it.opKey];
      if (lib) {
        if (lib.em && lib.em > desde) { desde = lib.em; it.aguarda = lib.etapa; }
        else if (!lib.em) it.ressalva = 'sem contar a ' + lib.etapa + ', que está sem estimativa';
      }
      var ini = avancar(desde, 0, cal);
      var fim = ini && avancar(ini, d.horas, cal);
      if (!ini || !fim) { it.semEstimativa = 'sem turno cadastrado'; quebrou = 'turno'; return; }
      it.inicioEstimado = ini; it.fimEstimado = fim; it.horas = d.horas; it.fonteRitmo = d.fonte;
      cursor = fim;
    });
    return grupo;
  }

  /* Todas as filas, com as etapas encadeadas: a manipulação de uma OP não
     começa antes da separação dela terminar, e o envase não começa antes
     da manipulação (ou da separação, se a OP não manipula). A rotulagem
     corre em paralelo ao envase (form.html: a mesma OP pode estar aberta
     nos dois setores), então não espera ninguém. O tempo da análise do
     bulk pela Qualidade não entra: não há dado para estimá-lo. */
  var ANTERIORES = {manipulacao: ['separacao'], envase: ['manipulacao', 'separacao']};
  function estimarTudo(ops, ordem, ritmos, cal, ctx, agora) {
    var out = {};
    ORDEM_SETORES.forEach(function(setor) {
      var liberacao = {};
      (ANTERIORES[setor] || []).forEach(function(ant) {
        (out[ant] || []).forEach(function(g) {
          g.itens.forEach(function(it) {
            if (liberacao[it.opKey]) return; // a mais próxima vence (manipulação antes da separação)
            liberacao[it.opKey] = {em: it.fimEstimado, etapa: SETORES[ant].rotulo.toLowerCase()};
          });
        });
      });
      out[setor] = fila(setor, ops, (ordem || {})[setor], ctx);
      out[setor].forEach(function(g) { estimar(g, agora, ritmos, cal, ctx, setor, liberacao); });
    });
    return out;
  }

  return {
    SETORES: SETORES, estimarTudo: estimarTudo, ORDEM_SETORES: ORDEM_SETORES, chave: chave,
    opAtiva: opAtiva, etapa: etapa, recursoDe: recursoDe, fila: fila,
    mover: mover, trocarRecurso: trocarRecurso, duracao: duracao,
    horasUteisDoDia: horasUteisDoDia, avancar: avancar, estimar: estimar
  };
});
