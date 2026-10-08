# Application Actions

Status: **FOUNDATION / CAPABILITY DESCRIPTION AND PROPOSAL ONLY**

OrdaX Intelligence may eventually help a user operate applications, but understanding that an action exists is not authority to perform it.

This foundation introduces a strict semantic boundary between:

1. application identity;
2. a proven action capability;
3. a data-only action proposal;
4. future policy/grants/human confirmation;
5. future execution by a bounded adapter.

No executor is implemented here.

## Architecture

```text
user intent
  -> OrdaX Intelligence
  -> Application Intelligence Awareness
  -> Application Action Capability Registry
       -> declared semantic capability
       -> data-only validated proposal
  -> FUTURE App Action Broker
       -> current Space/session
       -> permission policy
       -> resource grants
       -> human confirmation when required
       -> audit receipt
  -> FUTURE bounded adapter
       -> first-party semantic API
       -> generic application lifecycle adapter
       -> verified Windows integration
```

The local model still has `authority=none` and `toolExecution=false`.

## First-party action manifest

`ordax.application-action-manifest/1` is the public package-level envelope for first-party app capabilities.

It binds:

- exact `appId`;
- exact `appVersion`;
- `authority: "none"`;
- `execution: "proposal-only"`;
- a bounded `capabilities[]` list.

Every capability inside the manifest is revalidated through `ordax.application-action-capability/1` and must:

- use the same app id;
- use an action id namespaced as `<appId>.*`;
- be `sourceClass: "first-party"`;
- be `platform: "ordax"`;
- use `provider.kind: "first-party-native"`;
- have no foreign payload SHA binding;
- keep `executionAuthorized=false`;
- keep `modelDirectExecutionAuthorized=false`.

Duplicate action ids are rejected. The manifest contains no broker, grants, confirmation receipt, adapter object, callback, executable path or raw device capability. It is suitable for inclusion in a verified app package because package trust proves the bytes and app identity, while this contract proves only declarative semantics.

The manifest does **not** mean an app is executable by Intelligence. A later platform-owned loader may feed validated capabilities into the read-only registry; a separate App Action Broker remains required for policy, grants, confirmation, audit and bounded adapter invocation.

## Capability contract

`ordax.application-action-capability/1` identifies one semantic action for one exact application identity.

A capability contains:

- stable `appId`;
- stable semantic `actionId`;
- display title/description;
- application source/platform class;
- provider kind and opaque adapter identity/revision;
- exact foreign payload SHA-256 binding for installed Windows applications;
- typed semantic parameter declarations;
- risk class;
- confirmation class;
- provenance;
- mandatory `executionAuthorized=false`;
- mandatory `modelDirectExecutionAuthorized=false`.

The current provider kinds are descriptive only:

- `first-party-native` — an OrdaX-owned semantic integration;
- `generic-lifecycle` — a future OrdaX-provided generic lifecycle integration;
- `verified-integration` — an integration bound to a specific installed foreign app payload.

Declaring any of these kinds does not make an executor available.

## Parameters are semantic, not operating-system authority

Allowed parameter types are bounded scalar forms:

- `string`;
- `boolean`;
- `integer`;
- `number`;
- `enum`;
- `uri`;
- `resource-grant-id`.

Filesystem resources must cross the future broker as opaque resource-grant identities, not raw host paths.

A `uri` parameter must also declare a bounded allowlist of schemes. The registry rejects a proposal whose URI scheme is not explicitly declared by that capability. For example, a web-navigation capability may declare `https`/`http` without thereby accepting `javascript`, `file`, a vendor URI scheme or any other scheme. A future broker/adapter may narrow this further; it must not widen the capability silently.

The capability contract explicitly rejects parameter identities that would create a hidden authority channel such as:

- `path` / `raw-path` / `host-path`;
- `command` / `shell`;
- `executable` / `executable-path`;
- `wineprefix`;
- `argv`;
- `environment` / `env`;
- `working-directory`.

