'use strict';
/* Material em Processo (01/10) -- tela. Regras em shared/material-processo.js
   (funções puras, testadas em run_material_processo_test.js). Aqui só carrega as
   fontes, desenha e grava: a bombona numa transaction, o resto em caminhos planos. */
(function() {
  var db = firebase.database();
  var MP = MaterialProcesso;
  var bombonas = {}, ops = {}, registros = {}, carregou = {b: false, o: false, r: false};
  var historicoAberto = null;
  var ultimaEtiqueta = null;
  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function kg(v) { return num(v).toLocaleString('pt-BR', {maximumFractionDigits: 3}); }
  function autor() { return (window.currentUser && (window.currentUser.nome || window.currentUser.email)) || (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'Desconhecido'; }
  function dataBR(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—'; }
  function dataHora(v) { var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}); }
  function somenteLeitura() { return !!window.currentUser && ['qualidade', 'comercial', 'rh'].indexOf(window.currentUser.role) >= 0; }

  function aviso(html, tipo) {
    var a = el('aviso');
    a.className = 'aviso ' + (tipo || 'ok'); a.innerHTML = html; a.hidden = !html;
    if (html) a.scrollIntoView({block: 'nearest', behavior: 'smooth'});
  }

  /* ── Modal simples ── */
  function modal(titulo, corpo, botoes) {
    var fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = '<div class="modal" role="dialog" aria-label="' + e(titulo) + '"><h2>' + e(titulo) + '</h2><div class="corpo">' + corpo + '</div><div class="erro aviso erro" hidden></div><div class="acoes"></div></div>';
    var acoes = fundo.querySelector('.acoes');
    var api = {
      el: fundo,
      fechar: function() { if (fundo.parentNode) fundo.parentNode.removeChild(fundo); },
      erro: function(msg) { var x = fundo.querySelector('.erro'); x.hidden = !msg; x.innerHTML = msg || ''; },
      campo: function(id) { return fundo.querySelector('#' + id); }
    };
    botoes.forEach(function(b) {
      var bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'btn' + (b.ghost ? ' ghost' : ''); bt.textContent = b.rotulo;
      bt.onclick = function() { b.acao(api, bt); };
      acoes.appendChild(bt);
    });
    fundo.addEventListener('mousedown', function(ev) { if (ev.target === fundo) api.fechar(); });
    document.body.appendChild(fundo);
    var primeiro = fundo.querySelector('input,select,textarea'); if (primeiro) primeiro.focus();
    return api;
  }

  /* ── Bulk de cada OP: manipulado, envasado, e o que falta num recipiente ── */
  function kgNasBombonas(opKey, lote) {
    var total = 0;
    Object.keys(bombonas).forEach(function(c) {
      var cont = bombonas[c] && bombonas[c].conteudo;
      if (cont && (cont.opKey === opKey || (lote && cont.lote === lote))) total += MP.kgAtual(bombonas[c]);
    });
    return total;
  }
  function bulkDaOp(opKey, op) {
    var man = op.manipulacao && op.manipulacao.manipulacao;
    var rend = num(man && man.rendimento);
    var peso = num(op.pesoTeoricoUnG);
    var env = num(op.produzidoLinha != null ? op.produzidoLinha : op.produzido);
    var usado = peso > 0 ? env * peso / 1000 : 0;
    var disponivel = Math.max(0, rend - usado);
    var registrado = kgNasBombonas(opKey, op.lote);
    return {rendimento: rend, usado: usado, disponivel: disponivel, registrado: registrado, falta: disponivel - registrado};
  }
  function opsComBulk() {
    return Object.keys(ops).map(function(k) { return {key: k, op: ops[k]}; })
      .filter(function(x) { return x.op && x.op.status !== 'Cancelado' && x.op.manipulacao && num(bulkDaOp(x.key, x.op).rendimento) > 0; })
      .sort(function(a, b) { return String(b.op.dataEmissao || '').localeCompare(String(a.op.dataEmissao || '')); });
  }

  /* ── Renderização: bombonas ── */
  function renderBombonas() {
    if (!carregou.b) return;
    var lista = Object.keys(bombonas).map(function(k) { return bombonas[k]; }).filter(function(r) { return r && r.codigo; });
    var cheias = lista.filter(function(r) { return MP.situacao(r) === 'CHEIA'; });
    var totalKg = cheias.reduce(function(s, r) { return s + MP.kgAtual(r); }, 0);
    el('resumoBombonas').innerHTML =
      '<div class="chip"><b>' + lista.length + '</b><span>recipientes cadastrados</span></div>' +
      '<div class="chip"><b>' + cheias.length + '</b><span>com bulk</span></div>' +
      '<div class="chip"><b>' + (lista.length - cheias.length) + '</b><span>vazios</span></div>' +
      '<div class="chip"><b>' + kg(totalKg) + ' kg</b><span>de bulk em recipientes</span></div>';

    var busca = (el('buscaBombona').value || '').toLowerCase().trim();
    var filtro = el('filtroBombona').value;
    var linhas = lista.filter(function(r) {
      if (filtro && MP.situacao(r) !== filtro) return false;
      if (!busca) return true;
      var c = r.conteudo || {};
      return [r.codigo, c.lote, c.produto, c.sku, c.donoNome, c.cliente, c.local].filter(Boolean).join(' ').toLowerCase().indexOf(busca) >= 0;
    }).sort(function(a, b) { return String(a.codigo).localeCompare(String(b.codigo)); });

    var ro = somenteLeitura();
    el('corpoBombonas').innerHTML = linhas.length ? linhas.map(function(r) {
      var c = r.conteudo, sit = MP.situacao(r);
      var acoes = '<button type="button" class="btn ghost sm" data-etq="' + e(r.codigo) + '" title="Imprimir a etiqueta deste recipiente">🏷 Etiqueta</button> ' +
        (ro ? '' : (sit === 'VAZIA'
          ? '<button type="button" class="btn sm" data-encher="' + e(r.codigo) + '">⬇ Registrar bulk</button>'
          : '<button type="button" class="btn ghost sm" data-encher="' + e(r.codigo) + '" title="Somar mais bulk do mesmo lote">+ Bulk</button> ' +
            '<button type="button" class="btn ghost sm" data-ajustar="' + e(r.codigo) + '">Ajustar kg</button> ' +
            '<button type="button" class="btn perigo sm" data-esvaziar="' + e(r.codigo) + '">Esvaziar</button>')) +
        ' <button type="button" class="btn ghost sm" data-hist="' + e(r.codigo) + '">Histórico</button>';
      var linha = '<tr><td><b>' + e(r.codigo) + '</b><div class="dica">' + e((MP.TIPOS_RECIPIENTE[r.tipo] || {}).rotulo || r.tipo) + (r.capacidadeKg ? ' · ' + kg(r.capacidadeKg) + ' kg' : '') + '</div></td>' +
        '<td><span class="tag ' + (sit === 'CHEIA' ? 'cheia' : 'vazia') + '">' + (sit === 'CHEIA' ? 'Com bulk' : 'Vazia') + '</span></td>' +
        '<td>' + (c ? '<b>' + e(c.produto || '—') + '</b><div class="dica">Lote ' + e(c.lote) + (c.sku ? ' · ' + e(c.sku) : '') + '</div>' : '<span class="dica">—</span>') + '</td>' +
        '<td class="num">' + (c ? kg(MP.kgAtual(r)) : '—') + '</td>' +
        '<td>' + (c ? dataBR(c.validade) : '—') + '</td>' +
        '<td>' + (c ? e(c.donoTipo === 'KURYOS' ? 'KURYOS' : c.donoNome) : '—') + '</td>' +
        '<td>' + (c ? e(c.local || '—') : '—') + '</td>' +
        '<td style="white-space:nowrap">' + acoes + '</td></tr>';
      if (historicoAberto === r.codigo) {
        var h = Object.keys(r.historico || {}).map(function(k) { return r.historico[k]; }).sort(function(a, b) { return String(b.em).localeCompare(String(a.em)); }).slice(0, 12);
        linha += '<tr><td colspan="8"><ul class="hist">' + (h.length ? h.map(function(x) {
          return '<li>' + dataHora(x.em) + ' · ' + e(x.por || '—') + ' · <b>' + e(x.tipo) + '</b> ' + kg(x.kgAntes) + ' → ' + kg(x.kgDepois) + ' kg' + (x.lote ? ' · lote ' + e(x.lote) : '') + (x.motivo ? ' · ' + e(x.motivo) : '') + '</li>';
        }).join('') : '<li>Sem movimentos ainda.</li>') + '</ul></td></tr>';
      }
      return linha;
    }).join('') : '<tr><td colspan="8" class="dica">' + (lista.length ? 'Nenhum recipiente com esse filtro.' : 'Nenhuma bombona cadastrada ainda. Clique em "Cadastrar bombonas / tanques".') + '</td></tr>';

    el('corpoBombonas').querySelectorAll('[data-etq]').forEach(function(b) { b.onclick = function() { imprimirEtiquetas([bombonas[b.getAttribute('data-etq')]]); }; });
    el('corpoBombonas').querySelectorAll('[data-encher]').forEach(function(b) { b.onclick = function() { abrirRegistrarBulk(b.getAttribute('data-encher'), null); }; });
    el('corpoBombonas').querySelectorAll('[data-ajustar]').forEach(function(b) { b.onclick = function() { abrirAjuste(b.getAttribute('data-ajustar'), false); }; });
    el('corpoBombonas').querySelectorAll('[data-esvaziar]').forEach(function(b) { b.onclick = function() { abrirAjuste(b.getAttribute('data-esvaziar'), true); }; });
    el('corpoBombonas').querySelectorAll('[data-hist]').forEach(function(b) { b.onclick = function() { var c = b.getAttribute('data-hist'); historicoAberto = historicoAberto === c ? null : c; renderBombonas(); }; });
    el('btnNovas').hidden = ro; el('btnRegistrar').hidden = ro;
    renderSemRecipiente();
  }

  function renderSemRecipiente() {
    if (!carregou.b || !carregou.o) return;
    var linhas = opsComBulk().map(function(x) { return {x: x, b: bulkDaOp(x.key, x.op)}; })
      .filter(function(y) { return y.x.op.status !== 'Concluído' && y.b.falta > 5; });
    el('cardSemRecipiente').hidden = !linhas.length;
    el('corpoSemRecipiente').innerHTML = linhas.map(function(y) {
      return '<tr><td><b>' + e(y.x.op.lote || y.x.key) + '</b></td><td>' + e(y.x.op.produto || '—') + '</td><td class="num">' + kg(y.b.rendimento) + ' kg</td>' +
        '<td class="num">' + kg(y.b.usado) + ' kg</td><td class="num"><b>' + kg(y.b.falta) + ' kg</b></td>' +
        '<td>' + (somenteLeitura() ? '' : '<button type="button" class="btn sm" data-op="' + e(y.x.key) + '" data-falta="' + (Math.round(y.b.falta * 10) / 10) + '">Registrar em recipiente</button>') + '</td></tr>';
    }).join('');
    el('corpoSemRecipiente').querySelectorAll('[data-op]').forEach(function(b) {
      b.onclick = function() { abrirRegistrarBulk(null, {opKey: b.getAttribute('data-op'), kg: b.getAttribute('data-falta')}); };
    });
  }

  /* ── Etiquetas ── */
  function imprimirEtiquetas(lista) {
    var dados = lista.filter(Boolean).map(function(r) { return MP.dadosEtiqueta(r); });
    if (!dados.length) return;
    if (!EtiquetasWMS.imprimir('bombona', dados, 'Etiqueta ' + dados.map(function(d) { return d.codigo; }).join(', '))) {
      aviso('O navegador bloqueou a janela de impressão. Libere pop-ups para este site e tente de novo.', 'alerta');
    }
  }

  /* ── Cadastrar recipientes ── */
  function abrirNovas() {
    var m = modal('Cadastrar bombonas / tanques',
      '<label for="nvTipo">Tipo</label><select id="nvTipo"><option value="BOMBONA">Bombona</option><option value="TANQUE">Tanque</option></select>' +
      '<label for="nvQtd">Quantos</label><input id="nvQtd" type="number" min="1" max="100" value="1" inputmode="numeric">' +
      '<label for="nvCap">Capacidade em kg (opcional)</label><input id="nvCap" type="number" min="1" step="any" placeholder="Ex.: 200" inputmode="decimal">' +
      '<p class="dica" style="margin-top:10px">Cada um recebe um código único (BB-0001, TQ-0001...). Depois imprima as etiquetas e cole nos recipientes; o conteúdo é preenchido quando entra o bulk.</p>',
      [{rotulo: 'Cancelar', ghost: true, acao: function(a) { a.fechar(); }},
       {rotulo: 'Cadastrar', acao: function(a, bt) {
         var v = MP.validarNovos({tipo: a.campo('nvTipo').value, quantidade: a.campo('nvQtd').value, capacidadeKg: a.campo('nvCap').value});
         if (!v.ok) return a.erro(v.erros.join('<br>'));
         bt.disabled = true; a.erro('');
         var tipo = a.campo('nvTipo').value, prefixo = MP.TIPOS_RECIPIENTE[tipo].prefixo, criados = [];
         var passo = function(i) {
           if (i >= v.quantidade) return Promise.resolve();
           return nextSequential(db, 'contador_bombonas/' + prefixo, prefixo, 4).then(function(r) {
             var rec = MP.novoRecipiente(r.formatado, tipo, v.capacidadeKg, autor(), new Date().toISOString());
             return db.ref('bombonas_bulk/' + r.formatado).transaction(function(atual) { return atual ? undefined : rec; }).then(function(res) {
               if (res.committed) criados.push(rec);
               return passo(i + 1);
             });
           });
         };
         passo(0).then(function() {
           a.fechar();
           aviso('✅ ' + criados.length + (criados.length === 1 ? ' recipiente cadastrado' : ' recipientes cadastrados') + ': <b>' + e(criados.map(function(r) { return r.codigo; }).join(', ')) + '</b>. ' +
             '<button type="button" class="btn sm" id="btnImprimirNovas">🏷 Imprimir as etiquetas</button>', 'ok');
           ultimaEtiqueta = criados;
           var bi = el('btnImprimirNovas'); if (bi) bi.onclick = function() { imprimirEtiquetas(ultimaEtiqueta); };
         }).catch(function(err) { bt.disabled = false; a.erro('Não foi possível cadastrar: ' + e(err.message)); });
       }}]);
    return m;
  }

  /* ── Registrar bulk num recipiente ── */
  function abrirRegistrarBulk(codigoFixo, pre) {
    var recs = Object.keys(bombonas).map(function(k) { return bombonas[k]; }).filter(function(r) { return r && r.ativo !== false; })
      .sort(function(a, b) { return String(a.codigo).localeCompare(String(b.codigo)); });
    if (!recs.length) return aviso('Cadastre antes pelo menos uma bombona ou tanque.', 'alerta');
    var lista = opsComBulk();
    if (!lista.length) return aviso('Nenhuma OP com bulk manipulado para registrar.', 'alerta');
    var preOp = (pre && pre.opKey) || '';
    var optsRec = recs.map(function(r) {
      var c = r.conteudo;
      return '<option value="' + e(r.codigo) + '"' + (r.codigo === codigoFixo ? ' selected' : '') + '>' + e(r.codigo) + ' · ' + (c ? 'com ' + kg(MP.kgAtual(r)) + ' kg do lote ' + e(c.lote) : 'vazio') + '</option>';
    }).join('');
    var optsOp = lista.map(function(x) {
      var b = bulkDaOp(x.key, x.op);
      return '<option value="' + e(x.key) + '"' + (x.key === preOp ? ' selected' : '') + '>' + e(x.op.lote || x.key) + ' · ' + e(x.op.produto || '') + ' · ' + kg(b.rendimento) + ' kg manipulados</option>';
    }).join('');
    var m = modal('Registrar bulk em recipiente',
      '<label for="rbRec">Recipiente</label><select id="rbRec">' + optsRec + '</select>' +
      '<label for="rbOp">OP do bulk</label><select id="rbOp">' + optsOp + '</select>' +
      '<label for="rbKg">Quantidade (kg)</label><input id="rbKg" type="number" min="0" step="any" inputmode="decimal" value="' + e((pre && pre.kg) || '') + '">' +
      '<label for="rbDono">Dono do material</label><select id="rbDono"></select>' +
      '<label for="rbVal">Validade</label><input id="rbVal" type="date">' +
      '<label for="rbLocal">Local (onde está a bombona)</label><input id="rbLocal" type="text" placeholder="Ex.: Sala de manipulação, Galpão GAL-3.1.1" maxlength="80">',
      [{rotulo: 'Cancelar', ghost: true, acao: function(a) { a.fechar(); }},
       {rotulo: 'Registrar e etiquetar', acao: function(a, bt) {
         var opKey = a.campo('rbOp').value, op = ops[opKey] || {}, codigo = a.campo('rbRec').value;
         var d = MP.dono(a.campo('rbDono').value, op);
         var man = (op.manipulacao && op.manipulacao.manipulacao) || {};
         var validade = a.campo('rbVal').value || null;
         var conteudo = {opKey: opKey, lote: op.lote || opKey, sku: op.sku, produto: op.produto, cliente: op.cliente,
           donoTipo: d.donoTipo, donoNome: d.donoNome, kg: a.campo('rbKg').value, fabricadoEm: man.fim || null, validade: validade,
           origem: 'MANIPULACAO', local: a.campo('rbLocal').value};
         if (!validade) return a.erro('Informe a validade: ela vai na etiqueta do recipiente.');
         bt.disabled = true; a.erro('');
         var agora = new Date().toISOString(), falha = null, resultado = null;
         db.ref('bombonas_bulk/' + codigo).transaction(function(atual) {
           falha = null;
           if (!atual) return atual;
           var chk = MP.podeEncher(atual, conteudo);
           if (!chk.ok) { falha = chk.erros.join(' '); return; }
           resultado = MP.encher(atual, conteudo, autor(), agora);
           return resultado.rec;
         }).then(function(res) {
           if (!res.committed) { bt.disabled = false; return a.erro(e(falha || 'Não foi possível gravar. Atualize e tente de novo.')); }
           return db.ref('bombonas_bulk/' + codigo + '/historico').push(resultado.evento).then(function() {
             a.fechar();
             ultimaEtiqueta = [res.snapshot.val()];
             aviso('✅ ' + kg(conteudo.kg) + ' kg do lote <b>' + e(conteudo.lote) + '</b> em <b>' + e(codigo) + '</b>. <button type="button" class="btn sm" id="btnImprimirEnch">🏷 Imprimir a etiqueta</button>', 'ok');
             var bi = el('btnImprimirEnch'); if (bi) bi.onclick = function() { imprimirEtiquetas(ultimaEtiqueta); };
           });
         }).catch(function(err) { bt.disabled = false; a.erro('Erro: ' + e(err.message)); });
       }}]);
    function atualizarOp() {
      var op = ops[m.campo('rbOp').value] || {};
      m.campo('rbDono').innerHTML = '<option value="CLIENTE">Cliente — ' + e(op.cliente || '—') + '</option><option value="KURYOS">KURYOS</option>';
      var v = String(op.validade || '').slice(0, 10);
      m.campo('rbVal').value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    }
    m.campo('rbOp').onchange = atualizarOp;
    atualizarOp();
    return m;
  }

  /* ── Ajustar kg / esvaziar ── */
  function abrirAjuste(codigo, esvaziar) {
    var r = bombonas[codigo];
    if (!r || !r.conteudo) return;
    var motivos = esvaziar
      ? ['Bulk usado por inteiro no envase', 'Bulk descartado', 'Bulk devolvido ao tanque de manipulação', 'Outro']
      : ['Retirado para o envase', 'Contagem física', 'Perda ou derramamento', 'Outro'];
    var m = modal((esvaziar ? 'Esvaziar ' : 'Ajustar ') + codigo,
      '<p class="dica">' + e(r.conteudo.produto) + ' · lote ' + e(r.conteudo.lote) + ' · hoje <b>' + kg(MP.kgAtual(r)) + ' kg</b></p>' +
      (esvaziar ? '' : '<label for="ajKg">Kg que há agora no recipiente</label><input id="ajKg" type="number" min="0" step="any" inputmode="decimal" value="' + e(MP.kgAtual(r)) + '">') +
      '<label for="ajMot">Motivo</label><select id="ajMot">' + motivos.map(function(x) { return '<option>' + e(x) + '</option>'; }).join('') + '</select>' +
      '<label for="ajDet">Detalhe (obrigatório se "Outro")</label><input id="ajDet" type="text" maxlength="120">',
      [{rotulo: 'Cancelar', ghost: true, acao: function(a) { a.fechar(); }},
       {rotulo: esvaziar ? 'Esvaziar' : 'Salvar ajuste', acao: function(a, bt) {
         var mot = a.campo('ajMot').value, det = a.campo('ajDet').value.trim();
         if (mot === 'Outro' && !det) return a.erro('Descreva o motivo.');
         var novoKg = esvaziar ? 0 : a.campo('ajKg').value;
         if (!esvaziar && (novoKg === '' || !(Number(novoKg) >= 0))) return a.erro('Informe os kg (0 esvazia).');
         bt.disabled = true; a.erro('');
         var agora = new Date().toISOString(), falha = null, resultado = null;
         db.ref('bombonas_bulk/' + codigo).transaction(function(atual) {
           falha = null;
           if (!atual) return atual;
           try { resultado = MP.ajustarKg(atual, novoKg, det ? mot + ': ' + det : mot, autor(), agora); return resultado.rec; }
           catch (er) { falha = er.message; return; }
         }).then(function(res) {
           if (!res.committed) { bt.disabled = false; return a.erro(e(falha || 'Não foi possível gravar. Atualize e tente de novo.')); }
           return db.ref('bombonas_bulk/' + codigo + '/historico').push(resultado.evento).then(function() { a.fechar(); aviso('✅ ' + e(codigo) + (esvaziar ? ' esvaziado.' : ' ajustado para ' + kg(novoKg) + ' kg.'), 'ok'); });
         }).catch(function(err) { bt.disabled = false; a.erro('Erro: ' + e(err.message)); });
       }}]);
    return m;
  }

  /* ── Renderização: sobras e retidos ── */
  var STATUS_ROTULO = {EM_PROCESSO: 'Em processo', USADO: 'Usado', DESCARTADO: 'Descartado', DEVOLVIDO: 'Devolvido ao estoque'};
  function renderSobras() {
    if (!carregou.r) return;
    var busca = (el('buscaSobra').value || '').toLowerCase().trim();
    var filtro = el('filtroSobra').value;
    var lista = Object.keys(registros).map(function(k) { return Object.assign({id: k}, registros[k]); }).filter(function(r) { return r && r.tipo; })
      .filter(function(r) { return (!filtro || r.status === filtro) && (!busca || [r.lote, r.produto, r.descricao, r.cliente, r.donoNome, r.recipienteCodigo].filter(Boolean).join(' ').toLowerCase().indexOf(busca) >= 0); })
      .sort(function(a, b) { return String(b.em).localeCompare(String(a.em)); });
    var resumo = MP.resumoRetidos(Object.keys(registros).map(function(k) { return registros[k]; }));
    el('resumoSobras').textContent = resumo.length ? 'Em processo agora: ' + resumo.map(MP.rotuloResumo).join(' · ') : 'Nada em processo agora.';
    var ro = somenteLeitura();
    el('corpoSobras').innerHTML = lista.length ? lista.map(function(r) {
      var onde = r.recipienteCodigo ? e(r.recipienteCodigo) : (r.origem === 'PAUSA' ? 'OP fora da linha' : 'Sobra do encerramento');
      return '<tr><td><b>' + e(r.descricao) + '</b><div class="dica">' + e((MP.TIPOS_ITEM[r.tipo] || {}).rotulo || r.tipo) + (r.materialCodigo ? ' · ' + e(r.materialCodigo) : '') + '</div></td>' +
        '<td><b>' + e(r.lote) + '</b><div class="dica">' + e(r.produto || '') + '</div></td>' +
        '<td class="num">' + kg(r.qtd) + ' ' + e(r.unidade) + '</td>' +
        '<td>' + e(r.donoTipo === 'KURYOS' ? 'KURYOS' : r.donoNome) + '</td><td>' + onde + '<div class="dica">' + (r.origem === 'PAUSA' ? 'pausa da OP' : 'fim da OP') + '</div></td>' +
        '<td>' + e(r.declaradoPor || '—') + '<div class="dica">' + dataHora(r.em) + '</div></td>' +
        '<td><span class="tag ' + (r.status === 'EM_PROCESSO' ? 'alerta' : 'vazia') + '">' + e(STATUS_ROTULO[r.status] || r.status) + '</span>' +
          (r.baixa ? '<div class="dica">' + e(r.baixa.por || '') + ' · ' + e(r.baixa.motivo || '') + '</div>' : '') + '</td>' +
        '<td>' + (r.status === 'EM_PROCESSO' && !ro ? '<button type="button" class="btn ghost sm" data-baixa="' + e(r.id) + '">Dar baixa</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="dica">' + (Object.keys(registros).length ? 'Nada com esse filtro.' : 'Nenhuma sobra ou item retido registrado ainda. Eles aparecem quando uma OP é encerrada (contagem de sobras) ou sai da linha.') + '</td></tr>';
    el('corpoSobras').querySelectorAll('[data-baixa]').forEach(function(b) { b.onclick = function() { abrirBaixa(b.getAttribute('data-baixa')); }; });
  }

  function abrirBaixa(id) {
    var r = registros[id];
    if (!r) return;
    var m = modal('Dar baixa em ' + r.descricao,
      '<p class="dica">' + kg(r.qtd) + ' ' + e(r.unidade) + ' · OP ' + e(r.lote) + '</p>' +
      '<label for="bxSit">O que aconteceu</label><select id="bxSit"><option value="USADO">Foi usado (em outra OP / reaproveitado)</option><option value="DESCARTADO">Foi descartado</option><option value="DEVOLVIDO">Voltou ao estoque</option></select>' +
      '<label for="bxMot">Motivo / observação *</label><input id="bxMot" type="text" maxlength="160" placeholder="Ex.: usado na OP 26280/01">',
      [{rotulo: 'Cancelar', ghost: true, acao: function(a) { a.fechar(); }},
       {rotulo: 'Dar baixa', acao: function(a, bt) {
         var mot = a.campo('bxMot').value.trim();
         if (!mot) return a.erro('Informe o motivo ou a observação.');
         bt.disabled = true;
         var up = {};
         up['material_processo/' + id + '/status'] = a.campo('bxSit').value;
         up['material_processo/' + id + '/baixa'] = {por: autor(), em: new Date().toISOString(), motivo: mot};
         db.ref().update(up).then(function() { a.fechar(); aviso('✅ Baixa registrada.', 'ok'); })
           .catch(function(err) { bt.disabled = false; a.erro('Erro: ' + e(err.message)); });
       }}]);
    return m;
  }

  function render() { renderBombonas(); renderSobras(); }

  /* ── Abas, filtros e fontes ── */
  function aba(qual) {
    el('abaBombonas').classList.toggle('on', qual === 'b'); el('abaSobras').classList.toggle('on', qual === 's');
    el('painelBombonas').hidden = qual !== 'b'; el('painelSobras').hidden = qual !== 's';
    try { history.replaceState(null, '', qual === 's' ? '?aba=sobras' : location.pathname); } catch (x) { /* nada */ }
  }
  el('abaBombonas').onclick = function() { aba('b'); };
  el('abaSobras').onclick = function() { aba('s'); };
  el('buscaBombona').oninput = renderBombonas; el('filtroBombona').onchange = renderBombonas;
  el('buscaSobra').oninput = renderSobras; el('filtroSobra').onchange = renderSobras;
  el('btnNovas').onclick = abrirNovas;
  el('btnRegistrar').onclick = function() { abrirRegistrarBulk(null, null); };
  if (/aba=sobras/.test(location.search)) aba('s');

  dbOnValue(db.ref('bombonas_bulk'), function(snap) { bombonas = snap.val() || {}; carregou.b = true; render(); });
  dbOnValue(db.ref('ops'), function(snap) { ops = snap.val() || {}; carregou.o = true; renderSemRecipiente(); });
  dbOnValue(db.ref('material_processo'), function(snap) { registros = snap.val() || {}; carregou.r = true; renderSobras(); });
  window.addEventListener('kuryos-auth-pronto', render);

  window.MaterialProcessoTela = {abrirNovas: abrirNovas, abrirRegistrarBulk: abrirRegistrarBulk, abrirAjuste: abrirAjuste, imprimirEtiquetas: imprimirEtiquetas};
})();
