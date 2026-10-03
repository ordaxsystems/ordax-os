# Application services

`system/services/apps` owns application-level system services. It does not turn apps into authority owners and it does not replace the Component Manager.

## Boundaries

Three concepts must stay separate:

1. **Product catalog** — `system/apps/catalog.mjs` describes known first-party applications and their stable app/component contracts.
2. **Delivery policy** — `delivery-policy.mjs` describes whether a known first-party app is currently structural, bootstrap or on-demand, plus its discovery/removal intent.
3. **Installed inventory** — the physical truth that a payload is actually present, verified and activatable. Production inventory will require a Native owner; neither catalog nor delivery policy may claim that an app is installed.

The Surface may project an absent, catalogued app as `available`. That never makes it launchable. A recommended absent app can open an install/details experience, but execution requires a verified installed payload.

## Installation authority

Delivery metadata is always `authority:none`.

The future Store UI is presentation only. It must not become a second updater. A first-party `component-slot` app must reuse the canonical component pipeline:

`catalog -> artifact identity -> trust/provenance -> compatibility -> stage -> health/probation -> promote -> inventory/receipt`

`runtime-component-release/2` and the Component Manager remain the canonical trust/activation path when applicable.

## Uninstall and user data

Removing an application payload and removing user data are separate operations.

Uninstall must not implicitly delete documents, Projects, Space data or Memory. Shared dependencies also require a real ownership/reference policy before removal; filename/path heuristics are not sufficient.

## Stable image policy

The delivery classes are a target architecture, not an instruction to remove current MVP payload immediately.

- `structural` — no proven independent uninstall/recovery boundary yet; not Store-removable.
- `bootstrap` — intended to ship initially but become independently removable/updateable after lifecycle proof.
- `on-demand` — intended to become absent-by-default once install/reinstall/offline/rollback/uninstall proofs exist.

The current Stable/MVP payload remains unchanged until those proofs are complete.

## Localization

There is one OrdaX localization architecture, but message catalogs remain component-scoped. An independently delivered app must carry/resolve compatible localization content without forcing an unrelated Base update.
