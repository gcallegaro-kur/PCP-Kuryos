const fs = require('fs');
const {formatarLoteInterno, validarEPrepararLinhas, statusPedidoApos} = require('./functions/recebimento');

if (formatarLoteInterno(2026, 576) !== 'AK-2026-000576') throw new Error('Formato AK incorreto');
if (formatarLoteInterno(2027, 1) !== 'AK-2027-000001') throw new Error('Reinício anual incorreto');

const pedido = {itens:{i1:{materialCodigo:'EP-001',materialNome:'Frasco',unidade:'un',qtd:1000,qtdRecebida:100},i2:{materialCodigo:'MP-001',qtd:50,qtdRecebida:0}}};
const enderecos = {A1:{codigo:'GAL-1.1.1',ativo:true}};
const base = {data:'2026-09-11',notaFiscal:'123',condicoesVeiculo:5,linhas:[
  {itemKey:'i1',tipoMaterial:'EMBALAGEM',identificacaoMaterial:'Frasco',skuFornecedor:'F1',loteOrigem:'EXT-A',qtdRecebida:400,qtdVolumes:4,qtdAmostragem:10,certificadoFornecedor:'SIM',condicoesEmbalagem:5,enderecoKey:'A1'},
  {itemKey:'i1',tipoMaterial:'EMBALAGEM',identificacaoMaterial:'Frasco',skuFornecedor:'F1',loteOrigem:'EXT-B',qtdRecebida:500,qtdVolumes:5,qtdAmostragem:10,certificadoFornecedor:'NAO',condicoesEmbalagem:4,enderecoKey:'A1'}
]};
const preparado = validarEPrepararLinhas(base,pedido,enderecos);
if (preparado.linhas.length !== 2 || preparado.totais.i1 !== 900) throw new Error('Múltiplos lotes externos não foram consolidados por item');
if (preparado.linhas[0].certificadoFornecedor !== true || preparado.linhas[1].certificadoFornecedor !== false) throw new Error('Certificado não normalizado');

let excedeu = false;
try { validarEPrepararLinhas({...base,linhas:[{...base.linhas[0],qtdRecebida:901}]},pedido,enderecos); } catch (e) { excedeu = e.code === 'failed-precondition'; }
if (!excedeu) throw new Error('Saldo excedente do PC foi aceito');
let duplicou = false;
try { validarEPrepararLinhas({...base,linhas:[base.linhas[0],{...base.linhas[0],qtdRecebida:10}]},pedido,enderecos); } catch (e) { duplicou = /repetido/.test(e.message); }
if (!duplicou) throw new Error('Mesmo lote externo duplicado no item foi aceito');
let amostraExcedeu = false;
try { validarEPrepararLinhas({...base,linhas:[{...base.linhas[0],qtdAmostragem:401}]},pedido,enderecos); } catch (e) { amostraExcedeu = /amostragem/.test(e.message); }
if (!amostraExcedeu) throw new Error('Amostragem maior que o lote foi aceita');

const final = statusPedidoApos(pedido.itens,{i1:900,i2:50});
if (final.status !== 'RECEBIDO_TOTAL' || final.novosTotais.i1 !== 1000) throw new Error('Status total incorreto');
const estornado = statusPedidoApos({...pedido.itens,i1:{...pedido.itens.i1,qtdRecebida:1000}},{i1:-500});
if (estornado.status !== 'RECEBIDO_PARCIAL' || estornado.novosTotais.i1 !== 500) throw new Error('Estorno não reabriu saldo');

const index = fs.readFileSync('functions/index.js','utf8');
const tela = fs.readFileSync('public/logistica.html','utf8');
['exports.registrarRecebimento','ServerValue.increment','recebimentos_locks','recebimentos_operacoes','exports.cancelarRecebimento','exports.registrarDevolucaoRecebimento']
  .forEach(s => { if (!index.includes(s)) throw new Error('Proteção server-side ausente: '+s); });
['＋ Outro lote deste material','Gerado automaticamente ao confirmar','Reimprimir etiquetas','Cancelar recebimento','Devolver']
  .forEach(s => { if (!tela.includes(s)) throw new Error('Fluxo operacional ausente: '+s); });
console.log('OK Lote interno: sequência anual, múltiplos lotes, limite do PC, estorno, idempotência e operações pós-recebimento.');
