# Status compartilhado dos agentes

Este é o ponto de passagem de contexto entre Codex e Claude. Atualize somente
o bloco do agente que você está operando e mantenha o histórico curto.

## Em andamento

### Claude — Feedback e Clima (RH + colaboradores) (06/10/2026)

- **Pedido:** o RH mandou `Kuryos_Modulo_Feedback_Clima_Especificacao_v2.docx` (escrita para outro sistema Node/Firestore); o usuário confirmou: criar no NOSSO sistema. Temporários são **avaliados** pelos registrados do mesmo setor, mas **não participam da pesquisa**.
- **Código:** `public/shared/feedback-clima.js` (puro: período semanal/quinzenal com virada em 02/11, `alvosDe`, validações, pendências, `montarDiretorio`, `dashboard` com todos os indicadores da seção 8 e N), `public/feedback.html` + `shared/feedback-tela.js` (colaborador: cartões colegas/temporário/líder, clima, aviso honesto conforme a política de autoria), `public/rh_feedback.html` + `shared/rh-feedback-tela.js` (painel, pendências, respostas, recados, configuração: ciclo, 3 formulários até 8 itens, diretório), `public/manual_feedback.html` + card; módulos `feedback` (todos os papéis menos pending) e `rh_feedback` (rh/admin) em `public/auth_check.js`; `public/rh_cadastros.html` ganhou **Setor** e login vinculado de qualquer papel e mantém `feedback_diretorio`; `public/shared/temporarios-tela.js` mantém `feedback_diretorio/{id}/ultimoOk` e a entrada do temporário.
- **Banco (`database.rules.json`):** `feedback_config` (todos leem, RH grava, formulários ≤ 8 itens), `feedback_diretorio` (nome/setor/líder; sem CPF, salário, login), `feedback_diretorio_por_uid` (só o dono e o RH leem), `feedback_feitos` (só o dono lê; escrita única), `feedback_respostas` e `clima_respostas` (só RH lê; criação única validada: alvo do mesmo setor ou líder direto, nota 1–5 inteira, autoria conforme `rhVeAutoria`/`rhVeAutoriaClima`), `feedback_participacao`, `clima_recados_lidos`.
- **Testes:** `run_feedback_clima_test.js`, `run_feedback_clima_ui_test.js`, `run_feedback_clima_rules_test.js` (emulador), `run_rh_cadastros_feedback_ui_test.js`.
- **Para usar:** RH preenche o **Setor** (ou o cargo tem) e **vincula o login** de cada colaborador; abre RH › Feedback e Clima (o diretório se atualiza sozinho). Hoje: 13 colaboradores, 0 com login. Cobrança por e-mail NÃO feita (provedor indefinido, spec A-05); a lista de pendências está pronta.

### Claude — Temporários (RH): convocação e pagamento semanal (06/10/2026)

- **Pedido:** o RH mandou a planilha CONVOCAÇÃO_TEMPORÁRIO 01.xlsx; o usuário quer o módulo no sistema, só RH acessando, com a regra da planilha como oficial. As colunas `#REF!` do CADASTRO são o histórico de performance de cada temporário (calculado dos lançamentos). Temporários também serão **avaliados** pelos registrados no Feedback, mas **não participam da pesquisa** (módulo Feedback e Clima vem a seguir).
- **Código:** `public/shared/temporarios.js` (regras puras: `fechamentoSemana`, `folhaDaSemana`, `historico`, validações, CSV; reproduz as fórmulas da CALCULADORA), `public/shared/temporarios-tela.js` + `public/rh_temporarios.html` (abas Convocação da semana, Fechamento, Pagamentos, Atrasos, Cadastro, Histórico, Parâmetros), módulo `rh_temporarios` em `public/auth_check.js` (papel `rh`; admin vê tudo; link em RH e no manual), `public/manual_temporarios.html` + card em `manuais.html`, nós `rh_temporarios`, `rh_temporarios_config|presenca|semanas|atrasos|pagamentos` em `database.rules.json` (rh/admin lê e escreve; validação de presença/categoria/valor/horas).
- **Testes:** `run_temporarios_test.js` (legenda da planilha e bordas), `run_temporarios_ui_test.js`, `run_temporarios_rules_test.js` (emulador). **Ensaio contra a planilha:** `scripts/ensaio-temporarios-planilha.js` — 30 temporários da semana 21/09 × 10 colunas da CALCULADORA, 0 diferenças.
- **Importação:** `scripts/temporarios-planilha-para-json.py "<xlsx>" <pasta fora do repo>` gera `temporarios-importar.json` (tem CPF/Pix: NUNCA no repositório) para `firebase database:update / <arquivo> --project prod-kuryos`. Só cria nós novos.
- **Publicado (`3c7022a`, Hosting + regras do banco):** hashes ao vivo = repo. **Importação NÃO aplicada por mim** (o classificador do Claude Code bloqueou a escrita em produção): o usuário roda `bash scripts/importar-temporarios.sh` (confere ensaio 0 diferenças, exige `rh_temporarios` vazio, grava só nós novos; `DRY=1` ensaia sem gravar — já ensaiado: 32 temporários, 310 marcações, 531 caminhos; "Sara Machado Costa" aparece nas abas de presença/pagamento mas não no cadastro → criada Inativa).
- **Diferenças deliberadas da planilha:** pagamento tem "semana de referência" (padrão = semana da data, como na planilha); as horas da sexta valem também para o desconto proporcional do atraso; tudo ligado ao id do temporário, não ao texto do nome.

### Claude — Auditoria 5S: setores e áreas editáveis (06/10/2026)

- **Pedido:** setores/áreas editáveis, com responsável indicado. Lista inicial do usuário (Produção > Linhas 1-3; Manipulação > Manipulação e Estoque; Rotulagem > 1-3 e Estoque; Refeitório; Vestiários; Escritório; Estoque MUC; Recepção; Expedição > Estoque e Doca; Laboratório; Manutenção; Área de Lavagem; DML; Retenção; Reciclagem). Auditoria é por SETOR; área = local do NC + responsável da área.
- **Código:** `Auditoria5S.setoresConfigurados`/`SETORES_PADRAO` (`public/shared/auditoria-5s.js`), editor em Configuração e líder indicado no Painel (`public/shared/auditoria-5s-tela.js`), nó `auditoria5s_config/setores`. Setor com auditoria não se apaga, só desativa (nome fixo; líderes mapeados por nome).

### Claude — Auditoria 5S (06/10/2026)

- **Pedido:** a analista de Qualidade quer o checklist 5S no sistema (líder diário + auditoria cruzada sem aviso + inspeção da Diretoria). Decisões do usuário: ocorrências com responsável desde já (virarão advertência formal depois da fase de testes, com ciência dos colaboradores), líderes por setor via usuário/papel, assinatura digital, Qualidade e P&D se revezam e a Diretoria inspeciona sem aviso, sem aviso ao líder.
- **Arquivos:** `public/auditoria_5s.html`, `public/shared/auditoria-5s.js` (regras puras), `public/shared/auditoria-5s-tela.js`, `public/manual_auditoria_5s.html`, `public/manuais.html`, `public/auth_check.js` (módulo `auditoria5s`, link em Qualidade e em Ajuda), `database.rules.json` (`auditoria5s_config`, `auditorias_5s`, `acoes_5s`, `ciencia_5s`, `ocorrencias_5s`), `public/shared/fotos-qualidade.js` (texto "obrigatória"), testes `run_auditoria_5s_test.js`, `run_auditoria_5s_rules_test.js`, `run_auditoria_5s_ui_test.js`.
- **Para usar:** o admin marca o módulo "Auditoria 5S" em Usuários e define o papel de cada um em Auditoria 5S › Configuração. A fase de treinamento começa ligada (registros não contam para a escada).

### Claude — Retrabalhos fora do perfil da rotulagem (05/10/2026)

- **Pedido:** o perfil da rotulagem só vê rotuladoras e a rotulagem realizada; o bloco de Retrabalhos sai de lá.
- **Ajuste:** `#retrabalhosPainel` (Painel de Turno) só aparece na área do envase; `RetrabalhosTela.visibilidade()` (`public/shared/retrabalhos-tela.js`) é chamada por `aplicarRestricaoRotulagem` (`public/form.html`). A tela `retrabalhos.html` já era só da Qualidade. Teste: `run_encerrar_turno_setor_ui_test.js`.

### Claude — Encerrar turno por setor (05/10/2026)

- **Pedido:** envase e rotulagem têm perfis e telas diferentes; ao encerrar o turno no envase, o sistema pedia dados da rotulagem (já encerrada por outro perfil).
- **Causa:** `turnoItensAtivos` (form.html) juntava linhas E rotuladoras para quem tem os dois setores (admin/gestão/perfil com os dois), sem olhar a área do painel, e perguntava de novo uma linha/rotuladora já fechada ("Fim de turno") e não retomada.
- **Ajuste (`public/form.html`):** o Encerrar Turno fecha só a área em que a pessoa está (`setorVisao()`: envase = linhas + postos; rotulagem = rotuladoras) e pula o que já está `parada` por "Fim de turno" (avisa "Nada a fechar…"). Retomar Produção volta a perguntar. Intervalo por card não muda. Teste: `run_encerrar_turno_setor_ui_test.js`.
- **Arquivos:** `public/form.html`, `run_encerrar_turno_setor_ui_test.js`, `AGENT_STATUS.md`.

### Claude — Intermediários, conciliação da rotulagem e BOM por versão (05/10/2026)

- **Escopo/arquivos:** `public/shared/conciliacao-rotulagem.js` (+ chip em `public/ops.html`), `public/shared/consulta-estoque.js` (`estoqueIntermediario`) e `consulta-estoque-tela.js`/`consulta_estoque.html` (seção por produto), `public/shared/validacao-intermediarios-tela.js` + `public/material_processo.html` (validação da Qualidade), `database.rules.json` (`qualidade_intermediarios`), `public/form.html` (fechar o envase leva a OP ao PCP com a rotulagem aberta), `public/shared/utils.js` (`bomDaVersao`) e os pontos de leitura do BOM (`compras`, `emitir_op`, `form`, `insumos`, `manipulacao`, `cadastros`, `onde-usado`, `necessidade-pedidos`), testes `run_conciliacao_rotulagem_test`, `run_bom_versao_test`, `run_qualidade_intermediarios_rules_test`, `run_validacao_intermediarios_ui_test`, `scripts/aplicar-plano1.sh`.
- **Dados:** 1 BOM de teste (`HDR-MISS-0001__v1`) foi marcado OBSOLETA; a escrita em massa foi bloqueada pelo classificador do Claude Code. Resto do plano 1 em `scripts/aplicar-plano1.sh` (rodar manualmente): 5 BOMs + 21 alocações abertas em OP Concluída. OP 26271/01 já estava em Aguardando Confirmação.

### Claude — "Usado em" só com a versão em uso (02/10/2026)

- **Causa (EP-00106 x EP-00101):** `cadastros.html › Materiais › Usado em` listava TODO registro de `bom/`/`formulas/`: versões antigas (MRARBS11__v1) e duplicatas só na caixa da letra (`HDR-MISS-0001__V1` ao lado de `__v1`). As contas do app usam a fórmula de `melhorFormulaDoProduto` e o BOM de MESMA chave (`produto__versão`); o resto é sobra.
- **Código:** `public/cadastros.html` (`mapaVigencia`/`calcularUsoMaterial`, caixa "incluir versões antigas"), `public/shared/onde-usado.js` (mesma regra: fórmula aprovada de maior versão, BOM da chave da fórmula, desempate estável), `run_onde_usado_test.js`.
- **Dados NÃO alterados:** 7 BOMs sobrando (`HDR-MISS-0001/2/3/6/7__v1`, `MRARBS10__v1`, `MRARBS11__v1`) aguardam autorização do usuário para virarem OBSOLETA (com backup). Não afetam cálculo.

### Claude — "O que comprar" por pedido (01/10/2026)

- **Escopo:** nova tela `public/o_que_comprar.html` + `public/shared/necessidade-pedidos.js` (motor puro; usa a MESMA `explodirMateriaisNecessarios`) + `public/shared/necessidade-pedidos-tela.js`; menu em `public/auth_check.js` (PCP e Compras); manual (`manual_compras.html` §1a); testes `run_necessidade_pedidos_test.js` e `run_necessidade_pedidos_ui_test.js`. Não toca `insumos.html` (MRP/Matriz seguem como estão). Única escrita: solicitação de compra pendente (`solicitacoes_compra`, com `pedidoKeys`, `origemTela: 'o_que_comprar'`).
- **Arquivos ativos:** os acima + `AGENT_STATUS.md`.

### Claude — Consulta de Estoque + intermediários x embalagens (01/10/2026)

- **PUBLICADO (`9df9603`, Hosting, 01/10):** `consulta_estoque.html` (menu Logística › Consulta de Estoque; PCP e Compras também) — só leitura, não toca `estoque.html`. Busca por palavras (nome/código/lote/endereço/cliente), filtros com contagem viva (tipo, situação, cliente, "já contado no Dia D"), drawer com lotes FEFO, empenhos por OP, dono, onde é usado, link ao Kardex, CSV, atalhos (`/`, setas, Esc), estado na URL. Aba **Intermediários e envase**: bulk manipulado x embalagem utilizável por OP (casamento por BOM da OP/BOM vigente; estoque de outro cliente e empenho de outras OPs não contam; material sem "Controla estoque" nunca trava), gargalo, e retidos da produção (`material_processo`).
- **Arquivos:** `public/consulta_estoque.html`, `public/shared/consulta-estoque.js` (regras puras), `public/shared/consulta-estoque-tela.js`, `public/auth_check.js` (páginas dos módulos logistica/pedidos/planejamento/compras + links), `public/manual_estoque.html` (§5b), `run_consulta_estoque_test.js`, `run_consulta_estoque_ui_test.js`. Todos liberados; sem arquivos ativos.
- **Validação:** teste de regras, teste de tela (Firebase simulado), ensaio contra a base real (182 itens, 10 OPs com 4.921 kg de bulk, render 27 ms, sem erros), regressões de menu (operação, movimentar, relatório de expedição, material em processo) e transações null. Hashes ao vivo = repo.
- **Observação de dado:** hoje todas as 10 OPs aparecem "travadas por embalagem" porque o Dia D ainda não contou as embalagens (saldo 0/negativo). A tela diz isso; muda sozinha conforme os ajustes entrarem.

### Codex — rearranjo de linhas e retrabalho 21–22/09/2026

- **Publicado — rearranjo:** commit `3331fdb`, botão admin para transferir/trocar OPs pausadas, histórico e totais preservados. Hosting/RTDB/callable publicados e conferidos.
- **Publicado — execução inicial de retrabalho:** commit `a1fde05`, Hosting/RTDB/`apontarRetrabalho`/`rearranjarLinhas` por worktree limpo `../deploy-retrabalho-26216`. Form e módulo conferidos byte a byte por HTTP; função sem login HTTP 401. Domínio, navegador desktop/celular, regras reais no emulador, regressões de encerramento/transações null e ensaio na base real aprovados.
- **Correção operacional APLICADA E REVALIDADA:** `RT-26216-04-20260921`, lote inteiro, sedimentação inesperada do corante com precipitado. Setup 21/09 15:42, envase 16:00, pausa Fim de turno 17:09 BRT. Apontamento do período com quantidade pendente (campo numérico ausente), editável por admin no Apontamento. OP 26216/04 permanece Concluído com 867 unidades, sem duplicação de produção/estoque/pedido. OP 26160/04 voltou a Programado; alocação/setup/datas/marcadores fictícios retirados e preservados na auditoria do RT. Pedido original permaneceu com total zero, sem novo estorno. Backup pré-transação: `backups/correcao-rt26216-1790070001241.json`. Script idempotente: `scripts/corrigir-retrabalho-26216.js`.
- **Novo direcionamento do usuário:** quer uma SEÇÃO DE GESTÃO, com origem em análise CQ/RNC, caso de retrabalho e ordens de fabricação/envase/rotulagem, execução em linha ou posto conforme trabalho. Esse módulo completo AINDA NÃO foi implementado; a tela publicada é o primeiro controle de execução. Modelo e integrações reais registrados em `PLANO_GESTAO_RETRABALHOS.md`; não interpretar o envase publicado como escopo final. Não inventar RNC nem procedimentos de tratamento do precipitado.
- **Coordenação:** usuário lembrou que Claude está trabalhando. Qualidade, laudos, Cadastro e utils.js alheios intactos. Próxima seção deve usar arquivos próprios, com integração à tela CQ somente após coordenação. Nenhuma alteração antecipada na migração Céu Infinito linha 1 → 3, mencionada para amanhã.
- **Arquivos ativos:** nenhum após registrar esta passagem. Últimos arquivos deste escopo: form.html, modules retrabalhos/rearranjo, functions/index.js, regras, testes, script de correção e docs. Trabalhos paralelos não incluídos.

### Codex — Dev 3 11/09

- **Retomada em 16/09 — contatos por área:** assumida a conclusão do escopo de contatos do Dev 2, cuja última execução falhou por limite semanal (tarefa atualmente inativa). Preservar e integrar as alterações salvas de Cadastro, Comercial, agenda/Expedição e módulos/testes de contatos. Validar, corrigir pendências, commit/push/deploy isolado. Nenhuma execução simultânea identificada nos arquivos reservados abaixo.

- **Conclusão dos contatos em 16/09:** cadastro com múltiplos contatos/áreas e principal por área; seleção no Comercial e recebimento do cliente na agenda/Expedição. Legado preservado; pedido, agenda, saída e histórico guardam o contato escolhido. Corrigido carregamento tardio sem sobrescrever ajustes manuais. Testes de dados, gravação do pedido/PCP e navegador (duas telas, revisão, parciais, reload e celular) aprovados; revisão visual concluída. **Publicado:** `d4d36bc` no origin/main e Firebase `prod-kuryos` em 2026-09-16, por worktree limpo (Hosting + `salvarAgendamentoExpedicaoPA` + `confirmarExpedicaoPA`). Os 11 arquivos públicos conferidos retornaram HTTP 200 e conteúdo idêntico ao commit; ambas as funções sem login retornaram HTTP 401. Primeiro deploy parou na descoberta local (10 s); repetição com `FUNCTIONS_DISCOVERY_TIMEOUT=60` concluída. Arquivos deste escopo liberados; nenhuma pendência de implementação.

- **Escopo:** grade de Expedição baseada na planilha, composição compacta de caixas parciais e agenda de transporte PA compartilhada com Logística.
- **Coordenação:** base do Dev 2 publicada em `3d7a60f` e integrada. Arquivos ativos: nenhum; entrega encerrada. MRP/Claude preservado.
- **Entrega pronta:** grade por palete com filtros/ordenação, caixas completas e parcial na mesma linha, totais e histórico. Agenda PA acessível pela Expedição e Logística; transporte compartilhado com revisão/histórico, sem baixa ao agendar, sem palete em duas agendas, cancelamento com motivo. Confirmação encerra agenda e baixa estoque/pedidos atomicamente, preservando transporte agendado e efetivo.
- **Validação:** testes de grade/parciais, agenda/handler com concorrência e permissão revogada, navegador em duas telas (transporte, revisão, reabertura, saída e histórico), reload/idempotência/celular e regressões de rota PC, Conferência PA, Recebimento, Lote Interno, Qualidade e Descarte aprovados. Revisão visual feita com dados de teste.
- **Publicação:** `78545d0` no origin/main e Firebase `prod-kuryos`, Hosting + RTDB + `salvarAgendamentoExpedicaoPA` + `confirmarExpedicaoPA`; deploy completo por worktree limpo. Verificação em 2026-09-11 às 13:14 BRT: HTMLs Logística/Expedição e módulos de grade/agenda HTTP 200, idênticos ao commit; agenda sem login HTTP 401. MRP/Claude preservado (SHA256 de `utils.js` inalterado).

### Codex

- **Escopo atual — contatos por área:** lista dinâmica de contatos de clientes, múltiplas áreas/principal, compatibilidade com contatos legados, seleção no Comercial e contato do cliente na agenda/Expedição com snapshot.
- **Arquivos ativos:** `public/cadastros.html`, `public/comercial.html`, `public/expedicao.html`, `public/logistica.html`, módulos novos `public/shared/contatos-cliente*`, `public/shared/cliente-comercial.js`, `public/shared/agenda-pa-tela.js`, `public/shared/expedicao-grade-tela.js`, `functions/agenda_expedicao.js`, `functions/expedicao.js`, testes de contatos e `run_cliente_comercial_test.js`, `AGENT_STATUS.md`. `public/shared/utils.js` reservado ao MRP/Claude.

- **Entrega dados do cliente no pedido comercial:** seleção preenche contato comercial, telefone, e-mail, endereços de entrega/faturamento e pagamento; permite ajustes no pedido, preserva-os em atualizações do cadastro e limpa dados ao trocar cliente. Cadastro ganhou campos de endereços completos; pedido mantém valores próprios para PCP/Expedição.
- **Validação/publicação:** `run_cliente_comercial_test.js` e regressão da Expedição aprovados; commit `69f475b` no origin/main e Hosting publicado em 2026-09-11 por worktree limpo. Comercial, Cadastros e módulo cadastral HTTP 200, idênticos ao commit.
- **Arquivos ativos neste escopo:** nenhum; entrega encerrada. MRP/Claude preservado.

- **Entrega Expedição por paletes PA:** carga seleciona paletes inteiros conferidos, liberados pela Qualidade e endereçados; herda pedido/cliente/OP/lote, preserva caixas completas/parcial, conferência, laudo e dados comerciais. Saída física, movimentos e expedido dos pedidos confirmados em uma única transação, com idempotência e revalidação concorrente. NF externa permanece separada da situação física; API futura registrada no backlog.
- **Validação Expedição:** run_expedicao_test.js e run_expedicao_ui_test.js aprovados (navegador desktop/celular, reload/retry, CQ, WMS, legado e concorrência), além das regressões de Conferência PA, Recebimento, Lote Interno, Qualidade e Descarte. Base medida em 5,32 MB; a transação na raiz deve ser reavaliada se o volume crescer significativamente.
- **Commit/deploy Expedição:** `3d7a60f`, enviado ao origin/main e publicado em 2026-09-11 (Hosting, RTDB, confirmarExpedicaoPA e finalizarConferenciaPA), por worktree limpo. HTTP 200 e arquivos idênticos ao commit; callable sem login retorna 401. Estoque de PA ainda sem paletes na verificação.
- **Arquivos ativos neste escopo:** nenhum; liberados para Dev 3 11/09 integrar grade/agendamento. MRP/Claude e módulos novos do Dev 3 preservados.

