'use strict';
/* Responsável comercial por cliente (20/10/2026): lista própria do comercial,
   vínculo por ID no cliente, atribuição em lote por caminho plano, órfão que
   não desaparece e cobertura da carteira. */
const assert = require('node:assert/strict');
const path = require('node:path');
const RC = require(path.join(__dirname, 'public', 'shared', 'responsavel-comercial.js'));

// ── Normalizar: é o que impede carteira dividida por grafia ─────────────────
assert.equal(RC.normalizar('G. Callegaro'), 'G. CALLEGARO');
assert.equal(RC.normalizar('  joão   silva '), 'JOAO SILVA');
assert.equal(RC.normalizar('José Antônio'), RC.normalizar('jose antonio'));
assert.equal(RC.normalizar(null), '');

// ── Lista ───────────────────────────────────────────────────────────────────
const cfg = {responsaveis: {
  rc_b: {nome: 'Bruno Lima', email: 'bruno@kuryos.com.br', uidLogin: 'uid_bruno', ativo: true},
  rc_a: {nome: 'Ana Souza', email: '', uidLogin: null, ativo: true},
  rc_z: {nome: 'Zeca (desligado)', ativo: false},
  lixo: 'texto solto'
}};
const ls = RC.lista(cfg);
assert.deepEqual(ls.map((r) => r.nome), ['Ana Souza', 'Bruno Lima', 'Zeca (desligado)'], 'ordem alfabética pt-BR');
assert.equal(ls.length, 3, 'valor escalar no nó é ignorado, não quebra');
assert.deepEqual(RC.ativos(cfg).map((r) => r.id), ['rc_a', 'rc_b']);
assert.equal(RC.lista(cfg.responsaveis).length, 3, 'aceita o nó cru ou o comercial_config inteiro');
assert.deepEqual(RC.lista({}), []);
assert.deepEqual(RC.lista(null), []);
assert.equal(RC.porId(cfg, 'rc_a').nome, 'Ana Souza');
assert.equal(RC.porId(cfg, 'nao_existe'), null);
assert.equal(RC.porId(cfg, ''), null);
assert.equal(RC.lista(cfg).find((r) => r.id === 'rc_a').ativo, true, 'ativo ausente conta como ativo');

// ── porUid: o filtro "minha carteira" ───────────────────────────────────────
assert.equal(RC.porUid(cfg, 'uid_bruno').nome, 'Bruno Lima');
// Representante sem login não tem carteira própria na tela -- esperado, não falha.
assert.equal(RC.porUid(cfg, 'uid_ana'), null);
assert.equal(RC.porUid(cfg, ''), null);
assert.equal(RC.porUid(cfg, null), null);

// ── salvar: as travas que protegem o propósito do campo ─────────────────────
const ok = RC.salvar([
  {id: 'rc_a', nome: ' Ana Souza ', email: 'ana@kuryos.com.br', uidLogin: '', ativo: true},
  {id: 'rc_b', nome: 'Bruno Lima', uidLogin: 'uid_bruno', ativo: false}
]);
assert.deepEqual(ok, {
  rc_a: {nome: 'Ana Souza', email: 'ana@kuryos.com.br', uidLogin: null, ativo: true, criadoEm: null},
  rc_b: {nome: 'Bruno Lima', email: '', uidLogin: 'uid_bruno', ativo: false, criadoEm: null}
}, 'nome aparado, uid vazio vira null');
assert.deepEqual(RC.salvar([]), {});
const falha = (ls2, re) => assert.throws(() => RC.salvar(ls2), re);
falha([{id: 'rc_a', nome: ''}], /precisa de nome/);
falha([{id: 'rc a', nome: 'Ana'}], /Identificador de responsável inválido/);
falha([{id: 'a/b', nome: 'Ana'}], /inválido/);
falha([{id: '', nome: 'Ana'}], /inválido/);
falha([{id: 'rc_a', nome: 'Ana'}, {id: 'rc_a', nome: 'Outra'}], /duplicado/);
// A trava central: dois nomes que só diferem em acento/caixa são a mesma pessoa.
falha([{id: 'rc_a', nome: 'José Antônio'}, {id: 'rc_b', nome: 'jose antonio'}], /mesmo nome/);
falha([{id: 'rc_a', nome: 'Ana', email: 'ana@'}], /Confira o e-mail de Ana/);
falha([{id: 'rc_a', nome: 'Ana', uidLogin: 'u1'}, {id: 'rc_b', nome: 'Bruno', uidLogin: 'u1'}], /mesmo login/);

// ── doCliente: resolve o vínculo e nunca esconde dado vencido ───────────────
const semDono = RC.doCliente({nome: 'ACME'}, cfg);
assert.deepEqual(semDono, {id: null, nome: '', atribuido: false, orfao: false, inativo: false, em: null, por: null});
const comDono = RC.doCliente({responsavelComercialId: 'rc_a', responsavelComercialNome: 'Ana Souza',
  responsavelComercialEm: '2026-10-20T12:00:00.000Z', responsavelComercialPor: 'Gustavo'}, cfg);
