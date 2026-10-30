# WEB-001 — OrdaX Web Research

- **Tipo:** PLAN / ROADMAP
- **Status documental:** READY — NOT IMPLEMENTED
- **Elegibilidade de execução:** **DEFERRED FOR EXECUTION**
- **Prioridade preservada:** P1 para reavaliação pós-MVP
- **Criado:** 2026-10-14
- **Owner canônico proposto:** boundary sistêmico de Web Research sob os owners atuais de Intelligence/Action Policy; confirmar paths somente quando a frente voltar a ser elegível
- **Relatório:** `../reports/WEB-001-WEB-RESEARCH-DEEP-RESEARCH.md`
- **Não boot-critical:** SIM

## Janela de execução

Este plano está preservado, mas **não deve abrir task, issue, PR ou implementação durante o fechamento atual do MVP**.

Quando o MVP estiver fechado, revalidar `main`, owners, contratos, custos e providers antes de liberar a Fase 0. `READY` significa maturidade documental, não autorização para começar.

Se algum comportamento semelhante já for exigido antes disso por `MVP.md`, contratos ou outro owner canônico, o trabalho pertence a esse owner e não promove automaticamente `WEB-001`.

## Problema

Aura, Studio, IA local e futuras IAs conectadas precisam obter informação atual, documentação e evidências da web. Acoplar diretamente Tavily/Exa/Firecrawl em cada app criaria lock-in, duplicação de política, credenciais espalhadas e semânticas diferentes.

Ao mesmo tempo, usar uma API paga para cada pergunta de cada usuário não escala economicamente e enfraquece privacidade/offline.

## Objetivo

Quando a frente for liberada, criar uma capability **OrdaX Web** provider-neutral que permita descobrir, extrair, verificar e pesquisar conteúdo externo com:

- contratos estáveis;
- grants de `external-egress`;
- provenance/freshness/citations;
- budgets de custo/bytes/tempo;
- provider routing/fallback autorizado;
- cache compatível com direitos do provider/site;
- local extraction quando possível;
- segurança contra SSRF e prompt injection;
- integração compartilhada por Aura/Studio/IA local/MCP.

## Não objetivos

- construir um Google próprio no primeiro release;
- colocar Web Research em kernel/initramfs/bootstrap/Base mínima;
- tornar Tavily contrato do produto;
- expor API keys a Aura/Studio/browser;
- dar browser autenticado/cookies do usuário ao crawler por padrão;
- bypass de CAPTCHA/controles de acesso;
- copiar automaticamente resultados web para Memory;
- transformar conteúdo web em autoridade de ações.

## Invariantes

```text
web content = untrusted data
web content != authority

provider token != OrdaX client/MCP token

web result != Memory

search/research != permission to write/act
```

Falha de Web Research não pode impedir boot, recovery, arquivos, update ou uso local básico.

## Contratos alvo

Proposta inicial, sujeita a alinhamento com os owners atuais quando a execução for liberada:

```text
ordax.web.search/1
ordax.web.extract/1
ordax.web.map/1
ordax.web.crawl/1
ordax.web.research/1
ordax.web.source/1
ordax.web.provenance/1
```

Campos mínimos devem cobrir owner/device/Space/project, grantRef, locale, freshness, domain policy, limites, cache mode e usage.

Resultados devem preservar URL canônica, timestamps, provider, extractor/version, content hash, freshness e contexto de autorização.

## Arquitetura conceitual

```text
Aura / Studio / Files / Apps
          -> ordax.intelligence / capability consumer
                    -> ordax.web.*
                         -> Web Research Orchestrator
                         -> Action Gateway / external-egress grant
                         -> Provider Router
                              -> local cache/index
                              -> Tavily adapter
                              -> Brave adapter
                              -> Exa/Firecrawl optional
                              -> Local Web Worker
                                   -> HTTP/parser
                                   -> Playwright sandboxed fallback
                         -> Normalizer + Provenance
                         -> Budget + Receipt + Freshness
```

**Não congelar caminhos de diretório a partir deste desenho.** O primeiro PR futuro precisa mapear os owners/ports/adapters existentes na `main` daquele momento e encaixar sem criar paralelo.

## Fase 0 — auditoria e decisão arquitetural

**Estado:** DEFERRED.

Objetivo futuro: impedir duplicação.

