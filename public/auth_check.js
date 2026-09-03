// --- Preferência manual de tema (claro/escuro/automático) ---
// Aplicado já no topo do script, antes de qualquer outra coisa, pra não
// piscar o tema errado (o CSS já está linkado no <head> antes deste script).
(function() {
  try {
    var saved = localStorage.getItem('kuryos-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {}
})();

function kuryosThemeState() {
  var saved = null;
  try { saved = localStorage.getItem('kuryos-theme'); } catch (e) {}
  return (saved === 'light' || saved === 'dark') ? saved : 'auto';
}

function kuryosThemeIcon(state) {
  return state === 'light' ? '☀️' : state === 'dark' ? '🌙' : '🌓';
}

function kuryosThemeLabel(state) {
  if (state === 'light') return 'Tema: Claro — clique para Escuro';
  if (state === 'dark') return 'Tema: Escuro — clique para Automático (segue o sistema)';
  return 'Tema: Automático (segue o sistema) — clique para Claro';
}

window.cycleKuryosTheme = function() {
  var state = kuryosThemeState();
  var next = state === 'auto' ? 'light' : (state === 'light' ? 'dark' : 'auto');
  try {
    if (next === 'auto') localStorage.removeItem('kuryos-theme');
    else localStorage.setItem('kuryos-theme', next);
  } catch (e) {}
  if (next === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  var btn = document.getElementById('kt-theme-toggle');
  if (btn) {
    btn.textContent = kuryosThemeIcon(next);
    btn.title = kuryosThemeLabel(next);
  }
};

// --- Perfis de Acesso Permitidos por Página ---
// 'pcp' (novo, pedido do usuário): vê tudo do PCP -- mesmo acesso de
// página que 'admin' sempre teve nas páginas de produção/planejamento/
// cadastros/compras/logística -- só NÃO entra em nenhuma página de RH.
// 'admin' virou o papel "vê literalmente tudo, sem exceção" -- ganhou
// acesso às páginas de RH também (ver grupo rh_* abaixo), que antes eram
// só de 'rh'/'gestor'.
// Regra permanente (pedido do usuário): onde quer que 'production' apareça
// abaixo, 'pcp' entra junto -- PCP precisa sempre ter acesso a tudo que é
// "produção", nunca menos que o operador de chão de fábrica. As regras de
// escrita em database.rules.json já seguem esse mesmo padrão em todo lugar;
// aqui só faltava form.html (Apontamento/Registro de Produção).
const pageAccessRules = {
  'form.html': ['production', 'admin', 'rotulagem', 'pcp'],
  'planejamento.html': ['production', 'admin', 'pcp'],
  'horizonte.html': ['production', 'admin', 'pcp'],
  'dashboard.html': ['production', 'admin', 'pcp'],
  'dashboard_analise.html': ['production', 'admin', 'pcp'],
  'ops.html': ['production', 'admin', 'pcp'],
  'historico.html': ['production', 'admin', 'pcp'],
  'pedidos.html': ['admin', 'pcp'],
  'produtos.html': ['admin', 'pcp'],
  'insumos.html': ['admin', 'pcp'],
  'usuarios.html': ['admin', 'pcp'],
  'admin.html': ['admin', 'pcp'],
  'clientes.html': ['admin', 'pcp'],
  'materiais.html': ['admin', 'pcp'],
  'formulas.html': ['admin', 'pcp'],
  'cadastros.html': ['admin', 'pcp'],
  'emitir_op.html': ['admin', 'pcp'],
  'compras.html': ['admin', 'pcp'],
  'logistica.html': ['admin', 'pcp'],
  'estoque.html': ['admin', 'pcp'],
  'separacao_materiais.html': ['admin', 'pcp'],
  // Módulo de RH -- login completamente separado do PCP pra 'rh'/'gestor'
  // (decisão do usuário: sem múltiplos papéis por pessoa). 'admin' entra
  // aqui também (pedido do usuário: ADM vê tudo, sem exceção) -- 'pcp'
  // deliberadamente NÃO entra em nenhuma linha abaixo.
  'rh_cadastros.html': ['rh', 'gestor', 'admin'],
  'rh_avaliacao.html': ['rh', 'gestor', 'admin'],
  'rh_ferias.html': ['rh', 'gestor', 'admin'],
  'rh_dashboard.html': ['rh', 'admin']
};

// Extrai o nome da página atual
function getActivePageName() {
  const path = window.location.pathname;
  return path.substring(path.lastIndexOf('/') + 1) || 'index.html';
}

window.currentUser = null;

(function() {
  // Garante que shared/theme.css (tokens de cor/tipografia da linguagem Apple,
  // aprovada 2026-07-19) esteja carregado antes da sidebar usar as variáveis.
  if (!document.querySelector('link[href="shared/theme.css"]')) {
    var themeLink = document.createElement('link');
    themeLink.rel = 'stylesheet';
    themeLink.href = 'shared/theme.css';
    document.head.appendChild(themeLink);
  }

  // Estilos da sidebar de navegação (ver dashboard.html para o resto dos tokens).
  // O recuo de layout (padding-left:232px) NÃO fica aqui — mora em
  // shared/theme.css na classe estática ".has-sidebar" do <body>, presente
  // desde o primeiro paint de cada página. Isso evita o "pulo" de conteúdo
  // que acontecia quando o recuo só era aplicado depois que a sidebar era
  // inserida via JS (auth + leitura de perfil no Firebase, ambos assíncronos).
  const css = `
    .kt-sidebar {
      position: fixed; left: 0; top: 0; height: 100vh; width: 232px;
      padding: 22px 14px; box-sizing: border-box;
      background: var(--sidebar-bg, rgba(255,255,255,.85));
      backdrop-filter: blur(22px) saturate(1.4);
      -webkit-backdrop-filter: blur(22px) saturate(1.4);
      border-right: 1px solid var(--line, #d2d2d7);
      display: flex; flex-direction: column; gap: 22px;
      font-family: var(--font-ui, -apple-system, "Segoe UI", sans-serif);
      z-index: 9999;
      color: var(--ink, #1d1d1f);
      transition: transform .25s ease;
      /* A lista de páginas cresceu (Compras, Logística, Materiais,
         Fórmulas/BOM, Clientes...) e passou a ultrapassar 100vh em telas
         normais -- sem overflow, os itens de baixo (Ajuste de Metas,
         Usuários, o próprio rodapé com o usuário logado) ficavam
         visualmente cortados E inacessíveis, sem nenhuma forma de rolar até
         eles. overflow-y:auto deixa só a sidebar rolar, sem mexer no resto
         da página; overflow-x:hidden evita barra horizontal por causa do
         padding lateral. */
      overflow-y: auto; overflow-x: hidden;
    }
    .kt-sidebar::-webkit-scrollbar { width: 6px; }
    .kt-sidebar::-webkit-scrollbar-thumb { background: var(--line, #d2d2d7); border-radius: 3px; }
    .kt-hamburger, .kt-backdrop { display: none; }
    /* Tablet e celular: sidebar vira gaveta que desliza por cima do conteúdo,
       aberta por um botão hamburger fixo — sem isso a navegação simplesmente
       sumia abaixo de 980px, sem nenhuma forma alternativa de trocar de tela. */
    @media (max-width: 980px) {
      .kt-sidebar { transform: translateX(-100%); box-shadow: 0 0 0 transparent; }
      .kt-sidebar.open { transform: translateX(0); box-shadow: 8px 0 32px rgba(0,0,0,.18); }
      .kt-hamburger {
        display: flex; align-items: center; justify-content: center;
        position: fixed; top: 14px; left: 14px; z-index: 10001;
        width: 40px; height: 40px; border-radius: 12px; border: none; cursor: pointer;
        background: var(--sidebar-bg, rgba(255,255,255,.85));
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        box-shadow: var(--shadow, 0 1px 2px rgba(0,0,0,.08));
        color: var(--ink, #1d1d1f);
      }
      .kt-hamburger svg { width: 20px; height: 20px; }
      .kt-backdrop {
        display: block; position: fixed; inset: 0; z-index: 9998;
        background: rgba(0,0,0,.35); opacity: 0; pointer-events: none;
        transition: opacity .2s ease;
      }
      .kt-backdrop.open { opacity: 1; pointer-events: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .kt-sidebar { transition: none; } }
    .kt-brand { display: flex; align-items: center; gap: 10px; padding: 4px 6px 10px; cursor: pointer; }
    .kt-brand-logo { height: 26px; width: auto; display: block; }
    /* A logo é navy sólido (não tem variante clara) — no modo escuro ela some
       contra o fundo escuro da sidebar, então inverte pra branco só ali. */
    @media (prefers-color-scheme: dark) {
      :root:where(:not([data-theme="light"])) .kt-brand-logo { filter: brightness(0) invert(1); }
    }
    :root[data-theme="dark"] .kt-brand-logo { filter: brightness(0) invert(1); }
    .kt-nav-group { display: flex; flex-direction: column; gap: 2px; }
    .kt-nav-cap { font-size: 11px; font-weight: 600; color: var(--ink-mute, #86868b); text-transform: uppercase; letter-spacing: .06em; padding: 6px 12px 4px; }
    .kt-nav-link { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 9px; color: var(--ink-soft, #6e6e73); font-size: 13.5px; font-weight: 500; cursor: pointer; text-decoration: none; }
    .kt-nav-link svg { width: 18px; height: 18px; flex: none; }
    .kt-nav-link.active { background: var(--accent, #2456d6); color: #fff; font-weight: 600; }
    .kt-nav-link:not(.active):hover { background: color-mix(in srgb, var(--ink, #1d1d1f) 6%, transparent); }
    .kt-sidebar-foot { margin-top: auto; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--line, #d2d2d7); }
    .kt-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--s2, #c9910a); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; flex: none; }
    .kt-sidebar-foot .who { flex: 1; min-width: 0; }
    .kt-sidebar-foot .name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kt-sidebar-foot .role { font-size: 11px; color: var(--ink-mute, #86868b); }
    .kt-sidebar-foot button { background: none; border: none; color: var(--ink-mute, #86868b); cursor: pointer; font-size: 16px; line-height: 1; padding: 4px; }
    .nav-links { display: none !important; }
  `;
  const styleEl = document.createElement('style');
  styleEl.innerHTML = css;
  document.head.appendChild(styleEl);

  // ── Watchdog de carregamento ─────────────────────────────────────
  // Nenhum passo da cadeia de autenticação abaixo (onAuthStateChanged,
  // leitura de usuarios/{uid}) tinha timeout ou tratamento de erro -- se a
  // conexão engasgasse (wifi instável, VPN, aba que "dormiu"), a leitura do
  // perfil simplesmente nunca retornava, renderUnifiedNavbar() nunca era
  // chamada, e a página ficava parada pra sempre sem barra lateral e sem
  // nenhum aviso (relatado como "às vezes não carrega"). Este watchdog é a
  // rede de segurança: se nada resolver em 12s, mostra uma tela de erro com
  // botão de tentar de novo, em vez de travar silenciosamente.
  let authWatchdogTimer = null;
  let authWatchdogResolved = false;
  function startAuthWatchdog() {
    authWatchdogTimer = setTimeout(() => {
      if (!authWatchdogResolved) showAuthLoadError('O sistema está demorando pra carregar. Verifique sua conexão com a internet.');
    }, 12000);
  }
  function clearAuthWatchdog() {
    authWatchdogResolved = true;
    if (authWatchdogTimer) { clearTimeout(authWatchdogTimer); authWatchdogTimer = null; }
  }
  function showAuthLoadError(msg) {
    authWatchdogResolved = true;
    if (authWatchdogTimer) { clearTimeout(authWatchdogTimer); authWatchdogTimer = null; }
    if (document.getElementById('kt-auth-error-overlay')) return; // já mostrando
    const overlay = document.createElement('div');
    overlay.id = 'kt-auth-error-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg,#f5f5f7);display:flex;align-items:center;justify-content:center;padding:24px;font-family:var(--font-ui,-apple-system,"Segoe UI",sans-serif)';
    overlay.innerHTML =
      '<div style="max-width:380px;text-align:center;background:var(--panel,#fff);border-radius:16px;padding:32px 28px;box-shadow:0 12px 28px -14px rgba(0,0,0,.25)">' +
        '<div style="font-size:34px;margin-bottom:10px">⚠️</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--ink,#1d1d1f);margin-bottom:8px">Não foi possível carregar</div>' +
        '<div style="font-size:13.5px;color:var(--ink-soft,#6e6e73);margin-bottom:20px;line-height:1.5">' + msg + '</div>' +
        '<button id="kt-auth-retry-btn" style="background:var(--accent,#2456d6);color:#fff;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer">🔄 Tentar novamente</button>' +
      '</div>';
    document.body.appendChild(overlay);
    document.getElementById('kt-auth-retry-btn').addEventListener('click', () => window.location.reload());
  }

  // Inicializa a verificação de autenticação
  document.addEventListener('DOMContentLoaded', () => {
    startAuthWatchdog();

    if (typeof firebase === 'undefined') {
      console.error('Firebase compat library não carregada. Certifique-se de importar o Firebase antes do auth_check.js.');
      showAuthLoadError('Não foi possível carregar as bibliotecas do sistema. Tente novamente.');
      return;
    }

    firebase.auth().onAuthStateChanged(user => {
      const activePage = getActivePageName();

      if (!user) {
        // Redireciona para o login caso não esteja logado
        clearAuthWatchdog();
        if (activePage !== 'login.html') {
          window.location.href = 'login.html';
        }
      } else {
        const db = firebase.database();
        readUsuarioProfileWithRetry(db, user.uid, snapshot => {
          const profile = snapshot.val();

          if (!profile || profile.role === 'pending') {
            // Sem perfil ou pendente de aprovação
            clearAuthWatchdog();
            if (activePage !== 'login.html') {
              window.location.href = 'login.html?status=pending';
            } else {
              const pendingMsg = document.getElementById('pending-message');
              if (pendingMsg) pendingMsg.style.display = 'block';
            }
          } else {
            const role = profile.role || 'pending';
            window.currentUser = {
              uid: user.uid,
              nome: profile.nome || user.displayName || user.email.split('@')[0],
              email: user.email,
              role: role
            };

            // Validação de acessos da página
            const allowedRoles = pageAccessRules[activePage];
            if (allowedRoles && !allowedRoles.includes(role)) {
              clearAuthWatchdog();
              const deniedRoleLabel = role === 'admin' ? 'Administrador'
                : role === 'pcp' ? 'PCP'
                : role === 'rh' ? 'RH Central'
                : role === 'gestor' ? 'Gestor de Linha'
                : role === 'rotulagem' ? 'Rotulagem' : 'Produção';
              alert('Acesso Negado: Seu perfil (' + deniedRoleLabel + ') não tem permissão para acessar esta página.');
              // Cada "família" de papel tem sua própria home -- mandar um
              // papel de RH pra dashboard.html (que ele também não acessa)
              // só trocaria um Acesso Negado por outro, em loop.
              if (role === 'rh') {
                window.location.href = 'rh_dashboard.html';
              } else if (role === 'gestor') {
                window.location.href = 'rh_avaliacao.html';
              } else if (role === 'production' || role === 'rotulagem') {
                window.location.href = 'form.html';
              } else {
                window.location.href = 'dashboard.html';
              }
            } else {
              // Constrói e injeta o menu superior unificado
              renderUnifiedNavbar(window.currentUser);
              clearAuthWatchdog();

              if (role === 'admin' && typeof window.syncAllActiveOpsStatus === 'function') {
                window.syncAllActiveOpsStatus();
              }

              // Adapta o planejamento para visualização somente leitura para o perfil de produção
              if (activePage === 'planejamento.html' && role === 'production') {
                makePlanningReadOnly();
              }
            }
          }
        });
      }
    });
  });
})();

// Lê usuarios/{uid} com retentativa silenciosa em caso de erro. Este é um
// app multi-página sem SPA -- toda navegação recarrega a página do zero, o
// que recria a conexão websocket do Realtime Database do zero também
// (diferente do estado de autenticação, que fica em cache local). Nos
// primeiros instantes após onAuthStateChanged dar o usuário como logado, o
// token de auth às vezes ainda não terminou de propagar pra essa conexão
// nova, e uma leitura que dispara nesse instante recebe permission_denied
// mesmo com o login válido -- um erro transitório, não uma falha real de
// permissão. Sem retentativa, isso aparecia como "Erro ao carregar seu
// perfil" a cada navegação em que essa corrida acontecesse. Tenta de novo
// silenciosamente antes de admitir derrota e mostrar a tela de erro.
function readUsuarioProfileWithRetry(db, uid, onSuccess, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 2;
  db.ref('usuarios/' + uid).once('value', snapshot => {
    // Bug real encontrado testando a Fase 0 no emulador local (achado
    // independente do problema de databaseURL já corrigido): o retry aqui
    // só cobria o callback de ERRO do once() -- uma leitura que teve SUCESSO
    // mas voltou null (a corrida entre a conexão de long-polling do RTDB
    // ainda terminando de sincronizar e essa leitura disparando cedo demais)
    // nunca era retentada, e usuarios/{uid} nulo é tratado como "sem perfil"
    // -> redireciona pro login mesmo com sessão válida. No app de produção
    // (WebSocket, não long-polling) essa corrida é rara; no emulador local
    // era reproduzível toda vez em páginas com muitos listeners (ex:
    // dashboard.html). Retry aqui é seguro nos dois ambientes.
    if (snapshot.val() === null && attemptsLeft > 0) {
      setTimeout(() => {
        readUsuarioProfileWithRetry(db, uid, onSuccess, attemptsLeft - 1);
      }, 700);
      return;
    }
    onSuccess(snapshot);
  }, err => {
    if (attemptsLeft > 0) {
      setTimeout(() => {
        readUsuarioProfileWithRetry(db, uid, onSuccess, attemptsLeft - 1);
      }, 700);
    } else {
      showAuthLoadError('Erro ao carregar seu perfil: ' + (err && err.message ? err.message : 'tente novamente') + '.');
    }
  });
}

// Ícones de linha (estilo SF Symbols) usados na sidebar — desenhados com
// formas simples, sem path complexo, pra ficar consistente e leve.
const ktIcons = {
  dashboard: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2"/><rect x="13" y="13" width="7.5" height="7.5" rx="2"/>',
  history: '<path d="M4 20V10M12 20V4M20 20v-7"/>',
  calendar: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 3v3M16 3v3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.2-.9-2 3.4L4.6 10.5a7.6 7.6 0 0 0 0 3L2.7 15l2 3.4 2.2-.9c.77.66 1.65 1.17 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.2.9 2-3.4-1.9-1.5Z"/>',
  list: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  tag: '<path d="M11.5 3.5H5A1.5 1.5 0 0 0 3.5 5v6.5c0 .4.16.78.44 1.06l9 9a1.5 1.5 0 0 0 2.12 0l6.5-6.5a1.5 1.5 0 0 0 0-2.12l-9-9a1.5 1.5 0 0 0-1.06-.44Z"/><circle cx="8" cy="8" r="1.5"/>',
  box: '<path d="M3.5 8 12 4l8.5 4M3.5 8v8L12 20l8.5-4V8M3.5 8 12 12m0 0 8.5-4M12 12v8"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M9 12h11M4 18h13M19 18h1"/><circle cx="11" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  pencil: '<path d="M4 20.5V9l6-4.5 6 4.5v11.5"/><path d="M10 20.5v-6h4v6M15 9.5h5v11"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M2.8 20c.6-3.4 3-5.5 6.2-5.5s5.6 2.1 6.2 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M15.3 14.7c2.3.3 4 2 4.5 4.8"/>',
  chart: '<path d="M4 19V5M4 19h16"/><path d="M8 15l3-4 3 2 4-6"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2.2L8 15h9l2.5-7.5H6.3"/>',
  truck: '<rect x="1.5" y="7" width="13" height="9" rx="1.5"/><path d="M14.5 10h4l3 3.5V16h-7z"/><circle cx="6" cy="18.5" r="1.7"/><circle cx="17" cy="18.5" r="1.7"/>',
  // Estoque/WMS -- galpão com telhado e portão, distinto de "box" (já usado
  // por Matriz de Insumos) e de "truck".
  warehouse: '<path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9 20v-6.5h6V20"/>',
  // Separação de Materiais (WMS Fase 2) -- prancheta com check, distinto de
  // "warehouse" (o hub de estoque em si) e "box" (Matriz de Insumos).
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M9 12l2 2 4-4"/>'
};
function ktIcon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + ktIcons[name] + '</svg>';
}
function ktLink(href, icon, label, activePage) {
  // Compara só o nome do arquivo, ignorando ?query -- necessário desde que
  // uma mesma página passou a ter mais de um link de menu apontando pra
  // abas diferentes dela (ex: "Estoque" e "WMS" -> estoque.html?tab=X) --
  // sem isso, NENHUM dos dois nunca ficava marcado como ativo, porque
  // activePage (só o nome do arquivo) nunca batia com href+query.
  var hrefPage = href.split('?')[0];
  var cls = 'kt-nav-link' + (activePage === hrefPage ? ' active' : '');
  return '<a class="' + cls + '" href="' + href + '">' + ktIcon(icon) + '<span>' + label + '</span></a>';
}

// Renderiza a sidebar de navegação (linguagem visual Apple, aprovada 2026-07-19)
function renderUnifiedNavbar(user) {
  // Remove qualquer cabeçalho legado ou barra preta antiga
  // NOTA: '.header' foi removido deste seletor -- hoje é a classe do cabeçalho
  // ATUAL e intencional de quase toda página (título h1, status de conexão,
  // relógio em form.html). Nenhum <header> semântico nem #auth-status-bar
  // sobrevive no HTML atual (confirmado via grep no repo); este seletor fica
  // aqui só como salvaguarda caso um cabeçalho legado real volte a existir.
  const oldHeader = document.querySelector('header, #auth-status-bar, #auth-status-bar-black');
  const blackToolbar = document.querySelector('body > div[style*="background:#0f172a"], body > div[style*="background: #0f172a"]');
  const body = document.body;
  const activePage = getActivePageName();

  if (blackToolbar) {
    blackToolbar.remove();
  }

  // Se já existir a sidebar, não renderiza de novo
  if (document.getElementById('unified-navbar')) return;

  const sidebar = document.createElement('aside');
  sidebar.id = 'unified-navbar';
  sidebar.className = 'kt-sidebar';

  // Módulo de RH -- login completamente separado do PCP pra 'rh'/'gestor'
  // (decisão do usuário). Esse papel nunca vê nenhum link de PCP/Produção,
  // e vice-versa -- os dois grupos de link são mutuamente exclusivos pra
  // ele. 'admin' é a ÚNICA exceção (pedido do usuário: ADM vê tudo, sem
  // exceção) -- vê o menu de PCP inteiro E o de RH ao mesmo tempo, por
  // isso showRhGroup é uma condição separada de isRH.
  const isRH = user.role === 'rh' || user.role === 'gestor';
  const showRhGroup = isRH || user.role === 'admin';
  const isRotulagem = user.role === 'rotulagem';
  const roleLabel = user.role === 'admin' ? 'Administrador'
    : user.role === 'pcp' ? 'PCP'
    : user.role === 'rh' ? 'RH Central'
    : user.role === 'gestor' ? 'Gestor de Linha'
    : (isRotulagem ? 'Rotulagem' : 'Produção');
  // 'pcp' (novo papel, pedido do usuário: "vê tudo, menos o RH") tem
  // exatamente o mesmo alcance de página que 'admin' sempre teve no PCP.
  const isPcpAdmin = user.role === 'admin' || user.role === 'pcp';
  const initials = (user.nome || '?').trim().split(/\s+/).slice(0, 2).map(function(s) { return s[0]; }).join('').toUpperCase();

  // Reorganização de menu pedida pelo usuário (blocos: Analytics/Geral/
  // Compras/PCP/Logística/Produção/RH/ADM) -- por decisão explícita dele,
  // isto muda só ROTULAGEM e AGRUPAMENTO visual, NUNCA quem vê o quê --
  // "depois vou delinear os acessos, qual perfil vê o que e faz o que" é
  // uma etapa futura separada. Cada link mantido com o MESMO gate
  // (isPcpAdmin) que já tinha antes, só reagrupado em blocos novos.

  // Perfil Rotulagem só tem acesso a form.html -- sidebar minimalista, sem
  // links pra páginas que dariam "Acesso Negado" se clicadas.
  const analisesGroup = (isRotulagem || isRH) ? '' :
    '<div class="kt-nav-group"><div class="kt-nav-cap">Analytics</div>' +
    ktLink('dashboard.html', 'dashboard', 'Dashboard Diário', activePage) +
    ktLink('dashboard_analise.html', 'history', 'Dashboard Geral', activePage) +
    '</div>';

  // "Geral" -- pedido do usuário: Cadastros e Estoque (a visão de
  // QUANTIDADE, "de fato os estoques") saem do bloco PCP e ganham um
  // bloco próprio, mais genérico. Estoque aponta pra estoque.html?tab=
  // agregado -- mesma página de sempre, só landing direto na aba de saldo
  // (WMS, abaixo, landing na aba de posições/endereçamento -- são a MESMA
  // ferramenta, dois pontos de entrada, não duas páginas -- ver ktLink
  // acima pro fix de "ativo" que isso exigiu).
  // Geral/Compras têm SÓ links isPcpAdmin-gated (diferente de PCP, que
  // tem "Planejamento"/"Controle de OPs" abertos pra 'production'
  // também) -- gate no GRUPO INTEIRO por isPcpAdmin, não só nos links de
  // dentro, senão sobra uma legenda "Geral"/"Compras" flutuando sem link
  // nenhum embaixo pra quem não é admin/pcp (achado ao testar com o
  // papel 'production'). isPcpAdmin já implica !isRotulagem && !isRH
  // (papéis são mutuamente exclusivos), então um gate só basta.
  const geralGroup = !isPcpAdmin ? '' :
    '<div class="kt-nav-group"><div class="kt-nav-cap">Geral</div>' +
    ktLink('cadastros.html', 'tag', 'Cadastros', activePage) +
    ktLink('estoque.html?tab=agregado', 'warehouse', 'Estoque', activePage) +
    '</div>';

  const comprasGroup = !isPcpAdmin ? '' :
    '<div class="kt-nav-group"><div class="kt-nav-cap">Compras</div>' +
    ktLink('compras.html', 'cart', 'Compras', activePage) +
    '</div>';

  const pcpGroup = (isRotulagem || isRH) ? '' :
    '<div class="kt-nav-group"><div class="kt-nav-cap">PCP</div>' +
    ktLink('planejamento.html', 'calendar', 'Planejamento', activePage) +
    // horizonte.html tirado do menu a pedido do usuário -- "não é usado
    // pra nada hoje" (o botão de congelar, que era a única mecânica ativa
    // da tela, nunca pegou uso real -- alocacoes_planejamento ficou vazio
    // o tempo todo). Página continua existindo (histórico/dados não
    // apagados), só não é mais oferecida como parte do fluxo ativo.
    ktLink('ops.html', 'gear', 'Controle de OPs', activePage) +
    (isPcpAdmin ? ktLink('emitir_op.html', 'pencil', 'Emitir OP', activePage) : '') +
    (isPcpAdmin ? ktLink('pedidos.html', 'list', 'Pedidos', activePage) : '') +
    // "Matriz de Insumos > MRP" -- por ora só o rótulo muda (confirmado
    // pelo usuário: "a princípio só renomear"); uma funcionalidade de MRP
    // de verdade fica pra quando o Estoque/Compras (Agendamentos) já
    // estiverem rodando -- registrado em MELHORIAS_FUTURAS.md.
    (isPcpAdmin ? ktLink('insumos.html', 'box', 'Matriz de Insumos (MRP)', activePage) : '') +
    (isPcpAdmin ? ktLink('admin.html', 'sliders', 'Ajustes / Config', activePage) : '') +
    // Histórico de Apontamentos aparece TAMBÉM aqui, além de Produção
    // (confirmado pelo usuário: "aparece nos 2 blocos mesmo") -- PCP e
    // Produção são times diferentes que precisam do mesmo histórico.
    (isPcpAdmin ? ktLink('historico.html', 'history', 'Histórico de Apontamentos', activePage) : '') +
    '</div>';

  // "Logística" -- pedido do usuário: separa do bloco PCP, ganha 3 itens.
  // "Logística" (a página) vira "Agendamentos" no menu -- rótulo só,
  // logistica.html continua sendo a mesma página/funcionalidade. "WMS"
  // aponta pra estoque.html?tab=enderecos (posições/endereçamento --
  // "organização do estoque", palavras do usuário), landing diferente de
  // "Estoque" acima, mesma página.
  // Mesmo motivo do gate em Geral/Compras acima -- os 3 links daqui são
  // isPcpAdmin-only, gate no grupo inteiro.
  const logisticaGroup = !isPcpAdmin ? '' :
    '<div class="kt-nav-group"><div class="kt-nav-cap">Logística</div>' +
    ktLink('logistica.html', 'truck', 'Agendamentos', activePage) +
    ktLink('estoque.html?tab=enderecos', 'warehouse', 'WMS', activePage) +
    ktLink('separacao_materiais.html', 'clipboard', 'Separação de Materiais', activePage) +
    '</div>';

  const producaoGroup = isRH ? '' :
    '<div class="kt-nav-group"><div class="kt-nav-cap">Produção</div>' +
    ktLink('form.html', 'pencil', 'Apontamento Diário', activePage) +
    (isRotulagem ? '' : ktLink('historico.html', 'history', 'Histórico de Apontamentos', activePage)) +
    '</div>';

  const usersGroup = isPcpAdmin
    ? '<div class="kt-nav-group"><div class="kt-nav-cap">ADM</div>' + ktLink('usuarios.html', 'people', 'Usuários', activePage) + '</div>'
    : '';

  // RH (Fase 1-3b): Colaboradores/Cargos, Avaliação, Férias -- Documentos
  // etc. entram em fases futuras (ver plano do módulo). 'admin' vê este
  // grupo TAMBÉM (showRhGroup), além do grupo PCP inteiro acima -- os
  // dois não são mais mutuamente exclusivos só pra esse papel.
  const rhGroup = !showRhGroup ? '' :
    '<div class="kt-nav-group"><div class="kt-nav-cap">RH</div>' +
    ((user.role === 'rh' || user.role === 'admin') ? ktLink('rh_dashboard.html', 'dashboard', 'Dash', activePage) : '') +
    ktLink('rh_cadastros.html', 'people', 'Colaboradores', activePage) +
    ktLink('rh_avaliacao.html', 'pencil', 'Avaliação de Desempenho', activePage) +
    ktLink('rh_ferias.html', 'calendar', 'Férias', activePage) +
    '</div>';

  // RH Central pousa no Dashboard (é a "tela inicial" dele, por decisão da
  // especificação); Gestor não acessa o Dashboard nesta fase -- pousa na
  // Avaliação, sua ferramenta principal.
  var rhHome = user.role === 'rh' ? 'rh_dashboard.html' : 'rh_avaliacao.html';
  sidebar.innerHTML =
    '<div class="kt-brand" onclick="window.location.href=\'' + (isRH ? rhHome : 'dashboard.html') + '\'"><img class="kt-brand-logo" src="kuryos-logo.svg" alt="Kuryos"></div>' +
    analisesGroup + geralGroup + comprasGroup + pcpGroup + logisticaGroup + producaoGroup + usersGroup + rhGroup +
    '<div class="kt-sidebar-foot">' +
      '<span class="kt-avatar">' + initials + '</span>' +
      '<div class="who"><div class="name">' + user.nome + '</div><div class="role">' + roleLabel + '</div></div>' +
      '<button id="kt-theme-toggle" title="' + kuryosThemeLabel(kuryosThemeState()) + '" onclick="cycleKuryosTheme()">' + kuryosThemeIcon(kuryosThemeState()) + '</button>' +
      '<button title="Sair" onclick="firebase.auth().signOut().then(() => window.location.href=\'login.html\')">⏻</button>' +
    '</div>';

  // Botão hamburger + fundo escurecido — só aparecem (via CSS) abaixo de
  // 980px, quando a sidebar vira gaveta deslizante em vez de ficar fixa.
  const backdrop = document.createElement('div');
  backdrop.className = 'kt-backdrop';
  backdrop.id = 'kt-backdrop';

  const hamburger = document.createElement('button');
  hamburger.className = 'kt-hamburger';
  hamburger.id = 'kt-hamburger';
  hamburger.title = 'Menu';
  hamburger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/></svg>';

  function closeDrawer() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
  }
  function toggleDrawer() {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('open');
  }
  hamburger.addEventListener('click', toggleDrawer);
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeDrawer(); });
  // Fecha a gaveta ao navegar (toque num link) pra não reabrir já aberta na próxima página
  sidebar.addEventListener('click', function(e) { if (e.target.closest('.kt-nav-link')) closeDrawer(); });

  // Insere sidebar, hamburger e fundo escurecido no início do body
  body.insertBefore(backdrop, body.firstChild);
  body.insertBefore(sidebar, body.firstChild);
  body.insertBefore(hamburger, body.firstChild);

  // Remove cabeçalhos duplicados/antigos se existirem na página para manter o design clean
  if (oldHeader && oldHeader !== sidebar) {
    oldHeader.remove();
  }
}

