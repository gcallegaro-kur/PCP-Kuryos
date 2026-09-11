"use strict";

const TIPOS_MATERIAL = new Set(["EMBALAGEM", "MATERIA_PRIMA"]);

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : NaN;
}

function texto(valor, max = 200) {
  return String(valor == null ? "" : valor).trim().slice(0, max);
}

function formatarLoteInterno(ano, sequencia) {
  const year = Number(ano);
  const seq = Number(sequencia);
  if (!Number.isInteger(year) || year < 2020 || year > 9999 || !Number.isInteger(seq) || seq < 1 || seq > 999999) {
    throw Object.assign(new Error("Sequência de lote interno inválida."), {code: "invalid-argument"});
  }
  return `AK-${year}-${String(seq).padStart(6, "0")}`;
}

function validarEPrepararLinhas(payload, pedido, enderecos) {
  const data = texto(payload.data, 10);
  const notaFiscal = texto(payload.notaFiscal, 80);
  const condicoesVeiculo = numero(payload.condicoesVeiculo);
  const linhas = Array.isArray(payload.linhas) ? payload.linhas : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw Object.assign(new Error("Informe a data do recebimento."), {code: "invalid-argument"});
  if (!notaFiscal) throw Object.assign(new Error("Informe o número da nota fiscal ou SEM NF."), {code: "invalid-argument"});
  if (![1, 2, 3, 4, 5].includes(condicoesVeiculo)) throw Object.assign(new Error("Avalie as condições do veículo de 1 a 5."), {code: "invalid-argument"});
  if (!linhas.length) throw Object.assign(new Error("Informe ao menos um lote recebido."), {code: "invalid-argument"});

  const itensPedido = pedido && pedido.itens || {};
  const totais = {};
  const lotesInformados = new Set();
  const preparadas = linhas.map((linha, indice) => {
    const itemKey = texto(linha.itemKey, 100);
    const item = itensPedido[itemKey];
    if (!item) throw Object.assign(new Error(`O item ${itemKey || indice + 1} não pertence mais ao Pedido de Compra.`), {code: "failed-precondition"});
    if (!texto(item.materialCodigo, 120)) throw Object.assign(new Error(`O item ${itemKey} está sem SKU interno no Pedido de Compra.`), {code: "failed-precondition"});
    const qtd = numero(linha.qtdRecebida);
    const qtdVolumes = numero(linha.qtdVolumes);
    const amostra = numero(linha.qtdAmostragem);
    const tipo = texto(linha.tipoMaterial, 30).toUpperCase();
    const enderecoKey = texto(linha.enderecoKey, 100);
    const endereco = enderecos && enderecos[enderecoKey];
    const loteOrigem = texto(linha.loteOrigem, 120);
    const skuFornecedor = texto(linha.skuFornecedor, 120);
    const identificacao = texto(linha.identificacaoMaterial, 300);
    const certificado = linha.certificadoFornecedor === true || texto(linha.certificadoFornecedor, 10).toUpperCase() === "SIM";
    const certificadoInformado = linha.certificadoFornecedor === true || linha.certificadoFornecedor === false || ["SIM", "NAO"].includes(texto(linha.certificadoFornecedor, 10).toUpperCase());
    const condEmb = numero(linha.condicoesEmbalagem);
    if (!(qtd > 0)) throw Object.assign(new Error(`Informe uma quantidade maior que zero para ${item.materialCodigo || itemKey}.`), {code: "invalid-argument"});
    if (!Number.isInteger(qtdVolumes) || qtdVolumes < 1 || qtdVolumes > 9999) throw Object.assign(new Error(`Informe a quantidade de volumes de ${item.materialCodigo || itemKey}.`), {code: "invalid-argument"});
    if (!TIPOS_MATERIAL.has(tipo)) throw Object.assign(new Error(`Selecione o tipo de material de ${item.materialCodigo || itemKey}.`), {code: "invalid-argument"});
    if (!identificacao) throw Object.assign(new Error(`Informe a identificação de ${item.materialCodigo || itemKey}.`), {code: "invalid-argument"});
    if (!skuFornecedor) throw Object.assign(new Error(`Informe o SKU do fornecedor de ${item.materialCodigo || itemKey}.`), {code: "invalid-argument"});
    if (!loteOrigem) throw Object.assign(new Error(`Informe o lote do fornecedor de ${item.materialCodigo || itemKey}; use NÃO INFORMADO quando ele não existir.`), {code: "invalid-argument"});
    const chaveLote = `${itemKey}|${loteOrigem.toUpperCase()}`;
    if (lotesInformados.has(chaveLote)) throw Object.assign(new Error(`O lote ${loteOrigem} foi repetido para ${item.materialCodigo || itemKey}. Mantenha uma única linha e some a quantidade.`), {code: "invalid-argument"});
    lotesInformados.add(chaveLote);
    if (!Number.isFinite(amostra) || amostra < 0) throw Object.assign(new Error(`Informe uma amostragem válida para ${item.materialCodigo || itemKey}.`), {code: "invalid-argument"});
    if (amostra > qtd + 0.0001) throw Object.assign(new Error(`A amostragem de ${item.materialCodigo || itemKey} não pode exceder a quantidade recebida deste lote.`), {code: "invalid-argument"});
    if (!certificadoInformado) throw Object.assign(new Error(`Informe se ${item.materialCodigo || itemKey} veio com certificado.`), {code: "invalid-argument"});
    if (![1, 2, 3, 4, 5].includes(condEmb)) throw Object.assign(new Error(`Avalie a embalagem de ${item.materialCodigo || itemKey} de 1 a 5.`), {code: "invalid-argument"});
    if (!endereco || endereco.ativo === false) throw Object.assign(new Error(`Selecione um endereço ativo para ${item.materialCodigo || itemKey}.`), {code: "failed-precondition"});
    totais[itemKey] = (totais[itemKey] || 0) + qtd;
    const validade = texto(linha.dataValidade, 10);
    if (validade && !/^\d{4}-\d{2}-\d{2}$/.test(validade)) throw Object.assign(new Error(`A validade de ${item.materialCodigo || itemKey} é inválida.`), {code: "invalid-argument"});
    return {
      itemKey, item, qtdRecebida: qtd, qtdVolumes, qtdAmostragem: amostra, tipoMaterial: tipo,
      identificacaoMaterial: identificacao, skuFornecedor, loteOrigem,
      certificadoFornecedor: certificado, condicoesEmbalagem: condEmb,
      dataValidade: validade || null, enderecoKey,
      enderecoCodigo: endereco.codigo || null,
    };
  });

  for (const [itemKey, qtdAgora] of Object.entries(totais)) {
    const item = itensPedido[itemKey];
    const pedidoQtd = numero(item.qtd) || 0;
    const recebido = numero(item.qtdRecebida) || 0;
    if (recebido + qtdAgora > pedidoQtd + 0.0001) {
      throw Object.assign(new Error(`O recebimento de ${item.materialCodigo || itemKey} excede o saldo do pedido. Disponível: ${Math.max(0, pedidoQtd - recebido)}.`), {code: "failed-precondition"});
    }
  }
  return {data, notaFiscal, condicoesVeiculo, linhas: preparadas, totais};
}

function statusPedidoApos(itens, deltas) {
  let algum = false;
  let completo = true;
  const novosTotais = {};
  for (const [key, item] of Object.entries(itens || {})) {
    const recebido = Math.max(0, (numero(item.qtdRecebida) || 0) + (numero(deltas[key]) || 0));
    const qtd = numero(item.qtd) || 0;
    novosTotais[key] = recebido;
    if (recebido > 0.0001) algum = true;
    if (recebido < qtd - 0.0001) completo = false;
  }
  return {status: completo ? "RECEBIDO_TOTAL" : (algum ? "RECEBIDO_PARCIAL" : "ENVIADO"), novosTotais};
}

module.exports = {formatarLoteInterno, validarEPrepararLinhas, statusPedidoApos};
