# External Egress Authority

Status: **SOURCE FOUNDATION / GATEWAY INTEGRATION DISABLED**

This document owns the human-readable security boundary for outbound side effects. Machine semantics live in `system/contracts/external-egress-grant.mjs`; the session authority lives in `system/services/personal-ordax/external-egress-grants.mjs`.

## Current truth

`external-egress` already exists as an `ordax.action-request/1` effect, but the current Action Gateway deliberately denies it because `ordax.intelligence-tool-grant/1` does not authorize network egress. Creating this contract does **not** change that behavior.

The canonical owners remain:

```text
Action Gateway -> decision authority
Action Executor -> pre-side-effect revalidation + typed adapter + action receipt
External Egress Grant -> explicit bounded user authority consumed by those owners
```

There is no second broker, no Web-specific grant authority and no provider-owned permission model.

## Grant v1

`ordax.external-egress-grant/1` is intentionally narrow. It binds:

- exact Work and approval;
- exact tool id + artifact SHA-256;
- exact action id;
- owner and optional Space/project;
- exact opaque resourceRef;
- exact DNS HTTPS origins only;
- bounded request count, external bytes, cost and deadline;
- explicit user approval;
- maximum five-minute TTL.

Wildcard hosts, IP literals, custom ports, credential-bearing URLs and arbitrary extra fields are rejected. Grant objects also reject credential-shaped fields such as API keys, tokens, cookies, authorization headers and passwords.

Provider secrets remain implementation credentials, never user authority.

## Session authority

`createExternalEgressGrantAuthority()` exposes separate registry and issuer ports:

- `registry.resolve(grantId)` returns only a currently live grant;
- `issuer.issue(...)` requires an explicit approved request and prevents approval replay;
- `issuer.revoke(grantId)` removes authority immediately;
- expiry is pruned on resolve/issue;
- `dispose()` clears the session authority and both ports fail closed afterwards.

A revoked or expired grant cannot be restored from an Action Receipt.

## What is still disabled

This foundation does **not** yet:

- teach the Action Gateway to return `allow` for external egress;
- alter `ordax.intelligence-tool-grant/1`;
- enable any HTTP/provider adapter;
- allow device-control;
- expose provider credentials to apps/Surface;
- grant background/autonomous egress.

Until the Gateway integration gate is completed, remote Web Research and other outbound actions remain denied.

## Next gate

The next change must integrate the new registry into the existing Action Gateway with exact scope matching and fail-closed absence semantics. The Action Executor must continue to revalidate the Gateway immediately before resolving an adapter.

Only after those proofs are green may a consumer such as WEB-001 enter a real remote adapter.

## Network safety

Grant scope is authorization, not SSRF defense. The eventual network executor must independently validate DNS resolution, redirect targets, loopback/private/link-local/metadata destinations, rebinding, byte/time limits and content policy at execution time.

## Planning

Execution plan: `../00-PLANOS-PRIORITARIOS/plans/SEC-001-EXTERNAL-EGRESS-AUTHORITY.md`.
