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

The source now contains the stable work/activity contracts plus a foreground runtime under
`system/services/personal-ordax/`. It binds work to the exact device/account owner and optional
explicit Space/project, persists each owner in an isolated store partition, pauses the previous
partition on identity change, preserves corrupt durable partitions without overwriting them,
discards stale inference results, keeps Intelligence consultative and persists only through the
dedicated bounded work-store contract. Successful foreground reasoning now also persists a bounded
owner-partitioned Work Result atomically with the `completed` state and its Activity reference.
A Native device-store adapter also exists with one storage record per owner. It preserves corrupt
owner bytes and blocks only that owner instead of resetting silently. The adapter is deliberately
device-local; it is not account sync and it does not reuse Memory as a task database. Native
composition now mounts the Personal OrdaX runtime with the canonical identity session, Space
selection, Projects catalog and selected-Space Intelligence ports. The composition does not infer
Space or Project binding and owns no parallel context service.

The Native Surface now has an explicit Activity app entry point. Work is created only after a
deliberate user action in that app; ordinary Assistant messages do not become Work automatically.
The Activity/result view projects Work, Activity and Result directly from the same mounted runtime
and owns no task/result persistence. It can inspect existing owner work even when Intelligence is
temporarily unavailable; execution still fails closed unless the canonical Intelligence port is
ready.

Approval/Action Gateway integration now has a source-level execution gate. Approval requests are
owner-bound runtime state, transition Work to `waiting-approval`, and are recorded in ordered
Activity. Resolution goes through `ordax.action-gateway/1`; the Personal OrdaX gateway reuses
`ordax.intelligence-tool-grant/1` and requires an exact owner, optional Space/project, tool,
action and read/write-mode match. Missing grants remain `approval-required`; invalid, expired or
cross-context grants fail closed to `deny`. Approved sensitive actions require the exact grant
reference, and resolved approvals are persisted with their terminal action decision and Activity
event as one validated graph.

The Action Gateway does not execute side effects yet. Native composition now owns a bounded
session-scoped Intelligence tool grant authority and injects only its read-only registry into the
Personal OrdaX Action Gateway. The issuer is a separate trusted port, requires explicit user
approval, issues only exact owner/Space/project/tool/action grants with an initial five-minute
maximum TTL, and is not exposed through the Personal OrdaX runtime or Activity app. This removes
the previous fake-resolver gap without turning model output or app state into authority.

The typed `ordax.action-executor/1` boundary is also defined, and it rejects non-`allow`,
mismatched or sensitive grant-less executions before an executor can receive them. Native
composition now mounts `ordax.personal-approval-consent/1` as the only UI-facing path to the
issuer. Activity receives that narrow controller, never the issuer itself. The Approve affordance is
rendered only when the controller can resolve the retained tool/action to a compatible typed action;
when available, an explicit Approve click can issue one short-lived exact `read|write` grant and
resolve the retained approval. With the current Native main composition no typed Personal OrdaX
tool is registered yet, so this preflight stays fail-closed instead of presenting a fake approval.
An explicit Deny is routed through the Action Gateway and retained as a terminal deny decision.
If context changes or approval resolution fails after issuance, the controller revokes the new
grant instead of leaving orphan authority. Egress and device-control cannot be approved through
this tool-grant controller.

There is still no executor implementation and no side effect path in Native composition. Approval
now means only that a bounded grant exists for the exact retained action; it does not execute the
action. The next gate is a real typed tool/action adapter plus immediate grant/context revalidation
at the executor boundary and an auditable action receipt. Background execution remains disabled.

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
