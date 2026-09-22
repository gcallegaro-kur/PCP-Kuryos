/* Migração do formato antigo (`retrabalhos/{id}`) para OP de retrabalho.

   O caso real é o RT-26216-04-20260921, que está ocupando a Linha 2 em
   produção e impede alocar qualquer outra OP lá. O que este teste protege é
   o que não pode dar errado numa migração de dado vivo:

   - não inventar a quantidade que nunca foi informada;
   - não tocar na OP original (867 unidades já contadas e vendidas);
   - liberar o bloqueio da linha, senão o problema continua;
   - rodar duas vezes não pode criar dois retrabalhos. */
const assert = require('node:assert/strict');
const {migrar} = require('./scripts/migrar-retrabalho-para-op.js');

const ID = 'RT-26216-04-20260921';
const AGORA = '2026-09-22T20:00:00.000Z';

function base() {
  return {
    ops: {
      '26216-04': {lote: '26216/04', sku: 'PRF-TAWUS-30', produto: 'PERFUME TAWUS 30ML',
        cliente: 'DAPOP', status: 'Concluído', qtdPlanejada: 900, produzidoLinha: 867,
        produzido: 867, skuPedidoKey: '0017__PRF', validade: '2028-08-01',
        materiaisConsumo: {a: {mpCodigo: 'EP-01', quantidade: 900, origem: 'bom'}}},
    },
    estado_linhas: {Linha_2: {status: 'parada', inicioParada: '2026-09-21T20:09:00.000Z',
      motivoParada: 'Fim de turno', lote: '26216/04', produto: 'PERFUME TAWUS 30ML',
      retrabalhoId: ID, tipoOperacao: 'retrabalho'}},
    retrabalhos_linhas: {'Linha 2': ID},
    retrabalhos: {
      [ID]: {id: ID, loteOriginal: '26216/04', opKey: '26216-04', produto: 'PERFUME TAWUS 30ML',
        cliente: 'DAPOP', linha: 'Linha 2', escopo: 'Lote inteiro',
        motivo: 'Sedimentação inesperada do corante, formando precipitado.',
        quantidadeOriginalRegistrada: 867, status: 'pausado', revisao: 1,
        criadoEm: '2026-09-22T01:00:00.000Z', criadoPor: 'Correção do administrador',
        setupInicio: '2026-09-21T18:42:00.000Z', setupFim: '2026-09-21T19:00:00.000Z',
        envaseInicio: '2026-09-21T19:00:00.000Z', inicioParada: '2026-09-21T20:09:00.000Z',
        apontamentos: {'envase-20260921': {inicio: '2026-09-21T19:00:00.000Z',
          fim: '2026-09-21T20:09:00.000Z', linha: 'Linha 2', quantidadePendente: true}}},
    },
  };
}

// ── 1. Vira uma OP de retrabalho com o número {lote}-RT1 ─────────────
let b = base();
let r = migrar(b, ID, AGORA);
assert.equal(r.lote, '26216/04-RT1');
assert.equal(r.repetida, false);
const nova = b.ops['26216-04-RT1'];
assert.ok(nova, 'a OP foi criada');
assert.equal(nova.tipoOrdem, 'RETRABALHO');
assert.equal(nova.retrabalhoDe, '26216/04');
assert.equal(nova.produto, 'PERFUME TAWUS 30ML');
assert.equal(nova.cliente, 'DAPOP');
assert.equal(nova.qtdPlanejada, 867, 'lote inteiro: o que foi produzido');

// ── 2. As duas ausências ─────────────────────────────────────────────
assert.equal(nova.skuPedidoKey, '', 'não credita pedido — as 867 já foram contadas');
assert.deepEqual(nova.materiaisConsumo, {}, 'não baixa BOM de novo');

// ── 3. Preserva a execução que já aconteceu ──────────────────────────
assert.equal(nova.setupInicio, '2026-09-21T18:42:00.000Z');
assert.equal(nova.setupFim, '2026-09-21T19:00:00.000Z');
assert.equal(nova.abertaDesde, '2026-09-21T19:00:00.000Z', 'envase começou às 16:00 BRT');
assert.equal(nova.abertaLinha, 'Linha 2');
assert.equal(nova.status, 'Em Produção');
assert.match(nova.retrabalhoObs, /16:00→17:09/, 'o período trabalhado fica registrado');
assert.match(nova.retrabalhoMotivo, /Sedimentação/);

// ── 4. NÃO inventa quantidade ────────────────────────────────────────
// Era o cuidado central do registro antigo: pendente não é zero. Na OP,
// "ainda não apontado" é produzido 0 com a linha aberta — estado normal de
// uma OP no meio do turno, não um número fabricado.
assert.equal(nova.produzidoLinha, 0);
assert.equal(nova.produzido, 0);
assert.equal(nova.produzidoPosto, 0);

