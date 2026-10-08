# Personal OrdaX Runtime

Status: **CANONICAL FOUNDATION / PUBLIC RUNTIME DISABLED**

## Goal

The OrdaX should evolve from a collection of AI-enabled features into one coherent personal
system that can keep context, organize work, show progress and eventually continue bounded work
without forcing the user to manage separate chats or duplicated agents.

The working product model is:

```text
User
  |
  v
Personal OrdaX
  |
  +-- Identity / local session
  +-- Workspace / Projects
  +-- Spaces / Profile Packs
  +-- OrdaX Memory
  +-- OrdaX Intelligence
  +-- Tools / Action Gateway
  +-- Apps / Files / device capabilities
  |
  v
Visible work + approvals + artifacts
```

This is an orchestration layer, not a new source of privilege, memory, identity or platform policy.

## Why this foundation exists now

The current repository already has the hard pieces that should remain authoritative: one product
across modes, shared Surface/apps, identity, Spaces, projects, Memory, Intelligence, tool grants,
Device Agent/Action Gateway boundaries and fail-closed capability adapters.

The scalable move is therefore **composition**, not a second agent stack.

The design is also informed by the public product pattern demonstrated by OpenAI dots on
2026-09-29: persistent personal context, ongoing work, visible activity and explicit action
approval are useful product primitives. OrdaX does not copy their cloud-computer implementation or
depend on OpenAI. It adopts only the general product lesson and keeps local-first/hybrid execution
as an OrdaX architectural choice.

Reference:
https://openai.com/index/introducing-dots/

## Non-negotiable boundaries

Personal OrdaX:

- does not own account identity;
- does not replace Workspace, Space or Project;
- does not own Memory;
- does not become an inference provider;
- does not import concrete platform adapters;
- does not turn prompt/model/Profile/Memory content into authority;
- does not bypass `ordax.intelligence-tool-grant/1`, Device Agent grants or the Action Gateway;
- does not gain generic shell, raw-disk, release-key or physical-write authority;
- fails closed when an expected grant or scope is missing.

This preserves the existing dependency direction:

```text
contracts
   ^
services / orchestration policy
   ^
apps / Surface
   ^
composition selects adapters
```

## Four primitives

### 1. Work item

`ordax.personal-work-item/1` represents one user goal with explicit owner and optional Space/project
scope.

Initial states:

```text
queued
 -> running
 -> waiting-approval
 -> paused
 -> completed | failed | cancelled
```

The source foundation deliberately rejects background execution. We first stabilize identity,
scope, activity and approvals; continuous execution can be promoted later without changing the
work identity.

### 2. Activity

`ordax.personal-activity/1` is an ordered, user-visible event stream for work progress.

Activity should answer simple questions:

- what is OrdaX doing?
- what changed?
- what is waiting for me?
- which artifact/result was produced?
- did an action succeed or fail?

Activity carries bounded summaries and references. It is not a hidden transcript dump and is not an
authority channel.

### 3. Work result

`ordax.personal-work-result/1` stores the bounded persisted output of completed foreground
reasoning. Its actual durability is the same honest `device|session` persistence reported by the
owner-partitioned work store; a session fallback is never described as durable. It belongs to the same owner partition as its Work and is linked from exactly one
`completed` Activity event by `result:<id>`.

The result records engine/model provenance and fixed `authority=none`. Persisting model output
does not turn that output into permission, Memory or an executable action. Work completion, result
creation and the completed Activity reference are committed as one validated runtime state
transition so the Surface cannot observe a newly completed Work with a missing result.

### 4. Action decision

`ordax.personal-action-decision/1` normalizes the orchestration decision into:

```text
allow
approval-required
deny
```

Effects are classified as `read`, `write`, `external-egress` or `device-control`.

Sensitive effects can be allowed only by referencing an existing explicit grant. System policy may
allow already-authorized reads, but it cannot silently default-allow writes, external transmission
or device control.

## How existing OrdaX pieces fit

```text
Account / local device owner
        |
        +--> Space selection ------+
        +--> Project context ------+----> Personal work scope
        +--> Memory auth ----------+
        |
        +--> Intelligence ----------------> planning / reasoning
        |
        +--> Tool grant / Device grant ---> action authority
        |
        +--> Action Gateway --------------> bounded execution
        |
        +--> Activity --------------------> Surface review
```

Profile Packs may shape knowledge, defaults and suggested workflows. They never grant action
authority.

Memory may help the system remember preferences, facts and prior project context. Memory never
becomes a permission source.

