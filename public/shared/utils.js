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

// Remove acentos/diacríticos mantendo a letra base (á->a, ç->c, ã->a...).
// Achado do usuário (Busca Avançada de Materiais, campo Formato):
// "CILÍNDRICO" e "CILINDRICO" eram tratados como valores diferentes em
// toda busca/filtro/comparação -- nenhuma página do app tirava acento,
// só maiúscula (ver `.uc`, cadastros.html). Cada página ainda mantém sua
// própria função `norm()` local (não centralizada aqui ainda -- ver nota
// em cadastros.html); esta função é o bloco de construção reaproveitável
// pra ir fechando essa lacuna página por página.
function stripAccents(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '');
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
  // 'Aguardando Confirmação' (Fase 7 do plano de Planejamento/PCP -- ver
  // computeOpStatus) entra no mesmo balde de Concluído/Cancelado aqui: o
  // operador já fechou a OP (registrou quantidade final, liberou a linha),
  // só falta o PCP confirmar -- não deve mais aparecer como disponível pra
  // nova alocação/apontamento em nenhuma lista.
  return status !== 'Concluído' && status !== 'Cancelado' && status !== 'Aguardando Confirmação';
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
  // Fase 7 do plano (PLANO_PLANEJAMENTO_PCP.md): conclusão de OP é 100%
  // manual pelo PCP, sem exceção, nunca automática/silenciosa -- decisão
  // que responde diretamente ao problema original da sessão (OP com 800
  // produzido de 1000 planejados "finalizando" sozinha, sem ninguém
  // confirmar, até 5% de perda invisível em qualquer relatório). Uma vez
  // 'Concluído' (só gravado por confirmação explícita do PCP em ops.html)
  // ou 'Aguardando Confirmação' (gravado quando um operador fecha a OP,
  // ou quando a produção bate a meta sozinha, ver abaixo), o valor é
  // pegajoso -- essa função nunca reverte pra trás.
  if (op.status === 'Concluído' || op.status === 'Aguardando Confirmação') return op.status;
  if (!planned) return op.status || 'Não Iniciado';
  var tipos = ['linha'].filter(function(t) { return getProduzido(op, t) > 0; });
  if (!tipos.length) return op.status || 'Não Iniciado';
  var noAlvo = tipos.every(function(t) { return getProduzido(op, t) / planned >= 0.95; });
  return noAlvo ? 'Aguardando Confirmação' : 'Em Produção';
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

// Copia texto pra área de transferência com fallback pra navegador/webview
// sem Clipboard API -- promovido de horizonte.html (copyCodigo/
// fallbackCopyCodigo) pra cá, reaproveitado agora também em compras.html
// (texto padrão de solicitação de cotação). onSuccess roda depois que a
// cópia (real ou fallback) terminou, pra quem chamou dar o feedback visual.
function copyTextToClipboard(text, onSuccess) {
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    if (onSuccess) onSuccess();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(fallback);
  } else {
    fallback();
  }
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

// Nome de exibi\u00e7\u00e3o de um fornecedor (fornecedores/{key}) -- nomeFantasia
// tem prioridade, cai pra razaoSocial quando n\u00e3o preenchido. Extra\u00edda pra
// c\u00e1 (era duplicada em materiais.html) porque agora tamb\u00e9m \u00e9 usada em
// formulas.html (F\u00f3rmula/BOM), pedido do usu\u00e1rio: "indicar ao lado do
// nome, o fornecedor" -- uma fun\u00e7\u00e3o s\u00f3, pra nunca divergir entre as duas
// telas se o crit\u00e9rio de exibi\u00e7\u00e3o mudar (ex: incluir CNPJ) um dia.
function fornecedorNome(f) {
  return f ? (f.nomeFantasia || f.razaoSocial || '') : '';
}