This is intentional. A future adapter can internally translate an authorized semantic resource grant into its implementation-specific path or handle. That mapping must remain behind the broker/sandbox boundary.

## Installed Windows application binding

A foreign capability is not attached only to a display name like `Photoshop`.

It is bound to the installed OrdaX application identity and the exact `payloadSha256` already validated by `ordax.installed-application/1` and projected by Application Intelligence Awareness.

Therefore an application update that changes payload identity does not silently inherit a previous verified integration. The registry fails closed until a capability matching the new installed identity is declared/reverified.

A Windows application also cannot claim a `first-party-native` provider.

## Risk and confirmation metadata

The capability describes policy-relevant metadata without satisfying policy itself.

Current risk classes:

- `read-only`;
- `local-change`;
- `external-effect`;
- `privileged`.

Current confirmation classes:

- `none`;
- `policy-gated`;
- `always`.

Contract invariants include:

- a `privileged` action requires `always` confirmation;
- an `external-effect` action cannot use `none`.

The proposal contract repeats those invariants instead of trusting a caller-provided risk/confirmation pair. A future broker still re-resolves the exact capability and may never treat a proposal as authority by itself.

These are minimum structural constraints. A future App Action Broker may require *more* confirmation based on user policy, Space, resource grants, destination, session state or action-specific rules. It may never weaken the declared minimum.

## Proposal is not execution

`ordax.application-action-proposal/1` is a bounded data object produced only after:

- exact `appId/actionId` lookup;
- exact capability binding validation;
- rejection of undeclared parameters;
- validation of required arguments;
- validation of parameter type/range/enum/resource-grant/URI-scheme constraints.

A proposal still carries:

```text
executionAuthorized = false
modelDirectExecutionAuthorized = false
```

There is deliberately no `execute()` step in this foundation.

The read-only registry exposes only:

- `list()`;
- `get(appId, actionId)`;
- `listForApp(appId)`;
- `propose(appId, actionId, arguments)`;
- `contextItem()`.

It rejects or omits mutation/execution/grant methods such as `register`, `execute`, `invoke`, `launch`, `install`, `shell`, `spawn`, `grant`, `authorize` and `confirm`.

## Intelligence context

`contextItem()` exposes only the semantic subset useful for planning:

- app id;
- action id/title;
- parameter ids/types/required flags and bounded semantic constraints such as enum values or allowed URI schemes;
- risk class;
- confirmation class;
- execution flags fixed to false.

It does **not** expose:

- foreign payload SHA-256;
- provider adapter id/revision;
- Wine/runtime/profile ids;
- executable paths;
- shell commands;
- grants;
- confirmation receipts.

The context itself says `authority=none` and `toolExecution=false`.

## No production capabilities yet

This foundation does not declare real actions for existing applications.

That is deliberate. Real capabilities must arrive only when their implementation can be proven:

1. first-party actions: explicit semantic contracts in the owning app;
2. generic lifecycle actions: only after a safe OrdaX lifecycle executor exists;
3. Windows app-specific actions: only after a version/payload-bound integration proves documented CLI/URI/IPC/file-association behavior;
4. accessibility: later bounded fallback if a stable accessibility surface is proven;
5. pixel/visual automation: last resort, not a generic authority escape hatch.

A running Wine process is not proof that an app supports a semantic action.

## Next gate: App Action Broker

A later PR may introduce a broker, but it must remain separate from Intelligence and this read-only registry.

Before executing anything it must validate at least:

- exact application and capability identity;
- current user/session/Space;
- resource grants;
- current installed payload/integration revision;
- risk and confirmation policy;
- human confirmation where required;
- adapter availability/health;
- bounded audit receipt.

The broker must receive semantic arguments, never an arbitrary shell command generated by a model.

## Relationship to Memory and automation

Application capabilities do not imply memory and memory does not imply action authority.

For example:

