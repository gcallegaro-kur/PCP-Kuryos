'use strict';
/* ACOMPANHAMENTO DE CARGAS (3ª de 3 telas da expedição de vendas, 29/09).
   Pedido do usuário: "depois fica o acompanhamento do agendamento de carga,
   puxando as informações de NF, quando emitida". Cada carga agendada mostra
   em que etapa está, a NF registrada no Faturamento e, com ela, a
   conferência do carregamento e a confirmação da saída física -- inclusive
   em mais de uma viagem com a mesma NF. O histórico de saídas mora aqui.
   Callables: confirmarExpedicaoPA e salvarAgendamentoExpedicaoPA (as mesmas
   de antes; só a tela mudou). */
(function() {
  var db = firebase.database(), fn = firebase.functions();
  var base = {estoque_lotes: {}, ops: {}, pedidos: {}, pedidos_comerciais: {}, conferencias_pa: {}, enderecos_estoque: {}, produtos: {}};
  var agendas = {}, cargas = {}, clientesContatos = {}, carregados = new Set(), agendaPronta = false;
  // Painel aberto numa carga: {key, tipo: 'CARREGAR'|'TRANSPORTE', revisao, valores, carregamento, selecionados, faltas, contato}
  var painel = null, contatoUI = null, ocupado = false, tentativa = null;
  var destaque = new URLSearchParams(location.search).get('carga'), destaqueRolado = false;
  var CHAVE_TENTATIVA = 'cargasPA-tentativa';
  function el(id) { return document.getElementById(id); }
  function e(v) { return escapeHtml(String(v == null ? '' : v)); }
  function num(v) { return Number(v || 0).toLocaleString('pt-BR'); }
  function brl(v) { return Number(v || 0).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}); }
  function hoje() { return new Date().toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'}); }
  function dataBR(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—'; }
  function dataHoraBR(v) { var d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}); }
  function aviso(html, erro) { var r = el('resultado'); r.className = 'notice' + (erro ? ' error' : ''); r.innerHTML = html; }
  function pronto() { return carregados.size === Object.keys(base).length && agendaPronta; }
  function idLinha(l) { return l.itemKey + '/' + l.loteKey; }
  function composicaoHTML(p) {
    var c = ExpedicaoGrade.composicao(p);
    if (!c.valida) return '<span class="warning">' + e(c.texto) + '</span>';
    return (c.caixas ? num(c.caixas) + ' cx × ' + num(c.multiplo) : '') + (c.caixas && c.parcial ? ' + ' : '') + (c.parcial ? '<span class="partial">1 parcial · ' + num(c.parcial) + ' un</span>' : '');
  }

  // Recupera confirmação interrompida (rede, recarga) -- inclusive a da tela
  // antiga, que guardava na chave 'expedicaoPA-tentativa'.
  try {
    tentativa = JSON.parse(sessionStorage.getItem(CHAVE_TENTATIVA) || sessionStorage.getItem('expedicaoPA-tentativa') || 'null');
    if (tentativa && !tentativa.agendaKey) tentativa = null;
  } catch (ignore) { tentativa = null; }

  /* ── Conferência do carregamento (antes na tela da Expedição) ── */
  function planoCarga(l) {
    var c = painel.carregamento[idLinha(l)] || {modo: 'INTEIRO'}, lote = l.lote, saldo = Number(lote.saldoLote);
    if (c.modo === 'NAO_CARREGADO') return {unidades: 0, ficou: saldo};
    if (c.modo !== 'PARCIAL') return {unidades: saldo, ficou: 0};
    var u = Math.min(Math.max(Number(c.caixas) || 0, 0), Number(lote.caixasFechadas) || 0) * (Number(lote.unidadesPorCaixa) || 0) + (c.caixaParcial ? Number(lote.unidadesCaixaParcial) || 0 : 0);
    return {unidades: u, ficou: saldo - u};
  }
  function totaisCarga() {
    return Object.keys(painel.selecionados).reduce(function(t, k) { var p = planoCarga(painel.selecionados[k]); t.carregado += p.unidades; t.ficou += p.ficou; return t; }, {carregado: 0, ficou: 0});
  }
  function montarSelecao(a) {
    var sel = {}, faltas = [];
    (a.paletes || []).filter(function(p) { return CargasPA.pendente(p) > 0; }).forEach(function(p) {
      var l = ExpedicaoPA.analisar(base, p.itemKey, p.loteKey, hoje());
      if (l.disponivel && Number(l.lote.saldoLote) === CargasPA.pendente(p)) sel[idLinha(l)] = l;
      else faltas.push((p.identificadorPalete || p.loteKey) + (l.disponivel ? ' (saldo mudou)' : ' (' + l.motivo + ')'));
    });
    return {selecionados: sel, faltas: faltas};
  }

  function painelCarregarHTML(a) {
    var viagens = Object.keys(a.viagens || {}).length, bloqueado = ocupado || !!tentativa;
    var mudou = a.revisao !== painel.revisao;
    var ls = Object.keys(painel.selecionados).map(function(k) { return painel.selecionados[k]; });
    var v = painel.valores, t = totaisCarga();
    var linhas = ls.map(function(l) {
      var k = idLinha(l), c = painel.carregamento[k] || {modo: 'INTEIRO'}, lote = l.lote, cx = Number(lote.caixasFechadas) || 0, temParcial = Number(lote.unidadesCaixaParcial) > 0, comp = ExpedicaoGrade.composicao(lote), p = planoCarga(l);
      return '<tr><td>' + e(lote.identificadorPalete || l.loteKey) + '</td><td>' + e(lote.itemCodigo) + '</td><td>' + composicaoHTML(lote) + '</td><td class="num">' + num(lote.saldoLote) + '</td>' +
        '<td><select data-modo="' + e(k) + '"' + (bloqueado ? ' disabled' : '') + '><option value="INTEIRO"' + (c.modo === 'INTEIRO' ? ' selected' : '') + '>Inteiro</option>' + (comp.valida ? '<option value="PARCIAL"' + (c.modo === 'PARCIAL' ? ' selected' : '') + '>Parcial</option>' : '') + '<option value="NAO_CARREGADO"' + (c.modo === 'NAO_CARREGADO' ? ' selected' : '') + '>Não carregado</option></select></td>' +
        '<td>' + (c.modo === 'PARCIAL' ? '<input type="number" min="0" max="' + cx + '" step="1" data-caixas="' + e(k) + '" value="' + e(c.caixas || 0) + '" aria-label="Caixas completas carregadas" style="width:70px"' + (bloqueado ? ' disabled' : '') + '> de ' + num(cx) +
          (temParcial ? '<label class="check"><input type="checkbox" data-parcial="' + e(k) + '"' + (c.caixaParcial ? ' checked' : '') + (bloqueado ? ' disabled' : '') + '> + caixa parcial (' + num(lote.unidadesCaixaParcial) + ' un)</label>' : '') : '—') + '</td>' +
        '<td class="num">' + num(p.unidades) + '</td><td class="num' + (p.ficou ? ' ficou' : '') + '">' + num(p.ficou) + '</td></tr>';
    }).join('');
    var campo = function(id, rot, tipo, extra) {
      return '<div><label for="c_' + id + '">' + rot + '</label><input id="c_' + id + '" data-campo="' + id + '" type="' + (tipo || 'text') + '" value="' + e(v[id] || '') + '"' + (extra || '') + (bloqueado ? ' disabled' : '') + '></div>';
    };
    return '<div class="carga-form" data-painel="CARREGAR"><h3>Carregamento e saída física' + (viagens ? ' · viagem ' + (viagens + 1) + ' (mesma NF)' : '') + '</h3>' +
      (mudou ? '<div class="notice error">A carga mudou em outra tela. Feche e abra o carregamento de novo.</div>' : '') +
      (painel.faltas.length ? '<div class="notice error">Paletes indisponíveis ou com saldo alterado: ' + e(painel.faltas.join(', ')) + '. Regularize antes de confirmar.</div>' : '') +
      '<p class="sub">Marque o que realmente subiu no veículo. O que ficar continua reservado para esta carga e sai na próxima viagem, com a mesma NF.</p>' +
      '<div style="overflow-x:auto"><table class="carga-itens"><thead><tr><th>Palete</th><th>SKU</th><th>Composição</th><th class="num">Pendente</th><th>Carregamento</th><th>Caixas</th><th class="num">Carregado</th><th class="num">Fica</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '<div class="carregamento-total" id="carregamentoTotal"><b>' + num(t.carregado) + ' un carregadas</b>' + (t.ficou ? ' · <span class="ficou">' + num(t.ficou) + ' un ficam aguardando embarque</span>' : '') + '</div>' +
      '<div class="fields" style="margin-top:10px">' + campo('data', 'Data da saída física', 'date', ' max="' + hoje() + '"') + campo('transportadora', 'Transportadora / prestador') + campo('motorista', 'Motorista') +
        campo('contatoMotorista', 'Contato do motorista', 'tel') + campo('placa', 'Placa', 'text', ' maxlength="20"') + '</div>' +
      '<h4 style="margin:10px 0 4px">Contato do cliente para recebimento</h4><div id="c_contato"></div>' +
      '<label for="c_obs">Observações da saída</label><textarea id="c_obs" data-campo="observacoes" rows="2" maxlength="2000"' + (bloqueado ? ' disabled' : '') + '>' + e(v.observacoes || '') + '</textarea>' +
      '<p class="carga-erro">' + e(painel.erro || '') + '</p>' +
      '<div class="carga-acoes"><button class="btn ghost" data-fechar-painel' + (ocupado ? ' disabled' : '') + '>Fechar</button>' +
      '<button class="btn" id="confirmarSaida"' + ((ocupado || mudou || !ls.length) && !tentativa ? ' disabled' : '') + '>' + (ocupado ? 'Processando…' : tentativa ? 'Verificar / repetir confirmação' : 'Confirmar saída física') + '</button></div></div>';
  }

  function painelTransporteHTML(a) {
    var v = painel.valores, bloqueado = ocupado;
    var campo = function(id, rot, tipo) {
      return '<div><label for="t_' + id + '">' + rot + '</label><input id="t_' + id + '" data-campo="' + id + '" type="' + (tipo || 'text') + '" value="' + e(v[id] || '') + '"' + (bloqueado ? ' disabled' : '') + '></div>';
    };
    return '<div class="carga-form" data-painel="TRANSPORTE"><h3>Transporte da carga</h3>' +
      (a.revisao !== painel.revisao ? '<div class="notice error">A carga mudou em outra tela. Feche e abra de novo para editar a versão atual.</div>' : '') +
      '<div class="fields">' + campo('dataAgendada', 'Data agendada', 'date') + campo('janela', 'Horário / janela') + campo('transportadora', 'Transportadora / prestador') +
        campo('motorista', 'Motorista') + campo('contatoMotorista', 'Contato do motorista', 'tel') + campo('placa', 'Placa') + '</div>' +
      '<h4 style="margin:10px 0 4px">Contato do cliente para recebimento</h4><div id="c_contato"></div>' +
      '<label for="t_obs">Observações</label><textarea id="t_obs" data-campo="observacoes" rows="2" maxlength="2000">' + e(v.observacoes || '') + '</textarea>' +
      '<p class="carga-erro">' + e(painel.erro || '') + '</p>' +
      '<div class="carga-acoes"><button class="btn ghost" data-fechar-painel>Fechar</button><button class="btn" id="salvarTransporte"' + (bloqueado || a.revisao !== painel.revisao ? ' disabled' : '') + '>Salvar transporte</button></div></div>';
  }

  function passosHTML(a) {
    var cod = CargasPA.etapa(a).codigo, f = a.faturamento || {};
    if (cod === 'CANCELADA') return '';
    var feito = {
      agendada: true,
      solicitado: !!f.status,
      nf: CargasPA.faturada(a),
      saida: Object.keys(a.viagens || {}).length > 0,
      expedida: cod === 'EXPEDIDA'
    };
    var agora = !feito.solicitado ? 'solicitado' : !feito.nf ? 'nf' : !feito.expedida ? 'saida' : '';
    return '<div class="carga-passos">' + [['agendada', 'Agendada'], ['solicitado', 'Faturamento solicitado'], ['nf', 'NF emitida'], ['saida', 'Carregada / saída'], ['expedida', 'Expedida']].map(function(p) {
      return '<span class="' + (feito[p[0]] ? 'feito' : agora === p[0] ? 'agora' : '') + '">' + (feito[p[0]] ? '✓ ' : '') + p[1] + '</span>';
    }).join('') + '</div>';
  }

  function nfHTML(a) {
    var lista = CargasPA.nfs(a), f = a.faturamento || {};
    if (!lista.length) {
      if (!CargasPA.ativa(a)) return '';
      return '<div class="carga-nf sem">' + (f.status === 'SOLICITADO' ? 'Faturamento solicitado em ' + dataBR(f.solicitadoEm) + '; a NF ainda não foi registrada.' : 'Faturamento ainda não solicitado.') +
        ' A saída física só é liberada com a NF. <a href="faturamento.html?carga=' + encodeURIComponent(a._key) + '"><b>Ir para o Faturamento →</b></a></div>';
    }
    return lista.map(function(x) {
      return '<div class="carga-nf"><div><b>NF</b>' + e(x.texto) + '</div><div><b>Valor</b>' + brl(x.valor) + '</div><div><b>Emitida em</b>' + dataBR(x.emitidaEm) + '</div>' +
        '<div><b>Chave NF-e</b><span style="word-break:break-all">' + e(x.chaveNfe || '—') + '</span></div><div><b>Registrada por</b>' + e(x.registradoPor || '—') + '</div></div>';
    }).join('');
  }

  function paletesHTML(a) {
    return '<details' + (painel && painel.key === a._key ? '' : '') + '><summary class="sub" style="cursor:pointer">Paletes da carga (' + num((a.paletes || []).length) + ')</summary>' +
      '<table class="carga-itens"><thead><tr><th>Palete</th><th>Produto</th><th>Pedido</th><th class="num">Unidades</th><th class="num">Embarcado</th><th class="num">Pendente</th></tr></thead><tbody>' +
      (a.paletes || []).map(function(p) {
        return '<tr><td>' + e(p.identificadorPalete || p.loteKey) + '</td><td><b>' + e(p.sku) + '</b> ' + e(p.descricao || '') + '</td><td>' + e(p.pedidoNumero || '—') + '</td>' +
          '<td class="num">' + num(p.quantidade) + '</td><td class="num">' + num(p.embarcado) + '</td><td class="num">' + num(CargasPA.pendente(p)) + '</td></tr>';
      }).join('') + '</tbody></table></details>';
  }

  function cardHTML(a) {
    var k = a._key, et = CargasPA.etapa(a), ac = CargasPA.acoes(a), t = CargasPA.totais(a);
    var pedidos = Object.keys(a.pedidos || {}).map(function(x) { return a.pedidos[x]; }).join(', ');
    var tempo = CargasPA.linhaDoTempo(a);
    var cc = a.contatoCliente;
    var painelAqui = painel && painel.key === k;
    return '<article class="carga-card' + (k === destaque ? ' destaque' : '') + '" data-carga="' + e(k) + '">' +
      '<div class="carga-topo"><div><h3>' + e(a.cliente) + '</h3><div class="carga-meta">Pedido(s) ' + e(pedidos || '—') + ' · ' +
        (a.tipo === 'COLETA' ? 'Coleta FOB' : 'Entrega CIF') + ' em <b>' + dataBR(a.dataAgendada) + '</b>' + (a.janela ? ' ' + e(a.janela) : '') +
        ' · ' + num(t.paletes) + ' palete(s) · ' + num(t.unidades) + ' un' + (t.embarcado ? ' · <b>' + num(t.embarcado) + ' embarcadas</b>' : '') + (t.pendente && t.embarcado ? ' · ' + num(t.pendente) + ' aguardando embarque' : '') +
        '<br>' + e([a.transportadora || 'Transportadora a definir', a.motorista || 'motorista a definir', a.placa || 'placa a definir'].join(' · ')) +
        (cc && [cc.nome, cc.telefone, cc.email].filter(Boolean).length ? '<br>Recebimento: ' + e([cc.nome, cc.telefone, cc.email].filter(Boolean).join(' · ')) : '') + '</div></div>' +
        '<span class="etapa-tag etapa-' + et.cor + '" title="' + e(et.rotulo) + '">' + e(et.curto) + '</span></div>' +
      passosHTML(a) + nfHTML(a) + paletesHTML(a) +
      (tempo.length ? '<details><summary class="sub" style="cursor:pointer">Linha do tempo</summary><ul class="carga-tempo">' + tempo.map(function(x) {
        return '<li>' + dataHoraBR(x.em) + ' — ' + e(x.texto) + (x.por ? ' <span class="sub">(' + e(x.por) + ')</span>' : '') + '</li>';
      }).join('') + '</ul></details>' : '') +
      (painelAqui ? '' : '<div class="carga-acoes">' +
        (ac.carregar ? '<button class="btn" data-acao="CARREGAR" data-k="' + e(k) + '">' + (et.codigo === 'AGUARDANDO_EMBARQUE' ? 'Carregar o saldo (próxima viagem)' : 'Carregar e confirmar saída') + '</button>' : '') +
        (!ac.carregar && CargasPA.ativa(a) ? '<button class="btn" disabled title="Registre a NF no Faturamento">Carregar (aguardando NF)</button>' : '') +
        (ac.editarTransporte ? '<button class="btn ghost" data-acao="TRANSPORTE" data-k="' + e(k) + '">Transporte</button>' : '') +
        (ac.cancelar ? '<button class="btn ghost" data-acao="CANCELAR" data-k="' + e(k) + '">Cancelar carga</button>' : '') +
      '</div>') +
      (painelAqui ? (painel.tipo === 'CARREGAR' ? painelCarregarHTML(a) : painelTransporteHTML(a)) : '') +
      '</article>';
  }

  function render() {
    CargasFluxo.render(el('fluxoCargas'), 'cargas.html', agendas);
    if (!pronto()) return;
    // O painel aberto reflete os paletes atuais: se algo mudou no estoque,
    // a seleção é refeita (e as faltas, avisadas).
    if (painel && painel.tipo === 'CARREGAR' && !tentativa && agendas[painel.key]) {
      var s = montarSelecao(agendas[painel.key]); painel.selecionados = s.selecionados; painel.faltas = s.faltas;
    }
    if (contatoUI && painel) painel.contato = contatoUI.valor();
    var filtro = el('filtro').value, busca = el('busca').value;
    var lista = CargasPA.listar(agendas, filtro, busca);
    var c = CargasPA.contagem(agendas);
    el('resumoCargas').textContent = num(c.AGENDADA + c.FATURAMENTO_SOLICITADO) + ' aguardando NF · ' + num(c.FATURADA) + ' pronta(s) para carregar · ' + num(c.AGUARDANDO_EMBARQUE) + ' com saldo aguardando embarque';
    el('listaCargas').innerHTML = lista.map(cardHTML).join('') || '<div class="cargas-vazio">Nenhuma carga neste filtro. Cargas nascem em <a href="expedicao.html">Montar carga</a>.</div>';
    ligar();
    if (destaque && !destaqueRolado) {
      var card = document.querySelector('[data-carga="' + CSS.escape(destaque) + '"]');
      if (card) { destaqueRolado = true; card.scrollIntoView({block: 'center'}); }
    }
  }

  function ligar() {
    document.querySelectorAll('[data-acao]').forEach(function(b) {
      b.onclick = function() { acao(b.dataset.acao, b.dataset.k); };
    });
    var box = document.querySelector('[data-painel]');
    contatoUI = null;
    if (!box || !painel) return;
    var a = agendas[painel.key];
    var cont = el('c_contato');
    if (cont) {
      contatoUI = ContatosClienteUI.seletor(cont, ['LOGISTICA']);
      contatoUI.carregar(clientesContatos[a.clienteKey] || {}, a.clienteKey || a.cliente, painel.contato !== undefined ? painel.contato : (a.contatoCliente || null));
      if (ocupado || tentativa) contatoUI.desabilitar(true);
    }
    box.querySelectorAll('[data-campo]').forEach(function(inp) { inp.addEventListener('input', function() { painel.valores[inp.dataset.campo] = inp.value; }); });
    box.querySelectorAll('[data-fechar-painel]').forEach(function(b) { b.onclick = function() { if (!ocupado) { painel = null; render(); } }; });
    box.querySelectorAll('[data-modo]').forEach(function(s) {
      s.onchange = function() { var k = s.dataset.modo, c = painel.carregamento[k] || {}; painel.carregamento[k] = {modo: s.value, caixas: s.value === 'PARCIAL' ? (c.caixas || 0) : 0, caixaParcial: s.value === 'PARCIAL' && !!c.caixaParcial}; render(); };
    });
    box.querySelectorAll('[data-caixas],[data-parcial]').forEach(function(inp) {
      inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', function() {
        var k = inp.dataset.caixas || inp.dataset.parcial, c = painel.carregamento[k] || {modo: 'PARCIAL'};
        if (inp.dataset.caixas) { var max = Number(inp.max) || 0, v = Math.floor(Number(inp.value) || 0); c.caixas = Math.min(Math.max(v, 0), max); } else c.caixaParcial = inp.checked;
        painel.carregamento[k] = c;
        var t = totaisCarga(), l = painel.selecionados[k], p = planoCarga(l), tr = inp.closest('tr');
        tr.children[6].textContent = num(p.unidades); tr.children[7].textContent = num(p.ficou); tr.children[7].className = 'num' + (p.ficou ? ' ficou' : '');
        el('carregamentoTotal').innerHTML = '<b>' + num(t.carregado) + ' un carregadas</b>' + (t.ficou ? ' · <span class="ficou">' + num(t.ficou) + ' un ficam aguardando embarque</span>' : '');
      });
    });
    var bs = el('confirmarSaida'); if (bs) bs.onclick = confirmarSaida;
    var bt = el('salvarTransporte'); if (bt) bt.onclick = salvarTransporte;
  }

  function acao(tipo, k) {
    var a = agendas[k];
    if (!a || ocupado) return;
    if (tentativa && tentativa.agendaKey !== k) return aviso('Há uma confirmação de saída pendente em outra carga. Conclua-a antes.', true);
    if (tipo === 'CANCELAR') return cancelar(k, a);
    var valores = tipo === 'CARREGAR'
      ? {data: hoje(), transportadora: a.transportadora || '', motorista: a.motorista || '', contatoMotorista: a.contatoMotorista || '', placa: a.placa || '', observacoes: a.observacoes || ''}
      : {dataAgendada: a.dataAgendada || '', janela: a.janela || '', transportadora: a.transportadora || '', motorista: a.motorista || '', contatoMotorista: a.contatoMotorista || '', placa: a.placa || '', observacoes: a.observacoes || ''};
    painel = {key: k, tipo: tipo, revisao: a.revisao, valores: valores, carregamento: {}, selecionados: {}, faltas: [], contato: undefined, erro: ''};
    if (tipo === 'CARREGAR') {
      if (tentativa) { painel.valores = Object.assign(painel.valores, {data: tentativa.data}); painel.revisao = tentativa.agendaRevisao; (tentativa.paletes || []).forEach(function(p) { if (p.carregar) painel.carregamento[p.itemKey + '/' + p.loteKey] = p.carregar; }); }
      var s = montarSelecao(a); painel.selecionados = s.selecionados; painel.faltas = s.faltas;
    }
    render();
    var card = document.querySelector('[data-carga="' + CSS.escape(k) + '"]');
    if (card) card.scrollIntoView({block: 'start', behavior: 'smooth'});
  }

  async function cancelar(k, a) {
    var motivo = prompt('Cancelar a carga de ' + a.cliente + '?\n\nOs paletes voltam a ficar livres na Expedição (o estoque não muda). Motivo:');
    if (!motivo) return;
    ocupado = true;
    try { await fn.httpsCallable('salvarAgendamentoExpedicaoPA')({agendaKey: k, revisao: a.revisao, cancelar: true, motivo: motivo}); aviso('Carga cancelada. Os paletes estão livres para montar outra carga.'); }
    catch (err) { aviso(e(err.message || 'Não foi possível cancelar a carga.'), true); }
    finally { ocupado = false; render(); }
  }

  async function salvarTransporte() {
    if (ocupado || !painel) return;
    var a = agendas[painel.key], v = painel.valores;
    if (!v.dataAgendada) { painel.erro = 'Informe a data agendada.'; return render(); }
    var dados = {agendaKey: painel.key, revisao: painel.revisao, tipo: a.tipo, contatoCliente: contatoUI ? contatoUI.valor() : a.contatoCliente};
    ['dataAgendada', 'janela', 'transportadora', 'motorista', 'contatoMotorista', 'placa', 'observacoes'].forEach(function(f) { dados[f] = String(v[f] || '').trim(); });
    ocupado = true; render();
    try { await fn.httpsCallable('salvarAgendamentoExpedicaoPA')(dados); painel = null; aviso('Transporte atualizado.'); }
    catch (err) { if (painel) painel.erro = err.message || 'Não foi possível salvar. Feche e abra de novo para conferir os dados atuais.'; }
    finally { ocupado = false; render(); }
  }

  async function confirmarSaida() {
    if (ocupado || !painel) return;
    var a = agendas[painel.key];
    if (!tentativa) {
      if (!CargasPA.acoes(a).carregar) { painel.erro = 'Registre a NF no Faturamento antes da saída.'; return render(); }
      if (a.revisao !== painel.revisao) { painel.erro = 'A carga mudou. Feche e abra o carregamento de novo.'; return render(); }
      if (painel.faltas.length) { painel.erro = 'Há paletes indisponíveis nesta carga. Regularize antes de confirmar.'; return render(); }
      var v = painel.valores;
      if (!v.data) { painel.erro = 'Informe a data da saída.'; return render(); }
      var tc = totaisCarga();
      if (!tc.carregado) { painel.erro = 'Nenhuma unidade marcada como carregada.'; return render(); }
      if (!confirm('Confirmar a saída física de ' + num(tc.carregado) + ' un' + (tc.ficou ? '? ' + num(tc.ficou) + ' un ficam reservadas para a próxima viagem, com a mesma NF.' : '?') + ' Esta confirmação baixa do estoque o que foi carregado.')) return;
      tentativa = {idempotencyKey: crypto.randomUUID(), data: v.data, tipo: a.tipo, nf: '', serie: '', chaveNfe: '', valorFaturado: '',
        contatoCliente: contatoUI ? contatoUI.valor() : a.contatoCliente || null,
        transportadora: String(v.transportadora || '').trim(), motorista: String(v.motorista || '').trim(), contatoMotorista: String(v.contatoMotorista || '').trim(),
        placa: String(v.placa || '').trim(), observacoes: String(v.observacoes || '').trim(),
        paletes: Object.keys(painel.selecionados).map(function(k) {
          var l = painel.selecionados[k];
          return {itemKey: l.itemKey, loteKey: l.loteKey, quantidade: Number(l.lote.saldoLote), enderecoKey: l.lote.enderecoKey, skuPedidoKey: l.skuPedidoKey, carregar: painel.carregamento[k] || {modo: 'INTEIRO'}};
        }),
        agendaKey: painel.key, agendaRevisao: painel.revisao, ficou: tc.ficou};
      sessionStorage.setItem(CHAVE_TENTATIVA, JSON.stringify(tentativa));
    }
    ocupado = true; painel.erro = ''; render();
    try {
      var r = await fn.httpsCallable('confirmarExpedicaoPA')(tentativa);
      var ficou = tentativa.ficou || 0, cliente = a.cliente;
      tentativa = null; sessionStorage.removeItem(CHAVE_TENTATIVA); sessionStorage.removeItem('expedicaoPA-tentativa'); painel = null;
      aviso('Saída confirmada: ' + e(r.data.numero) + ' (' + e(cliente) + '). ' + (ficou ? num(ficou) + ' un ficaram aguardando embarque, reservadas para a próxima viagem com a mesma NF.' : 'Paletes baixados e pedidos vinculados.'));
    } catch (err) {
      var definitivo = ['functions/invalid-argument', 'functions/failed-precondition', 'functions/permission-denied', 'functions/unauthenticated', 'functions/aborted'].indexOf(err.code) !== -1;
      if (definitivo) { tentativa = null; sessionStorage.removeItem(CHAVE_TENTATIVA); sessionStorage.removeItem('expedicaoPA-tentativa'); }
      if (painel) painel.erro = (err.message || 'Falha na confirmação.') + (definitivo ? '' : ' Use "Verificar / repetir confirmação" para recuperar a mesma saída.');
    } finally { ocupado = false; render(); }
  }

  /* ── Histórico de saídas (antes "Expedidos" na tela da Expedição) ── */
  function renderHistorico() {
    var q = el('buscaHistorico').value.toLocaleLowerCase('pt-BR'), rows = [];
    Object.keys(cargas).map(function(k) { return [k, cargas[k]]; }).sort(function(x, y) { return String(y[1].criadoEm || '').localeCompare(String(x[1].criadoEm || '')); }).forEach(function(entry) {
      var c = entry[1];
      Object.values(c.itens || {}).forEach(function(l) {
        if (![c.nf, c.cliente, c.numero, l.sku, l.pedidoNumero, l.opLote, l.identificadorPalete, c.transportadora, c.motorista, c.placa].join(' ').toLocaleLowerCase('pt-BR').includes(q)) return;
        rows.push('<tr><td>' + e(c.nf || 'Pendente') + '<div class="sub">' + e(c.numero || entry[0]) + '</div></td><td>' + e(c.versao === 2 ? (c.complementar ? 'Viagem ' + c.viagem + ' (mesma NF)' : 'Expedido') : c.status || 'Legado') + (l.parcial ? '<div class="sub">parcial · ficou ' + num(l.saldoRestante) + ' un</div>' : '') + '</td><td>' + e(c.cliente) + '</td><td>' + e(l.pedidoNumero || l.pedidoId || c.pedidoId) + '</td><td class="product">' + e(l.sku) + '<div class="sub">' + e(l.descricao) + '</div></td><td>' + e(l.opLote || '—') + '<div class="sub">' + e(l.identificadorPalete || 'Registro anterior aos paletes') + '</div></td><td>' + composicaoHTML(l.paleteOrigem || {saldoLote: l.qtd}) + '</td><td class="numeric">' + num(l.qtd) + '</td><td>' + dataBR(c.data) + '</td><td>' + e(c.transportadora || '—') + '</td><td>' + e(c.motorista || c.veiculo || '—') + '<div class="sub">' + e(c.contatoMotorista || '') + '</div></td><td>' + e(c.placa || '—') + '</td><td class="product">' + e(c.observacoes || '') + '<div class="sub">' + e(c.contatoCliente ? [c.contatoCliente.nome, c.contatoCliente.telefone, c.contatoCliente.email].filter(Boolean).join(' · ') : '') + '</div></td></tr>');
      });
    });
    el('lista').innerHTML = rows.join('') || '<tr><td colspan="13">Nenhuma saída neste filtro.</td></tr>';
  }

  if (destaque) el('filtro').value = 'todas';
  el('filtro').onchange = render;
  el('busca').oninput = render;
  el('buscaHistorico').oninput = renderHistorico;
  Object.keys(base).forEach(function(no) { dbOnValue(db.ref(no), function(s) { base[no] = s.val() || {}; carregados.add(no); if (!ocupado) render(); }); });
  dbOnValue(db.ref('clientes'), function(s) { clientesContatos = s.val() || {}; });
  dbOnValue(db.ref('expedicoes_comerciais'), function(s) { cargas = s.val() || {}; renderHistorico(); });
  dbOnValue(db.ref('agendamentos_expedicao'), function(s) {
    agendas = s.val() || {}; agendaPronta = true;
    if (!ocupado) render();
    if (tentativa && !painel && agendas[tentativa.agendaKey]) { aviso('Há uma confirmação de saída pendente. Use "Verificar / repetir confirmação" para recuperar o resultado.', true); acao('CARREGAR', tentativa.agendaKey); }
  });
})();