// Configura o planejamento para modo Somente Leitura para a Produção
function makePlanningReadOnly() {
  setTimeout(() => {
    // Oculta painel de agendamento lateral
    const sidebar = document.getElementById('sidebar');
    const pContainer = document.querySelector('.p-container');
    if (sidebar) sidebar.style.display = 'none';
    if (pContainer) pContainer.style.gridTemplateColumns = '1fr';

    // Oculta botões de salvar e resetar
    const btnSave = document.getElementById('btn-save');
    const btnReset = document.getElementById('btn-reset');
    if (btnSave) btnSave.style.display = 'none';
    if (btnReset) btnReset.style.display = 'none';

    // Bloqueia cliques nas células e cartões no planejamento
    const grid = document.getElementById('planning-grid');
    if (grid) {
      const style = document.createElement('style');
      style.innerHTML = `
        .cell, .scheduled-card, .drag-item, .time-col button { pointer-events: none !important; }
        .grid-container { pointer-events: auto !important; overflow: auto !important; }
      `;
      document.head.appendChild(style);
    }
  }, 800);
}

// --- MÁQUINA DE STATUS AUTOMÁTICA DAS OPs ---
// Executa recálculo do status de uma OP ativa com base em seus slots e apontamentos
window.updateOpStatusAutomatically = function(pedidoId, callback, preloadedProgramacao) {
  if (typeof firebase === 'undefined') return;
  const db = firebase.database();

  db.ref('pedidos/' + pedidoId).once('value', pedSnap => {
    const p = pedSnap.val();
    if (!p) {
      if (callback) callback(null);
      return;
    }

    // Se a OP já estiver concluída manualmente, respeita e não altera de volta a menos que explicitamente solicitado
    const plannedQty = p.qtdTotal || 0;
    // produzido/ultimoApontamento já são mantidos incrementalmente a cada apontamento
    // (ver transaction em form.html) — evita reescanear todo o histórico de registros.
    const totalProduced = parseFloat(p.produzido) || 0;
    const lastTimestamp = p.ultimoApontamento ? new Date(p.ultimoApontamento).getTime() : 0;

    function withProgramacao(programacao) {
      let isScheduled = false;

      Object.keys(programacao).forEach(date => {
        const dayData = programacao[date] || {};
        Object.keys(dayData).forEach(hour => {
          const hourData = dayData[hour] || {};
          // 10 slots, não 4: todo o resto do sistema varre 1..10 (grade,
          // Andon, replanejamento, form.html). Com a 5ª linha cadastrada, todo
          // pedido programado só nela ficava eternamente "Não Iniciado".
          // E normaliza a chave dos dois lados -- '0022__SKU' vs '22__SKU' é o
          // caso real que motivou _kuryosNormalizePedidoKey (hoisted, def. abaixo).
          for (let l = 1; l <= 10; l++) {
            const slot = hourData['env' + l];
            if (!slot) continue;
            const alvo = _kuryosNormalizePedidoKey(pedidoId);
            if (!alvo) continue; // nunca casar undefined com undefined
            if (_kuryosNormalizePedidoKey(slot.pedidoKey) === alvo
                || _kuryosNormalizePedidoKey(slot.pedidoId) === alvo) {
              isScheduled = true;
            }
          }
        });
      });

      // Define o novo status
      let newStatus = 'Não Iniciado';
      if (totalProduced >= plannedQty && plannedQty > 0) {
        newStatus = 'Concluído';
      } else if (totalProduced > 0) {
        // Diferença de tempo desde o último apontamento
        const diffMs = Date.now() - lastTimestamp;
        const twoHoursMs = 2 * 60 * 60 * 1000;
        if (diffMs > twoHoursMs) {
          newStatus = 'Produção Parcial';
        } else {
          newStatus = 'Em Produção';
        }
      } else if (isScheduled) {
        newStatus = 'Programado';
      }

      // Atualiza no banco se mudou
      if (p.status !== newStatus) {
        db.ref('pedidos/' + pedidoId).update({ status: newStatus })
          .then(() => {
            console.log(`Status de ${pedidoId} (Pedido) recalculado automaticamente: ${newStatus}`);
            if (callback) callback(newStatus);
          });
      } else {
        if (callback) callback(p.status);
      }
    }

    if (preloadedProgramacao) {
      withProgramacao(preloadedProgramacao);
    } else {
      // Busca se está agendada no planejamento semanal
      db.ref('programacao').once('value', progSnap => {
        withProgramacao(progSnap.val() || {});
      });
    }
  });
};

