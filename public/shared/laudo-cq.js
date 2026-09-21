/* ══════════════════════════════════════════════════════════════════════
   LAUDOS DO CQ — o documento que sai impresso

   A Kuryos já emite esses laudos há anos, fora do sistema. Este módulo não
   inventa um formato: ele reproduz os documentos oficiais que estão em
   `06. Laboratório/01. CQ`, lidos um a um antes de escrever qualquer linha
   daqui (2026-09-21):

   - **Produto acabado** — "RELATÓRIO DE ANÁLISE – PRODUTO ACABADO", modelo
     Word de `23. Relatório de análise`, hoje preenchido pelo script
     `gerar_relatorio.py` a partir de uma planilha do Microsoft Forms. Nove
     seções, tabela de peso em 4 colunas, micro opcional.
   - **Matéria-prima** — F0070 / POP004, "RECEBIMENTO E ANÁLISE DE MATÉRIA
     PRIMA", um .doc por MP em `07. LAUDOS MP`.
   - **Embalagem** — F009 / POP041, "RECEBIMENTO E ANÁLISE DE EMBALAGENS",
     de `08. LAUDOS DE EMBALAGENS`.

   Por que reproduzir e não "melhorar": é documento de BPF que a Anvisa
   audita e que vai para o cliente. Quem recebe compara com o que recebeu
   no mês passado. O ganho aqui é a ORIGEM dos dados — sai do laudo
   registrado no sistema, não de uma redigitação —, não o layout.

   Funções PURAS: entram dados, sai HTML. Sem DOM, sem Firebase — é o que
   deixa o documento testável sem navegador.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaudoCQ = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) { var x = Number(v); return isFinite(x) ? x : null; }
  // Número como a fábrica lê: vírgula decimal, sem cauda de ponto flutuante.
  function fmt(v, casas) {
    var x = num(v);
    if (x == null) return '';
    var s = casas == null ? String(Math.round(x * 1000) / 1000) : x.toFixed(casas);
    return s.replace('.', ',');
  }
  function data(d) {
    var s = String(d || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
    return s;
  }
  function ou(v, alt) { return v == null || v === '' ? (alt == null ? '___/___/___' : alt) : v; }

  /* C / NC / NA do sistema → a palavra que o laudo em papel usa. O laudo
     nunca inventa "Conforme" para item não respondido: em branco é em
     branco, porque um campo vazio num documento de BPF é uma pendência
     visível e "Conforme" indevido é um registro falso. */
  function cnc(v) {
    return v === 'C' ? 'Conforme' : v === 'NC' ? 'Não conforme' : v === 'NA' ? 'Não aplicável' : '';
  }
  function marca(ligado) { return ligado ? '☒' : '☐'; }

  // ── Blocos de montagem ──────────────────────────────────────────────
  function titulo(n, texto) { return '<div class="laudo-h">' + esc(n) + '. ' + esc(texto) + '</div>'; }
  function subtitulo(n, texto) { return '<div class="laudo-h2">' + esc(n) + ' ' + esc(texto) + '</div>'; }
  function itens(lista) {
    return '<ul class="laudo-lista">' + lista.filter(Boolean).map(function(l) {
      return '<li><b>' + esc(l[0]) + ':</b> ' + esc(ou(l[1], '____________________')) + '</li>';
    }).join('') + '</ul>';
  }
  function tabela(colunas, linhas) {
    return '<table class="laudo-tabela"><thead><tr>' +
      colunas.map(function(c) { return '<th>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      linhas.map(function(l) {
        return '<tr>' + l.map(function(c) { return '<td>' + esc(ou(c, '')) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  function cabecalho(pop, formulario, titulo1, titulo2) {
    return '<div class="laudo-topo">' +
      '<div class="laudo-topo-org">LABORATÓRIO DE CONTROLE DE QUALIDADE E DESENVOLVIMENTO</div>' +
      '<div class="laudo-topo-doc">' + esc(titulo1) + (titulo2 ? '<br>' + esc(titulo2) : '') + '</div>' +
      (pop || formulario
        ? '<div class="laudo-topo-ref">' + esc(pop || '') + (pop && formulario ? ' · ' : '') + esc(formulario || '') + '</div>'
        : '') +
    '</div>';
  }
  function rodapeResponsavel(d, rotuloData) {
    var r = d.responsavel || {};
    return '<div class="laudo-assina">' +
      '<div><b>' + esc(rotuloData || 'Data da Análise') + ':</b> ' + esc(ou(data(d.dataAnalise))) + '</div>' +
      '<div class="laudo-assina-bloco">' +
        '<div class="laudo-assina-nome">' + esc(r.nome || '') + '</div>' +
        (r.registro ? '<div class="laudo-assina-reg">' + esc(r.registro) + '</div>' : '') +
        '<div class="laudo-assina-rotulo">Assinatura do responsável</div>' +
      '</div>' +
    '</div>';
  }

  /* ── Análises microbiológicas ──
     As 4 linhas e a nota da RDC vêm do modelo oficial. O usuário pediu
     (21/09) a opção de ENTRAR OU NÃO com a tabela: produto com álcool
     ≥ 60% dispensa o monitoramento, e o laudo sai com a justificativa
     técnica no lugar da tabela -- exatamente o que o gerar_relatorio.py já
     fazia perguntando "teor alcoólico acima de 60%?" no prompt. */
  var MICRO_PADRAO = [
    {analise: 'Contagem de Microrganismos Mesófilos Aeróbios Totais', metodo: 'USP',
      especificacao: '≤ 1 × 10³ UFC/g ou mL', resultado: '< 1 × 10³ UFC/mL ou g'},
    {analise: 'Ausência de Pseudomonas aeruginosa', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', resultado: 'Ausente'},
    {analise: 'Ausência de Staphylococcus aureus', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', resultado: 'Ausente'},
    {analise: 'Ausência de coliformes totais e fecais', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', resultado: 'Ausente'}
  ];
  var NOTA_MICRO = '*Categoria microbiológica Tipo II da RDC 907/2024 (ANVISA)';
  var DISPENSA_MICRO =
    'OBS: Devido à elevada concentração de álcool em sua composição (≥ 60%), ' +
    'determinados produtos cosméticos possuem risco microbiológico reduzido, ' +
    'podendo ter a frequência de monitoramento microbiológico flexibilizada, ' +
    'desde que a decisão esteja respaldada por avaliação e embasamento técnico adequados.';

  function blocoMicro(micro) {
    var m = micro || {};
    if (m.incluir === false) {
      return '<div class="laudo-obs">' + esc(m.justificativa || DISPENSA_MICRO) + '</div>';
    }
    var linhas = (m.linhas && m.linhas.length ? m.linhas : MICRO_PADRAO).map(function(l) {
      return [l.analise, l.metodo, l.especificacao, l.resultado];
    });
    return tabela(['Análise', 'Método', 'Especificação', 'Resultado obtido'], linhas) +
      '<div class="laudo-nota-peq">' + esc(NOTA_MICRO) + '</div>' +
      (m.laboratorio ? '<div class="laudo-nota-peq">Laudo externo: ' + esc(m.laboratorio) + '</div>' : '');
  }

  /* ── Tabela de peso ──
     4 colunas de Nº/Peso, como o modelo. A quantidade é a que a inspetora
     pesou -- o modelo dizia "amostra de 32 peças" porque 32 era o número
     cravado no Forms; agora a frase acompanha o que foi feito de verdade. */
  function tabelaPesos(pesos, unidade) {
    var lista = (pesos || []).map(num).filter(function(v) { return v != null && v > 0; });
    if (!lista.length) return '<div class="laudo-nota-peq">Nenhuma unidade pesada.</div>';
    var COLS = 4;
    var linhas = Math.ceil(lista.length / COLS);
    var html = '<table class="laudo-tabela laudo-pesos"><thead><tr>';
    for (var c = 0; c < COLS; c++) html += '<th>Nº</th><th>Peso (' + esc(unidade || 'g') + ')</th>';
    html += '</tr></thead><tbody>';
    for (var r = 0; r < linhas; r++) {
      html += '<tr>';
      for (var k = 0; k < COLS; k++) {
        // Coluna a coluna, como no modelo: 1..8 na 1ª, 9..16 na 2ª...
        var i = k * linhas + r;
        html += i < lista.length
          ? '<td>' + (i + 1) + '</td><td>' + esc(fmt(lista[i])) + '</td>'
          : '<td></td><td></td>';
      }
      html += '</tr>';
    }
    var soma = lista.reduce(function(s, v) { return s + v; }, 0);
    html += '</tbody></table>';
    html += '<div class="laudo-pesos-resumo">' +
      '<span><b>Média:</b> ' + esc(fmt(soma / lista.length, 2)) + ' ' + esc(unidade || 'g') + '</span>' +
      '<span><b>Mínimo:</b> ' + esc(fmt(Math.min.apply(null, lista), 2)) + ' ' + esc(unidade || 'g') + '</span>' +
      '<span><b>Máximo:</b> ' + esc(fmt(Math.max.apply(null, lista), 2)) + ' ' + esc(unidade || 'g') + '</span>' +
    '</div>';
    return html;
  }

  /* ══════════════════════════════════════════════════════════════════
     RELATÓRIO DE ANÁLISE — PRODUTO ACABADO
     ══════════════════════════════════════════════════════════════════ */
  function paginaProdutoAcabado(dados) {
    var d = dados || {};
    var pa = d.pa || {};
    var unidade = d.unidadePeso || 'g';
    var listaPesos = (d.pesos || []).map(num).filter(function(v) { return v != null && v > 0; });
    var nPesos = listaPesos.length;
    // A média de 5.1 ("Peso Médio") e a de 5.2 (rodapé da tabela) têm que
    // ser o MESMO número -- duas médias diferentes no mesmo laudo é o tipo
    // de detalhe que derruba a confiança no documento inteiro. Calculada
    // aqui, a partir dos pesos impressos, e não herdada de outro cálculo.
    var mediaPesos = nPesos
      ? listaPesos.reduce(function(s, v) { return s + v; }, 0) / nPesos
      : num(pa.pesoMedio);

    var fq = (d.fq && d.fq.length ? d.fq : [
      {parametro: 'Aspecto', especificacao: 'Conforme padrão', metodo: 'Análise visual'},
      {parametro: 'Cor', especificacao: 'Conforme padrão', metodo: 'Análise visual'},
      {parametro: 'Odor', especificacao: 'Característico', metodo: 'Análise olfativa'},
      {parametro: 'pH (25°C)', especificacao: '____ a ____', metodo: 'pHmetro calibrado'},
      {parametro: 'Densidade', especificacao: '____ a ____ g/mL', metodo: 'Picnômetro / densímetro'}
    ]).map(function(l) { return [l.parametro, l.especificacao, l.resultado, l.metodo]; });

    var emb = (d.embalagem || []).map(function(l) {
      return [l.parametro, l.especificacao || 'Conforme padrão', l.resultado, l.metodo || 'Análise visual'];
    });

    return '<div class="laudo-page">' +
      cabecalho(null, null, 'RELATÓRIO DE ANÁLISE –', 'PRODUTO ACABADO') +

      titulo(1, 'Identificação do Produto') +
      itens([
        ['Nome do Produto', d.produto],
        ['Código Interno', d.codInterno],
        ['Código Cliente', d.codCliente],
        ['Lote', d.lote],
        ['Data de Fabricação', data(d.dataFabricacao) || null],
        ['Data de Validade', data(d.validade) || null]
      ]) +

      titulo(2, 'Informações do Cliente') +
      itens([['Empresa', d.empresa]]) +

      titulo(3, 'Resultados de Análise FQ') +
      tabela(['Parâmetro', 'Especificação', 'Resultado obtido', 'Método de análise'], fq) +

      titulo(4, 'Resultado de Aspecto Visual – Embalagem') +
      (emb.length
        ? tabela(['Parâmetro', 'Especificação', 'Resultado obtido', 'Método de análise'], emb)
        : '<div class="laudo-nota-peq">Inspeção de embalagem não registrada neste lote.</div>') +

      titulo(5, 'Resultados de Análise PA') +
      '<div class="laudo-linha-info">Amostragem Aspecto: √N + 1' +
        (d.amostragemTexto ? ' — ' + esc(d.amostragemTexto) : '') + '</div>' +
      '<div class="laudo-linha-info">Análise de Peso: ' + nPesos + ' amostra' + (nPesos === 1 ? '' : 's') + '</div>' +

      subtitulo('5.1.', 'Aspecto') +
      tabela(['Parâmetro', 'Especificação', 'Resultado obtido', 'Método de análise'], [
        ['Defeito Menor', 'NQA 6,5%', pa.defeitoMenor == null ? '' : String(pa.defeitoMenor), 'Análise visual'],
        ['Defeito Maior', 'NQA 2,5%', pa.defeitoMaior == null ? '' : String(pa.defeitoMaior), 'Análise visual'],
        ['Defeito Crítico', '0', pa.defeitoCritico == null ? '' : String(pa.defeitoCritico), 'Análise visual'],
        ['Peso Médio', d.pesoNominal != null ? (fmt(d.pesoNominal) + ' ' + unidade + ' (± tolerância)') : '____ (± tolerância)',
          mediaPesos != null ? (fmt(mediaPesos, 2) + ' ' + unidade) : '', 'Balança calibrada']
      ]) +

      subtitulo('5.2.', 'Tabela de peso (amostra de ' + nPesos + ' peça' + (nPesos === 1 ? '' : 's') + ')') +
      tabelaPesos(d.pesos, unidade) +
      '<div class="laudo-linha-info">Peso nominal: ' + esc(d.pesoNominal != null ? fmt(d.pesoNominal) + ' ' + unidade : '____') +
        '     Mínimo aceitável [Δ3% segundo INMETRO]: ' +
        esc(d.pesoMinimo != null ? fmt(d.pesoMinimo) + ' ' + unidade : '____') + '</div>' +

      titulo(6, 'Análises Microbiológicas') +
      blocoMicro(d.micro) +

      titulo(7, 'Conclusão') +
      '<div class="laudo-conclusao">' +
        '<span>' + marca(d.conclusao === 'APROVADO') + ' Produto APROVADO</span>' +
        '<span>' + marca(d.conclusao === 'REPROVADO') + ' Produto REPROVADO</span>' +
      '</div>' +

      titulo(8, 'Observações') +
      '<div class="laudo-obs">' + esc(d.observacoes || '') + '</div>' +

      titulo(9, 'Responsáveis') +
      rodapeResponsavel(d) +

      '<div class="laudo-nota">Nota: Este certificado refere-se exclusivamente ao lote analisado ' +
      'e foi elaborado conforme os procedimentos internos de controle de qualidade e boas práticas de fabricação.</div>' +
    '</div>';
  }

  /* Nome do arquivo do PDF. Segue o que a Qualidade já arquivava à mão em
     `LAUDOS 2026`: "Relatório de análise - PRODUTO - 26244.09.pdf". A barra
     do lote vira ponto porque "/" não existe em nome de arquivo. */
  function nomeArquivo(prefixo, dados) {
    var d = dados || {};
    var partes = [prefixo, d.produto || d.material || d.codInterno, String(d.lote || '').replace(/\//g, '.')];
    return partes.filter(Boolean).join(' - ')
      .replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  }

  return {
    MICRO_PADRAO: MICRO_PADRAO, NOTA_MICRO: NOTA_MICRO, DISPENSA_MICRO: DISPENSA_MICRO,
    cnc: cnc, tabelaPesos: tabelaPesos, blocoMicro: blocoMicro,
    paginaProdutoAcabado: paginaProdutoAcabado, nomeArquivo: nomeArquivo
  };
});
