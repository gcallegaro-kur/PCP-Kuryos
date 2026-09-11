const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/shared/utils.js', 'utf8');
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Função não encontrada: ' + name);
  const open = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Função incompleta: ' + name);
}

let movimento = null;
const lote = { status:'QUARENTENA', saldoLote:500, itemTipo:'produto', itemNome:'PA Teste', unidade:'un', enderecoKey:'A1', enderecoCodigo:'GAL-A1' };
const db = { ref(path) {
  if (path.startsWith('estoque_lotes/')) return {
    transaction(fn) {
      const atualizado = fn({...lote});
      return Promise.resolve({ committed:true, snapshot:{ val:() => atualizado } });
    },
  };
  if (path.startsWith('movimentos_estoque/')) return {
    push(data) { movimento = data; return Promise.resolve(); },
  };
  throw new Error('Path inesperado: ' + path);
} };

const ctx = {
  Promise, Date,
  sanitizeKey:s => s,
  rotuloStatusLote:s => s,
};
vm.createContext(ctx);
vm.runInContext(extractFunction('registrarLaudoQualidade'), ctx);

ctx.registrarLaudoQualidade(db, 'PA-001', 'pa_op_p1', { decisao:'LIBERADO_EXPEDICAO' }, 'Qualidade Teste')
  .then(result => {
    if (!result.ok) throw new Error('Laudo não concluiu');
    if (!movimento || movimento.itemTipo !== 'produto') throw new Error('Movimento de PA ainda foi classificado como material');
    console.log('OK Qualidade: movimento de liberação preserva itemTipo=produto.');
  })
  .catch(err => { console.error(err); process.exit(1); });