// Rótulo de um material pro campo de busca (Fórmula/BOM) -- "CODIGO —
// NOME" + fornecedor quando há um vinculado. Pedido do usuário: "indicar
// ao lado do nome, o fornecedor" + "ter a opção de pesquisar o item pelo
// nome, fornecedor, codigo, ao invés de só selecionar" -- como o
// attachAutocomplete filtra por substring dentro do label inteiro, colocar
// o fornecedor no label já faz a busca por fornecedor funcionar de graça,
// sem precisar de lógica de filtro separada. `fornecedor` já resolvido
// (objeto de fornecedores/{key} ou null/undefined) -- função não faz
// lookup sozinha, quem chama já tem os dados carregados.
function materialBuscaLabel(m, fornecedor) {
  if (!m) return '';
  var base = (m.mpCodigo || '') + ' — ' + (m.mpNome || '');
  var forn = fornecedorNome(fornecedor);
  return forn ? (base + ' · Fornecedor: ' + forn) : base;
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
    // Transação abortada (concorrência, regra negada, conexão) devolvia
    // committed:false com snapshot nulo -- e o número saía como "SC-null",
    // "PC-null" ou lote "26251/null", gravado de forma permanente num
    // documento que vai pro fornecedor ou pro chão de fábrica.
    // Falhar alto é melhor: todo chamador já trata erro mostrando alerta, e
    // um número ausente é recuperável, um número corrompido não.
    if (!result.committed || n == null || isNaN(n)) {
      throw new Error('Não foi possível reservar o próximo número em ' + counterPath +
        '. Nada foi gravado — tente de novo.');
    }
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
//
// Fórmula, BOM e Especificação têm aprovação PRÓPRIA e independente
// (pedido do usuário: "o certo é ter 3 aprovações, da formula, do bom e
// da spec"), cada uma no seu próprio nó (formulas/bom/especificacoes,
// mesma chave). allBom/allEspecificacoes são OPCIONAIS -- quando o
// chamador não passa (compras.html gerando solicitação de compra,
// form.html baixando estoque no apontamento -- os dois já existiam antes
// dessa mudança e nunca devem ficar bloqueados por um campo de aprovação
// que não existia quando foram escritos), "aprovada" continua olhando só
// a Fórmula, exatamente como sempre foi. Só quando os 3 argumentos são
// passados (emitir_op.html) uma versão passa a contar como aprovada
// quando Fórmula, BOM E Especificação estiverem TODAS com status
// APROVADA.
function melhorFormulaDoProduto(codProduto, allFormulas, allBom, allEspecificacoes) {
  var versoes = Object.values(allFormulas || {}).filter(function(f) { return f && f.codProduto === codProduto; });
  if (!versoes.length) return null;
  var exigeTudo = !!(allBom && allEspecificacoes);
  var aprovadas = versoes.filter(function(f) {
    if (f.status !== 'APROVADA') return false;
    if (!exigeTudo) return true;
    var key = chaveVersao(codProduto, f.versao);
    var b = allBom[key], e = allEspecificacoes[key];
    return !!(b && b.status === 'APROVADA') && !!(e && e.status === 'APROVADA');
  });
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
//
// WMS Fase 1: mapa tipo (código técnico, o que sempre existiu em
// ultimaMovimentacao.tipo) -> motivo (nome humano da lista fechada
// gerenciada em Cadastros > Categorias, config/motivosMovimentoEstoque).
// Cobre só os tipos AUTOMÁTICOS que já passam por ajustarEstoque hoje --
// ações manuais (transferência entre endereços, saída manual) deixam o
// usuário escolher o motivo na tela, não usam este mapa.
var MOTIVO_POR_TIPO_MOVIMENTACAO = {
  recebimento_pc: 'RECEBIMENTO',
  consumo_producao: 'CONSUMO DE PRODUÇÃO',
  perda: 'PERDA',
  ajuste_manual: 'AJUSTE DE INVENTÁRIO'
};
function motivoPadraoPorTipoMovimentacao(tipo) {
  return MOTIVO_POR_TIPO_MOVIMENTACAO[tipo] || 'OUTRO';
}

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
  }).then(function(resultado) {
    // WMS Fase 1: ultimaMovimentacao acima só guarda a ÚLTIMA movimentação
    // (sobrescrita a cada chamada) -- sem histórico nenhum de tudo que já
    // aconteceu antes. movimentos_estoque é um log append-only (push),
    // alimentado automaticamente por QUALQUER chamada a ajustarEstoque --
    // os 3 pontos de chamada existentes (logistica.html, form.html x2)
    // ganham log completo sem precisar editar nenhum deles. Best-effort:
    // se o push falhar, não desfaz o ajuste de saldo (que já é a fonte de
    // verdade) -- o log é um reflexo dele, não pré-requisito.
    var novoSaldo = (resultado && resultado.committed && resultado.snapshot && resultado.snapshot.val()) ? resultado.snapshot.val().saldoAtual : null;
    dbRef.ref('movimentos_estoque/' + key).push({
      tipo: tipoMovimentacao || null,
      motivo: motivoPadraoPorTipoMovimentacao(tipoMovimentacao),
      qtd: delta, saldoApos: novoSaldo, ref: ref || null,
      itemTipo: 'material', itemCodigo: materialCodigo,
      itemNome: extras.materialNome || null, unidade: extras.unidade || null,
      autor: extras.autor || null, em: new Date().toISOString()
    }).catch(function(err) { console.error('Falha ao gravar log de movimentação de estoque:', err); });
    return resultado;
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

// Gera/atualiza os enderecos_estoque de UMA rua a partir da Estrutura de
// Ruas (rua × nível × prédio -- prédio ímpar=esquerdo, par=direito) --
// usado tanto em cadastros.html (aba Endereços) quanto em estoque.html
// (mesmo botão "Salvar e Gerar Posições" nos dois lugares, pedido do
// usuário: "vale ter na aba cadastro e na aba... onde precisamos
// executar" -- uma lógica só, chamada dos dois pontos, pra nunca divergir
// se um dia precisar mudar a regra de geração). Só MONTA o objeto de
// updates (não escreve nada sozinho) -- quem chama decide o `estrutura_
// ruas/{codigoRua}` e faz o `db.ref().update(updates)`. Nunca apaga/move
// uma posição já ocupada (ocupantesPorEndereco vem de fora -- quem chama
// já tem os dados carregados, evita esta função ter que ler
// estoque_lotes sozinha) -- cria as que faltam, reatualiza a área das que
// ainda estão vazias, e REMOVE as que ficaram de fora quando a estrutura
// encolhe (níveis/prédios reduzidos), desde que estejam vazias -- senão
// "Posições geradas" ficava contando pra sempre sobra de uma configuração
// antiga.
// Monta o código de uma posição a partir da sigla da área + rua/nível/prédio.
// Fica numa função só porque 4 lugares diferentes montavam essa string à mão
// (geração de posições, mapa por rua, planta baixa em 2 pontos) -- e um
// divergir dos outros significaria a tela desenhar posições que não existem.
//
// A sigla entrou porque o número da rua era GLOBAL: com as 236 posições todas
// no galpão isso não incomodava, mas ao cadastrar as outras áreas a "Rua 1 da
// fábrica" colidiria com a "Rua 1 do galpão". O prefixo resolve os dois
// problemas de uma vez -- a colisão de chave (a chave deriva do código) e o
// problema humano de uma etiqueta "1.2.3" não dizer em que prédio está.
//
// Sem sigla, devolve o formato antigo (`1.2.3`) -- mantém compatível
// enquanto a migração não rodou e com qualquer dado legado.
function montarCodigoEndereco(sigla, codigoRua, nivel, predio) {
  return (sigla ? sigla + '-' : '') + codigoRua + '.' + nivel + '.' + predio;
}

// Chave de uma rua em estrutura_ruas. Antes era só o número (global, colidia
// entre áreas); agora é sigla+número, então cada área tem sua própria "Rua 1".
function chaveRua(sigla, codigoRua) {
  return (sigla ? sigla + '-' : '') + codigoRua;
}

function gerarUpdatesPosicoesRua(codigoRua, area, niveis, predios, enderecosExistentes, ocupantesPorEndereco, autor, sigla) {
  var updates = {};
  var agora = new Date().toISOString();
  for (var nivel = 1; nivel <= niveis; nivel++) {
    for (var predio = 1; predio <= predios; predio++) {
      var codigo = montarCodigoEndereco(sigla, codigoRua, nivel, predio);
      var key = sanitizeKey(codigo);
      var existente = enderecosExistentes[key];
      var ocupada = (ocupantesPorEndereco[key] || 0) > 0;
      if (!existente) {
        updates['enderecos_estoque/' + key] = {
          codigo: codigo, rua: codigoRua, nivel: nivel, predio: predio, area: area,
          // sigla guardada na própria posição: quem lê um endereço solto
          // (movimento, lote, contagem) sabe a que área pertence sem ter que
          // voltar em estrutura_ruas
          sigla: sigla || null,
          ativo: true, geradoDe: chaveRua(sigla, codigoRua), criadoEm: agora, criadoPor: autor
        };
      } else if (!ocupada && existente.area !== area) {
        updates['enderecos_estoque/' + key + '/area'] = area;
      }
    }
  }
  // Estrutura ENCOLHEU (menos níveis/prédios que antes de editar a rua) --
  // as posições que ficaram de fora do novo tamanho não existem mais
  // fisicamente. Sem isto, "Posições geradas" ficava contando pra sempre
  // as sobras da configuração antiga (bug real reportado pelo usuário:
  // "esta aparecendo posicoes geradas 72 de 36" -- rua tinha 6 níveis x 12
  // prédios = 72 antes, editada pra 3 níveis = 36, e as 36 do nível 4/5/6
  // continuavam contando pra sempre). Só remove as que estão VAZIAS --
  // nunca apaga uma posição ocupada (item real parado lá precisa ser
  // transferido por alguém antes de a posição deixar de existir).
  Object.keys(enderecosExistentes).forEach(function(key) {
    var e = enderecosExistentes[key];
    if (!e || e.rua !== codigoRua) return;
    // Compara TAMBÉM a sigla: desde que o número da rua passou a ser por
    // área, "rua 1" existe em mais de um lugar. Sem isto, encolher a rua 1
    // do galpão apagaria as posições fora de tamanho da rua 1 da fábrica.
    // `|| null` dos dois lados pra '' e undefined caírem no mesmo caso
    // (dado legado, antes da migração de siglas).
    if ((e.sigla || null) !== (sigla || null)) return;
    var foraDoNovoTamanho = e.nivel > niveis || e.predio > predios;
    if (!foraDoNovoTamanho) return;
    var ocupada = (ocupantesPorEndereco[key] || 0) > 0;
    if (!ocupada) updates['enderecos_estoque/' + key] = null;
  });
  return updates;
}

// Mapa visual do armazém -- um grid por rua (nível como linha, do mais alto
// pro mais baixo, igual se lê uma estante de verdade; prédio como coluna),
// pedido do usuário: "conseguimos criar um mapa visual do wms, como no
// excel que passei... ou até melhor construído". Reaproveitada em
// cadastros.html e estoque.html (mesmo princípio de gerarUpdatesPosicoesRua
// -- uma função só, nunca duas implementações divergindo). Só MONTA o HTML
// (string) -- não tem clique nenhum embutido aqui; cada página wireia o
// clique via delegação, lendo data-endereco-key/data-codigo pra abrir o
// detalhe com os dados que ela já tem carregados (estoque_lotes).
function mapaVisualRuasHtml(estruturaRuas, enderecosEstoque, ocupantesPorEndereco) {
  var ruas = Object.values(estruturaRuas || {}).sort(function(a, b) { return (a.codigoRua || 0) - (b.codigoRua || 0); });
  if (!ruas.length) return '<div class="empty-hint">Nenhuma rua cadastrada ainda -- gere posições em "Estrutura de Ruas" primeiro.</div>';
  return ruas.map(function(r) {
    var niveis = r.niveis || 0, predios = r.predios || 0;
    var linhasHtml = '';
    // Nível mais alto primeiro (topo da tela) -- é como se lê uma estante de
    // verdade, olhando de baixo pra cima fica invertido do que a pessoa vê.
    for (var nivel = niveis; nivel >= 1; nivel--) {
      var celulas = '';
      for (var predio = 1; predio <= predios; predio++) {
        var codigo = montarCodigoEndereco(r.sigla, r.codigoRua, nivel, predio);
        var key = sanitizeKey(codigo);
        var end = enderecosEstoque[key];
        var ocupantes = ocupantesPorEndereco[key] || 0;
        var classe = !end ? 'mapa-cell-naogerada' : (ocupantes > 0 ? 'mapa-cell-ocupada' : 'mapa-cell-livre');
        var tituloAttr = !end ? (codigo + ' -- não gerada ainda') : (codigo + (ocupantes > 0 ? (' -- ' + ocupantes + ' item' + (ocupantes > 1 ? 's' : '')) : ' -- livre'));
        celulas += '<div class="mapa-cell ' + classe + '" data-endereco-key="' + escapeAttr(key) + '" data-codigo="' + escapeAttr(codigo) + '" title="' + escapeAttr(tituloAttr) + '">' + predio + '</div>';
      }
      linhasHtml += '<div class="mapa-nivel-row"><div class="mapa-nivel-label">N' + nivel + '</div>' + celulas + '</div>';
    }
    // âncora pela CHAVE COMPOSTA -- é o que a planta baixa usa pra pular pra
    // elevação da rua certa; com o número puro, duas áreas gerariam o mesmo id
    return '<div class="mapa-rua" id="mapa-rua-' + escapeAttr(chaveRua(r.sigla, r.codigoRua)) + '"><div class="mapa-rua-titulo">Rua ' + escapeHtml(chaveRua(r.sigla, r.codigoRua)) + ' — ' + escapeHtml(r.area || '') + '</div><div class="mapa-grid-scroll"><div class="mapa-grid-rows">' + linhasHtml + '</div></div></div>';
  }).join('');
}

// Planta baixa -- visão de CIMA do galpão (diferente do mapa por rua acima,
// que é uma ELEVAÇÃO -- de frente pra estante, níveis empilhados). Pedido
// do usuário depois de ver o mapa por rua: "tem como ficar com algo mais
// visual, como se fosse uma planta baixa?" -- ele já tinha mandado uma foto
// do galpão real antes, com módulos numerados espalhados de forma
// irregular pelo chão, não em fileira reta -- por isso cada rua tem
// posição (layoutX/layoutY) ARRASTÁVEL, gravada em estrutura_ruas, em vez
// de um layout automático de fileira única (não reflete um galpão real
// nenhum). Sem posição salva ainda, cai num layout automático em fileira
// (utilizável de imediato, sem exigir configuração antes de ver algo).
//
// Cada rua vira um bloco -- largura proporcional ao Nº de módulos (cada
// módulo = 2 prédios, confirmado pelo usuário), cor pela % de ocupação
// agregada da rua inteira. Só MONTA o HTML (string) -- arrastar e o clique
// pra abrir a elevação daquela rua são wireados por quem chama, igual o
// mapa por rua acima.
//
// nivelSelecionado (opcional): pedido do usuário depois de ver a planta
// agregada -- "não da pra colocar algo que de pra visualizar as posições
// de palete também na planta baixa, talvez visualizando algo em nivel?".
// Ausente/0 = visão agregada (% de ocupação da rua inteira, responde
// "qual rua está cheia"). Com um nível escolhido, o bloco se ABRE nas
// posições individuais daquele nível, olhadas de cima -- responde "qual
// palete está livre, e onde ele fica no galpão". A geometria do bloco
// (posição/tamanho) é IDÊNTICA nos dois modos, senão trocar de nível
// embaralharia a planta que a pessoa arrumou arrastando.
function plantaBaixaRuasHtml(estruturaRuas, enderecosEstoque, ocupantesPorEndereco, nivelSelecionado) {
  var ruas = Object.values(estruturaRuas || {}).sort(function(a, b) { return (a.codigoRua || 0) - (b.codigoRua || 0); });
  if (!ruas.length) return '<div class="empty-hint">Nenhuma rua cadastrada ainda -- gere posições em "Estrutura de Ruas" primeiro.</div>';
  var UNIDADE = 60; // px por módulo (2 prédios) de largura -- também usado como grid de encaixe ao arrastar
  var GAP_AUTO = 20; // espaço entre blocos no layout automático (sem posição salva)
  var nivelFoco = Number(nivelSelecionado) || 0; // 0 = visão agregada
  var proximoXAuto = 0;
  return ruas.map(function(r) {
    var niveis = r.niveis || 0, predios = r.predios || 0;
    var modulos = Math.max(1, Math.ceil(predios / 2));
    var largura = modulos * UNIDADE;
    var altura = UNIDADE; // profundidade fixa -- planta baixa não empilha nível, isso é a elevação
    var temPosicaoSalva = typeof r.layoutX === 'number' && typeof r.layoutY === 'number';
    var x = temPosicaoSalva ? r.layoutX : proximoXAuto;
    var y = temPosicaoSalva ? r.layoutY : 0;
    if (!temPosicaoSalva) proximoXAuto += largura + GAP_AUTO;
    var estiloAttr = 'left:' + x + 'px;top:' + y + 'px;width:' + largura + 'px;height:' + altura + 'px';
    // CHAVE COMPOSTA (sigla-rua), não só o número: é ela que a planta baixa
    // usa pra gravar layoutX/layoutY em estrutura_ruas. Com o número puro,
    // arrastar a rua 1 do galpão gravaria a posição na rua 1 da fábrica.
    var chaveDaRua = chaveRua(r.sigla, r.codigoRua);
    var idAttr = 'planta-rua-' + escapeAttr(chaveDaRua);
    var ruaAttr = escapeAttr(chaveDaRua);

    // ── Visão POR NÍVEL: abre o bloco nas posições de palete daquele nível ──
    if (nivelFoco > 0) {
      // Rua mais baixa que o nível escolhido (ex: posições de chão, 1 nível
      // só, quando se olha o nível 3): fica apagada mas NO LUGAR -- sumir
      // faria a pessoa perder a referência de onde está no galpão.
      if (nivelFoco > niveis) {
        return '<div class="planta-bloco planta-bloco-semnivel" id="' + idAttr + '" data-codigo-rua="' + ruaAttr + '" style="' + estiloAttr + '" ' +
          'title="' + escapeAttr('Rua ' + r.codigoRua + ' — não tem nível ' + nivelFoco + ' (vai só até o ' + niveis + ')') + '">' +
          '<div class="planta-bloco-numero">' + escapeHtml(String(r.codigoRua)) + '</div></div>';
      }
      var celulas = '';
      for (var p = 1; p <= predios; p++) {
        var codigoPos = montarCodigoEndereco(r.sigla, r.codigoRua, nivelFoco, p);
        var keyPos = sanitizeKey(codigoPos);
        var endPos = enderecosEstoque[keyPos];
        var ocupPos = ocupantesPorEndereco[keyPos] || 0;
        var classeCel = !endPos ? 'planta-cell-naogerada' : (ocupPos > 0 ? 'planta-cell-ocupada' : 'planta-cell-livre');
        var tituloCel = !endPos ? (codigoPos + ' -- não gerada ainda') : (codigoPos + (ocupPos > 0 ? (' -- ' + ocupPos + ' item' + (ocupPos > 1 ? 's' : '')) : ' -- livre'));
        celulas += '<div class="planta-cell ' + classeCel + '" data-endereco-key="' + escapeAttr(keyPos) + '" data-codigo="' + escapeAttr(codigoPos) + '" title="' + escapeAttr(tituloCel) + '">' + p + '</div>';
      }
      return '<div class="planta-bloco planta-bloco-nivel" id="' + idAttr + '" data-codigo-rua="' + ruaAttr + '" style="' + estiloAttr + '" ' +
        'title="' + escapeAttr('Rua ' + r.codigoRua + ' — ' + (r.area || '') + ' — nível ' + nivelFoco) + '">' +
        '<div class="planta-bloco-label">R' + escapeHtml(String(r.codigoRua)) + '</div>' +
        '<div class="planta-bloco-cells">' + celulas + '</div>' +
      '</div>';
    }

    var totalPosicoes = 0, ocupadas = 0;
    for (var nivel = 1; nivel <= niveis; nivel++) {
      for (var predio = 1; predio <= predios; predio++) {
        var key = sanitizeKey(montarCodigoEndereco(r.sigla, r.codigoRua, nivel, predio));
        if (!enderecosEstoque[key]) continue; // não gerada ainda -- não conta nem como vaga nem ocupada
        totalPosicoes++;
        if (ocupantesPorEndereco[key] > 0) ocupadas++;
      }
    }
    var pct = totalPosicoes ? Math.round((ocupadas / totalPosicoes) * 100) : 0;
    var classePct = totalPosicoes === 0 ? 'planta-bloco-vazio' : (pct === 0 ? 'planta-bloco-livre' : (pct >= 90 ? 'planta-bloco-cheio' : 'planta-bloco-parcial'));
    var tituloAttr = 'Rua ' + r.codigoRua + ' — ' + (r.area || '') + (totalPosicoes ? (' — ' + ocupadas + '/' + totalPosicoes + ' posições ocupadas (' + pct + '%)') : ' — nenhuma posição gerada ainda');

    return '<div class="planta-bloco ' + classePct + '" id="' + idAttr + '" data-codigo-rua="' + ruaAttr + '" ' +
      'style="' + estiloAttr + '" title="' + escapeAttr(tituloAttr) + '">' +
      '<div class="planta-bloco-numero">' + escapeHtml(String(r.codigoRua)) + '</div>' +
      '<div class="planta-bloco-pct">' + (totalPosicoes ? (pct + '%') : '—') + '</div>' +
      '</div>';
  }).join('');
}

// ── WMS Fase 1: lote/endereço granular (estoque_lotes/enderecos_estoque) ──
// Nós IRMÃOS de estoque/{materialKey}, não aninhados dentro dele -- o
// agregado (saldoAtual/saldoEmpenhado) continua sendo a fonte de verdade
// do saldo físico total de MP/embalagem, inalterado; estes dois nós novos
// só adicionam RASTREABILIDADE de entrada (de qual lote, validade, onde
// foi guardado), sem mudar nada de como o agregado funciona.
//
// itemTipo distingue de onde vem o item: 'material' (materiais/, entra
// pelo recebimento em logistica.html) ou 'produto' (produtos/, SKU --
// entra pela conclusão de OP em ops.html, ver seção Produto Acabado do
// plano). itemKey = sanitizeKey(materialCodigo) ou sanitizeKey(sku),
// mesma função já usada em todo o resto do app.

// Chamado no recebimento (logistica.html, item com lote/validade/endereço
// preenchidos) e na conclusão de OP com endereço de destino (ops.html,
// produto acabado). Só cria (push simples, sem .transaction() -- cada
// chamada gera uma chave nova, não existe corrida a proteger aqui, mesmo
// raciocínio já usado em pedidos_compra/.../recebimentos.push()). Nunca
// toca em estoque/{materialKey} -- quem chama isto continua chamando
// ajustarEstoque/incrementarEstoque separadamente pro saldo agregado.
function putawayEstoqueLote(dbRef, itemTipo, itemCodigo, dadosLote) {
  if (!itemTipo || !itemCodigo || !dadosLote || !dadosLote.enderecoKey) return Promise.resolve();
  var itemKey = sanitizeKey(itemCodigo);
  var agora = new Date().toISOString();
  var registro = Object.assign({
    itemTipo: itemTipo, itemCodigo: itemCodigo,
    status: 'LIBERADO', criadoEm: agora, atualizadoEm: agora
  }, dadosLote);
  return dbRef.ref('estoque_lotes/' + itemKey).push(registro).then(function(ref) {
    return dbRef.ref('movimentos_estoque/' + itemKey).push({
      tipo: itemTipo === 'produto' ? 'producao_op' : 'recebimento_pc',
      motivo: itemTipo === 'produto' ? 'ENTRADA DE PRODUÇÃO' : 'RECEBIMENTO',
      qtd: dadosLote.saldoLote || dadosLote.qtdOriginal || 0, saldoApos: null,
      ref: dadosLote.origemRef || null, loteKey: ref.key, enderecoKey: dadosLote.enderecoKey,
      itemTipo: itemTipo, itemCodigo: itemCodigo,
      itemNome: dadosLote.itemNome || null, unidade: dadosLote.unidade || null,
      autor: dadosLote.criadoPor || null, em: agora
    }).then(function() { return ref; });
  }).catch(function(err) { console.error('Falha ao registrar putaway de estoque:', err); throw err; });
}

// Move um lote já registrado de um endereço pra outro (não muda saldo
// nenhum, só a localização) -- usado pela ação "Transferir" em
// estoque.html. `motivo` vem de config/motivosMovimentoEstoque (lista
// fechada), escolhido pelo usuário na tela -- pedido do usuário: "Lista
// fechada, gerenciável em Cadastros" pro motivo de cada movimentação.
function transferirLoteEndereco(dbRef, itemTipo, itemCodigo, loteKey, novoEnderecoKey, motivo, autor) {
  if (!itemCodigo || !loteKey || !novoEnderecoKey) return Promise.resolve();
  var itemKey = sanitizeKey(itemCodigo);
  var loteRef = dbRef.ref('estoque_lotes/' + itemKey + '/' + loteKey);
  return Promise.all([
    loteRef.once('value'),
    dbRef.ref('enderecos_estoque/' + novoEnderecoKey).once('value')
  ]).then(function(snaps) {
    var lote = snaps[0].val();
    if (!lote) return Promise.resolve(); // lote já não existe mais (removido/consumido) -- nada a transferir
    // enderecoCodigo é denormalizado (mesmo princípio do putaway) -- sem
    // resolver de novo aqui, a exibição do lote ficaria mostrando o código
    // do endereço ANTIGO pra sempre depois de uma transferência.
    var novoEndereco = snaps[1].val();
    var enderecoAnterior = lote.enderecoKey;
    return loteRef.update({
      enderecoKey: novoEnderecoKey, enderecoCodigo: (novoEndereco && novoEndereco.codigo) || null,
      // Mover É o cumprimento da pendência criada na liberação — a fila de
      // "liberado, aguardando posição definitiva" precisa esvaziar sozinha
      // quando a Logística faz o trabalho, senão vira lista que ninguém olha.
      aguardandoEnderecoDefinitivo: null,
      atualizadoEm: new Date().toISOString()
    }).then(function() {
      return dbRef.ref('movimentos_estoque/' + itemKey).push({
        tipo: 'transferencia', motivo: motivo || 'TRANSFERÊNCIA ENTRE ENDEREÇOS',
        qtd: 0, saldoApos: null, ref: enderecoAnterior + ' -> ' + novoEnderecoKey,
        loteKey: loteKey, enderecoKey: novoEnderecoKey,
        itemTipo: itemTipo || lote.itemTipo, itemCodigo: itemCodigo,
        itemNome: lote.itemNome || null, unidade: lote.unidade || null,
        autor: autor || null, em: new Date().toISOString()
      });
    });
  });
}

// Baixa manual de um lote específico -- usado pela ação "Registrar Saída"
// em estoque.html (ex: saída de produto acabado por expedição manual, já
// que não existe hoje um fluxo de expedição automatizado pra ligar nisso;
// ou correção pontual do saldo de um lote específico de MP). Nunca muda
// estoque/{materialKey} (o agregado) -- só o saldoLote granular desse
// lote. `motivo` vem da lista fechada (config/motivosMovimentoEstoque),
// escolhido pelo usuário na tela. Nunca deixa saldoLote negativo (mesmo
// princípio de baixarEmpenho -- abate o mínimo entre o pedido e o que
// realmente sobra).
function darBaixaLoteManual(dbRef, itemTipo, itemCodigo, loteKey, qtd, motivo, autor) {
  if (!itemCodigo || !loteKey || !qtd || qtd <= 0) return Promise.resolve();
  var itemKey = sanitizeKey(itemCodigo);
  var loteRef = dbRef.ref('estoque_lotes/' + itemKey + '/' + loteKey);
  // abatidoReal -- capturado de DENTRO da transaction, não é `qtd` (o
  // pedido). Bug real achado em auditoria cruzada: o log gravava `qtd`
  // (pedida) mesmo quando o clamp abaixo abatia menos (saldoLote menor que
  // o pedido) -- trilha de auditoria ficava incorreta, sobrestimando a
  // saída. A transaction pode rodar mais de uma vez em disputa de
  // concorrência, mas só a execução que de fato COMMITA é a que sobra
  // atribuída aqui antes do .then() ler o resultado.
  var abatidoReal = 0;
  return loteRef.transaction(function(atual) {
    if (!atual) return atual; // lote já não existe mais -- aborta sem gravar nada
    abatidoReal = Math.min(qtd, atual.saldoLote || 0);
    atual.saldoLote = Math.round(((atual.saldoLote || 0) - abatidoReal) * 1000) / 1000;
    atual.atualizadoEm = new Date().toISOString();
    return atual;
  }).then(function(resultado) {
    var lote = (resultado && resultado.committed && resultado.snapshot) ? resultado.snapshot.val() : null;
    if (!lote) return resultado;
    return dbRef.ref('movimentos_estoque/' + itemKey).push({
      tipo: 'saida_manual', motivo: motivo || 'REMESSA',
      // qtd/saldoApos usam o valor REAL pós-transaction (mesmo padrão de
      // ajustarEstoque acima), não o pedido -- outro bug do mesmo achado
      // era saldoApos sempre null, mesmo já tendo o snapshot em mãos.
      qtd: -abatidoReal, saldoApos: lote.saldoLote, ref: null, loteKey: loteKey, enderecoKey: lote.enderecoKey || null,
      itemTipo: itemTipo || lote.itemTipo, itemCodigo: itemCodigo,
      itemNome: lote.itemNome || null, unidade: lote.unidade || null,
      autor: autor || null, em: new Date().toISOString()
    }).then(function() { return resultado; });
  });
}

// ── WMS Fase 2: separação guiada por OP ─────────────────────────────────
// Pedido do usuário: "OP emitida -> Ordem de Separação -> Logística separa
// no galpão... material transferido pro espaço dedicado na fábrica" --
// "separação será guiada, e não preenchida" (o sistema sugere de onde
// tirar, a pessoa confirma/ajusta e escolhe SEMPRE manualmente pra onde
// vai). Escopo desta fase: só embalagem (origem 'bom' em
// materiaisConsumo) -- matéria-prima/Ordem de Fabricação fica pra depois.

// Um lote real quase sempre tem mais peças do que uma OP específica
// precisa -- transferirLoteEndereco (acima) move o LOTE INTEIRO, não
// serve pra separação parcial. Esta função é IRMÃ, não substitui aquela:
// separa só `qtd` do lote de origem (clamp de segurança, mesmo princípio
// de darBaixaLoteManual -- nunca deixa saldoLote negativo) e cria um
// registro NOVO no endereço de destino, sempre -- mesmo se `qtd` cobrir o
// lote de origem inteiro (fica simples e uniforme, sem branch especial
// "é tudo ou é parte"). A origem nunca é apagada, mesmo zerada (mesmo
// princípio de auditoria já usado em darBaixaLoteManual).
function separarParcialLoteEndereco(dbRef, itemTipo, itemCodigo, loteKey, qtd, novoEnderecoKey, motivo, autor, origemRefNovo) {
  if (!itemCodigo || !loteKey || !qtd || qtd <= 0 || !novoEnderecoKey) return Promise.resolve({ abatidoReal: 0, novoLoteKey: null });
  var itemKey = sanitizeKey(itemCodigo);
  var loteRef = dbRef.ref('estoque_lotes/' + itemKey + '/' + loteKey);
  var abatidoReal = 0;
  return Promise.all([
    loteRef.transaction(function(atual) {
      if (!atual) return atual; // lote já não existe mais -- aborta sem gravar nada
      abatidoReal = Math.min(qtd, atual.saldoLote || 0);
      atual.saldoLote = Math.round(((atual.saldoLote || 0) - abatidoReal) * 1000) / 1000;
      atual.atualizadoEm = new Date().toISOString();
      return atual;
    }),
    dbRef.ref('enderecos_estoque/' + novoEnderecoKey).once('value')
  ]).then(function(results) {
    var resultado = results[0], novoEnderecoSnap = results[1];
    var lote = (resultado && resultado.committed && resultado.snapshot) ? resultado.snapshot.val() : null;
    if (!lote || abatidoReal <= 0) return { abatidoReal: 0, novoLoteKey: null };
    var novoEndereco = novoEnderecoSnap.val();
    var agora = new Date().toISOString();
    return dbRef.ref('estoque_lotes/' + itemKey).push({
      itemTipo: itemTipo || lote.itemTipo, itemCodigo: itemCodigo,
      itemNome: lote.itemNome || null, unidade: lote.unidade || null,
      loteOrigem: lote.loteOrigem || null, dataValidade: lote.dataValidade || null,
      // dataRecebimento tem que ser COPIADA: é o 2º critério de desempate do
      // FEFO (sugerirAlocacaoFefo), depois da validade. Sem ela o lote
      // separado ficava com '' e ordenava sempre ANTES do restante que
      // continuou no armazém -- por acidente isso dava o resultado certo,
      // mas invertia no dia em que alguém preenchesse o campo. Copiando,
      // o fracionamento preserva a posição do lote na fila FEFO, que é o
      // comportamento correto: os dois pedaços vieram do mesmo recebimento.
      dataRecebimento: lote.dataRecebimento || null,
      status: lote.status || 'LIBERADO',
      enderecoKey: novoEnderecoKey, enderecoCodigo: (novoEndereco && novoEndereco.codigo) || null,
      saldoLote: abatidoReal, qtdOriginal: abatidoReal,
      origemTipo: 'separacao_op', origemRef: origemRefNovo || null,
      criadoEm: agora, atualizadoEm: agora, criadoPor: autor || null
    }).then(function(novoRef) {
      // Diferente de transferirLoteEndereco (que loga qtd=0 -- é a MESMA
      // posição só mudando de endereço), aqui a quantidade real separada
      // é informação de auditoria que se perderia com 0, já que o lote
      // está sendo FRACIONADO (parte fica na origem, parte nasce no
      // destino).
      return dbRef.ref('movimentos_estoque/' + itemKey).push({
        tipo: 'transferencia', motivo: motivo || 'TRANSFERÊNCIA ENTRE ENDEREÇOS',
        qtd: abatidoReal, saldoApos: null,
        ref: (lote.enderecoKey || '—') + ' -> ' + novoEnderecoKey,
        loteKey: novoRef.key, enderecoKey: novoEnderecoKey,
        itemTipo: itemTipo || lote.itemTipo, itemCodigo: itemCodigo,
        itemNome: lote.itemNome || null, unidade: lote.unidade || null,
        autor: autor || null, em: agora
      }).then(function() { return { abatidoReal: abatidoReal, novoLoteKey: novoRef.key }; });
    });
  });
}

// Baixa o consumo REAL de produção do estoque endereçado, em ordem FEFO.
//
// Achado da auditoria geral (2026-09-05): o ciclo do WMS era ASSIMÉTRICO --
// o recebimento (logistica.html) gravava nos dois lugares (putawayEstoqueLote
// criando o lote no endereço + ajustarEstoque somando no agregado), mas o
// apontamento (form.html), único ponto onde o consumo real acontece, só
// descontava o agregado: `estoque_lotes` não aparecia UMA vez sequer naquele
// arquivo. Resultado: o saldo endereçado só subia, nunca descia. A cada OP
// produzida o WMS se afastava mais da realidade física, e o FEFO da Separação
// Guiada -- que lê exatamente esse dado -- passaria a mandar o separador
// buscar em lotes já consumidos.
//
// Três decisões de projeto aqui, todas deliberadas:
//
// 1. EXCLUI posição bloqueada, igual à sugestão de separação. A primeira
//    versão fazia o contrário, com o argumento de que isto é "escrituração
//    do que JÁ saiu fisicamente" e ignorar deixaria saldo fantasma na
//    posição com problema. Revisão derrubou o argumento, com razão: ninguém
//    escaneou nada -- esta função não sabe de onde o material saiu, ela
//    ADIVINHA por FEFO. Adivinhar numa posição de onde a Separação Guiada
//    acabou de DESVIAR o separador produz divergência garantida (a separação
//    mandou pegar no lote B, o consumo baixa o lote A), que é o inverso
//    exato do objetivo. Pior no caso "posição em contagem": congelar a
//    posição existe justamente pra o livro parar de se mexer enquanto se
//    conta o físico. O saldo fantasma que sobrar numa posição bloqueada é
//    problema de ajuste de inventário -- explícito e auditado --, não de
//    drenagem silenciosa. (Lote em QUARENTENA já era tratado assim.)
// 2. NUNCA rejeita. Se faltar saldo endereçado, baixa o que dá e devolve
//    `faltante` -- quem chama decide o que fazer. Apontamento de produção é
//    o fluxo mais crítico do sistema e roda no chão de fábrica: escrituração
//    de WMS não pode, em hipótese nenhuma, travar o registro do que foi
//    produzido. A realidade física vence o livro.
// 3. Lê só os lotes DAQUELE item, sob demanda (`estoque_lotes/{itemKey}`),
//    em vez de manter um listener do nó inteiro em form.html -- o
//    apontamento é a página mais usada do app e fecha poucas vezes por
//    turno, então uma leitura pontual por material sai muito mais barata
//    que carregar todo o estoque endereçado o tempo todo.
//
// Reaproveita sugerirAlocacaoFefo pra ORDENAR: a regra de FEFO fica num
// lugar só, então separação e consumo nunca discordam sobre qual lote sai
// primeiro.
//
// REPLANEJA quando a corrida come parte do abatimento: entre montar o plano
// e gravar, outra sessão pode drenar um lote. O clamp impede saldo negativo,
// mas sozinho deixava o restante sem escorrer pro próximo lote mesmo havendo
// saldo sobrando. Refaz o plano com dado fresco até zerar ou não sobrar
// candidato, com teto de tentativas.
function baixarLotesFefo(dbRef, itemTipo, itemCodigo, qtd, motivo, autor, origemRef) {
  if (!itemCodigo || !qtd || qtd <= 0) return Promise.resolve({ baixado: 0, faltante: 0, lotes: [] });
  var itemKey = sanitizeKey(itemCodigo);
  var TENTATIVAS_MAX = 3;
  var acumuladoBaixado = 0;
  var acumuladoLotes = [];

  function passe(restante, tentativa) {
    if (restante <= 0 || tentativa > TENTATIVAS_MAX) {
      return Promise.resolve({
        baixado: Math.round(acumuladoBaixado * 1000) / 1000,
        faltante: Math.max(0, Math.round(restante * 1000) / 1000),
        lotes: acumuladoLotes
      });
    }
    return Promise.all([
      dbRef.ref('estoque_lotes/' + itemKey).once('value'),
      dbRef.ref('enderecos_estoque').once('value')
    ]).then(function(snaps) {
      var lotesDoItem = snaps[0].val() || {};
      var enderecos = snaps[1].val() || {};
      var bloqueados = {};
      Object.keys(enderecos).forEach(function(k) {
        if (enderecos[k] && enderecos[k].ativo === false) bloqueados[k] = true;
      });
      var plano = sugerirAlocacaoFefo(itemCodigo, restante, lotesDoItem, bloqueados);
      if (!plano.alocacoes.length) {
        return {
          baixado: Math.round(acumuladoBaixado * 1000) / 1000,
          faltante: Math.max(0, Math.round(restante * 1000) / 1000),
          lotes: acumuladoLotes
        };
      }
    var agora = new Date().toISOString();
    var baixadoReal = 0;
    var lotesTocados = [];
    return Promise.all(plano.alocacoes.map(function(a) {
      var loteRef = dbRef.ref('estoque_lotes/' + itemKey + '/' + a.loteKey);
      var abatidoNesteLote = 0;
      return loteRef.transaction(function(atual) {
        if (!atual) return atual;
        // Clamp contra o saldo do MOMENTO da transaction, não contra o que o
        // plano viu: entre montar o plano e gravar, outra sessão pode ter
        // mexido no mesmo lote. Mesmo padrão de darBaixaLoteManual.
        // Math.max(0, ...) é essencial: com saldoLote já negativo (dado
        // inconsistente), Math.min(600, -50) daria -50 e a subtração
        // "corrigiria" o lote de -50 pra 0 sem gravar movimento nenhum --
        // um ajuste de inventário invisível. Assim, saldo negativo não abate
        // nada e o faltante denuncia.
        abatidoNesteLote = Math.max(0, Math.min(a.qtdSugerida, atual.saldoLote || 0));
        atual.saldoLote = Math.round(((atual.saldoLote || 0) - abatidoNesteLote) * 1000) / 1000;
        atual.atualizadoEm = agora;
        return atual;
      }).then(function(res) {
        if (!res || !res.committed || abatidoNesteLote <= 0) return null;
        baixadoReal += abatidoNesteLote;
        lotesTocados.push({ loteKey: a.loteKey, enderecoKey: a.enderecoKey, qtd: abatidoNesteLote });
        return dbRef.ref('movimentos_estoque/' + itemKey).push({
          tipo: 'consumo',
          motivo: motivo || 'CONSUMO DE PRODUÇÃO',
          // NEGATIVO: é saída. Toda a convenção do sistema grava saída com
          // sinal negativo (ajustarEstoque usa o próprio delta,
          // darBaixaLoteManual grava -abatidoReal), e estoque.html pinta
          // qtd > 0 de verde com "+" na frente. Gravar positivo fazia um
          // consumo de 600 aparecer no Histórico de Movimentações como
          // "+600" verde -- uma ENTRADA -- ao lado do "-600" do agregado.
          qtd: -abatidoNesteLote,
          saldoApos: (res.snapshot.val() || {}).saldoLote != null ? res.snapshot.val().saldoLote : null,
          ref: origemRef || null,
          loteKey: a.loteKey,
          enderecoKey: a.enderecoKey || null,
          enderecoCodigo: a.enderecoCodigo || null,
          itemTipo: itemTipo || 'material',
          itemCodigo: itemCodigo,
          // itemNome/unidade: todos os outros movimentos do sistema gravam
          // (putaway, transferência, separação, baixa manual, ajustarEstoque)
          // -- sem eles a quantidade aparece sem unidade no histórico.
          itemNome: (lotesDoItem[a.loteKey] && lotesDoItem[a.loteKey].itemNome) || null,
          unidade: (lotesDoItem[a.loteKey] && lotesDoItem[a.loteKey].unidade) || null,
          autor: autor || null,
          em: agora
        });
      });
    })).then(function() {
      baixadoReal = Math.round(baixadoReal * 1000) / 1000;
      acumuladoBaixado += baixadoReal;
      lotesTocados.forEach(function(l) { acumuladoLotes.push(l); });
      var novoRestante = Math.round((restante - baixadoReal) * 1000) / 1000;
      // Nada saiu neste passe (todos os lotes do plano foram drenados por
      // outra sessão, ou só sobrou saldo negativo) -- insistir de novo com o
      // mesmo resultado só gastaria leitura. Encerra com o faltante honesto.
      if (baixadoReal <= 0) {
        return {
          baixado: Math.round(acumuladoBaixado * 1000) / 1000,
          faltante: Math.max(0, novoRestante),
          lotes: acumuladoLotes
        };
      }
      return passe(novoRestante, tentativa + 1);
    });
    });
  }

  return passe(qtd, 1);
}

// ══════════════════════════════════════════════════════════════════════
// STATUS DE LOTE — vocabulário único
//
// Vem da especificação do Módulo CQ (seção 7.3, "Regras de Transição de
// Status de Lote"). Antes existia espalhado: estoque.html tinha a lista num
// <select> de filtro, outra no de edição e um mapa de cores -- três lugares
// que precisavam concordar de cor.
//
// Um vocabulário só serve material e produto acabado, como na spec. A
// diferença é o CAMINHO, não o dicionário:
//   material: QUARENTENA -> LIBERADO | REPROVADO | APROVADO_CONCESSAO
//   PA:       AGUARDANDO_CONFERENCIA -> QUARENTENA -> LIBERADO_EXPEDICAO
//
// AGUARDANDO_CONFERENCIA é a única adição ao vocabulário da spec, e é
// justificada: é etapa da LOGÍSTICA (conferir o palete que a produção
// declarou), anterior à Qualidade. O usuário confirmou que são dois
// momentos -- "produção declara, logística confere".
var STATUS_LOTE = {
  AGUARDANDO_CONFERENCIA: { rotulo: 'Aguardando conferência', badge: 'badge-gray',   disponivel: false, aplicaA: 'produto'  },
  QUARENTENA:             { rotulo: 'Quarentena',             badge: 'badge-orange', disponivel: false, aplicaA: 'ambos'    },
  LIBERADO:               { rotulo: 'Aprovado',               badge: 'badge-green',  disponivel: true,  aplicaA: 'material' },
  APROVADO_CONCESSAO:     { rotulo: 'Aprovado c/ concessão',  badge: 'badge-purple', disponivel: true,  aplicaA: 'ambos'    },
  LIBERADO_EXPEDICAO:     { rotulo: 'Liberado p/ expedição',  badge: 'badge-green',  disponivel: true,  aplicaA: 'produto'  },
  REPROVADO:              { rotulo: 'Reprovado',              badge: 'badge-red',    disponivel: false, aplicaA: 'ambos'    },
  RETIDO:                 { rotulo: 'Retido',                 badge: 'badge-red',    disponivel: false, aplicaA: 'ambos'    },
  VENCIDO:                { rotulo: 'Vencido',                badge: 'badge-red',    disponivel: false, aplicaA: 'ambos'    }
};

// "Está disponível pra uso?" numa função só. É a pergunta que a separação, o
// consumo e a expedição fazem -- e que antes cada um respondia com o seu
// próprio `status === 'LIBERADO'` literal, o que fez APROVADO_CONCESSAO
// nascer invisível pra todos eles.
function loteDisponivel(status) {
  var s = STATUS_LOTE[status || 'LIBERADO'];
  return !!(s && s.disponivel);
}
function rotuloStatusLote(status) {
  var s = STATUS_LOTE[status];
  return s ? s.rotulo : (status || '—');
}
function badgeStatusLote(status) {
  var s = STATUS_LOTE[status];
  return s ? s.badge : 'badge-gray';
}

// ══════════════════════════════════════════════════════════════════════
// LIBERAÇÃO DE QUALIDADE (estoque em inspeção)
//
// Material recebido entra em QUARENTENA e só a Qualidade libera. O
// mecanismo de status já existia em estoque_lotes (LIBERADO/QUARENTENA/
// REPROVADO) e sugerirAlocacaoFefo já filtrava por LIBERADO -- o que
// faltava era quem escrevesse a transição.
//
// Os campos de inspeção vieram do formulário real que a Logística preenche
// hoje ("Formulário de entrada de materiais", 605 registros): certificado
// do fornecedor, condições do veículo e da embalagem (escala 1-5),
// integridade e vazamento (C/NC), quantidade amostrada e data de inspeção.
// No formulário esses campos ficavam em 13% a 60% de preenchimento; aqui
// laudo e responsável são obrigatórios porque são o que define se o
// material pode ser usado.
//
// REPROVADO não zera o saldo: o material continua fisicamente lá, ocupando
// a posição, até alguém devolver ao fornecedor ou descartar -- e essas são
// saídas próprias, com movimento próprio, não efeito colateral de um laudo.
function registrarLaudoQualidade(dbRef, itemCodigo, loteKey, laudo, autor) {
  if (!itemCodigo || !loteKey || !laudo || !laudo.decisao) {
    return Promise.resolve({ ok: false, erro: 'Faltam dados do laudo.' });
  }
  // Decisões válidas (spec do CQ, 7.3). LIBERADO_EXPEDICAO é o equivalente
  // de LIBERADO para produto acabado -- o formulário "Liberação de Palete". Quem
  // chama escolhe conforme o itemTipo do lote; a função aceita as duas
  // porque a mecânica (transação, laudo, movimento) é idêntica.
  var DECISOES = { LIBERADO: 1, LIBERADO_EXPEDICAO: 1, REPROVADO: 1, APROVADO_CONCESSAO: 1, RETIDO: 1 };
  if (!DECISOES[laudo.decisao]) {
    return Promise.resolve({ ok: false, erro: 'Decisão inválida: ' + laudo.decisao });
  }
  // Concessão é autorização formal pra usar material fora de especificação --
  // a spec exige autorização nominal (7.3). Sem quem autorizou, não grava.
  if (laudo.decisao === 'APROVADO_CONCESSAO' && !laudo.autorizadoPor) {
    return Promise.resolve({ ok: false, erro: 'Aprovação com concessão exige o nome de quem autorizou.' });
  }
  var itemKey = sanitizeKey(itemCodigo);
  var agora = new Date().toISOString();
  var loteRef = dbRef.ref('estoque_lotes/' + itemKey + '/' + loteKey);
  var saldoNoMomento = 0;
  return loteRef.transaction(function(atual) {
    if (!atual) return atual;
    // Só decide o que ainda está em quarentena -- reprocessar um lote já
    // liberado/reprovado por dois cliques ou duas sessões não pode
    // sobrescrever o laudo anterior em silêncio.
    if (atual.status !== 'QUARENTENA') return; // aborta a transaction
    saldoNoMomento = atual.saldoLote || 0;
    atual.status = laudo.decisao;
    atual.qualidade = {
      decisao: laudo.decisao,
      inspecionadoEm: agora,
      inspecionadoPor: autor || null,
      dataInspecao: laudo.dataInspecao || agora.slice(0, 10),
      qtdAmostrada: laudo.qtdAmostrada != null ? laudo.qtdAmostrada : null,
      certificadoFornecedor: !!laudo.certificadoFornecedor,
      condicoesVeiculo: laudo.condicoesVeiculo != null ? laudo.condicoesVeiculo : null,
      condicoesEmbalagem: laudo.condicoesEmbalagem != null ? laudo.condicoesEmbalagem : null,
      integridadeEmbalagem: laudo.integridadeEmbalagem || null,
      ausenciaVazamento: laudo.ausenciaVazamento || null,
      observacao: laudo.observacao || null,
      autorizadoPor: laudo.autorizadoPor || null,
      // Resultado ensaio a ensaio, quando o item tem especificação
      // cadastrada. É o que transforma o laudo de "aprovado/reprovado" em
      // registro de análise rastreável -- e o que um COA precisaria ler.
      especificacaoKey: laudo.especificacaoKey || null,
      ensaios: laudo.ensaios || null,
      resumoPlano: laudo.resumoPlano || null
    };
    // ── Pendência de endereçamento definitivo ──
    // Levantado pelo usuário (2026-09-08): "o correto não seria ir para
    // quarentena e, após aprovado, ser endereçado pela logística?".
    //
    // O bloqueio de uso já existia -- material em QUARENTENA não é sugerido
    // pela Separação. O que faltava é o passo DEPOIS: liberar só trocava o
    // status, e o lote continuava exatamente na posição em que foi
    // descarregado. Se aquilo era área de retenção ou posição de passagem, o
    // material ficava liberado no sistema e no lugar errado no chão.
    //
    // A marca só faz sentido pra lote LIBERADO que está em alguma posição:
    // reprovado não se move pra estoque bom, e lote sem endereço não tem de
    // onde sair. Ela é limpa em transferirLoteEndereco, quando a Logística
    // de fato move.
    var liberou = laudo.decisao === 'LIBERADO' || laudo.decisao === 'LIBERADO_EXPEDICAO' ||
                  laudo.decisao === 'APROVADO_CONCESSAO';
    atual.aguardandoEnderecoDefinitivo = (liberou && atual.enderecoKey) ? true : null;
    atual.atualizadoEm = agora;
    return atual;
  }).then(function(res) {
    if (!res || !res.committed) {
      return { ok: false, erro: 'Este lote não está mais em quarentena -- alguém já registrou o laudo.' };
    }
    // Movimento com qtd 0: nada entrou nem saiu fisicamente, mudou a
    // DISPONIBILIDADE. Mesmo princípio de transferirLoteEndereco, que também
    // loga sem mexer em quantidade.
    return dbRef.ref('movimentos_estoque/' + itemKey).push({
      tipo: 'qualidade',
      motivo: 'QUALIDADE: ' + rotuloStatusLote(laudo.decisao).toUpperCase(),
      qtd: 0,
      saldoApos: saldoNoMomento,
      ref: laudo.observacao || null,
      loteKey: loteKey,
      enderecoKey: (res.snapshot.val() || {}).enderecoKey || null,
      enderecoCodigo: (res.snapshot.val() || {}).enderecoCodigo || null,
      itemTipo: 'material',
      itemCodigo: itemCodigo,
      itemNome: (res.snapshot.val() || {}).itemNome || null,
      unidade: (res.snapshot.val() || {}).unidade || null,
      autor: autor || null,
      em: agora
    }).then(function() { return { ok: true, decisao: laudo.decisao, saldo: saldoNoMomento }; });
  });
}

// ══════════════════════════════════════════════════════════════════════
// PRODUTO ACABADO — conferência da Logística e "Liberação de Palete"
// ══════════════════════════════════════════════════════════════════════

// Conferência da Logística: a produção declarou X, a Logística conta o que
// de fato chegou ao estoque. A DIFERENÇA é registrada, não escondida --
// divergência entre declarado e recebido é justamente o que a planilha atual
// não captura, e é sinal de perda, de erro de contagem ou de palete
// incompleto.
// Depois de conferido o palete vai pra QUARENTENA (aguardando o CQ), não
// direto pra disponível: quem libera palete é o formulário "Liberação de
// Palete", da Qualidade.
function conferirPaletePA(dbRef, sku, loteKey, qtdConferida, autor, obs) {
  if (!sku || !loteKey || qtdConferida == null || qtdConferida < 0) {
    return Promise.resolve({ ok: false, erro: 'Informe a quantidade conferida.' });
  }
  var itemKey = sanitizeKey(sku);
  var agora = new Date().toISOString();
  var declarada = 0, divergencia = 0;
  return dbRef.ref('estoque_lotes/' + itemKey + '/' + loteKey).transaction(function(atual) {
    if (!atual) return atual;
    if (atual.status !== 'AGUARDANDO_CONFERENCIA') return; // aborta: já conferido
    declarada = atual.qtdDeclarada != null ? atual.qtdDeclarada : (atual.saldoLote || 0);
    divergencia = Math.round((qtdConferida - declarada) * 1000) / 1000;
    atual.saldoLote = qtdConferida;
    atual.status = 'QUARENTENA';
    atual.conferencia = {
      qtdDeclarada: declarada, qtdConferida: qtdConferida, divergencia: divergencia,
      conferidoEm: agora, conferidoPor: autor || null, observacao: obs || null
    };
    atual.atualizadoEm = agora;
    return atual;
  }).then(function(res) {
    if (!res || !res.committed) {
      return { ok: false, erro: 'Este palete não está mais aguardando conferência.' };
    }
    var lote = res.snapshot.val() || {};
    return dbRef.ref('movimentos_estoque/' + itemKey).push({
      tipo: 'conferencia_pa',
      motivo: divergencia === 0 ? 'CONFERÊNCIA DE PALETE (sem divergência)'
        : ('CONFERÊNCIA DE PALETE (' + (divergencia > 0 ? 'sobra ' : 'falta ') + Math.abs(divergencia) + ')'),
      // a quantidade do movimento é a DIFERENÇA -- o que entrou já foi
      // lançado na declaração; aqui só corrige
      qtd: divergencia,
      saldoApos: qtdConferida,
      ref: lote.loteOrigem || null,
      loteKey: loteKey,
      enderecoKey: lote.enderecoKey || null, enderecoCodigo: lote.enderecoCodigo || null,
      itemTipo: 'produto', itemCodigo: sku, itemNome: lote.itemNome || null, unidade: lote.unidade || null,
      autor: autor || null, em: agora
    }).then(function() {
      return { ok: true, declarada: declarada, conferida: qtdConferida, divergencia: divergencia };
    });
  });
}

// Função PURA: paletes que a produção declarou e a Logística ainda não
// conferiu. Mais antigo primeiro -- é palete parado sem entrar no estoque.
function paletesAguardandoConferencia(estoqueLotes) {
  var out = [];
  Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
    var lotes = estoqueLotes[itemKey] || {};
    Object.keys(lotes).forEach(function(loteKey) {
      var l = lotes[loteKey];
      if (!l || l.status !== 'AGUARDANDO_CONFERENCIA') return;
      out.push({
        itemKey: itemKey, loteKey: loteKey,
        sku: l.itemCodigo, itemNome: l.itemNome || null,
        qtdDeclarada: l.qtdDeclarada != null ? l.qtdDeclarada : (l.saldoLote || 0),
        loteOrigem: l.loteOrigem || null, dataValidade: l.dataValidade || null,
        enderecoKey: l.enderecoKey || null, enderecoCodigo: l.enderecoCodigo || null,
        criadoEm: l.criadoEm || null, dataRecebimento: l.dataRecebimento || null
      });
    });
  });
  out.sort(function(a, b) {
    var da = a.criadoEm || '', db2 = b.criadoEm || '';
    return da < db2 ? -1 : (da > db2 ? 1 : 0);
  });
  return out;
}

