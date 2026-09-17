"use strict";
/* PDF do pedido comercial por e-mail à diretoria (2026-09-16).

   Pedido do usuário: "O PDF eu gostaria que fosse enviado em anexo no email
   para a diretoria". Decisão: automático ao criar E a cada edição (versão),
   com as mudanças destacadas na edição.

   Gatilhos em index.js:
     pedidos_comerciais/{id}               criado  -> versão 1 ("Novo pedido")
     pedidos_comerciais/{id}/versoes/{v}   criado  -> versão v ("Pedido alterado")
   Destinatários: config/emailDiretoria (lista ou texto separado por , ou ;).
   Sem destinatário não há padrão: registra SEM_DESTINATARIOS e não envia --
   mandar pedido com preço para um endereço adivinhado seria pior.

   Funções puras + gerarPdf (pdfkit, Buffer). O gatilho só lê, chama e envia. */

const PDFDocument = require("pdfkit");

const URL_GESTAO = "https://prod-kuryos.web.app/gestao_comercial.html?tab=carteira";
const AZUL = "#0a1c69";
const CINZA = "#6e6e73";
const LINHA = "#d2d2d7";

function texto(v) { return v == null ? "" : String(v); }
function n(v) { const x = Number(v); return isFinite(x) ? x : 0; }
function itensDe(pc) { return (Array.isArray(pc && pc.itens) ? pc.itens : Object.values((pc && pc.itens) || {})).filter(Boolean); }
function dataBr(d) { return /^\d{4}-\d{2}-\d{2}/.test(texto(d)) ? texto(d).slice(0, 10).split("-").reverse().join("/") : "—"; }
function unidades(v) { return Math.round(n(v)).toLocaleString("pt-BR"); }
function reais(v) { return n(v).toLocaleString("pt-BR", {style: "currency", currency: "BRL"}); }
function precoUn(v) { return n(v) > 0 ? "R$ " + n(v).toLocaleString("pt-BR", {minimumFractionDigits: 2, maximumFractionDigits: 4}) : "—"; }
// Helvetica do pdfkit usa WinAnsi: sem "→" (sai "!’"). Troca só no PDF.
function paraPdf(s) { return texto(s).replace(/→/g, "->").replace(/[“”]/g, "\"").replace(/[‘’]/g, "'"); }
function escHtml(s) { return texto(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c])); }