assert.equal(comDono.nome, 'Ana Souza');
assert.equal(comDono.atribuido, true);
assert.equal(comDono.orfao, false);
assert.equal(comDono.inativo, false);
assert.equal(comDono.por, 'Gustavo');
// Nome mudou na lista: a lista vence o espelho (o espelho é só para leitor antigo).
assert.equal(RC.doCliente({responsavelComercialId: 'rc_a', responsavelComercialNome: 'Ana S.'}, cfg).nome, 'Ana Souza');
// Desligado continua aparecendo, marcado -- a conta não perde o dono em silêncio.
const inativo = RC.doCliente({responsavelComercialId: 'rc_z', responsavelComercialNome: 'Zeca'}, cfg);
assert.equal(inativo.inativo, true);
assert.equal(inativo.orfao, false);
assert.equal(inativo.nome, 'Zeca (desligado)');
// Removido da lista: órfão, e cai no nome espelhado em vez de virar vazio.
const orfao = RC.doCliente({responsavelComercialId: 'rc_sumiu', responsavelComercialNome: 'Quem Saiu'}, cfg);
assert.equal(orfao.orfao, true);
assert.equal(orfao.nome, 'Quem Saiu');
assert.equal(orfao.atribuido, true);
assert.equal(RC.doCliente(null, cfg).atribuido, false);

// ── atribuir: SEMPRE caminho plano (objeto aninhado apaga campos no RTDB) ───
const u = RC.atribuir('ACME', {id: 'rc_a', nome: 'Ana Souza'}, {em: '2026-10-20T12:00:00.000Z', por: 'Gustavo'});
assert.deepEqual(u, {
  'clientes/ACME/responsavelComercialId': 'rc_a',
  'clientes/ACME/responsavelComercialNome': 'Ana Souza',
  'clientes/ACME/responsavelComercialEm': '2026-10-20T12:00:00.000Z',
  'clientes/ACME/responsavelComercialPor': 'Gustavo'
});
Object.keys(u).forEach((k) => assert.equal(typeof u[k] !== 'object' || u[k] === null, true, 'nenhum valor aninhado: ' + k));
// Desatribuir limpa os quatro campos, não só o id (senão o espelho mentiria).
assert.deepEqual(RC.atribuir('ACME', null), {
  'clientes/ACME/responsavelComercialId': null,
  'clientes/ACME/responsavelComercialNome': null,
  'clientes/ACME/responsavelComercialEm': null,
  'clientes/ACME/responsavelComercialPor': null
});
assert.equal(RC.atribuir('ACME', {id: 'rc_a', nome: 'Ana'}, {})['clientes/ACME/responsavelComercialPor'], null, 'sem autor grava null, não undefined');
// Chave que o RTDB trataria como caminho aninhado é recusada.
['', 'a/b', 'a.b', 'a#b', 'a$b', 'a[b', 'a]b', null].forEach((k) => {
  assert.throws(() => RC.atribuir(k, {id: 'rc_a', nome: 'Ana'}), /Chave de cliente inválida/, 'recusa chave ' + JSON.stringify(k));
});
assert.throws(() => RC.atribuir('ACME', {id: 'r a', nome: 'Ana'}), /Identificador de responsável inválido/);
assert.throws(() => RC.atribuir('ACME', {id: 'rc_a', nome: ''}), /sem nome/);

// ── atribuirVarios: um update só para a carteira inteira ────────────────────
const lote = RC.atribuirVarios(['ACME', 'BETA'], {id: 'rc_b', nome: 'Bruno Lima'}, {em: 'X', por: 'G'});
assert.equal(Object.keys(lote).length, 8, '4 campos x 2 clientes em um update');
assert.equal(lote['clientes/BETA/responsavelComercialId'], 'rc_b');
assert.deepEqual(RC.atribuirVarios([], {id: 'rc_b', nome: 'B'}), {});
assert.deepEqual(RC.atribuirVarios(null, {id: 'rc_b', nome: 'B'}), {});

// ── clientesDe: quem fica órfão se eu desligar este responsável ─────────────
const clientes = {
  ACME: {nome: 'ACME', ativo: true, responsavelComercialId: 'rc_a', responsavelComercialNome: 'Ana Souza'},
  BETA: {nome: 'BETA', ativo: true, responsavelComercialId: 'rc_a', responsavelComercialNome: 'Ana Souza'},
  GAMA: {nome: 'GAMA', ativo: true, responsavelComercialId: 'rc_b', responsavelComercialNome: 'Bruno Lima'},
  DELTA: {nome: 'DELTA', ativo: true},
  EPSILON: {nome: 'EPSILON', ativo: true, responsavelComercialId: 'rc_sumiu', responsavelComercialNome: 'Quem Saiu'},
  ZETA: {nome: 'ZETA', ativo: false, responsavelComercialId: 'rc_a', responsavelComercialNome: 'Ana Souza'},
  RUIM: 'escalar'
};
assert.deepEqual(RC.clientesDe(clientes, 'rc_a'), ['ACME', 'BETA', 'ZETA'], 'inclui inativo: desligar afeta o cadastro todo');
assert.deepEqual(RC.clientesDe(clientes, 'rc_nada'), []);
assert.deepEqual(RC.clientesDe(clientes, ''), []);
assert.deepEqual(RC.clientesDe(null, 'rc_a'), []);

