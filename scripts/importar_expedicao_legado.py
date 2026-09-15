# -*- coding: utf-8 -*-
"""Importa a aba EXPEDICAO da planilha "Controle de Entradas, Saidas e Estoque"
para o Firebase: saldo de produto acabado vira palete legado, e o que ja saiu
vira historico so-leitura.

POR QUE ESTE SCRIPT EXISTE
  A planilha e, hoje, a fonte mais confiavel do PCP sobre o que foi de fato
  expedido por item, OP e pedido. A Expedicao do sistema so enxerga palete
  nascido de Conferencia de PA, e o fluxo de conferencia e PROSPECTIVO (corte
  em 2026-09-10) -- entao nada do passado existe la.

RE-EXECUCAO
  O usuario avisou que vai repetir a carga com dados mais novos. Por isso toda
  chave e DETERMINISTICA: sai de um hash do conteudo identificador da linha,
  nao da posicao dela na planilha. Rodar de novo com a planilha atualizada
  ATUALIZA o que ja existe e acrescenta o que e novo, sem duplicar, mesmo que
  as linhas tenham sido reordenadas.

O QUE NAO FAZ
  Nao inventa conferencia nem laudo de Qualidade. O palete legado entra com
  status LEGADO_ESTOQUE e origemTipo 'legado_planilha'; quem dispensa os dois
  portoes e o ExpedicaoPA.analisar, explicitamente e so para essa origem.

USO
  python scripts/importar_expedicao_legado.py                 # simulacao
  python scripts/importar_expedicao_legado.py --aplicar       # grava
"""
import argparse
import collections
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl nao instalado: pip install openpyxl")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANILHA_PADRAO = os.path.abspath(os.path.join(
    RAIZ, "..", "Refs", "Controle de Entradas, Saidas e Estoque.xlsx"))
ABA = "EXPEDIÇÃO"
PRIMEIRA_LINHA_DADOS = 5
ENDERECO_LEGADO = "HISTORICO"
ORIGEM = "Controle de Entradas, Saidas e Estoque.xlsx#EXPEDICAO"

# Colunas da aba, 0-indexadas. A coluna A e vazia; o cabecalho esta na linha 4.
C_NF, C_STATUS, C_CLIENTE, C_SKU, C_PRODUTO, C_LOTE, C_DATA_FAB = 1, 2, 3, 4, 5, 6, 7
C_CAIXAS, C_MULTIPLO, C_UNIDADES, C_KG_CX, C_CARGA = 8, 9, 10, 11, 12
C_DATA_STK, C_DIAS_STK, C_DATA_EXP = 13, 14, 15
C_TRANSP, C_MOTORISTA, C_CONTATO, C_PLACA, C_DOC, C_OBS = 16, 17, 18, 19, 20, 21


def chave_item(v):
    """Mesma normalizacao de ExpedicaoPA.key -- os dois PRECISAM concordar,
    senao o palete e gravado num itemKey que a tela nunca procura."""
    s = str(v or "").strip()
    s = re.sub(r"[./\[\]#$]", "-", s)
    s = re.sub(r"\s+", "_", s)
    return s[:60]


def texto(v):
    if v is None:
        return ""
    return str(v).strip()


