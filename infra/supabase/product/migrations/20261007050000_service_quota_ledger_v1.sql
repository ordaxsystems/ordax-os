-- Server-authoritative quota metering and reservation ledger v1.
--
-- This layer deliberately does not assign commercial numeric limits. Limits are
-- resolved only from active server-owned entitlement grants. The private helper
-- functions are not executable by API roles; domain executors must call them from
-- an audited SECURITY DEFINER mutation so quota reservation and resource mutation
-- share one database transaction.

begin;

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

commit;
