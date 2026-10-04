# ORDAX Studio external runtime port

Status: public contract composition for future `ordax-apps/apps/studio`; this document does not enable runtime dispatch or source cutover.

## Boundary

The external Studio app consumes the platform through `ordax.studio-runtime/1`. The app does not receive the raw `ordax.device-agent/1` port and cannot call Device Agent `execute()` directly.

```text
apps/studio
   │
   ▼
ordax.studio-runtime/1
   ├─ capabilityReader -> ordax.device-agent-capability-reader/1
   ├─ projectCatalog   -> ordax.project-catalog/1
   └─ requestAction()  -> request/receipt envelopes
            │
            ▼
platform authorization + canonical action gateway
            │
            ▼
Device Agent / platform runtime
```

## Authority

`requestAction()` accepts a validated `ordax.device-action-request/1` and returns an `ordax.device-action-receipt/1`. A request is not authority.

The host/platform remains responsible for:

- subject/account/Space/project/device binding;
- grant resolution;
- explicit write approval;
- request expiry revalidation;
- idempotency;
- audit;
- local/device policy;
- dispatch through the canonical action gateway;
- receipt production.

Provider identity such as ChatGPT or Grok may be authenticated session context, but it does not select a different local action implementation and does not mint capability authority.

## Deliberately not exported

The App SDK does not export:

- `ordax.device-agent/1`;
- raw `execute()`;
- `validateDeviceCapabilityGrant()`;
- the Studio action-authorizer service implementation;
- private Control Plane implementation;
- provider credentials;
- Identity, Memory, Intelligence or updater implementations.

## Host implementations

On OrdaX OS, the platform composition layer injects `ordax.studio-runtime/1` using platform-owned services.

On Windows or another foreign operating system, ORDAX Runtime may implement the same public port while remaining infrastructure outside the Studio app package.

Both environments must pass the same contract/conformance tests. The Studio app must not branch capability semantics by provider or operating system.