- `user prefers WebP for Instagram exports` may become authorized per-app memory later;
- `image.export` may be a declared capability later;
- publishing externally still requires the broker/policy/confirmation rules for that external effect.

This separation is required for the future Jarvis-style experience to remain useful without turning learned preferences into silent permissions.

## Verified first-party package loading

Apps first-party externalizados não registram capabilities por chamada mutável e o OS não faz scan de diretórios.

A composição Native usa a mesma fonte read-only de package verificado já usada pelo App Intelligence:

```text
component-runtime current slot
        ↓
app.json
ai/manifest.json
actions/manifest.json
        ↓
mesmo version + sourceCommit
        ↓
Application Awareness
        ↓
Application Action Capability Registry
        ↓
Application Context Intelligence
```

Para cada app permitido pelo registro first-party de delivery, o loader resolve o slot atual uma vez e lê os três manifests dentro do namespace verificado da mesma resolução. O `actions/manifest.json` é validado por `ordax.application-action-manifest/1`.

Além do contrato público, o loader verifica a coerência com `ai/manifest.json`:

- toda capability deve possuir intent de mesmo `actionId`;
- os parâmetros devem ter os mesmos ids e required flags;
- tipos especializados de string podem ser estreitados para `enum`, `uri` ou `resource-grant-id`;
- risco não pode ser mais fraco que o efeito do intent;
- confirmação não pode ser mais fraca que a política do intent;
- intents destrutivos exigem `always`.

Uma falha de identidade, versão, provenance de slot ou coerência semântica em um `actions/manifest.json` presente falha fechada. Um pacote legado verificado que simplesmente não contém o arquivo recebe `actionManifest = null` e continua fornecendo apenas sua semântica de IA; nenhuma capability é sintetizada.

Pacotes novos produzidos pelo `ordax-apps` exigem `actions/manifest.json` no builder, portanto a ausência é apenas uma regra de compatibilidade para payloads legados já verificados.

Quando existem capabilities verificadas, a composição cria `ordax.application-action-capability-registry/1` e injeta somente sua projeção bounded no contexto do Intelligence. Quando não existem capabilities verificadas, nenhum contexto de actions é inventado.

Esse registry continua sem `execute()`, `run()`, `invoke()`, grant ou confirmation authority. O resultado continua sendo somente uma proposal com:

```text
executionAuthorized = false
modelDirectExecutionAuthorized = false
```

A futura execução permanece separada no App Action Broker.

## Preparation Registry

`ordax.application-action-preparation/1` is the private platform bridge between an authority-free Application Action proposal and the existing Personal OrdaX approval/grant pipeline.

It does **not** execute an app action.

The preparation registry:

- re-resolves the exact current capability through the verified capability registry;
- re-proposes the exact arguments and rejects stale capability/proposal identity;
- accepts only verified `first-party-native` capabilities in this first slice;
- binds the proposal to an explicit Personal OrdaX `workItemId`;
- maps risk conservatively to the existing Action Gateway effect classes:
  - `read-only -> read`;
  - `local-change -> write`;
  - `external-effect -> external-egress`;
  - `privileged -> device-control`;
- replaces raw proposal arguments at the authority boundary with an opaque resource reference:
  `application-action:<preparationId>`;
- keeps `authority=none`, `executionAuthorized=false` and `modelDirectExecutionAuthorized=false`;
- exposes only `prepare`, `resolve`, `revoke` and `listForWork`.

The registry deliberately does not expose `execute`, `invoke`, `run`, `grant`, `authorize` or `confirm`.

The opaque resource reference is intended to become the exact `resourceRef` bound into the existing Personal OrdaX approval and Intelligence Tool Grant. A future typed first-party provider adapter may resolve the preparation only after the existing Action Gateway has produced an exact allow decision.

This keeps the execution chain singular:

