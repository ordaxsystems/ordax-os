# Shared Runtime Contracts

`system/contracts/` is the innermost, platform-neutral boundary of the OrdaX product runtime.

It exists so Surface, apps, shared services and platform adapters can evolve independently without importing one another's implementation details. Concrete interfaces and value types should be added here only when a real implementation needs them; this directory is not a dumping ground for speculative abstractions.

Dependency direction:

```text
contracts
   ^
   |------ services
   |          ^
   |          |------ apps
   |          |          ^
   |          |          |------ surface
   |          |
   |----------|------ adapters
```

Adapters implement environment-specific capabilities. Shared Surface/apps/services consume platform-neutral contracts and must not import `adapters/web`, `adapters/mobile`, `adapters/desktop` or `adapters/native` implementations directly.

Rules are machine-readable in `docs/contracts/module-boundaries.json`.
Component update contracts follow the same boundary: `component-manifest.mjs` declares identity, version, failure domain and release mode; `component-state-store.mjs` owns persisted slot state; `component-manager.mjs` exposes the neutral runtime port. A semantic version does not by itself grant independent update authority — only `releaseMode: "component-slot"` does.

## Pre-MVP ecosystem contracts

The product foundation also defines narrow provider-neutral ports for the next account/ecosystem layer:

- `entitlements.mjs` — server/local-default entitlement decisions; client-claimed paid state is never authoritative;
- `spaces.mjs` — Spaces, membership and Profile Pack descriptors;
- `memory.mjs` — scoped, provenance-bearing OrdaX Memory independent of model provider;
- `model-router.mjs` — local/external inference route selection with explicit egress for cloud providers;
- `intelligence-artifact.mjs` — signed/content-addressed identity, provenance, compatibility and resource gates for replaceable engines, models, embeddings, tool runtimes and knowledge packs;
- `intelligence-tool.mjs` — typed local tool declarations and explicit owner/Space/project grants; prompt/model text cannot create authority and dangerous generic host actions remain forbidden;
- `personal-ordax.mjs` — identity-bound work, visible activity, durable work-result provenance and action-decision values for Personal OrdaX; persisted model output remains `authority=none` and never creates privilege;
- `personal-ordax-store.mjs` — bounded owner-partitioned work/activity/result persistence and runtime snapshot contract; persistence is separate from Memory and cannot redefine owner/scope/authority;
- `semantic-index.mjs` — derived/rebuildable vector index identity; embedding changes invalidate the index without migrating or redefining OrdaX Memory.
- `profile-provisioning.mjs` — lightweight Profile distribution identity and fail-closed provisioning plans; Stable USB bundles catalog metadata, not every professional payload.
- `profile-component-inventory.mjs` — content-addressed installed Profile component inventory; Native is durable/read-only to Surface and Web is explicitly session-only.
- `profile-install-receipt.mjs` — verified installation receipt binding artifact version/hash, Ed25519 verification metadata and healthy activation before inventory admission.
- `profile-content-pack.mjs` — declarative Knowledge/Skill payload structure with per-entry hashes, per-source provenance, no executable media, and no Skill authority/tools in the current foundation.
- `operational-realtime.mjs` — Space-scoped live operational events plus typed Device Action request/receipt validation; account sync, notifications and action authorization remain separate authorities.
- `mobile-companion.mjs` — explicit, expiring phone/tablet capability grants for camera, microphone, location/presence, sensors, sharing and notifications; silent sensor activation is forbidden.
- `application-compatibility.mjs` — fail-closed inspection and runtime-selection boundary for foreign desktop formats; no install/execute authority and no implicit Wine/Proton provider.
- `application-compatibility-profile.mjs` — payload/runtime-bound isolated profile identity and side-effect-free creation planning; no absolute host path or profile mutation authority.

These contracts prepare architecture only. They do not enable billing, public Store installation, cloud memory, external AI egress, Windows application execution or mutating MCP tools by themselves.
