/* ══════════════════════════════════════════════════════════════════════
   ANÁLISE DO GRANEL (bulk) — o que a Qualidade aponta antes do envase

   Pedido do usuário (29/09), na tela "Análise do granel":
   - NA nas opções: ensaio que não se aplica ao produto (teor alcoólico num
     creme) não é pendência nem reprova;
   - faixas de pH, teor e densidade EDITÁVEIS, vindas da especificação do
     produto;
   - campo só de resultado: no ensaio numérico a analista digita o número e
     o sistema diz se está dentro -- sem ter de marcar C/NC à mão.

   Regras que ficam aqui (funções PURAS, sem DOM nem Firebase):
   - numérico = tem faixa na especificação ou é pH/densidade/teor/álcool;
   - faixa editada na análise vale para ESTE lote e fica marcada
     (`faixaAlterada`) -- a especificação cadastrada não muda por baixo;
   - produto SEM especificação: a faixa digitada nasce como a v1 da
     especificação (mesma decisão da MP em 23/09: "o cadastro acontece na
     análise"), para o próximo lote já vir preenchido;
   - NA nunca reprova; ensaio crítico fora bloqueia (a tela pergunta).
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnaliseGranel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var NA = 'NA';
  function texto(v) { return String(v == null ? '' : v).trim(); }
  // Aceita vírgula (é como se digita no Brasil) e ignora o que não é número.
  function num(v) {
    if (v == null || v === '') return null;
    var x = Number(String(v).trim().replace(',', '.'));
    return isFinite(x) ? x : null;
  }
  function semAcento(v) { return texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function nomeNumerico(nome) { return /\bph\b|densidade|alco|teor/.test(semAcento(nome)); }
  function fmt(x) { return String(x).replace('.', ','); }
  function faixaTexto(min, max) {
    return min != null && max != null ? fmt(min) + ' – ' + fmt(max)
      : min != null ? '≥ ' + fmt(min) : max != null ? '≤ ' + fmt(max) : '';
  }

  /* Faixa escrita no TEXTO da especificação. Ensaio com dados reais (29/09):
     das 687 linhas numéricas das 218 especificações de produto, 282 têm a
     faixa só no texto ("5,5 – 6,5", "65 a 75", "180g-198g", "≥ 0,8") e as
     colunas Mínimo/Máximo vazias -- sem isto, o campo viria em branco. */
  var NUM = '(-?\\d+(?:[.,]\\d+)?)';
  var UNID = '\\s*[a-zA-Z%°µ/]*\\s*';
  var RE_ENTRE = new RegExp(NUM + UNID + '(?:–|—|-|a|até|ate)\\s*' + NUM, 'i');
  var RE_MIN = new RegExp('(?:≥|>=|mín(?:imo)?\\.?|min(?:imo)?\\.?)\\s*' + NUM, 'i');
  var RE_MAX = new RegExp('(?:≤|<=|máx(?:imo)?\\.?|max(?:imo)?\\.?)\\s*' + NUM, 'i');
  function faixaDoTexto(t) {
    var s = texto(t);
    if (!s) return null;
    var m = RE_ENTRE.exec(s);
    if (m) {
      var a = num(m[1]), b = num(m[2]);
      if (a != null && b != null && a <= b) return {minimo: a, maximo: b};
    }
    var mi = RE_MIN.exec(s), ma = RE_MAX.exec(s);
    if (mi || ma) return {minimo: mi ? num(mi[1]) : null, maximo: ma ? num(ma[1]) : null};
    return null;
  }

  /* As linhas da análise. `itensEspec` = especificacoes/{sku}__vN/itens do
     produto; sem ele, o `planoPadrao` (os seis do SpecMaterial.PLANO_MP). */
  function linhas(itensEspec, planoPadrao) {
    var espec = itensEspec || {};
    var temEspec = Object.keys(espec).length > 0;
    var origem = temEspec ? espec : {};
    if (!temEspec) {
      (planoPadrao || []).forEach(function(p) {
        origem[p.chave] = {ensaio: p.ensaio, metodo: p.metodo, numerico: !!p.numerico};
      });
    }
    return Object.keys(origem).map(function(k) {
      var e = origem[k] || {};
      var min = num(e.minimo), max = num(e.maximo);
      var espTexto = texto(e.especificacaoTexto);
      // "N/A", "NA", "N.A." e "-" no texto do cadastro querem dizer "a faixa
      // está nas colunas Mínimo/Máximo" (ver textoEspecAusente em utils.js).
      var ausente = /^(N\/?A|N\.A\.?|-)?$/i.test(espTexto.replace(/\s/g, ''));
      if (min == null && max == null && !ausente) {
        var dt = faixaDoTexto(espTexto);
        if (dt) { min = dt.minimo; max = dt.maximo; }
      }
      return {
        key: k, ensaio: texto(e.ensaio) || k, metodo: texto(e.metodo), critico: !!e.critico,
        especificacaoTexto: ausente ? '' : espTexto,
        numerico: !!e.numerico || min != null || max != null || nomeNumerico(e.ensaio),
        minimo: min, maximo: max,
        // Especificação que já diz "não se aplica" começa em NA.
        naEspec: e.aplicavel === false && min == null && max == null
      };
    });
  }

  /* Avalia com o que a analista preencheu. `resultados[key]`:
     {valor, cnc ('C'|'NC'), na (bool), minimo, maximo (faixa editada)}. */
  function avaliar(lista, resultados) {
    var res = resultados || {};
    var out = (lista || []).map(function(l) {
      var r = res[l.key] || {};
      var na = r.na != null ? !!r.na : !!l.naEspec;
      var editouMin = Object.prototype.hasOwnProperty.call(r, 'minimo');
      var editouMax = Object.prototype.hasOwnProperty.call(r, 'maximo');
      var min = editouMin ? num(r.minimo) : l.minimo;
      var max = editouMax ? num(r.maximo) : l.maximo;
      var faixaAlterada = l.numerico && (min !== l.minimo || max !== l.maximo);
      var valor = num(r.valor);
      var conforme = null, status, motivo = '';
      if (na) { status = 'NA'; motivo = 'Não se aplica.'; }
      else if (l.numerico) {
        if (valor == null) { status = 'PENDENTE'; motivo = 'Digite o resultado.'; }
        else if (min == null && max == null) { status = 'PENDENTE'; motivo = 'Informe a faixa para julgar o resultado.'; }
        else if (min != null && max != null && min > max) { status = 'PENDENTE'; motivo = 'Faixa inválida: mínimo maior que o máximo.'; }
        else if (min != null && valor < min) { conforme = false; status = 'NC'; motivo = 'Abaixo do mínimo (' + fmt(min) + ').'; }
        else if (max != null && valor > max) { conforme = false; status = 'NC'; motivo = 'Acima do máximo (' + fmt(max) + ').'; }
        else { conforme = true; status = 'C'; motivo = 'Dentro da faixa.'; }
      } else {
        if (r.cnc === 'C') { conforme = true; status = 'C'; }
        else if (r.cnc === 'NC') { conforme = false; status = 'NC'; }
        else { status = 'PENDENTE'; motivo = 'Marque C ou NC.'; }
      }
      return Object.assign({}, l, {na: na, minimoUsado: min, maximoUsado: max, faixa: faixaTexto(min, max),
        faixaAlterada: !na && faixaAlterada, valor: valor, cnc: l.numerico ? null : (r.cnc || null),
        conforme: conforme, status: status, motivo: motivo});
    });
    var c = {C: 0, NC: 0, NA: 0, PENDENTE: 0};
    out.forEach(function(l) { c[l.status]++; });
    return {linhas: out, conformes: c.C, naoConformes: c.NC, na: c.NA, pendentes: c.PENDENTE,
      bloqueia: out.some(function(l) { return l.critico && l.conforme === false; }),
      faixasAlteradas: out.filter(function(l) { return l.faixaAlterada; }).map(function(l) { return l.ensaio; })};
  }

  /* O que vai em ops/{op}/manipulacao/analise/ensaios. Mantém os campos que
     os leitores já usam (ensaio, especificacaoTexto, faixa, metodo, valor,
     cnc, conforme -- laudo de PA, densidade do INMETRO, dossiê) e acrescenta
     minimo/maximo usados, faixaAlterada e na. No numérico, `cnc` recebe o
     veredito automático para quem só lê C/NC. */
  function registro(aval) {
    var ensaios = {};
    ((aval && aval.linhas) || []).forEach(function(l) {
      ensaios[l.key] = {
        ensaio: l.ensaio, especificacaoTexto: l.especificacaoTexto || null, metodo: l.metodo || null,
        critico: l.critico, faixa: l.faixa || null,
        minimo: l.na ? null : l.minimoUsado, maximo: l.na ? null : l.maximoUsado,
        faixaAlterada: !!l.faixaAlterada,
        valor: l.na ? null : l.valor,
        cnc: l.na ? NA : l.numerico ? (l.conforme === true ? 'C' : l.conforme === false ? 'NC' : null) : l.cnc,
        na: !!l.na, conforme: l.na ? null : l.conforme
      };
    });
    return ensaios;
  }

  /* Especificação v1 do PRODUTO a partir da análise, quando ele não tem
     nenhuma. Só nasce se ao menos uma faixa numérica foi informada --
     especificação só de "C/NC" não ensina nada ao próximo lote. */
  function especificacaoDaAnalise(sku, aval, contexto) {
    var c = contexto || {};
    var itens = {}, comFaixa = 0;
    ((aval && aval.linhas) || []).forEach(function(l) {
      var temFaixa = !l.na && (l.minimoUsado != null || l.maximoUsado != null);
      if (temFaixa) comFaixa++;
      itens[l.key] = {
        ensaio: l.ensaio, metodo: l.metodo || null, critico: !!l.critico,
        especificacaoTexto: l.na ? NA : (l.especificacaoTexto || (temFaixa ? l.faixa : 'Conforme padrão')),
        minimo: temFaixa ? l.minimoUsado : null, maximo: temFaixa ? l.maximoUsado : null,
        aplicavel: !l.na
      };
    });
    if (!comFaixa) return null;
    var chave = sku + '__v1';
    var u = {};
    u['especificacoes/' + chave] = {
      codProduto: sku, versao: 'v1', tipoItem: 'PRODUTO', status: 'APROVADA',
      origem: 'ANALISE_GRANEL', criadoEm: c.agora || null, criadoPor: c.por || null, loteOrigem: c.lote || null,
      itens: itens
    };
    return {updates: u, chave: chave};
  }

  return {NA: NA, num: num, faixaDoTexto: faixaDoTexto, linhas: linhas, avaliar: avaliar, registro: registro,
    especificacaoDaAnalise: especificacaoDaAnalise, faixaTexto: faixaTexto};
});
