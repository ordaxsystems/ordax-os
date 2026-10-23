# Application services

`system/services/apps` owns application-level system services. It does not turn apps into authority owners and it does not replace the Component Manager.

A [política de portfólio e pré-instalação](../../../docs/APP-PORTFOLIO-AND-PREINSTALL.md) distingue intenção de primeiro provisionamento de instalação verificada. A seleção declarativa vive em `first-run-selection.mjs`. O owner nativo de ativação persiste a remoção explícita no próprio estado canônico (`user_removed`), sem banco paralelo; o plano da primeira instalação ainda não lê esse marcador automaticamente e não executa instalações.

## External first-party product SSOT

The first-party external component registry is **generated**, never hand-maintained:
`docs/contracts/runtime-component-package.json` →
`canonical_package_source_repository_by_component` →
`tools/app-policy/render_external_first_party_policy.py` →
`system/services/apps/external-first-party-policy.mjs`.

The canonical owner map is the full source-provenance registry for first-party package identities. It is not an install catalog: entries can describe apps whose package, Native module-read, probation, signature, activation or rollback gates are still closed. While an app remains bundled in the OS, `native_external_current_slot_blocked_by_bundled_owner_components` keeps the platform as the only source accepted by the Native signer; the generated Go source gate enforces this until Gate A removes the bundled implementation. The Native module-read set is independently derived from the intersection with `native_loopback_broker_supported_components`; health, probation and activation are narrower gates again. `canonical_external_source_repository_by_component` is a separate, narrower allowlist used by the unsigned-candidate verifier; it must agree with the owner map but does not broaden Native reads or override canonical ownership. Regeneration is checked in CI.

A known app ID is not an installation grant. A verified signed catalog, runtime `current` state, first-party delivery policy and platform lifecycle authority remain independent fail-closed gates; no helper can manufacture those. Native broker component support and production distribution are separately gated.

## Native module-read readiness is not a Store grant

The same generator derives `EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS` from the **intersection** of the external package-source owner map and `native_loopback_broker_supported_components` in `docs/contracts/runtime-component-package.json`. Do not create a second app allowlist or widen that Native broker by editing Store code.

`store-lifecycle-request-service.mjs` rejects install/update **before privileged delegation** with `runtime-module-read-unavailable` when the Native host lacks canonical module-read support. This is necessary but never sufficient: signer/trust, probation, health, promotion, receipt and rollback remain independently guarded by their owners. **Removal stays permitted** when actual current activation is verified, even if module-read support has been withdrawn.

A signed-catalog candidate cannot invent executable-read capability. The verified Store projection must enforce the same restriction before offering user-visible install/update; that dependent UI change is tracked separately in #1398.

### Probation canônico entre Native e Surface

O conjunto de componentes que pode executar o probe `import-contract` pertence exclusivamente a `docs/contracts/runtime-component-package.json` → `runtime_health_bridge_supported_components`. O gerador `tools/app-policy/render_native_store_metadata_policy.py` emite tanto `NATIVE_PROBATION_COMPONENT_IDS` (Python Native) quanto `NATIVE_COMPONENT_PROBATION_IDS` e `NATIVE_COMPONENT_PROBE_MODE` (JavaScript Surface). Não manter allowlists manuscritas nos bridges. O gerador valida a relação `probation ⊆ health mutation ⊆ signed module read`, identidade/duplicatas e probe mode. Os artefatos gerados são verificados no CI e não são fontes independentes.

**Escopo atual de probation é Files/Notas.** Internet não tem leitura de módulo Native habilitada; a Calculadora, o Studio e a **Aura** (ID técnico `assistant`) têm leitura verificada do slot, mas **não** probation. A Aura consome `ordax.intelligence/1`, sem duplicar o motor. O nome de produto vem do `app.json#title` e, no catálogo publicado, do título verificado assinado; `assistant` permanece o único ID estável de instalação. Instalação continua bloqueada sem o lifecycle de ativação/publicação. Ampliar probation exige testes do import, receipt com nonce, revisão exata, registro de saúde e não promoção, seguidos de pacote assinado e prova no host. Gerar uma lista não instala, promove nem habilita distribuição.

### Aura: montagem isolada e contexto de conversa

