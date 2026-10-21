'use strict';
/* Desativar e excluir usuário (21/10/2026).

   O que mais importa aqui são as TRAVAS: o ADM não pode se trancar fora, e o
   último admin ativo não pode sair. Se isso falhar, a recuperação só existe
   pelo Console do Firebase. O resto é caminho plano e a lápide que impede a
   conta de login de virar fantasma. */
const assert = require('node:assert/strict');
const path = require('node:path');
const GU = require(path.join(__dirname, 'public', 'shared', 'gestao-usuarios.js'));

// Base parecida com a real: 2 admins, gente comum, pendente e inativo.
const base = () => ({
  adm1: {nome: 'Gustavo Callegaro', email: 'gustavo@kuryos.com.br', role: 'admin', created_at: '2026-07-08T10:00:00.000Z'},
  adm2: {nome: 'Lucca De Camillis', email: 'lucca@kuryos.com.br', role: 'admin', created_at: '2026-07-07T10:00:00.000Z'},
  pcp1: {nome: 'Diego Costa', email: 'diego.costa@kuryos.com.br', role: 'pcp', created_at: '2026-07-08T10:00:00.000Z'},
  pen1: {nome: 'Bruna Araujo', email: 'bruna.araujo@kuryos.com.br', role: 'pending', created_at: '2026-07-08T10:00:00.000Z'},
  pen2: {nome: 'Luana', email: 'lauarlata@gmail.com', role: 'pending', created_at: '2026-10-21T14:04:19.000Z'},
  pen3: {nome: 'Luana', email: 'lauarlata@gmail.com', role: 'pending', created_at: '2026-10-21T14:04:19.000Z'},
  prod1: {nome: 'Luana', email: 'lauarlata@gmail.com', role: 'production', created_at: '2026-10-21T14:04:19.000Z'},
  off1: {nome: 'Ex Funcionario', email: 'ex@kuryos.com.br', role: 'production', ativo: false,
    desativadoEm: '2026-10-01T10:00:00.000Z', desativadoPor: 'Gustavo Callegaro', created_at: '2026-01-01T10:00:00.000Z'},
  lixo: 'escalar no lugar de objeto'
});

// ── ativo / estado: ausência do campo NÃO pode significar inativo ───────────
/* Se `ativo` ausente contasse como inativo, o primeiro deploy trancaria os 24
   usuários de uma vez -- nenhum registro de hoje tem o campo. */
assert.equal(GU.ativo({}), true, 'registro sem o campo continua ativo');
assert.equal(GU.ativo({ativo: true}), true);
assert.equal(GU.ativo({ativo: false}), false);
assert.equal(GU.ativo(null), true);
assert.equal(GU.ativo({ativo: 0}), true, 'só o false exato desativa, não valor falsy');
assert.equal(GU.ativo({ativo: 'false'}), true, 'string "false" não desativa');
assert.equal(GU.estado({role: 'pcp'}), 'ATIVO');
assert.equal(GU.estado({role: 'pending'}), 'PENDENTE');
assert.equal(GU.estado({role: 'pcp', ativo: false}), 'INATIVO');
assert.equal(GU.estado({role: 'pending', ativo: false}), 'INATIVO', 'inativo vence pendente');
assert.equal(GU.estado(null), 'AUSENTE');

// ── lista ───────────────────────────────────────────────────────────────────
const ls = GU.lista(base());
assert.equal(ls.length, 8, 'valor escalar no nó é ignorado, não quebra');
assert.ok(!ls.some((u) => u.uid === 'lixo'));
assert.deepEqual(ls.map((u) => u.nome)[0], 'Bruna Araujo', 'ordem alfabética pt-BR');
assert.equal(ls.find((u) => u.uid === 'off1').estado, 'INATIVO');
assert.equal(ls.find((u) => u.uid === 'pcp1').role, 'pcp');
assert.equal(GU.lista({}).length, 0);
assert.equal(GU.lista(null).length, 0);
assert.equal(GU.lista({x: {}}).find((u) => u.uid === 'x').role, 'pending', 'registro sem papel conta como pendente');

// ── adminsAtivos: a conta que as travas protegem ────────────────────────────
assert.deepEqual(GU.adminsAtivos(base()).map((u) => u.uid).sort(), ['adm1', 'adm2']);
const umAdminSo = Object.assign(base(), {adm2: {nome: 'Lucca', role: 'admin', ativo: false}});
assert.deepEqual(GU.adminsAtivos(umAdminSo).map((u) => u.uid), ['adm1'], 'admin desativado não conta');

