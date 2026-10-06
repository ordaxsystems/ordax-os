# Work Coordination

Status: **FOUNDATION CONTRACTS ONLY / NOT PUBLICLY ENABLED**

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

The first foundation publishes six internal platform contracts in
`system/contracts/work-coordination.mjs`:

- `ordax.work-coordination-policy/1`
- `ordax.work-plan/1`
- `ordax.work-task/1`
- `ordax.work-claim/1`
- `ordax.work-checkpoint/1`
- `ordax.work-evidence/1`

These contracts do not create storage, UI, background execution or connector mutations by
themselves.

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
self-dependency. Full graph validation (missing dependencies/cycles/cross-plan references) belongs
to the future coordination runtime because it requires access to the whole plan snapshot.

A task may declare required evidence kinds. A future runtime can only call the task complete when
its declared completion policy is satisfied; model text saying "done" is not evidence.

### Claim

A Claim is an expiring lease for one task. It binds:

- plan and task ids;
- exact plan/task revisions observed when claimed;
- opaque worker/client/session references;
- lease id;
- acquire, heartbeat and expiry timestamps.

A claim has a finite maximum lease window and must be renewed through a later atomic state
transition. It is not a permanent lock.

The future store/runtime must use compare-and-swap semantics so two clients cannot successfully
claim the same ready task from the same revision.

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
authority snapshot.

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

Disabling policy stops new coordinated behavior. Existing coordination data should not be deleted
as a side effect; deletion/retention is a separate explicit operation to be defined with the store.

## Next implementation order

1. owner/project-scoped atomic store;
2. plan/task graph validation and ready/blocked derivation;
3. claim/heartbeat/expiry/recovery runtime;
4. checkpoint/handoff and evidence evaluation;
5. Activity projection and Settings controls;
6. typed provider connector operations;
7. Studio as the first large consumer;
8. specialist workers/background integration only after existing #848 gates.

No step should create a second SSOT merely to move faster.
