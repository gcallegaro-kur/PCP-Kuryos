// Kuryos PCP Shared Utilities

// Carrega a lib xlsx (~600KB) só quando alguém realmente importa/exporta uma
// planilha, em vez de baixar em toda visita às páginas que têm essa opção.
window.kuryosLoadXLSX = function() {
  if (window.XLSX) return Promise.resolve();
  if (window._kuryosXlsxPromise) return window._kuryosXlsxPromise;
  window._kuryosXlsxPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = function() { resolve(); };
    s.onerror = function() { reject(new Error('Falha ao carregar biblioteca de planilhas.')); };
    document.head.appendChild(s);
  });
  return window._kuryosXlsxPromise;
};

// Fase 0 do ERP unificado (Compras/Logística/Materiais/Fórmulas/BOM/OP):
// dá pra desenvolver/testar telas novas clicando de verdade, contra uma
// cópia local do Firebase, sem nunca tocar prod-kuryos.
//
// kuryosDatabaseURL(prodURL) -- chamar ao MONTAR firebaseConfig, ANTES de
// firebase.initializeApp(). Achado testando a Fase 0: `firebase.database().
// useEmulator(host, port)` (chamado depois do initializeApp, como o SDK
// "deveria" funcionar) NÃO inclui o parâmetro `?ns=` certo nesta versão do
// SDK compat -- sem ele o emulador responde com um namespace vazio/errado,
// SEM erro nenhum, só devolve null pra tudo (bug silencioso, achado só
// comparando uma leitura via REST direto no emulador vs. via SDK). Setar o
// databaseURL certo direto na config, antes do initializeApp, contorna isso
// de vez -- é o padrão confirmado funcionando nesta sessão.
function kuryosIsLocalDev() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}
function kuryosDatabaseURL(prodURL) {
  return kuryosIsLocalDev() ? 'http://localhost:9000/?ns=prod-kuryos' : prodURL;
}
// kuryosConnectEmulatorsIfLocal() -- chamar logo depois de
// firebase.initializeApp(...) (o databaseURL já cuidou do Database sozinho;
// aqui só falta Auth/Functions, que o .useEmulator() deles funciona normal).
// Em produção não faz nada -- seguro deixar em qualquer página nova.
function kuryosConnectEmulatorsIfLocal() {
  if (!kuryosIsLocalDev()) return;
  try {
    if (typeof firebase.auth === 'function') {
      firebase.auth().useEmulator('http://localhost:9099', { disableWarnings: true });
    }
    if (typeof firebase.functions === 'function') {
      firebase.functions().useEmulator('localhost', 5001);
    }
    console.info('[Kuryos] Rodando local -- conectado aos emuladores do Firebase (Auth/Database via databaseURL/Functions), prod-kuryos intocado.');
  } catch (e) {
    console.error('[Kuryos] Falha ao conectar nos emuladores locais:', e);
  }
}

// Corrige uma corrida real do Firebase num app multi-página sem SPA: cada
// navegação recria a conexão websocket do Realtime Database do zero, e por
// uma fração de segundo o token de auth às vezes ainda não propagou pra
// essa conexão nova -- uma leitura que dispara nesse instante recebe
// permission_denied mesmo com login válido (erro transitório, não falta de
// permissão de verdade). Sem retentativa, ref.on('value', ...) simplesmente
// morre nesse erro e a tela fica sem dado nenhum até um F5 dar tempo novo
// pra conexão se firmar -- era por isso que as telas pareciam precisar de
// atualização constante pra carregar. Substituto direto de
// ref.on('value', cb): mesmo callback de sucesso, só que com retentativa
// automática por trás quando falha.
function dbOnValue(ref, onData, opts) {
  opts = opts || {};
  var attemptsLeft = opts.attempts != null ? opts.attempts : 3;
  var delay = opts.delay != null ? opts.delay : 700;
  function attach() {
    ref.on('value', onData, function(err) {
      if (attemptsLeft > 0) {
        attemptsLeft--;
        ref.off('value', onData);
        setTimeout(attach, delay);
      } else {
        console.error('dbOnValue: falha ao carregar dados (permissão/conexão):', err);
        if (opts.onError) opts.onError(err);
      }
    });
  }
  attach();
}

