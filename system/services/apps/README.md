# Application services

`system/services/apps` owns application-level system services. It does not turn apps into authority owners and it does not replace the Component Manager.

## External first-party product SSOT

The first-party external component registry is **generated**, never hand-maintained:
`docs/contracts/runtime-component-package.json` →
`canonical_package_source_repository_by_component` →
`tools/app-policy/render_external_first_party_policy.py` →
`system/services/apps/external-first-party-policy.mjs`.

The 14 current IDs consist of 13 unsigned component-package candidates plus Studio's separate distribution path. The older, narrower `canonical_external_source_repository_by_component` must remain a consistent subset; it **cannot** silently override the canonical package source set. Regeneration is checked in CI. This also keeps previously installed optional apps visible as potential *installed entries* even if a subsequent signed catalog omits them, once the runtime's verified activation state is available.

A known app ID is not an installation grant. A verified signed catalog, runtime `current` state, first-party delivery policy and platform lifecycle authority remain independent fail-closed gates; no helper can manufacture those. Native broker component support and production distribution are separately gated.

## Native module-read readiness is not a Store grant

The same generator derives `EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS` from the **intersection** of the external package-source owner map and `native_loopback_broker_supported_components` in `docs/contracts/runtime-component-package.json`. Do not create a second app allowlist or widen that Native broker by editing Store code.

`store-lifecycle-request-service.mjs` rejects install/update **before privileged delegation** with `runtime-module-read-unavailable` when the Native host lacks canonical module-read support. This is necessary but never sufficient: signer/trust, probation, health, promotion, receipt and rollback remain independently guarded by their owners. **Removal stays permitted** when actual current activation is verified, even if module-read support has been withdrawn.

A signed-catalog candidate cannot invent executable-read capability. The verified Store projection must enforce the same restriction before offering user-visible install/update; that dependent UI change is tracked separately in #1398.

## Boundaries

Four concepts must stay separate:

1. **Known product/delivery registry** — `delivery-policy.mjs` may describe a first-party product even when its payload is absent locally. This registry is not a Store catalog and cannot make an app installable; a signed Store catalog may later enrich it with verified artifact/version metadata.
2. **Local app presentation catalog** — `system/apps/catalog.mjs` contains first-party app descriptors whose product source/presentation is present in the current platform composition. It is not the authoritative list of every product OrdaX may offer.
3. **Installed-state SSOT** — for independently delivered `component-slot` apps, the canonical truth is the verified `current` activation owned by `ordax-runtime-component-channel`. A staged or cached slot is not an installation, and Store never keeps a second installed-app database.
4. **Delivery projection** — `verified-store-projection.mjs` combines verified catalog metadata, the read-only current activation projection and first-party delivery policy into `ordax.app-store-catalog/2`. It persists no inventory and mints no authority.

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

After a future Native verifier authenticates the published catalog against the pinned `runtime-components` trust domain, it may expose only the read-only `ordax.verified-app-store-catalog/1` projection. The projection is pinned to the canonical `ordaxsystems/ordax-apps` source, the `ordax-runtime-components-v1` key identity, an exact source commit, a signed-catalog SHA-256 and a positive monotonic publication sequence. The schema itself does not grant verification or installation authority.

The Native catalog verifier owns signature verification **and** anti-replay persistence. It must persist the highest accepted sequence plus catalog SHA-256 before exposing `ordax.verified-app-store-catalog/1`. Lower sequences and same-sequence/different-digest catalogs fail closed. Surface code receives only the read-only verified result and has no watermark write capability.

`verified-store-projection.mjs` is deliberately derived state. It reads only the verified catalog plus the Native `current` activation metadata exposed by the canonical runtime-component activation owner. It never scans slot directories, never treats cache presence as installation, and never writes a parallel inventory. An installed external app remains removable even if a later verified catalog no longer advertises it; catalog drift, unavailable activation metadata, unknown delivery policy and bundled/component-slot conflicts fail closed as blocked presentation.

## First-party utilities in the verified Store boundary

The canonical `ordaxsystems/ordax-apps` repository has independent unsigned candidate packages for basic utility apps (Calculator, Clock, Converter, Text Viewer, Image Viewer, Calendar, Colors, Character Map, Paint, Media Player, PDF Viewer and Toolbox). The platform's `delivery-policy.mjs` now explicitly recognizes those product IDs as **on-demand / store-only**, so a **future signed and verified** Store catalog can project them without an accidental `first-party-delivery-policy-unavailable` blocker.

This extension is *not* an expansion of the initial public USB MVP application payload. `mvp-delivery-policy.mjs` continues to define the six initial on-demand products, plus Files/Internet bootstrap and structural surfaces; additional policies must remain `store-only`. New on-demand policies do **not** publish candidates, select artifacts, authorize a signer or enable the native lifecycle executor. Unknown app IDs, unsigned catalogs and unavailable Native activation metadata still fail closed. The Store UI remains disabled for the public MVP under its existing contract. No app source is copied from the platform by adding a delivery policy.

