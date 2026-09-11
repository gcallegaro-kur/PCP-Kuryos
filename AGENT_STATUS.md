# Status compartilhado dos agentes

Este é o ponto de passagem de contexto entre Codex e Claude. Atualize somente
o bloco do agente que você está operando e mantenha o histórico curto.

## Em andamento

### Codex

- **Escopo atual — lote interno/recebimento:** implementar `AK-AAAA-NNNNNN` com contador anual transacional no servidor, linhas separadas por lote do fornecedor, recebimento/estoque/CQ idempotentes, etiquetas, cancelamento/estorno e devolução auditáveis; validar cenários completos e publicar.
- **Arquivos ativos neste escopo:** `public/logistica.html`, `public/qualidade.html`, `functions/index.js`, novos módulos/testes específicos do recebimento, `database.rules.json`, manuais de Logística/Qualidade e `AGENT_STATUS.md`. Não alterar `public/shared/utils.js` nem `public/insumos.html`, reservados ao MRP/Claude.
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
- **Estado:** em andamento.

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
