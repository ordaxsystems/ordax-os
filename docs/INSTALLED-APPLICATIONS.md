# Installed Applications

Status: **FOUNDATION / PRESENTATION CONTRACT ONLY**

OrdaX should make supported user-installed applications feel like applications, not like compatibility-runtime administration.

This document defines the user-facing invariant while keeping trust, installation, execution and compatibility boundaries explicit.

## Product invariant

A successfully installed foreign application appears in the ordinary OrdaX application surfaces alongside other applications:

- launcher/application grid;
- search;
- dock/pinning when supported;
- normal window/workspace behavior;
- application details;
- uninstall/update management.

The normal user flow must not require knowledge of Wine prefixes, Proton bottles, environment variables, drive mappings or shell commands.

Compatibility is infrastructure, not a separate desktop mode.

## Trust boundary

Unified presentation does **not** mean unified trust.

The first-party catalog remains the closed source of OrdaX-owned applications. User-installed applications live in a separate installed-application catalog and are projected into the same Surface presentation layer.

Therefore:

```text
same launcher surface != same trust class
same window model      != native OrdaX code
runtime available      != install authorization
installed record       != execution authority
```

A Windows payload never becomes first-party or native-trusted merely because OrdaX can run it.

## Target Windows installation flow

The intended flow for a local Windows installer is:

```text
user opens setup.exe / setup.msi
  -> Files asks Compatibility Manager to inspect it
  -> OrdaX resolves a verified runtime and isolated profile plan
  -> OrdaX shows publisher/provenance, storage impact and requested grants
  -> user explicitly authorizes installation
  -> isolated compatibility profile is materialized
  -> verified compatibility runtime performs the installer transaction
  -> resulting launchable entrypoints are validated and assigned opaque OrdaX ids
  -> committed installed-application record is created
  -> app appears in the normal launcher/search/application management surfaces
```

A portable Windows executable may later use a shorter `Add application` flow, but it must still receive an isolated profile and an OrdaX-owned installed identity before ordinary launcher integration.

Opening an arbitrary `.exe` must never silently bypass inspection, permission review or profile isolation.

## What the user sees

Ordinary use should look native to the OrdaX shell:

- one app icon;
- ordinary application name;
- ordinary launcher/search entry;
- normal open/close/focus behavior;
- normal recent/pinning behavior when implemented;
- one application-management entry for uninstall/update/repair/reset.

The compatibility implementation should be disclosed in application details, not forced into the primary launcher UI. A details surface can say, for example, `Aplicativo para Windows` and explain that OrdaX Compatibility provides the runtime.

Do not expose `Wine`, a prefix path, `WINEPREFIX`, registry tools or raw runtime commands as normal user-facing concepts. Advanced diagnostics may expose implementation details only in an explicitly technical surface.

## Installed-application identity

`ordax.installed-application/1` is deliberately separate from the first-party app contract.

A committed record binds:

- stable OrdaX application id;
- display metadata;
- foreign platform/source;
- original payload SHA-256;
- optional publisher display identity;
- compatibility profile id;
- compatibility runtime id;
- opaque entrypoint id;
- lifecycle/update policy;
- explicit `nativeTrust=false` and `runtimeGrantsTrust=false`.

It does not contain:

- absolute host paths;
- raw executable paths as launcher authority;
- shell commands;
- Wine prefix paths;
- environment-variable strings;
- runtime CLI arguments.

The installed catalog created in this foundation is read-only. It provides no register/install/launch mutation authority yet.

## Lifecycle target

The final lifecycle should be transactional and OrdaX-owned:

```text
inspect
-> install plan
-> permission review
-> stage/profile materialization
-> install
-> health/entrypoint discovery
-> commit installed record
-> launch
-> update / repair / reset
-> uninstall
```

A failed installation must not create a launcher entry. A launcher entry must represent committed application state, not merely the presence of an `.exe` somewhere inside a profile.

Uninstall must remove the application transactionally without giving the Windows uninstaller authority over OrdaX system paths. User data preservation/removal must be an explicit policy choice.

## Updates

Two update families are expected:

- `ordax-managed`: Store/package lifecycle owns the delivered application payload;
- `vendor-managed`: an application's own updater may run inside the same sandbox/profile subject to network/filesystem grants.

Manual/unknown mode remains possible for applications without a proven safe updater.

Compatibility-runtime updates are separate from application updates. Upgrading the shared runtime must not silently rewrite application identity or permissions and must support compatibility health/rollback before promotion.

## Failure UX

Compatibility failures should be translated into OrdaX product language rather than leaking runtime internals by default.

Examples:

- `Este aplicativo ainda não é compatível com esta versão do OrdaX.`
- `Este aplicativo precisa de uma permissão que não foi concedida.`
- `A instalação não foi concluída; nenhuma alteração foi aplicada.`

Technical diagnostics may retain exact Wine/runtime output for debugging, but ordinary UI should not ask a user to edit prefixes, DLL overrides or registry keys.

## Current implementation boundary

Implemented now:

- separate validated installed-application identity contract;
- read-only installed application catalog;
- neutral presentation projection for future Surface composition;
- Windows origin and compatibility binding retained without exposing Wine internals;
- foreign/native trust separation enforced in code and tests.

Not implemented by this foundation:

- installation authority;
- catalog persistence;
- launcher composition;
- profile materialization;
- entrypoint discovery;
- Wine/runtime execution;
- `.exe`/`.msi` execution;
- uninstall/update/repair/reset executors.

Those capabilities remain gated by the Windows compatibility runtime chain and must be added separately.