def data_iso(v):
    t = texto(v)
    if not t:
        return None
    return t[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", t) else t


def numero(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n


def inteiro(v):
    n = numero(v)
    return int(round(n)) if n is not None else None


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(c) != "Mn")


def classificar(status):
    """A planilha usa '1) Em estoque', '2) Expedido', 'x) Furto'..."""
    s = sem_acento(texto(status)).upper()
    if s.startswith("1"):
        return "ESTOQUE"
    if s.startswith("2"):
        return "EXPEDIDO"
    if s.startswith("3"):
        return "DEVOLUCAO"
    if s.startswith("4"):
        return "RETRABALHO"
    if s.startswith("X"):
        return "FURTO"
    return "SEM_STATUS"


def ler_no(no):
    """Le um no do RTDB pelo firebase CLI ja autenticado."""
    p = subprocess.run(
        ["firebase", "database:get", "/" + no, "--project", "prod-kuryos"],
        capture_output=True, text=True, encoding="utf-8", shell=True)
    linhas = [l for l in (p.stdout or "").splitlines()
              if not re.match(r"^\s*(\(node:|at |Deprecation|Use `node)", l)]
    corpo = "\n".join(linhas).strip()
    if not corpo:
        sys.exit("Nao consegui ler /%s. Confira 'firebase login:list'.\n%s" % (no, p.stderr[:400]))
    return json.loads(corpo) or {}


def indice_pedidos(pedidos):
    """(id sem zero a esquerda, SKU maiusculo) -> chave real em /pedidos.

    Existe porque o skuPedidoKey gravado nas OPs usa o numero do pedido SEM
    zero a esquerda ('17__PRF-AFEE-0006') e /pedidos guarda COM ('0017__...').
    Essa unica diferenca respondia por 51 dos 66 vinculos que pareciam
    perdidos."""
    idx = {}
    for k, v in pedidos.items():
        v = v or {}
        pid = str(v.get("id") or k.split("__")[0])
        sku = str(v.get("sku") or k.rpartition("__")[2]).upper()
        idx.setdefault((pid.lstrip("0") or "0", sku), k)
    return idx


def resolver_pedido(spk, pedidos, idx):
    if not spk:
        return None
    if spk in pedidos:
        return spk
    pre, _, sku = spk.rpartition("__")
    return idx.get((pre.lstrip("0") or "0", sku.upper()))


def identidade(linha):
    """Hash estavel do que identifica a linha. Nao inclui posicao na planilha,
    entao reordenar nao cria registro novo."""
    partes = [texto(linha[c]) for c in
              (C_LOTE, C_SKU, C_CAIXAS, C_MULTIPLO, C_UNIDADES, C_DATA_FAB,
               C_STATUS, C_NF, C_DATA_EXP)]
    return hashlib.sha1("|".join(partes).encode("utf-8")).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--planilha", default=PLANILHA_PADRAO)
    ap.add_argument("--aplicar", action="store_true",
                    help="grava no Firebase; sem isso, so simula")
    ap.add_argument("--saida", default=os.path.join(RAIZ, "importacao_legado"))
    args = ap.parse_args()

    if not os.path.exists(args.planilha):
        sys.exit("Planilha nao encontrada: %s" % args.planilha)
    os.makedirs(args.saida, exist_ok=True)

    print("Lendo %s" % args.planilha)
    wb = openpyxl.load_workbook(args.planilha, data_only=True, read_only=True)
    if ABA not in wb.sheetnames:
        sys.exit("Aba %r nao encontrada. Abas: %s" % (ABA, wb.sheetnames))
    linhas = [r for r in wb[ABA].iter_rows(min_row=PRIMEIRA_LINHA_DADOS, values_only=True)
              if any(c not in (None, "") for c in r)]
    print("  %d linhas com dado" % len(linhas))

    print("Lendo a base de producao...")
    ops = ler_no("ops")
    pedidos = ler_no("pedidos")
    conferencias = ler_no("conferencias_pa")
    idx = indice_pedidos(pedidos)
    print("  %d OPs, %d pedidos, %d conferencias de PA" % (len(ops), len(pedidos), len(conferencias)))

    # OPs com conferencia ABERTA no sistema ficam de fora do palete legado.
    # Motivo concreto: conferencia_pa.js bloqueia a finalizacao se ja existirem
    # paletes daquela OP no WMS ("faca a conciliacao do legado") -- e essa
    # ferramenta de conciliacao nao existe. Importar aqui TRAVARIA a conferencia
    # de vez. O fluxo real e quem deve criar esses paletes.
    em_conferencia = {k for k, c in conferencias.items()
                      if c and not c.get("finalizadoEm")}
    if em_conferencia:
        print("  conferencia em andamento (palete legado sera pulado): %s"
              % ", ".join(sorted(em_conferencia)))

    updates = {}
    relatorio = []
    contagem = collections.Counter()
    vistos = set()
    cargas = collections.defaultdict(lambda: {"itens": {}, "meta": None})

    # ── Fase 1: ler cada linha ─────────────────────────────────────────────
    regs = []
    for linha in linhas:
        sku = texto(linha[C_SKU])
        lote_planilha = texto(linha[C_LOTE])
        op_key = lote_planilha.replace("/", "-") if lote_planilha else ""
        op = ops.get(op_key) or {}
        spk = op.get("skuPedidoKey")
        pedido_key = resolver_pedido(spk, pedidos, idx)
        pedido = pedidos.get(pedido_key) or {}

        if not op_key or op_key == "-":
            motivo = "Sem lote informado na planilha"
        elif not op:
            motivo = "OP %s nao existe no sistema" % op_key
        elif not spk:
            motivo = "OP sem skuPedidoKey"
        elif not pedido_key:
            motivo = "Pedido %s nao encontrado" % spk
        else:
            motivo = ""

        tipo = classificar(linha[C_STATUS])
        ident = identidade(linha)
        # Duas linhas identicas em tudo sao dois registros reais; desempata.
        seq = 0
        while (ident, seq) in vistos:
            seq += 1
        vistos.add((ident, seq))
        sufixo = ident if seq == 0 else "%s_%d" % (ident, seq)

        unidades = inteiro(linha[C_UNIDADES])
        caixas = inteiro(linha[C_CAIXAS])
        multiplo = inteiro(linha[C_MULTIPLO])
        contagem[tipo] += 1
        contagem["com_pedido" if not motivo else "sem_pedido"] += 1

        rel = {
            "status_planilha": texto(linha[C_STATUS]), "tipo": tipo,
            "cliente": texto(linha[C_CLIENTE]), "sku": sku,
            "produto": texto(linha[C_PRODUTO]), "lote": lote_planilha,
            "caixas": caixas, "multiplo": multiplo, "unidades": unidades,
            "nf": texto(linha[C_NF]), "data_expedicao": data_iso(linha[C_DATA_EXP]),
            "pedido": pedido_key or "", "vinculo_pendente": "SIM" if motivo else "",
            "motivo": motivo, "chave": sufixo, "caixa_parcial": "",
        }
        relatorio.append(rel)

        if unidades is None or unidades <= 0:
            contagem["ignoradas_sem_unidades"] += 1
            continue

        regs.append({
            "linha": linha, "sku": sku, "lote": lote_planilha, "op_key": op_key,
            "spk": spk, "pedido_key": pedido_key, "pedido": pedido, "motivo": motivo,
            "tipo": tipo, "sufixo": sufixo, "unidades": unidades, "caixas": caixas,
            "multiplo": multiplo, "rel": rel, "parcial": None, "anexada_a": None,
            "avulsa": False, "multiplo_op": None,
        })

    # ── Fase 2: caixa parcial vai para o palete ────────────────────────────
    # A planilha registra a caixa parcial como LINHA PROPRIA (1 cx cujo
    # "multiplo" e a quantidade solta: '1 cx x 10' ao lado de '88 cx x 24'),
    # e cada linha virava um palete. Fisicamente a parcial fica NO palete.
    # Regras decididas pelo usuario em 2026-09-14:
    #   - parcial = 1 caixa com multiplo MENOR que o da OP; mais de 1 caixa
    #     com multiplo menor e mudanca de formato, fica como palete proprio;
    #   - vai para o palete da mesma OP com o mesmo status, data de expedicao
    #     e NF -- o que nao saiu junto nao e juntado;
    #   - com 2+ candidatos, vai para o de MENOS caixas (o palete incompleto,
    #     que e onde a sobra fica); desempate pela chave, que e estavel;
    #   - sem candidato, fica como linha propria marcada caixa parcial avulsa;
    #   - vale para estoque e para o historico expedido.
    por_op = collections.defaultdict(list)
    for r in regs:
        if r["op_key"] and r["op_key"] != "-":
            por_op[(r["op_key"], r["sku"])].append(r)
    for grupo_op in por_op.values():
        mults = [r["multiplo"] for r in grupo_op if r["multiplo"]]
        if not mults:
            continue
        mx = max(mults)
        for r in grupo_op:
            r["multiplo_op"] = mx
        parciais = [r for r in grupo_op if r["multiplo"] and r["multiplo"] < mx and r["caixas"] == 1]
        inteiros = [r for r in grupo_op if r not in parciais]
        for p in sorted(parciais, key=lambda x: x["sufixo"]):
            def mesma_saida(h):
                return (texto(h["linha"][C_STATUS]) == texto(p["linha"][C_STATUS])
                        and data_iso(h["linha"][C_DATA_EXP]) == data_iso(p["linha"][C_DATA_EXP])
                        and texto(h["linha"][C_NF]) == texto(p["linha"][C_NF]))
            candidatos = sorted((h for h in inteiros if mesma_saida(h) and h["parcial"] is None),
                                key=lambda h: (h["caixas"] or 0, h["sufixo"]))
            if candidatos:
                host = candidatos[0]
                host["parcial"] = p
                p["anexada_a"] = host
                p["rel"]["caixa_parcial"] = "SOMADA AO PALETE " + host["sufixo"]
                host["rel"]["caixa_parcial"] = "RECEBEU PARCIAL " + p["sufixo"]
                contagem["parciais_somadas"] += 1
            else:
                p["avulsa"] = True
                p["rel"]["caixa_parcial"] = "AVULSA"
                contagem["parciais_avulsas"] += 1

    # ── Fase 3: montar o que grava ─────────────────────────────────────────
    remover = {}  # caminho -> None: registro de parcial gravado por carga anterior
    for r in regs:
        if r["anexada_a"] is not None:
            # A parcial agora mora no palete. O registro proprio que uma carga
            # ANTERIOR criou para ela precisa sair, senao a unidade conta duas
            # vezes. Carga com NF e regravada inteira (o item some sozinho);
            # sem NF, a parcial tinha carga avulsa propria.
            if r["tipo"] == "ESTOQUE":
                remover["estoque_lotes/%s/LEG_%s" % (chave_item(r["sku"]), r["sufixo"])] = None
            elif not texto(r["linha"][C_NF]):
                remover["expedicoes_comerciais/LEG_AVULSA_" + r["sufixo"]] = None
            continue

        linha, p = r["linha"], r["parcial"]
        caixas, multiplo, unidades = r["caixas"], r["multiplo"], r["unidades"]
        parcial_un = None
        peso = numero(linha[C_CARGA])
        if p is not None:
            parcial_un = p["unidades"]
            unidades = unidades + parcial_un
            peso_p = numero(p["linha"][C_CARGA])
            peso = (peso or 0) + (peso_p or 0) if (peso is not None or peso_p is not None) else None
        elif r["avulsa"]:
            # Uma caixa incompleta sozinha: zero fechadas, a quantidade solta
            # como parcial e o multiplo real da caixa da OP.
            caixas, multiplo, parcial_un = 0, r["multiplo_op"], unidades

        comum = {
            "legado": True, "origemTipo": "legado_planilha", "origemRef": ORIGEM,
            "itemCodigo": r["sku"], "itemNome": texto(linha[C_PRODUTO]) or None, "unidade": "un",
            "cliente": texto(linha[C_CLIENTE]) or None,
            "opKey": r["op_key"] or None, "opLote": r["lote"] or None,
            "loteOrigem": r["lote"] or None,
            # skuPedidoKey guarda a chave RECONSTRUIDA (a que existe em
            # /pedidos). A crua da OP fica em skuPedidoKeyOrigem, que e o que o
            # portao de "vinculo mudou" compara contra a OP.
            "skuPedidoKey": r["pedido_key"] or r["spk"] or None,
            "skuPedidoKeyOrigem": r["spk"] or None, "pedidoKey": r["pedido_key"],
            "pedidoId": r["pedido"].get("parentPedidoId") or r["pedido"].get("id"),
            "vinculoPendente": bool(r["motivo"]), "vinculoMotivo": r["motivo"] or None,
            "caixasFechadas": caixas, "unidadesPorCaixa": multiplo,
            "unidadesCaixaParcial": parcial_un,
            "caixaParcialAvulsa": True if r["avulsa"] else None,
            # Rastro da linha da planilha que virou a parcial deste palete.
            "parcialDaPlanilha": ({"chave": p["sufixo"], "unidades": p["unidades"],
                                   "pesoKg": numero(p["linha"][C_CARGA])} if p is not None else None),
            # Peso vale para os DOIS lados, nao so para o palete em estoque:
            # o relatorio gerencial soma carga por cliente e por transportadora.
            "pesoPorCaixaKg": numero(linha[C_KG_CX]), "pesoTotalKg": peso,
            "dataFabricacao": data_iso(linha[C_DATA_FAB]),
            "importadoEm": None,
        }
        sufixo, tipo, op_key = r["sufixo"], r["tipo"], r["op_key"]
        rotulo_id = "LEG-%s-%s%s" % (r["lote"] or "SEMLOTE", "PARC-" if r["avulsa"] else "", sufixo[:6])

        if tipo == "ESTOQUE" and op_key in em_conferencia:
            contagem["estoque_pulado_em_conferencia"] += 1
            r["rel"]["motivo"] = (r["rel"]["motivo"] + " | " if r["rel"]["motivo"] else "") + \
                "Palete NAO importado: OP %s tem conferencia de PA em andamento" % op_key
            continue

        if tipo == "ESTOQUE":
            palete = dict(comum)
            palete.update({
                "itemTipo": "produto", "status": "LEGADO_ESTOQUE",
                "identificadorPalete": rotulo_id,
                "saldoLote": unidades, "qtdOriginal": unidades,
                "enderecoKey": ENDERECO_LEGADO, "enderecoCodigo": ENDERECO_LEGADO,
                "dataEntradaEstoque": data_iso(linha[C_DATA_STK]),
                "conferencia": None, "qualidade": None, "validade": None,
            })
            updates["estoque_lotes/%s/LEG_%s" % (chave_item(r["sku"]), sufixo)] = palete
            contagem["paletes_legado"] += 1
        else:
            # Uma carga por (NF, data, cliente). Sem NF, a propria linha vira
            # carga -- e o que a planilha permite afirmar.
            nf = texto(linha[C_NF])
            grupo = ("NF_" + re.sub(r"[^A-Za-z0-9_-]", "_", nf) + "_" + (data_iso(linha[C_DATA_EXP]) or "SEMDATA")
                     if nf else "AVULSA_" + sufixo)
            carga = cargas[grupo]
            item = dict(comum)
            item.update({"qtd": unidades, "descricao": texto(linha[C_PRODUTO]),
                         "sku": r["sku"], "identificadorPalete": "LEG-%s%s" % ("PARC-" if r["avulsa"] else "", sufixo[:8]),
                         "paleteOrigem": {"saldoLote": unidades, "caixasFechadas": caixas,
                                          "unidadesPorCaixa": multiplo, "unidadesCaixaParcial": parcial_un},
                         "pedidoNumero": (r["pedido"].get("id") or r["pedido_key"] or "")})
            carga["itens"]["LEG_" + sufixo] = item
            if carga["meta"] is None:
                carga["meta"] = {
                    "tipo": tipo, "nf": nf, "cliente": texto(linha[C_CLIENTE]),
                    "data": data_iso(linha[C_DATA_EXP]) or data_iso(linha[C_DATA_FAB]),
                    "transportadora": texto(linha[C_TRANSP]), "motorista": texto(linha[C_MOTORISTA]),
                    "contatoMotorista": texto(linha[C_CONTATO]), "placa": texto(linha[C_PLACA]).upper(),
                    "documentoMotorista": texto(linha[C_DOC]), "observacoes": texto(linha[C_OBS]),
                }

    agora = None
    # Rotulo aparece na tela e nos filtros do relatorio: acentuado, como a
    # pessoa escreveria ao procurar.
    ROTULO = {"EXPEDIDO": "Expedido (legado)", "FURTO": "Furto (legado)",
              "DEVOLUCAO": "Devolução (legado)", "RETRABALHO": "Retrabalho (legado)",
              "SEM_STATUS": "Sem status (legado)"}
    for grupo, carga in cargas.items():
        m = carga["meta"]
        itens = carga["itens"]
        updates["expedicoes_comerciais/LEG_" + grupo] = {
            # versao != 2 de proposito: a aba Expedidos rotula esses registros
            # como legado em vez de tratar como carga do fluxo novo.
            "legado": True, "origemRef": ORIGEM,
            "numero": "LEG-" + grupo, "nf": m["nf"] or None,
            "status": ROTULO.get(m["tipo"], "Legado"), "tipoLegado": m["tipo"],
            "cliente": m["cliente"] or None, "data": m["data"],
            "transportadora": m["transportadora"] or None, "motorista": m["motorista"] or None,
            "contatoMotorista": m["contatoMotorista"] or None, "placa": m["placa"] or None,
            "documentoMotorista": m["documentoMotorista"] or None,
            "observacoes": m["observacoes"] or None,
            "itens": itens, "totalPaletes": len(itens),
            "totalUnidades": sum(i["qtd"] for i in itens.values()),
            "criadoEm": m["data"], "criadoPor": "Importacao da planilha de Expedicao",
        }
    contagem["cargas_historico"] = len(cargas)
    # Uma remocao nunca pode apagar o que esta carga acabou de escrever.
    for caminho in remover:
        if caminho not in updates:
            updates[caminho] = None
    contagem["registros_de_parcial_removidos"] = sum(1 for c in remover if c in updates)

    # Endereco unico do legado. Criado aqui para a importacao nao depender de
    # alguem lembrar de cadastrar antes -- sem ele, todo palete cairia em
    # "Aguardando endereco definitivo ativo".
    updates["enderecos_estoque/" + ENDERECO_LEGADO] = {
        "codigo": ENDERECO_LEGADO, "area": "GALPAO", "sigla": "LEG", "ativo": True,
        "rua": 999, "predio": 999, "nivel": 999, "legado": True,
        "observacao": "Posicao unica do estoque importado da planilha. Reenderece pelo WMS conforme conferir o fisico.",
        "criadoPor": "Importacao da planilha de Expedicao",
    }

    # Estado ATUAL dos caminhos que esta carga toca. Serve a duas coisas:
    #   1. palete legado que ja foi mexido no sistema (reenderecado, expedido,
    #      saldo alterado) NAO e sobrescrito nem apagado -- regravar zeraria o
    #      que a operacao fez. Se o palete que recebe uma parcial foi mexido,
    #      a parcial antiga tambem fica onde esta, para nao sumir unidade;
    #   2. o rollback vira BACKUP de verdade: restaura o valor anterior de cada
    #      caminho, inclusive o registro de parcial que esta carga remove.
    #      Null nos caminhos gravados nao bastava depois que passou a haver
    #      remocao.
    atual_lotes = ler_no("estoque_lotes")
    atual_cargas = ler_no("expedicoes_comerciais")

    def valor_atual(caminho):
        partes = caminho.split("/")
        if partes[0] == "estoque_lotes" and len(partes) == 3:
            return ((atual_lotes or {}).get(partes[1]) or {}).get(partes[2])
        if partes[0] == "expedicoes_comerciais" and len(partes) == 2:
            return (atual_cargas or {}).get(partes[1])
        return None

    def mexido(v):
        return bool(v) and bool(v.get("legado")) and (
            bool(v.get("expedicaoId")) or v.get("status") != "LEGADO_ESTOQUE"
            or v.get("enderecoKey") != ENDERECO_LEGADO
            or v.get("saldoLote") != v.get("qtdOriginal"))

    preservados = []
    for caminho in [c for c in updates if c.startswith("estoque_lotes/")]:
        if mexido(valor_atual(caminho)):
            preservados.append(caminho)
            del updates[caminho]
    for r in regs:
        host = r["anexada_a"]
        if host is not None and r["tipo"] == "ESTOQUE":
            caminho_host = "estoque_lotes/%s/LEG_%s" % (chave_item(host["sku"]), host["sufixo"])
            caminho_parcial = "estoque_lotes/%s/LEG_%s" % (chave_item(r["sku"]), r["sufixo"])
            if caminho_host in preservados and updates.get(caminho_parcial, 0) is None:
                del updates[caminho_parcial]
    contagem["preservados_mexidos_no_sistema"] = len(preservados)
    for c in preservados:
        print("  PRESERVADO (ja mexido no sistema): %s" % c)

    caminho_payload = os.path.join(args.saida, "payload.json")
    with open(caminho_payload, "w", encoding="utf-8") as f:
        json.dump(updates, f, ensure_ascii=False, indent=1)
    # O endereco HISTORICO fica de fora do backup: se algum palete ja tiver
    # sido reenderecado ou expedido, apagar o endereco quebraria registro
    # legitimo.
    caminho_rollback = os.path.join(args.saida, "rollback.json")
    with open(caminho_rollback, "w", encoding="utf-8") as f:
        json.dump({k: valor_atual(k) for k in updates if not k.startswith("enderecos_estoque/")},
                  f, ensure_ascii=False, indent=1)

    caminho_rel = os.path.join(args.saida, "relatorio.csv")
    with open(caminho_rel, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(relatorio[0].keys()))
        w.writeheader()
        w.writerows(relatorio)

    print("\n=== RESUMO ===")
    for k in ["ESTOQUE", "EXPEDIDO", "FURTO", "DEVOLUCAO", "RETRABALHO", "SEM_STATUS"]:
        if contagem[k]:
            print("  %-22s %5d" % (k, contagem[k]))
    print("  %-22s %5d" % ("com pedido", contagem["com_pedido"]))
    print("  %-22s %5d" % ("vinculo pendente", contagem["sem_pedido"]))
    print("  %-22s %5d" % ("paletes legado", contagem["paletes_legado"]))
    print("  %-22s %5d" % ("cargas de historico", contagem["cargas_historico"]))
    print("  %-22s %5d  (somadas ao palete da mesma OP e saida)" % ("parciais somadas", contagem["parciais_somadas"]))
    print("  %-22s %5d  (sem palete correspondente; linha propria)" % ("parciais avulsas", contagem["parciais_avulsas"]))
    print("  %-22s %5d  (registro proprio de parcial de carga anterior)" % ("removidos", contagem["registros_de_parcial_removidos"]))
    if contagem["preservados_mexidos_no_sistema"]:
        print("  %-22s %5d  (paletes ja mexidos no sistema, nao regravados)"
              % ("preservados", contagem["preservados_mexidos_no_sistema"]))
    if contagem["ignoradas_sem_unidades"]:
        print("  %-22s %5d" % ("sem unidades (fora)", contagem["ignoradas_sem_unidades"]))
    if contagem["estoque_pulado_em_conferencia"]:
        print("  %-22s %5d  (OP em conferencia; o fluxo real cria esses)"
              % ("estoque pulado", contagem["estoque_pulado_em_conferencia"]))
    print("\n  payload  : %s (%d caminhos)" % (caminho_payload, len(updates)))
    print("  relatorio: %s" % caminho_rel)

    if not args.aplicar:
        print("\nSIMULACAO. Nada foi gravado. Para gravar, rode de novo com --aplicar")
        return

    print("\nGravando no Firebase...")
    p = subprocess.run(["firebase", "database:update", "/", caminho_payload,
                        "--project", "prod-kuryos", "--force"],
                       capture_output=True, text=True, encoding="utf-8", shell=True)
    print((p.stdout or "") + (p.stderr or ""))
    if p.returncode != 0:
        sys.exit("Falhou. Nada garantido gravado; o payload continua em %s" % caminho_payload)
    print("Concluido.")


if __name__ == "__main__":
    main()
