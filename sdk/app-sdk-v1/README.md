# OrdaX App SDK contract bundle v1

This directory publishes the machine-readable contract set intended for apps developed outside the platform source tree.

## Bundle 1.2.0

Version `1.2.0` keeps the 1.1 contracts and adds the narrowed runtime-facing contracts required to externalize ORDAX Studio without exporting raw Device Agent authority:

- `ordax.app-activation/1`
- `ordax.component-manifest/1`
- `ordax.component-runtime/1`
- `ordax.device-action-receipt/1`
- `ordax.device-action-request/1`
- `ordax.device-agent-capabilities/1`
- `ordax.device-agent-capability-reader/1`
- `ordax.file-space/11`
- `ordax.first-party-app-delivery-policy/1`
- `ordax.intelligence/1`
- `ordax.localization/1`
- `prototype-ordax.localization-pack/1`
- `ordax.memory/1`
- `ordax.project-catalog/1`
- `ordax.studio-runtime/1`
- `ordax.surface-render-lifecycle/4`

The bundle is generated from canonical source contracts by `tools/app-sdk/export.py`. Each entry records the exact Git blob of the contract source and `bundle.sha256` pins the exported bundle bytes.

### Studio runtime composition

External `apps/studio` code receives `ordax.studio-runtime/1` from the host composition layer. That port combines:

- a read-only `ordax.device-agent-capability-reader/1`;
- the platform-owned `ordax.project-catalog/1` port;
- `requestAction(request)`, which accepts a validated `ordax.device-action-request/1` and returns an `ordax.device-action-receipt/1`.

The Studio port explicitly rejects raw `execute` and a raw `deviceAgent` object. An action request is data, not authority: authorization, write approval, expiry, idempotency, audit and dispatch remain platform-owned and continue through the canonical action gateway.

The SDK deliberately does **not** export `ordax.device-agent/1`, the grant validator, the Studio action authorizer implementation, or the full operational realtime service contract.

## Compatibility

Compatibility is by contract major, not by an unpinned `latest` OrdaX release. Product versions and ISO versions can evolve independently as long as the required contract majors remain supported.

Adding contracts is a bundle-version change. Existing published bundle pins remain immutable because consumers pin an exact platform commit + bundle digest.

## Ownership

The SDK contains **platform contracts only**. App-specific contracts do not become global platform APIs just because an app currently lives in the platform repository.

For the Notes pilot, `notes-store` and `notes-file-importer` remain Notes-owned and are expected to move with the app at source-of-truth cutover.

Private service implementations such as `system/services/intelligence/client-actions.mjs` are not exported. Apps receive platform ports through the runtime host/composition and consume their public contracts.

## Authority

The SDK has `authority: none`.

It does not contain install authority, private keys, grants, provider credentials or implementation copies of Identity/Memory/Intelligence. Studio-facing device contracts describe bounded data and host ports; they do not mint device authority or bypass local policy.

## Consumers

- `washingtonmsdj/ordax-apps` for official apps;
- future third-party/user app repositories;
- package/build tooling that needs a stable public compatibility target.

This bundle is contract metadata, not a package installer and not a second updater.