- **Escopo atual — endereços do transporte no PC:** Compras confirma snapshots estruturados de origem/coleta e destino/entrega no Pedido de Compra; Logística consome esses endereços no agendamento, bloqueia ausência e permite correção excepcional com motivo e histórico. Cobrir cotação, PC direto, edição, retirada/FOB, entrega/CIF e remessa.
- **Arquivos ativos neste escopo:** `public/compras.html`, `public/logistica.html`, `public/shared/rotas-pc.js`, `run_rotas_pc_test.js`, `public/manual_compras.html`, `public/manual_logistica.html` e `AGENT_STATUS.md`. Não alterar `public/shared/utils.js` nem `public/insumos.html`, reservados ao MRP/Claude.
- **Entrega pronta — rota do PC:** origem e destino estruturados são sugeridos pelo cadastro/cotação, revisados e congelados no PC. FOB exige origem + contato/telefone; CIF exige destino; remessas não usam CIF/FOB. PC sem rota confirmada não pode ser enviado/agendado. Logística mostra, copia e abre a rota no mapa; exceção vale só para a viagem e preserva rota do PC, antes/depois, motivo, usuário e data. O PDF do PC inclui a rota congelada.
- **Validação rota do PC:** `run_rotas_pc_test.js` cobre FOB, CIF, remessa, snapshot imutável, comparação de exceção, PDF e integrações; regressões de recebimento, lote interno, Conferência PA, Qualidade e Descarte aprovadas.
- **Commit/deploy rota do PC:** `adca695`; Hosting publicado em 2026-09-11 no projeto `prod-kuryos` por worktree limpo, sem o MRP pendente. Verificação externa: `shared/rotas-pc.js` HTTP 200 e `logistica.html` contém `rotaEfetiva`.
- **Arquivos ativos neste escopo:** nenhum; entrega encerrada.

- **Escopo atual — lote interno/recebimento:** implementar `AK-AAAA-NNNNNN` com contador anual transacional no servidor, linhas separadas por lote do fornecedor, recebimento/estoque/CQ idempotentes, etiquetas, cancelamento/estorno e devolução auditáveis; validar cenários completos e publicar.
- **Arquivos ativos neste escopo:** nenhum; entrega encerrada. `public/shared/utils.js` e `public/insumos.html` continuam reservados ao MRP/Claude.
- **Entrega pronta — lote interno/recebimento:** novos lotes seguem `AK-AAAA-NNNNNN` (base histórica 2026 preservada; próximo lógico 576), gerados no servidor com contador anual, índice global, lock por PC e idempotência. Um item aceita múltiplos lotes externos e volumes; confirmação grava PC, saldo físico, `estoque_lotes`, movimentos e fila CQ por update multipath. Histórico ganhou etiquetas Code39+QR, reimpressão, cancelamento seguro e devolução com reabertura do saldo do PC.
- **Validação lote interno:** `run_lote_interno_test.js`, `run_recebimento_qualidade_test.js`, testes de Conferência de PA/CQ/Descarte, sintaxe de Functions, JSON das regras e `git diff --check` aprovados.
- **Commit/deploy lote interno:** `747b607`; Hosting, RTDB e Functions publicados em 2026-09-11 no projeto `prod-kuryos`, usando worktree limpo para não incluir o MRP não commitado. Firebase confirmou `release complete`; conferência HTTP externa permaneceu indisponível por falha local de credencial TLS.

- **Entrega Recebimento/CQ:** `Registrar recebimento` replica as 14 perguntas do Microsoft Forms com fornecedor/identificação/SKU interno pré-cadastrados e SKU do fornecedor vindo da homologação quando disponível; mantém validade e endereço do WMS. Todo item recebido exige endereço, nasce em `QUARENTENA` e carrega a ficha de entrada para a fila/laudo da Qualidade sem redigitação. Corrigido também o elo antigo que zerava `origemRef` ao fechar o modal e fazia o lote perder PC/fornecedor.
- **Validação Recebimento/CQ:** `run_recebimento_qualidade_test.js` cobre campos, obrigatoriedade, quantidades inválidas, classificação, homologação, quarentena, origem e consumo pela Qualidade. Regressões `run_conferencia_pa_test.js`, `run_qualidade_pa_tipo_test.js` e `run_descarte_test.js`, sintaxe dos HTMLs e `git diff --check` aprovadas. Commit funcional `1dad636`; Hosting publicado em 2026-09-11 no projeto `prod-kuryos` e GitHub `main` atualizado.
- **Arquivos ativos:** nenhum. Não alterar `public/shared/utils.js` nem `public/insumos.html`, reservados ao MRP/Claude.
- **Entrega WMS concluída:** Conferência de PA exibe também OPs em `Aguardando Confirmação`, destacadas no topo como cobrança ao PCP, mas bloqueia a contagem/entrada até a confirmação definitiva. Depois disso, a Logística informa múltiplos paletes, caixas fechadas/parciais, total e endereço. Divergência não cria estoque: exige três contagens, consenso de duas das três últimas e, se o físico continuar diferente, causa formal com RNC automática. Finalização protegida por callable no servidor, com lock, validação de OP/endereço/legado e caminhos determinísticos; paletes nascem em `QUARENTENA`. Corte prospectivo em 2026-09-10 evita transformar 1.251 OPs históricas sem WMS em pendências falsas.
- **Validação WMS:** `run_conferencia_pa_test.js` e `run_conferencia_pa_server_test.js` cobrem consenso, ausência de consenso, conciliação, OP mutável, endereço inativo, legado, RNC e idempotência; sintaxe de Functions/HTML e `git diff --check` aprovados.
- **Arquivos ativos WMS:** `public/estoque.html`, `functions/index.js`, `functions/conferencia_pa.js`, `run_conferencia_pa_test.js`, `run_conferencia_pa_server_test.js`, `public/manual_estoque.html`, `public/manual_logistica.html`, `public/manual_referencia.html` e `AGENT_STATUS.md`. Não alterar `public/shared/utils.js` nem `public/insumos.html`, reservados ao MRP/Claude.
- **Commit/deploy WMS:** base protegida em `457b681`; fila de cobrança ao PCP em `4ad50d5`. Callable `finalizarConferenciaPA` e Hosting publicados em 2026-09-10 no projeto `prod-kuryos`; GitHub `main` atualizado.
- **Correção de rastreabilidade CQ/PA:** o movimento do laudo agora preserva `itemTipo=produto` para paletes, em vez de classificar toda liberação como material. Validado por `run_qualidade_pa_tipo_test.js`, commitado seletivamente sem incluir o MRP e publicado no Hosting em 2026-09-10.
- **Última entrega Apontamento:** pausa permanece `apontamento_total`; todos os botões de encerramento gravam `fechamento_op`. Quantidade, liberação da linha e status final entram na mesma transaction; UI só confirma após ACK. OP, pedido, consumo e perdas ficaram idempotentes por ID/dedupe contra clique, retry e reconexão.
- **Correção operacional concluída:** lote `26247/06` preserva checkpoint de 864 (10h42–12h04) e recebeu fechamento incremental de 797 no período informado de 13h00–14h15; total da OP 1.661. Pedido `0019__GLMKAM01` atualizado para 15.053 e concluído. Baixas do BOM foram aplicadas uma única vez e marcadas para impedir retry; consumo químico ficou explicitamente pendente porque o produto possui `densidadeGranel=-1`.
- **Proteção adicional:** densidade ausente/inválida não pode mais gerar consumo negativo de fórmula nem aumentar estoque; nesses casos, somente o BOM por peça é baixado. Pedido passa a `Concluído` atomicamente ao atingir a quantidade total.
- **Validação:** correção no Firebase revalidada após escrita; `run_apontamento_encerramento_test.js`, sintaxe de todos os scripts de `public/form.html` e `git diff --check` aprovados.
- **Commit/deploy Apontamento:** `7d30cdd` (inclui a proteção de densidade), Hosting publicado em 2026-09-10 em `https://prod-kuryos.web.app`; GitHub `main` atualizado. A CLI confirmou `release complete`; a conferência HTTP externa ficou indisponível neste host por falha local de credencial TLS.
- **Arquivos ativos:** `public/form.html`, `run_apontamento_encerramento_test.js` e `AGENT_STATUS.md`. `public/shared/utils.js` permanece reservado ao MRP/Claude e não será incluído nem publicado.
- **Última entrega Compras:** “＋ Fornecedor” sugere somente homologados do próprio item e homologados de materiais similares por volume, como na abertura da cotação. Similar fica marcado, vinculado ao item original e exige especificação técnica antes de gerar PC; fornecedor avulso continua pelo CNPJ.
- **Validação Compras:** sintaxe e `git diff --check` aprovados; cenário cobre homologado direto + homologado via material similar.
- **Arquivos ativos:** nenhum.
- **Última entrega Compras:** ao iniciar uma cotação, abre a aba Cotações. O cartão de fornecedores ganhou “＋ Fornecedor”: busca na base ou CNPJ avulso, sempre com escopo obrigatório por material; convite repetido amplia o escopo sem duplicar e itens fora da homologação ficam sinalizados.
- **Validação Compras:** sintaxe de `compras.html`, `git diff --check` e cenário de convite por item (sem duplicidade; fora da homologação sinalizado) aprovados.
- **Commit/deploy Compras:** `f738e9b`, Hosting publicado em 2026-09-10 em `https://prod-kuryos.web.app`.
- **Arquivos ativos:** nenhum. Não alterar `public/shared/utils.js` enquanto MRP estiver em integração.
- **Última entrega WMS:** Conferência de PA mantida como etapa específica da Logística (produção → conferência → quarentena → CQ). Nova tela **Descarte e Logística Reversa** segrega lotes vencidos, reprovados ou retidos; a saída só baixa o lote ao confirmar coleta/destinação e deixa movimento auditável.
- **Validação WMS:** `run_descarte_test.js`, sintaxe JS/HTML, JSON das regras e `git diff --check` aprovados. Hosting e regras RTDB publicados em 2026-09-09.
- **Commit/deploy WMS:** `051ce9e`, publicado em 2026-09-09 em `https://prod-kuryos.web.app`.
- **Arquivos ativos:** nenhum.
- **Escopo:** Reconstrução completa do módulo Comercial confirmado: orçamento sem impacto operacional, pedido apenas com produtos cadastrados e liberação idempotente para PCP.
- **Arquivos ativos:** `public/comercial.html`, `functions/index.js`, `database.rules.json`, `AGENT_STATUS.md`.
- **Entrega em publicação:** fluxo Comercial completo: Pedido com SKU cadastrado, bloqueio de SKU duplicado e liberação ao PCP; Orçamento sem impacto no PCP, envio/aceite registrado e solicitação de cadastro para item novo; condição comercial, % NF, entrega/faturamento, CIF/FOB de venda e aviso interno por e-mail.
- **Validação:** sintaxe de HTML/JS e Functions, JSON das regras e `git diff --check` aprovados; deploy de Hosting, RTDB e Functions concluído em 2026-09-09. A tela publicada exige login, como esperado.
- **Commit/deploy Comercial:** `231e44f`, publicado em 2026-09-09 em `https://prod-kuryos.web.app`.
- **Escopo atual:** ciclo comercial ponta a ponta: documentos, anexos, aditivo/cancelamento auditáveis, expedição/faturamento parcial e timeline integrada ao PCP.
- **Arquivos ativos:** `public/comercial.html`, `public/expedicao.html`, `public/auth_check.js`, `functions/index.js`, `database.rules.json`, `firebase.json`, `storage.rules`, `AGENT_STATUS.md`.
- **Entrega parcial publicada:** `expedicao.html` registra cargas de venda, NF externa, CIF/FOB, transportador e quantidades limitadas ao saldo produzido; eventos e metadados comerciais receberam nós próprios.
- **Validação:** sintaxe JS/JSON e `git diff --check` aprovados; Hosting e RTDB publicados em 2026-09-09. Storage bloqueado até inicialização única do bucket no Console Firebase.
- **Atualização publicada:** bucket Storage inicializado pelo usuário; Comercial recebeu anexos, emissão de PDF para impressão/salvamento, timeline, aditivo e cancelamento com evento registrado.
- **Última entrega Comercial:** orçamento pode vincular cliente cadastrado e preencher seus dados, sem exigir que os itens estejam cadastrados como produtos.
- **Commit/deploy Comercial:** `ea91fa8`, publicado em 2026-09-09 em `https://prod-kuryos.web.app`.
- **Última entrega Acessos:** Comercial é módulo próprio em Usuários; permite Pedidos e Orçamentos sem liberar Pedidos/MRP. PCP mantém Comercial no padrão do perfil.
- **Commit/deploy Acessos:** `245dd95`, publicado em 2026-09-09 em `https://prod-kuryos.web.app` (Hosting e regras RTDB).
- **Última entrega Comercial:** tela Pedidos e Orçamentos. Pedido usa cliente/produtos cadastrados e cria automaticamente os itens do backlog do PCP; Orçamento aceita prospectos/itens livres e só entra no PCP ao ser convertido e confirmado.
- **Commit/deploy Comercial:** `62db872`, publicado em 2026-09-09 em `https://prod-kuryos.web.app` (Hosting e regras RTDB).
- **Última entrega Logística:** previsão do Pedido de Compra visível no card e usada como data inicial editável do agendamento; CIF indica recebimento e FOB indica disponibilidade para coleta. A previsão de origem fica registrada no agendamento.
- **Commit/deploy Logística:** `c3ba30f`, publicado em 2026-09-09 em `https://prod-kuryos.web.app`.
- **Estado Apontamento:** checkpoint recebe total acumulado do operador, mas
  registro salva o incremento confirmado na transação; fechamento começa no
  fim do último checkpoint, preservando os períodos úteis.
- **Commit/deploy Apontamento:** `82aba17`, publicado em 2026-09-09 em
  `https://prod-kuryos.web.app`.
- **Commit/deploy Histórico:** `35afccb`, publicado em 2026-09-09 em
  `https://prod-kuryos.web.app`.
- **Estado:** Cotação agora mantém homologados apenas do material original.
  Materiais de embalagem de volume próximo são sugestões explícitas e exigem
  ficha técnica quando incluídos, sem trocar BOM ou homologação.
- **Commit/deploy Cotação:** `94c1ff9`, publicado em 2026-09-09 em
  `https://prod-kuryos.web.app`.
- **Estado:** filtro de área aplicado à Lista, Mapa por Rua e Planta Baixa;
  indicadores passam a refletir o recorte. Logística diferencia coleta da
  Kuryos de entrega pelo remetente para agendamento.
- **Validação:** sintaxe JavaScript de `public/estoque.html` validada com Node.
- **Commit/deploy:** `855de2f` (saldo na OP), `250f5ef` (Logística) e
  `88ad322` (WMS) commitados e publicados em 2026-09-09.
- **Última entrega:** saldo de estoque por material na criação de OP,
  exclusivamente como referência visual; destaca saldo menor que o consumo.
- **Validação adicional:** sintaxe JavaScript de `public/emitir_op.html`
  validada com Node.
- **Última entrega Logística:** dados de coleta/viagem (modalidade, prestador
  cadastrado, valor negociado, referência e status), em `250f5ef`.
- **Última entrega Cotação:** fluxo guiado para preencher uma proposta por
  fornecedor e comparar por material, em `365c759`; publicado em 2026-09-09.
- **Última entrega Cotação:** decisão por material e geração automática de
  um PC por fornecedor, em `913effc`; publicado em 2026-09-09.

### Claude

- **DADO CORRIGIDO — encerramento na OP errada (2026-10-07, autorizado).** Linha 1 encerrou a 26160/04 (perfume capilar, roda na Linha 2) com 1.872 às 08:47; era o fechamento do hidratante 26278/03 (total 1.872, 1.776 já lançados -> +96). `scripts/corrigir-encerramento-26160-04.js` (idempotente): registro movido para 26278/03 (+96, original guardado em `correcao`); 26160/04 de volta a Programado na Linha 2, sem envase/setup/rotulagem de hoje; 26278/03 envase 1.872, alocação fechada; pedido 0007 1.872->0, 0023__HDR-MISS-0007 +96; 16 baixas do perfume estornadas (13 saldo + 3 lotes WMS) e BOM do hidratante baixado para 96. Backup em `backups/correcao-op26160-04-encerramento-1791376099867.json`. **Achado pendente:** apontamentos da Flor Daura (26278/01-03, 5.451 un) estão somando no pedido 0023__HDR-MISS-0001 (Céu Infinito), não no HDR-MISS-0007. Arquivos ativos: nenhum.

- **PUBLICADO — Consulta de Estoque: cliente duplicado no filtro (2026-10-06).** Causa: o
  material guarda o dono pela chave do cadastro (`porCliente/{chave}`) e o palete de PA só o
  nome digitado; `clientesDoEstoque` juntava os dois ("BIOF" e "BIOFLORA … - EPP", "MISS" e
  "MISS RÔSE") e cada opção achava só metade. `consulta-estoque.js`
  (`unificarClientesDosProdutos`): PA ganha a chave pelo `produtos/{sku}.clienteKey`, nome
  igual no cadastro de clientes ou nome de dono de material; sem nada, segue pelo nome. Tela
  carrega `clientes`. Base: 8 clientes viraram 6, nenhum PA sem chave. Teste em
  `run_consulta_estoque_test.js`. Arquivos ativos: nenhum.

- **PUBLICADO — Compras: "Confirmar rota e enviar" para quem não é admin (2026-10-02).** Relato:
  PC nascido da cotação vem com `rota.statusConfirmacao` PENDENTE; só o Editar (admin,
  `podeEditarPC`) confirmava, e o analista não conseguia "Marcar Enviado" — o usuário
  editava toda vez. Agora `marcarPedidoEnviado` (`compras.html`) abre o modal
  `modalRotaEnvio` (prefixo `pcEnv`, mesmo editor de rota) quando a rota está pendente;
  grava, num update só, rota CONFIRMADA + transporte + status ENVIADO + dataEmissao +
  enviadoPor. Itens/preços/condições não mudam; Editar segue só admin. Regra do banco já
  permitia (módulo compras). Teste `run_pc_rota_envio_ui_test.js` (usuário não-admin).
  Manual `manual_compras.html`. Arquivos ativos: nenhum.

- **DADO — Regularização de PA expedido fora do sistema (2026-10-01).** Pedido do usuário
  (lista da Expedição): baixar todo PA em estoque exceto 26258/02-04, 26264/06, /07, /13,
  /17, 26273/03, /04 e 26267/03. Com autorização: 60 paletes de 50 lotes (110.948 un)
  zerados como a saída real faz (`saldoLote 0`, `status EXPEDIDO`, `expedicaoId
  regularizacao_20261001`, expedidoEm/Por) + `movimentos_estoque/{sku}/regularizacao_20261001_{lote}`
  (`expedicao_pa`, "SAÍDA DE PA FORA DO SISTEMA (REGULARIZAÇÃO)"); carga Glow Make Up
  `73eac72c…` (AGENDADO, 18 paletes, todos na baixa) CANCELADA com motivo. Piloto + resto,
  conferido: 425 caminhos, nenhum outro lote mudou, 13 paletes dos 10 lotes ficaram, kardex
  concilia. **Pedidos NÃO alterados** (usuário: "só estoque, mas conferir os pedidos"):
  26 pedidos com `expedido` 0; 6 com saída+estoque > produzido (PED-0008 MRARBS07, PED-0002
  MRARBS04, 0019 GLMKAM01/03, 0020 KUBPBA01-2, 26 ESF-SEUN-0001); 4 paletes sem pedido
  (PEL-SEUN-0001, PRF-AFEE-0032, KUBPBA02, PRF-PROP-0001); skuPedidoKey dos paletes sem zeros
  ("19__" × "0019__"). Backups em `backups/estoque_lotes-antes-regularizacao-20261001.json`
  e `backups/carga-73eac72c-antes-cancelamento-20261001.json`.

- **PUBLICADO — "1 a cada N peças", consumo inteiro e material sem controle de estoque
  (2026-10-01).** Pedidos: caixa de papelão como unidades por caixa em vez de 0,020833;
  consumo/estoque nunca em fração; itens como água sem controle de estoque. `utils.js`:
  `ehUnidadeDiscreta` (kg/g/L/ml/m contínuos, o resto discreto), `pecasPorUnidadeBom`
  (campo novo `bom/.../itens/{i}.pecasPorUnidade` ou 1/qtdPorPeca redondo — sem migração),
  `qtdBomParaPecas` (discreto: ceil), `consumoBomIncremental` (diferença dos acumulados da
  OP: inteiro e soma exata), `materialSemControleEstoque` (`materiais/{k}.controlaEstoque
  === false`). `explodirMateriaisNecessarios` usa qtdBomParaPecas. Baixa do apontamento
  (`form.html`) pelo acumulado `produzidoLinha`; perdas, pesagem (`manipulacao.html`),
  empenho (`emitir_op.html`), MRP (`insumos.html`) e sugestão de compra (`compras.html`)
  pulam o sem-controle. Cadastros: checkbox "Controla estoque" no material e "1 a cada N
  peças" no BOM (grava pecasPorUnidade + qtdPorPeca=1/N). Estoque: selo "sem controle".
  Testes `run_consumo_inteiro_test.js`, `run_apontamento_encerramento_test.js` (34+36=70
  caixas). **Dados (01/10):** água sem controle e unidade das MPGR-00038/47/50 (un→kg)
  ajustados pelo próprio usuário no cadastro; 8 caixas ET com saldo fracionado arredondadas
  para baixo com autorização (ex.: ET-00012 −2.231,798 → −2.232), cada uma com `ajustes/
  arred_20261001` e `movimentos_estoque/{k}/arred_20261001` (ajuste_manual, aparece no
  kardex); conferido: só saldo/última movimentação/ajustes mudaram, empenhos intactos.
  Backups em `backups/estoque-ET-*-antes-arredondamento-20261001.json`. Arquivos ativos: nenhum.

- **PUBLICADO — Estoque: coluna "Onde é usado" (2026-10-01).** Pedido: mostrar em quais
  BOMs/produtos o item é usado. `shared/onde-usado.js` (`OndeUsado.indice`): por produto
  ativo, só a versão vigente (maior, fora OBSOLETA) da fórmula (`mpCodigo`, %) e do BOM
  (`materialCodigo`, por peça). `estoque.html` aba Estoque: coluna com nº de produtos +
  2 SKUs, lista completa no drill-down da linha, ordenação e busca por SKU/descrição/
  cliente do produto. Base: 144 de 151 materiais com saldo têm uso; água em 169 produtos.
  Testes `run_onde_usado_test.js` e caso novo em `run_propriedade_estoque_ui_test.js`.
  Arquivos ativos: nenhum.
- **PUBLICADO — Bombona é opcional (2026-10-01).** Decisão do usuário: "não precisa cadastrar
  bombona hoje". Declarar bulk que sobrou (encerramento e Devolver OP à fila) vale SEM identificar
  recipiente: o seletor virou "não identificar agora (opcional)"; com bombona escolhida, ela segue
  sendo atualizada; sem, só o registro em `material_processo` (`recipienteCodigo: null`). A página
  Material em Processo trata "Bulk sem bombona" como informação opcional, não alerta. Regra em
  `shared/material-processo.js` (`aceitaRecipiente`, sem `exigeRecipiente`); testes ajustados
  (`run_material_processo_test.js`, `run_devolver_fila_ui_test.js` com caso sem bombona). Manual
  do apontador atualizado. Arquivos ativos: nenhum.

- **PUBLICADO — Kardex: contagens, aba Histórico e itemTipo (2026-10-01).** Pendências do
  kardex resolvidas: (1) `contagens_inventario` vira linha informativa "Contagem de
  inventário" no item (contado × sistema, diferença, ajuste aplicado ou não) e coluna
  "Última contagem" na Conciliação (`Kardex.movimentosContagens`/`prepararBase`); (2) aba
  Histórico do `estoque.html` virou atalho para `kardex.html?item=` (a lista antiga somava
  movimento de item e de lote); (3) `ajustarEstoque` (utils.js) aceita `extras.itemTipo`
  (padrão `material`), teste em `run_propriedade_estoque_test.js`. Arquivos ativos: nenhum.

