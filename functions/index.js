const {onRequest, onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onValueCreated} = require("firebase-functions/v2/database");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

const OPS_API_KEY = defineSecret("OPS_API_KEY");
const PEDIDOS_API_KEY = defineSecret("PEDIDOS_API_KEY");
const MS_GRAPH_TENANT_ID = defineSecret("MS_GRAPH_TENANT_ID");
const MS_GRAPH_CLIENT_ID = defineSecret("MS_GRAPH_CLIENT_ID");
const MS_GRAPH_CLIENT_SECRET = defineSecret("MS_GRAPH_CLIENT_SECRET");
const MS_GRAPH_SENDER_EMAIL = defineSecret("MS_GRAPH_SENDER_EMAIL");

// Mesma regra usada no resto do sistema (shared/utils.js, sanitizeKey) —
// tem que produzir exatamente a mesma chave, senão os registros divergem
// dos que o app já tem.
function sanitizeKey(val) {
  let s = String(val || "").trim();
  s = s.replace(/[./[\]#$]/g, "-");
  s = s.replace(/\s+/g, "_");
  return s.slice(0, 60);
}

function checkApiKey(req, res, expected) {
  const provided = (req.get("x-api-key") || "").trim();
  if (!provided || provided !== String(expected || "").trim()) {
    res.status(401).json({ok: false, error: "x-api-key ausente ou inválido"});
    return false;
  }
  return true;
}

function sendError(res, status, msg) {
  res.status(status).json({ok: false, error: msg});
}

// Campos de "ficha técnica/comercial" que a planilha (Gerador de OPs) é
// dona -- só esses são sobrescritos aqui. Tudo que só o app calcula ou o
// time edita direto em produtos.html (prodHoraRef, categoria, cq,
// viscosidade, subcategoria, ean13/dum14, etc.) nunca é tocado por esta
// sincronização -- é update() de campos específicos, nunca um set() do
// nó inteiro.
const PRODUTO_CATALOG_FIELDS = [
  "codCliente", "volume", "unCx", "prazoValidadeMeses",
  "overfillPct", "perdaLinhaPct", "perdaProcessoPct",
  "densidadeGranel", "capacidadeReatorL", "ativo",
];

// Mantém produtos/{sku} em dia toda vez que uma OP é emitida -- sem exigir
// um botão/fluxo separado no Gerador de OPs para "sincronizar produtos".
// sku/produto/cliente já são obrigatórios em toda chamada de criarOP, então
// descricao/cliente ficam sempre atualizados de graça; produtoInfo (opcional)
// carrega o resto da ficha técnica quando a planilha tiver esses dados.
async function syncProdutoFromOP(sku, produto, cliente, produtoInfo) {
  const key = sanitizeKey(sku);
  const ref = db.ref("produtos/" + key);
  const existingSnap = await ref.once("value");
  const isNew = !existingSnap.exists();

  const updates = {
    sku: String(sku),
    descricao: String(produto),
    cliente: String(cliente),
  };
  if (isNew) updates.ativo = "Ativo";

  if (produtoInfo && typeof produtoInfo === "object") {
    for (const field of PRODUTO_CATALOG_FIELDS) {
      const val = produtoInfo[field];
      if (val !== undefined && val !== null && val !== "") updates[field] = val;
    }
  }

  await ref.update(updates);
}

// Fecha o ciclo do horizonte rolante: quando uma OP real é emitida pro mesmo
// pedidoKey de um bloco já "congelado" (zona congelada de horizonte.html,
// aguardando emissão), vincula os dois -- a partir daí autoAjustarPlanejamento
// (auth_check.js) para de mexer nesse slot, porque virou compromisso real.
//
// Vínculo por identificação, não por suposição: cada alocação "congelada" tem
// um código de exibição derivado do seu próprio ID (últimos 6 caracteres,
// "NEC-XXXXXX", ver horizonte.html/renderNecessidades) -- se o Gerador de OPs
// mandar esse código em `necessidadeCodigo`, o vínculo é exato. Só cai no
// fallback de "quantidade mais próxima" (comportamento antigo, impreciso)
// quando NENHUM código é informado -- caso de uma OP emitida sem passar pela
// lista de Necessidades de Emissão. Se um código É informado mas não bate
// com nada, não adivinha por quantidade em cima disso -- fica sem vincular e
// loga o erro, pra não mascarar um vínculo errado atrás de um código que
// parecia preciso e não era.
// Fase 6 do plano (PLANO_PLANEJAMENTO_PCP.md): achado do usuário ao
// revisar o mockup -- um pedido comercial planejado por quantidade
// (ex: 10.000 un.) na prática vira N OPs emitidas (ex: 10 de 1.000),
// não 1. A versão anterior desta função tratava cada alocação como
// vínculo BINÁRIO (1 alocação = no máximo 1 OP, "opLote" + status
// vira 'vinculado' e nunca mais aceita outra) -- a 2a OP emitida contra
// o mesmo bloco de 10.000 não achava mais nenhuma alocação 'congelado'
// disponível (a única já virou 'vinculado' pela 1a) e ficava sem vínculo.
// Agora cada alocação é consumida aos poucos: "congelado" enquanto
// sobrar capacidade (qtd - qtdConsumida > 0), só vira "vinculado" quando
// a soma das OPs emitidas contra ela fecha o total. `opsVinculadas` (mapa
// loteKey -> {lote,qtd,vinculadoEm}) substitui o antigo campo único
// `opLote` -- ver cancelOp (ops.html) e _syncOpsLoteStatusELinha/
// autoAjustarPlanejamento (auth_check.js), que precisaram do mesmo ajuste.
async function linkAlocacaoToOP(skuPedidoKey, lote, qtdPlanejada, necessidadeCodigo) {
  if (!skuPedidoKey) return;
  const snap = await db.ref("alocacoes_planejamento")
      .orderByChild("pedidoKey").equalTo(skuPedidoKey).once("value");
  const alocacoes = snap.val() || {};
  let bestId = null;
  let vinculoPreciso = false;

  function capacidadeRestante(aloc) {
    return (aloc.qtd || 0) - (aloc.qtdConsumida || 0);
  }

  if (necessidadeCodigo) {
    const codigoNorm = String(necessidadeCodigo).trim().toUpperCase();
    for (const [id, aloc] of Object.entries(alocacoes)) {
      if (!aloc || aloc.status !== "congelado" || capacidadeRestante(aloc) <= 0) continue;
      const derivedCodigo = "NEC-" + id.slice(-6).toUpperCase();
      if (derivedCodigo === codigoNorm) {
        bestId = id;
        vinculoPreciso = true;
        break;
      }
    }
    if (!bestId) {
      console.error("necessidadeCodigo '" + necessidadeCodigo + "' informado pra OP " + lote +
        " não bateu com nenhuma alocação congelada com capacidade restante de " + skuPedidoKey +
        " -- não vinculado, pra não adivinhar errado.");
      return;
    }
  } else {
    let bestDiff = Infinity;
    for (const [id, aloc] of Object.entries(alocacoes)) {
      if (!aloc || aloc.status !== "congelado" || capacidadeRestante(aloc) <= 0) continue;
      const diff = Math.abs(capacidadeRestante(aloc) - qtdPlanejada);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestId = id;
      }
    }
    if (!bestId) return;
  }

  const aloc = alocacoes[bestId];
  const loteKeySafe = sanitizeKey(lote);
  const novaQtdConsumida = (aloc.qtdConsumida || 0) + qtdPlanejada;
  const novoStatus = novaQtdConsumida >= (aloc.qtd || 0) ? "vinculado" : "congelado";
  const updates = {};
  updates["opsVinculadas/" + loteKeySafe] = {lote: lote, qtd: qtdPlanejada, vinculadoEm: new Date().toISOString()};
  updates.qtdConsumida = novaQtdConsumida;
  updates.status = novoStatus;
  if (vinculoPreciso) updates.vinculoPreciso = true;
  await db.ref("alocacoes_planejamento/" + bestId).update(updates);

  // Grava o lote direto nos slots horários que essa OP cobre (só até a
  // quantidade DESSA OP, não a alocação inteira -- sem isso, a 1a OP de
  // um bloco de 10 "roubaria" visualmente os slots das outras 9) -- sem
  // isso, a Grade Semanal (planejamento.html) tinha que adivinhar por FIFO
  // qual OP corresponde a cada hora (buildWeekLoteAssignment/exactLoteForSlot).
  // Best-effort: se der errado, a alocação já está vinculada, o pior caso é
  // a Grade continuar caindo no fallback de adivinhação pra essa semana.
  try {
    await writeLoteIntoWeekSlots(skuPedidoKey, aloc.semanaISO, aloc.linha, lote, qtdPlanejada);
  } catch (e) {
    console.error("Falha ao gravar lote nos slots de programacao pro lote " + lote + ":", e);
  }
}

// qtdAlvo (Fase 6, achado do usuário: "1 pedido vira N OPs"): quando
// passado, para de preencher slots assim que a soma de mediaPorHora dos
// slots já marcados (o mesmo ritmo com que cada slot foi originalmente
// programado) cobrir a quantidade dessa OP específica -- sem isso, a 1a
// OP emitida contra um bloco de 10.000un/10 OPs "roubaria" visualmente
// TODOS os slots restantes do bloco inteiro, sobrando nada pras próximas
// 9. Omitir qtdAlvo preenche tudo que sobrar (comportamento antigo,
// ainda correto pro caso de 1 alocação = 1 OP só).
async function writeLoteIntoWeekSlots(pedidoKey, semanaISO, linhaNome, lote, qtdAlvo) {
  if (!semanaISO || !linhaNome) return;
  const linhasSnap = await db.ref("config/linhas").once("value");
  const linhas = linhasSnap.val() || [];
  const linhaIdx = linhas.indexOf(linhaNome);
  if (linhaIdx < 0) return;
  const slotKey = "env" + (linhaIdx + 1);

  const weekStart = new Date(semanaISO + "T12:00:00");
  const updates = {};
  let qtdCoberta = 0;
  for (let d = 0; d < 7 && (qtdAlvo == null || qtdCoberta < qtdAlvo); d++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + d);
    const ymd = day.toISOString().split("T")[0];
    const daySnap = await db.ref("programacao/" + ymd).once("value");
    const dayData = daySnap.val() || {};
    // Ordem cronológica dentro do dia (chaves tipo "07_00") -- cobre as
    // horas mais cedo primeiro, mesma ordem em que a produção acontece.
    const hourKeys = Object.keys(dayData).sort();
    for (const hourKey of hourKeys) {
      if (qtdAlvo != null && qtdCoberta >= qtdAlvo) break;
      const slot = (dayData[hourKey] || {})[slotKey];
      if (slot && slot.pedidoKey === pedidoKey && !slot.lote) {
        updates["programacao/" + ymd + "/" + hourKey + "/" + slotKey + "/lote"] = lote;
        qtdCoberta += (slot.mediaPorHora || 0);
      }
    }
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
}

// ── POST /criarOP ────────────────────────────────────────────────────
// Chamado pelo Gerador de OPs (VBA) logo após RegistrarOP, dentro de
// GerarOP_PDF. Cria ou atualiza uma OP em ops/{lote}, preservando os campos
// que só o app/operação controla (linha, produzido, status, paradas, perdas)
// se a OP já existir — mesmo padrão que op_watcher.py já usava.
exports.criarOP = onRequest({secrets: [OPS_API_KEY], cors: false}, async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Use POST");
  if (!checkApiKey(req, res, OPS_API_KEY.value())) return;

  const body = req.body || {};
  const required = ["lote", "sku", "produto", "cliente", "qtdPlanejada"];
  const missing = required.filter((k) => body[k] === undefined || body[k] === null || body[k] === "");
  if (missing.length) {
    return sendError(res, 400, "Campos obrigatórios faltando: " + missing.join(", "));
  }

  const loteKey = sanitizeKey(body.lote);
  const skuPedidoKey = body.pedidoComercialId
    ? sanitizeKey(body.pedidoComercialId) + "__" + sanitizeKey(body.sku)
    : "";

  const ref = db.ref("ops/" + loteKey);
  const existingSnap = await ref.once("value");
  const existing = existingSnap.val() || {};

  const data = {
    lote: String(body.lote),
    skuPedidoKey: skuPedidoKey || existing.skuPedidoKey || "",
    sku: String(body.sku),
    produto: String(body.produto),
    cliente: String(body.cliente),
    qtdPlanejada: Number(body.qtdPlanejada) || 0,
    // Campos que só o app atualiza depois (apontamentos, admin) -- preserva
    // se já existirem, nunca reseta numa reemissão da mesma OP. O .set()
    // abaixo substitui o nó inteiro, então qualquer campo omitido aqui
    // desaparece -- abertaDesde(Rot)/abertaLinha/abertaRotulagem e
    // setupInicio(Rot)/setupFim(Rot) (form.html, Linha e Rotulagem têm
    // estado de abertura independente) e cancelado* (ops.html, cancelOp)
    // são críticos: sem preservar, uma OP já alocada ou já cancelada
    // "reabriria"/"descancelaria" silenciosamente numa reemissão.
    linha: existing.linha || "",
    // Linha/Rotulagem/Posto são somatórias sempre distintas (nunca soma) --
    // produzido legado fica de espelho de produzidoLinha, ver
    // campoProduzido/getProduzido em public/shared/utils.js.
    produzidoLinha: existing.produzidoLinha || 0,
    produzidoRotulagem: existing.produzidoRotulagem || 0,
    produzidoPosto: existing.produzidoPosto || 0,
    produzido: existing.produzido || 0,
    status: existing.status || "Não Iniciado",
    dataInicioReal: existing.dataInicioReal || null,
    dataFimReal: existing.dataFimReal || null,
    dataInicioPlanejada: existing.dataInicioPlanejada || null,
    dataFimPlanejada: existing.dataFimPlanejada || null,
    mediaPorHora: existing.mediaPorHora || 0,
    paradas: existing.paradas || [],
    perdas: existing.perdas || {},
    abertaDesde: existing.abertaDesde || null,
    abertaLinha: existing.abertaLinha || null,
    abertaDesdeRot: existing.abertaDesdeRot || null,
    abertaRotulagem: existing.abertaRotulagem || null,
    setupInicio: existing.setupInicio || null,
    setupFim: existing.setupFim || null,
    setupInicioRot: existing.setupInicioRot || null,
    setupFimRot: existing.setupFimRot || null,
    canceladoEm: existing.canceladoEm || null,
    canceladoPor: existing.canceladoPor || null,
    motivoCancelamento: existing.motivoCancelamento || null,
    // Metadados de emissão (novos a cada chamada)
    dataEmissao: body.dataEmissao || new Date().toISOString(),
    emitidoPor: body.emitidoPor || "",
    arquivoPdf: body.arquivoPdf || "",
    arquivoXlsx: body.arquivoXlsx || "",
  };

  await ref.set(data);

  // Sincroniza produtos/{sku} de graça a cada emissão -- não deixa a criação
  // da OP falhar se isso der errado, é um enriquecimento, não o core da ação.
  try {
    await syncProdutoFromOP(body.sku, body.produto, body.cliente, body.produtoInfo);
  } catch (e) {
    console.error("Falha ao sincronizar produtos/" + sanitizeKey(body.sku) + ":", e);
  }

  // Vincula a um bloco congelado do horizonte rolante, se houver -- também
  // um enriquecimento best-effort, não trava a emissão da OP se der errado.
  try {
    await linkAlocacaoToOP(data.skuPedidoKey, data.lote, data.qtdPlanejada, body.necessidadeCodigo);
  } catch (e) {
    console.error("Falha ao vincular alocacoes_planejamento pro lote " + data.lote + ":", e);
  }

  // Notificação por e-mail: quem manda de fato é o daemon já existente
  // (email_notifications_daemon.py, via Outlook local) -- uma Cloud Function
  // não tem acesso a um Outlook instalado, então só deixamos o aviso na fila
  // que o daemon já varre a cada 2 min.
  if (!existingSnap.exists()) {
    await db.ref("alertas_pendentes").push({
      tipo: "op_emitida",
      timestamp: new Date().toISOString(),
      lote: data.lote,
      sku: data.sku,
      produto: data.produto,
      cliente: data.cliente,
      qtdPlanejada: data.qtdPlanejada,
      pedidoComercialId: body.pedidoComercialId || "",
      emitidoPor: data.emitidoPor,
    });
  }

  res.status(200).json({ok: true, loteKey: loteKey, isNew: !existingSnap.exists()});
});

