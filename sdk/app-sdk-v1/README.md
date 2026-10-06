# OrdaX App SDK contract bundle v1

This directory publishes the machine-readable contract set intended for apps developed outside the platform source tree.

## Bundle 1.9.0

Version `1.9.0` is an additive public-contract release. It preserves every contract published in 1.8.0 and adds the project cloud-link port required by an independently delivered Projects app:

- `ordax.project-cloud-links/1`

The contract exposes bounded project-link state and operations but does not grant Device Agent execution, install authority or cloud identity authority. Projects consumes the already-public `ordax.device-agent-capability-reader/1` for capability discovery instead of importing the broader private Device Agent contract.

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
- `ordax.project-cloud-links/1`
- `ordax.studio-action-context/1`
- `ordax.studio-runtime/1`
- `ordax.studio-runtime/2`
- `ordax.studio-runtime/3`
- `ordax.surface-render-lifecycle/5`

The bundle is generated from canonical source contracts by `tools/app-sdk/export.py`. Each entry records the exact Git blob of the contract source and `bundle.sha256` pins the exported bytes.

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