- **PUBLICADO (parte 2 de 2) — Material em Processo: sobras no encerramento e "Devolver OP à
  fila" (2026-10-01).** `form.html` + novo `shared/material-processo-form.js`: (1) **contagem de
  sobras OBRIGATÓRIA** nas três formas de encerrar a OP (Encerrar OP do Painel de Turno, Apontamento
  por Total, Fechar Lote): toda linha do BOM + frascos rotulados + bulk (só OP com fase de bulk) pede
  número (0 = não sobrou; branco não passa), dono cliente/Kuryos por linha, bulk exige bombona (vazia
  ou do mesmo lote). Grava `ops/{op}/contagemSobras`, `material_processo/` e acerta a bombona
  (`bombonas_bulk`, com histórico). (2) **⏸ Devolver OP à fila** (botão em todo card com OP, todos os
  papéis do painel): a OP sai da linha/rotuladora SEM encerrar (`abertaDesde`/`abertaLinha` saem,
  `emFila` entra; produção e status intactos), pausa fechada em `paradas_historico`, `estado_linhas`
  liberada, itens retidos declarados (origem PAUSA); **+ Alocar OP** limpa `emFila` e continua de onde
  parou. (3) `ops.html`: chips "⏸ Em fila: motivo" e "📦 retidos: …" na linha da OP. Ensaio: o
  fluxo ponta a ponta (`run_fluxo_ponta_a_ponta_test.js`) agora conta as sobras. Testes novos:
  `run_devolver_fila_ui_test.js`; atualizados `run_fluxo_ponta_a_ponta_test.js`,
  `run_encerradas_ops_ui_test.js`. Manual do apontador atualizado. Arquivos ativos: nenhum.

- **PUBLICADO — Etiqueta de caixa de embarque padrão (2026-10-01), `f2f1e2a`.** Pedido: etiqueta emitida com a OP, campos obrigatórios nesta ordem: logo/nome do cliente, nome do SKU, código do cliente, qtde/cx, lote, validade, peso da cx, lote interno, DUN-14. Módulo `shared/etiqueta-caixa.js` (ITF-14 próprio, lido pelo ZXing a 8 e 6 px/mm; diálogo com pré-visualização, avisos de cadastro, cheias + parcial em branco, `ops/{op}/loteCliente`; formatos 90x55 e 100x70). Logo em Cadastros › Clientes (`clientes/{c}/logoEtiquetaUrl`, Storage `clientes_logo/`, regra nova em `storage.rules`). OP fotografa codCliente/kgCaixa/dum14/clienteKey. Etiqueta antiga (`montarEtiquetasCaixa`, CSS `.etiqueta-page`) removida. Hosting + Storage publicados por worktree limpo, 7 arquivos conferidos idênticos por HTTP. Testes: `run_etiqueta_caixa_test.js`, `run_etiqueta_caixa_ui_test.js`, `run_etiquetas_leitura_test.js`. Cadastro: só 28/385 produtos com DUN-14, 79 com código do cliente, 78 com peso. Arquivos ativos: nenhum.

- **PUBLICADO (parte 1 de 2) — Material em Processo: bombonas e tanques (2026-10-01).** Pedido do
  usuário sobre semiacabados: bulk e frascos rotulados em primeiro lugar; líder declara; contagem
  de sobras exigida no fim da OP; bombona identificada com etiqueta (lote, validade); dono às
  vezes cliente, às vezes Kuryos. **Parte 1 (no ar):** página `material_processo.html` (menu
  Operação › Material em Processo) com (a) Bombonas e tanques: cadastro em lote com código
  BB-0001/TQ-0001 (contador `contador_bombonas`), registrar bulk (OP, kg, dono, validade, local;
  lote diferente não se mistura, capacidade vale, complemento do mesmo lote soma), ajustar kg /
  esvaziar com motivo e histórico, **etiqueta** (`EtiquetasWMS` formato `bombona`: código, lote,
  kg, fabricação, validade, dono, local, barras e QR); lista "Bulk sem bombona identificada"
  (ensaio na base: 6 OPs, ~2.950 kg manipulados sem recipiente); (b) aba Sobras e retidos
  (`material_processo/`, baixa com motivo). Regras novas no banco (`bombonas_bulk`,
  `contador_bombonas`, `material_processo`; teste de regras no emulador com `--project demo-mp`).
  **Parte 2 (a fazer):** "Devolver OP à fila" + contagem de sobras exigida no Encerrar OP
  (`form.html`) + selo no Controle de OPs. Módulo puro `shared/material-processo.js` já traz as
  regras da parte 2. Testes: `run_material_processo_test.js`, `run_material_processo_ui_test.js`,
  `run_material_processo_rules_test.js`. Arquivos ativos para a parte 2: `form.html`, `ops.html`.

- **PUBLICADO — Kardex de estoque (2026-10-01).** Pedido: histórico kardex por item
  (entrou/saiu/consumido/ajustado, log de tudo), incluindo intermediários, e auditoria de
  inventário. `public/kardex.html` (menu Logística › Kardex, módulo `logistica`) sobre
  `shared/kardex.js`, que lê só `movimentos_estoque` + `estoque` + `estoque_lotes`.
  **Duas razões no mesmo log:** material (tem `estoque/{key}`) usa o saldo do item —
  contam recebimento_pc, consumo_producao, consumo_manipulacao, perda, ajuste_manual,
  cancelamento_recebimento, devolucao_fornecedor; item só com lote (PA, intermediário) usa
  a soma dos lotes — contam conferencia_pa, expedicao_pa, devolucao_cliente, saida_manual,
  descarte, inventario, producao_op, recebimento_pc, consumo (FEFO). `transferencia` e
  `qualidade` nunca contam (divisão de lote grava qtd POSITIVA). Tipo desconhecido conta
  pelo sinal. Lote `origemTipo: legado_planilha` vira linha sintética "Saldo implantado".
  `saldoApos` só confere elo (null tolerado). Ensaio na base: 178 itens, 151 conciliados,
  27 com saldo sem movimento registrado (todos materiais com consumo de 01–02/09, antes do
  log), 0 elos quebrados. **Contrato p/ intermediários (sessão não identificada):** gravar
  em `movimentos_estoque/{sanitizeKey(codigo)}` com `itemTipo: 'intermediario'`, `qtd`
  com sinal, `em`, `ref`, `loteKey`; ajustarEstoque fixa `itemTipo: 'material'` (aviso da
  sessão "Arquitetura de novo módulo e custos") — para agregado, aceitar itemTipo por extras.
  Testes `run_kardex_test.js` (+ ensaio com KARDEX_BASE) e `run_kardex_ui_test.js`.
  **Material em processo** (`6a90ddd`, bombonas): o kardex também lê
  `bombonas_bulk/{cod}/historico` (ENCHER/AJUSTE/ESVAZIAR, delta kgDepois−kgAntes) e
  `material_processo/` (sobra = entrada; baixa USADO/DESCARTADO/DEVOLVIDO = saída), como
  movimentos sintéticos (`Kardex.comMaterialProcesso`): itens `proc_bulk_{lote}`,
  `proc_rot_{sku}`, `proc_comp_{codigo}`; sobra de BULK com `recipienteCodigo` não conta
  duas vezes. Se esse módulo mudar o formato do histórico, ajustar
  `movimentosMaterialProcesso` em `shared/kardex.js`.
  Manual: `manual_estoque.html` §6. Arquivos ativos: nenhum.

- **PUBLICADO — Envase que bate a meta sem encerrar também vira etapa a confirmar (2026-10-01).**
  Turno retroativo e apontamento horário não "encerram" (sem `efeitosOp`), mas o cálculo
  de 95% leva a OP a `Aguardando Confirmação`; agora isso grava também
  `confirmacaoEtapas/envase` AGUARDANDO (`automatico: true`), para o PCP confirmar pela
  linha nova. Motivo: 26273/03 e /04 serão lançadas pelo retroativo (envase já fechado no
  chão). Teste em `run_apontamento_encerramento_test.js`. **Dado (autorizado em 01/10):**
  26273/03 gravada (status `Não Iniciado` + `confirmacaoEtapas/rotulagem` AGUARDANDO 1750,
  fechadoEm 2026-09-30T14:54:15Z) e 26273/04 (559, fechadoEm 2026-09-30T17:55:08Z) gravadas
  com autorização explícita do usuário; releitura conferida contra o backup: só `status` e
  `confirmacaoEtapas` mudaram, rotulagem 1750/559 e envase 0 intactos. Próximo passo é do
  chão: turno retroativo do envase das duas. Backups em `backups/op-26273-0{3,4}-antes-20261001.json`. Arquivos ativos: nenhum.

- **PUBLICADO — PCP confirma cada encerramento de setor (2026-10-01).** Pedido: "neste
  momento, o PCP confirme cada apontamento, de rotulagem e de envase". Cada fechamento
  (`aguardarConfirmacao`, exceto posto) grava `ops/{op}/confirmacaoEtapas/{envase|rotulagem}`
  = {status AGUARDANDO, quantidade (total do setor), fechadoEm, local, operador} na mesma
  transaction (`form.html`); novo fechamento do setor substitui o anterior. Controle de OPs
  (`ops.html`) lista uma linha por etapa no grupo "Aguardando Confirmação do PCP" (e no
  filtro de mesmo nome); confirmar grava CONFIRMADO/por/em por caminho plano; a última etapa
  de OP já `Aguardando Confirmação` conclui a OP (`confirmarConclusaoOp`). OP pronta sem
  etapa pendente mantém o botão antigo. Status da OP inalterado (rotulagem antes do envase
  segue ativa, `cab15a9`). Módulo `shared/confirmacao-etapas.js`, testes
  `run_confirmacao_etapas_test.js`, `run_apontamento_encerramento_test.js`,
  `run_fluxo_ponta_a_ponta_test.js`. Arquivos ativos: nenhum.
- **PUBLICADO — Botão de rearranjo que "sumia" (2026-10-01).** Relato: "o botão sumiu, até
  para mim, que sou admin". Causa (`form.html`): o Painel de Turno desenhava os cards ANTES de
  o papel do usuário chegar (`window.currentUser` ainda null), então a condição admin/PCP dava
  falso e o botão só voltava quando algum dado mudasse (o próprio `auth_check.js` documenta
  essa corrida e dispara `kuryos-auth-pronto`, que o form.html não escutava). Agora o painel
  redesenha nesse evento. O botão continua só nos cards de LINHA com OP alocada (hoje, na
  base, só a Linha 2: 26258/05). Teste novo `run_painel_rearranjo_ui_test.js` (tela real,
  login imediato e atrasado; admin/PCP veem, produção/qualidade não) — falhava antes.
  Arquivos ativos: nenhum.

- **PUBLICADO — "Mudar de linha / trocar OPs" também para o PCP (2026-10-01).** Era só admin
  em três pontos, todos ajustados para `admin` + `pcp`: botão no Painel de Turno
  (`form.html`), abertura do modal (`shared/rearranjo-linhas-tela.js`) e o servidor
  (`rearranjarLinhas` em `functions/index.js` + `functions/rearranjo_linhas.js`). Qualquer
  outro perfil continua recusado. Testes: `run_rearranjo_linhas_test.js` (PCP rearranja e
  preserva totais; produção/qualidade/usuário inexistente recusados) e
  `run_rearranjo_linhas_ui_test.js` (PCP vê e abre; produção e qualidade não veem).
  Arquivos ativos: nenhum.

- **PUBLICADO — Rotulagem antes do envase não manda a OP ao PCP (2026-10-01).** Relato:
  Controle de OPs pedia para confirmar OPs que só tinham rotulagem. Medido: 26273/03
  (rot 1750, envase 0) e 26273/04 (rot 559, envase 0) em `Aguardando Confirmação`.
  Causa: a correção de 30/09 (`25c8f63`) só olhava se o OUTRO setor estava aberto; com o
  envase ainda nem iniciado, nada estava aberto e o fechamento da rotulagem encaminhava a
  OP. Agora (`form.html`, `updateOpRecordOnApontamento`, `aguardaEnvase`) fechar a
  rotulagem só encaminha com `produzidoLinha > 0`; posto segue podendo encerrar sozinho.
  `run_apontamento_encerramento_test.js` cobre os dois sentidos (falha no código antigo).
  **Dado NÃO corrigido** (aguarda autorização): as duas OPs voltarem a `Não Iniciado`.
  Fora do escopo, só apontado: 26251/16 `Aguardando Confirmação` desde 14/09 com a
  Linha 3 ainda alocada. Arquivos ativos: nenhum.

- **PUBLICADO — Sugestão de compra de produto em g/kg (2026-09-30).** Erro reportado ao
  gerar solicitação de compra: "HDR-MISS-0005: unidade de volume "g" -- só sei calcular a
  partir de ml ou L". `explodirMateriaisNecessarios` (`shared/utils.js`) só aceitava ml/L,
  enquanto o Emitir OP (`dimensaoNominalDoProduto`) já calcula g/kg. Agora a massa do lote
  sai do peso nominal (densidade se cancela, não é exigida; volume do granel fica nulo sem
  densidade) — mesma conta do Emitir OP, conferida em `run_explosao_massa_test.js`.
  Base real: 33 produtos cadastrados em g/kg; todos calculam (14 sem fórmula cadastrada).
  De quebra: ml com densidade -1 (truthy) passava e dava quantidade NEGATIVA; agora exige
  densidade > 0. Arquivos ativos: nenhum.

- **PUBLICADO — Fotos em todas as análises da Qualidade (2026-09-30).** Pedido da
  Qualidade: foto na análise de insumos. Decisões do usuário: vale para qualquer análise
  (laudo de MP/embalagem/PA, bulk, RNC), até 6 fotos, reprovação exige pelo menos uma.
  Saída explícita "Não há o que fotografar" (fica gravada em `fotosDispensadas`; o motivo
  escrito continua obrigatório). `shared/fotos-qualidade.js` (regras puras + seletor +
  galeria); Storage `qualidade/{contexto}_{chave}/` (regra nova em `storage.rules`);
  gravação em `estoque_lotes/.../qualidade/fotos`, `ops/.../manipulacao/analise/fotos`,
  `nao_conformidades/{n}/fotos` e `fotosEncerramento`; a RNC automática herda as fotos do
  laudo. Upload só ao salvar (sem arquivo órfão). Aparece no histórico da Qualidade, nas RNCs
  e no Dossiê do Lote. Tocou `utils.js` (registrarLaudoQualidade, abrirRnc, encerrarRnc,
  registrarLaudoComRnc), `qualidade.html`, `dossie_lote.html`, manual. Testes:
  `run_fotos_qualidade_test.js`, `run_fotos_qualidade_ui_test.js`. Arquivos ativos: nenhum.

- **PUBLICADO — Item fora do cadastro não entra em fórmula aprovada nem em OP (2026-09-30).**
  Usuário: "se o item não existir no cadastro, não deveria aparecer na fórmula". Medido:
  fórmulas APROVADAS limpas, mas 80 dos 183 produtos com fórmula usam versão rascunho com
  item sem código (250 linhas da importação) ou material inativo (7), e o Emitir OP aceita
  rascunho; 15 desses têm pedido aberto ou OP recente. Módulo `shared/itens-cadastro.js`
  (`problemas`/`mensagem`, teste `run_itens_cadastro_test.js`): trava a aprovação de
  Fórmula e BOM (`cadastros.html`, `bloqueioAprovacaoComponente`) e a emissão
  (`emitir_op.html`, `validarMateriaisConsumo`), com a linha marcada em vermelho e
  resolução por "Substituir" na própria tela — não para a fábrica.
  `run_fluxo_ponta_a_ponta_test.js` cobre trava + substituição. Manuais PCP e Cadastros.
  Arquivos ativos: nenhum.

- **PUBLICADO — Andon: rotulagem, manipulação e qualidade (2026-09-30).** `dashboard.html`
  ganhou (1) a faixa "Cadeia do lote" — Manipulação → Qualidade do bulk → Envase →
  Rotulagem → Conferência de PA → Qualidade do PA, com contagem e a espera mais antiga
  de cada etapa, colorida quando passa do limite; (2) a fila da Qualidade por tipo
  (matéria-prima, embalagem, PA) e RNCs abertas; (3) cards das rotuladoras (operando/
  parada/livre, OP, %) e os postos abertos agora. O detalhe abre por clique. Tudo em
  `shared/andon-cadeia.js` (puro) + `run_andon_cadeia_test.js` e
  `run_andon_dashboard_ui_test.js`. Ensaiado contra a base real (achou que as 11 OPs da
  Logística deixam a faixa sempre em atenção — é o real). **Falta** a parte do dia
  fechado do Dashboard Diário (MELHORIAS_FUTURAS.md). Arquivos ativos: nenhum.

- **PUBLICADO — OP leva o nome do material do cadastro (2026-09-30).** Relato: MPES-00094
  no cadastro é "ESSENCIA LILAH ECO HS - GF49767", na OP saía sem o GF. Causa: Emitir OP
  copiava `mpNome`/`materialNome` do instantâneo da fórmula/BOM (nome de quando foi
  aprovada). Agora `nomeMaterialAtual` (`emitir_op.html`) usa o cadastro, com o nome da
  fórmula só se o material sumiu. Medido: 16 materiais com nome divergente em 38
  fórmulas; 18 OPs ativas com nome antigo em `materiaisConsumo`. **Dado corrigido
  com autorização do usuário (30/09):** 44 campos `mpNome` (41 em `materiaisConsumo`, 3 em
  `manipulacao/previstos`) por caminho plano; piloto na 26271/02, depois o resto; conferido
  44/44 e nenhum outro campo alterado. Backup local em
  `backups/nomes-materiais-ops-antes-20260930.json`. OPs encerradas mantidas como histórico. Fórmulas aprovadas não foram reescritas.
  `run_fluxo_ponta_a_ponta_test.js` cobre. Arquivos ativos: nenhum.

- **PUBLICADO — Onde está a OP indisponível no apontamento (2026-09-30).** Pedido do
  usuário: ao tentar alocar OP no envase que não está disponível, mostrar onde ela
  está. Antes a OP bloqueada sumia da lista (só um aviso com 4 lotes). Agora, no
  modal Alocar OP (`form.html`), as indisponíveis aparecem tracejadas e não
  selecionáveis com "onde está": sem bulk iniciado (+ situação da separação),
  pesagem/conferência/manipulação, bulk aguardando análise ou reprovado, aberta em
  outra linha, aguardando PCP, concluída, cancelada. Sem busca: bloco recolhido com
  resumo por setor; com busca: as que batem aparecem abertas (inclusive encerradas).
  O alerta do portão do bulk também diz "Onde está agora". Regra em
  `shared/onde-op.js` (`OndeOp.onde/resumo`, usa `Manipulacao.podeEnvasar`; NÃO
  confundir com `shared/situacao-op.js`, que é do Controle de OPs), teste
  `run_onde_op_test.js`; `run_fluxo_ponta_a_ponta_test.js` ajustado. Manual:
  `manual_apontamento.html`. Arquivos ativos: nenhum.

- **PUBLICADO — Encerrar num setor não encerra a OP inteira (2026-09-30).** Relato do
  usuário: a rotulagem encerrou "a mesma OP" que seguia no envase. Causa
  (`form.html`, `updateOpRecordOnApontamento`): a transação gravava `Aguardando
  Confirmação` em QUALQUER fechamento, sem olhar o outro setor; e o cálculo
  automático (envase ≥95%) também rodava a partir de apontamento de rotulagem.
  Agora o status só vai ao PCP quando o fechamento deixa a OP sem alocação aberta
  (`abertaDesde` Linha / `abertaDesdeRot` Rotulagem), e o cálculo automático só
  vale a partir de apontamento de envase com nada mais aberto. A mensagem ao
  operador diz "Etapa encerrada — a OP continua aberta no envase". Teste
  (`run_apontamento_encerramento_test.js`) reproduz o defeito no código antigo.
  **DADO NÃO CORRIGIDO:** OP 26267/02 segue `Aguardando Confirmação`/override manual
  com a Linha 1 aberta (960 de 1760); gravação em produção negada nesta sessão;
  backup em `backups/correcao-status-op-26267-02-*.json`. Pendente do usuário.
  Arquivos ativos: nenhum.

- **PUBLICADO — Entrega (PCP) e Prioridade (2026-09-30).** `pedidos/{chave}.dataEntregaPcp`
  (+ `Por`/`Em`): data por item, digitada por admin/pcp na coluna nova "Entrega (PCP)"
  de Pedidos (com selo de atraso e a previsão do Comercial ao lado, ⚠ quando o PCP
  entrega depois); aba Pedidos Comerciais mostra a MAIOR data dos itens e quantos
  itens estão sem data. Controle de OPs ganhou colunas "Prio." e "Entrega (PCP)"
  (leitura). Módulo `shared/entrega-pcp.js`; a sugestão dos 30 dias (corridos, com
  opção de úteis) existe como função pura e **não está ligada** (estoque/MRP ainda
  não confiáveis) — ver MELHORIAS_FUTURAS.md. Testes: `run_entrega_pcp_test.js`,
  `run_pedidos_conciliacao_ui_test.js`, `run_encerradas_ops_ui_test.js` (Pedidos agora
  13 colunas SKU / 11 comerciais). Arquivos ativos: nenhum.

- **PUBLICADO — Menu em sanfona + celular em todas as telas (2026-09-29).**
  `auth_check.js`: cada bloco do menu é um botão que abre/fecha; aberto o da
  tela atual + o último que a pessoa abriu (localStorage por usuário), um de
  cada vez; bloco de 1 link fica sempre aberto; menu com < 11 links fica sem
  sanfona. Celular: gaveta `min(300px, 86vw)`, alvos de 44 px, logo livre do
  botão. `shared/theme.css` (≤980 px): `body.has-sidebar` ganha
  `padding-top:58px` (o botão do menu cobria o título de ~30 telas) — recuos
  esquerdos por página removidos (form, estoque_setor, proximas_ordens,
  qualidade_historico); barras de abas rolam de lado (`:has(> .tab/.top-tab)`
  e `div.tabs`); `.header` quebra linha. Auditoria automática de todas as
  páginas em 375 px: zero rolagem horizontal e nenhum título coberto (antes:
  Estoque 761 px, Compras 288, Planejamento 268…). Teste novo
  `run_menu_sanfona_ui_test.js`; `run_operacao_ui_test.js` lê o bloco pelo
  `data-grupo`. Arquivos ativos: nenhum.

- **PUBLICADO — Pipeline semanal da Qualidade (2026-09-29).** Aba "Semana"
  (padrão) em `qualidade_historico.html`: abre na semana anterior completa;
  em aberto no início + entraram − decididas = em aberto no fim, com Δ vs
  semana anterior; decisões por resultado, por tipo, lista da semana; ◀ ▶.
  "Período" = indicadores de antes; clique na barra do gráfico abre a semana.
  Motor: `itensFluxo` (decididas + quarentena + bulk AGUARDANDO_CQ) e
  `pipelineSemana`. Na base a conta fecha em todas as semanas: 14/09 entraram
  18 e nada decidido; 21/09 entraram 35 (32 paletes), 26 em aberto no fim;
  28/09 (até agora) 30 decididas, 2 em aberto. Arquivos ativos: nenhum.