// ── POST /criarPedido ────────────────────────────────────────────────
// Chamado pelo Gerador de Pedidos (VBA). Cria/atualiza um pedido comercial
// em pedidos_comerciais/{id} e um registro por SKU em pedidos/{id__sku},
// preservando produzido/status/checklist dos itens que já existirem.
exports.criarPedido = onRequest({secrets: [PEDIDOS_API_KEY], cors: false}, async (req, res) => {
  if (req.method !== "POST") return sendError(res, 405, "Use POST");
  if (!checkApiKey(req, res, PEDIDOS_API_KEY.value())) return;

  const body = req.body || {};
  if (!body.pedidoId || !body.cliente || !Array.isArray(body.itens) || !body.itens.length) {
    return sendError(res, 400, "Campos obrigatórios: pedidoId, cliente, itens[] (não vazio)");
  }
  for (const it of body.itens) {
    if (!it.sku || !it.descricao || it.qtd === undefined) {
      return sendError(res, 400, "Cada item precisa de sku, descricao e qtd");
    }
  }

  const parentKey = sanitizeKey(body.pedidoId);
  const totalQtd = body.itens.reduce((s, it) => s + (Number(it.qtd) || 0), 0);

  await db.ref("pedidos_comerciais/" + parentKey).set({
    cliente: String(body.cliente),
    dataPedido: body.dataPedido || null,
    itens: body.itens.map((it) => ({
      sku: String(it.sku),
      descricao: String(it.descricao),
      qtd: Number(it.qtd) || 0,
    })),
    total_qtd: totalQtd,
  });

  const updates = {};
  for (const it of body.itens) {
    const pedKey = parentKey + "__" + sanitizeKey(it.sku);
    const existingSnap = await db.ref("pedidos/" + pedKey).once("value");
    const existing = existingSnap.val() || {};
    updates[pedKey] = {
      id: String(body.pedidoId),
      cliente: String(body.cliente),
      sku: String(it.sku),
      produto: String(it.descricao),
      qtdTotal: Number(it.qtd) || 0,
      // Achado do Auditor: este objeto SUBSTITUI pedidos/{pedKey} inteiro
      // (semântica de multi-path update do RTDB, não é merge recursivo) --
      // qualquer campo que só o app/operação controla (linha, priority,
      // dataProd, statusManual, ultimoApontamento) e que não for preservado
      // aqui desaparece silenciosamente toda vez que o Gerador de Pedidos
      // reprocessa o mesmo pedido. Mesmo padrão defensivo já usado em
      // criarOP (linha 219+ acima) -- estava faltando aqui.
      produzido: existing.produzido || 0,
      mediaPorHora: existing.mediaPorHora || 0,
      status: existing.status || "Não Iniciado",
      parentPedidoId: parentKey,
      insumosChecklist: existing.insumosChecklist || {},
      linha: existing.linha || "",
      priority: existing.priority != null ? existing.priority : null,
      dataProd: existing.dataProd || null,
      statusManual: existing.statusManual || null,
      ultimoApontamento: existing.ultimoApontamento || null,
    };
  }
  await db.ref("pedidos").update(updates);

  res.status(200).json({ok: true, parentKey: parentKey, itemCount: body.itens.length});
});