// Executa varredura e atualização de todas as OPs ativas no banco (para consistência do sistema).
// Hoje rodava em TODA carga de página admin (form/planejamento/dashboard/ops/
// pedidos/produtos/insumos/admin/usuarios/importar), cada vez lendo pedidos+
// programacao inteiros sem escopo, mais uma leitura extra por OP não
// concluída (N+1) -- pressão real e crescente no RTDB conforme o histórico
// aumenta, que piora a chance da leitura de perfil em auth_check.js travar
// (várias leituras grandes competindo pelo mesmo websocket). Cooldown de 5min
// por aba/sessão evita repetir a varredura inteira a cada navegação, sem
// deixar de rodar quando genuinamente faz sentido (primeira carga do dia).
window.syncAllActiveOpsStatus = function() {
  if (typeof firebase === 'undefined') return;
  try {
    const last = parseInt(sessionStorage.getItem('kuryos_last_ops_sync') || '0', 10);
    if (Date.now() - last < 5 * 60 * 1000) return;
    sessionStorage.setItem('kuryos_last_ops_sync', String(Date.now()));
  } catch (e) { /* sessionStorage indisponível -- segue sem cooldown */ }
  const db = firebase.database();

  db.ref('pedidos').once('value', snapshot => {
    const pedidos = snapshot.val() || {};
    db.ref('programacao').once('value', progSnap => {
      const programacao = progSnap.val() || {};
      Object.keys(pedidos).forEach(key => {
        const p = pedidos[key];
        if (p.status !== 'Concluído') {
          window.updateOpStatusAutomatically(key, null, programacao);
        }
      });
      // Mesma varredura, agora pro nível de OP/lote real (ops/) -- até aqui
      // só tinha status setado manualmente em Controle de OPs, ou "Em
      // Produção"/"Concluído" quando alguém apontava produção (ver
      // updateOpRecordOnApontamento em form.html). Nunca virava "Programado"
      // nem "Produção Parcial" (parada), então ficava sempre incompleto.
      window._syncOpsLoteStatusELinha(programacao);
    });
  });
};

