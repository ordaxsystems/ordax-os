# OrdaX — parte 5: Intelligence, contexto e agentes escaláveis

**Estado:** fundação em implementação incremental; sem autoridade mutável para IA.  
**Objetivo:** evoluir OrdaX Intelligence de capacidade consultiva + chat local para uma camada de inteligência do sistema que conheça aplicativos, projetos e contexto autorizado sem acoplar o produto a um modelo, provedor ou lista fixa de apps.

Este plano preserva as decisões do legado `washingtonmsdj/novo-ordax-os` sobre Context Manager, Model Router, Agent Manager, Tool Manager, Capability Bridge, Task Scheduler, memória e coordenação multiagente, mas reimplementa cada etapa sobre os contratos atuais do protótipo.

## 1. Regra central

```text
Apps / Surface / Workspace
        |
        v
Context sources autorizadas
        |
        v
Ordax Intelligence
        |
        +-- Context Registry
        +-- Memory
        +-- Model Router
        +-- futuros Planner / Agents / Tools
        |
        v
Inference providers
```

O modelo não é a autoridade. Contexto não concede tools. Tools não concedem privilégios. Prompt de usuário não concede contexto privado, capability, rede, shell ou escrita.

## 2. Apps precisam ser descobertos, não hardcoded

O catálogo `system/apps/catalog.mjs` é a origem canônica dos aplicativos first-party. A Intelligence não deve manter uma segunda lista de nomes de apps em prompt, configuração ou código do modelo.

A primeira implementação desta etapa projeta automaticamente do catálogo:

- app id;
- título;
- versão semântica;
- descrição;
- capabilities obrigatórias;
- capabilities opcionais.

Assim, um novo app first-party passa a fazer parte do conhecimento estrutural da Intelligence quando entra no catálogo canônico.

Isso **não** autoriza leitura do conteúdo privado do app. Saber que `Arquivos` existe é diferente de poder ler um arquivo; saber que `Conta` existe é diferente de poder ler uma sessão. Estado privado e conteúdo vivo exigem fontes de contexto próprias e autorização explícita.

## 3. Context Registry

A fundação define um registry provider-neutral de fontes de contexto com dois modos:

- `automatic`: somente metadados estruturais não sensíveis que podem participar sem ação adicional, como o catálogo first-party;
- `explicit`: documento, projeto, Workspace, memória ou outro contexto que só entra quando a composição/UI autoriza a fonte.

O registry agrega itens usando o mesmo contrato bounded/provenance de `ordax.intelligence/1`. IDs duplicados, fontes desconhecidas ou excesso de contexto falham fechados.

Prompt de usuário nunca ativa uma fonte `explicit` por texto.

## 4. Sequência de implementação

### P0 — fundação segura

1. app OrdaX Intelligence conversacional local;
2. Context Registry provider-neutral;
3. fonte automática do catálogo first-party;
4. UI deixa visível que contexto estrutural do sistema participa;
5. manter Web grounding, cloud provider, voz e tools desativados.

### P1 — contexto útil sem mutação

6. fonte explícita de documento/arquivo selecionado;
7. fonte explícita do projeto ativo;
8. fonte explícita de Workspace/objetos ativos;
9. memória autorizada escolhida pelo usuário/composição;
10. ações "Perguntar à Intelligence sobre isto" em Arquivos, Notas, Internet, Projetos e Sistema usando o mesmo registry.

Nenhum desses itens precisa conceder execução de tools.

### P2 — planejamento estruturado

11. Task IR v0.1 para transformar intenção em objetivo, alvo, risco, constraints e critérios de aceite;
12. Context Capsule para fornecer somente o contexto necessário;
13. modo Planejar no app Intelligence sem executar mudanças;
14. Project Intelligence read-only baseado em evidência real de Git, testes, contratos e artefatos.

### P3 — agentes e capabilities read-only

15. Agent Registry com identidades como System, Search, File, Workspace e Developer;
16. Tool Manager / Capability Bridge somente leitura;
17. status, health, logs sanitizados, listagem e leitura explicitamente autorizada;
18. receipts/telemetria de cada execução;
19. nenhuma shell genérica.

