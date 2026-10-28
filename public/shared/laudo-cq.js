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
  /* Sem resultado (28/09): o modelo trazia "Ausente" / "< 1 × 10³" já
     impressos, e o laudo afirmava um resultado que ninguém registrou. O
     resultado vem do laudo (`qualidade.resultadosPa.micro`); sem ele, sai
     em branco -- pendência visível, nunca resultado inventado. */
  var MICRO_PADRAO = [
    {analise: 'Contagem de Microrganismos Mesófilos Aeróbios Totais', metodo: 'USP',
      especificacao: '≤ 1 × 10³ UFC/g ou mL', resultado: ''},
    {analise: 'Ausência de Pseudomonas aeruginosa', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', resultado: ''},
    {analise: 'Ausência de Staphylococcus aureus', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', resultado: ''},
    {analise: 'Ausência de coliformes totais e fecais', metodo: 'USP',
      especificacao: 'Ausente em 1 g ou 1 mL', resultado: ''}
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
      (m.laboratorio || m.laudoExterno ? '<div class="laudo-nota-peq">Laudo externo: ' +
        esc([m.laboratorio, m.laudoExterno ? 'nº ' + m.laudoExterno : ''].filter(Boolean).join(' · ')) + '</div>' : '');
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
  /* Critério de peso dos laudos a partir de 25/09: Portaria INMETRO
     249/2021 (T da tabela, c do plano, 2T, média Qn − k·s) e, para
     produto declarado em ml, a densidade que converteu o nominal em
     gramas -- sem ela impressa, "170 g" num frasco de 200 ml parece erro. */
  var ORIGEM_DENSIDADE = {LAUDO: 'medida na amostra', BULK: 'análise do bulk', CADASTRO: 'cadastro do produto'};
  function linhasCriterioPeso(d, unidade) {
    var c = d.pesoCriterio;
    var emMl = c.unidadeDeclarada === 'ml';
    return '<div class="laudo-linha-info">Conteúdo declarado: ' + esc(fmt(c.nominalDeclarado) + ' ' + (emMl ? 'ml' : 'g')) +
        (emMl ? '     Densidade: ' + esc(fmt(c.densidade, 3) + ' g/ml (' + (ORIGEM_DENSIDADE[c.origemDensidade] || '—') + ')') : '') +
        '     Peso nominal: ' + esc(d.pesoNominal != null ? fmt(d.pesoNominal) + ' ' + unidade : '____') + '</div>' +
      '<div class="laudo-linha-info">Tolerância T: ' + esc(fmt(c.tolerancia) + ' ' + (emMl ? 'ml' : 'g')) +
        '     Mínimo individual (Qn − T): ' + esc(d.pesoMinimo != null ? fmt(d.pesoMinimo) + ' ' + unidade : '____') +
        ', até ' + esc(String(c.c)) + ' unidade(s)' +
        '     Nenhuma abaixo de (Qn − 2T): ' + esc(c.limiteT2 != null ? fmt(c.limiteT2) + ' ' + unidade : '____') +
        '     Média mínima (Qn − k·s): ' + esc(c.limiteMedia != null ? fmt(c.limiteMedia) + ' ' + unidade : '____') +
        '     [Portaria INMETRO 249/2021]</div>';
  }

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
      (d.pesoCriterio ? linhasCriterioPeso(d, unidade) :
      '<div class="laudo-linha-info">Peso nominal: ' + esc(d.pesoNominal != null ? fmt(d.pesoNominal) + ' ' + unidade : '____') +
        '     Mínimo aceitável [Δ3% segundo INMETRO]: ' +
        esc(d.pesoMinimo != null ? fmt(d.pesoMinimo) + ' ' + unidade : '____') + '</div>') +

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
    // Produto acabado tem `lote`; recebimento tem lote interno (AK-...) e
    // lote do fornecedor. O interno vem primeiro porque é o número que a
    // Kuryos usa para rastrear -- o do fornecedor só serve quando ainda não
    // houve geração de lote interno.
    var lote = d.lote || d.loteInterno || d.loteFornecedor || '';
    var partes = [prefixo, d.produto || d.material || d.codInterno, String(lote).replace(/\//g, '.')];
    return partes.filter(Boolean).join(' - ')
      .replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  }


  /* ══════════════════════════════════════════════════════════════════
     IDENTIFICAÇÃO DO RECEBIMENTO — cabeça comum do F0070 e do F009

     Os dois formulários pedem quase o mesmo bloco, na mesma ordem. Onde
     diferem está marcado: só a MP tem "Qtd por embalagem", "LOTE INTERNO"
     e "Validade" no corpo (a embalagem não tem validade).

     "Laudo: ( ) sim ( ) não" é o laudo do FORNECEDOR que veio junto com a
     carga -- no sistema é `certificadoFornecedor`, gravado pela Logística
     na entrada. Não confundir com este documento, que é o laudo da Kuryos.
     ══════════════════════════════════════════════════════════════════ */
  function sn(valor) {
    return '( ' + (valor === true ? 'X' : '&nbsp;') + ' ) Sim &nbsp; ( ' +
      (valor === false ? 'X' : '&nbsp;') + ' ) Não';
  }
  function opcao(marcado, texto) {
    return '( ' + (marcado ? 'X' : '&nbsp;') + ' ) ' + esc(texto);
  }
  function linhaCampo(partes) {
    return '<div class="laudo-campo-linha">' + partes.filter(Boolean).join('') + '</div>';
  }
  function campo(rotulo, valor, largura) {
    return '<span class="laudo-par"><b>' + esc(rotulo) + ':</b> ' +
      '<span class="laudo-campo"' + (largura ? ' style="min-width:' + largura + '"' : '') + '>' +
      esc(valor == null || valor === '' ? '' : valor) + '</span></span>';
  }
  function blocoIdentificacao(d, comValidade) {
    var qtd = d.qtdRecebida != null ? fmt(d.qtdRecebida) + ' ' + (d.unidade || '') : '';
    return '<div class="laudo-ident">' +
      linhaCampo([
        campo('Nome comercial', d.nomeComercial || d.material, '190px'),
        campo('Código', d.codigo, '110px'),
        campo('NF', d.notaFiscal, '90px')
      ]) +
      linhaCampo([
        campo('Fornecedor', d.fornecedor, '230px'),
        campo('Lote do fornecedor', d.loteFornecedor, '120px')
      ]) +
      linhaCampo([
        campo('Qtd recebida', qtd, '120px'),
        d.qtdPorEmbalagem != null && d.qtdPorEmbalagem !== ''
          ? campo('Qtd por embalagem', d.qtdPorEmbalagem, '110px') : '',
        d.loteInterno ? campo('Lote interno', d.loteInterno, '140px') : ''
      ]) +
      linhaCampo([
        campo('Descrição da embalagem', d.descricaoEmbalagem, '200px'),
        '<span class="laudo-par"><b>Lacre:</b> ' + sn(d.lacre === true ? true : d.lacre === false ? false : null) + '</span>'
      ]) +
      linhaCampo([
        '<span class="laudo-par"><b>Condições das embalagens:</b> ' +
          opcao(d.condicaoEmbalagem === 'APROPRIADA', 'Apropriada') + ' &nbsp; ' +
          opcao(d.condicaoEmbalagem === 'INAPROPRIADA', 'Inapropriada') + '</span>',
        comValidade ? campo('Validade', data(d.validade), '100px') : ''
      ]) +
      linhaCampo([
        '<span class="laudo-par">' + opcao(d.avaria === 'SEM', 'Recebido sem avaria') + ' &nbsp; ' +
          opcao(d.avaria === 'COM', 'Recebido com avarias') + '</span>',
        '<span class="laudo-par laudo-par-dir"><b>Laudo:</b> ' +
          sn(d.laudoFornecedor === true ? true : d.laudoFornecedor === false ? false : null) + '</span>'
      ]) +
    '</div>';
  }

  function blocoConclusaoRecebimento(d) {
    return '<div class="laudo-conclusao">' +
      '<span>' + marca(d.conclusao === 'APROVADO') + ' APROVADO</span>' +
      '<span>' + marca(d.conclusao === 'REPROVADO') + ' REPROVADO</span>' +
      (d.conclusao === 'RETIDO' ? '<span>' + marca(true) + ' RETIDO</span>' : '') +
      (d.conclusao === 'APROVADO_CONCESSAO' ? '<span>' + marca(true) + ' APROVADO COM CONCESSÃO</span>' : '') +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════
     F0070 — RECEBIMENTO E ANÁLISE DE MATÉRIA PRIMA (POP 004)
     ══════════════════════════════════════════════════════════════════ */
  function paginaMateriaPrima(dados) {
    var d = dados || {};
    var ensaios = (d.ensaios || []).map(function(e) {
      return [e.parametro, e.especificacao, e.metodo, e.resultado];
    });
    return '<div class="laudo-page">' +
      cabecalho('POP 004', 'F0070 – Rev.01',
        'RECEBIMENTO E ANÁLISE DE MATÉRIA PRIMA',
        d.material ? String(d.material).toUpperCase() : '') +
      blocoIdentificacao(d, true) +

      '<div class="laudo-h">Resultados analíticos</div>' +
      (ensaios.length
        ? tabela(['Parâmetros', 'Especificações', 'Métodos', 'Resultados'], ensaios)
        : '<div class="laudo-nota-peq">Nenhum ensaio cadastrado para este material — ' +
          'a especificação entra em Cadastros › Fórmulas/BOM/Especificações.</div>') +

      '<div class="laudo-h">Observações gerais</div>' +
      '<div class="laudo-obs">' + esc(d.observacoes || '') + '</div>' +

      '<div class="laudo-h">Conclusão</div>' +
      blocoConclusaoRecebimento(d) +
      (d.autorizadoPor ? '<div class="laudo-linha-info">Concessão autorizada por: ' + esc(d.autorizadoPor) + '</div>' : '') +

      linhaCampo([
        campo('Data do recebimento', data(d.dataRecebimento), '110px'),
        campo('Recebido por', d.recebidoPor, '170px')
      ]) +
      rodapeResponsavel(d, 'Data da análise') +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════
     F009 — RECEBIMENTO E ANÁLISE DE EMBALAGENS (POP 041)

     No papel as duas tabelas ficam lado a lado, em colunas estreitas.
     Aqui saem empilhadas: a dimensional tem quantas amostras a inspetora
     quiser (não as 12 fixas do papel) e não caberia espremida na metade
     da folha.
     ══════════════════════════════════════════════════════════════════ */
  function paginaEmbalagem(dados) {
    var d = dados || {};
    var params = (d.parametros || []).map(function(p) { return [p.texto, p.resultado]; });
    var medidas = d.dimensional || [];
    return '<div class="laudo-page">' +
      cabecalho('POP 041', 'F009 – Rev.01',
        'RECEBIMENTO E ANÁLISE DE EMBALAGENS',
        d.material ? String(d.material).toUpperCase() : '') +
      blocoIdentificacao(d, false) +

      '<div class="laudo-h">Resultados analíticos</div>' +
      (params.length
        ? tabela(['Parâmetros', 'Resultados'], params)
        : '<div class="laudo-nota-peq">Nenhum parâmetro respondido.</div>') +

      '<div class="laudo-h2">Parâmetros da ficha técnica</div>' +
      (d.fichaTecnica ? '<div class="laudo-linha-info">' + esc(d.fichaTecnica) + '</div>' : '') +
      (medidas.length
        ? tabela(['Amostra', 'Altura', 'Largura', 'Comprimento', 'Volume'],
            medidas.map(function(m, i) {
              return [String(i + 1), fmt(m.altura), fmt(m.largura), fmt(m.comprimento), fmt(m.volume)];
            }))
        : '<div class="laudo-nota-peq">Nenhuma medida registrada.</div>') +

      '<div class="laudo-h">Observações gerais</div>' +
      '<div class="laudo-obs">' + esc(d.observacoes || '') + '</div>' +

      '<div class="laudo-h">Conclusão</div>' +
      blocoConclusaoRecebimento(d) +
      (d.autorizadoPor ? '<div class="laudo-linha-info">Concessão autorizada por: ' + esc(d.autorizadoPor) + '</div>' : '') +

      linhaCampo([
        campo('Data do recebimento', data(d.dataRecebimento), '110px'),
        campo('Análise feita por', d.recebidoPor, '170px')
      ]) +
      rodapeResponsavel(d, 'Data da análise') +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════
     FOR-QUA-0001 — REGISTRO DE NÃO CONFORMIDADE (RNC)

     Reproduz o formulário Word que a Qualidade já usa, lido da "RNC - 0052"
     emitida em 28/10/2026 (rótulo B´BALM SEA SAPHIRE, cliente BIOFLORA).
     Mesma regra dos outros laudos deste arquivo: reproduzir, não melhorar --
     é documento de SGQ que vai para o cliente e que a auditoria compara com
     o do mês passado. O ganho aqui é a ORIGEM dos dados.

     DUAS COISAS A CONFERIR CONTRA O WORD ORIGINAL:
     - As seções 5 e 7 não existem na camada de texto do PDF: a 4 vai direto
       à 6, e o bloco "Método utilizado / Causa raiz" aparece solto antes da
       8 -- é claramente o conteúdo da 7. Aqui a 7 recebe o título "ANÁLISE
       DE CAUSA" e a 5 NÃO é emitida: a numeração fica fiel ao que se pôde
       verificar, em vez de inventar seção em documento de SGQ.
     - A "Origem da NC" do formulário (auditoria interna/externa, cliente,
       produção, inspeção, fornecedor, outro) NÃO é o vocabulário do
       `RNC_ORIGEM` do sistema (recebimento, produção, expedição, cliente,
       interna). ORIGEM_FORMULARIO faz o de-para, e o que não tem caixa
       própria sai em "Outro" com o rótulo do sistema escrito, para não
       perder a informação. Na 0052 a Roberta marcou "Inspeção" para uma RNC
       de recebimento -- é esse o de-para adotado.
     ══════════════════════════════════════════════════════════════════ */
  var ORIGEM_FORMULARIO = {
    RECEBIMENTO: 'Inspeção',
    PRODUCAO: 'Produção',
    CLIENTE: 'Cliente',
    EXPEDICAO: 'Outro',
    INTERNA: 'Outro'
  };
  var CAIXAS_ORIGEM = ['Auditoria interna', 'Auditoria externa', 'Cliente', 'Produção', 'Inspeção', 'Fornecedor'];
  var CLASSES_RNC = ['Crítica', 'Maior', 'Menor'];
  var ROTULO_CLASSE = { CRITICA: 'Crítica', MAIOR: 'Maior', MENOR: 'Menor' };
  var METODOS_CAUSA = ['5 Porquês', 'Ishikawa', 'FMEA'];

  function blocoOrigemRnc(d) {
    var caixa = ORIGEM_FORMULARIO[d.origem] || 'Outro';
    var outro = caixa === 'Outro' ? (d.origemRotulo || d.origem || '') : '';
    return '<div class="laudo-campo-linha">' +
      CAIXAS_ORIGEM.map(function(t) { return '<span class="laudo-par">' + opcao(caixa === t, t) + '</span>'; }).join('') +
      '<span class="laudo-par">' + opcao(caixa === 'Outro', 'Outro') + ': ' +
        '<span class="laudo-campo" style="min-width:120px">' + esc(outro) + '</span></span>' +
    '</div>';
  }

  /* Seção 6 -- as perguntas de contenção. São sim/não de TRÊS valores: sim,
     não e "ninguém respondeu". Em documento de BPF, pergunta não respondida
     tem de sair vazia: imprimir "Não" por falta de dado afirmaria contenção
     que ninguém verificou, que é exatamente o que o cliente e o auditor leem. */
  var PERGUNTAS_CONTENCAO = [
    ['loteBloqueado', 'O lote do produto foi bloqueado no estoque interno?'],
    ['materiaisBloqueados', 'As matérias-primas, granéis e/ou materiais de embalagem envolvidos no desvio foram bloqueados no estoque interno?'],
    ['outrosImpactados', 'Há outros produtos/lotes que podem ter sido impactados pelo mesmo desvio? Se sim, liste quais no campo de observação.'],
    ['outrosBloqueados', 'Caso a resposta acima seja "sim", estes itens também foram bloqueados no estoque interno?'],
    ['houveExpedicao', 'Houve expedição do lote reprovado e/ou de outros lotes possivelmente impactados pelo desvio? Se sim, liste quais no campo de observação.'],
    ['equipesAvisadas', 'As equipes internas foram avisadas sobre o RNC?']
  ];
  function blocoContencao(c) {
    var dados = c || {};
    return '<div class="laudo-ident">' + PERGUNTAS_CONTENCAO.map(function(p) {
      var v = dados[p[0]];
      return '<div class="laudo-campo-linha"><span class="laudo-par">' + esc(p[1]) + '</span>' +
        '<span class="laudo-par">' + sn(v === true ? true : v === false ? false : null) + '</span></div>';
    }).join('') + '</div>';
  }

  function blocoEscala(rotulo, valor, opcoes) {
    return '<div class="laudo-campo-linha"><span class="laudo-par"><b>' + esc(rotulo) + ':</b></span>' +
      opcoes.map(function(o) { return '<span class="laudo-par">' + opcao(valor === o, o) + '</span>'; }).join('') +
    '</div>';
  }

  /* A consulta ao cliente. Só sai impressa quando existe: RNC sem consulta
     não deve carregar uma seção vazia sugerindo que faltou perguntar. */
  function blocoConsultaCliente(cc) {
    if (!cc || !cc.notificadoEm) return '';
    var r = cc.resposta || null;
    return '<div class="laudo-h">Consulta ao cliente</div>' +
      '<div class="laudo-ident">' +
        linhaCampo([
          campo('Cliente notificado em', data(cc.notificadoEm), '110px'),
          campo('Por', cc.notificadoPor, '150px'),
          campo('Meio', cc.meio, '110px')
        ]) +
        linhaCampo([
          campo('Contato', cc.contatoNome, '170px'),
          campo('E-mail', cc.contatoEmail, '190px')
        ]) +
        (cc.observacao ? '<div class="laudo-linha-info">' + esc(cc.observacao) + '</div>' : '') +
        '<div class="laudo-campo-linha">' +
          '<span class="laudo-par">' + opcao(!r, 'Aguardando resposta') + '</span>' +
          '<span class="laudo-par">' + opcao(!!r && r.decisao === 'LIBEROU', 'Cliente AUTORIZOU o uso (concessão)') + '</span>' +
          '<span class="laudo-par">' + opcao(!!r && r.decisao === 'REPROVOU', 'Cliente REPROVOU') + '</span>' +
        '</div>' +
        (r
          ? linhaCampo([
              campo('Respondido em', data(r.respondidoEm), '110px'),
              campo('Autorizado por', r.autorizadoPor, '170px'),
              campo('Cargo', r.cargo, '130px')
            ]) +
            linhaCampo([
              campo('Meio da resposta', r.meio, '130px'),
              campo('Evidência anexada', r.evidencia, '200px')
            ]) +
            (r.restricao ? '<div class="laudo-linha-info"><b>Restrição de uso:</b> ' + esc(r.restricao) + '</div>' : '')
          : '') +
      '</div>';
  }

  /* RNC cancelada ainda imprime -- e imprime DIZENDO que está cancelada.
     Esconder o relatório deixaria um número sem papel na sequência; emitir o
     relatório normal seria pior, porque viraria um FOR-QUA-0001 válido de uma
     não conformidade que não existe. A faixa vem antes de tudo, e nomeia a
     RNC que permanece válida quando o cancelamento foi por duplicidade. */
  function faixaCancelada(d) {
    if (!d.cancelada) return '';
    return '<div class="laudo-cancelada">RNC CANCELADA' +
      (d.canceladaEm ? ' EM ' + data(d.canceladaEm) : '') +
      (d.canceladaPor ? ' POR ' + esc(d.canceladaPor) : '') +
      '<div class="laudo-cancelada-motivo">' + esc(d.motivoCancelamento || '') +
      (d.duplicataDe ? ' · Permanece válida a ' + esc(d.duplicataDe) : '') +
      '</div></div>';
  }

  function paginaRnc(dados) {
    var d = dados || {};
    var risco = d.risco || {};
    var ef = d.eficacia || {};
    var enc = d.encerramento || {};
    var metodoOutro = !!d.metodo && METODOS_CAUSA.indexOf(d.metodo) < 0;
    return '<div class="laudo-page">' +
      cabecalho('FOR-QUA-0001 — Versão 00', 'Setor: CQ',
        'RELATÓRIO DE NÃO CONFORMIDADE — RNC',
        'Sistema de Gestão da Qualidade — ISO 9001:2015') +
      faixaCancelada(d) +
      '<div class="laudo-ident">' + linhaCampo([
        campo('Data de emissão', data(d.dataEmissao), '110px'),
        campo('Elaborado por', d.elaboradoPor, '170px'),
        campo('Aprovado por', enc.aprovadoPor, '170px')
      ]) + '</div>' +

      titulo(1, 'IDENTIFICAÇÃO DA NÃO CONFORMIDADE') +
      '<div class="laudo-ident">' +
        linhaCampo([
          campo('RNC nº', d.numero, '140px'),
          campo('Data de abertura', data(d.dataAbertura), '110px')
        ]) +
        linhaCampo([campo('Nome do produto', d.produto, '420px')]) +
        linhaCampo([
          campo('Cliente', d.cliente, '190px'),
          campo('Lote', d.lote, '150px')
        ]) +
        linhaCampo([
          campo('Fornecedor', d.fornecedor, '190px'),
          campo('Área / Processo', d.area, '150px')
        ]) +
        linhaCampo([campo('Produto / Serviço', d.produtoServico, '190px')]) +
        '<div class="laudo-linha-info"><b>Origem da NC:</b></div>' +
        blocoOrigemRnc(d) +
      '</div>' +

      titulo(2, 'DESCRIÇÃO DA NÃO CONFORMIDADE') +
      '<div class="laudo-obs">' + esc(d.descricao || '') + '</div>' +

      titulo(3, 'CLASSIFICAÇÃO DA NÃO CONFORMIDADE') +
      '<div class="laudo-ident">' +
        linhaCampo([campo('Procedimento', d.procedimento, '220px')]) +
        '<div class="laudo-campo-linha">' +
          CLASSES_RNC.map(function(c) {
            return '<span class="laudo-par">' + opcao(ROTULO_CLASSE[d.classificacao] === c, c) + '</span>';
          }).join('') +
        '</div>' +
      '</div>' +

      titulo(4, 'EVIDÊNCIA OBJETIVA') +
      (d.fotos && d.fotos.length
        ? '<div class="laudo-nota-peq">' + esc(d.fotos.length) + ' registro(s) fotográfico(s) anexado(s) à RNC no sistema.</div>'
        : '') +
      '<div class="laudo-obs">' + esc(d.evidencia || '') + '</div>' +

      titulo(6, 'CORREÇÃO / AÇÃO DE CONTENÇÃO IMEDIATA') +
      '<div class="laudo-obs">' + esc(d.acaoImediata || '') + '</div>' +
      '<div class="laudo-ident">' + linhaCampo([
        campo('Responsável', d.responsavelAcaoImediata, '170px'),
        campo('Prazo', data(d.prazoAcaoImediata), '110px')
      ]) + '</div>' +
      blocoContencao(d.contencao) +
      (d.observacaoContencao ? '<div class="laudo-obs">' + esc(d.observacaoContencao) + '</div>' : '') +

      blocoConsultaCliente(d.consultaCliente) +

      titulo(7, 'ANÁLISE DE CAUSA') +
      '<div class="laudo-campo-linha">' +
        METODOS_CAUSA.map(function(m) {
          return '<span class="laudo-par">' + opcao(d.metodo === m, m) + '</span>';
        }).join('') +
        '<span class="laudo-par">' + opcao(metodoOutro, 'Outro') +
          ': <span class="laudo-campo" style="min-width:120px">' + esc(metodoOutro ? d.metodo : '') + '</span></span>' +
      '</div>' +
      '<div class="laudo-linha-info"><b>Causa raiz identificada:</b></div>' +
      '<div class="laudo-obs">' + esc(d.causaRaiz || '') + '</div>' +

      titulo(8, 'PLANO DE AÇÃO E AÇÃO CORRETIVA') +
      '<div class="laudo-obs">' + esc(d.planoAcao || '') + '</div>' +
      '<div class="laudo-ident">' + linhaCampo([
        campo('Responsável', d.responsavelAcao, '170px'),
        campo('Prazo', data(d.prazoAcao), '110px'),
        campo('Disposição do material', d.disposicao, '180px')
      ]) + '</div>' +

      titulo(9, 'AVALIAÇÃO PÓS-AÇÃO (RISCO RESIDUAL)') +
      '<div class="laudo-ident">' +
        blocoEscala('Probabilidade', risco.probabilidade, ['Baixa', 'Média', 'Alta']) +
        blocoEscala('Impacto', risco.impacto, ['Baixo', 'Médio', 'Alto']) +
        blocoEscala('Risco residual', risco.residual, ['Aceitável', 'Não aceitável']) +
      '</div>' +

      titulo(10, 'VERIFICAÇÃO DA EFICÁCIA') +
      '<div class="laudo-nota-peq">(ISO 9001 — Cláusula 10.2.1 d)</div>' +
      '<div class="laudo-linha-info"><b>Descrição da verificação:</b></div>' +
      '<div class="laudo-obs">' + esc(ef.descricao || '') + '</div>' +
      '<div class="laudo-ident">' +
        '<div class="laudo-campo-linha">' +
          '<span class="laudo-par"><b>Resultado:</b></span>' +
          '<span class="laudo-par">' + opcao(ef.resultado === 'APROVADO', 'Aprovado') + '</span>' +
          '<span class="laudo-par">' + opcao(ef.resultado === 'REPROVADO', 'Reprovado') + '</span>' +
        '</div>' +
        linhaCampo([
          campo('Data', data(ef.data), '110px'),
          campo('Responsável', ef.responsavel, '170px')
        ]) +
      '</div>' +

      titulo(11, 'ENCERRAMENTO') +
      '<div class="laudo-ident">' + linhaCampo([
        campo('Data de encerramento', data(enc.data), '110px'),
        campo('Aprovado por', enc.aprovadoPor, '190px')
      ]) + '</div>' +
      rodapeResponsavel(d, 'Data do registro') +
    '</div>';
  }

  /* ══════════════════════════════════════════════════════════════════
     TERMO DE ANUÊNCIA E ISENÇÃO DE RESPONSABILIDADE

     O documento que a Kuryos manda assinar quando o cliente, CIENTE da
     reprovação, autoriza usar o material. Não é laudo: é o papel que liga a
     reprovação da Kuryos à autorização nominal de quem respondeu por ela.

     A redação das cláusulas abaixo é operacional, montada sobre os fatos
     gravados na RNC. O texto de RESPONSABILIDADE CIVIL precisa de validação
     jurídica antes de virar padrão da casa -- este módulo produz o documento
     e os fatos; não substitui o advogado da Kuryos.
     ══════════════════════════════════════════════════════════════════ */
  function paginaTermoConcessao(dados) {
    var d = dados || {};
    var cc = d.consultaCliente || {};
    var r = cc.resposta || {};
    var itemTexto = [d.produto, d.lote ? 'lote ' + d.lote : null].filter(Boolean).join(', ');
    return '<div class="laudo-page">' +
      cabecalho('FOR-QUA-0001 — anexo', 'Setor: CQ',
        'TERMO DE ANUÊNCIA E ISENÇÃO DE RESPONSABILIDADE',
        'Uso de material sob concessão — ' + (d.numero || '')) +

      '<div class="laudo-ident">' +
        linhaCampo([
          campo('RNC nº', d.numero, '140px'),
          campo('Data de abertura', data(d.dataAbertura), '110px')
        ]) +
        linhaCampo([
          campo('Cliente', d.cliente, '220px'),
          campo('Fornecedor do material', d.fornecedor, '190px')
        ]) +
        linhaCampo([campo('Material / produto', itemTexto, '420px')]) +
      '</div>' +

      '<div class="laudo-h">1. Do resultado da inspeção</div>' +
      '<div class="laudo-obs">' +
        'A Kuryos, em sua inspeção de qualidade, REPROVOU o material acima identificado. ' +
        'A não conformidade constatada foi registrada na ' + esc(d.numero || 'RNC') +
        ', classificada como ' + esc(ROTULO_CLASSE[d.classificacao] || d.classificacao || '') +
        ', nos seguintes termos:' +
      '</div>' +
      '<div class="laudo-obs">' + esc(d.descricao || '') + '</div>' +
      (d.evidencia ? '<div class="laudo-obs">' + esc(d.evidencia) + '</div>' : '') +

      '<div class="laudo-h">2. Da contenção adotada</div>' +
      '<div class="laudo-obs">' +
        'Em decorrência da reprovação, o lote foi BLOQUEADO no estoque da Kuryos e sua ' +
        'utilização em produção foi suspensa' +
        (cc.notificadoEm ? ', e o cliente foi formalmente notificado em ' + esc(data(cc.notificadoEm)) +
          (cc.contatoNome ? ', na pessoa de ' + esc(cc.contatoNome) : '') +
          (cc.meio ? ' (' + esc(cc.meio) + ')' : '') : '') + '.' +
      '</div>' +
      (d.acaoImediata ? '<div class="laudo-obs">' + esc(d.acaoImediata) + '</div>' : '') +

      '<div class="laudo-h">3. Da autorização do cliente</div>' +
      '<div class="laudo-obs">' +
        'O CLIENTE, ciente da reprovação e da não conformidade descritas acima, ' +
        'AUTORIZA expressamente a utilização do material no estado em que se encontra, ' +
        'declarando que a decisão é sua e que foi tomada com pleno conhecimento do desvio.' +
      '</div>' +
      (r.restricao ? '<div class="laudo-obs"><b>Restrição de uso declarada pelo cliente:</b> ' + esc(r.restricao) + '</div>' : '') +

      '<div class="laudo-h">4. Da isenção de responsabilidade</div>' +
      '<div class="laudo-obs">' +
        'Por ser decisão do CLIENTE, e tendo a Kuryos cumprido seu dever de identificar, ' +
        'registrar, conter e comunicar a não conformidade, o CLIENTE assume integralmente ' +
        'a responsabilidade pelas consequências decorrentes do desvio aqui descrito, ' +
        'isentando a Kuryos de responsabilidade quanto a tais consequências. ' +
        'Esta isenção alcança exclusivamente a não conformidade descrita no item 1 e o ' +
        'lote nela identificado, não se estendendo a qualquer outro desvio, lote ou ' +
        'obrigação da Kuryos.' +
      '</div>' +

      '<div class="laudo-h">5. Assinaturas</div>' +
      '<div class="laudo-ident">' +
        linhaCampo([
          campo('Pelo cliente — nome', r.autorizadoPor, '220px'),
          campo('Cargo', r.cargo, '160px')
        ]) +
        linhaCampo([
          campo('Documento (CPF/RG)', null, '160px'),
          campo('Data', data(r.respondidoEm), '110px')
        ]) +
        '<div class="laudo-assina-bloco"><div class="laudo-assina-rotulo">Assinatura do representante do cliente</div></div>' +
      '</div>' +
      rodapeResponsavel(d, 'Data de emissão do termo') +
    '</div>';
  }

  return {
    MICRO_PADRAO: MICRO_PADRAO, NOTA_MICRO: NOTA_MICRO, DISPENSA_MICRO: DISPENSA_MICRO,
    cnc: cnc, tabelaPesos: tabelaPesos, blocoMicro: blocoMicro,
    paginaProdutoAcabado: paginaProdutoAcabado,
    paginaMateriaPrima: paginaMateriaPrima, paginaEmbalagem: paginaEmbalagem,
    ORIGEM_FORMULARIO: ORIGEM_FORMULARIO, PERGUNTAS_CONTENCAO: PERGUNTAS_CONTENCAO,
    paginaRnc: paginaRnc, paginaTermoConcessao: paginaTermoConcessao,
    nomeArquivo: nomeArquivo
  };
});