// Função PURA: lotes esperando laudo, mais antigos primeiro (é o que está
// parado ocupando posição sem poder ser usado).
function lotesAguardandoQualidade(estoqueLotes) {
  var out = [];
  Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
    var lotes = estoqueLotes[itemKey] || {};
    Object.keys(lotes).forEach(function(loteKey) {
      var l = lotes[loteKey];
      if (!l || l.status !== 'QUARENTENA') return;
      out.push({
        itemKey: itemKey, loteKey: loteKey,
        itemTipo: l.itemTipo || 'material',
        itemCodigo: l.itemCodigo, itemNome: l.itemNome || null, unidade: l.unidade || null,
        saldoLote: l.saldoLote || 0,
        loteOrigem: l.loteOrigem || null, dataValidade: l.dataValidade || null,
        dataRecebimento: l.dataRecebimento || null,
        enderecoKey: l.enderecoKey || null, enderecoCodigo: l.enderecoCodigo || null,
        criadoEm: l.criadoEm || null
      });
    });
  });
  out.sort(function(a, b) {
    var da = a.dataRecebimento || (a.criadoEm || '').slice(0, 10);
    var db2 = b.dataRecebimento || (b.criadoEm || '').slice(0, 10);
    if (da !== db2) return da < db2 ? -1 : 1;
    return (a.itemCodigo || '') < (b.itemCodigo || '') ? -1 : 1;
  });
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// PLANO DE INSPEÇÃO — avaliação do laudo contra a especificação cadastrada
//
// A especificação já existe e está POVOADA: 181 registros em
// `especificacoes/{codProduto}__v{versao}`, 1.323 ensaios com ensaio /
// especificacaoTexto / metodo / minimo / maximo / critico. Até aqui nada no
// sistema a usava para DECIDIR nada -- ops.html só a imprime na ficha da OP.
//
// Estas funções são o elo que faltava: dado o valor medido, a própria
// especificação diz se está conforme. Onde há minimo/maximo numérico a
// resposta é do sistema; onde a especificação é textual ("LÍQUIDO",
// "CARACTERÍSTICO") ela é do analista -- e isso é uma distinção real, não
// uma limitação: ninguém automatiza "odor característico".
// ══════════════════════════════════════════════════════════════════════

// Função PURA. Devolve { conforme: true|false|null, faixa, motivo }.
// `conforme: null` = a especificação não é mensurável automaticamente (sem
// min/max) OU não foi informado valor -- quem decide é o analista, no C/NC.
function avaliarEnsaio(ensaio, valorMedido) {
  var e = ensaio || {};
  var temMin = e.minimo !== '' && e.minimo != null && !isNaN(parseFloat(e.minimo));
  var temMax = e.maximo !== '' && e.maximo != null && !isNaN(parseFloat(e.maximo));
  var min = temMin ? parseFloat(e.minimo) : null;
  var max = temMax ? parseFloat(e.maximo) : null;
  var faixa = temMin && temMax ? (min + ' – ' + max)
    : temMin ? ('≥ ' + min)
    : temMax ? ('≤ ' + max) : null;

  if (!temMin && !temMax) {
    return { conforme: null, faixa: null, motivo: 'Especificação descritiva — avaliação do analista.' };
  }
  if (valorMedido === '' || valorMedido == null || isNaN(parseFloat(valorMedido))) {
    return { conforme: null, faixa: faixa, motivo: 'Sem valor medido.' };
  }
  var v = parseFloat(valorMedido);
  if (temMin && v < min) return { conforme: false, faixa: faixa, motivo: 'Abaixo do mínimo (' + min + ').' };
  if (temMax && v > max) return { conforme: false, faixa: faixa, motivo: 'Acima do máximo (' + max + ').' };
  return { conforme: true, faixa: faixa, motivo: 'Dentro da faixa.' };
}

// Função PURA. Avalia o plano inteiro e devolve o veredito consolidado.
// `itens` = especificacoes/{key}/itens (objeto); `resultados` = { itemKey:
// { valor, cnc } } onde `cnc` é o C/NC manual do analista (para ensaio
// descritivo). Devolve os ensaios avaliados + contagens + `bloqueia`, que é
// true quando algum ensaio CRÍTICO reprovou.
//
// `bloqueia` NÃO trava a tela sozinho: informa. Quem decide é sempre o
// analista -- inclusive porque APROVADO_CONCESSAO existe justamente para
// liberar item fora de especificação com autorização nominal.
function avaliarPlanoInspecao(itens, resultados) {
  var res = resultados || {};
  var linhas = [];
  Object.keys(itens || {}).forEach(function(k) {
    var e = itens[k] || {};
    var r = res[k] || {};
    var auto = avaliarEnsaio(e, r.valor);
    // O C/NC manual do analista vence a avaliação automática quando existe:
    // ele viu a amostra, o sistema só leu um número.
    var conforme = r.cnc === 'C' ? true : r.cnc === 'NC' ? false : auto.conforme;
    linhas.push({
      itemKey: k,
      ensaio: e.ensaio || '',
      especificacaoTexto: e.especificacaoTexto || '',
      metodo: e.metodo || '',
      critico: !!e.critico,
      faixa: auto.faixa,
      valor: r.valor != null && r.valor !== '' ? r.valor : null,
      cnc: r.cnc || null,
      conforme: conforme,
      motivo: r.cnc ? 'Avaliação do analista.' : auto.motivo,
      automatico: auto.conforme !== null && !r.cnc
    });
  });
  linhas.sort(function(a, b) {
    if (a.critico !== b.critico) return a.critico ? -1 : 1; // crítico primeiro
    return (a.ensaio || '') < (b.ensaio || '') ? -1 : 1;
  });
  var conformes = 0, naoConformes = 0, pendentes = 0, criticosNc = 0;
  linhas.forEach(function(l) {
    if (l.conforme === true) conformes++;
    else if (l.conforme === false) { naoConformes++; if (l.critico) criticosNc++; }
    else pendentes++;
  });
  return {
    linhas: linhas, total: linhas.length,
    conformes: conformes, naoConformes: naoConformes, pendentes: pendentes,
    criticosNaoConformes: criticosNc,
    bloqueia: criticosNc > 0
  };
}

// Função PURA: acha a especificação vigente de um SKU. As chaves são
// `{codProduto}__v{n}`; sem versão informada, pega a de maior número --
// mesma convenção de chaveVersao() usada por cadastros/ops.
function especificacaoVigente(especificacoes, codProduto, versao) {
  if (!codProduto) return null;
  var alvo = sanitizeKey(codProduto);
  var melhor = null, melhorV = -1;
  Object.keys(especificacoes || {}).forEach(function(k) {
    var partes = String(k).split('__v');
    if (partes.length < 2 || sanitizeKey(partes[0]) !== alvo) return;
    var v = parseInt(partes[1], 10);
    if (isNaN(v)) return;
    if (versao != null && v !== parseInt(versao, 10)) return;
    if (v > melhorV) { melhorV = v; melhor = { key: k, versao: v, registro: especificacoes[k] }; }
  });
  return melhor;
}

// ══════════════════════════════════════════════════════════════════════
// NÃO CONFORMIDADE (RNC) — spec do Módulo CQ, seção 2.3
//
// É o elo que faz a Qualidade CONVERSAR com Compras: RNC de recebimento
// nasce vinculada ao fornecedor, e o histórico por fornecedor é o insumo de
// homologação que hoje não existe em lugar nenhum (a planilha do CQ registra
// a entrada, mas nada acumula o desempenho de quem entregou).
//
// O vínculo com o fornecedor NÃO é digitado: o lote guarda `origemRef` = a
// chave do pedido de compra, e o pedido guarda fornecedorKey/fornecedorNome.
// Ou seja, quem já lançou o PC não redigita nada -- é a mesma regra de
// "cadastro não se pede duas vezes" aplicada aqui.
// ══════════════════════════════════════════════════════════════════════

var RNC_CLASSIFICACAO = {
  CRITICA: { rotulo: 'Crítica', badge: 'badge-red',    ordem: 1 },
  MAIOR:   { rotulo: 'Maior',   badge: 'badge-orange', ordem: 2 },
  MENOR:   { rotulo: 'Menor',   badge: 'badge-gray',   ordem: 3 }
};
var RNC_STATUS = {
  ABERTA:     { rotulo: 'Aberta',      badge: 'badge-red',    aberta: true  },
  EM_ANALISE: { rotulo: 'Em análise',  badge: 'badge-orange', aberta: true  },
  CONCLUIDA:  { rotulo: 'Concluída',   badge: 'badge-green',  aberta: false }
};
// Destino do material da NC. É decisão separada do laudo: reprovar diz que
// não serve; a disposição diz o que se FAZ com ele -- e é a que gera
// devolução, descarte ou retrabalho lá na ponta.
var RNC_DISPOSICAO = {
  DEVOLUCAO:  'Devolver ao fornecedor',
  DESCARTE:   'Descartar',
  RETRABALHO: 'Retrabalhar',
  CONCESSAO:  'Usar com concessão',
  ACEITE:     'Aceitar como está'
};
var RNC_ORIGEM = {
  RECEBIMENTO: 'Recebimento',
  PRODUCAO:    'Produção',
  EXPEDICAO:   'Expedição',
  CLIENTE:     'Reclamação de cliente',
  INTERNA:     'Interna'
};

// Função PURA: próximo número livre do ano, no formato RNC-{ano}-{seq}.
// Numera por ANO, como a spec pede (2.3) -- e a sequência é derivada das
// chaves existentes, não de um contador guardado à parte, porque contador
// separado é mais uma coisa que pode dessincronizar do que ele conta.
function proximoNumeroRnc(rncs, ano) {
  var y = String(ano || new Date().getFullYear());
  var prefixo = 'RNC-' + y + '-';
  var maior = 0;
  Object.keys(rncs || {}).forEach(function(k) {
    if (k.indexOf(prefixo) !== 0) return;
    var n = parseInt(k.slice(prefixo.length), 10);
    if (!isNaN(n) && n > maior) maior = n;
  });
  return prefixo + String(maior + 1).padStart(3, '0');
}

