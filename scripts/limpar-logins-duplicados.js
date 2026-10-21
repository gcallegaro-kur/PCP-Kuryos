'use strict';
/* Apaga logins duplicados: o registro em `usuarios/{uid}` E a conta no
 * Firebase Auth. A tela não consegue a segunda parte (precisa de Admin SDK,
 * que vive nas Cloud Functions, fora do ar pelo billing) -- este script é a
 * saída enquanto isso.
 *
 * NASCEU DE: 21/10/2026. Medido, 25 contas no Auth para ~19 pessoas. Os 3
 * logins da Luana foram criados no MESMO segundo (14:04:19) porque o botão
 * de cadastro não travava no envio -- consertado em `login.html` no mesmo
 * commit. Este script limpa o que o bug já produziu.
 *
 * SEGURANÇA (armadilha do CLAUDE.md: backup, UM registro, conferir, só então
 * o resto):
 *   - Sem `--aplicar` ele só MOSTRA o que faria (padrão).
 *   - Sempre grava backup JSON do que vai apagar, antes de apagar.
 *   - Recusa apagar quem não está na lista explícita de uids.
 *   - Recusa apagar admin, e recusa apagar o único login de uma pessoa.
 *
 * Uso:
 *   node scripts/limpar-logins-duplicados.js                  # simulação
 *   node scripts/limpar-logins-duplicados.js --aplicar        # executa
 *   node scripts/limpar-logins-duplicados.js --aplicar --so-um  # só o 1º
 */
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});

/* Lista EXPLÍCITA. Nada é descoberto por heurística: um `role` lido errado
 * apagaria a pessoa errada, e isso não tem desfazer. Decisão do usuário em
 * 21/10: só as 3 duplicatas da Luana criadas hoje; `EaN7w6eC` (production) é
 * o login que ela usa e FICA. */
const ALVOS = [
  // 14:04:22.950, 14:04:23.745 e 14:04:23.756 -- três contas em 0,8 segundo.
  {uid: '8y9nlfdsdgNtMNrZPGlRyDHt5op2', email: 'lauarlata@gmail.com', motivo: 'duplicata do duplo clique (mesmo e-mail, 0,8s de diferenca)'},
  {uid: 'oPGc3T5Y3DS4hJERn82XAkUXH6i1', email: 'lauarlata@gmail.com', motivo: 'duplicata do duplo clique (mesmo e-mail, 0,8s de diferenca)'},
  {uid: 'ZERXmDp4wzfCbwDdUfbjl9mEbu03', email: 'luarlagta@gmail.com', motivo: 'e-mail digitado errado no cadastro (tentativa 80s antes)'},
];
const MANTER = 'EaN7w6eCW9TU4WbdIWn5n8lnAhj1';  // Luana, production -- o que ela usa

const aplicar = process.argv.includes('--aplicar');
const soUm = process.argv.includes('--so-um');

