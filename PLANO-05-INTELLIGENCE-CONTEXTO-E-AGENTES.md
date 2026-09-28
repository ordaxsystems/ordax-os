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

A implementação projeta automaticamente do contrato canônico de cada app:

- app id;
- título;
- versão semântica;
- descrição;
- capabilities obrigatórias;
- capabilities opcionais;
- IDs de fontes de contexto da Intelligence declaradas pelo próprio app;
- IDs de tools da Intelligence declaradas pelo próprio app quando existirem.

Assim, um novo app first-party passa a fazer parte do conhecimento estrutural da Intelligence quando entra no catálogo canônico. Integrações opcionais também ficam anexadas ao mesmo `defineFirstPartyApp`, em vez de criar uma lista paralela no Assistant.

Isso **não** autoriza leitura do conteúdo privado do app. Saber que `Arquivos` existe ou que declara `file-selection` é diferente de poder ler um arquivo; saber que `Conta` existe é diferente de poder ler uma sessão. Metadados de integração descrevem pontos possíveis, mas autorização continua pertencendo ao Context Registry, grants e Capability Bridge.

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

**Estado atual da P2:** Projetos já possui contexto explícito de metadados canônicos e referências Web sanitizadas, além de uma primeira fonte separada de **evidências locais do projeto**. Essa fonte só é lida depois da ação explícita `Analisar evidências`; o app recebe uma porta estreita `ordax.project-evidence/1`, enquanto o acesso ao File Space permanece dentro da composição/serviço. O scanner é deliberadamente bounded: considera somente arquivos de orientação/manifests aprovados no topo do projeto e resumos rasos de diretórios conhecidos de testes, documentação, contratos e artefatos. Não percorre `src`, não faz varredura recursiva, não inspeciona `.git`, não envia o caminho local do projeto e não transforma evidência em authority. A próxima evolução de Project Intelligence deve adicionar Git/testes/contratos/artefatos como capabilities read-only próprias quando precisarem de observação mais profunda, em vez de alargar implicitamente o acesso ao filesystem.

### P3 — agentes e capabilities read-only

15. Agent Registry com identidades como System, Search, File, Workspace e Developer;
16. Tool Manager / Capability Bridge somente leitura;
17. status, health, logs sanitizados, listagem e leitura explicitamente autorizada;
18. receipts/telemetria de cada execução;
19. nenhuma shell genérica.

**Estado atual da P3:** Agent Registry, Tool Registry, Capability Bridge e grants tipados já existem. O broker exige binding explícito agente→tool, capability realmente presente, alvo compatível, TTL curto e uso único. O lifecycle de autorização gera receipts `issued/claimed/revoked/expired` sem bearer token nem target privado. A execução governada read-only cobre agora `observe-system-metrics`, `observe-network-status` e `observe-power-status`, sempre depois de claim válido e usando somente as portas canônicas `ordax.system-metrics/1`, `ordax.network-status/1` e `ordax.power-status/1`. O contexto de rede é minimizado antes do modelo: nomes de interfaces, IPs, SSIDs e configuração não são carregados; ficam apenas tipo, estado e sinal. Energia expõe somente estado/percentual de bateria e alimentação externa. Resultados continuam bounded com provenance e execution receipt `succeeded/failed`. Receipts de autorização e execução são correlacionados por `auditRef` em journal dedicado, bounded e append-only de runtime, sem grant ID, target ID, prompt, resposta do modelo, conteúdo de tool ou detalhe interno do adapter. Persistência nativa durável desse journal ainda está deliberadamente pendente. A composição Native já conecta a ação explícita de diagnóstico do app Sistema a esse pipeline: o consumidor continua falando apenas com `ordax.intelligence/1`, enquanto a composição substitui o snapshot ad hoc por observações governadas antes da inferência. Isso evita acoplar a UI ao Tool Manager e permite que novos apps recebam clientes governados equivalentes no futuro. O chat/modelo não recebe seleção automática de tool e nenhuma tool mutável foi habilitada.

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
 -> app-owned Intelligence metadata
 -> optional explicit context source
 -> optional typed tools/capabilities
```

`defineFirstPartyApp` é também a origem canônica dos IDs de integração da Intelligence. Hoje Arquivos declara `file-selection`, Notas declara `note-selection` e Projetos declara `project-selection` + `project-evidence-selection`. Apps sem integração recebem listas vazias, sem precisar de exceções no Assistant. Testes cruzam fontes declaradas com o registry first-party para impedir referências órfãs.

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
- integrações de Intelligence pertencem ao contrato do app, não a uma lista paralela do Assistant;
- declarar fonte/tool não autoriza coleta ou execução;
- contexto privado exige autorização;
- prompt não concede autorização;
- tool não é inferida por nome de agente;
- modelo forte não recebe mais privilégio que modelo fraco;
- Internet não é fallback silencioso;
- memória não é injetada automaticamente por login;
- agentes não recebem root/shell genérico;
- receipts e audit logs não são capabilities nem bearer tokens;
- evidência de projeto é contexto explícito e bounded, nunca autoridade de filesystem;
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