O provider do host Native agora fornece as portas públicas preexistentes para
montagem **apenas** de `assistant` quando seu slot corrente está instalado e
verificado. O iframe usa snapshots Identity/Space e chamadas consultivas
`Intelligence.respond` pelo broker fechado, sem rede arbitrária, credenciais,
Memory, ferramentas, File Space ou mutação do Space. O host valida a identidade
do slot antes/depois do pedido e invalida resultados após trocas de conta/Space;
o cancelamento interrompe a inferência que suportar `AbortSignal`.

**Limite factual:** os testes de source/isolamento não provam que exista slot
assinado da Aura no USB. O gate de trust canônico, probation do runtime real,
publicação e ativação continua fechado. Não marcar Gate B ou preinstall como
aprovado antes da prova física e da promoção/rollback.

### Gate Aura: apenas leitura assinada

O pacote canônico `ordax-apps/apps/assistant` é exportado para o namespace
`system/apps/assistant/` pelo builder comum de componentes. O broker Native
pode solicitar apenas bytes da versão/commit/revisão do slot exato, após a
verificação de assinatura e integridade pelo helper canônico; não contém nem
interpreta o nome público "Aura" como identidade de segurança. Isso **não**
distribui, instala, inicia, promove ou autoriza ferramentas da IA.

A prova de saúde, o import em sandbox sem poderes, o atualizador e o
rollback ainda precisam ser validados antes de habilitar a ativação. Até lá,
Store e First Run continuam bloqueando instalar quando faltar probation
compatível, inclusive na presença de catálogo verificado. O modelo local,
Memory e OrdaX Intelligence permanecem system-owned.

## Native installed Surface runtime: verified before display

The execution source is the Native broker's **verified `current` slot**, not the
Store candidate, a manifest alone or a local package directory.

The implementation has two distinct checks:

- `verified-external-app-catalog.mjs` discovers bounded, immutable package
  metadata, owner, version, presentation and optional file associations through
  the verified package source. Its result is **descriptive**, not executable.
- `system/composition/native/verified-installed-apps.mjs` delegates execution
  to the existing `current-slot-loader.mjs`. Native's trusted component
  bootstrap supplies a bound `ordax.app-data/1` port for exactly that app;
  `expectedCurrent` must match the discovery revision before code import and
  is checked again before/after mount. `isolated-component-executor.mjs` runs
  the signed runtime in an opaque-origin sandbox whose CSP is scoped to that
  exact package path. Its private `MessagePort` brokers only the app's own App
  Data and the minimal Surface lifecycle; it denies File Space and arbitrary
  network access. The app may not provide its own App Data.

The Surface starts with bundled apps and updates its single runtime catalog
**only with mounted IDs**. A failed, absent, removed or unbound app must not
appear as launchable. Catalog reconciliation removes obsolete external windows
from persisted workspace state. The external app receives a restricted
`SurfaceRenderLifecycle` projection; it cannot update the host catalog or
receive unrestricted File Space, Intelligence or other device grants through
  presentation metadata. The **single Aura component** (`assistant`) is a
  narrowly scoped exception for *public consultative ports*: only its exact
  signed current slot may receive Identity/Space read-only snapshots and
  `ordax.intelligence/1` through the existing isolated MessagePort broker.
  The dedicated host-owned provider is `system/composition/native/intelligence-client-trusted-context.mjs`;
  it is not a second Intelligence service, model router or permission authority.
  The broker revalidates slot identity on every request, bounds inference to one
  pending turn, aborts on cancellation/revocation/Identity/Space changes and
  drops late results from outdated scopes. Space selection changes and
  privileged grants are **not** exposed to Aura. The exact-slot check is bounded and abortable; if
  Native verification times out, the operation fails closed and teardown can
  finish draining without waiting indefinitely on the verifier.

The isolated executor's teardown revokes the broker, drains in-flight calls,
requests runtime cleanup in the child, and removes the iframe. Native pending
probation uses a separate opaque-origin import-contract probe: it revalidates
the exact unknown-health pending revision before and after import, exposes no
host port, and never mounts or returns a launchable runtime. Its `healthy`
receipt means only that the signed candidate satisfied the import/export
contract. A mount-health probe is still absent; any `mount-contract` mode fails
closed until that host-owned path exists. Canonical trust, signed publication,
activation, promotion, rollback and distribution remain closed independently.

