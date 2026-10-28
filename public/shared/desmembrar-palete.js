(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DesmembrarPalete = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  /* Desmembrar palete de PA (Montar Carga, 28/10/2026).
     Pedido do usuário: o apontamento do PA foi lançado errado (um palete só onde
     fisicamente há dois ou três). Em vez de refazer a Conferência de PA, o palete
     é dividido na própria tela: o original fica com a primeira parte e os demais
     nascem como paletes novos do MESMO lote, com a mesma OP, pedido, status da
     Qualidade, validade e endereço (movimentar depois, se precisar).

     Regras que não mudam:
     - o total de caixas e de unidades não muda (nada entra nem sai do estoque);
     - a caixa parcial é UMA caixa física: não se parte, vai inteira para um palete;
     - palete numa carga agendada não se mexe (a carga guarda o palete pela chave). */

  var MAX_PARTES = 20;

  function inteiro(v) { var n = Number(v); return Number.isFinite(n) && Math.floor(n) === n ? n : NaN; }
  function limpaChave(v) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '_'); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function erro(msg) { var e = new Error(msg); e.desmembrar = true; return e; }

  /* Composição do palete como ele está hoje. */
  function composicaoAtual(lote) {
    lote = lote || {};
    var caixas = inteiro(lote.caixasFechadas), multiplo = inteiro(lote.unidadesPorCaixa), parcial = inteiro(lote.unidadesCaixaParcial || 0), saldo = Number(lote.saldoLote);
    if (!(caixas >= 0) || !(parcial >= 0) || !Number.isFinite(saldo) || saldo <= 0) return null;
    if (caixas > 0 && !(multiplo > 0)) return null;
    if (multiplo > 0 && parcial >= multiplo) return null;
    if (caixas * (multiplo > 0 ? multiplo : 0) + parcial !== saldo) return null;
    return {caixas: caixas, multiplo: multiplo > 0 ? multiplo : null, parcial: parcial, saldo: saldo, volumes: caixas + (parcial > 0 ? 1 : 0)};
  }

  /* Dá para oferecer o botão? (volumes >= 2 e composição fechando) */
  function podeDesmembrar(lote) {
    if (!lote || lote.itemTipo !== 'produto') return false;
    var c = composicaoAtual(lote);
    return !!c && c.volumes >= 2;
  }

  /* Confere as partes digitadas contra o palete. Devolve {ok, mensagem, faltaCaixas, qtds}. */
  function conferir(lote, partes) {
    var c = composicaoAtual(lote);
    if (!c) return {ok: false, mensagem: 'A composição deste palete não fecha (caixas × unidades + parcial ≠ saldo). Corrija o cadastro de caixas antes de desmembrar.'};
    partes = partes || [];
    if (partes.length < 2) return {ok: false, mensagem: 'Informe ao menos dois paletes.'};
    if (partes.length > MAX_PARTES) return {ok: false, mensagem: 'No máximo ' + MAX_PARTES + ' paletes por vez.'};
    var somaCx = 0, somaParcial = 0, comParcial = 0, qtds = [];
    for (var i = 0; i < partes.length; i++) {
      var cx = inteiro(partes[i].caixas === '' || partes[i].caixas == null ? 0 : partes[i].caixas), pc = inteiro(partes[i].parcial === '' || partes[i].parcial == null ? 0 : partes[i].parcial);
      if (!(cx >= 0) || !(pc >= 0)) return {ok: false, mensagem: 'Palete ' + (i + 1) + ': caixas e unidades parciais precisam ser números inteiros, sem negativos.'};
      if (pc > 0 && !(c.multiplo > 0)) return {ok: false, mensagem: 'Palete ' + (i + 1) + ': este palete não tem unidades por caixa, então não há caixa parcial.'};
      if (c.multiplo && pc >= c.multiplo) return {ok: false, mensagem: 'Palete ' + (i + 1) + ': a caixa parcial precisa ter menos de ' + c.multiplo + ' unidades (uma caixa fechada).'};
      var qtd = cx * (c.multiplo || 0) + pc;
      if (!(qtd > 0)) return {ok: false, mensagem: 'Palete ' + (i + 1) + ' está vazio.'};
      somaCx += cx; somaParcial += pc; if (pc > 0) comParcial++; qtds.push(qtd);
    }
    var faltaCaixas = c.caixas - somaCx;
    if (comParcial > 1) return {ok: false, mensagem: 'A caixa parcial é uma caixa só: ela vai inteira para um único palete.', faltaCaixas: faltaCaixas};
    if (somaCx !== c.caixas) return {ok: false, mensagem: (faltaCaixas > 0 ? 'Faltam ' + faltaCaixas + ' caixa(s)' : 'Sobram ' + (-faltaCaixas) + ' caixa(s)') + ' para fechar as ' + c.caixas + ' do palete.', faltaCaixas: faltaCaixas};
    if (somaParcial !== c.parcial) return {ok: false, mensagem: c.parcial ? 'A caixa parcial de ' + c.parcial + ' un precisa ficar em um dos paletes.' : 'Este palete não tem caixa parcial.', faltaCaixas: 0};
    return {ok: true, mensagem: '', faltaCaixas: 0, qtds: qtds, composicao: c};
  }

  /* Plano completo: o que o original passa a ser e quais paletes nascem. */
  function planejar(lote, partes, lotesDoItem, ctx) {
    ctx = ctx || {};
    var r = conferir(lote, partes);
    if (!r.ok) throw erro(r.mensagem);
    var c = r.composicao, agora = ctx.agora || new Date().toISOString(), autor = ctx.autor || null, motivo = ctx.motivo || 'DESMEMBRAMENTO DE PALETE';
    lotesDoItem = lotesDoItem || {};
    var base = String(lote.identificadorPalete || '').replace(/-P\d+$/i, '') || ('PA-' + limpaChave(lote.opLote || lote.opKey || 'LOTE'));
    var prefixoChave = 'pa_' + limpaChave(lote.opKey || lote.opLote || base) + '_p';
    var maior = inteiro(lote.paleteNumero) > 0 ? inteiro(lote.paleteNumero) : 1;
    Object.keys(lotesDoItem).forEach(function(k) {
      var l = lotesDoItem[k] || {};
      if (!(l.opKey && l.opKey === lote.opKey) && String(l.identificadorPalete || '').replace(/-P\d+$/i, '') !== base) return;
      var n = inteiro(l.paleteNumero), m = /-P(\d+)$/i.exec(String(l.identificadorPalete || ''));
      if (n > maior) maior = n;
      if (m && Number(m[1]) > maior) maior = Number(m[1]);
    });
    var usadas = {}; Object.keys(lotesDoItem).forEach(function(k) { usadas[k] = true; });
    var filhos = [], proximo = maior;
    for (var i = 1; i < partes.length; i++) {
      var chave;
      do { proximo++; chave = prefixoChave + proximo; } while (usadas[chave]);
      usadas[chave] = true;
      var cx = inteiro(partes[i].caixas === '' || partes[i].caixas == null ? 0 : partes[i].caixas), pc = inteiro(partes[i].parcial === '' || partes[i].parcial == null ? 0 : partes[i].parcial);
      var filho = clone(lote);
      filho.paleteNumero = proximo; filho.identificadorPalete = base + '-P' + proximo;
      filho.caixasFechadas = cx; filho.unidadesCaixaParcial = pc; filho.saldoLote = r.qtds[i]; filho.qtdOriginal = r.qtds[i];
      filho.atualizadoEm = agora; filho.criadoPor = lote.criadoPor || autor;
      filho.desmembramento = {deLoteKey: ctx.loteKey || null, deIdentificador: lote.identificadorPalete || null, em: agora, por: autor, motivo: motivo};
      filhos.push({loteKey: chave, dados: filho, identificador: filho.identificadorPalete});
    }
    var cx0 = inteiro(partes[0].caixas === '' || partes[0].caixas == null ? 0 : partes[0].caixas), pc0 = inteiro(partes[0].parcial === '' || partes[0].parcial == null ? 0 : partes[0].parcial);
    return {
      original: {caixasFechadas: cx0, unidadesCaixaParcial: pc0, saldoLote: r.qtds[0], qtdOriginal: r.qtds[0], atualizadoEm: agora,
        desmembramento: {filhos: filhos.map(function(f) { return f.loteKey; }), em: agora, por: autor, motivo: motivo, saldoAntes: c.saldo, caixasAntes: c.caixas, parcialAntes: c.parcial}},
      antes: {caixasFechadas: c.caixas, unidadesCaixaParcial: c.parcial, saldoLote: c.saldo},
      filhos: filhos, qtds: r.qtds, composicao: c
    };
  }

  /* Grava. O original é conferido numa transação (nada mudou desde que a tela
     abriu) e só então os novos paletes e os movimentos entram, num update só.
     Se esse segundo passo falhar, o original volta ao que era. */
  function executar(dbRef, req) {
    var itemKey = req.itemKey, loteKey = req.loteKey, partes = req.partes, autor = req.autor || null, motivo = req.motivo || 'DESMEMBRAMENTO DE PALETE';
    var loteRef = dbRef.ref('estoque_lotes/' + itemKey + '/' + loteKey);
    return dbRef.ref('estoque_lotes/' + itemKey).once('value').then(function(snap) {
      var todos = snap.val() || {}, lote = todos[loteKey];
      if (!lote) throw erro('Palete não encontrado. Atualize a tela.');
      if (req.emCarga && req.emCarga(itemKey, loteKey)) throw erro('Este palete já está numa carga agendada. Retire-o da carga antes de desmembrar.');
      var plano = planejar(lote, partes, todos, {autor: autor, motivo: motivo, loteKey: loteKey, agora: new Date().toISOString()});
      var falhou = null;
      return loteRef.transaction(function(atual) {
        if (!atual) return atual;
        if (Number(atual.saldoLote) !== plano.antes.saldoLote || Number(atual.caixasFechadas) !== plano.antes.caixasFechadas ||
            Number(atual.unidadesCaixaParcial || 0) !== plano.antes.unidadesCaixaParcial || atual.desmembramento && atual.desmembramento.emAndamento) {
          falhou = 'O palete mudou enquanto você montava a divisão. Atualize a tela e refaça.';
          return;
        }
        Object.keys(plano.original).forEach(function(k) { atual[k] = plano.original[k]; });
        atual.desmembramento.emAndamento = true;
        return atual;
      }, undefined, false).then(function(res) {
        if (!res.committed) throw erro(falhou || 'Não foi possível reservar o palete. Atualize a tela e tente de novo.');
        var updates = {};
        plano.filhos.forEach(function(f, i) {
          updates['estoque_lotes/' + itemKey + '/' + f.loteKey] = f.dados;
          var mov = dbRef.ref('movimentos_estoque/' + itemKey).push().key;
          updates['movimentos_estoque/' + itemKey + '/' + mov] = {
            tipo: 'transferencia', motivo: motivo, qtd: plano.qtds[i + 1], saldoApos: null,
            ref: (lote.identificadorPalete || loteKey) + ' -> ' + f.identificador, loteKey: f.loteKey,
            enderecoKey: lote.enderecoKey || null, enderecoCodigo: lote.enderecoCodigo || null,
            itemTipo: lote.itemTipo, itemCodigo: lote.itemCodigo, itemNome: lote.itemNome || null, unidade: lote.unidade || 'un',
            autor: autor, em: plano.original.atualizadoEm
          };
        });
        updates['estoque_lotes/' + itemKey + '/' + loteKey + '/desmembramento/emAndamento'] = null;
        return dbRef.ref().update(updates).catch(function(e) {
          return loteRef.transaction(function(atual) {
            if (!atual) return atual;
            atual.caixasFechadas = plano.antes.caixasFechadas; atual.unidadesCaixaParcial = plano.antes.unidadesCaixaParcial;
            atual.saldoLote = plano.antes.saldoLote; atual.qtdOriginal = lote.qtdOriginal != null ? lote.qtdOriginal : plano.antes.saldoLote;
            if (lote.desmembramento) atual.desmembramento = lote.desmembramento; else delete atual.desmembramento;
            return atual;
          }, undefined, false).then(function() { throw erro('Não foi possível gravar os novos paletes; o palete original foi mantido. ' + (e && e.message || '')); });
        }).then(function() {
          return {original: loteKey, novos: plano.filhos.map(function(f) { return {loteKey: f.loteKey, identificador: f.identificador}; }), qtds: plano.qtds};
        });
      });
    });
  }

  return {composicaoAtual: composicaoAtual, podeDesmembrar: podeDesmembrar, conferir: conferir, planejar: planejar, executar: executar, MAX_PARTES: MAX_PARTES};
});