function sanitizeKey(str) {
  if (!str) return '';
  var s = String(str).trim()
    .replace(/[./[\]#$]/g, '-')
    .replace(/\s+/g, '_');
  return s.slice(0, 60);
}

function pedidoFirebaseKey(id, produto) {
  return sanitizeKey(id) + '__' + sanitizeKey(produto);
}

function normalizeForMatch(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
}

function findPedidoKey(pedidoId, produto, pedidosDict) {
  if (!pedidosDict || !pedidoId) return null;
  var keys = Object.keys(pedidosDict);
  var exactKey = pedidoFirebaseKey(pedidoId, produto);
  if (pedidosDict[exactKey]) return exactKey;
  
  var pid = String(pedidoId).trim();
  var prodNorm = produto ? normalizeForMatch(produto) : '';

  // 1. Try exact or prefix match + product match
  for (var i = 0; i < keys.length; i++) {
    var p = pedidosDict[keys[i]];
    if (!p) continue;
    var idStr = String(p.id || '').trim();
    var idMatches = (idStr === pid || idStr.indexOf(pid + '-') === 0);
    if (idMatches && prodNorm) {
      if (normalizeForMatch(p.produto) === prodNorm) {
        return keys[i];
      }
    }
  }

  // 2. Try exact or prefix match alone
  for (var i = 0; i < keys.length; i++) {
    var p = pedidosDict[keys[i]];
    if (!p) continue;
    var idStr = String(p.id || '').trim();
    var idMatches = (idStr === pid || idStr.indexOf(pid + '-') === 0);
    if (idMatches) {
      return keys[i];
    }
  }
  return null;
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

// Resolve a chave real de pedidos/ a partir de um ops/{lote}.skuPedidoKey
// (formato "{pedidoComercialId}__{sku}"). Existe porque o Gerador de OPs e o
// Gerador de Pedidos (duas ferramentas VBA externas e independentes) nem
// sempre formatam o pedidoComercialId igual -- um manda "17", o outro grava
// o pedido como "0017"; às vezes até aparece um "-005" com traço estranho.
// Um lookup direto (pedidosDict[skuPedidoKey]) falha silenciosamente nesses
// casos e o apontamento nunca credita o pedido (bug real encontrado e
// corrigido em ago/2026: 38 OPs, ~161 mil un. presas). Aqui comparamos o id
// só pelos dígitos (ignora zero à esquerda e sinal) + SKU exato -- o SKU
// exato já evita falso-positivo, então a normalização de id pode ser
// permissiva sem risco de cruzar pedido errado.
function resolvePedidoKeyBySkuKey(skuKey, pedidosDict) {
  if (!skuKey || !pedidosDict) return null;
  if (pedidosDict[skuKey]) return skuKey; // já bate direto, caminho rápido
  var sep = String(skuKey).indexOf('__');
  if (sep === -1) return null;
  var idPart = skuKey.slice(0, sep);
  var skuPart = skuKey.slice(sep + 2);
  var idDigits = digitsOnly(idPart);
  if (!idDigits) return null;
  var idNum = parseInt(idDigits, 10);
  var keys = Object.keys(pedidosDict);
  for (var i = 0; i < keys.length; i++) {
    var p = pedidosDict[keys[i]];
    if (!p) continue;
    var pIdDigits = digitsOnly(p.id);
    if (!pIdDigits) continue;
    if (parseInt(pIdDigits, 10) === idNum && String(p.sku || '') === skuPart) {
      return keys[i];
    }
  }
  return null;
}

// ── Motor de ritmo demonstrado ──────────────────────────────────────────
// Substitui "usar o ritmo do último apontamento fechado como se fosse a
// meta de planejamento" (volátil por natureza -- um único período atípico
// vira a meta da semana inteira) por uma janela móvel de sessões reais,
// com viés conservador e exclusão de ruído. Referência de mercado: OEE
// (Disponibilidade × Performance × Qualidade) usa uma "taxa demonstrada"
// histórica como base de planejamento, não a taxa nominal nem uma amostra
// isolada -- é esse princípio que essas funções replicam. Só cálculo, não
// lê nem grava nada sozinho -- quem chama já traz os registros carregados.
var KURYOS_RITMO_JANELA_SESSOES = 10;   // quantas sessões recentes considerar
var KURYOS_RITMO_MIN_AMOSTRAS = 3;      // mesmo mínimo que calcProdHora já usa em produtos.html
var KURYOS_RITMO_PERCENTIL_CONSERVADOR = 25; // viés pra baixo, não a média

function kuryosMediana(nums) {
  if (!nums || !nums.length) return 0;
  var s = nums.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function kuryosPercentil(nums, p) {
  if (!nums || !nums.length) return 0;
  var s = nums.slice().sort(function(a, b) { return a - b; });
  var idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

// Sessões "limpas" de um pedido ou produto, a partir de um objeto
// registros/{data}/{regId} já carregado em memória (mesmo formato que
// db.ref('registros').once('value').val()). filtro: {pedidoId, produto}
// (compara por pedido específico, mesma lógica de match do auth_check.js)
// ou só {produto} (agrega por nome de produto, pra sugestão de produto
// novo). Descarta: sessão sem quantidade, sessão curta demais (<0.5h --
// não representa ritmo sustentável, é setup/início de turno) e sessão com
// mais de 15% do próprio período em parada registrada.
function kuryosSessoesLimpas(registrosPorData, filtro) {
  var sessoes = [];
  filtro = filtro || {};
  var pedidoIdAlvo = filtro.pedidoId ? String(filtro.pedidoId).trim().toUpperCase() : null;
  var produtoAlvo = filtro.produto ? String(filtro.produto).trim().toUpperCase() : null;
  Object.keys(registrosPorData || {}).forEach(function(date) {
    var dayRegs = registrosPorData[date] || {};
    Object.keys(dayRegs).forEach(function(regId) {
      var r = dayRegs[regId];
      if (!r || !r.quantidade || r.quantidade <= 0) return;
      if (pedidoIdAlvo && String(r.pedidoId || '').trim().toUpperCase() !== pedidoIdAlvo) return;
      if (produtoAlvo && String(r.produto || '').trim().toUpperCase() !== produtoAlvo) return;
      var horas = r.horasTrabalhadas > 0 ? r.horasTrabalhadas : 1;
      if (horas < 0.5) return;
      var totalParadaMin = 0;
      if (Array.isArray(r.paradas)) {
        r.paradas.forEach(function(p) { totalParadaMin += (p.duracao || 0); });
      } else if (r.parada) {
        totalParadaMin = r.parada;
      }
      if (totalParadaMin > 0 && (totalParadaMin / (horas * 60)) > 0.15) return;
      // "Mais recente" pra escolher a janela de sessões precisa refletir
      // QUANDO A PRODUÇÃO ACONTECEU, não quando alguém clicou em salvar --
      // mesmo cuidado já aplicado em form.html#updateOpRecordOnApontamento
      // pro Início/Término real da OP. Sem isso, um lançamento retroativo de
      // dias/semanas atrás (comum no Turno Retroativo) entrava na janela
      // como se fosse a sessão mais recente só por ter sido salva agora,
      // deslocando sessões de verdade mais recentes pra fora da amostra.
      // r.periodoFim (ISO real) tem prioridade; sem ele (apontamento em
      // tempo real, onde salvar == quando aconteceu), cai pro r.timestamp de
      // sempre.
      sessoes.push({
        ritmo: r.quantidade / horas,
        horas: horas,
        timestamp: r.periodoFim || r.timestamp || (date + 'T12:00:00')
      });
    });
  });
  return sessoes;
}

// Ritmo demonstrado: pega as sessões limpas mais recentes (até
// KURYOS_RITMO_JANELA_SESSOES), e devolve o percentil conservador delas
// (não a média) -- se o ritmo real oscila, planejar pelo percentil 25 erra
// pro lado de sobrar capacidade, não de faltar, que é a direção mais
// barata de errar numa fábrica. Exige amostra mínima antes de confiar
// (fonte:'demonstrado'); com menos que isso, quem chama deve cair pro
// fallback de sempre (mediaPorHora manual, depois prodHoraRef).
function kuryosRitmoDemonstrado(registrosPorData, filtro) {
  var sessoes = kuryosSessoesLimpas(registrosPorData, filtro);
  sessoes.sort(function(a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)); });
  sessoes = sessoes.slice(0, KURYOS_RITMO_JANELA_SESSOES);
  if (sessoes.length < KURYOS_RITMO_MIN_AMOSTRAS) {
    return { ritmo: 0, amostras: sessoes.length, fonte: 'insuficiente' };
  }
  var ritmos = sessoes.map(function(s) { return s.ritmo; });
  return {
    ritmo: Math.round(kuryosPercentil(ritmos, KURYOS_RITMO_PERCENTIL_CONSERVADOR)),
    amostras: ritmos.length,
    fonte: 'demonstrado'
  };
}

// Faixa de volume pra agrupar produtos comparáveis -- ver
// kuryosSugerirRitmoProdutoNovo. Fronteiras em mL (ou g, tratado igual).
function kuryosFaixaVolume(volume) {
  var v = parseFloat(volume);
  if (!v || v <= 0) return null;
  if (v < 100) return 'pequeno';
  if (v <= 500) return 'medio';
  return 'grande';
}

// Sugestão de ritmo pra produto sem histórico próprio ainda: mediana do
// ritmo demonstrado de produtos existentes na mesma viscosidade (campo já
// cadastrado em produtos.html) e faixa de volume -- são os dois fatores
// físicos que de fato determinam velocidade de envase (viscosidade
// domina; volume afeta o tempo de indexação na esteira), não densidade,
// que é usada em outro cálculo (conversão massa↔volume do lote).
// produtoAlvo: {viscosidade, volume}. todosProdutos: produtos/ já
// carregado. registrosPorData: registros/ já carregado. Devolve null se
// não achar nenhum produto comparável com histórico suficiente ainda --
// aí não tem outro jeito, cai pra referência manual mesmo.
function kuryosSugerirRitmoProdutoNovo(produtoAlvo, todosProdutos, registrosPorData) {
  if (!produtoAlvo || !produtoAlvo.viscosidade || !produtoAlvo.volume) return null;
  var faixaAlvo = kuryosFaixaVolume(produtoAlvo.volume);
  if (!faixaAlvo) return null;
  var ritmosComparaveis = [];
  Object.values(todosProdutos || {}).forEach(function(p) {
    if (!p || !p.viscosidade || p.viscosidade !== produtoAlvo.viscosidade) return;
    if (kuryosFaixaVolume(p.volume) !== faixaAlvo) return;
    var r = kuryosRitmoDemonstrado(registrosPorData, { produto: p.descricao });
    if (r.fonte === 'demonstrado') ritmosComparaveis.push(r.ritmo);
  });
  if (!ritmosComparaveis.length) return null;
  return {
    ritmo: Math.round(kuryosMediana(ritmosComparaveis)),
    baseadoEm: ritmosComparaveis.length,
    viscosidade: produtoAlvo.viscosidade,
    faixaVolume: faixaAlvo
  };
}

// ── Turnos extras (reforço temporário/pontual) ──────────────────────────
// Item 6 da conversa de auditoria: "2 turnos por 2-3 semanas", "sábado
// extra por 2 sábados seguidos" -- demanda extraordinária, sem tocar no
// padrão semanal permanente (config.turnos/diasSemana). Um registro em
// config.turnosExtras cobre os dois casos: {nome, dataInicio, dataFim,
// diasSemana (opcional -- se ausente, vale todo dia do período; se
// presente, ex: [6], só nesses dias da semana ISO dentro do período),
// horarioInicio, horarioFim, pausaInicio/pausaFim (opcional)}. Cadastro em
// admin.html; lido por horasEPausasDoDia() de planejamento.html e
// horizonte.html, somado às horas do turno normal do dia -- não substitui,
// adiciona.
function kuryosHorasExtrasDoDia(dateObj, turnosExtras) {
  var horasSet = {};
  var pausasSet = {};
  if (!turnosExtras) return { horasAtivas: [], pausas: [] };
  var ymd = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
  var dowIso = dateObj.getDay() === 0 ? 7 : dateObj.getDay();
  function expandRange(hIni, hFimExclusive) {
    var out = [];
    var h = ((hIni % 24) + 24) % 24;
    var hFim = ((hFimExclusive % 24) + 24) % 24;
    var guard = 0;
    while (h !== hFim && guard < 24) {
      out.push((h < 10 ? '0' + h : h) + ':00');
      h = (h + 1) % 24;
      guard++;
    }
    return out;
  }
  Object.values(turnosExtras).forEach(function(t) {
    if (!t || !t.dataInicio || !t.dataFim || !t.horarioInicio || !t.horarioFim) return;
    if (ymd < t.dataInicio || ymd > t.dataFim) return;
    if (Array.isArray(t.diasSemana) && t.diasSemana.length && t.diasSemana.indexOf(dowIso) === -1) return;
    var hIni = parseInt(t.horarioInicio.split(':')[0], 10);
    var fimParts = t.horarioFim.split(':');
    var hFim = parseInt(fimParts[0], 10) + (parseInt(fimParts[1] || '0', 10) > 0 ? 1 : 0);
    expandRange(hIni, hFim).forEach(function(h) { horasSet[h] = true; });
    if (t.pausaInicio && t.pausaFim) {
      var hp = parseInt(t.pausaInicio.split(':')[0], 10);
      var pFimParts = t.pausaFim.split(':');
      var hpFim = parseInt(pFimParts[0], 10) + (parseInt(pFimParts[1] || '0', 10) > 0 ? 1 : 0);
      expandRange(hp, hpFim).forEach(function(h) { horasSet[h] = true; pausasSet[h] = true; });
    }
  });
  return { horasAtivas: Object.keys(horasSet), pausas: Object.keys(pausasSet) };
}

function fmtHoraRange(hora) {
  if (!hora) return '?';
  var cleanHora = String(hora).replace('_', ':');
  var parts = cleanHora.split(':');
  var h = parseInt(parts[0]);
  if (isNaN(h)) return hora;
  var nextH = (h + 1) % 24;
  var nextHStr = (nextH < 10 ? '0' + nextH : nextH) + ':00';
  return cleanHora + 'h - ' + nextHStr + 'h';
}

// Pro feed/lista de registros: um apontamento_total (checkpoint de
// Intervalo/Encerrar Turno, form.html) representa um PERÍODO inteiro
// (periodoInicio até periodoFim), não uma hora só -- mostrar a hora do
// fechamento sozinha via fmtHoraRange (ex: "20h - 21h") pra um registro que
// na verdade cobre "07h - 12h" (ou até atravessa a virada do dia, numa
// linha que ficou aberta a noite inteira) é enganoso. Usa o período real
// sempre que o registro tiver periodoInicio/periodoFim -- não trava mais no
// tipo 'apontamento_total' especificamente, porque outros fluxos (fechar
// posto de trabalho, por exemplo) também podem carregar o período real e
// não tinham motivo pra ficar de fora dessa exibição. Cai pro comportamento
// de sempre (fmtHoraRange) só quando o registro genuinamente não tem
// período (apontamento hora-a-hora normal/retroativo, e o Finalizar OP
// legado do Modo Avançado, que ainda não grava período).
function fmtRegistroRange(r) {
  if (!r || !r.periodoInicio || !r.periodoFim) {
    return fmtHoraRange(r ? r.hora : null);
  }
  var ini = new Date(r.periodoInicio);
  var fim = new Date(r.periodoFim);
  if (isNaN(ini.getTime()) || isNaN(fim.getTime())) return fmtHoraRange(r.hora);
  function hm(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
  }
  var mesmoDia = ini.toDateString() === fim.toDateString();
  var prefixo = mesmoDia ? '' : (String(ini.getDate()).padStart(2, '0') + '/' + String(ini.getMonth() + 1).padStart(2, '0') + ' ');
  return prefixo + hm(ini) + 'h - ' + hm(fim) + 'h';
}

function horasDesde(isoInicio) {
  var ms = Date.now() - new Date(isoInicio).getTime();
  return Math.max(ms / 3600000, 0);
}

function isConcluido(pedido) {
  if (!pedido) return false;
  var status = String(pedido.status || '').toLowerCase().trim();
  var statusManual = String(pedido.statusManual || '').toLowerCase().trim();
  return status.indexOf('conclu') === 0 || statusManual === 'encerrado';
}

// Uma OP (ops/{lote}) conta como "ainda ativa" pra tudo que decide o que
// oferecer pro apontamento/planejamento (Alocar OP, grade, Andon, etc) --
// nem concluída nem cancelada. Centralizado aqui porque "status !== 'Concluído'"
// sozinho tratava uma OP cancelada como se ainda estivesse em aberto,
// deixando ela selecionável em form.html mesmo depois de cancelada.
function opEstaAtiva(op) {
  if (!op) return false;
  var status = String(op.status || '');
  return status !== 'Concluído' && status !== 'Cancelado';
}

// Produção de uma OP (ops/{lote}) é sempre rastreada como 3 somatórias
// DISTINTAS por setor -- Linha (envase), Rotulagem (rótulo), Posto de
// Trabalho -- nunca somadas num único número. Somar daria um total sem
// sentido físico (ex: 5.480 rótulos + 4.880 envasados não são "10.360
// unidades feitas" -- são contagens de processos diferentes, às vezes
// sobre os mesmos frascos, às vezes não). Ver [[kuryos-pcp-app-redesign]]
// e o caso real que motivou isso: OP 26215/03 aberta em Rotulagem e Linha
// 2 ao mesmo tempo.
function campoProduzido(tipo) {
  if (tipo === 'rotulagem') return 'produzidoRotulagem';
  if (tipo === 'posto') return 'produzidoPosto';
  return 'produzidoLinha';
}

// Lê o total de UM setor só. OPs de antes dessa separação só tinham um
// `produzido` compartilhado -- sempre implicitamente Linha (Rotulagem/Posto
// concorrentes na mesma OP não existiam como fluxo real até essa correção)
// -- por isso o fallback só vale pro tipo 'linha' (ou tipo indefinido).
function getProduzido(op, tipo) {
  if (!op) return 0;
  var campo = campoProduzido(tipo);
  if (op[campo] != null) return op[campo];
  return (tipo === 'linha' || !tipo) ? (op.produzido || 0) : 0;
}

// Deriva o status geral da OP. Decisão explícita do usuário pra esta
// primeira etapa beta: só a Linha decide "Concluído" -- Rotulagem e Posto
// continuam rastreados como somatórias 100% distintas em todo lugar (nunca
// somadas), mas o dado de Rotulagem ainda não é confiável o bastante pra
// bloquear/liberar o status geral da OP. Quando isso mudar, é só trocar
// `tipos` de volta pra incluir 'rotulagem'/'posto' -- o resto da função já
// generaliza pra qualquer lista de setores tocados.
function computeOpStatus(op) {
  if (!op || op.status === 'Cancelado') return op ? op.status : null;
  var planned = op.qtdPlanejada || 0;
  if (op.status === 'Concluído') return 'Concluído';
  if (!planned) return op.status || 'Não Iniciado';
  var tipos = ['linha'].filter(function(t) { return getProduzido(op, t) > 0; });
  if (!tipos.length) return op.status || 'Não Iniciado';
  var todosConcluidos = tipos.every(function(t) { return getProduzido(op, t) / planned >= 0.95; });
  return todosConcluidos ? 'Concluído' : 'Em Produção';
}

function toLocalISODate(date) {
  var d = date || new Date();
  var offset = d.getTimezoneOffset() * 60000;
  var local = new Date(d.getTime() - offset);
  return local.toISOString().split('T')[0];
}

function todayLocal() {
  return toLocalISODate(new Date());
}

function escapeHtml(str) {
  if (typeof str !== 'string') return str === undefined || str === null ? '' : String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (typeof str !== 'string') return str === undefined || str === null ? '' : String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/`/g, '&#96;');
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('pt-BR');
}

function normalizeSearch(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function cleanFutureSlots(pedidoId, dbRef) {
  if (!pedidoId) return Promise.resolve(0);
  var today = todayLocal();
  var currentHour = new Date().getHours();
  
  return dbRef.ref('programacao').once('value').then(function(snapshot) {
    var programacao = snapshot.val() || {};
    var updates = {};
    var count = 0;
    
    Object.keys(programacao).forEach(function(date) {
      if (date < today) return;
      
      var dayData = programacao[date] || {};
      Object.keys(dayData).forEach(function(hora) {
        var hourData = dayData[hora] || {};
        
        if (date === today) {
          var h = parseInt(hora.replace('_', ':').split(':')[0]);
          if (h < currentHour) return;
        }
        
        Object.keys(hourData).forEach(function(key) {
          if (key.indexOf('env') === 0) {
            var slot = hourData[key];
            if (slot && (slot.pedidoKey === pedidoId || slot.pedidoId === pedidoId)) {
              updates['programacao/' + date + '/' + hora + '/' + key] = null;
              count++;
            }
          }
        });
      });
    });
    
    if (count > 0) {
      return dbRef.ref().update(updates).then(function() {
        return count;
      });
    }
    return 0;
  });
}

// Irmã de cleanFutureSlots, mas pra quando uma OP (não o pedido inteiro) é
// cancelada -- só limpa o campo `lote` do slot (não o slot inteiro), porque
// o pedido pode continuar precisando daquela capacidade reservada, só não
// mais coberta por essa OP específica que foi cancelada. Uma nova OP pode
// ser vinculada ao mesmo slot depois.
function clearLoteFromFutureSlots(lote, dbRef) {
  if (!lote) return Promise.resolve(0);
  var today = todayLocal();
  var currentHour = new Date().getHours();

  return dbRef.ref('programacao').once('value').then(function(snapshot) {
    var programacao = snapshot.val() || {};
    var updates = {};
    var count = 0;

    Object.keys(programacao).forEach(function(date) {
      if (date < today) return;

      var dayData = programacao[date] || {};
      Object.keys(dayData).forEach(function(hora) {
        var hourData = dayData[hora] || {};

        if (date === today) {
          var h = parseInt(hora.replace('_', ':').split(':')[0]);
          if (h < currentHour) return;
        }

        Object.keys(hourData).forEach(function(key) {
          if (key.indexOf('env') === 0) {
            var slot = hourData[key];
            if (slot && slot.lote === lote) {
              updates['programacao/' + date + '/' + hora + '/' + key + '/lote'] = null;
              count++;
            }
          }
        });
      });
    });

    if (count > 0) {
      return dbRef.ref().update(updates).then(function() {
        return count;
      });
    }
    return 0;
  });
}

// Substituto de <input list="..."> + <datalist> -- em celular (Android/iOS)
// o datalist nativo renderiza como uma barra horizontal de sugestões colada
// no teclado (igual corretor de palavras), sem scroll vertical decente,
// muito ruim de usar. Isto desenha uma lista suspensa de verdade, com
// scroll, tocável, que funciona igual em desktop e mobile.
// getItems() deve devolver um array de {value, label} (value = o que entra
// no input ao selecionar; label = o que aparece na lista, igual à semântica
// de datalist onde value/textContent podem ser diferentes).
function attachAutocomplete(input, getItems, opts) {
  if (!input) return;
  opts = opts || {};

  var list = document.createElement('div');
  list.className = 'kt-ac-list';
  document.body.appendChild(list);

  var currentItems = [];
  var activeIndex = -1;
  var suppressNextRender = false;

  function norm(s) { return String(s || '').toLowerCase(); }

  function position() {
    var r = input.getBoundingClientRect();
    var spaceBelow = window.innerHeight - r.bottom;
    list.style.left = r.left + 'px';
    list.style.width = r.width + 'px';
    if (spaceBelow < 180 && r.top > spaceBelow) {
      list.style.top = '';
      list.style.bottom = (window.innerHeight - r.top + 2) + 'px';
    } else {
      list.style.bottom = '';
      list.style.top = (r.bottom + 2) + 'px';
    }
  }

  function highlight() {
    Array.prototype.forEach.call(list.children, function(el, i) {
      el.classList.toggle('active', i === activeIndex);
    });
    if (activeIndex >= 0 && list.children[activeIndex]) {
      list.children[activeIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function hide() {
    list.classList.remove('open');
    activeIndex = -1;
  }

  function select(i) {
    var it = currentItems[i];
    if (!it) return;
    input.value = it.value;
    hide();
    // Dispara 'input' pra quem mais escuta esse campo (parsing de hint, etc.
    // -- mesmo evento que uma seleção de <datalist> nativo dispararia), mas
    // sem deixar o próprio render() deste componente reabrir a lista se
    // filtrando o valor recém-preenchido contra si mesmo.
    suppressNextRender = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (opts.onSelect) opts.onSelect(it);
  }

  function render() {
    if (suppressNextRender) { suppressNextRender = false; return; }
    var query = norm(input.value);
    var all = (getItems() || []).map(function(it) {
      return typeof it === 'string' ? { value: it, label: it } : it;
    });
    currentItems = query ? all.filter(function(it) { return norm(it.label).indexOf(query) !== -1; }) : all;
    activeIndex = -1;
    if (!currentItems.length) { hide(); return; }
    list.innerHTML = '';
    currentItems.slice(0, 200).forEach(function(it, i) {
      var row = document.createElement('div');
      row.className = 'kt-ac-item';
      row.textContent = it.label;
      row.addEventListener('mousedown', function(e) {
        e.preventDefault(); // evita o blur do input fechar a lista antes do clique registrar
        select(i);
      });
      list.appendChild(row);
    });
    position();
    list.classList.add('open');
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', function() { setTimeout(hide, 150); });
  input.addEventListener('keydown', function(e) {
    if (!list.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, currentItems.length - 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlight(); }
    else if (e.key === 'Enter') { if (activeIndex >= 0) { e.preventDefault(); select(activeIndex); } else { hide(); } }
    else if (e.key === 'Escape') { hide(); }
  });
  window.addEventListener('scroll', function() { if (list.classList.contains('open')) position(); }, true);
  window.addEventListener('resize', function() { if (list.classList.contains('open')) position(); });
}

// Contador sequencial seguro contra corrida (dois admins clicando "Novo" ao
// mesmo tempo nunca geram o mesmo número) -- usa .transaction() do RTDB, que
// resolve no servidor mesmo com dois clientes escrevendo ao mesmo tempo.
// Reaproveitado pela geração de código de SKU (produtos.html) e depois pela
// numeração de Compras/emissão de OP. `counterPath` é um nó numérico simples
// em config/contadores/*; `prefix`/`pad` só formatam o resultado, não afetam
// o contador em si.
function nextSequential(dbRef, counterPath, prefix, pad) {
  return dbRef.ref(counterPath).transaction(function(cur) {
    return (cur || 0) + 1;
  }).then(function(result) {
    var n = result.snapshot.val();
    var formatted = prefix
      ? prefix + '-' + String(n).padStart(pad || 4, '0')
      : String(n).padStart(pad || 4, '0');
    return { numero: n, formatado: formatted };
  });
}

// Ordenação clicável de coluna, reaproveitada em toda tabela de listagem
// de cadastros.html (Materiais/Produtos/Clientes/Fornecedores/
// Transportadoras). Cada th ordenável leva `data-sort="campo"` no HTML;
// `campo` é o nome da propriedade no objeto de dado da linha (pra coluna
// que mistura mais de um campo na exibição, ex: "Contato" = nome+e-mail,
// usa o campo mais relevante pra ordenar, não recria a concatenação).
// Uso: 1) var sortable = makeSortableTable(theadEl, 'campoPadrao', 'asc');
//      2) sortable.wireHeaders(renderFn) uma vez, no boot da aba;
//      3) dentro de renderFn: rows = sortable.applySort(rows, function(r){return r[1].campo;});
function makeSortableTable(theadEl, defaultField, defaultDir) {
  var state = { field: defaultField, dir: defaultDir || 'asc' };
  function applySort(rows, fieldGetter) {
    var field = state.field, mult = state.dir === 'asc' ? 1 : -1;
    return rows.slice().sort(function(a, b) {
      var va = fieldGetter(a, field); var vb = fieldGetter(b, field);
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
      if (typeof va === 'boolean' || typeof vb === 'boolean') return ((va ? 1 : 0) - (vb ? 1 : 0)) * mult;
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' }) * mult;
    });
  }
  function updateIndicators() {
    if (!theadEl) return;
    theadEl.querySelectorAll('th[data-sort]').forEach(function(th) {
      if (!th.dataset.origLabel) th.dataset.origLabel = th.textContent.trim();
      var active = th.getAttribute('data-sort') === state.field;
      th.textContent = th.dataset.origLabel + (active ? (state.dir === 'asc' ? ' ▲' : ' ▼') : '');
      th.classList.toggle('th-sort-active', active);
    });
  }
  function wireHeaders(onSortChange) {
    if (!theadEl) return;
    theadEl.querySelectorAll('th[data-sort]').forEach(function(th) {
      th.classList.add('th-sortable');
      th.addEventListener('click', function() {
        var field = th.getAttribute('data-sort');
        if (state.field === field) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.field = field; state.dir = 'asc'; }
        updateIndicators();
        onSortChange();
      });
    });
    updateIndicators();
  }
  return { state: state, applySort: applySort, wireHeaders: wireHeaders };
}

// ── Explosão de materiais (Fórmula + BOM) por quantidade planejada ──────
// Usado por emitir_op.html (cópia local, não tocada -- já testada em
// produção) e por compras.html (Necessidade de Compra, gerar solicitação a
// partir de um pedido) -- os dois precisam do MESMO cálculo, senão a
// quantidade sugerida na compra diverge da que a OP de fato vai consumir.
function parseVersaoNum(v) { return parseInt(String(v || 'v0').replace(/[^\d]/g, ''), 10) || 0; }
function chaveVersao(codProduto, versao) { return codProduto + '__' + versao; }

// Prefere a versão APROVADA mais recente; sem nenhuma aprovada, cai pra
// mais recente de qualquer status (com temAprovada:false pro chamador
// decidir se avisa/bloqueia).
function melhorFormulaDoProduto(codProduto, allFormulas) {
  var versoes = Object.values(allFormulas || {}).filter(function(f) { return f && f.codProduto === codProduto; });
  if (!versoes.length) return null;
  var aprovadas = versoes.filter(function(f) { return f.status === 'APROVADA'; });
  var pool = aprovadas.length ? aprovadas : versoes;
  pool.sort(function(a, b) { return parseVersaoNum(b.versao) - parseVersaoNum(a.versao); });
  return { registro: pool[0], temAprovada: aprovadas.length > 0 };
}

// Só sabe calcular fisicamente a partir de ml/L -- outras unidades (g/kg/un)
// bloqueiam com erro explícito em vez de um número silenciosamente errado.
function volumeNominalEmLitros(produto) {
  var vol = parseFloat(produto.volume) || 0;
  var un = (produto.unidadeVolume || 'ml').toLowerCase();
  if (un === 'ml') return { litros: vol / 1000, ok: true };
  if (un === 'l') return { litros: vol, ok: true };
  return { litros: 0, ok: false, unidade: produto.unidadeVolume };
}

// Mesma matemática de montarMateriaisConsumo() em emitir_op.html, só que
// sem o estado de "substituição de item" (não existe nesse contexto --
// aqui é só sugestão de compra, ainda não é uma OP de verdade).
// `pecas` = quantidade de unidades a produzir (ex: saldo em aberto do
// pedido, não necessariamente o pedido inteiro).
// Retorna { ok, erro?, itens: [{mpCodigo, mpNome, quantidade, unidade, origem}], massaLoteKg, volumeGranelL }
function explodirMateriaisNecessarios(produto, pecas, formula, bom, materiaisCache) {
  var volInfo = volumeNominalEmLitros(produto);
  if (!volInfo.ok) return { ok: false, erro: 'Produto cadastrado com unidade de volume "' + (volInfo.unidade || '—') + '" -- só sei calcular a partir de ml ou L.' };
  var densidade = parseFloat(produto.densidadeGranel) || 0;
  if (!volInfo.litros || !densidade || !pecas) return { ok: false, erro: 'Faltam dados pra calcular (volume nominal, densidade de granel ou quantidade).' };

  var overfillPct = parseFloat(produto.overfillPct) || 0;
  var perdaProcessoPct = parseFloat(produto.perdaProcessoPct) || 0;
  var volumeTeoricoFinalMlPorUn = (volInfo.litros * (1 + overfillPct / 100)) * 1000;
  var volumeGranelL = pecas * volumeTeoricoFinalMlPorUn * (1 + perdaProcessoPct / 100) / 1000;
  var massaLoteKg = volumeGranelL * densidade;

  var itens = [];
  Object.values((formula && formula.itens) || {}).forEach(function(it) {
    itens.push({
      mpCodigo: it.mpCodigo, mpNome: it.mpNome,
      quantidade: Math.round((massaLoteKg * (it.percentualMM || 0) / 100) * 1000) / 1000,
      unidade: 'kg', origem: 'formula'
    });
  });
  Object.values((bom && bom.itens) || {}).forEach(function(it) {
    var matCadastrado = materiaisCache ? (materiaisCache[sanitizeKey(it.materialCodigo)] || Object.values(materiaisCache).find(function(m) { return m.mpCodigo === it.materialCodigo; })) : null;
    itens.push({
      mpCodigo: it.materialCodigo, mpNome: it.materialNome,
      quantidade: Math.round((pecas * (it.qtdPorPeca || 0)) * 1000) / 1000,
      unidade: (matCadastrado && matCadastrado.unidade) || 'un', origem: 'bom'
    });
  });

  return { ok: true, itens: itens, massaLoteKg: Math.round(massaLoteKg * 1000) / 1000, volumeGranelL: Math.round(volumeGranelL * 1000) / 1000 };
}

// ── Ajuste de saldo de estoque (Fase 4) ─────────────────────────────────
// Único ponto que escreve em estoque/{materialKey} -- usado por
// logistica.html (entrada por recebimento), form.html (baixa por consumo
// real de produção e por perda com material específico). `delta` pode ser
// positivo (entrada) ou negativo (saída); `dbRef` é a instância `db` de
// quem chama (mesmo padrão de nextSequential). Sempre .transaction() --
// dois ajustes concorrentes no mesmo material nunca se perdem um no outro.
function ajustarEstoque(dbRef, materialCodigo, delta, tipoMovimentacao, ref, extras) {
  if (!materialCodigo || !delta) return Promise.resolve();
  extras = extras || {};
  var key = sanitizeKey(materialCodigo);
  return dbRef.ref('estoque/' + key).transaction(function(atual) {
    atual = atual || { saldoAtual: 0 };
    atual.saldoAtual = (atual.saldoAtual || 0) + delta;
    atual.materialCodigo = materialCodigo;
    if (extras.materialNome) atual.materialNome = extras.materialNome;
    if (extras.unidade) atual.unidade = extras.unidade;
    atual.ultimaAtualizacao = new Date().toISOString();
    atual.ultimaMovimentacao = { tipo: tipoMovimentacao, qtd: delta, ref: ref || null, em: new Date().toISOString() };
    return atual;
  });
}

// ── Estoque empenhado/reservado (Fase 4c) ───────────────────────────────
// Saldo físico (saldoAtual, acima) e saldo empenhado são dois números
// DIFERENTES no mesmo nó estoque/{materialKey}: saldoAtual é o que tem
// fisicamente em fábrica; saldoEmpenhado é quanto disso já está comprometido
// por OPs emitidas mas ainda não totalmente apontadas. saldoDisponivel
// (= saldoAtual - saldoEmpenhado) é o que sobra pra novos compromissos --
// sempre CALCULADO na leitura (compras.html), nunca gravado, pra nunca
// divergir dos dois números-fonte.
//
// empenhos/{loteKey} dentro de cada material é o índice que permite reduzir
// ou liberar o empenho de um lote específico sem precisar varrer todo mundo
// -- criado na emissão (empenharMateriais), reduzido a cada apontamento real
// (baixarEmpenho, mesmo delta que já sai do saldo físico) e zerado quando a
// OP termina ou é cancelada (liberarEmpenhoLote), soltando de volta pro
// disponível qualquer sobra entre o teórico empenhado e o real consumido.

// Chamado na emissão da OP (emitir_op.html) -- reserva cada material do
// materiaisConsumo recém-calculado. Best-effort: se falhar, não desfaz a
// emissão (a OP já existe; o empenho é um reflexo dela, não pré-requisito).
function empenharMateriais(dbRef, lote, sku, itens) {
  if (!lote || !itens || !itens.length) return Promise.resolve();
  var loteKey = sanitizeKey(lote);
  var agora = new Date().toISOString();
  return Promise.all(itens.map(function(it) {
    if (!it.mpCodigo || !it.quantidade) return Promise.resolve();
    var key = sanitizeKey(it.mpCodigo);
    return dbRef.ref('estoque/' + key).transaction(function(atual) {
      atual = atual || { saldoAtual: 0 };
      atual.saldoEmpenhado = (atual.saldoEmpenhado || 0) + it.quantidade;
      atual.materialCodigo = it.mpCodigo;
      if (it.mpNome) atual.materialNome = it.mpNome;
      atual.empenhos = atual.empenhos || {};
      atual.empenhos[loteKey] = { lote: lote, sku: sku || '', qtdEmpenhada: it.quantidade, criadoEm: agora, atualizadoEm: agora };
      return atual;
    });
  }));
}

// Chamado a cada apontamento real de produção (form.html, junto com
// ajustarEstoque do consumo físico) -- reduz o empenho daquele lote na MESMA
// quantidade que acabou de sair do físico, pra o empenhado ir refletindo a
// realidade conforme a OP avança. Nunca vai negativo; se não havia empenho
// pra esse lote/material (ex: OP emitida antes desta função existir), não
// desconta nada em vez de criar um saldo negativo sem sentido.
function baixarEmpenho(dbRef, lote, materialCodigo, qtd) {
  if (!lote || !materialCodigo || !qtd) return Promise.resolve();
  var loteKey = sanitizeKey(lote);
  var key = sanitizeKey(materialCodigo);
  return dbRef.ref('estoque/' + key).transaction(function(atual) {
    if (!atual || !atual.empenhos || !atual.empenhos[loteKey]) return atual;
    var emp = atual.empenhos[loteKey];
    var abatido = Math.min(qtd, emp.qtdEmpenhada || 0);
    var novoQtd = Math.round(((emp.qtdEmpenhada || 0) - abatido) * 1000) / 1000;
    atual.saldoEmpenhado = Math.max(0, Math.round(((atual.saldoEmpenhado || 0) - abatido) * 1000) / 1000);
    if (novoQtd <= 0) {
      delete atual.empenhos[loteKey];
    } else {
      atual.empenhos[loteKey] = { lote: emp.lote, sku: emp.sku, qtdEmpenhada: novoQtd, criadoEm: emp.criadoEm, atualizadoEm: new Date().toISOString() };
    }
    return atual;
  });
}

// Chamado quando a OP conclui (~95% do planejado, mesmo critério de
// computeOpStatus) ou é cancelada -- libera de volta pro disponível
// qualquer sobra entre o que foi empenhado na emissão e o que realmente
// foi consumido via baixarEmpenho ao longo da produção. `materiaisCodigos`
// vem de Object.values(op.materiaisConsumo) -- a OP já carrega essa lista,
// não precisa varrer o estoque inteiro procurando quem reservou esse lote.
function liberarEmpenhoLote(dbRef, lote, materiaisCodigos) {
  if (!lote || !materiaisCodigos || !materiaisCodigos.length) return Promise.resolve();
  var loteKey = sanitizeKey(lote);
  return Promise.all(materiaisCodigos.map(function(mpCodigo) {
    if (!mpCodigo) return Promise.resolve();
    var key = sanitizeKey(mpCodigo);
    return dbRef.ref('estoque/' + key).transaction(function(atual) {
      if (!atual || !atual.empenhos || !atual.empenhos[loteKey]) return atual;
      var restante = atual.empenhos[loteKey].qtdEmpenhada || 0;
      atual.saldoEmpenhado = Math.max(0, Math.round(((atual.saldoEmpenhado || 0) - restante) * 1000) / 1000);
      delete atual.empenhos[loteKey];
      return atual;
    });
  }));
}

// ── Padrão de etiqueta de identificação do fornecedor ───────────────────
// Campos obrigatórios na etiqueta que o fornecedor cola nas caixas/fardos
// entregues -- usado por compras.html (mostra o padrão + manda no e-mail de
// cotação) e logistica.html (checklist de conferência no recebimento).
// ATENÇÃO: existe uma cópia equivalente em functions/index.js (o corpo do
// e-mail de cotação é montado no servidor) -- se mudar aqui, muda lá também.
var PADRAO_ETIQUETA_FORNECEDOR = [
  { campo: 'codigoMaterial', label: 'Código do material (o mesmo do cadastro Kuryos)' },
  { campo: 'descricao', label: 'Descrição do material' },
  { campo: 'loteDataFabricacao', label: 'Lote e data de fabricação' },
  { campo: 'quantidadeUnidade', label: 'Quantidade, com a unidade explícita (kg/L/un)' },
  { campo: 'pesoBrutoLiquido', label: 'Peso bruto × peso líquido (quando vendido por peso)' },
  { campo: 'fornecedor', label: 'Fornecedor (razão social ou nome fantasia)' },
  { campo: 'referenciaPC', label: 'Referência do Pedido de Compra Kuryos' },
  { campo: 'clientePedido', label: 'Cliente dono do pedido' },
  { campo: 'validade', label: 'Validade do material' },
  { campo: 'numeroVolumes', label: 'Número de volumes (ex: 2 de 5), se a entrega vier fracionada' },
  { campo: 'codigoBarras', label: 'Código de barras ou QR (material + lote)' }
];
