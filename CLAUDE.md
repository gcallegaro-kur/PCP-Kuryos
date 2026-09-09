# CLAUDE.md — App PCP Kuryos (`producao_firebase_FINAL`)

App de PCP/produção da Kuryos em Firebase (RTDB + Hosting + Functions), projeto
`prod-kuryos`, repo `https://github.com/gcallegaro-kur/PCP-Kuryos.git`, branch `main`.
Kuryos é fabricante *private label* de cosméticos: ~30 clientes-marca, operação de
envase/rotulagem, licenciada pela Anvisa.

Memória completa (histórico, decisões antigas, projetos vizinhos):
`../../MEMORIA_KURYOS.md` — leia a seção relevante antes de re-derivar qualquer diagnóstico.

---

## Como trabalhar aqui

- **Só eu escrevo no repositório.** O usuário não edita código nem documentos —
  palavras dele: *"eu não anoto nada no repo, só vc"*. Quando ele disser "joguei no
  repo de melhorias" ou "deixei registrado", leia como **"considere adiado, e registre
  você"**. Registrar em `MELHORIAS_FUTURAS.md` faz parte da tarefa; basta conferir
  duplicata com `grep` antes de inserir, sem perguntar.
- **Deploy e git andam juntos.** Todo `firebase deploy --only hosting --project prod-kuryos`
  é seguido, no mesmo turno e sem perguntar, de `git add` + `commit` descritivo +
  `git push origin main`. O repo existe para o dev do Kuryos ERP acompanhar o progresso —
  GitHub desatualizado em relação à produção anula o propósito.
- **Enquadramento de consultor, não de revisor de código.** Em conversas de
  roadmap/funcionalidade, lidere pela razão de negócio e pela priorização
  impacto×esforço para uma fabricante de cosméticos por contrato, ancorado nos
  artefatos reais do drive — não em teoria genérica de MES/ERP.
- **Capacidade sempre pelo valor conservador.** Quando a média histórica calculada
  divergir do teto que o usuário relata, use o menor valor em `prodHoraRef` /
  `mediaPorHora`. Apontamentos lançam lote inteiro como se fosse uma hora e inflam a
  média; superestimar capacidade gera prazo que não se cumpre.
- Ele opta consistentemente pela alternativa mais simples/gratuita quando há escolha, e
  tolera sessões longas de depuração iterativa.

## Onde este app se encaixa

O **Kuryos ERP** (`kuryos-deploy.vercel.app`) é a plataforma de longo prazo e absorverá
o fluxo ponta a ponta. Este app nasceu como remédio para tirar o PCP das planilhas.
**Mesmo assim, continue construindo código real, testado e deployado aqui** — confirmado
em 2026-09-01: *"todo o código que estamos produzindo está sendo aproveitado no outro
sistema, principalmente os motores que rodam as regras de negócio"*. Não responda a um
pedido de funcionalidade com "escrevo só a spec"; o formato de spec vale apenas quando o
próprio usuário pedir um documento para entregar aos devs do ERP. Não tenho acesso ao
código do Kuryos ERP — lá só dá para verificar pelo navegador.

## Estado dos módulos (setembro/2026)

| Módulo | Situação |
|---|---|
| WMS Fase 1 (endereçamento, mapa, planta baixa) | em produção desde 2026-09-02 |
| WMS Fase 2 (separação guiada FEFO, `separacao_materiais.html`) | em produção desde 2026-09-03 |
| Qualidade Fase 2 (`qualidade.html`, papel `qualidade`) | no ar; Fases 3-4 bloqueadas por Ordem de Manipulação, anexo de arquivo e Tarefas Pendentes, que não existem |
| Planejamento/apontamento (`PLANO_PLANEJAMENTO_PCP.md`) | plano fechado, **nada implementado** |
| Estoque | ver "Dia D" abaixo |

**O saldo de estoque ainda não serve para decidir.** Dos 906 materiais cadastrados, só 37
têm registro e 11 estão negativos (pior caso: ET-00012 a −538.784 un). A **saída**
funciona — `baixarEstoqueConsumo` roda a cada apontamento —, a **entrada** nunca
aconteceu, porque só existe via recebimento contra Pedido de Compra. Um **"Dia D"**
operacional (inventário físico completo + endereçamento) vai estabelecer o saldo de
abertura. Até lá: não use saldo como base de compra ou de emissão de OP, e não exiba
saldo ao lado do item na tela de Compras — saldo errado parece confiável e é pior que
saldo nenhum. Pendência operacional, não de código: `estoque_lotes` segue vazio em
produção e ninguém tem o papel `qualidade` ainda.

