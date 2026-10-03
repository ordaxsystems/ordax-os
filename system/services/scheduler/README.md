# OrdaX Scheduler

System-owned scheduling foundation for Work and future bounded system jobs.

Current source status: **implemented but not composed or publicly enabled**.

The scheduler owns time, recurrence, missed-run handling and deduplication. Its output is only an authority-free wake intent. It does not:

- start Personal OrdaX execution by itself;
- approve an action;
- create or reuse a grant;
- call an adapter;
- infer a new owner, Space or project context.

A consumer must revalidate the current owner/context and apply its own policy before converting a wake into any runtime work. Mutable actions remain behind the canonical Action Gateway and Action Executor boundaries.
