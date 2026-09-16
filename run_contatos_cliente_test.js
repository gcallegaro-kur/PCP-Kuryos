'use strict';
const assert=require('node:assert/strict');
const C=require('./public/shared/contatos-cliente');
const legado={contatoComNome:'Ana',contatoComEmail:'ana@cliente.com',contatoComTelefone:'11',contatoTecNome:'Beto',contatoTecEmail:'beto@cliente.com'};
const migrados=C.lista(legado);
assert.equal(migrados.length,2);assert.equal(C.sugerir(legado,['TECNICO']).nome,'Beto');
const salvo=C.salvar([
 {id:'ana',nome:'Ana',email:'ana@cliente.com',telefone:'11',areas:['COMERCIAL','COMPRAS'],principais:['COMERCIAL','COMPRAS'],observacoes:'Manhã'},
 {id:'bia',nome:'Bia',email:'bia@cliente.com',telefone:'22',areas:['LOGISTICA','FINANCEIRO'],principais:['LOGISTICA'],observacoes:'Recebe cargas'},
 {id:'caio',nome:'Caio',email:'',telefone:'33',areas:['OUTRA'],principais:[],outraArea:'Diretoria',observacoes:''}
]);
assert.equal(salvo.contatosVersao,1);assert.equal(C.sugerir(salvo,['LOGISTICA']).nome,'Bia');
assert.equal(salvo.contatoComNome,'Ana','Espelho legado preserva leitores existentes');
assert.equal(salvo.contatoTecNome,'','Área sem contato deve limpar espelho antigo');
assert.match(C.rotulo(salvo.contatos.caio),/Diretoria/);
assert.throws(()=>C.salvar([{id:'x',nome:'X',areas:[],principais:[]}]),/área/);
assert.throws(()=>C.salvar([{id:'x',nome:'X',email:'errado',areas:['COMERCIAL'],principais:[]}]),/e-mail/);
assert.throws(()=>C.salvar([{id:'x',nome:'X',areas:['OUTRA'],principais:[]}]),/outra área/);
assert.throws(()=>C.salvar([{id:'x',nome:'X',areas:['COMERCIAL'],principais:['COMERCIAL']},{id:'y',nome:'Y',areas:['COMERCIAL'],principais:['COMERCIAL']}]),/somente um/);
const snap=C.snapshot({...salvo.contatos.bia,id:'bia'},{nome:'Bia Souza',email:'novo@cliente.com',telefone:'44'});
salvo.contatos.bia.nome='Cadastro alterado';assert.equal(snap.nome,'Bia Souza');assert.equal(snap.observacoes,'Recebe cargas');
console.log('OK Contatos cliente: legado, múltiplas áreas, principal por área, outra área, validações e snapshot imutável.');