## Armadilhas confirmadas (todas já custaram caro)

- **`firebase database:update /nó` com objetos aninhados APAGA campos.** O RTDB trata
  cada chave do objeto como um *caminho*. Um update `{PRODUTO: {clienteKey: X}}` trocou
  375 produtos inteiros por um objeto de um campo só. Use sempre **caminhos planos**
  (`PRODUTO/campo`). Antes de qualquer comando destrutivo em massa: (a) backup,
  (b) rodar em UM registro, (c) conferir, (d) só então o resto.
- **Testar a unidade não basta quando o defeito está na ligação.** `clienteKey` ficou
  declarado duas vezes no mesmo objeto literal do save — em JS a última vence, e a
  funcionalidade nasceu morta em produção enquanto 16 asserções passavam testando a
  função isolada.
- **Papel novo precisa entrar em cinco pontas:** `pageAccessRules`, navbar,
  `login.html` (senão dá "Perfil desconhecido"), `usuarios.html` (senão é inatribuível)
  e `database.rules.json` (senão dá PERMISSION_DENIED e o módulo fica decorativo).
- **Escrita em nó novo: confira a regra do banco contra os papéis que usam a TELA.**
  `estoque_lotes` tinha `.write` só para `admin|pcp`, mas quem aponta é
  `production`/`rotulagem` — a baixa retornava PERMISSION_DENIED, o `.catch()` engolia,
  e o bug parecia resolvido.
- **`.catch()` não protege contra throw síncrono** (cache velho após deploy quebrava
  consumo e perdas) — envolva com `Promise.resolve().then(...)`.
- **Buscar `db.ref` por regex não acha escrita mediada por função** (`ajustarEstoque`,
  `putawayEstoqueLote`). Isso me levou a concluir o oposto do verdadeiro e a afirmação
  errada chegou a entrar em 4 manuais. Confirme sempre na implementação.
- **`horizonte.html` NÃO é código morto** — está fora do menu, mas continua gravando
  `alocacoes_planejamento`, que o motor de reajuste lê. Não apague.
- **`materiais.html` é código morto por construção** — faz `location.replace` para
  `cadastros.html?tab=materiais` na abertura; nada no `<body>` dele é visto. A busca
  facetada real vive na aba Materiais de `cadastros.html`.
- **WMS e Estoque ficam desacoplados de propósito.** "Ajustar Estoque" corrige
  quantidade e nunca exige endereço; a aba "Endereçamento" é puramente aditiva a
  `estoque_lotes` e nunca escreve em `estoque/{key}`. Não acople os dois.
- Separação/transferência só **move** endereço, nunca decrementa saldo — a baixa real
  continua no apontamento.

## Documentos vivos no repo (git-tracked, leia antes de trabalhar no tema)

- `MELHORIAS_FUTURAS.md` — backlog de tudo que foi deliberadamente adiado. Todo item
  adiado entra aqui, com contexto e arquivo/função para retomar.
- `PLANO_PLANEJAMENTO_PCP.md` — roadmap de planejamento/eficiência/apontamento, com
  diagnóstico já confirmado contra o código (não re-derive). Decisões travadas:
  granularidade de 15 min, conclusão de OP 100% manual pelo PCP no início, duas telas de
  planejamento sobre o pipeline `alocacoes_planejamento` existente, changeover por linha,
  ML adiado. Sequência: apontamento de manipulação → popular `dataInicioPlanejada/Fim` →
  travar apontamento na OP programada → paradas na ETA → telas → conclusão gated → etc.
- `AUDITORIA_INTEGRACAO.md` — os 9 elos entre setores, com evidência no código. 4 foram
  fechados em 2026-09-08.
- `public/manuais.html` — manuais operacionais. Cada passagem que ainda depende de
  conversa leva um selo laranja "manual"; **ao fechar um elo no código, tire a marca do
  manual correspondente**.

## Próximos passos conhecidos (nenhum iniciado)

1. Acesso por papel conforme os 8 blocos do menu (Analytics/Geral/Compras/PCP/Logística/
   Produção/RH/ADM) — o usuário disse que vem como passo próprio, depois da renomeação.
2. WMS Fase 3: inventário rotativo + coletor de código de barras (o app já gera
   EAN13/Code39 e tem `qrcode-lib.js`, mas não lê nada).
3. Fase 1 do plano de planejamento: apontamento de manipulação — hoje a etapa de granel
   tem zero rastreamento, e é a causa raiz do buraco "programei 1000, finalizei 800".
