# WEB-001 — OrdaX Web Research

- **Tipo:** PLAN / ROADMAP
- **Status:** ACTIVE — G0 PASS_SOURCE / G1 IN PROGRESS
- **Prioridade:** P1
- **Criado:** 2026-10-14
- **Reauditado:** 2026-10-14 contra `main@ef6c111fb6fadc7eba2c63fe51e2abb50e44af58`
- **Owner canônico:** `docs/WEB-RESEARCH.md`
- **Contrato source em desenvolvimento:** `system/contracts/web-research.mjs`
- **Pesquisa original:** `../reports/WEB-001-WEB-RESEARCH-DEEP-RESEARCH.md`
- **Atualização de providers/custos:** `../reports/WEB-001-PROVIDER-UPDATE-2026-10-14.md`
- **Não boot-critical:** SIM

## Decisão

Criar uma capability sistêmica **OrdaX Web**, provider-neutral, compartilhável por Aura, Studio, Files/Search, Personal OrdaX, IA local e bordas externas como Product MCP.

O OrdaX possui a semântica de busca/extract/research, trust, provenance e política. Providers comerciais/open source são adapters substituíveis.

## Descobertas da Fase 0

O relatório inicial estava correto na direção, porém a `main` já evoluiu mais do que ele assumia. Não é necessário criar uma nova fundação de autorização.

Owners existentes a reutilizar:

- `ordax.intelligence/1` — Intelligence consultativa;
- `ordax.model-router/1` — model routing, separado da aquisição de evidência web;
- `ordax.memory/1` — Memory persistente; resultado web não vira Memory automaticamente;
- `ordax.action-gateway/1` + `ordax.action-request/1` — authority boundary;
- effect existente `external-egress`;
- grants + Action Executor com revalidação para efeitos sensíveis;
- Action Policy/Review existentes;
- Background Runtime budgets, inclusive `external-egress` bytes;
- Product MCP/Product Gateway como borda de interoperabilidade, não contrato interno de Web Research;
- Internet app/browser selection já usa `untrusted-web-content`.

### Correção importante em relação ao primeiro draft

`grantRef` **não pertence a `ordax.web.search/1` nem a `ordax.web.extract/1`**.

O request Web descreve a operação informacional. Approval/grant/decision pertencem ao envelope canônico de autorização e execução.

```text
web request != authorization
web result != authority
web result != Memory
```

Essa separação evita duplicar a autoridade do Action Gateway.

## Contratos: recorte menor primeiro

Primeira fundação source:

```text
ordax.web.search/1
ordax.web.extract/1
ordax.web.source/1
ordax.web.provenance/1
ordax.web-provider/1
```

`map`, `crawl` e `ordax.web.research/1` ficam para milestones posteriores. Não ampliar o contrato antes de provar search/extract.

Os contracts iniciais carregam somente intenção/limites/cache/freshness/domínios e metadata de fonte/provenance. Campos de autoridade são rejeitados explicitamente.

Todo `ordax.web.source/1` usa:

```text
trust = untrusted-external-content
```

## Gate G0 — owner audit

**PASS_SOURCE — 2026-10-14.**

Auditoria identificou owners existentes de Intelligence, Memory, model routing, Action Gateway, grants/executor, external-egress, background budgets, browser untrusted content e Product MCP. A nova fundação não cria nenhum owner paralelo.

Documento canônico criado: `docs/WEB-RESEARCH.md`.

## Gate G1 — contract/policy foundation

**IN PROGRESS.**

Já criado na branch `feature/web-research-foundation-20261014`:

- `system/contracts/web-research.mjs`;
- `tests/test_web_research_contract.mjs`;
- request bounds para query/results/requests/bytes/cost/deadline;
- source/provenance schemas;
- provider-neutral capability interface;
- reject list explícita de campos de autoridade (`grantRef`, approval, tool/action/decision etc.);
- HTTP(S) URL syntax validation sem credenciais;
- cache/freshness/domain-policy primitives;
- `untrusted-external-content` obrigatório.

Ainda falta para fechar G1:

