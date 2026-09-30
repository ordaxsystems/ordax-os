# OrdaX Profile Packs

Profile Packs are versioned product compositions applied to a Space.

They may describe:

- recommended/required apps;
- templates and workspace defaults;
- knowledge-source classes and refresh policy;
- Intelligence instructions;
- optional capabilities that still require normal entitlement/permission checks.

They do **not** fork OrdaX, grant privileges, bypass app signatures, store provider secrets or turn model output into an authoritative knowledge source.

The user account profile remains separate from Profile Packs.


## Distribution and provisioning

Profile manifests are the single source of truth for composition. Distribution is a separate boundary that owns only delivery policy such as bundled/on-demand mode, public-install gating, offline expectations and artifact size metadata.

`system/profile-packs/distributions.mjs` is the lightweight local delivery-policy catalog. Component composition is never duplicated there: it is derived from the validated versioned manifests.
`ordax.profile-provisioning/1` plans what is already present, what is missing, whether
network is required and whether activation is allowed.

The Stable USB does not preseed every professional payload. Planned or unsigned artifacts
are never installable. Public download/install remains disabled until the package trust,
transactional staging, health and rollback path is proven.


## Canonical manifest layout

Bundled Profile manifests are versioned source artifacts:

```text
system/profile-packs/
├── catalog.json
├── developer/
│   └── v1/manifest.json
├── legal-br/
│   └── v1/manifest.json
├── pizzaria-br/
│   └── v1/manifest.json
└── impressao-3d-br/
    └── v1/manifest.json
```

`catalog.json` maps exact `slug@version` identities to same-origin runtime URLs such as
`/system/profile-packs/developer/v1/manifest.json`. The Native host serves the OrdaX
release root (`/srv/ordax-system`) as its HTTP root, so runtime URLs preserve the
source-tree `system/` prefix.

Old unversioned `<slug>/manifest.json` paths are forbidden. Multiple versions may coexist
so update and rollback never require overwriting the previous manifest.

At boot, Native may resolve persisted Profile activation metadata against these manifests,
the Space kind, provisioning state and installed receipts. This restore is currently
**metadata-only**. Drift is `disabled-safe`; it never silently applies apps, tools,
Knowledge, policies or privileges.


## MVP business showcase

`pizzaria-br@1` and `impressao-3d-br@1` are the first bounded showcase candidates. They deliberately have
no downloadable components and no privilege expansion. Their first versions compose only
existing first-party apps and Space-scoped Memory/Intelligence policy, so proving them does
not require inflating the Stable USB or creating a separate business runtime.

The bundled manifest being provisionable does **not** by itself prove Stable/MVP user
activation. Public activation remains a separate product gate until the Native command,
Surface UX and physical smoke prove that exact safe path.
