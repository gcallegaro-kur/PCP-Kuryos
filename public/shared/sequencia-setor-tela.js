/* Tela da sequência por setor -- a MESMA nas duas pontas (29/09):
   - Planejamento, aba "Sequência por setor": o PCP ordena (↑ ↓), troca o
     recurso e informa o ritmo; um bloco por setor, tudo na mesma aba;
   - Próximas Ordens: cada setor consulta a própria fila, só leitura.
   Uma tela só evita que o operador veja uma ordem diferente da que o PCP
   montou. O cálculo mora em shared/sequencia-setor.js.

   Depende de: firebase (db), shared/utils.js (dbOnValue, escapeHtml,
   fmtNum, kuryosHorasExtrasDoDia), shared/sequencia-setor.js,
   shared/perdas-etapa.js (a OP leva rótulo?) e, se carregado,
   shared/manipulacao.js (nome da fase). */
(function(root) {
  'use strict';
  var S = root.SequenciaSetor;

  var CSS = '' +
    '.sq-bloco{background:var(--card);border-radius:16px;box-shadow:var(--shadow,0 1px 3px rgba(0,0,0,.08));margin-bottom:16px;border-left:4px solid var(--primary)}' +
    '.sq-bloco-cab{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.sq-bloco-cab h3{font-size:15px;font-weight:800;margin:0}' +
    '.sq-bloco-cab .sq-sub{font-size:12px;color:var(--muted)}' +
    '.sq-recursos{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;padding:12px}' +
    '.sq-rec{border:1.5px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card)}' +
    '.sq-rec-cab{padding:8px 12px;background:var(--surface-2);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.sq-rec-nome{font-weight:800;font-size:13.5px}' +
    '.sq-ritmo{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted)}' +
    '.sq-ritmo input{width:74px;padding:5px 7px;border:1.5px solid var(--border);border-radius:7px;font-size:13px;background:var(--card);color:var(--text)}' +
    '.sq-item{padding:9px 12px;border-top:1px solid var(--border);display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:start}' +
    '.sq-item.andamento{background:var(--tint-green-bg,#d1fae5)}' +
    '.sq-pos{font-weight:800;font-size:15px;color:var(--muted);text-align:center;padding-top:1px}' +
    '.sq-lote{font-weight:800;font-size:13.5px}' +
    '.sq-prod{font-size:12.5px}' +
    '.sq-meta{font-size:11.5px;color:var(--muted);margin-top:2px;line-height:1.45}' +
    '.sq-est{font-size:12px;margin-top:3px}' +
    '.sq-est b{font-weight:800}' +
    '.sq-sem{color:var(--warning,#c9910a);font-weight:600}' +
    '.sq-acoes{display:flex;flex-direction:column;gap:4px;align-items:flex-end}' +
    '.sq-acoes .sq-btns{display:flex;gap:4px}' +
    '.sq-acoes button{min-width:34px;min-height:32px;border:1.5px solid var(--border);background:var(--card);color:var(--text);border-radius:7px;cursor:pointer;font-size:14px}' +
    '.sq-acoes button:disabled{opacity:.35;cursor:default}' +
    '.sq-acoes select{font-size:12px;padding:4px;border:1.5px solid var(--border);border-radius:7px;background:var(--card);color:var(--text);max-width:130px}' +
    '.sq-badge{display:inline-block;padding:1px 8px;border-radius:12px;font-size:10.5px;font-weight:700;background:var(--tint-gray-bg,#f3f4f6);color:var(--muted);white-space:nowrap}' +
    '.sq-badge.verde{background:var(--tint-green-bg,#d1fae5);color:var(--tint-green-fg,#065f46)}' +
    '.sq-badge.azul{background:var(--tint-blue-bg,#eff6ff);color:var(--primary)}' +
    '.sq-vazio{padding:14px 12px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--border)}' +
    '@media(max-width:700px){.sq-recursos{grid-template-columns:1fr;padding:8px}}';

  function injetarCss() {
    if (document.getElementById('sqCss')) return;
    var st = document.createElement('style');
    st.id = 'sqCss';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // Planejamento não tem caixa de aviso própria: cai no alert do navegador.
  function avisar(msg) {
    if (typeof root.showAlert === 'function') root.showAlert(msg, 'danger');
    else if (typeof root.alert === 'function') root.alert(msg);
  }

  var DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  function quando(d, agora) {
    if (!d) return '—';
    var hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    var dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((dia - hoje) / 86400000);
    var hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    if (diff === 0) return 'hoje ' + hh;
    if (diff === 1) return 'amanhã ' + hh;
    return DIAS[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hh;
  }
  function duracaoTxt(h) {
    if (h == null) return '';
    if (h < 1) return Math.max(Math.round(h * 60), 1) + ' min';
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return hh + ' h' + (mm ? ' ' + mm + ' min' : '');
  }

  /* opts: {db, setores: ['envase', ...], podeEditar, agora (teste)} */
  function montar(el, opts) {
    injetarCss();
    var o = opts || {};
    var db = o.db;
    var dados = {ops: {}, ordem: {}, ritmos: {}, config: {}, calPlan: {}, prodHora: {}};
    var prontos = {};
    var pendente = null;

    function ctx() {
      return {
        recursos: {envase: dados.config.linhas || [], rotulagem: dados.config.rotulagem || []},
        temRotulagem: function(op) {
          if (!root.PerdasEtapa) return false;
          return root.PerdasEtapa.embalagensDaOp(op, null, null).some(function(i) { return i.tipo === 'Rótulos'; });
        },
        rotuloManipulacao: root.Manipulacao ? root.Manipulacao.rotulo : null,
        prodHoraRef: function(it) { return dados.prodHora[String(it.sku || '').toUpperCase()]; }
      };
    }
    function calendario() {
      var c = dados.config, p = dados.calPlan;
      return {
        turnos: c.turnos || [], modo: c.modoOperacaoTurno || 'auto', turnoFixo: c.turnoFixoNome || '',
        horarios: c.turnoHorarios || {}, fim: c.turnoHorariosFim || {}, fimSexta: c.turnoHorariosFimSexta || {},
        pausas: c.turnoPausas || {}, diasSemana: p.diasSemana || [1, 2, 3, 4, 5], feriados: p.feriados || {},
        extrasDoDia: typeof root.kuryosHorasExtrasDoDia === 'function'
          ? function(d) { return root.kuryosHorasExtrasDoDia(d, c.turnosExtras); } : null
      };
    }

    function agendar() {
      if (pendente) return;
      pendente = setTimeout(function() { pendente = null; render(); }, 40);
    }
    function ouvir(caminho, nome, transformar) {
      root.dbOnValue(db.ref(caminho), function(snap) {
        var v = snap.val() || {};
        dados[nome] = transformar ? transformar(v) : v;
        prontos[nome] = true;
        agendar();
      });
    }
    ouvir('ops', 'ops');
    ouvir('sequenciamento/ordem', 'ordem');
    ouvir('sequenciamento/ritmos', 'ritmos');
    ouvir('config', 'config');
    ouvir('config/planejamento', 'calPlan');
    ouvir('produtos', 'prodHora', function(v) {
      var m = {};
      Object.keys(v).forEach(function(k) {
        var p = v[k] || {};
        if (p.sku && Number(p.prodHoraRef) > 0) m[String(p.sku).toUpperCase()] = Number(p.prodHoraRef);
      });
      return m;
    });
    // O relógio anda: a estimativa de quem está rodando muda sem apontamento.
    var relogio = setInterval(agendar, 60000);

    var filasAtuais = {};
    function render() {
      if (!prontos.ops || !prontos.config) { el.innerHTML = '<div class="sq-vazio">Carregando…</div>'; return; }
      var agora = o.agora ? new Date(o.agora) : new Date();
      var c = ctx(), cal = calendario();
      // Todas as filas, mesmo mostrando um setor só: o envase de uma OP
      // depende da manipulação e da separação dela.
      filasAtuais = S.estimarTudo(dados.ops, dados.ordem, dados.ritmos, cal, c, agora);
      el.innerHTML = (o.setores || S.ORDEM_SETORES).map(function(setor) {
        var cfg = S.SETORES[setor];
        var grupos = filasAtuais[setor];
        var total = grupos.reduce(function(s, g) { return s + g.itens.length; }, 0);
        return '<section class="sq-bloco" data-sq-setor="' + setor + '">' +
          '<div class="sq-bloco-cab"><h3>' + root.escapeHtml(cfg.rotulo) + '</h3>' +
          '<span class="sq-sub">' + total + ' ordem(ns) na fila' + (setor === 'envase' ? ' · OP programada na grade horária segue a grade' : '') + '</span></div>' +
          '<div class="sq-recursos">' + grupos.map(function(g) { return htmlRecurso(setor, g, grupos, agora); }).join('') + '</div>' +
        '</section>';
      }).join('');
      ligarEventos();
    }

    function htmlRitmo(setor, recurso) {
      var cfg = S.SETORES[setor];
      if (recurso === cfg.semRecurso) {
        return '<span class="sq-ritmo">' + (o.podeEditar ? 'escolha a ' + (setor === 'envase' ? 'linha' : 'rotuladora') + ' em "Mover para…"' : 'a definir pelo PCP') + '</span>';
      }
      var atual = (((dados.ritmos || {})[setor] || {})[S.chave(recurso)] || {})[cfg.ritmo];
      var dica = setor === 'envase' ? 'Opcional: vale o menor entre este e o prodHoraRef do produto' : 'Usado para estimar o término';
      if (!o.podeEditar) return atual ? '<span class="sq-ritmo">' + root.escapeHtml(String(atual).replace('.', ',')) + ' ' + cfg.ritmoRotulo + '</span>' : '';
      return '<label class="sq-ritmo" title="' + dica + '">Ritmo <input type="text" inputmode="decimal" data-sq-ritmo="' + setor + '|' + root.escapeHtml(recurso) + '" value="' +
        (atual == null ? '' : String(atual).replace('.', ',')) + '" placeholder="' + (setor === 'envase' ? 'cadastro' : '—') + '"> ' + cfg.ritmoRotulo + '</label>';
    }

    // Quem só consulta não tem o que "informar": diz de quem é a pendência.
    function motivoSemEstimativa(m) {
      if (o.podeEditar || !m) return m || '';
      if (/^informe o ritmo/.test(m) || /sem prodHoraRef/.test(m)) return 'o PCP ainda não informou o ritmo';
      if (/^depende de/.test(m)) return 'depende de uma ordem anterior sem estimativa';
      return m;
    }
    function htmlRecurso(setor, g, grupos, agora) {
      var cab = '<div class="sq-rec-cab"><span class="sq-rec-nome">' + root.escapeHtml(g.recurso) + '</span>' + htmlRitmo(setor, g.recurso) + '</div>';
      if (!g.itens.length) return '<div class="sq-rec">' + cab + '<div class="sq-vazio">Nenhuma ordem.</div></div>';
      var moveis = g.itens.filter(function(i) { return i.movel; });
      var outros = grupos.filter(function(x) { return x.recurso !== g.recurso && x.recurso !== (S.SETORES[setor].semRecurso || ''); });
      return '<div class="sq-rec" data-sq-recurso="' + root.escapeHtml(g.recurso) + '">' + cab + g.itens.map(function(it) {
        var falta = it.unidade === 'un' ? root.fmtNum(Math.round(it.restante)) + ' un a fazer' + (it.qtdPlanejada && it.restante !== it.qtdPlanejada ? ' de ' + root.fmtNum(it.qtdPlanejada) : '') : '';
        var badge = it.emAndamento ? '<span class="sq-badge verde">' + root.escapeHtml(it.status) + '</span>'
          : it.naGrade ? '<span class="sq-badge azul">na grade</span> <span class="sq-badge">' + root.escapeHtml(it.status) + '</span>'
          : '<span class="sq-badge">' + root.escapeHtml(it.status) + '</span>';
        var est = it.inicioEstimado
          ? '<div class="sq-est">' + (it.emAndamento ? 'Termina <b>' + quando(it.fimEstimado, agora) + '</b>'
              : 'Começa <b>' + quando(it.inicioEstimado, agora) + '</b> · termina <b>' + quando(it.fimEstimado, agora) + '</b>') +
            ' <span class="sq-meta">(' + duracaoTxt(it.horas) + ')</span>' +
            (it.aguarda ? '<div class="sq-meta">Aguarda a ' + root.escapeHtml(it.aguarda) + ' desta OP</div>' : '') +
            (it.ressalva ? '<div class="sq-meta sq-sem">Estimativa ' + root.escapeHtml(it.ressalva) + '</div>' : '') + '</div>'
          : '<div class="sq-est sq-sem">Sem estimativa: ' + root.escapeHtml(motivoSemEstimativa(it.semEstimativa)) + '</div>';
        var acoes = '';
        if (o.podeEditar) {
          var idx = moveis.indexOf(it);
          acoes = '<div class="sq-acoes">' + (it.movel
            ? '<div class="sq-btns"><button type="button" title="Subir" data-sq-mover="-1" data-sq-op="' + it.opKey + '"' + (idx <= 0 ? ' disabled' : '') + '>↑</button>' +
              '<button type="button" title="Descer" data-sq-mover="1" data-sq-op="' + it.opKey + '"' + (idx >= moveis.length - 1 ? ' disabled' : '') + '>↓</button></div>' +
              (outros.length ? '<select data-sq-recurso-op="' + it.opKey + '"><option value="">Mover para…</option>' +
                outros.map(function(x) { return '<option>' + root.escapeHtml(x.recurso) + '</option>'; }).join('') + '</select>' : '')
            : '<span class="sq-meta">' + (it.emAndamento ? 'rodando' : 'ordem da grade') + '</span>') + '</div>';
        }
        return '<div class="sq-item' + (it.emAndamento ? ' andamento' : '') + '" data-sq-item="' + it.opKey + '">' +
          '<div class="sq-pos">' + it.ordem + '</div>' +
          '<div><div class="sq-lote">' + root.escapeHtml(it.lote) + ' ' + badge + '</div>' +
            '<div class="sq-prod">' + root.escapeHtml(it.produto || it.sku) + '</div>' +
            '<div class="sq-meta">' + [it.cliente, falta].filter(Boolean).map(root.escapeHtml).join(' · ') + '</div>' + est + '</div>' +
          acoes + '</div>';
      }).join('') + '</div>';
    }

    function grupoDe(setor, recurso) {
      return (filasAtuais[setor] || []).find(function(g) { return g.recurso === recurso; });
    }
    function gravar(u, msg) {
      u['sequenciamento/atualizadoEm'] = new Date().toISOString();
      u['sequenciamento/atualizadoPor'] = (root.currentUser && root.currentUser.nome) || null;
      return db.ref().update(u).catch(function(e) {
        avisar('Não foi possível gravar ' + msg + ': ' + e.message);
      });
    }
    function ligarEventos() {
      if (!o.podeEditar) return;
      el.querySelectorAll('[data-sq-mover]').forEach(function(b) {
        b.addEventListener('click', function() {
          var setor = b.closest('[data-sq-setor]').getAttribute('data-sq-setor');
          var g = grupoDe(setor, b.closest('[data-sq-recurso]').getAttribute('data-sq-recurso'));
          var u = g && S.mover(g, b.getAttribute('data-sq-op'), Number(b.getAttribute('data-sq-mover')), setor);
          if (u) gravar(u, 'a ordem');
        });
      });
      el.querySelectorAll('[data-sq-recurso-op]').forEach(function(sel) {
        sel.addEventListener('change', function() {
          if (!sel.value) return;
          var setor = sel.closest('[data-sq-setor]').getAttribute('data-sq-setor');
          var destino = grupoDe(setor, sel.value);
          if (destino) gravar(S.trocarRecurso(destino, sel.getAttribute('data-sq-recurso-op'), setor), 'o recurso');
        });
      });
      el.querySelectorAll('[data-sq-ritmo]').forEach(function(inp) {
        inp.addEventListener('change', function() {
          var partes = inp.getAttribute('data-sq-ritmo').split('|');
          var setor = partes[0], recurso = partes.slice(1).join('|');
          var v = inp.value.trim() === '' ? null : Number(inp.value.trim().replace(',', '.'));
          if (v != null && !(v > 0)) {
            avisar('Ritmo precisa ser um número maior que zero.');
            inp.value = '';
            return;
          }
          var u = {};
          u['sequenciamento/ritmos/' + setor + '/' + S.chave(recurso) + '/' + S.SETORES[setor].ritmo] = v;
          gravar(u, 'o ritmo');
        });
      });
    }

    render();
    return {render: render, parar: function() { clearInterval(relogio); }, filas: function() { return filasAtuais; }};
  }

  root.SequenciaSetorTela = {montar: montar};
})(typeof globalThis !== 'undefined' ? globalThis : this);
