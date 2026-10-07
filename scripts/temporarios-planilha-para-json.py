#!/usr/bin/env python3
"""Converte a planilha CONVOCAÇÃO_TEMPORÁRIO do RH nos caminhos do banco (rh_temporarios*).

Uso:  python scripts/temporarios-planilha-para-json.py "<planilha.xlsx>" <saida-dir>

Gera em <saida-dir> (NUNCA dentro do repositório: tem CPF, Pix e telefone):
  temporarios-importar.json   -> `firebase database:update / temporarios-importar.json --project prod-kuryos`
  temporarios-esperado.json   -> números que a CALCULADORA da planilha calculou, para o ensaio
                                 (node scripts/ensaio-temporarios-planilha.js <saida-dir>)
Só cria nós novos; não apaga nada. Rodar duas vezes grava os mesmos ids (idempotente)."""
import datetime, json, os, sys, warnings
warnings.filterwarnings('ignore')
import openpyxl

def ymd(d):
    return d.strftime('%Y-%m-%d') if isinstance(d, (datetime.datetime, datetime.date)) else None

def segunda(s):
    d = datetime.date.fromisoformat(s)
    return (d - datetime.timedelta(days=d.weekday())).isoformat()

def txt(v):
    return '' if v is None else str(v).strip()

def main(xlsx, saida):
    os.makedirs(saida, exist_ok=True)
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    up, aviso = {}, []

    # parâmetros e feriados
    p = wb['PARÂMETROS']
    cfg = {'valorHora': p['C3'].value, 'diariaSemana': p['C4'].value, 'diariaSexta': p['C5'].value, 'diariaReduzida': p['C6'].value,
           'valorVT': p['C7'].value, 'horasDia': p['C23'].value, 'horasSexta': p['C24'].value, 'atrasoLimiteHoras': p['C25'].value}
    for k, v in cfg.items():
        up['rh_temporarios_config/' + k] = v
    for r in range(2, 120):
        d, n = ymd(p.cell(r, 5).value), txt(p.cell(r, 6).value)
        if d:
            up['rh_temporarios_config/feriados/' + d] = n or 'Feriado'

    # cadastro
    ids, nome_por_id = {}, {}
    ws = wb['CADASTRO DE TEMP']
    for r in range(3, ws.max_row + 1):
        nome = txt(ws.cell(r, 2).value)
        if not nome:
            continue
        tid = 'T%04d' % (len(ids) + 1)
        ids[nome] = tid
        nome_por_id[tid] = nome
        st = txt(ws.cell(r, 10).value)
        base = 'rh_temporarios/' + tid + '/'
        campos = {'nome': nome, 'idade': ws.cell(r, 3).value, 'endereco': txt(ws.cell(r, 4).value), 'distanciaKm': ws.cell(r, 5).value,
                  'documento': txt(ws.cell(r, 6).value), 'pix': txt(ws.cell(r, 7).value), 'telefone': txt(ws.cell(r, 8).value),
                  'obs': txt(ws.cell(r, 9).value), 'status': 'Ativo' if st == 'Ativo' else 'Inativo', 'origem': 'planilha-2026-10'}
        for k, v in campos.items():
            if v not in (None, ''):
                up[base + k] = v

    def id_de(nome):
        nome = txt(nome)
        if nome not in ids:
            tid = 'T%04d' % (len(ids) + 1)
            ids[nome] = tid
            nome_por_id[tid] = nome
            up['rh_temporarios/' + tid + '/nome'] = nome
            up['rh_temporarios/' + tid + '/status'] = 'Inativo'
            up['rh_temporarios/' + tid + '/origem'] = 'planilha-2026-10'
            aviso.append('nome fora do cadastro (criado Inativo): ' + nome)
        return ids[nome]

    # presença (datas na linha 3, nomes na coluna B)
    ws = wb['LISTA DE PRESENÇA']
    datas = {}
    for c in range(3, ws.max_column + 1):
        d = ymd(ws.cell(3, c).value)
        if d:
            datas[c] = d
    qtd = 0
    for r in range(4, ws.max_row + 1):
        nome = txt(ws.cell(r, 2).value)
        if not nome:
            continue
        for c, d in datas.items():
            v = txt(ws.cell(r, c).value).upper()
            if v in ('OK', 'NC', 'F', 'FA'):
                up['rh_temporarios_presenca/%s/%s' % (d, id_de(nome))] = v
                qtd += 1
            elif v and v not in ('FER', 'C'):
                aviso.append('código desconhecido "%s" em %s %s' % (v, nome, d))

    # atrasos
    ws = wb['DESCONTO']
    for r in range(3, ws.max_row + 1):
        nome, d, h = txt(ws.cell(r, 2).value), ymd(ws.cell(r, 3).value), ws.cell(r, 5).value
        if nome and d and h:
            up['rh_temporarios_atrasos/AT%04d' % (r)] = {'tempId': id_de(nome), 'data': d, 'motivo': txt(ws.cell(r, 4).value), 'horas': h, 'origem': 'planilha-2026-10'}

    # pagamentos
    ws = wb['PAGAMENTOS']
    for r in range(3, ws.max_row + 1):
        nome, d, v, cat = txt(ws.cell(r, 2).value), ymd(ws.cell(r, 3).value), ws.cell(r, 4).value, txt(ws.cell(r, 5).value).upper()
        if nome and d and v:
            reg = {'tempId': id_de(nome), 'data': d, 'valor': v, 'categoria': cat or 'SALARIO', 'semana': segunda(d), 'origem': 'planilha-2026-10'}
            if txt(ws.cell(r, 6).value):
                reg['obs'] = txt(ws.cell(r, 6).value)
            up['rh_temporarios_pagamentos/PG%04d' % (r)] = reg

    # o que a CALCULADORA calculou (para o ensaio)
    ws = wb['CALCULADORA']
    ini = ymd(ws['C3'].value)
    esperado = {'semana': ini, 'horasSexta': ws['C5'].value, 'linhas': {}}
    for r in range(8, ws.max_row + 1):
        nome = txt(ws.cell(r, 2).value)
        if not nome:
            continue
        v = lambda c: ws.cell(r, c).value
        esperado['linhas'][ids.get(nome, nome)] = {'nome': nome, 'diasSegQui': v(6), 'diasSexta': v(7), 'regra': v(8), 'totalDiarias': v(11), 'descVT': v(12),
                                                     'vtAPagar': v(13), 'descAtraso': v(14), 'fechamento': v(15), 'pago': v(16), 'emAberto': v(17)}

    json.dump(up, open(os.path.join(saida, 'temporarios-importar.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    json.dump(esperado, open(os.path.join(saida, 'temporarios-esperado.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    print('temporários: %d · marcações de presença: %d · caminhos a gravar: %d' % (len(ids), qtd, len(up)))
    for a in aviso:
        print('AVISO', a)

if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