## Surface da Loja: experiência e contrato

A Loja estrutural permanece sob `system/apps/store` e `system/surface/ui/store-overview-controls.mjs`, usando estilos em `store.css` e mensagens component-scoped em `system/services/i18n/catalog/store.mjs`. Este frontend **não** é um segundo catálogo nem um gerenciador de pacotes: consome somente o snapshot validado `ordax.app-store-catalog/2`.

- **Descobrir**: apresenta apenas entradas fornecidas pelo catálogo verificado. A busca local funciona por título/ID com normalização de acentos e não altera o snapshot. A apresentação tem ordenação alfabética natural, independente da ordem do catálogo assinado.
- **Instalados**: deriva da versão instalada confirmada pelo owner canônico, nunca de arquivos em cache.
- **Atualizações**: mostra candidatos novos e estados relevantes de atualização/retensão; somente a flag `updatable` permite solicitar uma atualização.
- **Detalhes**: exibe IDs, versões e estados sem inventar publisher, ícones oficiais, capturas, preço, avaliação, categoria ou permissões que o contrato ainda não fornece. Identidade/procedência verificadas referem-se à **versão candidata**, não à instalação anterior.
- **Remoção**: exige confirmação explícita no frontend, mas ainda passa pelo mesmo pedido `authority:none` e pelo gate do lifecycle. Cancelar não emite pedido. Remover instalação não remove dados.
- **Falhas**: erro síncrono ou assíncrono do port deve liberar o estado visual pendente e mostrar falha; motivos de rejeição já validados pela plataforma podem ser mostrados como texto; aceitação não equivale a instalação concluída. Catálogo indisponível mantém operações desabilitadas.
- **IDs de pedido**: solicitações precisam de identidade gerada a partir de fonte criptográfica segura; na ausência dela, operações ficam desabilitadas. Nunca usar relógio como fallback de request ID.
- **Composição**: o layout reage à largura efetiva da janela, usa somente tokens de Surface, restaura o foco em buscas e navegação e não cria persistência paralela por aplicativo.

**Provas**: `tests/test_app_store_contract.mjs` valida filtros, catálogo e boundaries sem autoridade. O `Surface Web Candidate` executa Chromium real com catálogo indisponível na composição e uma fixture isolada, validada apenas para interação da interface, incluindo pesquisa, redimensionamento, confirmação de remoção, cancelamento e erro síncrono. A fixture nunca publica artefatos, não altera a fonte canônica e não autoriza instalação.

Categorias, badges de Intelligence, avaliações e capturas exigem evolução **versionada** do contrato de metadados/projeção verificada e respectiva proveniência. Não inferir categorias por ID nem usar fixtures como catálogo real. Habilitação produtiva de instalação independente continua sujeita aos gates Native atuais, sem antecipar `component-slot` ou terceiros.

## MVP launch delivery

`mvp-delivery-policy.mjs` owns the launch intent and `docs/contracts/mvp-app-delivery.json` records it for release tooling.

The first public Stable/MVP surface is deliberately small:

- structural: `account`, `settings`, `store`, `system`;
- bootstrap: `files`, `internet`;
- on-demand/post-launch: `activity`, `assistant`, `network`, `notes`, `projects`, `studio`.

Completion of the on-demand apps does not block the public USB launch. Physical byte-level removal of their dormant source from the current image is also not a launch requirement.

For MVP, a completed optional first-party app may be added or upgraded by the existing **signed Stable release** path. `system/supervisor` remains the update owner, uses the official signed release channel and preserves the Base/Surface known-good and rollback boundaries. Therefore a user does not need to recreate the USB just because a later Stable release adds Notes, Assistant or another first-party app.

The First Run network screen is not a second updater. Stable already performs periodic signed-channel discovery; when network becomes available, that existing owner becomes able to discover the official release. Network remains skippable and discovery failure must never block First Run completion.

## Optional platform runtime evolution without postponing the MVP

The public Stable/MVP USB launch scope is owned by `docs/contracts/mvp-app-delivery.json`. In its `optional_platform_runtimes` section, it references the **existing** `docs/contracts/application-compatibility.json` SSOT rather than copying runtime availability flags.

Windows/Wine remains a development-only optional capability; completion of a Wine source build, its APK closure, an isolated runtime package, or later optional Windows applications **does not block** the first Stable/MVP public USB release. The initial signed USB image must not include an unverified Wine payload or silently fetch one on boot/First Run. A signed future update can evolve this independently **only after** the existing runtime/component trust, sandbox, compatibility, staging, health and rollback gates are proven. A runtime failure must not become a boot failure.

This is a **scope decision, not a readiness declaration**: canonical signed-release trust, target-specific physical Stable/MVP proof, user consent for destructive operations and other actual product-launch gates in `docs/PROMOTION-GATES.md` remain binding. Missing mandatory boot/Files/Internet functionality cannot be relabeled optional. A successful Wine CI does not authorize installation/execution; the compatibility contract controls those authorities and currently denies them.

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
