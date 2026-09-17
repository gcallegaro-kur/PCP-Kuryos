"use strict";
/* E-mail + PDF da solicitação de faturamento da carga (2026-09-17).
   Para o Financeiro (config/emailFinanceiro), cópia à diretoria
   (config/emailDiretoria). Sem Financeiro configurado não envia: registra
   SEM_DESTINATARIOS -- adivinhar endereço para dado fiscal seria pior. */

const PDFDocument = require("pdfkit");
const {destinatarios: listaEmails} = require("./pedido_diretoria");

const AZUL = "#0a1c69", CINZA = "#6e6e73", LINHA = "#d2d2d7";
const URL_EXPEDICAO = "https://prod-kuryos.web.app/expedicao.html";

function texto(v) { return v == null ? "" : String(v); }
function n(v) { const x = Number(v); return isFinite(x) ? x : 0; }
function dataBr(d) { return /^\d{4}-\d{2}-\d{2}/.test(texto(d)) ? texto(d).slice(0, 10).split("-").reverse().join("/") : "—"; }
function un(v) { return Math.round(n(v)).toLocaleString("pt-BR"); }
function reais(v) { return n(v).toLocaleString("pt-BR", {style: "currency", currency: "BRL"}); }
function kg(v) { return n(v) ? n(v).toLocaleString("pt-BR", {maximumFractionDigits: 1}) + " kg" : "—"; }
function paraPdf(s) { return texto(s).replace(/→/g, "->").replace(/[“”]/g, "\"").replace(/[‘’]/g, "'"); }
function escHtml(s) { return texto(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c])); }

function destinatarios(config) {
  config = config || {};
  const para = listaEmails({emailDiretoria: config.emailFinanceiro});
  const copia = listaEmails({emailDiretoria: config.emailDiretoria}).filter((e) => !para.includes(e));
  return {para, copia};
}

function composicao(i) {
  const partes = [];
  if (n(i.caixas)) partes.push(un(i.caixas) + " cx x " + un(i.unidadesPorCaixa));
  if (n(i.caixaParcial)) partes.push("1 parcial c/ " + un(i.caixaParcial));
  return partes.join(" + ") || "—";
}

