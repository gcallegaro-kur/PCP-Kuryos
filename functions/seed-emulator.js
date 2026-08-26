// -*- coding: utf-8 -*-
//
// Ferramenta de desenvolvimento local (Fase 0 do ERP unificado). NÃO É UMA
// CLOUD FUNCTION -- não é exportado em index.js, não é implantado (está na
// lista "ignore" de functions em firebase.json). Só roda contra os
// emuladores locais do Firebase, nunca contra prod-kuryos: os dois
// require() abaixo de FIRESTORE_EMULATOR_HOST-equivalentes (as env vars
// *_EMULATOR_HOST) são o que faz o Admin SDK falar com localhost em vez da
// nuvem -- sem elas, este script escreveria direto em produção, por isso a
// checagem de segurança logo no início.
//
// Uso (com `firebase emulators:start` já rodando numa outra janela):
//   cd producao_firebase_FINAL/functions
//   node seed-emulator.js
//
// Cria: 1 usuário de teste (admin) no Auth emulator + usuarios/{uid} com
// role admin, e um config/ mínimo. Idempotente -- rodar de novo não
// duplica nada, só confirma que já existe.

process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "localhost:9000";

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  console.error("Variáveis de emulador não definidas -- abortando por segurança (evita escrever em produção).");
  process.exit(1);
}

const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "prod-kuryos",
  databaseURL: "http://localhost:9000/?ns=prod-kuryos",
});

const TEST_EMAIL = "teste@kuryos.local";
const TEST_PASSWORD = "kuryos-teste-123";
const TEST_NOME = "Admin de Teste (local)";

async function main() {
  console.log("Conectando nos emuladores: AUTH=%s DATABASE=%s", process.env.FIREBASE_AUTH_EMULATOR_HOST, process.env.FIREBASE_DATABASE_EMULATOR_HOST);

  // 1. Usuário de teste no Auth emulator (cria se não existir).
  let uid;
  try {
    const existing = await admin.auth().getUserByEmail(TEST_EMAIL);
    uid = existing.uid;
    console.log("Usuário de teste já existe: %s (uid=%s)", TEST_EMAIL, uid);
  } catch (e) {
    const created = await admin.auth().createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      displayName: TEST_NOME,
    });
    uid = created.uid;
    console.log("Usuário de teste criado: %s (uid=%s)", TEST_EMAIL, uid);
  }

  // 2. usuarios/{uid} com role admin -- sem isso o auth_check.js bloqueia
  //    a página inteira (role 'pending'/ausente redireciona pro login).
  const db = admin.database();
  await db.ref("usuarios/" + uid).update({
    nome: TEST_NOME,
    email: TEST_EMAIL,
    role: "admin",
    created_at: new Date().toISOString(),
  });
  console.log("usuarios/%s marcado como role=admin.", uid);

  // 3. config/ mínimo -- categoriasProduto (regra de SKU) e emailNotificacoes
  //    vazio (evita tentativa de e-mail real durante teste local).
  const configSnap = await db.ref("config").once("value");
  if (!configSnap.exists()) {
    await db.ref("config").set({
      categoriasProduto: [
        { nome: "BODY SPLASH", codigo: "BSPL" },
        { nome: "PERFUME", codigo: "PRF" },
        { nome: "HIDRATANTE", codigo: "HIDR" },
      ],
      emailNotificacoes: [],
    });
    console.log("config/ inicial criado (categoriasProduto de exemplo).");
  } else {
    console.log("config/ já existe, não sobrescrevi.");
  }

  console.log("\nPronto. Login local:");
  console.log("  email:    " + TEST_EMAIL);
  console.log("  senha:    " + TEST_PASSWORD);
  console.log("  Auth UI:  http://localhost:4000/auth");
  console.log("  DB UI:    http://localhost:4000/database");
  process.exit(0);
}

main().catch(function (err) {
  console.error("Falha ao semear o emulador:", err);
  process.exit(1);
});
