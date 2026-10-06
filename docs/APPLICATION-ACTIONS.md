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

## Personal OrdaX runtime composition

The Native Personal OrdaX composition now owns the first-party Application Action Preparation Registry and composes the current verified provider binding resolver already defined by the platform.

The runtime path is:

```text
verified first-party capability
  -> authority-free proposal
  -> owner-bound Work
  -> session-only Application Action Preparation
  -> re-read current verified app semantics
  -> current verified provider binding
```

The preparation remains session-only and carries no approval, grant or execution authority. It is revoked when its owner partition changes, its Work becomes terminal or disappears, its bound Space/project context is no longer current, or a matching action approval/attempt has already crossed a terminal authority or side-effect boundary.

Provider binding is resolved only from a still-current preparation. The resolver re-reads the external first-party app from the current verified component slot and revalidates capability identity, proposal digest, provider `adapterId + revision`, app version, source commit and component revision.

After that asynchronous revalidation completes, Personal OrdaX checks the preparation and Work revision again. If either changed during the await boundary, the binding is discarded. This closes the owner/context TOCTOU window without adding execution authority.

The composition intentionally does not expose an Application Action-specific approval, grant or execute shortcut. Existing Personal OrdaX approval/grant/gateway/executor remains the only authority path for future provider invocation.

