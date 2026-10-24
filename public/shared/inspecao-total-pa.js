/* Inspeção total de PA: da sinalização do problema à reprovação de fato.

   Fluxo descrito pelo usuário (23/10/2026):
     1. A Qualidade, no laudo do lote, SINALIZA um problema no palete. O lote
        inteiro fica bloqueado (status INSPECAO_TOTAL) e entra numa fila.
     2. A PRODUÇÃO designa uma pessoa para revisar tudo, item por item, com
        prazo máximo (horas, configuradas pelo admin) e separação das
        inconformidades POR MOTIVO.
     3. A Qualidade volta e informa a reprovação de fato: pode reprovar
        parcialmente e por motivos diferentes.
     4. Cada motivo reprovado vira UMA OP de retrabalho (lote-RT1, RT2...). O
        que foi aprovado sai da quarentena, pronto para expedição.

   Onde fica:
     ops/{op}/inspecaoTotal    máquina de estados + sinalização, designação,
                               resultado, decisão e histórico
     estoque_lotes/.../{pal}   status INSPECAO_TOTAL -> LIBERADO_EXPEDICAO
                               (o que sobrou) ou EM_RETRABALHO (palete esvaziado)
     ops/{lote-RTn}            as OPs de retrabalho (RetrabalhoOp.montar)

   A inspeção é registrada por CONTAGEM POR MOTIVO em cada palete (não item a
   item no sistema): quantas unidades foram inspecionadas e, para cada motivo
   de inconformidade, quantas. Como as peças ruins são fisicamente separadas
   do palete, o saldo do palete cai pelo que for reprovado.

   Funções PURAS (planejar*, validar*, fila, prazo) e os executores que
   falam com o banco (sinalizar, designar, registrarResultado, decidir), todos
   com guarda de estado por transaction. Testes: run_inspecao_total_pa_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./laudo-pa-lote.js'), require('./retrabalho-op.js'));
  else root.InspecaoTotalPA = factory(root.LaudoPaLote, root.RetrabalhoOp);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(LaudoPaLote, RetrabalhoOp) {
  'use strict';

  var ESTADOS = {
    AGUARDANDO_DESIGNACAO: {rotulo: 'Aguardando designação', ordem: 1},
    EM_INSPECAO: {rotulo: 'Em inspeção total', ordem: 2},
    AGUARDANDO_DECISAO: {rotulo: 'Aguardando decisão da Qualidade', ordem: 3},
    DECIDIDA: {rotulo: 'Decidida', ordem: 4}
  };
  var STATUS_PALETE = {SINALIZADO: 'INSPECAO_TOTAL', RETRABALHO: 'EM_RETRABALHO', LIBERADO: 'LIBERADO_EXPEDICAO'};
  var PRAZO_PADRAO_HORAS = 24;
  var PRAZO_MAX_HORAS = 240;

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function inteiro(v) { var x = Number(v); return isFinite(x) && Math.floor(x) === x ? x : null; }
  function texto(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 400); }
  function chaveOp(k) { return String(k || '').trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60); }
  function base(opKey) { return 'ops/' + chaveOp(opKey) + '/inspecaoTotal'; }

  // "Tampa solta" e "tampa  solta" são o mesmo motivo.
  function chaveMotivo(m) {
    return texto(m, 120).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  }

  function prazoHoras(valor) {
    var h = inteiro(valor);
    return h && h > 0 && h <= PRAZO_MAX_HORAS ? h : PRAZO_PADRAO_HORAS;
  }

  function estadoDe(insp) { return insp && ESTADOS[insp.estado] ? insp.estado : null; }

  /* Prazo da inspeção em andamento: minutos que faltam (negativo = atrasada). */
  function situacaoPrazo(insp, agora) {
    var prazo = insp && insp.designacao && insp.designacao.prazoEm;
    if (!prazo || estadoDe(insp) !== 'EM_INSPECAO') return null;
    var min = Math.round((new Date(prazo).getTime() - new Date(agora || Date.now()).getTime()) / 60000);
    if (isNaN(min)) return null;
    return {restanteMin: min, vencido: min < 0};
  }
  function textoPrazo(sit) {
    if (!sit) return '';
    var a = Math.abs(sit.restanteMin), h = Math.floor(a / 60), m = a % 60;
    var t = (h ? h + 'h' : '') + (h && m ? ' ' : '') + (m || !h ? m + 'min' : '');
    return sit.vencido ? 'vencido há ' + t : 'faltam ' + t;
  }

  /* Fila: uma linha por OP com inspeção total, a mais antiga primeiro. */
  function fila(ops) {
    var out = [];
    Object.keys(ops || {}).forEach(function(k) {
      var op = ops[k], insp = op && op.inspecaoTotal;
      if (!insp || !estadoDe(insp)) return;
      out.push({
        opKey: k, lote: op.lote || k, produto: op.produto || '', cliente: op.cliente || '', sku: op.sku || '',
        estado: insp.estado, insp: insp, sinalizadoEm: (insp.sinalizacao && insp.sinalizacao.em) || ''
      });
    });
    return out.sort(function(a, b) {
      return ESTADOS[a.estado].ordem - ESTADOS[b.estado].ordem || (a.sinalizadoEm < b.sinalizadoEm ? -1 : 1);
    });
  }

  function paletesDaInspecao(estoqueLotes, opKey) {
    return LaudoPaLote.paletesDoLote(estoqueLotes, opKey).filter(function(p) { return p.lote.status === STATUS_PALETE.SINALIZADO; });
  }

  /* ── Resultado da inspeção ─────────────────────────────────────────────
     linhas: [{loteKey, inspecionadas, defeitos: [{motivo, qtd, obs}]}] */
  function validarResultado(paletes, resultado) {
    var erros = [], r = resultado || {}, porPalete = {};
    (paletes || []).forEach(function(p) { porPalete[p.loteKey] = p; });
    var linhas = r.linhas || [], vistos = {}, motivos = {};
    var totalInsp = 0, totalSaldo = 0, parcial = false;
    (paletes || []).forEach(function(p) { totalSaldo += n(p.lote.saldoLote); });
    if (!linhas.length) erros.push('Informe a inspeção de pelo menos um palete.');
    var normal = linhas.map(function(l) {
      var p = porPalete[l.loteKey], nome = p ? (p.lote.identificadorPalete || l.loteKey) : l.loteKey;
      if (!p) { erros.push('Palete ' + l.loteKey + ' não pertence a esta inspeção.'); return null; }
      if (vistos[l.loteKey]) { erros.push('O palete ' + nome + ' aparece duas vezes.'); return null; }
      vistos[l.loteKey] = true;
      var insp = inteiro(l.inspecionadas), saldo = n(p.lote.saldoLote);
      if (insp == null || insp < 0) { erros.push('Palete ' + nome + ': informe quantas unidades foram inspecionadas (número inteiro).'); return null; }
      if (insp > saldo) { erros.push('Palete ' + nome + ': ' + insp + ' inspecionadas é mais que as ' + saldo + ' do palete.'); return null; }
      if (insp < saldo) parcial = true;
      var soma = 0, defeitos = [];
      (l.defeitos || []).forEach(function(d) {
        var q = inteiro(d.qtd), chave = chaveMotivo(d.motivo);
        if (!chave) { erros.push('Palete ' + nome + ': todo defeito precisa de um motivo.'); return; }
        if (q == null || q <= 0) { erros.push('Palete ' + nome + ', ' + texto(d.motivo, 60) + ': a quantidade deve ser um número inteiro maior que zero.'); return; }
        soma += q;
        defeitos.push({motivo: texto(d.motivo, 120), motivoKey: chave, qtd: q, obs: texto(d.obs, 300) || null});
        var m = motivos[chave] = motivos[chave] || {motivo: texto(d.motivo, 120), motivoKey: chave, achada: 0, porPalete: {}, obs: null};
        m.achada += q; m.porPalete[l.loteKey] = (m.porPalete[l.loteKey] || 0) + q;
        if (d.obs && !m.obs) m.obs = texto(d.obs, 300);
      });
      if (soma > insp) erros.push('Palete ' + nome + ': os defeitos somam ' + soma + ', mais que as ' + insp + ' inspecionadas.');
      totalInsp += insp;
      var fotos = Array.isArray(l.fotos) && l.fotos.length ? l.fotos.slice(0, 6) : null;
      return {loteKey: l.loteKey, palete: nome, saldo: saldo, inspecionadas: insp, defeitos: defeitos, naoConformes: soma, fotos: fotos};
    }).filter(Boolean);
    (paletes || []).forEach(function(p) {
      if (!vistos[p.loteKey]) erros.push('Falta a inspeção do palete ' + (p.lote.identificadorPalete || p.loteKey) + '.');
    });
    var justificativa = texto(r.justificativaParcial, 400);
    if (parcial && !justificativa) erros.push('A inspeção é TOTAL: inspecione todas as unidades ou justifique por que ficaram unidades sem inspeção.');
    var naoConformes = normal.reduce(function(t, x) { return t + x.naoConformes; }, 0);
    return {
      ok: !erros.length, erros: erros,
      resultado: erros.length ? null : {
        linhas: normal, inspecionadas: totalInsp, naoConformes: naoConformes, conformes: totalInsp - naoConformes,
        saldoLote: totalSaldo, parcial: parcial, justificativaParcial: parcial ? justificativa : null,
        motivos: motivos, observacao: texto(r.observacao, 600) || null
      }
    };
  }

  /* ── Decisão ───────────────────────────────────────────────────────────
     decisoes: {motivoKey: {reprovada, destino:{tipo,nome}}}. O que não for
     reprovado fica aprovado e volta ao palete. */
  function alocarReprovadas(resultado, decisoes) {
    var porPalete = {}, restante = {}, erros = [];
    Object.keys(resultado.motivos || {}).forEach(function(k) {
      var m = resultado.motivos[k], d = (decisoes || {})[k] || {}, rep = inteiro(d.reprovada == null ? 0 : d.reprovada);
      if (rep == null || rep < 0) { erros.push('Motivo "' + m.motivo + '": a quantidade reprovada deve ser um número inteiro (0 ou mais).'); return; }
      if (rep > m.achada) { erros.push('Motivo "' + m.motivo + '": você reprovou ' + rep + ', mas a inspeção achou ' + m.achada + '.'); return; }
      restante[k] = rep;
    });
    if (erros.length) return {ok: false, erros: erros};
    resultado.linhas.forEach(function(l) {
      l.defeitos.forEach(function(d) {
        var tira = Math.min(d.qtd, restante[d.motivoKey] || 0);
        if (!tira) return;
        restante[d.motivoKey] -= tira;
        var p = porPalete[l.loteKey] = porPalete[l.loteKey] || {total: 0, porMotivo: {}};
        p.total += tira; p.porMotivo[d.motivoKey] = (p.porMotivo[d.motivoKey] || 0) + tira;
      });
    });
    return {ok: true, porPalete: porPalete};
  }

  // Palete que perdeu unidades: recalcula caixas só quando dá para saber o tamanho da caixa.
  function caixasApos(lote, novoSaldo) {
    var saldo = n(lote.saldoLote), cx = n(lote.caixasFechadas), parc = n(lote.unidadesCaixaParcial);
    var upc = n(lote.unidadesPorCaixa) || (cx > 0 && parc === 0 && saldo % cx === 0 ? saldo / cx : 0);
    if (!(upc > 0) || Math.floor(upc) !== upc) return null;
    return {caixasFechadas: Math.floor(novoSaldo / upc), unidadesCaixaParcial: novoSaldo % upc};
  }

  /* Tudo o que a decisão grava. PURA. `existentes` = {lote: true} das OPs RT
     que já existem para este lote (para numerar RT1, RT2...). */
  function planejarDecisao(o) {
    var res = o.resultado, deps = o.deps, agora = o.agora, autor = o.autor, op = o.op || {};
    var aloc = alocarReprovadas(res, o.decisoes);
    if (!aloc.ok) return {ok: false, erros: aloc.erros};
    var updates = {}, aprovadas = 0, reprovadas = 0, pushN = 0;
    var obsFinal = texto(o.observacao, 600) || null;
    var motivosReprovados = Object.keys(res.motivos).filter(function(k) { return n((o.decisoes[k] || {}).reprovada) > 0; });

    o.paletes.forEach(function(p) {
      var a = aloc.porPalete[p.loteKey] || {total: 0, porMotivo: {}}, saldo = n(p.lote.saldoLote), novo = saldo - a.total;
      var b = 'estoque_lotes/' + p.itemKey + '/' + p.loteKey;
      aprovadas += novo; reprovadas += a.total;
      var liberado = novo > 0;
      var q = deps.qualidadeDoLaudo({
        decisao: liberado ? STATUS_PALETE.LIBERADO : 'REPROVADO',
        observacao: liberado
          ? 'Aprovado após inspeção total' + (a.total ? ' (' + a.total + ' un separadas para retrabalho)' : '') + (obsFinal ? ': ' + obsFinal : '.')
          : 'Palete esvaziado: ' + a.total + ' un enviadas a retrabalho' + (obsFinal ? ': ' + obsFinal : '.')
      }, autor, agora);
      q.laudoLote = chaveOp(o.opKey); q.espelhoDeLote = true; q.inspecaoTotal = true;
      updates[b + '/status'] = liberado ? STATUS_PALETE.LIBERADO : STATUS_PALETE.RETRABALHO;
      updates[b + '/qualidade'] = q;
      updates[b + '/atualizadoEm'] = agora;
      if (a.total) {
        updates[b + '/saldoLote'] = novo;
        var cx = caixasApos(p.lote, novo);
        if (cx) { updates[b + '/caixasFechadas'] = cx.caixasFechadas; updates[b + '/unidadesCaixaParcial'] = cx.unidadesCaixaParcial; }
        updates[b + '/retiradoRetrabalho'] = n(p.lote.retiradoRetrabalho) + a.total;
      }
      updates['movimentos_estoque/' + p.itemKey + '/' + (o.pushKeys[p.loteKey] || ('mov_' + p.loteKey))] = {
        tipo: 'qualidade',
        motivo: 'INSPEÇÃO TOTAL (LOTE ' + (o.opLote || o.opKey) + '): ' + (liberado ? 'LIBERADO' : 'EM RETRABALHO') + (a.total ? ' — ' + a.total + ' un retiradas p/ retrabalho' : ''),
        qtd: 0, qtdRetrabalho: a.total || null, saldoApos: novo, ref: obsFinal, loteKey: p.loteKey,
        enderecoKey: p.lote.enderecoKey || null, enderecoCodigo: p.lote.enderecoCodigo || null,
        itemTipo: 'produto', itemCodigo: o.itemCodigo, itemNome: p.lote.itemNome || null, unidade: p.lote.unidade || null,
        autor: autor || null, em: agora
      };
    });

    // Uma OP de retrabalho por motivo reprovado.
    var existentes = Object.assign({}, o.existentes || {}), opsRT = [];
    motivosReprovados.forEach(function(k) {
      var m = res.motivos[k], d = o.decisoes[k], qtd = inteiro(d.reprovada), destino = d.destino && d.destino.tipo ? d.destino : {tipo: 'linha', nome: ''};
      var mapa = {};
      Object.keys(existentes).forEach(function(l) { mapa[l] = {lote: l}; });
      var nova = RetrabalhoOp.montar({
        opOriginal: op, opOriginalKey: chaveOp(o.opKey), ops: mapa, agora: agora, autor: autor,
        motivo: 'Inspeção total: ' + m.motivo, escopo: 'Parcial — ' + m.motivo + ' (' + qtd + ' un)',
        qtdPlanejada: qtd, observacao: m.obs || obsFinal, destino: destino
      });
      nova.origemInspecaoTotal = {opKey: chaveOp(o.opKey), motivo: m.motivo, motivoKey: k};
      // A expedição do palete retrabalhado usa o pedido da OP original (a OP RT não tem skuPedidoKey de propósito).
      nova.skuPedidoKeyExpedicao = op.skuPedidoKey || null;
      existentes[nova.lote] = true;
      var chave = deps.sanitizeKey(nova.lote);
      updates['ops/' + chave] = nova;
      opsRT.push({opKey: chave, lote: nova.lote, motivo: m.motivo, qtd: qtd});
    });

    var decisao = {
      em: agora, por: autor || null, observacao: obsFinal,
      aprovadas: aprovadas, reprovadas: reprovadas, parcial: aprovadas > 0 && reprovadas > 0,
      resultado: aprovadas > 0 ? 'LIBERADO_EXPEDICAO' : 'REPROVADO',
      motivos: Object.keys(res.motivos).map(function(k) {
        var m = res.motivos[k], rt = opsRT.filter(function(x) { return x.opKey && x.motivo === m.motivo; })[0];
        return {motivo: m.motivo, motivoKey: k, achada: m.achada, reprovada: n((o.decisoes[k] || {}).reprovada), opRetrabalho: rt ? rt.lote : null, opRetrabalhoKey: rt ? rt.opKey : null};
      })
    };
    var b0 = base(o.opKey);
    updates[b0 + '/estado'] = 'DECIDIDA';
    updates[b0 + '/decisao'] = decisao;
    // Laudo do lote (fonte da verdade que Dossiê/Expedição já leem).
    var laudo = deps.qualidadeDoLaudo({
      decisao: decisao.resultado,
      observacao: 'Inspeção total: ' + aprovadas + ' un aprovadas, ' + reprovadas + ' un em retrabalho' +
        (motivosReprovados.length ? ' (' + motivosReprovados.map(function(k) { return res.motivos[k].motivo; }).join('; ') + ')' : '') + (obsFinal ? '. ' + obsFinal : '.')
    }, autor, agora);
    laudo.opKey = chaveOp(o.opKey); laudo.opLote = o.opLote || null; laudo.itemCodigo = o.itemCodigo; laudo.inspecaoTotal = true;
    laudo.aprovadas = aprovadas; laudo.reprovadas = reprovadas; laudo.qtdPaletes = o.paletes.length;
    laudo.saldoLote = aprovadas;
    updates['ops/' + chaveOp(o.opKey) + '/qualidadePA'] = laudo;
    return {ok: true, updates: updates, decisao: decisao, opsRT: opsRT, aprovadas: aprovadas, reprovadas: reprovadas};
  }

  /* ── Executores (falam com o banco) ────────────────────────────────── */

  function historico(dbRef, opKey, acao, por, em, detalhe) {
    var k = dbRef.ref(base(opKey) + '/historico').push().key;
    return [base(opKey) + '/historico/' + k, {acao: acao, por: por || null, em: em, detalhe: detalhe || null}];
  }

  // Muda o estado só se estiver num dos estados esperados. Devolve Promise<boolean>.
  function trocarEstado(dbRef, opKey, de, para) {
    return dbRef.ref(base(opKey) + '/estado').transaction(function(atual) {
      if (atual === null) return atual;      // cache frio: o SDK refaz com o valor do servidor
      return de.indexOf(atual) >= 0 ? para : undefined;
    }).then(function(r) { return !!(r && r.committed && r.snapshot && r.snapshot.val() === para); });
  }

  function sinalizar(dbRef, opKey, paletes, dados, autor, ctx) {
    dados = dados || {}; ctx = ctx || {};
    var motivo = texto(dados.motivo, 600);
    if (!opKey || !paletes || !paletes.length) return Promise.resolve({ok: false, erro: 'Faltam dados do lote.'});
    if (!motivo) return Promise.resolve({ok: false, erro: 'Descreva o problema identificado no palete.'});
    var agora = new Date().toISOString(), ref = dbRef.ref(base(opKey)), reservou = false;
    var soltar = function() { return reservou ? ref.remove().catch(function() {}) : Promise.resolve(); };
    return ref.transaction(function(atual) {
      if (atual) return;
      return {estado: 'RESERVANDO', reservadoEm: agora};
    }).then(function(res) {
      if (!res || !res.committed || !res.snapshot || !res.snapshot.val()) return {ok: false, erro: 'Este lote já foi sinalizado — veja a fila de inspeção total.'};
      reservou = true;
      return dbRef.ref('ops/' + chaveOp(opKey) + '/qualidadePA').once('value').then(function(s) {
        if (s.val()) return soltar().then(function() { return {ok: false, erro: 'Este lote já tem laudo registrado — alguém decidiu antes.'}; });
        return Promise.all(paletes.map(function(p) {
          return dbRef.ref('estoque_lotes/' + p.itemKey + '/' + p.loteKey).once('value').then(function(x) { return x.val(); });
        })).then(function(frescos) {
          if (frescos.some(function(l) { return !l || l.status !== 'QUARENTENA'; })) {
            return soltar().then(function() { return {ok: false, erro: 'Há palete deste lote que não está mais em quarentena. Atualize a tela.'}; });
          }
          var u = {};
          u[base(opKey)] = {
            estado: 'AGUARDANDO_DESIGNACAO',
            sinalizacao: {por: autor || null, em: agora, motivo: motivo, fotos: dados.fotos || null, fotosDispensadas: dados.fotosDispensadas ? true : null,
              qtdPaletes: paletes.length, saldoLote: paletes.reduce(function(t, p, i) { return t + n(frescos[i].saldoLote); }, 0)}
          };
          var h = historico(dbRef, opKey, 'SINALIZADO', autor, agora, motivo);
          u[h[0] + ''] = h[1];
          // o histórico mora dentro do nó; grava junto sem sobrescrever a raiz do nó
          var raiz = u[base(opKey)]; delete u[base(opKey)];
          Object.keys(raiz).forEach(function(c) { u[base(opKey) + '/' + c] = raiz[c]; });
          paletes.forEach(function(p, i) {
            var b = 'estoque_lotes/' + p.itemKey + '/' + p.loteKey;
            u[b + '/status'] = STATUS_PALETE.SINALIZADO; u[b + '/atualizadoEm'] = agora;
            u[b + '/inspecaoTotal'] = {sinalizadoEm: agora, sinalizadoPor: autor || null, motivo: motivo};
            u['movimentos_estoque/' + p.itemKey + '/' + dbRef.ref('movimentos_estoque/' + p.itemKey).push().key] = {
              tipo: 'qualidade', motivo: 'PROBLEMA SINALIZADO (LOTE ' + (ctx.opLote || opKey) + '): inspeção total', qtd: 0, saldoApos: n(frescos[i].saldoLote),
              ref: motivo, loteKey: p.loteKey, enderecoKey: frescos[i].enderecoKey || null, enderecoCodigo: frescos[i].enderecoCodigo || null,
              itemTipo: 'produto', itemCodigo: ctx.itemCodigo || frescos[i].itemCodigo, itemNome: frescos[i].itemNome || null, unidade: frescos[i].unidade || null,
              autor: autor || null, em: agora
            };
          });
          return dbRef.ref().update(u).then(function() { reservou = false; return {ok: true, paletes: paletes.length}; });
        });
      });
    }).catch(function(err) { return soltar().then(function() { return {ok: false, erro: err.message}; }); });
  }

  function designar(dbRef, opKey, dados, autor, agoraIso) {
    dados = dados || {};
    var resp = texto(dados.responsavel, 120);
    if (!resp) return Promise.resolve({ok: false, erro: 'Escolha quem fará a inspeção.'});
    var horas = prazoHoras(dados.prazoHoras), agora = agoraIso || new Date().toISOString();
    return trocarEstado(dbRef, opKey, ['AGUARDANDO_DESIGNACAO', 'EM_INSPECAO'], 'EM_INSPECAO').then(function(ok) {
      if (!ok) return {ok: false, erro: 'Esta inspeção não está mais aguardando designação. Atualize a tela.'};
      var prazoEm = new Date(new Date(agora).getTime() + horas * 3600000).toISOString();
      var u = {}, h = historico(dbRef, opKey, 'DESIGNADO', autor, agora, resp + ' — prazo ' + horas + 'h');
      u[base(opKey) + '/designacao'] = {responsavel: resp, responsavelUid: dados.responsavelUid || null, designadoPor: autor || null, em: agora, prazoHoras: horas, prazoEm: prazoEm};
      u[h[0]] = h[1];
      return dbRef.ref().update(u).then(function() { return {ok: true, prazoEm: prazoEm, prazoHoras: horas}; });
    }).catch(function(err) { return {ok: false, erro: err.message}; });
  }

  function registrarResultado(dbRef, opKey, paletes, resultado, autor, agoraIso) {
    var v = validarResultado(paletes, resultado);
    if (!v.ok) return Promise.resolve({ok: false, erro: v.erros.join(' '), erros: v.erros});
    var agora = agoraIso || new Date().toISOString();
    return trocarEstado(dbRef, opKey, ['EM_INSPECAO'], 'AGUARDANDO_DECISAO').then(function(ok) {
      if (!ok) return {ok: false, erro: 'Esta inspeção não está em andamento. Atualize a tela.'};
      return dbRef.ref(base(opKey) + '/designacao').once('value').then(function(s) {
        var d = s.val() || {}, atrasoMin = d.prazoEm ? Math.round((new Date(agora).getTime() - new Date(d.prazoEm).getTime()) / 60000) : null;
        var r = Object.assign({}, v.resultado, {por: autor || null, em: agora, atrasadoMin: atrasoMin > 0 ? atrasoMin : null});
        var u = {}, h = historico(dbRef, opKey, 'INSPECAO_CONCLUIDA', autor, agora,
          v.resultado.inspecionadas + ' inspecionadas, ' + v.resultado.naoConformes + ' não conformes' + (atrasoMin > 0 ? ' (atrasada ' + atrasoMin + ' min)' : ''));
        u[base(opKey) + '/resultado'] = r; u[h[0]] = h[1];
        return dbRef.ref().update(u).then(function() { return {ok: true, resultado: r}; });
      });
    }).catch(function(err) { return {ok: false, erro: err.message}; });
  }

  /* deps: {qualidadeDoLaudo, sanitizeKey, abrirRnc}. ctx: {itemCodigo, itemNome, unidade, loteOrigem, opLote, op}. */
  function decidir(dbRef, opKey, paletes, decisoes, observacao, autor, ctx, deps) {
    ctx = ctx || {}; deps = deps || {};
    var agora = new Date().toISOString(), chave = chaveOp(opKey);
    var reverter = function() { return dbRef.ref(base(opKey) + '/estado').set('AGUARDANDO_DECISAO').catch(function() {}); };
    return trocarEstado(dbRef, opKey, ['AGUARDANDO_DECISAO'], 'DECIDINDO').then(function(ok) {
      if (!ok) return {ok: false, erro: 'Esta inspeção não está aguardando decisão. Atualize a tela.'};
      return Promise.all([
        dbRef.ref(base(opKey) + '/resultado').once('value'),
        dbRef.ref('ops/' + chave + '/qualidadePA').once('value'),
        dbRef.ref('ops').orderByKey().startAt(chave).endAt(chave + '').once('value'),
        Promise.all(paletes.map(function(p) { return dbRef.ref('estoque_lotes/' + p.itemKey + '/' + p.loteKey).once('value').then(function(s) { return s.val(); }); }))
      ]).then(function(r) {
        var resultado = r[0].val();
        if (!resultado) return reverter().then(function() { return {ok: false, erro: 'A inspeção não tem resultado registrado.'}; });
        if (r[1].val()) return reverter().then(function() { return {ok: false, erro: 'Este lote já tem laudo registrado.'}; });
        if (r[3].some(function(l) { return !l || l.status !== STATUS_PALETE.SINALIZADO; })) {
          return reverter().then(function() { return {ok: false, erro: 'Há palete que não está mais em inspeção total. Atualize a tela.'}; });
        }
        var existentes = {}, filhos = r[2].val() || {};
        Object.keys(filhos).forEach(function(k) { if (filhos[k] && filhos[k].lote) existentes[filhos[k].lote] = true; });
        var pal = paletes.map(function(p, i) { return {itemKey: p.itemKey, loteKey: p.loteKey, lote: r[3][i]}; });
        var pushKeys = {};
        pal.forEach(function(p) { pushKeys[p.loteKey] = dbRef.ref('movimentos_estoque/' + p.itemKey).push().key; });
        var hist = historico(dbRef, opKey, 'DECIDIDO', autor, agora, '');
        var plano = planejarDecisao({
          opKey: opKey, op: ctx.op, opLote: ctx.opLote, itemCodigo: ctx.itemCodigo, paletes: pal, resultado: resultado,
          decisoes: decisoes || {}, observacao: observacao, agora: agora, autor: autor, deps: deps, existentes: existentes, pushKeys: pushKeys
        });
        if (!plano.ok) return reverter().then(function() { return {ok: false, erro: plano.erros.join(' '), erros: plano.erros}; });
        hist[1].detalhe = plano.aprovadas + ' un liberadas, ' + plano.reprovadas + ' un em retrabalho (' + plano.opsRT.length + ' OP)';
        plano.updates[hist[0]] = hist[1];
        return dbRef.ref().update(plano.updates).then(function() {
          var out = {ok: true, aprovadas: plano.aprovadas, reprovadas: plano.reprovadas, opsRT: plano.opsRT, decisao: plano.decisao};
          if (!plano.reprovadas || !deps.abrirRnc) return out;
          return deps.abrirRnc(dbRef, {
            classificacao: 'MAIOR', origem: 'PRODUCAO',
            descricao: 'Inspeção total do lote ' + (ctx.loteOrigem || ctx.opLote || opKey) + ': ' + plano.reprovadas + ' un reprovadas — ' +
              plano.decisao.motivos.filter(function(m) { return m.reprovada; }).map(function(m) { return m.motivo + ' (' + m.reprovada + ')'; }).join('; ') + '.',
            itemTipo: 'produto', itemCodigo: ctx.itemCodigo, itemNome: ctx.itemNome || null, unidade: ctx.unidade || null,
            qtdEnvolvida: plano.reprovadas, loteKey: pal[0].loteKey, loteOrigem: ctx.loteOrigem || null, opLote: ctx.opLote || null,
            acaoImediata: 'Unidades separadas e enviadas a retrabalho (' + plano.opsRT.map(function(x) { return x.lote; }).join(', ') + '); restante liberado.',
            automatica: true
          }, autor).then(function(rr) {
            out.rnc = rr.ok ? rr.numero : null; out.rncErro = rr.ok ? null : rr.erro; return out;
          }).catch(function(err) { out.rnc = null; out.rncErro = err.message; return out; });
        });
      });
    }).catch(function(err) { return reverter().then(function() { return {ok: false, erro: err.message}; }); });
  }

  return {
    ESTADOS: ESTADOS, STATUS_PALETE: STATUS_PALETE, PRAZO_PADRAO_HORAS: PRAZO_PADRAO_HORAS, PRAZO_MAX_HORAS: PRAZO_MAX_HORAS,
    chaveMotivo: chaveMotivo, prazoHoras: prazoHoras, situacaoPrazo: situacaoPrazo, textoPrazo: textoPrazo, fila: fila,
    paletesDaInspecao: paletesDaInspecao, validarResultado: validarResultado, alocarReprovadas: alocarReprovadas,
    caixasApos: caixasApos, planejarDecisao: planejarDecisao,
    sinalizar: sinalizar, designar: designar, registrarResultado: registrarResultado, decidir: decidir
  };
});