## Evolution path

### Phase 1 — foundation and visible work

Phase 1 is implemented in the Native composition.

The runtime under `system/services/personal-ordax/` binds Work to the exact device/account owner
and optional explicit Space/project. Owner state is isolated in bounded partitions; the Native
device-store persists one validated record per owner and degrades only the affected owner to session
state when durable bytes are corrupt, preserving those bytes for recovery. Identity, Space and
project changes pause affected active Work instead of retargeting it, and stale inference responses
cannot complete Work under a different context.

The Native Activity app is mounted over the same runtime. Users deliberately create Work there;
ordinary Assistant messages do not auto-create Work. Activity exposes ordered progress, results,
`waiting-approval`, explicit approve/deny, pause/resume/cancel/remove and action outcome state.
Work Result persistence remains bounded and keeps model output at fixed `authority=none`.

Sensitive execution reuses the existing Intelligence tool-grant authority and
`ordax.action-gateway/1`; there is no Personal-OrdaX-owned permission system. Approval binds the
exact Work, owner, optional Space/project, resource, tool, action, effect and tool-artifact SHA-256.
The Action Executor revalidates the same authority immediately before resolving an adapter.

Exactly one first-party foreground mutation is currently registered and executable:
`ordax-native-file-space/files.directory.ensure`. It is idempotent, file-space bounded and exposed
only after explicit human approval. No model output, Profile, Memory or project content can create
that authority.

Each side-effect attempt is journaled durably before adapter entry. A proven pre-adapter failure is
retryable only through explicit user flow; an ambiguous post-adapter failure or restored
`started` attempt becomes `uncertain`, revokes the live grant and pauses Work. Automatic replay is
forbidden.

Activity history now has a bounded explicit Native export flow. It serializes only the current
owner partition into `ordax.personal-activity-export/1`, saves JSON through the existing
user file-space into `/Downloads`, strips retained `grantRef` values and omits runtime
`nextOrdinal`. The export is therefore review/audit data, not a restorable authority snapshot.
There is no automatic export, account sync, upload or Web fake-file fallback.

Phase 1 does **not** enable background autonomy, generic egress, generic device control, shell, raw
disk, release-key access, physical writes, non-idempotent file mutations or **automatic execution
of model-generated proposals**. The consultative planner can suggest one catalog action for
explicit human review. The proposal itself grants no authority and can only become a pending
approval through an intentional user action in Activity.

### Phase 2 — resumable bounded background work

Add a durable work store, pause/resume/recovery semantics, explicit background policy and selected
connectors. Background work must survive restart without inventing a second sync model.

### Phase 3 — specialist workers

Specialist workers may appear for coding, research, creative work or professional Profiles, but
they operate underneath the same Personal OrdaX owner, Memory and permission boundaries. They do
not become independent user identities by default.

### Phase 4 — hybrid execution

A work item may be executed locally, on an authorized Edge device or in cloud compute depending on
capability, privacy, cost and availability. The work identity, activity stream and permission
semantics remain stable while the execution backend changes.

## MVP rule

The public Stable/MVP remains USB-only and consultative Intelligence remains the currently promoted
AI authority. This foundation **does not enable an autonomous agent in the MVP**.

What it does now is prevent future autonomy from forcing a rewrite of Memory, Spaces, Projects,
Profiles, permissions or Surface architecture.

Machine-readable authority: `docs/contracts/personal-ordax.json`.


### Resource-bound execution gate

Before any real mutation is registered, sensitive approvals now retain an explicit `resourceRef`.
The same resource identity and approval id are copied into the short-lived tool grant. The Action
Gateway requires exact approval/owner/Space/project/resource/tool/action/effect equality, so a grant
approved for one file-space target cannot authorize another target or another retained approval.

`createPersonalOrdaxActionExecutor()` performs the final authority check immediately before
resolving a typed adapter. A revoked, expired, context-mismatched or resource-substituted grant
fails before the adapter is resolved, and successful adapters return a bounded
`ordax.action-receipt/1`. Activity also shows the exact retained resource before consent.

This gate is now exercised by the first verified Native action
`ordax-native-file-space/files.directory.ensure`. No placeholder artifact hash or generic broker
escape hatch was introduced; additional mutations remain disabled until they satisfy the same
resource/grant/artifact/receipt requirements.

