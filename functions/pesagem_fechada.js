"use strict";
/* E-mail à Qualidade/P&D quando a pesagem do bulk é fechada (2026-09-23).

   Pedido do usuário: com a "Conferência de Pesagem" ligada, a pesagem só é
   conferida pela Qualidade ou pelo P&D -- e "eu preciso que o sistema informe
   a elas de alguma forma que a pesagem foi finalizada, pode ser via email por
   exemplo, igual ocorre da produção" (o aviso de OP encerrada ao PCP,
   op_encerrada.js). Enquanto ninguém confere, a manipulação fica parada.

   "Fechada" = ops/{op}/manipulacao/status passou a PESADO. Destinatários: quem
   pode conferir -- a mesma regra de podeConferirPesagem em auth_check.js --
   mais a lista opcional config/emailConferenciaPesagem. Chave desligada: não
   envia (a conferência volta a ser entre operadores, na própria fábrica).

   Funções puras: o gatilho em index.js só lê, chama e envia. */

const STATUS_FECHADA = "PESADO";
const URL_MANIPULACAO = "https://prod-kuryos.web.app/manipulacao.html";
const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Só na TRANSIÇÃO para PESADO: regravar o status não reenvia.
function deveNotificar(antes, depois) {
  return depois === STATUS_FECHADA && antes !== STATUS_FECHADA;
}

function chaveLigada(config) {
  return !!(config && config.conferenciaPesagem && config.conferenciaPesagem.ativa === true);
}

// Espelho de podeConferirPesagem (auth_check.js): papel Qualidade no padrão
// do perfil, ou a permissão "Conferência de Pesagem" marcada em Usuários.
function podeConferir(user) {
  if (!user || user.role === "pending") return false;
  const temModulos = !!(user.modulos && typeof user.modulos === "object");
  if (user.role === "qualidade" && !temModulos) return true;
  return !!(temModulos && user.modulos.conferencia_pesagem === true);
}

function listaDeEmails(bruto) {
  const lista = Array.isArray(bruto) ? bruto : (typeof bruto === "string" ? bruto.split(/[;,]/) : []);
  return lista.map((e) => String(e || "").trim().toLowerCase()).filter((e) => EMAIL_VALIDO.test(e));
}

function destinatarios(usuarios, config) {
  const dosUsuarios = Object.values(usuarios || {}).filter(podeConferir).map((u) => String(u.email || "").trim().toLowerCase())
      .filter((e) => EMAIL_VALIDO.test(e));
  const extras = listaDeEmails(config && config.emailConferenciaPesagem);
  return [...new Set(dosUsuarios.concat(extras))];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c]));
}
function fmtNum(n) {
  return num(n).toLocaleString("pt-BR", {maximumFractionDigits: 3});
}
function fmtDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"}).format(d);
}
function minutos(inicio, fim) {
  const a = new Date(inicio).getTime(), b = new Date(fim).getTime();
  return (isNaN(a) || isNaN(b) || b < a) ? null : Math.round((b - a) / 60000);
}

// Uma linha por MP: previsto x pesado (o resumo gravado no fechamento).
function linhasDaPesagem(fase) {
  const previstos = (fase && fase.previstos) || {};
  const itens = ((fase && fase.pesagem) || {}).itens || {};
  return Object.keys(previstos).map((k) => {
    const p = previstos[k] || {}, r = itens[k] || {};
    const previsto = num(p.previsto), pesado = num(r.pesado);
    const desvio = previsto > 0 ? Math.round((pesado - previsto) / previsto * 10000) / 100 : null;
    return {codigo: p.mpCodigo || k, nome: p.mpNome || "", unidade: p.unidade || "kg", previsto, pesado,
      lote: r.loteMaterial || "", desvio, justificativa: r.justificativa || "", ordem: p.ordem == null ? 999 : num(p.ordem)};
  }).sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));
}

