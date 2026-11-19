# Entitlements and service quotas

OrdaX separates **entitlement** (whether a remote capability exists for the subject) from **quota** (how much metered remote capacity may be allocated).

`ordax.entitlements/1` remains the stable capability/plan decision port. `ordax.service-quota-*` adds provider-neutral usage admission for metered remote services.

## Authority

Quota checks do not create Action Gateway authority. For remote paid value, both policy and usage are server-authoritative. A client may display a preflight result, but the canonical server mutation must re-check quota in the same transaction that allocates or changes the remote resource.

## Downgrade

When existing usage is above a new lower quota, OrdaX retains existing user data and blocks only new growth until usage falls below the limit or the plan changes. Delete and account export must remain available while over quota.

## Providers

The current product backend adapter is Supabase. The quota contract intentionally does not bind product semantics to Supabase, Cloudflare or another vendor. Object storage such as R2 may be useful later for large user-selected blobs or backups, but it must not become the authority for identity, entitlements or transactional Memory mutations.

## Authenticated subscription state — first backend slice

The Account subscription is separate from entitlement grants and the public reference catalog. The single bounded gateway projection in infra/supabase/functions/_shared/account_subscription.mjs accepts only verified, owner-matched rows. It never infers Free or a paid plan from an empty database, a logged-in session, a UI-selected offer or an entitlement.

The migration 20261118000000_account_commerce_subscription_read_v1.sql introduces a private evidence-backed subscription ledger, a unique subject row, immutable provider event identifiers and an exact own-subject read RPC. No user is silently enrolled. The Account gateway owns GET /account/subscription after normal activation, returning ordax.account-subscription-view/1. It does not grant quota, authorize actions, create payments, reconcile invoices or provide checkout.

Full billing still requires a selected production payment provider, signature-verified webhook ingestion, idempotent reconciliation, invoice and charge read models, cancellation/downgrade, refund tests, cost validation and a separate public commercial-release gate. Absence stays unverified, distinct from explicit Free or failed backend.

## Pricing

The approved reference offer catalog lives in `docs/contracts/entitlements.json`. The public builder projects its prices, capacities and additional offers into the landing page and Account through `tools/public-site/plan_catalog.py`. These are reference offers, not active grants or checkout quotes. `commercial_capacity_allocation_enabled=false` preserves the measured-cost activation gate.

Operational cost-sensitive numeric quotas are not assigned by this presentation. `memory.cloud.bytes`, `memory.history.days`, `ai.external.compute`, `sync.bytes`, `backup.bytes` and `storage.user.bytes` stay unset until real unit costs and retention behavior are measured. Structural limits already present in the plan catalog (Spaces, connectors, automations, members) remain independent of this accounting foundation.
