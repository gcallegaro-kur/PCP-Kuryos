'use strict';
/* Feedback da semana -- tela do colaborador (06/10/2026). Regras em shared/feedback-clima.js (puro, testado em
   run_feedback_clima_test.js) e no banco (run_feedback_clima_rules_test.js). O colaborador avalia os colegas do setor
   (temporários inclusive), o líder direto e responde a pesquisa de clima. Responde e NÃO vê resultado, nota nem média. */
(function() {
  var db = firebase.database();
  var F = FeedbackClima;
  var S = {cfg: {}, dir: {}, meuId: undefined, feitos: {}, carregou: {}, ab: {}, iniciou: false, uid: null};

  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function hojeYmd() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function toast(msg, erro) { var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 6000); }
  function ciclo() { return F.ciclo(S.cfg.ciclo); }
  function lista(chave, padrao) { var v = S.cfg[chave]; if (!v) return padrao; var a = Array.isArray(v) ? v : Object.keys(v).sort(function(x, y) { return Number(x) - Number(y); }).map(function(k) { return v[k]; }); return a.length ? a : padrao; }
  function modelos() { return {par: lista('modeloPar', F.MODELO_PAR), lider: lista('modeloLider', F.MODELO_LIDER), clima: lista('modeloClima', F.MODELO_CLIMA)}; }
  function periodo() { return F.periodoDe(hojeYmd(), S.cfg.ciclo); }

  function pronto() { return S.carregou.cfg && S.carregou.dir && S.carregou.me && (S.meuId == null || S.carregou.feitos) && window.currentUser; }
  function render() {
    if (!pronto()) return;
    var c = ciclo(), p = periodo(), box = el('conteudo');
    el('periodoTxt').textContent = F.rotuloPeriodo(p) + ' · prazo ' + F.dataBR(p.prazo);
    if (!S.meuId) {
      box.innerHTML = '<div class="card"><h2>Seu login ainda não está ligado ao seu cadastro</h2><p class="dica">Para avaliar colegas e responder a pesquisa, o RH precisa vincular o seu login ao seu cadastro de colaborador (RH › Colaboradores › "Login vinculado"). Fale com o RH.</p></div>';
      return;
    }
    var eu = S.dir[S.meuId] || {}, alvos = F.alvosDe(S.meuId, S.dir, hojeYmd()), m = modelos();
    var feitos = S.feitos || {};
    var itens = [];
    alvos.pares.forEach(function(x) { itens.push({tipo: 'par', alvo: x}); });
    if (alvos.lider) itens.push({tipo: 'lider', alvo: Object.assign({tipo: 'colaborador'}, alvos.lider)});
    var feitosN = itens.filter(function(i) { return feitos[i.alvo.id]; }).length;
    var climaFeito = !!feitos._clima;
    var h = '';
    if (!c.ativo) h += '<div class="aviso warn"><b>Pesquisa pausada.</b> O RH pausou o ciclo; por enquanto não é possível enviar respostas.</div>';
    if (hojeYmd() > p.prazo) h += '<div class="aviso warn">O prazo deste ciclo foi <b>' + e(F.dataBR(p.prazo)) + '</b>. Ainda dá para responder; a resposta fica marcada como fora do prazo.</div>';
    h += '<div class="aviso info"><b>Como isto é usado.</b> O resultado <b>não entra</b> na sua nota trimestral, não compõe promoção nem decide aumento: é um termômetro de desenvolvimento e de clima. Seus colegas <b>nunca</b> veem quem deu qual nota. ' +
      (c.rhVeAutoria ? 'O RH <b>consegue ver quem avaliou</b>. ' : 'O RH <b>não vê quem avaliou</b>: a avaliação é gravada sem o seu nome. ') +
      (c.rhVeAutoriaClima ? 'Na pesquisa de clima o RH <b>também consegue ver quem respondeu</b>. ' : 'Na pesquisa de clima a resposta é gravada <b>sem o seu nome</b>. ') +
      'Você responde e não vê o resultado; o RH usa os dados para decidir o que melhorar.</div>';
    if (alvos.semSetor) h += '<div class="aviso warn">O seu cadastro está <b>sem setor</b>, então você só avalia o seu líder (e não aparece como colega de ninguém). Peça ao RH para preencher.</div>';
    h += '<div class="resumo"><div><span class="mut">Avaliações</span><b>' + feitosN + ' de ' + itens.length + '</b></div><div><span class="mut">Pesquisa de clima</span><b>' + (climaFeito ? 'respondida ✓' : 'pendente') + '</b></div></div>';
    if (!itens.length) h += '<div class="card"><h2>Ninguém para avaliar neste ciclo</h2><p class="dica">Não há colegas do seu setor nem líder cadastrado para você avaliar agora.</p></div>';
    var pendentes = itens.filter(function(i) { return !feitos[i.alvo.id]; }), feitosL = itens.filter(function(i) { return feitos[i.alvo.id]; });
    pendentes.forEach(function(i) { h += cartao(i, m, eu); });
    h += blocoClima(m, climaFeito);
    if (feitosL.length) h += '<div class="card"><h2>Já respondidos neste ciclo</h2><p class="dica">' + feitosL.map(function(i) { return e(i.alvo.nome) + (i.tipo === 'lider' ? ' (líder)' : ''); }).join(' · ') + '</p></div>';
    box.innerHTML = h;
    ligar(m, eu, alvos);
  }

  function cartao(i, m, eu) {
    var modelo = i.tipo === 'lider' ? m.lider : m.par, id = i.alvo.id;
    var h = '<div class="card alvo" data-alvo="' + e(id) + '" data-tipo="' + i.tipo + '"><h2>' + e(i.alvo.nome) + ' <span class="tg ' + (i.tipo === 'lider' ? 'info' : i.alvo.tipo === 'temporario' ? 'warn' : 'mute') + '">' + (i.tipo === 'lider' ? 'Seu líder' : i.alvo.tipo === 'temporario' ? 'Temporário' : 'Colega') + '</span></h2>';
    modelo.forEach(function(c) {
      h += '<div class="crit"><div class="ctx"><b>' + e(c.nome) + '</b><span class="dica">' + e(c.def || '') + '</span></div><div class="esc" role="radiogroup" aria-label="' + e(c.nome) + '">' +
        F.ESCALA.map(function(n) { return '<button type="button" class="nt" role="radio" aria-checked="false" data-c="' + e(c.id) + '" data-n="' + n + '">' + n + '</button>'; }).join('') + '</div></div>';
    });
    h += '<div class="legenda dica">1 = muito abaixo · 3 = esperado · 5 = muito acima</div><label class="t" style="margin-top:8px">Observação (opcional, até 1000 caracteres)</label><textarea class="com" rows="2" maxlength="1000"></textarea>' +
      '<div class="erros aviso bad" style="display:none"></div><div style="margin-top:10px"><button type="button" class="btn pri enviar">Enviar avaliação</button></div></div>';
    return h;
  }
  function blocoClima(m, feito) {
    if (feito) return '<div class="card"><h2>Pesquisa de clima</h2><p class="dica">Você já respondeu neste ciclo. Obrigado!</p></div>';
    var h = '<div class="card" id="cardClima"><h2>Pesquisa de clima</h2><p class="dica">Sobre a sua experiência, não sobre terceiros. Leva menos de um minuto.</p>';
    m.clima.forEach(function(q) {
      if (q.tipo === 'texto') h += '<div class="crit"><div class="ctx"><b>' + e(q.texto) + '</b></div><textarea class="cq" data-q="' + e(q.id) + '" rows="2" maxlength="1000"></textarea></div>';
      else h += '<div class="crit"><div class="ctx"><b>' + e(q.texto) + '</b></div><div class="esc" role="radiogroup" aria-label="' + e(q.texto) + '">' + F.ESCALA.map(function(n) { return '<button type="button" class="nt" role="radio" aria-checked="false" data-q="' + e(q.id) + '" data-n="' + n + '">' + n + '</button>'; }).join('') + '</div></div>';
    });
    h += '<div class="legenda dica">1 = discordo totalmente · 5 = concordo totalmente</div><label class="t" style="margin-top:8px">Tem algo que você queira contar ao RH? (opcional)</label><textarea id="recado" rows="3" maxlength="2000"></textarea>' +
      '<div id="errosClima" class="aviso bad" style="display:none"></div><div style="margin-top:10px"><button type="button" class="btn pri" id="enviarClima">Enviar pesquisa de clima</button></div></div>';
    return h;
  }

  function marcar(botoes, btn) {
    botoes.forEach(function(b) { var on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
  }
  function ligar(m, eu, alvos) {
    document.querySelectorAll('.alvo').forEach(function(card) {
      card.querySelectorAll('.crit').forEach(function(linha) {
        var bs = [].slice.call(linha.querySelectorAll('.nt'));
        bs.forEach(function(b) { b.onclick = function() { marcar(bs, b); }; });
      });
      card.querySelector('.enviar').onclick = function() { enviarAvaliacao(card, m, eu, alvos); };
    });
    var bc = el('enviarClima');
    if (bc) {
      document.querySelectorAll('#cardClima .crit').forEach(function(linha) { var bs = [].slice.call(linha.querySelectorAll('.nt')); bs.forEach(function(b) { b.onclick = function() { marcar(bs, b); }; }); });
      bc.onclick = function() { enviarClima(m, eu, alvos); };
    }
  }

  function participacao(alvos, extraPares, extraLider, extraClima) {
    var f = S.feitos || {}, pares = alvos.pares.filter(function(x) { return f[x.id]; }).length + (extraPares || 0);
    return {pares: pares, lider: !!((alvos.lider && f[alvos.lider.id]) || extraLider), clima: !!(f._clima || extraClima),
            esperadoPares: alvos.pares.length, esperadoLider: alvos.lider ? 1 : 0, atualizadoEm: new Date().toISOString()};
  }
  function mostrarErros(box, erros) { box.style.display = erros.length ? '' : 'none'; box.innerHTML = erros.map(e).join('<br>'); }

  function enviarAvaliacao(card, m, eu, alvos) {
    var tipo = card.getAttribute('data-tipo'), alvoId = card.getAttribute('data-alvo'), modelo = tipo === 'lider' ? m.lider : m.par, c = ciclo(), p = periodo();
    var notas = {};
    card.querySelectorAll('.nt.on').forEach(function(b) { notas[b.getAttribute('data-c')] = Number(b.getAttribute('data-n')); });
    var comentario = card.querySelector('.com').value.trim();
    var erros = F.validarResposta(modelo, {notas: notas, comentario: comentario});
    mostrarErros(card.querySelector('.erros'), erros);
    if (erros.length) return;
    if (!c.ativo) { toast('A pesquisa está pausada pelo RH.', true); return; }
    var alvo = S.dir[alvoId] || {}, btn = card.querySelector('.enviar');
    btn.disabled = true;
    var reg = {tipo: tipo, avaliadoId: alvoId, avaliadoTipo: alvo.tipo === 'temporario' ? 'temporario' : 'colaborador', setor: eu.setor || '', notas: notas, criadoEm: new Date().toISOString()};
    if (c.rhVeAutoria) reg.avaliadorId = S.meuId;
    if (comentario) reg.comentario = comentario;
    if (hojeYmd() > p.prazo) reg.atraso = true;
    var chave = db.ref('feedback_respostas/' + p.id).push().key, up = {};
    up['feedback_respostas/' + p.id + '/' + chave] = reg;
    up['feedback_feitos/' + p.id + '/' + S.uid + '/' + alvoId] = true;
    up['feedback_participacao/' + p.id + '/' + S.meuId] = participacao(alvos, tipo === 'par' ? 1 : 0, tipo === 'lider', false);
    db.ref().update(up).then(function() { toast('Avaliação enviada. Obrigado!'); S.feitos = Object.assign({}, S.feitos, (function() { var o = {}; o[alvoId] = true; return o; })()); render(); })
      .catch(function(err) { btn.disabled = false; toast(/permission/i.test(err.message) ? 'Não foi possível enviar: você já avaliou esta pessoa neste ciclo, ou ela não está na sua lista.' : err.message, true); });
  }

  function enviarClima(m, eu, alvos) {
    var c = ciclo(), p = periodo(), respostas = {};
    document.querySelectorAll('#cardClima .nt.on').forEach(function(b) { respostas[b.getAttribute('data-q')] = Number(b.getAttribute('data-n')); });
    document.querySelectorAll('#cardClima .cq').forEach(function(t) { if (t.value.trim()) respostas[t.getAttribute('data-q')] = t.value.trim(); });
    var recado = el('recado').value.trim(), erros = F.validarClima(m.clima, respostas, recado);
    mostrarErros(el('errosClima'), erros);
    if (erros.length) return;
    if (!c.ativo) { toast('A pesquisa está pausada pelo RH.', true); return; }
    el('enviarClima').disabled = true;
    var reg = {setor: eu.setor || '', respostas: respostas, criadoEm: new Date().toISOString()};
    if (c.rhVeAutoriaClima) reg.colaboradorId = S.meuId;
    if (recado) reg.recadoRh = recado;
    if (hojeYmd() > p.prazo) reg.atraso = true;
    var chave = db.ref('clima_respostas/' + p.id).push().key, up = {};
    up['clima_respostas/' + p.id + '/' + chave] = reg;
    up['feedback_feitos/' + p.id + '/' + S.uid + '/_clima'] = true;
    up['feedback_participacao/' + p.id + '/' + S.meuId] = participacao(alvos, 0, false, true);
    db.ref().update(up).then(function() { toast('Pesquisa enviada. Obrigado!'); S.feitos = Object.assign({}, S.feitos, {_clima: true}); render(); })
      .catch(function(err) { el('enviarClima').disabled = false; toast(/permission/i.test(err.message) ? 'Não foi possível enviar: a pesquisa deste ciclo já foi respondida.' : err.message, true); });
  }

  /* ── Carga ── */
  var ouvindoFeitos = null;
  function iniciar() {
    if (S.iniciou) return; S.iniciou = true;
    S.uid = firebase.auth().currentUser.uid;
    dbOnValue(db.ref('feedback_config'), function(s) { S.cfg = s.val() || {}; S.carregou.cfg = true; trocarPeriodo(); render(); }, {onError: function() { S.carregou.cfg = true; render(); }, attempts: 1});
    dbOnValue(db.ref('feedback_diretorio'), function(s) { S.dir = s.val() || {}; S.carregou.dir = true; render(); }, {onError: function() { S.carregou.dir = true; render(); }, attempts: 1});
    dbOnValue(db.ref('feedback_diretorio_por_uid/' + S.uid), function(s) { S.meuId = s.val() || null; S.carregou.me = true; render(); }, {onError: function() { S.meuId = null; S.carregou.me = true; render(); }, attempts: 1});
  }
  var periodoOuvido = null;
  function trocarPeriodo() {
    var p = periodo().id;
    if (periodoOuvido === p) return;
    periodoOuvido = p; S.carregou.feitos = false;
    dbOnValue(db.ref('feedback_feitos/' + p + '/' + S.uid), function(s) { S.feitos = s.val() || {}; S.carregou.feitos = true; render(); }, {onError: function() { S.feitos = {}; S.carregou.feitos = true; render(); }, attempts: 1});
  }
  window.addEventListener('kuryos-auth-pronto', function() { render(); });
  firebase.auth().onAuthStateChanged(function(u) { if (u) iniciar(); });
  if (firebase.auth().currentUser) iniciar();
})();