```text
verified app capability
  -> authority-free proposal
  -> preparation resourceRef
  -> Personal OrdaX approval
  -> scoped grant
  -> existing Action Gateway
  -> existing Action Executor
  -> future typed app provider adapter
  -> receipt
```

No second permission store, grant issuer, confirmation system or receipt format is introduced.

A preparation is not provider-artifact proof. It intentionally carries only the capability's declared `adapterId + revision`. Before any future execution, a platform-owned provider resolver must still bind that declaration to the **currently verified first-party package/provider artifact** and fail closed if version, source commit, adapter revision or artifact identity changed after preparation. This prevents a preparation from silently authorizing a newly updated app runtime.

Preparation references are session-only coordination state, not durable authority. When the registry is composed into Personal OrdaX, the integration must revoke the reference on Work cancellation/removal, owner switch, invalidated Space/project context, succeeded execution, revoked approval, or an uncertain adapter-entered attempt. A serialized or restored preparation must never recreate a grant or become executable on its own.

## Current verified provider binding

`ordax.application-action-provider-binding/1` closes the package-identity gap left intentionally by the Preparation Registry without adding execution authority.

The private resolver receives only an opaque preparation `resourceRef`, resolves it through the authoritative in-memory Preparation Registry, and only then independently rechecks both sources of truth:

1. the current `ApplicationActionCapabilityRegistry`;
2. the current verified first-party component-slot semantics supplied by the platform package owner.

The resolver fails closed unless all of the following still match exactly:

- `appId` and `actionId`;
- proposal arguments, risk, confirmation, capability digest and provenance;
- capability source/platform (`first-party` + `ordax`);
- provider kind, `adapterId` and provider revision;
- package action manifest capability;
- component kind and `component-slot` release mode;
- expected first-party package owner;
- current app semantic version;
- current component-slot `sourceCommit`;
- current component-slot revision.

On success it returns only an immutable, authority-free binding containing the retained preparation `resourceRef`, Work id, action identity, exact app version/source commit/component revision, exact provider identity and capability identity. Unknown, revoked or non-retained preparation references resolve to no binding.

The provider resolver exposes only `resolve()`. It does **not** expose `execute`, `invoke`, `run`, `launch`, `grant`, `authorize` or `confirm`, and the returned binding always carries:

```text
authority = none
executionAuthorized = false
modelDirectExecutionAuthorized = false
```

This binding is still not an adapter callback, does not contain a tool artifact SHA-256 and is not an Action Gateway allow decision. Its purpose is narrower: prove that the provider declaration belongs to the exact currently verified first-party package before a later slice binds an actual typed provider module artifact and connects it to the existing Personal OrdaX approval/grant/gateway/executor chain. Notes and Studio currently publish declarative provider identities only; until an executable typed provider artifact exists and is verified, the chain remains fail-closed.

## Personal OrdaX provider-binding composition

Personal OrdaX now composes the existing current verified provider resolver only after a session-only Application Action preparation exists.

The runtime path remains authority-free:

```text
verified capability
  -> proposal
  -> Work-bound preparation
  -> re-read current verified app semantics
  -> current verified provider binding
```

The Native composition reuses the same verified component package source used by App Intelligence and re-reads the requested app from the current slot for every provider binding resolution. The provider binding therefore cannot rely only on boot-time semantic state.

During preparation, Personal OrdaX retains the exact Work revision privately. After the asynchronous verified-slot revalidation returns, it requires the same preparation object, owner partition and Work revision to still be current. Any drift discards the binding.

This composition does not add an Application Action-specific approval, grant or execute shortcut. The binding remains `authority=none`, `executionAuthorized=false`, and `modelDirectExecutionAuthorized=false`.

## Native preparation lifecycle

The Native Personal OrdaX composition now owns a session-only Application Action preparation lifecycle on top of the verified capability registry.

It exposes only bounded discovery/proposal/preparation operations: list available Application Actions, create a data-only proposal, prepare it for an existing Work item, resolve/list the retained preparation and revoke it. Preparing an Application Action does not create an approval, grant, Action Gateway decision or execution attempt.

