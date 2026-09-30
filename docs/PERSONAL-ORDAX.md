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

Next in this phase is an explicit Work entry point plus the shared Activity/result view. That UI
must consume this same runtime rather than create an app-local task or result store, and ordinary
Assistant messages must not become Work automatically.

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
