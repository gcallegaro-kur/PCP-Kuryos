// Kuryos PCP Shared Utilities

function sanitizeKey(str) {
  if (!str) return '';
  var s = String(str).trim()
    .replace(/[./[\]#$]/g, '-')
    .replace(/\s+/g, '_');
  return s.slice(0, 60);
}

function pedidoFirebaseKey(id, produto) {
  return 'OP_' + sanitizeKey(id) + '__' + sanitizeKey(produto);
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

function isConcluido(pedido) {
  if (!pedido) return false;
  var status = String(pedido.status || '').toLowerCase().trim();
  var statusManual = String(pedido.statusManual || '').toLowerCase().trim();
  return status.indexOf('conclu') === 0 || statusManual === 'encerrado';
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
