# Current State

## Public account and Web entry — 2026-10-09 source candidate

The public portal now has a responsive My account overview at `/conta/` and a
separate `/web/` entry.

The account concept now uses the user-approved transparent ribbon, OS landscape and Inter through
the canonical brand build. It includes responsive service sections, search,
deep links, keyboard focus and mobile navigation. Plan names are derived from
entitlements; locale uses the existing portal owner. These are presentation
capabilities, not activation of billing, profile editing or device control.

Account data comes only from the existing verified
same-origin session; native sign-out remains unchanged. Back navigation clears
personal data and launch links before revalidation. Plans/storage/devices show
availability without fabricated usage, permissions or assigned subscription.
Web launch requires verified identity and a configured, owner-approved product
destination. Configuration and contract keep the actual Web runtime disabled;
no hosted Surface, public identity activation or live account E2E is implied.
See `docs/PUBLIC-SITE.md` for ownership, acceptance and remaining gates.

## Studio Web availability — 2026-10-09 source candidate

The shared rail now opens the existing Studio host integration panel. The panel distinguishes read discovery from an operational workspace, suppresses misleading zero capability metrics when the reader is absent, delegates Projects to its existing app owner and links to the public ChatGPT site with explicit mode/quota guidance. The full portable conversation/preview source belongs to `ordaxsystems/ordax-apps` and is **not yet composed into OS Web**. The bundled `system/apps/studio` version identifies the legacy integration component, not the current canonical portable product version. No external payload, provider session, Runtime execution or production installation has been activated. See [STUDIO-WEB-AVAILABILITY.md](STUDIO-WEB-AVAILABILITY.md).


## Surface visual identity — 2026-10-09 source candidate

Midnight (dark) and Ice (light) implement the approved ribbon/blue-violet visual direction in the shared Surface tokens/composition. The original local ribbon SVG is shared by the shell and loading screen; the generated landscape is a local offline asset with recorded provenance. Navigation, command search, Home shortcuts and the floating dock retain canonical state owners; Settings previews use the same tokens and the existing `appearance.theme` owner. Light remains the default, and preference persistence, accessibility and account-sync authority are unchanged. See [DESKTOP-IDENTITY.md](DESKTOP-IDENTITY.md) for scope, acceptance and ownership. This source candidate does not activate a production release or establish physical-media evidence.

Status date: 2026-09-30

This is the canonical handoff snapshot. Architecture/contracts win if another document conflicts with it. Detailed historical evidence remains under `docs/evidence/`; this file records the current boundary without treating CI proof, development-hardware proof and product-release authorization as interchangeable. Values that mirror structured source — including product/app versions, component release modes and physical-media geometry — are regression-checked against their owners so this snapshot cannot silently drift from the implementation.

## First-party utility Store policies (2026-10-08)

The first-party delivery policy additionally recognizes twelve optional utility app IDs from `ordaxsystems/ordax-apps` as `on-demand/store-only`. This is **metadata/presentation policy only**: a future verified signed catalog may project them, but no app becomes installed, launchable or production-installable from metadata alone. Initial USB MVP scope and on-demand boot policy remain unchanged; Native Store lifecycle executor and public Store UI remain disabled until separate trust, lifecycle and release gates are proven. The source, G0 package inventory and public App SDK contracts retain their respective canonical owners.

## MVP current release activation (USB) and integrated-development scope (USB + Native target)

```text
MVP_PUBLIC_EXECUTION_MODE=USB_ONLY
MVP_NATIVE_INSTALLATION_AVAILABLE=NO
MVP_INTERNAL_DISK_DESTRUCTIVE_WRITE=NO
MVP_INTEGRATED_DEVELOPMENT_SCOPE=ALL_SUBSTANTIVELY_STARTED_CAPABILITIES
NATIVE_MVP_DEVELOPMENT_TARGET=YES
NATIVE_FOUNDATION_RETAINED_FOR_MVP_INTEGRATION=YES
MVP_BILLING_IMPLEMENTED=NO
MVP_PRICING_DEFINED=NO
MVP_PLAN_STRUCTURE_DEFINED=YES
MVP_PLAN_IDS=free,personal,professional,team
MVP_PAID_PLANS_PURCHASABLE=NO
MVP_DEFAULT_PLAN=free
MVP_ACCOUNT_OPTIONAL=YES
MVP_ACCOUNT_SIGNUP_LOGIN_REQUIRED_IF_CHOSEN=YES
MVP_COMMERCIAL_DEVICE_LIMIT_DEFINED=NO
WEB_MOBILE_SYNC_PUBLIC_STATUS=COMING_SOON_ONLY
OPERATIONAL_REALTIME_CONTRACT=PASS_SOURCE_RUNTIME_DISABLED
ORDAX_OPERATIONAL_REALTIME_PUBLIC=NO
ORDAX_DEVICE_ACTIONS_PUBLIC=NO
ORDAX_MOBILE_ADAPTER_STATUS=ARCHITECTURE_ONLY
ORDAX_ANDROID_APK_IMPLEMENTED=NO
ORDAX_MOBILE_COMPANION_CONTRACT=PASS_SOURCE_RUNTIME_DISABLED
ORDAX_PHONE_CAMERA_AS_WEBCAM_IMPLEMENTED=NO
ORDAX_PHONE_MIC_AS_INTELLIGENCE_INPUT_IMPLEMENTED=NO
ORDAX_DEVICE_LOCATOR_IMPLEMENTED=NO
ORDAX_EDGE_RUNTIME_CONTRACT=PASS_SOURCE_RUNTIME_DISABLED
ORDAX_EDGE_RUNTIME_PUBLIC=NO
ORDAX_PRODUCTION_REQUIRES_USER_NOTEBOOK_ON=NO
```

Native contracts, Creator Core, LUKS2/Btrfs work, Native initramfs, ESP and disposable proofs remain valid engineering foundation, but they do not block or appear as user-facing MVP functionality.

## Autoridade de repositório (reconciliada em 2026-10-09)

O bloco `## Repository` abaixo reflete agora o owner canônico real, conforme
`docs/contracts/repository-ownership.json` e `docs/contracts/repository-migration-status.json`.
A linha `Status date` no início identifica a data do snapshot histórico geral:
não certifica, sozinha, todas as demais capacidades ali descritas como atuais.
Os antigos slugs `washingtonmsdj/prototipo-ordax-os` e
`ordaxsystems/prototipo-ordax-os` permanecem válidos exclusivamente como
proveniência da transferência/renomeação, não como autoridade operacional.
Uma Stable pública assinada não é inferida do nome final do repositório;
seus gates de publicação e hardware continuam independentes.

## Repository

```text
REPOSITORY=ordaxsystems/ordax-os
ROLE=OFFICIAL_ORDAX_OS
DEFAULT_BRANCH=main
PROMOTED_TO_OFFICIAL=YES
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REPOSITORY_IS_REFERENCE_ONLY=YES
GIT_MAIN_IS_SOURCE_AUTHORITY=YES
USB_IS_SOURCE_AUTHORITY=NO
```

## Product model

```text
ONE_PRODUCT=YES
MODES=WEB,MOBILE,DESKTOP,USB,NATIVE_DISK
ONE_ACCOUNT_MODEL=YES
ONE_SURFACE_SOURCE=YES
CAPABILITY_DIFFERENCES_VIA_ADAPTERS=YES
SYSTEM_ENTRYPOINT_IMPLEMENTED=YES
SURFACE_BOOTSTRAP_RUNTIME=YES
GRAPHICAL_SURFACE_SOURCE=IMPLEMENTED
SHARED_WORKSPACE_WINDOW_MODEL=IMPLEMENTED
FIRST_PARTY_APP_REGISTRY=FILES,PROJECTS,STUDIO,NOTES,NETWORK,ASSISTANT,ACTIVITY,INTERNET,SETTINGS,ACCOUNT,SYSTEM
DEVICE_AGENT_PRODUCT_NAME=OrdaX_Device_Agent
DEVICE_AGENT_FOUNDATION=PASS_SOURCE_CONTRACT
DEVICE_AGENT_PROJECTS_CAPABILITY_READER=PASS_SOURCE_READ_ONLY_NO_EXECUTE
DEVICE_AGENT_RUNTIME_IN_PRODUCT=DEFERRED_POST_MVP_FULL_RUNTIME
DEVICE_AGENT_HISTORICAL_INCUBATION_REPOSITORY=washingtonmsdj/mcp-blender
DEVICE_AGENT_CONTROL_PLANE_BACKEND=ordax-control-plane
DEVICE_AGENT_CONTROL_PLANE_AUTHORITY=SHARED_BACKEND_SEPARATE_PRODUCT_AND_DEVELOPMENT
DEVICE_AGENT_DEVELOPMENT_CREDENTIALS_VALID_FOR_PRODUCT=NO
DEVICE_AGENT_PRODUCT_CREDENTIALS_VALID_FOR_ENGINEERING=NO
DEVICE_AGENT_DEVELOPMENT_ADAPTER_BACKEND=APPLIED_BLENDER_V1
DEVICE_AGENT_GITHUB_OIDC_ENROLLMENT=DEPLOYED_V1
DEVICE_AGENT_EXISTING_TOKEN_IDENTITY_RECOVERY=DEPLOYED_V1
DEVICE_AGENT_WINDOWS_V2_ENROLLMENT_PROOF=PENDING_LOCAL_RECOVERY_EXECUTION
DEVICE_AGENT_CERCO_PROJECT_REGISTRATION=PENDING_LOCAL_RECOVERY_EXECUTION
PROJECTS_EXTERNAL_AI_ACCESS=GITHUB_DIRECT_PLUS_ORDAX_MCP
ORDAX_WEB_DEVICE_CONTROL=PASS_SOURCE_SHARED_ACTION_CONTRACT_RUNTIME_DISABLED
SETTINGS_VISIBLE_LABEL=AJUSTES
SURFACE_HOME_TECHNICAL_UPDATE_MARKERS=REMOVED
PRODUCT_VERSION=0.1.0
PRODUCT_VERSION_LABEL=v0.1.0
PRODUCT_MATURITY=PROTOTYPE
PRODUCT_V1_RESERVED_FOR_STABLE_RELEASE=YES
FIRST_PARTY_APP_VERSIONING=PER_COMPONENT
FIRST_PARTY_APP_PRE_1_0_MATURITY=BETA
APP_FILES_VERSION=0.1.0
APP_FILES_MATURITY=BETA
APP_FILES_RELEASE_MODE=bundled
APP_PROJECTS_VERSION=0.1.0
APP_PROJECTS_MATURITY=BETA
APP_PROJECTS_RELEASE_MODE=git-app
APP_SETTINGS_VERSION=0.1.0
APP_SETTINGS_MATURITY=BETA
APP_SETTINGS_RELEASE_MODE=bundled
APP_ACCOUNT_VERSION=0.1.0
APP_ACCOUNT_MATURITY=BETA
APP_ACCOUNT_RELEASE_MODE=bundled
APP_STORE_VERSION=0.1.0
APP_STORE_MATURITY=BETA
APP_STORE_RELEASE_MODE=bundled
APP_SYSTEM_VERSION=0.1.0
APP_SYSTEM_MATURITY=BETA
APP_SYSTEM_RELEASE_MODE=bundled
APP_INTERNET_VERSION=0.3.0
APP_INTERNET_MATURITY=BETA
APP_INTERNET_RELEASE_MODE=git-app
APP_NOTES_DELIVERY=ON_DEMAND_STORE_ONLY
APP_NOTES_LOCAL_PAYLOAD=ABSENT_PRELAUNCH_EXTERNALIZATION
PRODUCTION_INDEPENDENT_APP_UPDATES_ENABLED=NO
SYSTEM_UPDATE_SCOPE=BASE,SURFACE,SERVICES,SYSTEM
APPLICATION_UPDATE_SCOPE=FILES,PROJECTS,NOTES,INTERNET,SETTINGS,ACCOUNT
UPDATE_HUMAN_IDENTITY=DELIVERY_NUMBER
UPDATE_PR_NUMBER_IS_PRODUCT_IDENTITY=NO
UPDATE_RUNNING_LABEL=EM_EXECUCAO
WEB_CLIENT_CANDIDATE=PASS
APPEARANCE_THEME_VALUES=DARK,LIGHT
SURFACE_ACCESSIBILITY_PREFERENCES=CONTRAST,MOTION,TEXT_SCALE
SURFACE_TEXT_SCALE_VALUES=STANDARD,LARGE,EXTRA_LARGE
APPEARANCE_PERSISTENCE=WEB_LOCAL_PASS
APPEARANCE_ACCOUNT_SYNC=PASS_SOURCE_WEB_PUBLIC_ROLLOUT_GATED
NATIVE_GRAPHICAL_HOST=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_PRIMARY_INPUT=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_POWER_RESTART=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_POWER_SHUTDOWN=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_GIT_HOT_UPDATE=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_UPDATE_SELF_HEALING=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_GUARDIAN_SUPERVISOR=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_RESCUE_CHANNEL=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_TELEMETRY_RELAY=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_CANDIDATE_PREFLIGHT_SUCCESS_PATH=PASS_PHYSICAL_DEVELOPMENT_USB
CANONICAL_TRUST_TOOLKIT_REQUIRES_PORTABLE_ONE_SHOT_PROOF=YES
CANONICAL_TRUST_TOOLKIT_PROVENANCE_ELIGIBLE=YES
CANONICAL_TRUST_TOOLKIT_SOURCE_COMMIT=2172eb6a18430910afd036199ec492ad63dc185d
CANONICAL_TRUST_TOOLKIT_WORKFLOW_RUN_ID=35617567458
CANONICAL_TRUST_TOOLKIT_ARTIFACT_SHA256=cb8232d20a9cdbaa81e73d55b52e2d6047b3b800a06a73a14869e6dc2245af31
CANONICAL_TRUST_TOOLKIT_LOCAL_PREFLIGHT_EXECUTED=YES
PORTABLE_COLD_HEALTH_PROOF_SCOPE=PHYSICAL_STABLE_MVP_REQUIRED_NO_SYNTHETIC_CI
CANONICAL_KERNEL_ACPI_BATTERY_SUPPORT=EXPLICIT
CANONICAL_KERNEL_SYSRQ_RESTART_FALLBACK=EXPLICIT
REAL_SYSTEM_BUNDLE_REPRODUCIBLE=PASS
GRAPHICAL_SURFACE_COMPLETE=NO
CANONICAL_SYSTEM_RUNTIME_COMPLETE=NO
```


