#!/usr/bin/env bash
# Plano 1 (05/10/2026): limpeza de dados na produção, com backup completo antes.
#   1. 5 BOMs duplicados/antigos viram OBSOLETA (EP-00106 x EP-00101). Reversível: o registro e os itens ficam.
#   2. Alocações de linha/rotuladora ainda abertas em OPs já Concluídas (21 OPs) são liberadas.
# A OP 26271/01 já estava "Aguardando Confirmação" quando este script foi gerado: nada a fazer nela.
# Uso (na pasta producao_firebase_FINAL):   bash scripts/aplicar-plano1.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
P=prod-kuryos
D=$(date +%Y%m%d-%H%M)
mkdir -p backups

echo "== Backup completo (bom e ops) =="
firebase database:get /bom --project $P > "backups/bom-antes-plano1-$D.json"
firebase database:get /ops --project $P > "backups/ops-antes-plano1-$D.json"
ls -l "backups/bom-antes-plano1-$D.json" "backups/ops-antes-plano1-$D.json"

echo "== 1. BOMs obsoletos (caminhos planos: só status/motivo/data, itens intactos) =="
firebase database:update /bom scripts/plano1-bom-obsoletos.json --project $P --force

echo "== 2. Alocações abertas em OPs Concluídas =="
firebase database:update /ops scripts/plano1-alocacoes-stale.json --project $P --force

echo "== Conferência =="
firebase database:get /bom/HDR-MISS-0001__v1/status --project $P
firebase database:get /bom/HDR-MISS-0001__V1/status --project $P   # o BOM em uso NÃO muda
firebase database:get /ops/26212-05/abertaLinha --project $P       # deve ser null
echo "Pronto. Para desfazer: restaurar os campos a partir dos backups em backups/ (relatorios/alocacoes-abertas-em-op-concluida-2026-10-05.json lista o que foi liberado)."
