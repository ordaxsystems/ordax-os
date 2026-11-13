# OrdaX — Planos Prioritários

Status: **PLANNING ROUTER — não canônico**

Esta pasta é o ponto único para organizar **planos, pesquisas, relatórios, prioridades e handoffs de implementação** do OrdaX OS.

Ela existe porque o repositório já possui vários planos históricos na raiz e várias frentes podem estar sendo analisadas por chats/agentes diferentes. O objetivo é impedir perda de contexto, duplicação de implementação e prioridades contraditórias.

## Regra operacional atual — paralelismo por owner

Este hub **não define uma fila global de produto**. A regra vigente é a mesma de ADR-031: owners independentes avançam em paralelo e sincronizam somente quando existe adoção real de contrato, artefato ou revisão. Desktop, USB/Creator, Surface, Apps, Site e Intelligence não bloqueiam uns aos outros por padrão.

- planos desta pasta ou planos históricos da raiz **não abrem trabalho de implementação por si só**;
- nenhuma frente futura deve ser iniciada apenas porque está `READY`, P1, P2 ou documentada em detalhes;
- execução depende do estado contemporâneo em source, PRs/branches, `docs/CURRENT-STATE.md`, `MVP.md`, contratos e owner canônico;
- uma frente já ativa por owner/gate real continua elegível mesmo que outro produto/canal esteja validando algo em paralelo;
- alterações client-only não disparam USB/kernel/Creator sem causalidade; alterações de USB/Native também não congelam Desktop/Web;
- pesquisa, documentação, auditoria de links e correção de classificação documental podem continuar sem promover capacidade de produto.

Isso separa **preservar uma boa ideia** de **autorizar sua implementação agora** e evita transformar repositórios separados em uma fila global.

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

## Entrada de novos agentes — sem fila documental

**Implementação com owner e tarefa definidos:** começar em `AGENTS.md`, verificar o owner/contrato e a fonte atual necessários à alteração, executar primeiro e validar proporcionalmente. **Não é obrigatório ler este hub, `ROADMAP.md` ou `REGISTRY.md` antes de cada correção.** Essas referências não são gates de implementação e não podem bloquear jornadas independentes.

**Planejamento, proposta nova, alteração de prioridade ou escopo incerto:** consultar este índice e o `REGISTRY.md` para reaproveitar materiais existentes; consultar `ROADMAP.md` somente quando for relevante à decisão de escopo. Revalidar owner, contratos e estado atual antes de declarar execução elegível. Um plano `READY` não cria trabalho por si só.

Se já houver documento equivalente, atualizar o mesmo item em vez de criar versões `v2`, `final`, `novo` ou `alternativo`. Evidências e handoffs históricos permanecem contexto, não comandos operacionais.

## Estrutura