1. executar testes/CI da branch e corrigir regressões reais;
2. definir serviço/router que resolva capability sem hard-code de marca;
3. projetar a execução remota sobre os owners existentes de `external-egress`, grant e budget — sem copiar `grantRef` para o request Web;
4. definir usage/receipt model compatível com auditoria existente;
5. definir error vocabulary/degraded states;
6. registrar minimização/redaction de query no serviço remoto;
7. provar que Surface/apps não recebem provider credentials.

**G1 só passa quando no-grant/invalid-grant fail-closed for provado no executor real.** Contract tests sozinhos não provam autorização de rede.

## Gate G2 — evaluation harness antes do default

A pesquisa original favorecia `Tavily + Brave`. O recheck do mesmo dia encontrou alternativas e mudanças de preço suficientes para não congelar essa ordem.

Primeiro benchmark de Search, se test tiers/credenciais estiverem disponíveis:

1. Parallel Turbo/Fast;
2. Brave Search;
3. Tavily Basic Search;
4. Exa Instant/Fast.

Opcionais posteriores: Kagi, Jina Search, SearXNG; Perplexity somente via Agent API/provider-native research, não Sonar legado.

Métricas mínimas: relevância/recall, fonte oficial/freshness, PT-BR + technical docs, latência p50/p95, timeout/429/5xx, bytes, custo/query, custo por resposta útil, duplicação e retention/privacy/ToS.

Benchmark do próprio provider é evidência externa, não acceptance proof OrdaX.

## Gate G3 — primeiro provider remoto

Somente depois de G1 + baseline de G2. O adapter deve ficar atrás de `ordax.web-provider/1`, isolar secrets, respeitar deadline/retry/backoff, reportar usage, nunca criar grants e ser substituível sem alterar consumer.

A escolha poderá ser Tavily pela amplitude de `search+extract`, ou outro search provider se benchmark/custo justificar. **Marca não é decisão arquitetural.**

## Gate G4 — provenance/cache/cost

Implementar canonical URL, timestamps/freshness, content hash, usage/cost/latency, cache condicionado a policy e audit receipt sanitizado. Não persistir conteúdo apenas porque foi encontrado na web.

## Gate G5 — Local Web Worker

Começar por HTTP seguro, não browser. Revalidar destino/redirects, limitar bytes/time/content-type e cobrir SSRF (loopback/private/link-local/metadata/DNS rebinding). Playwright apenas como fallback JS sandboxed.

## Gate G6 — `ordax.web.research/1`

Somente depois de search/extract estáveis: decomposição, provider selection autorizado, search, merge/dedupe/rank, extract, freshness checks, bounded evidence, síntese via Intelligence, citations/provenance/usage receipt.

Provider-native agents podem executar subtarefas, nunca possuir a semântica canônica.

## Gate G7 — Aura/Studio

Aura mostra pesquisa/fontes/freshness sem provider keys. Studio prioriza docs oficiais, versions/changelogs, breaking changes e erros recentes.

```text
Web Research = descobre evidência
Intelligence = raciocina/propoe
Action Gateway = autoriza efeito
Runtime = executa
```

## Modelo econômico

**Nunca assumir “uma pergunta = uma chamada Tavily”.** Ordem preferida: cache/corpus autorizado -> local extract -> remote search simples -> multi-provider/deep quando necessário.

Todo rollout público precisa de budgets, teto global, degraded mode, burn-rate observável e entitlements coerentes com custo real. Preços são snapshot; ver `../reports/WEB-001-PROVIDER-UPDATE-2026-10-14.md`.

## Segurança invariável

- conteúdo web é dado não confiável;
- prompt injection nunca cria authority;
- remote operation é `external-egress`;
- no grant válido -> fail closed no executor;
- authenticated/private web é capability futura separada;
- sem CAPTCHA bypass;
- sem cookies do usuário no worker genérico;
- sem automatic Memory ingestion;
- sem kernel/boot dependency.

## Próxima ação exata

Fechar G1 na branch atual, abrir PR e deixar CI validar a fundação. **Não integrar provider real no mesmo PR.**

O PR seguinte introduz evaluation harness e/ou primeiro adapter somente depois que a boundary provider-neutral estiver verde e revisada.
