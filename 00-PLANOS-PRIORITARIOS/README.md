# OrdaX — Planos Prioritários

Status: **PLANNING ROUTER — não canônico**

Esta pasta é o ponto único para organizar **planos, pesquisas, relatórios, prioridades e handoffs de implementação** do OrdaX OS.

Ela existe porque o repositório já possui vários planos históricos na raiz e várias frentes podem estar sendo analisadas por chats/agentes diferentes. O objetivo é impedir perda de contexto, duplicação de implementação e prioridades contraditórias.

## Regra operacional atual — fechamento do MVP primeiro

Até o fechamento do MVP atual, este hub funciona principalmente como **registro, triagem, preservação e reconciliação documental**.

- planos desta pasta ou planos históricos da raiz **não abrem trabalho de implementação por si só**;
- nenhuma frente futura deve ser iniciada apenas porque está `READY`, P1, P2 ou documentada em detalhes;
- antes do fechamento do MVP, execução só ocorre quando já for exigida pelos owners canônicos do MVP, contratos, `docs/CURRENT-STATE.md` ou `docs/PROMOTION-GATES.md`;
- pesquisa, documentação, auditoria de links e correção de classificação documental podem continuar sem promover execução de produto;
- depois do fechamento do MVP, `ROADMAP.md` deve ser revalidado contra a `main` e os owners canônicos antes de liberar qualquer plano adiado.

Isso separa **preservar uma boa ideia** de **autorizar sua implementação agora**.

## Autoridade

Esta pasta **não substitui** a hierarquia documental do OrdaX.

Quando houver conflito, prevalece a ordem definida em `docs/README.md`, em especial:

1. source + contratos machine-readable;
2. `docs/CURRENT-STATE.md`;
3. `MVP.md`;
4. `docs/DECISIONS.md` e owners canônicos;
5. documentação canônica do tópico;
6. planos/propostas desta pasta ou planos históricos da raiz;
7. pesquisas/evidências históricas.

Um plano nunca transforma intenção em implementação concluída, escopo de MVP ou autoridade. Declarações históricas como `CANÔNICO`, `P0` ou equivalentes dentro de um `PLANO-*` não vencem a hierarquia acima.

## Regra para qualquer novo chat/agente

Antes de iniciar uma nova frente de implementação:

1. ler `AGENTS.md` e a ordem canônica obrigatória;
2. ler este `README.md`;
3. consultar `ROADMAP.md`;
4. consultar `REGISTRY.md` para verificar se já existe plano, pesquisa ou frente equivalente;
5. revalidar a `main` e os owners canônicos do tópico;
6. verificar se a frente está **EXECUTION-ELIGIBLE** no roadmap atual;
7. somente então criar/continuar implementação.

Enquanto vigorar o fechamento do MVP, planos futuros ficam **DEFERRED FOR EXECUTION** mesmo que continuem `READY` documentalmente.

Se a frente já existir, atualizar o mesmo item. **Não criar `v2`, `final`, `novo`, `alternativo` ou outro plano paralelo para a mesma responsabilidade.**

## Estrutura

```text
00-PLANOS-PRIORITARIOS/
├── README.md                 # regras deste hub
├── ROADMAP.md                # janela de execução e ordem atual
├── REGISTRY.md               # catálogo de planos/relatórios/handoffs
├── inbox/                    # material novo ainda não triado
├── plans/                    # planos executáveis ou preservados para execução futura
├── reports/                  # pesquisas e análises de apoio
├── templates/                # formato obrigatório para novos documentos
└── archive/                  # itens encerrados/superseded após auditoria de links
```

## Prioridades

- **P0 — bloqueador de release/segurança/integridade:** trabalho exigido pelos owners canônicos para fechar gates correntes.
- **P1 — alta prioridade estratégica:** alto impacto, mas não ganha precedência sobre o fechamento atual do MVP apenas por estar classificado como P1.
- **P2 — evolução importante:** capacidade relevante para uma etapa posterior.
- **P3 — futuro/experimental:** investigação, escala futura ou recurso opcional.

