/* Pesagens: o que foi pesado no dia e o que ficou para trás (pedido da
   operação, 21/10/2026: "consigo verificar o que pesou no dia, isso ajuda a
   gente ir lá cobrar caso não tenha pesado alguma coisa").

   Regra do usuário: a pesagem tem que acontecer BEM ANTES do envase --
   o ideal é de 3 a 5 dias antes. Então "pendência" é a OP que exige bulk,
   ainda não teve a pesagem concluída e já está perto (ou passou) do envase.

   Duas visões, as duas só leem:
     pesagensDoDia(ops, dia)        parcelas gravadas em
                                    ops/{op}/manipulacao/pesagem/parcelas/{mp}/{id}
     pendencias(ops, grade, hoje)   OPs que deveriam estar pesadas

   Limite conhecido: a grade de programação (programacao/{data}/{hora}/{linha})
   guarda pedido + SKU, não a OP. Quando há várias OPs do mesmo pedido/SKU a
   data de envase é a primeira da grade para todas -- por isso a tela mostra
   "aprox." e quantas OPs dividem a data. Funções puras, sem DOM. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./manipulacao.js'));
  else root.PesagensDia = factory(root.Manipulacao);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Manipulacao) {
  'use strict';

  var IDEAL_DIAS = 3;     // pesagem pronta até 3 dias antes do envase
  var JANELA_DIAS = 5;    // e pode começar até 5 dias antes
  var RETROATIVO_DIAS = 2; // slot da grade mais velho que isto não conta como "envase desta OP"
  var BRT_MS = 3 * 3600 * 1000; // Brasil sem horário de verão desde 2019

  function texto(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function arred(v) { return Math.round(v * 1000) / 1000; }

  // ISO (UTC ou sem fuso) -> 'AAAA-MM-DD' no horário de São Paulo.
  function diaLocal(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    return new Date(t.getTime() - BRT_MS).toISOString().slice(0, 10);
  }
  function horaLocal(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    return new Date(t.getTime() - BRT_MS).toISOString().slice(11, 16);
  }
  function somaDias(dia, n) {
    var d = new Date(dia + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function diasEntre(de, ate) { // ate - de, em dias inteiros
    return Math.round((new Date(ate + 'T12:00:00Z') - new Date(de + 'T12:00:00Z')) / 86400000);
  }

  function aberta(op) { return !!op && op.status !== 'Concluído' && op.status !== 'Cancelado'; }

  /* ── Pesagens do dia ─────────────────────────────────────────────────── */
  function todasParcelas(opKey, op) {
    var pes = op && op.manipulacao && op.manipulacao.pesagem, prev = (op.manipulacao && op.manipulacao.previstos) || {};
    var out = [];
    var parc = (pes && pes.parcelas) || {};
    Object.keys(parc).forEach(function(itemKey) {
      var no = parc[itemKey] || {}, p = prev[itemKey] || {};
      Object.keys(no).forEach(function(id) {
        var x = no[id];
        if (!x || !x.em) return;
        out.push({
          id: id, opKey: opKey, lote: op.lote || opKey, produto: op.produto || '', cliente: op.cliente || '',
          itemKey: itemKey, mpCodigo: texto(x.mpCodigo) || texto(p.mpCodigo) || itemKey, mpNome: texto(p.mpNome),
          unidade: texto(p.unidade) || 'kg', peso: num(x.peso), loteMaterial: texto(x.loteMaterial),
          por: texto(x.por) || '(sem nome)', em: x.em, dia: diaLocal(x.em), hora: horaLocal(x.em),
          fotoUrl: (x.foto && x.foto.url) || '', temFoto: !!(x.foto && x.foto.caminho),
          cancelada: !!x.canceladaEm
        });
      });
    });
    return out;
  }

  function pesagensDoDia(ops, dia) {
    var parcelas = [], porOp = {}, porOperador = {};
    Object.keys(ops || {}).forEach(function(k) {
      todasParcelas(k, ops[k]).forEach(function(p) { if (p.dia === dia) parcelas.push(p); });
    });
    parcelas.sort(function(a, b) { return String(a.em).localeCompare(String(b.em)); });
    var validas = parcelas.filter(function(p) { return !p.cancelada; });
    validas.forEach(function(p) {
      var o = porOperador[p.por] || (porOperador[p.por] = {por: p.por, pesagens: 0, kg: 0, ops: {}, semFoto: 0, primeira: p.hora, ultima: p.hora});
      o.pesagens++; o.kg = arred(o.kg + p.peso); o.ops[p.opKey] = true; if (!p.temFoto) o.semFoto++;
      if (p.hora < o.primeira) o.primeira = p.hora; if (p.hora > o.ultima) o.ultima = p.hora;
      var q = porOp[p.opKey] || (porOp[p.opKey] = {opKey: p.opKey, lote: p.lote, produto: p.produto, cliente: p.cliente, pesagens: 0, kg: 0, mpsNoDia: {}, operadores: {}});
      q.pesagens++; q.kg = arred(q.kg + p.peso); q.mpsNoDia[p.itemKey] = true; q.operadores[p.por] = true;
    });
    var listaOp = Object.keys(porOp).map(function(k) {
      var q = porOp[k], op = ops[k], prev = Object.keys((op.manipulacao && op.manipulacao.previstos) || {});
      var linhas = Manipulacao.linhasPesagem((op.manipulacao && op.manipulacao.previstos) || {}, op.manipulacao && op.manipulacao.pesagem);
      var feitas = linhas.filter(function(l) { return !l.pendente; }).length;
      return {
        opKey: k, lote: q.lote, produto: q.produto, cliente: q.cliente, pesagens: q.pesagens, kg: q.kg,
        mpsNoDia: Object.keys(q.mpsNoDia).length, operadores: Object.keys(q.operadores),
        mpsPrevistas: prev.length, mpsPesadas: feitas, completa: prev.length > 0 && feitas === prev.length,
        estado: Manipulacao.estado(op)
      };
    }).sort(function(a, b) { return String(a.lote).localeCompare(String(b.lote)); });
    var listaOperador = Object.keys(porOperador).map(function(k) {
      var o = porOperador[k]; o.ops = Object.keys(o.ops).length; return o;
    }).sort(function(a, b) { return b.pesagens - a.pesagens || a.por.localeCompare(b.por); });
    return {
      dia: dia, parcelas: parcelas, porOperador: listaOperador, porOp: listaOp,
      totais: {
        pesagens: validas.length, canceladas: parcelas.length - validas.length,
        kg: arred(validas.reduce(function(s, p) { return s + p.peso; }, 0)),
        ops: listaOp.length, operadores: listaOperador.length, semFoto: validas.filter(function(p) { return !p.temFoto; }).length
      }
    };
  }

  /* ── Pendências ──────────────────────────────────────────────────────── */
  // Pesagem concluída = o bulk já passou do "aguardando pesagem".
  function pesagemFeita(op) {
    var st = Manipulacao.estado(op);
    return !!st && st !== 'AGUARDANDO_PESAGEM' && st !== 'CORRECAO_ABERTA';
  }

  // Datas da grade por pedidoKey, só de hoje - RETROATIVO_DIAS em diante.
  function datasDaGrade(grade, hoje, retroativo) {
    var corte = somaDias(hoje, -(retroativo == null ? RETROATIVO_DIAS : retroativo)), por = {};
    Object.keys(grade || {}).forEach(function(dia) {
      if (dia < corte || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
      var horas = grade[dia] || {};
      Object.keys(horas).forEach(function(h) {
        var linhas = horas[h] || {};
        Object.keys(linhas).forEach(function(l) {
          var s = linhas[l], pk = s && texto(s.pedidoKey);
          if (!pk) return;
          (por[pk] = por[pk] || {})[dia] = true;
        });
      });
    });
    Object.keys(por).forEach(function(pk) { por[pk] = Object.keys(por[pk]).sort(); });
    return por;
  }

  /* Situação da OP frente à meta (dias até o envase = d):
       ATRASADA    d <= 0                         envase hoje/passado sem pesagem
       FORA_META   0 < d < ideal                  deveria estar pesada -- cobrar
       NA_JANELA   ideal <= d <= janela           já pode (e deve) pesar
       FUTURA      d > janela                     ainda cedo
       SEM_DATA    não está na grade              PCP ainda não programou */
  function situacao(d, ideal, janela) {
    if (d == null) return 'SEM_DATA';
    if (d <= 0) return 'ATRASADA';
    if (d < ideal) return 'FORA_META';
    if (d <= janela) return 'NA_JANELA';
    return 'FUTURA';
  }

  function pendencias(ops, grade, hoje, opcoes) {
    opcoes = opcoes || {};
    var ideal = opcoes.ideal == null ? IDEAL_DIAS : Number(opcoes.ideal);
    var janela = Math.max(ideal, opcoes.janela == null ? JANELA_DIAS : Number(opcoes.janela));
    var datas = datasDaGrade(grade, hoje, opcoes.retroativoDias);
    var candidatas = Object.keys(ops || {}).filter(function(k) {
      var op = ops[k];
      return aberta(op) && Manipulacao.exigeBulk(op, opcoes.desde) && !pesagemFeita(op);
    });
    // quantas OPs abertas dividem o mesmo pedido/SKU (data da grade é do pedido)
    var dividem = {};
    Object.keys(ops || {}).forEach(function(k) {
      var op = ops[k], pk = texto(op && op.skuPedidoKey);
      if (aberta(op) && pk && Manipulacao.exigeBulk(op, opcoes.desde)) dividem[pk] = (dividem[pk] || 0) + 1;
    });
    var itens = candidatas.map(function(k) {
      var op = ops[k], pk = texto(op.skuPedidoKey), jaEnvasou = num(op.produzidoLinha) > 0 || !!op.setupFim;
      var prev = (op.manipulacao && op.manipulacao.previstos) || {};
      var linhas = Manipulacao.linhasPesagem(prev, op.manipulacao && op.manipulacao.pesagem);
      var feitas = linhas.filter(function(l) { return !l.pendente; }).length;
      var lista = (datas[pk] || []);
      var envase = lista.length ? lista[0] : null;
      var d = envase ? diasEntre(hoje, envase) : null;
      var sit = jaEnvasou ? 'JA_ENVASOU' : situacao(d, ideal, janela);
      return {
        opKey: k, lote: op.lote || k, produto: op.produto || '', cliente: op.cliente || '', status: op.status || '',
        estado: Manipulacao.estado(op), semRegistro: !op.manipulacao,
        mpsPrevistas: linhas.length, mpsPesadas: feitas,
        parcial: feitas > 0 || linhas.some(function(l) { return l.pesado > 0; }),
        envase: envase, diasAteEnvase: d, pesarAte: envase ? somaDias(envase, -ideal) : null,
        situacao: sit, dividemData: pk ? dividem[pk] : 1, linha: op.linha || ''
      };
    }).filter(function(i) { return i.situacao !== 'JA_ENVASOU'; });
    var peso = {ATRASADA: 0, FORA_META: 1, NA_JANELA: 2, FUTURA: 3, SEM_DATA: 4};
    itens.sort(function(a, b) {
      return peso[a.situacao] - peso[b.situacao] || (a.diasAteEnvase == null ? 1e9 : a.diasAteEnvase) - (b.diasAteEnvase == null ? 1e9 : b.diasAteEnvase) || String(a.lote).localeCompare(String(b.lote));
    });
    var cont = {ATRASADA: 0, FORA_META: 0, NA_JANELA: 0, FUTURA: 0, SEM_DATA: 0};
    itens.forEach(function(i) { cont[i.situacao]++; });
    return {itens: itens, contagem: cont, cobrar: cont.ATRASADA + cont.FORA_META, ideal: ideal, janela: janela, hoje: hoje};
  }

  // Texto pronto para colar no WhatsApp/e-mail.
  function textoCobranca(res) {
    var cobrar = res.itens.filter(function(i) { return i.situacao === 'ATRASADA' || i.situacao === 'FORA_META'; });
    if (!cobrar.length) return 'Pesagens em dia: nenhuma OP com envase próximo sem pesagem.';
    var br = function(d) { return d ? d.slice(8) + '/' + d.slice(5, 7) : '—'; };
    return 'Pesagens pendentes (meta: ' + res.ideal + ' dias antes do envase):\n' + cobrar.map(function(i) {
      return '• ' + i.lote + ' ' + i.produto + ' — envase ' + br(i.envase) + (i.situacao === 'ATRASADA' ? ' (HOJE/ATRASADO)' : ' (em ' + i.diasAteEnvase + 'd)') +
        (i.mpsPrevistas ? ' — ' + i.mpsPesadas + '/' + i.mpsPrevistas + ' MPs pesadas' : ' — pesagem não iniciada');
    }).join('\n');
  }

  return {
    IDEAL_DIAS: IDEAL_DIAS, JANELA_DIAS: JANELA_DIAS, diaLocal: diaLocal, horaLocal: horaLocal, somaDias: somaDias, diasEntre: diasEntre,
    pesagensDoDia: pesagensDoDia, pendencias: pendencias, pesagemFeita: pesagemFeita, datasDaGrade: datasDaGrade, situacao: situacao, textoCobranca: textoCobranca
  };
});
