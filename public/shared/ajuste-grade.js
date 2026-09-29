/* Ajustar a grade de Quantidades a partir do desvio (29/09).

   Pedido do usuário: quando a produção anda mais devagar (ou mais rápido)
   que o planejado, um botão para "empurrar o restante do pedido" na grade.
   A grade NÃO se ajusta sozinha: o auto-ajuste (autoAjustarPlanejamento,
   auth_check.js) foi pausado a pedido do PCP em 09/09 porque relinearizava
   a linha inteira por prioridade e a grade "mudava sem ninguém saber por
   quê". Este ajuste é o oposto, de propósito:
   - mexe num pedido só, o que o PCP escolheu;
   - o que falta produzir (pedido.qtdTotal − produzido) é comparado com o
     que a grade ainda reserva para ele daqui para a frente (soma do
     mediaPorHora dos horários futuros, em qualquer linha);
   - faltando, acrescenta horas logo depois do último horário dele na linha
     e empurra o que vem em seguida SÓ até o primeiro horário vago -- quem
     está depois da folga não se mexe;
   - sobrando (andou mais rápido), libera as últimas horas dele e não puxa
     ninguém para a frente: antecipar outro pedido é decisão do PCP
     (material, cliente), não do sistema;
   - devolve a prévia (quem anda, quantas horas) antes de gravar nada.

   Horários = horas úteis do turno (SequenciaSetor.horasUteisDoDia) a partir
   da hora corrente. A hora corrente entra se estiver vaga ou for do próprio
   pedido (pedido atrasado às 08:00 com a linha livre começa às 08:00, não
   às 09:00), e reserva só a fração que falta dela. Ocupada por outro
   pedido, fica de fora: não se insere nada antes do que já está rodando.
   Função pura, testada em run_ajuste_grade_test.js. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sequencia-setor.js'));
  else root.AjusteGrade = factory(root.SequenciaSetor);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(S) {
  'use strict';

  var HORIZONTE_DIAS = 60;
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hk(h) { return String(h).padStart(2, '0') + '_00'; }

  /* Índice envN da linha naquela hora -- mesma regra do apontamento
     (form.html, updateFormFromSchedule): o nome gravado em linhaN vence; sem
     nome gravado, vale a posição no cadastro de linhas. */
  function indiceDaLinha(hora, linha, linhasCfg) {
    var h = hora || {};
    for (var i = 1; i <= 10; i++) if (h['linha' + i] === linha) return i;
    var pos = (linhasCfg || []).indexOf(linha) + 1;
    return pos > 0 && !h['linha' + pos] ? pos : null;
  }

  // Horários úteis futuros de uma linha, com o que cada um tem.
  function horariosDaLinha(programacao, linha, linhasCfg, agora, cal, dias, pedidoKey) {
    var out = [];
    var dia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    for (var d = 0; d < (dias || HORIZONTE_DIAS); d++) {
      var data = ymd(dia);
      S.horasUteisDoDia(dia, cal).forEach(function(h) {
        if (d === 0 && h < agora.getHours()) return;
        var hora = ((programacao || {})[data] || {})[hk(h)] || {};
        var idx = indiceDaLinha(hora, linha, linhasCfg);
        if (!idx) return;
        var slot = hora['env' + idx];
        var conteudo = slot && typeof slot === 'object' && slot.pedidoKey ? slot : null;
        if (d === 0 && h === agora.getHours() && conteudo && conteudo.pedidoKey !== pedidoKey) return;
        out.push({data: data, hora: hk(h), idx: idx, conteudo: conteudo});
      });
      dia = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1);
    }
    return out;
  }

  // Quanto a grade ainda reserva para o pedido daqui para a frente, em todas as linhas.
  function reservadoFuturo(programacao, pedidoKey, agora) {
    var hoje = ymd(agora), total = 0;
    Object.keys(programacao || {}).forEach(function(data) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < hoje) return;
      Object.keys(programacao[data] || {}).forEach(function(chave) {
        var h = parseInt(chave, 10);
        if (data === hoje && h < agora.getHours()) return;
        // Hora corrente: só o que ainda falta dela.
        var fracao = data === hoje && h === agora.getHours() ? (60 - agora.getMinutes()) / 60 : 1;
        var hora = programacao[data][chave] || {};
        Object.keys(hora).forEach(function(k) {
          var s = hora[k];
          if (/^env\d+$/.test(k) && s && s.pedidoKey === pedidoKey) total += n(s.mediaPorHora) * fracao;
        });
      });
    });
    return total;
  }

  /* opts: {programacao, pedidoKey, pedido: {qtdTotal, produzido, produto, sku,
     mediaPorHora, id}, linha, linhasCfg, agora, cal, dias}
     Devolve {ok, horas (+ acrescenta / − libera), updates, movidos, resumo}. */
  function planejar(opts) {
    var o = opts || {};
    var ped = o.pedido || {};
    var falta = Math.max(n(ped.qtdTotal) - n(ped.produzido), 0);
    var reservado = reservadoFuturo(o.programacao, o.pedidoKey, o.agora);
    var horarios = horariosDaLinha(o.programacao, o.linha, o.linhasCfg, o.agora, o.cal, o.dias, o.pedidoKey);
    reservado = Math.round(reservado);
    if (!horarios.length) return {ok: false, erro: 'A linha ' + o.linha + ' não tem horário de turno cadastrado nos próximos dias.'};
    var meus = [];
    horarios.forEach(function(s, i) { if (s.conteudo && s.conteudo.pedidoKey === o.pedidoKey) meus.push(i); });
    var modelo = meus.length ? horarios[meus[meus.length - 1]].conteudo : null;
    var ritmo = n(modelo && modelo.mediaPorHora) || n(ped.mediaPorHora);
    var base = {falta: falta, reservado: reservado, ritmo: ritmo, linha: o.linha};

    var deficit = falta - reservado;
    var updates = {}, movidos = {}, horas = 0;
    function caminho(s) { return 'programacao/' + s.data + '/' + s.hora + '/env' + s.idx; }

    if (deficit > 0) {
      if (!(ritmo > 0)) return Object.assign(base, {ok: false, erro: 'O pedido não tem ritmo (un/h) na grade nem no cadastro para calcular as horas.'});
      horas = Math.ceil(deficit / ritmo);
      var novo = {pedidoKey: o.pedidoKey, produto: (modelo && modelo.produto) || ped.produto || '', sku: (modelo && modelo.sku) || ped.sku || '', mediaPorHora: ritmo};
      var ins = meus.length ? meus[meus.length - 1] + 1 : 0;
      var conteudos = horarios.map(function(s) { return s.conteudo; });
      var inseridos = [];
      for (var k = 0; k < horas; k++) inseridos.push(Object.assign({}, novo));
      var nova = conteudos.slice(0, ins).concat(inseridos, conteudos.slice(ins));
      // A folga absorve o empurrão: tira o primeiro horário VAGO depois dos inseridos, k vezes.
      var tirar = horas;
      for (var i = ins + horas; i < nova.length && tirar > 0; ) {
        if (nova[i] === null) { nova.splice(i, 1); tirar--; } else i++;
      }
      if (tirar > 0) return Object.assign(base, {ok: false, erro: 'Não há ' + horas + ' h vagas na ' + o.linha + ' nos próximos ' + (o.dias || HORIZONTE_DIAS) + ' dias para absorver o empurrão.'});
      // Mesmo conteúdo no mesmo horário (B continua às 14h) não se regrava.
      horarios.forEach(function(s, j) {
        if (JSON.stringify(nova[j] || null) === JSON.stringify(s.conteudo || null)) return;
        updates[caminho(s)] = nova[j] || null;
        var quem = s.conteudo && s.conteudo.pedidoKey;
        if (quem && quem !== o.pedidoKey) movidos[quem] = true;
      });
    } else {
      // Sobra: libera do fim enquanto o que resta ainda cobre o que falta.
      var sobra = reservado;
      for (var m = meus.length - 1; m >= 0; m--) {
        var s = horarios[meus[m]];
        var mph = n(s.conteudo.mediaPorHora);
        if (sobra - mph < falta) break;
        sobra -= mph;
        updates[caminho(s)] = null;
        horas--;
      }
    }
    if (!horas) return Object.assign(base, {ok: true, horas: 0, updates: {}, movidos: [], resumo: 'A grade já reserva o que falta produzir deste pedido. Nada a ajustar.'});
    var primeiro = null, ultimo = null;
    horarios.forEach(function(s) {
      var v = updates[caminho(s)];
      if (v !== undefined) { if (!primeiro) primeiro = s; ultimo = s; }
    });
    var lista = Object.keys(movidos);
    var resumo = horas > 0
      ? 'Acrescentar ' + horas + ' h ao pedido na ' + o.linha + ' (faltam ' + falta + ' un; a grade reservava ' + reservado + ' un a ' + ritmo + ' un/h).' +
        (lista.length ? ' Empurra ' + lista.length + ' outro(s) pedido(s) até o primeiro horário vago.' : ' Cabe em horário vago, sem empurrar ninguém.')
      : 'Liberar ' + (-horas) + ' h do fim do pedido na ' + o.linha + ' (faltam ' + falta + ' un; a grade reservava ' + reservado + ' un). Ninguém é puxado para a frente.';
    return Object.assign(base, {ok: true, horas: horas, updates: updates, movidos: lista, resumo: resumo,
      de: primeiro && (primeiro.data + ' ' + primeiro.hora.replace('_', ':')), ate: ultimo && (ultimo.data + ' ' + ultimo.hora.replace('_', ':'))});
  }

  /* Linha onde o ajuste acontece: a do ÚLTIMO horário futuro do pedido (é
     depois dele que as horas entram). Pedido sem horário futuro: null, e a
     tela usa a linha onde a OP está na Sequência. */
  function linhaDoPedido(programacao, pedidoKey, linhasCfg, agora) {
    var hoje = ymd(agora), achada = null, chaveAchada = '';
    Object.keys(programacao || {}).forEach(function(data) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < hoje) return;
      Object.keys(programacao[data] || {}).forEach(function(chave) {
        if (data === hoje && !(parseInt(chave, 10) > agora.getHours())) return;
        var hora = programacao[data][chave] || {};
        Object.keys(hora).forEach(function(k) {
          var e = /^env(\d+)$/.exec(k);
          if (!e || !hora[k] || hora[k].pedidoKey !== pedidoKey) return;
          var ordem = data + ' ' + chave;
          if (ordem >= chaveAchada) { chaveAchada = ordem; achada = hora['linha' + e[1]] || (linhasCfg || [])[+e[1] - 1] || ('Linha ' + e[1]); }
        });
      });
    });
    return achada;
  }

  return {planejar: planejar, linhaDoPedido: linhaDoPedido, horariosDaLinha: horariosDaLinha, reservadoFuturo: reservadoFuturo, indiceDaLinha: indiceDaLinha};
});
