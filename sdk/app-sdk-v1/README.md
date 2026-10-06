# OrdaX App SDK contract bundle v1

This directory publishes the machine-readable contract set intended for apps developed outside the platform source tree.

## Bundle 1.11.0

Version `1.11.0` is an additive public-contract release. It preserves every contract published in 1.10.0 — including Projects and the Application Action capability/proposal contracts — and adds the canonical first-party Application Action manifest:

- `ordax.application-action-manifest/1`.

The manifest binds a bounded list of first-party semantic capabilities to an exact `appId + appVersion`. It is always `authority:none` and `execution:proposal-only`; each capability remains `executionAuthorized=false` and `modelDirectExecutionAuthorized=false`.

The Application Action contracts from 1.10 remain published:

- `ordax.application-action-capability/1`;
- `ordax.application-action-capability-registry/1`;
- `ordax.application-action-proposal/1`.

These contracts let external OrdaX apps describe typed semantic actions and produce validated proposals without importing private platform source. They do not publish the App Action Broker, an executor, grants, confirmations, provider credentials or raw device authority. Capability and proposal values remain fixed to `executionAuthorized=false` and `modelDirectExecutionAuthorized=false`.

The Projects boundary from 1.9 remains unchanged:

- `ordax.project-cloud-links/1` — bounded cloud-link data/snapshot validation only;
- `ordax.project-cloud-links-reader/1` — read-only snapshot/subscription port.

The SDK splits Projects cloud-link data from the reader port. The published files expose bounded snapshot validation plus read-only getSnapshot()/subscribe(); the mutable platform owner module is not in the SDK and link()/unlink()/destroy() never cross the app boundary. Projects consumes the already-public `ordax.device-agent-capability-reader/1` for capability discovery instead of importing the broader private Device Agent contract.

Studio runtime v1/v2/v3 ports remain published side by side for pinned consumers. Runtime v3 keeps request-v2 semantics and bounded `getActionResult(request)`; results are data, never authority.

The complete bundle includes:

- `ordax.app-activation/1`
- `ordax.app-data/1`
- `ordax.app-intelligence-manifest/1`
- `prototype-ordax.component-localization/1`
- `ordax.component-manifest/1`
- `ordax.component-runtime/1`
- `ordax.device-action-receipt/1`
- `ordax.device-action-request/1`
- `ordax.device-action-request/2`
- `ordax.device-action-result/1`
- `ordax.device-agent-capabilities/1`
- `ordax.device-agent-capability-reader/1`
- `ordax.file-space/11`
- `ordax.first-party-app-delivery-policy/1`
- `ordax.intelligence/1`
- `ordax.locale-profile/1`
- `ordax.localization/2`
- `prototype-ordax.localization-pack/1`
- `prototype-ordax.localization-pack-release/1`
- `ordax.memory/1`
- `ordax.project-catalog/1`
- `ordax.project-cloud-links-reader/1`
- `ordax.studio-action-context/1`
- `ordax.studio-runtime/1`
- `ordax.studio-runtime/2`
- `ordax.studio-runtime/3`
- `ordax.surface-render-lifecycle/5`

The bundle is generated from canonical source contracts by `tools/app-sdk/export.py`. Each entry records the exact Git blob of the contract source and `bundle.sha256` pins the exported bytes.

### Application Action contracts

The App SDK publishes the semantic manifest/capability/proposal boundary only. `ordax.application-action-manifest/1` binds capabilities to one exact first-party app/version. Apps may describe typed parameters, risk class, minimum confirmation class and provider metadata, but those values never authorize execution.

The registry contract exposes only `list()`, `get()`, `listForApp()`, `propose()` and `contextItem()`. It explicitly rejects authority-bearing methods such as `execute`, `invoke`, `run`, `launch`, `grant`, `authorize` and `confirm`.

A later platform-owned App Action Broker remains a separate gate. Publishing these contracts does not make any Notes, Studio, Commerce or third-party action executable.

### Studio runtime composition

Studio consumers that need action output should target `ordax.studio-runtime/3`. The port combines:

- a read-only `ordax.device-agent-capability-reader/1`;
- the platform-owned `ordax.project-catalog/1` port;
- `getActionContext()`, returning validated `ordax.studio-action-context/1` derived by the host;
- `requestAction(request)`, accepting `ordax.device-action-request/2` and returning `ordax.device-action-receipt/1`;
- `getActionResult(request)`, returning `ordax.device-action-result/1` only after host/context and request/result correlation checks.

The result contract is UTF-8 byte-bounded and accepts only normalized JSON-safe output. Credential-like fields, structural prototype keys and non-plain objects are rejected. Output is unavailable unless its receipt is `succeeded`.

Runtime v3 explicitly rejects raw `execute`, a raw `deviceAgent`, and generic `call`. Authorization, write approval, expiry, idempotency, audit, dispatch and result ownership remain platform/host responsibilities. The intelligence manifest is declarative metadata and also grants no execution authority.

## Compatibility

Compatibility is by contract major, not by an unpinned `latest` release. Product and image versions can evolve independently while the required contract majors remain supported.

Adding contracts changes the bundle version. Existing published pins remain immutable because consumers pin an exact platform commit and bundle SHA-256 digest.

## Ownership

The SDK contains platform contracts only. App-specific implementation details do not become global APIs merely because a first-party app consumes public ports.

Private Device Agent execution, grant validation, Identity internals and service implementations are not exported. Apps receive platform ports through the runtime host/composition layer.

## Authority

The SDK has `authority: none`.

It contains no install authority, private keys, grants, provider credentials or implementation copies of Identity/Memory/Intelligence. Studio-facing contracts describe bounded data and host ports; they do not mint device authority or bypass local policy.

## Consumers

- `washingtonmsdj/ordax-apps` for official apps;
- future third-party/user app repositories;
- package/build tooling that needs a stable public compatibility target.

This bundle is contract metadata, not a package installer and not a second updater.
