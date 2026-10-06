# Work Coordination

Status: **FOUNDATION + STORE CONTRACTS / NOT PUBLICLY ENABLED**

Issue: `#1154`

## Goal

Work Coordination is the shared OrdaX system capability for organizing a goal into a versioned plan,
coordinating multiple authorized clients on tasks, preserving bounded handoff checkpoints and
recording evidence of completion.

It exists to prevent duplicated or stale work across ChatGPT conversations, Grok, local
Intelligence, future specialist workers and human-facing OrdaX applications.

It is **not** a Studio-owned task manager and it is **not** a second Personal OrdaX, Project,
Memory, permission, scheduler, notification or execution stack.

## Ownership

```text
Personal OrdaX / Projects / Spaces
            |
            v
    Work Coordination
            |
     +------+------+----------------+
     |             |                |
 Activity       Studio UI      provider connectors
     |                              |
     +------------------------------+
                    |
            canonical state
```

Ownership boundaries:

- `prototipo-ordax-os` owns platform-neutral coordination contracts and shared policy/runtime;
- `ordax-control-plane` may later own remote transport, queueing, audit and provider-facing lease
  operations, but not a second task database;
- `ordax-runtime` owns local/device execution and receipts, not coordination policy;
- `ordax-apps` / Studio owns presentation and software-development UX only;
- ChatGPT, Grok, local Intelligence and future providers are clients of the same contracts.

Provider/client/session metadata is descriptive context only. It does not create authority.

## Contracts

The platform currently defines these internal contracts:

- `ordax.work-coordination-policy/1`
- `ordax.work-plan/1`
- `ordax.work-task/1`
- `ordax.work-claim/1`
- `ordax.work-checkpoint/1`
- `ordax.work-evidence/1`
- `ordax.work-coordination-store/1`
- `ordax.work-coordination-store-state/1`

They do not create UI, background execution or provider connector mutations by themselves. The store
contract defines the canonical persistence boundary shape; a durable Native adapter is still a
separate composition step.

### Policy

Coordination has explicit user policy:

```text
off
manual
assisted
automatic
```

No policy record means there is no contract-level opt-in. A caller must not infer automatic
coordination merely because the feature exists.

`assisted` is the recommended product mode **after the user opts in**: OrdaX may suggest organizing
or continuing work, but it does not silently enroll an unrelated project.

`automatic` requires an explicit confirmation timestamp. Even in automatic coordination mode,
`authority` remains `none`; this mode never grants file, network, device, connector or application
mutation authority.

Policies may be global or project-scoped. A project policy is an override for that exact project;
the future policy resolver must define precedence deterministically instead of relying on UI state.

### Notifications

Policy stores only notification **intent** for coordination-relevant categories:

- approval/action required;
- task blocked;
- work completed;
- stale claim available for recovery;
- duplicate/conflicting work avoided;
- routine progress.

Routine progress is expected to be off in the normal product configuration. The contract does not
send notifications and does not create another notification service. Future composition must reuse
the platform notification owner.

Turning notifications off never turns Work Coordination off, and turning notifications on never
grants execution authority.

### Plan

A Work Plan is owner-bound and revisioned. It may optionally point to an existing Space, Project
and Personal Work item. Those references are reused; Work Coordination does not redefine their
identity.

The plan contains ordered task ids but not a duplicate embedded task database. Plan state is:

```text
active | paused | completed | archived
```

### Task

A task is independently revisioned and belongs to one plan. State is:

```text
planned | ready | blocked | in-progress | review | completed | cancelled
```

Dependencies are explicit task ids. The value contract rejects duplicate dependencies and
self-dependency. The store contract validates the complete retained graph and rejects missing,
cyclic or cross-plan dependencies.

A task may declare required evidence kinds. A completed task that declares required evidence is
invalid in canonical store state unless verified evidence for the exact current task revision is
retained. Model text saying `done` is not evidence.

### Claim

A Claim is an expiring lease for one task. It binds:

- plan and task ids;
- exact plan/task revisions observed when claimed;
- opaque worker/client/session references;
- lease id;
- acquire, heartbeat and expiry timestamps.

A claim has a finite maximum lease window and must be renewed through a later atomic state
transition. It is not a permanent lock.

The store permits at most one retained active claim per task and requires that claim to match the
current plan/task revisions. A retained claim also requires an `active` plan and an `in-progress`
task.

Losing a claim or observing a newer plan/task revision invalidates the client's right to update
coordination state. It does **not** revoke or create Action Gateway authority; those are separate
boundaries.