**Estado atual da P3:** Agent Registry, Tool Registry, Capability Bridge e grants tipados já existem. O broker exige binding explícito agente→tool, capability realmente presente, alvo compatível, TTL curto e uso único. O lifecycle de autorização gera receipts `issued/claimed/revoked/expired` sem bearer token nem target privado. A primeira execução governada também já foi implementada para `observe-system-metrics`: somente após claim válido do grant, usando a porta canônica `ordax.system-metrics/1`, resultado bounded com provenance e execution receipt separado `succeeded/failed`. Os receipts de autorização e execução agora podem ser correlacionados por `auditRef` em um journal dedicado, bounded e append-only de runtime. O journal não guarda grant ID, target ID, prompt, resposta do modelo, conteúdo retornado pela tool nem detalhe interno do adapter; `auditRef` não concede autoridade. Persistência nativa durável desse journal ainda está deliberadamente pendente. `observe-network-status` e `observe-power-status` continuam registradas porém não invocáveis. O chat/modelo ainda não recebe seleção automática de tool e nenhuma tool mutável foi habilitada.

### P4 — Web e modelos externos

20. Web grounding com origem, URL, timestamp e provenance;
21. adapters externos atrás de `ordax.model-router/1`;
22. preferências Local first / Privacy / Balanced / Quality;
23. egress explícito por policy e por dados envolvidos;
24. fallback nunca envia dados a provider não autorizado.

### P5 — ações tipo Jarvis

25. tools mutáveis tipadas;
26. preview/plano antes da ação;
27. `awaiting_approval` para ações sensíveis, externas, destrutivas ou irreversíveis;
28. leases para mutações concorrentes;
29. rollback quando suportado;
30. evidence/receipt obrigatório.

Somente depois dessa camada entram automações maiores, voz, multiagente e self-healing.

## 5. Escalabilidade de aplicativos

Um app novo deve seguir uma única cadeia:

```text
app owner
 -> defineFirstPartyApp
 -> canonical app catalog
 -> Surface availability by capability
 -> Intelligence structural discovery
 -> optional explicit context source
 -> optional typed tools/capabilities
```

Adicionar app não deve exigir editar o prompt global da IA, o runtime do modelo ou uma lista paralela no Assistant.

Apps externos futuros deverão passar pelo catálogo/distribuição assinada e por um contrato equivalente antes de participarem de Intelligence. O fato de um pacote existir não autoriza seu conteúdo nem suas tools.

## 6. Memória e conhecimento

Memória persistente continua pertencendo ao OrdaX, não ao modelo. Catálogo de apps não é memória de usuário.

Separação:

```text
system metadata      -> automatic context
selected live data   -> explicit context
persistent memory    -> authorized memory context
knowledge sources    -> provenance + freshness
model output         -> nunca vira fato permanente sozinho
```

Knowledge Graph, semantic search e Project Brain podem ser adicionados depois sobre essas fronteiras sem trocar o app conversacional nem o contrato estável de Intelligence.

## 7. Regras que não podem regredir

- IA não é boot-critical;
- provider é substituível;
- app não importa backend de modelo diretamente;
- novo app entra pelo catálogo canônico;
- contexto privado exige autorização;
- prompt não concede autorização;
- tool não é inferida por nome de agente;
- modelo forte não recebe mais privilégio que modelo fraco;
- Internet não é fallback silencioso;
- memória não é injetada automaticamente por login;
- agentes não recebem root/shell genérico;
- receipts e audit logs não são capabilities nem bearer tokens;
- mutação oficial do sistema continua subordinada às authorities e gates do OrdaX.

## 8. Relação com o legado Nova OrdaX

Esta etapa recupera de forma clean-room as ideias registradas em:

- `docs/intelligence/ORDAX-INTELLIGENCE.md`;
- `docs/intelligence/ARCHITECTURE.md`;
- `docs/intelligence/AGENTS.md`;
- `docs/intelligence/MEMORY-CONTEXT.md`;
- `docs/intelligence/MODEL-ROUTING.md`;
- `docs/architecture/ORDAX-PLATFORM-INTELLIGENCE-ROADMAP-001.md`;
- `docs/FOUNDATION/AI-INTEROP/AI-INTEROP-003-INTELLIGENCE-NORMALIZATION.md`.

A meta de longo prazo permanece a mesma: uma experiência progressivamente "Jarvis-like", mas construída sobre contexto, capabilities, policies, evidence e aprovação em vez de entregar autoridade irrestrita a um chatbot.
