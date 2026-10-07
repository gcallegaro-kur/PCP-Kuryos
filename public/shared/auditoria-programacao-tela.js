/* Tela da Auditoria da Programação (auditoria_programacao.html).
   A lógica de juntar/filtrar/descrever vive em shared/eventos-programacao.js
   (puro, testado). Aqui só há leitura de banco e HTML.

   Por que lê DIA A DIA e não o nó inteiro: `eventos_programacao` é um log e
   cresce para sempre. Ler a árvore toda a cada abertura baixaria o histórico
   completo -- é o mesmo motivo pelo qual o kardex lê
   `movimentos_estoque/{itemKey}` e não a árvore inteira. Aqui o balde é o
   dia, então o período do filtro vira N leituras pequenas e previsíveis.

   `ops` fica atrás de um checkbox: são mais de mil registros e só valem pelas
   confirmações de etapa e cancelamentos. Deixar ligado por padrão tornaria a
   abertura lenta para quem só quer ver quem mexeu na grade hoje. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuditoriaProgramacaoTela = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MAX_DIAS = 62;   // teto da janela: 2 meses de leitura por vez
  var MAX_LINHAS = 500; // teto de renderização, para não travar o navegador

  var db = null, usuario = null, carregando = false;
  var cacheOps = null;   // lido no máximo uma vez por sessão da tela

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(id) { return document.getElementById(id); }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function hojeMenos(dias) {
    var d = new Date();
    d.setDate(d.getDate() - dias);
    return ymd(d);
  }
  /* Lista de dias (inclusive) entre de..ate. Em ordem para a leitura; o teto
     evita que alguém digite 2020 e a tela tente baixar dois mil dias. */
  function diasEntre(de, ate) {
    var ini = new Date(de + 'T12:00:00'), fim = new Date(ate + 'T12:00:00');
    if (isNaN(ini.getTime()) || isNaN(fim.getTime()) || fim < ini) return [];
    var out = [];
    for (var d = new Date(ini); d <= fim && out.length < MAX_DIAS; d.setDate(d.getDate() + 1)) {
      out.push(ymd(d));
    }
    return out;
  }

  function fmtQuando(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 16);
    return d.toLocaleDateString('pt-BR') + ' ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function montarSelects() {
    var selAcao = el('fAcao');
    Object.keys(EventosProgramacao.ACOES).forEach(function(a) {
      var o = document.createElement('option');
      o.value = a;
      o.textContent = (EventosProgramacao.ROTULOS[a] || a).replace(/^./, function(c) { return c.toUpperCase(); });
      selAcao.appendChild(o);
    });
    db.ref('config/linhas').once('value').then(function(s) {
      var linhas = s.val() || [];
      var sel = el('fLinha');
      linhas.forEach(function(l) {
        var o = document.createElement('option');
        o.value = l; o.textContent = l;
        sel.appendChild(o);
      });
    }).catch(function() { /* sem config/linhas o filtro de linha fica só com "Todas" */ });
  }

  function lerEventos(dias) {
    return Promise.all(dias.map(function(dia) {
      return db.ref(EventosProgramacao.NO + '/' + dia).once('value')
        .then(function(s) { return { dia: dia, val: s.val() || {} }; })
        .catch(function() { return { dia: dia, val: {} }; });
    })).then(function(partes) {
      var out = {};
      partes.forEach(function(p) { if (Object.keys(p.val).length) out[p.dia] = p.val; });
      return out;
    });
  }

  function carregar() {
    if (carregando) return;
    carregando = true;
    var lista = el('lista');
    lista.innerHTML = '<div class="vazio">Lendo o log...</div>';

    var de = el('fDe').value || hojeMenos(7);
    var ate = el('fAte').value || ymd(new Date());
    var dias = diasEntre(de, ate);
    if (!dias.length) {
      carregando = false;
      lista.innerHTML = '<div class="vazio">Período inválido — a data inicial tem que ser anterior à final.</div>';
      return;
    }

    var querOps = el('fIncluirOps').checked;
    var tarefas = [
      lerEventos(dias),
      db.ref('rearranjos_linhas').once('value').then(function(s) { return s.val() || {}; }).catch(function() { return {}; }),
      querOps ? (cacheOps ? Promise.resolve(cacheOps)
        : db.ref('ops').once('value').then(function(s) { cacheOps = s.val() || {}; return cacheOps; }).catch(function() { return {}; }))
        : Promise.resolve({})
    ];

    Promise.all(tarefas).then(function(r) {
      var tempo = EventosProgramacao.linhaDoTempo({ eventos: r[0], rearranjos: r[1], ops: r[2] });
      // O recorte de período vale para TODAS as fontes: rearranjos e OPs são
      // lidos inteiros (não têm balde por dia), então sem este filtro a tela
      // mostraria eventos fora da janela que o admin pediu.
      var filtrado = EventosProgramacao.filtrar(tempo, {
        de: de, ate: ate,
        acao: el('fAcao').value || null,
        linha: el('fLinha').value || null,
        busca: el('fBusca').value || null
      });
      render(filtrado, { de: de, ate: ate, dias: dias.length, querOps: querOps });
    }).catch(function(err) {
      lista.innerHTML = '<div class="vazio">Não consegui ler o log: ' + esc(err && err.message) +
        '<br><br>Se a mensagem fala de permissão, esta página é só para o papel <b>admin</b>.</div>';
    }).then(function() { carregando = false; });
  }

  function render(eventos, ctx) {
    var doSistema = eventos.filter(function(e) { return e.porUid === 'sistema'; }).length;
    var tirados = eventos.filter(function(e) { return e.acao === EventosProgramacao.ACOES.TIRAR; }).length;
    var pessoas = {};
    eventos.forEach(function(e) { if (e.porNome && e.porUid !== 'sistema') pessoas[e.porNome] = 1; });

    el('kpis').innerHTML =
      '<div class="kpi"><b>' + eventos.length + '</b><span>eventos no período</span></div>' +
      '<div class="kpi sistema"><b>' + doSistema + '</b><span>feitos pelo sistema</span></div>' +
      '<div class="kpi tirou"><b>' + tirados + '</b><span>tiraram OP da grade</span></div>' +
      '<div class="kpi"><b>' + Object.keys(pessoas).length + '</b><span>pessoas envolvidas</span></div>';

    var avisos = '';
    if (!ctx.querOps) {
      avisos += '<div class="aviso">📋 Encerramentos e cancelamentos de OP estão <b>fora</b> deste resultado. ' +
        'Marque a opção acima para incluí-los — eles vêm das OPs e são <b>retroativos</b>, ' +
        'ou seja, existem desde antes deste log.</div>';
    }
    if (ctx.dias >= MAX_DIAS) {
      avisos += '<div class="aviso">⏱️ O período foi limitado a ' + MAX_DIAS + ' dias por leitura. ' +
        'Para ir mais atrás, mova a janela de datas.</div>';
    }
    el('avisos').innerHTML = avisos;

    var lista = el('lista');
    if (!eventos.length) {
      lista.innerHTML = '<div class="vazio">Nenhum evento no período e nos filtros escolhidos.<br><br>' +
        'O log de eventos da grade (programar, mover, tirar, congelar e o vínculo automático do servidor) ' +
        'começou a gravar em <b>07/10/2026</b> — antes disso esses eventos simplesmente não eram registrados. ' +
        'Já os <b>rearranjos de linha</b>, <b>encerramentos</b> e <b>cancelamentos</b> são retroativos: ' +
        'se não apareceu nada, tente ampliar as datas ou marcar a opção de incluir as OPs.</div>';
      return;
    }

    var corte = eventos.slice(0, MAX_LINHAS);
    lista.innerHTML = corte.map(function(e) {
      var frase = EventosProgramacao.descrever(e);
      var meta = [];
      if (e.porNome && e.porUid !== 'sistema') meta.push(esc(e.porNome) + (e.papel ? ' (' + esc(e.papel) + ')' : ''));
      if (e.motivo) meta.push(esc(e.motivo));
      return '<div class="ev">' +
        '<div class="ev-hora">' + esc(fmtQuando(e.em)) + (e.semInstante ? ' <i>sem hora</i>' : '') + '</div>' +
        '<div class="ev-corpo">' +
          '<div class="ev-frase"><span class="tag ' + esc(e.acao) + '">' + esc(e.acao) + '</span>' + esc(frase) + '</div>' +
          (meta.length ? '<div class="ev-meta">' + meta.join(' · ') + ' <span class="fonte">[' + esc(e.fonte || '—') + ']</span></div>'
            : '<div class="ev-meta"><span class="fonte">[' + esc(e.fonte || '—') + ']</span></div>') +
        '</div></div>';
    }).join('');
    if (eventos.length > corte.length) {
      lista.innerHTML += '<div class="vazio">Mostrando os ' + MAX_LINHAS + ' mais recentes de ' +
        eventos.length + '. Estreite o período ou use a busca.</div>';
    }
  }

  function iniciar(database, user) {
    db = database;
    usuario = user || null;
    if (!usuario || usuario.role !== 'admin') {
      // auth_check.js já barra pelo módulo; esta é a segunda tranca, para o
      // caso de alguém receber o módulo sem ser admin.
      el('lista').innerHTML = '<div class="vazio">Esta página é restrita ao papel <b>admin</b>.</div>';
      return;
    }
    el('fDe').value = hojeMenos(7);
    el('fAte').value = ymd(new Date());
    montarSelects();
    el('btnBuscar').addEventListener('click', carregar);
    el('fIncluirOps').addEventListener('change', carregar);
    el('fAcao').addEventListener('change', carregar);
    el('fLinha').addEventListener('change', carregar);
    el('fBusca').addEventListener('keydown', function(ev) { if (ev.key === 'Enter') carregar(); });
    carregar();
  }

  return { iniciar: iniciar, diasEntre: diasEntre, MAX_DIAS: MAX_DIAS, MAX_LINHAS: MAX_LINHAS };
});