// ── podeRemover: AS TRAVAS ──────────────────────────────────────────────────
// Si mesmo, nunca -- é o jeito mais fácil de se trancar fora.
assert.equal(GU.podeRemover(base(), 'adm1', 'adm1').ok, false);
assert.match(GU.podeRemover(base(), 'adm1', 'adm1').motivo, /seu próprio acesso/);
// Com 2 admins, tirar um é permitido.
assert.equal(GU.podeRemover(base(), 'adm2', 'adm1').ok, true, 'com 2 admins, dá para tirar o outro');
// Com 1 admin ativo, não.
assert.equal(GU.podeRemover(umAdminSo, 'adm1', 'pcp1').ok, false, 'último admin ativo é intocável');
assert.match(GU.podeRemover(umAdminSo, 'adm1', 'pcp1').motivo, /último administrador ativo/);
// Admin JÁ inativo pode ser excluído mesmo sendo o único registro admin extra
// -- ele não é um acesso que o app ainda tem.
assert.equal(GU.podeRemover(umAdminSo, 'adm2', 'adm1').ok, true, 'admin já desativado pode sair');
// Gente comum sai sem drama.
assert.equal(GU.podeRemover(base(), 'pcp1', 'adm1').ok, true);
assert.equal(GU.podeRemover(base(), 'pen2', 'adm1').ok, true);
// Alvo inexistente ou uid que o RTDB trataria como caminho.
assert.equal(GU.podeRemover(base(), 'naoexiste', 'adm1').ok, false);
assert.match(GU.podeRemover(base(), 'naoexiste', 'adm1').motivo, /não encontrado/);
assert.equal(GU.podeRemover(base(), 'lixo', 'adm1').ok, false, 'escalar não é usuário');

// ── desativar / reativar: caminho PLANO ─────────────────────────────────────
const d = GU.desativar('pcp1', {em: '2026-10-21T12:00:00.000Z', por: 'Gustavo Callegaro'});
assert.deepEqual(d, {
  'usuarios/pcp1/ativo': false,
  'usuarios/pcp1/desativadoEm': '2026-10-21T12:00:00.000Z',
  'usuarios/pcp1/desativadoPor': 'Gustavo Callegaro'
});
Object.values(d).forEach((v) => assert.equal(typeof v !== 'object' || v === null, true, 'nada aninhado'));
assert.equal(GU.desativar('pcp1', {})['usuarios/pcp1/desativadoPor'], null, 'sem autor grava null');
const r = GU.reativar('off1', {em: '2026-10-21T12:00:00.000Z', por: 'Gustavo Callegaro'});
assert.equal(r['usuarios/off1/ativo'], true);
assert.equal(r['usuarios/off1/desativadoEm'], null, 'reativar LIMPA a marca anterior');
assert.equal(r['usuarios/off1/desativadoPor'], null);
assert.equal(r['usuarios/off1/reativadoEm'], '2026-10-21T12:00:00.000Z');
['', 'a/b', 'a.b', 'a#b', 'a$b', 'a[b', 'a]b'].forEach((uid) => {
  assert.throws(() => GU.desativar(uid, {}), /inválido/, 'recusa uid ' + JSON.stringify(uid));
  assert.throws(() => GU.reativar(uid, {}), /inválido/);
  assert.throws(() => GU.excluir(uid, {}, {}), /inválido/);
});

// ── excluir: a linha SAI e a lápide ENTRA no mesmo update ───────────────────
/* Juntas de propósito: uma falha no meio deixaria a conta sem registro E sem
   lápide, que é exatamente o fantasma que isto evita. */
const b = base();
const ex = GU.excluir('pen2', b.pen2, {em: '2026-10-21T12:00:00.000Z', por: 'Gustavo Callegaro'});
assert.equal(ex['usuarios/pen2'], null, 'a linha sai');
assert.equal(ex['usuarios_removidos/pen2/nome'], 'Luana');
assert.equal(ex['usuarios_removidos/pen2/email'], 'lauarlata@gmail.com');
assert.equal(ex['usuarios_removidos/pen2/role'], 'pending');
assert.equal(ex['usuarios_removidos/pen2/criadoEm'], '2026-10-21T14:04:19.000Z', 'guarda quando nasceu');
assert.equal(ex['usuarios_removidos/pen2/removidoPor'], 'Gustavo Callegaro');
assert.equal(ex['usuarios_removidos/pen2/authPendente'], true,
  'a credencial no Auth continua existindo: a tela não apaga, então fica pendência VISÍVEL');
Object.values(ex).forEach((v) => assert.equal(typeof v !== 'object' || v === null, true, 'nada aninhado'));
// Excluir registro sem nome/e-mail não inventa dado nem grava undefined.
const exVazio = GU.excluir('x', {}, {em: 'X'});
assert.equal(exVazio['usuarios_removidos/x/nome'], null);
assert.equal(exVazio['usuarios_removidos/x/email'], null);
assert.equal(exVazio['usuarios_removidos/x/authPendente'], true);

