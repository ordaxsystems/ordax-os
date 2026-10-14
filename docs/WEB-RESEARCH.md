# OrdaX Web Research

Status: **SOURCE FOUNDATION / PROVIDERS DISABLED / NOT BOOT-CRITICAL**

This document is the canonical human-readable owner for the OrdaX Web Research boundary. Exact machine semantics live in `system/contracts/web-research.mjs` and later service/adapters. Planning and provider research live under `00-PLANOS-PRIORITARIOS/` and do not override this document, `docs/CURRENT-STATE.md`, contracts or security policy.

## Purpose

OrdaX needs current external evidence without making Aura, Studio, Files, Personal OrdaX or external MCP clients depend on a single search vendor.

The product boundary is therefore **OrdaX-owned and provider-neutral**:

```text
consumer
  -> OrdaX Web contract/service
  -> canonical authorization/policy boundary
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
- `external-egress` — existing effect class for outbound effects;
- existing grant/action executor semantics — sensitive execution requires an exact grant and is revalidated before execution;
- Background Runtime budget concepts — bounded work already reserves steps/actions/deadline/external-egress bytes before operations;
- Product MCP/Product Gateway boundaries — external AI interoperability remains an edge/client, not the internal Web Research contract;
- existing Internet app/browser page selection — selected page text is already classified as `untrusted-web-content` and cannot create authority.

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
```

All remote search/extract/research operations are outbound effects and must ultimately be authorized under the existing `external-egress` model before network execution.

## Source trust

Every normalized external source uses:

```text
trust = untrusted-external-content
```

Provider ranking, official-domain status, citation count, HTTPS, signatures from a provider or repeated agreement between sources do not convert page content into OrdaX execution authority.

Prompt instructions found in fetched pages remain data.

## Initial contracts

The first source slice defines:

- `ordax.web.search/1` — bounded provider-neutral search intent;
- `ordax.web.extract/1` — bounded extraction intent for explicit HTTP(S) URLs;
- `ordax.web.source/1` — normalized source identity/trust/content hash metadata;
- `ordax.web.provenance/1` — provider/extractor/retrieval/cache provenance;
- `ordax.web-provider/1` — capability-based adapter interface.

These contracts deliberately do **not** implement network access and do not activate any provider.

`map`, `crawl` and `research` remain later contracts after search/extract ownership is proven. This keeps the first public boundary smaller than the original planning proposal.

## Request bounds

The source contract provides explicit bounds for query length, URL count, result count, external bytes, request count, cost ceiling and deadline. These are request-level safety ceilings, not entitlements and not authorization.

Service/runtime layers may apply stricter limits based on plan, device, Space, project, provider terms, current health and operator budget.

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

The eventual network executor must re-resolve and reject loopback, link-local, RFC1918/private targets, cloud metadata endpoints and disallowed schemes/destinations, including after redirects and with DNS-rebinding defenses.

This protection belongs at the executor/network boundary, not only in the pure request validator.

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

The product must measure real usage before final public entitlements are frozen.

Required accounting for remote operations includes, where available:

- provider id;
- operation/capability;
- request count;
- provider units/credits;
- external bytes;
- estimated and actual cost;
- latency;
- cache hit/miss/revalidation;
- degraded/fallback reason.

A free provider allowance is development capacity, not a production entitlement.

## Rollout gates

### G0 — ownership audit

**PASS_SOURCE on 2026-10-14 for the initial boundary.** Existing Intelligence, Memory, Action Gateway, grants/execution, external-egress, browser-selection and Product MCP owners were identified. The first contract reuses them and creates no provider/network path.

### G1 — contract/policy foundation

In progress. Required before any real provider call:

- contract tests;
- provider-neutral adapter interface;
- explicit projection to existing authorization/budget owners;
- receipt/usage model aligned with existing audit semantics;
- no-grant fail-closed proof at the eventual executor;
- no provider secret in Surface/apps.

### G2 — provider evaluation

Run a reproducible evaluation harness against a fixed query set before choosing defaults. Measure at minimum relevance/recall, freshness, latency, failure rate and effective cost per useful answer.

Vendor-published benchmarks are input evidence only; they are not OrdaX acceptance proof.

### G3 — first remote provider

Enable one adapter only after G1/G2 and explicit secret/egress configuration. The consumer must remain unchanged if the adapter is swapped.

### G4 — local extract

Add safe local HTTP extraction with SSRF negative tests and bounded resource use.

### G5 — research orchestration

Only after evidence acquisition is stable, define `ordax.web.research/1` as OrdaX-owned orchestration over search/extract/provenance/budget/freshness.

## Current non-goals

- no Tavily SDK in Aura/Studio;
- no generic browser automation authority;
- no authenticated-web/cookie scraping;
- no CAPTCHA bypass;
- no automatic Memory ingestion;
- no custom web-scale search index in the MVP;
- no boot dependency;
- no claim that source contracts equal a deployed feature.

## Planning routes

- execution plan: `../00-PLANOS-PRIORITARIOS/plans/WEB-001-WEB-RESEARCH.md`;
- original deep research: `../00-PLANOS-PRIORITARIOS/reports/WEB-001-WEB-RESEARCH-DEEP-RESEARCH.md`;
- provider update/economic recheck: `../00-PLANOS-PRIORITARIOS/reports/WEB-001-PROVIDER-UPDATE-2026-10-14.md`;
- cross-plan audit: `../00-PLANOS-PRIORITARIOS/reports/PLAN-AUDIT-2026-10-14.md`.