// Função PURA: descobre o fornecedor de um lote sem ninguém digitar.
// O caminho é lote.origemRef -> pedidos_compra/{key} -> fornecedor.
function fornecedorDoLote(lote, pedidosCompra) {
  var l = lote || {};
  if (l.origemTipo !== 'recebimento_pc' || !l.origemRef) return null;
  var pc = (pedidosCompra || {})[l.origemRef];
  if (!pc) return null;
  return {
    fornecedorKey: pc.fornecedorKey || null,
    fornecedorNome: pc.fornecedorNome || null,
    pedidoKey: l.origemRef,
    pedidoNumero: pc.numeroFormatado || null
  };
}

// Abre uma RNC. A chave É o número (RNC-2026-001) -- legível no banco e
// única por construção.
//
// A corrida por número é resolvida pela própria chave: a transaction no nó
// do número escolhido ABORTA se ele já existe, e aí tentamos o seguinte.
// Um contador em `config/` seria o caminho óbvio, mas config só aceita
// escrita de admin/pcp -- o papel `qualidade`, que é justamente quem abre
// RNC, não conseguiria incrementá-lo.
function abrirRnc(dbRef, dados, autor) {
  var d = dados || {};
  if (!d.descricao || !String(d.descricao).trim()) {
    return Promise.resolve({ ok: false, erro: 'Descreva a não conformidade.' });
  }
  if (!RNC_CLASSIFICACAO[d.classificacao]) {
    return Promise.resolve({ ok: false, erro: 'Classificação inválida: ' + d.classificacao });
  }
  var agora = new Date().toISOString();
  var ano = new Date().getFullYear();

  return dbRef.ref('nao_conformidades').once('value').then(function(snap) {
    var existentes = snap.val() || {};

    function tentar(tentativa) {
      if (tentativa > 20) {
        return { ok: false, erro: 'Não foi possível reservar um número de RNC. Tente de novo.' };
      }
      var numero = proximoNumeroRnc(existentes, ano);
      var registro = {
        numero: numero,
        status: 'ABERTA',
        classificacao: d.classificacao,
        origem: RNC_ORIGEM[d.origem] ? d.origem : 'INTERNA',
        descricao: String(d.descricao).trim(),
        abertaEm: agora,
        abertaPor: autor || null,
        itemTipo: d.itemTipo || null,
        itemCodigo: d.itemCodigo || null,
        itemNome: d.itemNome || null,
        unidade: d.unidade || null,
        qtdEnvolvida: d.qtdEnvolvida != null ? d.qtdEnvolvida : null,
        loteKey: d.loteKey || null,
        loteOrigem: d.loteOrigem || null,
        fornecedorKey: d.fornecedorKey || null,
        fornecedorNome: d.fornecedorNome || null,
        pedidoKey: d.pedidoKey || null,
        pedidoNumero: d.pedidoNumero || null,
        opLote: d.opLote || null,
        acaoImediata: d.acaoImediata || null,
        automatica: !!d.automatica
      };
      return dbRef.ref('nao_conformidades/' + numero).transaction(function(atual) {
        if (atual) return; // já existe -- aborta e tentamos o próximo número
        return registro;
      }).then(function(res) {
        if (res && res.committed) return { ok: true, numero: numero, rnc: registro };
        existentes[numero] = true; // marca como ocupado e tenta o seguinte
        return tentar(tentativa + 1);
      });
    }
    return tentar(1);
  });
}

// Registra tratativa/encerramento. Encerrar exige causa raiz e ação
// corretiva -- RNC sem os dois é só um registro de que algo deu errado, que
// é exatamente o que a planilha já fazia.
function encerrarRnc(dbRef, numero, dados, autor) {
  var d = dados || {};
  if (!numero) return Promise.resolve({ ok: false, erro: 'RNC não identificada.' });
  if (!d.causaRaiz || !String(d.causaRaiz).trim()) {
    return Promise.resolve({ ok: false, erro: 'Informe a causa raiz.' });
  }
  if (!d.acaoCorretiva || !String(d.acaoCorretiva).trim()) {
    return Promise.resolve({ ok: false, erro: 'Informe a ação corretiva.' });
  }
  if (!RNC_DISPOSICAO[d.disposicao]) {
    return Promise.resolve({ ok: false, erro: 'Escolha a disposição do material.' });
  }
  var agora = new Date().toISOString();
  return dbRef.ref('nao_conformidades/' + numero).transaction(function(atual) {
    if (!atual) return atual;
    if (atual.status === 'CONCLUIDA') return; // aborta: não reencerra
    atual.status = 'CONCLUIDA';
    atual.causaRaiz = String(d.causaRaiz).trim();
    atual.acaoCorretiva = String(d.acaoCorretiva).trim();
    atual.responsavelAcao = d.responsavelAcao || null;
    atual.prazoAcao = d.prazoAcao || null;
    atual.disposicao = d.disposicao;
    atual.encerradaEm = agora;
    atual.encerradaPor = autor || null;
    return atual;
  }).then(function(res) {
    if (!res || !res.committed) {
      return { ok: false, erro: 'Esta RNC já foi concluída.' };
    }
    return { ok: true, numero: numero };
  });
}

// Move a RNC para "em análise" (alguém pegou pra tratar). Mudança leve, sem
// exigência de conteúdo -- o rigor está no encerramento.
function assumirRnc(dbRef, numero, autor) {
  if (!numero) return Promise.resolve({ ok: false, erro: 'RNC não identificada.' });
  return dbRef.ref('nao_conformidades/' + numero).transaction(function(atual) {
    if (!atual) return atual;
    if (atual.status !== 'ABERTA') return; // aborta
    atual.status = 'EM_ANALISE';
    atual.emAnaliseEm = new Date().toISOString();
    atual.emAnalisePor = autor || null;
    return atual;
  }).then(function(res) {
    if (!res || !res.committed) return { ok: false, erro: 'Esta RNC já saiu do status Aberta.' };
    return { ok: true };
  });
}

// Laudo + RNC automática numa operação só.
//
// Reprovar é o gatilho da RNC pela spec (fluxo 3.1, passo 8b: "Sistema cria
// RNC automaticamente vinculada ao RA e ao fornecedor"). Deixar isso a cargo
// da tela abriria a porta pro caso ruim -- laudo gravado, RNC não -- que é
// justamente o material reprovado sem ninguém cobrando o fornecedor.
//
// A RNC é consequência, nunca condição: se ela falhar, o laudo continua
// valendo e a resposta diz o que faltou. Travar a liberação de material por
// causa do registro administrativo seria trocar um problema de papel por um
// problema de fábrica parada.
function registrarLaudoComRnc(dbRef, itemCodigo, loteKey, laudo, autor, contexto) {
  var ctx = contexto || {};
  return registrarLaudoQualidade(dbRef, itemCodigo, loteKey, laudo, autor).then(function(r) {
    if (!r.ok) return r;
    var geraRnc = laudo.decisao === 'REPROVADO' || laudo.decisao === 'RETIDO';
    if (!geraRnc) return r;
    return abrirRnc(dbRef, {
      classificacao: laudo.decisao === 'REPROVADO' ? 'MAIOR' : 'MENOR',
      origem: ctx.origem || (ctx.itemTipo === 'produto' ? 'PRODUCAO' : 'RECEBIMENTO'),
      descricao: laudo.observacao || ('Lote ' + (ctx.loteOrigem || loteKey) + ' de ' + itemCodigo + ' com laudo ' + rotuloStatusLote(laudo.decisao) + '.'),
      itemTipo: ctx.itemTipo || 'material',
      itemCodigo: itemCodigo, itemNome: ctx.itemNome || null, unidade: ctx.unidade || null,
      qtdEnvolvida: r.saldo != null ? r.saldo : null,
      loteKey: loteKey, loteOrigem: ctx.loteOrigem || null,
      fornecedorKey: ctx.fornecedorKey || null, fornecedorNome: ctx.fornecedorNome || null,
      pedidoKey: ctx.pedidoKey || null, pedidoNumero: ctx.pedidoNumero || null,
      opLote: ctx.opLote || null,
      acaoImediata: 'Lote bloqueado para uso.',
      automatica: true
    }, autor).then(function(rr) {
      r.rnc = rr.ok ? rr.numero : null;
      r.rncErro = rr.ok ? null : rr.erro;
      return r;
    }).catch(function(err) {
      r.rnc = null;
      r.rncErro = err.message;
      return r;
    });
  });
}

// Função PURA: desempenho por fornecedor, que é o que transforma laudo
// isolado em critério de homologação. Conta lotes inspecionados e o que
// aconteceu com cada um, cruzando estoque_lotes com pedidos_compra.
function desempenhoQualidadeFornecedor(estoqueLotes, pedidosCompra, rncs) {
  var porFornecedor = {};
  function bucket(key, nome) {
    if (!porFornecedor[key]) {
      porFornecedor[key] = {
        fornecedorKey: key, fornecedorNome: nome || key,
        inspecionados: 0, liberados: 0, reprovados: 0, concessoes: 0,
        emQuarentena: 0, rncs: 0, rncsAbertas: 0
      };
    }
    return porFornecedor[key];
  }
  Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
    var lotes = estoqueLotes[itemKey] || {};
    Object.keys(lotes).forEach(function(lk) {
      var l = lotes[lk];
      if (!l) return;
      var f = fornecedorDoLote(l, pedidosCompra);
      if (!f || !f.fornecedorKey) return;
      var b = bucket(f.fornecedorKey, f.fornecedorNome);
      if (l.status === 'QUARENTENA') { b.emQuarentena++; return; }
      if (!l.qualidade || !l.qualidade.decisao) return;
      b.inspecionados++;
      if (l.qualidade.decisao === 'LIBERADO') b.liberados++;
      else if (l.qualidade.decisao === 'REPROVADO') b.reprovados++;
      else if (l.qualidade.decisao === 'APROVADO_CONCESSAO') b.concessoes++;
    });
  });
  Object.keys(rncs || {}).forEach(function(k) {
    var r = rncs[k];
    if (!r || !r.fornecedorKey) return;
    var b = bucket(r.fornecedorKey, r.fornecedorNome);
    b.rncs++;
    if ((RNC_STATUS[r.status] || {}).aberta) b.rncsAbertas++;
  });
  var lista = Object.values(porFornecedor);
  lista.forEach(function(b) {
    // Concessão NÃO conta como aprovação limpa: o material entrou fora de
    // especificação e alguém teve que autorizar. Somá-lo aos liberados
    // esconderia exatamente o fornecedor que dá mais trabalho.
    b.taxaAprovacao = b.inspecionados ? Math.round((b.liberados / b.inspecionados) * 1000) / 10 : null;
  });
  lista.sort(function(a, b) {
    if (a.taxaAprovacao === null && b.taxaAprovacao === null) return b.inspecionados - a.inspecionados;
    if (a.taxaAprovacao === null) return 1;
    if (b.taxaAprovacao === null) return -1;
    return a.taxaAprovacao - b.taxaAprovacao; // pior primeiro
  });
  return lista;
}

// Função PURA. Classifica o desempenho de UM fornecedor em algo que cabe num
// selo -- para a cotação poder mostrar, ao lado do preço, com quem se está
// prestes a fechar.
//
// Achado da auditoria de integração (2026-09-08): `desempenhoQualidadeFornecedor`
// existia e tinha UMA única chamada em todo o sistema, dentro de qualidade.html.
// O comprador comparava orçamentos por custo sem enxergar que aquele fornecedor
// reprovou lote três vezes no trimestre. O sistema calculava a reputação e não
// a usava na única decisão em que ela importa.
//
// `bucket` é um item da lista devolvida por desempenhoQualidadeFornecedor.
// Devolve null quando não há histórico: selo vazio é ruído, e "sem dados" não
// é a mesma coisa que "sem problema" -- quem lê precisa distinguir.
function classificarQualidadeFornecedor(bucket) {
  var b = bucket;
  if (!b || (!b.inspecionados && !b.rncs)) return null;
  var taxa = b.taxaAprovacao;
  // RNC ABERTA pesa mais que a taxa: é problema não resolvido, agora, e a
  // taxa é histórico. Fechar compra nova com pendência em aberto é
  // exatamente o que o selo existe pra evitar.
  var nivel;
  if (b.rncsAbertas > 0) nivel = 'ruim';
  else if (taxa == null) nivel = 'neutro';
  else if (taxa >= 95) nivel = 'bom';
  else if (taxa >= 80) nivel = 'atencao';
  else nivel = 'ruim';
  var partes = [];
  if (taxa != null) partes.push(fmtPct1(taxa) + '% aprovação');
  if (b.rncsAbertas > 0) partes.push(b.rncsAbertas + ' RNC' + (b.rncsAbertas > 1 ? 's' : '') + ' aberta' + (b.rncsAbertas > 1 ? 's' : ''));
  else if (b.rncs > 0) partes.push(b.rncs + ' RNC' + (b.rncs > 1 ? 's' : '') + ' encerrada' + (b.rncs > 1 ? 's' : ''));
  if (!partes.length && b.emQuarentena > 0) partes.push(b.emQuarentena + ' em quarentena');
  if (!partes.length) return null;
  return {
    nivel: nivel,
    texto: partes.join(' · '),
    // Detalhe pro title= -- quem quiser o número exato passa o mouse, sem
    // encher a coluna, que já é a mais densa da tela.
    detalhe: b.inspecionados
      ? b.liberados + ' liberados, ' + b.reprovados + ' reprovados e ' +
        b.concessoes + ' com concessão em ' + b.inspecionados + ' lotes inspecionados'
      : 'sem lote inspecionado ainda',
    taxaAprovacao: taxa,
    rncsAbertas: b.rncsAbertas || 0
  };
}

// Função PURA. A partir dos insumos de um pedido (Matriz de Insumos) e do
// saldo de estoque, devolve o que precisa ser COMPRADO.
//
// Achado da auditoria de integração (2026-09-08): a Matriz calculava a falta,
// mostrava na tela e parava ali. `compras.html` nunca lia o nó `insumos` e
// `insumos.html` nunca referenciava `solicitacoes_compra` -- não havia caminho
// de ida nem de volta. O MRP existe pra descobrir a falta ANTES de ela parar a
// linha, e a informação não chegava a quem compra.
//
// A conta é a MESMA que a tela já mostra ao lado de cada insumo
// (necessário − disponível, com disponível = saldo − empenhado). Usar uma
// fórmula diferente aqui faria o botão pedir um número que a pessoa não vê em
// lugar nenhum -- e ninguém confia num número que não consegue conferir.
//
// `insumos` = insumosData do pedido; `estoque` = nó estoque inteiro.
function faltasParaSolicitacao(insumos, estoque) {
  var out = { itens: [], semCodigo: [], semEstoque: 0 };
  Object.keys(insumos || {}).forEach(function(k) {
    var it = insumos[k] || {};
    var necessaria = parseFloat(it.qtdNecessaria) || 0;
    if (necessaria <= 0) return;
    // Insumo digitado à mão não tem material vinculado: não dá pra montar
    // uma solicitação sem código, e inventar um seria pior. Fica listado
    // como pendência pra pessoa resolver no cadastro.
    if (!it.mpCodigo) { out.semCodigo.push(it.nome || k); return; }
    var est = (estoque || {})[sanitizeKey(it.mpCodigo)];
    var temRegistro = !!est;
    var disponivel = temRegistro ? ((est.saldoAtual || 0) - (est.saldoEmpenhado || 0)) : 0;
    if (!temRegistro) out.semEstoque++;
    // Saldo negativo (existem em produção) não vira "falta maior": o que ele
    // significa é que a base está errada, não que se precisa comprar mais.
    // Tratado como zero disponível, e sinalizado.
    var disponivelUtil = disponivel > 0 ? disponivel : 0;
    var falta = necessaria - disponivelUtil;
    if (falta <= 0) return;
    out.itens.push({
      insumoKey: k,
      mpCodigo: it.mpCodigo,
      nome: it.nome || it.mpCodigo,
      unidade: it.unidade || (est && est.unidade) || '',
      qtdNecessaria: necessaria,
      qtdRecebida: parseFloat(it.qtdRecebida) || 0,
      disponivel: temRegistro ? disponivel : null,
      saldoNegativo: disponivel < 0,
      semRegistroEstoque: !temRegistro,
      falta: Math.round(falta * 10000) / 10000
    });
  });
  // Maior falta primeiro: é a que trava mais rápido.
  out.itens.sort(function(a, b) { return b.falta - a.falta; });
  return out;
}

// Uma casa decimal, sem casa quando é inteiro: "97,5%" e "100%", nunca
// "100,0%".
function fmtPct1(n) {
  var v = Number(n);
  if (isNaN(v)) return '—';
  return (Math.round(v * 10) / 10).toString().replace('.', ',');
}

// ══════════════════════════════════════════════════════════════════════
// INVENTÁRIO ROTATIVO (contagem cíclica)
//
// O mecanismo que mantém um WMS honesto DEPOIS da carga inicial: conta-se um
// pedaço do armazém por dia, em rodízio, sem parar a operação. Sem ele, a
// única alternativa é parar tudo e recontar o galpão inteiro -- que foi
// exatamente o que a auditoria apontou como faltando (zero código no app).
//
// Critério de prioridade escolhido pelo usuário: "há mais tempo sem contar +
// posição ocupada". Posição vazia não entra (não há o que conferir), e nunca
// contada vem antes de qualquer uma já contada -- é onde mora o risco.
// ══════════════════════════════════════════════════════════════════════

// Função PURA. Devolve as posições ordenadas por urgência de contagem.
// `enderecos` = enderecos_estoque; `ocupantesPorEndereco` = {enderecoKey: n};
// `hojeISO` injetável pra o teste não depender do relógio.
function priorizarContagemInventario(enderecos, ocupantesPorEndereco, hojeISO) {
  var hoje = new Date(hojeISO || new Date().toISOString());
  var out = [];
  Object.keys(enderecos || {}).forEach(function(key) {
    var e = enderecos[key];
    if (!e) return;
    var ocupantes = (ocupantesPorEndereco || {})[key] || 0;
    // Posição vazia não entra no rodízio: não há saldo pra conferir, e
    // encher a fila de posição vazia é o defeito clássico do rodízio "por
    // rua em ordem fixa".
    if (ocupantes <= 0) return;
    // Posição bloqueada TAMBÉM entra -- "em contagem" é justamente um dos
    // motivos de bloqueio, e material parado numa posição interditada é
    // exatamente o que mais precisa ser conferido.
    var ultima = e.ultimaContagemEm || null;
    var diasSemContar = ultima
      ? Math.floor((hoje - new Date(ultima)) / 86400000)
      : null; // null = NUNCA contada
    out.push({
      enderecoKey: key,
      enderecoCodigo: e.codigo || key,
      area: e.area || null,
      rua: e.rua, nivel: e.nivel, predio: e.predio,
      ocupantes: ocupantes,
      bloqueada: e.ativo === false,
      ultimaContagemEm: ultima,
      diasSemContar: diasSemContar
    });
  });
  out.sort(function(a, b) {
    // nunca contada primeiro
    if (a.diasSemContar === null && b.diasSemContar !== null) return -1;
    if (b.diasSemContar === null && a.diasSemContar !== null) return 1;
    if (a.diasSemContar !== b.diasSemContar) return (b.diasSemContar || 0) - (a.diasSemContar || 0);
    // desempate determinístico por endereço físico, pra a fila não dançar
    // entre recarregamentos e a pessoa conseguir percorrer o galpão em ordem
    return (a.rua - b.rua) || (a.nivel - b.nivel) || (a.predio - b.predio);
  });
  return out;
}

// Função PURA. Congela o que o sistema ACHA que tem numa posição, no momento
// em que a contagem começa. É esse retrato -- não o saldo do momento em que
// a pessoa terminar de contar -- que a divergência compara, senão um consumo
// que aconteça durante a contagem apareceria como erro de quem contou.
function snapshotEsperadoPosicao(enderecoKey, estoqueLotes) {
  var esperado = {};
  Object.keys(estoqueLotes || {}).forEach(function(itemKey) {
    var lotes = estoqueLotes[itemKey] || {};
    Object.keys(lotes).forEach(function(loteKey) {
      var l = lotes[loteKey];
      if (!l || l.enderecoKey !== enderecoKey) return;
      if ((l.saldoLote || 0) <= 0) return;
      var cod = l.itemCodigo;
      if (!esperado[cod]) {
        esperado[cod] = { itemCodigo: cod, itemNome: l.itemNome || null, unidade: l.unidade || null, saldoEsperado: 0, lotes: {} };
      }
      esperado[cod].saldoEsperado = Math.round((esperado[cod].saldoEsperado + (l.saldoLote || 0)) * 1000) / 1000;
      esperado[cod].lotes[loteKey] = {
        saldoLote: l.saldoLote, loteOrigem: l.loteOrigem || null, dataValidade: l.dataValidade || null, itemKey: itemKey
      };
    });
  });
  return esperado;
}

// Função PURA. Compara o contado com o esperado congelado.
// `contado` = {itemCodigo: qtd}. Itens contados que o sistema não esperava
// naquela posição entram como sobra (esperado 0) -- é achado comum e
// importante: material guardado no lugar errado.
function calcularDivergenciaInventario(esperado, contado) {
  var linhas = [];
  var codigos = {};
  Object.keys(esperado || {}).forEach(function(c) { codigos[c] = 1; });
  Object.keys(contado || {}).forEach(function(c) { codigos[c] = 1; });
  Object.keys(codigos).forEach(function(cod) {
    var esp = (esperado && esperado[cod]) ? (esperado[cod].saldoEsperado || 0) : 0;
    var con = (contado && contado[cod] != null) ? (Number(contado[cod]) || 0) : 0;
    var dif = Math.round((con - esp) * 1000) / 1000;
    linhas.push({
      itemCodigo: cod,
      itemNome: (esperado && esperado[cod] && esperado[cod].itemNome) || null,
      unidade: (esperado && esperado[cod] && esperado[cod].unidade) || null,
      saldoEsperado: esp,
      qtdContada: con,
      diferenca: dif,
      // 'sobra' = achou material que o sistema não sabia que estava ali
      // (inclui item inteiro inesperado); 'falta' = contou menos do que devia
      tipo: dif === 0 ? 'ok' : (dif > 0 ? 'sobra' : 'falta'),
      inesperado: esp === 0 && con > 0
    });
  });
  linhas.sort(function(a, b) { return Math.abs(b.diferenca) - Math.abs(a.diferenca); });
  var comDivergencia = linhas.filter(function(l) { return l.tipo !== 'ok'; });
  return {
    linhas: linhas,
    divergentes: comDivergencia,
    confere: comDivergencia.length === 0,
    // acurácia da posição: quantos itens bateram sobre o total conferido --
    // é o indicador que se acompanha ao longo do tempo pra saber se o WMS
    // está melhorando ou piorando
    acuraciaPct: linhas.length ? Math.round((linhas.length - comDivergencia.length) / linhas.length * 100) : 100
  };
}

