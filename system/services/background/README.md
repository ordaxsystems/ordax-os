# OrdaX Background Runtime

System-owned bounded lifecycle for future long-running Work.

Current source status: **implemented but not composed or publicly enabled**.

The v1 policy is deliberately read-only:

- `read` is the only accepted effect;
- action budget is `0`;
- external-egress budget is `0`;
- leases, wall-clock/step budgets, cancellation and checkpoints are mandatory;
- restored active runs become paused and require external recovery reconciliation;
- this service never calls action adapters, mints approvals, creates grants or bypasses Action Gateway.

Personal OrdaX may later consume this service, but does not own it. Other system workloads such as bounded sync/backup may also use it after their own promotion gates.