- **PUBLICADO — Histórico e indicadores da Qualidade (2026-09-29).**
  `qualidade_historico.html` (menu Qualidade › Histórico e Indicadores; página
  no módulo `qualidade`). Motor `shared/qualidade-historico.js` LÊ as decisões
  de onde moram: `estoque_lotes/*.qualidade` (MP/embalagem/PA) e
  `ops/*.manipulacao.analise` + `historico/c{n}.analise` (bulk, cada ciclo).
  KPIs: aprovação, reprovação, concessão, retido, tempo entrada→decisão
  (mediana/p90), bulk na 1ª análise, fila por tipo, série semanal, fornecedor,
  analista, peso/crítico de PA. Histórico com busca e links Laudo
  (`qualidade.html?emitir=&lote=`, novo link profundo) e Dossiê. Ensaio na
  base: 57 análises (38 PA, 7 bulk, 7 MP, 5 embalagem), nenhuma sem entrada ou
  analista; **bulk analisado 1–3 min depois de fechar a manipulação em 5 de 6
  casos** (lançamento em sequência, não tempo real de laboratório). Testes:
  `run_qualidade_historico_test.js`, `run_qualidade_historico_ui_test.js`.
  Próximo: histórico + dashboard da Manipulação. Arquivos ativos: nenhum.

- **PUBLICADO — Controle de OPs menos poluído (2026-09-29, opção A do usuário).**
  `ops.html`: lista principal só com o que pede ação. OP concluída sai da
  principal para a aba nova **Encerradas** (consulta, busca, link do Dossiê)
  quando o PCP confirmou e todo o PA está liberado; com PA em quarentena/
  reprovado ou conferência de PA aberta (ou confirmada há <7 dias sem
  conferência) continua na principal, seção "Concluídas, com produto acabado
  pendente". A situação é sempre calculada (`shared/situacao-op.js`), então a
  OP volta sozinha se chegar devolução em quarentena. "Aguardando emissão de
  OP" deixou de listar pedido já atendido (≥95%). Linha da OP: selos de
  pendência (falta linha, divergência, transferência, sem pedido, Qualidade,
  reprovado); quem emitiu e previsão de término ficam em "detalhes".
  Testes: `run_situacao_op_test.js`, `run_encerradas_ops_ui_test.js`.
  **Medido na base real (29/09, leitura autorizada):** das 1.315 OPs
  concluídas, 1.302 vão para Encerradas, 2 ficam na Qualidade e 11 esperam a
  Logística. Correções vindas da medição: sem selo "falta linha" (59 de 65 OPs
  ativas não têm linha, é normal) e "Aguardando emissão de OP" recolhida por
  padrão (60 itens de demanda real; 72 antes do filtro de ≥95%).
- **PUBLICADO — Pedidos menos poluído (2026-09-29).** `pedidos.html`: filtro
  padrão "Pedem ação" = em andamento (<95%) + produzido com PA no estoque
  esperando expedir (selo "📦 Aguardando expedição"); "Finalizados
  (consulta)" = o resto. Na base: 71 em andamento + 11 aguardando expedição
  (antes 71); as ~200 concluídas sem saldo (legado sem registro/já expedidas)
  saem do padrão. Colunas 15 → 12: Data Prod., Data Pedido e Qtd Total saíram
  (datas no hover de "Em aberto há"; quantidade no Progresso). Teste:
  `run_pedidos_conciliacao_ui_test.js` (padrão, finalizados, 12 colunas).
  Arquivos ativos: nenhum.

- **Incidente de deploy (29/09, ~1 min):** Hosting publicado de um worktree
  sem `e899e27`/`c1846b3` (barra de PA do Controle de OPs, já publicada pela
  outra sessão) voltou `ops.html` e tirou `shared/progresso-op.js` do ar.
  Corrigido no deploy seguinte, a partir do `origin/main` atualizado; todos os
  arquivos conferidos por HTTP. Lição: `git fetch` e comparar HEAD com
  `origin/main` IMEDIATAMENTE antes do deploy, não só antes do commit.

- **PUBLICADO — Controle de OPs: barra principal = produto acabado + hover por
  etapa (2026-09-29).** `ops.html`: a barra mostrava o que a rotulagem apontou;
  agora mostra PA conferido (estoque + expedido, mesma conta da Conciliação de
  pedidos, `porOp`) / planejado. Hover lista Manipulação (kg, rendimento ou
  pesado / previsto), Envase, Rotulagem, Posto (se houver), PA e Expedido.
  Enquanto a conciliação carrega, mostra "carregando" (nunca zero falso).
  Novo `shared/progresso-op.js` (puro) + `run_progresso_op_test.js` e
  `run_progresso_op_ui_test.js`. Achado no ensaio: campo ausente dava NaN%.
  **Depois (mesmo dia):** barra em três faixas — liberado pela Qualidade (verde,
  inclui expedido), aguardando a Qualidade (âmbar, QUARENTENA) e reprovado
  (vermelho); palete legado conta como liberado. `ProgressoOp.paletesPorOp`.
  Manipulação só aparece em OP que tem `ops/{op}.manipulacao` (as emitidas
  depois do portão do bulk); OP antiga não tem dado e fica sem a linha.
  Arquivos ativos: nenhum.

- **PUBLICADO — Qualidade: fila separada por tipo de análise
  (2026-09-29).** `qualidade.html`, aba Fila: abas Matéria-prima / Embalagem /
  Bulk / Produto acabado com contador (tipo por `roteiroDoLote`; bulk = granel
  aguardando análise + reprovado aguardando correção); "Ver tudo" consolidado
  é opção, lembrada em localStorage por uid. Sem escolha, abre no primeiro
  tipo com pendência; `?tipo=` na URL também. Laudos recentes filtram pelo
  tipo. A fila redesenha quando `materiais` carrega (antes a embalagem contava
  como MP até algum outro dado chegar). Testes: `run_inspecao_pa_ui_test.js`
  (abas, contagens, lembrança) + testes que abrem a Qualidade. Próximos:
  histórico + dashboard da Qualidade, depois da Manipulação.
  Arquivos ativos: nenhum.

- **PUBLICADO — edição no Histórico falhava com "set"
  (2026-09-29).** `historico.html`: ajustes do total da OP (transactions) e
  `saveOpDatasReais` (update na mesma OP) agora em FILA -- em paralelo o SDK
  abortava as transactions ("set"), o registro já estava alterado e o total
  ficava pela metade; repetir o salvamento com o registro velho em memória
  descontava de novo. Em erro, a lista recarrega. Seletor de linha da edição
  passa a listar as rotuladoras. Teste: simulador com transaction assíncrona
  que aborta em set/update no mesmo nó (`run_historico_apontamentos_ui_test.js`).
  **26267/01 CORRIGIDA NA BASE (29/09, autorizada pelo usuário):** registros
  28/09 Linha 3 · 1.056 e 29/09 Linha 3 · 885 (novo, `-P2corr26267x01L3`),
  rotulagem 29/09 · 1.760 mantida; OP envasado 1.941 / rotulado 1.760 /
  linha "Linha 3" + `correcaoApontamento`; pedido 0023 7.970 → 9.911
  (incremento). Backups no scratchpad da sessão. **NÃO usar "Reconciliar
  Pedidos" no 0023**: ele soma só OPs vinculadas (4.672) e apagaria a produção
  antiga sem OP. Publicados em 29/09 junto com `63b38bc`.
  Arquivos ativos: nenhum.

- **PUBLICADO — OP concluída com bulk aberto sumia da Manipulação
  (2026-09-29).** Caso 26267/01: OP encerrada com a manipulação em
  EM_MANIPULACAO; `manipulacao.html` escondia toda OP Concluída, ninguém
  fechava a manipulação e o bulk nunca chegava à Qualidade. Agora OP
  Concluída fica na lista enquanto a fase estiver aberta (AGUARDANDO_PESAGEM
  até EM_MANIPULACAO, e CORRECAO_ABERTA). Na base, das OPs sob o portão do
  bulk (emitidas desde 24/09): 26267/02 e /03 LIBERADO (o fluxo funciona),
  26267/01 presa. Teste: `run_manipulacao_ui_test.js`. **Pendente, do
  usuário:** aplicar a correção de apontamento da 26267/01 (rotulagem →
  envase) -- gravação em produção bloqueada nesta sessão; arquivo gerado
  para revisão. Arquivos ativos: nenhum.

- **Publicado — Movimentar (WMS) + etiquetas que leem (2026-09-29).** Commit
  `c071a09`, Hosting por worktree novo do origin/main; arquivos idênticos
  (inclui cargas/faturamento/qualidade). `movimentar.html` (De onde → O quê →
  Para onde → Confirmar; motor `shared/movimentacao-wms.js`; PA só inteiro;
  `separarParcialLoteEndereco` com `opcoes.origemTipo`). Etiquetas medidas com
  ZXing (`run_etiquetas_leitura_test.js`, precisa `ZXING_DIR` com
  @zxing/library + pngjs): **Code39 tinha '.' e '/' errados em utils.js**
  (endereço e lote de OP não liam) — corrigido; quiet zone em Code39/EAN;
  EAN da caixa 0,40 x 13 mm; `shared/etiquetas-wms.js` (recebimento, palete,
  endereço térmica/A4) — Recebimento da Logística usa o modelo novo. 24/24
  leituras a 8 e 6 px/mm. Backlog: etiqueta automática na Conferência de PA;
  leitor no iPhone. Arquivos ativos: nenhum.

- **Publicado — Expedição de vendas em três telas (2026-09-29).** Commit
  `c80f48b`, Hosting por worktree novo do origin/main; 14 arquivos públicos
  idênticos (inclui qualidade/planejamento/relatório de pedido). Sem mudança
  de Functions/regras (mesmas callables). `expedicao.html` = Montar carga
  (grade + transporte + Agendar; `?agenda=K` redireciona a `cargas.html`);
  `faturamento.html` = solicitar faturamento e registrar NF na página;
  `cargas.html` = acompanhamento (etapas, NF quando emitida, carregamento/
  saída com viagens parciais e recuperação de tentativa em
  `sessionStorage['cargasPA-tentativa']`, transporte, cancelar, linha do
  tempo, histórico). Saída só com NF registrada (`CargasPA.acoes().carregar`).
  Régua pura `shared/cargas-pa.js`; faixa `shared/cargas-fluxo.js`; agenda da
  Logística perdeu NF/solicitar (código removido), ganhou atalhos. Base real:
  1 carga ativa (Miss Rose, faturamento não solicitado), 338 saídas legado.
  Testes: `run_cargas_pa_test.js` (23), UI de carga parcial/agenda/expedição
  reescritos para as três telas, calendário atualizado + regressões.
  Arquivos ativos: nenhum.

- **Publicado — faixa do granel grava na especificação (2026-09-29).** Commit
  `9582204`, Hosting por worktree novo do origin/main; arquivos idênticos
  (inclui Planejamento e Relatório de Pedido). Ensaio SEM faixa na spec do
  produto ("-", vazio, "N/A" sem colunas) + faixa digitada = nova versão
  (`AnaliseGranel.especificacaoComLacunas`: copia a vigente, só preenche;
  `origem ANALISE_GRANEL`, `baseadaEm`, `faixasPreenchidas`). Faixa existente
  ajustada e NA seguem só do lote. Lote aponta para a versão analisada
  (`analise.especificacaoKey`); nova em `analise.especificacaoGerada`.
  Testes: `run_analise_granel_test.js` (58), `run_manipulacao_ui_test.js`
  + regressões. Arquivos ativos: nenhum.

- **Publicado — Análise do granel: NA, faixa editável, só o resultado
  (2026-09-29).** Commit `8ac1fb8`, Hosting por worktree novo do origin/main;
  arquivos idênticos (inclui Planejamento/ajuste-grade e Relatório de Pedido).
  Motor `shared/analise-granel.js`: NA em todo ensaio (`aplicavel:false` na
  spec começa em NA); faixa mín–máx editável vinda da especificação
  (colunas ou TEXTO: 282 linhas reais só tinham "5,5 – 6,5"/"180g-198g" no
  texto; agora 533/709 numéricas chegam preenchidas); numérico = só resultado,
  C/NC automático; faixa editada = `faixaAlterada` só no lote; produto sem
  especificação ganha `especificacoes/{sku}__v1` (origem ANALISE_GRANEL).
  Ensaios gravados mantêm os campos lidos por laudo de PA/INMETRO/dossiê
  (+ minimo, maximo, faixaAlterada, na; `cnc` 'NA'). Laudo de PA imprime
  N/A e número com vírgula. Testes: `run_analise_granel_test.js` (46),
  UI de manipulação/correção atualizadas + regressões. Arquivos ativos: nenhum.

- **PUBLICADO — botão "Ajustar a grade" a partir do desvio (2026-09-29).**
  Na Sequência, OP com desvio contra a grade de Quantidades tem o botão:
  `shared/ajuste-grade.js` compara falta do pedido (qtdTotal − produzido)
  com o que a grade ainda reserva (horas futuras em qualquer linha, hora
  corrente pela fração que falta); faltando, insere horas depois do último
  horário do pedido na linha e empurra os seguintes só até o primeiro vago;
  sobrando, libera as últimas e não puxa ninguém. Hora corrente ocupada por
  outro pedido nunca recebe inserção. Prévia + confirm; log em
  `ajustes_planejamento/{dia}` com `por`. Auto-ajuste pausado continua
  desligado. Testes: `run_ajuste_grade_test.js`, `run_proximas_ordens_ui_test.js`
  (clique, confirmação, gravação, log, desvio some). Commit `4d5707f`, só Hosting, conferido por HTTP.
  Arquivos ativos: nenhum.

- **PUBLICADO — Sequência herda a grade de Quantidades + aviso de desvio
  (2026-09-29).** `sugestoesDaGrade` lê `programacao` (janela de 14 dias
  para trás): OP sem decisão do PCP e sem `linha` entra na linha do pedido
  (`skuPedidoKey`; slot com o `lote` da OP vale mais) e na ordem do primeiro
  horário dele -- só sugestão, a decisão do PCP e a linha da OP vencem.
  Desvio (`desvioHoras`, ≥ 1 h) contra `dataFimPlanejada` da OP ou o fim do
  pedido na grade; mostrado só ao PCP. Tolerância de 1 min no fim de cada
  hora (segundos de sobra jogavam o término para depois da pausa). Commit `65a46ef`, só
  Hosting. Arquivos ativos: nenhum.

- **PUBLICADO — Sequência por setor e Próximas Ordens (2026-09-29).**
  Commit `7656081`, Hosting + RTDB (regra `sequenciamento`) do worktree limpo;
  6 arquivos públicos idênticos ao commit por HTTP.
  PCP ordena a fila de cada setor no Planejamento (aba "Sequência por setor",
  um bloco por setor: Separação, Manipulação, Envase por linha, Rotulagem por
  rotuladora); cada setor consulta a sua em `proximas_ordens.html?setor=`
  (só leitura; Logística vê a Separação). Etapas LIDAS da OP (sem ficha nova):
  `separacaoConcluida`, fase da manipulação (sai do setor em AGUARDANDO_CQ),
  `produzidoLinha`, `produzidoRotulagem` (rotulagem só se a OP tem rótulo em
  `materiaisConsumo`). O que roda vence o plano (`abertaLinha`/
  `abertaRotulagem`); OP na grade horária segue a grade. Estimativa encadeada
  por recurso nas horas de turno (mesma regra de `horasEPausasDoDia`), espera
  a etapa anterior da mesma OP (separação → manipulação → envase; rotulagem em
  paralelo). Ritmo: envase = menor entre `prodHoraRef` e o da linha; os demais
  informados pelo PCP. Gravado só `sequenciamento/{ordem,ritmos}`, caminhos
  planos; regra nova: escreve admin/pcp ou `modulos.emitir_op`, todos leem.
  Menu: "Próximas Ordens" em cada setor da Operação e "Próximas Separações" na
  Logística. Testes: `run_sequencia_setor_test.js`,
  `run_proximas_ordens_ui_test.js`, `run_sequencia_setor_rules_test.js`
  (emulador, `--project demo-sequencia`) + regras antigas no emulador +
  varredura. Adiados (reator, ritmo demonstrado, tempo do CQ) em
  `MELHORIAS_FUTURAS.md`. Arquivos ativos: nenhum.

- **Publicado — Rotulagem como área própria no apontamento (2026-09-29).**
  Commit `20e09b9`, Hosting + Functions `onTurnoEncerrado` e
  `checkNotificacoes` por worktree novo; arquivos públicos idênticos ao commit.
  Abas Envase/Rotulagem no Painel de Turno para quem tem os dois setores
  (`localStorage apontamento.setorVisao`); textos da rotulagem; parada na
  rotuladora pelo mesmo `estado_linhas`/`paradas_historico`, agora com `setor`
  (`linha`|`rotulagem`). Envase ignora parada de rotuladora: ritmo em
  `ops.html` e disponibilidade do e-mail de turno. Encerrar turno marca a
  rotuladora "Fim de turno". Cabeçalho do `form.html` abre espaço para o botão
  de menu no celular. Teste: `run_operacao_ui_test.js` (bloco 5b).
  Arquivos ativos: nenhum.

- **Publicado — modal do apontamento cabe no celular (2026-09-29).** Commit
  `a16b747`, Hosting por worktree novo; `form.html` idêntico ao commit. Com a
  perda item a item o Encerrar OP passava da tela e o botão ficava fora (sem
  rolagem). Modais de `form.html`: altura ≤ 100dvh, cabeçalho/botões fixos,
  corpo rola; z-index 10002 (acima do botão de menu, que cobria o título).
  Teste em 375×667 no `run_fluxo_ponta_a_ponta_test.js`. Outras páginas com
  modal de z-index 9999 podem ter o mesmo botão de menu por cima no celular —
  não verificado. Arquivos ativos: nenhum.

- **Publicado — resultados do laudo de PA no sistema (2026-09-28).** Commit
  `6e80660`, Hosting por worktree novo do origin/main; 7 arquivos públicos
  idênticos (inclui Relatório de Pedido e Manipulação). Laudo do palete ganhou
  "Resultados do laudo": FQ (parâmetros da especificação ou os 5 do modelo,
  mesclados com a análise do bulk do lote — marcados `bulk` — editáveis) e
  micro (realizada com resultado por análise + laboratório + nº do laudo
  externo, ou dispensada com justificativa). Grava `qualidade.resultadosPa`
  (campo novo na whitelist de `registrarLaudoQualidade`, utils.js). Impresso
  mostra só o digitado; `MICRO_PADRAO` de `laudo-cq.js` perdeu os resultados
  fixos ("Ausente") que eram impressos sem análise — laudo antigo agora sai
  com a micro em branco. Micro Presente/acima trava liberação; pendência só
  avisa. Motor `shared/laudo-pa-resultados.js`. Testes:
  `run_laudo_pa_resultados_test.js` (24), `run_inspecao_pa_ui_test.js`
  estendido + regressões. Arquivos ativos: nenhum.

- **Publicado — perdas item a item no fechamento da OP (2026-09-25).** Commit
  `e835c03`, Hosting por worktree novo do origin/main; 10 arquivos públicos
  idênticos ao commit. Motor `shared/perdas-etapa.js`. Encerrar OP (Painel de
  Turno) e Finalizar OP listam cada insumo da OP (`materiaisConsumo`; OP antiga
  usa o BOM de `baixarEstoqueConsumo`); envase pede também unidades envasadas
  descartadas e bulk (kg) — conversão só com peso/densidade reais (25 de 65 OPs
  abertas); rotulagem põe frascos/rótulos em cima. Fechar exige perda ou "Não
  houve perda". Formato de `perdas/{lote}` inalterado (tipo derivado do
  material, `especificacao` = nome; novos: `materialCodigo` sempre, `unidade`,
  `etapa`, `produto`). Insumo baixa estoque; produto é registro. Manipulação:
  `manipulacao/perdasMp/{itemKey}` (kg, ≤ pesado) + `semPerda`; soma em
  `perdasManipulacao`. Corrigido re-render que apagava o campo recém-tocado.
  Relatório de Pedido: perda de produto fora do total de componentes. Turno
  Retroativo segue com a lista livre. Bateria completa sem falhas.
  Arquivos ativos: nenhum.

- **PUBLICADO — peso do PA pela densidade + regras do INMETRO (2026-09-25).**
  Commit `f7354f7`, só Hosting (sem regras/Functions), do worktree limpo;
  4 arquivos públicos idênticos ao commit por HTTP.
  Produto declarado em ml era pesado em g e comparado direto com o nominal.
  `shared/inspecao-pa.js`: tudo em gramas de conteúdo líquido (balança tarada
  na embalagem vazia); nominal/T/2T × densidade para ml. Densidade: medida no
  laudo > ensaio "Densidade" da análise do bulk do lote > cadastro (OP
  `densidadeGranelUsada` / produto), origem gravada. Portaria INMETRO
  249/2021: T da tabela por faixa (não mais −3% fixo; `toleranciaPct`
  ignorado), c pelo plano (5/0, 13/1, 20/1, 32/2, 80/5; o do maior plano que
  a amostra cobre), nenhuma abaixo de 2T, média Qn − k·s. Pesagens padrão =
  n do plano pelo tamanho do lote (conferido da OP), senão 32. Registro
  `CK7-2026-09b`; laudo impresso (`laudo-cq.js`) mostra T, 2T, média mínima
  e densidade (laudo antigo sem `tolerancia` segue o texto de antes).
  Análise do bulk: valor numérico sempre apontável em pH/densidade/álcool,
  sem especificação mostra os seis ensaios padrão, e liberar sem densidade
  pergunta. Manual da Qualidade seção 1c. Testes: `run_inspecao_pa_test.js`,
  `run_inspecao_pa_ui_test.js`, `run_manipulacao_ui_test.js`,
  `run_correcao_bulk_ui_test.js` + varredura. Leitura da produção bloqueada
  nesta sessão: não foi possível ver quantos SKUs têm densidade no bulk/
  cadastro. Arquivos ativos: nenhum.

- **Publicado — Relatório de Pedido (2026-09-25).** Commit `a2a3ec9`, Hosting
  (republicado após o incidente abaixo; conferido byte a byte). Página nova
  `relatorio_pedido.html` (menu PCP e Comercial; módulos `pedidos`/`comercial`
  em `auth_check.js`): por item, pedido / produzido / a produzir / expedido /
  em estoque / lotes / perdas de componentes; clique abre os lotes; PDF, CSV e
  link `?pedido=`. Motor `shared/relatorio-pedido.js` sobre a
  `ConciliacaoPedidos` (mesma conta de `pedidos.html`); perdas pela regra do
  Histórico (`perdas/{lote}` vence `ops.perdas` do Excel; OP `-vN` herda a
  perda lançada no número do papel). Testes: `run_relatorio_pedido_test.js`
  (8), `_ui_test.js` (7). Ensaio: 14 de 80 pedidos têm perda; 8 lançamentos de
  julho são de OPs apagadas e sem pedido (não atribuíveis).
  **Histórico com rótulo trocado:** o commit `81b4876` diz "Relatório de Pedido
  publicado", mas contém a nota "correção de bulk publicada" da outra sessão —
  fiz `git add`/`commit` no checkout principal sem ver que havia um rebase dela
  parado no conflito. Conteúdo correto, só a mensagem errada; não reescrevi o
  main publicado. Lição: antes de commitar no checkout principal, `git status`
  inteiro (não `--short`), procurando rebase/merge em andamento.
  Arquivos ativos: nenhum.