A autoridade sensível também fica presa ao SHA-256 exato do artefato da tool. A approval retém essa identidade, o grant a copia, o Action Gateway compara com a tool atualmente resolvida e o Action Executor compara novamente com o adapter imediatamente antes do efeito. Trocar a implementação mantendo apenas o mesmo `toolId/action` invalida a autorização existente.

### Primeiro adapter Native first-party

O primeiro adapter concreto é `ordax-native-file-space/files.directory.ensure`. Ele usa somente o `fileSpace` canônico já montado na Surface, não expõe shell nem broker genérico e não recebe caminho fora de `file-space:`. A operação é deliberadamente idempotente: se o diretório exato já existir, a mesma execução termina com sucesso sem repetir mutação; se existir outro tipo de entrada no alvo, falha fechado.

A identidade do adapter é o SHA-256 calculado sobre os bytes reais do próprio módulo servido pela mesma origem via Web Crypto. Essa identidade entra na tool e precisa coincidir com approval, grant, Action Gateway e Action Executor. A composição Native conecta somente esse `adapterResolver` verificado ao Action Executor; nenhum broker genérico ou segunda ação mutável é habilitado por consequência.

### Lifecycle foreground da ação

A approval aprovada agora pode entrar explicitamente em execução foreground. O runtime persiste `action-started`, mantém a approval como `approved` durante a tentativa e só a transforma em `executed` quando recebe um `ordax.action-receipt/1` com status `succeeded` que coincide exatamente com Work, approval, tool, SHA-256 do artefato, action, effect, recurso e grant retidos. A mesma approval não pode ser executada novamente depois desse consumo.

Falha sem receipt verificado pausa o Work sem consumir a approval. A retomada/reexecução continua sendo explícita e foi desenhada para adapters idempotentes, começando por `files.directory.ensure`. Este corte ainda não conecta o adapter Native ao Action Executor na composição principal; o lifecycle está pronto antes de abrir o efeito.

### Primeiro side effect foreground habilitado

A composição Native agora conecta exclusivamente o adapter verificado `ordax-native-file-space/files.directory.ensure` ao Action Executor. A Activity só oferece execução depois de approval humana explícita e somente quando o adapter atual tem o mesmo SHA-256 retido pela approval. O grant também é preso ao `workItemId` exato.

A execução faz `approved -> running -> executed`, persiste `action-started/action-finished` e consome a approval apenas com receipt `succeeded` exato. Enquanto existir uma ação aprovada não consumida, o Work não pode iniciar novo raciocínio nem pedir outra approval. Cancelar o Work revoga primeiro o grant no registry e retém a approval como `revoked` para auditoria.

O escopo de side effect habilitado continua deliberadamente único: garantir um diretório dentro do `file-space` canônico. Background, egress, device-control, shell, raw disk e execução genérica continuam desabilitados.

### Action Catalog canônico

A entrada de novas ações não fica hardcoded na Activity. Adapters first-party registram descritores bounded no `ordax.personal-action-catalog/1`; a UI recebe apenas metadados públicos e um `resourceValue` humano. A própria registration converte e valida esse valor para o `resourceRef` canônico antes de criar uma approval. O catálogo não emite grant, não executa adapter e não transforma conteúdo de modelo em autoridade.

O primeiro registro é `native-file.ensure-directory`. A Activity pode solicitar approval para ele sem conhecer `file-space:`, tool IDs ou regras de filesystem. Decisions persistidas agora carregam o `approvalId` exato. Isso permite repetir o mesmo tipo de ação no mesmo Work em recursos diferentes, desde que cada tentativa tenha uma nova approval e um novo grant compatível.

O contrato `ordax.personal-action-proposal/1` agora existe como boundary ephemeral e sem authority. Uma proposal carrega somente `workItemId + entryId + resourceValue + rationale`, fixa `authority=none`, `executionAuthorized=false` e `approvalRequested=false`, e rejeita campos de authority como tool/action IDs, canonical `resourceRef`, grant, approval, decision, effect ou artifact SHA.

O catálogo valida o `entryId` e passa o `resourceValue` pela mesma registration real que futuramente canonicalizaria o recurso, mas descarta o `resourceRef` resultante. Portanto uma proposal não consegue fabricar recurso fora da ação registrada nem receber a referência canônica que alimenta authority. Transformar a proposal em approval continua sendo uma ação explícita separada, que deve chamar o catálogo novamente e revalidar o recurso.

