#!/usr/bin/env bash
# Importa a planilha CONVOCAÇÃO_TEMPORÁRIO do RH para a produção (rh_temporarios*).
# Uso (na pasta producao_firebase_FINAL):   bash scripts/importar-temporarios.sh ["caminho/da/planilha.xlsx"]
# Ensaio sem gravar:                        DRY=1 bash scripts/importar-temporarios.sh
#
# O que faz, nesta ordem, e para se qualquer passo falhar:
#   1. converte a planilha em caminhos do banco (pasta temporária, FORA do repositório: tem CPF e Pix);
#   2. ENSAIO: o motor de pagamento tem que bater 100% com a CALCULADORA da planilha;
#   3. confere que rh_temporarios ainda está VAZIO na produção (não sobrescreve nada; roda uma vez só);
#   4. grava só nós novos (cadastro, presença, atrasos, pagamentos, parâmetros e feriados);
#   5. confere as contagens no banco.
set -euo pipefail
export MSYS_NO_PATHCONV=1                       # o Git Bash não pode reescrever "/" como caminho do Windows
XLSX="${1:-$HOME/Downloads/CONVOCAÇÃO_TEMPORÁRIO 01.xlsx}"
OUT="$(mktemp -d)"
PROJ=prod-kuryos
[ -f "$XLSX" ] || { echo "Planilha não encontrada: $XLSX"; exit 1; }

python scripts/temporarios-planilha-para-json.py "$XLSX" "$OUT"
node scripts/ensaio-temporarios-planilha.js "$OUT" | head -3

atual=$(firebase database:get /rh_temporarios --shallow --project "$PROJ" 2>/dev/null | tr -d '[:space:]')
if [ -n "$atual" ] && [ "$atual" != "null" ]; then
  echo "rh_temporarios já tem dados na produção ($atual). Nada foi gravado."; exit 1
fi

[ "${DRY:-0}" = 1 ] && { echo "DRY=1: tudo certo até aqui; nada foi gravado."; rm -rf "$OUT"; exit 0; }
firebase database:update / "$OUT/temporarios-importar.json" --project "$PROJ" --force >/dev/null 2>&1
echo "Gravado. Conferindo..."
for no in rh_temporarios rh_temporarios_presenca rh_temporarios_atrasos rh_temporarios_pagamentos; do
  n=$(firebase database:get "/$no" --shallow --project "$PROJ" 2>/dev/null | grep -o '"[^"]*":' | wc -l)
  echo "  $no: $n chaves"
done
rm -rf "$OUT"
echo "Pronto. Abra RH › Temporários."