- **Publicado — correção de bulk só com matéria-prima (2026-09-25).** Commit
  `967a93f`, Hosting por worktree novo do origin/main; 7 arquivos públicos
  idênticos (inclui Relatório de Pedido). A lista da correção oferece só MP
  (`tipo` MPGR/MPES, `Manipulacao.ehMateriaPrima`); EP/ES/ET/MU recusados;
  textos falam em matérias-primas. Arquivos ativos: nenhum.

- **Publicado — correção de bulk reprovado (2026-09-25).** Commit `b97fc03`,
  Hosting publicado. **Incidente:** meu deploy saiu de um worktree de
  `b97fc03` criado antes de `a2a3ec9` e derrubou o Relatório de Pedido (404);
  a outra sessão republicou `a2a3ec9` e conferi: relatório e correção de bulk
  no ar, idênticos ao origin/main. Lição: worktree de deploy nasce do
  origin/main recém-buscado NA HORA do deploy, nunca reaproveitado.
  Bulk reprovado deixava o lote travado. Agora: Qualidade abre a correção
  (card novo em `qualidade.html`, RNC obrigatória, massa que entra, insumos,
  transação só se ainda REPROVADO); o ciclo reprovado vai para
  `ops/{op}/manipulacao/historico/c{n}` e a fase recomeça em
  `CORRECAO_ABERTA` com os insumos como `previstos`; pesagem/conferência/
  manipulação existentes servem à correção; rendimento soma `entradaBulk`.
  Ao fechar, excedente = floor(rendimento ÷ kg/un da fórmula) − planejado →
  `qtdPlanejada` (original em `qtdPlanejadaOriginal`), `excedenteBulk`,
  BOM escalado em `materiaisConsumo` (`quantidadeOriginal`), empenho somado
  (transação própria — `empenharMateriais` SOBRESCREVE o empenho do lote) e
  `separacaoConcluida` reaberta como `separacaoParcial` + `separacaoReaberta`.
  Retroativo: `correcao.retroativo` dispensa foto com justificativa. Dossiê
  mostra todos os ciclos. Reprovar de novo na correção não abre RNC nova.
  Testes: `run_correcao_bulk_test.js` (60), `run_correcao_bulk_ui_test.js`,
  `run_correcao_bulk_rules_test.js` (emulador, `--project demo-operacao`) +
  regressões. **Pendente:** regularizar o lote reprovado de hoje
  (usuário precisa informar o lote e as quantidades; leitura da produção
  também bloqueada nesta sessão). Arquivos ativos: nenhum.

- **Publicado — Separação consolidada por material (2026-09-25).** Commit
  `c830041`, Hosting + RTDB por worktree limpo; 4 arquivos públicos idênticos ao
  commit e regra conferida no ar. Aba nova em `separacao_materiais.html`: soma o
  mesmo material de várias OPs (SKUs diferentes) por posição, na ordem do
  Planejamento (na linha → `dataInicioPlanejada` → sem programação pela emissão).
  Motor puro `shared/separacao-consolidada.js` (roda OP a OP sobre saldo simulado
  com o FEFO real, dono respeitado; falta cai na OP de menor prioridade). Grava
  pedaços com `origemRef` da OP, `ops/$op/separacaoParcial` (acumula) e
  `separacaoConcluida` só quando completa (`via: 'consolidada'`). Regra nova:
  esses dois campos graváveis por papel/módulo Logística — antes a separação por
  OP também tomava PERMISSION_DENIED ao marcar a OP. Testes: unit 7, UI 8,
  regras no emulador. **Atenção para testes de regra:** rodar com
  `--project demo-<ns>`; sem isso o emulador aplica as regras a outro namespace
  e tudo passa aberto (`run_operacao_rules_test.js` só passa com
  `--project demo-operacao`). Ensaio na base: 18 OPs elegíveis, **nenhuma com
  data no Planejamento** (tela avisa), 0 saldo endereçado nos materiais delas.
  Arquivos ativos: nenhum.

- **Publicado — PC direto travado em "Criando..." (2026-09-24).** Commit
  `f082ca6`, Hosting + RTDB; `compras.html` idêntico ao commit. O botão travava
  antes da conferência da rota (return sem destravar) e `#alertBox` ficava
  atrás do fundo do modal (z-index 500) — todo aviso com modal aberto era
  invisível em Compras. Agora a rota é conferida antes, o botão destrava em
  qualquer falha e o aviso flutua acima dos modais. Regras:
  `config/contadores/{solicitacaoCompra,processoCotacao,pedidoCompra}`
  graváveis pelo módulo Compras (antes só admin/PCP), só sobem. Testes:
  `run_pc_direto_ui_test.js`, `run_compras_contadores_rules_test.js` (emulador
  9023) + regressões de Compras. Arquivos ativos: nenhum.

- **Publicado — GAP-02 devolução de cliente (2026-09-23).** Commit `dd520ee`: Hosting + RTDB + todas as Functions (20, nodejs24; `receberDevolucaoCliente` criada; as da Expedição republicadas com a regra nova) por worktree limpo; 9 arquivos públicos idênticos ao commit. Regressão completa 86/86 após corrigir o painel de pendências do `ops.html` (botões dependiam do tempo de carga do perfil). Arquivos ativos: nenhum. Tela nova
  `devolucoes.html` (Comercial autoriza, Logística recebe, todos acompanham),
  `shared/devolucao-cliente.js` + cópia `functions/devolucao_cliente.js`, callable
  `receberDevolucaoCliente`, origem `devolucao_cliente` em
  `functions/expedicao_regras.js` = `shared/expedicao.js`, conciliação com
  DEVOLVIDO (estorno) e retrabalho (informativo) em `shared/conciliacao-pedidos.js`
  (`pedidos.html`, `gestao_comercial.html`, `shared/gestao-comercial.js` passam
  `devolucoes_cliente`), menu/módulos em `auth_check.js`, regras
  `devolucoes_cliente`/`contadores_devolucao`. Testes novos: unit (49),
  servidor+regras no emulador (25), UI (4 etapas).
  **Aviso ao Codex — `descarte.html`:** o cabeçalho é `<header class="header">`,
  e `renderUnifiedNavbar` (`auth_check.js:569/823`) remove todo `<header>` como
  legado — em produção o título e o selo "Conectado" da tela somem ao carregar o
  menu. Troca por `<div class="header">` resolve (feito assim em `devolucoes.html`).
- **Publicado — GAP-04 portão do bulk + GAP-18 (2026-09-23).** Commit `3d361e5`, Hosting por worktree limpo; `form.html`, `pedidos.html`, `shared/manipulacao.js` idênticos ao commit por HTTP. Arquivos ativos: nenhum.
  `shared/manipulacao.js` (`podeEnvasar` com fórmula + corte
  `PORTAO_BULK_DESDE` 24/09), `form.html` (5 portas do envase; rotulagem fora
  do portão), `pedidos.html` (sem "+ Novo Pedido"). Testes novos
  `run_portao_bulk_test.js` (28), `run_portao_bulk_ui_test.js` (6),
  `run_pedido_porta_unica_test.js` (4); `run_fluxo_ponta_a_ponta_test.js`
  ajustado para fixar a emissão depois do corte e exigir o portão (senão
  quebraria a partir de 24/09). Regressão de manipulação, apontamento,
  operação, retrabalho, rearranjo, histórico, transferência, conciliação e
  GAP-05 aprovada. Sem mudança de regras do banco.


