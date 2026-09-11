"use strict";

function sanitizeKey(val) {
  let s = String(val || "").trim();
  s = s.replace(/[./[\]#$]/g, "-");
  s = s.replace(/\s+/g, "_");
  return s.slice(0, 60);
}

function arredondar(v) {
  return Math.round((Number(v) || 0) * 1000) / 1000;
}

function erro(code, message) {
  const e = new Error(message);
  e.code = code;
  throw e;
}

function contagensOrdenadas(conf) {
  return Object.entries((conf && conf.contagens) || {}).map(([key, value]) => ({...(value || {}), key}))
    .sort((a, b) => String(a.contadoEm || "").localeCompare(String(b.contadoEm || "")) || a.key.localeCompare(b.key));
}

function analisarTripla(qtdApontada, contagens) {
  const apontada = arredondar(qtdApontada);
  const cs = (contagens || []).map((c) => ({...(c || {}), total: arredondar(c && c.total)}));
  if (!cs.length) return {status: "AGUARDANDO_CONTAGEM", etapa: 1, contagemAceita: null};
  const ultima = cs[cs.length - 1];
  if (cs.length === 1 && ultima.total === apontada) {
    return {status: "PRONTO_CONCILIADO", total: ultima.total, diferenca: 0, contagemAceita: ultima};
  }
  if (cs.length < 3) return {status: "DIVERGENCIA_RECONTAGEM", etapa: cs.length + 1, contagemAceita: null};
  const grupos = {};
  cs.slice(-3).forEach((c) => {
    const key = String(c.total);
    (grupos[key] = grupos[key] || []).push(c);
  });
  const consenso = Object.values(grupos).filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!consenso) return {status: "SEM_CONVERGENCIA", etapa: cs.length + 1, contagemAceita: null};
  const aceita = consenso[consenso.length - 1];
  const diferenca = arredondar(aceita.total - apontada);
  return {
    status: diferenca === 0 ? "PRONTO_CONCILIADO" : "AGUARDANDO_CONCILIACAO",
    total: aceita.total,
    diferenca,
    contagemAceita: aceita,
  };
}

function validarPaletes(paletes, enderecos) {
  const lista = Object.values(paletes || {});
  if (!lista.length) erro("failed-precondition", "A contagem aceita não possui paletes.");
  let total = 0;
  const numeros = new Set();
  lista.forEach((p, index) => {
    const numero = Number(p.numero || index + 1);
    const caixas = Number(p.caixasFechadas || 0);
    const multiplo = p.unidadesPorCaixa == null ? null : Number(p.unidadesPorCaixa);
    const parcial = Number(p.unidadesCaixaParcial || 0);
    const qtd = Number(p.qtdUnidades);
    if (!Number.isInteger(numero) || numero <= 0 || numeros.has(numero)) erro("invalid-argument", "A numeração dos paletes é inválida ou duplicada.");
    numeros.add(numero);
    if (!Number.isInteger(caixas) || caixas < 0 || !Number.isInteger(parcial) || parcial < 0 || !Number.isInteger(qtd) || qtd <= 0) erro("invalid-argument", "Caixas e unidades do palete " + numero + " precisam ser inteiras e positivas.");
    if (caixas > 0 && (!Number.isInteger(multiplo) || multiplo <= 0)) erro("invalid-argument", "Faltam as unidades por caixa do palete " + numero + ".");
    if (multiplo && (parcial >= multiplo || qtd !== caixas * multiplo + parcial)) erro("invalid-argument", "O total do palete " + numero + " não confere com caixas e parcial.");
    const endereco = (enderecos || {})[p.enderecoKey];
    if (!p.enderecoKey || !endereco || endereco.ativo === false) erro("failed-precondition", "O endereço do palete " + numero + " não existe ou está inativo.");
    total += qtd;
  });
  return {lista, total: arredondar(total)};
}

function prepararFinalizacao({opKey, op, conf, enderecos, lotesItem, autor, conciliacao, agora}) {
  if (!op || op.status !== "Concluído") erro("failed-precondition", "A OP precisa estar definitivamente concluída pelo PCP antes da entrada do PA.");
  const apontada = arredondar(op.produzidoLinha != null ? op.produzidoLinha : op.produzido);
  if (apontada <= 0) erro("failed-precondition", "A OP não possui quantidade produzida válida.");
  if (!conf) erro("not-found", "A conferência da OP não foi encontrada.");
  if (arredondar(conf.qtdApontada) !== apontada) erro("failed-precondition", "A quantidade da OP mudou depois do início da conferência. Reinicie a conferência com o PCP.");

  const contagens = contagensOrdenadas(conf);
  const estado = analisarTripla(apontada, contagens);
  if (estado.status !== "PRONTO_CONCILIADO" && estado.status !== "AGUARDANDO_CONCILIACAO") {
    erro("failed-precondition", "A conferência ainda não tem consenso físico suficiente para finalizar.");
  }
  const diferenca = arredondar(estado.total - apontada);
  const motivos = new Set(["APONTAMENTO_PRODUCAO_INCORRETO", "PERDA_OU_AVARIA", "SOBRA_FISICA", "ERRO_DE_EMBALAGEM_OU_CONTAGEM", "OUTRO"]);
  if (diferenca !== 0) {
    if (!conciliacao || !motivos.has(conciliacao.motivo) || String(conciliacao.observacao || "").trim().length < 10) {
      erro("failed-precondition", "A divergência exige causa e explicação formal da conciliação.");
    }
  }

  const aceita = estado.contagemAceita;
  const validacao = validarPaletes(aceita.paletes, enderecos);
  if (validacao.total !== arredondar(aceita.total)) erro("failed-precondition", "A soma dos paletes não confere com o total da contagem aceita.");
  const itemKey = sanitizeKey(op.sku);
  const finalId = "final_" + sanitizeKey(aceita.key);

  const legados = Object.entries(lotesItem || {}).filter(([, lote]) => lote && (lote.opKey === opKey || lote.origemRef === opKey));
  const alheios = legados.filter(([, lote]) => !lote.conferencia || lote.conferencia.finalizacaoId !== finalId);
  if (alheios.length) erro("already-exists", "Já existem paletes desta OP no WMS. A finalização foi bloqueada para evitar duplicidade; faça a conciliação do legado.");

  const updates = {};
  const rncNumero = diferenca === 0 ? null : "RNC-PA-" + sanitizeKey(opKey).toUpperCase();
  validacao.lista.forEach((p, index) => {
    const numero = Number(p.numero || index + 1);
    const endereco = enderecos[p.enderecoKey];
    const loteKey = "pa_" + sanitizeKey(opKey) + "_p" + numero;
    const movimentoKey = "confpa_" + sanitizeKey(opKey) + "_p" + numero;
    const identificador = "PA-" + String(op.lote || opKey).replace(/[^A-Za-z0-9]/g, "-") + "-P" + numero;
    updates["estoque_lotes/" + itemKey + "/" + loteKey] = {
      itemTipo: "produto", itemCodigo: op.sku, itemNome: op.produto || op.produtoNome || null, unidade: "un",
      loteOrigem: op.lote || null, opKey, opLote: op.lote || null, paleteNumero: numero, identificadorPalete: identificador,
      caixasFechadas: p.caixasFechadas, unidadesPorCaixa: p.unidadesPorCaixa || null,
      unidadesCaixaParcial: p.unidadesCaixaParcial, saldoLote: p.qtdUnidades, qtdOriginal: p.qtdUnidades,
      enderecoKey: p.enderecoKey, enderecoCodigo: endereco.codigo || p.enderecoKey,
      origemTipo: "conferencia_pa", origemRef: opKey, status: "QUARENTENA",
      conferencia: {qtdApontada: apontada, qtdConferida: p.qtdUnidades, divergenciaTotal: diferenca,
        contagemAceitaKey: aceita.key, totalContagens: contagens.length, conferidoEm: agora,
        conferidoPor: autor, conciliacao: diferenca === 0 ? null : conciliacao, finalizacaoId: finalId, rncNumero},
      criadoEm: agora, atualizadoEm: agora, criadoPor: autor,
    };
    updates["movimentos_estoque/" + itemKey + "/" + movimentoKey] = {
      tipo: "conferencia_pa", motivo: diferenca === 0 ? "ENTRADA PA CONFERIDA E ENDEREÇADA" : "ENTRADA PA APÓS TRIPLA CONFERÊNCIA",
      qtd: p.qtdUnidades, saldoApos: p.qtdUnidades, ref: opKey, loteKey, enderecoKey: p.enderecoKey,
      enderecoCodigo: endereco.codigo || p.enderecoKey, itemTipo: "produto", itemCodigo: op.sku,
      itemNome: op.produto || op.produtoNome || null, unidade: "un", autor, em: agora, finalizacaoId: finalId, rncNumero,
    };
  });
  const base = "conferencias_pa/" + opKey + "/";
  updates[base + "paletes"] = aceita.paletes;
  updates[base + "qtdPaletizada"] = estado.total;
  updates[base + "divergencia"] = diferenca;
  updates[base + "status"] = diferenca === 0 ? "CONFERIDO" : "CONFERIDO_COM_DIVERGENCIA";
  updates[base + "conciliacao"] = diferenca === 0 ? {motivo: "RECONTAGEM_CONFERE_OP", observacao: "Contagem física conciliada com o apontamento.", conciliadoEm: agora, conciliadoPor: autor} : {...conciliacao, qtdApontada: apontada, qtdFisica: estado.total, diferenca, conciliadoEm: agora, conciliadoPor: autor};
  updates[base + "alarmeResolvidoEm"] = conf.alarmeAbertoEm ? agora : null;
  updates[base + "conferidoEm"] = agora;
  updates[base + "conferidoPor"] = autor;
  updates[base + "finalizadoEm"] = agora;
  updates[base + "finalizacaoStatus"] = "FINALIZADO";
  updates[base + "finalizacaoId"] = finalId;
  updates[base + "rncNumero"] = rncNumero;

  if (rncNumero) {
    updates["nao_conformidades/" + rncNumero] = {
      numero: rncNumero, status: "ABERTA", classificacao: Math.abs(diferenca) / apontada >= 0.02 ? "MAIOR" : "MENOR",
      origem: "PRODUCAO", descricao: "Divergência entre produção apontada e PA recebido pela Logística. " + String(conciliacao.observacao).trim(),
      abertaEm: agora, abertaPor: autor, itemTipo: "produto", itemCodigo: op.sku,
      itemNome: op.produto || op.produtoNome || null, unidade: "un", qtdEnvolvida: Math.abs(diferenca),
      loteOrigem: op.lote || null, opLote: op.lote || null, acaoImediata: "Tripla conferência realizada; saldo físico conciliado antes da quarentena.",
      automatica: true, conferenciaOpKey: opKey,
    };
  }
  return {updates, finalId, total: estado.total, diferenca, rncNumero, contagemAceitaKey: aceita.key};
}

module.exports = {arredondar, contagensOrdenadas, analisarTripla, validarPaletes, prepararFinalizacao, sanitizeKey};