The canonical prototype trust ceremony and public handoff are complete. The eligible toolkit bound to `2172eb6a18430910afd036199ec492ad63dc185d` passed read-only preflight; canonical Ed25519 key material was generated locally, independent public derivation matched, the proof signature passed, recovery was verified from a distinct restored copy, and the recovered signing envelope passed public verification. The exact public anchor is pinned in Git and the minimal-bootstrap trust binding remains resolved. An earlier owner authorization existed for the first Stable/MVP USB proof, release sequence 1, but it was bound to a previous physical-writer context and is no longer valid after the writer changed. On 2026-09-26 the owner-controlled v4 candidate was signed and published as a prerelease, then materialized and verified from its exact versioned HTTPS URL in CI run `36234573905`; aggregate proof SHA-256 `2dd17580ddbf5a0fd0433a912e97e6bded04fd0a44ea0849e9da15e13df01e4b` is bound in the repository. This prerelease did not become GitHub's stable `latest` release. The authorization contract is now `blocked-explicit-physical-authorization-pending`, with `physical_write_allowed=false`, `explicit_owner_authorization=false` and no authorization-context hash. A fresh explicit owner authorization must be recorded against the current writer context before any destructive physical flow becomes eligible. No target-specific consent has been recorded and no USB is selected or authorized for a new write; live target revalidation, Windows UAC and target-specific destructive confirmation remain separate later gates. The local PEM remains a controlled prototype signing backend rather than the intended long-term production custody model; independent off-device custody and managed non-exportable KMS/HSM remain broad-distribution hardening requirements, with signed trust rotation required before broad public distribution.

The first formal human product version is **OrdaX Prototype v0.1.0**. Product version, Entrega, Git SHA and component/app versions are separate identities: v0.1.0 identifies the prototype product milestone, Entrega identifies the notebook-facing delivery sequence, the SHA remains the exact technical build identity, and each component may evolve its own SemVer. First-party apps on the `0.x` line are **Beta**; `1.0.0` remains reserved for the first stable release of each app. Internet is currently `0.3.0 Beta` and Projetos is `0.1.0 Beta`; both use `git-app` in Owner/Development. Notes remains a known first-party product identity but its local payload is intentionally absent during the pre-launch externalization gate. Arquivos, Ajustes, Conta and Sistema are `0.1.0 Beta` and remain `bundled`. A component having its own version does not mean it already has a production-independent update channel: `git-app` is a development delivery mode, while production-independent activation remains gated behind the signed `component-slot` path with pending health, promotion and rollback. Product v1.0 remains reserved for the stable product rather than being inferred from prototype maturity, component versions or delivery count.

`system/` is the shared product source. The native development path is physically proven through `system/entrypoint (guardian) -> system/supervisor -> system/surface/entrypoint -> system/surface/bin/ordax-surface`; repository CI also proves that the actual `system/` tree can be bundled deterministically as `system.tar`.

The shared graphical source remains under `system/surface/ui/` with platform-neutral contracts, workspace/window lifecycle and capability-driven app availability. Projects is a first-party application with stable app id `projects`, version `0.1.0 Beta` and `git-app` delivery in Owner/Development. It consumes the existing neutral local project catalog and optional `ordax.project-cloud-links-reader/1` read-only overlay over `ordax.project-cloud-links/1` data; it does not create a second project store, require an account, upload local files by default or change local project identity. Web currently degrades honestly when no local/cloud project catalog is supplied. Notes remains a known first-party product with stable app id `notes`, classified as `on-demand` and `store-only`. During the pre-launch remove-first externalization gate its payload is intentionally absent from `system/`: there is no local Notes runtime, fixed launcher path, app-owned localization payload or legacy `/__ordax/native/notes` persistence endpoint. Its future package is sourced from `ordax-apps` and will consume public platform contracts such as `ordax.app-data/1`, `ordax.intelligence/1` and `ordax.file-space/11`. The Store is discovery/request UI only; its authority-free lifecycle request contract now models install, update and remove while refusing artifact/version selection, trust changes, permission grants, verification bypass and implicit user-data deletion. Verified acquisition, install/update staging, health, promotion, rollback, uninstall execution and inventory remain platform lifecycle authority, and the Native executor stays unmounted while canonical component trust/publication/activation gates remain closed. Internet is the first-party browser app with stable id `internet`, version `0.3.0 Beta` and `git-app` delivery in Owner/Development; this version identity does not claim a production Store/updater. Its shared Surface owns the approved concept structure (navigation toolbar, workspace/tab rail, central web viewport and project-context panel), while Native/USB provide `browser.web-content` through a separate unprivileged WebKit context and one external WebView per tab. The native slice supports up to 16 tabs, back/forward/reload, tab search, keyboard accelerators, persisted public tab URLs/order/active tab, project-context selection, explicit saved web references with bounded per-reference notes, automatic reference cleanup after project removal, public-network filtering and an exact loopback Host/browser-provenance boundary. Saved project references are owned by a neutral project-domain runtime and persist in the Native privileged profile with honest session fallback; the external page never receives project storage capability. Web intentionally exposes an unavailable browser-session port rather than pretending arbitrary sites can be safely embedded. Notes web references activate this same `internet` app. Internet also owns bounded device-local favorites through a neutral `ordax.browser-favorites/1` port; the Native privileged profile persists them while external website WebViews receive no access to that store. Native hardware proof for the new WebKit host remains pending, so the browser slice is implemented in source but not yet marked physically proven. Ajustes now owns persisted Surface-level contrast, motion and text-scale preferences; text scale changes the shared typographic base without claiming host-level accessibility control. Platform-specific behavior belongs in adapters/compositions, not in forks of the shared Surface. The normal Home now keeps technical delivery/recovery markers out of the area label; real delivery identity and update details live in Sistema. The visible settings identity is standardized as **Ajustes** while preserving the stable internal app id `settings`.

### Nova OrdaX pre-USB functional closure

The legacy/product-vision audit has been revalidated before the first Stable/MVP
physical USB. `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` is now the active
pre-USB closure plan. Physical media work is intentionally held while the remaining
class-A product gaps are closed. Ordax Intelligence consumers, Native local
session/lock, safe Files removal and PT-BR/en-US launch-language coverage are now
source-complete. The historical v4 candidate carrying the proven local-AI runtime was
signed, materialized, exactly verified and bound by a non-activating proof at source
`b924ff8d74d1761232381ae3f9604bba17497cfd`. It remains a public prerelease and valid
historical pre-hardening evidence, but PR #588 and later source hardening superseded it
for current-main physical promotion. The stable `latest` channel has not been promoted.
Diagnostics/recovery presentation and the conservative MVP hardware-support matrix
are source-complete; their target-hardware/physical proofs remain later gates.

The v4 Creator payload change deliberately revoked the stale 15-artifact authorization
context instead of widening it. The structured physical-authorization contract is now
authoritative at `blocked-canonical-v4-release-proof-pending`: the historical
`canonical-v4-release-proof.json` cannot be rebound to reopen consent. A replacement
signed/materialized v4 proof from a different post-hardening source commit must be
produced, verified and bound before owner consent becomes reachable. The 17-artifact
writer remains fail-closed, no USB target is selected, no target-specific destructive
confirmation is current and no new physical write/proof is authorized. The physical Creator
now keeps writer/tooling provenance separate from release identity: the writer embeds its own
Git SHA as provenance plus the canonical v4 release source commit from
`physical-write-authorization.json -> release_binding.source_commit`. Target-specific
Portable media/application plans must use that canonical release commit, and
`prepare-portable`/`apply-portable` fail closed unless it matches; the v4 writer accepts
exactly 17 canonical artifact sources, never the previous 15-source shape.

```text
PRE_USB_NOVA_ORDAX_AUDIT=PASS
INTELLIGENCE_REAL_SYSTEM_CONSUMER=PASS_SOURCE
INTELLIGENCE_STABLE_V4_BACKEND_LIFECYCLE=PASS_SOURCE_SIGNED_STABLE_PROOF_PENDING
INTELLIGENCE_MEMORY_NATIVE_RUNTIME=PASS_SOURCE_FAIL_SOFT
INTELLIGENCE_MEMORY_REVIEW_UI=PASS_SOURCE_NATIVE_ACCOUNT_MEMORY_SECTION
INTELLIGENCE_MEMORY_WEB_DURABLE_REVIEW=UNAVAILABLE_NO_FAKE_PERSISTENCE
INTELLIGENCE_MEMORY_AUTOMATIC_INJECTION=PASS_SOURCE_COMPOSITION_AUTHORIZED_DEVICE_ACCOUNT_SPACE
INTELLIGENCE_MODEL_ROUTER_LOCAL_IDENTITY=PASS_SOURCE_ENGINE_PLUS_MODEL
LOCAL_AI_HARDWARE_PROBE_BEFORE_START=PASS_SOURCE_NON_BOOT_CRITICAL
LOCAL_SESSION_LOCK_POLICY=PASS_SOURCE
LOCAL_SESSION_LOCK_IMPLEMENTATION=PASS_SOURCE
LOCAL_SESSION_LOCK_PHYSICAL_PROOF=PENDING
FILES_DAILY_OPERATIONS=PASS_SOURCE
FILES_SAFE_REMOVAL=PASS_SOURCE
FILES_TRASH_PHYSICAL_PROOF=PENDING
DIAGNOSTICS_RECOVERY_PRESENTATION=PASS_SOURCE
RECOVERY_STATUS_PHYSICAL_PROOF=PENDING_PHYSICAL
SUPPORTED_HARDWARE_MATRIX=PASS_SOURCE
CANONICAL_STABLE_TARGET_HARDWARE_PROOF=PENDING_PHYSICAL
CANONICAL_V4_OPERATOR_PREFLIGHT=PASS_SOURCE_READ_ONLY
CREATOR_PORTABLE_WRITER_RELEASE_SOURCE_BINDING=PASS_SOURCE
CREATOR_PORTABLE_WRITER_ARTIFACT_SOURCE_COUNT=17
CREATOR_WRITER_SOURCE_PROVENANCE_SEPARATE=YES
CANONICAL_V4_OPERATOR_INPUT_EXPORT=PASS_SOURCE_MANUAL_WORKFLOW_DISPATCH_ONLY
CANONICAL_V4_OPERATOR_INPUT_RETENTION=1_DAY_NON_PUBLICATION
CANONICAL_V4_OPERATOR_INPUT_SAME_SHA_REQUIRED=YES
CANONICAL_V4_OPERATOR_RECEIPT_SCHEMA=prototype-ordax.canonical-v4-operator-artifact/1
CANONICAL_V4_OPERATOR_RECEIPTS=PASS_CI_SAME_SHA_SHA256_SIZE_REVERIFIED
CANONICAL_V4_OPERATOR_RECEIPT_TAMPER_REJECTION=PASS_CI_WRONG_COMMIT_AND_BYTE_TAMPER
CANONICAL_V4_OPERATOR_RECEIPT_WORKFLOW_RUN_ID=36166653548
CANONICAL_V4_RELEASE_PROOF_HISTORY=PASS_SIGNED_MATERIALIZED_VERSIONED_PRERELEASE_PRE_HARDENING
CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN=PENDING_POST_HARDENING_REPLACEMENT
STABLE_MVP_USB_READINESS_GATE=PASS_SOURCE_AGGREGATES_PRE_USB_AND_PHYSICAL_PROMOTION
STABLE_MVP_USB_READINESS_CURRENT_STAGE=CANONICAL_V4_RELEASE_PROOF_PENDING
CANONICAL_V4_RELEASE_PROOF_BINDING_CURRENT_MAIN=NO_SUPERSEDED_HISTORY_RETAINED
PHYSICAL_OWNER_AUTHORIZATION_RECORDED=NO
PHYSICAL_OWNER_AUTHORIZATION_REACHABLE=NO_REPLACEMENT_PROOF_REQUIRED
FIRST_STABLE_MVP_USB_WRITE=HOLD_CANONICAL_V4_RELEASE_PROOF_PENDING
PHYSICAL_WRITE_AUTHORITY=BLOCKED_CANONICAL_V4_RELEASE_PROOF_PENDING
```

### Pre-MVP ecosystem foundation

A separate product-domain foundation is now defined before public accounts carry real data. The account model distinguishes one OrdaX identity from **Spaces** and versioned **Profile Packs**; the initial Developer and Legal-BR packs are draft descriptors only and do not activate professional-domain behavior. Billing, prices and commercial tier names remain undefined. A provisional two-private-Space default exists only as an internal capacity foundation and is not a public commercial claim.

Persistent Intelligence memory is now implemented as OrdaX-owned through `ordax.memory/1`, with explicit `device|account` ownership, device/account/space/project/session scopes, provenance, bounded search/review/edit/delete semantics and durable `flush()` confirmation. Native/USB owns a bounded private atomic memory state through a loopback-only endpoint and mounts the memory runtime fail-soft; Web fallback is explicitly ephemeral and cannot pretend durable device/account/Space/project state. Account → Memory now mounts a user-visible Native review surface over the same owner-scoped runtime, with device/account owner switching, bounded search/pagination, editing, deletion and durable flush feedback; the Web composition deliberately shows durable memory as unavailable instead of simulating persistence. `ordax.memory-context-auth/1` and the authorized-memory bridge require composition-layer authorization before any memory reaches Intelligence, and ordinary Intelligence requests still inject no memory automatically unless Native composition has an explicit identity-bound `Space em uso`; Native composition now explicitly authorizes a shared bounded Memory set: device scope always remains available locally, authenticated account scope is added only for the real signed-in `subjectId`, and selected-Space scope is added only for that same subject plus exact `spaceId`; project/session/restricted memory is not inferred. in that case only account-owned, non-restricted `scope=space` memory for that exact `subjectId + spaceId` is eligible as selected Space Memory context. `ordax.model-router/1` is now active in the Intelligence runtime, binds local routes to `engineId + modelId` and keeps future OpenAI/xAI routes fail-closed without explicit egress plus an enabled adapter. Local AI remains the offline baseline and no inference provider owns persistent memory.

