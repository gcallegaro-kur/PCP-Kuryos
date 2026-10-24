/* Laudo único de PA por LOTE (OP), não por palete.

   Decisão do usuário (16/10/2026): uma OP = um lote de produto acabado. Por
   mais paletes que ela tenha, a análise é uma só — um laudo, uma decisão —
   e vale para o lote inteiro. A amostragem de caixas continua por palete
   (x caixas do palete A, y do palete B), mas dentro do mesmo laudo.

   Onde fica:
     ops/{opKey}/qualidadePA           o laudo (fonte da verdade)
     estoque_lotes/.../{palete}        status + `qualidade` = ESPELHO do laudo,
                                       gravado na mesma operação. É o que a
                                       Expedição, o Dossiê e a grade já leem,
                                       por isso nada a jusante precisou mudar.

   Palete que chega depois (a Logística confere um palete de um lote já
   decidido) HERDA a decisão do lote — ver heranca(). */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaudoPaLote = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var DECISOES = {LIBERADO: 1, LIBERADO_EXPEDICAO: 1, REPROVADO: 1, APROVADO_CONCESSAO: 1, RETIDO: 1};
  var LIBERA = {LIBERADO: 1, LIBERADO_EXPEDICAO: 1, APROVADO_CONCESSAO: 1};

  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(n(v) * 1000) / 1000; }
  function chaveOp(k) { return String(k || '').trim().replace(/[./[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60); }

  function caixasDoPalete(l) {
    l = l || {};
    return Math.floor(n(l.caixasFechadas)) + (n(l.unidadesCaixaParcial) > 0 ? 1 : 0);
  }
  function ehPalete(l) { return !!l && l.itemTipo === 'produto'; }

  // Paletes de PA de uma OP: [{itemKey, loteKey, lote}].
  function paletesDoLote(estoqueLotes, opKey) {
    var out = [];
    Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
      var lotes = estoqueLotes[itemKey] || {};
      Object.keys(lotes).forEach(function(loteKey) {
        var l = lotes[loteKey];
        if (ehPalete(l) && chaveOp(l.opKey) === chaveOp(opKey)) out.push({itemKey: itemKey, loteKey: loteKey, lote: l});
      });
    });
    return out.sort(function(a, b) { return n(a.lote.paleteNumero) - n(b.lote.paleteNumero) || (a.loteKey < b.loteKey ? -1 : 1); });
  }

  /* Fila da Qualidade para PA: um item por OP que tenha palete conferido
     (QUARENTENA) esperando laudo. Palete ainda AGUARDANDO_CONFERENCIA conta
     à parte — herdará a decisão (heranca). */
  function filaLotes(estoqueLotes) {
    var porOp = {};
    Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
      var lotes = estoqueLotes[itemKey] || {};
      Object.keys(lotes).forEach(function(loteKey) {
        var l = lotes[loteKey];
        // Só palete nascido da Conferência de PA entra no laudo do lote. Palete de
        // devolução do cliente tem laudo próprio (decide reintegrar/reenviar).
        if (!ehPalete(l) || !l.opKey || l.origemTipo !== 'conferencia_pa') return;
        var g = porOp[l.opKey] = porOp[l.opKey] || {
          opKey: l.opKey, itemKey: itemKey, itemCodigo: l.itemCodigo, itemNome: l.itemNome || null,
          loteOrigem: l.loteOrigem || null, opLote: l.opLote || l.loteOrigem || null, unidade: l.unidade || null,
          dataValidade: l.dataValidade || null, paletes: [], aguardandoConferencia: 0,
          saldoTotal: 0, caixasTotal: 0, enderecos: [], criadoEm: l.criadoEm || null
        };
        if (l.status === 'AGUARDANDO_CONFERENCIA') { g.aguardandoConferencia++; return; }
        if (l.status !== 'QUARENTENA') return;
        g.paletes.push({itemKey: itemKey, loteKey: loteKey, lote: l});
        g.saldoTotal = arred(g.saldoTotal + n(l.saldoLote));
        g.caixasTotal += caixasDoPalete(l);
        if (l.enderecoCodigo && g.enderecos.indexOf(l.enderecoCodigo) < 0) g.enderecos.push(l.enderecoCodigo);
        if (!g.dataValidade && l.dataValidade) g.dataValidade = l.dataValidade;
        if (l.criadoEm && (!g.criadoEm || l.criadoEm < g.criadoEm)) g.criadoEm = l.criadoEm;
      });
    });
    return Object.keys(porOp).map(function(k) { return porOp[k]; })
      .filter(function(g) { return g.paletes.length; })
      .map(function(g) {
        g.paletes.sort(function(a, b) { return n(a.lote.paleteNumero) - n(b.lote.paleteNumero) || (a.loteKey < b.loteKey ? -1 : 1); });
        return g;
      })
      .sort(function(a, b) { return String(a.criadoEm || '') < String(b.criadoEm || '') ? -1 : 1; });
  }

  /* Amostragem POR PALETE: cada palete sugere a sua amostra (√N+1 sobre as
     caixas dele, topo/meio/fundo). `amostragemFn` é InspecaoPA.amostragem. */
  function amostragemPorPalete(paletes, amostragemFn) {
    var linhas = (paletes || []).map(function(p, i) {
      var l = p.lote || {}, a = amostragemFn(caixasDoPalete(l));
      return {
        loteKey: p.loteKey, palete: l.identificadorPalete || l.paleteNumero || (i + 1),
        endereco: l.enderecoCodigo || null, saldo: n(l.saldoLote),
        caixas: a.caixas, amostra: a.amostra, posicoes: a.posicoes, texto: a.texto
      };
    });
    return {
      porPalete: linhas,
      caixasLote: linhas.reduce(function(t, x) { return t + x.caixas; }, 0),
      caixasAmostradas: linhas.reduce(function(t, x) { return t + x.amostra; }, 0)
    };
  }
  function textoAmostragem(am) {
    if (!am || !am.porPalete.length) return '';
    return am.porPalete.map(function(x) {
      return 'Palete ' + x.palete + (x.endereco ? ' (' + x.endereco + ')' : '') + ': ' +
        (x.caixas ? x.amostra + ' de ' + x.caixas + ' caixa(s) — ' + x.posicoes.join(', ').toLowerCase() : 'sem caixas informadas na conferência');
    }).join(' · ') + ' — total ' + am.caixasAmostradas + ' de ' + am.caixasLote + ' caixa(s).';
  }

  /* O que vai para o banco. PURA. `qualidade` é o objeto já montado por
     qualidadeDoLaudo() (utils.js); `pushKeys[loteKey]` é a chave do
     movimento de cada palete. */
  function planejarGravacao(o) {
    var q = o.qualidade, updates = {}, agora = o.agora;
    var lista = o.paletes.map(function(p) {
      return {loteKey: p.loteKey, itemKey: p.itemKey, identificador: p.lote.identificadorPalete || p.lote.paleteNumero || null,
        saldo: n(p.lote.saldoLote), endereco: p.lote.enderecoCodigo || null};
    });
    var laudoLote = Object.assign({}, q, {
      opKey: o.opKey, opLote: o.opLote || null, itemCodigo: o.itemCodigo, loteOrigem: o.loteOrigem || null,
      amostragemPaletes: o.amostragem ? o.amostragem.porPalete : null, paletes: lista,
      qtdPaletes: lista.length, saldoLote: arred(lista.reduce(function(t, x) { return t + x.saldo; }, 0))
    });
    updates['ops/' + chaveOp(o.opKey) + '/qualidadePA'] = laudoLote;
    o.paletes.forEach(function(p) {
      var base = 'estoque_lotes/' + p.itemKey + '/' + p.loteKey;
      var am = o.amostragem ? o.amostragem.porPalete.filter(function(x) { return x.loteKey === p.loteKey; })[0] || null : null;
      updates[base + '/status'] = q.decisao;
      updates[base + '/qualidade'] = Object.assign({}, q, {laudoLote: o.opKey, espelhoDeLote: true, amostragemPalete: am});
      updates[base + '/atualizadoEm'] = agora;
      updates['movimentos_estoque/' + p.itemKey + '/' + (o.pushKeys[p.loteKey] || ('mov_' + p.loteKey))] = {
        tipo: 'qualidade', motivo: 'QUALIDADE (LOTE ' + (o.opLote || o.opKey) + '): ' + String(q.decisao).replace(/_/g, ' '),
        qtd: 0, saldoApos: n(p.lote.saldoLote), ref: q.observacao || null, loteKey: p.loteKey,
        enderecoKey: p.lote.enderecoKey || null, enderecoCodigo: p.lote.enderecoCodigo || null,
        itemTipo: 'produto', itemCodigo: o.itemCodigo, itemNome: p.lote.itemNome || null, unidade: p.lote.unidade || null,
        autor: o.autor || null, em: agora
      };
    });
    return {updates: updates, laudoLote: laudoLote};
  }

  /* Palete que chega depois do laudo do lote. Herda a decisão: o lote é a
     unidade da análise. Fica marcado `herdado` e sem amostragem própria —
     a tela da Qualidade mostra "palete sem amostragem" no lote. */
  function heranca(laudoLote, opKey, agora) {
    if (!laudoLote || !DECISOES[laudoLote.decisao]) return null;
    var q = Object.assign({}, laudoLote);
    ['paletes', 'amostragemPaletes', 'qtdPaletes', 'saldoLote'].forEach(function(c) { delete q[c]; });
    q.laudoLote = opKey; q.espelhoDeLote = true; q.herdado = true; q.herdadoEm = agora || null; q.amostragemPalete = null;
    return {status: laudoLote.decisao, qualidade: q};
  }

  // Paletes do lote que não aparecem na amostragem do laudo (chegaram depois).
  function paletesSemAmostragem(laudoLote, paletesAtuais) {
    var amostrados = {};
    ((laudoLote || {}).amostragemPaletes || []).forEach(function(x) { amostrados[x.loteKey] = true; });
    return (paletesAtuais || []).filter(function(p) { return !amostrados[p.loteKey]; });
  }

  /* Grava o laudo do lote. Reserva `ops/{op}/qualidadePA` por transaction
     (dois cliques / duas sessões não decidem o mesmo lote duas vezes),
     confere que todo palete ainda está em QUARENTENA, grava tudo num único
     update multi-path e, se reprovou/reteve, abre UMA RNC para o lote.
     deps: {qualidadeDoLaudo, abrirRnc, rotuloStatusLote}. */
  function registrarLaudoPaLote(dbRef, opKey, paletes, laudo, autor, ctx, deps) {
    ctx = ctx || {}; deps = deps || {};
    if (!opKey || !paletes || !paletes.length || !laudo || !laudo.decisao) return Promise.resolve({ok: false, erro: 'Faltam dados do laudo.'});
    if (!DECISOES[laudo.decisao]) return Promise.resolve({ok: false, erro: 'Decisão inválida: ' + laudo.decisao});
    if (laudo.decisao === 'APROVADO_CONCESSAO' && !laudo.autorizadoPor) {
      return Promise.resolve({ok: false, erro: 'Aprovação com concessão exige o nome de quem autorizou.'});
    }
    var agora = new Date().toISOString(), refLaudo = dbRef.ref('ops/' + chaveOp(opKey) + '/qualidadePA'), reservou = false;
    function soltar() { return reservou ? refLaudo.remove().catch(function() {}) : Promise.resolve(); }
    return refLaudo.transaction(function(atual) {
      if (atual) return; // já decidido (ou em decisão): aborta
      return {reservadoEm: agora, reservadoPor: autor || null};
    }).then(function(res) {
      if (!res || !res.committed) return {ok: false, erro: 'Este lote já tem laudo registrado — alguém decidiu antes.'};
      reservou = true;
      // Lote com inspeção total aberta (sinalizado pela Qualidade) não recebe laudo avulso: o
      // palete que chegou depois da sinalização espera a decisão da inspeção.
      return dbRef.ref('ops/' + chaveOp(opKey) + '/inspecaoTotal/estado').once('value').then(function(es) {
        if (es.val()) return soltar().then(function() {
          return {ok: false, erro: 'Este lote está em inspeção total (' + es.val() + '). Aguarde a decisão da inspeção antes de laudar o palete que chegou depois.'};
        });
        return gravarLaudo();
      });
      function gravarLaudo() {
      // Estado fresco de cada palete.
      return Promise.all(paletes.map(function(p) {
        return dbRef.ref('estoque_lotes/' + p.itemKey + '/' + p.loteKey).once('value').then(function(s) { return s.val(); });
      })).then(function(frescos) {
        var fora = frescos.filter(function(l) { return !l || l.status !== 'QUARENTENA'; });
        if (fora.length) return soltar().then(function() {
          return {ok: false, erro: 'Há palete deste lote que não está mais em quarentena. Atualize a tela.'};
        });
        var pal = paletes.map(function(p, i) { return {itemKey: p.itemKey, loteKey: p.loteKey, lote: frescos[i]}; });
        var pushKeys = {};
        pal.forEach(function(p) { pushKeys[p.loteKey] = dbRef.ref('movimentos_estoque/' + p.itemKey).push().key; });
        var q = deps.qualidadeDoLaudo(laudo, autor, agora);
        var plano = planejarGravacao({
          opKey: opKey, opLote: ctx.opLote, itemCodigo: ctx.itemCodigo || pal[0].lote.itemCodigo, loteOrigem: ctx.loteOrigem,
          paletes: pal, qualidade: q, amostragem: ctx.amostragem, agora: agora, autor: autor, pushKeys: pushKeys
        });
        return dbRef.ref().update(plano.updates).then(function() {
          var r = {ok: true, decisao: laudo.decisao, paletes: pal.length, saldo: plano.laudoLote.saldoLote};
          reservou = false; // gravado: não soltar mais
          if (laudo.decisao !== 'REPROVADO' && laudo.decisao !== 'RETIDO') return r;
          if (!deps.abrirRnc) return r;
          return deps.abrirRnc(dbRef, {
            classificacao: laudo.decisao === 'REPROVADO' ? 'MAIOR' : 'MENOR', origem: 'PRODUCAO',
            descricao: laudo.observacao || ('Lote ' + (ctx.loteOrigem || opKey) + ' de ' + (ctx.itemCodigo || pal[0].lote.itemCodigo) + ' com laudo ' +
              (deps.rotuloStatusLote ? deps.rotuloStatusLote(laudo.decisao) : laudo.decisao) + ' (' + pal.length + ' palete(s)).'),
            itemTipo: 'produto', itemCodigo: ctx.itemCodigo || pal[0].lote.itemCodigo, itemNome: ctx.itemNome || null, unidade: ctx.unidade || null,
            qtdEnvolvida: r.saldo, loteKey: pal[0].loteKey, loteOrigem: ctx.loteOrigem || null, opLote: ctx.opLote || null,
            acaoImediata: 'Lote bloqueado para expedição (todos os paletes).', automatica: true,
            fotos: laudo.fotos || null, fotosDispensadas: laudo.fotosDispensadas || false
          }, autor).then(function(rr) {
            r.rnc = rr.ok ? rr.numero : null; r.rncErro = rr.ok ? null : rr.erro; return r;
          }).catch(function(err) { r.rnc = null; r.rncErro = err.message; return r; });
        });
      });
      }
    }).catch(function(err) {
      return soltar().then(function() { return {ok: false, erro: err.message}; });
    });
  }

  return {
    DECISOES: DECISOES, LIBERA: LIBERA, caixasDoPalete: caixasDoPalete, paletesDoLote: paletesDoLote, filaLotes: filaLotes,
    amostragemPorPalete: amostragemPorPalete, textoAmostragem: textoAmostragem, planejarGravacao: planejarGravacao,
    heranca: heranca, paletesSemAmostragem: paletesSemAmostragem, registrarLaudoPaLote: registrarLaudoPaLote
  };
});