- localizar owners correntes de `ordax.intelligence/1`, local AI, Action Gateway, grants, audit receipts, Memory e MCP;
- procurar qualquer search/extract/crawl já existente;
- verificar taxonomia real de effects/`external-egress`;
- decidir se os contratos exigem ADR em `docs/DECISIONS.md`;
- definir owner único da capability;
- registrar paths reais e dependências.

**Gate G0:** nenhum contrato/serviço paralelo; owner e dependências aprovados no source/documentação correta.

## Fase 1 — contratos + policy foundation

Entregas futuras:

- schemas/versionamento `ordax.web.search/1` e `ordax.web.extract/1` primeiro;
- `source/provenance` model;
- provider interface;
- erros normalizados;
- integração com grant `external-egress`;
- budget reservation antes da chamada;
- receipt de uso/custo;
- redaction/minimização de query remota;
- testes de autoridade: conteúdo web nunca cria grant.

**Gate G1:** testes de contrato/policy passam sem provider real; chamadas sem grant falham fechadas.

## Fase 2 — Remote MVP da capability

Providers candidatos iniciais:

1. Tavily adapter: search + extract;
2. Brave adapter: search independente/fallback;
3. provider router simples baseado em capability, autorização, health e budget.

Regras:

- secrets só em owner seguro/config server-side apropriado;
- timeout/retry/backoff/circuit breaker por provider;
- respeitar `Retry-After`;
- fallback somente se provider alternativo estiver permitido pelo grant;
- nenhuma UI conhece SDK Tavily/Brave.

**Gate G2:** `search` e `extract` funcionam via contrato OrdaX; provider pode ser trocado sem alterar consumer.

## Fase 3 — provenance, cache e custo

Implementar futuramente:

- canonical URL;
- `publishedAt`, `retrievedAt`, freshness/staleness;
- content hashes;
- cache L0/L1/L2 com policy por provider/site/user;
- usage real: requests, credits, external bytes, estimated/actual cost;
- receipt auditável sem armazenar prompt sensível por padrão;
- métricas de hit rate e custo evitado.

**Gate G3:** cada operação remota tem receipt e limite; cache não viola retention policy conhecida.

## Fase 4 — Local Web Worker

Começar pelo barato/seguro quando esta fase for liberada:

```text
URL autorizada
 -> secure HTTP fetch
 -> redirect/DNS/IP validation
 -> byte/time/content-type limits
 -> extractor
 -> normalized content
```

Depois adicionar crawl HTTP limitado/Scrapy apenas se necessário.

### SSRF hardening obrigatório

Bloquear/revalidar:

- localhost/loopback;
- RFC1918/private ranges;
- link-local;
- metadata cloud;
- `file://` e schemes indevidos;
- redirects para destinos proibidos;
- DNS rebinding;
- payloads acima de limite.

**Gate G4A:** suite SSRF negativa passa.

## Fase 5 — Playwright sandboxed fallback

Só usar browser quando HTTP/extractor não conseguir conteúdo suficiente e JS for necessário.

Worker efêmero:

- sem HOME do usuário;
- sem cookies do usuário;
- sem secrets;
- sem filesystem global;
- sem sockets locais;
- egress controlado;
- CPU/RAM/time limit;
- perfil descartável.

**Gate G4B:** página maliciosa não consegue alcançar recursos locais nem transformar conteúdo em authority.

## Fase 6 — `ordax.web.research/1`

Orquestração OrdaX futura:

1. classificar necessidade;
2. decompor queries;
3. selecionar providers dentro do grant/budget;
4. buscar em paralelo quando justificado;
5. normalizar/deduplicar/fundir/rankear;
6. extrair top sources;
7. checar freshness;
8. repetir busca se evidência insuficiente;
9. montar bounded evidence set;
10. sintetizar via Intelligence;
11. devolver resposta + provenance/citations/receipt.

Provider-native research pode acelerar subtarefas, mas não substitui esta semântica.

**Gate G5:** benchmark/evaluation mostra ganho de cobertura/freshness com custo conhecido e contexto limitado.

## Fase 7 — Aura e Studio

### Aura

Mostrar de forma simples:

```text
Pesquisado na web
N fontes
Atualizado há X
providers utilizados
```

Permitir expandir fontes/provenance sem expor detalhes desnecessários ao usuário comum.

### Studio

Casos prioritários futuros:

- ler documentação oficial;
- verificar versão/breaking changes;
- mapear docs de framework;
- comparar bibliotecas;
- investigar erros recentes antes de alterar código.

Separação:

```text
Web Research = descobre
Intelligence = raciocina/propoe
Action Gateway = autoriza
Runtime = executa
```