function montarEmail(s, agendaKey) {
  const pedidos = [...new Set((s.itens || []).map((i) => i.pedidoNumero + (i.numeroPedidoCliente ? " (cliente " + i.numeroPedidoCliente + ")" : "")).filter(Boolean))];
  const assunto = "Solicitação de faturamento: " + texto(s.cliente) + " — " + (s.tipo === "COLETA" ? "coleta" : "entrega") + " " + dataBr(s.dataAgendada) +
    " — " + un(s.totalUnidades) + " un";
  const linhas = (s.itens || []).map((i) => "<tr>" + [i.pedidoNumero + (i.numeroPedidoCliente ? "<br><span style=\"color:#6e6e73\">cliente " + escHtml(i.numeroPedidoCliente) + "</span>" : ""),
    escHtml(i.sku) + "<br><span style=\"color:#6e6e73\">" + escHtml(i.descricao) + "</span>", escHtml(i.lote) + "<br><span style=\"color:#6e6e73\">val. " + dataBr(i.validade) + "</span>",
    escHtml(composicao(i)), un(i.unidades), i.precoUnitario ? reais(i.precoUnitario) : "<b style=\"color:#c2410c\">sem preço</b>", i.precoUnitario ? reais(i.valor) : "—"]
    .map((c, k) => "<td style=\"padding:6px 8px;border-bottom:1px solid #eee;" + (k >= 4 ? "text-align:right;" : "") + "\">" + c + "</td>").join("") + "</tr>").join("");
  const corpo = "<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d1d1f;max-width:760px\">" +
    "<p>A Logística solicita o faturamento da carga abaixo. O PDF com o detalhe por palete está em anexo.</p>" +
    "<table style=\"border-collapse:collapse;font-size:14px;margin-bottom:12px\">" +
    [["Cliente", s.cliente], ["Pedido(s)", pedidos.join(", ") || "—"], [s.tipo === "COLETA" ? "Coleta (FOB)" : "Entrega (CIF)", dataBr(s.dataAgendada) + (s.janela ? " · " + s.janela : "")],
      ["Destino", s.enderecoEntrega || "—"], ["Transportadora", s.transportadora || "—"],
      ["Total", un(s.totalUnidades) + " un · " + kg(s.totalPesoKg) + " · " + (s.totalValor ? reais(s.totalValor) : "sem preço")],
      ["Solicitado por", s.por + " em " + new Date(s.em).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"})]]
        .map((r) => "<tr><td style=\"padding:3px 12px 3px 0;color:#6e6e73\">" + escHtml(r[0]) + "</td><td><b>" + escHtml(r[1]) + "</b></td></tr>").join("") + "</table>" +
    (s.itensSemPreco ? "<p style=\"color:#c2410c\"><b>" + s.itensSemPreco + " item(ns) sem preço no pedido.</b> Confirme o valor com o Comercial antes de emitir.</p>" : "") +
    (s.observacoes ? "<p><b>Observações:</b> " + escHtml(s.observacoes) + "</p>" : "") +
    "<table style=\"border-collapse:collapse;font-size:13px;width:100%\"><thead><tr>" +
    ["Pedido", "Produto", "Lote / validade", "Caixas", "Unidades", "Preço un.", "Valor"].map((h, k) => "<th style=\"text-align:" + (k >= 4 ? "right" : "left") + ";padding:6px 8px;background:#f5f5f7;color:#6e6e73;font-size:11px\">" + h + "</th>").join("") +
    "</tr></thead><tbody>" + linhas + "</tbody></table>" +
    "<p style=\"margin-top:16px\">Depois de emitida, registre a NF na carga em <a href=\"" + URL_EXPEDICAO + "\">Expedição de Vendas</a>. Se parte da carga não couber no veículo, o saldo segue na próxima viagem com a mesma NF.</p>" +
    "<p style=\"color:#6e6e73;font-size:12px\">E-mail automático do sistema PCP Kuryos · carga " + escHtml(agendaKey) + "</p></div>";
  const arquivo = "Faturamento " + texto(s.cliente).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + " " + texto(s.dataAgendada) + ".pdf";
  return {assunto, corpo, arquivo};
}

function gerarPdf(s, agendaKey) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({size: "A4", layout: "landscape", margin: 36, info: {Title: "Solicitação de faturamento", Author: "Kuryos"}});
    const partes = [];
    doc.on("data", (b) => partes.push(b));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    const esq = 36, larg = doc.page.width - 72;
    doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(20).text("KURYOS", esq, 32);
    doc.fillColor(CINZA).font("Helvetica").fontSize(9).text("Solicitação de faturamento de carga", esq, 56);
    doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(14).text(paraPdf(s.cliente), esq, 32, {width: larg, align: "right"});
    doc.fillColor(CINZA).font("Helvetica").fontSize(9).text((s.tipo === "COLETA" ? "Coleta FOB " : "Entrega CIF ") + dataBr(s.dataAgendada) + (s.janela ? " · " + paraPdf(s.janela) : "") +
      " · solicitado por " + paraPdf(s.por) + " em " + new Date(s.em).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo"}), esq, 50, {width: larg, align: "right"});
    doc.moveTo(esq, 72).lineTo(esq + larg, 72).lineWidth(2).strokeColor(AZUL).stroke();
    let y = 80;
    doc.fillColor("#1d1d1f").font("Helvetica").fontSize(9.5)
        .text("Destino: " + paraPdf(s.enderecoEntrega || "—") + "     Transportadora: " + paraPdf(s.transportadora || "—"), esq, y, {width: larg});
    y = doc.y + 8;
    const cols = [{t: "Pedido", w: 90}, {t: "Nº cliente", w: 60}, {t: "SKU", w: 70}, {t: "Produto", w: 0}, {t: "Lote", w: 70}, {t: "Validade", w: 58},
      {t: "Palete", w: 90}, {t: "Caixas", w: 90}, {t: "Unid.", w: 55, a: "right"}, {t: "Peso", w: 55, a: "right"}, {t: "Preço un.", w: 60, a: "right"}, {t: "Valor", w: 70, a: "right"}];
    cols[3].w = larg - cols.reduce((t, c) => t + c.w, 0);
    const cab = () => {
      doc.rect(esq, y, larg, 16).fill("#f5f5f7");
      let x = esq;
      cols.forEach((c) => { doc.fillColor(CINZA).font("Helvetica-Bold").fontSize(7.5).text(c.t.toUpperCase(), x + 3, y + 4, {width: c.w - 6, align: c.a || "left"}); x += c.w; });
      y += 18;
    };
    cab();
    (s.itens || []).forEach((i) => {
      const v = [i.pedidoNumero, i.numeroPedidoCliente || "—", i.sku, i.descricao, i.lote || "—", dataBr(i.validade), i.identificadorPalete, composicao(i),
        un(i.unidades), kg(i.pesoKg), i.precoUnitario ? reais(i.precoUnitario) : "SEM PREÇO", i.precoUnitario ? reais(i.valor) : "—"].map(paraPdf);
      const h = Math.max(12, doc.font("Helvetica").fontSize(8.5).heightOfString(v[3], {width: cols[3].w - 6})) + 5;
      if (y + h > doc.page.height - 70) { doc.addPage(); y = 36; cab(); }
      let x = esq;
      cols.forEach((c, k) => { doc.fillColor(k === 10 && !i.precoUnitario ? "#c2410c" : "#1d1d1f").font("Helvetica").fontSize(8.5).text(v[k], x + 3, y + 2, {width: c.w - 6, align: c.a || "left"}); x += c.w; });
      y += h;
      doc.moveTo(esq, y).lineTo(esq + larg, y).lineWidth(0.5).strokeColor(LINHA).stroke();
    });
    if (y > doc.page.height - 90) { doc.addPage(); y = 36; }
    y += 8;
    doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(12)
        .text("Total: " + un(s.totalUnidades) + " un · " + kg(s.totalPesoKg) + " · " + (s.totalValor ? reais(s.totalValor) : "sem preço"), esq, y, {width: larg, align: "right"});
    y = doc.y + 4;
    if (s.itensSemPreco) { doc.fillColor("#c2410c").font("Helvetica").fontSize(9).text(s.itensSemPreco + " item(ns) sem preço no pedido: confirmar com o Comercial.", esq, y, {width: larg, align: "right"}); y = doc.y + 4; }
    if (s.observacoes) { doc.fillColor("#1d1d1f").font("Helvetica").fontSize(9.5).text("Observações: " + paraPdf(s.observacoes), esq, y + 4, {width: larg}); }
    doc.fillColor(CINZA).font("Helvetica").fontSize(7.5).text("Carga " + agendaKey + " · Sistema PCP Kuryos", esq, doc.page.height - 44, {width: larg, align: "center", lineBreak: false});
    doc.end();
  });
}

module.exports = {destinatarios, montarEmail, gerarPdf, composicao};
