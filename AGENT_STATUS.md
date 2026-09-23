# Status compartilhado dos agentes

Este é o ponto de passagem de contexto entre Codex e Claude. Atualize somente
o bloco do agente que você está operando e mantenha o histórico curto.

## Em andamento

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

- **Módulo Operação, Fase 1 (2026-09-23) — commit `88060ca`, local, AINDA
  NÃO PUBLICADO nem enviado ao origin.** O deploy foi barrado pela checagem
  de permissão da sessão; publicar junto com o push:
  `firebase deploy --only hosting,database,functions:onPesagemFechada --project prod-kuryos`
  (com `FUNCTIONS_DISCOVERY_TIMEOUT=60`).
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