**Gate G6:** pesquisar nunca concede write/device-control; consumidores funcionam sem conhecer provider.

## Fase 8 — expansão opcional

Somente por métricas/necessidade:

- Exa semântico/deep;
- Firecrawl map/crawl;
- SerpAPI para verticais;
- Diffbot enterprise;
- SearXNG/dev fallback;
- Common Crawl/corpus histórico;
- índice offline próprio.

## Modelo econômico

### Princípio

**Não usar Tavily em toda pergunta.**

Ordem econômica:

```text
cache/corpus
 -> local extract para URL conhecida
 -> search remoto simples
 -> multi-provider/deep somente quando necessário
```

### Snapshot inicial Tavily

Pesquisa de 14/10/2026 indica ~1.000 créditos free/mês e PAYG ~US$0,008/crédito. Revalidar antes de qualquer compra ou implementação.

A cota free deve ser tratada como **DEV/PoC**, não entitlement de produção compartilhado.

### Guardrails de produto

Antes de rollout público existir:

- budget por operação;
- budget por owner/account/Space quando aplicável;
- teto mensal global configurável;
- degraded mode quando budget/provider indisponível;
- alertas de burn rate;
- cost receipt;
- cache hit rate;
- provider mix;
- feature/entitlement explícito para deep research se custo justificar.

Não definir agora pricing final de planos OrdaX sem telemetria real de consumo.

### Cenários de referência

No PAYG de US$0,008, 1 crédito por busca básica:

- 100 usuários x 1 busca/dia -> ~US$24/mês;
- 1.000 x 1/dia -> ~US$240/mês;
- 10.000 x 1/dia -> ~US$2.400/mês.

Research complexo pode multiplicar isso. Objetivo futuro do router/cache/local worker é reduzir chamadas pagas por resposta útil.

## Privacidade e compliance

- minimizar query antes de provider remoto;
- provider-aware retention;
- não persistir conteúdo automaticamente em Memory;
- authenticated/private web é capability separada futura;
- respeitar robots por padrão no crawler próprio;
- não implementar CAPTCHA bypass;
- classificar conteúdo externo como não confiável;
- revisar ToS/licenciamento/PII antes de retenção/redistribuição.

## Testes mínimos futuros

- contract versioning/backward compatibility;
- no-grant fail closed;
- budget exhausted fail/degraded;
- provider timeout/429/5xx;
- fallback autorizado e fallback negado;
- query redaction;
- provenance/freshness/hash;
- cache retention policy;
- SSRF matrix + redirects + DNS rebinding;
- prompt injection não cria authority;
- local extract sem network lateral;
- browser sandbox escape-negative tests;
- provider swap sem consumer change;
- bounded context para IA local;
- cost accounting reconciliado.

## Rollback/degradação

Quando implementado, se providers remotos falharem ou orçamento acabar:

1. usar cache/corpus autorizado e marcar freshness;
2. usar local extract para URLs já fornecidas quando possível;
3. informar indisponibilidade/degradação;
4. nunca liberar egress não autorizado nem esconder informação stale.

Web Research poderá ficar indisponível sem derrubar o sistema.

## Próxima ação documental

Manter este plano e o relatório coerentes com `REGISTRY.md`/`ROADMAP.md`. Não abrir execução enquanto a janela atual for o fechamento do MVP.

## Próxima ação de execução

**DEFERRED.** Depois do fechamento do MVP, revalidar `main` e os owners atuais; somente então decidir se a Fase 0 continua válida e mudar explicitamente a elegibilidade para `EXECUTION-ELIGIBLE`.

O primeiro PR de código futuro **não deve integrar Tavily diretamente**. Se a arquitetura continuar válida após revalidação, ele deve fechar owner/contratos/policy provider-neutral suficientes para um provider entrar como adapter em etapa posterior.

## Handoff para outro chat

Ao retomar `WEB-001`:

1. ler `AGENTS.md`, `docs/README.md`, `docs/CURRENT-STATE.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`;
2. ler este plano + relatório relacionado;
3. verificar `ROADMAP.md` e `REGISTRY.md`;
4. se continuar `DEFERRED FOR EXECUTION`, limitar-se a documentação/revalidação e não abrir implementação;
5. quando a janela pós-MVP abrir, auditar source atual antes de assumir paths/versões;
6. registrar qualquer decisão canônica no owner correto;
7. atualizar `REGISTRY.md` e este plano após mudança real de status.
