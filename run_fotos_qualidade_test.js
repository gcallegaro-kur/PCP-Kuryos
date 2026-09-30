/* Fotos nas análises da Qualidade: limite de 6, reprovação exige foto (com a
   saída "não há o que fotografar"), caminho e registro, envio ao Storage. */
const assert = require('assert');
const F = require('./public/shared/fotos-qualidade.js');

// ── Limite de 6 ────────────────────────────────────────────────────────
assert.strictEqual(F.MAX_FOTOS, 6);
assert.deepStrictEqual(F.podeAdicionar(0, 3), {ok: true, aceitas: 3, erro: null});
assert.deepStrictEqual(F.podeAdicionar(4, 2), {ok: true, aceitas: 2, erro: null});
let lim = F.podeAdicionar(4, 5);
assert.strictEqual(lim.aceitas, 2, 'cabem só mais 2');
assert.match(lim.erro, /Só cabem mais 2 fotos/);
lim = F.podeAdicionar(5, 3);
assert.strictEqual(lim.aceitas, 1);
assert.match(lim.erro, /Só cabem mais 1 foto \(/);
lim = F.podeAdicionar(6, 1);
assert.strictEqual(lim.ok, false);
assert.match(lim.erro, /Limite de 6/);

// ── Reprovação exige foto; só reprovação ───────────────────────────────
assert.strictEqual(F.exigencia('REPROVADO', 0, false).ok, false);
assert.match(F.exigencia('REPROVADO', 0, false).erro, /pelo menos uma foto/);
assert.strictEqual(F.exigencia('REPROVAR', 0, false).ok, false, 'análise do bulk usa REPROVAR');
assert.strictEqual(F.exigencia('REPROVADO', 1, false).ok, true);
assert.strictEqual(F.exigencia('REPROVADO', 0, true).ok, true, '"Não há o que fotografar" libera');
for (const d of ['LIBERADO', 'LIBERADO_EXPEDICAO', 'APROVADO_CONCESSAO', 'RETIDO', 'LIBERAR']) {
  assert.strictEqual(F.exigencia(d, 0, false).ok, true, d + ' não exige foto');
}

// ── Lista: aceita objeto do push e array; descarta lixo ─────────────────
assert.deepStrictEqual(F.lista(null), []);
assert.strictEqual(F.lista({a: {url: 'u1'}, b: {caminho: 'c2'}, c: null, d: {}}).length, 2);
assert.strictEqual(F.lista([{url: 'u'}, null, {nada: 1}]).length, 1);

// ── Caminho e registro ─────────────────────────────────────────────────
const c = F.caminho('laudo', 'MPGR-00001_-Lote/1', 'Foto do Lacre ção.jpg', 1000);
assert.match(c, /^qualidade\/laudo_MPGR-00001_-Lote-1\/1000_Foto_do_Lacre_cao\.jpg$/, c);
assert.strictEqual(c.split('/').length, 3, 'um nível só de pasta, como a regra do Storage espera');
const r = F.registro({name: 'a.jpg', size: 1234, type: 'image/jpeg'}, c, 'https://x/y', 'Ana', '  lacre rompido  ', '2026-09-30T10:00:00Z');
assert.strictEqual(r.legenda, 'lacre rompido');
assert.strictEqual(r.enviadoPor, 'Ana');
assert.strictEqual(r.bytes, 1234);
assert.strictEqual(F.registro({name: 'a.jpg', size: 1, type: 'image/jpeg'}, c, 'u', 'Ana', '   ').legenda, null);
assert.strictEqual(F.registro({name: 'a.jpg', size: 1, type: 'image/jpeg'}, c, 'u', 'Ana', 'x'.repeat(200)).legenda.length, F.LEGENDA_MAX);

// ── Envio: sobe todas, devolve registros; nada sobe com arquivo inválido ──
const subidos = [];
const storage = {ref(caminho) {
  return {put(arq, meta) { subidos.push({caminho, tipo: meta.contentType}); return Promise.resolve(); },
    getDownloadURL() { return Promise.resolve('https://storage/' + caminho); }};
}};
const img = (n) => ({name: n, size: 2048, type: 'image/jpeg'});
(async () => {
  assert.deepStrictEqual(await F.enviar(storage, [], {contexto: 'laudo', chave: 'k', autor: 'Ana'}), []);
  const regs = await F.enviar(storage, [{arquivo: img('a.jpg'), legenda: 'frasco amassado'}, {arquivo: img('b.png'), legenda: ''}],
    {contexto: 'laudo', chave: 'EP-1_L1', autor: 'Ana'});
  assert.strictEqual(regs.length, 2);
  assert.strictEqual(regs[0].legenda, 'frasco amassado');
  assert.strictEqual(regs[1].legenda, null);
  assert.ok(regs[0].url.startsWith('https://storage/qualidade/laudo_EP-1_L1/'));
  assert.notStrictEqual(regs[0].caminho, regs[1].caminho, 'cada foto tem o seu arquivo');
  assert.strictEqual(subidos.length, 2);
  // Mais de 6 pendentes: só as 6 primeiras sobem.
  subidos.length = 0;
  const muitas = Array.from({length: 9}, (_, i) => ({arquivo: img('f' + i + '.jpg'), legenda: ''}));
  assert.strictEqual((await F.enviar(storage, muitas, {contexto: 'bulk', chave: 'OP', autor: 'Ana'})).length, 6);
  assert.strictEqual(subidos.length, 6);
  // Arquivo que não é imagem ou é grande demais: rejeita antes de subir qualquer coisa útil.
  subidos.length = 0;
  await assert.rejects(F.enviar(storage, [{arquivo: {name: 'x.pdf', size: 10, type: 'application/pdf'}, legenda: ''}], {contexto: 'laudo', chave: 'k'}), /imagem/i);
  await assert.rejects(F.enviar(storage, [{arquivo: {name: 'g.jpg', size: 20 * 1024 * 1024, type: 'image/jpeg'}, legenda: ''}], {contexto: 'laudo', chave: 'k'}), /limite/i);
  assert.strictEqual(subidos.length, 0);
  console.log('fotos-qualidade: todos os testes passaram');
})().catch(e => { console.error(e); process.exit(1); });
