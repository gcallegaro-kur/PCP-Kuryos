'use strict';
/* Regras do banco do Feedback e Clima (06/10), no emulador real:
   firebase emulators:exec --project demo-mp --only database --config firebase.retrabalhos-test.json "node run_feedback_clima_rules_test.js"
   R1 só par do mesmo setor e o líder direto; R2 ninguém avalia a si; R3 o líder não aparece como par (nem o liderado para o líder);
   R5 uma resposta por avaliador/avaliado/período; R6 sem edição nem exclusão; R7/R9 só o RH lê resultado;
   R10 só o RH muda a configuração; R11 formulário com no máximo 8 itens; R12 nota 1-5 inteira; R13 clima uma vez por período;
   R14 participação separada do conteúdo. */
const assert = require('assert/strict');
const admin = require('./functions/node_modules/firebase-admin');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9023') throw new Error('Teste exige emulador local 9023.');
const URL = 'http://127.0.0.1:9023?ns=demo-mp-default-rtdb';
const raiz = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL}, 'raiz');
const apps = {};
const como = (uid) => (apps[uid] || (apps[uid] = admin.initializeApp({projectId: 'demo-mp', databaseURL: URL, databaseAuthVariableOverride: {uid: uid}}, uid))).database();
const negado = (p) => assert.rejects(p, /permission[ _]denied/i);
const P = '2026-S41';
const notas = {a: 4, b: 5, c: 3, d: 4};
const resp = (tipo, alvo, extra) => Object.assign({tipo: tipo, avaliadoId: alvo, notas: notas, criadoEm: '2026-10-08T12:00:00Z'}, extra || {});
// o que a tela grava: a resposta + o registro de "já avaliei" (atômico)
const enviar = (uid, col, tipo, alvo, extra, key) => como(uid).ref().update({
  ['feedback_respostas/' + P + '/' + (key || ('r_' + uid + '_' + alvo + '_' + tipo))]: resp(tipo, alvo, Object.assign({avaliadorId: col}, extra || {})),
  ['feedback_feitos/' + P + '/' + uid + '/' + alvo]: true
});
const clima = (extra) => Object.assign({colaboradorId: 'A', setor: 'Produção', respostas: {humor: 4, condicoes: 3, recomendaria: 5}, criadoEm: '2026-10-08T12:00:00Z'}, extra || {});
const enviarClima = (uid, c, extra, key) => como(uid).ref().update({
  ['clima_respostas/' + P + '/' + (key || 'c_' + uid)]: clima(Object.assign({colaboradorId: c}, extra || {})),
  ['feedback_feitos/' + P + '/' + uid + '/_clima']: true
});

