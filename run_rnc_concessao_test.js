'use strict';
/* Consulta ao cliente e uso sob concessão (28/10/2026).

   Caso que originou isto: rótulo do cliente BIOFLORA reprovou no teste de
   exposição ao perfume (RNC 0052, lote AK-2026-000671). O cliente pode, ciente
   da reprovação, autorizar o uso -- e a Kuryos precisa provar as duas coisas:
   que reprovou, e que o cliente anuiu.

   O que este teste trava, na ordem em que exime a empresa:
   reprovação gravada -> lote bloqueado -> cliente notificado com nome e meio
   -> anuência nominal COM anexo -> lote em APROVADO_CONCESSAO sem perder o
   laudo de reprovação -> encerramento só então aceita a disposição CONCESSAO. */
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const LaudoCQ = require('./public/shared/laudo-cq.js');

/* ── Banco falso ──
   `transaction(fn)`: devolver undefined aborta (é como o SDK sinaliza), e
   qualquer outro retorno grava. O SDK chama o callback com o cache local
   primeiro; aqui uma passada só basta, porque o que se testa é a REGRA de
   quem aborta, não a corrida. */
function fakeDb(dados) {
  const store = JSON.parse(JSON.stringify(dados));
  const get = (p) => p.split('/').reduce((o, k) => (o == null ? o : o[k]), store);
  const set = (p, v) => {
    const partes = p.split('/');
    const folha = partes.pop();
    partes.reduce((o, k) => (o[k] = o[k] || {}), store)[folha] = v;
  };
  return {
    store,
    ref: (path) => ({
      transaction: (fn) => {
        const antes = get(path);
        const depois = fn(antes === undefined ? null : JSON.parse(JSON.stringify(antes)));
        if (depois === undefined) return Promise.resolve({committed: false, snapshot: {val: () => antes}});
        set(path, depois);
        return Promise.resolve({committed: true, snapshot: {val: () => depois}});
      }
    })
  };
}

// utils.js é script clássico (globais, sem module.exports): carrega inteiro.
const ctx = {Object, String, Number, Array, Promise, Date, Math, JSON, isFinite, isNaN,
  parseInt, parseFloat, console, RegExp, Error, setTimeout, encodeURIComponent, decodeURIComponent,
  // utils.js e script de navegador: registra carregadores em `window` e toca o
  // DOM em alguns helpers de tela. Nada disso é o que se testa aqui -- os
  // esboços existem só para o arquivo carregar inteiro no vm.
  window: {}, document: {createElement: () => ({style: {}, appendChild() {}, setAttribute() {}}),
    head: {appendChild() {}}, body: {appendChild() {}}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => []},
  localStorage: {getItem: () => null, setItem() {}, removeItem() {}},
  navigator: {userAgent: 'node'}, location: {href: '', search: ''}, alert() {}, fetch: () => Promise.reject(new Error('sem rede'))};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/shared/utils.js', 'utf8'), ctx);
const {consultarClienteRnc, registrarRespostaClienteRnc, liberarLoteSobConcessao,
  encerrarRnc, RNC_STATUS, RNC_DISPOSICAO, STATUS_LOTE, loteDisponivel} = ctx;

// ── O estado novo existe e continua contando como aberta ──
assert.equal(RNC_STATUS.AGUARDANDO_CLIENTE.aberta, true,
  'RNC esperando o cliente ainda tem material bloqueado: não pode sair da lista de abertas');
assert.equal(RNC_STATUS.CONCLUIDA.aberta, false);
assert.equal(loteDisponivel('APROVADO_CONCESSAO'), true, 'lote em concessão é usável (já era regra do STATUS_LOTE)');
assert.equal(loteDisponivel('REPROVADO'), false);

// O laudo de reprovação que será preservado — é a prova de que a Kuryos reprovou.
const LAUDO_REPROVA = {decisao: 'REPROVADO', inspecionadoEm: '2026-10-28T12:00:00.000Z',
  inspecionadoPor: 'Roberta Ramos', observacao: 'Desbotamento após 10 min de exposição ao perfume.'};