// ── Notificações por e-mail (Microsoft Graph) ──────────────────────────
// Substitui email_notifications_daemon.py -- em vez de um PC rodando o
// script continuamente e mandando via automação COM do Outlook local, esta
// function agendada roda a cada 2 min no Firebase e manda via Microsoft
// Graph (mesma caixa de e-mail real da Kuryos, sem trocar de provedor).
const NOTIF_COOLDOWN_MIN = 60;

async function getGraphToken() {
  const tenant = MS_GRAPH_TENANT_ID.value();
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: MS_GRAPH_CLIENT_ID.value(),
      client_secret: MS_GRAPH_CLIENT_SECRET.value(),
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error("Falha ao obter token Graph: " + JSON.stringify(json));
  return json.access_token;
}

async function sendMailViaGraph(to, subject, body, opts) {
  if (!to || !to.length) {
    console.log("Sem destinatários configurados (config.emailNotificacoes). E-mail não enviado:", subject);
    return false;
  }
  const token = await getGraphToken();
  const sender = MS_GRAPH_SENDER_EMAIL.value();
  const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: {"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    body: JSON.stringify({
      message: {
        subject,
        body: {contentType: (opts && opts.html) ? "HTML" : "Text", content: body},
        toRecipients: to.map((addr) => ({emailAddress: {address: addr}})),
      },
    }),
  });
  if (!resp.ok) {
    throw new Error("Falha ao enviar e-mail via Graph: " + resp.status + " " + (await resp.text()));
  }
  console.log("E-mail enviado:", subject);
  return true;
}

// ── Compras: rascunho de cotação por e-mail (Fase 4) ───────────────────
// Chamada pelo botão "Solicitar Cotação" em compras.html. Cria um RASCUNHO
// (POST /messages, sem /send) na caixa da Kuryos -- nunca envia sozinho, é
// decisão explícita do usuário: "usa a mesma integração Microsoft Graph
// que sendMailViaGraph já usa hoje, mas chamando o endpoint de criar
// rascunho em vez de enviar". Quem revisa e manda é sempre uma pessoa.
exports.criarRascunhoCotacao = onCall(
  {secrets: [MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_SENDER_EMAIL]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Faça login pra usar essa função.");
    }
    // Nunca confia só na regra de acesso da página (client-side) -- reconfirma
    // o papel no servidor, mesmo padrão de defesa em profundidade do resto do app.
    const roleSnap = await db.ref("usuarios/" + request.auth.uid + "/role").once("value");
    if (roleSnap.val() !== "admin") {
      throw new HttpsError("permission-denied", "Só administradores podem solicitar cotação.");
    }

    const data = request.data || {};
    const fornecedorEmail = String(data.fornecedorEmail || "").trim();
    const fornecedorNome = String(data.fornecedorNome || "").trim();
    const itens = Array.isArray(data.itens) ? data.itens : [];
    if (!fornecedorEmail || !itens.length) {
      throw new HttpsError("invalid-argument", "Informe o e-mail do fornecedor e ao menos um item.");
    }

    const linhasItens = itens.map((it) =>
      `- ${it.materialCodigo || "?"} — ${it.materialNome || ""}: ${it.qtd || 0} ${it.unidade || ""}`,
    ).join("\n");
    // Mesma lista de PADRAO_ETIQUETA_FORNECEDOR em public/shared/utils.js --
    // Cloud Function não compartilha código com o cliente, então é uma cópia
    // deliberada. Mudou um lado, muda o outro.
    const padraoEtiqueta = [
      "Código do material (o mesmo do cadastro Kuryos)",
      "Descrição do material",
      "Lote e data de fabricação",
      "Quantidade, com a unidade explícita (kg/L/un)",
      "Peso bruto × peso líquido (quando vendido por peso)",
      "Fornecedor (razão social ou nome fantasia)",
      "Referência do Pedido de Compra Kuryos",
      "Cliente dono do pedido",
      "Validade do material",
      "Número de volumes (ex: 2 de 5), se a entrega vier fracionada",
      "Código de barras ou QR (material + lote)",
    ].map((l, i) => `${i + 1}. ${l}`).join("\n");
    const corpo = [
      "Solicitamos cotação para os itens abaixo:",
      "",
      linhasItens,
      "",
      data.prazoDesejado ? `Prazo desejado: ${data.prazoDesejado}` : null,
      data.precoMeta ? `Preço de referência: ${data.precoMeta}` : null,
      data.observacoes ? `Observações: ${data.observacoes}` : null,
      "",
      "Toda caixa/fardo entregue precisa vir com etiqueta de identificação contendo:",
      padraoEtiqueta,
      "",
      "Aguardamos retorno com valores e prazo de entrega.",
      "",
      "Atenciosamente,",
      "Kuryos — Compras",
    ].filter((l) => l !== null).join("\n");
    const assunto = "Solicitação de Cotação — " + (fornecedorNome || fornecedorEmail);

    const token = await getGraphToken();
    const sender = MS_GRAPH_SENDER_EMAIL.value();
    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/messages`, {
      method: "POST",
      headers: {"Authorization": "Bearer " + token, "Content-Type": "application/json"},
      body: JSON.stringify({
        subject: assunto,
        body: {contentType: "Text", content: corpo},
        toRecipients: [{emailAddress: {address: fornecedorEmail}}],
      }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      throw new HttpsError("internal", "Falha ao criar rascunho via Graph: " + resp.status + " " + JSON.stringify(json));
    }
    return {ok: true, webLink: json.webLink || null, messageId: json.id || null};
  },
);

// Estado de cooldown/digest -- antes era um JSON local (email_notifications_state.json),
// agora fica no próprio Firebase já que a function não tem disco persistente
// entre execuções.
// Achado do agente de boas práticas: janela vinha fixa em NOTIF_COOLDOWN_MIN
// (60min) sem parâmetro -- bloqueava a Fase 4 do plano (alerta de atraso
// com repique a cada 10min, cooldown próprio, não o padrão de 60min).
// windowMin opcional preserva os 2 call sites existentes sem mudança.
async function cooldownOk(key, windowMin) {
  const snap = await db.ref("email_notifications_state/last_sent/" + sanitizeKey(key)).once("value");
  const last = snap.val();
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) > (windowMin || NOTIF_COOLDOWN_MIN) * 60 * 1000;
}
async function markSent(key) {
  await db.ref("email_notifications_state/last_sent/" + sanitizeKey(key)).set(new Date().toISOString());
}

// Horários (turnoHorarios, andonParadaMinutos) são sempre em horário de
// Brasília -- a function roda em UTC por padrão, então tudo que compara
// "agora" com esses horários precisa converter primeiro.
function saoPauloParts(date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {dateStr: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}`};
}
function hmToMinutes(hm) {
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + m;
}