The dedicated Supabase project `ordax-control-plane` is the selected pre-MVP backend target for the product schema. The source-controlled migrations under `infra/supabase/product/` have been applied: `ordax_accounts`, Spaces/membership, server-authoritative entitlement grants, versioned Profile Packs, memory metadata + pgvector embeddings and project-connection metadata all use RLS. The older duplicate `ordax_profiles` migration was removed so Auth has one OrdaX product bootstrap owner. The Supabase password provider is implemented and the OrdaX account gateway is deployed to the dedicated control-plane backend. Sign-in, sign-up implementation, refresh, validated session state and logout use HttpOnly cookies and never expose provider tokens to Surface JavaScript. Account registration itself is now explicitly fail-closed across Surface capability, Native host and gateway until a reviewed legal policy plus server-authoritative document-version receipt binding exists; login remains independent. Account sync now uses an atomic initial snapshot plus a subject-bound persisted incremental cursor for appearance, portable preferences and workspace metadata on Web and Native/USB. **Public browser login remains fail-closed** pending the same-origin production hosting boundary, leaked-password protection, remaining Auth hardening and legal readiness. The Account Surface now also has a minimal read-only Spaces view on Web and Native/USB: it consumes only `/account/spaces`, validates a bounded provider-neutral projection, clears cached Space data on sign-out and never invents a local Space. The account gateway source v17 is deployed as Edge Function revision 27; registration remains explicitly disabled. The live gateway also enforces the shared server-authoritative auth rate limit on direct Native credential/recovery paths and keeps password-recovery credentials isolated from normal account sessions. A service-role-only read projection now exposes only the active/effective canonical Privacy/Terms metadata through `/auth/registration-policy`; Web and Native source consume that same projection, intersect it with their local registration gate, and require affirmative acceptance without trusting client-supplied version/hash authority. The server-authoritative registration legal receipt migration `20261002221427_account_registration_legal_receipt_v1` is applied: the existing single `auth.users` trigger now requires a short-lived service-issued legal intent, binds it to the normalized-email SHA-256 and active canonical legal policy, snapshots Privacy/Terms version + effective date + SHA-256 into a private receipt in the same user-creation transaction, and rejects direct signup bypasses. No active legal policy exists yet, so the source-ready Web/Native acceptance UI remains unavailable and public registration stays fail-closed; the dedicated account lifecycle service is deployed as revision 2 with global session revocation before account deletion while account-close remains disabled. Public browser account access and account-close execution remain disabled.

OrdaX Network now has a live server-authoritative MVP backend in the same
`ordax-control-plane`. The six v1 Network migrations plus all six canonical v2
mutation migrations are applied: message-send, direct-create, block-change,
group-join, report-create and group-create. Public v2 wrappers remain
`SECURITY INVOKER`; privileged implementations remain private
`SECURITY DEFINER` with `search_path=''`. The live schema exposes zero direct
Network table grants to `anon` or `authenticated`. Group/report idempotency
columns are nullable for legacy v1 rows and protected by partial unique indexes
for v2 retries. The multi-tenant PostgreSQL proof covers cross-account denial,
viewer write denial, block behavior, idempotency, rate-limit durability, group
lifecycle and deletion/tombstone behavior. The first-party Network app exists
as an optional fail-soft component and pins a draft to its sender Space; a
global Space change never silently retargets the pending draft. The same-origin
message route is deployed through Native -> account gateway -> Edge ->
`ordax_network_send_message_v2`, while `PUBLIC_SITE_NETWORK_ENABLED=false`
keeps public Network activation fail-closed.

```text
ORDAX_NETWORK_MVP_BACKEND=PASS_APPLIED
ORDAX_NETWORK_V1_SCHEMA=PASS_APPLIED
ORDAX_NETWORK_V2_MUTATIONS=MESSAGE_SEND,DIRECT_CREATE,BLOCK_CHANGE,GROUP_JOIN,REPORT_CREATE,GROUP_CREATE
ORDAX_NETWORK_V2_MIGRATIONS=PASS_APPLIED
ORDAX_NETWORK_DIRECT_BROWSER_TABLE_GRANTS=NONE
ORDAX_NETWORK_RPC_BOUNDARY=PUBLIC_INVOKER_PRIVATE_DEFINER_SEARCH_PATH_EMPTY
ORDAX_NETWORK_MULTI_TENANT_PROOF=PASS_POSTGRESQL16
ORDAX_NETWORK_RETENTION_TOMBSTONE_POLICY=PASS_CONTRACT_V1
ORDAX_NETWORK_COLLABORATIVE_HISTORY_ON_ACTOR_DELETE=RETAIN_WITH_ATTRIBUTION_TOMBSTONE
ORDAX_NETWORK_AUTOMATIC_MESSAGE_PURGE=NO
ORDAX_NETWORK_SURFACE_APP=PASS_SOURCE_OPTIONAL_FAIL_SOFT
ORDAX_NETWORK_DRAFT_SENDER_SPACE=PINNED_NO_SILENT_RETARGET
ORDAX_NETWORK_MESSAGE_TRANSPORT_SERVER=PASS_DEPLOYED
ORDAX_NETWORK_PUBLIC_SITE_ENABLED=NO
```

First-party Product OAuth now has a separate persistent authorization domain from
owner/development MCP credentials. The private OAuth client/code/grant/access-token
authority is applied in `ordax-control-plane`; authorization code + PKCE S256,
single-use code consumption, opaque access-token resolution/revocation and current
Space authority are proven end to end through the provider-neutral HTTP boundary.
The canonical Achegue-se client `acheguese-web-01` remains deliberately
`disabled` with an empty redirect allowlist and exactly the three initial read
scopes. A read-only Product Network resource server is also applied: its server-only
RPCs accept only SHA-256 access-token digests, revalidate token/grant/client/scope
and current owner/admin authority, and expose bound Space, discoverable directory
and active communities reads. Public RPC EXECUTE is limited to `service_role`;
`anon` and `authenticated` have no Product Network resource RPC authority.
No public listener, real redirect or Achegue-se linking is enabled.

```text
PRODUCT_OAUTH_AUTHORITY=PASS_APPLIED_PRIVATE_RPC_ONLY
PRODUCT_OAUTH_HTTP_BOUNDARY=PASS_SOURCE_DISPOSABLE_E2E
PRODUCT_OAUTH_PKCE_S256=PASS_DISPOSABLE_E2E
PRODUCT_OAUTH_ACHEGUESE_CLIENT=DISABLED_ZERO_REDIRECTS
PRODUCT_OAUTH_ACHEGUESE_INITIAL_SCOPES=NETWORK_SPACE_READ,NETWORK_DIRECTORY_READ,NETWORK_COMMUNITIES_READ
PRODUCT_NETWORK_READ_RESOURCE=PASS_APPLIED_SERVER_ONLY
PRODUCT_NETWORK_READ_RESOURCE_TOKEN_TO_DB=SHA256_ONLY
PRODUCT_NETWORK_READ_RESOURCE_BROWSER_EXECUTE_GRANTS=NONE
PRODUCT_NETWORK_READ_RESOURCE_LIVE_UNKNOWN_TOKEN=DENIED
PRODUCT_OAUTH_PUBLIC_LISTENER=NO
PRODUCT_OAUTH_REAL_HTTPS_REDIRECT=NO
PRODUCT_OAUTH_PUBLIC_LINKING=NO
```

A Product MCP boundary is also specified separately from the owner/development Control Plane. Future ChatGPT/Grok clients authenticate to OrdaX OAuth, then receive only account/Space/project-scoped tools. GitHub is a separate connection, preferably through a GitHub App restricted to selected repositories; upstream GitHub credentials are never returned to the external model. Public Product MCP deployment, mutating tools, connectors and automations remain post-MVP functionality.

This foundation does not change the current physical release gate:

```text
ECOSYSTEM_FOUNDATION=PASS_SOURCE_BACKEND_SCHEMA_PREPARED
PUBLIC_IDENTITY_PASSWORD_FLOW=PASS_SOURCE_ACTIVATION_GATED
PUBLIC_IDENTITY_EDGE_GATEWAY=DEPLOYED_ORDAX_CONTROL_PLANE_SOURCE_V17_REV27_NATIVE_AUTH_RATE_LIMIT_LIVE_REGISTRATION_CLOSE_DISABLED
PUBLIC_IDENTITY_EDGE_DEPLOYMENT_REVISION=27_SOURCE_V17_LIVE
PUBLIC_SITE_SAME_ORIGIN_ADAPTER=PASS_SOURCE_NGINX_NOT_DEPLOYED
PUBLIC_IDENTITY_GATED_FORMS=PASS_SOURCE_NATIVE_POST_JS_NO_CREDENTIAL_READ
PUBLIC_SITE_DEPLOYMENT_PROOF_HARNESS=PASS_SOURCE_CREDENTIAL_FREE
PUBLIC_AUTH_CSRF_STATE_CHANGE_PROTECTION=PASS_DEPLOYED
PUBLIC_AUTH_SERVER_SIDE_ACTIVATION_GATE=PASS_DEPLOYED_DISABLED
PUBLIC_AUTH_PUBLIC_SITE_MARKER=X-OrDaX-Public-Site
PUBLIC_AUTH_REGISTRATION_PASSWORD_POLICY=PASS_PRODUCT_MIN_12_PROVIDER_CONFIG_PENDING
PUBLIC_AUTH_REGISTRATION_ENABLED=NO
PUBLIC_AUTH_REGISTRATION_LEGAL_BINDING=SERVER_RECEIPT_AND_POLICY_PROJECTION_IMPLEMENTED_FINAL_POLICY_AND_E2E_PENDING
PUBLIC_AUTH_REGISTRATION_NATIVE_BYPASS_ALLOWED=NO
PUBLIC_AUTH_REGISTRATION_POLICY_PROJECTION=PASS_SOURCE_APPLIED_SERVICE_ROLE_ONLY
PUBLIC_AUTH_REGISTRATION_POLICY_ACTIVE=NO
PUBLIC_AUTH_REGISTRATION_UI_BINDING=PASS_SOURCE_DISABLED_UNTIL_ACTIVE_POLICY_AND_SWITCH
PUBLIC_AUTH_RATE_LIMIT_REVIEW=PASS_SHARED_POLICY_DB_AUTHORITY_NATIVE_DIRECT_LIVE_PUBLIC_EDGE_V6_LIVE_VERCEL_REAL_IP_PROOF_PENDING
PUBLIC_AUTH_RATE_LIMIT_DEPLOYED=NATIVE_DIRECT_AND_PUBLIC_EDGE_V6_YES_VERCEL_ADAPTER_PROOF_PENDING
PUBLIC_AUTH_SESSION_REVOCATION_PROOF=PENDING_REAL_CREDENTIALLED_EXECUTION_LOCAL_SCOPE
PUBLIC_AUTH_SESSION_REVOCATION_HARNESS=PASS_SOURCE_CREDENTIAL_SAFE_SANITIZED_RECEIPT
PUBLIC_AUTH_SESSION_REVOCATION_WORKFLOW=PASS_SOURCE_MANUAL_SECRETS_REQUIRED
PUBLIC_AUTH_SESSION_REVOCATION_RECEIPT_SCHEMA=prototype-ordax.account-session-revocation-proof/1
PUBLIC_AUTH_RECOVERY_REQUEST=PASS_SOURCE_EDGE_V27_DISABLED_SESSION_ISOLATED
PUBLIC_AUTH_RECOVERY_REDIRECT_CONFIG=CANONICAL_ORIGIN_SELECTED_PROVIDER_ALLOWLIST_PROOF_PENDING
PUBLIC_AUTH_RECOVERY_EMAIL_TEMPLATE=PASS_SOURCE_NOT_APPLIED_TO_PROVIDER
PUBLIC_AUTH_RECOVERY_COMPLETION_ENABLED=NO
PUBLIC_AUTH_RECOVERY_COMPLETION_FLOW=PASS_SOURCE_EDGE_V27_DISABLED_TOKEN_HASH_SERVER_SIDE_RECOVERY_ONLY_COOKIES
PUBLIC_AUTH_LEAKED_PASSWORD_PROTECTION=PASS_PRODUCT_GATEWAY_HIBP_K_ANONYMITY_PROVIDER_NATIVE_PROTECTION_STILL_REQUIRED
PUBLIC_AUTH_PROVIDER_LEAKED_PASSWORD_ADVISOR=WARN_DISABLED_SUPABASE_FREE_PLAN
SUPABASE_CONTROL_PLANE_STATUS=ACTIVE_HEALTHY_VERIFIED_2026_10_02
SUPABASE_PRODUCT_RLS_POLICY_REVIEW=PASS_VERIFIED_OWNER_SPACE_PROJECT_SCOPES
SUPABASE_PRODUCT_DATA_API_ANON_GRANTS=NONE_VERIFIED
SUPABASE_PRODUCT_DATA_API_AUTHENTICATED_DIRECT_GRANTS=SELECT_ONLY_VERIFIED
SUPABASE_PRODUCT_MUTATIONS_DIRECT_DATA_API=DENIED_SERVER_AUTHORITATIVE
SUPABASE_SECURITY_ADVISOR_RLS_NO_POLICY=INFO_72_DENY_BY_DEFAULT_REVIEWED
PUBLIC_AUTH_ACTIVATION_PREFLIGHT=PASS_CI_SAFE_DISABLED
PUBLIC_AUTH_ACTIVATION_PREFLIGHT_WORKFLOW_RUN_ID=36166653490
PUBLIC_IDENTITY_NATIVE_SIGNED_GATEWAY_CONFIG=PASS_SOURCE
ACCOUNT_SYNC_BACKEND_V2=PASS_APPLIED_PRIVATE_RLS_INCREMENTAL
ACCOUNT_SYNC_WEB_DATA_CLASSES=APPEARANCE,PREFERENCES,WORKSPACE_METADATA
ACCOUNT_SYNC_CURRENT_READ_MODE=ATOMIC_SNAPSHOT_PLUS_PAGED_INCREMENTAL_CURSOR
ACCOUNT_SYNC_INCREMENTAL_CURSOR=PASS_APPLIED_AND_CLIENT_CHECKPOINTED
ACCOUNT_SYNC_CLIENT_INTEGRATION=PASS_SOURCE_WEB
ACCOUNT_SYNC_OFFLINE_RECONNECT=PASS_SOURCE_WEB_NATIVE
ACCOUNT_SYNC_OFFLINE_LOCAL_CHANGES_PRESERVED=PASS_SOURCE
ACCOUNT_SYNC_CHECKPOINT_SCOPE=SUBJECT_BOUND_DEVICE_WITH_SESSION_FALLBACK
ACCOUNT_SYNC_MULTI_DEVICE_E2E_PROOF=PENDING_REAL_CREDENTIALLED_EXECUTION
ACCOUNT_SYNC_TWO_CLIENT_PROOF_HARNESS=PASS_SOURCE_CREDENTIAL_SAFE_SANITIZED_RECEIPT
ACCOUNT_SYNC_TWO_CLIENT_PROOF_WORKFLOW=PASS_SOURCE_MANUAL_SECRETS_REQUIRED
ACCOUNT_SYNC_TWO_CLIENT_PROOF_RECEIPT_SCHEMA=prototype-ordax.account-sync-two-client-proof/1
ACCOUNT_AUTH_PROOF_WORKFLOWS_SOURCE_VALIDATION=PASS_CI_SOURCE_ONLY
ACCOUNT_AUTH_PROOF_WORKFLOWS_SOURCE_VALIDATION_RUN_ID=36167856584
ACCOUNT_GATEWAY_STABLE_BOOTSTRAP_BINDING=PASS_SOURCE_OPTIONAL_HTTPS_ORIGIN
ACCOUNT_SYNC_NATIVE_USB_INTEGRATION=PASS_SOURCE_GATEWAY_DEPLOYED_PHYSICAL_PROOF_PENDING
ACCOUNT_SYNC_ACCOUNT_UI_CONTINUITY_STATUS=PASS_SOURCE_REAL_RUNTIME_SNAPSHOT
ACCOUNT_SPACES_UI=PASS_SOURCE_READ_ONLY_WEB_NATIVE
ACCOUNT_SPACES_GATEWAY_SOURCE=V17_DEPLOYED_REV27
ACCOUNT_SPACES_RLS=OWNER_OR_ACTIVE_MEMBER
ACCOUNT_SPACES_MUTATION_UI=NONE
ACCOUNT_SYNC_PUBLIC_AVAILABILITY=NO
PUBLIC_IDENTITY=DISABLED_FAIL_CLOSED
BILLING=NO
PUBLIC_STORE=NO
PRODUCT_MCP_DEPLOYED=NO
FIRST_STABLE_MVP_USB_WRITE=HOLD_CANONICAL_V4_RELEASE_PROOF_PENDING
```

