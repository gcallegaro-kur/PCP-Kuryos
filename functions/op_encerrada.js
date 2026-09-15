"use strict";
/* E-mail ao PCP quando a produção encerra uma OP (2026-09-15).

   Pedido do usuário: "enviar email toda vez que uma OP for encerrada, para
   que o PCP se mobilize para confirmar a OP (pcp@kuryos.com.br)".

   "Encerrada" = status passou a "Aguardando Confirmação". Desde a Fase 7 do
   PLANO_PLANEJAMENTO_PCP.md nenhum fluxo de produção grava "Concluído": o
   operador fecha (Encerrar OP / apontamento por total com aguardarConfirmacao)
   ou a OP bate ~95% da meta (computeOpStatus), e ela fica parada nesse status
   até o PCP conferir e confirmar em ops.html. É exatamente essa espera que o
   e-mail existe para encurtar -- enquanto a OP não é confirmada, a Conferência
   de PA fica bloqueada (estoque.html) e o produto não entra em estoque.

   Funções puras: o gatilho em index.js só lê, chama e envia. */

const STATUS_ENCERRADA = "Aguardando Confirmação";
const DESTINATARIOS_PADRAO = ["pcp@kuryos.com.br"];
const URL_OPS = "https://prod-kuryos.web.app/ops.html";

// Dispara só na TRANSIÇÃO para o status. Regravar o mesmo status (turno
// encerrado, correção de total, nó inteiro reescrito) não reenvia.
function deveNotificar(antes, depois) {
  return depois === STATUS_ENCERRADA && antes !== STATUS_ENCERRADA;
}

// config/emailConfirmacaoOp (lista ou texto separado por vírgula/;)
// substitui o padrão; vazio ou inválido cai no padrão.
function destinatarios(config) {
  const bruto = config && config.emailConfirmacaoOp;
  const lista = Array.isArray(bruto) ? bruto : (typeof bruto === "string" ? bruto.split(/[;,]/) : []);
  const validos = lista.map((e) => String(e || "").trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  return validos.length ? [...new Set(validos)] : DESTINATARIOS_PADRAO.slice();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c]));
}
function fmtNum(n) {
  return num(n).toLocaleString("pt-BR", {maximumFractionDigits: 2});
}
function fmtDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"}).format(d);
}
// Data local (BRT) no formato de registros/{AAAA-MM-DD}.
function dataLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {timeZone: "America/Sao_Paulo"}).format(d);
}

// O registro de fechamento do operador traz o que o PCP precisa para
// confirmar sem abrir outra tela: justificativa de divergência e perdas.
// Pega o fechamento_op mais recente DESTA OP no dia.
function fechamentoDaOp(registrosDoDia, lote) {
  const lista = Object.values(registrosDoDia || {})
      .filter((r) => r && r.tipo === "fechamento_op" && r.lote === lote);
  if (!lista.length) return null;
  return lista.reduce((a, b) => (String(a.timestamp || "") >= String(b.timestamp || "") ? a : b));
}

function montarEmail(op, opKey, fechamento) {
  op = op || {};
  const lote = op.lote || opKey;
  const planejado = num(op.qtdPlanejada);
  const produzido = op.produzidoLinha != null ? num(op.produzidoLinha) : num(op.produzido);
  const rotulagem = num(op.produzidoRotulagem);
  const pct = planejado > 0 ? Math.round((produzido / planejado) * 1000) / 10 : null;
  const diferenca = planejado > 0 ? produzido - planejado : null;
  const abaixo = diferenca != null && diferenca < 0;

  const assunto = `✅ OP ${lote} encerrada — confirmar no PCP (${op.produto || "produto não informado"})`;

  const linha = (rotulo, valor) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6e6e73;white-space:nowrap">${esc(rotulo)}</td><td style="padding:4px 0"><strong>${valor}</strong></td></tr>`;
  let resultado = "—";
  if (planejado > 0) {
    resultado = `${fmtNum(produzido)} de ${fmtNum(planejado)} un. (${String(pct).replace(".", ",")}%)`;
    if (abaixo) resultado += ` <span style="color:#d03b3b">— faltaram ${fmtNum(-diferenca)} un.</span>`;
    else if (diferenca > 0) resultado += ` <span style="color:#c9910a">— ${fmtNum(diferenca)} un. acima do planejado</span>`;
  } else if (produzido > 0) {
    resultado = `${fmtNum(produzido)} un. (sem quantidade planejada na OP)`;
  }

  const blocos = [];
  if (fechamento && fechamento.justificativaDivergencia) {
    blocos.push(`<p style="margin:12px 0 0"><strong>Justificativa do operador:</strong> ${esc(fechamento.justificativaDivergencia)}</p>`);
  }
  const perdas = (fechamento && Array.isArray(fechamento.perdas)) ? fechamento.perdas.filter((p) => p && num(p.quantidade) > 0) : [];
  if (perdas.length) {
    blocos.push(`<p style="margin:12px 0 4px"><strong>Perdas informadas no fechamento:</strong></p><ul style="margin:0;padding-left:20px">` +
      perdas.map((p) => `<li>${fmtNum(p.quantidade)} — ${esc(p.tipo || "Outro")}${p.especificacao ? ": " + esc(p.especificacao) : ""}</li>`).join("") + `</ul>`);
  }

  const corpo = `
    <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d1d1f;max-width:640px">
      <h2 style="margin:0 0 4px">OP ${esc(lote)} encerrada pela produção</h2>
      <p style="margin:0 0 14px;color:#6e6e73">A OP está em <strong>Aguardando Confirmação</strong>. Enquanto o PCP não confirmar, a Conferência de PA fica bloqueada e o produto não entra em estoque.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${linha("Produto", esc(op.produto || "—") + (op.sku ? " <span style=\"color:#6e6e73\">(" + esc(op.sku) + ")</span>" : ""))}
        ${linha("Cliente", esc(op.cliente || "—"))}
        ${linha("Linha", esc(op.linha || (fechamento && fechamento.linha) || "—"))}
        ${linha("Envase", resultado)}
        ${rotulagem > 0 ? linha("Rotulagem", fmtNum(rotulagem) + " un.") : ""}
        ${linha("Início real", esc(fmtDataHora(op.dataInicioReal)))}
        ${linha("Fim real", esc(fmtDataHora(op.dataFimReal)))}
      </table>
      ${blocos.join("")}
      <p style="margin:20px 0">
        <a href="${URL_OPS}" style="background:#0a1c69;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600">Abrir Controle de OPs</a>
      </p>
      <p style="color:#6e6e73;font-size:12px;margin-top:20px">Sistema PCP Kuryos — aviso automático de OP encerrada. Confira as quantidades e confirme a OP na fila "Aguardando Confirmação do PCP".</p>
    </div>
  `;
  return {assunto, corpo, resumo: {lote, produto: op.produto || null, planejado, produzido, pct}};
}

module.exports = {STATUS_ENCERRADA, DESTINATARIOS_PADRAO, URL_OPS, deveNotificar, destinatarios, fechamentoDaOp, montarEmail, dataLocal};