// Normaliza a parte numérica do id do pedido (antes do "__sku") removendo
// zeros à esquerda -- mesma correção usada em planejamento.html pra casar
// ops/{lote}.skuPedidoKey com pedidos/{key} mesmo quando um dos dois perdeu
// o zero à esquerda na emissão (ex: "12__SKU" vs "0012__SKU").
function _kuryosNormalizePedidoKey(key) {
  if (!key) return key;
  var parts = String(key).split('__');
  if (parts.length < 2) return key;
  var idPart = parts[0];
  if (/^\d+$/.test(idPart)) idPart = String(parseInt(idPart, 10));
  return idPart + '__' + parts.slice(1).join('__');
}

function _kuryosBuildScheduledPedidoKeySet(programacao) {
  var set = {};
  Object.keys(programacao).forEach(function(date) {
    var dayData = programacao[date] || {};
    Object.keys(dayData).forEach(function(hour) {
      var hourData = dayData[hour] || {};
      for (var l = 1; l <= 10; l++) {
        var slot = hourData['env' + l];
        if (slot && slot.pedidoKey) set[_kuryosNormalizePedidoKey(slot.pedidoKey)] = true;
      }
    });
  });
  return set;
}

// Recalcula status (Não Iniciado/Programado/Em Produção/Produção Parcial) e
// preenche a linha de cada OP real (ops/) que ainda não tenha uma -- mesma
// lógica de status já usada pro nível de pedido, adaptada pra OP: usa
// dataFimReal (atualizado a cada apontamento) como "última atividade" e
// abertaDesde como sinal de que está rodando agora mesmo. A linha só é
// preenchida quando existe um vínculo confirmado no horizonte rolante
// (alocacoes_planejamento vinculado) -- nunca sobrescreve uma linha já
// definida manualmente.
window._syncOpsLoteStatusELinha = function(programacao) {
  if (typeof firebase === 'undefined') return;
  const db = firebase.database();
  const scheduledSet = _kuryosBuildScheduledPedidoKeySet(programacao);

  Promise.all([
    db.ref('ops').once('value'),
    db.ref('alocacoes_planejamento').once('value')
  ]).then(function(results) {
    const ops = results[0].val() || {};
    const alocacoes = Object.values(results[1].val() || {});
    const now = Date.now();
    const twoHoursMs = 2 * 60 * 60 * 1000;

    Object.keys(ops).forEach(function(key) {
      const op = ops[key];
      // 'Cancelado' faltava aqui -- sem essa checagem, essa varredura (roda
      // em TODA carga de página, ver comentário de syncAllActiveOpsStatus)
      // reescrevia o status de qualquer OP cancelada de volta pra "Não
      // Iniciado"/"Programado"/etc pouco depois do cancelamento, silenciosamente
      // desfazendo o cancelOp (ops.html) -- a OP cancelada voltava a aparecer
      // disponível pra alocação em linha/rotulagem como se nada tivesse
      // acontecido, sem nenhum aviso.
      // Achado do Auditor: mesmo problema valia pra QUALQUER correção manual
      // de status feita em ops.html (ex: "Produção Parcial" numa OP travada
      // por abertaDesde obsoleto) -- essa varredura sobrescrevia de volta na
      // próxima carga de página de qualquer admin, sem aviso. statusManualOverride
      // (gravado por updateOpField em ops.html, limpo por clearStatusOverride)
      // avisa pra deixar essa OP em paz até alguém devolver pro automático.
      // 'Aguardando Confirmação' (Fase 7 do plano) entra no mesmo balde de
      // Concluído/Cancelado -- já é um estado "pegajoso" aguardando o PCP,
      // essa varredura automática não deve mais mexer nele.
      if (!op || op.status === 'Concluído' || op.status === 'Cancelado' || op.status === 'Aguardando Confirmação' || op.statusManualOverride) return;

      var updates = {};

      if (!op.linha) {
        // Fase 6 do plano: opLote (vínculo único) virou opsVinculadas (mapa
        // -- uma alocação pode ter várias OPs, um pedido de 10.000 vira N
        // OPs). Não exige mais status==='vinculado' (só bate quando a
        // alocação inteira já foi 100% consumida) -- uma OP específica já
        // está genuinamente vinculada a essa linha mesmo que a alocação
        // ainda esteja 'congelado' aguardando as outras OPs do mesmo bloco.
        var opLoteKeySafe = sanitizeKey(op.lote);
        var alocLinha = alocacoes.find(function(a) {
          return a && a.opsVinculadas && a.opsVinculadas[opLoteKeySafe] && a.linha;
        });
        if (alocLinha) updates.linha = alocLinha.linha;
      }

      const planned = op.qtdPlanejada || 0;
      // Linha/Rotulagem/Posto são somatórias sempre distintas (getProduzido,
      // shared/utils.js), nunca somadas -- mas decisão explícita do usuário
      // pra esta primeira etapa beta: só a Linha decide "Concluído"/"Em
      // Produção" da OP inteira (dado de Rotulagem ainda não é confiável o
      // bastante pra isso). Mesmo escopo de computeOpStatus, mantido em
      // sincronia manual aqui porque essa função tem a nuance extra de
      // "Produção Parcial" (atividade parada há >2h) que computeOpStatus
      // não tem.
      var tiposTocados = ['linha'].filter(function(t) { return getProduzido(op, t) > 0; });
      var todosConcluidos = planned > 0 && tiposTocados.length > 0 &&
        tiposTocados.every(function(t) { return getProduzido(op, t) / planned >= 0.95; });
      const lastTs = op.dataFimReal ? new Date(op.dataFimReal).getTime()
        : (op.dataInicioReal ? new Date(op.dataInicioReal).getTime() : 0);

      var newStatus;
      if (todosConcluidos) {
        // Fase 7 do plano: nunca conclui sozinho -- só sinaliza pro PCP
        // confirmar em ops.html (mesmo raciocínio de computeOpStatus,
        // shared/utils.js, mantido em sincronia aqui).
        newStatus = 'Aguardando Confirmação';
      } else if (tiposTocados.length > 0) {
        newStatus = (now - lastTs) > twoHoursMs ? 'Produção Parcial' : 'Em Produção';
      } else if (op.abertaDesde || op.abertaDesdeRot) {
        // abertaDesdeRot = aberta na Rotulagem (form.html/campoAberturaInicio)
        // -- Linha e Rotulagem são setores diferentes que podem estar
        // trabalhando a mesma OP ao mesmo tempo, em campos de abertura
        // separados; qualquer um dos dois já significa "rodando agora".
        newStatus = 'Em Produção';
      } else if (scheduledSet[_kuryosNormalizePedidoKey(op.skuPedidoKey)]) {
        newStatus = 'Programado';
      } else {
        newStatus = 'Não Iniciado';
      }
      if (newStatus !== op.status) updates.status = newStatus;

      if (Object.keys(updates).length) {
        db.ref('ops/' + key).update(updates);
      }
    });
  });
};

