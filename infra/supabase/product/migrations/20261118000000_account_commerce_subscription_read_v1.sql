begin;

-- Commerce remains a distinct authority from entitlement grants and measured usage.
-- No existing user receives an inferred Free or paid subscription.
create table if not exists private.ordax_commerce_provider_receipts (
  provider text not null check (provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
  event_id text not null check (length(event_id) between 8 and 200),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  event_kind text not null check (length(event_kind) between 3 and 100),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table private.ordax_commerce_provider_receipts enable row level security;
revoke all on private.ordax_commerce_provider_receipts from public, anon, authenticated;

create table if not exists private.ordax_commerce_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('free','personal','professional','team')),
  lifecycle text not null check (lifecycle in ('trialing','active','past_due','unpaid','canceled','incomplete','expired')),
  source text not null check (source in ('operator-free','verified-provider')),
  provider text,
  provider_event_id text,
  verified_at timestamptz not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  unique(owner_user_id),
  foreign key (provider, provider_event_id)
    references private.ordax_commerce_provider_receipts(provider, event_id),
  constraint ordax_commerce_evidence_boundary check (
    (plan_id = 'free' and source = 'operator-free' and lifecycle = 'active'
      and provider is null and provider_event_id is null
      and current_period_start is null and current_period_end is null
      and cancel_at_period_end = false)
    or
    (plan_id <> 'free' and source = 'verified-provider'
      and provider is not null and provider_event_id is not null
      and current_period_start is not null and current_period_end is not null
      and current_period_end > current_period_start)
  )
);
create index if not exists ordax_commerce_subscriptions_period_idx
  on private.ordax_commerce_subscriptions(current_period_end)
  where current_period_end is not null;
alter table private.ordax_commerce_subscriptions enable row level security;
revoke all on private.ordax_commerce_subscriptions from public, anon, authenticated;

-- Fixed, argument-free, subject-filtered read projection. Never expose
-- provider ids, event ids, invoice data, prices, raw webhooks or credentials.
create or replace function public.ordax_read_account_subscription_row_v1()
returns jsonb
language sql
stable security definer
set search_path = ''
as $sql$
  select jsonb_build_object(
    'owner_user_id', s.owner_user_id,
    'plan_id', s.plan_id,
    'lifecycle', s.lifecycle,
    'source', s.source,
    'verified_at', to_char(s.verified_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'current_period_start', case when s.current_period_start is null then null
      else to_char(s.current_period_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'current_period_end', case when s.current_period_end is null then null
      else to_char(s.current_period_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'cancel_at_period_end', s.cancel_at_period_end
  )
  from private.ordax_commerce_subscriptions s
  where s.owner_user_id = (select auth.uid())
  limit 1;
$sql$;

revoke all on function public.ordax_read_account_subscription_row_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_read_account_subscription_row_v1()
  to authenticated;

-- The named tables are intentionally private: no policy permits direct reads
-- or writes by browser roles. Future verified provider adapters must be the
-- only writers and must reconcile events transactionally and idempotently.
commit;