A retained preparation is revoked fail-closed when its authority-free coordination context stops being current, including:

- owner partition change;
- Work removal or terminal state;
- bound Space or Project becoming invalid;
- matching approval becoming executed, revoked, denied or cancelled;
- matching action attempt succeeding or becoming uncertain;
- disposal of the Personal OrdaX composition.

The lifecycle therefore cannot turn a serialized or stale `application-action:*` reference into durable authority.

## Verified provider artifact resolution

`ordax.application-action-provider-manifest/1` binds each declared first-party provider `adapterId + revision` to one canonical module path under `actions/providers/` and an exact SHA-256. The verified semantics loader reads this manifest from the same current component-slot identity as `app.json`, `ai/manifest.json` and `actions/manifest.json` and requires exact coverage of providers referenced by the Action manifest.

Artifact resolution is intentionally downstream of the existing provider binding; it is not a second path from a raw preparation:

```text
preparation resourceRef
  -> ordax.application-action-provider-resolver/1
  -> ordax.application-action-provider-binding/1
  -> ordax.application-action-provider-artifact-resolver/1
  -> ordax.application-action-provider-resolution/1
```

The artifact resolver accepts only the opaque `resourceRef`, obtains the current provider binding from the existing binding resolver, and then checks the currently verified provider manifest, current slot metadata and provider module SHA-256. It re-resolves the provider binding after the asynchronous metadata/hash work and fails if the binding changed during resolution.

The final provider resolution preserves the binding identity — Work, app/action, version/sourceCommit/component revision, provider identity and capability digest/provenance — and only adds the canonical provider module and verified artifact SHA-256. It never weakens the binding into a smaller identity token.

The binding resolver and artifact resolver deliberately use different port schemas so they cannot be substituted for each other. The canonical first-party package owner is owned by `system/services/apps/external-first-party-policy.mjs` and exported as `EXTERNAL_FIRST_PARTY_OWNER`; verified application semantics and the artifact resolver consume that same SSOT and reject owner drift before package I/O.

This historical slice was initially unmounted, but that statement is now superseded by the **Native provider artifact composition** section below. The current product exposes provider artifact resolution only through the read-only Personal OrdaX method `resolveApplicationActionProviderArtifact(resourceRef)`. No provider module is imported, and no Action Gateway decision, grant, confirmation or execution authority is created.


## Native provider artifact composition

The Native Personal OrdaX composition mounts verified provider artifact resolution as a read-only continuation of the existing provider binding.

The path is:

```text
Work-bound preparation
  -> current verified provider binding
  -> current verified provider manifest
  -> same-origin provider module bytes
  -> exact SHA-256
  -> immutable provider artifact resolution
```

The composition uses the canonical `EXTERNAL_FIRST_PARTY_OWNER` exported by the neutral Apps distribution policy and does not maintain a second first-party owner literal.

Provider module hashing is implemented by a dedicated Native adapter. It accepts only URLs inside the canonical loopback `/__ordax/native/component-module/` namespace, rejects query strings, fragments and cross-origin URLs, performs only `GET` with `cache=no-store`, `credentials=same-origin` and `redirect=error`, bounds provider modules to 1 MiB, and computes SHA-256 with Web Crypto.

Personal OrdaX exposes only `resolveApplicationActionProviderArtifact(resourceRef)`. Artifact resolution reuses the same Work/owner TOCTOU-checked provider-binding path. It does not import or evaluate the module, does not expose `load`, `loadAdapter`, `invoke` or `execute`, and does not create an approval, grant, gateway decision or receipt.

A successful resolution therefore remains metadata proof only:

```text
authority = none
executionAuthorized = false
modelDirectExecutionAuthorized = false
```

Any later execution must still enter the existing Personal OrdaX approval, scoped grant, Action Gateway and Action Executor chain. Verified provider bytes alone are never execution authority.


