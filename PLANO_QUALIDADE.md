# Plano de Ação — Qualidade (Fases 3 e 4 da spec do CQ)

Fechado com o usuário em **19/10/2026**. Base: `ERP_Kuryos_Modulo_CQ_Especificacao_v1.1.docx`
(pasta *6. Sistema de OPs*), a revisão da Qualidade de 17/09 (em `MELHORIAS_FUTURAS.md`,
seção Qualidade) e o POP 035 / F 0065 / F 0066 (*06. Laboratório/01. CQ/09. Formulários atuais*).

Duas colunas de dono: **Sistema** (Claude constrói, testa e publica) e **Kuryos** (decisão,
cadastro, compra ou processo que só a empresa faz). Um item do sistema que depende de algo
da Kuryos diz qual.

---

## Decisões travadas

| # | Decisão |
|---|---|
| D1 | **Agentes sanitizantes** iniciais = F 0065/F 0066: água, Divosan Divosep 350 (1%), álcool 70%. Editáveis. (Fecha a D-11 da spec.) |
| D2 | **Regra de sanitização = POP 035**: completa na troca de produto, no início de cada dia de operação, após manutenção/parada longa e a cada **15 lotes seguidos** da mesma fórmula. **Liberação de linha (line clearance) em TODA OP**, sem exceção — dentro do first article. A Qualidade pode encurtar o limite para cremes/hidratantes (base água). |
| D3 | **Equipamentos vêm do cadastro de Ativos** (Manutenção › Ativos), que os outros módulos consomem. ✅ no ar (`48e390a`). |
| D4 | **Travas em chave** (Ajustes): entram registrando e avisando; liga-se quando a equipe estiver usando. A spec manda bloquear "sem exceção" — é o destino, não o primeiro dia. |
| D5 | **First article = 32 unidades** (correção da Qualidade; a spec dizia 5–10). Tolerância de peso/volume −3% (D-02 da spec). Torque opcional (D-03). |
| D6 | **Checklists editáveis pela Qualidade.** Perguntas não ficam no código: a Qualidade cria, edita, marca crítico, exige foto/medida e **versiona**. Inspeção antiga guarda a versão que usou. Vale para todos os CK. (Pedido do usuário: "ir aperfeiçoando as perguntas vide problemas do dia a dia".) |
| D7 | **CK-2 (documentos da MP) sem trava**: o sistema pede NF × pedido, laudo do fornecedor e FISPQ e **avisa** quando falta; um indicador mostra o % de entradas completas. Cultura antes de trava. |
| D8 | **Registro de temperatura/umidade só digital** (fecha a D-05 da spec). |
| D9 | **RNC nasce de qualquer lugar.** Botão "Relatar problema" nas telas da produção (e no celular), com OP/lote/linha preenchidos e foto. A Qualidade tria e decide: vira RNC, desvio registrado ou melhoria. RNC leva causa raiz (5 porquês), ação, responsável, prazo e verificação de eficácia. |
| D10 | **Retenção em caixas numeradas.** Prazos: MP até o vencimento; PA validade + 1 ano. Hoje ninguém faz a gestão de vencimentos — o sistema passa a gerar a fila de descarte. |
| D11 | **Ronda (CK-6) de 1 em 1 hora** por linha, configurável, com pontos obrigatórios no início do lote, após parada/ajuste e no fim; lote curto = 3 pontos (início, meio, fim). |
| D12 | **Aviso da ronda e de pendência crítica**: 1º som e vibração na tela da inspetora; 2º **sirene física na fábrica** acionada pelo sistema; 3º notificação no celular. |

---

## Sequência

### Fase A — Assepsia e first article
| # | Entrega | Dono | Depende de |
|---|---|---|---|
| A1 | Cadastro de Ativos (Manutenção › Ativos) | Sistema | ✅ feito em 19/10 |
| A2 | **Motor de checklists editáveis** (modelos versionados, itens S/N/NA, crítico, foto, medida numérica com faixa) + editor da Qualidade | Sistema | — |
| A3 | **CK-4 Assepsia de linha** (operador registra, CQ libera) + **CK-5 Setup/First article** (32 un., média e −3%, line clearance, lote/validade impressos, unidade retida) — trava em chave | Sistema | A2; K1; K3 |
| A4 | **CK-3 Assepsia de reator/tacho**, ligada à pesagem (situação do equipamento: sujo → sanitizado → liberado; regra dos 15 lotes) | Sistema | A2; K1 |