function destinatarios(config) {
  const bruto = config && config.emailDiretoria;
  const lista = Array.isArray(bruto) ? bruto : texto(bruto).split(/[;,\s]+/);
  const validos = lista.map((e) => texto(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return [...new Set(validos)];
}

// Só pedido do Comercial (tem itens com SKU). Rascunho sem itens não sai.
function deveEnviarCriacao(pc) {
  return !!pc && itensDe(pc).some((i) => i.sku) && !/cancelad/i.test(texto(pc.status));
}

function totais(pc) {
  const itens = itensDe(pc);
  const qtd = itens.reduce((s, i) => s + n(i.qtd), 0);
  const valor = itens.reduce((s, i) => s + n(i.qtd) * n(i.valorUnitario) - n(i.desconto), 0);
  const semPreco = itens.filter((i) => !(n(i.valorUnitario) > 0)).length;
  return {qtd, valor, semPreco, itens: itens.length};
}

function montarEmail(pc, id, versao) {
  const numero = texto(pc.numeroFormatado || id);
  const v = versao && versao.versao > 1 ? versao : null;
  const t = totais(pc);
  const assunto = (v ? "Pedido alterado (v" + v.versao + "): " : "Novo pedido: ") + numero + " — " + texto(pc.cliente) +
    (pc.numeroPedidoCliente ? " (pedido do cliente " + pc.numeroPedidoCliente + ")" : "");
  const linha = (rotulo, valor) => "<tr><td style=\"padding:3px 12px 3px 0;color:#6e6e73\">" + escHtml(rotulo) + "</td><td style=\"padding:3px 0\"><b>" + escHtml(valor) + "</b></td></tr>";
  const mudancas = v ? "<div style=\"background:#fff7ed;border-radius:8px;padding:10px 14px;margin:14px 0\"><b>O que mudou na versão " + v.versao + "</b>" +
    "<div style=\"color:#6e6e73\">Por " + escHtml(v.por || "—") + " em " + escHtml(new Date(v.em).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"})) + ". Motivo: " + escHtml(v.motivo || "—") + "</div>" +
    "<ul style=\"margin:6px 0 0 18px;padding:0\">" + (v.mudancas || []).map((m) => "<li>" + escHtml(m.texto || m.tipo) + "</li>").join("") + "</ul></div>" : "";
  const corpo = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d1d1f;max-width:640px\">" +
    "<p>" + (v ? "O pedido abaixo foi alterado." : "Um novo pedido foi liberado para o PCP.") + " O PDF completo está em anexo.</p>" + mudancas +
    "<table style=\"border-collapse:collapse;font-size:14px\">" +
    linha("Pedido", numero + (v ? " · versão " + v.versao : "")) + linha("Cliente", texto(pc.cliente)) +
    linha("Pedido do cliente", texto(pc.numeroPedidoCliente) || "—") + linha("Data", dataBr(pc.dataPedido)) +
    linha("Previsão de entrega", dataBr(pc.previsaoComercialEntrega)) + linha("Condição de pagamento", texto(pc.prazoPagamento) || "—") +
    linha("Itens", t.itens + " · " + unidades(t.qtd) + " un") +
    linha("Valor total", t.valor > 0 ? reais(t.valor) + (t.semPreco ? " (" + t.semPreco + " item(ns) sem preço)" : "") : "sem preço informado") +
    "</table><p style=\"margin-top:16px\"><a href=\"" + URL_GESTAO + "\">Abrir na Gestão Comercial</a></p>" +
    "<p style=\"color:#6e6e73;font-size:12px\">E-mail automático do sistema PCP Kuryos.</p></div>";
  const arquivo = "Pedido " + numero.replace(/[^A-Za-z0-9_-]+/g, "-") + (v ? " v" + v.versao : "") + ".pdf";
  return {assunto, corpo, arquivo};
}

/* PDF A4. cadastro: clientes/{clienteKey} (CNPJ, código), opcional. */
function gerarPdf(pc, id, versao, cadastro) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size: "A4", margin: 40, info: {Title: "Pedido " + texto(pc.numeroFormatado || id), Author: "Kuryos"}});
    const partes = [];
    doc.on("data", (b) => partes.push(b));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    const esq = 40, larg = doc.page.width - 80, v = versao && versao.versao > 1 ? versao : null;
    const cad = cadastro || pc.clienteCadastro || {};

    // Cabeçalho
    doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(22).text("KURYOS", esq, 40);
    doc.fillColor(CINZA).font("Helvetica").fontSize(9).text("Pedido comercial", esq, 66);
    doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(16).text(texto(pc.numeroFormatado || id), esq, 40, {width: larg, align: "right"});
    doc.fillColor(CINZA).font("Helvetica").fontSize(9)
        .text((v ? "Versão " + v.versao + " · " : "") + "Emitido em " + new Date().toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"}), esq, 60, {width: larg, align: "right"});
    doc.moveTo(esq, 84).lineTo(esq + larg, 84).lineWidth(2).strokeColor(AZUL).stroke();

    // Dados do pedido em duas colunas
    let y = 96;
    const par = (rotulo, valor, x, w) => {
      doc.fillColor(CINZA).font("Helvetica").fontSize(8).text(rotulo.toUpperCase(), x, y, {width: w});
      doc.fillColor("#1d1d1f").font("Helvetica").fontSize(10).text(texto(valor) || "—", x, y + 10, {width: w});
      return doc.y;
    };
    const col = larg / 2;
    const linhaPar = (a, b) => {
      const fim = Math.max(par(a[0], a[1], esq, col - 10), par(b[0], b[1], esq + col, col));
      y = fim + 7;
    };
    linhaPar(["Cliente", pc.cliente], ["CNPJ", cad.cnpj]);
    linhaPar(["Pedido do cliente", pc.numeroPedidoCliente], ["Data do pedido", dataBr(pc.dataPedido)]);
    linhaPar(["Previsão de entrega", dataBr(pc.previsaoComercialEntrega)], ["Condição de pagamento", pc.prazoPagamento]);
    const frete = pc.frete || {};
    linhaPar(["Frete", [frete.tipo, frete.prazo].filter(Boolean).join(" · ")], ["% NF", pc.percentualNF != null ? pc.percentualNF + "%" : ""]);
    linhaPar(["Contato", [pc.contato, pc.telefone, pc.email].filter(Boolean).join(" · ")], ["Entrega parcial", pc.entregaParcial === false ? "Não" : "Permitida"]);
    linhaPar(["Endereço de entrega", frete.enderecoEntrega], ["Endereço de faturamento", pc.enderecoFaturamento]);

    // Mudanças da versão
    if (v) {
      y += 4;
      const linhas = ["Motivo: " + paraPdf(v.motivo || "—")].concat((v.mudancas || []).map((m) => "• " + paraPdf(m.texto || m.tipo)));
      const alturaTexto = doc.font("Helvetica").fontSize(9).heightOfString(linhas.join("\n"), {width: larg - 20});
      doc.roundedRect(esq, y, larg, alturaTexto + 30, 6).fill("#fff7ed");
      doc.fillColor("#c2410c").font("Helvetica-Bold").fontSize(10)
          .text("O que mudou na versão " + v.versao + " — " + texto(v.por) + ", " + new Date(v.em).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"}), esq + 10, y + 8, {width: larg - 20});
      doc.fillColor("#1d1d1f").font("Helvetica").fontSize(9).text(linhas.join("\n"), esq + 10, y + 22, {width: larg - 20});
      y = y + alturaTexto + 40;
    }

    // Tabela de itens
    const cols = [
      {t: "SKU", w: 70}, {t: "Produto", w: larg - 70 - 62 - 70 - 62 - 78}, {t: "Qtd.", w: 62, a: "right"},
      {t: "Preço un.", w: 70, a: "right"}, {t: "Desconto", w: 62, a: "right"}, {t: "Total", w: 78, a: "right"}
    ];
    const cabecalho = () => {
      doc.rect(esq, y, larg, 18).fill("#f5f5f7");
      let x = esq;
      cols.forEach((c) => {
        doc.fillColor(CINZA).font("Helvetica-Bold").fontSize(8).text(c.t.toUpperCase(), x + 4, y + 5, {width: c.w - 8, align: c.a || "left"});
        x += c.w;
      });
      y += 20;
    };
    cabecalho();
    const itens = itensDe(pc);
    itens.forEach((i) => {
      const valores = [paraPdf(i.sku), paraPdf(i.descricao), unidades(i.qtd), precoUn(i.valorUnitario),
        n(i.desconto) ? reais(i.desconto) : "—", n(i.valorUnitario) > 0 ? reais(n(i.qtd) * n(i.valorUnitario) - n(i.desconto)) : "—"];
      const altura = Math.max(14, doc.font("Helvetica").fontSize(9).heightOfString(valores[1], {width: cols[1].w - 8})) + 6;
      if (y + altura > doc.page.height - 90) { doc.addPage(); y = 40; cabecalho(); }
      let x = esq;
      cols.forEach((c, k) => {
        doc.fillColor("#1d1d1f").font("Helvetica").fontSize(9).text(valores[k], x + 4, y + 3, {width: c.w - 8, align: c.a || "left"});
        x += c.w;
      });
      y += altura;
      doc.moveTo(esq, y).lineTo(esq + larg, y).lineWidth(0.5).strokeColor(LINHA).stroke();
    });

    const t = totais(pc);
    if (y > doc.page.height - 130) { doc.addPage(); y = 40; }
    y += 10;
    doc.fillColor(CINZA).font("Helvetica").fontSize(9).text(t.itens + " item(ns) · " + unidades(t.qtd) + " unidades", esq, y, {width: larg / 2});
    doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(15)
        .text(t.valor > 0 ? "Total " + reais(t.valor) : "Sem preço informado", esq + larg / 2, y - 3, {width: larg / 2, align: "right"});
    y += 22;
    if (t.semPreco && t.valor > 0) {
      doc.fillColor("#c2410c").font("Helvetica").fontSize(8.5).text(t.semPreco + " item(ns) sem preço não entram no total.", esq, y, {width: larg, align: "right"});
      y += 14;
    }
    if (pc.observacoes) {
      y += 8;
      doc.fillColor(CINZA).font("Helvetica").fontSize(8).text("OBSERVAÇÕES", esq, y);
      doc.fillColor("#1d1d1f").font("Helvetica").fontSize(9.5).text(paraPdf(pc.observacoes), esq, y + 10, {width: larg});
    }
    doc.fillColor(CINZA).font("Helvetica").fontSize(8)
        .text("Criado por " + texto(pc.criadoPor || "—") + (pc.atualizadoPor ? " · última alteração por " + pc.atualizadoPor : "") + " · Sistema PCP Kuryos",
            esq, doc.page.height - 50, {width: larg, align: "center", lineBreak: false});
    doc.end();
  });
}

module.exports = {paraPdf, destinatarios, deveEnviarCriacao, montarEmail, gerarPdf, totais, URL_GESTAO};
