'use strict';
/* Testes da tela de Auditoria da Programação.
   O módulo da tela toca DOM, então aqui testo o que dá para isolar (a janela
   de dias, que é o que define quantas leituras a tela faz) e exercito
   `iniciar` com um DOM de mentira, procurando o que costuma quebrar:
   não-admin passando, leitura do nó inteiro em vez de dia a dia, e HTML com
   undefined. */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Tela = require('./public/shared/auditoria-programacao-tela');
const E = require('./public/shared/eventos-programacao');

let n = 0;
const eq = (a, b, m) => { n++; assert.equal(a, b, m); };
const ok = (c, m) => { n++; assert.ok(c, m); };

// ── diasEntre: é o que define o custo de leitura da tela ───────────────────
eq(Tela.diasEntre('2026-10-01', '2026-10-01').length, 1, 'mesmo dia é uma leitura');
eq(Tela.diasEntre('2026-10-01', '2026-10-07').length, 7, 'uma semana são 7 leituras');
eq(Tela.diasEntre('2026-10-07', '2026-10-01').length, 0, 'data final antes da inicial não lê nada');
eq(Tela.diasEntre('bagunca', '2026-10-01').length, 0, 'data inválida não lê nada');
eq(Tela.diasEntre('2026-10-01', '2026-10-01')[0], '2026-10-01', 'devolve o dia no formato do balde');
// O teto é o que impede alguém digitar 2020 e a tela tentar baixar 2 mil dias
ok(Tela.diasEntre('2020-01-01', '2026-10-07').length <= Tela.MAX_DIAS,
  'janela é limitada a MAX_DIAS — sem isso a tela tentaria baixar anos de log');
eq(Tela.diasEntre('2026-01-01', '2026-12-31').length, Tela.MAX_DIAS, 'pedido grande é cortado no teto');
// Virada de mês e ano
eq(Tela.diasEntre('2026-10-30', '2026-11-02').length, 4, 'atravessa a virada de mês');
eq(Tela.diasEntre('2026-12-30', '2027-01-02').length, 4, 'atravessa a virada de ano');

// ── a página declara o módulo e os scripts certos ──────────────────────────
const html = fs.readFileSync(path.join(__dirname, 'public/auditoria_programacao.html'), 'utf8');
ok(/shared\/eventos-programacao\.js/.test(html), 'a página carrega o motor do log');
ok(/shared\/auditoria-programacao-tela\.js/.test(html), 'e o módulo da tela');
ok(/auth_check\.js/.test(html), 'e o auth_check, que é quem barra o acesso');
ok(/kuryosDatabaseURL/.test(html), 'usa o helper de URL do banco, igual às outras telas (emulador local)');
// Chave inventada é erro clássico de página nova: tem que ser a MESMA do resto
const auth = fs.readFileSync(path.join(__dirname, 'public/usuarios.html'), 'utf8');
const chaveDaPagina = (html.match(/apiKey:\s*"([^"]+)"/) || [])[1];
const chaveReal = (auth.match(/apiKey:\s*"([^"]+)"/) || [])[1];
eq(chaveDaPagina, chaveReal, 'o firebaseConfig é o mesmo das outras páginas, não um inventado');

