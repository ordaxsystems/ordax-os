# WEB-001 — OrdaX Web Research

- **Tipo:** PLAN / ROADMAP
- **Status:** ACTIVE — G0 PASS_SOURCE / G1 ADVANCED PASS_SOURCE / REMOTE EGRESS BLOCKED
- **Prioridade:** P1
- **Criado:** 2026-10-14
- **Reauditado:** 2026-10-14 contra `main@7d7dce1312b5225a0def00ab614167aeef463080`
- **Owner canônico:** `docs/WEB-RESEARCH.md`
- **Dependência de segurança:** `SEC-001-EXTERNAL-EGRESS-AUTHORITY.md`
- **Pesquisa de providers/custos:** `../reports/WEB-001-PROVIDER-UPDATE-2026-10-14.md`
- **Não boot-critical:** SIM

## Decisão

Criar uma capability sistêmica **OrdaX Web**, provider-neutral, compartilhável por Aura, Studio, Files/Search, Personal OrdaX, IA local e bordas externas. Search vendors são adapters; nenhum provider vira owner semântico do produto.

## Verdade arquitetural atual

A `main` já possui os owners que Web Research deve reutilizar:

- `ordax.intelligence/1`;
- `ordax.model-router/1`;
- `ordax.memory/1`;
- `ordax.action-gateway/1` + `ordax.action-request/1`;
- `ordax.action-executor/1` + `ordax.action-receipt/1`;
- effect `external-egress`;
- background budgets;
- Product MCP/Product Gateway nas bordas.

A auditoria posterior corrigiu uma suposição importante: **`external-egress` existe como classe de efeito, mas não está autorizado hoje**. O Action Gateway canônico o nega deliberadamente porque Intelligence tool grants não são grants de rede.

Portanto:

```text
web request != authorization
web result != authority
provider usage != action receipt
intelligence tool grant != external egress grant
```

WEB-001 não cria broker/grant registry próprio. A lacuna transversal é tratada por SEC-001 nos mesmos Action Gateway/Executor.

## Fundação source já implementada

Contratos:

```text
ordax.web.search/1
ordax.web.extract/1
ordax.web.source/1
ordax.web.provenance/1
ordax.web.usage/1
ordax.web-operation-receipt/1
ordax.web-provider/1
```

Serviços:

- provider router por capability, sem hard-code de marca;
- snapshot sem provider secrets;
- projeção `search|extract -> ordax.action-request/1`;
- actions `web.search` / `web.extract`;
- effect `external-egress`;
- `resourceRef` determinístico sobre o request Web normalizado;
- `grantRef` somente no envelope de autoridade, nunca no request Web.

Trust:

```text
trust = untrusted-external-content
```

`ordax.web.usage/1` registra provider/operação/requests/bytes/units/cost/latency/cache. `ordax.web-operation-receipt/1` liga esse usage ao `resourceRef`, status e hashes das fontes normalizadas sem carregar authority. O receipt canônico do side effect continua sendo `ordax.action-receipt/1`.

## G0 — owner audit

**PASS_SOURCE.** Nenhum novo owner paralelo necessário.

## G1 — contract/policy foundation

**ADVANCED PASS_SOURCE / REMOTE EGRESS BLOCKED.**

Já concluído:

- contracts + bounds;
- source trust/provenance;
- provider interface/router;
- deterministic action projection;
- usage canônico separado de authority receipt;
- `ordax.web-operation-receipt/1` para resultado/auditoria de domínio sem authority;
- vocabulário inicial `succeeded|partial|failed`, `errorCode` e fallback no usage;`r`n- audit metadata privacy-minimized sem query/URL/domain cru por padrão;
- fail-closed proof do Gateway atual;
- workflow Node path-scoped;
- documentação canônica atualizada.

Falta para G1 fechar:

1. integrar/validar SEC-001 E1, cuja authority foundation já existe em branch dedicada;
2. integrar/validar SEC-001 E2, cujo binding ao Action Gateway já existe em branch dedicada;
3. fechar SEC-001 E3: o Action Executor já revalida antes do adapter, mas o adapter hoje recebe apenas `request`; egress precisa de um execution-context genérico mínimo para impor destinos/budgets aprovados sem colocar authority no Web request nem criar um segundo executor;
4. minimização/redaction de query/metadata;
5. prova canônica após CI-001 remover QEMU desnecessário de contracts/services high-level.

Nenhum provider remoto entra antes disso.

## G2 — evaluation harness

Construir harness reproduzível com fixture/query set fixo. Parte de replay/offline pode avançar antes de rede; benchmark live só depois de SEC-001 E1-E3.

Shortlist inicial:

1. Parallel Turbo/Fast;
2. Brave Search;
3. Tavily;
4. Exa.

Métricas mínimas:

- relevância/recall;
- freshness/fonte oficial;
- PT-BR + documentação técnica;
- latência p50/p95;
- 429/5xx/timeout;
- bytes e requests;
- custo/query e custo por resposta útil;
- duplicação;
- retention/privacy/ToS.

Provider benchmark publicado é evidência externa, não acceptance proof OrdaX.

## G3 — primeiro provider remoto

Somente depois de G1 + SEC-001 E1-E3 + baseline live de G2.

Adapter obrigatório:

- atrás de `ordax.web-provider/1`;
- secrets fora de Surface/apps;
- deadline/retry/backoff limitados;
- usage reportado;
- sem criação de grant;
- substituível sem mudar consumer.

Marca não é decisão arquitetural.

## G4 — local HTTP extract

Implementar fetch seguro com:

- resolved-IP/redirect validation;
- loopback/private/link-local/metadata rejection;
- DNS rebinding defense;
- byte/time/content-type bounds;
- provenance/hash.

Browser/Playwright só como fallback sandboxed.

## G5 — cache/provenance/fusion

Adicionar cache condicionado a policy, canonical URL, dedupe/result fusion e health scoring sem transformar conteúdo externo em Memory automaticamente.

## G6 — `ordax.web.research/1`

Somente com search/extract estáveis: decomposição, provider selection autorizado, bounded evidence, freshness, síntese via Intelligence e citations/provenance/usage.

## G7 — Aura/Studio

Aura mostra pesquisa/fontes/freshness sem provider keys. Studio prioriza documentação oficial, versões/changelogs, breaking changes e erros recentes.

```text
Web Research = descobre evidência
Intelligence = raciocina/propoe
Action Gateway = autoriza
Action Executor = revalida/executa
```

## Segurança invariável

- conteúdo web é não confiável;
- prompt injection nunca cria authority;
- provider credential nunca é user grant;
- remote operation é `external-egress`;
- grant ausente/inválido/revogado -> fail closed antes do adapter;
- authenticated/private web é capability futura separada;
- sem CAPTCHA bypass;
- sem cookies do usuário no worker genérico;
- sem automatic Memory ingestion;
- sem kernel/boot dependency.

## Ordem de execução atual

1. mergear CI-001 para eliminar QEMU em contracts/services high-level;
2. validar/mergear as foundations SEC-001 E1/E2 já existentes;
3. fechar SEC-001 E3 com execution-context mínimo + prova de revogação imediatamente antes do adapter;
4. validar o slice WEB de projeção/usage/operation-receipt sobre essa autoridade;
5. criar G2 harness;
6. só então habilitar primeiro provider remoto.
