# Application services

`system/services/apps` owns application-level system services. It does not turn apps into authority owners and it does not replace the Component Manager.

## Boundaries

Four concepts must stay separate:

1. **Known product/delivery registry** — `delivery-policy.mjs` may describe a first-party product even when its payload is absent locally. This registry is not a Store catalog and cannot make an app installable; a signed Store catalog may later enrich it with verified artifact/version metadata.
2. **Local app presentation catalog** — `system/apps/catalog.mjs` contains first-party app descriptors whose product source/presentation is present in the current platform composition. It is not the authoritative list of every product OrdaX may offer.
3. **Installed component catalog/inventory** — the component/package truth used for verified activation. A product being known or catalogued never proves that its payload is installed.
4. **Delivery projection** — combines policy with an installation/catalog observation to produce `available`, `installed`, `staged`, `blocked` and launch/install presentation without minting authority.

The Surface may project an absent, catalogued app as `available`. That never makes it launchable. A recommended absent app can open an install/details experience, but execution requires a verified payload supplied either by the current signed Stable release or by a future verified independent component slot.

## Installation authority

Delivery metadata is always `authority:none`.

The structural Store UI is presentation/request only. It fails closed when no verified catalog port is supplied and has no mutation authority. One authority-free lifecycle request contract covers `install`, `update` and `remove`; the launcher may request `install` only. The request cannot select an artifact/version, grant permissions, replace the trust anchor, bypass verification or delete user data.

`store-lifecycle-request-service.mjs` is the guarded backend facade for that request boundary. It revalidates the current verified catalog projection at request time, serializes lifecycle mutations per app, preserves bounded request-id idempotency, rejects stale/unavailable operations before privileged delegation and validates the returned receipt against the exact request identity. Its public port remains `authority:none`; the injected lifecycle delegate is platform-private and must carry `platform-component-lifecycle` authority.

The Store must never become a second updater. A first-party `component-slot` app reuses the canonical component pipeline:

`catalog -> artifact identity -> trust/provenance -> compatibility -> stage -> health/probation -> promote -> inventory/receipt`

`runtime-component-release/2` and the Component Manager remain the canonical trust/activation path when independent component delivery is used. Rollback is platform-owned recovery, not Store authority. The Store lifecycle executor stays unmounted while canonical component trust/publication/activation gates remain closed.

### Verified Store catalog boundary

The `ordax-apps.store-catalog-candidate/1` artifact produced by `ordax-apps` is publication input, not trusted runtime state. The Surface must never consume that unsigned candidate directly.

After a future Native verifier authenticates the published catalog against the pinned `runtime-components` trust domain, it may expose only the read-only `ordax.verified-app-store-catalog/1` projection. The projection is pinned to the canonical `washingtonmsdj/ordax-apps` source, the `ordax-runtime-components-v1` key identity, an exact source commit, a signed-catalog SHA-256 and a positive monotonic publication sequence. The schema itself does not grant verification or installation authority.

`verified-store-catalog-replay-guard.mjs` persists the highest accepted sequence plus its catalog SHA-256 before exposing a newer catalog. A lower sequence is rejected as rollback/replay; the same sequence with a different digest is rejected as equivocation; failure to persist the watermark fails closed. This guard does not perform cryptography and cannot replace the Native signature verifier.

## MVP launch delivery

`mvp-delivery-policy.mjs` owns the launch intent and `docs/contracts/mvp-app-delivery.json` records it for release tooling.

The first public Stable/MVP surface is deliberately small:

- structural: `account`, `settings`, `store`, `system`;
- bootstrap: `files`, `internet`;
- on-demand/post-launch: `activity`, `assistant`, `network`, `notes`, `projects`, `studio`.

Completion of the on-demand apps does not block the public USB launch. Physical byte-level removal of their dormant source from the current image is also not a launch requirement.

For MVP, a completed optional first-party app may be added or upgraded by the existing **signed Stable release** path. `system/supervisor` remains the update owner, uses the official signed release channel and preserves the Base/Surface known-good and rollback boundaries. Therefore a user does not need to recreate the USB just because a later Stable release adds Notes, Assistant or another first-party app.

The First Run network screen is not a second updater. Stable already performs periodic signed-channel discovery; when network becomes available, that existing owner becomes able to discover the official release. Network remains skippable and discovery failure must never block First Run completion.

## Independent app delivery after launch

Per-app `component-slot` delivery is an optimization and modularity milestone, not a blocker for the first public release. Before dormant payloads are removed from the Base specifically in favor of independent app installation, production-equivalent proofs must exist for:

- Native installed inventory/receipt;
- first install;
- reinstall;
- offline use of an already installed app;
- failed update retaining the last-known-good version;
- rollback;
- uninstall preserving user data.

This keeps the first launch small in **product scope** without rushing the package manager. Later releases can shrink bytes once the independent delivery path is proven.

On-demand apps are never silently installed merely because they appear in the catalog. If a mature first-party app should become part of the default experience, a signed release policy may promote it from `on-demand` to `bootstrap`.

## Uninstall and user data

Removing an application installation and removing user data are separate operations. For a `component-slot` app, the authoritative installed state is the verified activation reference, not the mere presence of an immutable slot in the local cache. Uninstall clears that activation state through the canonical runtime-component lifecycle; cache garbage collection is separate.

Uninstall must not implicitly delete documents, Projects, Space data, App Data or Memory. Shared dependencies also require a real ownership/reference policy before removal; filename/path heuristics are not sufficient.

## Localization

There is one OrdaX localization architecture, but message catalogs remain component-scoped. An independently delivered app must carry/resolve compatible localization content without forcing an unrelated Base update.