// Mesma convenção de config.planejamento.diasSemana usada em horizonte.html
// (getDay() do JS é 0=domingo..6=sábado; aqui domingo vira 7 pra combinar
// com a lista salva em Admin, ex: [1,2,3,4,5] = segunda a sexta).
function dowToConfig(dow) {
  return dow === 0 ? 7 : dow;
}
function isWorkingDay(dateStr, planejamento) {
  const diasSemana = (planejamento && planejamento.diasSemana && planejamento.diasSemana.length) ? planejamento.diasSemana : [1, 2, 3, 4, 5];
  const dow = dowToConfig(new Date(dateStr + "T12:00:00").getDay());
  if (!diasSemana.includes(dow)) return false;
  const feriados = (planejamento && planejamento.feriados) || {};
  if (feriados[dateStr]) return false;
  return true;
}

async function checkLinhasParadas(config, destinatarios) {
  const limiteMin = config.andonParadaMinutos || 15;
  const snap = await db.ref("estado_linhas").once("value");
  const estadoLinhas = snap.val() || {};

  for (const [linhaKey, info] of Object.entries(estadoLinhas)) {
    if (!info || info.status !== "parada" || !info.inicioParada) continue;
    // "Fim de turno" e "Intervalo" são paradas deliberadas (Encerrar Turno e
    // o checkpoint de intervalo programado), não anomalia de produção --
    // avisar sobre elas é ruído. Os dois já têm seu próprio e-mail de resumo
    // (onTurnoEncerrado / onIntervaloApontado).
    if (info.motivoParada === "Fim de turno" || info.motivoParada === "Intervalo") continue;
    const inicio = new Date(info.inicioParada.replace("Z", ""));
    const minutosParada = (Date.now() - inicio.getTime()) / 60000;
    if (minutosParada < limiteMin) continue;

    const key = `parada_${linhaKey}_${info.inicioParada}`;
    if (!(await cooldownOk(key))) continue;

    const assunto = `🔴 Linha parada há ${Math.floor(minutosParada)} min — ${info.motivoParada || "motivo não informado"}`;
    const corpo =
      `A linha (chave: ${linhaKey}) está parada há ${Math.floor(minutosParada)} minutos.\n\n` +
      `Motivo: ${info.motivoParada || "não informado"}\n` +
      `OP: #${info.pedidoId || "—"}\n` +
      `Produto: ${info.produto || "—"}\n` +
      `Lote: ${info.lote || "—"}\n` +
      `Parada iniciada em: ${info.inicioParada}\n\n` +
      `Sistema PCP Kuryos — alerta automático.`;
    if (await sendMailViaGraph(destinatarios, assunto, corpo)) await markSent(key);
  }
}

// Achado da 2a rodada de auditoria (PLANO_PLANEJAMENTO_PCP.md, Fase 4): a
// versão anterior consumia uma fila de eventos ÚNICOS (alertas_pendentes/,
// só populada quando um apontamento fechava) e descartava cada entrada
// depois de processar, emailada ou não -- não reavaliava nada. Se ninguém
// apontasse de novo (o cenário que mais importa: apontamento não
// acontecendo, não a produção em si), nunca surgia outro evento e o
// alerta nunca disparava de novo. Reescrito no mesmo padrão de
// checkLinhasParadas: reavalia estado AO VIVO a cada tick do cron
// (2min), com tolerância de 5min + repique a cada 10min enquanto o
// desvio persistir (cooldown próprio, não o padrão de 60min) -- decisão
// registrada na seção 3 do plano.
//
// Dois sinais independentes, cada um cobrindo um cenário que o outro não
// cobre sozinho:
// 1. ops/{lote}.dataInicioPlanejada/dataFimPlanejada (programação manual
//    do PCP em ops.html) -- "não iniciada no horário" e "ainda aberta
//    depois do término previsto". Só avalia OPs que TÊM plano (a maioria
//    ainda não tem, Horizonte pouco usado) -- sem plano, sem alerta, não
//    tem base pra cobrar.
// 2. pedidos/{key}.desvioAtraso -- estado ao vivo gravado por
//    autoAjustarPlanejamento (auth_check.js) toda vez que o ritmo real
//    fica pior que o planejado a ponto de faltar mais horas do que
//    faltariam no ritmo planejado, além do limiar configurável
//    (config.opAtrasoHoras). Cobre OPs sem dataFimPlanejada também, já
//    que se baseia no ritmo do pedido, não numa data fixa.
async function checkOpsAtrasadas(destinatarios) {
  const TOLERANCIA_MIN = 5;
  const COOLDOWN_MIN = 10;
  const agora = Date.now();

  // ── Sinal 1: programação manual da OP (ops/) ──────────────────────
  const opsSnap = await db.ref("ops").once("value");
  const ops = opsSnap.val() || {};

  for (const [loteKey, op] of Object.entries(ops)) {
    // "Aguardando Confirmação" (Fase 7 do plano): a linha já foi liberada
    // pelo operador, produção já terminou -- não faz sentido alertar
    // "não iniciada"/"atrasada" pra uma OP que já foi fechada, só falta o
    // PCP confirmar.
    if (!op || op.status === "Concluído" || op.status === "Cancelado" || op.status === "Aguardando Confirmação") continue;

    const linha = op.abertaLinha || op.linha || "—";
    const produzido = op.produzidoLinha || op.produzido || 0;

    const naoIniciada = !op.abertaDesde && !op.abertaDesdeRot && !produzido;
    if (op.dataInicioPlanejada && naoIniciada) {
      const inicioMs = new Date(op.dataInicioPlanejada).getTime();
      if (!isNaN(inicioMs)) {
        const atrasoMin = (agora - inicioMs) / 60000;
        if (atrasoMin >= TOLERANCIA_MIN) {
          const key = `op_nao_iniciada_${loteKey}`;
          if (await cooldownOk(key, COOLDOWN_MIN)) {
            const assunto = `⏰ OP ${op.lote || loteKey} não iniciada — ${Math.floor(atrasoMin)} min de atraso`;
            const corpo =
              `A OP ${op.lote || loteKey} (${op.produto || "—"}, cliente ${op.cliente || "—"}) ` +
              `estava programada pra começar em ${op.dataInicioPlanejada} e ainda não foi aberta ` +
              `em nenhuma linha/rotulagem — ${Math.floor(atrasoMin)} minuto(s) de atraso.\n\n` +
              `Quantidade planejada: ${op.qtdPlanejada || 0} un.\n` +
              `Linha programada: ${linha}\n\n` +
              `Pode ser simplesmente esquecimento — vale checar pessoalmente.\n\n` +
              `Sistema PCP Kuryos — alerta automático (repete a cada ${COOLDOWN_MIN}min enquanto não iniciar).`;
            if (await sendMailViaGraph(destinatarios, assunto, corpo)) await markSent(key);
          }
        }
      }
      continue; // já avaliada -- não checa também "atrasada em andamento" no mesmo ciclo
    }

    if (op.abertaDesde && op.dataFimPlanejada) {
      const fimMs = new Date(op.dataFimPlanejada).getTime();
      if (!isNaN(fimMs)) {
        const atrasoMin = (agora - fimMs) / 60000;
        if (atrasoMin >= TOLERANCIA_MIN) {
          const key = `op_atrasada_prazo_${loteKey}`;
          if (await cooldownOk(key, COOLDOWN_MIN)) {
            const pctFeito = op.qtdPlanejada ? Math.round((produzido / op.qtdPlanejada) * 100) : null;
            const assunto = `⚠️ OP ${op.lote || loteKey} atrasada — ${Math.floor(atrasoMin)} min além do previsto`;
            const corpo =
              `A OP ${op.lote || loteKey} (${op.produto || "—"}, cliente ${op.cliente || "—"}) na ${linha} ` +
              `deveria ter terminado em ${op.dataFimPlanejada} e ainda está aberta — ` +
              `${Math.floor(atrasoMin)} minuto(s) além do previsto.\n\n` +
              `Produzido até agora: ${produzido} de ${op.qtdPlanejada || 0} un. planejadas` +
              (pctFeito != null ? ` (${pctFeito}%)` : "") + `.\n\n` +
              `Sistema PCP Kuryos — alerta automático (repete a cada ${COOLDOWN_MIN}min enquanto o desvio persistir).`;
            if (await sendMailViaGraph(destinatarios, assunto, corpo)) await markSent(key);
          }
        }
      }
    }
  }

  // ── Sinal 2: desvio de ritmo do pedido (pedidos/{key}.desvioAtraso) ──
  const pedSnap = await db.ref("pedidos").once("value");
  const pedidos = pedSnap.val() || {};

  for (const [pedKey, p] of Object.entries(pedidos)) {
    const d = p && p.desvioAtraso;
    if (!d || !d.detectadoEm) continue;

    const detectadoMs = new Date(d.detectadoEm).getTime();
    if (isNaN(detectadoMs)) continue;
    const persisteMin = (agora - detectadoMs) / 60000;
    if (persisteMin < TOLERANCIA_MIN) continue;

    const key = `op_atrasada_ritmo_${pedKey}`;
    if (await cooldownOk(key, COOLDOWN_MIN)) {
      const assunto = `⚠️ OP #${p.id || pedKey} atrasada — ${d.desvioHoras}h de desvio de ritmo`;
      const corpo =
        `A OP #${p.id || pedKey} (${p.produto || "—"}) na ${d.linha || "—"} ` +
        `está produzindo a ${d.ritmoReal || 0} un/h, abaixo do ritmo planejado de ` +
        `${d.ritmoPlanejado || 0} un/h — desvio projetado de ${d.desvioHoras} hora(s), ` +
        `persistindo há ${Math.floor(persisteMin)} minuto(s).\n\n` +
        `O planejamento já foi reajustado automaticamente; este e-mail é só um aviso.\n\n` +
        `Sistema PCP Kuryos — alerta automático (repete a cada ${COOLDOWN_MIN}min enquanto o desvio persistir).`;
      if (await sendMailViaGraph(destinatarios, assunto, corpo)) await markSent(key);
    }
  }
}

