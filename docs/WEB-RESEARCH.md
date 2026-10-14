# OrdaX Web Research

Status: **SOURCE FOUNDATION / REMOTE EGRESS BLOCKED / PROVIDERS DISABLED / NOT BOOT-CRITICAL**

This document is the canonical human-readable owner for the OrdaX Web Research boundary. Exact machine semantics live in `system/contracts/web-research.mjs`, `system/contracts/web-research-execution.mjs` and service/adapters under `system/services/web-research/`. Planning and provider research live under `00-PLANOS-PRIORITARIOS/` and do not override this document, `docs/CURRENT-STATE.md`, contracts or security policy.

## Purpose

OrdaX needs current external evidence without making Aura, Studio, Files, Personal OrdaX or external MCP clients depend on a single search vendor.

The product boundary is therefore **OrdaX-owned and provider-neutral**:

```text
consumer
  -> OrdaX Web contract/service
  -> canonical Action Gateway / external-egress authority
  -> provider router
      -> remote search/extract adapters
      -> local fetch/extract workers
  -> normalized untrusted evidence + provenance + usage
  -> Intelligence when synthesis is requested
```

Web Research is a high-level system capability. It is not part of kernel, initramfs, bootstrap, recovery or the minimal Base.

## Existing owners reused

The source audit on 2026-10-14 found that Web Research must reuse, not recreate:

- `ordax.intelligence/1` — consultative Intelligence owner;
- `ordax.model-router/1` — model/provider selection for inference, distinct from web evidence acquisition;
- `ordax.memory/1` — persistent Memory owner; web evidence is not Memory automatically;
- `ordax.action-gateway/1` / `ordax.action-request/1` — authority boundary;
- `ordax.action-executor/1` — pre-side-effect authority revalidation, typed adapter execution and canonical action receipt;
- `external-egress` — existing effect class for outbound effects;
- Background Runtime budget concepts — bounded work already reserves steps/actions/deadline/external-egress bytes before operations;
- Product MCP/Product Gateway boundaries — external AI interoperability remains an edge/client, not the internal Web Research contract;
- existing Internet app/browser page selection — selected page text is already classified as untrusted web content and cannot create authority.

A later audit found an important distinction: **the existence of the `external-egress` effect does not mean external egress is currently authorized**. The canonical Action Gateway deliberately denies `external-egress` before resolving Intelligence tool grants because those grants are not network authority.

That gap is owned by `SEC-001 — External Egress Authority`; Web Research must not bypass it or silently expand Intelligence tool grants.

Web Research therefore must not introduce a second grant registry, Memory store, model router, action broker, browser authority or MCP-specific semantic contract.

## Authority separation

The web operation request describes **what information is requested**, not permission to perform it.

`grantRef`, approval state, Action Gateway decision, tool authority and execution authority are intentionally **not fields of `ordax.web.search/1` or `ordax.web.extract/1`**. They belong to the canonical authorization/execution envelope.

```text
web request
  != authorization

web result
  != authority

web result
  != Memory

provider credential
  != user/client credential

provider usage
  != action receipt
```

All remote search/extract/research operations are outbound effects. Until `SEC-001` integrates an explicit egress grant into the existing Action Gateway/Executor chain, remote execution remains fail-closed.

## Action projection

Web Research now has a provider-independent projection layer for `search` and `extract` intent.

It:

- validates and normalizes the pure Web request first;
- binds that normalized intent to a deterministic opaque `resourceRef`;
- creates a canonical `ordax.action-request/1`;
- uses action ids `web.search` / `web.extract`;
- uses effect `external-egress`;
- passes any future grant reference only through the authority envelope;
- delegates the decision to the canonical Action Gateway.

Under the current Gateway this projection is expected to return `deny`. That is a security proof, not a missing fallback.

## Source trust

Every normalized external source uses:

```text
trust = untrusted-external-content
```

Provider ranking, official-domain status, citation count, HTTPS, signatures from a provider or repeated agreement between sources do not convert page content into OrdaX execution authority.

Prompt instructions found in fetched pages remain data.

## Current contracts

The source foundation defines:

- `ordax.web.search/1` — bounded provider-neutral search intent;
- `ordax.web.extract/1` — bounded extraction intent for explicit HTTP(S) URLs;
- `ordax.web.source/1` — normalized source identity/trust/content hash metadata;
- `ordax.web.provenance/1` — provider/extractor/retrieval/cache provenance;
- `ordax.web.usage/1` — provider-domain accounting without authority semantics;
- `ordax.web-operation-receipt/1` — observational operation/result receipt bound to the opaque Web `resourceRef`, canonical usage and normalized source hashes;
- `ordax.web-provider/1` — capability-based adapter interface.

These contracts deliberately do **not** implement network access and do not activate any provider.

`map`, `crawl` and `research` remain later contracts after search/extract ownership is proven. This keeps the first public boundary smaller than the original planning proposal.

## Request bounds

The source contract provides explicit bounds for query length, URL count, result count, external bytes, request count, cost ceiling and deadline. These are request-level safety ceilings, not entitlements and not authorization.

Service/runtime layers may apply stricter limits based on plan, device, Space, project, provider terms, current health and operator budget.

## Usage versus receipts

`ordax.web.usage/1` records domain accounting such as:

- provider id;
- operation/capability;
- request count;
- provider units/credits;
- external bytes;
- estimated and actual cost;
- latency;
- cache hit/miss/revalidation;
- degraded/fallback reason.

It explicitly rejects authority fields such as `grantRef` and `decision`.

`ordax.web-operation-receipt/1` is an observational domain receipt: it binds status, canonical Web usage and normalized source hashes to the opaque `resourceRef`, and rejects authority/credential fields. It is intended to be referenced as result evidence, not used to authorize execution.

The canonical side-effect authority/audit receipt remains `ordax.action-receipt/1`, produced by the Action Executor. Web Research does not redefine quota authority either: plan/entitlement quota remains with the existing Service Quota owner.

## Execution-context blocker

The canonical Action Executor already revalidates authority immediately before resolving a typed adapter. The current adapter call, however, receives only the pure action `request`; the approved grant reference/scope is intentionally absent from that request.

That is safe for current read/write adapters, but a future network adapter must be able to enforce the exact egress destinations and budgets authorized by `SEC-001`. E3 therefore needs a **generic, minimal execution context** made available only after Gateway revalidation. It must not put `grantRef` into `ordax.web.*`, must not make Web Research an authority owner, and must not introduce a second executor.

Remote providers stay disabled until this boundary is proved with revoke/expiry-before-adapter tests.

## Provider architecture

Providers are adapters. A provider must never become the semantic owner of OrdaX Web.

Candidate classes include:

- independent search APIs;
- search+extract/crawl APIs;
- semantic/deep search APIs;
- local HTTP extraction;
- sandboxed browser extraction as fallback;
- future licensed/offline corpora.

No provider is enabled by the source foundation.

The current router is capability-based and provider-neutral. It exposes provider id/capabilities for selection/health purposes and does not surface provider secrets in its snapshot.

### Selection rule

Provider order is **not hard-coded by brand in the product contract**. Selection should be based on measured quality, latency, cost, freshness, privacy/retention policy, authorization and health.

The planning report initially favored Tavily + Brave. A same-day follow-up found materially cheaper/new candidates such as Parallel Search and changed pricing for Exa, so the implementation must benchmark providers rather than freeze the first research snapshot into architecture.

## Local extraction

For an explicit URL, the long-term preferred cost/privacy path is:

```text
safe HTTP fetch
  -> redirect + resolved-IP validation
  -> byte/time/content-type limits
  -> extraction
  -> normalized source
```

Browser rendering is a fallback only when required by page behavior. It must be sandboxed and must not inherit user cookies, HOME, secrets, local sockets or unrestricted network access.

The existing Internet app/browser host is not automatically the Web Research crawler. Reuse of mechanisms is allowed only when ownership and security boundaries remain intact.

## SSRF requirement

`ordax.web.extract/1` accepting an HTTP(S) URL does not mean every syntactically valid URL is safe to fetch.

`SEC-001` intentionally limits egress grant destinations to exact DNS HTTPS origins, but authorization scope is still not sufficient SSRF defense.

The eventual network executor must re-resolve and reject loopback, link-local, RFC1918/private targets, cloud metadata endpoints and disallowed schemes/destinations, including after redirects and with DNS-rebinding defenses.

