-- Generated from five canonical owner migrations (NO duplicate ledger).
-- Target ref: jhfphsjptrpmtnzkpwud; VERIFY your connection outside this artifact.
-- Output is SQL text only; this command NEVER connects to PostgreSQL.
-- EXPLICIT COMMIT BUNDLE: deploy ONLY after reviewed staging evidence.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $ordax_preflight$
BEGIN
  -- A populated user database is EXPECTED. A partial storage installation is not.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ordax:storage-quota-destination-foundation:1',0)
  );
  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.ordax_spaces') IS NULL
     OR to_regclass('public.ordax_entitlement_grants') IS NULL
     OR to_regnamespace('private') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('private.ordax_touch_updated_at()') IS NULL
     OR to_regprocedure('private.ordax_authenticated_subject_eligible_v1()') IS NULL
     OR to_regprocedure('private.ordax_can_access_space(uuid)') IS NULL
  THEN RAISE EXCEPTION 'storage-destination-prerequisite-missing'; END IF;
  IF to_regnamespace('ordax_policy') IS NOT NULL
  THEN RAISE EXCEPTION 'storage-destination-legacy-policy-owner-drift'; END IF;

  IF to_regclass('public.ordax_user_objects') IS NOT NULL
     OR to_regclass('private.ordax_user_object_provider_refs') IS NOT NULL
     OR to_regclass('private.ordax_user_upload_reservations') IS NOT NULL
     OR to_regclass('private.ordax_service_quota_usage') IS NOT NULL
     OR to_regclass('private.ordax_service_quota_reservations') IS NOT NULL
     OR to_regprocedure('private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)') IS NOT NULL
     OR to_regprocedure('private.ordax_reduce_service_quota_usage_v1(uuid,uuid,text,text,bigint)') IS NOT NULL
     OR to_regprocedure('public.ordax_service_quota_usage_status_v1(uuid,uuid,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'storage-destination-partial-or-previous-install'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users)
  THEN RAISE EXCEPTION 'storage-destination-populated-user-guard-failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
     OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')
     OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role')
  THEN RAISE EXCEPTION 'storage-destination-api-roles-missing'; END IF;
END;
$ordax_preflight$;

-- SOURCE 20261007050000_service_quota_ledger_v1.sql
-- Server-authoritative quota metering and reservation ledger v1.
--
-- This layer deliberately does not assign commercial numeric limits. Limits are
-- resolved only from active server-owned entitlement grants. The private helper
-- functions are not executable by API roles; domain executors must call them from
-- an audited SECURITY DEFINER mutation so quota reservation and resource mutation
-- share one database transaction.


create table private.ordax_service_quota_usage (
  usage_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  space_id uuid references public.ordax_spaces(space_id) on delete cascade,
  quota_key text not null
    check (quota_key ~ '^[a-z][a-z0-9.-]{2,95}$'),
  unit text not null
    check (unit in ('bytes','items','operations','compute-units','days')),
  used_units bigint not null default 0 check (used_units >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((user_id is not null)::integer + (space_id is not null)::integer = 1)
);

create unique index ordax_service_quota_usage_user_key_idx
  on private.ordax_service_quota_usage(user_id, quota_key)
  where user_id is not null;

create unique index ordax_service_quota_usage_space_key_idx
  on private.ordax_service_quota_usage(space_id, quota_key)
  where space_id is not null;

create table private.ordax_service_quota_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  usage_id uuid not null
    references private.ordax_service_quota_usage(usage_id)
    on delete cascade,
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 200),
  requested_units bigint not null check (requested_units >= 0),
  state text not null default 'reserved'
    check (state in ('reserved','committed','released','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  settled_at timestamptz,
  unique (usage_id, idempotency_key),
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '1 hour'),
  check (
    (state = 'reserved' and settled_at is null)
    or (state <> 'reserved' and settled_at is not null)
  )
);

create index ordax_service_quota_reservations_active_idx
  on private.ordax_service_quota_reservations(usage_id, expires_at)
  where state = 'reserved';

alter table private.ordax_service_quota_usage enable row level security;
alter table private.ordax_service_quota_reservations enable row level security;

revoke all on table private.ordax_service_quota_usage
  from public, anon, authenticated, service_role;
revoke all on table private.ordax_service_quota_reservations
  from public, anon, authenticated, service_role;

create trigger touch_ordax_service_quota_usage_updated_at
before update on private.ordax_service_quota_usage
for each row execute function private.ordax_touch_updated_at();

create or replace function private.ordax_reserve_service_quota_v1(
  p_user_id uuid,
  p_space_id uuid,
  p_quota_key text,
  p_unit text,
  p_requested_units bigint,
  p_idempotency_key text,
  p_ttl_seconds integer default 600
)
returns table (
  reservation_id uuid,
  quota_state text,
  can_allocate boolean,
  used_units bigint,
  reserved_units bigint,
  limit_units bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $reserve$
declare
  v_subject_kind text;
  v_subject_id uuid;
  v_usage_id uuid;
  v_used bigint;
  v_reserved bigint;
  v_limit bigint;
  v_policy_value jsonb;
  v_policy_valid_until timestamptz;
  v_policy_count integer;
  v_existing private.ordax_service_quota_reservations%rowtype;
  v_expires_at timestamptz;
  v_state text;
  v_grant_id uuid;
  v_limit_text text;
begin
  if ((p_user_id is not null)::integer + (p_space_id is not null)::integer) <> 1 then
    raise exception 'quota-subject-invalid' using errcode = '22023';
  end if;
  if p_quota_key is null
     or p_quota_key !~ '^[a-z][a-z0-9.-]{2,95}$' then
    raise exception 'quota-key-invalid' using errcode = '22023';
  end if;
  if p_unit not in ('bytes','items','operations','compute-units','days') then
    raise exception 'quota-unit-invalid' using errcode = '22023';
  end if;
  if p_requested_units is null or p_requested_units < 0 then
    raise exception 'quota-request-invalid' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) < 8
     or char_length(p_idempotency_key) > 200 then
    raise exception 'quota-idempotency-key-invalid' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    raise exception 'quota-reservation-ttl-invalid' using errcode = '22023';
  end if;

  if p_user_id is not null then
    v_subject_kind := 'account';
    v_subject_id := p_user_id;
  else
    v_subject_kind := 'space';
    v_subject_id := p_space_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_subject_kind || ':' || v_subject_id::text || ':' || p_quota_key,
      0
    )
  );

  select count(*)::integer
    into v_policy_count
  from public.ordax_entitlement_grants g
  where g.entitlement_key = p_quota_key
    and (
      (p_user_id is not null and g.user_id = p_user_id and g.space_id is null)
      or
      (p_space_id is not null and g.space_id = p_space_id and g.user_id is null)
    )
    and g.valid_from <= statement_timestamp()
    and (g.valid_until is null or g.valid_until > statement_timestamp());

  if v_policy_count = 0 then
    raise exception 'quota-policy-unavailable' using errcode = '55000';
  end if;
  if v_policy_count <> 1 then
    raise exception 'quota-policy-ambiguous' using errcode = '55000';
  end if;

  select g.grant_id, g.entitlement_value, g.valid_until
    into v_grant_id, v_policy_value, v_policy_valid_until
  from public.ordax_entitlement_grants g
  where g.entitlement_key = p_quota_key
    and (
      (p_user_id is not null and g.user_id = p_user_id and g.space_id is null)
      or
      (p_space_id is not null and g.space_id = p_space_id and g.user_id is null)
    )
    and g.valid_from <= statement_timestamp()
    and (g.valid_until is null or g.valid_until > statement_timestamp())
  order by g.valid_from desc, g.grant_id
  limit 1
  for share;

  if v_grant_id is null
     or jsonb_typeof(v_policy_value) <> 'object' then
    raise exception 'quota-policy-invalid' using errcode = '22023';
  end if;

  if not (v_policy_value ? 'decision')
     or not (v_policy_value ? 'type')
     or not (v_policy_value ? 'unit')
     or not (v_policy_value ? 'limit')
     or (v_policy_value - array['decision','type','unit','limit']::text[]) <> '{}'::jsonb
     or v_policy_value->>'type' <> 'quota'
     or v_policy_value->>'unit' <> p_unit
     or v_policy_value->>'decision' not in ('allowed','denied') then
    raise exception 'quota-policy-invalid' using errcode = '22023';
  end if;

  if v_policy_value->>'decision' = 'denied' then
    if jsonb_typeof(v_policy_value->'limit') <> 'number'
       or (v_policy_value->>'limit') !~ '^0$' then
      raise exception 'quota-policy-invalid' using errcode = '22023';
    end if;
    v_limit := 0;
  elsif jsonb_typeof(v_policy_value->'limit') = 'null' then
    v_limit := null;
  elsif jsonb_typeof(v_policy_value->'limit') = 'number' then
    v_limit_text := v_policy_value->>'limit';
    if v_limit_text !~ '^[0-9]+$'
       or v_limit_text::numeric > 9223372036854775807 then
      raise exception 'quota-policy-invalid' using errcode = '22023';
    end if;
    v_limit := v_limit_text::bigint;
  else
    raise exception 'quota-policy-invalid' using errcode = '22023';
  end if;

  select u.usage_id, u.used_units
    into v_usage_id, v_used
  from private.ordax_service_quota_usage u
  where (
    (
      p_user_id is not null
      and u.user_id = p_user_id
      and u.space_id is null
    )
    or (
      p_space_id is not null
      and u.space_id = p_space_id
      and u.user_id is null
    )
  )
    and u.quota_key = p_quota_key
  for update;

  if v_usage_id is null then
    insert into private.ordax_service_quota_usage(
      user_id,
      space_id,
      quota_key,
      unit
    ) values (
      p_user_id,
      p_space_id,
      p_quota_key,
      p_unit
    )
    returning ordax_service_quota_usage.usage_id,
              ordax_service_quota_usage.used_units
      into v_usage_id, v_used;
  else
    if exists (
      select 1
      from private.ordax_service_quota_usage u
      where u.usage_id = v_usage_id
        and u.unit <> p_unit
    ) then
      raise exception 'quota-unit-drift' using errcode = '23514';
    end if;
  end if;

  update private.ordax_service_quota_reservations r
  set
    state = 'expired',
    settled_at = statement_timestamp()
  where r.usage_id = v_usage_id
    and r.state = 'reserved'
    and r.expires_at <= statement_timestamp();

  select r.*
    into v_existing
  from private.ordax_service_quota_reservations r
  where r.usage_id = v_usage_id
    and r.idempotency_key = p_idempotency_key
  for update;

  select coalesce(sum(r.requested_units), 0)::bigint
    into v_reserved
  from private.ordax_service_quota_reservations r
  where r.usage_id = v_usage_id
    and r.state = 'reserved'
    and r.expires_at > statement_timestamp();

  if v_existing.reservation_id is not null then
    if v_existing.requested_units <> p_requested_units then
      raise exception 'quota-idempotency-conflict' using errcode = '23505';
    end if;
    if v_existing.state = 'committed' then
      return query
      select
        v_existing.reservation_id,
        'committed'::text,
        true,
        v_used,
        v_reserved,
        v_limit,
        v_existing.expires_at;
      return;
    end if;
    if v_existing.state <> 'reserved'
       or v_existing.expires_at <= statement_timestamp() then
      raise exception 'quota-idempotency-key-reused' using errcode = '23505';
    end if;
    return query
    select
      v_existing.reservation_id,
      case
        when v_limit is null then 'unmetered'
        when v_used + v_reserved > v_limit then 'over-quota-retained'
        else 'within-quota'
      end,
      true,
      v_used,
      v_reserved,
      v_limit,
      v_existing.expires_at;
    return;
  end if;

  if v_limit is null then
    v_state := 'unmetered';
  elsif v_used + v_reserved > v_limit then
    v_state := 'over-quota-retained';
  elsif v_used + v_reserved + p_requested_units <= v_limit then
    v_state := 'within-quota';
  else
    v_state := 'quota-exceeded';
  end if;

  if v_state in ('over-quota-retained','quota-exceeded') then
    return query
    select
      null::uuid,
      v_state,
      false,
      v_used,
      v_reserved,
      v_limit,
      null::timestamptz;
    return;
  end if;

  v_expires_at := statement_timestamp() + make_interval(secs => p_ttl_seconds);
  if v_policy_valid_until is not null then
    v_expires_at := least(v_expires_at, v_policy_valid_until);
  end if;
  if v_expires_at <= statement_timestamp() then
    raise exception 'quota-policy-expired' using errcode = '55000';
  end if;

  insert into private.ordax_service_quota_reservations(
    usage_id,
    idempotency_key,
    requested_units,
    expires_at
  ) values (
    v_usage_id,
    p_idempotency_key,
    p_requested_units,
    v_expires_at
  )
  returning ordax_service_quota_reservations.reservation_id
    into reservation_id;

  v_reserved := v_reserved + p_requested_units;

  return query
  select
    reservation_id,
    v_state,
    true,
    v_used,
    v_reserved,
    v_limit,
    v_expires_at;
