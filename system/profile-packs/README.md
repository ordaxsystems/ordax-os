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

Profile manifests describe composition. Distribution is a separate boundary.

`system/profile-packs/distributions.mjs` is the lightweight local distribution catalog.
`ordax.profile-provisioning/1` plans what is already present, what is missing, whether
network is required and whether activation is allowed.

The Stable USB does not preseed every professional payload. Planned or unsigned artifacts
are never installable. Public download/install remains disabled until the package trust,
transactional staging, health and rollback path is proven.


## Canonical manifests and restore

The only authoring source for bundled Profile manifests is:

`system/profile-packs/*/manifest.json`

`manifests.generated.mjs` is a deterministic runtime projection generated from those JSON files.
CI runs `python tools/profile-pack-manifests/generate.py check` and rejects drift.

On Native OrdaX, persisted `current` Profile state may be restored offline only when:

- the exact Profile slug/version still exists in the canonical manifest set;
- persisted `spaceKind` still matches the manifest;
- provisioning still reports every required component satisfied;
- installed component hashes and install-receipt hashes exactly match the persisted activation.

A mismatch becomes `disabled-safe`. Profile restore is not boot-critical and never rewinds Space
documents, Memory, projects or other user-owned data.