async function checkOpsEmitidas(destinatarios) {
  const snap = await db.ref("alertas_pendentes").once("value");
  const alertas = snap.val() || {};
  for (const [alertId, alert] of Object.entries(alertas)) {
    if (!alert || alert.tipo !== "op_emitida") continue;

    const assunto = `🆕 OP ${alert.lote || "—"} emitida — ${alert.produto || "—"}`;
    const corpo =
      `Nova OP emitida pelo Gerador de OPs:\n\n` +
      `Lote/OP: ${alert.lote || "—"}\n` +
      `Produto: ${alert.produto || "—"} (SKU: ${alert.sku || "—"})\n` +
      `Cliente: ${alert.cliente || "—"}\n` +
      `Quantidade planejada: ${alert.qtdPlanejada || 0} un.\n` +
      `Pedido comercial: #${alert.pedidoComercialId || "—"}\n` +
      `Emitido por: ${alert.emitidoPor || "—"}\n\n` +
      `Sistema PCP Kuryos — alerta automático.`;
    // Emissão de OP não precisa de cooldown (cada uma é um evento único) --
    // só consome a fila.
    await sendMailViaGraph(destinatarios, assunto, corpo);
    await db.ref("alertas_pendentes/" + alertId).remove();
  }
}

// Se a operação usa modo fixo (Ajustes → Horários dos Turnos → "Turno
// único"), as checagens abaixo devem considerar só esse turno -- senão um
// turno esquecido com horário configurado (ex: "Turno 02" de uma operação
// que não roda mais em múltiplos turnos) dispara alerta de fim de turno /
// turno não encerrado pra algo que nem está em uso de verdade.
function turnoHorariosAtivos(config) {
  const turnoHorarios = config.turnoHorarios || {};
  if (config.modoOperacaoTurno === "fixo" && config.turnoFixoNome) {
    const horaFixo = turnoHorarios[config.turnoFixoNome];
    return horaFixo ? {[config.turnoFixoNome]: horaFixo} : {};
  }
  return turnoHorarios;
}

