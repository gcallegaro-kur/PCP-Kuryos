/* Faixa de etapas comum às três telas da expedição de vendas (29/09):
   1 Montar carga → 2 Faturamento → 3 Acompanhamento, com quantas cargas
   esperam em cada uma. Depende de CargasPA (shared/cargas-pa.js). */
(function(root) {
  'use strict';
  var PASSOS = [
    {pagina: 'expedicao.html', titulo: 'Montar carga', desc: 'Paletes e agendamento'},
    {pagina: 'faturamento.html', titulo: 'Faturamento', desc: 'Solicitar e registrar NF'},
    {pagina: 'cargas.html', titulo: 'Acompanhamento', desc: 'NF, carregamento e saída'}
  ];
  function render(container, atual, agendas) {
    if (!container) return;
    var c = root.CargasPA ? root.CargasPA.contagem(agendas || {}) : {};
    var badges = [
      '',
      (c.AGENDADA || 0) + (c.FATURAMENTO_SOLICITADO || 0),
      (c.FATURADA || 0) + (c.AGUARDANDO_EMBARQUE || 0)
    ];
    var dicas = ['', ' carga(s) a faturar', ' carga(s) para carregar'];
    container.innerHTML = '<nav class="cargas-fluxo" aria-label="Etapas da expedição">' + PASSOS.map(function(p, i) {
      var ativo = p.pagina === atual;
      return '<a class="cargas-passo' + (ativo ? ' atual' : '') + '" href="' + p.pagina + '"' + (ativo ? ' aria-current="page"' : '') + '>' +
        '<span class="cargas-num">' + (i + 1) + '</span><span><b>' + p.titulo + '</b><small>' + p.desc + '</small></span>' +
        (badges[i] ? '<span class="cargas-badge" title="' + badges[i] + dicas[i] + '">' + badges[i] + '</span>' : '') + '</a>';
    }).join('<span class="cargas-seta" aria-hidden="true">›</span>') + '</nav>';
  }
  root.CargasFluxo = {render: render, PASSOS: PASSOS};
})(typeof window !== 'undefined' ? window : this);
