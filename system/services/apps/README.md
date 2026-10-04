# Application services

`system/services/apps` owns application-level system services. It does not turn apps into authority owners and it does not replace the Component Manager.

## Boundaries

Three concepts must stay separate:

1. **Product catalog** — `system/apps/catalog.mjs` describes known first-party applications and their stable app/component contracts.
2. **Delivery policy** — `delivery-policy.mjs` describes whether a known first-party app is structural, bootstrap or on-demand, plus its discovery/removal intent.
3. **Installed inventory** — the physical truth that a payload is actually present, verified and activatable. Catalog and delivery policy never prove installation.

The Surface may project an absent, catalogued app as `available`. That never makes it launchable. A recommended absent app can open an install/details experience, but execution requires a verified installed payload.

## Installation authority

Delivery metadata is always `authority:none`.

The future Store UI is presentation only. It must not become a second updater. A first-party `component-slot` app reuses the canonical component pipeline:

`catalog -> artifact identity -> trust/provenance -> compatibility -> stage -> health/probation -> promote -> inventory/receipt`

`runtime-component-release/2` and the Component Manager remain the canonical trust/activation path when applicable.

## MVP minimal payload

`mvp-delivery-policy.mjs` owns the launch payload intent and `docs/contracts/mvp-app-delivery.json` records it for release tooling.

The initial Stable/MVP target is deliberately small:

- structural: `account`, `settings`, `system`;
- bootstrap: `files`, `internet`;
- on-demand after launch: `activity`, `assistant`, `network`, `notes`, `projects`, `studio`.

On-demand app completion does not block the public USB launch. This is a release-scope decision, not permission to delete current payloads before delivery safety exists.

When network first becomes available, OrdaX should check the official Base channel, ensure the current signed bootstrap-app set, and refresh the signed first-party app catalog. Failure of this online refresh must not block First Run because network remains optional.

On-demand apps are not silently installed merely because they appear in the catalog. If a mature first-party app should become part of the default online experience later, a signed release policy may promote it from `on-demand` to `bootstrap`; the canonical component pipeline then provisions it without requiring users to recreate the USB.

## Stable image transition gate

Removing on-demand payloads from the Stable image is allowed only after production-equivalent proofs exist for:

- Native installed inventory/receipt;
- first install;
- reinstall;
- offline use of an already installed app;
- failed update retaining the last-known-good version;
- rollback;
- uninstall preserving user data.

Until those proofs pass, the current image contents may remain larger than the target without changing the launch scope. We reduce blocking scope first; we shrink bytes only after the safe delivery path is real.

## Uninstall and user data

Removing an application payload and removing user data are separate operations.

Uninstall must not implicitly delete documents, Projects, Space data, App Data or Memory. Shared dependencies also require a real ownership/reference policy before removal; filename/path heuristics are not sufficient.

## Localization

There is one OrdaX localization architecture, but message catalogs remain component-scoped. An independently delivered app must carry/resolve compatible localization content without forcing an unrelated Base update.
