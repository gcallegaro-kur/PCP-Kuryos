'use strict';
/* Migra um caso do formato antigo (`retrabalhos/{id}`) para uma OP de
   retrabalho, conforme a correção de rumo do usuário em 22/09: retrabalho
   é uma OP, não um registro à parte.

   Caso desta execução: RT-26216-04-20260921 (PERFUME TAWUS 30ML, lote
   inteiro, sedimentação do corante), que está ocupando a Linha 2 e trava a
   alocação de qualquer outra OP lá.

   O que preserva: setup (21/09 15:42→16:00), início do envase (16:00) e a
   pausa de fim de turno (17:09), a linha ocupada e o motivo. O que NÃO
   inventa: a quantidade do período, que nunca foi informada -- na OP ela é
   simplesmente "ainda não apontado" (produzidoLinha 0, linha aberta e
   pausada), que é o estado normal de uma OP no meio do turno, e o operador
   aponta quando souber. O registro antigo fica no banco marcado como
   migrado; nada é apagado.

   Execute da raiz do projeto. Sem --apply, só faz backup e ensaia. */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const {isDeepStrictEqual} = require('node:util');

const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));
const RetrabalhoOp = require(path.join(root, 'public/shared/retrabalho-op.js'));

const ID = process.argv.find((a) => a.startsWith('--id='))?.slice(5) || 'RT-26216-04-20260921';
const APLICAR = process.argv.includes('--apply');

const key = (v) => String(v || '').trim().replace(/[.\/[\]#$]/g, '-').replace(/\s+/g, '_').slice(0, 60);

/* Função PURA sobre a base inteira, no mesmo estilo de corrigirCaso26216:
   dá para ensaiar num clone antes de tocar em produção. Idempotente -- se
   o caso já foi migrado, devolve o que já existe sem mexer em nada. */
function migrar(base, id, agora) {
  const rt = (base.retrabalhos || {})[id];
  if (!rt) throw new Error('Retrabalho ' + id + ' não encontrado.');
  if (rt.migradoParaOp) return {lote: rt.migradoParaOp, repetida: true};

  const original = (base.ops || {})[rt.opKey] || {};
  if (!original.lote) throw new Error('OP original ' + rt.opKey + ' não encontrada.');

  const lote = RetrabalhoOp.proximoNumero(rt.loteOriginal, base.ops || {});
  const loteKey = key(lote);
  if ((base.ops || {})[loteKey]) throw new Error('A OP ' + lote + ' já existe.');

  const op = RetrabalhoOp.montar({
    opOriginal: original, opOriginalKey: rt.opKey, lote: lote,
    motivo: rt.motivo, escopo: rt.escopo,
    qtdPlanejada: rt.quantidadeOriginalRegistrada,
    destino: {tipo: 'linha', nome: rt.linha},
    autor: rt.criadoPor || 'Migração do registro de retrabalho',
    agora: rt.criadoEm || agora,
    observacao: 'Migrado de ' + id + '. Período de 21/09 16:00→17:09 executado sem quantidade informada; ' +
      'será apontado quando conferido.',
  });

  // Estado real da execução no momento da migração: a linha estava aberta
  // desde o início do envase e parada desde as 17:09.
  op.setupInicio = rt.setupInicio || null;
  op.setupFim = rt.setupFim || null;
  op.abertaDesde = rt.envaseInicio || rt.setupInicio || agora;
  op.abertaLinha = rt.linha;
  op.dataInicioReal = rt.setupInicio || rt.envaseInicio || null;
  op.status = 'Em Produção';

  (base.ops || (base.ops = {}))[loteKey] = op;

  // A linha deixa de estar "ocupada por retrabalho" (o que bloqueava
  // alocação e rearranjo) e passa a estar ocupada pela OP, pausada.
  const lk = key(rt.linha);
  const estado = (base.estado_linhas || (base.estado_linhas = {}))[lk] || {};
  base.estado_linhas[lk] = {
    status: 'parada',
    inicioParada: rt.inicioParada || estado.inicioParada || agora,
    motivoParada: estado.motivoParada || 'Fim de turno',
    lote: op.lote, produto: op.produto,
    opAtual: {lote: op.lote},
  };
  if (base.retrabalhos_linhas) delete base.retrabalhos_linhas[rt.linha];

  // O caso antigo fica como histórico, apontando para a OP que o sucedeu.
  rt.migradoParaOp = op.lote;
  rt.migradoEm = agora;
  rt.status = 'migrado';

  return {lote: op.lote, loteKey, repetida: false};
}

if (require.main === module) {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
    databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
  });
  const alvo = (b) => ({rt: (b.retrabalhos || {})[ID], linha: (b.estado_linhas || {})[key(((b.retrabalhos || {})[ID] || {}).linha)]});

  (async () => {
    const db = admin.database();
    const antes = (await db.ref().get()).val();
    const agora = new Date().toISOString();
    const backup = path.join(root, 'backups', 'migracao-retrabalho-' + ID + '-' + Date.now() + '.json');
    fs.writeFileSync(backup, JSON.stringify(antes));

    const ensaio = structuredClone(antes);
    const plano = migrar(ensaio, ID, agora);
    console.log(JSON.stringify({
      backup, id: ID, novaOp: plano.lote, repetida: plano.repetida,
      linhaLiberada: ensaio.retrabalhos_linhas,
      modo: APLICAR ? 'aplicar' : 'ensaio',
    }, null, 1));
    if (!APLICAR || plano.repetida) { await admin.app().delete(); return; }

    let falha = null, feito = null;
    const res = await db.ref().transaction((base) => {
      falha = null; feito = null;
      if (!base) return base;
      try {
        if (!isDeepStrictEqual(alvo(base), alvo(antes))) {
          throw new Error('O caso ou a linha mudaram desde o backup; migração abortada.');
        }
        feito = migrar(base, ID, agora);
        return base;
      } catch (e) { falha = e; return; }
    }, undefined, false);
    if (falha) throw falha;
    if (!res.committed || !feito) throw new Error('Migração não confirmada.');

    const depois = (await db.ref().get()).val();
    const nova = depois.ops[feito.loteKey];
    assert.equal(nova.tipoOrdem, 'RETRABALHO');
    assert.equal(nova.retrabalhoDe, antes.retrabalhos[ID].loteOriginal);
    assert.equal(nova.skuPedidoKey, '', 'não pode creditar pedido');
    assert.deepEqual(nova.materiaisConsumo, {}, 'não pode baixar BOM');
    assert.equal(nova.abertaLinha, antes.retrabalhos[ID].linha);
    assert.equal(depois.estado_linhas[key(nova.abertaLinha)].retrabalhoId, undefined,
      'a linha não pode continuar bloqueada por retrabalho');
    assert.equal((depois.retrabalhos_linhas || {})[nova.abertaLinha], undefined);
    assert.equal(depois.retrabalhos[ID].migradoParaOp, nova.lote);
    // A OP original não pode ter sido tocada.
    assert.deepEqual(depois.ops[antes.retrabalhos[ID].opKey], antes.ops[antes.retrabalhos[ID].opKey]);
    console.log(JSON.stringify({ok: true, novaOp: nova.lote, linha: nova.abertaLinha, backup}, null, 1));
    await admin.app().delete();
  })().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = {migrar};