// ── cobertura: a lista de trabalho para sair do zero ────────────────────────
const cob = RC.cobertura(clientes, cfg);
assert.equal(cob.totalClientes, 5, 'só clientes ativos por padrão (ZETA fora, escalar fora)');
assert.equal(cob.atribuidos, 3, 'ACME, BETA, GAMA — órfão não conta como atribuído');
assert.deepEqual(cob.semResponsavel, ['DELTA']);
assert.deepEqual(cob.orfaos, [{clienteKey: 'EPSILON', id: 'rc_sumiu', nome: 'Quem Saiu'}]);
assert.equal(cob.pctCobertura, 3 / 5);
assert.deepEqual(cob.carteiras.map((c) => [c.nome, c.total]),
  [['Ana Souza', 2], ['Bruno Lima', 1], ['Zeca (desligado)', 0]], 'maior carteira primeiro');
assert.deepEqual(cob.carteiras[0].clientes, ['ACME', 'BETA']);
assert.equal(RC.cobertura(clientes, cfg, {somenteClientesAtivos: false}).totalClientes, 6, 'inclui inativo quando pedido');
const vazio = RC.cobertura({}, {});
assert.equal(vazio.totalClientes, 0);
assert.equal(vazio.pctCobertura, 0, 'base vazia não divide por zero');
assert.deepEqual(RC.cobertura(null, null).semResponsavel, []);

// ── Ligação com o motor da Gestão Comercial ─────────────────────────────────
/* `listaClientes` em gestao-comercial.js monta um objeto NOVO: campo posto em
   `cli()` e não repassado ali desaparece sem erro. Foi o defeito real de
   20/10 -- a coluna mostrava "—" para todos enquanto este motor acertava. */
const GC = require(path.join(__dirname, 'public', 'shared', 'gestao-comercial.js'));
const base = {
  clientes: {
    MISS: {nome: 'MISS ROSE', ativo: true, responsavelComercialId: 'rc_a', responsavelComercialNome: 'Ana Souza'},
    SEMD: {nome: 'SEM DONO', ativo: true}
  },
  comercial_config: cfg,
  produtos: {S1: {sku: 'S1', clienteKey: 'MISS'}, S2: {sku: 'S2', clienteKey: 'SEMD'}},
  pedidos_comerciais: {
    P1: {numeroFormatado: 'P1', clienteKey: 'MISS', cliente: 'MISS ROSE', dataPedido: '2026-09-01', itens: [{sku: 'S1', qtd: 10}]},
    P2: {numeroFormatado: 'P2', clienteKey: 'SEMD', cliente: 'SEM DONO', dataPedido: '2026-09-01', itens: [{sku: 'S2', qtd: 10}]}
  },
  pedidos: {
    P1__S1: {id: 'P1', parentPedidoId: 'P1', sku: 'S1', cliente: 'MISS ROSE', qtdTotal: 10, produzido: 0},
    P2__S2: {id: 'P2', parentPedidoId: 'P2', sku: 'S2', cliente: 'SEM DONO', qtdTotal: 10, produzido: 0}
  }
};
const an = GC.calcular(base, '2026-10-20');
const doMotor = (k) => an.clientes.find((c) => c.clienteKey === k);
assert.ok(doMotor('MISS'), 'cliente com pedido entra na análise');
assert.equal(doMotor('MISS').responsavel.nome, 'Ana Souza', 'o responsável CHEGA na lista que a tela consome');
assert.equal(doMotor('MISS').responsavel.atribuido, true);
assert.equal(doMotor('SEMD').responsavel.atribuido, false);
// Cliente sem pedido NÃO entra na análise: é por isso que a atribuição mora
// num modal que lê `clientes` direto, e não na tabela da aba Clientes.
const semPedido = GC.calcular({clientes: {SO: {nome: 'SÓ CADASTRO', ativo: true}}, comercial_config: cfg}, '2026-10-20');
assert.equal(semPedido.clientes.length, 0, 'cliente sem movimento fica fora da análise');
// Sem o nó de configuração o motor não quebra -- base antiga continua abrindo.
assert.equal(GC.calcular({clientes: base.clientes, pedidos_comerciais: base.pedidos_comerciais,
  pedidos: base.pedidos, produtos: base.produtos}, '2026-10-20').clientes.find((c) => c.clienteKey === 'MISS').responsavel.orfao, true,
  'sem comercial_config o vínculo fica órfão, com o nome espelhado');

// ── novoId: chave que o RTDB aceita ─────────────────────────────────────────
for (let i = 0; i < 50; i++) assert.match(RC.novoId(), /^rc_[A-Za-z0-9]{1,24}$/);
assert.notEqual(RC.novoId(), RC.novoId());

console.log('run_responsavel_comercial_test: OK');
