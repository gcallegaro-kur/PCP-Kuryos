# Gestão de Retrabalhos — modelo solicitado em 22/09/2026

## Objetivo e limite da entrega atual

O usuário corrigiu o escopo: precisa de uma seção própria de **Gestão de
Retrabalhos**, originados em análises da Qualidade e RNCs. Um caso pode gerar
ordens de fabricação, envase e rotulagem, executadas em linha ou posto conforme
o procedimento. A seção publicada no Apontamento é apenas o primeiro controle
de execução; não representa o módulo completo de gestão.

A correção operacional da linha 02 já foi aplicada e conferida. A OP 26160/04,
não iniciada, voltou a Programado e teve os resíduos fictícios removidos com
auditoria. `RT-26216-04-20260921` registra o retrabalho do lote inteiro da OP
26216/04 por sedimentação inesperada do corante, formando precipitado. Setup
em 21/09/2026 15:42, envase 16:00, pausa de fim de turno 17:09 (São Paulo).
Quantidade do período pendente, editável pelo admin; nenhuma quantidade
inventada. OP original concluída e suas 867 unidades preservadas.

## Estrutura funcional proposta

1. **Caso de retrabalho (RT):** origem na RNC e/ou análise da Qualidade;
   referência da OP e lote, produto, cliente, quantidade/escopo afetado,
   diagnóstico, disposição técnica, responsável, prioridade, prazo e evidências.
   Reúne todo o histórico e o resultado final. Pode envolver todo o lote ou
   parte identificada. Não é uma nova OP comercial nem fabricação adicional.
2. **Roteiro aprovado:** lista somente das operações necessárias, com sequência
   ou dependências explícitas e critérios de aceitação. Não obrigar todo
   retrabalho a passar pelas três áreas. A RNC registra a não conformidade;
   o RT controla a execução do tratamento definido. Concluir a execução não
   encerra automaticamente a RNC nem atesta eficácia da ação corretiva.
3. **Ordens de execução vinculadas:** fabricação de retrabalho, envase de
   retrabalho e rotulagem de retrabalho. Cada ordem tem identificação própria,
   instrução técnica/revisão, entradas e saídas previstas, unidade (kg, L ou un,
   conforme o caso), quantidade, materiais adicionais, responsável e resultados.
   Podem existir operações auxiliares em postos dentro do roteiro.
4. **Recurso de execução independente do tipo:** linha de envase, estação de
   rotulagem, posto ou equipamento de fabricação. Envase pode ocorrer na linha
   ou manualmente num posto; rotulagem pode ser automática ou manual. Tipo de
   ordem não deve ser deduzido do nome do recurso. Recursos físicos precisam
   estar cadastrados e ter ocupação controlada. Configuração atual tem linhas,
   estações de rotulagem e postos; ainda não há catálogo de tanques/reatores.
5. **Execução:** abertura, setup quando aplicável, início da operação,
   apontamentos por período/etapa, pausas, pessoas, perdas, materiais adicionais
   efetivamente usados e transferências administrativas de recurso. Registro
   anterior conserva o recurso onde aconteceu. Quantidade pendente é diferente
   de zero e impede conclusão até conferência. Retry deve ser idempotente.
6. **Reinspeção e disposição final:** término da execução envia o caso à
   Qualidade. Decisão de liberar, retornar para nova etapa ou reprovar tem
   responsável, data, análise e motivo. Uma nova tentativa gera novo ciclo ou
   ordens adicionais com histórico, sem apagar o resultado anterior.

## Papéis propostos para validar na implementação

- Qualidade: origem, instrução/disposição técnica, aprovação do roteiro,
  reinspeção e decisão final.
- PCP: emissão das ordens autorizadas, sequência, recurso, prazo e programação.
- Produção: execução e apontamentos da ordem autorizada.
- Admin: rearranjos de recursos e correções auditadas. O botão administrativo
  existente para OPs comuns deve ser estendido às ordens RT, sem enfraquecer
  a aprovação técnica nem alterar apontamentos passados.

## Quantidade, estoque e genealogia

Quantidade processada por uma etapa não é nova produção comercial. Não somar
kg de fabricação com unidades de envase ou rotulagem. O balanço acompanha a
entrada/saída de cada etapa; conversões precisam de dados reais, não de
suposições. Preservar o vínculo ao lote original. Se a Qualidade determinar
novo lote, criar vínculo de origem/destino e manter rastreabilidade dos dois.

Não replicar automaticamente o BOM ou criar novamente estoque de PA. Somente
materiais adicionais realmente consumidos, perdas, desmontagens e recuperações
confirmadas geram os movimentos correspondentes. Segregação/liberação física
precisa usar os lotes reais do estoque; não inventar saldo nem tratar o status
do RT como liberação global automática de todos os paletes do SKU.

## Caso Tawus como primeiro caso

Sabe-se que o motivo foi precipitação/sedimentação do corante e que houve setup
e envase do retrabalho. Não inferir filtração, formulação, substituição de
corante, nova fabricação ou rotulagem. Essas etapas dependem do procedimento
que a Qualidade definir. Não inventar número de RNC: a importação do registro
atual deve indicar origem retrospectiva por relato administrativo e permitir
vincular a análise/RNC correta depois.

## Pontos de integração já conferidos no código

- RNCs: `nao_conformidades/{numero}`; campos `numero`, `descricao`, `opLote`,
  `itemCodigo`, `qtdEnvolvida`, `causaRaiz`, `acaoCorretiva`, `disposicao` e
  `status`. A nova página pode ler/vincular essas referências sem escrever na
  tela de Qualidade nem duplicar RNCs.
- Análises: granel mantém análise na fase de manipulação da OP; PA/recebimento
  mantém inspeção nos lotes. A integração deve identificar a fonte concreta,
  não criar um campo genérico que pareça um vínculo existente sem sê-lo.
- Execução inicial: `functions/retrabalhos.js`, callable `apontarRetrabalho`,
  `public/shared/retrabalhos-tela.js` e `public/form.html`. Hoje especializados
  em envase na linha. Separar caso/ordem antes de estender para fabricação,
  unidades decimais, postos e rotulagem. Preservar o ID, datas e apontamento
  pendente existentes ao migrar a primeira ordem.
- Ocupação inicial: `retrabalhos_linhas` e `estado_linhas/retrabalhoId`.
  Generalizar por tipo/recurso e integrar a `atividadesPosto`/rotulagem antes
  de habilitar essas execuções, com proteção também no servidor.
- Nova seção prevista: `public/retrabalhos.html` e módulo próprio; permissões
  e navegação em `public/auth_check.js`. Gestão visível a Qualidade/PCP/admin;
  execução acessível aos perfis produtivos conforme módulo autorizado.

## Coordenação com Claude

Claude está alterando `public/qualidade.html`, `public/shared/inspecao-pa.js`,
`public/shared/laudo-cq.js`, CSS e testes de laudos. Há também alterações
pendentes em Cadastro e utils.js. Esses arquivos não foram editados nem
publicados por esta tarefa. O módulo de gestão deve nascer em arquivos
próprios; botões/integração direta dentro da tela de Qualidade requerem
coordenação pelo AGENT_STATUS.md antes de tocar os arquivos ativos.
