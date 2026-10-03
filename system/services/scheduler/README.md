# Scheduler

Scheduler is a shared OrdaX system service. It decides **when** a consumer should be awakened; it never decides **what the consumer is authorized to do**.

Every Schedule and occurrence carries `authority: none`. A scheduled Personal OrdaX Work still needs the same Action Policy, Action Review, Action Gateway and exact grants it would need in the foreground.

## Durable outbox

A due schedule is not dispatched directly. The durable store atomically:

1. advances the Schedule revision/run count/next occurrence;
2. creates a pending occurrence with a stable deduplication key.

Only afterward is the pending occurrence delivered through the dispatch port. If delivery fails, it remains pending. If a crash occurs after enqueue but before acknowledgement, delivery may repeat, so consumers must deduplicate by `deduplicationKey`. This avoids pretending distributed exactly-once delivery exists.

## Recurrence in this foundation

Supported:

- one-shot schedules;
- fixed intervals from 1 minute to 30 days;
- explicit IANA timezone metadata;
- bounded `maxRuns`;
- overdue fixed intervals are coalesced to one occurrence and the next time is advanced into the future.

Calendar expressions such as “every weekday at 09:00 local time” are deliberately not approximated with fragile date math in this foundation. They will require a dedicated calendar recurrence contract with DST tests.

## Cancellation

Schedules can be disabled atomically through revision-checked compare-and-swap. Disabling removes `nextRunAt`; it does not delete history or pending occurrences already committed.

## Not enabled yet

This service is source foundation only. It does not connect to Personal OrdaX, does not wake Background Runtime in production and does not enable recurring autonomous mutations.