// Aplica o resultado de uma contagem de inventário no estoque endereçado.
// É a ÚNICA função do módulo de inventário que escreve.
//
// Regras, todas deliberadas:
//  - Só mexe em `estoque_lotes` (o WMS). NÃO toca `estoque/{key}.saldoAtual`,
//    mantendo o desacoplamento estoque × WMS que o usuário definiu. Se a
//    contagem física também deve corrigir o agregado, isso é um segundo
//    passo consciente, feito em "Ajustar Estoque" -- não um efeito colateral
//    escondido de uma contagem de posição.
//  - FALTA é rateada entre os lotes daquela posição em ordem FEFO (o que
//    vence primeiro é o que some primeiro, por consumo não apontado). SOBRA
//    vai toda pro lote de validade mais distante -- não dá pra inventar
//    validade pra material achado sobrando, e jogar no mais distante é a
//    escolha conservadora (evita criar saldo "quase vencendo" fictício).
//  - Item INESPERADO (não havia lote nenhum dele na posição) NÃO é criado
//    automaticamente: exige endereçamento explícito, senão a contagem viraria
//    uma porta lateral pra criar estoque sem rastreabilidade de origem.
//    Volta em `naoAplicados` pra a tela avisar.
//  - Grava um movimento por lote tocado, tipo 'inventario'.
function aplicarAjusteInventario(dbRef, contagem, autor) {
  var divergentes = (contagem && contagem.divergentes) || [];
  if (!divergentes.length) return Promise.resolve({ aplicados: 0, naoAplicados: [] });
  var agora = new Date().toISOString();
  var esperado = contagem.esperado || {};
  var naoAplicados = [];
  var aplicados = 0;

  return Promise.all(divergentes.map(function(d) {
    var esp = esperado[d.itemCodigo];
    if (!esp || !esp.lotes || !Object.keys(esp.lotes).length) {
      naoAplicados.push({ itemCodigo: d.itemCodigo, motivo: 'item não estava endereçado nesta posição -- use Endereçamento pra registrar a entrada' });
      return Promise.resolve();
    }
    // ordena os lotes da posição em FEFO pra ratear a falta
    var lotes = Object.keys(esp.lotes).map(function(loteKey) {
      return { loteKey: loteKey, info: esp.lotes[loteKey] };
    }).sort(function(a, b) {
      var va = a.info.dataValidade || '', vb = b.info.dataValidade || '';
      if (va && vb && va !== vb) return va < vb ? -1 : 1;
      if (va && !vb) return -1;
      if (!va && vb) return 1;
      return 0;
    });

    var restante = d.diferenca; // negativo = falta, positivo = sobra
    var alvos = restante > 0 ? [lotes[lotes.length - 1]] : lotes; // sobra vai pro de validade mais distante
    // SEQUENCIAL, não Promise.all: `restante` precisa ser decrementado por um
    // lote antes de o próximo decidir quanto tirar. Em paralelo, todos os
    // lotes enxergavam o restante original e cada um tirava o máximo que
    // podia -- uma falta de 700 zerava um lote de 600 E um de 400
    // (abatimento de 1000). Achado pelo próprio teste desta função.
    return alvos.reduce(function(cadeia, alvo) {
      return cadeia.then(function() {
      if (restante === 0) return null;
      var itemKey = alvo.info.itemKey;
      var delta = 0;
      return dbRef.ref('estoque_lotes/' + itemKey + '/' + alvo.loteKey).transaction(function(atual) {
        if (!atual) return atual;
        var saldo = atual.saldoLote || 0;
        // falta: nunca tira mais do que o lote tem (o resto escorre pro
        // próximo lote em FEFO). sobra: soma tudo no alvo escolhido.
        delta = restante < 0 ? -Math.min(-restante, saldo) : restante;
        atual.saldoLote = Math.round((saldo + delta) * 1000) / 1000;
        atual.atualizadoEm = agora;
        return atual;
      }).then(function(res) {
        if (!res || !res.committed || delta === 0) return null;
        restante = Math.round((restante - delta) * 1000) / 1000;
        aplicados++;
        return dbRef.ref('movimentos_estoque/' + itemKey).push({
          tipo: 'inventario',
          motivo: 'AJUSTE DE INVENTÁRIO (' + (delta < 0 ? 'falta' : 'sobra') + ')',
          qtd: delta,
          saldoApos: (res.snapshot.val() || {}).saldoLote,
          ref: 'contagem ' + (contagem.enderecoCodigo || contagem.enderecoKey || ''),
          loteKey: alvo.loteKey,
          enderecoKey: contagem.enderecoKey || null,
          enderecoCodigo: contagem.enderecoCodigo || null,
          itemTipo: 'material',
          itemCodigo: d.itemCodigo,
          itemNome: d.itemNome || null,
          unidade: d.unidade || null,
          autor: autor || null,
          em: agora
        });
      });
      });
    }, Promise.resolve()).then(function() {
      // sobrou falta que nenhum lote da posição cobriu -- o saldo endereçado
      // era menor que a falta apurada; registra pra a tela mostrar
      if (restante < 0) {
        naoAplicados.push({ itemCodigo: d.itemCodigo, motivo: 'faltavam ' + Math.abs(restante) + ' além do saldo endereçado nesta posição' });
      }
    });
  })).then(function() {
    return { aplicados: aplicados, naoAplicados: naoAplicados };
  });
}

// Função PURA (sem dbRef, sem I/O) -- o "cérebro" da separação guiada, só
// sugere DE ONDE tirar (FEFO -- mais próximo de vencer sai primeiro,
// pedido explícito do usuário: "importante a visão de FIFO, ou até melhor
// seria a visão de mais perto de vencer"). NUNCA sugere destino -- isso é
// sempre escolha manual de quem confirma a separação ("não deixaria
// automático, gostaria de ir sempre direcionando, conferindo"). Testável
// isolada, sem mock de Firebase. `lotesDoItem` = Object.values já
// carregado client-side (mesmo padrão de ocupantesPorEndereco). Nunca
// lança erro -- `faltante > 0` é um resultado válido, não uma falha.
// `enderecosBloqueados` (opcional, {enderecoKey: true}) tira da sugestão os
// lotes que estão numa posição bloqueada -- posição interditada/danificada/
// em contagem não deve mandar ninguém buscar lá. Parâmetro OPCIONAL de
// propósito: omitir mantém o comportamento antigo (nada bloqueado),
// preservando as chamadas que já existiam antes do bloqueio de posição.
// Se isso deixar faltando quantidade, o `faltante` já existente avisa na
// tela -- é melhor avisar do que rotear o separador pra uma posição
// interditada.
function sugerirAlocacaoFefo(itemCodigo, qtdNecessaria, lotesDoItem, enderecosBloqueados) {
  var bloqueados = enderecosBloqueados || {};
  var candidatos = Object.entries(lotesDoItem || {})
    .filter(function(entry) {
      var lote = entry[1];
      // loteDisponivel (não `status === 'LIBERADO'` literal): com o
      // vocabulário da spec do CQ, APROVADO_CONCESSAO também é material
      // liberado pra uso -- é o "aprovado com concessão", autorizado
      // formalmente apesar do desvio. Com a comparação literal ele nasceria
      // invisível pra separação, consumo e expedição ao mesmo tempo.
      if (!lote || lote.itemCodigo !== itemCodigo || !loteDisponivel(lote.status) || (lote.saldoLote || 0) <= 0) return false;
      if (lote.enderecoKey && bloqueados[lote.enderecoKey]) return false;
      return true;
    })
    .map(function(entry) { return { loteKey: entry[0], lote: entry[1] }; })
    .sort(function(a, b) {
      var va = a.lote.dataValidade || null, vb = b.lote.dataValidade || null;
      if (va && vb && va !== vb) return va < vb ? -1 : 1; // mais próximo de vencer primeiro
      if (va && !vb) return -1; // tem validade conhecida vem antes de quem não tem
      if (!va && vb) return 1;
      var ra = a.lote.dataRecebimento || '', rb = b.lote.dataRecebimento || '';
      if (ra !== rb) return ra < rb ? -1 : 1; // empate de validade -- o mais antigo recebido primeiro
      var ca = a.lote.enderecoCodigo || '', cb = b.lote.enderecoCodigo || '';
      return ca < cb ? -1 : (ca > cb ? 1 : 0); // empate final -- determinístico
    });

  var restante = qtdNecessaria || 0;
  var alocacoes = [];
  candidatos.forEach(function(c) {
    if (restante <= 0) return;
    var qtdAlocada = Math.min(c.lote.saldoLote || 0, restante);
    if (qtdAlocada <= 0) return;
    alocacoes.push({
      loteKey: c.loteKey, enderecoKey: c.lote.enderecoKey || null, enderecoCodigo: c.lote.enderecoCodigo || null,
      qtdSugerida: Math.round(qtdAlocada * 1000) / 1000, dataValidade: c.lote.dataValidade || null
    });
    restante = Math.round((restante - qtdAlocada) * 1000) / 1000;
  });
  var qtdTotal = Math.round(alocacoes.reduce(function(s, a) { return s + a.qtdSugerida; }, 0) * 1000) / 1000;
  return {
    alocacoes: alocacoes, qtdTotal: qtdTotal,
    faltante: Math.max(0, Math.round(((qtdNecessaria || 0) - qtdTotal) * 1000) / 1000)
  };
}

// ── Tipos de fornecedor (multi) ─────────────────────────────────────────
// Achado do usuário: um fornecedor real (ex: uma matriz com 3 CNPJs)
// costuma vender em mais de uma categoria ao mesmo tempo -- embalagem,
// válvula E matéria-prima, por exemplo. `tipo` (singular, o schema
// antigo) não dava conta disso: cadastrado como só "mp", o fornecedor
// sumia da lista de "fornecedor homologado" na hora de vincular a um
// material de embalagem (cadastros.html#refreshFhFornecedorOptions
// comparava tipo===tipoAlvo) e do <select> de transportadora em
// logistica.html (mesmo bug, mesma causa). `fornecedores/{key}.tipos`
// agora é um ARRAY -- tiposFornecedor(f) lê os dois formatos (novo
// `tipos`, ou o `tipo` singular antigo de cadastro nunca editado desde
// essa mudança) sem precisar de migração em massa: qualquer fornecedor
// antigo migra sozinho pra `tipos` na próxima vez que alguém salvar o
// cadastro dele em cadastros.html (ver saveFornecedor). Compartilhada
// (não só cadastros.html) porque logistica.html também lê fornecedores/
// filtrando por tipo (transportadora).
function tiposFornecedor(f) {
  if (!f) return [];
  if (Array.isArray(f.tipos)) return f.tipos;
  if (f.tipos && typeof f.tipos === 'object') return Object.keys(f.tipos).filter(function(k) { return f.tipos[k]; });
  return f.tipo ? [f.tipo] : [];
}

// ── Log de alterações de cadastro ───────────────────────────────────────
// Cadastros (Materiais por ora, mesmo padrão dá pra reusar em Produtos/
// Clientes/Fornecedores depois) não guardavam histórico nenhum -- salvar
// sempre sobrescrevia o registro inteiro, sem rastro de quem mudou o quê.
// Compara `antes` (registro como estava) com `depois` (o que vai ser
// gravado) campo a campo (JSON.stringify pra cobrir objeto aninhado tipo
// fornecedores/variantesEquivalentes também) e devolve só as mudanças reais
// -- quem chama inclui isso no MESMO multi-path update() da gravação, pra
// nunca logar uma mudança que não foi salva (ou vice-versa).
function diffParaHistorico(antes, depois, alteradoPor, ignorarCampos) {
  ignorarCampos = ignorarCampos || [];
  var campos = {};
  Object.keys(depois || {}).forEach(function(k) { campos[k] = true; });
  Object.keys(antes || {}).forEach(function(k) { campos[k] = true; });
  var agora = new Date().toISOString();
  var mudancas = [];
  Object.keys(campos).forEach(function(k) {
    if (ignorarCampos.indexOf(k) !== -1) return;
    var v1 = antes ? antes[k] : undefined;
    var v2 = (depois || {})[k];
    var s1 = JSON.stringify(v1 === undefined ? null : v1);
    var s2 = JSON.stringify(v2 === undefined ? null : v2);
    if (s1 === s2) return;
    mudancas.push({
      campo: k,
      valorAnterior: v1 === undefined ? null : v1,
      valorNovo: v2 === undefined ? null : v2,
      alteradoPor: alteradoPor,
      alteradoEm: agora
    });
  });
  return mudancas;
}

