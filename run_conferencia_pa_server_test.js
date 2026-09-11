const {
  analisarTripla,
  contagensOrdenadas,
  prepararFinalizacao,
} = require('./functions/conferencia_pa');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function expectError(fn, trecho) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err || !String(err.message).includes(trecho)) {
    throw new Error('Esperava erro contendo "' + trecho + '", recebeu: ' + (err && err.message));
  }
}

function palete(numero, qtd, enderecoKey) {
  return {
    numero,
    caixasFechadas: Math.floor(qtd / 48),
    unidadesPorCaixa: 48,
    unidadesCaixaParcial: qtd % 48,
    qtdUnidades: qtd,
    enderecoKey,
  };
}

const op = {
  status: 'Concluído', sku: 'PA-001', lote: '26247/06',
  produto: 'Produto teste', produzidoLinha: 1000,
};
const enderecos = { A1:{ codigo:'GAL-A1', ativo:true }, A2:{ codigo:'GAL-A2', ativo:true }, X:{ codigo:'X', ativo:false } };
const agora = '2026-09-10T18:00:00.000Z';
const base = { opKey:'26247-06', op, enderecos, lotesItem:{}, autor:'Logística Teste', agora };

const exata = {
  qtdApontada:1000,
  contagens:{ c1:{ total:1000, contadoEm:'2026-09-10T17:00:00.000Z', paletes:{ p1:palete(1,500,'A1'), p2:palete(2,500,'A2') } } },
};
const planoExato = prepararFinalizacao({ ...base, conf:exata, conciliacao:null });
assert(planoExato.total === 1000 && planoExato.diferenca === 0, 'Finalização exata calculada errado');
assert(planoExato.updates['conferencias_pa/26247-06/status'] === 'CONFERIDO', 'Status exato não ficou CONFERIDO');
const lotes = Object.keys(planoExato.updates).filter(k => k.startsWith('estoque_lotes/'));
assert(lotes.length === 2, 'Não criou exatamente dois paletes');
assert(lotes.every(k => planoExato.updates[k].status === 'QUARENTENA'), 'PA não entrou em quarentena');
assert(new Set(lotes.map(k => planoExato.updates[k].identificadorPalete)).size === 2, 'Identificador físico de palete duplicado');

const divergente = {
  qtdApontada:1000,
  alarmeAbertoEm:'2026-09-10T17:00:00.000Z',
  contagens:{
    c1:{total:990, contadoEm:'2026-09-10T17:00:00.000Z', paletes:{p1:palete(1,990,'A1')}},
    c2:{total:990, contadoEm:'2026-09-10T17:10:00.000Z', paletes:{p1:palete(1,990,'A1')}},
    c3:{total:1000, contadoEm:'2026-09-10T17:20:00.000Z', paletes:{p1:palete(1,1000,'A1')}},
  },
};
expectError(() => prepararFinalizacao({ ...base, conf:divergente, conciliacao:null }), 'causa e explicação');
const conciliacao = { motivo:'PERDA_OU_AVARIA', observacao:'Dez unidades avariadas confirmadas nas recontagens.' };
const planoDiv = prepararFinalizacao({ ...base, conf:divergente, conciliacao });
assert(planoDiv.diferenca === -10 && planoDiv.rncNumero === 'RNC-PA-26247-06', 'Divergência/RNC incorreta');
assert(planoDiv.updates['nao_conformidades/RNC-PA-26247-06'].qtdEnvolvida === 10, 'RNC não preservou quantidade envolvida');
assert(planoDiv.updates['conferencias_pa/26247-06/status'] === 'CONFERIDO_COM_DIVERGENCIA', 'Conciliação não preservou divergência');

expectError(() => prepararFinalizacao({ ...base, op:{...op, status:'Aguardando Confirmação'}, conf:exata }), 'definitivamente concluída');
expectError(() => prepararFinalizacao({ ...base, op:{...op, produzidoLinha:1001}, conf:exata }), 'quantidade da OP mudou');
const enderecoInativo = JSON.parse(JSON.stringify(exata));
enderecoInativo.contagens.c1.paletes.p1.enderecoKey = 'X';
expectError(() => prepararFinalizacao({ ...base, conf:enderecoInativo }), 'inativo');
expectError(() => prepararFinalizacao({ ...base, conf:exata, lotesItem:{ legado:{opKey:'26247-06', status:'QUARENTENA'} } }), 'evitar duplicidade');

const retry = prepararFinalizacao({
  ...base,
  conf:exata,
  lotesItem:Object.fromEntries(lotes.map(k => {
    const key = k.split('/').pop();
    return [key, planoExato.updates[k]];
  })),
});
assert(JSON.stringify(Object.keys(retry.updates).sort()) === JSON.stringify(Object.keys(planoExato.updates).sort()), 'Retry mudou os caminhos determinísticos');

const empate = { contagens:{ b:{total:999,contadoEm:agora}, a:{total:1000,contadoEm:agora}, c:{total:1000,contadoEm:'2026-09-10T18:01:00.000Z'} } };
const ordenadas = contagensOrdenadas(empate);
assert(ordenadas[0].key === 'a' && ordenadas[1].key === 'b', 'Timestamp empatado não teve desempate determinístico');
assert(analisarTripla(1000, ordenadas).status === 'PRONTO_CONCILIADO', 'Consenso do servidor divergiu da tela');

console.log('OK servidor PA: OP final; endereços ativos; legado bloqueado; RNC automática; paths idempotentes; quarentena preservada.');