### System diagnostics and recovery presentation

Sistema now composes the existing Native diagnostic-review owner instead of passing a
null controller. The review remains explicit, local and sanitized, and can copy/export
only through the existing bounded adapters.

A separate `ordax.recovery-status/1` observer exposes factual Portable v2 state:
running slot/source, current, known-good, candidate/activation transaction and the
actual recovery loader entry on ORDAX-ESP. The recovery entry is not accepted by
presence alone; the observer checks the expected kernel/initramfs/portable-init and
`ordax.mode=recovery` markers. This port is intentionally read-only and exposes no
rollback, reboot, repair, network or mutation authority.

The MVP hardware support matrix is also now canonical in source. It explicitly says
that driver presence is not a support claim and that canonical Stable target hardware
still requires physical proof.

```text
DIAGNOSTICS_RECOVERY_PRESENTATION=PASS_SOURCE
RECOVERY_STATUS_AUTHORITY=READ_ONLY
RECOVERY_STATUS_PHYSICAL_PROOF=PENDING_PHYSICAL
SUPPORTED_HARDWARE_MATRIX=PASS_SOURCE
CANONICAL_STABLE_TARGET_HARDWARE_PROOF=PENDING_PHYSICAL
```

### Shared Surface localization

The Surface now owns `ordax.localization/1`, derived from the existing persisted
`regional.locale` preference rather than a second locale state. The shell is
created in the selected locale on its first frame and re-renders localized shell
copy without rebuilding windows or losing interaction state. English entries now
cover the shared shell, launcher, workspace/window chrome, connectivity labels and
first-party app metadata. Unsupported message IDs fail closed; locales without a
shared translation fall back to PT-BR source copy explicitly.

English is now marked as a complete Surface locale for the public MVP. Files covers its
primary navigation/search/list/selection/Recents/Trash journey, common forms, deep operational
feedback, locale-aware sorting, import/export, copy/move/rename/create-folder flows, preview and
Files → Notes presentation through the shared catalog.
Settings/System cover their section navigation/header copy, and System now also derives
its overview health/summary, memory and user-storage resource views, update transaction details/history, component/update scopes, About/versioning, capability inventory, Intelligence presentation, and the explicit sanitized diagnostic review from structured runtime state through the shared
localization owner. Runtime failure banners in these System flows now retain semantic message IDs and translate at render time, so changing locale does not preserve stale rendered PT-BR copy. Settings now also covers Appearance, Accessibility, Regional preferences,
physical keyboard layout and deep Network/Wi-Fi presentation in PT-BR/en-US through that same owner;
async keyboard/Wi-Fi feedback stores semantic message IDs rather than rendered copy, and Wi-Fi
credentials remain transient interaction state. Settings covers its Notifications policy/source and local-session
Security sections end to end, and the Native live session lock rerenders through the same
localization owner while keeping
the entered secret only in transient repaint memory. Account covers its complete
first-party overview/sync experience in English. Notes now covers its
primary navigation/editor shell, project/list states, core persistence copy,
locale-aware relative time, image/file-picker/checklist/reference flows, capacity/statistics,
prompts/confirmations and consultative Intelligence controls. Its picker/runtime failures retain
semantic message IDs and newly attached local-file metadata no longer persists translated system
labels. Internet now covers its primary browser shell,
locale-aware tab/address search, project context, home status, project references,
favorites/history and first-party operational feedback deeply in PT-BR/en-US. Its own
feedback is stored as semantic message identity so a live locale change does not preserve
stale rendered copy. The shared Home continuation/pending cards, power controls,
global update accelerator, desktop-clock fallback and Surface boot screen also use the shared
localization owner; first-party async feedback retains semantic message identity across live locale
changes. Network and battery tray/quick-panel presentation plus the Notification Center use
`ordax.localization/1` and rerender on locale changes. `ordax.notifications/3` keeps
backward-compatible text fallbacks while first-party update events persist bounded semantic
presentation identity, allowing stored update history to rerender in the active locale without
heuristic text translation. The public MVP selectors expose only PT-BR and en-US. Spanish, German
and French remain OOBE-complete compatibility/future-rollout locales and are not advertised as
complete Surface languages.

```text
SURFACE_LOCALIZATION_OWNER=PASS_SOURCE
SURFACE_SHARED_SHELL_EN_US=PASS_SOURCE
FILES_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
FILES_FORMS_SORT_EXPORT_PREVIEW_EN_US=PASS_SOURCE
SETTINGS_SYSTEM_NAV_EN_US=PASS_SOURCE
SYSTEM_OVERVIEW_SUMMARY_EN_US=PASS_SOURCE
SYSTEM_RESOURCE_VIEWS_EN_US=PASS_SOURCE
SYSTEM_UPDATE_DETAILS_HISTORY_EN_US=PASS_SOURCE
SYSTEM_COMPONENTS_ABOUT_EN_US=PASS_SOURCE
SYSTEM_CAPABILITIES_INTELLIGENCE_EN_US=PASS_SOURCE
SYSTEM_RUNTIME_FAILURE_COPY_EN_US=PASS_SOURCE
SYSTEM_DIAGNOSTIC_REVIEW_EN_US=PASS_SOURCE
SETTINGS_NOTIFICATIONS_EN_US=PASS_SOURCE
SETTINGS_SECURITY_EN_US=PASS_SOURCE
LOCAL_SESSION_LOCK_EN_US=PASS_SOURCE
ACCOUNT_EN_US=PASS_SOURCE
PROJECTS_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
NOTES_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
NOTES_DEEP_EN_US=PASS_SOURCE
NOTES_SEMANTIC_ASYNC_MESSAGES=PASS_SOURCE
INTERNET_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
INTERNET_DEEP_EN_US=PASS_SOURCE
INTERNET_SEMANTIC_FEEDBACK=PASS_SOURCE
NETWORK_TRAY_QUICK_PANEL_EN_US=PASS_SOURCE
BATTERY_TRAY_QUICK_PANEL_EN_US=PASS_SOURCE
NOTIFICATION_CENTER_EN_US=PASS_SOURCE
FIRST_PARTY_UPDATE_NOTIFICATION_HISTORY_EN_US=PASS_SOURCE
FILES_DEEP_EN_US=PASS_SOURCE
FILES_SEMANTIC_OPERATIONAL_MESSAGES=PASS_SOURCE
SHELL_DEEP_EN_US=PASS_SOURCE
MVP_PUBLIC_LOCALES=pt-BR,en-US
RETAINED_COMPATIBLE_LOCALES=es-ES,de-DE,fr-FR
SURFACE_COMPLETE_LOCALES=pt-BR,en-US
SETTINGS_DEEP_EN_US=PASS_SOURCE
SETTINGS_ASYNC_MESSAGE_IDENTITIES=PASS_SOURCE
SURFACE_EN_US_APP_CONTROLS=PASS_SOURCE
```

### Files safe removal

The Native Files owner now exposes `ordax.file-space/11` with recoverable
`trashEntry()`, `listTrash()` and `restoreTrashEntry()`. The trash payload and
metadata live in a private reserved namespace under the user root that is not valid
as a public logical file-space path. Same-filesystem removal uses no-clobber rename;
restore also uses no-clobber and refuses to overwrite a new item at the original
path. Cross-device trash is rejected rather than converted into an unsafe delete,
and symlinks remain outside the supported boundary. Recent-file references are
cleared when their item is trashed, while Project continuity is invalidated only
after the file operation succeeds. Permanent delete and empty-trash actions are not
part of this MVP flow.

```text
FILE_SPACE_SCHEMA=ordax.file-space/11
FILES_SAFE_REMOVAL=PASS_SOURCE
FILES_TRASH_RESTORE_NO_CLOBBER=YES
FILES_PERMANENT_DELETE_MVP=NO
FILES_TRASH_PHYSICAL_PROOF=PENDING
```

### Ordax Intelligence and local inference

Ordax Intelligence is now a first-class system service with stable contract `ordax.intelligence/1`; an Assistant UI is only a possible client. The Native composition now creates the provider-neutral `ordax.local-ai/1 -> ordax.intelligence/1` chain and exposes real consultative first-party consumers: Notes can request a bounded provenance-bearing summary without rewriting the note, and System can request an explanation using only local Surface capabilities/connectivity plus sanitized metrics. Neither consumer imports llama.cpp/Qwen directly, and both retain `authority=none` with tool execution disabled. The service therefore exists as a real system function in source rather than only a model/runtime test. The Stable v4 source handoff is now implemented: Portable v2 verifies `release-manifest/4`, resolves and mounts the content-addressed `local-ai-runtime.erofs` read-only, and Stable Base starts the loopback backend when the verified runtime is available. Intelligence/model failure remains non-boot-critical and degrades the capability instead of blocking boot, Surface, recovery, files or updates. Disposable QEMU/UEFI v4 boot and fallback are now PASS_CI; canonical Stable v4 signing/materialization and the later physical Stable/MVP proof remain separate release gates.

The initial source lock pins Qwen3.5-0.8B-Q4_0 by exact GGUF SHA-256/size and llama.cpp by exact source commit plus the reproducibly observed `llama-server` ELF SHA-256/size. The real `local-ai-runtime.erofs` is now CI-proven: the current source lock produced byte-identical A/B builds in one job, the EROFS was mounted read-only, the exact model loaded, eight real completion tokens were generated on loopback-only HTTP, and the same runtime produced a real `OK` chat completion inside the pinned Alpine 3.22.5 userspace used by Stable Base. The current candidate engine SHA-256 is `4a974691b9905b88cb46d97c85c2b035b33592a16cd0239ae4c6687f68799afe` (17,039,584 bytes); the current EROFS candidate SHA-256 is `b244056dad3609357e8a70433f53f41becacd8f3bd93da3d8b23f9e99d86e11a` (568,061,952 bytes). `prototype-ordax.release-manifest/4` already binds this payload to the canonical source lock and content-addressed AI runtime store. The Local AI candidate workflow now also owns a non-promotional integration gate that signs a v4 envelope with an ephemeral CI-only key, serves the three artifacts over loopback HTTPS, materializes them through `materialize-portable-v4`, revalidates them offline, and byte-compares the content-addressed stored AI EROFS with the real built runtime. This proves the real-byte protocol/materialization path without activation or physical media. Canonical v4 signing and exact prerelease materialization are now proven and bound; stable `latest` channel promotion and the real physical Stable USB proof remain pending.

```text
ORDAX_INTELLIGENCE_CONTRACT=ordax.intelligence/1
ORDAX_INTELLIGENCE_LAYER=SYSTEM
ASSISTANT_APP_OWNS_INTELLIGENCE=NO
LOCAL_AI_BACKEND_CONTRACT=ordax.local-ai/1
LOCAL_AI_STABLE_MVP_DISTRIBUTION_REQUIRED=YES
LOCAL_AI_BOOT_CRITICAL=NO
LOCAL_AI_MODEL_ARTIFACT_PINNED=YES
LOCAL_AI_ENGINE_ARTIFACT_PINNED=YES
LOCAL_AI_RELEASE_MANIFEST_V4=PASS_SOURCE
LOCAL_AI_CONTENT_ADDRESSED_ACQUISITION=PASS_SOURCE
LOCAL_AI_REAL_RUNTIME_EROFS=PASS_CI_ALPINE
LOCAL_AI_REAL_V4_MATERIALIZATION_CI_GATE=IMPLEMENTED_NON_PROMOTIONAL
LOCAL_AI_V4_QEMU_UEFI_PROOF=PASS_CI
LOCAL_AI_CANONICAL_SIGNED_STABLE_MATERIALIZATION=PENDING
LOCAL_AI_PHYSICAL_STABLE_MVP_PROOF=PENDING
```

### First run, regional preferences and physical keyboard

