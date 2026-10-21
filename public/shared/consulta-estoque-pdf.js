'use strict';
/* Relatório de Estoque em PDF (21/10/2026). Função pura: recebe as linhas JÁ filtradas e ordenadas da
   Consulta de Estoque e devolve um documento HTML completo (A4 paisagem), pronto para imprimir /
   "Salvar como PDF". Sem DOM, sem Firebase -- testado em run_consulta_estoque_pdf_test.js.
   Regras que importam:
   - Totais SEMPRE por unidade (un, kg, L...). Somar kg com un não significa nada.
   - Itens agrupados por tipo, mantendo a ordenação que o usuário escolheu dentro do grupo.
   - O relatório diz quais filtros geraram a lista: um PDF sem isso circula sem contexto. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConsultaEstoquePdf = factory();
})(typeof self !== 'undefined' ? self : this, function() {

  var GRUPOS = {
    MPGR: 'Matéria-prima', MPES: 'Fragrância/essência', EP: 'Embalagem primária', ES: 'Embalagem secundária',
    ET: 'Embalagem terciária', MU: 'Uso e consumo', PA: 'Produto acabado', OUTRO: 'Outros'
  };
  var ORDEM = ['MPGR', 'MPES', 'EP', 'ES', 'ET', 'MU', 'PA', 'OUTRO'];
  var ROTULO_TAG = {semControle: 'Sem controle', negativo: 'Negativo', falta: 'Empenho > saldo', vencido: 'Vencido', zerado: 'Zerado',
    vencendo: 'Vencendo', quarentena: 'Quarentena', empenhado: 'Empenhado', empenhoPreso: 'Empenho preso', ok: 'OK'};
  var TOM_TAG = {negativo: 'r', falta: 'r', vencido: 'r', empenhoPreso: 'r', vencendo: 'a', quarentena: 'a', zerado: 'c', semControle: 'c', empenhado: 'b', ok: 'v'};

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function fmt(n) {
    var v = num(n), c = Math.abs(v) < 100 && v % 1 ? 2 : 0;
    return v.toLocaleString('pt-BR', {minimumFractionDigits: 0, maximumFractionDigits: c});
  }
  function dataBR(v) { var s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : '—'; }
  function p2(n) { return n < 10 ? '0' + n : String(n); }
  function quando(d) { return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }

  /* Totais por unidade de um conjunto de linhas. Pura. */
  function totaisPorUnidade(rows) {
    var por = {}, ordem = [];
    (rows || []).forEach(function(r) {
      var u = String(r.unidade || '—').trim() || '—';
      if (!por[u]) { por[u] = {unidade: u, itens: 0, saldo: 0, empenhado: 0, disponivel: 0, quarentena: 0}; ordem.push(u); }
      var t = por[u];
      t.itens++; t.saldo += num(r.atual); t.empenhado += num(r.empenhado); t.disponivel += num(r.disponivel); t.quarentena += num(r.quarentena);
    });
    return ordem.sort().map(function(u) { return por[u]; });
  }

  function agrupar(rows) {
    var por = {};
    (rows || []).forEach(function(r) { var g = GRUPOS[r.grupo] ? r.grupo : 'OUTRO'; (por[g] = por[g] || []).push(r); });
    return ORDEM.filter(function(g) { return por[g]; }).map(function(g) { return {grupo: g, rotulo: GRUPOS[g], rows: por[g]}; });
  }

  function cNum(v) { return num(v) < 0 ? ' neg' : ''; }

  function linhaItem(r) {
    var tags = (r.tags || []).filter(function(t) { return ROTULO_TAG[t] && t !== 'ok'; });
    var sit = tags.length ? tags.map(function(t) { return '<span class="tg ' + (TOM_TAG[t] || 'c') + '">' + esc(ROTULO_TAG[t]) + '</span>'; }).join(' ')
      : (r.semRegistro ? '<span class="tg c">Sem registro</span>' : '<span class="tg v">OK</span>');
    var ends = (r.enderecos || []);
    var donos = (r.clientes || []).map(function(k) { return r.porCliente && r.porCliente[k] ? r.porCliente[k].nome : k; });
    return '<tr>' +
      '<td class="cod">' + esc(r.codigo) + '</td>' +
      '<td class="nome">' + esc(r.nome) + (donos.length ? '<div class="sub">do cliente: ' + esc(donos.slice(0, 2).join(', ')) + (donos.length > 2 ? ' +' + (donos.length - 2) : '') + '</div>' : '') + '</td>' +
      '<td class="un">' + esc(r.unidade || '—') + '</td>' +
      '<td class="n' + cNum(r.atual) + '">' + fmt(r.atual) + '</td>' +
      '<td class="n">' + (num(r.empenhado) ? fmt(r.empenhado) : '—') + '</td>' +
      '<td class="n' + cNum(r.disponivel) + '">' + fmt(r.disponivel) + '</td>' +
      '<td class="n">' + (num(r.quarentena) ? fmt(r.quarentena) : '—') + '</td>' +
      '<td class="c">' + dataBR(r.proxValidade) + '</td>' +
      '<td class="end">' + (ends.length ? esc(ends.slice(0, 3).join(', ')) + (ends.length > 3 ? ' <span class="sub">+' + (ends.length - 3) + '</span>' : '') : '—') + '</td>' +
      '<td class="sit">' + sit + '</td></tr>';
  }

  function blocoTotais(tot, rotulo) {
    if (!tot.length) return '';
    return '<tr class="tot"><td colspan="10"><span class="tt">' + esc(rotulo) + '</span>' + tot.map(function(t) {
      return '<span class="ti"><b>' + esc(t.unidade) + '</b> · ' + t.itens + ' ite' + (t.itens === 1 ? 'm' : 'ns') + ' · saldo <b' + (t.saldo < 0 ? ' class="neg"' : '') + '>' + fmt(t.saldo) + '</b>' +
        (t.empenhado ? ' · empenhado ' + fmt(t.empenhado) : '') + ' · disponível <b' + (t.disponivel < 0 ? ' class="neg"' : '') + '>' + fmt(t.disponivel) + '</b></span>';
    }).join('') + '</td></tr>';
  }

  var CSS = [
    '@page{size:A4 landscape;margin:12mm 12mm 14mm;@bottom-left{content:"Kuryos · Relatório de Estoque";font:8pt Arial,sans-serif;color:#6e6e73}@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8pt Arial,sans-serif;color:#6e6e73}}',
    '*{box-sizing:border-box}',
    'html{-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    'body{margin:0;font:9pt/1.35 "Segoe UI",Arial,sans-serif;color:#1d1d1f;background:#fff}',
    '.topo{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:10px;border-bottom:3px solid #0a1c69}',
    '.logo{height:42px;display:block}.logo svg{height:42px;width:auto;display:block}',
    '.logo .txt{font:800 22pt Arial,sans-serif;color:#0a1c69;letter-spacing:.04em}',
    '.titulo{text-align:right}.titulo h1{margin:0;font-size:17pt;color:#0a1c69;letter-spacing:-.01em}',
    '.titulo .meta{font-size:8.5pt;color:#6e6e73;margin-top:2px}',
    '.filtros{margin:10px 0 8px;padding:7px 10px;background:#f3f5fb;border-left:3px solid #0a1c69;border-radius:3px;font-size:8.5pt}',
    '.filtros b{color:#0a1c69}.filtros span{margin-right:14px;white-space:nowrap}',
    '.kpis{display:flex;gap:8px;margin:0 0 10px}',
    '.kpi{flex:1;border:1px solid #d9dce6;border-radius:5px;padding:6px 9px;background:#fff}',
    '.kpi .v{font-size:15pt;font-weight:700;color:#0a1c69;line-height:1.1}.kpi .l{font-size:7.5pt;color:#6e6e73;text-transform:uppercase;letter-spacing:.05em;margin-top:1px}',
    '.kpi.r .v{color:#c0392b}.kpi.a .v{color:#b9770e}',
    'table{width:100%;border-collapse:collapse}',
    'thead{display:table-header-group}tr{page-break-inside:avoid;break-inside:avoid}',
    'thead th{background:#0a1c69;color:#fff;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;padding:6px 6px;text-align:left;font-weight:600}',
    'th.n,td.n{text-align:right;font-variant-numeric:tabular-nums}th.c,td.c,th.un,td.un{text-align:center}',
    'tbody td{padding:4.5px 6px;border-bottom:1px solid #e6e8ef;vertical-align:top}',
    'tbody tr:nth-child(even) td{background:#fafbfd}',
    'tr.grp td{background:#e6eaf7!important;color:#0a1c69;font-weight:700;font-size:9pt;padding:6px;border-top:1px solid #b9c2e3;border-bottom:1px solid #b9c2e3}',
    'tr.grp .q{font-weight:400;color:#6e6e73;margin-left:8px}',
    'td.cod{font-family:Consolas,monospace;font-size:8pt;white-space:nowrap}td.nome{font-weight:600}',
    '.sub{font-size:7.5pt;color:#6e6e73;font-weight:400}td.end{font-size:8pt}',
    '.neg{color:#c0392b;font-weight:700}',
    '.tg{display:inline-block;padding:1px 6px;border-radius:9px;font-size:7.5pt;font-weight:600;white-space:nowrap}',
    '.tg.r{background:#fde8e6;color:#a93226}.tg.a{background:#fdf1d6;color:#8a5a00}.tg.v{background:#e0f4ee;color:#0c6b57}.tg.b{background:#e3e9fb;color:#1f3a9e}.tg.c{background:#ececf0;color:#55555b}',
    'tr.tot td{background:#f3f5fb!important;border-top:1px solid #b9c2e3;border-bottom:2px solid #b9c2e3;font-size:8.5pt;padding:6px}',
    'tr.tot .tt{font-weight:700;color:#0a1c69;margin-right:12px;text-transform:uppercase;font-size:7.5pt;letter-spacing:.05em}',
    'tr.tot .ti{display:inline-block;margin-right:16px}',
    '.geral{margin-top:14px;page-break-inside:avoid;break-inside:avoid;border:2px solid #0a1c69;border-radius:6px;overflow:hidden}',
    '.geral h2{margin:0;background:#0a1c69;color:#fff;font-size:9.5pt;padding:6px 10px;letter-spacing:.04em;text-transform:uppercase}',
    '.geral table td,.geral table th{padding:5px 10px}.geral thead th{background:#e6eaf7;color:#0a1c69}',
    '.nota{margin-top:10px;font-size:7.5pt;color:#6e6e73;line-height:1.4}',
    '.vazio{text-align:center;padding:30px;color:#6e6e73;font-size:11pt}',
    '.barra-tela{position:sticky;top:0;background:#0a1c69;color:#fff;padding:9px 14px;font:13px Arial,sans-serif;display:flex;gap:10px;align-items:center;justify-content:space-between;z-index:9}',
    '.barra-tela button{background:#fff;color:#0a1c69;border:0;border-radius:5px;padding:7px 14px;font-weight:700;cursor:pointer}',
    '@media print{.barra-tela{display:none}}'
  ].join('\n');

  /* opts: {rows, kpis:{itens,comSaldo,negativos,faltando,vencendo,vencidos,quarentena,zerados}, filtros:[[rotulo,valor],...],
            ordem, emitidoEm:Date, emitidoPor, logoSvg, aviso} */
  function documento(opts) {
    opts = opts || {};
    var rows = opts.rows || [];
    var k = opts.kpis || {};
    var logo = opts.logoSvg ? '<div class="logo">' + opts.logoSvg + '</div>' : '<div class="logo"><span class="txt">KURYOS</span></div>';
    var filtros = (opts.filtros || []).filter(function(f) { return f && f[1]; });
    var fHtml = '<div class="filtros"><span><b>Itens no relatório:</b> ' + rows.length + '</span>' +
      (filtros.length ? filtros.map(function(f) { return '<span><b>' + esc(f[0]) + ':</b> ' + esc(f[1]) + '</span>'; }).join('') : '<span>Sem filtros — estoque completo</span>') +
      (opts.ordem ? '<span><b>Ordenado por:</b> ' + esc(opts.ordem) + '</span>' : '') + '</div>';
    var kp = [
      ['Itens', rows.length, ''], ['Com saldo', rows.filter(function(r) { return num(r.atual) > 0; }).length, ''],
      ['Negativos', k.negativos || 0, k.negativos ? 'r' : ''], ['Empenho > saldo', k.faltando || 0, k.faltando ? 'r' : ''],
      ['Vencidos', k.vencidos || 0, k.vencidos ? 'r' : ''], ['Vencendo', k.vencendo || 0, k.vencendo ? 'a' : ''],
      ['Em quarentena', k.quarentena || 0, k.quarentena ? 'a' : ''], ['Zerados', k.zerados || 0, '']
    ].map(function(x) { return '<div class="kpi ' + x[2] + '"><div class="v">' + x[1] + '</div><div class="l">' + esc(x[0]) + '</div></div>'; }).join('');

    var corpo;
    if (!rows.length) corpo = '<div class="vazio">Nenhum item nos filtros selecionados.</div>';
    else {
      var grupos = agrupar(rows);
      corpo = '<table><thead><tr><th style="width:9%">Código</th><th>Item</th><th class="un" style="width:4%">Un.</th>' +
        '<th class="n" style="width:8%">Saldo</th><th class="n" style="width:8%">Empenhado</th><th class="n" style="width:8%">Disponível</th><th class="n" style="width:7%">Quarentena</th>' +
        '<th class="c" style="width:8%">Validade</th><th style="width:13%">Endereços</th><th style="width:13%">Situação</th></tr></thead><tbody>' +
        grupos.map(function(g) {
          return '<tr class="grp"><td colspan="10">' + esc(g.rotulo) + '<span class="q">' + g.rows.length + ' ite' + (g.rows.length === 1 ? 'm' : 'ns') + '</span></td></tr>' +
            g.rows.map(linhaItem).join('') + blocoTotais(totaisPorUnidade(g.rows), 'Total · ' + g.rotulo);
        }).join('') + '</tbody></table>';
      var geral = totaisPorUnidade(rows);
      corpo += '<div class="geral"><h2>Totais gerais por unidade</h2><table><thead><tr><th>Unidade</th><th class="n">Itens</th><th class="n">Saldo</th><th class="n">Empenhado</th><th class="n">Disponível</th><th class="n">Quarentena</th></tr></thead><tbody>' +
        geral.map(function(t) {
          return '<tr><td><b>' + esc(t.unidade) + '</b></td><td class="n">' + t.itens + '</td><td class="n' + cNum(t.saldo) + '">' + fmt(t.saldo) + '</td><td class="n">' + fmt(t.empenhado) +
            '</td><td class="n' + cNum(t.disponivel) + '">' + fmt(t.disponivel) + '</td><td class="n">' + fmt(t.quarentena) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    var quem = opts.emitidoPor ? ' por ' + esc(opts.emitidoPor) : '';
    var data = quando(opts.emitidoEm || new Date());
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de Estoque — Kuryos</title><style>' + CSS + '</style></head><body>' +
      '<div class="barra-tela"><span>Para salvar em PDF: Imprimir → Destino “Salvar como PDF”.</span><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></div>' +
      '<div class="topo">' + logo + '<div class="titulo"><h1>Relatório de Estoque</h1><div class="meta">Emitido em ' + data + quem + '</div></div></div>' +
      fHtml + '<div class="kpis">' + kp + '</div>' + corpo +
      '<div class="nota">' + esc(opts.aviso || 'Saldos conforme o sistema na data de emissão. Totais somados apenas dentro da mesma unidade de medida. “Disponível” = saldo menos o material reservado (empenhado) para OPs.') + '</div>' +
      '</body></html>';
  }

  return {documento: documento, totaisPorUnidade: totaisPorUnidade, agrupar: agrupar};
});