Prioridade não significa autoridade nem elegibilidade de execução.

## Status documental

- `INBOX`: recebido, ainda não triado.
- `TRIAGED`: analisado e registrado, sem prontidão suficiente para execução.
- `READY`: suficientemente definido para ser considerado quando sua janela de execução abrir.
- `ACTIVE`: implementação realmente em andamento e respaldada pelos owners canônicos.
- `BLOCKED`: implementação autorizada/necessária, mas impedida por decisão, prova, recurso ou gate externo.
- `REFERENCE`: documento útil para produto/arquitetura/histórico, sem representar uma frente ativa.
- `GUIDE`: guia/handoff operacional, sem autoridade própria.
- `DONE`: plano executado e refletido no source/estado canônico.
- `SUPERSEDED`: substituído por caminho explicitamente nomeado.
- `ARCHIVED`: mantido apenas por história.

## Elegibilidade de execução

O status documental é separado da janela de execução:

- `EXECUTION-ELIGIBLE`: pode ser executado porque um owner canônico/gate corrente exige a frente.
- `DEFERRED FOR EXECUTION`: preservar e manter atualizado, mas não iniciar implementação agora.
- `NOT APPLICABLE`: relatório, referência ou histórico que não representa trabalho executável.

Durante o fechamento atual do MVP, a regra padrão para planos futuros é `DEFERRED FOR EXECUTION`.

## Regras de higiene

- Todo novo relatório deve entrar em `inbox/` ou diretamente em `reports/` se já estiver triado.
- Toda proposta de implementação precisa de um ID estável, por exemplo `WEB-001`.
- Toda frente precisa registrar: prioridade, status documental, elegibilidade de execução, owner canônico, dependências, gates, próximos passos e caminhos de source afetados.
- Branch/PR/issue de implementação só deve ser criado quando a frente estiver `EXECUTION-ELIGIBLE`; documentação não exige abrir tarefa de produto.
- Ao concluir implementação autorizada, atualizar `REGISTRY.md`, `ROADMAP.md` e o owner canônico aplicável. Não declarar `DONE` só porque um plano foi escrito.
- Custos, preços, versões externas e limites de provedores devem carregar data de verificação e nunca virar constantes arquiteturais.
- Relatórios podem recomendar; contratos/ADRs decidem.
- Não usar plano como changelog infinito: estado factual deve convergir para `docs/CURRENT-STATE.md`, contratos ou owner canônico do tópico.

## Migração dos planos antigos da raiz

Os planos já existentes na raiz **não serão movidos automaticamente**. Há links ativos e a documentação canônica manda auditar referências antes de mover/remover.

Eles estão catalogados em `REGISTRY.md`. A migração futura deve ser incremental:

1. identificar o owner canônico real;
2. retirar do plano qualquer pretensão de autoridade que conflite com `docs/README.md`;
3. atualizar links vivos;
4. marcar sucessor/status documental;
5. somente então mover, arquivar ou remover.

Até essa auditoria terminar, o `REGISTRY.md` é a classificação autoritativa **do hub de planejamento** para esses arquivos, sem alterar a autoridade arquitetural do produto.

## Primeiro plano nativo do hub

`WEB-001 — OrdaX Web Research` foi criado a partir da pesquisa de 14/10/2026 sobre Tavily, Brave, Exa, Firecrawl, alternativas open source, arquitetura provider-neutral, operação local, custos e segurança.

A direção preservada é: **OrdaX possui os contratos, política, research orchestration, provenance e budget; provedores externos são adapters substituíveis.** Web Research é núcleo lógico de serviços, não kernel/boot/initramfs.

Enquanto o MVP atual não estiver fechado, `WEB-001` permanece documentado e **DEFERRED FOR EXECUTION**.
