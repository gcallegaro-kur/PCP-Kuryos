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
function gerarUpdatesPosicoesRua(codigoRua, area, niveis, predios, enderecosExistentes, ocupantesPorEndereco, autor) {
  var updates = {};
  var agora = new Date().toISOString();
  for (var nivel = 1; nivel <= niveis; nivel++) {
    for (var predio = 1; predio <= predios; predio++) {
      var codigo = codigoRua + '.' + nivel + '.' + predio;
      var key = sanitizeKey(codigo);
      var existente = enderecosExistentes[key];
      var ocupada = (ocupantesPorEndereco[key] || 0) > 0;
      if (!existente) {
        updates['enderecos_estoque/' + key] = {
          codigo: codigo, rua: codigoRua, nivel: nivel, predio: predio, area: area,
          ativo: true, geradoDe: codigoRua, criadoEm: agora, criadoPor: autor
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
        var codigo = r.codigoRua + '.' + nivel + '.' + predio;
        var key = sanitizeKey(codigo);
        var end = enderecosEstoque[key];
        var ocupantes = ocupantesPorEndereco[key] || 0;
        var classe = !end ? 'mapa-cell-naogerada' : (ocupantes > 0 ? 'mapa-cell-ocupada' : 'mapa-cell-livre');
        var tituloAttr = !end ? (codigo + ' -- não gerada ainda') : (codigo + (ocupantes > 0 ? (' -- ' + ocupantes + ' item' + (ocupantes > 1 ? 's' : '')) : ' -- livre'));
        celulas += '<div class="mapa-cell ' + classe + '" data-endereco-key="' + escapeAttr(key) + '" data-codigo="' + escapeAttr(codigo) + '" title="' + escapeAttr(tituloAttr) + '">' + predio + '</div>';
      }
      linhasHtml += '<div class="mapa-nivel-row"><div class="mapa-nivel-label">N' + nivel + '</div>' + celulas + '</div>';
    }
    return '<div class="mapa-rua" id="mapa-rua-' + escapeAttr(String(r.codigoRua)) + '"><div class="mapa-rua-titulo">Rua ' + escapeHtml(String(r.codigoRua)) + ' — ' + escapeHtml(r.area || '') + '</div><div class="mapa-grid-scroll"><div class="mapa-grid-rows">' + linhasHtml + '</div></div></div>';
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
    var idAttr = 'planta-rua-' + escapeAttr(String(r.codigoRua));
    var ruaAttr = escapeAttr(String(r.codigoRua));

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
        var codigoPos = r.codigoRua + '.' + nivelFoco + '.' + p;
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
        var key = sanitizeKey(r.codigoRua + '.' + nivel + '.' + predio);
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

// Função PURA (sem dbRef, sem I/O) -- o "cérebro" da separação guiada, só
// sugere DE ONDE tirar (FEFO -- mais próximo de vencer sai primeiro,
// pedido explícito do usuário: "importante a visão de FIFO, ou até melhor
// seria a visão de mais perto de vencer"). NUNCA sugere destino -- isso é
// sempre escolha manual de quem confirma a separação ("não deixaria
// automático, gostaria de ir sempre direcionando, conferindo"). Testável
// isolada, sem mock de Firebase. `lotesDoItem` = Object.values já
// carregado client-side (mesmo padrão de ocupantesPorEndereco). Nunca
// lança erro -- `faltante > 0` é um resultado válido, não uma falha.
function sugerirAlocacaoFefo(itemCodigo, qtdNecessaria, lotesDoItem) {
  var candidatos = Object.entries(lotesDoItem || {})
    .filter(function(entry) {
      var lote = entry[1];
      return lote && lote.itemCodigo === itemCodigo && lote.status === 'LIBERADO' && (lote.saldoLote || 0) > 0;
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