The Native/USB first-use flow is now implemented as a persistent device-owned OOBE rather than a presentation-only screen. It follows `welcome -> regional -> network -> security -> account -> privacy -> ready`, stores completion separately from preferences, local-session credentials and online identity, and does not dismiss until durable state has been written. The Security step can configure an optional offline PIN/passphrase through `ordax.local-session/1`; the secret stays transient in Surface memory and never enters `first-run.json`. When configured, the Native host stores only a salted scrypt verifier in private device state and a new Surface session starts locked. The lock keeps the existing Workspace mounted but makes the Surface inert until local authentication succeeds. This is explicitly a session gate, not USB file encryption. The MVP always offers a local-only route: account creation/sign-in is optional and capability-driven, provider unavailability does not block first use, and cloud sync is not an MVP requirement. Network setup is skippable and reuses the existing Native network-management port; Wi-Fi credentials remain transient and do not enter first-run state.

Regional choices are real persisted preferences. The first-use OOBE retains translations for `pt-BR`, `en-US`, `es-ES`, `de-DE` and `fr-FR`, while the public MVP selectors expose only `pt-BR` and `en-US`; both are complete across the shared Surface. Spanish, German and French remain accepted compatibility/future-rollout locales with translated OOBE source but are hidden from the public selectors until their Surface coverage reaches the same launch standard. PT-BR remains the source/default locale. The default time zone is `America/Bahia`, and locale/time zone remain editable later under **Ajustes -> Idioma e região**. Physical keyboard layout is a separate Native device capability, not a Web preference: `br-abnt2` is the Stable/MVP default and `us` is the alternative. The selected layout is stored privately on the USB and mapped to fixed `XKB_DEFAULT_*` values before Cage starts. Arbitrary XKB values and shell input from HTTP are rejected. When the configured layout differs from the layout already applied to the running compositor, Ajustes reports that a new Surface start is required; no fake live-switch behavior is claimed. The OOBE keyboard selector intentionally remains hidden until a safe current-session application or pre-Surface handoff exists.

```text
FIRST_RUN_OOBE=PASS_SOURCE_NATIVE_USB
FIRST_RUN_PERSISTENT=YES
FIRST_RUN_ACCOUNT_OPTIONAL=YES
FIRST_RUN_LOCAL_ONLY_ALWAYS_AVAILABLE=YES
FIRST_RUN_NETWORK_SKIPPABLE=YES
FIRST_RUN_SOURCE_LOCALE=pt-BR
FIRST_RUN_OOBE_COMPLETE_LOCALES=pt-BR,en-US,es-ES,de-DE,fr-FR
SURFACE_LOCALIZATION_OWNER=PASS_SOURCE
SURFACE_SHARED_SHELL_EN_US=PASS_SOURCE
FIRST_RUN_FULL_SURFACE_TRANSLATIONS=PT_BR_EN_US_COMPLETE_ES_DE_FR_HIDDEN_MIGRATING
FIRST_RUN_DEFAULT_TIME_ZONE=America/Bahia
FIRST_RUN_WEB_DEVICE_OOBE=NO
KEYBOARD_LAYOUT_NATIVE=PASS_SOURCE
KEYBOARD_LAYOUT_DEFAULT=br-abnt2
KEYBOARD_LAYOUT_ALTERNATIVE=us
KEYBOARD_LAYOUT_WEB_CAPABILITY=NO
KEYBOARD_LAYOUT_LIVE_RECONFIGURE=NO
KEYBOARD_LAYOUT_FIRST_RUN_SELECTOR=NO_GATED_ON_SAFE_APPLY
KEYBOARD_LAYOUT_PHYSICAL_STABLE_MVP_PROOF=PENDING
EARLY_BOOT_GRAPHICAL_SPLASH=NO_CONSOLE_TEXT
```

On the target notebook, the owner/development USB has physically proven the Git-first native host: Cage/Wayland + Barkery/WebKitGTK renders the shared Surface fullscreen; keyboard and mouse/touchpad work; authenticated native restart and shutdown work; and Git changes can be pulled and applied with a Surface reload while the notebook remains running. The temporary live-update marker appeared and then disappeared automatically in the same running session, proving the rebootless update round trip.

The Git-first update path is now split between a stable `system/entrypoint` guardian and a child `system/supervisor`. Ordinary Surface changes reload the browser, native-host changes restart only the Surface, supervisor/guardian changes use a controlled supervisor restart, and boot/bootstrap changes are marked as requiring a later reboot instead of rebooting automatically. The guardian monitors the supervisor's state-file heartbeat and can restart a stalled supervisor child without returning to the Development Base maintenance shell. The controlled `exit 75 -> guardian refresh -> supervisor restart` path has been physically exercised on the target notebook.

Recovery no longer depends on that supervisor alone. A persistent, bounded `ordax-rescue` agent lives under `/state/ordax/rescue/` and consumes only target-bound, monotonic commands from the separate Git rescue ref. The physical notebook has acknowledged multiple rescue generations, including no-op generations while healthy. The rescue protocol does not provide remote shell, arbitrary commands, reboot, poweroff or arbitrary Git reset.

Operational observability is also physically active through the temporary Supabase relay. A host-base telemetry agent starts before the graphical runtime and reports checkout SHA, human `deliveryNumber`, pending `bootRefreshRequired`, updater state, health state, rescue generation/action, power-action proof fields and a supervisor state-file heartbeat. The deployed relay configuration is source-controlled. Supabase is observation-only and has no command semantics. This allowed the recovery from the stale `d071477a` graphical session to be diagnosed and verified without relying on the visible screen.

A native-host update delivered through the live Git path has been physically validated to restart only the Surface and return to the graphical session without rebooting the notebook. Candidate Git objects are now preflighted before switching the live checkout, and the valid-candidate success path has been physically exercised; rejection/rollback of an intentionally broken candidate remains a separate physical exercise. The development Base channel also materializes an exact-commit `rootfs.tar` into a versioned root. Acquisition is delegated by the supervisor to the persistent base-update owner and runs inside the replaceable native runtime, so the minimal development Base does not gain a Python dependency. The Git-refreshable `ordax-dev-init` then selects that root only when its SHA matches the one-shot A/B candidate slot. The mapping is per slot and preserves the seed Base as the legacy fallback. The selector/materializer is source/CI work only: `dev-base-ready-sha` is not yet consumed by an ESP staging/one-shot activation owner, so this change does not arm a boot candidate. Disposable selector proof, authorized A/B staging and broken-candidate physical rollback remain separate gates; none is claimed as physical proof here. The durable offline sync-state store is implemented and CI-proven; survival of a deliberately created pending mutation across a later explicit Surface restart remains a separate physical persistence exercise.

These development-USB results do **not** imply that the canonical signed release-acquisition/native-disk product path is complete. `GRAPHICAL_SURFACE_COMPLETE` and `CANONICAL_SYSTEM_RUNTIME_COMPLETE` remain `NO` until their separate product gates close.

## Development USB — physically proven path

```text
OWNER_DEVELOPMENT_USB_BOOT=PASS
DEVELOPMENT_GIT_CHECKOUT=PASS
DEVELOPMENT_NETWORK_FOR_GIT=PASS
REPLACEABLE_NATIVE_RUNTIME=PASS
CAGE_WAYLAND_RENDER=PASS
BARKERY_WEBKIT_RENDER=PASS
PHYSICAL_KEYBOARD=PASS
PHYSICAL_MOUSE_TOUCHPAD=PASS
NATIVE_RESTART=PASS
NATIVE_SHUTDOWN=PASS
RETURN_BOOT_AFTER_SHUTDOWN=PASS
GIT_HOT_UPDATE_RELOAD=PASS
GIT_HOT_UPDATE_ROUND_TRIP=PASS
GUARDIAN_SUPERVISOR_RESTART=PASS
INDEPENDENT_GIT_RESCUE=PASS
HOST_BASE_REMOTE_TELEMETRY=PASS
CANDIDATE_PREFLIGHT_VALID_PATH=PASS
USB_REFLASH_REQUIRED_FOR_NORMAL_SYSTEM_CHANGES=NO
SSH_REQUIRED=NO
REMOTE_CONTROL_PLANE_REQUIRED=NO
```

The physical evidence is recorded in `docs/evidence/physical-native-surface-2026-09-17.md`. The original BusyBox `command -v` handoff failure was corrected in PR #21 and subsequent owner/development USB boots progressed through the Git checkout into the graphical Surface, so that historical bring-up blocker is closed for this development path.

## Build autonomy

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
PINNED_KERNEL_BUILD_ENVIRONMENT=PASS
KERNEL_REPEAT_DIGEST_PROOF=PASS
GITHUB_ACTIONS_IMMUTABLE_SHA_POLICY=PASS
GITHUB_ACTIONS_MUTABLE_TAGS=FORBIDDEN
GITHUB_ACTIONS_UNKNOWN_EXTERNAL_REFS=FORBIDDEN
GITHUB_ACTIONS_PULL_REQUEST_TARGET=FORBIDDEN_BY_DEFAULT
BASE_UPDATE_FAT32_STAGING_PROOF=PASS_DISPOSABLE_CI
```

GitHub Actions remains the current build/proof executor; repository recipes are source authority. Kernel/build reproducibility, Action pinning and deterministic real-`system/` bundling remain CI-proven. The current A/B base staging code is also exercised on a disposable FAT32 loop image: the proof preserves current/recovery entries and the active slot, writes and verifies the inactive candidate, unmounts, runs read-only `fsck.vfat`, remounts and re-verifies bytes. That proof is explicitly filesystem-staging-only: it does not exercise canonical release trust, authorize physical writes, activate a candidate or prove notebook boot. CI proof does not authorize destructive physical writes or substitute for hardware validation.

## Physical architecture

The capacity-independent bootstrap seed and the current transitional USB prepared by Creator are different artifacts and must not be collapsed into one partition count:

```text
BOOTSTRAP_SEED_PARTITIONS=2
BOOTSTRAP_SEED_PARTITION_NAMES=ORDAX-ESP,ORDAX
SEED_PARTITION_1_FILESYSTEM=FAT32
SEED_PARTITION_2_FILESYSTEM=EXT4
PREPARED_USB_PARTITIONS=3
PREPARED_USB_PARTITION_NAMES=ORDAX-ESP,ORDAX,ORDAX-DATA
PREPARED_PARTITION_1_FILESYSTEM=FAT32
PREPARED_PARTITION_2_FILESYSTEM=EXT4
PREPARED_PARTITION_3_FILESYSTEM=EXFAT
SEPARATE_HOME_PARTITION=NO
LEGACY_ORDAX_PLATFORM_PARTITION=FORBIDDEN
LEGACY_ORDAX_HOME_PARTITION=FORBIDDEN
```

`docs/contracts/physical-media.json` is authoritative for the two-partition capacity-independent seed (`ORDAX-ESP` + `ORDAX`). `docs/contracts/physical-prepared-media.json` is authoritative for the current **transitional Owner/Development** prepared USB (`ORDAX-ESP` + bounded `ORDAX` + target-capacity-specific `ORDAX-DATA`). These counts describe different validation artifacts and are not the final Stable/MVP layout. The legacy/transitional release tree remains validation-only and must not become the public MVP default.

The durable MVP target is portable USB v2:

```text
ORDAX-ESP   FAT32
ORDAX-DATA  exFAT
  -> .ordax/base/stable-base.erofs
  -> .ordax/releases/<commit>/system.erofs
  -> .ordax/releases/<commit>/surface-runtime.sha256
  -> .ordax/runtimes/sha256/<runtime-sha256>/native-surface-runtime.erofs
  -> .ordax/state/persistent-state.img   # ext4-in-file