// ── % de preenchimento de cadastro ──────────────────────────────────────
// Usado por cadastros.html (Materiais/Produtos/Clientes/Fornecedores) pra
// mostrar, em cada linha da tabela, quanto do cadastro já foi preenchido --
// incentiva completar o registro em vez de só bater os campos obrigatórios
// mínimos. `campos` é um array onde cada item é uma string (dot-path lido
// direto de dentro do objeto, ex: 'cq.ph') ou {path, aplicavel(obj)} pra
// campo que só existe pra um subtipo do registro (ex: campo de Embalagem
// Primária não deveria contar contra um material de Matéria-Prima). Campo
// booleano/checkbox e select com valor padrão pré-selecionado ficam DE
// FORA de propósito -- não têm um estado "vazio" distinto de uma resposta
// válida, então contá-los só inflaria o % sem significar nada.
function valorPreenchido(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return v !== 0 && !isNaN(v);
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return !!v;
}
function lerCampoPreenchimento(obj, path) {
  return path.split('.').reduce(function(o, k) { return (o && o[k] !== undefined) ? o[k] : undefined; }, obj);
}
function calcularPreenchimento(obj, campos) {
  var total = 0, preenchidos = 0;
  (campos || []).forEach(function(c) {
    var path = typeof c === 'string' ? c : c.path;
    var aplicavel = typeof c === 'string' || typeof c.aplicavel !== 'function' || c.aplicavel(obj);
    if (!aplicavel) return;
    total++;
    if (valorPreenchido(lerCampoPreenchimento(obj, path))) preenchidos++;
  });
  return { pct: total > 0 ? Math.round((preenchidos / total) * 100) : 100, preenchidos: preenchidos, total: total };
}
// Escala contínua vermelho→amarelo→verde (interpola o matiz HSL de 0 a
// 120), em vez de 3 faixas fixas com corte abrupto -- fica claro que 40%
// é "melhor que 20%" e não só "ainda vermelho".
function corPreenchimento(pct) {
  return 'hsl(' + (Math.max(0, Math.min(100, pct)) * 1.2) + ', 70%, 42%)';
}
// Barrinha + % pra célula de tabela. Trilho usa var(--surface-2) (já
// tokenizado claro/escuro em todo o app) em vez de cor fixa, pra não ficar
// lavado no dark mode; só o preenchimento em si usa a escala de cor.
function preenchimentoBadgeHtml(pct) {
  var cor = corPreenchimento(pct);
  return '<div style="display:flex;align-items:center;gap:6px" title="' + pct + '% do cadastro preenchido">' +
    '<div style="flex:1;min-width:44px;height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden">' +
      '<div style="width:' + pct + '%;height:100%;background:' + cor + ';border-radius:3px"></div>' +
    '</div>' +
    '<span style="font-size:11px;font-weight:700;color:' + cor + ';font-variant-numeric:tabular-nums;min-width:30px;text-align:right">' + pct + '%</span>' +
  '</div>';
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

/* ══════════════════════════════════════════════════════════════════════
   PEDIDO DE COMPRA IMPRESSO — o documento que vai pro fornecedor

   Até aqui o sistema parava de falar com o fornecedor no momento em que a
   compra era DECIDIDA: havia rascunho de e-mail pra cotação (antes), e nada
   depois. Na prática o pedido saía por fora -- e-mail à mão, WhatsApp --,
   o que significa que o fornecedor recebia uma versão que ninguém garantia
   ser igual à do sistema: nem o preço negociado, nem o prazo, nem o
   endereço de coleta.

   Mesmo mecanismo das 5 fichas de OP: HTML com as classes .print-page/
   .print-table que emitir_op.html e ops.html já estilizam pra impressão.
   ══════════════════════════════════════════════════════════════════════ */

// Dinheiro no documento impresso. `toFixed(2).replace('.', ',')` sozinho
// produz "R$ 8000,00" -- sem separador de milhar, que num papel que vai pro
// fornecedor é onde alguém lê 8.000 como 800 ou 80.000.
function fmtBRLDoc(n) {
  var v = Number(n);
  if (isNaN(v)) return '—';
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// O documento carrega o PRÓPRIO estilo, em vez de depender de CSS declarado
// na página que o imprime. As 5 fichas de OP fizeram o contrário e o bloco
// acabou copiado em emitir_op.html E ops.html -- a mesma duplicação que já
// registramos como problema na lista dos campos de etiqueta.
//
// Paleta tirada do logotipo: navy #0a1c69. Sem cinza puro -- os neutros
// puxam levemente pro azul, pra o papel parecer da mesma família que a
// marca em vez de um formulário genérico.
//
// `print-color-adjust: exact` é obrigatório: por padrão o navegador remove
// fundos na impressão, e sem isso o cabeçalho e o total sairiam brancos.
function estilosDocumentoPC() {
  return '<style>' +
    '#printArea{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.pcdoc{page-break-after:always;padding:14mm 13mm;font-size:10.5px;line-height:1.45}' +
    '.pcdoc:last-child{page-break-after:auto}' +
    // Cabeçalho: logo à esquerda, identificação do documento à direita.
    '.pcdoc-cab{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #0a1c69;padding-bottom:9px;margin-bottom:4px}' +
    '.pcdoc-logo{height:13mm;width:auto;display:block}' +
    '.pcdoc-emissor{font-size:8.5px;color:#6b7280;margin-top:5px;letter-spacing:.02em}' +
    '.pcdoc-id{text-align:right;line-height:1.25}' +
    '.pcdoc-tipo{font-size:8.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#6b7280}' +
    '.pcdoc-num{font-size:21px;font-weight:700;color:#0a1c69;letter-spacing:-.01em}' +
    '.pcdoc-data{font-size:9px;color:#6b7280}' +
    // Seções: um filete fino e um rótulo pequeno em versalete.
    '.pcdoc-sec{font-size:8.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#0a1c69;' +
      'margin:16px 0 6px;padding-bottom:3px;border-bottom:1px solid #dfe3ec}' +
    // Pares rótulo-acima/valor-abaixo, o mesmo padrão da tela de cotação.
    '.pcdoc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px 18px}' +
    '.pcdoc-grid.duas{grid-template-columns:repeat(2,1fr)}' +
    '.pcdoc-campo>span{display:block;font-size:7.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8b93a5;margin-bottom:1px}' +
    '.pcdoc-campo>b{font-size:10.5px;font-weight:600;color:#1a1a1a}' +
    // Tabela: só filetes horizontais. Grade fechada pesa e não ajuda a ler.
    '.pcdoc-tab{width:100%;border-collapse:collapse;margin-top:2px;font-variant-numeric:tabular-nums}' +
    '.pcdoc-tab th{font-size:7.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;' +
      'text-align:left;padding:5px 7px;background:#f4f6fb;border-bottom:1px solid #cfd6e4}' +
    '.pcdoc-tab td{padding:6px 7px;border-bottom:1px solid #eceff5;font-size:10px;vertical-align:top}' +
    '.pcdoc-tab .num{text-align:right}' +
    '.pcdoc-cod{font-weight:700;color:#0a1c69}' +
    '.pcdoc-imposto{font-size:8.5px;color:#6b7280}' +
    // Total: destaque discreto, alinhado à direita.
    '.pcdoc-total{margin-top:9px;display:flex;justify-content:flex-end}' +
    '.pcdoc-total-cx{background:#f4f6fb;border-left:2.5px solid #0a1c69;padding:7px 13px;text-align:right;min-width:62mm}' +
    // Subtotal e impostos: pares rótulo/valor em cinza, acima do total.
    '.pcdoc-tot-linha{display:flex;justify-content:space-between;gap:16px;font-size:9px;color:#6b7280;' +
      'padding-bottom:2px;font-variant-numeric:tabular-nums}' +
    '.pcdoc-tot-linha+.pcdoc-total-lbl{margin-top:4px;padding-top:4px;border-top:1px solid #cfd6e4}' +
    '.pcdoc-total-lbl{font-size:7.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}' +
    '.pcdoc-total-val{font-size:15px;font-weight:700;color:#0a1c69;font-variant-numeric:tabular-nums}' +
    '.pcdoc-nota{font-size:8px;color:#8b93a5;margin-top:3px;text-align:right}' +
    // Aviso (identificação obrigatória / instrução da etiqueta)
    '.pcdoc-aviso{margin-top:14px;background:#f7f8fb;border:1px solid #dfe3ec;border-left:2.5px solid #0a1c69;padding:8px 11px;font-size:9.5px;color:#41485a}' +
    '.pcdoc-aviso b{color:#0a1c69}' +
    // Assinatura
    '.pcdoc-assin{margin-top:20px;display:flex;gap:22px}' +
    '.pcdoc-assin div{flex:1;border-top:1px solid #9aa2b4;padding-top:4px;font-size:8.5px;color:#6b7280;text-align:center}' +
    // Etiqueta: cartão com a cara do que o fornecedor vai colar.
    '.pcdoc-etq{border:1px solid #cfd6e4;border-radius:3px;overflow:hidden;margin-top:4px}' +
    '.pcdoc-etq-linha{display:flex;border-bottom:1px solid #eceff5}' +
    '.pcdoc-etq-linha:last-child{border-bottom:none}' +
    '.pcdoc-etq-c{width:47%;padding:6px 9px;background:#f7f8fb;font-size:8.5px;color:#41485a;border-right:1px solid #eceff5}' +
    '.pcdoc-etq-v{flex:1;padding:6px 9px;font-size:10px;display:flex;align-items:center}' +
    '.pcdoc-etq-v b{color:#0a1c69;font-weight:700}' +
    // Campo que o fornecedor preenche: linha pontilhada, convidando a escrever.
    '.pcdoc-etq-branco{flex:1;border-bottom:1px dotted #a9b1c2;min-height:11px}' +
    '.pcdoc-rodape{margin-top:16px;padding-top:6px;border-top:1px solid #eceff5;font-size:7.5px;color:#a2a9b8;display:flex;justify-content:space-between}' +
    '@page{margin:0}' +
  '</style>';
}

// Função PURA. Os totais que vão no papel do FORNECEDOR -- que NÃO são os
// mesmos números do custo interno.
//
// O documento imprimia `valorTotalEstimado`, que é CUSTO: traz o frete FOB
// somado e o crédito de ICMS descontado. Duas consequências, as duas ruins
// num papel que sai da empresa:
//   1. as linhas da tabela somavam um número e o "Total" mostrava outro --
//      o fornecedor confere e não fecha;
//   2. o total ficava ABAIXO do que ele vai faturar, porque o crédito de
//      ICMS é nosso, não dele.
// E, por ser congelado na decisão, não mexia quando o pedido era editado --
// tirar o frete não mudava o total (caso relatado pelo usuário).
//
// Aqui o total é o que o fornecedor vai cobrar: itens − desconto + IPI + ST
// + ISS. O frete FOB fica FORA do total (quem paga a transportadora somos
// nós, em outra nota) e aparece como informação. Em CIF já está no preço, e
// somar seria cobrá-lo duas vezes.
function totaisDocumentoPC(pc) {
  var p = pc || {};
  var frete = p.frete || {};
  var t = {
    bruto: 0, desconto: 0, subtotal: 0, ipi: 0, st: 0, iss: 0, totalNota: 0,
    freteTipo: frete.tipo || null,
    freteFob: frete.tipo === 'FOB' ? (parseFloat(frete.valor) || 0) : 0
  };
  Object.values(p.itens || {}).forEach(function(i) {
    // Reusa a MESMA função de custo da cotação: dois cálculos de imposto
    // vivendo em lugares diferentes divergem no primeiro ajuste que alguém
    // fizer num deles. Frete rateado 0 aqui de propósito -- ele entra (ou
    // não) no rodapé, nunca dentro do item.
    var c = calcularCustoItemCotacao({
      precoUnit: i.precoUnit,
      qtdCotada: i.qtdCotada != null ? i.qtdCotada : i.qtd,
      unidadeCotada: i.unidadeCotada, fatorConversao: i.fatorConversao,
      pctNf: i.pctNf, pctIpi: i.pctIpi, pctIcms: i.pctIcms,
      pctIcmsSt: i.pctIcmsSt, pctIss: i.pctIss, descontoPct: i.descontoPct
    }, 0, i.unidade);
    t.bruto += c.bruto; t.desconto += c.desconto; t.subtotal += c.liquido;
    t.ipi += c.ipi; t.st += c.st; t.iss += c.iss;
  });
  t.totalNota = t.subtotal + t.ipi + t.st + t.iss;
  return t;
}

// Linha secundária da caixa de totais (subtotal, desconto, cada imposto).
// Discreta de propósito: o número que salta aos olhos tem que ser um só.
function linhaTotalPC(rotulo, valor) {
  // Abatimento sai como "− R$ 100,00", não "R$ -100,00": o sinal colado no
  // R$ some numa impressão a laser e o desconto vira acréscimo.
  var v = Number(valor) || 0;
  var txt = v < 0 ? '− ' + fmtBRLDoc(-v) : fmtBRLDoc(v);
  return '<div class="pcdoc-tot-linha"><span>' + escapeHtml(rotulo) + '</span>' +
    '<span>' + txt + '</span></div>';
}

// Página 1: o pedido em si. `pc` = pedidos_compra/{key}, `fornecedor` =
// fornecedores/{key} (pode ser null -- o PC guarda o nome denormalizado).
function paginaPedidoCompra(pc, fornecedor) {
  var p = pc || {};
  var f = fornecedor || {};
  var itens = Object.values(p.itens || {});
  var frete = p.frete || {};
  var ehFob = frete.tipo === 'FOB';
  var tot = totaisDocumentoPC(p);

  var linhaItem = function(i) {
    var q = i.qtdCotada != null ? i.qtdCotada : i.qtd;
    // A unidade do documento é a que foi COTADA, não a de estoque. Um pedido
    // de 35 kg impresso como "35 rolo" faz o fornecedor entregar 35 rolos --
    // o número certo com a unidade errada é pior que número errado, porque
    // ninguém desconfia dele.
    var un = i.unidadeCotada || i.unidade || '';
    var unEstoque = i.unidade || '';
    var equivale = (i.qtdEmUnidadeEstoque != null && unEstoque &&
                    un.toLowerCase() !== unEstoque.toLowerCase())
      ? '<div class="pcdoc-imposto">≈ ' + fmtNum(i.qtdEmUnidadeEstoque) + ' ' + escapeHtml(unEstoque) + '</div>' : '';
    var preco = parseFloat(i.precoUnit) || 0;
    var impostos = [
      i.pctIpi ? 'IPI ' + i.pctIpi + '%' : '',
      i.pctIcmsSt ? 'ST ' + i.pctIcmsSt + '%' : '',
      i.pctIss ? 'ISS ' + i.pctIss + '%' : ''
    ].filter(Boolean).join(' · ');
    // Impostos como linha secundária sob a descrição, não em coluna própria:
    // é informação de conferência, não de leitura principal, e uma 6ª coluna
    // espremeria as que importam.
    return '<tr>' +
      '<td class="pcdoc-cod">' + escapeHtml(i.materialCodigo || '') + '</td>' +
      '<td>' + escapeHtml(i.materialNome || '') +
        (impostos ? '<div class="pcdoc-imposto">' + escapeHtml(impostos) + '</div>' : '') + '</td>' +
      '<td class="num">' + fmtNum(q) + (un ? ' ' + escapeHtml(un) : '') + equivale + '</td>' +
      '<td class="num">' + (preco ? fmtBRLDoc(preco) + (un ? '<div class="pcdoc-imposto">por ' + escapeHtml(un) + '</div>' : '') : '—') + '</td>' +
      '<td class="num">' + (preco && q ? fmtBRLDoc(preco * q) : '—') + '</td>' +
    '</tr>';
  };

  // Campo só aparece se tiver valor: rótulo pendurado sem conteúdo polui o
  // documento e faz parecer que faltou preencher.
  var campo = function(rot, val) {
    return val ? '<div class="pcdoc-campo"><span>' + escapeHtml(rot) + '</span><b>' + escapeHtml(String(val)) + '</b></div>' : '';
  };

  return '<div class="pcdoc">' +
    cabecalhoDocumentoPC('Pedido de Compra', p.numeroFormatado,
      (p.dataEmissao || p.dataCriacao) ? new Date(p.dataEmissao || p.dataCriacao).toLocaleDateString('pt-BR') : null,
      p.criadoPor) +

    '<div class="pcdoc-sec">Fornecedor</div>' +
    '<div class="pcdoc-grid">' +
      campo('Razão social', f.razaoSocial || p.fornecedorNome) +
      campo('CNPJ', f.cnpj) +
      campo('Contato', f.contatoNome) +
      campo('Telefone', f.contatoTelefone) +
      campo('E-mail', f.contatoEmail) +
    '</div>' +

    '<div class="pcdoc-sec">Itens do pedido</div>' +
    '<table class="pcdoc-tab"><thead><tr>' +
      '<th style="width:17%">Código</th><th>Descrição</th>' +
      '<th class="num" style="width:15%">Quantidade</th>' +
      '<th class="num" style="width:14%">Preço unit.</th>' +
      '<th class="num" style="width:15%">Total</th>' +
    '</tr></thead><tbody>' +
      (itens.length ? itens.map(linhaItem).join('')
        : '<tr><td colspan="5" style="color:#8b93a5">Nenhum item neste pedido.</td></tr>') +
    '</tbody></table>' +
    // Totais abertos linha a linha: o fornecedor confere a soma da tabela
    // contra o subtotal, e cada acréscimo aparece nomeado. Um total fechado
    // que não bate com as linhas é a primeira coisa que ele questiona.
    '<div class="pcdoc-total"><div class="pcdoc-total-cx">' +
      linhaTotalPC('Subtotal dos itens', tot.bruto) +
      (tot.desconto > 0 ? linhaTotalPC('Desconto', -tot.desconto) : '') +
      (tot.ipi > 0 ? linhaTotalPC('IPI', tot.ipi) : '') +
      (tot.st > 0 ? linhaTotalPC('ICMS-ST', tot.st) : '') +
      (tot.iss > 0 ? linhaTotalPC('ISS', tot.iss) : '') +
      '<div class="pcdoc-total-lbl">Total do pedido</div>' +
      '<div class="pcdoc-total-val">' + fmtBRLDoc(tot.totalNota) + '</div>' +
    '</div></div>' +
    // Frete FOB fora do total, dito com todas as letras: é a Kuryos que
    // contrata e paga a transportadora, então ele não entra na nota do
    // fornecedor. Somá-lo aqui faria o pedido cobrar do fornecedor um valor
    // que ele nunca vai faturar.
    (ehFob && tot.freteFob > 0
      ? '<div class="pcdoc-nota">Frete FOB estimado de ' + fmtBRLDoc(tot.freteFob) +
        ' — contratado e pago pela Kuryos, fora deste total.</div>' : '') +
    '<div class="pcdoc-nota">Valor de referência conforme cotação. A nota fiscal prevalece.</div>' +

    '<div class="pcdoc-sec">Condições comerciais</div>' +
    '<div class="pcdoc-grid">' +
      campo('Pagamento', p.condicaoPagamento) +
      campo('Frete', frete.tipo ? (frete.tipo + (ehFob ? ' — coleta por nossa conta' : ' — entrega por conta do fornecedor')) : null) +
      campo('Prazo de entrega', p.prazoEntregaDiasUteis != null ? p.prazoEntregaDiasUteis + ' dias úteis' : null) +
      campo('Data prevista', p.dataPrevistaEntrega ? p.dataPrevistaEntrega.split('-').reverse().join('/') : null) +
      campo('Entregar em', p.localEntrega === 'GALPAO' ? 'Galpão' : p.localEntrega === 'FABRICA' ? 'Fábrica' : null) +
    '</div>' +

    // Bloco de coleta só faz sentido em FOB: é a Kuryos que vai buscar, e o
    // fornecedor precisa saber quem aparece e o que deixar pronto.
    (ehFob && p.coleta ?
      '<div class="pcdoc-sec">Coleta — por nossa conta (FOB)</div>' +
      '<div class="pcdoc-grid duas">' +
        campo('Endereço de coleta', p.coleta.endereco) +
        campo('Contato no local', p.coleta.contatoNome) +
        campo('Telefone', p.coleta.contatoTelefone) +
        campo('Peso total', p.coleta.pesoTotalKg ? fmtNum(p.coleta.pesoTotalKg) + ' kg' : null) +
      '</div>' +
      '<div class="pcdoc-aviso">A coleta é agendada pela Kuryos com transportadora própria. ' +
      'O material deve estar <b>embalado, identificado e disponível</b> na data prevista.</div>' : '') +

    '<div class="pcdoc-aviso" style="margin-top:14px">' +
      '<b>Identificação obrigatória.</b> Toda caixa ou fardo deve vir com etiqueta contendo os ' +
      PADRAO_ETIQUETA_FORNECEDOR.length + ' campos ' +
      (itens.length > 1 ? 'das páginas seguintes' : 'da página seguinte') + '. ' +
      'A conferência é feita no recebimento — caixa sem identificação completa atrasa a liberação do material.' +
    '</div>' +

    '<div class="pcdoc-assin">' +
      '<div>Responsável pela compra — Kuryos</div>' +
      '<div>Ciente — ' + escapeHtml(f.razaoSocial || p.fornecedorNome || 'Fornecedor') + '</div>' +
    '</div>' +
    rodapeDocumentoPC(p.numeroFormatado, 'Pedido de Compra') +
  '</div>';
}

// Cabeçalho comum: logotipo à esquerda, identificação do documento à direita.
// O logo é o mesmo arquivo da barra lateral (navy #0a1c69), então o papel
// sai na cor da marca sem nenhuma imagem nova.
function cabecalhoDocumentoPC(tipo, numero, data, autor) {
  return '<div class="pcdoc-cab">' +
    '<div>' +
      '<img class="pcdoc-logo" src="kuryos-logo.svg" alt="Kuryos">' +
      '<div class="pcdoc-emissor">KURYOS COSMÉTICOS</div>' +
    '</div>' +
    '<div class="pcdoc-id">' +
      '<div class="pcdoc-tipo">' + escapeHtml(tipo) + '</div>' +
      '<div class="pcdoc-num">' + escapeHtml(numero || '—') + '</div>' +
      (data ? '<div class="pcdoc-data">Emitido em ' + escapeHtml(data) +
        (autor ? ' · ' + escapeHtml(autor) : '') + '</div>' : '') +
    '</div>' +
  '</div>';
}

function rodapeDocumentoPC(numero, tipo) {
  return '<div class="pcdoc-rodape">' +
    '<span>' + escapeHtml(tipo) + ' ' + escapeHtml(numero || '') + ' · Kuryos Cosméticos</span>' +
    '<span>Documento gerado pelo sistema Kuryos PCP</span>' +
  '</div>';
}

// Página 2: o modelo de etiqueta, com o que a Kuryos já sabe preenchido e o
// resto em branco pro fornecedor completar. Uma etiqueta por item.
//
// Sai na MESMA impressão do pedido (decisão do usuário) -- mandar o pedido
// e o padrão de identificação em documentos separados é o caminho mais curto
// pra chegar material sem etiqueta.
function paginaEtiquetaFornecedor(pc, item) {
  var p = pc || {}, i = item || {};
  // O que o sistema sabe vem preenchido; o resto é do fornecedor, e fica
  // com linha em branco pra ele escrever.
  var conhecidos = {
    codigoMaterial: i.materialCodigo || '',
    descricao: i.materialNome || '',
    quantidadeUnidade: (i.qtdCotada != null ? fmtNum(i.qtdCotada) : (i.qtd != null ? fmtNum(i.qtd) : '')) +
      (i.unidadeCotada || i.unidade ? ' ' + (i.unidadeCotada || i.unidade) : ''),
    fornecedor: p.fornecedorNome || '',
    referenciaPC: p.numeroFormatado || ''
  };
  // Cartão com a cara da etiqueta real, não uma tabela de formulário: o que
  // a Kuryos já sabe vem impresso em navy; o que é do fornecedor vira uma
  // linha pontilhada, que se lê como "escreva aqui".
  var linhas = PADRAO_ETIQUETA_FORNECEDOR.map(function(campo) {
    var valor = conhecidos[campo.campo];
    return '<div class="pcdoc-etq-linha">' +
      '<div class="pcdoc-etq-c">' + escapeHtml(campo.label) + '</div>' +
      '<div class="pcdoc-etq-v">' +
        (valor ? '<b>' + escapeHtml(valor) + '</b>' : '<span class="pcdoc-etq-branco"></span>') +
      '</div>' +
    '</div>';
  }).join('');

  return '<div class="pcdoc">' +
    cabecalhoDocumentoPC('Padrão de Etiqueta', i.materialCodigo || '', null, null) +
    '<div class="pcdoc-sec">' + escapeHtml(i.materialNome || 'Material') + '</div>' +
    '<div class="pcdoc-grid duas" style="margin-bottom:10px">' +
      '<div class="pcdoc-campo"><span>Pedido de compra</span><b>' + escapeHtml(p.numeroFormatado || '—') + '</b></div>' +
      '<div class="pcdoc-campo"><span>Fornecedor</span><b>' + escapeHtml(p.fornecedorNome || '—') + '</b></div>' +
    '</div>' +
    '<div class="pcdoc-aviso" style="margin-top:0">Cole uma etiqueta com estes campos em ' +
      '<b>cada caixa ou fardo</b>. Os campos em azul já vêm do pedido; as linhas pontilhadas são preenchidas por vocês.</div>' +
    '<div class="pcdoc-etq">' + linhas + '</div>' +
    '<div class="pcdoc-nota" style="text-align:left;margin-top:8px">' +
      'A conferência desta identificação é feita no recebimento da Kuryos. ' +
      'Caixa sem etiqueta completa atrasa a liberação do material para uso.</div>' +
    rodapeDocumentoPC(p.numeroFormatado, 'Padrão de Etiqueta') +
  '</div>';
}

// Documento completo: pedido + uma página de etiqueta por item.
function montarDocumentoPedidoCompra(pc, fornecedor) {
  var itens = Object.values((pc || {}).itens || {});
  // O <style> vai JUNTO: o documento é autossuficiente e não depende de a
  // página que o imprime ter declarado o CSS certo.
  return estilosDocumentoPC() +
    paginaPedidoCompra(pc, fornecedor) +
    itens.map(function(i) { return paginaEtiquetaFornecedor(pc, i); }).join('');
}

/* ── Fichas impressas de uma OP (5 fichas, paridade com o Gerador de OPs
   Excel/VBA: OP 1, OF, Ordem de Envase, Rotulagem, Relatório de Produto
   Acabado) -- construído originalmente só em emitir_op.html (emissão
   fresca, via opJaEmitida em memória) e movido pra cá pra ops.html
   também poder reimprimir a fiche de uma OP JÁ emitida antes, usando só
   o que está gravado no próprio registro ops/{lote} (nenhum estado em
   memória necessário). Campos que só existem pra preenchimento à mão no
   chão de fábrica (horários, responsáveis, paradas, resultado de
   qualidade) ficam em branco de propósito -- o apontamento continua em
   papel até uma fase futura digitalizar isso. ── */
function fmtPct3(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function campoAssinatura(label) {
  return '<div class="print-sign"><b>' + escapeHtml(label) + ':</b><span class="print-sign-line">&nbsp;</span></div>';
}
function tabelaEmBranco(titulo, colunas, linhas) {
  var n = linhas || 4;
  var linhasHtml = '';
  for (var i = 0; i < n; i++) linhasHtml += '<tr class="print-blank-table">' + colunas.map(function() { return '<td>&nbsp;</td>'; }).join('') + '</tr>';
  return (titulo ? '<div class="print-h" style="font-size:13px;margin-top:14px">' + escapeHtml(titulo) + '</div>' : '') +
    '<table class="print-table print-blank-table"><thead><tr>' + colunas.map(function(c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '</tr></thead>' +
    '<tbody>' + linhasHtml + '</tbody></table>';
}
// Não usada por nenhuma ficha no momento (paginaOrdemEnvase/paginaRotulagem
// pararam de listar todos os insumos, a pedido do usuário -- viram só uma
// referência "Fórmula: X" agora). Mantida por poder ser útil de novo.
function tabelaMateriaisSimples(itens) {
  return '<table class="print-table"><thead><tr><th>Código</th><th>Material</th><th>Quantidade</th></tr></thead><tbody>' +
    itens.map(function(i) { return '<tr><td>' + escapeHtml(i.mpCodigo) + '</td><td>' + escapeHtml(i.mpNome) + '</td><td>' + fmtNum(i.quantidade) + ' ' + escapeHtml(i.unidade || '') + '</td></tr>'; }).join('') +
    '</tbody></table>';
}
function tabelaEspecificacoes(especs, comResultado) {
  if (!Object.keys(especs).length) return '<div class="field-hint">Nenhuma especificação de qualidade cadastrada pra esta versão da fórmula.</div>';
  return '<table class="print-table"><thead><tr><th>Ensaio</th><th>Especificação</th>' + (comResultado ? '<th>Resultado</th>' : '') + '<th>PA</th></tr></thead><tbody>' +
    Object.values(especs).map(function(e) {
      return '<tr><td>' + escapeHtml(e.ensaio) + '</td><td>' + escapeHtml(e.especificacaoTexto || '') + '</td>' + (comResultado ? '<td>&nbsp;</td>' : '') + '<td>' + escapeHtml(e.metodo || '') + '</td></tr>';
    }).join('') + '</tbody></table>';
}

// Achado real (Firebase CLI, 904 materiais): não existe campo "papel"
// dedicado no cadastro pra distinguir frasco/rótulo/tampa/válvula --
// todos ficam misturados dentro do mesmo tipo (EP mistura frasco +
// válvula + tampa; ES mistura rótulo + alguns frascos). A única forma de
// separar hoje é pelo NOME do material -- funciona bem na prática (79
// FRASCO + 14 BISNAGA + 3 POTE = 96 itens, ZERO mistura com VALVULA/
// TAMPA nos 175 materiais tipo EP reais; 222 de 222 rótulos têm "ROTULO"
// no nome), mas é heurística de texto, não uma categoria garantida -- um
// material cadastrado com nome fora do padrão usual não seria pego aqui
// (continua aparecendo normalmente na Ficha 1/Separação, só não nesta
// lista filtrada da Rotulagem).
function ehFrascoOuRotulo(mpNome) {
  return /FRASCO|BISNAGA|POTE|BILHA|R[ÓO]TULO/i.test(mpNome || '');
}

function paginaOP1(op) {
  // Pedido do usuário: "na ficha de separação, não vamos mostrar a
  // formula, apenas os itens do BOM" -- quem separa não pesa MP (isso é
  // trabalho da Ordem de Fabricação, ficha 2), só reúne embalagem.
  var itensTodos = Object.values(op.materiaisConsumo || {}).filter(function(i) { return i.origem === 'bom'; });
  return '<div class="print-page">' +
    '<div class="print-h">Ordem de Separação e Produto Acabado — OP ' + escapeHtml(op.lote) + '</div>' +
    '<div class="print-sub">Emitida em ' + new Date(op.dataEmissao).toLocaleString('pt-BR') + ' por ' + escapeHtml(op.emitidoPor) + '</div>' +
    '<div class="print-grid">' +
      '<div><b>Cliente:</b> ' + escapeHtml(op.cliente) + '</div>' +
      '<div><b>Validade:</b> ' + (op.validade ? new Date(op.validade).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }) : '—') + '</div>' +
    '</div>' +
    '<div class="print-h" style="font-size:13px;margin-top:12px">Produto</div>' +
    '<table class="print-table"><thead><tr><th>SKU</th><th>Descrição</th><th>Qtde. Teórica</th><th>Volume</th><th>Dens.</th></tr></thead><tbody>' +
    // "Volume" aqui é por UNIDADE (igual à ficha real do Excel -- ex:
    // "0,215 l" pra um produto de 200ml, já com overfill/perda contados),
    // não o volume total do batch (esse já aparece na Ordem de
    // Fabricação, ficha 2, como "Volume teórico").
    '<tr><td>' + escapeHtml(op.sku) + '</td><td>' + escapeHtml(op.produto) + '</td><td>' + fmtNum(op.qtdPlanejada) + ' Un.</td><td>' + fmtNum((op.volumeTeoricoUnMl || 0) / 1000) + ' l</td><td>' + fmtNum(op.densidadeGranelUsada) + '</td></tr>' +
    '</tbody></table>' +
    '<div class="print-h" style="font-size:13px;margin-top:14px">Material</div>' +
    '<table class="print-table"><thead><tr><th>Código</th><th>Descrição do Material</th><th>Quantidade</th><th>Qtde. Separada</th></tr></thead><tbody>' +
    itensTodos.map(function(i) { return '<tr><td>' + escapeHtml(i.mpCodigo) + '</td><td>' + escapeHtml(i.mpNome) + '</td><td>' + fmtNum(i.quantidade) + ' ' + escapeHtml(i.unidade || '') + '</td><td>&nbsp;</td></tr>'; }).join('') +
    '</tbody></table>' +
    tabelaEmBranco('Controle de Quantidade Produzida', ['Pallet', 'Qtde. (cx)', 'Qtde. (Un.)', 'Conferido estoque', 'Observações'], 3) +
    '<div class="print-sign">Entrada sistema em ___/___/___ por: <span class="print-sign-line">&nbsp;</span></div>' +
    campoAssinatura('Responsável') +
  '</div>';
}

function paginaOF(op, formulaItens, especs) {
  return '<div class="print-page">' +
    '<div class="print-h">Ordem de Fabricação — OP ' + escapeHtml(op.lote) + '</div>' +
    '<div class="print-grid">' +
      '<div><b>Produto:</b> ' + escapeHtml(op.produto) + ' (' + escapeHtml(op.sku) + ')</div>' +
      '<div><b>Cliente:</b> ' + escapeHtml(op.cliente) + '</div>' +
      '<div><b>Lote:</b> ' + escapeHtml(op.lote) + '</div>' +
      '<div><b>Qtde.:</b> ' + fmtNum(op.massaLoteKg) + ' kg</div>' +
      '<div><b>Volume teórico:</b> ' + fmtNum(op.volumeGranelL) + ' L</div>' +
      '<div><b>Batelada:</b> 1</div>' +
    '</div>' +
    campoAssinatura('Pesado por') + campoAssinatura('Peso conferido por') + campoAssinatura('Manipulado por') +
    '<div class="print-sign">Início: ___/____/___ - ___:___ &nbsp;&nbsp;&nbsp; Término: ___/____/___ - ___:___</div>' +
    '<div class="print-h" style="font-size:13px;margin-top:14px">Fórmula (pesagem)</div>' +
    '<table class="print-table"><thead><tr><th>SKU</th><th>Matéria-prima</th><th>%</th><th>QT (kg)</th><th>QT. Pesada</th><th>Lote MP</th><th>Conf.</th></tr></thead><tbody>' +
    formulaItens.map(function(i) {
      return '<tr><td>' + escapeHtml(i.mpCodigo) + '</td><td>' + escapeHtml(i.mpNome) + '</td><td>' + fmtPct3(i.percentualMM) + '</td><td>' + fmtNum(i.quantidade) + ' kg</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>';
    }).join('') +
    '<tr style="font-weight:700"><td colspan="2">TOTAL</td><td>' + fmtPct3(formulaItens.reduce(function(s, i) { return s + (i.percentualMM || 0); }, 0)) + '</td><td>' + fmtNum(op.massaLoteKg) + ' kg</td><td colspan="3"></td></tr>' +
    '</tbody></table>' +
    '<div class="field-hint" style="margin-top:8px">Instruções conforme ficha técnica -- seguir o procedimento de manipulação já cadastrado pra esta fórmula.</div>' +
    '<div class="print-sign">Ocorrência: <span class="print-sign-line" style="min-width:320px">&nbsp;</span></div>' +
    '<div class="print-h" style="font-size:13px;margin-top:14px">Especificações de Qualidade (granel)</div>' +
    tabelaEspecificacoes(especs, true) +
    campoAssinatura('Aprovado por') +
    '<div class="print-sign">Data: ___/___/___</div>' +
  '</div>';
}

function paginaOrdemEnvase(op, itensTodos, msAnvisa) {
  // Pedido do usuário: "vamos mostrar a formula (em kg e litro,
  // concluida, como se fosse um semi acabado) e o BOM, com as
  // quantidades necessarias" -- diferente da Ordem de Fabricação (ficha
  // 2, que pesa cada MP individualmente), aqui a fórmula já está pronta
  // -- o envase recebe o granel como UM insumo só (linha única, massa/
  // volume do batch inteiro), não item por item. Embalagem continua
  // detalhada (é o que o envase de fato manuseia, componente a componente).
  var itensBom = itensTodos.filter(function(i) { return i.origem === 'bom'; });
  return '<div class="print-page">' +
    '<div class="print-h">Ordem de Envase — OP ' + escapeHtml(op.lote) + '</div>' +
    '<div class="print-grid">' +
      '<div><b>Produto:</b> ' + escapeHtml(op.produto) + '</div>' +
      '<div><b>MS ANVISA:</b> ' + escapeHtml(msAnvisa || '—') + '</div>' +
      '<div><b>Validade:</b> ' + (op.validade ? new Date(op.validade).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }) : '—') + '</div>' +
    '</div>' +
    campoAssinatura('Operador') + campoAssinatura('Linha de produção') + campoAssinatura('Máquinas utilizadas') +
    '<div class="print-sign">Início de setup: ___/____/___ - ___:___ &nbsp;&nbsp; Início de envase: ___/____/___ - ___:___</div>' +
    '<div class="print-sign">Término de setup: ___/____/___ - ___:___ &nbsp;&nbsp; Término de envase: ___/____/___ - ___:___</div>' +
    '<div class="print-h" style="font-size:13px;margin-top:14px">Granel (semi-acabado)</div>' +
    '<table class="print-table"><thead><tr><th>Fórmula</th><th>Massa concluída</th><th>Volume concluído</th></tr></thead><tbody>' +
    '<tr><td>' + escapeHtml(op.produto) + (op.formulaVersao ? ' (versão ' + escapeHtml(op.formulaVersao) + ')' : '') + '</td><td>' + fmtNum(op.massaLoteKg) + ' kg</td><td>' + fmtNum(op.volumeGranelL) + ' L</td></tr>' +
    '</tbody></table>' +
    '<div class="print-h" style="font-size:13px;margin-top:14px">Embalagem</div>' +
    '<table class="print-table"><thead><tr><th>Código</th><th>Descrição do Material</th><th>Quantidade</th></tr></thead><tbody>' +
    itensBom.map(function(i) { return '<tr><td>' + escapeHtml(i.mpCodigo) + '</td><td>' + escapeHtml(i.mpNome) + '</td><td>' + fmtNum(i.quantidade) + ' ' + escapeHtml(i.unidade || '') + '</td></tr>'; }).join('') +
    '</tbody></table>' +
    tabelaEmBranco('Equipe de Trabalho', ['Operação', 'Responsável'], 5) +
    tabelaEmBranco('Paradas por Turno', ['Início', 'Final', 'Turno', 'Responsável'], 4) +
    tabelaEmBranco('Apontamentos de Perdas', ['Código', 'Descrição', 'Qtde', 'Lote'], 4) +
    tabelaEmBranco('Apontamentos da Ordem de Produção', ['Início (data e hora)', 'Término (data e hora)'], 3) +
    '<div class="print-sign">Prod. KITS: <span class="print-sign-line">&nbsp;</span> &nbsp;&nbsp; Observações: <span class="print-sign-line" style="min-width:260px">&nbsp;</span></div>' +
  '</div>';
}

function paginaRotulagem(op, itensTodos) {
  // Pedido do usuário: "na ficha de rotulagem, vamos mostrar apenas
  // frasco e rotulo, nao vamos mostrar outros itens" -- filtrado por
  // NOME (ver comentário honesto em ehFrascoOuRotulo, acima). Qualquer
  // outro item de embalagem (tampa, válvula, caixa, lacre) fica de fora
  // desta ficha de propósito -- continua aparecendo normalmente na
  // Ficha 1 (Separação) e na Ordem de Envase, só não aqui.
  var itensFrascoRotulo = itensTodos.filter(function(i) { return i.origem === 'bom' && ehFrascoOuRotulo(i.mpNome); });
  return '<div class="print-page">' +
    '<div class="print-h">Rotulagem — OP ' + escapeHtml(op.lote) + '</div>' +
    '<div class="print-grid">' +
      '<div><b>Cliente:</b> ' + escapeHtml(op.cliente) + '</div>' +
      '<div><b>SKU:</b> ' + escapeHtml(op.sku) + '</div>' +
      '<div><b>Fórmula:</b> ' + escapeHtml(op.produto) + (op.formulaVersao ? ' (versão ' + escapeHtml(op.formulaVersao) + ')' : '') + '</div>' +
    '</div>' +
    tabelaEmBranco('Apontamentos da Ordem de Produção', ['Início (data e hora)', 'Término (data e hora)'], 3) +
    tabelaEmBranco('Paradas por Turno', ['Início', 'Final', 'Turno', 'Responsável'], 4) +
    tabelaEmBranco('Apontamentos de Perdas', ['Código', 'Descrição', 'Qtde', 'Lote'], 4) +
    '<div class="print-h" style="font-size:13px;margin-top:14px">Frasco / Rótulo</div>' +
    '<table class="print-table"><thead><tr><th>Item</th><th>Unidade</th><th>Qtde</th></tr></thead><tbody>' +
    itensFrascoRotulo.map(function(i) { return '<tr><td>' + escapeHtml(i.mpNome) + '</td><td>' + escapeHtml(i.unidade || 'UN') + '</td><td>' + fmtNum(i.quantidade) + '</td></tr>'; }).join('') +
    '</tbody></table>' +
    campoAssinatura('Responsável') +
    '<div class="print-sign">Observação: <span class="print-sign-line" style="min-width:320px">&nbsp;</span></div>' +
  '</div>';
}

function paginaRelatorioPA(op, especs) {
  return '<div class="print-page">' +
    '<div class="print-h">Laboratório de Controle de Qualidade — Relatório de Produto Acabado</div>' +
    '<div class="print-grid">' +
      '<div><b>Cliente:</b> ' + escapeHtml(op.cliente) + '</div>' +
      '<div><b>Produto:</b> ' + escapeHtml(op.produto) + '</div>' +
      '<div><b>Lote:</b> ' + escapeHtml(op.lote) + '</div>' +
      '<div><b>Data de Fabricação:</b> ___/____/___</div>' +
      '<div><b>Validade:</b> ' + (op.validade ? new Date(op.validade).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }) : '—') + '</div>' +
      '<div><b>Quantidade de itens:</b> ' + fmtNum(op.qtdPlanejada) + ' un.</div>' +
    '</div>' +
    '<div class="print-h" style="font-size:13px;margin-top:14px">Análise Bulk — Semi Acabado Manipulado</div>' +
    tabelaEspecificacoes(especs, true) +
    '<div class="print-sign"><span class="print-check"></span>Aprovado &nbsp;&nbsp; <span class="print-check"></span>Reprovado &nbsp;&nbsp; Responsável: <span class="print-sign-line">&nbsp;</span></div>' +
    '<div class="print-h" style="font-size:13px;margin-top:16px">Análise Produto Envasado</div>' +
    tabelaEspecificacoes(especs, true) +
    '<div class="print-sign"><span class="print-check"></span>Aprovado &nbsp;&nbsp; <span class="print-check"></span>Reprovado &nbsp;&nbsp; Responsável: <span class="print-sign-line">&nbsp;</span></div>' +
  '</div>';
}