end;
$reserve$;

create or replace function private.ordax_commit_service_quota_reservation_v1(
  p_reservation_id uuid
)
returns table (
  committed boolean,
  used_units bigint,
  reserved_units bigint
)
language plpgsql
security definer
set search_path = ''
as $commit$
declare
  v_usage_id uuid;
  v_reservation private.ordax_service_quota_reservations%rowtype;
  v_used bigint;
  v_reserved bigint;
begin
  select r.usage_id
    into v_usage_id
  from private.ordax_service_quota_reservations r
  where r.reservation_id = p_reservation_id;

  if v_usage_id is null then
    raise exception 'quota-reservation-not-found' using errcode = '22023';
  end if;

  select u.used_units
    into v_used
  from private.ordax_service_quota_usage u
  where u.usage_id = v_usage_id
  for update;

  select r.*
    into v_reservation
  from private.ordax_service_quota_reservations r
  where r.reservation_id = p_reservation_id
    and r.usage_id = v_usage_id
  for update;

  if v_reservation.state = 'committed' then
    select coalesce(sum(r.requested_units), 0)::bigint
      into v_reserved
    from private.ordax_service_quota_reservations r
    where r.usage_id = v_usage_id
      and r.state = 'reserved'
      and r.expires_at > statement_timestamp();
    return query select true, v_used, v_reserved;
    return;
  end if;

  if v_reservation.state <> 'reserved' then
    select coalesce(sum(r.requested_units), 0)::bigint
      into v_reserved
    from private.ordax_service_quota_reservations r
    where r.usage_id = v_usage_id
      and r.state = 'reserved'
      and r.expires_at > statement_timestamp();
    return query select false, v_used, v_reserved;
    return;
  end if;

  if v_reservation.expires_at <= statement_timestamp() then
    update private.ordax_service_quota_reservations r
    set
      state = 'expired',
      settled_at = statement_timestamp()
    where r.reservation_id = p_reservation_id;
    select coalesce(sum(r.requested_units), 0)::bigint
      into v_reserved
    from private.ordax_service_quota_reservations r
    where r.usage_id = v_usage_id
      and r.state = 'reserved'
      and r.expires_at > statement_timestamp();
    return query select false, v_used, v_reserved;
    return;
  end if;

  update private.ordax_service_quota_usage u
  set used_units = u.used_units + v_reservation.requested_units
  where u.usage_id = v_usage_id
  returning u.used_units into v_used;

  update private.ordax_service_quota_reservations r
  set
    state = 'committed',
    settled_at = statement_timestamp()
  where r.reservation_id = p_reservation_id;

  select coalesce(sum(r.requested_units), 0)::bigint
    into v_reserved
  from private.ordax_service_quota_reservations r
  where r.usage_id = v_usage_id
    and r.state = 'reserved'
    and r.expires_at > statement_timestamp();

  return query select true, v_used, v_reserved;
