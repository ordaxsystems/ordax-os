# Apps

`system/apps/` owns first-party application payloads that are currently present in the OrdaX OS source tree. Product identity and delivery policy may also describe external/on-demand apps whose payload is absent.

Apps are product modules, not Web/Mobile/Desktop forks. The Surface imports the shared catalog and renders those app contracts inside the same workspace/window model across every compatible host.

## Current baseline

Each first-party app has one explicit owner:

```text
system/apps/files/app.mjs
system/apps/projects/app.mjs
system/apps/internet/app.mjs
system/apps/settings/app.mjs
system/apps/account/app.mjs
system/apps/system/app.mjs
```

`system/contracts/first-party-app.mjs` validates the stable first-party app shape. `catalog.mjs` is deliberately thin: it composes the current owners, rejects duplicate IDs and exposes lookup/list operations to the Surface.

The initial owners are:

- Arquivos;
- Projetos;
- Internet;
- Ajustes;
- Conta;
- Sistema.

App definitions contain platform-neutral metadata, capability requirements and declarative panels. They do not import browser/native adapters and they do not decide which platform is running.

Application availability is capability-driven. A future app that requires a capability declares that capability in `requiredCapabilities`; the Surface fails closed when the host does not expose it. An app may also declare `optionalCapabilities`: these enrich the same app when a host exposes them without turning that app into a platform fork or making the optional feature a launch requirement.

## Version and update identity

Every first-party app has a component semantic version. This version is different from the OrdaX product version, from the human Entrega number and from the exact Git SHA.

Current app versions are:

```text
Arquivos  0.1.0
Projetos  0.1.0
Ajustes   0.1.0
Conta     0.1.0
Sistema   0.1.0
Internet  0.3.0
```

For first-party apps, OrdaX treats the `0.x` line as **Beta**. `1.0.0` is reserved for the first stable app release. The Beta label is an app maturity convention; it does not claim that independent production distribution is already enabled.

Updating OrdaX does not require every app version to change. Updating an app version does not create a new OrdaX product version automatically.

Current release modes are intentionally mixed while the MVP hardens:

- `bundled`: Arquivos, Ajustes, Conta and Sistema currently update with the OrdaX system delivery;
- `git-app`: Projetos and Internet own explicit app versions while the Owner/Development profile still delivers their code through the ordinary Git checkout/reconcile path;
- `component-slot`: reserved for an app that has completed the signed independent-package path with verification, pending health, promotion and rollback;
- `git-app` does not claim a production app updater, Store or app-local rollback.

`system/services/components/update-presentation.mjs` derives two update scopes for Sistema: **system** and **applications**. Base, Surface/services and the Sistema app belong to `system`; the other first-party apps belong to `applications`, even when a current app still arrives bundled with the OrdaX delivery.

**Projetos reuses the neutral project domain.** Its stable app id is `projects`; it consumes the existing `ordax.project-catalog/1` and optional cloud-link overlay instead of owning a second project database. Local projects remain usable without account or network.\n\n**Notas is an external/on-demand app identity, not a Surface/system subsystem.** Its stable app id is `notes`; during the pre-launch remove-first gate its payload is intentionally absent from `system/apps/` and will be sourced from `ordax-apps`.

**Internet follows the same app boundary.** Its stable app id is `internet`. The shared app owns browser chrome, workspace/tab organization and project context; Native/USB provide the optional browser engine capability through an isolated host, while Web fails closed instead of pretending arbitrary sites can be safely embedded.

## Boundary

Apps may depend on shared contracts and services according to `docs/contracts/module-boundaries.json`. They must not import `system/surface/` or concrete adapter implementations.

Do not create `apps-web`, `apps-mobile`, `apps-desktop`, Android/iOS copies or host-specific UI trees. Genuine host operations belong behind capability contracts and adapters.

The current registry is intentionally first-party and bounded. It is not a plugin marketplace or arbitrary code-loading framework; extension mechanics should only be introduced when there is a concrete product requirement and an explicit trust boundary.