// ── o módulo está registrado nas cinco pontas ──────────────────────────────
const authCheck = fs.readFileSync(path.join(__dirname, 'public/auth_check.js'), 'utf8');
ok(/auditoria:\s*\{/.test(authCheck), 'módulo `auditoria` existe em KURYOS_MODULOS');
ok(/auditoria_programacao\.html/.test(authCheck), 'a página está declarada no módulo');
ok(/temMod\('auditoria'\)[\s\S]{0,120}auditoria_programacao\.html/.test(authCheck),
  'e tem link na navbar atrás do módulo');
// A regra mais importante: NÃO entrar no padrão de nenhum papel além de admin
const porPapel = authCheck.slice(authCheck.indexOf('MODULOS_POR_PAPEL'), authCheck.indexOf('MODULOS_POR_PAPEL') + 1400);
ok(!/'auditoria'/.test(porPapel),
  'o módulo NÃO entra no padrão de nenhum papel — só admin (que recebe tudo) e quem o ADM marcar');

const regras = fs.readFileSync(path.join(__dirname, 'database.rules.json'), 'utf8');
const regrasLimpas = regras.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const r = JSON.parse(regrasLimpas).rules.eventos_programacao;
ok(r, 'o nó eventos_programacao tem regra');
ok(/role'\)\.val\(\) == 'admin'/.test(r['.read']), 'leitura só do admin');
ok(/!data\.exists\(\)/.test(r.$dia.$id['.write']), 'escrita só CRIA — não dá para editar');
ok(/newData\.exists\(\)/.test(r.$dia.$id['.write']), 'e não dá para apagar');
ok(/auth\.uid/.test(r.$dia.$id.porUid['.validate']),
  'porUid é validado contra auth.uid — ninguém assina no lugar de outro');

// ── iniciar() com DOM de mentira ───────────────────────────────────────────
function domFalso() {
  const nos = {};
  const criar = (id) => (nos[id] = {
    id, innerHTML: '', textContent: '', value: '', checked: false,
    appendChild() {}, addEventListener() {}
  });
  ['fDe', 'fAte', 'fAcao', 'fLinha', 'fBusca', 'btnBuscar', 'fIncluirOps', 'kpis', 'avisos', 'lista'].forEach(criar);
  return {
    nos,
    document: { getElementById: (id) => nos[id] || criar(id), createElement: () => ({ set value(v) {}, set textContent(v) {} }) }
  };
}
const dbFalso = {
  ref: (p) => ({
    once: () => Promise.resolve({
      val: () => (p === 'config/linhas' ? ['Linha 1', 'Linha 2']
        : (String(p).indexOf('eventos_programacao') === 0 ? {
          ev1: { acao: 'TIRAR', lote: '26273/03', porNome: 'Gustavo', porUid: 'u1', papel: 'admin',
                 linhaDe: 'Linha 1', em: new Date().toISOString(), motivo: 'slot limpo' }
        } : {}))
    })
  })
};

(async () => {
  const g = globalThis;
  const salvos = { document: g.document, EventosProgramacao: g.EventosProgramacao };
  const fake = domFalso();
  g.document = fake.document;
  g.EventosProgramacao = E;

  // Não-admin tem que ser barrado mesmo recebendo o módulo por engano
  Tela.iniciar(dbFalso, { uid: 'u2', nome: 'Robert', role: 'pcp' });
  ok(/restrita ao papel/.test(fake.nos.lista.innerHTML), 'papel que não é admin é barrado pela tela');
  ok(!/eventos no período/.test(fake.nos.kpis.innerHTML), 'e nem chega a montar os indicadores');

  // Admin: monta e renderiza
  const fake2 = domFalso();
  g.document = fake2.document;
  Tela.iniciar(dbFalso, { uid: 'u1', nome: 'Gustavo', role: 'admin' });
  await new Promise((res) => setTimeout(res, 60));
  ok(/eventos no período/.test(fake2.nos.kpis.innerHTML), 'admin vê os indicadores');
  ok(/26273\/03/.test(fake2.nos.lista.innerHTML), 'e o evento aparece na lista');
  ok(/Gustavo/.test(fake2.nos.lista.innerHTML), 'com o autor');
  ok(!/undefined|NaN|\[object Object\]/.test(fake2.nos.lista.innerHTML + fake2.nos.kpis.innerHTML),
    'HTML sem undefined/NaN');
  ok(/retroativ/.test(fake2.nos.avisos.innerHTML),
    'avisa que encerramentos/cancelamentos estão fora e são retroativos');

  g.document = salvos.document;
  g.EventosProgramacao = salvos.EventosProgramacao;

  console.log('OK tela de auditoria: ' + n + ' asserções — janela de dias limitada, cinco pontas registradas, ' +
    'regra do nó só admin e append-only, não-admin barrado, render sem undefined.');
})().catch((e) => { console.error(e); process.exit(1); });