// ── marcarAuthApagado: fecha a pendência sem perder a lápide ────────────────
const ma = GU.marcarAuthApagado('pen2', {em: '2026-10-22T09:00:00.000Z', por: 'Gustavo Callegaro'});
assert.equal(ma['usuarios_removidos/pen2/authPendente'], false);
assert.equal(ma['usuarios_removidos/pen2/authApagadoEm'], '2026-10-22T09:00:00.000Z');
assert.equal(Object.keys(ma).some((k) => k === 'usuarios_removidos/pen2/nome'), false, 'não reescreve a lápide');

// ── recomendaExcluir: pendente sim, quem já trabalhou não ───────────────────
assert.equal(GU.recomendaExcluir({role: 'pending'}), true);
assert.equal(GU.recomendaExcluir({role: 'production'}), false, 'quem tem histórico se desativa, não se exclui');
assert.equal(GU.recomendaExcluir({role: 'admin'}), false);
assert.equal(GU.recomendaExcluir(null), false);

// ── diasDesde ───────────────────────────────────────────────────────────────
assert.equal(GU.diasDesde('2026-10-01T00:00:00.000Z', '2026-10-21T00:00:00.000Z'), 20);
assert.equal(GU.diasDesde('2026-10-21T00:00:00.000Z', '2026-10-21T00:00:00.000Z'), 0);
assert.equal(GU.diasDesde(null, '2026-10-21T00:00:00.000Z'), null);
assert.equal(GU.diasDesde('nao e data', '2026-10-21T00:00:00.000Z'), null);
assert.equal(GU.diasDesde('2026-11-01T00:00:00.000Z', '2026-10-21T00:00:00.000Z'), 0, 'data no futuro não vira negativo');

// ── duplicados: foi assim que a bagunça nasceu ──────────────────────────────
const dup = GU.duplicados(base());
const grupoEmail = dup.porEmail.find((g) => g.chave === 'lauarlata@gmail.com');
assert.ok(grupoEmail, 'acha o e-mail repetido');
assert.deepEqual(grupoEmail.usuarios.map((u) => u.uid).sort(), ['pen2', 'pen3', 'prod1']);
const grupoNome = dup.porNome.find((g) => g.chave === 'LUANA');
assert.equal(grupoNome.usuarios.length, 3);
// Mesmo nome com acento/caixa diferente é a mesma pessoa.
const acento = GU.duplicados({a: {nome: 'José Antônio', email: 'a@x.com'}, b: {nome: 'jose antonio', email: 'b@x.com'}});
assert.equal(acento.porNome.length, 1, 'acento e caixa não criam duas pessoas');
assert.equal(acento.porEmail.length, 0, 'e-mails diferentes não são duplicata de e-mail');
// E-mail com caixa diferente é o mesmo e-mail.
assert.equal(GU.duplicados({a: {nome: 'A', email: 'X@Kuryos.com'}, b: {nome: 'B', email: 'x@kuryos.com'}}).porEmail.length, 1);
assert.deepEqual(GU.duplicados({}).porEmail, []);
assert.deepEqual(GU.duplicados(null).porNome, []);

// ── resumo: o painel de decisão do ADM ──────────────────────────────────────
const removidos = {
  velho: {nome: 'Saiu Antes', email: 'v@x.com', removidoEm: '2026-10-01T10:00:00.000Z', authPendente: false},
  ghost: {nome: 'Fantasma', email: 'g@x.com', removidoEm: '2026-10-20T10:00:00.000Z', authPendente: true},
  lixo2: 'escalar'
};
const res = GU.resumo(base(), removidos, '2026-10-21T00:00:00.000Z');
assert.equal(res.total, 8);
assert.equal(res.ativos, 4, 'adm1, adm2, pcp1, prod1');
assert.equal(res.inativos, 1, 'off1');
assert.equal(res.pendentes.length, 3, 'pen1, pen2, pen3');
assert.equal(res.adminsAtivos, 2);
// O que espera há mais tempo vem primeiro: foi o caso real da pessoa
// pendente desde julho que ninguém viu.
assert.equal(res.pendentes[0].nome, 'Bruna Araujo');
assert.equal(res.pendentes[0].diasEsperando, 104);
assert.equal(res.pendentes[1].diasEsperando, 0, 'as de hoje no fim');
// Só lápide com conta de login sobrando entra na pendência do Console.
assert.deepEqual(res.authPendente.map((x) => x.uid), ['ghost']);
assert.equal(GU.resumo({}, {}, '2026-10-21T00:00:00.000Z').total, 0);
assert.deepEqual(GU.resumo(null, null, null).pendentes, []);

console.log('run_gestao_usuarios_test: OK');
