# Background Runtime

Background Runtime is shared **system infrastructure**. Personal OrdaX, Sync, Backup, Updates and future services may consume it; no app owns it.

This foundation deliberately does **not** execute tools, issue grants or enable Personal OrdaX autonomy. A background run always carries `authority: none`.

## Safety model

A run is bounded by four budgets:

- wall-clock deadline;
- steps;
- actions;
- external-egress bytes.

Work must reserve the relevant budget **before** performing the operation. Budget exhaustion pauses the run and revokes its lease.

Only one worker may own a run at a time through a short lease. The durable store must provide atomic compare-and-swap by revision; a plain last-write-wins store is not compatible.

Leases have heartbeat and expiry. After a crash, `recover()` never silently resumes an expired worker: it converts an expired running lease to a paused run while preserving its last validated checkpoint. Deadline expiry fails the run.

Cancellation is persisted immediately, removes the active lease and prevents the stale worker from heartbeating, checkpointing or completing.

## Checkpoints

Checkpoints contain only bounded recovery metadata (`sequence`, optional cursor, digest and timestamp). They are not a second Memory system and must not contain prompts, credentials, documents or arbitrary model context.

## Authority

A run lease means only **permission to consume runtime resources**. It is not permission to perform a side effect. Every side effect still requires the normal Action Policy, Action Review, Action Gateway and exact action authority at execution time.

## Not enabled yet

This foundation does not:

- flip `backgroundExecution` on Personal OrdaX Work;
- schedule recurring work;
- enable connectors, browser control or device control;
- install a production durable store;
- auto-resume after reboot;
- grant autonomous mutation.

Those require explicit composition and deployment proofs after this contract is stable.