A integração foreground com planner/model agora é user-triggered: a Activity pede explicitamente uma sugestão, o planner envia à Intelligence somente descritores sanitizados do catálogo (`entryId + inputKind + resourceScheme`), exige JSON estrito e revalida o candidato via `catalog.propose()`. A proposal continua `authority=none` e efêmera. Converter essa sugestão em approval exige uma segunda ação explícita do usuário e chama o catálogo novamente; o rationale do modelo nunca substitui o reason confiável da registration. Troca de owner durante a inferência descarta o resultado. Approval e execução automáticos continuam desabilitados.

A recuperação semântica de Work segue a mesma regra de advisory-only. A Activity pode enviar um
pedido explícito de continuidade ao planner, mas somente Work `queued|paused` do owner atual e sem
authority pendente entram como candidatos. O modelo recebe `workItemId + goal + state` e apenas
flags booleanas dizendo se existe Space/Project vinculado; IDs de owner/Space/Project não são
expostos para matching. O resultado é uma suggestion `authority=none` presa à revisão exata do
Work no runtime. Aceitar a suggestion nunca troca contexto. Se o Work está pausado, a aceitação usa
o `resume()` canônico, que exige que o Space/Project original já esteja válido.

### Revogação ligada ao lifecycle

Um runtime com Action Gateway agora é inválido sem um revoker de grants. A revogação deixou de ser responsabilidade da UI/composição e passou a fazer parte do lifecycle canônico do Personal OrdaX.

Qualquer grant aprovado e ainda não consumido é revogado antes de invalidar seu contexto por troca de owner, logout, troca de Space, desaparecimento do projeto ou cancelamento explícito do Work. Isso também vale para Work já pausado após uma tentativa de execução: estar pausado não mantém authority viva. A approval permanece como `revoked` com seu `grantRef` apenas para auditoria; o registry já não resolve esse grant.

### Action Attempt journal e crash recovery

Cada side effect foreground passa a ter um `ordax.personal-action-attempt/1` persistido antes da entrada no adapter. O Attempt liga Work, approval, action, tool artifact, effect, resource e grant exatos.

O executor diferencia falha comprovadamente anterior ao adapter de falha depois de entrar no adapter. A primeira fecha o Attempt como `failed`, pausa o Work e preserva a approval para retry explícito. Depois de entrar no adapter, ausência de receipt verificável fecha como `uncertain`, revoga o grant e pausa o Work. Não existe replay automático de outcome incerto.

Se o processo cair com Attempt `started`, o restore converte esse Attempt para `uncertain` antes de expor o runtime, revoga a authority session-only e mantém o Work pausado. A Activity projeta esse estado para o usuário. Esse protocolo é pré-requisito para qualquer futura mutação não idempotente; rename/move/trash continuam desabilitados neste corte.

Decision e Action Executor também exigem o mesmo `approvalId` exato, além de Work/action/effect/grant, impedindo substituição entre approvals do mesmo tipo de ação.


## Prova automatizada do fluxo modelo → ação autorizada (MVP)

O teste `tests/test_personal_intelligence_foreground_e2e.mjs` exercita, pela
composição Native canônica e sem rota paralela, todo o percurso:

1. `Work` criado a partir de uma solicitação em português;
2. `createPersonalActionProposalPlanner` usa `ordax.intelligence/1` para
   propor apenas a entrada permitida do catálogo, sem conceder autoridade;
3. `requestProposedAction()` produz approval pendente, ainda sem mutação;
4. `approvalConsent.approve()` emite grant limitado pelo proprietário,
   recurso, ação e SHA-256 do artefato;
5. `executeApprovedAction()` revalida autorização com o Action Gateway,
   entra no adapter Native `files.directory.ensure` e retorna receipt
   com referência à pasta verificada;
6. a tentativa é registrada na Activity e a approval não pode ser reutilizada.

A suíte também prova que negar a approval, inventar uma ferramenta ou trocar
a conta antes da aprovação **não** produz efeitos no file-space.

**Tipo de evidência:** teste E2E de integração dos módulos reais com saída
controlada do modelo e implementação de file-space em memória. Ele confirma os
limites de contratos/consentimento, mas **não** mede precisão do modelo Qwen
real, inicialização da engine, latência, segurança do backend Native real ou
resultado em máquina física. O caminho de aprovação é explicitamente humano;
o modelo não ganha o poder de aprovar, executar ou criar grants.

O teste é requisito de regressão de
`.github/workflows/application-action-capability-foundation.yml`. O
passe na CI não altera o estado `PUBLIC RUNTIME DISABLED` nem substitui o
gate físico Stable/MVP ou a revisão de segurança de distribuição.