(async () => {
  await raiz.database().ref().set({
    usuarios: {adm: {role: 'admin'}, rh: {role: 'rh'}, uA: {role: 'production'}, uB: {role: 'production'}, uC: {role: 'rotulagem'}, uL: {role: 'gestor'}, uD: {role: 'production'}, uX: {role: 'production'}},
    feedback_diretorio: {
      L: {nome: 'Lúcia', tipo: 'colaborador', status: 'Ativo', setorChave: 'producao'},
      A: {nome: 'Ana', tipo: 'colaborador', status: 'Ativo', setorChave: 'producao', gestorKey: 'L'},
      B: {nome: 'Bia', tipo: 'colaborador', status: 'Ativo', setorChave: 'producao', gestorKey: 'L'},
      C: {nome: 'Caio', tipo: 'colaborador', status: 'Ativo', setorChave: 'producao', gestorKey: 'L'},
      D: {nome: 'Dora', tipo: 'colaborador', status: 'Ativo', setorChave: 'expedicao', gestorKey: 'L'},
      T1: {nome: 'Temp', tipo: 'temporario', status: 'Ativo', setorChave: 'producao', ultimoOk: '2026-10-05'}
    },
    feedback_diretorio_por_uid: {uA: 'A', uB: 'B', uC: 'C', uL: 'L', uD: 'D'}
  });
  await como('rh').ref('feedback_config/ciclo').set({ativo: true, rhVeAutoria: true, rhVeAutoriaClima: true});

  // ── R1/R2/R3: quem pode ser avaliado ──
  await enviar('uA', 'A', 'par', 'B');                                   // colega do setor
  await enviar('uA', 'A', 'par', 'T1');                                  // temporário do setor
  await enviar('uA', 'A', 'lider', 'L');                                 // líder direto
  await negado(enviar('uA', 'A', 'par', 'D'));                           // outro setor
  await negado(enviar('uA', 'A', 'par', 'A'));                           // ninguém avalia a si
  await negado(enviar('uA', 'A', 'par', 'L'));                           // o líder não é "par"
  await negado(enviar('uC', 'C', 'lider', 'B'));                         // "líder" só o gestor direto
  await negado(enviar('uC', 'C', 'par', 'zz'));                          // alvo que não existe
  await negado(enviar('uL', 'L', 'par', 'A'));                           // o líder não avalia liderado como par
  await enviar('uL', 'L', 'par', 'T1');                                  // mas avalia o temporário do setor
  await negado(enviar('uX', 'A', 'par', 'B'));                           // usuário sem vínculo com colaborador
  await negado(enviar('uB', 'A', 'par', 'C'));                           // não pode se passar por outra pessoa
  // ── R5/R6: uma vez só, sem editar nem apagar ──
  await negado(enviar('uA', 'A', 'par', 'B', {}, 'segunda_tentativa'));
  await negado(como('uA').ref('feedback_respostas/' + P + '/r_uA_B_par/notas/a').set(5));
  await negado(como('uA').ref('feedback_respostas/' + P + '/r_uA_B_par').remove());
  await negado(como('rh').ref('feedback_respostas/' + P + '/r_uA_B_par').remove());
  await negado(como('uA').ref('feedback_feitos/' + P + '/uA/B').remove());
  // ── R12: nota 1-5 inteira, completa ──
  await negado(enviar('uB', 'B', 'par', 'C', {notas: {a: 6, b: 5, c: 3, d: 4}}));
  await negado(enviar('uB', 'B', 'par', 'C', {notas: {a: 0, b: 5, c: 3, d: 4}}));
  await negado(enviar('uB', 'B', 'par', 'C', {notas: {a: 3.5, b: 5, c: 3, d: 4}}));
  await negado(enviar('uB', 'B', 'par', 'C', {notas: 'ótimo'}));
  await negado(enviar('uB', 'B', 'par', 'C', {comentario: 'x'.repeat(1001)}));
  await enviar('uB', 'B', 'par', 'C', {comentario: 'x'.repeat(1000)});
  // ── R7/R9: só o RH lê resultado; o avaliado nunca vê ──
  await negado(como('uA').ref('feedback_respostas').get());
  await negado(como('uB').ref('feedback_respostas/' + P).get());
  await negado(como('uL').ref('feedback_respostas/' + P + '/r_uA_L_lider').get());
  for (const u of ['rh', 'adm']) assert.equal((await como(u).ref('feedback_respostas/' + P + '/r_uA_B_par/avaliadoId').get()).val(), 'B');
  // quem já avaliou só vê a própria lista; nem o RH lê (não revela quem avaliou quem)
  assert.equal((await como('uA').ref('feedback_feitos/' + P + '/uA/B').get()).val(), true);
  await negado(como('uB').ref('feedback_feitos/' + P + '/uA').get());
  await negado(como('rh').ref('feedback_feitos/' + P + '/uA').get());

  // ── anonimato: só dá para omitir a autoria se o RH ligou a política ──
  await negado(como('uC').ref().update({['feedback_respostas/' + P + '/anon1']: resp('par', 'B'), ['feedback_feitos/' + P + '/uC/B']: true}));
  await como('rh').ref('feedback_config/ciclo/rhVeAutoria').set(false);
  await como('uC').ref().update({['feedback_respostas/' + P + '/anon1']: resp('par', 'B'), ['feedback_feitos/' + P + '/uC/B']: true});
  await negado(como('uC').ref().update({['feedback_respostas/' + P + '/anon2']: resp('par', 'A', {avaliadorId: 'B'}), ['feedback_feitos/' + P + '/uC/A']: true}));
  await como('rh').ref('feedback_config/ciclo/rhVeAutoria').set(true);

  // ── clima: uma vez por período, só colaborador com vínculo ──
  await enviarClima('uA', 'A', {recadoRh: 'Faltam luvas'});
  await negado(enviarClima('uA', 'A', {}, 'c_segunda'));                 // R13: segunda tentativa
  await negado(enviarClima('uX', 'A'));                                  // sem vínculo
  await negado(enviarClima('uB', 'A'));                                  // não responde por outro
  await negado(enviarClima('uB', 'B', {respostas: {humor: 9}}, 'c_b1'));
  await negado(enviarClima('uB', 'B', {recadoRh: 'x'.repeat(2001)}, 'c_b2'));
  await enviarClima('uB', 'B', {respostas: {humor: 3, condicoes: 3, recomendaria: 3, aberta: 'texto livre'}});
  await negado(como('uA').ref('clima_respostas/' + P).get());            // clima só o RH lê
  assert.equal((await como('rh').ref('clima_respostas/' + P + '/c_uA/recadoRh').get()).val(), 'Faltam luvas');
  await negado(como('uA').ref('clima_respostas/' + P + '/c_uA/respostas/humor').set(5));
  // ── participação (R14): o colaborador registra a própria; o RH lê; ninguém lê a dos outros ──
  await como('uA').ref('feedback_participacao/' + P + '/A').set({pares: 2, lider: true, clima: true, atualizadoEm: 'x'});
  await negado(como('uA').ref('feedback_participacao/' + P + '/B').set({pares: 9, atualizadoEm: 'x'}));
  await negado(como('uA').ref('feedback_participacao/' + P + '/A').get());
  assert.equal((await como('rh').ref('feedback_participacao/' + P + '/A/pares').get()).val(), 2);
  // ── configuração: todos leem (para montar o formulário), só RH/admin gravam (R10) ──
  assert.equal((await como('uA').ref('feedback_config/ciclo/ativo').get()).val(), true);
  await negado(como('uA').ref('feedback_config/ciclo/nMinimo').set(1));
  await negado(como('uL').ref('feedback_config/modeloPar').set([{id: 'x', nome: 'X'}]));
  await como('rh').ref('feedback_config/modeloPar').set([{id: 'x', nome: 'X'}]);
  await como('adm').ref('feedback_config/modeloClima').set(Array.from({length: 8}, (_, i) => ({id: 'q' + i, texto: 'Q', tipo: 'escala'})));
  await negado(como('rh').ref('feedback_config/modeloLider').set(Array.from({length: 9}, (_, i) => ({id: 'q' + i, nome: 'Q'}))));   // R11: no máximo 8
  // diretório: todos leem; só RH escreve; o mapeamento de login só o dono (e o RH) lê
  assert.equal((await como('uA').ref('feedback_diretorio/B/nome').get()).val(), 'Bia');
  await negado(como('uA').ref('feedback_diretorio/B/setorChave').set('expedicao'));
  assert.equal((await como('uA').ref('feedback_diretorio_por_uid/uA').get()).val(), 'A');
  await negado(como('uA').ref('feedback_diretorio_por_uid/uB').get());
  await negado(como('uA').ref('feedback_diretorio_por_uid/uA').set('B'));
  // ciclo pausado: ninguém responde
  await como('rh').ref('feedback_config/ciclo/ativo').set(false);
  await negado(enviar('uC', 'C', 'par', 'A'));
  await negado(enviarClima('uC', 'C'));
  await como('rh').ref('feedback_config/ciclo/ativo').set(true);
  await enviar('uC', 'C', 'par', 'A');
  // recados lidos: só RH
  await como('rh').ref('clima_recados_lidos/' + P + '/c_uA').set(true);
  await negado(como('uA').ref('clima_recados_lidos/' + P + '/c_uA').set(true));
  console.log('OK regras do Feedback e Clima: alvos válidos, uma resposta por par e período, sem edição, só o RH lê, anonimato conforme a política, clima único e formulários limitados a 8 itens.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