## Provider activation foundation

The platform now also defines a private, broker-only provider activation boundary:

`ordax.application-action-provider-activation/1`
and
`ordax.application-action-provider-activation-broker/1`.

This foundation is downstream of verified provider artifact resolution and currently permits only:

```text
providerExecution = unavailable
state = unavailable
brokerOnly = true
authority = none
executionAuthorized = false
modelDirectExecutionAuthorized = false
```

For each resolution, the broker revalidates current verified application semantics and requires the exact app/version/sourceCommit/component revision, capability provenance, provider identity, canonical module path and artifact SHA-256 to remain unchanged. It then resolves the provider artifact again and rejects any drift.

The broker exposes only `resolve(resourceRef)`. It does not expose activation, import/load, mount, adapter registration, invoke/execute, grant, authorization or confirmation methods.

**Current composition state:** the activation broker is now mounted in the Native Personal OrdaX composition as the read-only `resolveApplicationActionProviderActivation(resourceRef)` continuation of verified provider artifact resolution. It is created only when the artifact boundary is available, reuses the same live verified semantics source and canonical first-party owner, and fails closed otherwise. The exposed result remains `providerExecution/state=unavailable`, `brokerOnly=true`, `authority=none`, `executionAuthorized=false`, and `modelDirectExecutionAuthorized=false`; no provider code is imported or executed.

Changing a provider from `execution: "unavailable"` is not part of this state. That requires a separately versioned/gated provider contract plus the existing Personal OrdaX approval -> scoped grant -> Action Gateway -> Action Executor -> receipt path. It must not create a second permission store, confirmation system, executor or receipt format.


## Sugestões verificadas da Intelligence para aplicativos — somente consulta e preparação

A composição Native reutiliza os responsáveis já existentes:

- `ordax.application-semantic-router/1`: seleciona até 3 aplicativos
  relevantes para o objetivo do Work;
- `ordax.application-action-capability-registry/1`: fornece somente ações
  **first-party/native** com identidade conhecida e parâmetros tipados;
- `ordax.intelligence/1`: pode sugerir `kind=none` ou um único par
  `appId/actionId` com argumentos, em JSON de campos estritos;
- `ordax.personal-ordax/1`: vincula a sugestão à conta, Space, Project e
  revisão do Work antes e depois da inferência assíncrona;
- `ordax.application-action-preparation/1`: aceita somente a proposta
  original emitida pelo catálogo, após a ação explícita de preparar.

A entrada do modelo **não** pode declarar grants, SHA de artefato, permissão,
recursos brutos ou status de execução. A proposta validada é reconstruída pelo
registry canônico, que impõe `executionAuthorized=false` e
`modelDirectExecutionAuthorized=false`. O planner limita a 12 ações, usa
argumentos tipados e **recusa** catálogos além do orçamento, sem cortar
silenciosamente permissões. Conteúdo desconhecido ou ferramentas inventadas
falham antes de criar preparações.

Na Activity, `Sugerir ação de aplicativo` apresenta uma prévia explícita.
`Preparar sugestão de aplicativo` cria apenas uma preparação revogável
vinculada ao Work atual. Ela **não** solicita aprovação nem executa aplicativos.
A sugestão antiga não é aceita depois de troca de conta, mudança de revisão
de Work ou perda de Space/Project. O usuário pode descartá-la/revogar sua
preparação. Os testes ficam em
`tests/test_application_action_preparation_composition.mjs` e
`tests/test_personal_ordax_activity_surface.mjs`.

Este corte **não** habilita ações reais nos aplicativos: a implementação de
grants, consentimento e adapter verificado para cada ação continua sendo
um gate independente, sem segundo gateway nem bypass no modelo. A ação Native
`files.directory.ensure` permanece como o único efeito foreground validado
no Personal OrdaX. A CI prova os contratos com inferência controlada; não
comprova desempenho ou acurácia da IA real nem substitui o teste físico.
