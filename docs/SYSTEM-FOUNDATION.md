# OrdaX System Foundation

Status: **SOURCE FOUNDATION / SAFE TO EVOLVE / NO NEW AUTONOMOUS AUTHORITY**

This document fixes the root ownership model for OrdaX as the product grows beyond the original prototype.
Apps remain user-facing clients. Durable identity, Memory, Intelligence, policy, lifecycle and action authority remain system concerns.

## Root model

```text
Adapters / platform capabilities
              |
      System Foundation
  capability registry + lifecycle
  bounded events + restrictive policy
              |
  Identity --- Memory --- Intelligence --- Sync
              |
        Personal OrdaX
              |
       Work / Activity
              |
     Action Gateway / grants
              |
      bounded execution

Apps: Files / Notes / Internet / Activity / Assistant / ORDAX Studio / ...
      consume the system; they do not replace it.
```

`Personal OrdaX` is a system orchestration service, not a super-app and not the owner of identity, Memory or permissions.
`ORDAX Studio` is a first-party app/runtime consumer. Blender, Unity, Three.js and later creative engines are capabilities behind the OrdaX boundary, not alternate OrdaX products.

## Foundation runtime

`system/services/system-foundation/runtime.mjs` introduces four small root primitives:

1. **Capability registry** — records what the current composition can actually provide. Availability is data only and always carries `authority: none`.
2. **Lifecycle graph** — resolves required/optional service dependencies, rejects missing required dependencies and fails closed on cycles.
3. **Bounded system events** — metadata-only operational events with a cursor. It is not a new Memory store and must not be used to dump prompts, secrets or documents.
4. **Restrictive policy aggregation** — combines `pass`, `require-approval` and `deny`; the strictest result wins. `pass` means only “no extra restriction here”, never permission to execute.

Action grants and the Action Gateway remain the authority boundary. The system foundation cannot mint a grant.

## Scheduler and background ownership

Scheduler and background execution belong at system level because updates, sync, backups and Personal OrdaX may all need them. They must not be hidden inside one app.

The source foundation now contains two deliberately non-composed runtimes:

- `system/services/scheduler/runtime.mjs` owns one-shot/interval schedules, missed-run policy, bounded claiming and deterministic deduplication. Its only output is `ordax.schedule-wake-intent/1`, which always carries `authority: none`, `backgroundAuthorized: false`, `approvalAuthorized: false` and `executionAuthorized: false`.
- `system/services/background/runtime.mjs` owns bounded run lifecycle: wall-clock budget, step budget, lease renewal, immediate cancellation, bounded checkpoints, snapshots and fail-closed crash recovery. Active runs restored after a crash are converted to `paused` with `recoveryRequired: true`; they cannot silently resume.

This is **source capability, not product enablement**. Both runtimes remain absent from Native composition and public Surface. The first background policy version is intentionally local read-only: only the `read` effect is accepted, action budget is zero, egress budget is zero, and `write`, `external-egress` and `device-control` cannot be enabled by policy input.

A scheduler may wake Work; it may never start execution or grant authority. A background policy may bound observation; it may never mint approval/grant/action authority. When later integration reaches mutable actions, those actions must still traverse the existing Action Catalog / approval / grant / Action Gateway / Action Executor boundaries and must be revalidated at execution time.

The next promotion step is a separate integration proof from a scheduler wake into one explicitly selected Personal OrdaX Work item, using local read-only observation and visible Activity. External research/connectors and autonomous mutation remain separate future gates.

## Memory for years of use

The current native prototype persists `ordax.memory-snapshot/1` with a bounded item/byte ceiling. That remains a safe compatibility boundary, but it is not the final long-term storage design.

The new `ordax.memory-storage-manifest/1` foundation makes upgrades explicit:

- canonical user Memory stays `ordax.memory/1` and remains OrdaX-owned;
- storage format has its own version, independent of model/provider versions;
- canonical Memory generation is independent of the semantic/embedding index;
- an embedding index is **derived and rebuildable**, so changing the local model never rewrites canonical memories;
- every storage migration is sequential (`N -> N+1`), owner-preserving and fail-closed;
- an older system refuses to downgrade storage written by a newer OrdaX;
- future segmented/partitioned persistence can replace the single snapshot without changing app-facing Memory semantics.

The shared Memory runtime now also understands the optional `ordax.memory-record-store/1` persistence port. Unlike the legacy whole-snapshot port, it reads bounded candidate windows and writes/removes individual validated records, so the service itself no longer needs a global 2,048-item ceiling when that backend is selected. The service still revalidates every returned record and reapplies owner/Space/project/sensitivity authorization before ranking it. Session Memory remains volatile even when the record store is device-durable.

This is a service boundary, not a claim that Native already stores unlimited history. Before promoting Native from `ordax.memory-store/1` to the record backend, Native persistence and Account Memory sync must move together to an owner-partitioned/segmented backend with atomic generation switching and a last-known-good recovery point. Do not simply raise the 2,048-item or 8 MiB limits.

## Profiles and local AI

A user profile is not a hidden monolithic prompt. Preferences, durable facts, instructions and project/Space context remain typed Memory with explicit owner and scope.

Local AI consumes authorized context through OrdaX Intelligence. Model upgrades may change inference or rebuild derived indexes, but they must not silently migrate ownership, erase canonical Memory or make a provider the source of truth.

## Upgrade invariant

A normal OrdaX update may upgrade code and storage formats, but user state follows this order:

```text
read old generation
 -> validate owner + schema
 -> create explicit migration plan
 -> write new generation separately
 -> validate new generation
 -> switch active generation atomically
 -> retain last known-good recovery point
```

Destructive in-place conversion is not the target design.
