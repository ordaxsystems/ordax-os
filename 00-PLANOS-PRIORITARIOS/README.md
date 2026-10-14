# OrdaX — Planos Prioritários

Status: **PLANNING ROUTER — não canônico**

Esta pasta é o ponto único para organizar **novos planos, pesquisas, relatórios, prioridades e handoffs de implementação** do OrdaX OS.

Ela existe porque o repositório já possui vários planos históricos na raiz e várias frentes podem estar sendo trabalhadas por chats/agentes diferentes. O objetivo é impedir perda de contexto, duplicação de implementação e prioridades contraditórias.

## Autoridade

Esta pasta **não substitui** a hierarquia documental do OrdaX.

Quando houver conflito, prevalece a ordem definida em `docs/README.md`, em especial:

1. source + contratos machine-readable;
2. `docs/CURRENT-STATE.md`;
3. `MVP.md`;
4. `docs/DECISIONS.md` e owners canônicos;
5. documentação canônica do tópico;
6. planos/propostas desta pasta;
7. pesquisas/evidências históricas.

Um plano aqui nunca transforma intenção em implementação concluída.

## Regra para qualquer novo chat/agente

Antes de iniciar uma nova frente de implementação:

1. ler `AGENTS.md` e a ordem canônica obrigatória;
2. ler este `README.md`;
3. consultar `ROADMAP.md`;
4. consultar `REGISTRY.md` para verificar se já existe plano, pesquisa ou frente equivalente;
5. revalidar a `main` e os owners canônicos do tópico;
6. somente então criar/continuar trabalho.

Se a frente já existir, atualizar o mesmo item. **Não criar `v2`, `final`, `novo`, `alternativo` ou outro plano paralelo para a mesma responsabilidade.**

## Estrutura

```text
00-PLANOS-PRIORITARIOS/
├── README.md                 # regras deste hub
├── ROADMAP.md                # ordem atual de execução
├── REGISTRY.md               # catálogo de planos/relatórios/handoffs
├── inbox/                    # material novo ainda não triado
├── plans/                    # planos executáveis e roadmaps por iniciativa
├── reports/                  # pesquisas e análises de apoio
├── templates/                # formato obrigatório para novos documentos
└── archive/                  # itens encerrados/superseded após auditoria de links
```

## Prioridades

- **P0 — bloqueador de release/segurança/integridade:** trabalho que precisa fechar antes de gates atuais do Stable/MVP ou que corrige risco crítico.
- **P1 — alta prioridade estratégica:** deve avançar após/ao lado dos P0 quando não os deslocar; normalmente fundações de produto com alto impacto.
- **P2 — evolução importante:** agrega capacidade relevante, mas não bloqueia o fechamento imediato.
- **P3 — futuro/experimental:** investigação, escala futura ou recurso opcional sem precedência atual.

Prioridade não significa autoridade. Um P0 ainda precisa respeitar contratos e owners canônicos.

## Status documental

- `INBOX`: recebido, ainda não triado.
- `TRIAGED`: analisado e registrado, mas sem ordem de execução fechada.
- `READY`: plano suficientemente definido para começar após checagem da `main`.
- `ACTIVE`: implementação em andamento.
- `BLOCKED`: depende de decisão, prova, recurso ou gate externo.
- `DONE`: plano executado e refletido no source/estado canônico.
- `SUPERSEDED`: substituído por caminho explicitamente nomeado.
- `ARCHIVED`: mantido apenas por história.

## Regras de higiene

- Todo novo relatório deve entrar em `inbox/` ou diretamente em `reports/` se já estiver triado.
- Toda proposta de implementação precisa de um ID estável, por exemplo `WEB-001`.
- Toda frente precisa registrar: prioridade, status, owner canônico, dependências, gates, próximos passos e caminhos de source afetados.
- Ao iniciar implementação, registrar branch/PR/issue quando existir.
- Ao concluir, atualizar `REGISTRY.md`, `ROADMAP.md` e o owner canônico aplicável. Não declarar `DONE` só porque um plano foi escrito.
- Custos, preços, versões externas e limites de provedores devem carregar data de verificação e nunca virar constantes arquiteturais.
- Relatórios podem recomendar; contratos/ADRs decidem.

## Migração dos planos antigos da raiz

Os planos já existentes na raiz **não serão movidos automaticamente**. Há links ativos e a documentação canônica manda auditar referências antes de mover/remover.

Eles estão catalogados em `REGISTRY.md`. A migração futura deve ser feita de modo incremental: atualizar links, marcar sucessor e só então mover/arquivar.

## Primeiro item registrado

`WEB-001 — OrdaX Web Research` foi criado a partir da pesquisa de 14/10/2026 sobre Tavily, Brave, Exa, Firecrawl, alternativas open source, arquitetura provider-neutral, operação local, custos e segurança.

A decisão proposta é: **OrdaX possui os contratos, política, research orchestration, provenance e budget; provedores externos são adapters substituíveis.** Web Research é núcleo lógico de serviços, não kernel/boot/initramfs.
