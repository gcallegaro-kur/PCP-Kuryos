/* Log de eventos de programação: quem tirou a OP da linha, quem programou,
   quem encerrou, e o que o SISTEMA fez sozinho.

   Pedido do usuário (2026-10-07): "casos que citam 'a OP x apareceu na linha 1
   sozinha', quero investigar quem colocou ou se de fato foi sozinho" e
   "quero ver esse tipo de movimentação, o que/quem tirou uma op de linha,
   encerrou, ajustou programação".

   POR QUE UM NÓ NOVO, e não reaproveitar `ajustes_planejamento`:
   aquele nó tem `.write` liberado para production/rotulagem/pcp/admin e
   `.read` para qualquer autenticado. Um log de auditoria que as pessoas
   auditadas podem reescrever ou apagar não é log -- é recado. Aqui seguimos
   o padrão que `rearranjos_linhas` já usa neste repo: leitura só do admin e
   escrita que não dá pra editar nem apagar. A diferença é que lá quem grava
   é só o servidor; aqui o cliente também grava, então a regra do banco faz
   três coisas que o cliente não pode burlar:
     - só CRIAR (sem update, sem delete);
     - `porUid` tem que ser igual ao `auth.uid` de quem grava -- não dá pra
       assinar no lugar de outro;
     - `.read` apenas admin.
   O SDK admin (servidor) ignora regras, e é assim que o evento automático
   entra como porUid 'sistema'.

   `ajustes_planejamento` continua intocado: ele é dado OPERACIONAL, lido pelo
   planejamento.html para mostrar o que mudou no dia, e mexer nele quebraria
   aquela tela para quem não é admin.

   Funções PURAS, testadas em run_eventos_auditoria_test.js. A única função
   que toca o banco é `registrar`, e ela é best-effort DE PROPÓSITO: o log é
   reflexo da operação, nunca pré-requisito dela. Se o push falhar, a
   programação já foi gravada e não se desfaz por causa do log -- mesmo
   critério que `ajustarEstoque` documenta em utils.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventosAuditoria = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var NO = 'eventos_auditoria';

  /* As ações são fechadas de propósito: uma tela de auditoria que aceita
     string livre vira sopa de rótulos divergentes em três meses, e filtro
     por ação para de funcionar. */
  var ACOES = {
    // ── Programação (grade semanal / horizonte / servidor) ──
    PROGRAMAR: 'PROGRAMAR',                     // OP ganhou linha e horário
    MOVER: 'MOVER',                             // mudou de horário na mesma linha
    TROCAR_LINHA: 'TROCAR_LINHA',               // mudou de linha
    TIRAR: 'TIRAR',                             // slot/bloco da grade apagado
    CONGELAR: 'CONGELAR',                        // horizonte congelou alocação na grade
    VINCULO_AUTOMATICO: 'VINCULO_AUTOMATICO',   // o SERVIDOR pôs a OP na linha
    ENCERRAR: 'ENCERRAR',                       // etapa/OP encerrada (confirmação do PCP)
    // ── Apontamento (chão de fábrica) ──
    // Aqui o que importa é o LOGIN. Até 07/10/2026 o apontamento gravava só
    // o nome DIGITADO no campo "operador" (autocomplete de config.operadores)
    // -- ninguém sabia qual conta registrou a produção.
    APONTAR: 'APONTAR',                         // produção registrada
    APONTAR_EDITADO: 'APONTAR_EDITADO',         // apontamento alterado depois
    APONTAR_EXCLUIDO: 'APONTAR_EXCLUIDO',       // apontamento apagado
    OP_NA_LINHA: 'OP_NA_LINHA',                 // operador escolheu a OP da linha
    PARAR_LINHA: 'PARAR_LINHA',
    RETOMAR_LINHA: 'RETOMAR_LINHA',
    ENCERRAR_TURNO: 'ENCERRAR_TURNO'
  };

  // Rótulos para a tela. Verbo no passado, porque todo evento já aconteceu.
  var ROTULOS = {
    PROGRAMAR: 'programou',
    MOVER: 'moveu de horário',
    TROCAR_LINHA: 'trocou de linha',
    TIRAR: 'tirou da grade',
    CONGELAR: 'congelou na grade',
    VINCULO_AUTOMATICO: 'foi posta na linha pelo sistema',
    ENCERRAR: 'encerrou',
    APONTAR: 'apontou',
    APONTAR_EDITADO: 'editou o apontamento',
    APONTAR_EXCLUIDO: 'EXCLUIU o apontamento',
    OP_NA_LINHA: 'colocou',
    PARAR_LINHA: 'parou',
    RETOMAR_LINHA: 'retomou',
    ENCERRAR_TURNO: 'encerrou o turno em'
  };

  function texto(v, max) {
    var s = String(v == null ? '' : v).trim();
    return max ? s.slice(0, max) : s;
  }
  function numeroOuNulo(v) {
    var n = Number(v);
    return isFinite(n) && n !== 0 ? n : null;
  }

  /* Dia do balde, em horário LOCAL e não UTC.
     Uma OP tirada da grade às 21h de Brasília cairia no dia seguinte se o
     balde saísse de toISOString(), e a auditoria do dia não acharia o
     evento onde o usuário jurou que ele estava. */
  function diaLocal(em) {
    var d = em instanceof Date ? em : new Date(em || Date.now());
    if (isNaN(d.getTime())) d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* Monta o registro. Devolve { dia, registro } ou { erro }.
     Valida pouco e de propósito: o que NÃO pode faltar é ação, autor e
     instante -- sem um dos três o evento não serve para auditar nada. O
     resto é contexto e pode faltar sem invalidar o registro. */
  function montar(dados) {
    var d = dados || {};
    var acao = texto(d.acao).toUpperCase();
    if (!ACOES[acao]) return { erro: 'ação desconhecida: "' + texto(d.acao) + '"' };

    var porUid = texto(d.porUid, 128);
    if (!porUid) return { erro: 'evento sem autor (porUid)' };

    var em = d.em instanceof Date ? d.em.toISOString() : texto(d.em) || new Date().toISOString();
    if (isNaN(new Date(em).getTime())) return { erro: 'instante inválido: "' + texto(d.em) + '"' };

    var registro = {
      acao: acao,
      lote: texto(d.lote, 60) || null,
      pedidoKey: texto(d.pedidoKey, 120) || null,
      produto: texto(d.produto, 160) || null,
      linhaDe: texto(d.linhaDe, 60) || null,
      linhaPara: texto(d.linhaPara, 60) || null,
      data: texto(d.data, 10) || null,     // dia da GRADE afetada (≠ dia do evento)
      hora: texto(d.hora, 5) || null,
      horas: numeroOuNulo(d.horas),
      // ── Apontamento ──
      quantidade: numeroOuNulo(d.quantidade),
      turno: texto(d.turno, 40) || null,
      registroId: texto(d.registroId, 80) || null,
      /* O nome que a pessoa DIGITOU no campo "operador", guardado ao lado do
         login de quem gravou. Os dois são fatos diferentes e os dois importam:
         o operador é quem rodou a máquina, o login é quem registrou -- pode
         ser o líder apontando pelo time. O valor da auditoria está justamente
         em poder COMPARAR os dois, não em substituir um pelo outro. */
      operadorDigitado: texto(d.operadorDigitado, 120) || null,
      // Para edição/exclusão de apontamento: o que havia e o que passou a ser.
      antes: texto(d.antes, 400) || null,
      depois: texto(d.depois, 400) || null,
      motivo: texto(d.motivo, 400) || null,
      porUid: porUid,
      porNome: texto(d.porNome, 120) || null,
      papel: texto(d.papel, 40) || null,
      origem: texto(d.origem, 120) || null,
      em: em
    };
    return { dia: diaLocal(em), registro: registro };
  }

  /* Frase legível. É o que a tela mostra na linha de tempo -- e é o que
     responde "foi sozinho?" sem o admin ter que interpretar campos. */
  function descrever(ev) {
    var e = ev || {};
    var quem = e.porUid === 'sistema' ? 'O sistema' : (e.porNome || 'Alguém');

    /* Artigo e contração separados do nome do alvo. Concatenar "de" com um
       alvo que já trazia artigo produzia "de a OP 26273/03" -- e uma tela de
       auditoria que escreve errado perde autoridade justamente onde ela
       precisa ser levada a sério. "OP" é feminino; pedido e item, masculino. */
    var alvo, fem;
    if (e.lote) { alvo = 'OP ' + e.lote; fem = true; }
    else if (e.pedidoKey) { alvo = 'pedido ' + String(e.pedidoKey).split('__')[0]; fem = false; }
    else { alvo = 'item'; fem = false; }
    var o = fem ? 'a' : 'o';          // "a OP" / "o pedido"
    var doDa = fem ? 'da' : 'do';     // "da OP" / "do pedido"
    var verbo = ROTULOS[e.acao] || String(e.acao || '').toLowerCase();

    if (e.acao === ACOES.VINCULO_AUTOMATICO) {
      return o.toUpperCase() + ' ' + alvo + ' ' + verbo +
        (e.linhaPara ? ' (' + e.linhaPara + ')' : '') + '.';
    }

    /* Apontamento: a frase mostra os DOIS nomes quando eles diferem.
       "Robert apontou 800 un da OP 26273/03 na Linha 1, informando Luana como
       operador" é a informação que o admin quer -- e é impossível de montar
       se o sistema guardar só um dos dois. */
    if (e.acao === ACOES.APONTAR) {
      var f = quem + ' apontou' + (e.quantidade ? ' ' + e.quantidade + ' un' : '') + ' ' + doDa + ' ' + alvo;
      if (e.linhaPara) f += ' na ' + e.linhaPara;
      if (e.operadorDigitado && e.operadorDigitado !== e.porNome) {
        f += ', informando ' + e.operadorDigitado + ' como operador';
      }
      if (e.turno) f += ' (turno ' + e.turno + ')';
      return f + '.';
    }
    if (e.acao === ACOES.APONTAR_EDITADO || e.acao === ACOES.APONTAR_EXCLUIDO) {
      var g = quem + ' ' + verbo + ' ' + doDa + ' ' + alvo;
      if (e.antes && e.depois) g += ': ' + e.antes + ' → ' + e.depois;
      else if (e.antes) g += ' (era: ' + e.antes + ')';
      return g + '.';
    }
    if (e.acao === ACOES.PARAR_LINHA || e.acao === ACOES.RETOMAR_LINHA) {
      var h = quem + ' ' + verbo + ' a ' + (e.linhaDe || e.linhaPara || 'linha');
      if (e.lote) h += ' (' + alvo + ')';
      if (e.motivo && e.acao === ACOES.PARAR_LINHA) h += ' — ' + e.motivo;
      return h + '.';
    }
    // "colocou a OP X na Linha 1": o alvo e a OP, o destino e a linha.
    if (e.acao === ACOES.OP_NA_LINHA) {
      return quem + ' colocou ' + o + ' ' + alvo +
        (e.linhaPara ? ' na ' + e.linhaPara : '') + '.';
    }
    if (e.acao === ACOES.ENCERRAR_TURNO) {
      return quem + ' encerrou o turno' + (e.turno ? ' ' + e.turno : '') +
        (e.linhaDe || e.linhaPara ? ' na ' + (e.linhaDe || e.linhaPara) : '') + '.';
    }

    var frase = quem + ' ' + verbo + ' ' + o + ' ' + alvo;
    if (e.acao === ACOES.TROCAR_LINHA && e.linhaDe && e.linhaPara) {
      frase += ': ' + e.linhaDe + ' → ' + e.linhaPara;
    } else if (e.linhaPara) {
      frase += ' na ' + e.linhaPara;
    } else if (e.linhaDe) {
      frase += ' da ' + e.linhaDe;
    }
    if (e.data) frase += ' em ' + e.data + (e.hora ? ' ' + e.hora : '');
    if (e.horas) frase += ' (' + e.horas + 'h)';
    return frase + '.';
  }

  /* Grava. Best-effort: NUNCA rejeita, para não derrubar a operação que
     acabou de dar certo. Devolve Promise de { ok } ou { ok:false, erro }. */
  function registrar(dbRef, dados) {
    var m = montar(dados);
    if (m.erro) {
      // Evento malformado é defeito de quem chamou, não do operador: aparece
      // no console e segue, em vez de interromper a tela.
      try { console.error('EventosAuditoria: ' + m.erro, dados); } catch (e) {}
      return Promise.resolve({ ok: false, erro: m.erro });
    }
    if (!dbRef || typeof dbRef.ref !== 'function') return Promise.resolve({ ok: false, erro: 'sem dbRef' });
    try {
      return dbRef.ref(NO + '/' + m.dia).push(m.registro)
        .then(function() { return { ok: true }; })
        .catch(function(err) {
          try { console.error('EventosAuditoria: falha ao gravar o log', err); } catch (e) {}
          return { ok: false, erro: err && err.message };
        });
    } catch (err) {
      return Promise.resolve({ ok: false, erro: err && err.message });
    }
  }

  /* Atalho para as telas: completa autor/papel a partir do usuário logado.
     Sem usuário, grava 'desconhecido' em vez de não gravar -- um evento sem
     nome ainda diz O QUE aconteceu e QUANDO, e isso vale mais que silêncio. */
  function registrarComoUsuario(dbRef, usuario, dados) {
    var u = usuario || {};
    var d = dados || {};
    return registrar(dbRef, Object.assign({}, d, {
      porUid: d.porUid || u.uid || 'desconhecido',
      porNome: d.porNome || u.nome || null,
      papel: d.papel || u.role || null
    }));
  }

  /* Junta as fontes numa linha de tempo só, ordenada do mais recente para o
     mais antigo. Existe porque metade do que o admin quer ver JÁ era gravada
     em outros nós antes deste log existir -- e esses são retroativos, então
     a tela nasce com histórico em vez de vazia.

     Entradas (todas opcionais):
       eventos    = eventos_auditoria/{dia}/{id}  (este log)
       rearranjos = rearranjos_linhas/{id}          (servidor, já existia)
       ops        = ops/{lote}                      (confirmacaoEtapas, cancelamento) */
  function linhaDoTempo(fontes) {
    var f = fontes || {};
    var saida = [];

    Object.keys(f.eventos || {}).forEach(function(dia) {
      var doDia = f.eventos[dia] || {};
      Object.keys(doDia).forEach(function(id) {
        var ev = doDia[id];
        if (!ev || typeof ev !== 'object') return;
        saida.push(Object.assign({ id: id, fonte: 'eventos_auditoria' }, ev));
      });
    });

    Object.keys(f.rearranjos || {}).forEach(function(id) {
      var r = f.rearranjos[id];
      if (!r || typeof r !== 'object') return;
      saida.push({
        id: id, fonte: 'rearranjos_linhas',
        acao: ACOES.TROCAR_LINHA,
        lote: r.lote || null,
        linhaDe: r.origem || null, linhaPara: r.destino || null,
        porUid: r.uid || null, porNome: r.porNome || r.autor || null,
        motivo: r.motivo || 'rearranjo de linhas',
        em: r.em || r.quando || r.agora || null
      });
    });

    Object.keys(f.ops || {}).forEach(function(lote) {
      var op = f.ops[lote];
      if (!op || typeof op !== 'object') return;
      var etapas = op.confirmacaoEtapas || {};
      Object.keys(etapas).forEach(function(etapa) {
        var e = etapas[etapa] || {};
        if (!e.confirmadoEm) return;
        saida.push({
          id: lote + ':' + etapa, fonte: 'ops.confirmacaoEtapas',
          acao: ACOES.ENCERRAR,
          lote: op.lote || lote, produto: op.produto || null,
          linhaPara: op.linha || null,
          motivo: 'etapa ' + etapa + (e.quantidade != null ? ' — ' + e.quantidade + ' un' : ''),
          porUid: e.confirmadoUid || null, porNome: e.confirmadoPor || null,
          em: e.confirmadoEm
        });
      });
      if (op.canceladoEm) {
        saida.push({
          id: lote + ':cancelada', fonte: 'ops.cancelamento',
          acao: ACOES.TIRAR,
          lote: op.lote || lote, produto: op.produto || null, linhaDe: op.linha || null,
          motivo: 'OP cancelada' + (op.justificativaCancelamento ? ': ' + op.justificativaCancelamento : ''),
          porUid: null, porNome: op.canceladoPor || null,
          em: op.canceladoEm
        });
      }
    });

    // Sem instante não dá para posicionar na linha de tempo; some do meio e
    // vai para o fim, marcado, em vez de bagunçar a ordem silenciosamente.
    var comData = saida.filter(function(e) { return e.em && !isNaN(new Date(e.em).getTime()); });
    var semData = saida.filter(function(e) { return !(e.em && !isNaN(new Date(e.em).getTime())); });
    comData.sort(function(a, b) { return new Date(b.em) - new Date(a.em); });
    return comData.concat(semData.map(function(e) {
      return Object.assign({}, e, { semInstante: true });
    }));
  }

  /* Filtro da tela. Tudo opcional; o que vier vazio não restringe. */
  function filtrar(lista, filtro) {
    var f = filtro || {};
    var busca = texto(f.busca).toLowerCase();
    var compacto = busca.replace(/[^a-z0-9]/g, '');
    return (lista || []).filter(function(e) {
      if (f.acao && e.acao !== f.acao) return false;
      if (f.porUid && e.porUid !== f.porUid) return false;
      if (f.linha && e.linhaDe !== f.linha && e.linhaPara !== f.linha) return false;
      if (f.de && e.em && String(e.em).slice(0, 10) < f.de) return false;
      if (f.ate && e.em && String(e.em).slice(0, 10) > f.ate) return false;
      if (busca) {
        // "26273/03", "26273-03" e "2627303" são o mesmo lote -- mesma
        // tolerância que o dossiê do lote já aplica.
        var alvo = [e.lote, e.pedidoKey, e.produto, e.porNome, e.motivo]
          .map(function(v) { return String(v == null ? '' : v).toLowerCase(); }).join(' ');
        if (alvo.indexOf(busca) === -1 &&
            alvo.replace(/[^a-z0-9]/g, '').indexOf(compacto) === -1) return false;
      }
      return true;
    });
  }

  return {
    NO: NO, ACOES: ACOES, ROTULOS: ROTULOS,
    diaLocal: diaLocal,
    montar: montar,
    descrever: descrever,
    registrar: registrar,
    registrarComoUsuario: registrarComoUsuario,
    linhaDoTempo: linhaDoTempo,
    filtrar: filtrar
  };
});