// --- AUTO-AJUSTE DE PLANEJAMENTO ---
// Compara o ritmo real de produção de uma OP (últimas 3h de registros) com o
// planejado, e reajusta automaticamente os slots futuros dela e da fila de
// OPs da mesma linha na grade de programação, registrando cada mudança em
// ajustes_planejamento/{data}. Nunca toca no passado nem na hora corrente;
// nunca move OP entre linhas diferentes; sem limite de alcance da cascata
// dentro da capacidade já existente na grade (se a grade não tiver slots
// futuros suficientes, registra um aviso de capacidade esgotada em vez de
// inventar novos dias/horas fora da configuração do calendário).
window._autoAjusteCooldown = {};

function _kuryosDateStr(d) {
  var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
}

function _kuryosTodayStr() {
  return _kuryosDateStr(new Date());
}

function _kuryosLineIndexForSlot(hourData, linha) {
  for (var i = 1; i <= 10; i++) {
    var nome = hourData['linha' + i];
    if (!nome) {
      if (linha === 'Linha ' + i) return i;
    } else if (nome === linha) {
      return i;
    }
  }
  return null;
}

function _kuryosMondayOf(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  var dw = d.getDay();
  d.setDate(d.getDate() + (dw === 0 ? -6 : 1 - dw));
  return _kuryosDateStr(d);
}