// Transforma formulaEscolhida.itens (fórmula cadastrada, com percentualMM)
// + op.materiaisConsumo (o que essa OP específica consumiu de fato, com
// possíveis substituições de material) numa lista pronta pra paginaOF --
// mesma transformação que emitir_op.html já fazia inline, extraída pra
// dar pra reusar na reimpressão a partir de ops.html.
function formulaItensParaFichas(op, formulaRegistro) {
  var itensTodos = Object.values(op.materiaisConsumo || {});
  var itensFormula = itensTodos.filter(function(i) { return i.origem === 'formula'; });
  return Object.values(formulaRegistro ? (formulaRegistro.itens || {}) : {}).map(function(fi, idx) {
    var consumo = itensFormula[idx];
    return { mpCodigo: (consumo && consumo.mpCodigo) || '', mpNome: (consumo && consumo.mpNome) || '', percentualMM: fi.percentualMM, quantidade: consumo && consumo.quantidade };
  });
}

// Ponto de entrada único das 5 fichas -- usado tanto por emitir_op.html
// (emissão fresca) quanto por ops.html (reimpressão de OP já emitida).
//
// fichasSelecionadas (opcional) -- pedido do usuário: "preciso poder
// selecionar quais fichas serão emitidas, temos itens que não são
// rotulados por exemplo". Objeto {op1,of,envase,rotulagem,relatorioPA} ->
// boolean; ausente (quem chama sem o 5º argumento, como ops.html na
// reimpressão) ou com uma chave ausente = inclui a ficha (`!== false`,
// nunca `=== true`) -- assim nenhum call site antigo muda de
// comportamento sem passar o parâmetro novo.
function montarFichasOP(op, formulaItens, especs, msAnvisa, fichasSelecionadas) {
  if (!op) return '';
  var sel = fichasSelecionadas || {};
  var itensTodos = Object.values(op.materiaisConsumo || {});
  var html = '';
  if (sel.op1 !== false) html += paginaOP1(op);
  if (sel.of !== false) html += paginaOF(op, formulaItens, especs);
  if (sel.envase !== false) html += paginaOrdemEnvase(op, itensTodos, msAnvisa);
  if (sel.rotulagem !== false) html += paginaRotulagem(op, itensTodos);
  if (sel.relatorioPA !== false) html += paginaRelatorioPA(op, especs);
  return html;
}

/* ── Etiqueta de caixa de embarque ──
   Pedido do usuário: "minimizaria muitos dos erros que temos hoje, de
   impressão errada de etiqueta" -- em vez de exigir que alguém digite os
   dados da caixa à mão de novo (fonte do erro), a etiqueta é gerada
   automaticamente com o que já está gravado na própria OP. */

/* Code 39 (abaixo) -- NÃO é mais usado pela etiqueta atual (virou EAN13
   do produto + QR do lote, ver bloco acima). Mantido porque pode ser
   útil de novo (é o formato mais simples de implementar corretamente do
   zero -- cada caractere tem um padrão FIXO e independente, sem
   checksum obrigatório) -- ISO/IEC 16388, suporta 0-9/A-Z/espaço/-.$/+%.
   ATENÇÃO: essa tabela foi escrita de memória, não gerada por uma lib
   testada em campo -- validar com leitor de código de barras real antes
   de confiar em produção, se voltar a ser usada. */