(async () => {
  const db = admin.database();
  const usuarios = (await db.ref('usuarios').once('value')).val() || {};

  // O login que fica tem de existir ANTES de apagar os outros -- senão a
  // pessoa fica sem nenhum acesso e ninguém percebe até ela tentar entrar.
  if (!usuarios[MANTER]) {
    console.error('ABORTADO: o login que deveria FICAR (' + MANTER.slice(0, 8) + ') não existe em /usuarios.');
    process.exit(1);
  }
  console.log('Login que FICA: ' + MANTER.slice(0, 8) + ' | ' + usuarios[MANTER].email + ' | papel ' + usuarios[MANTER].role + '\n');

  const fila = [];
  for (const alvo of ALVOS) {
    const u = usuarios[alvo.uid];
    let conta = null;
    try { conta = await admin.auth().getUser(alvo.uid); } catch (e) { conta = null; }
    const problemas = [];
    // Não existir nos dois lados é IDEMPOTÊNCIA, não inconsistência: é o
    // estado depois de uma passada com --so-um. Abortar aqui tornava a
    // segunda execução impossível.
    const jaFeito = !u && !conta;
    if (u && u.role === 'admin') problemas.push('É ADMIN -- recusado por segurança');
    if (u && u.email && u.email !== alvo.email) {
      problemas.push('e-mail no RTDB (' + u.email + ') não casa com o esperado (' + alvo.email + ')');
    }
    if (conta && conta.email && conta.email !== alvo.email) {
      problemas.push('e-mail no Auth (' + conta.email + ') não casa com o esperado (' + alvo.email + ')');
    }
    fila.push({alvo: alvo, u: u || null, conta: conta, problemas: problemas, jaFeito: jaFeito});
  }

  console.log('— O que será apagado —');
  fila.forEach((f) => {
    if (f.jaFeito) {
      console.log('  ' + f.alvo.uid.slice(0, 8) + ' | já apagado numa passada anterior — pulando');
      return;
    }
    console.log('  ' + f.alvo.uid.slice(0, 8) + ' | ' + String((f.u && f.u.nome) || '(sem registro)').padEnd(18) +
      ' | ' + String(f.alvo.email).padEnd(24) + ' | papel ' + String((f.u && f.u.role) || '-').padEnd(10) +
      ' | RTDB:' + (f.u ? 'sim' : 'não') + ' Auth:' + (f.conta ? 'sim' : 'não'));
    console.log('       motivo: ' + f.alvo.motivo);
    f.problemas.forEach((p) => console.log('       ⚠ ' + p));
  });

  const bloqueados = fila.filter((f) => f.problemas.length);
  if (bloqueados.length) {
    console.error('\nABORTADO: ' + bloqueados.length + ' alvo(s) com inconsistência. Nada foi apagado.');
    process.exit(1);
  }

  if (!aplicar) {
    console.log('\nSIMULAÇÃO. Nada foi apagado. Rode com --aplicar para executar.');
    process.exit(0);
  }

  // Backup ANTES de qualquer remoção.
  const dir = path.join(root, 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
  const arquivo = path.join(dir, 'logins-removidos-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(arquivo, JSON.stringify({
    em: new Date().toISOString(),
    motivo: 'duplicatas do duplo clique no cadastro (login.html), decisão do usuário em 21/10/2026',
    mantido: {uid: MANTER, registro: usuarios[MANTER]},
    removidos: fila.filter((f) => !f.jaFeito).map((f) => ({
      uid: f.alvo.uid, motivo: f.alvo.motivo, registroRtdb: f.u,
      contaAuth: f.conta ? {email: f.conta.email, criada: f.conta.metadata.creationTime, ultimoAcesso: f.conta.metadata.lastSignInTime} : null
    }))
  }, null, 2), 'utf8');
  console.log('\nBackup: ' + arquivo);

  const pendentes = fila.filter((f) => !f.jaFeito);
  if (!pendentes.length) {
    console.log('\nNada a fazer: todos os alvos já foram apagados.');
    process.exit(0);
  }
  const executar = soUm ? pendentes.slice(0, 1) : pendentes;
  console.log('\n— Apagando ' + executar.length + ' de ' + pendentes.length + ' pendente(s) —');
  for (const f of executar) {
    const uid = f.alvo.uid;
    // Lápide no mesmo padrão da tela, para a exclusão ficar registrada no app.
    const upd = {};
    upd['usuarios/' + uid] = null;
    upd['usuarios_removidos/' + uid + '/nome'] = (f.u && f.u.nome) || null;
    upd['usuarios_removidos/' + uid + '/email'] = (f.u && f.u.email) || f.alvo.email || null;
    upd['usuarios_removidos/' + uid + '/role'] = (f.u && f.u.role) || null;
    upd['usuarios_removidos/' + uid + '/criadoEm'] = (f.u && f.u.created_at) || null;
    upd['usuarios_removidos/' + uid + '/removidoEm'] = new Date().toISOString();
    upd['usuarios_removidos/' + uid + '/removidoPor'] = 'script limpar-logins-duplicados';
    upd['usuarios_removidos/' + uid + '/motivo'] = f.alvo.motivo;
    // Aqui a conta do Auth É apagada, então não fica pendência nenhuma.
    upd['usuarios_removidos/' + uid + '/authPendente'] = false;
    upd['usuarios_removidos/' + uid + '/authApagadoEm'] = new Date().toISOString();
    upd['usuarios_removidos/' + uid + '/authApagadoPor'] = 'script limpar-logins-duplicados';
    await db.ref().update(upd);
    console.log('  RTDB removido + lápide: ' + uid.slice(0, 8));
    if (f.conta) {
      await admin.auth().deleteUser(uid);
      console.log('  conta do Auth apagada:  ' + uid.slice(0, 8));
    }
  }

  // Conferência depois: o que ficou de pé.
  const depois = (await db.ref('usuarios').once('value')).val() || {};
  const contas = [];
  let page;
  do {
    const r = await admin.auth().listUsers(1000, page);
    r.users.forEach((x) => contas.push(x));
    page = r.pageToken;
  } while (page);
  console.log('\n— Conferência —');
  console.log('registros no RTDB: ' + Object.keys(depois).length + ' | contas no Auth: ' + contas.length);
  console.log('login mantido ainda de pé: ' + (depois[MANTER] ? 'SIM (' + depois[MANTER].role + ')' : 'NÃO -- PROBLEMA'));
  executar.forEach((f) => {
    const aindaRtdb = !!depois[f.alvo.uid];
    const aindaAuth = contas.some((c) => c.uid === f.alvo.uid);
    console.log('  ' + f.alvo.uid.slice(0, 8) + ': RTDB ' + (aindaRtdb ? 'AINDA EXISTE' : 'removido') +
      ' | Auth ' + (aindaAuth ? 'AINDA EXISTE' : 'removido'));
  });
  if (soUm && pendentes.length > 1) {
    console.log('\n--so-um: conferido o primeiro. Rode sem --so-um para os outros ' + (pendentes.length - 1) + '.');
  }
  process.exit(0);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