function base() {
  return {
    nao_conformidades: {
      'RNC-2026-052': {
        numero: 'RNC-2026-052', status: 'EM_ANALISE', classificacao: 'MAIOR', origem: 'RECEBIMENTO',
        descricao: 'Rótulos com baixa resistência no teste de exposição ao perfume.',
        itemCodigo: 'EP-ROT-SEA', loteKey: 'ak2026000671', loteOrigem: 'AK-2026-000671',
        cliente: 'BIOFLORA', fornecedorNome: 'ÁGIL GRÁFICA',
        abertaEm: '2026-10-28T12:00:00.000Z', abertaPor: 'Roberta Ramos',
        acaoImediata: 'Lote bloqueado até resposta do cliente.'
      }
    },
    estoque_lotes: {
      'EP-ROT-SEA': {
        ak2026000671: {itemCodigo: 'EP-ROT-SEA', loteOrigem: 'AK-2026-000671', saldoLote: 5500,
          status: 'REPROVADO', qualidade: LAUDO_REPROVA}
      }
    }
  };
}
const RNC = 'nao_conformidades/RNC-2026-052';
const LOTE = 'estoque_lotes/EP-ROT-SEA/ak2026000671';

(async () => {
  // ── 1. A notificação ao cliente precisa ter destinatário e meio ──
  let db = fakeDb(base());
  assert.match((await consultarClienteRnc(db, 'RNC-2026-052', {meio: 'E-mail'}, 'Roberta')).erro,
    /destinatário com nome/, 'notificação sem nome de quem foi notificado passou');
  assert.match((await consultarClienteRnc(db, 'RNC-2026-052', {contatoNome: 'Fulano'}, 'Roberta')).erro,
    /qual meio/, 'notificação sem meio passou');

  let r = await consultarClienteRnc(db, 'RNC-2026-052',
    {contatoNome: 'Marina Alves', contatoEmail: 'marina@bioflora.com', meio: 'E-mail',
      observacao: 'Enviado o FOR-QUA-0001 com as fotos.'}, 'Roberta Ramos');
  assert.equal(r.ok, true, r.erro);
  assert.equal(db.store.nao_conformidades['RNC-2026-052'].status, 'AGUARDANDO_CLIENTE');
  assert.equal(db.store.nao_conformidades['RNC-2026-052'].consultaCliente.contatoNome, 'Marina Alves');
  assert.equal(db.store.nao_conformidades['RNC-2026-052'].consultaCliente.notificadoPor, 'Roberta Ramos');
  assert.match((await consultarClienteRnc(db, 'RNC-2026-052',
    {contatoNome: 'Outro', meio: 'E-mail'}, 'Roberta')).erro, /já foi notificado/,
    'notificar duas vezes sobrescreveria a data que conta para o prazo');

  // ── 2. Resposta: exige nome, e LIBEROU exige o anexo da autorização ──
  assert.match((await registrarRespostaClienteRnc(db, 'RNC-2026-052', {decisao: 'LIBEROU'}, 'Roberta')).erro,
    /nome de quem respondeu/);
  assert.match((await registrarRespostaClienteRnc(db, 'RNC-2026-052',
    {decisao: 'LIBEROU', autorizadoPor: 'Marina Alves'}, 'Roberta')).erro, /Anexe a autorização/,
    'concessão registrada sem a prova da anuência: é justamente a peça que exime a Kuryos');
  assert.match((await registrarRespostaClienteRnc(db, 'RNC-2026-052', {decisao: 'TALVEZ', autorizadoPor: 'X'}, 'R')).erro,
    /autorizou o uso ou reprovou/);

  // Resposta sem notificação registrada não entra.
  const dbSemConsulta = fakeDb(base());
  assert.match((await registrarRespostaClienteRnc(dbSemConsulta, 'RNC-2026-052',
    {decisao: 'REPROVOU', autorizadoPor: 'Marina'}, 'Roberta')).erro, /notificação ao cliente/,
    'resposta sem pergunta: a cadeia perde a ordem que a sustenta');

  // ── 3. O cliente autoriza: anuência gravada e lote liberado sob concessão ──
  r = await registrarRespostaClienteRnc(db, 'RNC-2026-052', {
    decisao: 'LIBEROU', autorizadoPor: 'Marina Alves', cargo: 'Gerente de Qualidade',
    meio: 'E-mail', respondidoEm: '2026-10-30', restricao: 'Usar somente no lote em curso.',
    evidencia: 'E-mail de 30/10/2026', anexos: [{url: 'gs://x/autorizacao.pdf', nome: 'autorizacao.pdf'}]
  }, 'Roberta Ramos');
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.loteLiberado, true, 'anuência gravada mas o lote continuou bloqueado: a disposição não fez nada');

  const rnc = db.store.nao_conformidades['RNC-2026-052'];
  assert.equal(rnc.status, 'EM_ANALISE', 'com resposta na mão a bola volta para a Qualidade');
  assert.equal(rnc.consultaCliente.resposta.autorizadoPor, 'Marina Alves');
  assert.equal(rnc.consultaCliente.resposta.anexos.length, 1);
  assert.equal(rnc.disposicaoSugerida, 'CONCESSAO');

  const lote = db.store.estoque_lotes['EP-ROT-SEA'].ak2026000671;
  assert.equal(lote.status, 'APROVADO_CONCESSAO', 'a transição REPROVADO -> concessão é o caminho que não existia');
  assert.equal(lote.concessao.statusAnterior, 'REPROVADO', 'o lote tem de dizer de onde veio');
  assert.equal(lote.concessao.rnc, 'RNC-2026-052');
  assert.equal(lote.concessao.autorizadoPor, 'Marina Alves');
  assert.equal(lote.concessao.restricao, 'Usar somente no lote em curso.');
  assert.deepEqual(lote.qualidade, LAUDO_REPROVA,
    'o laudo de REPROVAÇÃO não pode ser sobrescrito: é metade do que exime a Kuryos');

  assert.match((await registrarRespostaClienteRnc(db, 'RNC-2026-052',
    {decisao: 'REPROVOU', autorizadoPor: 'Outro'}, 'R')).erro, /já foi registrada/,
    'duas respostas na mesma RNC apagariam a primeira');

  // ── 4. Encerrar com CONCESSAO só depois da anuência ──
  const dbSemAnuencia = fakeDb(base());
  let e = await encerrarRnc(dbSemAnuencia, 'RNC-2026-052', {
    causaRaiz: 'Tinta sem resistência ao solvente do perfume.',
    acaoCorretiva: 'Trocar o verniz de proteção na gráfica.', disposicao: 'CONCESSAO'
  }, 'Roberta');
  assert.equal(e.ok, false);
  assert.match(e.erro, /registre antes a notificação ao cliente/,
    'encerrou "usar com concessão" sem ninguém ter autorizado nada');
  assert.equal(dbSemAnuencia.store.nao_conformidades['RNC-2026-052'].status, 'EM_ANALISE',
    'a RNC não pode ficar meio-encerrada quando a disposição é recusada');

  // Outras disposições continuam não exigindo cliente nenhum.
  e = await encerrarRnc(fakeDb(base()), 'RNC-2026-052', {
    causaRaiz: 'Tinta sem resistência ao solvente.', acaoCorretiva: 'Devolver à gráfica.', disposicao: 'DEVOLUCAO'
  }, 'Roberta');
  assert.equal(e.ok, true, e.erro);

  // Com a anuência gravada, CONCESSAO passa.
  e = await encerrarRnc(db, 'RNC-2026-052', {
    causaRaiz: 'Tinta sem resistência ao solvente do perfume.',
    acaoCorretiva: 'Trocar o verniz de proteção na gráfica.',
    responsavelAcao: 'Roberta Ramos', disposicao: 'CONCESSAO'
  }, 'Roberta Ramos');
  assert.equal(e.ok, true, e.erro);
  assert.equal(db.store.nao_conformidades['RNC-2026-052'].status, 'CONCLUIDA');
  assert.equal(db.store.nao_conformidades['RNC-2026-052'].disposicao, 'CONCESSAO');

  // ── 5. A liberação por concessão tem portas fechadas ──
  assert.match((await liberarLoteSobConcessao(fakeDb(base()), 'EP-ROT-SEA', 'ak2026000671',
    {rnc: 'RNC-2026-052'}, 'R')).erro, /nome de quem autorizou/);
  assert.match((await liberarLoteSobConcessao(fakeDb(base()), 'EP-ROT-SEA', 'ak2026000671',
    {autorizadoPor: 'Marina'}, 'R')).erro, /exige a RNC/,
    'concessão sem RNC é liberação sem rastro');
  const dbLiberado = fakeDb(base());
  dbLiberado.store.estoque_lotes['EP-ROT-SEA'].ak2026000671.status = 'LIBERADO';
  assert.match((await liberarLoteSobConcessao(dbLiberado, 'EP-ROT-SEA', 'ak2026000671',
    {autorizadoPor: 'Marina', rnc: 'RNC-2026-052'}, 'R')).erro, /não entra em concessão/,
    'lote já aprovado não vira concessão');
  const dbJa = fakeDb(base());
  await liberarLoteSobConcessao(dbJa, 'EP-ROT-SEA', 'ak2026000671', {autorizadoPor: 'Marina', rnc: 'R1'}, 'R');
  assert.match((await liberarLoteSobConcessao(dbJa, 'EP-ROT-SEA', 'ak2026000671',
    {autorizadoPor: 'Outro', rnc: 'R2'}, 'R')).erro, /já está liberado sob concessão/);

  // ── 6. RNC sem lote apontado: a anuência vale, o lote fica para a tela ──
  const dbSemLote = fakeDb(base());
  delete dbSemLote.store.nao_conformidades['RNC-2026-052'].loteKey;
  await consultarClienteRnc(dbSemLote, 'RNC-2026-052', {contatoNome: 'Marina', meio: 'E-mail'}, 'R');
  r = await registrarRespostaClienteRnc(dbSemLote, 'RNC-2026-052',
    {decisao: 'LIBEROU', autorizadoPor: 'Marina Alves', anexos: [{url: 'gs://x/a.pdf'}]}, 'R');
  assert.equal(r.ok, true, 'perder a anuência por falta de lote seria trocar a prova pelo efeito colateral');
  assert.equal(r.loteLiberado, false);
  assert.match(r.avisoLote, /não aponta lote/);

  // ── 7. Os documentos: FOR-QUA-0001 e o termo de anuência ──
  const dados = {
    numero: 'RNC-2026-052', dataAbertura: '2026-10-28', dataEmissao: '2026-10-28',
    produto: 'ROTULO BODY SPLASH B.BALM SEA SAPHIRE 200ML', cliente: 'BIOFLORA',
    lote: 'AK-2026-000671', fornecedor: 'ÁGIL GRÁFICA', area: 'RECEBIMENTO',
    produtoServico: 'Embalagem', origem: 'RECEBIMENTO', classificacao: 'MAIOR',
    descricao: 'Rótulos com baixa resistência ao perfume; desbotamento em 10 min.',
    acaoImediata: 'Bloqueio do lote até resposta do cliente.', elaboradoPor: 'Roberta Ramos',
    contencao: {loteBloqueado: true, materiaisBloqueados: true, outrosImpactados: false,
      houveExpedicao: false, equipesAvisadas: true},
    consultaCliente: db.store.nao_conformidades['RNC-2026-052'].consultaCliente,
    responsavel: {nome: 'Roberta Ramos'}
  };
  const doc = LaudoCQ.paginaRnc(dados);
  ['RNC-2026-052', 'BIOFLORA', 'ÁGIL GRÁFICA', 'AK-2026-000671', '( X ) Maior',
    '11. ENCERRAMENTO', 'Marina Alves', 'Cliente AUTORIZOU'].forEach(t =>
    assert.ok(doc.includes(t), 'FOR-QUA-0001 sem: ' + t));
  assert.ok(doc.includes('( X ) Inspeção'),
    'a origem RECEBIMENTO do sistema tem de cair na caixa "Inspeção" do formulário');
  assert.ok(!doc.includes('5. '), 'não inventar a seção 5, que não existe na camada de texto do Word');

  // Contenção: pergunta não respondida sai VAZIA, nunca "Não".
  const semResposta = LaudoCQ.paginaRnc(Object.assign({}, dados, {contencao: {}}));
  assert.ok(!/\(\s*X\s*\)\s*Não/.test(semResposta.split('6. CORREÇÃO')[1].split('7. ANÁLISE')[0]),
    'pergunta de contenção sem resposta saiu marcada: afirmaria contenção que ninguém verificou');

  const termo = LaudoCQ.paginaTermoConcessao(dados);
  ['TERMO DE ANUÊNCIA', 'REPROVOU', 'Marina Alves', 'Gerente de Qualidade',
    'BIOFLORA', 'isentando a Kuryos', 'Usar somente no lote em curso.'].forEach(t =>
    assert.ok(termo.includes(t), 'termo sem: ' + t));
  assert.ok(termo.includes('não se estendendo a qualquer outro desvio'),
    'a isenção precisa ser limitada a esta NC e a este lote');

  assert.equal(RNC_DISPOSICAO.CONCESSAO, 'Usar com concessão');
  assert.equal(STATUS_LOTE.APROVADO_CONCESSAO.disponivel, true);

  console.log('OK RNC/concessão: estado aguardando cliente; notificação com nome e meio; anuência exige anexo; ' +
    'REPROVADO -> APROVADO_CONCESSAO sem apagar o laudo; encerramento com CONCESSAO exige a anuência; ' +
    'FOR-QUA-0001 e termo de isenção.');
})().catch(e => { console.error(e); process.exit(1); });
