const assert = require('assert');
const path = require('path');
const A = require(path.join(__dirname, 'public', 'shared', 'anexos.js'));

// Nome armazenado: seguro, único pelo horário, com extensão.
assert.strictEqual(A.nomeArmazenado('Balança Mettler #3.jpg', 1000), '1000_Balanca_Mettler__3.jpg');
assert.strictEqual(A.nomeArmazenado('', 5), '5_arquivo');
assert.strictEqual(A.caminho('manipulacao', '26260/01', 'foto.jpg', 7), 'manipulacao/26260-01/7_foto.jpg', 'lote vira chave sem barra');
assert.strictEqual(A.caminho('../x', 'a', 'b.png', 1), 'x/a/1_b.png', 'pasta não sobe diretório');

// Validação por perfil.
const foto = {name: 'p.jpg', size: 3 * 1024 * 1024, type: 'image/jpeg'};
assert.deepStrictEqual(A.validar(foto).erros, []);
assert.match(A.validar({name: 'p.pdf', size: 100, type: 'application/pdf'}).erros[0], /Só imagem/);
assert.strictEqual(A.validar({name: 'p.pdf', size: 100, type: 'application/pdf'}, {perfil: 'documento'}).ok, true);
assert.match(A.validar({name: 'g.jpg', size: 12 * 1024 * 1024, type: 'image/jpeg'}).erros[0], /limite é 10 MB/);
assert.strictEqual(A.validar({name: 'g.pdf', size: 12 * 1024 * 1024, type: 'application/pdf'}, {perfil: 'documento'}).ok, true, 'documento vai até 20 MB');
assert.match(A.validar({name: 'v.jpg', size: 0, type: 'image/jpeg'}).erros[0], /vazio/);
assert.match(A.validar(null).erros[0], /Escolha um arquivo/);

// Tamanho legível e registro.
assert.strictEqual(A.tamanhoLegivel(512), '512 B');
assert.strictEqual(A.tamanhoLegivel(2048), '2 KB');
assert.strictEqual(A.tamanhoLegivel(3.4 * 1024 * 1024), '3.4 MB');
const reg = A.registro(foto, 'manipulacao/x/1_p.jpg', 'https://u', 'Operador João', '2026-09-17T12:00:00Z');
assert.deepStrictEqual(reg, {nomeOriginal: 'p.jpg', caminho: 'manipulacao/x/1_p.jpg', url: 'https://u', bytes: 3145728,
  contentType: 'image/jpeg', enviadoPor: 'Operador João', enviadoEm: '2026-09-17T12:00:00Z'});

// Lista ordenada por envio, ignorando registro sem arquivo.
const l = A.lista({b: {caminho: 'x', enviadoEm: '2026-09-17T13:00:00Z'}, a: {caminho: 'y', enviadoEm: '2026-09-17T12:00:00Z'}, z: {}});
assert.deepStrictEqual(l.map((x) => x.id), ['a', 'b']);

console.log('run_anexos_test.js: OK');
