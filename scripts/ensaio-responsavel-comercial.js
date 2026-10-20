'use strict';
/* Ensaio do responsável comercial contra a base REAL. SOMENTE LEITURA.
 *
 * Lição do MRP (CLAUDE.md): o ensaio com dados reais achou dois defeitos que
 * 46 asserções sintéticas não pegaram. Este roda `cobertura` e `doCliente`
 * nos 60 clientes de produção e confere que nada quebra com o nó de
 * configuração ainda inexistente.
 *
 * Uso: node scripts/ensaio-responsavel-comercial.js */
const path = require('path');
const root = path.resolve(__dirname, '..');
const admin = require(path.join(root, 'functions/node_modules/firebase-admin'));
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(root, 'firebase-service-account.json'))),
  databaseURL: 'https://prod-kuryos-default-rtdb.firebaseio.com',
});
const RC = require(path.join(root, 'public/shared/responsavel-comercial.js'));

(async () => {
  const ler = async (n) => (await admin.database().ref(n).once('value')).val() || {};
  const clientes = await ler('clientes');
  const cfg = await ler('comercial_config');

  const cob = RC.cobertura(clientes, cfg);
  console.log('— Cobertura da carteira —');
  console.log('clientes ativos no cadastro:', cob.totalClientes);
  console.log('com responsável:', cob.atribuidos, '(' + (cob.pctCobertura * 100).toFixed(1) + '%)');
  console.log('sem responsável:', cob.semResponsavel.length);
  console.log('vínculo órfão (responsável removido):', cob.orfaos.length);
  console.log('responsáveis cadastrados:', RC.lista(cfg).length, '| ativos:', RC.ativos(cfg).length);

  // `doCliente` tem de atravessar os 60 registros reais sem lançar, inclusive
  // os 9 com `cadastroIncompleto` e os que têm campo escalar onde se espera objeto.
  let erros = 0;
  Object.keys(clientes).forEach((k) => {
    try {
      const d = RC.doCliente(clientes[k], cfg);
      if (typeof d.atribuido !== 'boolean') throw new Error('atribuido não é booleano');
    } catch (e) { erros++; console.log('  FALHOU em', k, '->', e.message); }
  });
  console.log('registros percorridos sem erro:', Object.keys(clientes).length - erros, 'de', Object.keys(clientes).length);

  // A chave de todo cliente tem de ser aceita pelo caminho plano do update --
  // senão a atribuição em lote falharia justo no cliente de nome esquisito.
  const ruins = Object.keys(clientes).filter((k) => {
    try { RC.atribuir(k, {id: 'rc_teste', nome: 'Teste'}); return false; } catch (e) { return true; }
  });
  console.log('chaves que o update plano recusaria:', ruins.length ? ruins.join(', ') : 'nenhuma');

  if (cob.carteiras.some((c) => c.total)) {
    console.log('\n— Carteiras —');
    cob.carteiras.filter((c) => c.total).forEach((c) => console.log('  ' + c.nome + (c.ativo ? '' : ' (desligado)') + ': ' + c.total));
  }
  if (cob.semResponsavel.length) {
    console.log('\nPrimeiros sem responsável:', cob.semResponsavel.slice(0, 12).join(', ') +
      (cob.semResponsavel.length > 12 ? ' … (+' + (cob.semResponsavel.length - 12) + ')' : ''));
  }
  process.exit(erros || ruins.length ? 1 : 0);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