```text
00-PLANOS-PRIORITARIOS/
├── README.md                 # regras deste hub
├── ROADMAP.md                # janela de execução e ordem atual
├── REGISTRY.md               # catálogo de planos/relatórios/handoffs
├── inbox/                    # material novo ainda não triado
├── plans/                    # planos executáveis ou preservados para execução futura
├── reports/                  # pesquisas e análises de apoio
├── templates/                # modelos opcionais para planos/relatórios novos
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

A regra padrão para planos futuros é `DEFERRED FOR EXECUTION` até que um owner/gate contemporâneo os torne necessários.

## Planos centrais atuais deste hub

### NATIVE-001 — USB → Native e fechamento do MVP instalável

`plans/NATIVE-001-USB-TO-NATIVE-MVP-CLOSURE.md`

Organiza a promoção da infraestrutura Native já existente: whole-disk, target identity, Stable signed release, boot sem USB, first-boot health, known-good/recovery e hardware claim por modelo. **P0 somente porque o owner canônico já colocou Native no ciclo do MVP.** Não autoriza APPLY físico.

### MODE-001 — Web, Cloud & Device Runtime

`plans/MODE-001-WEB-CLOUD-DEVICE-RUNTIME.md`

Preserva a direção de um produto/uma Surface com runtimes `web | cloud | device | hybrid`, Web real, Files federado, Store sem mocks, Device Bridge, Secure Mesh opcional e Cloud Runtime/VPS somente quando justificado. P1 pós-MVP.

### DEV-001 — Space geral de Desenvolvimento

`plans/DEV-001-GENERAL-DEVELOPMENT-SPACE.md`

Define um Space horizontal de desenvolvimento para múltiplos projetos como Achegue-se, STLForge, sites, apps, APIs e outros produtos. **Studio é ferramenta/app dentro do contexto de um projeto, não um Space.** Git, CI, deploy e providers preservam seus próprios SSOTs e permissões. P1 pós-MVP.

### FAB-001 — OrdaX Fabrication e Impressão 3D

`plans/FAB-001-ORDAX-FABRICATION-3D-PRINTING-PILOT.md`

Primeiro vertical comercial recomendado depois da fundação Web/Cloud/Device. Usa a operação real de impressão 3D como dogfooding de pedidos, orçamento, modelos, jobs, print farm, materiais, qualidade, custos, devices e Intelligence. P1 pós-MVP.

### FOOD-001 — OrdaX Food e piloto Pizza

`plans/FOOD-001-ORDAX-FOOD-PIZZA-PILOT.md`

Transforma a direção já existente do Profile `pizzaria-br@1` em um plano comercial pós-MVP sem inflar o recorte atual do Profile. Define **OrdaX Food** como domínio compartilhado e **Pizza/Pizzaria** como primeiro vertical/piloto, cobrindo Menu, pizza builder, Orders, POS, KDS, mesas/comandas, estoque/ficha técnica, compras, CRM, Inbox/WhatsApp oficial, delivery, pagamentos, analytics e Intelligence/Autopilot. P1 pós-MVP.

### IDENTITY-001 — membros, convites e acesso a Spaces

`plans/IDENTITY-001-SPACE-MEMBERS-INVITES-AND-ACCESS.md`

Fecha o produto sobre o membership já existente: convites, aceite, expiração, revogação, `owner/admin/member/viewer`, transferência de ownership e auditoria. Funcionário/People não ganha login automaticamente. P1 pós-MVP.

### REL-001 — relações externas e portais

`plans/REL-001-EXTERNAL-RELATIONSHIPS-AND-PORTALS.md`

Fundação horizontal para clientes, pais/responsáveis, alunos e outros externos acessarem projections/actions autorizadas sem virarem membros internos. O domínio mantém o SSOT da relação; REL-001 possui grants/consent/revoke e shell do Portal. P1 pós-MVP.

### ACHEGUESE-001 — integração first-party OrdaX × Achegue-se

`plans/ACHEGUESE-001-FIRST-PARTY-PRODUCT-INTEGRATION.md`

Mantém os produtos separados e integráveis por OAuth/API/events/projections. Regra de produto: **Achegue-se descobre e conecta; OrdaX organiza e opera.** Nenhum banco, credencial privilegiada, release ou SSOT é fundido. P1 de ecossistema pós-MVP dos dois lados.

### ACHEGUESE-002 — Space operacional do Achegue-se

`plans/ACHEGUESE-002-ORDAX-OPERATIONS-SPACE.md`

Define o Space privado usado para operar o produto: usuários, empresas, solicitações, territórios, assinaturas/pagamentos quando houver owner real, pedidos quando promovidos, moderação, suporte, métricas e Aura. O desenvolvimento técnico do Achegue-se passa a ser um projeto no DEV-001. P1 de dogfooding/operação pós-MVP.

### TALENT-001 — Identidade profissional, vagas e contratação

`plans/TALENT-001-PROFESSIONAL-IDENTITY-JOBS-AND-HIRING.md`

Identidade profissional fica na Account, fora de Space e fora de Profile Pack. Vagas pertencem a Spaces empregadores; Network/Messaging suportam o fluxo; People e membership entram somente após decisões explícitas. IA é assistiva e não decide contratação. P2.

### EDU-001 — Education e Portal da Família

`plans/EDU-001-ORDAX-EDUCATION-SCHOOL-AND-FAMILY-PORTAL.md`

Define Escola como Space operacional privado: alunos, responsáveis, turmas, presença, notas, autorizações, reuniões, pagamentos e transporte limitado. Pais/alunos usam REL-001; dados de menores nunca viram targeting/publicação territorial. P2.

### MARKET-001 — ofertas, descoberta e Marketplace

`plans/MARKET-001-OFFERS-DISCOVERY-AND-MARKETPLACE.md`

OrdaX pode author/publicar ofertas; Achegue-se é canal territorial natural quando vinculado. Publicação é explícita, revisionada e revogável. Não há ad-tech baseado em dados privados/sensíveis. P2.

### HARDWARE-001 — Hardware, Drivers e Packs

`plans/HARDWARE-001-HARDWARE-DRIVERS-AND-PACKS.md`

Evolui a estratégia já existente de hardware packs assinados/exact-match até uma experiência de Hardware & Drivers com health/rollback. P1. O mínimo necessário ao modelo Native anunciado permanece no P0 do owner do MVP.

### DESKTOP-001 — experiência cotidiana

`plans/DESKTOP-001-DAILY-USE-EXPERIENCE.md`

Fecha lacunas reais sem recriar subsistemas: Displays, Help offline, MTP/PTP/SMB no Files, UX de Updates e descoberta de apps por intenção. Theme Packs são P2 interno. P1 pós-MVP.

### WEB-001 — Web Research

`plans/WEB-001-WEB-RESEARCH.md`

Capability provider-neutral para pesquisa externa compartilhável por Intelligence/Aura/Studio. P1 pós-MVP e distinta de OrdaX Web.

## Relatório de comparação de desktop

`reports/COMP-001-SPACED-LINUX-ORDAX-COMPARISON.md` registra a auditoria que corrigiu uma leitura superficial de lacunas.

Ele existe para impedir que outro chat/agente proponha desnecessariamente:

- Calamares como segundo instalador;
- Timeshift como segundo recovery;
- outro serviço de Diagnostics;
- outra Loja;
- outro updater;
- APT/DKMS/MATE/Compiz/Flatpak como arquitetura obrigatória do OrdaX.

A regra é: **copiar bons princípios de UX; preservar os owners e contratos do OrdaX**.

## Regras de higiene

- **Somente quando um novo plano ou relatório for realmente necessário**, cadastrar no índice existente (`inbox/`, `plans/` ou `reports/`) e reaproveitar modelo opcional. Não criar relatório por padrão após correções simples.
- Novos programas de planejamento acompanhados pelo hub recebem ID estável (por exemplo, `WEB-001`), owner, status documental, dependências e gates pertinentes; pequenas alterações de código não precisam de ID ou ficha de programa.
- `EXECUTION-ELIGIBLE` classifica propostas novas do hub; **não** condiciona tarefas já autorizadas e de owner conhecido à criação de um plano, branch ou issue de planejamento.
- Atualizar `REGISTRY.md` e `ROADMAP.md` **apenas quando o próprio registro, a prioridade ou a elegibilidade do plano mudar**. Para correções comuns, atualizar somente source/contratos/testes e o documento canônico realmente impactado. Não declarar `DONE` só porque um plano foi escrito.
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