var CODE39_PATTERNS = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw',
  'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn',
  'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn', 'K': 'wnnnnnnww', 'L': 'nnwnnnnww',
  'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn',
  'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
  'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw',
  'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnnwn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnwnn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn' // start/stop
};
// Só o que a Kuryos realmente usa em lote/SKU (dígitos, A-Z, "/") tem
// garantia de leitura razoável -- qualquer outro caractere vira "-".
function code39Sanitizar(texto) {
  return String(texto || '').toUpperCase().split('').map(function(c) {
    return CODE39_PATTERNS[c] ? c : (c === ' ' ? ' ' : '-');
  }).join('');
}
// Gera o SVG do código de barras (largura em módulos: barra estreita = 1
// módulo, larga = 3 módulos, mesma proporção clássica do Code 39).
function code39Svg(texto, alturaMm, moduloMm) {
  alturaMm = alturaMm || 12; moduloMm = moduloMm || 0.33;
  var conteudo = '*' + code39Sanitizar(texto) + '*'; // start/stop obrigatórios
  var x = 0;
  var barras = [];
  conteudo.split('').forEach(function(ch, idx) {
    var padrao = CODE39_PATTERNS[ch] || CODE39_PATTERNS['-'];
    for (var i = 0; i < padrao.length; i++) {
      var largura = (padrao[i] === 'w' ? 3 : 1) * moduloMm;
      var ehBarra = i % 2 === 0; // Code 39 sempre começa e intercala em barra
      if (ehBarra) barras.push('<rect x="' + x.toFixed(3) + '" y="0" width="' + largura.toFixed(3) + '" height="' + alturaMm + '" fill="#000"/>');
      x += largura;
    }
    x += moduloMm; // espaço estreito fixo entre caracteres
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + x.toFixed(2) + 'mm" height="' + alturaMm + 'mm" viewBox="0 0 ' + x.toFixed(2) + ' ' + alturaMm + '">' + barras.join('') + '</svg>';
}

// ── Código de barras EAN13 (produto) ──
// Pedido do usuário: "a etiqueta tem que ser com codigo de barras do
// produto" -- substitui o Code 39 do lote (abaixo, mantido só por se
// vir a ser útil de novo). Padrão internacional (GS1/ISO 15420) -- mais
// rígido que o Code 39, mas por isso mesmo dá pra AUTOVERIFICAR de um
// jeito bem mais forte: os padrões G e R de cada dígito são DERIVADOS
// matematicamente do padrão L (G = espelhamento do complemento de bits
// de L; R = só o complemento de L) -- só a tabela L (10 entradas) e a
// tabela de paridade (qual dos 6 dígitos da esquerda usa L ou G, por
// dígito inicial) precisam ser digitadas de cabeça; o resto é
// calculado, não transcrito -- elimina uma fonte inteira de erro que o
// Code 39 não tinha como evitar. Conferido contra 2 EAN13 reais
// publicados antes de confiar (dígito verificador batendo nos dois):
// 4006381333931 e 5901234123457. AVISO HONESTO, igual o Code 39: essas
// duas tabelas continuam escritas de memória -- validar com leitor real
// antes de confiar em produção.
var EAN13_L = {
  0: '0001101', 1: '0011001', 2: '0010011', 3: '0111101', 4: '0100011',
  5: '0110001', 6: '0101111', 7: '0111011', 8: '0110111', 9: '0001011'
};
var EAN13_PARIDADE = {
  0: 'LLLLLL', 1: 'LLGLGG', 2: 'LLGGLG', 3: 'LLGGGL', 4: 'LGLLGG',
  5: 'LGGLLG', 6: 'LGGGLL', 7: 'LGLGLG', 8: 'LGLGGL', 9: 'LGGLGL'
};
function ean13InverteBit(padrao) {
  return padrao.split('').map(function(b) { return b === '1' ? '0' : '1'; }).join('');
}
function ean13R(digito) { return ean13InverteBit(EAN13_L[digito]); }
function ean13G(digito) { return ean13R(digito).split('').reverse().join(''); }
function ean13Checksum(doze) {
  var soma = 0;
  for (var i = 0; i < 12; i++) soma += parseInt(doze[i], 10) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (soma % 10)) % 10);
}
// Aceita 13 dígitos (com verificador já certo, conferido de verdade) ou
// 12 (calcula o verificador) -- qualquer outra coisa (letras, tamanho
// errado, verificador que não bate) retorna null; nunca tenta
// "consertar" nem desenha um código inválido.
function ean13Normalizar(codigo) {
  var s = String(codigo || '').replace(/\D/g, '');
  if (s.length === 12) s += ean13Checksum(s);
  if (s.length !== 13) return null;
  if (ean13Checksum(s.slice(0, 12)) !== s[12]) return null;
  return s;
}
function ean13Svg(codigo, alturaMm, moduloMm) {
  var s = ean13Normalizar(codigo);
  if (!s) return '';
  alturaMm = alturaMm || 12; moduloMm = moduloMm || 0.33;
  var paridade = EAN13_PARIDADE[parseInt(s[0], 10)];
  var bits = '101'; // guarda esquerda
  for (var i = 0; i < 6; i++) {
    var d = parseInt(s[1 + i], 10);
    bits += paridade[i] === 'L' ? EAN13_L[d] : ean13G(d);
  }
  bits += '01010'; // guarda central
  for (var i = 0; i < 6; i++) bits += ean13R(parseInt(s[7 + i], 10));
  bits += '101'; // guarda direita -- 3+42+5+42+3 = 95 módulos no total (o número clássico do EAN13)
  var x = 0, barras = [];
  for (var i = 0; i < bits.length; i++) {
    if (bits[i] === '1') barras.push('<rect x="' + x.toFixed(3) + '" y="0" width="' + moduloMm.toFixed(3) + '" height="' + alturaMm + '" fill="#000"/>');
    x += moduloMm;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + x.toFixed(2) + 'mm" height="' + alturaMm + 'mm" viewBox="0 0 ' + x.toFixed(2) + ' ' + alturaMm + '">' + barras.join('') + '</svg>';
}

// ── QR code (lote) -- biblioteca vendorizada, shared/qrcode-lib.js ──
// Pedido do usuário: "talvez dê pra alocarmos um qr code que identifique
// o lote". Diferente do EAN13/Code 39, QR usa correção de erro
// Reed-Solomon (aritmética em GF(256)) -- reimplementar isso do zero
// seria arriscado demais pra confiar sem uma referência testada de
// verdade, por isso usa a biblioteca "qrcode-generator" (MIT, Kazuhiko
// Arase) em vez de escrever na mão como o EAN13/Code 39.
function qrCodeSvg(texto, tamanhoMm) {
  tamanhoMm = tamanhoMm || 15;
  if (typeof qrcode !== 'function') return ''; // lib não carregada -- não derruba a etiqueta inteira por causa disso
  var qr = qrcode(0, 'M'); // typeNumber 0 = menor tamanho que couber; M = 15% de correção de erro
  qr.addData(String(texto || ''));
  qr.make();
  var svg = qr.createSvgTag({ scalable: true, margin: 0 });
  // A lib só sabe gerar width/height em "px" -- injeta explícito em mm
  // no <svg> raiz, mantendo o viewBox dela (em módulos) pra escalar certo.
  return svg.replace('<svg ', '<svg width="' + tamanhoMm + 'mm" height="' + tamanhoMm + 'mm" ');
}

// Quantas etiquetas gerar -- 1 por caixa de embarque, calculado a partir
// do que já está gravado na OP (peças ÷ peças-por-caixa do cadastro do
// produto, arredondado pra cima -- mesmo princípio "nunca falta caixa"
// já aplicado ao consumo de embalagem). Sem peças-por-caixa cadastrado,
// gera 1 etiqueta só (fallback honesto, não inventa uma contagem).
function totalCaixasDaOP(op) {
  var pecasPorCaixa = op.pecasPorCaixa || 0;
  if (!pecasPorCaixa || !op.qtdPlanejada) return 1;
  return Math.max(1, Math.ceil(op.qtdPlanejada / pecasPorCaixa));
}

// Pedido do usuário: "a etiqueta tem que ser com codigo de barras do
// produto" (EAN13) + "um qr code que identifique o lote". "Vamos
// colocar o codigo de barras das que possuem registro... As que não
// tiverem, deixa o espaço vazio -- fica pro comercial levantar esses
// pontos junto ao cliente" -- confirmado via Firebase CLI: hoje 28 dos
// 373 produtos têm EAN13/DUM14 cadastrado (os DOIS sempre juntos, nunca
// um sem o outro) -- só o EAN13 é usado aqui (DUM14 é outro padrão de
// código de barras, ITF-14, não implementado -- ver MELHORIAS_FUTURAS.md
// se algum dia existir produto com DUM14 mas sem EAN13).
function paginaEtiquetaCaixa(op, numeroCaixa, totalCaixas) {
  var qtdNestaCaixa = op.pecasPorCaixa
    ? (numeroCaixa < totalCaixas ? op.pecasPorCaixa : (op.qtdPlanejada - op.pecasPorCaixa * (totalCaixas - 1)))
    : op.qtdPlanejada;
  var eanSvg = ean13Svg(op.ean13 || '', 8, 0.24);
  var qrSvg = qrCodeSvg(op.lote || '', 13);
  return '<div class="etiqueta-page">' +
    '<div class="etq-header"><b>' + escapeHtml(op.cliente || '—') + '</b><span>Caixa ' + numeroCaixa + ' de ' + totalCaixas + '</span></div>' +
    '<div class="etq-produto">' + escapeHtml(op.produto || '—') + '</div>' +
    '<div class="etq-grid">' +
      '<div><span class="etq-lbl">SKU</span><span class="etq-val">' + escapeHtml(op.sku || '—') + '</span></div>' +
      '<div><span class="etq-lbl">Lote</span><span class="etq-val">' + escapeHtml(op.lote || '—') + '</span></div>' +
      '<div><span class="etq-lbl">Qtde. nesta caixa</span><span class="etq-val">' + fmtNum(qtdNestaCaixa) + ' un.</span></div>' +
      '<div><span class="etq-lbl">Validade</span><span class="etq-val">' + (op.validade ? new Date(op.validade).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' }) : '—') + '</span></div>' +
    '</div>' +
    '<div class="etq-codigos">' +
      '<div class="etq-ean">' + (eanSvg || '<div class="etq-ean-vazio">EAN não cadastrado</div>') + (eanSvg ? '<div class="etq-codigo-txt">' + escapeHtml(op.ean13) + '</div>' : '') + '</div>' +
      '<div class="etq-qr">' + qrSvg + '<div class="etq-codigo-txt">' + escapeHtml(op.lote || '') + '</div></div>' +
    '</div>' +
  '</div>';
}

// Ponto de entrada -- 1 página por caixa, cada uma com "Caixa X de Y" pra
// quem confere na expedição saber se falta alguma.
function montarEtiquetasCaixa(op) {
  if (!op) return '';
  var total = totalCaixasDaOP(op);
  var paginas = '';
  for (var i = 1; i <= total; i++) paginas += paginaEtiquetaCaixa(op, i, total);
  return paginas;
}

// ══════════════════════════════════════════════════════════════════════
// ORÇAMENTO DE COTAÇÃO — custo comparável entre fornecedores
//
// Até aqui a cotação guardava preço unitário e prazo, e a tela pintava de
// verde o MENOR PREÇO UNITÁRIO. Com IPI, ICMS-ST e frete diferentes por
// fornecedor, o menor preço unitário frequentemente NÃO é o menor custo --
// ou seja, o destaque estava apontando o fornecedor errado.
//
// Estas funções calculam o número que de fato permite comparar: o custo
// unitário final, já com imposto que soma, frete rateado e crédito
// recuperável descontado.
//
// AS REGRAS FISCAIS (decididas com o usuário):
//
//   %NF   -- percentual do valor que sai faturado em nota. Paga-se o preço
//            cheio de qualquer jeito; o que muda é quanto é documentado --
//            e imposto e crédito só existem sobre a parte faturada.
//   IPI   -- POR FORA: calculado sobre a base e SOMADO ao valor.
//   ST    -- POR FORA, como o IPI (ICMS-Substituição Tributária). Comum em
//            embalagem de cosmético e ausente da lista original.
//   ISS   -- POR FORA, mas é imposto de SERVIÇO (municipal) -- não convive
//            com ICMS na mesma linha. Ver cotacaoItemInconsistencias().
//   ICMS  -- POR DENTRO: já está embutido no preço cotado. NÃO soma.
//            Entra como CRÉDITO, reduzindo o custo real de quem o recupera.
//            Somá-lo como o IPI contaria o mesmo imposto duas vezes.
//   FRETE -- FOB: o comprador paga, então SOMA ao custo.
//            CIF: o vendedor paga, já está no preço, NÃO soma.
// ══════════════════════════════════════════════════════════════════════

var COTACAO_FRETE = { FOB: 'FOB — por nossa conta', CIF: 'CIF — por conta do fornecedor' };

// Função PURA. Rateia o frete do fornecedor entre os itens dele,
// proporcionalmente ao valor líquido de cada um.
//
// Rateio POR VALOR (e não por peso ou em partes iguais) porque é o único
// que não exige um dado que a cotação não tem -- peso quase nunca vem
// preenchido, e dividir igualmente distorce quando um item vale 10x o
// outro. `linhas` = [{ itemKey, liquido }].
function ratearFreteCotacao(linhas, valorFrete) {
  var frete = parseFloat(valorFrete) || 0;
  var out = {};
  var soma = (linhas || []).reduce(function(s, l) { return s + (parseFloat(l.liquido) || 0); }, 0);
  (linhas || []).forEach(function(l) {
    // Sem base de rateio (tudo zerado), divide igualmente em vez de somar
    // zero -- senão um frete real sumiria do custo.
    out[l.itemKey] = soma > 0
      ? frete * ((parseFloat(l.liquido) || 0) / soma)
      : (linhas.length ? frete / linhas.length : 0);
  });
  return out;
}

// Função PURA. Devolve o detalhamento de custo de UM item de UM fornecedor.
// `resp`   = { precoUnit, qtdCotada, unidadeCotada, fatorConversao,
//              pctNf, pctIpi, pctIcms, pctIcmsSt, pctIss, descontoPct }
// `freteRateado`    = parcela do frete que cabe a este item (0 se CIF)
// `unidadeCadastro` = unidade em que o material é cadastrado/consumido
//
// UNIDADE COTADA ≠ UNIDADE DO CADASTRO é o caso normal, não a exceção: o
// material pode estar cadastrado em ROLO e o fornecedor orçar em KG. Sem
// converter, "custo unitário" compara R$/kg de um com R$/rolo de outro e
// elege o fornecedor errado -- e o número parece perfeitamente plausível.
//
// `fatorConversao` = quantas unidades COTADAS cabem em 1 unidade do
// CADASTRO (ex: 25, se 1 rolo tem 25 kg). Mesma unidade nos dois lados = 1.
//
// Nunca lança: campo vazio vira 0, e o resultado diz o que faltou.
// `itemCadastro` aceita a UNIDADE como string (uso antigo) ou o item
// completo { unidade, unidadeCompra, fatorConversao } -- e nesse caso a
// unidade de compra e o fator do CADASTRO valem como padrão quando a
// resposta do fornecedor não os informa.
//
// Isso importa porque o cadastro de material JÁ TEM esses dois campos
// (ES-00319: unidade "rolo", unidadeCompra "kg", fator 11,6666667) e até
// aqui nada os lia -- a pessoa preenchia no cadastro e o orçamento ignorava.
function calcularCustoItemCotacao(resp, freteRateado, itemCadastro) {
  var r = resp || {};
  var cad = (typeof itemCadastro === 'string' || itemCadastro == null)
    ? { unidade: itemCadastro || '' } : itemCadastro;
  var unidadeCadastro = cad.unidade;
  var num = function(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var preco = num(r.precoUnit);
  var qtd = num(r.qtdCotada);

  var bruto = preco * qtd;
  var desconto = bruto * (num(r.descontoPct) / 100);
  var liquido = bruto - desconto;

  // Sem %NF informado, assume 100% faturado -- é o caso normal, e tratar
  // vazio como 0% zeraria imposto e crédito sem ninguém perceber.
  var pctNf = (r.pctNf === '' || r.pctNf == null) ? 100 : num(r.pctNf);
  var baseNf = liquido * (pctNf / 100);

  var ipi = baseNf * (num(r.pctIpi) / 100);
  var st = baseNf * (num(r.pctIcmsSt) / 100);
  var iss = baseNf * (num(r.pctIss) / 100);
  var creditoIcms = baseNf * (num(r.pctIcms) / 100);
  var frete = num(freteRateado);

  var totalNota = liquido + ipi + st + iss;
  var custoTotal = totalNota + frete - creditoIcms;

  // ── Conversão de unidade ──
  // Ordem de precedência: o que o fornecedor de fato cotou vence; sem isso,
  // a unidade de compra do cadastro; sem isso, a unidade de estoque.
  var unCad = String(unidadeCadastro || '').trim();
  var unCot = String(r.unidadeCotada || '').trim() || String(cad.unidadeCompra || '').trim() || unCad;
  var mesmaUnidade = !unCad || !unCot || unCot.toLowerCase() === unCad.toLowerCase();
  var fator = parseFloat(r.fatorConversao);
  if (mesmaUnidade) {
    // Cotado na própria unidade de estoque: a conversão é 1, SEMPRE. O
    // fator do cadastro descreve kg↔rolo; aplicá-lo aqui converteria rolo
    // em rolo e daria um custo 11,67x errado -- e o número sairia plausível.
    fator = 1;
  } else if (!(fator > 0)) {
    // Fator do cadastro como padrão, mas SÓ quando a unidade cotada é de
    // fato a unidadeCompra que ele descreve. Um fator kg/rolo não serve pra
    // converter metro nem litro.
    var unCompra = String(cad.unidadeCompra || '').trim();
    if (unCompra && unCot.toLowerCase() === unCompra.toLowerCase()) {
      fator = parseFloat(cad.fatorConversao);
    }
  }
  var fatorOk = fator > 0;
  var qtdCadastro = fatorOk && qtd > 0 ? qtd / fator : null;

  return {
    preco: preco, qtd: qtd,
    bruto: bruto, desconto: desconto, liquido: liquido,
    pctNf: pctNf, baseNf: baseNf,
    ipi: ipi, st: st, iss: iss, creditoIcms: creditoIcms, frete: frete,
    totalNota: totalNota,
    custoTotal: custoTotal,
    // Custo na unidade em que o FORNECEDOR cotou -- é o número que ele
    // reconhece, e o que vale pra conferir a proposta dele.
    // null (e não 0) quando não há quantidade: 0 ordenaria como "o mais
    // barato de todos" e venceria a cotação.
    custoUnitario: qtd > 0 ? custoTotal / qtd : null,
    unidadeCotada: unCot || null,
    unidadeCadastro: unCad || null,
    fatorConversao: fatorOk ? fator : null,
    qtdCadastro: qtdCadastro,
    // O número da COMPARAÇÃO: custo na unidade do cadastro, igual pra todos
    // os fornecedores. É por ele que se decide quem ganha.
    custoUnitarioCadastro: qtdCadastro > 0 ? custoTotal / qtdCadastro : null,
    unidadeDiferente: !mesmaUnidade,
    // Unidade diferente sem fator = comparação IMPOSSÍVEL. Marcado
    // explicitamente pra a tela poder recusar eleger um vencedor em vez de
    // eleger um errado com aparência de certo.
    conversaoPendente: !mesmaUnidade && !fatorOk,
    completo: preco > 0 && qtd > 0 && fatorOk
  };
}

// Função PURA. Avisos de preenchimento, para a tela mostrar antes de
// alguém decidir a cotação em cima de um número errado.
function cotacaoItemInconsistencias(resp, itemCadastro) {
  var r = resp || {};
  var cad = (typeof itemCadastro === 'string' || itemCadastro == null)
    ? { unidade: itemCadastro || '' } : itemCadastro;
  var num = function(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var avisos = [];
  if (!(num(r.precoUnit) > 0)) avisos.push('sem preço');
  if (!(num(r.qtdCotada) > 0)) avisos.push('sem quantidade cotada');
  // Unidade cotada diferente da do cadastro sem fator: não dá pra comparar
  // com os outros fornecedores, e é o aviso mais importante da lista --
  // sem ele o sistema elegeria um vencedor com número sem sentido.
  // O fator do CADASTRO conta como preenchido: se o material já sabe que
  // 1 rolo = 11,67 kg, não há o que perguntar.
  var unCad = String(cad.unidade || '').trim();
  var unCot = String(r.unidadeCotada || '').trim() || String(cad.unidadeCompra || '').trim();
  var temFator = num(r.fatorConversao) > 0 || num(cad.fatorConversao) > 0;
  if (unCad && unCot && unCot.toLowerCase() !== unCad.toLowerCase() && !temFator) {
    avisos.push('cotado em ' + unCot + ' mas o cadastro é em ' + unCad + ' — informe a conversão');
  }
  // ISS é imposto de serviço (municipal), ICMS é de mercadoria (estadual).
  // Os dois na mesma linha significa que alguém preencheu o formulário sem
  // saber qual se aplica -- e o custo sai inflado.
  if (num(r.pctIss) > 0 && num(r.pctIcms) > 0) avisos.push('ISS e ICMS juntos — ISS é serviço, ICMS é mercadoria');
  ['pctNf', 'pctIpi', 'pctIcms', 'pctIcmsSt', 'pctIss', 'descontoPct'].forEach(function(c) {
    var v = num(r[c]);
    if (v < 0 || v > 100) avisos.push(c.replace('pct', '%').replace('Pct', ' %') + ' fora de 0–100');
  });
  return avisos;
}

// Função PURA. Compara todos os fornecedores de um processo de cotação e
// devolve, por item, quem tem o menor CUSTO UNITÁRIO -- não o menor preço.
//
// `convidados` = fornecedoresConvidados (objeto), `itens` = itens (objeto).
function compararCotacao(itens, convidados) {
  var porFornecedor = {};
  Object.keys(convidados || {}).forEach(function(cKey) {
    var c = convidados[cKey] || {};
    if (c.status === 'DECLINOU') return;
    var freteCab = c.frete || {};
    // CIF: o fornecedor paga o frete e ele já está no preço. Somar de novo
    // seria cobrar o frete duas vezes de quem o embutiu.
    var valorFrete = freteCab.tipo === 'FOB' ? (parseFloat(freteCab.valor) || 0) : 0;
    var linhas = Object.keys(itens || {}).map(function(itemKey) {
      var resp = (c.respostaItens || {})[itemKey] || {};
      var parcial = calcularCustoItemCotacao(resp, 0, itens[itemKey]);
      return { itemKey: itemKey, liquido: parcial.liquido };
    });
    var rateio = ratearFreteCotacao(linhas, valorFrete);
    var itensCalc = {};
    Object.keys(itens || {}).forEach(function(itemKey) {
      var resp = (c.respostaItens || {})[itemKey] || {};
      itensCalc[itemKey] = calcularCustoItemCotacao(resp, rateio[itemKey] || 0, itens[itemKey]);
      itensCalc[itemKey].avisos = cotacaoItemInconsistencias(resp, itens[itemKey]);
    });
    porFornecedor[cKey] = {
      itens: itensCalc,
      freteTipo: freteCab.tipo || null,
      freteValor: parseFloat(freteCab.valor) || 0,
      custoTotal: Object.keys(itensCalc).reduce(function(s, k) { return s + itensCalc[k].custoTotal; }, 0)
    };
  });

  // Vencedor por item: menor custo NA UNIDADE DO CADASTRO. Comparar pelo
  // custo na unidade cotada elegeria o fornecedor errado sempre que dois
  // cotassem em unidades diferentes (R$/kg contra R$/rolo).
  var vencedorPorItem = {};
  Object.keys(itens || {}).forEach(function(itemKey) {
    var melhor = null, temPendente = false;
    Object.keys(porFornecedor).forEach(function(cKey) {
      var calc = porFornecedor[cKey].itens[itemKey];
      if (!calc) return;
      if (calc.conversaoPendente) { temPendente = true; return; }
      if (!calc.completo || calc.custoUnitarioCadastro == null) return;
      if (!melhor || calc.custoUnitarioCadastro < melhor.custoUnitario) {
        melhor = { cKey: cKey, custoUnitario: calc.custoUnitarioCadastro };
      }
    });
    // Com alguém sem conversão definida, NÃO elege vencedor: um "melhor"
    // calculado ignorando quem não pôde ser convertido é pior que nenhum,
    // porque parece uma decisão tomada.
    if (melhor && !temPendente) vencedorPorItem[itemKey] = melhor;
    else if (temPendente) vencedorPorItem[itemKey] = null;
  });

  // Vencedor geral: menor custo total somando só quem respondeu TODOS os
  // itens. Um fornecedor que cotou 1 de 5 itens teria o "menor total" sem
  // ser comparável -- e é o erro clássico deste tipo de tela.
  var totalItens = Object.keys(itens || {}).length;
  var vencedorGeral = null;
  Object.keys(porFornecedor).forEach(function(cKey) {
    var f = porFornecedor[cKey];
    var completos = Object.keys(f.itens).filter(function(k) { return f.itens[k].completo; }).length;
    if (completos !== totalItens || !totalItens) return;
    if (!vencedorGeral || f.custoTotal < vencedorGeral.custoTotal) {
      vencedorGeral = { cKey: cKey, custoTotal: f.custoTotal };
    }
  });

  return { porFornecedor: porFornecedor, vencedorPorItem: vencedorPorItem, vencedorGeral: vencedorGeral };
}

// ══════════════════════════════════════════════════════════════════════
// PRAZO DE ENTREGA EM DIAS ÚTEIS → data de coleta/entrega
//
// O prazo que o fornecedor dá é em DIAS ÚTEIS ("entrega em 15 dias"), não
// em dias corridos. Contar corrido erra em ~2 dias por semana de prazo, e é
// justamente essa data que a Logística usa pra agendar a coleta.
//
// Usa o MESMO calendário do PCP (`config/planejamento`: diasSemana +
// feriados). Não é reaproveitamento por preguiça: entrega num dia em que a
// fábrica está fechada não serve pra nada, então o calendário útil da
// compra é o mesmo calendário útil da operação.
// ══════════════════════════════════════════════════════════════════════

// Função PURA. `diasSemana` = [1..7] com 1=segunda e 7=domingo (mesma
// convenção de config/planejamento). `feriados` = { 'YYYY-MM-DD': ... }.
function ehDiaUtil(dataISO, feriados, diasSemana) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataISO || ''));
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  var dw = d.getUTCDay();            // 0=domingo
  var dwConfig = dw === 0 ? 7 : dw;  // 7=domingo, como no config
  var ativos = (diasSemana && diasSemana.length) ? diasSemana : [1, 2, 3, 4, 5];
  if (ativos.indexOf(dwConfig) === -1) return false;
  return !(feriados || {})[dataISO.slice(0, 10)];
}

// Função PURA. Sempre em UTC, pelo mesmo motivo de
// calcularParcelasPagamento: misturar data local com toISOString() erra um
// dia em fusos positivos.
// `dias = 0` devolve o PRÓXIMO dia útil (ou o próprio, se já for útil) --
// "entrega hoje" num domingo não é hoje.
function somarDiasUteis(dataBase, dias, feriados, diasSemana) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataBase || ''));
  var base;
  if (m) base = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  else {
    var hoje = new Date();
    base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  }
  var n = parseInt(dias, 10);
  if (isNaN(n) || n < 0) return null;
  var cursor = base;
  var iso = function(ms) { return new Date(ms).toISOString().slice(0, 10); };
  var restantes = n;
  var guarda = 0;
  // Teto de segurança: um calendário mal configurado (diasSemana vazio, ou
  // feriado em todo dia útil) faria isto rodar pra sempre.
  while (guarda++ < 3000) {
    if (restantes === 0 && ehDiaUtil(iso(cursor), feriados, diasSemana)) return iso(cursor);
    cursor += 86400000;
    if (restantes > 0 && ehDiaUtil(iso(cursor), feriados, diasSemana)) restantes--;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// ENDEREÇO POR CEP
//
// Padrão de e-commerce: digita o CEP, o resto vem preenchido e a pessoa só
// completa número e complemento. Fonte: ViaCEP (pública, sem chave, sem
// cadastro) -- só o CEP sai daqui, nenhum dado nosso.
//
// A busca NUNCA é obrigatória: se a API estiver fora, os campos continuam
// editáveis à mão. Endereço de fornecedor não pode depender da
// disponibilidade de um serviço de terceiro.
// ══════════════════════════════════════════════════════════════════════

// Função PURA. Devolve só os 8 dígitos, ou '' se não for um CEP.
function normalizarCep(cep) {
  var d = String(cep == null ? '' : cep).replace(/\D/g, '');
  return d.length === 8 ? d : '';
}
// Função PURA. 01310100 -> "01310-100"
function formatarCep(cep) {
  var d = normalizarCep(cep);
  return d ? d.slice(0, 5) + '-' + d.slice(5) : String(cep == null ? '' : cep);
}

// Busca o endereço. `fetchFn` é injetável só pra o teste não sair na rede.
// Resolve SEMPRE (nunca rejeita): { ok, erro, endereco }. Quem chama trata
// a falha mostrando um aviso, não travando o formulário.
function buscarEnderecoPorCep(cep, fetchFn) {
  var limpo = normalizarCep(cep);
  if (!limpo) return Promise.resolve({ ok: false, erro: 'CEP precisa ter 8 dígitos.' });
  var f = fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!f) return Promise.resolve({ ok: false, erro: 'Busca de CEP indisponível neste navegador.' });
  return f('https://viacep.com.br/ws/' + limpo + '/json/')
    .then(function(resp) {
      if (!resp || !resp.ok) throw new Error('HTTP ' + ((resp && resp.status) || '?'));
      return resp.json();
    })
    .then(function(d) {
      // ViaCEP responde 200 com { erro: true } pra CEP inexistente -- não é
      // erro de rede, então precisa ser tratado aqui.
      if (!d || d.erro) return { ok: false, erro: 'CEP não encontrado.' };
      return { ok: true, endereco: {
        cep: limpo,
        logradouro: d.logradouro || '',
        bairro: d.bairro || '',
        cidade: d.localidade || '',
        uf: (d.uf || '').toUpperCase()
      } };
    })
    .catch(function(e) {
      return { ok: false, erro: 'Não foi possível consultar o CEP agora (' + e.message + '). Preencha à mão.' };
    });
}

// Função PURA: monta o endereço numa linha, a partir dos campos separados.
// Usada pela Logística no pedido de coleta. Sem logradouro devolve '' --
// cidade/UF sozinhos não fecham uma coleta, e oferecê-los como se fossem o
// endereço faria alguém agendar com dado incompleto.
function montarEnderecoCompleto(f) {
  var o = f || {};
  var rua = String(o.logradouro || '').trim();
  if (!rua) return '';
  var linha = rua;
  if (String(o.numero || '').trim()) linha += ', ' + String(o.numero).trim();
  if (String(o.complemento || '').trim()) linha += ' — ' + String(o.complemento).trim();
  if (String(o.bairro || '').trim()) linha += ', ' + String(o.bairro).trim();
  var cidadeUf = [String(o.cidade || '').trim(), String(o.uf || '').trim()].filter(Boolean).join('/');
  if (cidadeUf) linha += ', ' + cidadeUf;
  if (normalizarCep(o.cep)) linha += ' — CEP ' + formatarCep(o.cep);
  return linha;
}

// Função PURA: o que a Logística precisa ter em mãos pra fechar a coleta.
// Só se aplica a FOB -- em CIF quem coordena é o fornecedor.
// Devolve { aplica, pronto, faltando: [...] } pra a tela poder cobrar o
// preenchimento ANTES de o pedido virar responsabilidade nossa.
function coletaFobPendencias(convidado, fornecedor) {
  var c = convidado || {};
  if (!c.frete || c.frete.tipo !== 'FOB') return { aplica: false, pronto: true, faltando: [] };
  var col = c.coleta || {};
  var f = fornecedor || {};
  var faltando = [];
  // Os três primeiros herdam do cadastro do fornecedor: o que já está
  // cadastrado NÃO é pendência. `endereco` (logradouro) é campo de
  // Cadastros › Fornecedores; enquanto estiver vazio lá, a pessoa digita na
  // cotação, e assim que for preenchido passa a vir sozinho.
  // Cidade/UF de propósito NÃO contam como endereço: sozinhos não fecham
  // uma coleta, e aceitá-los deixaria alguém agendar com dado incompleto.
  if (!String(col.endereco || montarEnderecoCompleto(f) || '').trim()) faltando.push('endereço de coleta');
  if (!String(col.contatoNome || f.contatoNome || '').trim()) faltando.push('contato no local');
  if (!String(col.contatoTelefone || f.contatoTelefone || '').trim()) faltando.push('telefone do contato');
  if (!(parseFloat(col.pesoTotalKg) > 0)) faltando.push('peso total');
  return { aplica: true, pronto: faltando.length === 0, faltando: faltando };
}

// ══════════════════════════════════════════════════════════════════════
// PRAZO DE PAGAMENTO — "14/21/28 DDL" vira parcelas com data
//
// O texto livre que a Kuryos já usa ("14/21/28 DDL", "30/60/90") é a forma
// natural de escrever, então o campo continua sendo texto -- o sistema é
// que aprende a lê-lo, em vez de obrigar a pessoa a preencher três campos.
//
// Escopo desta fase (decisão do usuário): estruturar o prazo e calcular os
// vencimentos. O módulo financeiro (título, baixa, status) vem depois e lê
// isto pronto.
// ══════════════════════════════════════════════════════════════════════

// Função PURA. "14/21/28 DDL" -> { parcelas: [14,21,28], aVista: false }
function parsePrazoPagamento(texto) {
  var t = String(texto == null ? '' : texto).trim();
  if (!t) return { parcelas: [], aVista: false, texto: '', valido: false };
  if (/^\s*(a\s*vista|à\s*vista|avista)\s*$/i.test(t)) {
    return { parcelas: [0], aVista: true, texto: t, valido: true };
  }
  // Pega só os números; "DDL", "dias", "/" e espaços são ruído.
  var nums = (t.match(/\d+/g) || []).map(function(n) { return parseInt(n, 10); })
    .filter(function(n) { return !isNaN(n) && n >= 0 && n <= 720; });
  if (!nums.length) return { parcelas: [], aVista: false, texto: t, valido: false };
  // Ordena e remove repetidos: "30/30/60" é erro de digitação mais provável
  // que duas parcelas no mesmo dia.
  var unicos = [];
  nums.sort(function(a, b) { return a - b; }).forEach(function(n) {
    if (unicos.indexOf(n) === -1) unicos.push(n);
  });
  return { parcelas: unicos, aVista: unicos.length === 1 && unicos[0] === 0, texto: t, valido: true };
}

// Função PURA. Divide o valor entre as parcelas e calcula os vencimentos.
// `dataBase` é a data de contagem do DDL (ISO). A sobra de centavos vai
// pra ÚLTIMA parcela, senão a soma das parcelas não fecha com o total.
function calcularParcelasPagamento(valorTotal, parcelas, dataBase) {
  var total = parseFloat(valorTotal) || 0;
  var dias = (parcelas || []).slice();
  if (!dias.length) return [];
  // Data-only em UTC, de propósito. `new Date('2026-09-08')` é meia-noite
  // UTC; somar dias com getDate()/setDate() (que são LOCAIS) e depois
  // formatar com toISOString() (que é UTC) só dá certo por acaso em fuso
  // negativo -- em UTC+X o vencimento sai um dia adiantado. Trabalhando
  // 100% em UTC o resultado é o mesmo em qualquer máquina.
  var base;
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataBase || ''));
  if (m) base = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  else {
    var hoje = dataBase ? new Date(dataBase) : new Date();
    if (isNaN(hoje)) hoje = new Date();
    base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  }
  var porParcela = Math.round((total / dias.length) * 100) / 100;
  var out = dias.map(function(d, i) {
    var venc = new Date(base + d * 86400000);
    return { parcela: i + 1, dias: d, vencimento: venc.toISOString().slice(0, 10), valor: porParcela };
  });
  var somado = Math.round(porParcela * dias.length * 100) / 100;
  var sobra = Math.round((total - somado) * 100) / 100;
  if (sobra !== 0) out[out.length - 1].valor = Math.round((out[out.length - 1].valor + sobra) * 100) / 100;
  return out;
}
