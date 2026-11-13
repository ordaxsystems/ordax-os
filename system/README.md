# OrdaX OS system composition

`system/` contains the **OS-owned host, contracts, services, adapters and composition** used to assemble the OrdaX product across applicable modes. It is not the source owner of every component.

The visual Surface is owned by `ordaxsystems/ordax-surface`; removable first-party applications are owned by `ordaxsystems/ordax-apps`; the Windows host/packaging is owned by `ordaxsystems/ordax-desktop`. Exact external sources enter a candidate only through verified contracts/locks/artifacts.

```text
system/
  contracts/     # platform-neutral runtime interfaces/value shapes
  surface/       # OS-owned Surface host/runtime boundary; visual source external
  apps/          # catalogs, installed-state projection and structural app integration
  services/      # shared OS/domain services, including account/sync/lifecycle
  adapters/
    web/          # browser capability adapters
    mobile/       # mobile capability adapters
    desktop/      # OS-side desktop capability boundary; host app lives in ordax-desktop
    native/       # OrdaX OS capabilities shared by USB/native where genuine
  composition/   # thin target wiring + verified external component assembly
```

The machine-readable capability boundary is `docs/contracts/product-capabilities.json`. The dependency direction is owned by `docs/contracts/module-boundaries.json`. Shared product code asks for platform-neutral contracts instead of importing a concrete platform adapter.

Rules:

- `contracts/` is the innermost neutral layer and must not depend on product implementations;
- `services/` owns shared domain policy and depends inward on contracts, never outward on presentation/adapters;
- `apps/` contains OS-owned catalogs/projections/integration contracts only; removable app source lives in `ordax-apps`;
- `surface/` owns the Native host/runtime boundary but not visual source; visual code comes from the pinned `ordax-surface` revision;
- adapters implement environment-specific capabilities and cannot own copied screens, CSS, app policy or separate product logic;
- `composition/` is the only shared-system layer allowed to wire a concrete adapter to the shared Surface; it owns wiring only, never product policy or visual assets;
- never create separate Web/Mobile/Desktop/native Surface forks;
- never create independent Android and iOS product logic when a thin adapter is sufficient;
- visual presentation changes live in `ordax-surface`; OS host/runtime changes stay in `system/surface/`;
- removable app product changes live in `ordax-apps`; `system/apps/` changes only for OS catalog/projection/integration behavior;
- shared account, sync and domain behavior lives in `services/`;
- capability IDs are stable contracts: additive evolution is preferred and breaking semantic changes require a new ID or contract major;
- an unknown optional capability can be ignored, but an unknown required capability must fail closed;
- Mobile platform APIs such as notifications, biometrics, camera/media and secure storage stay behind `adapters/mobile/`;
- Desktop raw-device operations are explicit privileged Creator capabilities, not general Surface authority;
- private device state and secrets never belong in synchronized shared state;
- temporary compatibility bridges require an owner and removal condition; permanent ownerless bridges are forbidden;
- this tree plus verified external component revisions is materialized into versioned candidates/releases for the applicable modes;
- do not require identical repository HEADs: a product candidate records compatible direct dependencies and provenance instead of manual source copies or ports.
