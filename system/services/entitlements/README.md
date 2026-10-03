# Entitlements and service quotas

OrdaX separates **entitlement** (whether a remote capability exists for the subject) from **quota** (how much metered remote capacity may be allocated).

`ordax.entitlements/1` remains the stable capability/plan decision port. `ordax.service-quota-*` adds provider-neutral usage admission for metered remote services.

## Authority

Quota checks do not create Action Gateway authority. For remote paid value, both policy and usage are server-authoritative. A client may display a preflight result, but the canonical server mutation must re-check quota in the same transaction that allocates or changes the remote resource.

## Downgrade

When existing usage is above a new lower quota, OrdaX retains existing user data and blocks only new growth until usage falls below the limit or the plan changes. Delete and account export must remain available while over quota.

## Providers

The current product backend adapter is Supabase. The quota contract intentionally does not bind product semantics to Supabase, Cloudflare or another vendor. Object storage such as R2 may be useful later for large user-selected blobs or backups, but it must not become the authority for identity, entitlements or transactional Memory mutations.

## Pricing

Cost-sensitive numeric quotas are deliberately not guessed. `memory.cloud.bytes`, `memory.history.days`, `ai.external.compute`, `sync.bytes` and `backup.bytes` stay unset until real unit costs and retention behavior are measured. Structural limits already present in the plan catalog (Spaces, connectors, automations, members) remain independent of this accounting foundation.
