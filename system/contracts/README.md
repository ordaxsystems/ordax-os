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
- `semantic-index.mjs` — derived/rebuildable vector index identity; embedding changes invalidate the index without migrating or redefining OrdaX Memory.
- `profile-provisioning.mjs` — lightweight Profile distribution identity and fail-closed provisioning plans; Stable USB bundles catalog metadata, not every professional payload.

These contracts prepare architecture only. They do not enable billing, public Store installation, cloud memory, external AI egress or mutating MCP tools by themselves.