function montarEmail(op, opKey) {
  op = op || {};
  const fase = op.manipulacao || {};
  const pes = fase.pesagem || {};
  const lote = op.lote || opKey;
  const linhas = linhasDaPesagem(fase);
  const foraTolerancia = linhas.filter((l) => l.desvio != null && Math.abs(l.desvio) > 2);
  const assunto = `⚖️ Pesagem do lote ${lote} fechada — conferir antes da manipulação (${op.produto || "produto não informado"})`;
  const linha = (rotulo, valor) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6e6e73;white-space:nowrap">${esc(rotulo)}</td><td style="padding:4px 0"><strong>${valor}</strong></td></tr>`;
  const dur = minutos(pes.inicio, pes.fim);
  const tabela = linhas.length ? `
      <table style="border-collapse:collapse;font-size:13px;margin-top:14px;width:100%">
        <tr style="background:#f5f5f7"><th style="text-align:left;padding:6px">Matéria-prima</th><th style="text-align:right;padding:6px">Previsto</th><th style="text-align:right;padding:6px">Pesado</th><th style="text-align:left;padding:6px">Lote</th></tr>
        ${linhas.map((l) => `<tr>
          <td style="padding:6px;border-top:1px solid #e5e5ea">${esc(l.codigo)}<div style="color:#6e6e73;font-size:12px">${esc(l.nome)}</div></td>
          <td style="padding:6px;border-top:1px solid #e5e5ea;text-align:right">${fmtNum(l.previsto)} ${esc(l.unidade)}</td>
          <td style="padding:6px;border-top:1px solid #e5e5ea;text-align:right${l.desvio != null && Math.abs(l.desvio) > 2 ? ";color:#c9910a;font-weight:700" : ""}">${fmtNum(l.pesado)} ${esc(l.unidade)}${l.desvio ? ` <span style="font-size:11px">(${l.desvio > 0 ? "+" : ""}${String(l.desvio).replace(".", ",")}%)</span>` : ""}</td>
          <td style="padding:6px;border-top:1px solid #e5e5ea">${esc(l.lote || "—")}</td></tr>`).join("")}
      </table>` : "";
  const avisoTolerancia = foraTolerancia.length
    ? `<p style="margin:12px 0 0;color:#c9910a"><strong>Fora da tolerância de 2%:</strong> ${foraTolerancia.map((l) => esc(l.codigo) + (l.justificativa ? " — " + esc(l.justificativa) : "")).join("; ")}</p>`
    : "";
  const corpo = `
    <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d1d1f;max-width:680px">
      <h2 style="margin:0 0 4px">Pesagem do lote ${esc(lote)} pronta para conferência</h2>
      <p style="margin:0 0 14px;color:#6e6e73">A Conferência de Pesagem está ligada: a manipulação deste lote só começa depois que a Qualidade ou o P&amp;D conferir, com o próprio login, na tela da Manipulação.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${linha("Produto", esc(op.produto || "—") + (op.sku ? " <span style=\"color:#6e6e73\">(" + esc(op.sku) + ")</span>" : ""))}
        ${linha("Cliente", esc(op.cliente || "—"))}
        ${linha("Pesado por", esc(pes.por || "—"))}
        ${linha("Pesagem fechada em", esc(fmtDataHora(pes.fim)))}
        ${dur != null ? linha("Tempo de pesagem", dur + " min") : ""}
      </table>
      ${tabela}
      ${avisoTolerancia}
      <p style="margin:20px 0">
        <a href="${URL_MANIPULACAO}" style="background:#0a1c69;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600">Abrir a Manipulação e conferir</a>
      </p>
      <p style="color:#6e6e73;font-size:12px;margin-top:20px">Sistema PCP Kuryos — aviso automático da Conferência de Pesagem. Você recebe porque tem a permissão "Conferência de Pesagem" em Usuários.</p>
    </div>
  `;
  return {assunto, corpo, resumo: {lote, produto: op.produto || null, itens: linhas.length, foraTolerancia: foraTolerancia.length}};
}

module.exports = {STATUS_FECHADA, URL_MANIPULACAO, deveNotificar, chaveLigada, podeConferir, destinatarios, linhasDaPesagem, montarEmail};