end;
$commit$;

create or replace function private.ordax_release_service_quota_reservation_v1(
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $release$
declare
  v_state text;
begin
  select r.state
    into v_state
  from private.ordax_service_quota_reservations r
  where r.reservation_id = p_reservation_id
  for update;

  if v_state is null then
    return false;
  end if;
  if v_state = 'released' or v_state = 'expired' then
    return true;
  end if;
  if v_state = 'committed' then
    return false;
  end if;

  update private.ordax_service_quota_reservations r
  set
    state = case
      when r.expires_at <= statement_timestamp() then 'expired'
      else 'released'
    end,
    settled_at = statement_timestamp()
  where r.reservation_id = p_reservation_id
    and r.state = 'reserved';

  return found;
end;
$release$;

create or replace function public.ordax_service_quota_usage_status_v1(
  p_user_id uuid,
  p_space_id uuid,
  p_quota_key text
)
returns table (
  used_units bigint,
  reserved_units bigint,
  active_reservations bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $status$
declare
  v_usage_id uuid;
begin
  if ((p_user_id is not null)::integer + (p_space_id is not null)::integer) <> 1 then
    raise exception 'quota-subject-invalid' using errcode = '22023';
  end if;
  if p_quota_key is null
     or p_quota_key !~ '^[a-z][a-z0-9.-]{2,95}$' then
    raise exception 'quota-key-invalid' using errcode = '22023';
  end if;

  select u.usage_id
    into v_usage_id
  from private.ordax_service_quota_usage u
  where u.quota_key = p_quota_key
    and (
      (p_user_id is not null and u.user_id = p_user_id and u.space_id is null)
      or
      (p_space_id is not null and u.space_id = p_space_id and u.user_id is null)
    );

  if v_usage_id is null then
    return query select 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  return query
  select
    u.used_units,
    coalesce(sum(r.requested_units) filter (
      where r.state = 'reserved'
        and r.expires_at > statement_timestamp()
    ), 0)::bigint,
    count(r.reservation_id) filter (
      where r.state = 'reserved'
        and r.expires_at > statement_timestamp()
    )::bigint
  from private.ordax_service_quota_usage u
  left join private.ordax_service_quota_reservations r
    on r.usage_id = u.usage_id
  where u.usage_id = v_usage_id
  group by u.used_units;
end;
$status$;

revoke all on function private.ordax_reserve_service_quota_v1(
  uuid, uuid, text, text, bigint, text, integer
) from public, anon, authenticated, service_role;
revoke all on function private.ordax_commit_service_quota_reservation_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ordax_release_service_quota_reservation_v1(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.ordax_service_quota_usage_status_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_service_quota_usage_status_v1(uuid, uuid, text)
  to service_role;

comment on table private.ordax_service_quota_usage is
  'Server-authoritative logical usage meter. No client or service_role direct DML; domain executors mutate through reviewed SECURITY DEFINER transactions.';
comment on table private.ordax_service_quota_reservations is
  'Short-lived quota allocations serialized with logical usage. A reservation grants quota capacity only and never product action authority.';

-- SOURCE 20261007083105_service_quota_usage_reduction_v1.sql
-- Private committed-usage reduction for server-authoritative service quotas.
--
-- Reductions are intentionally independent from current entitlement policy so
-- deletion/cleanup can always release logical usage, including while over quota
-- or after an entitlement is removed. Domain executors must call this helper in
-- the same transaction as the corresponding resource deletion.


create or replace function private.ordax_reduce_service_quota_usage_v1(
  p_user_id uuid,
  p_space_id uuid,
  p_quota_key text,
  p_unit text,
  p_released_units bigint
)
returns table (
  reduced boolean,
  used_units bigint,
  reserved_units bigint
)
language plpgsql
security definer
set search_path = ''
as $reduce$
declare
  v_subject_kind text;
  v_subject_id uuid;
  v_usage_id uuid;
  v_used bigint;
  v_unit text;
  v_reserved bigint;
begin
  if ((p_user_id is not null)::integer + (p_space_id is not null)::integer) <> 1 then
    raise exception 'quota-subject-invalid' using errcode = '22023';
  end if;
  if p_quota_key is null
     or p_quota_key !~ '^[a-z][a-z0-9.-]{2,95}$' then
    raise exception 'quota-key-invalid' using errcode = '22023';
  end if;
  if p_unit not in ('bytes','items','operations','compute-units','days') then
    raise exception 'quota-unit-invalid' using errcode = '22023';
  end if;
  if p_released_units is null or p_released_units < 0 then
    raise exception 'quota-release-invalid' using errcode = '22023';
  end if;

  if p_user_id is not null then
    v_subject_kind := 'account';
    v_subject_id := p_user_id;
  else
    v_subject_kind := 'space';
    v_subject_id := p_space_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_subject_kind || ':' || v_subject_id::text || ':' || p_quota_key,
      0
    )
  );

  select u.usage_id, u.used_units, u.unit
    into v_usage_id, v_used, v_unit
  from private.ordax_service_quota_usage u
  where (
    (
      p_user_id is not null
      and u.user_id = p_user_id
      and u.space_id is null
    )
    or (
      p_space_id is not null
      and u.space_id = p_space_id
      and u.user_id is null
    )
  )
    and u.quota_key = p_quota_key
  for update;

  if v_usage_id is null then
    raise exception 'quota-usage-unavailable' using errcode = '55000';
  end if;
  if v_unit <> p_unit then
    raise exception 'quota-unit-drift' using errcode = '23514';
  end if;
  if v_used < p_released_units then
    raise exception 'quota-usage-underflow' using errcode = '23514';
  end if;

  update private.ordax_service_quota_usage u
  set used_units = u.used_units - p_released_units
  where u.usage_id = v_usage_id
  returning u.used_units into v_used;

  select coalesce(sum(r.requested_units), 0)::bigint
    into v_reserved
  from private.ordax_service_quota_reservations r
  where r.usage_id = v_usage_id
    and r.state = 'reserved'
    and r.expires_at > statement_timestamp();

  return query select true, v_used, v_reserved;
end;
$reduce$;

revoke all on function private.ordax_reduce_service_quota_usage_v1(
  uuid, uuid, text, text, bigint
) from public, anon, authenticated, service_role;

comment on function private.ordax_reduce_service_quota_usage_v1(
  uuid, uuid, text, text, bigint
) is
  'Private logical-usage reduction for reviewed domain deletion transactions. It does not consult entitlement policy and rejects accounting underflow.';

-- SOURCE 20261005171000_user_cloud_storage_foundation_v2.sql
-- User Cloud Storage source foundation v2.
--
-- This migration is intentionally fail-closed: it creates read-only client metadata
-- plus private provider/reservation state, but no client or service_role mutation
-- grants. A later audited executor/gateway boundary must own every mutation before
-- public rollout is enabled.


create table public.ordax_user_objects (
  object_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  space_id uuid references public.ordax_spaces(space_id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 255),
  media_type text not null check (char_length(media_type) between 1 and 160),
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  server_revision bigint not null default 1 check (server_revision > 0),
  state text not null default 'active' check (state in ('active', 'deleted')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table private.ordax_user_object_provider_refs (
  object_id uuid primary key references public.ordax_user_objects(object_id) on delete restrict,
  provider text not null check (provider in ('supabase-storage', 'cloudflare-r2', 'other')),
  provider_bucket text not null check (char_length(provider_bucket) between 1 and 160),
  provider_object_key text not null check (
    char_length(provider_object_key) between 8 and 512
    and provider_object_key !~ '^[\\/]'
    and provider_object_key !~ '(^|[\\/])\.\.?(?:[\\/]|$)'
    and provider_object_key !~ '[\\/]{2}'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_bucket, provider_object_key)
);

create table private.ordax_user_upload_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  object_id uuid not null unique,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  space_id uuid references public.ordax_spaces(space_id) on delete restrict,
  quota_key text not null default 'storage.user.bytes' check (quota_key = 'storage.user.bytes'),
  expected_size_bytes bigint not null check (expected_size_bytes >= 0),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('supabase-storage', 'cloudflare-r2', 'other')),
  provider_bucket text not null check (char_length(provider_bucket) between 1 and 160),
  provider_object_key text not null check (
    char_length(provider_object_key) between 8 and 512
    and provider_object_key !~ '^[\\/]'
    and provider_object_key !~ '(^|[\\/])\.\.?(?:[\\/]|$)'
    and provider_object_key !~ '[\\/]{2}'
  ),
  state text not null default 'reserved' check (state in ('reserved', 'consumed', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  consumed_at timestamptz,
  unique (provider, provider_bucket, provider_object_key),
  check (expires_at > created_at),
  check ((state = 'consumed') = (consumed_at is not null))
);

create index ordax_user_objects_owner_state_idx
  on public.ordax_user_objects(owner_user_id, state, created_at);
create index ordax_user_objects_space_state_idx
  on public.ordax_user_objects(space_id, state, created_at)
  where space_id is not null;
create index ordax_user_upload_reservations_owner_state_idx
  on private.ordax_user_upload_reservations(owner_user_id, state, expires_at);

create trigger touch_ordax_user_objects_updated_at
before update on public.ordax_user_objects
for each row execute function private.ordax_touch_updated_at();

alter table public.ordax_user_objects enable row level security;

revoke all on table public.ordax_user_objects
  from public, anon, authenticated, service_role;
revoke all on table private.ordax_user_object_provider_refs
  from public, anon, authenticated, service_role;
revoke all on table private.ordax_user_upload_reservations
  from public, anon, authenticated, service_role;

grant select on table public.ordax_user_objects to authenticated;

create policy ordax_user_objects_select_authorized
on public.ordax_user_objects for select to authenticated
using (
  (select private.ordax_authenticated_subject_eligible_v1())
  and (
    (space_id is null and owner_user_id = (select auth.uid()))
    or (space_id is not null and private.ordax_can_access_space(space_id))
  )
);

comment on table public.ordax_user_objects is
  'Client-readable canonical metadata for explicitly selected private cloud objects. No provider location or mutation authority is exposed here.';
comment on table private.ordax_user_object_provider_refs is
  'Server-only provider location for user cloud objects. Provider references must survive until verified provider cleanup completes.';
comment on table private.ordax_user_upload_reservations is
  'Server-only bounded upload reservations. No API role receives direct mutation authority.';

-- SOURCE 20261007015500_user_cloud_storage_private_rls_hardening_v1.sql
-- Defense-in-depth hardening for private user cloud-storage state.
--
-- The original v2 foundation revoked every API/client role from these private
-- tables but did not enable RLS on the tables themselves. Keep the existing
-- server-only ownership model and add RLS as an independent boundary. No
-- client or service_role policies are introduced here.


alter table private.ordax_user_object_provider_refs enable row level security;
alter table private.ordax_user_upload_reservations enable row level security;

revoke all on table private.ordax_user_object_provider_refs
  from public, anon, authenticated, service_role;
revoke all on table private.ordax_user_upload_reservations
  from public, anon, authenticated, service_role;

comment on table private.ordax_user_object_provider_refs is
  'Server-only provider location for user cloud objects. RLS enabled with no client/service_role policy; reviewed backend owners remain the only mutation path.';
comment on table private.ordax_user_upload_reservations is
  'Server-only bounded upload reservations. RLS enabled with no client/service_role policy; reviewed backend owners remain the only mutation path.';

-- SOURCE 20261007083746_user_cloud_storage_quota_reservation_link_v1.sql
-- Bind every user-cloud upload reservation to exactly one quota reservation.
--
-- The upload reservation cannot infer quota identity from subject/size/key: it must
-- retain the exact server-authoritative quota reservation that authorized growth.
-- This keeps reserve/finalize/cancel idempotent and prevents duplicate accounting.


alter table private.ordax_user_upload_reservations
  add column quota_reservation_id uuid;

alter table private.ordax_user_upload_reservations
  add constraint ordax_user_upload_reservations_quota_reservation_id_key
  unique (quota_reservation_id);

alter table private.ordax_user_upload_reservations
  add constraint ordax_user_upload_reservations_quota_reservation_id_fkey
  foreign key (quota_reservation_id)
  references private.ordax_service_quota_reservations(reservation_id)
  on delete restrict;

alter table private.ordax_user_upload_reservations
  alter column quota_reservation_id set not null;

comment on column private.ordax_user_upload_reservations.quota_reservation_id is
  'Exact server-authoritative quota reservation backing this upload reservation. Unique and retained until storage reservation cleanup is complete.';

DO $ordax_postflight$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'public.ordax_user_objects',
    'private.ordax_user_object_provider_refs',
    'private.ordax_user_upload_reservations',
    'private.ordax_service_quota_usage',
    'private.ordax_service_quota_reservations'
  ] LOOP
    IF to_regclass(target_table) IS NULL
       OR NOT EXISTS (
          SELECT 1 FROM pg_class
          WHERE oid=to_regclass(target_table) AND relrowsecurity
       )
    THEN RAISE EXCEPTION 'storage-destination-rls-or-table-missing:%',target_table;
    END IF;
    IF has_table_privilege('anon',target_table,'SELECT')
       OR has_table_privilege('authenticated',target_table,'INSERT')
       OR has_table_privilege('authenticated',target_table,'UPDATE')
       OR has_table_privilege('authenticated',target_table,'DELETE')
       OR has_table_privilege('service_role',target_table,'INSERT')
       OR has_table_privilege('service_role',target_table,'UPDATE')
       OR has_table_privilege('service_role',target_table,'DELETE')
    THEN RAISE EXCEPTION 'storage-destination-direct-mutation-privilege:%',target_table;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated','public.ordax_user_objects','SELECT')
  THEN RAISE EXCEPTION 'storage-destination-metadata-read-missing'; END IF;
  IF has_table_privilege('authenticated','private.ordax_user_upload_reservations','SELECT')
     OR has_table_privilege('service_role','private.ordax_user_upload_reservations','SELECT')
     OR has_table_privilege('authenticated','private.ordax_user_object_provider_refs','SELECT')
  THEN RAISE EXCEPTION 'storage-destination-private-provider-data-exposed'; END IF;
  IF NOT EXISTS(
     SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='ordax_user_objects'
       AND policyname='ordax_user_objects_select_authorized'
       AND roles=ARRAY['authenticated']::name[]
       AND qual LIKE '%private.ordax_authenticated_subject_eligible_v1()%'
       AND qual LIKE '%private.ordax_can_access_space(space_id)%'
  ) THEN RAISE EXCEPTION 'storage-destination-session-space-policy-drift'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='private' AND table_name='ordax_user_upload_reservations'
      AND column_name='quota_reservation_id' AND is_nullable='NO'
  ) THEN RAISE EXCEPTION 'storage-destination-quota-reservation-link-missing'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conname='ordax_user_upload_reservations_quota_reservation_id_fkey'
      AND contype='f' AND convalidated
  ) THEN RAISE EXCEPTION 'storage-destination-quota-link-fk-missing'; END IF;
  IF has_function_privilege('authenticated',
      'private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)','EXECUTE')
     OR has_function_privilege('anon',
      'private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)','EXECUTE')
     OR has_function_privilege('service_role',
      'private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)','EXECUTE')
  THEN RAISE EXCEPTION 'storage-destination-private-quota-helper-exposed'; END IF;
END;
$ordax_postflight$;
COMMIT;