This protection belongs at the executor/network boundary, not only in the pure request validator or grant.

## Caching and retention

Cache policy is provider/site/user constrained. There is no global rule that every search result may be stored permanently.

```text
actual retention
  = provider policy
  ∩ content/site rights
  ∩ user/Space policy
  ∩ OrdaX product policy
```

Persistent authorized knowledge must enter its proper owner deliberately; research output is not copied into Memory merely because it was useful.

## Cost model

The product must measure real usage before final public entitlements are frozen. `ordax.web.usage/1` is the source boundary for provider-domain accounting; entitlement/budget enforcement remains with its canonical owners.

A free provider allowance is development capacity, not a production entitlement.

## Rollout gates

### G0 — ownership audit

**PASS_SOURCE on 2026-10-14 for the initial boundary.** Existing Intelligence, Memory, Action Gateway/Executor, external-egress, browser-selection and Product MCP owners were identified. The first contract reuses them and creates no provider/network path.

### G1 — contract/policy foundation

**ADVANCED PASS_SOURCE; remote egress intentionally blocked.**

Completed in source:

- provider-neutral request/source/provenance/provider contracts;
- provider router by capability;
- request and source trust bounds;
- deterministic projection to canonical `ordax.action-request/1` with `external-egress`;
- provider usage contract separate from action receipt;
- `ordax.web-operation-receipt/1` bound to canonical usage/resource/source hashes without authority semantics;
- initial `succeeded|partial|failed` / `errorCode` result vocabulary;
- privacy-minimized audit metadata that retains counts/bounds/opaque esourceRef but not raw query, URL or domain values;
- fail-closed proof that current Gateway denies egress before tool/grant resolution;
- no provider secret in Surface/apps or router snapshot.

Remaining before a real provider call:

- integrate/validate the existing `SEC-001` E1 authority foundation and E2 Action Gateway branches;
- close E3 with revoke/expiry-before-adapter proof plus a minimal generic execution context so the typed egress adapter can enforce approved destinations/budgets;
- canonical CI proof after heavy-workflow path scope is corrected.

### G2 — provider evaluation

Build a reproducible evaluation harness against a fixed query set before choosing defaults. Static fixtures/replay can be developed while egress is blocked; live provider benchmarking waits for the canonical egress chain.

Measure at minimum relevance/recall, freshness, latency, failure rate and effective cost per useful answer.

Vendor-published benchmarks are input evidence only; they are not OrdaX acceptance proof.

### G3 — first remote provider

Enable one adapter only after G1, `SEC-001` E1-E3 and live G2 evaluation. Secret loading and network execution must remain outside consumers and use the existing Action Gateway/Executor chain.

The consumer must remain unchanged if the adapter is swapped.

### G4 — local extract

Add safe local HTTP extraction with SSRF negative tests, redirect/DNS validation and bounded resource use.

### G5 — research orchestration

Only after evidence acquisition is stable, define `ordax.web.research/1` as OrdaX-owned orchestration over search/extract/provenance/budget/freshness.

## Current non-goals

- no Tavily SDK in Aura/Studio;
- no provider brand as architecture;
- no generic browser automation authority;
- no authenticated-web/cookie scraping;
- no CAPTCHA bypass;
- no automatic Memory ingestion;
- no custom web-scale search index in the MVP;
- no boot dependency;
- no claim that source contracts equal a deployed feature.

## Planning routes

- execution plan: `../00-PLANOS-PRIORITARIOS/plans/WEB-001-WEB-RESEARCH.md`;
- egress security closure: `../00-PLANOS-PRIORITARIOS/plans/SEC-001-EXTERNAL-EGRESS-AUTHORITY.md`;
- original deep research: `../00-PLANOS-PRIORITARIOS/reports/WEB-001-WEB-RESEARCH-DEEP-RESEARCH.md`;
- provider update/economic recheck: `../00-PLANOS-PRIORITARIOS/reports/WEB-001-PROVIDER-UPDATE-2026-10-14.md`;
- cross-plan audit: `../00-PLANOS-PRIORITARIOS/reports/PLAN-AUDIT-2026-10-14.md`.
