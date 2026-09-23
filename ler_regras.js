// Lê database.rules.json para os testes. O RTDB aceita linhas de comentário
// "//" nas regras, mas JSON.parse não: tira as linhas inteiras antes de parsear.
const fs = require('node:fs');
const path = require('node:path');

function lerRegras(arquivo = path.join(__dirname, 'database.rules.json')) {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^\s*\/\/.*$/mg, ''));
}

module.exports = {lerRegras};