// ── 5. Libera o bloqueio da linha ────────────────────────────────────
// É o efeito prático: sem isso a Linha 2 continua recusando qualquer OP.
assert.equal(b.retrabalhos_linhas['Linha 2'], undefined);
assert.equal(b.estado_linhas.Linha_2.retrabalhoId, undefined);
// Mas a linha continua PARADA, com a mesma pausa aberta — a migração não
// retoma produção por conta própria.
assert.equal(b.estado_linhas.Linha_2.status, 'parada');
assert.equal(b.estado_linhas.Linha_2.inicioParada, '2026-09-21T20:09:00.000Z');
assert.equal(b.estado_linhas.Linha_2.motivoParada, 'Fim de turno');
assert.equal(b.estado_linhas.Linha_2.lote, '26216/04-RT1', 'a linha agora aponta para a OP de retrabalho');

// ── 6. A OP original fica intacta ────────────────────────────────────
assert.deepEqual(b.ops['26216-04'], base().ops['26216-04']);

// ── 7. O caso antigo vira histórico, não lixo ────────────────────────
assert.equal(b.retrabalhos[ID].migradoParaOp, '26216/04-RT1');
assert.equal(b.retrabalhos[ID].status, 'migrado');
assert.equal(b.retrabalhos[ID].migradoEm, AGORA);
assert.ok(b.retrabalhos[ID].apontamentos, 'os apontamentos antigos continuam lá');

// ── 8. Rodar de novo não duplica ─────────────────────────────────────
const depois = structuredClone(b);
r = migrar(b, ID, '2026-09-23T10:00:00.000Z');
assert.equal(r.repetida, true);
assert.equal(r.lote, '26216/04-RT1');
assert.deepEqual(b, depois, 'segunda execução não muda nada');

// ── 9. Recusa o que não dá para migrar com segurança ─────────────────
assert.throws(() => migrar(base(), 'RT-INEXISTENTE', AGORA), /não encontrado/);
const semOriginal = base();
delete semOriginal.ops['26216-04'];
assert.throws(() => migrar(semOriginal, ID, AGORA), /OP original .* não encontrada/);
// Número já ocupado não vira colisão: o contador olha QUALQUER OP com o
// padrão -RT, não só as marcadas como retrabalho, então pula para -RT2.
const jaExiste = base();
jaExiste.ops['26216-04-RT1'] = {lote: '26216/04-RT1'};
assert.equal(migrar(jaExiste, ID, AGORA).lote, '26216/04-RT2');
assert.ok(jaExiste.ops['26216-04-RT2'], 'a OP nova não sobrescreve a que já estava lá');
assert.deepEqual(jaExiste.ops['26216-04-RT1'], {lote: '26216/04-RT1'}, 'a anterior fica intacta');

// ── 10. Retrabalho EM EXECUÇÃO continua em execução ──────────────────
// Defeito real, achado em produção em 22/09: a primeira versão assumia
// sempre pausado. O caso do TAWUS estava `em_andamento`, retomado às 09:03,
// e a migração o deixou pausado com motivo "Fim de turno" -- uma parada que
// nunca aconteceu -- e com abertaDesde no envase de 21/09, inflando o tempo
// em aberto da OP.
const rodando = base();
rodando.retrabalhos[ID].status = 'em_andamento';
rodando.retrabalhos[ID].periodoInicio = '2026-09-22T12:03:08.164Z';
delete rodando.retrabalhos[ID].inicioParada;
rodando.estado_linhas.Linha_2 = {status: 'ativa', lote: '26216/04',
  produto: 'PERFUME TAWUS 30ML', retrabalhoId: ID, tipoOperacao: 'retrabalho'};
migrar(rodando, ID, AGORA);
const emExec = rodando.ops['26216-04-RT1'];
assert.equal(rodando.estado_linhas.Linha_2.status, 'ativa',
  'não pode inventar uma pausa numa linha que estava rodando');
assert.equal(rodando.estado_linhas.Linha_2.inicioParada, undefined);
assert.equal(rodando.estado_linhas.Linha_2.motivoParada, undefined,
  'nem inventar motivo de parada');
assert.equal(rodando.estado_linhas.Linha_2.retrabalhoId, undefined, 'e continua desbloqueando');
assert.equal(emExec.abertaDesde, '2026-09-22T12:03:08.164Z',
  'a base do ritmo é a retomada real, não o envase de ontem');
assert.equal(emExec.setupInicio, '2026-09-21T18:42:00.000Z', 'o setup original continua preservado');

console.log('run_retrabalho_migracao_test: OK');
