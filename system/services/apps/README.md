# Application services

`system/services/apps` owns application-level system services. It does not turn apps into authority owners and it does not replace the Component Manager.

## Boundaries

Three concepts must stay separate:

1. **Product catalog** — `system/apps/catalog.mjs` describes known first-party applications and their stable app/component contracts.
2. **Delivery policy** — `delivery-policy.mjs` describes whether a known first-party app is structural, bootstrap or on-demand, plus its discovery/removal intent.
3. **Installed inventory** — the physical truth that an independently delivered payload is actually present, verified and activatable. Catalog and delivery policy never prove installation.

The Surface may project an absent, catalogued app as `available`. That never makes it launchable. A recommended absent app can open an install/details experience, but execution requires a verified payload supplied either by the current signed Stable release or by a future verified independent component slot.

## Installation authority

Delivery metadata is always `authority:none`.

The future Store UI is presentation only. It must not become a second updater. A first-party `component-slot` app reuses the canonical component pipeline:

`catalog -> artifact identity -> trust/provenance -> compatibility -> stage -> health/probation -> promote -> inventory/receipt`

`runtime-component-release/2` and the Component Manager remain the canonical trust/activation path when independent component delivery is used.

## MVP launch delivery

`mvp-delivery-policy.mjs` owns the launch intent and `docs/contracts/mvp-app-delivery.json` records it for release tooling.

The first public Stable/MVP surface is deliberately small:

- structural: `account`, `settings`, `system`;
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

Removing an application payload and removing user data are separate operations.

Uninstall must not implicitly delete documents, Projects, Space data, App Data or Memory. Shared dependencies also require a real ownership/reference policy before removal; filename/path heuristics are not sufficient.

## Localization

There is one OrdaX localization architecture, but message catalogs remain component-scoped. An independently delivered app must carry/resolve compatible localization content without forcing an unrelated Base update.