Apps retain their own packaged source and UI slot. The Notes source in
`ordax-apps` uses `data-app-extension="notes"`, derived from its component
ID. Installing, signing, probation, updating and promoting slots still belong
to the existing runtime-component authority; this source implementation does
**not** declare production distribution or physical launch ready.

## Boundaries

Four concepts must stay separate:

1. **Known product/delivery registry** — `delivery-policy.mjs` may describe a first-party product even when its payload is absent locally. This registry is not a Store catalog and cannot make an app installable; a signed Store catalog may later enrich it with verified artifact/version metadata.
2. **Local app presentation catalog** — `system/apps/catalog.mjs` contains first-party app descriptors whose product source/presentation is present in the current platform composition. It is not the authoritative list of every product OrdaX may offer.
3. **Installed-state SSOT** — for independently delivered `component-slot` apps, the canonical truth is the verified `current` activation owned by `ordax-runtime-component-channel`. A staged or cached slot is not an installation, and Store never keeps a second installed-app database.
4. **Delivery projection** — `verified-store-projection.mjs` combines verified catalog metadata, the read-only current activation projection and first-party delivery policy into `ordax.app-store-catalog/2`. It persists no inventory and mints no authority.

The Surface may project an absent or explicitly removed, catalogued app as `available` for **manual** reinstall. Native `source:removed` and ordinary `source:absent` are distinct observations derived from the same signed component channel; they are never a separate installed-state database. A removed app must not become eligible for automatic first-run installation merely because Store shows a verified candidate. That never makes it launchable. A recommended absent app can open an install/details experience, but execution requires a verified payload supplied either by the current signed Stable release or by a future verified independent component slot.

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

### Ampliação gradual do leitor Native de módulos

A **Calculadora** é o primeiro utilitário de `ordax-apps` acrescentado ao escopo de leitura de módulos assinados, preservando seu código e manifesto na fonte oficial `apps/calculator`. O SSOT é `docs/contracts/runtime-component-package.json`; `tools/app-policy/render_native_store_metadata_policy.py` agora produz no mesmo arquivo gerado as três listas com direitos distintos: `STORE_METADATA_COMPONENT_IDS` (consultar estado), `NATIVE_MODULE_READ_COMPONENT_IDS` (solicitar arquivo ao helper assinado) e `NATIVE_HEALTH_MUTATION_COMPONENT_IDS` (registrar saúde). Não existem allowlists Python locais paralelas.

A adição da Calculadora **não** altera o conjunto de health mutation (Internet e Notas), não assina/copia pacotes, não ativa o instalador, não promove a versão, não habilita a chave de produção e não prova montagem em dispositivo. O loader continua verificando fonte, caminho, identidade do slot corrente e assinatura via helper. **A Loja bloqueia a instalação/atualização da Calculadora com `runtime-probation-unavailable` enquanto não houver saúde e probation Native compatíveis**, mesmo quando existe candidato de catálogo verificado. O gerador `render_external_first_party_policy.py` deriva a lista de componentes com probation apta do mesmo SSOT, separada dos componentes somente-leitura. Os demais utilitários continuam sem permissão de leitura executável até provas equivalentes.

**Gates seguintes:** caminho de saúde/probation validado para apps externos com runtime real, assinatura/publicação oficial do catálogo, pré-instalação transacional e E2E de instalação/remover/reiniciar/reinstalar. Sem esses gates, não apresentar a Calculadora como pré-instalada em produção.

## Surface da Loja: experiência e contrato

A Loja estrutural permanece sob `system/services/system-ui/store` e `system/surface/ui/store-overview-controls.mjs`, usando estilos em `store.css` e mensagens component-scoped em `system/services/i18n/catalog/store.mjs`. Este frontend **não** é um segundo catálogo nem um gerenciador de pacotes: consome somente o snapshot validado `ordax.app-store-catalog/2`.

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

## Idempotency ledger capacity (Store lifecycle)

The authority-free Store lifecycle request service remembers **all** request IDs
(decisions accepted, rejected, or pending) within the lifetime of one mounted
instance, with a bounded maximum of 256 identities. Known IDs replay the original
promise and a reused ID with a different operation/target fails closed.
Once the ledger is full, **new** IDs receive
`lifecycle-request-capacity-exhausted`; no prior decisions are evicted and no
Native delegation is attempted. The UI must establish a fresh service session
for additional operations rather than reusing an old ID. This is a request
admission policy, not proof of installation or a persistent Native receipt.