function _kuryosIsConcluidoLike(p) {
  if (!p) return true;
  if (p.statusManual === 'encerrado') return true;
  var st = String(p.status || '').toLowerCase().trim();
  // 'cancelado' tratado como "não disputa mais fila/slot futuro", mesmo
  // raciocínio de opEstaAtiva pras OPs -- pedidos não usam esse status hoje,
  // é só blindagem caso passem a usar no futuro.
  return st.indexOf('conclu') === 0 || st === 'cancelado';
}

// Slots futuros (hoje após a hora atual + dias seguintes) de uma linha,
// ordenados cronologicamente. Cada item: { date, hourKey, envKey, pedidoKey }
function _kuryosFutureSlotsForLinha(programacao, linha, todayStr, nowHour) {
  var out = [];
  Object.keys(programacao).sort().forEach(function(date) {
    if (date < todayStr) return;
    var dayData = programacao[date] || {};
    Object.keys(dayData).sort().forEach(function(hourKey) {
      if (date === todayStr) {
        var h = parseInt(hourKey.replace('_', ':').split(':')[0]);
        if (isNaN(h) || h <= nowHour) return; // nunca toca hoje ate a hora atual
      }
      var hourData = dayData[hourKey] || {};
      var idx = _kuryosLineIndexForSlot(hourData, linha);
      if (!idx) return;
      var envKey = 'env' + idx;
      var slot = hourData[envKey];
      out.push({
        date: date,
        hourKey: hourKey,
        envKey: envKey,
        pedidoKey: slot && slot.pedidoKey ? slot.pedidoKey : null,
        congelamentoLiberado: !!(slot && slot.congelamentoLiberado)
      });
    });
  });
  return out;
}