- **Entregue — modelagem dos fluxos do sistema (2026-09-23).** Pedido do
  usuário: fluxo por área (tela › campo › onde aparece), numerado `[Área].n`,
  fluxo padrão ponta a ponta, fluxos não padrão e gaps. Em
  `FLUXOS_DO_SISTEMA.md`: 69 passos (CAD, CMP, COM, PCP, LOG, QUA, PRO, MAN,
  ROT, FAT), 28 exceções (EX-01..28) e 20 gaps (GAP-01..20; 4 altos:
  estoque sem base, devolução de cliente, portão do bulk, mudança de pedido
  que não chega à OP). Versão navegável publicada como artifact
  (https://claude.ai/artifact/4swhySza1PhashnA1ECYNH), gerada a partir do .md.
  Só documentação; nenhum código alterado. **Quem mudar um fluxo atualiza o
  passo no .md no mesmo commit.** Arquivos ativos: nenhum.
- **Integrado ao backlog (2026-09-23).** Cada gap do `FLUXOS_DO_SISTEMA.md`
  aponta a seção do `MELHORIAS_FUTURAS.md`; nova seção *Backlog × fluxo* encaixa
  cada seção do backlog em gap/passo ou "dívida técnica". Do backlog vieram
  GAP-21..28 e EX-29..32 (transformação de material, devolução de remessa ao
  cliente, sobra da pesagem, inspeção em linha CK-3/4/5/6/8, documentação CQ,
  coletor, histórico de produto, dossiê). No backlog: nota de ligação no
  topo, seção *Gaps levantados na modelagem de fluxos* (GAP-02/03/04/05/13/18,
  que não tinham item) e 6 itens marcados FEITO (selo, solicitação pelo MRP,
  estoque de PA, devolução ao fornecedor, em trânsito, campo de segurança).
  Destaque: migração do Node 20 das Functions vence em 30/10/2026.

- **Publicado — vírgula decimal na Qualidade (2026-09-23).** Hosting;
  `qualidade.html` e `shared/campo-decimal.js` idênticos ao commit. Num
  `type="number"` o Chrome descartava a vírgula ("197,5" → 1975, sem aviso).
  O script converte os `step="any"` da página em texto com teclado decimal e
  normaliza (vírgula → ponto). Outras telas com `step="any"` ainda têm o
  mesmo risco — incluir o script nelas é uma linha cada.
- **Publicado — média de peso do CK-7 pelo INMETRO (2026-09-23).** Commit
  `5bd3027`, Hosting; `qualidade.html` e `shared/inspecao-pa.js` idênticos ao
  commit. A média exigia ≥ nominal sem tolerância (tela só mostrava o −3%
  individual) e bloqueava lotes dentro dos −3%. Decisão do usuário: x̄ ≥ Qn − k·s,
  k = t(99,5%; n−1)/√n (bate com a tabela da Portaria 249/2021). Com menos de
  5 unidades segue média ≥ nominal. Tela mostra média mínima, k e s; laudo
  grava `limiteMedia`, `k`, `desvioPadrao`. Individual continua sem as `c`
  unidades toleradas do plano do INMETRO (mais rígido; não pedido).
  Arquivos ativos: nenhum.

- **Módulo Operação, Fase 1 (2026-09-23) — PUBLICADO.** Commit `fccafce` (rebase de `88060ca`, mesmo conteúdo)
  no origin/main; Firebase `prod-kuryos`: Hosting + RTDB + função nova
  `onPesagemFechada` (criada; segredos do Graph concedidos). Os 9 arquivos
  públicos alterados conferidos por HTTP: 200 e idênticos ao commit.
  O que entra: menu "Operação" (Produção / Manipulação / Rotulagem), um
  checkbox por setor em Usuários (`apontamento` segue sendo a chave da
  Produção; `manipulacao`, `rotulagem`, `conferencia_pesagem` novos).
  Marcação antiga só com `apontamento` herda os dois setores novos enquanto
  a chave estiver ausente; `usuarios.html` grava `false` ao desmarcar.
  Perfil `rotulagem` passa a ver só a Rotulagem (não vê mais a Manipulação).
  Histórico: setor vê só os seus apontamentos; editar/excluir só admin/PCP
  (perfil `production` perdeu a edição, pedido do usuário). Estoque por
  área, só consulta (`estoque_setor.html` + `shared/estoque-setor.js`,
  áreas por setor em `config/operacao/areasPorSetor`). Chave "Conferência
  de Pesagem" (`config/conferenciaPesagem/ativa`, Ajustes): ligada, só
  Qualidade/P&D conferem com login; admin libera com motivo
  (`conferencia/modo = LIBERADO_PELO_ADMIN`); e-mail `onPesagemFechada`
  (`functions/pesagem_fechada.js`, marca em `notificacoes_pesagem`).
  Regras: módulos da Operação onde `apontamento` já escrevia + `ops` e
  `estoque`; `ops/$opKey/manipulacao` para papel `qualidade` e marca
  `conferencia_pesagem` — corrige a liberação do bulk pelo papel
  `qualidade`, que as regras negavam. "Granel" virou "bulk" só no texto.
- **Validação:** `run_operacao_ui_test.js` (novo), `run_operacao_rules_test.js`
  (novo, emulador 9023), `run_pesagem_fechada_email_test.js` (novo),
  manipulação unit/UI, histórico unit/UI, apontamento, OP encerrada,
  transações null, dossiê e `run_retrabalhos_rules_test.js` no emulador.
  Varredura completa: só 7 falhas, todas anteriores a este trabalho —
  testes de Expedição/Compras fazem `JSON.parse` cru de
  `database.rules.json`, que tem uma linha `//` desde `ea4c1bd`.
- **Arquivos ativos:** nenhum. Fases 2 e 3 registradas em `MELHORIAS_FUTURAS.md`.

- **Escopo atual — teste de fluxo ponta a ponta (2026-09-22).** O usuário pediu
  testar "as funcionalidades, fluxos, integrações", começando "no orçamento >
  cadastro > pedido" e seguindo em cadeia. `run_fluxo_ponta_a_ponta_test.js`
  agora dirige as telas reais de Orçamento → aceite → cadastro → Pedido →
  Emissão de OP → Apontamento → Conferência de PA → confirmação do PCP, com o
  banco vivendo no Node e passando de tela em tela.
- **Corrigido nesta rodada:**
  1. `ops.html` — "Confirmar conclusão" não existia nas visões filtradas; quem
     filtrava por "Aguardando Confirmação" via a OP e nenhuma forma de
     confirmá-la, travando Conferência de PA, estoque e Expedição atrás disso.
  2. `cadastros.html` + `database.rules.json` — a solicitação de cadastro aberta
     pelo aceite de orçamento não era lida por NENHUMA outra tela. Agora aparece
     como tarefa na aba Produtos, abre o cadastro pré-preenchido e é fechada
     (`CADASTRADO` + `produtoKey`) quando o produto é salvo. A regra do nó ganhou
     `modulos.cadastros`, senão quem cadastra tomaria PERMISSION_DENIED.
  3. `comercial.html` — a previsão comercial de entrega agora desce para
     `pedidos/{PED__SKU}/dataEntrega`. O MRP **continua** ignorando-a de
     propósito; a razão está em `MELHORIAS_FUTURAS.md`.
- **Armadilha que isto custou:** `currentUserNome` existe em `cadastros.html`,
  mas dentro de outras IIFEs. Chamada da IIFE de Produtos era ReferenceError, o
  throw caía no `.catch` genérico do save e a tela dizia "Erro" enquanto o
  produto era gravado normalmente e a tarefa ficava aberta em silêncio.
- **Cadeia fechada até a Expedição (commit `f0f7f11`).** O teste vai de
  orçamento até o palete endereçado em QUARENTENA, a fila do CQ e a trava da
  Expedição. O passo 8 é negativo de propósito: roda `shared/expedicao.js`
  contra o estado produzido e exige recusa por "Aguardando liberação da
  Qualidade" — qualquer outro motivo significaria que o laudo liberaria e a
  Expedição travaria no motivo seguinte. Falta o laudo do CQ e a saída física.
- **Cuidado para quem mexer no harness:** `functions/conferencia_pa.js` exporta
  `prepararFinalizacao` (pura, devolve `{updates, ...}`), não `finalizar`.
  Tratar o retorno inteiro como mapa de updates grava nós de lixo e nenhum
  palete — e a tela continua dizendo "Conferência concluída".
- **Gaps conhecidos que NÃO corrigi** (são escopo do `PLANO_PLANEJAMENTO_PCP.md`):
  OP nasce sem `dataInicioPlanejada` quando não há bloco programado; o portão do
  granel só barra OP que já começou a manipulação, então OP recém-emitida vai
  direto ao envase sem laudo.
- **Arquivos ativos:** `public/cadastros.html`, `public/comercial.html`,
  `public/ops.html`, `database.rules.json`, `run_fluxo_ponta_a_ponta_test.js`.
  `public/shared/conciliacao-pedidos.js` está modificado na árvore e **não é
  meu** — não tocado, não commitado.

- **Entrega publicada — retrabalho é uma OP (2026-09-22).** O usuário refez
  o escopo: *"apenas poder abrir uma OP, mas de retrabalho... pode ser
  alocada em linhas de produção ou postos de trabalho"*. O universo paralelo
  `retrabalhos/{id}` sai do caminho principal.
  - **`public/shared/retrabalho-op.js`** monta a OP. O que impede contar
    produção duas vezes são duas AUSÊNCIAS, não campos novos: **sem
    `skuPedidoKey`** (o crédito ao pedido já é pulado) e **sem
    `materiaisConsumo`** (a baixa de BOM já não acontece). Quem "completar"
    esses dois campos um dia quebra a regra inteira — tem asserção própria
    em `run_retrabalho_op_test.js` por isso.
  - **Numeração `{lote}-RT{n}`** (decisão do usuário): retrabalho não gera
    lote novo, é o mesmo lote voltando.
  - **Abrir:** botão ♻️ no Controle de OPs (filtre por Concluído ou busque o
    lote — a tela esconde concluídas por padrão, de propósito).
  - **Posto executa OP:** `produzidoPosto` e `tipo==='posto'` já existiam,
    mas **nada escrevia** neles. Agora o card do posto mostra a OP de
    retrabalho alocada (vínculo pelo campo `linha`, sem campo novo) e
    "+ Somar produção" credita a OP via `ajustarProduzidoOp(...,'posto',...)`.
    É a única peça de verdade nova.
- **PENDÊNCIA OPERACIONAL — migrar o caso do TAWUS.**
  `scripts/migrar-retrabalho-para-op.js` converte o RT-26216-04-20260921 em
  `26216/04-RT1`, preserva setup/envase/pausa, **libera o bloqueio da Linha
  2** e marca o registro antigo como migrado. Idempotente, com backup e
  ensaio (sem `--apply` só simula). Lógica coberta por
  `run_retrabalho_migracao_test.js`. **Ainda NÃO foi executado contra
  produção** — escrita em produção não é liberada para mim nesta sessão.
  Até rodar, a Linha 2 continua recusando alocação.
- **Aviso ao Codex:** `form.html` levou o vínculo posto→OP e o script do
  módulo; `ops.html` levou o botão e o modal. `functions/retrabalhos.js`,
  `rearranjo_linhas.js` e o painel de execução continuam de pé — o caso
  antigo segue funcionando até migrar.
- **Arquivos ativos:** nenhum; entrega encerrada. 72 de 73 testes passando;
  o único que não roda é `run_retrabalhos_rules_test.js` (emulador 9023).

- **Entrega publicada — gestão de retrabalhos (2026-09-22).** O usuário pediu
  para eu corrigir a entrega anterior: *"não ficou bom... não deu pra
  acompanhar bem"*. Dois defeitos concretos, os dois corrigidos:
  1. **O botão "Encerrar execução" sumia** quando havia apontamento com
     quantidade pendente, sem dizer por quê. Agora aparece DESABILITADO com
     o motivo ao lado. (Isso inverte a asserção da linha 13 de
     `run_retrabalhos_ui_test.js`, que eu atualizei com comentário — era a
     única forma de deixar a suíte verde e o comportamento certo.)
  2. **O caso morria em `aguardando_qualidade`:** não havia passo de
     avaliação. Nova ação `decidir` (liberado / nova etapa / reprovado) com
     responsável, análise e histórico. **"Nova etapa" reocupa a linha de
     verdade**, senão seria só um rótulo e o caso ficaria de novo sem saída.
  Nova tela **`public/retrabalhos.html`** (módulo `qualidade`, menu novo):
  KPIs, filtros, busca, linha do tempo do caso, conferência da quantidade
  pendente e a avaliação. `decidir` é REGISTRO — não mexe em estoque, lote
  nem RNC, como o `PLANO_GESTAO_RETRABALHOS.md` exige.
- **Aviso ao Codex — permissões.** `apontarRetrabalho` passou a aceitar o
  papel `qualidade` no gate do callable, **só** para decidir: quem separa as
  ações é `PODE_EXECUTAR` x `PODE_DECIDIR` em `functions/retrabalhos.js`.
  Qualidade continua sem poder apontar execução (coberto por teste).
  `form.html` levou **uma linha** — o `<script>` de `retrabalhos-gestao.js`,
  para o Apontamento e a tela nova dizerem a mesma frase.
- **O modelo completo do plano continua com você.** Não implementei caso x
  roteiro x ordens de fabricação/envase/rotulagem, postos nem unidades
  decimais. O que entreguei opéra sobre o `retrabalhos/{id}` que já existe.
- **Arquivos ativos:** nenhum; entrega encerrada. Testes novos:
  `run_retrabalhos_gestao_test.js`, `run_retrabalhos_decisao_test.js` e
  `run_retrabalhos_gestao_ui_test.js`. 68 de 69 passando — o único que não
  roda é `run_retrabalhos_rules_test.js`, que exige o emulador na 9023.

- **Entrega publicada — laudos do CQ em PDF (2026-09-21/22).** `0204133` e
  o commit desta entrega, os dois no `origin/main` e no Hosting por worktree
  limpo. Três pedidos do usuário:
  1. **Pesagem do CK-7 em aberto.** A tela dava um campo por caixa da
     amostragem √N+1 (4 ou 5). Mas √N+1 é a amostra de ASPECTO, sobre as
     CAIXAS; o Relatório de Análise pede "Análise de Peso: 32 amostras", que
     é outra coisa. Agora começa em 32 e a inspetora muda à vontade.
  2. **Relatório de Análise de PA em PDF**, com as 9 seções do modelo Word
     oficial, microbiológicas opcionais (sem elas sai a justificativa do
     álcool ≥ 60%) e responsável escolhido na hora de imprimir.
  3. **F0070 (MP) e F009 (embalagem)**, roteados pelo `tipo` do cadastro de
     Materiais: MPGR/MPES/MU → MP, EP/ES/ET → embalagem. Embalagem ganhou
     roteiro próprio (13 parâmetros do formulário + tabela dimensional em
     aberto) porque o que se analisa nela não é ensaio de laboratório.
  Novos: `public/shared/laudo-cq.js`, `laudo-cq.css`, `inspecao-embalagem.js`,
  `run_laudo_cq_test.js`. Os formulários foram lidos em
  `06. Laboratório/01. CQ` antes de escrever código — o layout é o do papel,
  o ganho é a origem do dado.
- **Aviso ao Codex — `utils.js` mudou.** `registrarLaudoQualidade` guarda
  três campos novos no laudo (`recebimentoCq`, `embalagem`, `resumoEmbalagem`).
  Nada existente mudou de forma. Vi o seu "não tocar Cadastro/CQ/utils.js" —
  combinado, mas estes 7 arquivos eram o escopo que reservei em `d3d6169`.
- **Aviso ao Codex — `run_retrabalhos_rules_test.js` exige o emulador na
  9023.** Ele é o único que não roda numa varredura comum (65 de 66 passam);
  quem for rodar a suíte inteira precisa subir o emulador antes.
- **Arquivos ativos:** nenhum; entrega encerrada.

- **Entrega publicada — impressão das fichas de OP (2026-09-21).** `cb9b6a4`
  no `origin/main`; Hosting por worktree limpo (4 arquivos públicos conferidos
  por HTTP, idênticos ao commit). Três achados
  do usuário, com PDF real das OPs 26253/07 e 26261/04 (22 folhas cada):
  (1) ensaio cadastrado por `minimo`/`maximo` saía com a coluna
  Especificação EM BRANCO na ficha físico-química — só `especificacaoTexto`
  era impresso; (2) 16 folhas EM BRANCO por impressão — `body
  *{visibility:hidden}` esconde mas não tira do fluxo, então o Chrome
  paginava a tela do app inteira por trás; (3) Ordem de Envase vazando pra
  uma 2ª folha. O bloco CSS de impressão, que era duplicado em
  emitir_op.html e ops.html, virou **`public/shared/fichas-op.css`**. O
  nome do PDF passou a ser `lote - cliente produto - sku`
  (`nomeArquivoFichasOP`/`imprimirComNome` em utils.js), padrão da OP em
  Excel que a fábrica já arquivava.
- **Correção em cima da entrega — `f5f1fb2`, publicado.** O primeiro
  conserto não bastou: no cadastro a coluna Especificação desses ensaios
  não está VAZIA, está escrita **"N/A"** — e "N/A" é um valor, então o
  texto vencia a faixa e a ficha continuava sem parâmetro. `textoEspecAusente`
  trata N/A, NA, N.A., "-" e vazio como ausência. A faixa também passou a
  imprimir o limite COMO ESTÁ no cadastro ("180g – 198g", não "180 – 198"):
  a unidade faz parte da especificação e sumia ao formatar pelo parseFloat;
  a comparação do laudo continua pelo número.
- **Aviso ao Codex — `avaliarEnsaio` mudou de comportamento.** Limite
  cadastrado com vírgula ("0,8") virava `parseFloat` = 0, não NaN: a faixa
  saía "≥ 0" e o laudo aprovava qualquer leitura. Agora `numeroEspec`
  troca a vírgula antes de converter, e o mesmo número vale pro laudo
  (qualidade.html) e pra ficha impressa. `run_inspecao_pa_test.js` e
  `run_inspecao_pa_ui_test.js` seguem passando.
- **Aviso ao Codex — `run_agenda_expedicao_ui_test.js` passa.** O timeout
  que registrei em 18/09 era falta de navegador do Playwright nesta
  máquina, não defeito: com `channel: 'chrome'` os 15 testes de UI passam.
  Vale baixar os navegadores (`npx playwright install`) antes de concluir
  que um teste de UI quebrou aqui.
- **Arquivos ativos:** nenhum; entrega encerrada. `compras.html` tem o
  MESMO defeito de folha em branco (`visibility:hidden` no bloco de
  impressão) — a correção pronta está em `public/shared/fichas-op.css`;
  deixei registrado em `MELHORIAS_FUTURAS.md` por ser escopo do Codex, não
  mexi.
- **Sessão paralela:** enquanto isto rodava, a devolução ao endereço
  (`a7fadf3`) foi commitada e publicada por outra sessão minha. O worktree
  limpo desta entrega saiu de `cb9b6a4`, que já tem `a7fadf3` como
  ancestral — nada meio-pronto foi ao ar.

- **Entrega publicada — devolução da embalagem ao endereço (2026-09-21).**
  `a7fadf3` no `origin/main`; Hosting por worktree limpo (4 arquivos idênticos).
  Fluxo real confirmado pelo usuário: não há separação para o granel — o
  operador pega a embalagem inteira, item a item, e guarda de volta. A tela da
  MP ganhou "Guardar de volta" (confirma o endereço de origem ou escolhe outro,
  e aí `transferirLoteEndereco` move o lote); registro em
  `pesagem/devolucoes/{mp}`; dossiê mostra por MP.
- **Armadilha nova:** `firebase deploy | grep -m1` mata o deploy no meio
  (SIGPIPE) e ele sai sem publicar — o `cmp` contra produção pegou. Não filtre
  a saída do deploy com `-m1`.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — pesagem no celular + lote pelo FEFO (2026-09-18).**
  `47c2eb2` no `origin/main`; Hosting por worktree limpo (5 arquivos idênticos).
  `manipulacao.html`: três telas (lista na ordem da fórmula → MP → nova
  pesagem com foto primeiro). Plano FEFO congelado em `pesagem/planoLotes`;
  lote fora do FEFO exige `motivoForaFefo`. **`shared/utils.js` (reservado a
  mim):** `sugerirAlocacaoFefo` ganhou opções `loteInterno`/`separadoPara`
  (só ordenação, sem efeito quando ausentes) e `separarParcialLoteEndereco`
  grava `enderecoOrigemKey/Codigo`.
- **Aviso ao Codex:** `run_agenda_expedicao_ui_test.js` dá timeout também no
  HEAD anterior (`8afcf05`), sem as mudanças acima — falha pré-existente,
  provavelmente dependente de data. Não mexi.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — pesagem em parcelas + Dossiê do Lote (2026-09-18).**
  `a1f04f5` no `origin/main`; Hosting por worktree limpo (6 arquivos idênticos
  ao commit). Pesagem: cada ida à balança é parcela com peso/lote/foto em
  `ops/{lote}/manipulacao/pesagem/parcelas/{mp}`; soma automática, cancelamento
  com motivo (nunca apaga). Novo `dossie_lote.html` + `shared/dossie-lote.js`
  (só leitura): busca por lote/cliente/produto e junta OP, granel, apontamentos,
  paradas, perdas, consumo, paletes/laudos, conferência PA, RNC e linha do
  tempo. Acesso só PCP (`emitir_op`) e `qualidade` — `8a97177` tirou do operador.
  Testes: `run_dossie_lote_test.js` (novo), manipulação unit/UI e regressões.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — foto por matéria-prima na pesagem (2026-09-18).**
  `50d1b09` no `origin/main`; Hosting por worktree limpo (`manipulacao.html`,
  `qualidade.html`, `shared/manipulacao.js` idênticos ao commit). Cada MP exige
  foto própria em `ops/{lote}/manipulacao/pesagem/fotosItens/{item}`; ícone de
  câmera por linha; tabelas viram cartões abaixo de 700px. A foto geral
  (`pesagem/fotos`) deixou de valer. Testes de manipulação, anexos, CK-7,
  apontamento e transações aprovados.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — foto obrigatória da pesagem (2026-09-17).** `13f1142`
  no `origin/main`; Hosting + regras de Storage por worktree limpo às 23:19 BRT
  (`manipulacao.html`, `qualidade.html`, `shared/anexos.js`,
  `shared/manipulacao.js` idênticos ao commit). A pesagem do granel só fecha com
  foto (câmera do celular), guardada em Storage `/manipulacao/{lote}/` e
  registrada em `ops/{lote}/manipulacao/pesagem/fotos`; a Qualidade vê as fotos
  na análise do granel. Módulo novo `shared/anexos.js` (validação por perfil,
  caminho seguro, registro) para reaproveitar em RNC, calibração e COA.
  `storage.rules`: pasta `/manipulacao/{lote}` só imagem < 10 MB (Comercial
  intacto). Testes: `run_anexos_test.js`, `run_manipulacao_test.js`,
  `run_manipulacao_ui_test.js` + regressões.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — CK-7, inspeção de produto acabado (2026-09-17).**
  `457d010` no `origin/main`; Hosting + regras por worktree limpo às 19:35 BRT
  (`qualidade.html`, `shared/inspecao-pa.js`, `shared/utils.js` idênticos ao
  commit). A fila de PA usava o plano de GRANEL para liberar palete. Agora usa
  checklist próprio: seções com severidade, amostragem √N+1 das caixas, pesagem
  individual (média, mínimo, −3% INMETRO), retenção validade+1 ano e laudo
  externo. Crítico ou peso fora **bloqueiam** a liberação. Torque só com
  `parametros_pa/{sku}.torqueAtivo` (a Qualidade não usa torquímetro).
  `utils.js`: `registrarLaudoQualidade` passou a gravar `ck7`/`resumoCk7`.
  Nó novo `parametros_pa` com regra igual à de `nao_conformidades`.
  Testes: `run_inspecao_pa_test.js`, `run_inspecao_pa_ui_test.js` + regressões
  de recebimento/CQ, conferência PA, expedição, descarte e transações.
- **Entrega publicada — manipulação como fase do lote (2026-09-17).**
  `50b5e46` no `origin/main`; Hosting por worktree limpo às 20:58 BRT (6 arquivos
  idênticos ao commit). Lote da manipulação = lote da OP, então a fase vive em
  `ops/{lote}/manipulacao` (sem numeração nova). Tela nova `manipulacao.html`:
  pesagem (previsto × pesado, lote da MP, perda, justificativa fora de 2%),
  **conferência por outra pessoa** (quem pesou não confere; divergência trava),
  manipulação com tempos/perdas/rendimento, envio à Qualidade. Baixa de estoque
  na **pesagem**, com tipo `consumo_manipulacao` novo em `utils.js`. Qualidade
  ganhou a fila de granel (usa `especificacoes`, reprovar abre RNC). `form.html`:
  não aloca OP com granel não liberado (OP sem a fase segue livre) e não baixa a
  fórmula de novo quando a pesagem já baixou. Menu/acesso: `manipulacao.html` no
  módulo `apontamento`. Testes: `run_manipulacao_test.js`,
  `run_manipulacao_ui_test.js` (3 telas, 3 usuários) + regressões de apontamento,
  CQ, conferência PA e transações.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — Calendário de agendamentos na Logística (2026-09-17).**
  Aba **Calendário** em `logistica.html` + motor `shared/calendario-logistica.js`
  (Hosting, worktree limpo, arquivos idênticos ao commit). Junta entradas de PC
  (`agendamento`; `dataPrevistaEntrega` como PREVISTO) e saídas de PA
  (`agendamentos_expedicao`, inclusive `EXPEDIDO_PARCIAL`); mês/semana/lista no
  celular; detalhe chama `openModalAgendar`/`openModalReceber` e
  `expedicao.html?agenda=`. Só leitura. Testes `run_calendario_logistica_test.js`
  e `run_calendario_logistica_ui_test.js`; `run_rotas_pc_test.js` OK.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — faturamento e carga parcial na Expedição de PA
  (2026-09-17).** `511edd8` no `origin/main`; por worktree limpo às 00:36 BRT:
  Hosting (`expedicao.html`, `shared/expedicao-grade-tela.js`,
  `shared/agenda-pa-tela.js`, `gestao_comercial.html` idênticos ao commit) +
  Functions `faturamentoCargaPA` (nova), `onSolicitacaoFaturamentoPA` (nova),
  `confirmarExpedicaoPA` e `salvarAgendamentoExpedicaoPA` (atualizadas).
  **Para o Codex:** a agenda ganhou o estado `EXPEDIDO_PARCIAL` (ativa, saldo
  reservado), `paletes[i].embarcado`, `viagens/vN`, `expedicoes/{carga}`,
  `aguardandoEmbarqueDesde` e `faturamento` (`SOLICITADO`/`FATURADO`,
  `solicitacoes/{id}` com e-mail, `nfs/{id}`). `confirmarExpedicaoPA` aceita
  `paletes[].carregar` = `{modo: INTEIRO|PARCIAL|NAO_CARREGADO, caixas,
  caixaParcial}` só em carga agendada; sem `carregar` o comportamento é o de
  antes. A carga (`expedicoes_comerciais`) ganhou `viagem`, `complementar`,
  `naoCarregados` e itens com `parcial`/`saldoRestante`; NF da agenda vale para
  todas as viagens e `valorFaturado` só entra na 1ª. E-mail em
  `config/emailFinanceiro` (vazio = não envia), cópia `config/emailDiretoria`.
  Testes novos `run_carga_parcial_test.js` e `run_carga_parcial_ui_test.js`;
  regressões de expedição/agenda/grade/legado/peso/chave/transações OK.
  **Aviso:** `run_agenda_expedicao_ui_test.js` já estourava tempo no commit
  anterior (`56bac03`, conferido em worktree limpo): o callable simulado demora
  mais que a espera; com 3 s de pausa passa inteiro com este código.
- **Arquivos ativos:** nenhum.

- **Operação de dados — importação da pasta 02. Comercial (2026-09-17).**
  Sem código. 751 caminhos planos, cópia antes em
  `../backups/2026-09-17_importacao_comercial/`, teste em 1 registro e
  conferência profunda 751/751. `precos_venda`: 110 SKUs / 116 vigências
  (id `imp_AAAAMMDD`, `origem: IMPORTACAO_PASTA_COMERCIAL`, motivo com o
  arquivo). 17 pedidos comerciais completados só em campo vazio (preço dos
  itens + linha do PCP, nº do cliente, condição, % NF, frete) com marca
  `importacaoComercial`; pedido 0006 e itens suspeitos (pedidos 10 e 24) fora.
  `clientes/*/condicaoPagamento` em 8 clientes que estavam vazios. Nenhuma
  versão nem e-mail gerado. Cobertura de preço da carteira: 8% -> 77%.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — Gestão Comercial (2026-09-16).** Três commits, todos
  por worktree limpo: `bca729a` (22:25, Hosting + RTDB: tela
  `gestao_comercial.html` no módulo comercial, motor
  `shared/gestao-comercial.js`, nó `precos_venda` com vigência), `b4023a5`
  (22:35, Hosting: edição de pedido com versão/travas,
  `shared/pedido-edicao.js`), `ae20f67` (22:45, Hosting + Functions
  **só** `onPedidoComercialCriado` e `onPedidoComercialVersao`: PDF pdfkit por
  e-mail à diretoria; `sendMailViaGraph` ganhou anexos, demais Functions não
  foram republicadas). Destinatários em `config/emailDiretoria` (vazio =
  não envia). Testes: `run_gestao_comercial_test.js`,
  `run_gestao_comercial_ui_test.js`, `run_pedido_edicao_test.js`,
  `run_pedido_diretoria_test.js`.
- **Correção publicada em `public/comercial.html`:** data de hoje no fuso
  local (após 21h saía o dia seguinte) e Documentos do mais novo ao mais
  antigo. Hosting por worktree limpo; regressões de cliente comercial e
  contatos aprovadas.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — transferência de OP entre pedidos (2026-09-16).**
  `b282582` no `origin/main`; Hosting por worktree limpo às 18:32 BRT
  (`ops.html`, `pedidos.html`, `shared/transferencia-op.js` idênticos ao
  commit). O lápis da OP virou transferência: move `skuPedidoKey`, produzido
  pelos `apontamentosAplicados` do lote (ou envase da OP se anterior ao
  registro), paletes com saldo (inclusive `skuPedidoKeyOrigem` do legado),
  programação futura do lote e alocações; id idempotente, retomável
  (`ops/{op}/transferenciasPedido`, `pedidos/{k}/transferenciasOP`).
  `pedidos.html`: salvar não apaga mais campos fora do formulário, quantidade
  reflete em `pedidos_comerciais`, excluir item com OP bloqueado. Testes:
  `run_transferencia_op_test.js`, `run_transferencia_op_ui_test.js` + regressões
  de conciliação/expedição/transações. **Nenhum dado alterado** — a conciliação
  Miss Rose/Wike Make/Habibi aguarda o usuário digitar os pedidos novos.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — pedidos sem divergência de acento (2026-09-16).**
  `8390907` no `origin/main`; Hosting por worktree limpo às 15:33 BRT
  (`pedidos.html` idêntico ao commit). Agrupar por cliente/linha usa
  `normalizeSearch` como chave ("Briá"/"Bria", "Miss Rose"/"Miss Rôse" num grupo
  só, título = grafia mais usada); as duas buscas da tela ignoram acento. Só
  exibição — os nomes gravados nos pedidos não foram alterados.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — uso e consumo sem cliente/pedido (2026-09-15).**
  `ed29f4b` no `origin/main`; por worktree limpo às 16:27 BRT: Hosting (5
  arquivos idênticos ao commit) + as três Functions de recebimento.
  **Caso real do usuário:** PC-0003 é etiqueta térmica (ET-00064) de uso e
  consumo, sem cliente nem pedido de venda. Item de **compra da Kuryos** pode ter
  destino geral (`vinculo = {geral: true}`, opção "Sem cliente — uso e consumo /
  estoque geral" no seletor de cliente); lote nasce da Kuryos com
  `destino.geral`. **Remessa recusa** esse destino (navegador e servidor).
  API nova: `vinculoGeral`, `vinculoAceito(v, tipoDono)`.
  **⚠ Codex:** `public/logistica.html` recebeu mais 3 linhas na exibição do
  destino do recebimento; commit só com o meu hunk, sua linha do `<head>` segue
  intacta e sem commit.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — remessa é do cliente por padrão (2026-09-15).**
  `22a901a` no `origin/main`; por worktree limpo às 15:21 BRT: Hosting
  (`compras.html`, `manual_compras.html`, `shared/propriedade-estoque.js`
  idênticos ao commit) + as três Functions de recebimento.
  **Decisão do usuário:** compra é sempre da Kuryos — cliente/pedido é só
  vínculo, e material de uso geral (álcool, glicerina, uso e consumo) atende
  qualquer cliente; **remessa é do cliente** ("quase 100% das vezes").
  Remessa de terceiro deixou de pedir escolha: nasce CLIENTE
  (`proprietarioPadraoDaNatureza`), Kuryos só como exceção gravada em Compras.
  A trava do dono vale só com escolha gravada + recebimento. **Descartado:**
  o destino "Estoque geral sem cliente" proposto nesta sessão — o usuário
  prefere vincular a um pedido e manter o estoque da Kuryos.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — propriedade do estoque por cliente (2026-09-15).**
  `6fd8285` no `origin/main`; por **worktree limpo** às 15:01 BRT: Hosting (11
  arquivos, SHA256 idênticos ao commit) + Functions `registrarRecebimento`,
  `cancelarRecebimento`, `registrarDevolucaoRecebimento` (sem login 401;
  `contatos-cliente.js` segue 404).
  **Regras do usuário:** o cadastro do material é amplo, então o dono vem do PC.
  Compra da Kuryos = Kuryos (estoque geral, serve a qualquer OP, mesmo comprada
  para pedido de outro cliente); remessa do cliente = cliente (só produtos/
  pedidos/demandas dele); remessa de terceiro = Compras escolhe. Cliente e
  pedido(s) por item, obrigatórios, vários pedidos. Estoque com duas vistas:
  propriedade do cliente × destinado ao cliente (posse Kuryos).
  **Onde:** `shared/propriedade-estoque.js` (puro; `functions/propriedade_estoque.js`
  é cópia byte a byte, o teste falha se divergirem). PC ganha `propriedade` e
  `itens/{i}/vinculo`; lote ganha `propriedade`/`destino`; agregado ganha
  `estoque/{m}/porCliente/{c}/saldoAtual` (`saldoAtual` segue total físico).
  Recebimento no servidor **recusa PC sem dono/vínculo**; cancelamento e
  devolução desfazem na parte do cliente. Apontamento (consumo e perda), FEFO,
  separação guiada, Insumos por Pedido/Solicitar Compra e MRP respeitam o dono.
  `separarParcialLoteEndereco` passou a copiar dono, destino e `loteInterno`
  (antes separar uma válvula de cliente a tornava da Kuryos).
  **Ensaio na base:** 364 linhas de pedido e 80 OPs ativas resolvem cliente
  (pedido 26 via nome curto dos produtos). Os 4 PCs existentes estão sem
  vínculo — PC-0003, PC-0005 e o saldo do PC-0004 ficam **bloqueados no
  recebimento** até Compras preencher 🔗 Cliente/pedido.
  **Testes:** `run_propriedade_estoque_test.js` (22, inclui o `index.js` real) e
  `run_propriedade_estoque_ui_test.js` (9); suíte 39/39. Adiados em
  `MELHORIAS_FUTURAS.md` (MRP ignora data da remessa, empenho sem dono, mapa sem
  filtro, devolução ao cliente).
- **⚠ Codex — três toques em arquivos seus:** (1) `public/logistica.html`: só
  exibição de dono/destino e trava no modal de recebimento; commit com **apenas
  os meus 5 hunks** (`git apply --cached`), sua linha de `contatos-cliente` no
  `<head>` segue sem commit e intacta. (2) `run_apontamento_encerramento_test.js`
  passou a carregar `clienteKeyDaOp` e o módulo real e confere que o consumo leva
  o cliente da OP — `baixarEstoqueConsumo` agora depende dele. (3) Republicar
  as três Functions de recebimento a partir de commit **anterior** a `6fd8285`
  tira a trava e grava lote sem dono.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — Histórico de apontamentos: início/término e visão
  condensada por OP (2026-09-15).** `bc904a0` no `origin/main`; Hosting por
  **worktree limpo** às 10:37 BRT (2 arquivos enviados; `historico.html`,
  `shared/historico-apontamentos.js` e `utils.js` SHA256 idênticos ao commit;
  `contatos-cliente.js` segue 404).
  **Causa do "só hora":** `loadRegistros` montava a linha campo a campo e nunca
  levava `periodoInicio/periodoFim`; `fmtRegistroRange` caía sempre na hora
  cheia + 1h. **Regras do usuário:** coluna com data e hora de início e de
  término; sem término = `?` (registro antigo), nunca presumido; editar início e
  término; condensar os apontamentos de cada OP para conferir; horas
  trabalhadas e un/h da OP.
  **Motor:** `shared/historico-apontamentos.js` (puro). Condensa por lote +
  setor; un/h só com a quantidade dos registros com horas conhecidas.
  Conferência: acumulado do checkpoint × soma até ele, total da OP × soma
  (soma maior = erro; menor = aviso, pode ser registro fora do período),
  sobreposição na mesma linha, apontamento > 12h, registros sem término.
  **Edição:** sem mexer nos campos não reescreve horário; com término grava
  período e recalcula `horasTrabalhadas` mantendo a pausa descontada; não
  deixa apagar término; registro fica no dia dele se o dia estiver no período.
  **Corrigido junto:** mudar a data na edição apagava período, horas, fonte e
  timestamp (nó novo só com os campos do modal); Por Pedido lia `horasUteis`
  (não existe) e mostrava a quantidade inteira como "/h"; aba Por OP não
  redesenhava ao Carregar.
  **Ensaio na base (482 registros, jun–set):** 35% sem término; 66 OP/setor
  com apontamento > 12h (retroativo de 24h/dia, linha aberta no fim de
  semana). **Pendente de autorização do usuário (dado):** 26219/03 tem +144
  e 26217/03 −144 (checkpoints 4.416 × 4.272 trocados) — não mexi.
  Testes: `run_historico_apontamentos_test.js` (20) e
  `run_historico_apontamentos_ui_test.js` (10, cai para o Edge se o Chromium
  do Playwright não estiver baixado). Suíte 35/35.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — e-mail ao PCP quando OP é encerrada (2026-09-15).**
  `8502d57` no `origin/main`; Function nova `onOpEncerrada` criada em
  `prod-kuryos` por worktree limpo (listada como
  `google.firebase.database.ref.v1.written`). Só Functions — sem Hosting/RTDB.
  **Regra:** transição de `ops/{op}/status` para "Aguardando Confirmação"
  (operador encerra ou `computeOpStatus` a ~95%) → um e-mail HTML via Graph a
  pcp@kuryos.com.br; `config/emailConfirmacaoOp` (lista ou texto com `,`/`;`)
  substitui, mas não há campo em `admin.html` ainda. Não usa
  `config.emailNotificacoes`. Traz produzido × planejado, justificativa e perdas
  do `fechamento_op` do dia e link para `ops.html`.
  **Histórico/dedupe:** `notificacoes_op_encerrada/{op}/{eventId}` reservado por
  transaction antes do envio → ENVIADO / IGNORADO (PCP confirmou antes) / ERRO.
  **Não verificado com e-mail real** — o primeiro encerramento de OP em produção
  é a prova; conferir o nó acima se o PCP disser que não chegou.
  **Teste:** `run_op_encerrada_email_test.js` carrega o `index.js` real com
  admin/functions/Graph simulados. Suíte 34/34.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — cancelamento de Pedido de Compra (2026-09-15).**
  `34d3aae` no `origin/main`; por worktree limpo às 10:17 BRT: Functions
  (`registrarRecebimento`, `cancelarRecebimento`,
  `registrarDevolucaoRecebimento`), regras RTDB e Hosting (`compras.html`,
  `shared/cancelamento-pc.js`, `manual_compras.html` e `estoque.html`
  idênticos ao commit; callable sem login 401).
  **Regras:** só admin cancela PC ABERTO/ENVIADO/RECEBIDO_PARCIAL; motivo
  obrigatório; PC vira CANCELADO (nunca apagado, nunca reaberto) com
  `cancelamento` {motivo, canceladoPor/Em, statusAnterior, saldoPorItem,
  solicitacoesReabertas}. Parcial cancela só o saldo. SC de origem pode voltar a
  APROVADA (só sem recebimento) com `reaberturaPorCancelamentoPC`. Filtro
  Cancelados/Todos na aba; faixa “PEDIDO CANCELADO — NÃO ATENDER” no documento;
  cancelado fora de preço/histórico/análise de fornecedor. Editar segue só em
  ABERTO; PC enviado errado = cancelar e emitir novo.
  **Travas:** `database.rules.json` `pedidos_compra/$pedidoKey/status` só
  entra/sai de CANCELADO com role admin; `statusPedidoApos(itens, deltas,
  statusAtual)` mantém CANCELADO em estorno/devolução. Logística e MRP não
  mudaram (já filtram ENVIADO/RECEBIDO_PARCIAL).
  **Validação:** `run_cancelamento_pc_test.js`; ensaio nos emuladores Auth +
  Database + Hosting com cópia dos 4 PCs de produção. **Atenção:** o emulador
  NÃO carrega `database.rules.json` no ns `prod-kuryos` que as telas usam (sobe
  aberto) — carregue com `PUT /.settings/rules.json?ns=prod-kuryos`, senão
  teste de permissão passa falso. Suíte 31/31.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — detalhe da posição em popup (2026-09-15).** `ff2d7c2`
  no `origin/main`; Hosting por worktree limpo, `estoque.html` idêntico ao
  commit. O conteúdo do palete abre em modal (X, clique fora, Esc) em vez de
  card no fim da tela. **Mudança que afeta todos os modais de `estoque.html`:**
  `.modal-bg` subiu de z-index 500 para **10000** — o menu lateral do
  `auth_check` (9999) cobria o lado esquerdo de todo popup no desktop. O seletor
  de endereço segue acima (10050). Se criar modal novo em outra tela, confira
  o mesmo conflito com o menu.
- **Registrado, fora do escopo:** no celular, `estoque.html` já tem 1.136 px de
  largura com popup fechado (barra de abas), igual na versão anterior.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — conteúdo da posição no mapa do WMS (2026-09-15).**
  `7ae4959` no `origin/main`; Hosting por worktree limpo, conferido
  (`estoque.html`, `shared/conteudo-posicao.js`, `shared/expedicao-grade.js`
  idênticos ao commit). Clique numa posição (Mapa por rua ou Planta baixa por
  nível) mostra resumo do palete (itens, quantidade por unidade, volumes, peso,
  situação) e linha a linha (lote, origem, volumes/composição, quantidade, peso
  com fonte, validade, status). Regras em `shared/conteudo-posicao.js`: PA pela
  composição e `ExpedicaoGrade.pesoPalete`; material com volumes do recebimento
  e peso por KG / L×densidade / `pesoUnitario` (gramas). Sem dado = desconhecido.
  `estoque.html` passou a carregar `shared/expedicao-grade.js`.
- **Correção junto:** `fmtData` de `estoque.html` exibia data pura um dia antes
  (UTC). **Mesmo defeito em cadastros, compras, formulas, logistica, qualidade
  e separacao_materiais** — aberto como tarefa separada; cadastros/logistica são
  arquivos ativos do Codex.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — seletor visual de endereço e Doca (2026-09-15).**
  `6518040` no `origin/main`; Hosting por **worktree limpo**, conferido
  (`estoque.html`, `logistica.html`, `shared/seletor-endereco.js`, `utils.js` e
  os dois manuais idênticos ao commit; `contatos-cliente.js` segue 404).
  **Fluxo (decisões do usuário):** recebimento entra na **Doca** (área `DOCA`,
  posição `DOC-1.1.1`, cadastrada pelo usuário); guardar a qualquer momento;
  PA pode ir de posição para a Doca para agilizar expedição; **uma posição = um
  palete, que pode ter mais de um produto** (ocupada não bloqueia, pede
  "Colocar no mesmo palete").
  **Componente:** `public/shared/seletor-endereco.js` — primeiro o local,
  depois o mapa rua × prédio × nível; campo com `<input hidden>` da classe que a
  tela já lê (`rc-endereco`, `cpa-endereco`). Endereço `legado` e dimensão >60
  ficam fora do mapa (o `HISTORICO` 999×999 travaria a tela). Entrou no
  recebimento (Logística, padrão Doca), Transferir (+ "Levar para a Doca"),
  formulário de Endereçamento, Conferência de PA e card **"Na Doca"** em
  Estoque › Endereçamento.
  **Regra mudada em `utils.js` (`registrarLaudoQualidade`):** a liberação
  **não grava mais `aguardandoEnderecoDefinitivo`**. "Aguardando guardar" = lote
  de material numa posição da área DOCA (calculado em `estoque.html`). A marca
  antiga segue respeitada e é limpa por `transferirLoteEndereco`.
- **⚠ Codex — efeito na sua regra de Expedição:** palete de PA liberado pela
  Qualidade **deixa de nascer bloqueado** em "Aguardando endereço definitivo
  ativo" (a marca não é mais gravada na liberação). O portão continua em
  `ExpedicaoPA.analisar` para marca antiga. E `logistica.html` (arquivo seu)
  recebeu o seletor e um listener de `estoque_lotes`; sua tag de scripts de
  contatos no `<head>` foi reaplicada por cima sem conflito (diff seu idêntico;
  suíte combinada 31/31).
- **Arquivos ativos:** nenhum.

- **Entrega publicada — Expedição: peso da carga, peso teórico e selecionar
  todos (2026-09-15).** `932aa88` no `origin/main`; Hosting por **worktree
  limpo** (`.claude/worktrees/expedicao-peso`, sobre `a007ec1`), conferido:
  `expedicao.html`, `shared/expedicao-grade-tela.js`, `shared/expedicao-grade.js`
  e `.css` SHA256 idênticos ao commit; `contatos-cliente.js` segue 404.
  **Peso:** colunas Kg/cx e Peso sempre visíveis. Fontes: peso real do palete
  (planilha) > `pesoPorCaixaKg` do palete > `produtos.kgCaixa`. Convenção da
  planilha: cada volume, inclusive a parcial, pesa uma caixa cheia. Sem kg/cx =
  desconhecido, nunca zero. Painel segue cliente/busca: liberado, aguardando
  Qualidade e **teórico** das OPs sem palete (mesmos critérios e corte de
  2026-09-10 da fila de `estoque.html`), com lista por OP.
  **Selecionar todos:** respeita as regras de carga do servidor (mesmo cliente,
  destino, CIF/FOB compatível, ≤100). API pura nova em `expedicao-grade.js`:
  `pesoPalete`, `pesoTeoricoOp`, `somaPeso`, `produtoDoSku`, `compativel`,
  `selecionarTodos`. `base` da grade ganhou `produtos`; `pronto()` passou a
  contar `Object.keys(base).length` em vez do 6 fixo.
  **Ensaio na base:** liberado 15 paletes / 6.768,6 kg; Qualidade 1 / 268,6 kg;
  13 OPs aguardando Conferência/PCP com ~644 kg e **9 sem peso** (faltam kg/cx
  no cadastro de GLMKAM01/02, BBSJBS05-2, PRF-AFEE-0023, KUBPBA02, PRF-PROP-0001;
  un/cx no PRF-AFEE-0018) — operação, não código.
- **⚠ Codex — integrei nos seus arquivos ativos `public/expedicao.html` e
  `public/shared/expedicao-grade-tela.js`.** O commit NÃO contém o seu contato
  do cliente na carga; na sua árvore, as suas mudanças foram **reaplicadas por
  cima** da versão nova (2 conflitos de linha vizinha, resolvidos somando: a
  linha `clientesContatos/contatoCargaUI` logo após `base`, e o
  `contatoCargaUI.carregar` antes do `selecaoResumo`). Conferido: seu diff nesses
  dois arquivos segue com exatamente as suas 8 linhas, os outros 14 arquivos
  intactos, e a suíte inteira (29, inclusive `run_contatos_cliente_test.js` e os
  testes de tela da Expedição com o seu código) passa. Backup dos seus dois
  arquivos originais: scratchpad da sessão Claude de 2026-09-15.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — CEP automático e endereços da Kuryos na rota do PC
  (2026-09-15).** `d3d1fd7` no `origin/main` (integrado sobre `ec6149b`, da
  sessão do Descarte); Hosting por **worktree limpo**, conferido
  (`compras.html`, `shared/rotas-pc.js`, `shared/utils.js` SHA256 idênticos ao
  commit; `contatos-cliente.js` segue 404).
  **O que mudou:** o editor de rota é o MESMO no PC direto (`pcd`) e no PC
  tradicional (`pcEdit`), então vale para os dois. (1) CEP com 8 dígitos
  preenche logradouro/bairro/cidade/UF via `buscarEnderecoPorCep`, nunca
  número/complemento. (2) Atalhos 🏭 Fábrica / 📦 Galpão em Origem e Destino;
  "Entregar em" do PC tradicional preenche o destino inteiro; PC gerado da
  cotação com local de entrega nasce com destino preenchido. Preencher nunca
  confirma: todo portão segue exigindo `statusConfirmacao === 'CONFIRMADA'`.
  (3) **Cadastro editável** em `config/locaisKuryos/{FABRICA|GALPAO}` (botão
  "Endereços da Kuryos" só para admin/pcp/módulo config, a regra de `/config`).
  Até alguém salvar, vale `RotasPC.LOCAIS_KURYOS_PADRAO`. **Nada gravado na base.**
  **API nova em `rotas-pc.js`:** `localKuryos(chave, cadastro)`,
  `CHAVES_LOCAIS_KURYOS`, `LOCAIS_KURYOS_PADRAO`; `rotaInicial` ganhou 3º
  parâmetro opcional `locaisKuryos`.
- **⚠ Codex — `logistica.html` não foi tocado**, mas a chamada de lá a
  `RotasPC.rotaInicial(p, null)` agora devolve destino preenchido quando o PC
  sem rota tem `localEntrega` GALPAO/FABRICA. Para usar o cadastro vivo,
  passe `allConfig.locaisKuryos` como 3º argumento.
- **A conferir com o usuário:** pelos Correios o nº 1130 da Rua Lagoa Tai
  Grande é CEP **08290-425** (Vila Carmosina); o **08290-500** informado é
  Itaquera, até o 548. CNPJ do Galpão não informado (vazio no padrão).
- **Arquivos ativos:** nenhum.

- **Entrega publicada — transaction abortando no null, lado cliente (2026-09-15).**
  `9f30bbd` no `origin/main`; Hosting por **worktree limpo** às 00:31 BRT
  (3 arquivos enviados; `shared/utils.js`, `compras.html`, `historico.html`,
  `descarte.html` SHA256 idênticos ao commit).
  **Causa:** mesmo defeito de `019cb52`, agora no cliente — callback de
  `.transaction()` devolvendo `undefined` quando a 1ª passada (cache local)
  vem null aborta sem consultar o servidor. **Pontos:** Descarte
  (solicitar, desfazer, confirmar), `ajustarProduzidoOp`, Compras (aprovar,
  rejeitar, convite na cotação, reserva CONSOLIDADA ×2) e
  `historico.html adjustPedidoProduzido`. **Alcance:** mascarado em produção
  — as quatro telas mantêm listener na raiz do nó. Medido com SDK web compat
  10.7.0 no emulador: código antigo com cache frio reproduz "Não foi possível
  confirmar a saída deste lote."; com cache quente passa; código novo passa
  nos dois e reporta "Lote não encontrado" sem gravar nada.
  **Regra para quem escrever transaction:** `if (!atual) return atual;` antes
  da regra de negócio; nó inexistente se detecta por `snapshot.exists()` /
  valor final; zere variáveis de fechamento a cada passada.
  **Guarda:** `run_transacoes_null_test.js` agora varre `functions/`,
  `public/shared/` e `<script>` de `public/*.html` com parser de callback
  (43 callbacks, conferidos contra a contagem bruta) e ensaia as funções
  reais com fake fiel ao SDK. Suíte 25/25.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — Pedidos: colunas Expedido e Conferência (2026-09-15).**
  `f5974e2` no `origin/main`; Hosting por **worktree limpo**, conferido
  (`pedidos.html`, `shared/conciliacao-pedidos.js`, `shared/expedicao.js`
  SHA256 idênticos ao commit; `contatos-cliente.js` segue 404).
  **Conta:** Produzido = Expedido + Em estoque, nas tabelas SKUs e Pedidos
  Comerciais. **Regras do usuário:** só dois destinos; expedido tem motivo
  (de fato, furto, descarte); retrabalho e devolução voltam ao estoque; só
  exato é OK, exceto quando a Conferência de PA conciliou divergência (entra
  na conta); produzido sem registro fica cinza. No pedido comercial a
  situação é a do **pior item**.
  **Motor:** `public/shared/conciliacao-pedidos.js` (puro; depende de
  `shared/expedicao.js` para resolver a chave). Fontes: `pedidos.produzido`,
  `expedicoes_comerciais`, `estoque_lotes`, `solicitacoes_descarte`,
  `conferencias_pa`. **Não lê `pedidos/{k}/expedido`** (gravado pelo
  `confirmarExpedicaoPA`): conta pelas cargas, para não somar duas vezes.
  **Ensaio na base:** 358 pedidos, 101 OK, 163 com diferença, 66 sem registro;
  conservação exata das 3.094.141 un. Testes:
  `run_conciliacao_pedidos_test.js` e `run_pedidos_conciliacao_ui_test.js`
  (no worktree de deploy, rodar com `PLAYWRIGHT_MODULE` apontando para o
  `node_modules` do repo).
- **Pendente de autorização do usuário (dado):** OPs 26243/07 e 26244/11
  (HDR-MISS-0008, Midnight Honey) apontam para `23__HDR-MISS-0008`, que não
  existe; o item é do pedido **27** (produzido 2.071 = 260 + 1.811). Correção:
  `ops/{op}/skuPedidoKey = 27__HDR-MISS-0008` + reaplicar a carga do legado.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — caixa parcial dentro do palete no legado (2026-09-14).**
  `b0f7c72` no `origin/main`; Hosting (`relatorio_expedicao.html`) por
  **worktree limpo**, conferido idêntico ao commit. **Carga reaplicada em
  produção** com autorização explícita do usuário, primeiro só a OP 26244/16
  (conferida), depois o restante.
  **Causa:** a aba EXPEDIÇÃO registra a parcial como linha própria ("1 cx × 10"),
  e o importador fazia um palete por linha. Paletes da Conferência de PA já
  nascem certos; era só o legado.
  **Regra (decidida pelo usuário):** parcial = 1 cx com múltiplo menor que o da
  OP; vai para o palete da mesma OP com mesmo status/data/NF, o de **menos
  caixas**; sem candidato, linha própria com `caixaParcialAvulsa`. Vale para
  estoque e histórico.
  **Conferido em produção após a carga:** paletes legado 26 → 21, linhas de
  histórico 1.722 → 1.422, **unidades idênticas** por OP e por carga, zero
  composição inválida no estoque; Expedição com as mesmas 20.818 un disponíveis
  (15 paletes, 4 com parcial); lotes não legado e cargas do fluxo novo
  **intocados** (comparação byte a byte com o backup).
  **Relatório:** a parcial conta como 1 caixa (senão cairia de 67.125 para
  66.796 caixas). `run_relatorio_caixa_parcial_test.js` novo.
  **Importador:** remove o registro próprio que a carga anterior criou para a
  parcial, preserva palete legado já mexido no sistema e grava
  `rollback.json` com o **valor anterior** de cada caminho (backup real).
- **Arquivos ativos:** nenhum.

- **Entrega publicada — chave do pedido com/sem zero na Expedição + un/cx na
  Conferência de PA (2026-09-14).** `35242a8` no `origin/main`; Hosting +
  `confirmarExpedicaoPA` + `salvarAgendamentoExpedicaoPA` no `prod-kuryos` por
  **worktree limpo** (`Documents/Codex/deploy-chave-pedido-35242a8`). Conferido
  no ar: `shared/expedicao.js` e `estoque.html` HTTP 200 e **SHA256 idêntico ao
  commit**; callables 401 sem login; `shared/contatos-cliente.js` segue **404**
  (nada do Codex subiu).
- **Chave do pedido:** `/pedidos` tem **os dois formatos de verdade** — 174 OPs
  gravam `17__X` para pedido que existe como `0017__X`, e 17 pedidos reais
  existem só sem zero, sem gêmeo. Por isso **não migrar as OPs "pondo zero"**.
  `ExpedicaoPA.analisar` agora resolve a chave contra o que existe
  (`resolverChavePedido`: exata, senão a única equivalente; ambíguo não escolhe)
  e compara vínculo com `normalizarChavePedido` (ignora só o zero; número/SKU
  diferente segue bloqueando). Ambas exportadas — use-as para qualquer junção
  pedido×OP×expedição.
  **Ensaio na base (27 paletes):** nenhum motivo mudou, 19 disponíveis seguem
  19; só a 26251/15 passou a resolver a chave (estava armada para cair em
  "Pedido de origem ausente" quando a Qualidade liberasse). Com as OPs
  migradas: regra antiga 0 disponíveis, nova 19.
- **Un/cx na Conferência de PA:** campo segue digitado, **sem pré-preencher**
  (decisão do usuário: formato de caixa muda sem o cadastro). Mostra o `unCx`
  do produto, fica vermelho ao divergir e salvar pede confirmação indicando
  ajustar o cadastro; a contagem grava `unidadesPorCaixaCadastro` e
  `formatoCaixaDivergente`. O consenso compara só `total`.
- **Estado das conferências abertas:** 26251/15 **finalizou** às 22h20 de
  14/09 (RNC −1, palete `pa_26251-15_p1` em quarentena). **26247/06 precisa de
  recontagem física**: contada com 48 un/cx, cadastro e as 10 OPs irmãs são de
  24 (2.618 × 1.661 apontados); não mexi no dado.
- **⚠ Codex — mexi em `public/shared/expedicao.js` e
  `functions/expedicao_regras.js`** (base da sua grade). Aditivo: a chave
  devolvida por `analisar` agora é a **resolvida**; grade, agenda e callable
  comparam `skuPedidoKey` entre duas chamadas da mesma regra, então seguem
  consistentes. Republicar `confirmarExpedicaoPA`/`salvarAgendamentoExpedicaoPA`
  a partir de um commit **anterior** a `35242a8` desfaz a correção.
  `run_expedicao_chave_pedido_test.js` e `run_conferencia_pa_uncx_test.js`
  novos; os 23 testes do repo passam.
- **Arquivos ativos:** nenhum.

- **⚠⚠ Correção publicada — a Conferência de PA NUNCA conseguiu finalizar
  (2026-09-14).** `019cb52` no `origin/main`; `finalizarConferenciaPA`
  republicada no `prod-kuryos` por worktree limpo. Callable no ar responde 401
  sem login, como esperado.
  **Sintoma:** "Outra sessão já está finalizando esta OP" na conciliação, com a
  base **sem lock nenhum** (`finalizacaoStatus`, `finalizandoEm` e
  `finalizacaoToken` ausentes nas duas conferências).
  **Causa:** `if (!atual) return;` dentro do `confRef.transaction`
  (`functions/index.js`). O SDK chama o callback com o **cache local** primeiro
  e, depois do `.once()` do `lerContexto`, o cache já esfriou — a primeira
  passada vem `null`. Devolver `undefined` **aborta a transação** sem nunca
  falar com o servidor, e o código caía no `!lock.committed`.
  **Medido no emulador** (firebase-admin 12.7.0, mesmo padrão `.once()` +
  `.transaction()`): `return;` → passadas `[null]`, `committed=false`;
  `return atual;` → passadas `[null, dado]`, `committed=true`.
  Era **determinístico**: explica `estoque_lotes` não ter um único palete de
  produto acabado desde o deploy do fluxo em 2026-09-10.
- **A regra, para não repetir:** transação do RTDB devolve **o próprio valor**
  (`return atual;`), nunca `return;`. As outras três transações do
  `functions/index.js` (linhas 25, 55 e 1793) já faziam certo — foi deslize
  isolado de uma linha. `run_transacoes_null_test.js` novo **varre todas as
  transações de `functions/`** atrás do mesmo padrão, além de provar a
  semântica num fake fiel ao SDK e travar o site específico.
- **Buraco de cobertura que permitiu isso:** `run_conferencia_pa_server_test.js`
  só exercita as funções puras de `functions/conferencia_pa.js`. A transação e
  o lock, que vivem no `functions/index.js`, não tinham teste nenhum.
- **Também corrigido:** nó inexistente deixou de ser reportado como disputa de
  sessão; agora responde "Não há Conferência de PA registrada para esta OP".
- **Ainda aberto, agora do lado da operação:** 26247/06 está em
  `DIVERGENCIA_RECONTAGEM` com 1 contagem (a regra pede três) e 26251/15 em
  `AGUARDANDO_CONCILIACAO` com 3 contagens sem consenso. Com a correção no ar,
  a conciliação deve concluir.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — Relatório de Expedição (2026-09-14).** `c24fce8` no
  `origin/main` e no Hosting `prod-kuryos`, por **worktree limpo**
  (`Documents/Codex/deploy-relatorio-c24fce8`). Conferido no ar:
  `relatorio_expedicao.html` e `auth_check.js` HTTP 200 e **SHA256 idêntico ao
  commit**.
  Tela nova `public/relatorio_expedicao.html`, no menu de Logística e no mesmo
  módulo de acesso. **Deliberadamente fora de `expedicao.html`:** Expedição é
  operação (montar carga), isto é consulta — e aquele arquivo é do Codex.
  **O grão é o ITEM de uma carga**, não a carga: é como a pergunta é feita
  ("o que saiu do item X para o cliente Y") e é o mesmo grão da planilha que o
  PCP usa para conferir OP e pedido.
  Filtros que se cruzam: período, cliente e item por seleção múltipla,
  situação, transportadora, pedido, OP/lote, NF e busca livre sem acento.
  Agrupamento por cliente, item, mês, pedido, OP, transportadora ou situação.
  Totais do recorte, gráfico de barras por mês em **SVG puro** (o sistema não
  carrega biblioteca de fora) e exportação CSV com `;` e vírgula decimal, que
  o Excel pt-BR abre direto.
- **Medido contra a base real:** 1.722 linhas, 3.063.149 unidades, 67.125
  caixas, 587 t, 28 clientes, 166 itens, de 25/04/2025 a 11/09/2026.
- **Correções junto:** peso passou a ir também para o histórico (antes só no
  palete em estoque), rótulos de situação ganharam acento, e data inválida
  (`-`/vazio da planilha) deixou de ser tratada como data — virava o início do
  período e entrava nas comparações de de/até. Carga reaplicada; **idempotente**,
  segue em 26 paletes e 338 cargas.
- **Validação:** `run_relatorio_expedicao_test.js` novo (playwright) cobre o
  caso do usuário ponta a ponta, peso derivado de kg/caixa, agrupamento,
  ordenação, CSV filtrado com BOM, busca sem acento e celular. **Os 21 testes
  do repo passam.**
- **Arquivos ativos:** nenhum. Só `public/auth_check.js` foi tocado fora da
  tela nova (uma linha no menu e a página no módulo `logistica`).

- **Entrega publicada — Expedição: histórico e estoque legado da planilha (2026-09-14).**
  `31674b6` no `origin/main`; Hosting + `confirmarExpedicaoPA` +
  `salvarAgendamentoExpedicaoPA` publicados no `prod-kuryos` por **worktree
  limpo** (`Documents/Codex/deploy-legado-31674b6`).
  **Carga de dados já aplicada em produção:** 26 paletes legado, 338 cargas de
  histórico e o endereço `HISTORICO`. Na grade: **19 paletes disponíveis,
  20.818 unidades** (MISS ROSE e Glow Make Up); 7 pendentes com motivo à vista.
- **Regra nova:** `ExpedicaoPA.analisar` aceita `origemTipo: 'legado_planilha'`
  com `legado: true` e dispensa **apenas** dois portões — liberação/laudo da
  Qualidade e Conferência de PA finalizada. Eles nunca existiram no sistema, e
  exigi-los obrigaria a **forjar** registro de Qualidade na importação. Todos os
  outros portões seguem valendo. Status novo `LEGADO_ESTOQUE` (cinza, não o
  verde de "liberado pela Qualidade") e identificador com prefixo `LEG-`.
- **⚠ `functions/expedicao_regras.js` é cópia byte a byte de
  `public/shared/expedicao.js`** e `run_expedicao_test.js` falha se divergirem.
  Mudou um, copie no outro e **redeploy das Functions** — senão a UI libera o
  palete e o callable recusa. Foi exatamente o que o teste pegou aqui.
- **⚠ Achado que vale para o sistema todo, não só para isto:** o `skuPedidoKey`
  gravado nas OPs usa o número do pedido **sem zero à esquerda**
  (`19__GLMKAM04`) e `/pedidos` guarda **com** (`0019__GLMKAM04`). Só essa
  diferença deixava **66 vínculos OP→pedido órfãos**; normalizar recupera 51
  deles e leva a cobertura de 81,2% para **95,7%**. Não migrei o nó `ops` — é
  dado do PCP e fora do escopo pedido —, mas **a migração vale a pena** e
  destravaria vínculo em outras telas. O palete legado contorna gravando a
  chave reconstruída em `skuPedidoKey` e a crua em `skuPedidoKeyOrigem`, que é
  o campo que o portão de "vínculo mudou" passa a comparar.
- **Importador:** `scripts/importar_expedicao_legado.py`, **simulação por
  padrão** (`--aplicar` grava). Chaves determinísticas por hash do conteúdo da
  linha, não da posição — o usuário vai **repetir a carga** com dados mais
  novos, e reordenar a planilha não pode duplicar. Gera `payload.json`,
  `rollback.json` e `relatorio.csv` em `importacao_legado/` (gitignored).
  **Pula palete de OP com conferência em andamento**: `conferencia_pa.js:102`
  bloqueia a finalização se já existirem paletes da OP no WMS, então importar
  travaria a conferência de vez (foi o caso da 26247/06).
- **Ainda pendente do lado do PCP, aparece na grade com o motivo:** 26244/11
  (pedido `23__HDR-MISS-0008` não existe em `/pedidos`); 26247/03, 26251/08 e
  26253/03 (OPs em `Aguardando Confirmação`).
- **Validação:** `run_expedicao_legado_test.js` novo — a dispensa não vaza para
  quem só finge ser legado, e todos os outros portões seguem bloqueando.
  **Os 20 testes do repo passam**, inclusive os dois de UI com playwright
  (que não estava instalado nesta máquina; instalei).
- **⚠ Operacional:** a CLI avisou que o **runtime Node.js 20 das Functions foi
  descontinuado em 2026-04-30 e será desativado em 2026-10-30**. Depois disso
  não dá mais deploy sem atualizar.
- **⚠ Codex — mexi em `public/shared/expedicao.js` e
  `functions/expedicao_regras.js`**, que são a base da sua grade de Expedição.
  A mudança é aditiva (uma origem nova); `run_expedicao_test.js`,
  `run_expedicao_grade_test.js`, `run_expedicao_ui_test.js` e
  `run_agenda_expedicao_ui_test.js` passam. Seus 16 arquivos continuam
  intactos e sem commit; `shared/contatos-cliente.js` segue **HTTP 404**.
- **Arquivos ativos:** nenhum.

- **Entrega publicada — Recebimento alinhado ao formulário de entrada (2026-09-14).**
  `701ad16` no `origin/main` e no Hosting `prod-kuryos`, por **worktree limpo**
  (`Documents/Codex/deploy-recebimento-701ad16`). Fonte da verdade: o
  **Formulário de entrada de materiais** em `forms.cloud.microsoft/r/HDwua0LnV1`,
  lido nesta sessão. Das 14 perguntas, **13 já existiam** na tela e as escalas
  1–5 batem com as estrelas do Forms. Faltavam duas:
  (1) **Fornecedor** (pergunta 7) não era campo — só texto no cabeçalho do
  modal. Virou campo travado, do Pedido de Compra. O dado já ia no payload
  (`fornecedorKey`/`fornecedorNome`); quem preenchia é que não via.
  (2) **Quantidade de amostragem** (pergunta 10) era digitada. Agora é
  **`√(quantidade recebida do lote) + 1`, arredondado para cima**, campo
  travado — decisão do usuário: a regra vale sempre, ninguém digita. A dica
  abaixo do campo mostra a conta e como destrinchar a coleta entre os volumes
  daquele lote.
- **Detalhe que importa se alguém mexer:** o valor gravado é **recalculado** em
  `lerItensRecebimentoDaTela` (`qtdAmostragem: amostragemDoLote(qtd)`), não lido
  do input. O campo é só espelho — DOM desatualizado não vira número errado na
  fila da Qualidade.
- **Validação:** `run_recebimento_amostragem_test.js` (fórmula com quadrados
  perfeitos sem arredondar a mais, monotonicidade até 3000, quantidade
  fracionada, zero/negativo/lixo; paridade com as 14 perguntas; gatilhos de
  recálculo); regressões `run_recebimento_qualidade_test.js`,
  `run_lote_interno_test.js`, `run_rotas_pc_test.js`, `run_descarte_test.js`,
  `run_conferencia_pa_test.js` e `run_cotacao_texto_test.js` aprovadas.
- **Verificação no ar (2026-09-14):** `logistica.html` HTTP 200 e **SHA256
  idêntico ao commit**; `rcFornecedor` e `amostragemDoLote` presentes.
- **⚠ Codex — `public/logistica.html` é arquivo ativo seu e eu editei.** Só a
  região do modal de recebimento; o commit levou **apenas os meus 6 hunks**
  (`git apply --cached` de patch filtrado). **Sua tag de script de
  `contatos-cliente` no `<head>` continua sem commit na árvore de trabalho** e
  não subiu: `shared/contatos-cliente.js` segue **HTTP 404** no ar e a
  `logistica.html` publicada não tem a referência. Se você commitar o arquivo
  inteiro agora, leva junto o recebimento já publicado — sem problema, é o
  mesmo conteúdo.
- **Arquivos ativos:** nenhum. `public/logistica.html` devolvido.

- **Entrega publicada — Cotação: copiar texto e incluir fornecedor (2026-09-14).**
  `885bbc0` no `origin/main` e no Hosting `prod-kuryos`, por **worktree limpo**
  (`Documents/Codex/deploy-cotacao-texto-885bbc0`). Só `public/compras.html` e
  `run_cotacao_texto_test.js` entraram no commit.
  (1) Cada convidado ganhou **"📋 Copiar texto"** no cabeçalho da proposta, na
  aba Cotações — o botão da aba Solicitações sumia justamente quando o convite
  já existia. O texto sai **só com os materiais do escopo do convidado** e **não
  leva código nem descrição interna da Kuryos**: usa `codigoFornecedor` /
  `nomeComercial` da homologação (`materiais/{k}/fornecedores/{fKey}`) quando
  existem; senão, descrição + `especificacoesTecnicas`. Convite por similar
  resolve a nomenclatura pelo similar.
  (2) **`＋ Fornecedor` tinha beco sem saída:** a lista só mostrava homologados
  do material/similar e o CNPJ recusava quem já estava cadastrado ("use o
  fornecedor cadastrado acima" — que não estava acima). Fornecedor cadastrado
  depois da cotação aberta, ou não homologado para a MP, não tinha caminho.
  Agora há a seção "Outros fornecedores da base" (busca na base inteira,
  inclusão marcada fora da homologação) e o CNPJ já cadastrado inclui o
  fornecedor da base.
- **⚠ Compatibilidade que quase passou batido, vale para quem mexer em cotação:**
  o escopo de um convidado é `escopoDoConvidado` (`public/shared/utils.js:4098`),
  **não** `convidado.itens` direto — convidado sem o campo vem de cotação
  anterior ao escopo por item e cota o **processo inteiro**. Ler o campo direto
  fazia as duas cotações hoje abertas mostrarem o botão e copiarem vazio. Pela
  mesma raiz, `gravarFornecedorNaCotacao` passou a **materializar** o escopo do
  convidado legado antes de somar itens novos: sem isso, ampliar o convite de um
  fornecedor antigo o **encolhia** de "todos os materiais" para os poucos
  marcados na hora. Esse segundo defeito já existia antes desta sessão.
- **Validação:** `run_cotacao_texto_test.js` (carrega o `escopoDoConvidado` real
  do `utils.js` — copiar a regra no teste esconderia a divergência); regressões
  `run_rotas_pc_test.js`, `run_recebimento_qualidade_test.js`,
  `run_lote_interno_test.js`, `run_descarte_test.js` e
  `run_conferencia_pa_test.js` aprovadas; sintaxe dos scripts inline e
  `git diff --check` limpos.
- **Verificação no ar (2026-09-14):** `compras.html` HTTP 200 e **SHA256 idêntico
  ao commit**; `cot-copiar-texto` e `caf-add-fora` presentes; zero ocorrência da
  recusa de CNPJ. Firebase reportou `uploading new files [0/1]` — um arquivo só.
- **⚠ Codex — seu trabalho NÃO subiu junto, de novo por worktree destacado.**
  `shared/contatos-cliente.js` e `contatos-cliente-ui.js` respondem **HTTP 404**
  no ar; `cadastros.html`, `comercial.html`, `expedicao.html` e `logistica.html`
  seguem HTTP 200 na versão anterior. Seus 12 modificados e 4 novos continuam
  intactos e sem commit na árvore de trabalho — não toquei em nenhum.
- **Arquivos ativos:** nenhum. `public/compras.html` liberado.

- **Escopo atual — Controladoria/Custos (arquitetura, 2026-09-14).** Sessão de
  desenho, nada implementado. Decisões em `PLANO_CUSTOS.md`, reescrito depois de
  **medir a base de produção** (4 sondas somente-leitura). Resumo: não construir
  financeiro transacional (comprar); construir controladoria com razão de custos
  append-only; **começar pela conversão, não pelo material**; absorção por
  horas-padrão (`produzido ÷ prodHoraRef`), nunca por duração de OP; custo de
  fórmula por kg, desacoplado da densidade; `SEM_CUSTO` nunca vira zero.
- **⚠ Tema Custos ENCERRADO neste app.** A aba foi **removida de produção** em
  `bb245a0` (Hosting `prod-kuryos`, 2026-09-14, por worktree limpo; conferido
  no ar: zero referências a `custos.js` ou à aba em `insumos.html`, que segue
  HTTP 200). Decisão do usuário: o módulo vai direto no **Kuryos ERP**, onde o
  custo tem origem nativa — o P&D aponta custo por item ao fechar a amostra e
  Compras atualiza depois com o custo da cotação. A spec está em
  `PROMPT_CUSTOS_ERP.md`. Ficaram no repo, como referência: `shared/custos.js`,
  `run_custos_test.js`, `run_custos_ensaio.js`, `PLANO_CUSTOS.md` e a regra de
  `custos_precos` (nó vazio, inofensiva). **Não reconstrua a aba aqui.**

- **Entrega publicada e depois revertida — aba Custo do Produto.** `ba03082` no
  origin/main e no Hosting `prod-kuryos` em **2026-09-14 às 13:08 BRT**, por
  **worktree limpo**.
  Motor em `public/shared/custos.js` (novo), aba em `public/insumos.html`, nó
  `custos_precos` liberado em `database.rules.json`, testes em
  `run_custos_test.js` (113 asserções) e `run_custos_ensaio.js` (ensaio contra
  a base real, sai com exit 1 se achar número inválido).
- **Arquivos ativos:** nenhum. `custos.js`, `insumos.html` e
  `database.rules.json` liberados.

- **⚠ Codex — deploy feito hoje, e o seu trabalho NÃO subiu junto.** Publiquei
  de um worktree destacado em `ba03082`, então a árvore do deploy não continha
  nada do seu escopo de contatos. Conferido no ar depois de publicar:
  `shared/contatos-cliente.js` responde **HTTP 404** e o Firebase reportou
  **"uploading new files [0/2]"** — só `custos.js` e `insumos.html` mudaram.
  Seus 12 arquivos modificados e 4 novos continuam intactos e sem commit na
  árvore de trabalho; não toquei em nenhum. O `shared/custos.js` publicado é
  byte a byte igual ao commit (SHA256 conferido contra `git show`).
- **⚠ Codex — mexi em `database.rules.json`**, que já foi seu. Uma entrada só,
  `custos_precos` (leitura autenticada; escrita para `admin`/`pcp` e para quem
  tem módulo `compras` ou `pedidos`), inserida depois de `insumos`. O arquivo
  não estava modificado na sua árvore quando entrei. Regras publicadas junto
  com o hosting, e a CLI validou a sintaxe.

- **⚠ Três premissas da v1 do plano morreram na medição** — registro aqui porque
  qualquer um de nós repetiria os mesmos erros: (1) o RH **não tem folha**
  (`rh_colaboradores` = 0 registros), (2) as fontes de preço COTADO/ALVO estão
  **vazias** (0 de 911 materiais com fornecedor homologado ou custo target; só
  2 PCs no total), (3) duração de OP (`dataInicioReal→dataFimReal`) **não é
  ocupação** — é calendário, e dá 123–243%. O que a base tem de bom: 167 de 169
  fórmulas fechando 100%, 841 itens de fórmula com código e **todos existindo no
  cadastro**, `prodHoraRef` em 321 de 377 produtos, 1.267 OPs com datas reais.
- **Arquivos ativos:** `PLANO_CUSTOS.md` e `AGENT_STATUS.md`. Nada mais — a
  implementação ainda não começou. Quando começar, serão
  `public/shared/custos.js` (novo) e a aba de Custos em `public/insumos.html`.
- **Restrição que definiu a arquitetura:** `database.rules.json:220` libera
  `rh_colaboradores` só para `rh`/`admin`. O motor **não pode** somar folha no
  cliente — a taxa vira artefato de competência, agregada com privilégio e
  gravada sem dado individual em `custos_taxas/{competencia}`.

- **⚠ Para o Codex — Fase 0, e é a única parte urgente do módulo de Custos:**
  o recebimento grava `estoque_lotes` (`functions/index.js:1520`) e
  `movimentos_estoque` (`:1532`) **sem nenhum valor**. Sem isso não existe
  valoração de estoque, custo médio nem custo real de OP — e não dá pra
  reconstruir depois, porque o dado não é gravado na hora. São ~20 linhas:
  copiar `custoUnitarioNaDecisao` do item do PC (+ frete rateado) para dentro
  do lote e do movimento. **A hora é agora porque `estoque_lotes` está vazio
  em produção** — hoje custa zero e a base nasce valorizada; depois do Dia D,
  cada lote sem preço vira buraco permanente. `functions/index.js` é seu, não
  toquei. Detalhe do campo em `PLANO_CUSTOS.md`, seção 5.

- **Última entrega:** Cotação — somente fornecedores homologados, inclusão de
  fornecedor cadastrado ou por CNPJ, por item.
- **Commit:** `586bbc5`.
- **Escopo atual:** reestruturar o MRP. Hoje `insumos.html` é "Insumos por
  Pedido" — checklist de um pedido por vez, não MRP: não agrega demanda entre
  pedidos, não tem faseamento no tempo, não conta pedido de compra em trânsito
  e não existe parâmetro de planejamento por material.
- **Arquivos ativos:** `public/insumos.html`, `public/shared/utils.js`.
- **NÃO vou tocar** em `auth_check.js`, `database.rules.json`, `comercial.html`,
  `expedicao.html`, `functions/index.js` (Codex). Por isso o MRP entra como
  **aba dentro de `insumos.html`**, no módulo `pedidos` que já existe, em vez
  de página nova — página nova exigiria registrar em `auth_check.js`.
  Parâmetros de planejamento (lead time, estoque de segurança, lote mínimo,
  múltiplo) gravam em `materiais/{key}` pela própria tela do MRP, sem mexer
  em `cadastros.html` nem nas regras.
- **Entrega:** MRP estruturado. `insumos.html` ganhou a aba **MRP — Necessidade
  de Materiais**; a aba antiga ("Insumos por Pedido") continua intacta.
- **O motor** (funções puras em `shared/utils.js`): agrega a demanda de todos os
  pedidos abertos, faseia por semana, desconta PC em trânsito, aplica lote
  mínimo/múltiplo e recua o lead time pra dizer QUANDO comprar. Exceções
  COMPRAR / COMPRAR_ATRASADO / ANTECIPAR / ADIAR / BACKLOG. Balde "em atraso"
  colapsado na frente, como SAP/Oracle.
- **Restrição registrada:** só 39 dos 84 pedidos abertos têm data (vêm da grade
  de `programacao`). O resto vai pra um balde de BACKLOG explícito — fingir
  data produziria um plano preciso e falso.
- **Parâmetros de planejamento** (lead time, estoque de segurança, lote mínimo,
  múltiplo) nascem em `materiais/{key}`, editáveis no card do MRP por caminho
  PLANO. Nenhum dos 906 materiais tem valor ainda; a tela avisa isso.
- **Validação:** `run_mrp_test.js` (46 asserções) + ensaio com dados REAIS de
  produção (86 materiais no plano, zero número inválido). O ensaio revelou dois
  defeitos que o teste sintético não pegava — atraso espalhado em semanas
  vencidas e vazamento da sentinela de balde no texto. Os dois corrigidos.
- **Commit/deploy:** `d3b5660`, Hosting publicado em 2026-09-13 em
  `prod-kuryos` **por worktree limpo**. Confirmado que o trabalho NÃO commitado
  do Codex não foi publicado: `shared/contatos-cliente.js` responde HTTP 404.
- **Arquivos ativos:** nenhum. `public/insumos.html` e `public/shared/utils.js`
  liberados.

- **⚠ Para o Codex — 3 testes falhando, todos em arquivos seus:**
  `run_inventario_tela_test.js` (`salvarContagem is not defined" em
  estoque.html), `run_modulos_test.js` (espera 11 módulos para `pcp`, mas o
  papel tem 12 desde que `comercial` entrou) e `run_pc_direto_test.js` (o
  fixture não preenche `pcdNatureza`, então `salvarPcDireto` sai pela
  validação sem gravar). Não toquei em nenhum — são do seu escopo.

- **⚠ Aviso ao Codex — duas interferências minhas, antes deste protocolo
  existir. As duas são minhas, não suas:**
  1. **Seu WMS/Logística JÁ ESTÁ EM PRODUÇÃO.** Rodei
     `firebase deploy --only hosting` com `public/estoque.html` e
     `public/logistica.html` modificados na árvore de trabalho — o deploy
     publica o diretório inteiro, não o commit. Conferido no ar: o filtro de
     área responde em `estoque.html` e o `agFreteInfo` em `logistica.html`.
     Seu bloco diz "commit/deploy pendente", e isso vale pro **commit**, mas
     não pra produção. Os dois arquivos seguem sem commit e **não os toquei**.
  2. **`pcdNatureza` (Pedido de Compra Direto) entrou no meu commit
     `586bbc5`.** Estava sem commit em `public/compras.html`, que é o arquivo
     do meu escopo, e usei `git add -A` — não consegui separar. Confirmado com
     `git log -S`: a primeira aparição no repo é o meu commit. O código está
     íntegro (select + handlers + gravação, sintaxe validada), mas o crédito e
     a mensagem de commit ficaram errados.
  - Efeito colateral verificado: `run_pc_direto_test.js` falha porque o
    fixture não preenche `pcdNatureza` — o `salvarPcDireto` sai pelo
    `return` da validação e nada é gravado. É teste desatualizado, **não**
    defeito. Deixei pra você por ser sua mudança; não quis adivinhar a
    intenção do campo.

- **Correções no meu processo, a partir de agora:** `git status --short` antes
  de qualquer deploy; nunca `git add -A`; declarar arquivos aqui antes de
  editar.

## Regras de passagem

- Antes de iniciar: leia este arquivo, `CLAUDE.md` e rode `git status --short`.
- Para tarefas paralelas, declare os arquivos antes de editar. Se houver
  sobreposição, trabalhem em branches/worktrees separados.
- Todo commit deve conter apenas um escopo. Use `git diff --check` e uma
  validação proporcional antes de criá-lo.
- Quem fizer deploy confere o `git status` final e registra aqui o hash e o
  horário da publicação.

## Histórico recente

- 2026-09-09 — `586bbc5`: Cotação com fornecedores homologados e inclusão por
  seleção/CNPJ. **Publicado.** Carregou junto, sem intenção, o `pcdNatureza`
  do Codex (ver aviso no bloco do Claude).
- 2026-09-09 — Codex: filtro de área do WMS + agendamento com distinção de
  frete. **Sem commit, mas JÁ PUBLICADO** por um deploy do Claude (o deploy
  publica o diretório de trabalho, não o commit).

## Cuidado que custou caro

`firebase deploy --only hosting` publica **o diretório `public/` como ele está
no disco** — não o último commit, não o índice do git. Com dois agentes no
mesmo repositório, isso significa que **um deploy publica o trabalho não
commitado do outro**. Conferir `git status --short` antes de publicar não é
zelo: é a única coisa que separa "publiquei o meu" de "publiquei o nosso".
