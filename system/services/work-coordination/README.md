# Work Coordination Runtime

Status: **INTERNAL RUNTIME FOUNDATION / NOT MOUNTED / PUBLIC DISABLED**

This service implements the lifecycle over the platform-neutral Work Coordination contracts. It is
not an AI agent, task database, permission owner, provider connector or background executor.

## Boundaries

The runtime consumes:

- `ordax.work-coordination-store/1` for atomic owner/project state;
- an injected effective policy resolver;
- an optional injected evidence verifier;
- clock/id factories supplied by composition/tests.

The runtime never mints Action Gateway grants and every retained Work Coordination value remains
`authority=none`.

## User policy

Mutations fail closed when coordination is unconfigured or `off`.

- `manual`: user-triggered coordination only;
- `assisted`: user-triggered coordination only; system suggestions belong outside this mutation
  boundary;
- `automatic`: system-triggered coordination state changes are permitted, but this still grants no
  execution authority.

Reads remain possible so disabled coordination data can still be reviewed/exported/deleted through
future explicit product flows.

## Concurrency

Every mutation loads a partition revision and commits with `compareAndSwap`. A stale writer fails
instead of overwriting newer state.

Task claims are finite leases with heartbeat. A task with an active claim cannot be claimed by a
second client. An expired claim is **not** silently replayed or immediately reassigned: recovery
removes the claim and blocks the task with `stale-claim-reconciliation-required` so external state
can be reconciled before work resumes.

## Handoff

A live claimant may record bounded checkpoints and explicitly hand the task off. Handoff removes the
claim, returns the task to `ready` and can persist one final checkpoint tied to the old claim/lease.

Checkpoints do not contain authority, credentials or an arbitrary chat transcript.

## Evidence

The runtime cannot self-certify evidence. `recordEvidence()` is unavailable unless composition
injects a verifier. The verifier must return a canonical `ordax.work-evidence/1` bound to the exact
current plan/task revision with `verification=verified`.

A claimed task cannot complete until all evidence kinds declared by that task are satisfied by
verified retained evidence. Therefore model text such as "done" cannot satisfy completion policy.

## Dependency progression

New plans derive tasks with no dependencies as `ready`; dependent tasks start `planned`. Completing
a prerequisite promotes newly satisfiable `planned` tasks to `ready`. The store continues to enforce
missing/cross-plan/cyclic dependency rejection.

## Not enabled here

This runtime is not mounted into Native or Web composition by this slice. It does not add:

- remote provider mutations;
- Studio task UI;
- notifications;
- Background Runtime execution;
- scheduler integration;
- autonomous side effects;
- GitHub-specific behavior.

Those remain separate promotion steps under #1154 / #848.