### Fase B — Pegar o problema na hora
| # | Entrega | Dono | Depende de |
|---|---|---|---|
| B1 | **"Relatar problema"** em qualquer tela da produção + triagem e tratamento de RNC (causa raiz, ação, eficácia) + indicador por origem | Sistema | K6 |
| B2 | **Ronda (CK-6)** de 1h com aviso sonoro na tela | Sistema | A2 |
| B3 | **Sirene na fábrica** acionada pelo sistema (ronda vencida, first article reprovado, parada) | Sistema + Kuryos | K5 |

### Fase C — Recebimento e análises
| # | Entrega | Dono | Depende de |
|---|---|---|---|
| C1 | **CK-1 por tipo de embalagem** (frasco, tampa, válvula, rótulo, cartucho, display, celofane) no motor do A2 | Sistema | A2; K2 |
| C2 | **RA numerado** (RA-AAAAMMDD-seq) para toda análise, com lista e busca | Sistema | — |
| C3 | **CK-2 documental** (NF × PC, laudo do fornecedor, FISPQ) com aviso e indicador, sem trava | Sistema | — |

### Fase D — Retenção, calibração e avisos
| # | Entrega | Dono | Depende de |
|---|---|---|---|
| D1 | **Retenção**: amostra por caixa, prazo automático, **fila de vencimentos/descarte** (F 0053) | Sistema | K7 |
| D2 | **Calibração e verificação diária (CK-8)** sobre os instrumentos do cadastro de Ativos, com certificado anexado e vencimento | Sistema | K1 (instrumentos) |
| D3 | Notificação no celular (app instalado na tela inicial) | Sistema | — |

---

## O que fica com a Kuryos

| # | Tarefa | Quem (sugestão) | Destrava |
|---|---|---|---|
| K1 | **Cadastrar os ativos**: reatores e tachos (com capacidade), máquinas de cada linha de envase (envasadora, fechadora, esteira, codificadora), rotuladoras e instrumentos do laboratório (balanças, pHmetro, termo-higrômetro, estufa, réguas). E marcar o módulo **Manutenção — Ativos** em Usuários para quem vai cadastrar. | Manutenção / PCP | A3, A4, D2 |
| K2 | **Revisar as perguntas iniciais** dos checklists. O sistema nasce com a lista da spec e do POP 035; a Qualidade ajusta no editor. Para o CK-1, listar o que se confere por tipo de embalagem. | Qualidade | A3, C1 |
| K3 | **Definir quem libera e dar o acesso**: inspetora(s) e analista(s) com o módulo Qualidade; supervisor/líder que assina o first article junto. Confirmar se há Qualidade em todos os turnos — senão, quem libera no turno sem Qualidade. | Qualidade + Produção | A3 |
| K4 | **Limite de campanha para cremes** (base água): manter 15 lotes ou encurtar (por lotes ou por horas). | Qualidade | A4 |
| K5 | **Sirene**: definir onde fica (uma por área ou central), garantir Wi-Fi no ponto e comprar o kit (relé Wi-Fi + sirene/torre luminosa). O Claude especifica o modelo antes da compra. | Manutenção / Compras | B3 |
| K6 | **Triagem de "Relatar problema"**: quem tria e em quanto tempo (sugestão: Qualidade, até o fim do turno). | Qualidade | B1 |
| K7 | **Retenção**: enviar a planilha de controle atual, numerar/identificar as caixas, e **nomear o responsável pelos vencimentos** (hoje não há). | Qualidade | D1 |
| K8 | **Data para ligar as travas** (assepsia, first article) depois de um período só registrando. | Qualidade + Produção | A3, A4 |
| K9 | **Cadastro técnico que o sistema já usa para julgar sozinho**: faixas de pH (115 sem faixa) e densidade (48 sem faixa) nas especificações; revisar quais ensaios são críticos (só 3 marcados); densidade do HDR-MISS-0002 (1,0 × 0,95 dos outros cremes). | Qualidade / P&D | qualidade dos laudos |

---

## Fora deste plano (continua no backlog)

COA comercial ao cliente, comunicado de RNC ao fornecedor com prazo de resposta, etiquetas de
status de lote/palete, ensaio anual de estabilidade do PA retido, "Tarefas Pendentes" com SLA
para todo o CQ e trilha explícita de status de lote. Detalhes em `MELHORIAS_FUTURAS.md`, seção
Qualidade.
