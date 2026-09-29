/* ══════════════════════════════════════════════════════════════════════
   MOVIMENTAÇÃO NO WMS — regras da tela Movimentar (movimentar.html)

   Pedido do usuário (29/09): "a melhor funcionalidade possível, sendo
   simples e acessível, objetivo e explícito". Diagnóstico na base: 250
   endereços, 73 lotes em 15 posições -- e UMA transferência em toda a
   história. Transferir estava escondido numa das 10 abas do Estoque, só
   movia o lote inteiro, e partia do item, não de onde a pessoa está.

   A tela pergunta o que o operador pensa no galpão:
     1. DE ONDE   -- posição (FAB-1.1.1), palete (PA-26246-07-P1) ou lote
                     (AK-2026-000576): digitado, lido por leitor ou câmera;
     2. O QUÊ     -- a posição inteira, alguns lotes, ou parte de um lote;
     3. PARA ONDE -- com a situação dita antes: livre, ocupada (vai para o
                     mesmo palete), Doca, bloqueada ou a mesma posição;
     4. CONFIRMAR -- um resumo por extenso do que vai acontecer.
   Mover nunca muda saldo: só a posição (o lote inteiro) ou reparte o lote
   (parte fica, parte vai). Funções PURAS: sem DOM nem Firebase.
   ══════════════════════════════════════════════════════════════════════ */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MovimentacaoWMS = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function texto(v) { return String(v == null ? '' : v).trim(); }
  function n(v) { var x = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : null; }
  function arred(v) { return Math.round(Number(v) * 1000) / 1000; }
  function semAcento(v) { return texto(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }
  // "fab-1.1.1", " FAB 1.1.1 ", "FAB-1-1-1" e "*FAB-1.1.1*" (Code39 com
  // start/stop) são o mesmo endereço.
  function chaveCodigo(v) { return semAcento(v).replace(/^\*|\*$/g, '').replace(/[\s._/]+/g, '-').replace(/-+/g, '-'); }
  function ehDoca(e) { return !!e && semAcento(e.area) === 'DOCA'; }

  /* O que o código lido é. Ordem: endereço (chave ou código), palete (PA-…),
     lote interno (AK-…), lote do fornecedor/OP -- este último só se for
     único, senão devolve os candidatos para a pessoa escolher. */
  function reconhecer(codigo, enderecos, lotes) {
    var c = chaveCodigo(codigo);
    if (!c) return {tipo: 'VAZIO'};
    var ends = enderecos || {};
    var eKey = Object.keys(ends).find(function(k) { return chaveCodigo(k) === c || chaveCodigo((ends[k] || {}).codigo) === c; });
    if (eKey) return {tipo: 'ENDERECO', enderecoKey: eKey};
    var achados = [];
    Object.keys(lotes || {}).forEach(function(ik) {
      Object.keys(lotes[ik] || {}).forEach(function(lk) {
        var l = lotes[ik][lk] || {};
        if (!(Number(l.saldoLote) > 0)) return;
        var forte = [l.identificadorPalete, l.loteInterno].some(function(x) { return x && chaveCodigo(x) === c; });
        var fraco = [l.loteOrigem, l.opLote].some(function(x) { return x && chaveCodigo(x) === c; });
        if (forte || fraco) achados.push({itemKey: ik, loteKey: lk, forte: forte, enderecoKey: l.enderecoKey || null});
      });
    });
    var fortes = achados.filter(function(a) { return a.forte; });
    var lista = fortes.length ? fortes : achados;
    if (lista.length === 1) return {tipo: 'LOTE', itemKey: lista[0].itemKey, loteKey: lista[0].loteKey, enderecoKey: lista[0].enderecoKey};
    if (lista.length > 1) return {tipo: 'VARIOS', candidatos: lista};
    return {tipo: 'NAO_ENCONTRADO', codigo: texto(codigo)};
  }

  function rotuloLote(l) {
    return l.identificadorPalete || l.loteInterno || l.loteOrigem || l.opLote || '';
  }
  // Lotes com saldo numa posição, na ordem em que aparecem no palete.
  function conteudo(enderecoKey, lotes) {
    var out = [];
    Object.keys(lotes || {}).forEach(function(ik) {
      Object.keys(lotes[ik] || {}).forEach(function(lk) {
        var l = lotes[ik][lk] || {};
        if (l.enderecoKey !== enderecoKey || !(Number(l.saldoLote) > 0)) return;
        out.push({itemKey: ik, loteKey: lk, itemCodigo: l.itemCodigo || ik, itemNome: l.itemNome || '', itemTipo: l.itemTipo || '',
          saldo: Number(l.saldoLote), unidade: l.unidade || (l.itemTipo === 'produto' ? 'un' : ''), status: l.status || 'LIBERADO',
          rotulo: rotuloLote(l), validade: l.dataValidade || l.validade || '',
          caixas: Number(l.caixasFechadas) || 0, unidadesPorCaixa: Number(l.unidadesPorCaixa) || 0, caixaParcial: Number(l.unidadesCaixaParcial) || 0});
      });
    });
    return out.sort(function(a, b) { return String(a.itemCodigo).localeCompare(String(b.itemCodigo), 'pt-BR', {numeric: true}) || String(a.rotulo).localeCompare(String(b.rotulo)); });
  }

  /* Situação do destino para quem vai colocar `movendo` (lista de
     {itemKey, loteKey}) nele. Explícita, com o que a pessoa vai encontrar. */
  function situacaoDestino(enderecoKey, origemKey, enderecos, lotes, movendo) {
    var e = (enderecos || {})[enderecoKey];
    if (!enderecoKey) return {tipo: 'VAZIO'};
    if (!e) return {tipo: 'INEXISTENTE', texto: 'Endereço não encontrado.'};
    if (e.ativo === false) return {tipo: 'BLOQUEADA', texto: 'Posição bloqueada no cadastro de endereços: não recebe material.', codigo: e.codigo || enderecoKey};
    if (enderecoKey === origemKey) return {tipo: 'MESMA', texto: 'É a posição de origem.', codigo: e.codigo || enderecoKey};
    var ids = {};
    (movendo || []).forEach(function(m) { ids[m.itemKey + '/' + m.loteKey] = true; });
    var ocupantes = conteudo(enderecoKey, lotes).filter(function(o) { return !ids[o.itemKey + '/' + o.loteKey]; });
    if (ehDoca(e)) return {tipo: 'DOCA', texto: 'Doca: área de passagem, aceita vários paletes.', codigo: e.codigo || enderecoKey, ocupantes: ocupantes};
    if (ocupantes.length) return {tipo: 'OCUPADA', texto: 'Posição ocupada: o material vai para o MESMO palete de ' + ocupantes.length + ' lote(s) que já estão lá.', codigo: e.codigo || enderecoKey, ocupantes: ocupantes};
    return {tipo: 'LIVRE', texto: 'Posição livre.', codigo: e.codigo || enderecoKey, ocupantes: []};
  }

  /* Posições livres para sugerir, as mais próximas da origem primeiro
     (mesma área, mesma rua, prédio e nível mais perto). */
  function sugerirLivres(origemKey, enderecos, lotes, limite) {
    var ends = enderecos || {}, o = ends[origemKey] || {};
    var ocupadas = {};
    Object.keys(lotes || {}).forEach(function(ik) { Object.keys(lotes[ik] || {}).forEach(function(lk) { var l = lotes[ik][lk] || {}; if (l.enderecoKey && Number(l.saldoLote) > 0) ocupadas[l.enderecoKey] = true; }); });
    return Object.keys(ends).filter(function(k) {
      var e = ends[k] || {};
      return k !== origemKey && e.ativo !== false && !ehDoca(e) && !e.legado && !ocupadas[k] && Number(e.rua) > 0 && Number(e.rua) <= 60;
    }).map(function(k) {
      var e = ends[k];
      var dist = (semAcento(e.area) === semAcento(o.area) ? 0 : 1000) + Math.abs((Number(e.rua) || 0) - (Number(o.rua) || 0)) * 50 +
        Math.abs((Number(e.predio) || 0) - (Number(o.predio) || 0)) * 2 + Math.abs((Number(e.nivel) || 0) - (Number(o.nivel) || 0));
      return {enderecoKey: k, codigo: e.codigo || k, area: e.area || '', dist: dist};
    }).sort(function(a, b) { return a.dist - b.dist || String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', {numeric: true}); })
      .slice(0, limite || 6);
  }

  /* O plano. selecao: {itemKey/loteKey: {mover: bool, qtd: número|''}} --
     qtd vazia = o lote inteiro. Devolve as operações e um resumo por extenso. */
  function planejar(dados) {
    var d = dados || {}, erros = [], ops = [];
    var itens = conteudo(d.origemKey, d.lotes);
    if (!d.origemKey) erros.push('Escolha de onde o material sai.');
    else if (!itens.length) erros.push('Não há material com saldo nesta posição.');
    itens.forEach(function(l) {
      var s = (d.selecao || {})[l.itemKey + '/' + l.loteKey];
      if (!s || !s.mover) return;
      var q = s.qtd === '' || s.qtd == null ? null : n(s.qtd);
      if (q != null && !(q > 0)) return erros.push(l.itemCodigo + ' ' + l.rotulo + ': informe uma quantidade maior que zero.');
      if (q != null && q > l.saldo) return erros.push(l.itemCodigo + ' ' + l.rotulo + ': a quantidade (' + q + ') é maior que o saldo (' + l.saldo + ').');
      var inteiro = q == null || arred(q) === arred(l.saldo);
      // Produto acabado se move como palete/lote inteiro: dividir aqui criaria
      // um pedaço sem OP, pedido, laudo e caixas -- a Expedição não o veria.
      if (!inteiro && l.itemTipo === 'produto') return erros.push(l.itemCodigo + ' ' + l.rotulo + ': palete de produto acabado se move inteiro.');
      ops.push({tipo: inteiro ? 'MOVER_LOTE' : 'SEPARAR', itemKey: l.itemKey, loteKey: l.loteKey, qtd: inteiro ? l.saldo : arred(q),
        itemCodigo: l.itemCodigo, itemNome: l.itemNome, rotulo: l.rotulo, unidade: l.unidade, itemTipo: l.itemTipo, saldo: l.saldo});
    });
    if (d.origemKey && itens.length && !ops.length) erros.push('Marque o que vai ser movido.');
    var dest = situacaoDestino(d.destinoKey, d.origemKey, d.enderecos, d.lotes, ops);
    if (!d.destinoKey) erros.push('Escolha para onde vai.');
    else if (dest.tipo === 'MESMA') erros.push('O destino é a própria posição de origem.');
    else if (dest.tipo === 'BLOQUEADA' || dest.tipo === 'INEXISTENTE') erros.push(dest.texto);
    if (!texto(d.motivo)) erros.push('Escolha o motivo.');
    var tudo = itens.length > 0 && ops.length === itens.length && ops.every(function(o) { return o.tipo === 'MOVER_LOTE'; });
    var origem = ((d.enderecos || {})[d.origemKey] || {}).codigo || d.origemKey || '—';
    var resumo = ops.length ? (tudo && itens.length > 1 ? 'Mover o PALETE INTEIRO (' + ops.length + ' lotes)' : 'Mover ' + ops.map(function(o) {
      return (o.tipo === 'SEPARAR' ? o.qtd.toLocaleString('pt-BR') + ' de ' + o.saldo.toLocaleString('pt-BR') + ' ' + o.unidade + ' de ' : '') + o.itemCodigo + (o.rotulo ? ' (' + o.rotulo + ')' : '');
    }).join(', ')) + ' de ' + origem + ' para ' + (dest.codigo || '—') + '.' : '';
    return {ok: !erros.length, erros: erros, operacoes: ops, destino: dest, paleteInteiro: tudo, resumo: resumo,
      separacoes: ops.filter(function(o) { return o.tipo === 'SEPARAR'; }).length};
  }

  // Últimas transferências, para a pessoa ver o que acabou de acontecer.
  function ultimas(movimentos, enderecos, limite) {
    var lista = [];
    Object.keys(movimentos || {}).forEach(function(ik) {
      Object.keys(movimentos[ik] || {}).forEach(function(mk) {
        var m = movimentos[ik][mk] || {};
        if (m.tipo !== 'transferencia') return;
        var partes = String(m.ref || '').split(' -> ');
        var cod = function(k) { var e = (enderecos || {})[k]; return (e && e.codigo) || k || '—'; };
        lista.push({em: m.em || '', autor: m.autor || '', itemCodigo: m.itemCodigo || ik, itemNome: m.itemNome || '', qtd: Number(m.qtd) || 0,
          unidade: m.unidade || '', motivo: m.motivo || '', de: cod(partes[0]), para: cod(partes[1] || m.enderecoKey), loteKey: m.loteKey || ''});
      });
    });
    return lista.sort(function(a, b) { return String(b.em).localeCompare(String(a.em)); }).slice(0, limite || 20);
  }

  return {chaveCodigo: chaveCodigo, ehDoca: ehDoca, reconhecer: reconhecer, conteudo: conteudo, situacaoDestino: situacaoDestino,
    sugerirLivres: sugerirLivres, planejar: planejar, ultimas: ultimas};
});