window.autoAjustarPlanejamento = function(pedidoKey) {
  if (typeof firebase === 'undefined' || !pedidoKey) return;
  var db = firebase.database();

  db.ref('pedidos/' + pedidoKey).once('value').then(function(pedSnap) {
    var pedidoOrigem = pedSnap.val();
    if (!pedidoOrigem) return;

    var todayStr = _kuryosTodayStr();
    Promise.all([
      // Só datas de hoje em diante importam aqui (tudo antes de todayStr é
      // descartado logo abaixo de qualquer forma — ver _kuryosFutureSlotsForLinha).
      db.ref('programacao').orderByKey().startAt(todayStr).once('value'),
      db.ref('pedidos').once('value'),
      db.ref('config/opAtrasoHoras').once('value'),
      db.ref('alocacoes_planejamento').once('value'),
      db.ref('config/congelamento').once('value')
    ]).then(function(results) {
      var programacao = results[0].val() || {};
      var todosPedidos = results[1].val() || {};
      var opAtrasoHoras = results[2].val() || 1;
      var alocacoes = results[3].val() || {};
      // Zona fixa rolante: além do vínculo explícito de OP emitida acima,
      // qualquer slot já ocupado dentro dos próximos N dias (config.congelamento.diasFixos,
      // padrão 7) também some do pool reajustável -- é o "conforme fosse
      // aproximando, deixássemos fixo" pedido pelo usuário. Só protege o que
      // já está preenchido (slot vazio dentro da janela continua livre pro
      // cascade usar); um planejador pode romper essa proteção por slot via
      // "🔓 Liberar para replanejamento" na Grade Semanal (grava
      // congelamentoLiberado no próprio slot -- ver planejamento.html).
      // `|| 7` engolia o 0: desligar a zona fixa gravando diasFixos:0 não
      // tinha efeito nenhum aqui (0 é falsy -> caía pro default 7), enquanto
      // planejamento.html e admin.html já liam com `!= null` e mostravam a
      // grade destravada. UI e motor discordavam em silêncio.
      var _cong = results[4].val() || {};
      var diasFixos = _cong.diasFixos != null ? _cong.diasFixos : 7;
      var limiteZonaFixaStr = _kuryosDateStr(new Date(Date.now() + diasFixos * 24 * 60 * 60 * 1000));
      // Slots com OP real emitida (alocação 'vinculado') viram fixos -- a
      // automação de reajuste nunca mais mexe neles, é o compromisso real
      // que endurece na zona congelada do horizonte rolante. Chave:
      // pedidoKey|segunda-da-semana|linha.
      var vinculadoSet = {};
      Object.values(alocacoes).forEach(function(a) {
        // Fase 6 do plano: status só vira 'vinculado' quando a alocação
        // inteira já foi 100% consumida (todas as N OPs do bloco emitidas)
        // -- mas mesmo uma OP só (consumo parcial, opsVinculadas não
        // vazio) já é um compromisso real que o reajuste automático não
        // deve mexer, senão reshufflaria a capacidade restante em cima de
        // OPs que já existem de verdade pra esse mesmo bloco.
        if (a && ((a.opsVinculadas && Object.keys(a.opsVinculadas).length) || a.status === 'vinculado')) {
          vinculadoSet[a.pedidoKey + '|' + a.semanaISO + '|' + a.linha] = true;
        }
      });
      var nowHour = new Date().getHours();

      // 1. Descobre em qual linha essa OP tem slot futuro agendado
      // Achado do Auditor: comparação direta de pedidoKey já causou bug
      // antes (ver _kuryosNormalizePedidoKey acima) -- ops/{lote}.skuPedidoKey
      // e o pedidoKey gravado no slot de programacao podem divergir por um
      // zero à esquerda perdido na emissão. Normaliza os dois lados antes
      // de comparar, mesma correção já aplicada em
      // _kuryosBuildScheduledPedidoKeySet.
      var pedidoKeyNorm = _kuryosNormalizePedidoKey(pedidoKey);
      var linha = null;
      Object.keys(programacao).sort().some(function(date) {
        if (date < todayStr) return false;
        var dayData = programacao[date] || {};
        return Object.keys(dayData).some(function(hourKey) {
          if (date === todayStr) {
            var h = parseInt(hourKey.replace('_', ':').split(':')[0]);
            if (isNaN(h) || h <= nowHour) return false;
          }
          var hourData = dayData[hourKey] || {};
          for (var i = 1; i <= 10; i++) {
            var slot = hourData['env' + i];
            if (slot && slot.pedidoKey && _kuryosNormalizePedidoKey(slot.pedidoKey) === pedidoKeyNorm) {
              linha = hourData['linha' + i] || ('Linha ' + i);
              return true;
            }
          }
          return false;
        });
      });
      if (!linha) return; // sem slot futuro pra essa OP, nada a reajustar

      // Cooldown por linha — evita recalcular a cada apontamento isolado
      var now = Date.now();
      var lastRun = window._autoAjusteCooldown[linha] || 0;
      if (now - lastRun < 3 * 60 * 1000) return;
      window._autoAjusteCooldown[linha] = now;

      // 2. Fila de OPs ativas dessa linha, por prioridade
      var filaLinha = Object.keys(todosPedidos)
        .map(function(k) { return { key: k, p: todosPedidos[k] }; })
        .filter(function(x) { return x.p && x.p.linha === linha && !_kuryosIsConcluidoLike(x.p); })
        .sort(function(a, b) {
          var pa = a.p.priority || 999, pb = b.p.priority || 999;
          if (pa !== pb) return pa - pb;
          return String(a.p.id || '').localeCompare(String(b.p.id || ''), undefined, { numeric: true });
        });
      if (!filaLinha.length) return;

      // Janela ampla (30 dias) pra alimentar o motor de ritmo demonstrado
      // (shared/utils.js) -- ele mesmo escolhe, dentro disso, as sessões
      // recentes e "limpas" (sem parada relevante, sem sessão curta demais)
      // até KURYOS_RITMO_JANELA_SESSOES. Antes disso aqui era só as
      // últimas 3h -- volátil por natureza, um período atípico virava a
      // meta da linha inteira. Registros são particionados por dia
      // (registros/{data}/...), então basta pedir a partir da data de corte.
      var corte = now - 30 * 24 * 60 * 60 * 1000;
      var corteDateStr = _kuryosDateStr(new Date(corte));
      db.ref('registros').orderByKey().startAt(corteDateStr).once('value').then(function(regSnap) {
        var registros = regSnap.val() || {};

        function ritmoReal(p) {
          var r = kuryosRitmoDemonstrado(registros, { pedidoId: p.id, produto: p.produto });
          return r.fonte === 'demonstrado' ? r.ritmo : 0;
        }

        // 3. Slots futuros já existentes na grade pra essa linha -- exclui os
        // que já têm OP real vinculada (fixos, fora do alcance do cascade) e
        // conta quantas horas fixas cada pedido já tem, pra não tentar
        // reclamar de novo o que já é compromisso real.
        var slotsLinhaTodos = _kuryosFutureSlotsForLinha(programacao, linha, todayStr, nowHour);
        var horasFixasPorPedido = {};
        var slotsLinha = slotsLinhaTodos.filter(function(slot) {
          if (!slot.pedidoKey) return true;
          var semanaISO = _kuryosMondayOf(slot.date);
          var vinculado = vinculadoSet[slot.pedidoKey + '|' + semanaISO + '|' + linha];
          var zonaFixa = !vinculado && !slot.congelamentoLiberado && slot.date < limiteZonaFixaStr;
          if (vinculado || zonaFixa) {
            horasFixasPorPedido[slot.pedidoKey] = (horasFixasPorPedido[slot.pedidoKey] || 0) + 1;
            return false;
          }
          return true;
        });
        if (!slotsLinha.length) return;

        // 4. Relineariza a fila sobre os slots existentes, na ordem de prioridade —
        //    isso já implementa tanto "puxar pra frente" (OP adiantada libera slot,
        //    próxima da fila ocupa) quanto "empurrar" (OP atrasada consome mais slots,
        //    empurrando as seguintes) como resultado natural do mesmo recálculo.
        var updates = {};
        var logEntries = [];
        var ponteiro = 0;
        var semCapacidade = [];

        filaLinha.forEach(function(item) {
          var p = item.p;
          var falta = Math.max((p.qtdTotal || 0) - (p.produzido || 0), 0);
          if (falta <= 0) return;

          var ritmoDemonstradoVal = ritmoReal(p);
          var ritmo = ritmoDemonstradoVal || p.mediaPorHora || 0;
          var horasNecessarias = ritmo > 0 ? Math.ceil(falta / ritmo) : 1;
          // Já tem horas fixas (OP vinculada) cobrindo parte dessa falta --
          // não reclama de novo no pool reajustável.
          horasNecessarias = Math.max(horasNecessarias - (horasFixasPorPedido[item.key] || 0), 0);
          if (horasNecessarias <= 0) return;

          // Corrige pedidos/{key}.mediaPorHora pro ritmo demonstrado (janela
          // de sessões limpas) sempre que houver amostra suficiente -- é o
          // único ponto do app que agora sobrescreve esse campo com o motor
          // novo; form.html continua gravando o ritmo cru de cada fechamento
          // (dado honesto, não mexe nisso), e este passo (que já roda a cada
          // apontamento fechado, via window.autoAjustarPlanejamento) refina
          // pro valor que efetivamente deve guiar o planejamento.
          if (ritmoDemonstradoVal > 0 && ritmoDemonstradoVal !== p.mediaPorHora) {
            updates['pedidos/' + item.key + '/mediaPorHora'] = ritmoDemonstradoVal;
          }

          // OP atrasada (ritmo): ritmo real pior que o planejado a ponto de
          // faltar mais horas do que faltariam no ritmo planejado, além do
          // limiar configurado em admin.html (config.opAtrasoHoras).
          // Achado da 2a rodada de auditoria (PLANO_PLANEJAMENTO_PCP.md,
          // Fase 4): antes empurrava um evento ÚNICO pra alertas_pendentes/,
          // que checkOpsAtrasadas (functions/index.js) consumia e descartava
          // -- se ninguém apontasse de novo (o cenário que mais importa: o
          // gargalo real costuma ser apontamento, não produção em si), nunca
          // gerava outro evento e o alerta nunca repetia. Agora grava um
          // estado AO VIVO em pedidos/{key}.desvioAtraso, recalculado a cada
          // replanejamento (limpo quando o desvio se resolve) -- o cron de
          // 2min do servidor reavalia esse estado direto, com tolerância de
          // 5min + repique a cada 10min enquanto persistir (seção 3 do plano).
          if (p.mediaPorHora > 0 && ritmo > 0 && ritmo < p.mediaPorHora) {
            var horasNoRitmoPlanejado = Math.ceil(falta / p.mediaPorHora);
            var desvioHoras = horasNecessarias - horasNoRitmoPlanejado;
            if (desvioHoras >= opAtrasoHoras) {
              updates['pedidos/' + item.key + '/desvioAtraso'] = {
                linha: linha,
                ritmoReal: Math.round(ritmo),
                ritmoPlanejado: Math.round(p.mediaPorHora),
                desvioHoras: desvioHoras,
                // Preserva o momento da PRIMEIRA detecção -- sem isso, cada
                // replanejamento (roda a cada apontamento fechado) reseta o
                // relógio e a tolerância de 5min do servidor nunca completa.
                detectadoEm: (p.desvioAtraso && p.desvioAtraso.detectadoEm) || new Date().toISOString()
              };
            } else if (p.desvioAtraso) {
              updates['pedidos/' + item.key + '/desvioAtraso'] = null;
            }
          } else if (p.desvioAtraso) {
            updates['pedidos/' + item.key + '/desvioAtraso'] = null;
          }

          for (var i = 0; i < horasNecessarias; i++) {
            if (ponteiro >= slotsLinha.length) {
              if (semCapacidade.indexOf(p.id || item.key) === -1) semCapacidade.push(p.id || item.key);
              break;
            }
            var slot = slotsLinha[ponteiro];
            if (slot.pedidoKey !== item.key) {
              var path = 'programacao/' + slot.date + '/' + slot.hourKey + '/' + slot.envKey;
              updates[path] = { pedidoKey: item.key, produto: p.produto || '', sku: p.sku || '', mediaPorHora: ritmo || p.mediaPorHora || 0 };
              logEntries.push({
                timestamp: new Date().toISOString(),
                linha: linha,
                data: slot.date,
                hora: slot.hourKey.replace('_', ':'),
                de: slot.pedidoKey ? (todosPedidos[slot.pedidoKey] ? todosPedidos[slot.pedidoKey].id : slot.pedidoKey) : null,
                para: p.id || item.key,
                motivo: 'reajuste automático de ritmo'
              });
            }
            ponteiro++;
          }
        });

        // Slots sobrando no fim da grade (ninguém mais precisa deles) ficam livres
        for (var j = ponteiro; j < slotsLinha.length; j++) {
          if (slotsLinha[j].pedidoKey) {
            var freePath = 'programacao/' + slotsLinha[j].date + '/' + slotsLinha[j].hourKey + '/' + slotsLinha[j].envKey;
            updates[freePath] = null;
          }
        }

        if (Object.keys(updates).length > 0) {
          db.ref().update(updates).then(function() {
            var logRef = db.ref('ajustes_planejamento/' + todayStr);
            logEntries.forEach(function(entry) { logRef.push(entry); });
            if (semCapacidade.length) {
              logRef.push({
                timestamp: new Date().toISOString(),
                linha: linha,
                motivo: 'Capacidade esgotada: OP(s) ' + semCapacidade.join(', ') + ' não têm slot futuro suficiente na grade atual. Amplie a programação manualmente.'
              });
            }
          });
        }
      });
    });
  });
};