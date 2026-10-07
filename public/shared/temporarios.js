/* Temporários (06/10/2026) -- regras puras da convocação e do pagamento semanal.

   Origem: planilha CONVOCAÇÃO_TEMPORÁRIO 01.xlsx do RH (abas PARÂMETROS, CADASTRO DE TEMP, LISTA DE PRESENÇA,
   DESCONTO, PAGAMENTOS, CALCULADORA). A regra oficial é a da planilha; este módulo a reproduz fórmula a fórmula
   e run_temporarios_test.js confere contra os números que a CALCULADORA calculou.

   Dia (segunda a sexta):  OK trabalhou · NC não convocado · F falta/desistência · FA falta abonada · FER feriado (automático).
   - OK paga a diária cheia (seg-qui 110; sexta com 8 h 97,77).
   - NC, F e FA não pagam o dia. Só o F derruba a semana: basta 1 F para TODOS os dias OK da semana valerem a reduzida (70).
   - FER (lista de feriados) não é pago, não conta como falta e não conta como convocação.
   - Atraso (lançado em horas): abaixo do limite (2 h) desconta horas x valor da hora; a partir do limite o dia vira a
     reduzida e as horas descontam proporcionalmente (70 ÷ 9 h seg-qui, 70 ÷ horas da sexta).
   - VT: dias de VT = VT pago na semana ÷ valor do VT (se não for múltiplo, ERRO e a semana não fecha).
     VT pago e não usado (dia não OK) é descontado; dia OK sem VT pago entra como VT a pagar.
   - Fechamento = diárias − atraso − desconto VT + VT a pagar; Em aberto = fechamento − pagamentos SALARIO da semana.

   Diferenças deliberadas em relação à planilha (todas só ampliam):
   - o pagamento tem "semana de referência" (por padrão a semana da data do pagamento, como na planilha); assim um
     salário pago na segunda seguinte pode ser atribuído à semana certa e não fica "em aberto" para sempre;
   - as horas da sexta valem para a diária e também para o desconto proporcional do atraso;
   - nome duplicado não existe: tudo é ligado ao id do temporário, não ao texto do nome. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Temporarios = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var CODIGOS = ['OK', 'NC', 'F', 'FA'];
  var ROTULOS = {OK: 'Trabalhou', NC: 'Não convocado', F: 'Falta', FA: 'Falta abonada', FER: 'Feriado'};
  var CATEGORIAS = ['SALARIO', 'VT'];
  var PARAMETROS_PADRAO = {valorHora: 12.22, diariaSemana: 110, diariaSexta: 97.77, diariaReduzida: 70, valorVT: 10.6, horasDia: 9, horasSexta: 8, atrasoLimiteHoras: 2};
  var FERIADOS_PADRAO = {
    '2026-10-12': 'N. Sra. Aparecida', '2026-11-02': 'Finados', '2026-11-20': 'Consciência Negra', '2026-12-25': 'Natal',
    '2027-01-01': 'Confraternização Universal', '2027-02-08': 'Carnaval (segunda)', '2027-02-09': 'Carnaval (terça)',
    '2027-03-26': 'Sexta-feira Santa', '2027-04-21': 'Tiradentes', '2027-05-27': 'Corpus Christi', '2027-09-07': 'Independência',
    '2027-10-12': 'N. Sra. Aparecida', '2027-11-02': 'Finados', '2027-11-15': 'Proclamação da República'
  };

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function txt(v) { return v == null ? '' : String(v).trim(); }
  function r2(v) { return Math.round((v + 1e-9) * 100) / 100; }
  function norm(s) { return txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase(); }

  /* ── datas (texto AAAA-MM-DD, aritmética em UTC: nada depende do fuso do navegador) ── */
  function dt(ymd) { var p = String(ymd).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fmt(d) { return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function dataValida(ymd) { return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd)) && fmt(dt(ymd)) === ymd; }
  function somaDias(ymd, n) { var d = dt(ymd); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
  function diaSemana(ymd) { var w = dt(ymd).getUTCDay(); return w === 0 ? 7 : w; }          // 1 = segunda … 7 = domingo
  function segundaDe(ymd) { return somaDias(ymd, 1 - diaSemana(ymd)); }
  function diasDaSemana(segunda) { return [0, 1, 2, 3, 4].map(function(i) { return somaDias(segunda, i); }); }
  function dataBR(ymd) { var p = String(ymd || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; }

  function parametros(cfg) {
    var c = cfg && typeof cfg === 'object' ? cfg : {}, o = {};
    Object.keys(PARAMETROS_PADRAO).forEach(function(k) { o[k] = c[k] != null && c[k] !== '' && isFinite(Number(c[k])) ? Number(c[k]) : PARAMETROS_PADRAO[k]; });
    return o;
  }
  /* feriados da configuração; sem nenhum configurado vale a lista padrão (a da planilha) */
  function feriados(cfg) {
    var f = cfg && cfg.feriados && typeof cfg.feriados === 'object' ? cfg.feriados : null;
    if (!f || !Object.keys(f).length) return Object.assign({}, FERIADOS_PADRAO);
    var o = {};
    Object.keys(f).forEach(function(k) { var v = f[k]; if (dataValida(k) && v !== false && v != null) o[k] = typeof v === 'string' ? v : (v && v.nome) || 'Feriado'; });
    return o;
  }
  function ehFeriado(ymd, fer) { return !!(fer && fer[ymd]); }

  /* Situação do dia de uma pessoa: feriado vence qualquer marcação. */
  function statusDoDia(presenca, id, ymd, fer) {
    if (ehFeriado(ymd, fer)) return 'FER';
    var d = presenca && presenca[ymd], c = d && d[id];
    return CODIGOS.indexOf(c) >= 0 ? c : '';
  }

  function semanaDoPagamento(p) { return dataValida(p && p.semana) ? segundaDe(p.semana) : (dataValida(p && p.data) ? segundaDe(p.data) : null); }

  /* ── fechamento semanal de UM temporário (as colunas da CALCULADORA) ── */
  function fechamentoSemana(id, segunda, ctx) {
    ctx = ctx || {};
    var p = parametros(ctx.config), fer = feriados(ctx.config), dias = diasDaSemana(segunda);
    var horasSexta = num((ctx.semanas && ctx.semanas[segunda] && ctx.semanas[segunda].horasSexta) || p.horasSexta) || p.horasSexta;
    var okSegQui = 0, okSexta = 0, faltas = 0, abonadas = 0, naoConv = 0, temF = false, mapa = {};
    dias.forEach(function(d, i) {
      var s = statusDoDia(ctx.presenca, id, d, fer); mapa[d] = s;
      if (s === 'OK') { if (i === 4) okSexta++; else okSegQui++; }
      else if (s === 'F') { faltas++; temF = true; }
      else if (s === 'FA') abonadas++;
      else if (s === 'NC') naoConv++;
    });
    var reduzida = temF;
    var valorDia = reduzida ? p.diariaReduzida : p.diariaSemana;
    var valorSexta = reduzida ? p.diariaReduzida : (horasSexta === 8 ? p.diariaSexta : p.diariaSemana);

    // atrasos da semana (a planilha só olha seg-sex)
    var horasAtraso = 0, diasLimSQ = 0, horasLimSQ = 0, diasLimSex = 0, horasLimSex = 0;
    Object.keys(ctx.atrasos || {}).forEach(function(k) {
      var a = ctx.atrasos[k];
      if (!a || a.tempId !== id || dias.indexOf(a.data) < 0) return;
      var h = num(a.horas); horasAtraso += h;
      if (h >= p.atrasoLimiteHoras) {
        if (diaSemana(a.data) === 5) { diasLimSex++; horasLimSex += h; } else { diasLimSQ++; horasLimSQ += h; }
      }
    });

    // VT e pagamentos da semana
    var vtPago = 0, salarioPago = 0, pagamentos = [];
    Object.keys(ctx.pagamentos || {}).forEach(function(k) {
      var g = ctx.pagamentos[k];
      if (!g || g.tempId !== id || semanaDoPagamento(g) !== segunda) return;
      pagamentos.push(Object.assign({id: k}, g));
      if (g.categoria === 'VT') vtPago += num(g.valor); else if (g.categoria === 'SALARIO') salarioPago += num(g.valor);
    });
    var diasVTbruto = p.valorVT > 0 ? Math.round((vtPago / p.valorVT) * 1e6) / 1e6 : 0;
    var vtOk = Math.abs(diasVTbruto - Math.round(diasVTbruto)) < 1e-9;
    var diasVT = vtOk ? Math.round(diasVTbruto) : null;

    var trabalhados = okSegQui + okSexta;
    var totalDiarias = okSegQui * valorDia + okSexta * valorSexta - diasLimSQ * (valorDia - p.diariaReduzida) - diasLimSex * (valorSexta - p.diariaReduzida);
    var descAtraso = (horasAtraso - horasLimSQ - horasLimSex) * p.valorHora + horasLimSQ * p.diariaReduzida / p.horasDia + horasLimSex * p.diariaReduzida / horasSexta;
    var diasDescVT = vtOk ? Math.max(0, diasVT - trabalhados) : null;
    var descVT = vtOk ? diasDescVT * p.valorVT : null;
    var vtAPagar = vtOk ? Math.max(0, trabalhados - diasVT) * p.valorVT : null;
    var fechamento = vtOk ? totalDiarias - descAtraso - descVT + vtAPagar : null;
    var participou = trabalhados + faltas + abonadas + naoConv > 0 || vtPago > 0 || salarioPago > 0 || horasAtraso > 0;

    return {
      id: id, semana: segunda, dias: mapa, participou: participou,
      diasSegQui: okSegQui, diasSexta: okSexta, trabalhados: trabalhados, faltas: faltas, abonadas: abonadas, naoConvocados: naoConv,
      regra: reduzida ? 'Reduzida' : 'Cheia', valorDia: valorDia, valorSexta: valorSexta, horasSexta: horasSexta,
      totalDiarias: r2(totalDiarias), horasAtraso: horasAtraso, diasAtrasoLimite: diasLimSQ + diasLimSex, descAtraso: r2(descAtraso),
      vtPago: r2(vtPago), diasVT: diasVT, diasDescVT: diasDescVT, descVT: vtOk ? r2(descVT) : null, vtAPagar: vtOk ? r2(vtAPagar) : null,
      erro: vtOk ? '' : 'VT pago (R$ ' + r2(vtPago) + ') não é múltiplo do valor do VT (R$ ' + p.valorVT + ')',
      fechamento: vtOk ? r2(fechamento) : null, pago: r2(salarioPago), emAberto: vtOk ? r2(fechamento - salarioPago) : null, pagamentos: pagamentos
    };
  }

  /* ── folha da semana: uma linha por temporário com movimento (ou ativo) ── */
  function folhaDaSemana(temps, segunda, ctx) {
    var linhas = [];
    Object.keys(temps || {}).forEach(function(id) {
      var t = temps[id]; if (!t) return;
      var f = fechamentoSemana(id, segunda, ctx);
      if (!f.participou && t.status === 'Inativo') return;
      if (!f.participou && !t.status) return;
      f.nome = t.nome; f.temp = t; linhas.push(f);
    });
    linhas.sort(function(a, b) { return norm(a.nome).localeCompare(norm(b.nome)); });
    var tot = {trabalhados: 0, totalDiarias: 0, descAtraso: 0, descVT: 0, vtAPagar: 0, fechamento: 0, pago: 0, emAberto: 0, vtPago: 0, erros: 0};
    linhas.forEach(function(l) {
      tot.trabalhados += l.trabalhados; tot.totalDiarias += l.totalDiarias; tot.descAtraso += l.descAtraso; tot.vtPago += l.vtPago; tot.pago += l.pago;
      if (l.erro) tot.erros++; else { tot.descVT += l.descVT; tot.vtAPagar += l.vtAPagar; tot.fechamento += l.fechamento; tot.emAberto += l.emAberto; }
    });
    Object.keys(tot).forEach(function(k) { tot[k] = k === 'trabalhados' || k === 'erros' ? tot[k] : r2(tot[k]); });
    return {linhas: linhas, totais: tot};
  }

  /* ── histórico de performance (as colunas do CADASTRO que estavam quebradas) ── */
  function semanasComMovimento(id, ctx) {
    var set = {};
    Object.keys(ctx.presenca || {}).forEach(function(d) { if (ctx.presenca[d] && ctx.presenca[d][id] && diaSemana(d) <= 5) set[segundaDe(d)] = true; });
    Object.keys(ctx.atrasos || {}).forEach(function(k) { var a = ctx.atrasos[k]; if (a && a.tempId === id && dataValida(a.data)) set[segundaDe(a.data)] = true; });
    Object.keys(ctx.pagamentos || {}).forEach(function(k) { var g = ctx.pagamentos[k]; if (g && g.tempId === id) { var s = semanaDoPagamento(g); if (s) set[s] = true; } });
    return Object.keys(set).sort();
  }
  function historico(id, ctx) {
    ctx = ctx || {};
    var fer = feriados(ctx.config), ok = 0, f = 0, fa = 0, nc = 0, primeiro = null, ultimo = null;
    Object.keys(ctx.presenca || {}).sort().forEach(function(d) {
      if (diaSemana(d) > 5) return;
      var s = statusDoDia(ctx.presenca, id, d, fer);
      if (s === 'OK') { ok++; if (!primeiro) primeiro = d; ultimo = d; } else if (s === 'F') f++; else if (s === 'FA') fa++; else if (s === 'NC') nc++;
    });
    var semanas = semanasComMovimento(id, ctx), liquido = 0, pago = 0, vt = 0, comErro = 0, emAberto = 0;
    semanas.forEach(function(s) {
      var x = fechamentoSemana(id, s, ctx);
      pago += x.pago; vt += x.vtPago;
      if (x.erro) comErro++; else { liquido += x.fechamento; emAberto += x.emAberto; }
    });
    var base = ok + f + fa;
    return {
      id: id, diasTrabalhados: ok, faltas: f, abonadas: fa, naoConvocados: nc, presencaPct: base ? ok / base : null,
      primeiroDia: primeiro, ultimoDia: ultimo, semanas: semanas.length, semanasComErro: comErro,
      totalLiquido: r2(liquido), totalPago: r2(pago), saldo: r2(liquido - pago), vtPago: r2(vt)
    };
  }

  /* ── validações das telas ── */
  function validarAtraso(a) {
    var e = [];
    if (!a || !txt(a.tempId)) e.push('Escolha o temporário.');
    if (!a || !dataValida(a.data)) e.push('Informe a data do atraso.');
    else if (diaSemana(a.data) > 5) e.push('A data do atraso tem que ser de segunda a sexta.');
    if (!a || !(num(a.horas) > 0) || num(a.horas) > 12) e.push('Informe as horas de atraso (maior que zero).');
    return e;
  }
  function validarPagamento(g, cfg) {
    var e = [], p = parametros(cfg);
    if (!g || !txt(g.tempId)) e.push('Escolha o temporário.');
    if (!g || !dataValida(g.data)) e.push('Informe a data do pagamento.');
    if (!g || !(num(g.valor) > 0)) e.push('Informe o valor pago.');
    if (!g || CATEGORIAS.indexOf(g.categoria) < 0) e.push('A categoria é SALARIO ou VT.');
    if (g && g.semana && !dataValida(g.semana)) e.push('A semana de referência é inválida.');
    if (g && g.categoria === 'VT' && num(g.valor) > 0 && p.valorVT > 0) {
      var d = num(g.valor) / p.valorVT;
      if (Math.abs(d - Math.round(d)) > 1e-6) e.push('O VT precisa ser múltiplo de R$ ' + p.valorVT.toFixed(2).replace('.', ',') + ' (valor do VT por dia).');
    }
    return e;
  }
  function validarTemp(t) {
    var e = [];
    if (!t || !txt(t.nome)) e.push('Informe o nome completo.');
    return e;
  }
  function validarParametros(c) {
    var e = [], p = parametros(c);
    ['valorHora', 'diariaSemana', 'diariaSexta', 'diariaReduzida', 'valorVT', 'horasDia', 'horasSexta', 'atrasoLimiteHoras'].forEach(function(k) {
      if (!(p[k] > 0)) e.push('Parâmetro "' + k + '" precisa ser maior que zero.');
    });
    return e;
  }

  function moeda(v) { return v == null ? '—' : 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /* CSV do fechamento (ponto e vírgula e vírgula decimal: abre direto no Excel em português) */
  function csvFolha(folha, segunda) {
    var cab = ['Semana', 'Nome', 'Dias trabalhados', 'Faltas', 'Abonadas', 'Regra', 'Total diárias', 'Desc. atraso', 'Desc. VT', 'VT a pagar', 'Fechamento', 'Pago (salário)', 'Em aberto', 'Obs'];
    var n = function(v) { return v == null ? '' : Number(v).toFixed(2).replace('.', ','); };
    var linhas = folha.linhas.map(function(l) {
      return [segunda, l.nome, l.trabalhados, l.faltas, l.abonadas, l.regra, n(l.totalDiarias), n(l.descAtraso), n(l.descVT), n(l.vtAPagar), n(l.fechamento), n(l.pago), n(l.emAberto), l.erro].map(function(c) {
        c = String(c == null ? '' : c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(';');
    });
    return [cab.join(';')].concat(linhas).join('\r\n');
  }

  return {
    CODIGOS: CODIGOS, ROTULOS: ROTULOS, CATEGORIAS: CATEGORIAS, PARAMETROS_PADRAO: PARAMETROS_PADRAO, FERIADOS_PADRAO: FERIADOS_PADRAO,
    norm: norm, dataValida: dataValida, somaDias: somaDias, diaSemana: diaSemana, segundaDe: segundaDe, diasDaSemana: diasDaSemana, dataBR: dataBR,
    parametros: parametros, feriados: feriados, ehFeriado: ehFeriado, statusDoDia: statusDoDia, semanaDoPagamento: semanaDoPagamento,
    fechamentoSemana: fechamentoSemana, folhaDaSemana: folhaDaSemana, semanasComMovimento: semanasComMovimento, historico: historico,
    validarAtraso: validarAtraso, validarPagamento: validarPagamento, validarTemp: validarTemp, validarParametros: validarParametros,
    moeda: moeda, csvFolha: csvFolha
  };
});