### Checkpoint

A Checkpoint is small handoff metadata tied to an exact claim/lease and task revision. It may retain:

- bounded summary;
- bounded resume reference;
- bounded artifact references;
- sequence and timestamp.

A checkpoint is not a transcript, prompt archive, Memory replacement, credential store or
authority snapshot. Store validation rejects future task revisions, regressing task revisions,
non-increasing checkpoint sequence within a task revision and regressing checkpoint time.

### Evidence

Evidence records an external or local proof reference for one task revision. Initial kinds are:

```text
pull-request
commit
ci-run
artifact
action-receipt
document
physical-proof
manual-verification
```

Evidence may be `unverified`, `verified` or `rejected`. A reference may point to GitHub, a release
artifact, a device receipt or another typed integration, but the evidence value itself grants no
authority.

GitHub remains an integration/evidence source, not the universal Work source of truth.

## Store, retention and migration

Canonical coordination state is partitioned by exact owner plus optional Project. One partition is
bounded to 4 MiB serialized and has explicit limits for plans, tasks, claims, checkpoints and
evidence.

The mutation port is intentionally narrow:

```text
load(partition)
compareAndSwap(partition, expectedRevision, nextState)
```

A compatible store must not expose a parallel last-write-wins mutation path such as `save()`,
`set()`, `put()`, `write()`, `update()`, `replace()`, `delete()` or `remove()`. Even if a store also
implements `compareAndSwap()`, the presence of one of those mutation aliases makes it incompatible.
This prevents callers from bypassing the concurrency invariant through the same port.

The persisted state carries `formatVersion = 1`. Unknown store schema or format versions are
rejected fail-closed. Migration is owned by the future Native storage adapter and must produce a
fully validated next-format state before it becomes canonical. A migration may not redefine the
owner+project partition and may not create action authority.

Retention is independent from Memory and from feature disablement:

- no automatic deletion is enabled by the store contract;
- `archived` is a Plan state, not a hidden deletion flag;
- completed or archived plans require all retained tasks to be terminal;
- deleting retained coordination data is a separate explicit operation represented by a later
  partition CAS that omits the selected plan graph;
- deletion does not cascade into OrdaX Memory, Project data, files or provider data;
- disabling Work Coordination must not silently delete retained coordination state.

The store contract does not itself decide whether a deletion is user-authorized. That belongs to the
policy/runtime/user-control layer, which must still write through the same revisioned CAS boundary.

## Authority and safety

Every Work Coordination value is fixed to:

```text
authority = "none"
```

The validators reject action/grant fields such as grant, approval, tool, effect or execution
authorization handles.

Therefore:

```text
planning != permission
claiming != permission
checkpointing != permission
evidence != permission
automatic coordination != permission
```

Any real side effect still uses the existing OrdaX policy/review/grant/Action Gateway/receipt
boundaries.

## Relationship with Background Runtime

Work Claim and Background Runtime lease concepts are intentionally consistent but not duplicated
implementations.

- Work Claim answers **who is coordinating this task now?**
- Background Runtime lease answers **which worker owns this bounded background run now?**

A future composed background task may reference both identities, but Work Coordination does not
enable Background Runtime or autonomous execution. #848 remains the gate for public background
work.

## Relationship with Activity

Activity remains the user-visible history/attention surface. Work Coordination should later project
high-signal changes into Activity rather than build a second event center.

Expected product sections include:

- Plan;
- In progress;
- Needs you;
- Blocked;
- Completed;
- interrupted/stale work that can be recovered.

Heartbeat noise is operational state and should not become user-visible Activity spam.

## Disablement

Coordination must be removable from the user's workflow without breaking:

- Projects;
- Personal OrdaX foreground work;
- Studio;
- Git;
- apps;
- normal assistant/tool use.

Disabling policy stops new coordinated behavior. Existing coordination data is retained until a
separate explicit retention/delete operation is accepted and committed through CAS.

## Next implementation order

1. coordination runtime over the CAS store contract;
2. narrow Native durable store adapter using the existing Native state-owner pattern;
3. Activity projection and Settings controls;
4. typed provider connector operations;
5. Studio as the first large consumer;
6. specialist workers/background integration only after existing #848 gates.

Recovery/maintenance that mutates canonical coordination state is not an implicit policy exception:
it must traverse an explicit policy/trigger boundary in the runtime. No step should create a second
SSOT merely to move faster.