// Vira hábito só se alguém cobrar quando não acontece -- alerta o time se um
// turno passou do horário configurado de fim e ninguém clicou em "Encerrar
// Turno" no Painel de Turno (form.html). Diferente de onTurnoEncerrado (que
// manda o resumo quando o fechamento realmente acontece), esse aqui só
// dispara quando o fechamento explícito (turnosEncerrados/{data}/{turno})
// está faltando -- é o gatilho pra cobrar o líder responsável.
async function checkTurnoNaoEncerrado(config, destinatarios) {
  const turnoHorarios = turnoHorariosAtivos(config);
  const entries = Object.entries(turnoHorarios);
  if (!entries.length) return;

  const turnoHorariosFim = config.turnoHorariosFim || {};
  const turnoHorariosFimSexta = config.turnoHorariosFimSexta || {};

  const {dateStr: hojeStr, hm: nowHm} = saoPauloParts(new Date());
  // Sem isso, esse alerta dispara TODO dia (inclusive fim de semana/feriado)
  // sempre que o horário configurado de fim de turno passa -- mesmo em dias
  // que a fábrica nem opera, cobrando um fechamento que nunca deveria
  // acontecer. config.planejamento.diasSemana é a mesma fonte que
  // horizonte.html já usa pra saber quais dias são úteis.
  if (!isWorkingDay(hojeStr, config.planejamento)) return;
  const nowMin = hmToMinutes(nowHm);
  const isSexta = new Date(hojeStr + "T12:00:00").getDay() === 5;
  const turnosOrdenados = entries.sort((a, b) => hmToMinutes(a[1]) - hmToMinutes(b[1]));

  for (let i = 0; i < turnosOrdenados.length; i++) {
    const [turnoNome] = turnosOrdenados[i];

    let horaFim = turnoHorariosFim[turnoNome];
    if (isSexta && turnoHorariosFimSexta[turnoNome]) horaFim = turnoHorariosFimSexta[turnoNome];
    if (!horaFim) {
      // Sem "Fim do turno" configurado pra esse turno -- cai no mesmo
      // fallback do checkFimDeTurno (início do próximo turno).
      horaFim = i + 1 < turnosOrdenados.length ? turnosOrdenados[i + 1][1] : "23:59";
    }
    const fimMin = hmToMinutes(horaFim);

    const diffMin = nowMin - fimMin;
    if (diffMin < 0 || diffMin > 180) continue; // ainda não passou do fim, ou já demorou demais pra alertar

    const turnoKey = sanitizeKey(turnoNome);
    const encerradoSnap = await db.ref("turnosEncerrados/" + hojeStr + "/" + turnoKey).once("value");
    if (encerradoSnap.exists()) continue; // já foi encerrado, nada a cobrar

    const digestKey = `turno_nao_encerrado_${hojeStr}_${turnoNome}`;
    const digestRef = db.ref("email_notifications_state/last_digest/" + sanitizeKey(digestKey));
    if ((await digestRef.once("value")).exists()) continue; // já mandou esse alerta hoje

    const assunto = `⚠️ Turno ${turnoNome} não foi encerrado (${hojeStr})`;
    const corpo =
      `O turno "${turnoNome}" deveria ter terminado às ${horaFim} e ainda não foi encerrado no ` +
      `Painel de Turno.\n\nPeça ao líder responsável pra abrir o app e clicar em "Encerrar turno".\n\n` +
      `Sistema PCP Kuryos — alerta automático de turno não encerrado.`;
    if (await sendMailViaGraph(destinatarios, assunto, corpo)) await digestRef.set(true);
  }
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtNumBr(n) {
  return Number(n || 0).toLocaleString("pt-BR");
}

// Um registro tem .linha = nome livre digitado no app -- classifica contra
// as listas cadastradas em Admin pra saber se é Linha de produção, Rotulagem
// ou Posto de trabalho. Usado nos e-mails de resumo (onTurnoEncerrado,
// onIntervaloApontado): Linha, Rotulagem e Posto são somatórias SEMPRE
// distintas (nunca somadas -- mesmo princípio de produzidoLinha/
// produzidoRotulagem/produzidoPosto em ops/{lote}, ver
// campoProduzido/getProduzido em public/shared/utils.js). Um nome que não
// bate com nenhuma lista cadastrada fica de fora ("outro"), pra não inflar
// nenhum total com lançamento órfão/mal digitado.
function classificarLinha(nome, config) {
  var linhas = config.linhas || [];
  var rotulagem = config.rotulagem || [];
  var postos = config.postos || [];
  if (linhas.indexOf(nome) !== -1) return "linha";
  if (rotulagem.indexOf(nome) !== -1) return "rotulagem";
  if (postos.indexOf(nome) !== -1) return "posto";
  return "outro";
}

function agruparRegs(regs) {
  const total = regs.reduce((s, r) => s + (r.quantidade || 0), 0);
  const nomes = [...new Set(regs.map((r) => r.linha || "—"))].sort();
  const html = nomes.map((l) => {
    const doNome = regs.filter((r) => r.linha === l);
    const qtd = doNome.reduce((s, r) => s + (r.quantidade || 0), 0);
    return `<li><strong>${escHtml(l)}</strong>: ${fmtNumBr(qtd)} un. em ${doNome.length} lançamento(s)</li>`;
  }).join("");
  return {total, count: regs.length, html: html || "<li>Nenhum lançamento.</li>"};
}

// Resumo separado por tipo (Linha / Rotulagem / Posto), excluindo qualquer
// nome não cadastrado -- ver classificarLinha acima. `count` (nº de
// lançamentos) pode ser somado à vontade -- é contagem de registros, não
// quantidade produzida. As três UNIDADES produzidas (linhas.total/
// rotulagem.total/postos.total) nunca são somadas entre si em lugar
// nenhum -- ver resumoTipoHtml.
function resumoPorTipo(regs, config) {
  const linhaRegs = regs.filter((r) => classificarLinha(r.linha, config) === "linha");
  const rotulagemRegs = regs.filter((r) => classificarLinha(r.linha, config) === "rotulagem");
  const postoRegs = regs.filter((r) => classificarLinha(r.linha, config) === "posto");
  const linhas = agruparRegs(linhaRegs);
  const rotulagem = agruparRegs(rotulagemRegs);
  const postos = agruparRegs(postoRegs);
  return {
    linhas, rotulagem, postos,
    count: linhas.count + rotulagem.count + postos.count,
  };
}

function normTxt(s) {
  return String(s || "").toLowerCase().trim();
}

// Mapa nome de produto (normalizado) -> ritmo de referência (un/h),
// cadastrado manualmente em produtos.html (prodHoraRef). Base pro
// comparativo de performance: produto rápido e produto lento têm
// referências diferentes, então comparar contra a própria referência de
// cada um neutraliza o mix de produto do período (em vez de comparar
// total bruto de dias com mixes diferentes, o que engana).
function buildRitmoRefMap(produtosVal) {
  const map = {};
  Object.values(produtosVal || {}).forEach((p) => {
    if (p && p.descricao && p.prodHoraRef) map[normTxt(p.descricao)] = p.prodHoraRef;
  });
  return map;
}

// % do ritmo de referência batido no período: soma das quantidades reais ÷
// soma das referências dos MESMOS lançamentos (cada lançamento horário ≈ 1h
// de produção, mesma premissa do cálculo de "média calculada" em
// produtos.html) -- ponderado por quantidade, não é média simples das
// razões (uma linha com 1 lançamento pequeno não pesa igual a uma com 8).
// Retorna null quando nenhum produto do período tem referência cadastrada
// (não dá pra comparar com nada).
function performancePct(regs, ritmoRefMap) {
  let realSum = 0;
  let refSum = 0;
  regs.forEach((r) => {
    const ref = ritmoRefMap[normTxt(r.produto)];
    if (ref) { realSum += (r.quantidade || 0); refSum += ref; }
  });
  if (!refSum) return null;
  return Math.round((realSum / refSum) * 100);
}

// Disponibilidade simplificada: % do tempo do turno sem parada, contando
// só o tempo já decorrido (início do turno até agora). Não distingue
// parada planejada (intervalo/fim de turno) de não planejada por ora --
// decisão consciente, ver conversa.
function disponibilidadePct(turnoInicioHm, agoraDate, paradasMin) {
  if (!turnoInicioHm) return null;
  const parts = String(turnoInicioHm).split(":");
  const inicioMin = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  const agoraMin = agoraDate.getHours() * 60 + agoraDate.getMinutes();
  const totalMin = Math.max(agoraMin - inicioMin, 1);
  return Math.max(0, Math.min(100, Math.round((1 - paradasMin / totalMin) * 100)));
}

// Pareto de paradas: agrupa por motivo e ordena pelo tempo total perdido
// (maior primeiro) -- mostra de cara a causa que mais consumiu tempo, em
// vez de uma lista solta em ordem cronológica que obriga a somar na mão
// pra achar o que mais pesou.
function paretoParadas(paradas) {
  const porMotivo = {};
  paradas.forEach((p) => {
    const m = p.motivo || "—";
    if (!porMotivo[m]) porMotivo[m] = {motivo: m, totalMin: 0, count: 0};
    porMotivo[m].totalMin += (p.duracao || 0);
    porMotivo[m].count++;
  });
  return Object.values(porMotivo).sort((a, b) => b.totalMin - a.totalMin);
}

function paretoParadasHtml(paradas) {
  if (!paradas.length) return "<li>Nenhuma parada registrada.</li>";
  const ranked = paretoParadas(paradas);
  const totalMin = ranked.reduce((s, p) => s + p.totalMin, 0);
  return ranked.map((p) => {
    const pct = totalMin ? Math.round((p.totalMin / totalMin) * 100) : 0;
    return `<li><strong>${escHtml(p.motivo)}</strong>: ${p.totalMin} min (${pct}%) em ${p.count} parada(s)</li>`;
  }).join("") + `<li><em>Total: ${totalMin} min em ${paradas.length} parada(s)</em></li>`;
}

// Produtos em produção no período, com progresso ACUMULADO da OP (não só
// do período) -- "quanto falta" de verdade. É produção física, não
// liberação: ainda falta a análise de qualidade pra aprovar de fato, por
// isso o rótulo é "produzido", nunca "concluído".
// Mesmo campo por setor de public/shared/utils.js#campoProduzido/getProduzido
// -- Node não compartilha módulo com o client, então essa cópia local
// pequena evita puxar todo o arquivo do browser pra cá. Linha/Rotulagem/
// Posto nunca são somados num único "produzido" -- ver comentário grande
// em classificarLinha/resumoPorTipo acima.
function getProduzidoOp(op, tipo) {
  if (!op) return 0;
  const campo = tipo === "rotulagem" ? "produzidoRotulagem" : tipo === "posto" ? "produzidoPosto" : "produzidoLinha";
  if (op[campo] != null) return op[campo];
  return (tipo === "linha" || !tipo) ? (op.produzido || 0) : 0;
}

async function produtosComProgresso(regs) {
  const porChave = {};
  regs.forEach((r) => {
    const chave = r.lote || r.produto || "—";
    if (!porChave[chave]) porChave[chave] = {lote: r.lote || "", produto: r.produto || "—", qtdPeriodo: 0};
    porChave[chave].qtdPeriodo += (r.quantidade || 0);
  });
  const entradas = Object.values(porChave);
  const comOp = entradas.filter((e) => e.lote);
  const opsSnaps = await Promise.all(comOp.map((e) => db.ref("ops/" + sanitizeKey(e.lote)).once("value")));
  comOp.forEach((e, i) => {
    const op = opsSnaps[i].val();
    if (op && op.qtdPlanejada) {
      e.qtdPlanejada = op.qtdPlanejada;
      // Um por setor que já produziu algo -- nunca um único "produzidoTotal"
      // somado (o mesmo motivo de computeOpStatus/getProduzido no client).
      e.setoresProgresso = ["linha", "rotulagem", "posto"]
        .map((tipo) => ({tipo, produzido: getProduzidoOp(op, tipo)}))
        .filter((s) => s.produzido > 0)
        .map((s) => ({...s, pct: Math.min(100, Math.round((s.produzido / op.qtdPlanejada) * 100))}));
    }
  });
  return entradas.sort((a, b) => b.qtdPeriodo - a.qtdPeriodo);
}

const SETOR_LABEL = {linha: "Linha", rotulagem: "Rotulagem", posto: "Posto"};
function produtosComProgressoHtml(entradas) {
  if (!entradas.length) return "<li>Nenhum lançamento.</li>";
  return entradas.map((e) => {
    const progresso = (e.setoresProgresso && e.setoresProgresso.length)
      ? " — " + e.setoresProgresso.map((s) =>
        `${SETOR_LABEL[s.tipo]}: ${fmtNumBr(s.produzido)}/${fmtNumBr(e.qtdPlanejada)} un. (${s.pct}%)`,
      ).join(" · ") + " (aguarda qualidade pra liberar)"
      : "";
    return `<li><strong>${escHtml(e.produto)}</strong>${e.lote ? " · OP " + escHtml(e.lote) : ""}: ` +
      `${fmtNumBr(e.qtdPeriodo)} un. no período${progresso}</li>`;
  }).join("");
}

// Cartão de indicador simples (Performance/Disponibilidade) -- div com
// flex/inline-style, não canvas/svg, pra renderizar em qualquer cliente de
// e-mail (Outlook não confia em canvas/svg).
function kpiCardHtml(label, value, sub) {
  return `
    <div style="flex:1;min-width:140px;background:#f5f5f7;border-radius:10px;padding:12px 14px">
      <div style="font-size:22px;font-weight:700;color:#2456d6">${escHtml(value)}</div>
      <div style="font-size:12px;font-weight:600;color:#1d1d1f;margin-top:2px">${escHtml(label)}</div>
      <div style="font-size:11px;color:#6e6e73;margin-top:2px">${escHtml(sub)}</div>
    </div>
  `;
}

// Linhas/Rotulagem/Posto nunca aparecem somados num "total de produção" --
// não é uma unidade física combinável (envasado, rotulado e posto são
// contagens de processos diferentes). Só o nº de lançamentos (contagem de
// registros, não quantidade) aparece como resumo geral.
function resumoTipoHtml(resumo) {
  return `
    <p style="margin:0 0 4px"><strong>${resumo.count} lançamento(s)</strong> no período, por setor:</p>
    <p style="margin:10px 0 4px;font-weight:600;color:#3b5bdb">Linhas — ${fmtNumBr(resumo.linhas.total)} un.</p>
    <ul style="margin:0 0 10px;padding-left:20px">${resumo.linhas.html}</ul>
    <p style="margin:10px 0 4px;font-weight:600;color:#7048e8">Rotulagem — ${fmtNumBr(resumo.rotulagem.total)} un.</p>
    <ul style="margin:0 0 10px;padding-left:20px">${resumo.rotulagem.html}</ul>
    <p style="margin:10px 0 4px;font-weight:600;color:#0ca678">Postos de Trabalho — ${fmtNumBr(resumo.postos.total)} un.</p>
    <ul style="margin:0 0 10px;padding-left:20px">${resumo.postos.html}</ul>
  `;
}

// Dispara no evento real de fechamento (turnosEncerrados/{data}/{turno}
// gravado por confirmarFechamentoTurno em form.html), não numa checagem
// agendada -- chega no e-mail assim que o líder aponta o fim de turno e as
// quantidades, em vez de esperar uma janela de horário fixa. Substitui o
// antigo checkFimDeTurno (agendado) e não compete com checkLinhasParadas,
// que agora ignora a parada deliberada de "Fim de turno".
exports.onTurnoEncerrado = onValueCreated(
  {
    ref: "/turnosEncerrados/{data}/{turno}",
    instance: "prod-kuryos-default-rtdb",
    secrets: [MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_SENDER_EMAIL],
  },
  async (event) => {
    const hojeStr = event.params.data;
    const turnoNome = decodeURIComponent(event.params.turno);
    const fechamento = event.data.val() || {};

    const configSnap = await db.ref("config").once("value");
    const config = configSnap.val() || {};
    const destinatarios = config.emailNotificacoes || [];
    if (!destinatarios.length) return;

    const [regSnap, perdasSnap, paradasSnap, produtosSnap] = await Promise.all([
      db.ref("registros/" + hojeStr).once("value"),
      db.ref("perdas").once("value"),
      db.ref("paradas_historico").once("value"),
      db.ref("produtos").once("value"),
    ]);

    const registrosHoje = Object.values(regSnap.val() || {});
    const doTurno = registrosHoje.filter((r) => r && r.turno === turnoNome);

    const resumoTurno = resumoPorTipo(doTurno, config);
    const resumoDia = resumoPorTipo(registrosHoje, config);

    const ritmoRefMap = buildRitmoRefMap(produtosSnap.val());
    const performanceTurno = performancePct(doTurno, ritmoRefMap);
    const produtosTurno = await produtosComProgresso(doTurno);

    // Perdas: perdas/{loteKey}/{pushKey} = {data, lote, produto, linha, perdas:[{tipo,quantidade,especificacao}]}
    const perdasHoje = [];
    const perdasVal = perdasSnap.val() || {};
    Object.values(perdasVal).forEach((porLote) => {
      Object.values(porLote || {}).forEach((entry) => {
        if (entry && entry.data === hojeStr) perdasHoje.push(entry);
      });
    });
    let perdasHtml = "<li>Nenhuma perda registrada hoje.</li>";
    if (perdasHoje.length) {
      const linhasPerdas = [];
      perdasHoje.forEach((entry) => {
        (entry.perdas || []).forEach((p) => {
          linhasPerdas.push(
              `<li><strong>${escHtml(entry.produto || "—")}</strong>` +
              ` (${escHtml(entry.linha || "—")}${entry.lote ? " · OP " + escHtml(entry.lote) : ""}):` +
              ` ${fmtNumBr(p.quantidade)} — ${escHtml(p.tipo || "Outro")}${p.especificacao ? ": " + escHtml(p.especificacao) : ""}</li>`,
          );
        });
      });
      perdasHtml = linhasPerdas.join("") || perdasHtml;
    }

    // Paradas do dia (paradas_historico não tem campo "data" -- compara a
    // data local extraída de fim/inicio, mesma lógica do dashboard).
    function localDate(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return new Intl.DateTimeFormat("en-CA", {timeZone: "America/Sao_Paulo"}).format(d);
    }
    function localHm(iso) {
      if (!iso) return "";
      return new Intl.DateTimeFormat("en-GB", {timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false}).format(new Date(iso));
    }
    const paradasVal = paradasSnap.val() || {};
    const paradasHoje = Object.values(paradasVal).filter((p) => p && localDate(p.fim || p.inicio) === hojeStr);

    // Paradas "deste turno": começaram depois do início do turno configurado
    // (mesmo dia) -- aproximação simples, não lida com turno que atravessa
    // meia-noite (nenhum turno cadastrado hoje faz isso).
    const turnoInicioHm = (config.turnoHorarios && config.turnoHorarios[turnoNome]) || null;
    const paradasDoTurno = turnoInicioHm ? paradasHoje.filter((p) => localHm(p.inicio) >= turnoInicioHm) : paradasHoje;
    const paradasDoTurnoMin = paradasDoTurno.reduce((s, p) => s + (p.duracao || 0), 0);
    const disponibilidadeTurno = disponibilidadePct(turnoInicioHm, new Date(), paradasDoTurnoMin);

    const kpiHtml = `
      <div style="display:flex;gap:10px;margin:12px 0 16px;flex-wrap:wrap">
        ${performanceTurno != null ? kpiCardHtml("Performance", performanceTurno + "%", "ritmo real vs. referência") : ""}
        ${disponibilidadeTurno != null ? kpiCardHtml("Disponibilidade", disponibilidadeTurno + "%", "tempo produzindo vs. parado") : ""}
      </div>
    `;

    const assunto = `📋 Resumo do turno ${turnoNome} — ${hojeStr}`;
    const corpo = `
      <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d1d1f">
        <h2 style="margin:0 0 4px">Turno ${escHtml(turnoNome)} encerrado — ${hojeStr}</h2>
        <p style="color:#6e6e73;margin:0 0 16px">${fechamento.itens || 0} item(ns) fechado(s) neste turno.${fechamento.justificativaAtraso ? " <strong style=\"color:#d03b3b\">Encerrado com atraso: " + escHtml(fechamento.justificativaAtraso) + "</strong>" : ""}</p>

        ${kpiHtml}

        <h3 style="margin:16px 0 6px">Produção neste turno</h3>
        ${resumoTipoHtml(resumoTurno)}

        <h3 style="margin:16px 0 6px">Produção do dia (todos os turnos)</h3>
        ${resumoTipoHtml(resumoDia)}

        <h3 style="margin:16px 0 6px">Produtos em produção neste turno</h3>
        <ul style="margin:0 0 16px;padding-left:20px">${produtosComProgressoHtml(produtosTurno)}</ul>

        <h3 style="margin:16px 0 6px">Perdas do dia</h3>
        <ul style="margin:0 0 16px;padding-left:20px">${perdasHtml}</ul>

        <h3 style="margin:16px 0 6px">Paradas do dia — por motivo</h3>
        <ul style="margin:0 0 16px;padding-left:20px">${paretoParadasHtml(paradasHoje)}</ul>

        <p style="color:#6e6e73;font-size:12px;margin-top:20px">Sistema PCP Kuryos — resumo automático de fim de turno.</p>
      </div>
    `;
    await sendMailViaGraph(destinatarios, assunto, corpo, {html: true});
  },
);

// Termômetro de meio-turno: dispara depois do checkpoint de intervalo
// programado (intervalosApontados/{data}/{turno}/{itemId}, gravado por
// confirmarFechamentoTurno em form.html quando chamado com
// opts.tipo='intervalo') -- mesma ideia do onTurnoEncerrado, só que mais
// enxuto (só produção, sem perdas/paradas do dia) e SEM marcar
// turnosEncerrados, já que o turno continua aberto depois do intervalo.
// checkLinhasParadas já ignora motivoParada 'Intervalo' (não é anomalia) e
// checkTurnoNaoEncerrado só olha turnosEncerrados, então o intervalo não
// interfere em nenhuma das outras checagens.
//
// Não é mais um gatilho onValueCreated -- passou a ser checado dentro do
// polling de checkNotificacoes (a cada 2min) de propósito: com o botão de
// Intervalo por linha/rotulagem, cada card pode bater o checkpoint num
// momento diferente do turno, e mandar um e-mail por checkpoint viraria
// enxurrada (uma fábrica com 5 linhas geraria até 5 e-mails "picotados" no
// mesmo intervalo). Em vez disso: o primeiro checkpoint pendente do dia
// abre uma janela de 15min pra "condensar" o que mais entrar nesse meio
// tempo num único e-mail; depois que esse primeiro e-mail sai, qualquer
// apontamento novo (alguém que só bateu o ponto depois, atrasado) sai
// sozinho na próxima varredura, sem abrir uma nova espera de 15min.
async function checkIntervalosPendentes(config, destinatarios) {
  if (!destinatarios.length) return;
  const hojeStr = saoPauloParts(new Date()).dateStr;
  const snap = await db.ref("intervalosApontados/" + hojeStr).once("value");
  const porTurno = snap.val() || {};
  const agora = Date.now();

  for (const turnoKey of Object.keys(porTurno)) {
    const itensObj = porTurno[turnoKey] || {};
    const entradas = Object.entries(itensObj).filter(([, v]) => v);
    const pendentes = entradas.filter(([, v]) => !v.emailEnviado);
    if (!pendentes.length) continue;

    const jaTeveEmailAntes = entradas.some(([, v]) => v.emailEnviado);
    const maisAntigoMs = Math.min(...pendentes.map(([, v]) => new Date(v.apontadoEm).getTime()));
    const idadeMin = (agora - maisAntigoMs) / 60000;
    // Só espera a janela de 15min pro PRIMEIRO lote do dia -- depois disso
    // cada apontamento avulso sai isolado (sem novo período de espera).
    if (!jaTeveEmailAntes && idadeMin < 15) continue;

    const turnoNome = decodeURIComponent(turnoKey);
    const totalItens = pendentes.reduce((s, [, v]) => s + (v.itens || 0), 0);
    await sendApuracaoParcialEmail(hojeStr, turnoNome, totalItens, config, destinatarios);

    const updates = {};
    pendentes.forEach(([key]) => { updates[key + "/emailEnviado"] = true; });
    await db.ref("intervalosApontados/" + hojeStr + "/" + turnoKey).update(updates);
  }
}

async function sendApuracaoParcialEmail(hojeStr, turnoNome, totalItens, config, destinatarios) {
  const [regSnap, produtosSnap] = await Promise.all([
    db.ref("registros/" + hojeStr).once("value"),
    db.ref("produtos").once("value"),
  ]);
  const registrosHoje = Object.values(regSnap.val() || {});
  const doTurno = registrosHoje.filter((r) => r && r.turno === turnoNome);

  const resumoTurno = resumoPorTipo(doTurno, config);
  const resumoDia = resumoPorTipo(registrosHoje, config);

  const ritmoRefMap = buildRitmoRefMap(produtosSnap.val());
  const performanceTurno = performancePct(doTurno, ritmoRefMap);
  const produtosTurno = await produtosComProgresso(doTurno);

  const assunto = `🌡️ Apuração parcial (Intervalo) — ${turnoNome} — ${hojeStr}`;
  const corpo = `
    <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d1d1f">
      <h2 style="margin:0 0 4px">Intervalo do turno ${escHtml(turnoNome)} — ${hojeStr}</h2>
      <p style="color:#6e6e73;margin:0 0 16px">${totalItens} item(ns) apontado(s) no checkpoint de intervalo. O turno continua aberto.</p>

      ${performanceTurno != null ? '<div style="display:flex;margin:12px 0 16px">' + kpiCardHtml("Performance", performanceTurno + "%", "ritmo real vs. referência") + "</div>" : ""}

      <h3 style="margin:16px 0 6px">Produção neste turno (até o intervalo)</h3>
      ${resumoTipoHtml(resumoTurno)}

      <h3 style="margin:16px 0 6px">Produção do dia (todos os turnos, até agora)</h3>
      ${resumoTipoHtml(resumoDia)}

      <h3 style="margin:16px 0 6px">Produtos em produção neste turno</h3>
      <ul style="margin:0 0 16px;padding-left:20px">${produtosComProgressoHtml(produtosTurno)}</ul>

      <p style="color:#6e6e73;font-size:12px;margin-top:20px">Sistema PCP Kuryos — apuração automática de intervalo programado.</p>
    </div>
  `;
  await sendMailViaGraph(destinatarios, assunto, corpo, {html: true});
}

exports.checkNotificacoes = onSchedule(
  {
    schedule: "every 2 minutes",
    timeZone: "America/Sao_Paulo",
    secrets: [MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_SENDER_EMAIL],
  },
  async () => {
    const configSnap = await db.ref("config").once("value");
    const config = configSnap.val() || {};
    const destinatarios = config.emailNotificacoes || [];

    // Cada checagem isolada -- uma falhar não pode impedir as outras (ex:
    // um alerta de OP emitida é urgente, não pode ficar preso porque a
    // checagem de linha parada deu erro).
    const checks = [
      ["linhas paradas", () => checkLinhasParadas(config, destinatarios)],
      ["ops atrasadas", () => checkOpsAtrasadas(destinatarios)],
      ["ops emitidas", () => checkOpsEmitidas(destinatarios)],
      ["turno não encerrado", () => checkTurnoNaoEncerrado(config, destinatarios)],
      ["intervalos pendentes", () => checkIntervalosPendentes(config, destinatarios)],
    ];
    for (const [nome, fn] of checks) {
      try {
        await fn();
      } catch (e) {
        console.error(`Erro na checagem "${nome}":`, e);
      }
    }
  },
);