```

Mutable activation authority (`current`, `known-good`, `candidate`, `rejected` and `activation-transaction.json`) lives inside the ext4 persistent-state image, never as a mutable exFAT symlink/pointer. Portable v2 remains the storage/bootstrap compatibility shape; the current Stable/MVP candidate uses signed `release-manifest/4`, binding `system.erofs`, the content-addressed Surface runtime and the content-addressed Local AI runtime/source-lock identity. `release-manifest/3` remains a verified compatibility baseline for pre-v4 devices and for the already-proven v3 activation evidence; it is not the current MVP release shape. The Stable Base remains a separate immutable minimal OS EROFS. The fixed initramfs candidate owns exact release selection, capsule/Base verification, system/runtime EROFS mounts and the read-only-to-ephemeral OverlayFS handoff; signature authority remains in the bootstrap-owned release agent. The Stable supervisor is v4-aware: it inspects the signed manifest schema, selects exact v3 or v4 materialization/verification, blocks v3 downgrade after a v4 boot, and preserves the one-shot `candidate -> cold-health -> commit/rollback` lifecycle. The dedicated disposable QEMU/UEFI v4 proof now proves boot handoff with the Local AI runtime plus safe fallback, while the older v3 one-shot proof remains compatibility evidence for candidate rejection/rollback behavior. This still does **not** prove cold-health commit, physical Stable/MVP USB boot, Secure Boot, physical known-good or physical rollback. The graphical cold-health path is intentionally not synthesized in CI: the actual product path requires Cage/Wayland/WebKit/seatd plus the native host and Surface heartbeat/health handshake with the exact release SHA, and no equivalent headless product mode is currently implemented.

```text
PORTABLE_USB_V2_STORAGE_PROOF=PASS_CI_DISPOSABLE
PORTABLE_RELEASE_EROFS_REPRODUCIBLE=PASS_CI
PORTABLE_RELEASE_MANIFEST_V2_SIGN_VERIFY=PASS_CI_COMPATIBILITY
PORTABLE_RELEASE_MANIFEST_V3_SIGN_VERIFY=PASS_CI_COMPATIBILITY
PORTABLE_RELEASE_V3_CONTENT_ADDRESSED_RUNTIME=PASS_CI_COMPATIBILITY
PORTABLE_RELEASE_MANIFEST_V4_SIGN_VERIFY=PASS_CI_CURRENT_MVP
PORTABLE_RELEASE_V4_LOCAL_AI_CONTENT_ADDRESSED_RUNTIME=PASS_CI
PORTABLE_RELEASE_OFFLINE_EXACT_VERIFY=PASS_CI_V2_V3_V4
PORTABLE_MOUNT_HANDOFF_PROOF=PASS_CI_DISPOSABLE
PORTABLE_BOOTSTRAP_CAPSULE_REPRODUCIBLE=PASS_CI
PORTABLE_INITRAMFS_HELPERS=PASS_CI
PORTABLE_SURFACE_RUNTIME_APK_LOCK=PASS_CI_253_EXACT_PACKAGES
PORTABLE_SURFACE_RUNTIME_EROFS_REPRODUCIBLE=PASS_CI
PORTABLE_SURFACE_RUNTIME_EROFS_SHA256=5b44729139777b610c300864d6f41c0580a3d6ca0b694b8dc53e38f505f99236
PORTABLE_SURFACE_RUNTIME_BOOT_CONNECTED=PASS_CI_RUNTIME_V3_HANDOFF
PORTABLE_STABLE_RUNTIME_V3_HANDOFF_PROVEN=PASS_CI_DIRECT_KERNEL_AND_UEFI
PORTABLE_STABLE_GRAPHICAL_SURFACE_OFFLINE_PROVEN=NO_PHYSICAL_GRAPHICAL_EXERCISE_PENDING
PORTABLE_STABLE_BOOT_APK_INSTALL_ALLOWED=NO
PORTABLE_V3_UPDATE_ACTIVATION_SOURCE=CONNECTED_ONE_SHOT_REBOOT_COLD_HEALTH
PORTABLE_V3_UPDATE_BASELINE_QEMU_REGRESSION=PASS_CI_CURRENT_MAIN_DIRECT_AND_UEFI
PORTABLE_V3_UPDATE_ACTIVATION_QEMU_ONE_SHOT_PROOF=PASS_CI_DISPOSABLE_EXACT_SOURCE
PORTABLE_V3_UPDATE_ONE_SHOT_PROVEN_SOURCE_COMMIT=837a99733654943f08a400d6cc3fb28bf84605f8
PORTABLE_V3_UPDATE_ONE_SHOT_WORKFLOW_RUN_ID=35607396175
PORTABLE_V3_UPDATE_ONE_SHOT_PROOF_ARTIFACT_SHA256=57712b1364b5e6ee2efc44645238abc21e50d531fa41f6936f7674465cdf5a23
PORTABLE_V3_UPDATE_COLD_HEALTH_COMMIT_PROOF=PENDING
PORTABLE_V3_UPDATE_ACTIVATION_PHYSICAL_PROOF=NO
PORTABLE_V3_REJECTED_SHA_PERSISTED=PASS_CI_DISPOSABLE_ONE_SHOT
PORTABLE_SURFACE_RUNTIME_EPHEMERAL_OVERLAY=/run
PORTABLE_PINNED_INITRAMFS_COMPOSITION=PASS_CI
PORTABLE_QEMU_DIRECT_KERNEL_BOOT=PASS_CI_RUNTIME_V3
PORTABLE_QEMU_UEFI_BOOT=PASS_CI_RUNTIME_V3_OVMF_NON_SECURE_BOOT
PORTABLE_RUNTIME_V3_LAST_PROVEN_SOURCE_COMMIT=c8c8fe526d03ced7630420cd116dd954b08ef03a
PORTABLE_RUNTIME_V3_LAST_PROVEN_WORKFLOW_RUN_ID=35598937763
PORTABLE_RUNTIME_V3_PROOF_ARTIFACT_SHA256=73e7db317b1983f7cdf7f5be369b9e7d0509a8932235318176166d1469ca2bc3
PORTABLE_RUNTIME_V3_QEMU_DIRECT_KERNEL_BOOT=PASS_CI
PORTABLE_RUNTIME_V3_QEMU_UEFI_BOOT=PASS_CI_OVMF_NON_SECURE_BOOT
PORTABLE_QEMU_NETWORK_REQUIRED=NO
PORTABLE_QEMU_PHYSICAL_TARGET_TOUCHED=NO
PORTABLE_QEMU_SECURE_BOOT=NO
PORTABLE_PHYSICAL_USB_BOOT=NO
PORTABLE_V2_PUBLIC_WRITER_ENABLED=NO
```

The offline Stable/MVP graphical runtime is a separate EROFS artifact with a full 253-package Alpine lock and repeat-digest proof. It deliberately excludes generated machine identity and Fontconfig caches from signed bytes. Release-manifest/3 binds that runtime by SHA-256, Creator preseeds the content-addressed bytes, the candidate PID1 re-verifies v3 offline and mounts the runtime read-only beneath an ephemeral OverlayFS in `/run`, and the Stable launcher refuses boot-time `apk add` provisioning. The exact runtime-v3 handoff was proven at source `b9e1b164d7510f2dfc7572e473642b8fb885fa8c` in both direct-kernel QEMU and non-Secure-Boot OVMF/UEFI with networking disabled and no physical target touched. **This proves the signed offline runtime handoff, not a complete graphical Surface session on real hardware; the final Stable/MVP USB graphical boot remains a physical validation gate.**

Portable v2 itself has now crossed the CI boot-handoff gate with the final two-partition layout: the direct-kernel QEMU proof and the UEFI/OVMF + systemd-boot proof both reached `ORDAX_PORTABLE_V2_HANDOFF=VERIFIED` and `ORDAX_STABLE_INIT_HANDOFF=VERIFIED`, selected the exact `current` slot/source identity, ran with QEMU networking disabled, destroyed disposable guest state afterward and did not touch a physical target device. The UEFI proof uses non-Secure-Boot OVMF; **Secure Boot and physical USB boot remain unproven**.

CI proof remains distinct from physical boot evidence and does not authorize the public writer.

## Minimal bootstrap and canonical release path

The product bootstrap/release architecture remains distinct from the owner/development USB Git path.

```text
FULL_SYSTEM_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
REMOTE_CORE_PRESEEDED=NO
CONTROL_PLANE_PRESEEDED=NO
SSH_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
KNOWN_GOOD_OFFLINE_BOOT_REQUIRED=YES
RELEASE_BUNDLE_TOOLING_IMPLEMENTED=YES
DETERMINISTIC_SYSTEM_TAR=PASS
REAL_REPOSITORY_SYSTEM_BUNDLE=PASS
RELEASE_MANIFEST_TOOLING_IMPLEMENTED=YES
RELEASE_SIGNING_TOOLING_IMPLEMENTED=YES
RELEASE_PIPELINE_CI=PASS
RELEASE_AGENT_CANONICAL_SHA256=550df685679f1bf15a636729960fe6fc3ffc1afda1a346214ce96716f7170a66
RELEASE_AGENT_HASH_ADDRESSED_ASSET_PUBLISHED=YES
RELEASE_AGENT_PUBLICATION_RELEASE_ID=393818764
RELEASE_AGENT_PUBLICATION_SOURCE_COMMIT=3db77f679b85f8f62a87ce8aab3414c9c12f688a
RELEASE_AGENT_LEGACY_SEED_SHA256=721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740
PRODUCTION_RELEASE_PUBLISHED=NO
CANONICAL_GITHUB_LATEST_RELEASE=NONE_404_VERIFIED_2026_09_25
CANONICAL_GITHUB_RELEASES_CURRENT=PRERELEASE_TECHNICAL_ONLY_VERIFIED_2026_09_25
SIGNED_TRUST_TRANSITION_PROTOCOL=PASS_CI_SIGNER_AGENT
TRUST_TRANSITION_SIGNER_VERIFIER=PASS_CI
TRUST_TRANSITION_RELEASE_AGENT_VERIFIER=PASS_CI
TRUST_TRANSITION_SIGNER_AGENT_WORKFLOW_RUN_ID=35640416446
TRUST_TRANSITION_RELEASE_AGENT_WORKFLOW_RUN_ID=35640416481
TRUST_TRANSITION_STATEFUL_DEVICE_ACTIVATION=NO
BOOTSTRAP_EFFECTIVE_ROTATED_TRUST_SELECTION=NO
PRODUCTION_ROTATION_READY=NO
PUBLIC_TRUST_PROMOTION_TOOL=IMPLEMENTED_FAIL_CLOSED
PUBLIC_TRUST_PROMOTION_CANONICAL_INPUT=OrdaX-Public-Trust-Handoff.zip
PUBLIC_TRUST_PROMOTION_ZIP_CHECK=PASS_CI
PUBLIC_TRUST_PROMOTION_ZIP_APPLY_ISOLATED=PASS_CI
PUBLIC_TRUST_PROMOTION_WORKFLOW_RUN_ID=35642338419
PUBLIC_TRUST_PROMOTION_PHYSICAL_WRITE_SIDE_EFFECT=NO
FULL_BOOTSTRAP_CANONICAL_TRUST_PROOF=PASS_MAIN
FULL_BOOTSTRAP_CANONICAL_TRUST_WORKFLOW_RUN_ID=35661774796
FULL_BOOTSTRAP_CANONICAL_TRUST_PROOF_ARTIFACT_SHA256=079aad05492867000989fa2c2768b8a29354f9458fa0d791171f4ed02dbe3d0b
```

The canonical release channel resolves `release-envelope.json`; the URL selects bytes and Ed25519 verification decides authenticity. The release acquisition code remains fail-closed with SHA-256 verification, exact source-commit binding, safe materialization, atomic activation and known-good preservation.

### Canonical release trust — public anchor and v4 candidate proof bound; physical consent pending

```text
RELEASE_TRUST_POLICY=RESOLVED
TRUST_POLICY_SCHEMA=prototype-ordax.release-trust-policy/1
CANONICAL_KEY_ID=ordax-prototype-release-v1
CANONICAL_KEY_MATERIAL_GENERATED=YES
CANONICAL_PUBLIC_TRUST_SHA256=d2836df77a3d5a54ccf64cc5643cfd5c19052efc83f2e3e2666c6d3197fce250
CANONICAL_TRUST_RECOVERY_VERIFIED=YES
PUBLIC_ANCHOR_PINNED=YES
RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED
PRIVATE_SIGNING_KEY_IN_GIT=FORBIDDEN
PRIVATE_SIGNING_KEY_IN_USB=FORBIDDEN
PRIVATE_KEY_CUSTODY_OWNER=repository-owner-developer
RELEASE_SIGNING_BACKEND_CURRENT=LOCAL_PEM_CONTROLLED_PROTOTYPE
RELEASE_SIGNING_BACKEND_PRODUCTION_TARGET=MANAGED_NON_EXPORTABLE_KMS_HSM
GITHUB_IS_KEY_CUSTODIAN=NO
MANAGED_KMS_HSM_REQUIRED_FOR_FIRST_PHYSICAL_PROOF=NO
SIGNED_TRUST_ROTATION_REQUIRED_BEFORE_BROAD_PUBLIC_DISTRIBUTION=YES
RECOVERY_PUBLIC_HANDOFF_SHA256=85d4f8430f0a4066ebed84a410071409c112c65aa72a5818483a664a41b91e20
LOCAL_ENCRYPTED_BACKUP_COPY_VERIFIED=YES
EXTERNAL_OFFLINE_BACKUP_CUSTODY_CONFIRMED=NO
EXTERNAL_OFFLINE_BACKUP_REQUIRED_BEFORE_BROAD_DISTRIBUTION=YES
PUBLIC_TRUST_PROMOTION=PASS_PUBLIC_HANDOFF_VALIDATED
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=YES
PHYSICAL_AUTHORIZATION_ELIGIBLE_BY_TRUST=YES
CANONICAL_V4_HISTORICAL_SOURCE_COMMIT=b924ff8d74d1761232381ae3f9604bba17497cfd
CANONICAL_V4_RELEASE_STATUS=PUBLIC_PRERELEASE_NOT_LATEST_HISTORICAL
CANONICAL_V4_RELEASE_PROOF_HISTORY=PASS_SIGNED_MATERIALIZED_EXACT_PRE_HARDENING
CANONICAL_V4_RELEASE_PROOF_HISTORY_SHA256=2dd17580ddbf5a0fd0433a912e97e6bded04fd0a44ea0849e9da15e13df01e4b
CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN=PENDING_POST_HARDENING_REPLACEMENT
CANONICAL_V4_RELEASE_PROOF_BINDING_CURRENT_MAIN=NO
PHYSICAL_OWNER_AUTHORIZATION_RECORDED=NO
PHYSICAL_OWNER_AUTHORIZATION_REACHABLE=NO_REPLACEMENT_PROOF_REQUIRED
PHYSICAL_WRITE_ALLOWED=NO_CANONICAL_V4_RELEASE_PROOF_PENDING
PHYSICAL_WRITE_SCOPE=first-real-stable-mvp-usb-proof
PHYSICAL_WRITE_RELEASE_SEQUENCE=1
PHYSICAL_TARGET_SELECTED=NO
PHYSICAL_TARGET_DESTRUCTIVE_CONFIRMATION=PENDING
```

The eligible Windows trust toolkit from canonical `main` source `2172eb6a18430910afd036199ec492ad63dc185d` (workflow run `35617567458`) completed operator steps 1, 2 and 3 on 2026-09-21. The uploaded `OrdaX-Public-Trust-Handoff.zip` was then independently revalidated: archive shape, exact public hashes and the recovered Ed25519 signing proof all passed. The exact public anchor is pinned at `bootstrap/trust/release-ed25519.json`, and the minimal bootstrap trust group is resolved. The private key remains outside Git/USB/Actions artifacts and is not recorded here. A same-host encrypted backup copy was verified byte-for-byte; this is accepted for the first controlled prototype but is not independent off-device custody, which remains required before broad public distribution. Public trust promotion itself did not authorize destructive media writes. On 2026-09-22 the owner provided the exact Stable/MVP authorization phrase for scope `first-real-stable-mvp-usb-proof`, release sequence 1, bound to the then-current 15-artifact writer context; later writer changes invalidated that consent. On 2026-09-26 the exact v4 candidate was signed, published as a prerelease, materialized and verified by the source-owned agent, aggregated with the signed-handoff proof, and bound to the physical authorization contract. The proof binds source commit `b924ff8d74d1761232381ae3f9604bba17497cfd`, manifest SHA-256 `ddab1681ffecacca000ff1014d3b354978c1f4a785985998b673816e18e65b85`, envelope SHA-256 `cc89cf7436357c5d479624d74e32325d4eb249a6fc1334385fb55827c313f5c9` and proof SHA-256 `2dd17580ddbf5a0fd0433a912e97e6bded04fd0a44ea0849e9da15e13df01e4b`. The prerelease did not move GitHub's stable `latest` channel. The current writer change invalidates the previously recorded owner consent, so the authorization contract is fail-closed with `physical_write_allowed=false`; fresh explicit owner authorization is required before any target-specific preparation or application. No USB is selected or currently authorized for a new destructive write; live USB revalidation, Windows UAC and target-specific destructive confirmation remain later independent gates.

## Creator and physical-write boundary

```text
CREATOR_CORE_IMPLEMENTED=YES
CREATOR_COMPONENT_CHANNEL_STATUS=CANDIDATE_ENABLED
CREATOR_COMPONENT_PUBLICATION_ALLOWED=NO
CREATOR_VERIFY_PAYLOAD_IMPLEMENTED=YES
CREATOR_STAGE_TREE=IMPLEMENTED_TRANSACTIONAL
CREATOR_DISPOSABLE_GPT_FILESYSTEM_PROOF=PASS
CREATOR_WINDOWS_TARGET_DISCOVERY=PASS
CREATOR_WINDOWS_SYSTEM_DISK_EXCLUSION=PASS
CREATOR_WINDOWS_NATIVE_RAW_DISK_BACKEND=PASS_TAGGED_UNBOUND
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG=ordax_raw_backend
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG_ISOLATION=PASS
CREATOR_WINDOWS_RAW_BACKEND_IN_PUBLIC_BUILD=NO
CREATOR_NATIVE_BACKEND_PUBLICLY_REACHABLE=NO
CREATOR_PORTABLE_PHYSICAL_WRITER_IMPLEMENTED=YES_TAGGED_INTERNAL
CREATOR_PORTABLE_PHYSICAL_WRITER_OPERATION_COUNT=39
CREATOR_PORTABLE_PHYSICAL_WRITER_ARTIFACT_READBACKS=17
CREATOR_PORTABLE_PHYSICAL_WRITER_WHOLE_DISK_RAW=NO
CREATOR_PORTABLE_PHYSICAL_WRITER_UAC_REQUIRED=YES
CREATOR_PORTABLE_PHYSICAL_WRITER_LIVE_USB_REVALIDATION=YES
CREATOR_PUBLIC_PHYSICAL_APPLY_IMPLEMENTED=NO
PHYSICAL_WRITE_AUTHORIZED=NO_EXPLICIT_OWNER_AUTHORIZATION
PHYSICAL_TARGET_SELECTED=NO
PHYSICAL_TARGET_DESTRUCTIVE_CONFIRMATION=PENDING
```

The Windows destructive backend remains compile-time isolated behind `ordax_raw_backend` and unreachable from the public Creator command. The final Portable writer is now implemented inside that tagged boundary: it executes the Core-owned 39-operation `ORDAX-ESP + ORDAX-DATA` plan, with 17 exact artifacts including the Local AI runtime and its signed-release digest reference, and performs per-artifact sync/readback SHA-256+size verification without a target-sized whole-disk RAW image. **Implementation alone does not authorize use.** Canonical v4 trust, proof and source bindings resolve, but the current writer change invalidates the previously recorded owner authorization. Fresh explicit owner consent must be recorded against the current authorization context before a destructive candidate can be prepared or applied. The candidate release is a prerelease and has not moved the stable `latest` channel. Public reachability remains closed, and choosing/revalidating a concrete USB plus Windows UAC and the target-specific destructive confirmation remain separate execution gates.

The byte-complete media workflow remains proven with ephemeral CI trust and disposable media only. That proof establishes composition and growth behavior; it does not establish canonical public trust or authorize a product-media write. The notebook development-USB boot is a separate physical proof and must not be used to collapse those boundaries.

## Recovery

```text
RECOVERY_ENTRY=YES
RECOVERY_ORDAX_MOUNT=READ_ONLY
RECOVERY_AUTOMATIC_NETWORK=NO
RECOVERY_SSH=NO
RECOVERY_AUTOMATIC_MUTATION=NO
RECOVERY_PHYSICAL_EXERCISE=PENDING_FINAL_VALIDATION
```

## Host independence and remote access

```text
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
POWERSHELL_REQUIRED=NO
BASH_REQUIRED=NO
SPECIFIC_DEVELOPER_DESKTOP_OS_REQUIRED=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
THIN_HOST_ADAPTERS_ALLOWED=YES
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

