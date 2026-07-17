// --- Perfis de Acesso Permitidos por Página ---
const pageAccessRules = {
  'form.html': ['production', 'admin'],
  'planejamento.html': ['production', 'admin'],
  'dashboard.html': ['production', 'admin'],
  'dashboard_analise.html': ['production', 'admin'],
  'ops.html': ['production', 'admin'],
  'historico.html': ['production', 'admin'],
  'pedidos.html': ['admin'],
  'produtos.html': ['admin'],
  'insumos.html': ['admin'],
  'usuarios.html': ['admin'],
  'admin.html': ['admin']
};

// Extrai o nome da página atual
function getActivePageName() {
  const path = window.location.pathname;
  return path.substring(path.lastIndexOf('/') + 1) || 'index.html';
}

window.currentUser = null;

(function() {
  // Adiciona estilos globais para o menu superior (dropdowns, animações, etc.)
  const css = `
    .navbar {
      background: #0f172a;
      border-bottom: 1px solid #1e293b;
      padding: 0 24px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      position: sticky;
      top: 0;
      z-index: 9999;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
    .nav-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 800;
      font-size: 15px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #38bdf8;
      cursor: pointer;
    }
    .nav-groups {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 100%;
    }
    .nav-dropdown {
      position: relative;
      display: inline-block;
      height: 100%;
    }
    .nav-dropdown-btn {
      background: none;
      border: none;
      color: #cbd5e1;
      font-size: 13.5px;
      font-weight: 600;
      padding: 0 16px;
      height: 56px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .nav-dropdown:hover .nav-dropdown-btn {
      color: #38bdf8;
      background: #1e293b;
    }
    .nav-dropdown-content {
      display: none;
      position: absolute;
      top: 56px;
      left: 0;
      background: #1e293b;
      min-width: 200px;
      border: 1px solid #334155;
      border-radius: 0 0 8px 8px;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
      padding: 6px 0;
      z-index: 10000;
    }
    .nav-dropdown:hover .nav-dropdown-content {
      display: block;
    }
    .nav-dropdown-content a {
      display: block;
      color: #cbd5e1;
      padding: 10px 16px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.15s;
    }
    .nav-dropdown-content a:hover {
      background: #334155;
      color: #38bdf8;
    }
    .nav-dropdown-content a.active {
      color: #38bdf8;
      background: #0f172a;
      font-weight: 700;
      border-left: 3px solid #38bdf8;
    }
    .nav-user {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12.5px;
    }
    .nav-logout-btn {
      background: #dc2626;
      color: #fff;
      border: none;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s;
    }
    .nav-links {
      display: none !important;
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.innerHTML = css;
  document.head.appendChild(styleEl);

  // Inicializa a verificação de autenticação
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof firebase === 'undefined') {
      console.error('Firebase compat library não carregada. Certifique-se de importar o Firebase antes do auth_check.js.');
      return;
    }

    firebase.auth().onAuthStateChanged(user => {
      const activePage = getActivePageName();

      if (!user) {
        // Redireciona para o login caso não esteja logado
        if (activePage !== 'login.html') {
          window.location.href = 'login.html';
        }
      } else {
        const db = firebase.database();
        db.ref('usuarios/' + user.uid).once('value', snapshot => {
          const profile = snapshot.val();

          if (!profile || profile.role === 'pending') {
            // Sem perfil ou pendente de aprovação
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
              alert('Acesso Negado: Seu perfil (' + (role === 'admin' ? 'Administrador' : 'Produção') + ') não tem permissão para acessar esta página.');
              if (role === 'production') {
                window.location.href = 'form.html';
              } else {
                window.location.href = 'dashboard.html';
              }
            } else {
              // Constrói e injeta o menu superior unificado
              renderUnifiedNavbar(window.currentUser);
              
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

// Renderiza a nova barra de navegação premium unificada
function renderUnifiedNavbar(user) {
  // Remove qualquer cabeçalho legado ou barra preta antiga
  const oldHeader = document.querySelector('.header, header, #auth-status-bar, #auth-status-bar-black');
  const blackToolbar = document.querySelector('body > div[style*="background:#0f172a"], body > div[style*="background: #0f172a"]');
  const body = document.body;
  const activePage = getActivePageName();

  if (blackToolbar) {
    blackToolbar.remove();
  }

  // Se já existir a barra unificada, não renderiza de novo
  if (document.getElementById('unified-navbar')) return;

  const navbar = document.createElement('nav');
  navbar.id = 'unified-navbar';
  navbar.className = 'navbar';

  // Role label translate
  const roleLabel = user.role === 'admin' ? 'Administrador' : 'Produção';

  // Links Condicionais por Perfil
  const isPcpAdmin = user.role === 'admin';

  // Submenu Análises
  const analysesMenu = `
    <div class="nav-dropdown">
      <button class="nav-dropdown-btn">📊 Análises ▾</button>
      <div class="nav-dropdown-content">
        <a href="dashboard.html" class="${activePage === 'dashboard.html' ? 'active' : ''}">🏠 Daily Dashboard</a>
        <a href="dashboard_analise.html" class="${activePage === 'dashboard_analise.html' ? 'active' : ''}">📈 Histórico Pedidos/Vendas</a>
      </div>
    </div>
  `;

  // Submenu PCP
  const pcpMenu = `
    <div class="nav-dropdown">
      <button class="nav-dropdown-btn">🗓 PCP ▾</button>
      <div class="nav-dropdown-content">
        <a href="planejamento.html" class="${activePage === 'planejamento.html' ? 'active' : ''}">🗓 Planejamento</a>
        <a href="ops.html" class="${activePage === 'ops.html' ? 'active' : ''}">⚙️ Controle de OPs / Lotes</a>
        ${isPcpAdmin ? `<a href="pedidos.html" class="${activePage === 'pedidos.html' ? 'active' : ''}">📦 Pedidos</a>` : ''}
        ${isPcpAdmin ? `<a href="produtos.html" class="${activePage === 'produtos.html' ? 'active' : ''}">🏷 Cadastro de Produtos</a>` : ''}
        ${isPcpAdmin ? `<a href="insumos.html" class="${activePage === 'insumos.html' ? 'active' : ''}">📦 Matriz de Insumos</a>` : ''}
        ${isPcpAdmin ? `<a href="admin.html" class="${activePage === 'admin.html' ? 'active' : ''}">⚙️ Ajuste de Metas / Configurações</a>` : ''}
      </div>
    </div>
  `;

  // Submenu Produção
  const productionMenu = `
    <div class="nav-dropdown">
      <button class="nav-dropdown-btn">📝 Produção ▾</button>
      <div class="nav-dropdown-content">
        <a href="form.html" class="${activePage === 'form.html' ? 'active' : ''}">📝 Apontamento Diário</a>
        <a href="historico.html" class="${activePage === 'historico.html' ? 'active' : ''}">📜 Histórico Apontamentos</a>
      </div>
    </div>
  `;

  // Menu de Usuários (exclusivo Admin)
  const usersMenu = isPcpAdmin ? `
    <div class="nav-dropdown">
      <a href="usuarios.html" class="nav-dropdown-btn ${activePage === 'usuarios.html' ? 'active' : ''}" style="text-decoration:none; display:flex;">👥 Usuários</a>
    </div>
  ` : '';

  navbar.innerHTML = `
    <div class="nav-brand" onclick="window.location.href='dashboard.html'">
      <span>🏭</span> Kuryos PCP
    </div>
    <div class="nav-groups">
      ${analysesMenu}
      ${pcpMenu}
      ${productionMenu}
      ${usersMenu}
    </div>
    <div class="nav-user">
      <span style="color:#cbd5e1;">👤 <strong>${user.nome}</strong> (${roleLabel})</span>
      <button onclick="firebase.auth().signOut().then(() => window.location.href='login.html')" class="nav-logout-btn">
        Sair
      </button>
    </div>
  `;

  // Insere a barra no topo do body
  body.insertBefore(navbar, body.firstChild);

  // Remove cabeçalhos duplicados/antigos se existirem na página para manter o design clean
  if (oldHeader && oldHeader !== navbar) {
    oldHeader.remove();
  }
  
  // Customização para esconder títulos redundantes ou cabeçalhos antigos específicos
  const mainHeaderElement = document.querySelector('body > .header, body > header');
  if (mainHeaderElement && mainHeaderElement !== navbar) {
    mainHeaderElement.remove();
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
window.updateOpStatusAutomatically = function(pedidoId, callback) {
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
    
    // Busca apontamentos horários (registros)
    db.ref('registros').once('value', regSnap => {
      const registros = regSnap.val() || {};
      let totalProduced = 0;
      let lastTimestamp = 0;
      
      const targetId = String(p.id || '').trim().toUpperCase();
      const targetProd = String(p.produto || '').trim().toUpperCase();
      
      Object.keys(registros).forEach(date => {
        const dayRegs = registros[date] || {};
        Object.keys(dayRegs).forEach(regId => {
          const r = dayRegs[regId];
          if (r.pedidoId && r.produto) {
            const cleanRegId = String(r.pedidoId).trim().toUpperCase();
            const cleanRegProd = String(r.produto).trim().toUpperCase();
            if (cleanRegId === targetId && cleanRegProd === targetProd) {
              totalProduced += parseFloat(r.quantidade) || 0;
              const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0;
              if (ts > lastTimestamp) {
                lastTimestamp = ts;
              }
            }
          }
        });
      });
      
      // Busca se está agendada no planejamento semanal
      db.ref('programacao').once('value', progSnap => {
        const programacao = progSnap.val() || {};
        let isScheduled = false;
        
        Object.keys(programacao).forEach(date => {
          const dayData = programacao[date] || {};
          Object.keys(dayData).forEach(hour => {
            const hourData = dayData[hour] || {};
            for (let l = 1; l <= 4; l++) {
              const slot = hourData['env' + l];
              if (slot && (slot.pedidoKey === pedidoId || slot.pedidoId === pedidoId)) {
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
      });
    });
  });
};

// Executa varredura e atualização de todas as OPs ativas no banco (para consistência do sistema)
window.syncAllActiveOpsStatus = function() {
  if (typeof firebase === 'undefined') return;
  const db = firebase.database();
  
  db.ref('pedidos').once('value', snapshot => {
    const pedidos = snapshot.val() || {};
    Object.keys(pedidos).forEach(key => {
      const p = pedidos[key];
      if (p.status !== 'Concluído') {
        window.updateOpStatusAutomatically(key);
      }
    });
  });
};