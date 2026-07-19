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
  'admin.html': ['admin'],
  'importar.html': ['admin']
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
        <a href="ops.html" class="${activePage === 'ops.html' ? 'active' : ''}">⚙️ Controle de OPs</a>
        ${isPcpAdmin ? `<a href="pedidos.html" class="${activePage === 'pedidos.html' ? 'active' : ''}">📦 Pedidos &amp; OPs</a>` : ''}
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

function _kuryosTodayStr() {
  var d = new Date();
  var local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
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

function _kuryosIsConcluidoLike(p) {
  if (!p) return true;
  if (p.statusManual === 'encerrado') return true;
  var st = String(p.status || '').toLowerCase().trim();
  return st.indexOf('conclu') === 0;
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
        pedidoKey: slot && slot.pedidoKey ? slot.pedidoKey : null
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

    Promise.all([
      db.ref('programacao').once('value'),
      db.ref('pedidos').once('value')
    ]).then(function(results) {
      var programacao = results[0].val() || {};
      var todosPedidos = results[1].val() || {};
      var todayStr = _kuryosTodayStr();
      var nowHour = new Date().getHours();

      // 1. Descobre em qual linha essa OP tem slot futuro agendado
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
            if (slot && slot.pedidoKey === pedidoKey) {
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

      db.ref('registros').once('value').then(function(regSnap) {
        var registros = regSnap.val() || {};
        var corte = now - 3 * 60 * 60 * 1000; // ritmo real = últimas 3h

        function ritmoReal(p) {
          var totalQtd = 0;
          var horasComRegistro = {};
          var targetId = String(p.id || '').trim().toUpperCase();
          var targetProd = String(p.produto || '').trim().toUpperCase();
          Object.keys(registros).forEach(function(date) {
            var dayRegs = registros[date] || {};
            Object.keys(dayRegs).forEach(function(regId) {
              var r = dayRegs[regId];
              if (!r || !r.pedidoId || !r.produto) return;
              if (String(r.pedidoId).trim().toUpperCase() !== targetId) return;
              if (String(r.produto).trim().toUpperCase() !== targetProd) return;
              var ts = r.timestamp ? new Date(r.timestamp).getTime() : 0;
              if (ts < corte) return;
              totalQtd += parseFloat(r.quantidade) || 0;
              horasComRegistro[date + '_' + r.hora] = true;
            });
          });
          var nHoras = Object.keys(horasComRegistro).length;
          return nHoras > 0 ? (totalQtd / nHoras) : 0;
        }

        // 3. Slots futuros já existentes na grade pra essa linha
        var slotsLinha = _kuryosFutureSlotsForLinha(programacao, linha, todayStr, nowHour);
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

          var ritmo = ritmoReal(p) || p.mediaPorHora || 0;
          var horasNecessarias = ritmo > 0 ? Math.ceil(falta / ritmo) : 1;

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