## Physical state

```text
OWNER_DEVELOPMENT_USB_PRESENT=YES
PHYSICAL_NOTEBOOK_BOOT_PROVEN=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_GRAPHICS=PASS_DEVELOPMENT_USB
PHYSICAL_PRIMARY_INPUT=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_RESTART=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_SHUTDOWN=PASS_DEVELOPMENT_USB
PHYSICAL_LIVE_UPDATE=PASS_DEVELOPMENT_USB
PHYSICAL_GUARDIAN_SUPERVISOR=PASS_DEVELOPMENT_USB
PHYSICAL_RESCUE_CHANNEL=PASS_DEVELOPMENT_USB
PHYSICAL_TELEMETRY_RELAY=PASS_DEVELOPMENT_USB
CANONICAL_SIGNED_RELEASE_BOOT_PROVEN=NO_PHYSICAL_STABLE_MVP_PENDING
CANONICAL_NATIVE_DISK_INSTALL_PROVEN=NO_POST_MVP
CREATOR_PUBLIC_PHYSICAL_APPLY_IMPLEMENTED=NO
RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED
PHYSICAL_AUTHORIZATION_ELIGIBLE=NO_REPLACEMENT_CANONICAL_V4_PROOF_REQUIRED
PHYSICAL_WRITE_AUTHORIZED=NO_CANONICAL_V4_RELEASE_PROOF_PENDING
PHYSICAL_TARGET_SELECTED=NO
PHYSICAL_TARGET_DESTRUCTIVE_CONFIRMATION=PENDING
MVP_SURFACE_SMOKE_HARNESS=PASS_SOURCE
MVP_SURFACE_SMOKE_TOUR_ITEMS=12
MVP_SURFACE_SMOKE_ACCOUNT_MEMORY=REQUIRED_WITHOUT_ONLINE_LOGIN_DEPENDENCY
MVP_SURFACE_SMOKE_PHYSICAL=PENDING
CANONICAL_STABLE_GRAPHICAL_MODE=PENDING
PUBLIC_PHYSICAL_APPLY=NO
```

Do not reinterpret `PASS_DEVELOPMENT_USB` as canonical release/install proof. The proven target today is the owner/development Git-first USB on the tested notebook.

The source-controlled Stable/MVP physical smoke harness is now ready for the verified Stable runtime and remains non-promotional until executed on the real Stable/MVP USB. The running Surface publishes a private ephemeral proof context, and the harness fails closed unless that context identifies the exact Owner/Development dynamic runtime or `stable-mvp + verified-erofs-overlay + canonical-stable-mvp` with its verified runtime SHA-256. The Stable graphical runtime no longer depends on or mounts a Git repository. The smoke also checks configured/applied physical keyboard state, preserves baseline/after comparison, rejects mixed runtime evidence, and requires all 12 manual tour items — including Account/Memory without requiring an online login — plus a fresh fail-closed finalization. This is source/CI readiness only: `MVP_SURFACE_SMOKE_PHYSICAL=PENDING` and `CANONICAL_STABLE_GRAPHICAL_MODE=PENDING` remain authoritative until real hardware evidence exists.

## Deferred/final physical validation

The following are intentionally left for later/final hardware validation rather than blocking current product development:

```text
SURFACE_ONLY_NATIVE_HOST_RESTART_PHYSICAL=PASS_DEVELOPMENT_USB
SUSPEND_RESUME=PENDING_FINAL
AUDIO=PENDING_FINAL
GRAPHICS_ACCELERATION_QUALITY=PENDING_FINAL
LONG_RUN_STABILITY=PENDING_FINAL
RECOVERY_PHYSICAL_EXERCISE=PENDING_FINAL
BROADER_HARDWARE_COVERAGE=PENDING_FINAL
```

## Current priorities

The disposable QEMU activation inspectors replay only the committed ext4 journal
on a copied persistent-state image before mounting that copy read-only. QEMU is
stopped after a durable serial marker without a clean guest unmount, so inspecting
with `noload` before journal replay can expose uncheckpointed metadata. General
filesystem repair is forbidden; the original guest disk remains untouched by
inspection and is reused for the independent second boot. This correction does
not itself establish a passing cold-health or physical proof.

1. prioritize the Stable/MVP **USB system path**: preserve the green source/QEMU/UEFI path, complete canonical signed Stable v4 materialization with the proven local-AI runtime, then close the later real-hardware gates for first canonical USB boot, cold health, known-good promotion and rollback without coupling ordinary app changes to a full system reboot;
2. keep the **local inference payload** pinned and reproducible: the exact llama.cpp/model artifacts, real-byte v4 materialization and disposable QEMU/UEFI v4 path are already CI-proven; the remaining non-physical release gate is canonical Stable signing/materialization, without making AI boot-critical;
3. keep PT-BR/en-US launch coverage regression-closed and continue Spanish, German and French migration without exposing those hidden compatibility locales as complete before their Surface coverage reaches the same standard;
4. keep the current first-party apps useful and coherent as Beta components, focusing app work on correctness, regression coverage and genuine MVP gaps; move an app toward production-independent packaging only when the signed `component-slot` path is actually ready to prove it;
5. continue hardening staged/transactional Owner/Development Git-first activation while keeping it explicitly separate from the Stable/MVP public update channel;
6. execute the integrated Surface smoke only on the eventual Stable/MVP physical USB for canonical promotion; Owner/Development evidence remains development-only and CI or an unexecuted runbook must never become physical PASS;
7. continue account/cloud preference and workspace continuity through neutral contracts without making an authenticated provider or cloud sync an MVP boot dependency;
8. keep the already-pinned canonical Ed25519 public trust stable, keep private signing material outside Git/CI/chat, and treat independent off-device custody plus managed non-exportable signing as broad-distribution hardening rather than an unfinished first-prototype trust ceremony;
9. keep all physical writers fail-closed after scope authorization until non-published candidate review, exact target confirmation/UAC and post-write verification are deliberately completed; source/CI readiness alone never selects or authorizes erasing a particular USB;
10. continue product experience work that does not weaken boot safety, including the early graphical OrdaX splash with mandatory text fallback; leave suspend/resume, audio, acceleration-quality, long-run and broader-hardware exercises for final physical validation unless an MVP gate depends on them sooner.

## Autonomous recovery and observation boundary

```text
NORMAL_UPDATE_CONTROL=GIT_MAIN
BOUNDED_RECOVERY_CONTROL=GIT_ORDAX_RESCUE
OBSERVABILITY=SUPABASE_ORDAX_OS_RELAY
REMOTE_SHELL=NO
SUPABASE_COMMAND_CHANNEL=NO
GUARDIAN_NETWORK_ACCESS=NO
SUPERVISOR_GIT_ACCESS=YES
INTENTIONALLY_BAD_UPDATE_ROLLBACK_PHYSICAL_PROOF=PENDING
FULL_A_B_RUNTIME_ACTIVATION=NO
BASE_UPDATE_A_B_CONTRACT=DEFINED
BASE_UPDATE_FAT32_STAGING_PROOF=PASS_DISPOSABLE_CI
BASE_UPDATE_CANONICAL_TRUST_EXERCISED_BY_FAT32_PROOF=NO
BASE_UPDATE_PHYSICAL_HARDWARE_PROVEN=NO
BASE_UPDATE_PHYSICAL_WRITER=NO
```

The temporary Supabase project is an operational relay, not product authority. It may be migrated later without changing the device identity or telemetry contract. Git `main` remains product source authority; `ordax-rescue` remains a separate, deliberately narrow recovery path.

## Canonical documentation freshness

The Foundation regression suite compares this snapshot against structured owners for product version, first-party app versions/release modes and seed/transitional-media geometry. A source change that makes those values stale must fail CI until the canonical snapshot and nomenclature contract are updated in the same change. Portable v2 remains governed separately by `docs/contracts/portable-usb-v2.json`; transitional geometry must never be mistaken for the final public MVP target.

## Handoff rule

Any new AI/conversation must read `AGENTS.md`, this file and the canonical contracts before changing source. It must also reconcile current structured source with the snapshot before planning work from a historical statement. CI alone never proves physical boot, native graphics or destructive safety. For the tested owner/development USB notebook, physical native graphics/input/power/live-update claims are supported by `docs/evidence/physical-native-surface-2026-09-17.md`; those claims still do not promote CI trust, authorize physical mutation, prove canonical signed release acquisition or declare the product complete.


## Runtime component trust identity

The signed `component-slot` protocol intentionally uses a trust domain separate
from whole-OS release signing. Source now defines the operator ceremony and
fail-closed policy for the first component identity, but no canonical component
key is pinned yet.

```text
COMPONENT_TRUST_DOMAIN=runtime-components
COMPONENT_TRUST_KEY_ID=ordax-runtime-components-v1
COMPONENT_TRUST_CEREMONY=PENDING_OPERATOR_EXECUTION
CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED=NO
COMPONENT_PUBLISH_ALLOWED=NO
PRODUCTION_COMPONENT_SLOT_ACTIVATION_ALLOWED=NO
```

Only a reviewed public anchor may later enter
`system/trust/runtime-components-ed25519.json`. The matching private key remains
external to Git/device and must pass independent derivation plus encrypted-recovery
signing proof before public pinning.

The Native Surface now has a fail-closed, read-only component-slot broker backed
by the signed `ordax-runtime-component-channel` helper. It is available only for
Stable/MVP USB when both the helper and a real component trust file exist, and it
revalidates component bytes through the verifier rather than trusting writable
slot paths directly. Source also implements the next non-activation layers: a
pending probation loader, an internal Native health recorder bound to the exact
component identity and probation revision, a system-owned nonce-bound health
bridge, and a fail-closed promotion policy that can only return hold/reject/promote
decisions. The bridge does not expose generic HTTP mutation authority and neither
the recorder nor the policy executes promotion, rejection or rollback. Because the
canonical component trust file is not pinned, the broker remains unavailable in
the current product and production component-slot activation is still blocked.
The next authority boundary is a separate Native executor consuming exact
revision+identity policy decisions only after canonical component trust and the
promotion/rollback proof gates are satisfied.

PUBLIC_ACCOUNT_LIFECYCLE_CONTRACT=PASS_SOURCE_OWNER_DEFINED
PUBLIC_ACCOUNT_CLOSE_FLOW=PASS_SOURCE_AND_GATEWAY_DEPLOYED_DISABLED_REQUIRES_REAL_PROOF_BEFORE_ACTIVATION
PUBLIC_ACCOUNT_DATA_EXPORT_FLOW=PASS_SOURCE_DB_EDGE_AUTHENTICATED_PUBLIC_DISABLED

PUBLIC_ACCOUNT_DATA_EXPORT_RPC=ordax_account_export_v1_SECURITY_INVOKER_RLS

PUBLIC_IDENTITY_GATEWAY_SOURCE=V16_POLICY_PROJECTION_SPACES_READ_DEPLOYED_REV22
PUBLIC_ACCOUNT_CLOSE_SOURCE=PASS_DISABLED
PUBLIC_ACCOUNT_CLOSE_MAIN_GATEWAY_DEPLOYED=YES_SOURCE_V16_REV22_DISABLED
PUBLIC_ACCOUNT_LIFECYCLE_SERVICE=DEPLOYED_REV2_GLOBAL_REVOCATION_DISABLED_VERIFY_JWT

PUBLIC_ACCOUNT_DATA_EXPORT_NATIVE_USB=PASS_SOURCE_READ_ONLY_SESSION_BOUND
PUBLIC_ACCOUNT_DATA_EXPORT_SURFACE_UX=PASS_SOURCE_SIGNED_IN_SAME_ORIGIN_DOWNLOAD

PUBLIC_AUTH_EMAIL_CONFIRMATION_POLICY=PASS_PROVIDER_VERIFIED_MAILER_AUTOCONFIRM_FALSE_2026_10_07
PUBLIC_AUTH_REDIRECT_ALLOWLIST_POLICY=REVIEWED_SAME_ORIGIN_NO_WILDCARD_CANONICAL_ORIGIN_SELECTED_PROVIDER_VERIFICATION_PENDING

PUBLIC_ACCOUNT_CLOSE_GATEWAY_ROUTE=DEPLOYED_DISABLED
PUBLIC_ACCOUNT_CLOSE_LIFECYCLE_SERVICE=DEPLOYED_DISABLED
PUBLIC_ACCOUNT_CLOSE_ENABLED=NO
PUBLIC_ACCOUNT_CLOSE_DISABLED_PROOF_HARNESS=PASS_SOURCE_CREDENTIAL_FREE

MEMORY_CAPTURE_POLICY_BOUND_AUTO_SAVE=PASS_SOURCE_NATIVE_ASSISTANT_INTEGRATED
ASSISTANT_AUTO_MEMORY_EXTRACTION=PASS_SOURCE_STRICT_JSON_FAIL_CLOSED
ASSISTANT_AUTO_MEMORY_AUTHORITY=COMPOSITION_OWNS_DEVICE_ACCOUNT_SPACE
ASSISTANT_AUTO_MEMORY_SECRET_FILTER=PASS_SOURCE_CREDENTIAL_SIGNAL_REJECT
ASSISTANT_AUTO_MEMORY_SOURCE_EVIDENCE=PASS_SOURCE_VERBATIM_USER_TURN_REQUIRED_NOT_PERSISTED
ASSISTANT_AUTO_MEMORY_PERSISTED_CONTENT=VERBATIM_USER_EVIDENCE_ONLY_NO_MODEL_PARAPHRASE

MEMORY_MANUAL_ENTRY=PASS_SOURCE_NATIVE_ACCOUNT_SURFACE
MEMORY_APP_MUTATION_PORT=PASS_SOURCE_ASYNC_REVIEW_CAPTURE_SHARED_NATIVE
MEMORY_ACCOUNT_PROTECTED_PROVIDER_NATIVE_WIRING=PASS_SOURCE_FIXED_ENTITLEMENT_ROUTE_NO_CLOUD_TRANSPORT
MEMORY_ACCOUNT_PROTECTED_PROVIDER_CORRUPTION_POLICY=RECOVERY_REQUIRED_BLOCK_BEFORE_LOCAL_MUTATION
MEMORY_ACCOUNT_CRASH_RECOVERY_NATIVE=PASS_SOURCE_NON_BLOCKING_SIGN_IN_AND_RECONNECT_RETRY
MEMORY_ACCOUNT_PROTECTED_PROVIDER_PUBLIC_CLOUD_PROMOTION=NO

MEMORY_AUTO_CAPTURE_PREFERENCE=PASS_SOURCE_DEVICE_LOCAL_DEFAULT_ON
MEMORY_EXACT_CAPTURE_DEDUP=PASS_SOURCE_EXACT_ONLY


CLOUD_MEMORY_SYNC_BOUNDARY=PASS_SOURCE_DISABLED
CLOUD_MEMORY_TWO_CLIENT_PROOF=PASS_SOURCE_EXECUTION_PENDING_PREPROVISIONED_ENTITLEMENT
CLOUD_MEMORY_PROOF_ENTITLEMENT_OPERATOR=DEPLOYED_OPERATOR_ONLY_NO_GRANT
CLOUD_MEMORY_LOCAL_FIRST_IDENTITY=PASS_SOURCE_UUID_V4_PRESERVED_DEPLOYMENT_PENDING
CLOUD_MEMORY_NATIVE_FRESH_INSTALL_RESTORE=PASS_CI_COMPOSITION_MEMORY_BEFORE_CHECKPOINT_NO_ECHO
CLOUD_MEMORY_NATIVE_PHYSICAL_REINSTALL_PROOF=NO

Account-owned and Space-owned Memory are currently local OrdaX Memory ownership domains, not a released cloud-sync claim. The dedicated control-plane database contains RLS-protected `ordax_memory_items` plus a separate sync-object stream, and the server-authoritative `ordax_apply_memory_mutation_v1` boundary is deployed so canonical Memory and its sync/tombstone mirror advance atomically. The manual proof harness is now source-ready for two independent authenticated sessions of the same dedicated non-admin account: Client A creates/edits/deletes while Client B independently consumes the incremental sync stream, attempts a stale mutation that must be rejected, and verifies the canonical deleted state. Public cloud Memory remains disabled because execution still requires a deliberately preprovisioned `memory.cloud.enabled` entitlement and a real authenticated run; the proof itself never creates that grant or uses service-role authority. The operator-only issue/revoke boundary is now deployed in `ordax-control-plane`, owned by `postgres` and inaccessible to `anon`, `authenticated` and `service_role`; no proof entitlement has been issued and the live active-grant count remains zero. Independent client dual-write remains forbidden; device/session/project/restricted Memory remain outside the initial cloud-sync eligibility boundary.


PROFILE_PROVISIONING_COMPLETED_GATES=RECEIPT_INVENTORY,TRUSTED_EXECUTOR,HEALTH_ROLLBACK,SURFACE_CATALOG_UI
PROFILE_PROVISIONING_NEXT_GATE=FIRST_PUBLIC_PROFILE_PROOF
PROFILE_PROVISIONING_FIRST_PUBLIC_PROFILE_PROOF=BLOCKED_CANONICAL_TRUST_PUBLICATION_REQUIRED


### Operational realtime / Web / Mobile foundation

The product now has a provider-neutral source contract separating account synchronization
from live operational events and remote device actions. `ordax.operational-event/1` uses
Space-scoped aggregate identity, server sequence and revision; device mutations use
`ordax.device-action-request/1` + `ordax.device-action-receipt/1` and must be matched
to an explicit approved Device Agent write grant.

This foundation is intentionally non-activating. There is no released Android APK, no public
operational realtime transport and no public remote-device Action Gateway yet. Web/Mobile/
Desktop/Native/MCP share the same future action boundary; account sync is not a command queue,
notifications are not source of truth, and push payloads are not command authority.

Machine-readable owner: `docs/contracts/operational-realtime.json`.

## Personal OrdaX orchestration foundation

Personal OrdaX is now a mounted **Native foreground orchestration** capability, not merely a
source-only architecture stub. It reuses the canonical identity session, Space selection, Projects,
Memory/Intelligence and tool-grant authorities; it does not own a parallel identity, Memory, sync,
permission or project system.

`ordax.personal-work-item/1` binds every Work item to the exact device/account owner and optional
explicit Space/project. `ordax.personal-activity/1` is the ordered user-visible activity stream,
`ordax.personal-work-result/1` stores bounded reasoning results with fixed `authority=none`, and
approvals/decisions/attempts are persisted in the same owner partition. Account/Space/project
changes pause affected active Work and cannot silently retarget it. Stale inference responses are
discarded.

### Personal OrdaX foreground runtime

The Native composition mounts the canonical Personal OrdaX runtime plus its owner-partitioned
device store and Activity app. The Surface supports deliberate Work creation, visible
`waiting-approval`, explicit pause/resume/cancel/remove, approval/deny controls and bounded result
review. Durable owner records are capped and validated; corrupt durable bytes are preserved rather
than silently reset. Account sync remains separate from operational Work state.

One real foreground side effect is enabled:
`ordax-native-file-space/files.directory.ensure`. It is intentionally narrow and idempotent.
Execution requires an explicit human approval, a short-lived exact grant, matching
owner/Space/project/Work/approval/resource/tool/action/effect, matching SHA-256 identity for the
tool/adapter artifact, and final revalidation immediately before the adapter is resolved. The
runtime persists an `ordax.personal-action-attempt/1` before adapter entry. A crash or ambiguous
post-adapter failure becomes `uncertain`, revokes live authority and pauses Work; there is no
automatic replay.

The authority-free Action Proposal boundary is source-ready and connected to an explicit
foreground planner action. The catalog can produce an ephemeral
`ordax.personal-action-proposal/1` only for an existing nonterminal Work in the current owner
partition and a registered Action Catalog entry. The planner sees only
`entryId + inputKind + resourceScheme`, requires exact JSON and revalidates the candidate through
the catalog. A proposal carries only `workItemId + entryId + resourceValue + rationale`, fixes
`authority=none`, `executionAuthorized=false` and `approvalRequested=false`, and rejects
tool/action IDs, canonical resource references, grants, approvals, decisions, effects and artifact
identities. Proposal -> approval remains a separate explicit user action and there is no automatic
proposal -> execution path.

Semantic Work recovery is also source-ready as an explicit foreground lookup. Only current-owner
`queued|paused` Work without unresolved authority is eligible. Intelligence sees
`workItemId + goal + state + spaceBound + projectBound` and never receives owner/Space/Project
IDs. The returned `ordax.personal-work-recovery-suggestion/1` carries no authority, cannot switch
context and cannot resume automatically. A runtime-local binding pins owner and exact Work revision;
accepting a paused match delegates to the canonical `resume()`, which still fails closed unless
the original Space/Project context is valid.

Background/autonomous execution remains disabled. Generic external egress, device-control, shell,
raw disk, release-key access, physical writes, non-idempotent file mutations, model-generated action
proposal generation, specialist workers and hybrid cloud execution are not enabled by this runtime.

```text
PERSONAL_ORDAX_NATIVE_RUNTIME=PASS_MOUNTED_FOREGROUND
PERSONAL_ORDAX_ACTIVITY_SURFACE=PASS_NATIVE_VISIBLE
PERSONAL_ORDAX_OWNER_PARTITIONED_STORE=PASS_NATIVE_DEVICE_WITH_SESSION_FALLBACK
PERSONAL_ORDAX_CONTEXT_RETARGET=DENY_PAUSE_ON_OWNER_SPACE_PROJECT_CHANGE
PERSONAL_ORDAX_APPROVAL_GATE=PASS_EXPLICIT_HUMAN_CONSENT
PERSONAL_ORDAX_FOREGROUND_ACTION_EXECUTION=PASS_ONE_BOUNDED_ACTION
PERSONAL_ORDAX_FOREGROUND_ACTION_SCOPE=ORDAX_NATIVE_FILE_SPACE_FILES_DIRECTORY_ENSURE
PERSONAL_ORDAX_ACTION_ATTEMPT_JOURNAL=PASS_CRASH_SAFE_NO_AUTO_REPLAY
PERSONAL_ORDAX_ACTIVITY_EXPORT=PASS_SOURCE_NATIVE_EXPLICIT_JSON_DOWNLOADS
PERSONAL_ORDAX_ACTIVITY_EXPORT_AUTHORITY_REPLAYABLE=NO
PERSONAL_ORDAX_ACTIVITY_EXPORT_ACCOUNT_SYNC=NO
PERSONAL_ORDAX_ACTION_PROPOSAL_CONTRACT=PASS_SOURCE_AUTHORITY_NONE
PERSONAL_ORDAX_ACTION_PROPOSAL_NATIVE_PORT=PASS_SOURCE_CURRENT_WORK_BOUND
PERSONAL_ORDAX_MODEL_TO_PROPOSAL=PASS_SOURCE_USER_TRIGGERED_STRICT_JSON
PERSONAL_ORDAX_MODEL_PROPOSAL_CATALOG_VIEW=ENTRY_ID_INPUT_KIND_RESOURCE_SCHEME_ONLY
PERSONAL_ORDAX_MODEL_PROPOSAL_AUTHORITY=NONE
PERSONAL_ORDAX_MODEL_PROPOSAL_OWNER_DRIFT=DISCARD
PERSONAL_ORDAX_MODEL_PROPOSAL_TO_APPROVAL=EXPLICIT_USER_ACTION_ONLY
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY=PASS_SOURCE_CURRENT_OWNER_EXPLICIT_REQUEST
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_MODEL_VIEW=WORK_ID_GOAL_STATE_CONTEXT_BOUND_FLAGS_ONLY
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_OWNER_SPACE_PROJECT_IDS_TO_MODEL=NO
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_CONTEXT_SWITCH=NO
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_AUTO_RESUME=NO
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_PAUSED_GATE=CANONICAL_RUNTIME_RESUME
PERSONAL_ORDAX_AUTOMATIC_PROPOSAL_TO_APPROVAL=NO
PERSONAL_ORDAX_AUTOMATIC_PROPOSAL_EXECUTION=NO
PERSONAL_ORDAX_BACKGROUND_EXECUTION=NO
PERSONAL_ORDAX_GENERIC_EGRESS=NO
PERSONAL_ORDAX_GENERIC_DEVICE_CONTROL=NO
PERSONAL_ORDAX_PUBLIC_STABLE_AUTONOMY=NO
```

Canonical authority: `docs/PERSONAL-ORDAX.md` +
`docs/contracts/personal-ordax.json`.
