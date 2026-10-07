\set ON_ERROR_STOP on

-- Disposable PostgreSQL proof for the server-authoritative quota ledger.
-- This intentionally bootstraps only the foundation objects the migration depends on;
-- no production Supabase project is contacted.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create schema private;
create extension if not exists pgcrypto;

create table auth.users (
  id uuid primary key
);

create table public.ordax_spaces (
  space_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('personal','work','professional')),
  state text not null check (state in ('active','archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.ordax_entitlement_grants (
  grant_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  space_id uuid references public.ordax_spaces(space_id) on delete cascade,
  entitlement_key text not null check (entitlement_key ~ '^[a-z][a-z0-9.-]{2,95}$'),
  entitlement_value jsonb not null,
  source text not null default 'admin'
    check (source in ('product-default','admin','promotion','billing','migration')),
  valid_from timestamptz not null default timezone('utc', now()),
  valid_until timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check ((user_id is not null)::integer + (space_id is not null)::integer = 1),
  check (valid_until is null or valid_until > valid_from)
);

create or replace function private.ordax_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function private.ordax_touch_updated_at()
from public, anon, authenticated, service_role;

\ir ../../infra/supabase/product/migrations/20261007050000_service_quota_ledger_v1.sql

-- The migration must expose no direct table authority to any API role, and only
-- the operational read RPC may be executable by service_role.
do $proof$
declare
  v_role text;
begin
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_table_privilege(
      v_role,
      'private.ordax_service_quota_usage',
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception 'quota-usage-table-authority-leak:%', v_role;
    end if;
    if pg_catalog.has_table_privilege(
      v_role,
      'private.ordax_service_quota_reservations',
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception 'quota-reservation-table-authority-leak:%', v_role;
    end if;
    if pg_catalog.has_function_privilege(
      v_role,
      'private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)',
      'EXECUTE'
    ) then
      raise exception 'quota-reserve-helper-authority-leak:%', v_role;
    end if;
    if pg_catalog.has_function_privilege(
      v_role,
      'private.ordax_commit_service_quota_reservation_v1(uuid)',
      'EXECUTE'
    ) then
      raise exception 'quota-commit-helper-authority-leak:%', v_role;
    end if;
    if pg_catalog.has_function_privilege(
      v_role,
      'private.ordax_release_service_quota_reservation_v1(uuid)',
      'EXECUTE'
    ) then
      raise exception 'quota-release-helper-authority-leak:%', v_role;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'service_role',
    'public.ordax_service_quota_usage_status_v1(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'quota-status-service-role-missing';
  end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.ordax_service_quota_usage_status_v1(uuid,uuid,text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.ordax_service_quota_usage_status_v1(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'quota-status-public-authority-leak';
  end if;
end;
$proof$;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.ordax_spaces(
  space_id, owner_user_id, name, kind, state
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '11111111-1111-4111-8111-111111111111',
  'Quota Proof Space',
  'professional',
  'active'
);

insert into public.ordax_entitlement_grants(
  user_id,
  entitlement_key,
  entitlement_value
) values (
  '11111111-1111-4111-8111-111111111111',
  'storage.user.bytes',
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":100}'::jsonb
);

insert into public.ordax_entitlement_grants(
  space_id,
  entitlement_key,
  entitlement_value
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'storage.user.bytes',
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":25}'::jsonb
);

-- Reserve, retry, capacity denial, commit and replay must all be deterministic.
do $proof$
declare
  v_first record;
  v_retry record;
  v_blocked record;
  v_commit record;
  v_commit_retry record;
  v_second record;
  v_over record;
  v_release boolean;
begin
  select * into v_first
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    60,
    'request-0001',
    600
  );

  if not v_first.can_allocate
     or v_first.quota_state <> 'within-quota'
     or v_first.used_units <> 0
     or v_first.reserved_units <> 60
     or v_first.limit_units <> 100
     or v_first.reservation_id is null then
    raise exception 'quota-first-reservation-invalid';
  end if;

  select * into v_retry
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    60,
    'request-0001',
    600
  );

  if v_retry.reservation_id <> v_first.reservation_id
     or not v_retry.can_allocate
     or v_retry.reserved_units <> 60 then
    raise exception 'quota-reservation-idempotency-broken';
  end if;

  select * into v_blocked
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    50,
    'request-0002',
    600
  );

  if v_blocked.can_allocate
     or v_blocked.quota_state <> 'quota-exceeded'
     or v_blocked.reservation_id is not null then
    raise exception 'quota-capacity-overallocation-accepted';
  end if;

  select * into v_commit
  from private.ordax_commit_service_quota_reservation_v1(v_first.reservation_id);
  if not v_commit.committed
     or v_commit.used_units <> 60
     or v_commit.reserved_units <> 0 then
    raise exception 'quota-first-commit-invalid';
  end if;

  select * into v_commit_retry
  from private.ordax_commit_service_quota_reservation_v1(v_first.reservation_id);
  if not v_commit_retry.committed
     or v_commit_retry.used_units <> 60
     or v_commit_retry.reserved_units <> 0 then
    raise exception 'quota-commit-idempotency-broken';
  end if;

  select private.ordax_release_service_quota_reservation_v1(v_first.reservation_id)
    into v_release;
  if v_release then
    raise exception 'quota-committed-reservation-released';
  end if;

  select * into v_second
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    40,
    'request-0003',
    600
  );
  if not v_second.can_allocate or v_second.reserved_units <> 40 then
    raise exception 'quota-second-reservation-invalid';
  end if;

  select * into v_commit
  from private.ordax_commit_service_quota_reservation_v1(v_second.reservation_id);
  if not v_commit.committed or v_commit.used_units <> 100 then
    raise exception 'quota-second-commit-invalid';
  end if;

  select * into v_over
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    1,
    'request-0004',
    600
  );
  if v_over.can_allocate or v_over.quota_state <> 'quota-exceeded' then
    raise exception 'quota-hard-limit-growth-accepted';
  end if;
end;
$proof$;

-- A downgrade retains historical usage and blocks only new growth.
update public.ordax_entitlement_grants
set entitlement_value =
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":80}'::jsonb
where user_id = '11111111-1111-4111-8111-111111111111'
  and entitlement_key = 'storage.user.bytes';

do $proof$
declare
  v_over record;
begin
  select * into v_over
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    1,
    'request-0005',
    600
  );
  if v_over.can_allocate
     or v_over.quota_state <> 'over-quota-retained'
     or v_over.used_units <> 100
     or v_over.limit_units <> 80 then
    raise exception 'quota-downgrade-semantics-invalid';
  end if;
end;
$proof$;

-- Expired reservations cannot be committed into usage.
update public.ordax_entitlement_grants
set entitlement_value =
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":200}'::jsonb
where user_id = '11111111-1111-4111-8111-111111111111'
  and entitlement_key = 'storage.user.bytes';

do $proof$
declare
  v_expiring record;
  v_commit record;
begin
  select * into v_expiring
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    10,
    'request-0006',
    600
  );
  if not v_expiring.can_allocate or v_expiring.reservation_id is null then
    raise exception 'quota-expiry-fixture-reservation-failed';
  end if;

  update private.ordax_service_quota_reservations
  set
    created_at = statement_timestamp() - interval '2 minutes',
    expires_at = statement_timestamp() - interval '1 minute'
  where reservation_id = v_expiring.reservation_id;

  select * into v_commit
  from private.ordax_commit_service_quota_reservation_v1(v_expiring.reservation_id);
  if v_commit.committed or v_commit.used_units <> 100 then
    raise exception 'quota-expired-reservation-consumed-usage';
  end if;
end;
$proof$;

-- Multiple active grants for one subject/key must fail closed.
insert into public.ordax_entitlement_grants(
  user_id,
  entitlement_key,
  entitlement_value
) values (
  '11111111-1111-4111-8111-111111111111',
  'storage.user.bytes',
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":200}'::jsonb
);

do $proof$
begin
  begin
    perform * from private.ordax_reserve_service_quota_v1(
      '11111111-1111-4111-8111-111111111111',
      null,
      'storage.user.bytes',
      'bytes',
      1,
      'request-0007',
      600
    );
    raise exception 'quota-ambiguous-policy-accepted';
  exception
    when sqlstate '55000' then null;
  end;
end;
$proof$;

delete from public.ordax_entitlement_grants
where user_id = '11111111-1111-4111-8111-111111111111'
  and entitlement_key = 'storage.user.bytes'
  and grant_id <> (
    select min(grant_id)
    from public.ordax_entitlement_grants
    where user_id = '11111111-1111-4111-8111-111111111111'
      and entitlement_key = 'storage.user.bytes'
  );

-- Extra policy fields are rejected so the grant JSON remains a strict contract.
update public.ordax_entitlement_grants
set entitlement_value =
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":200,"extra":true}'::jsonb
where user_id = '11111111-1111-4111-8111-111111111111'
  and entitlement_key = 'storage.user.bytes';

do $proof$
begin
  begin
    perform * from private.ordax_reserve_service_quota_v1(
      '11111111-1111-4111-8111-111111111111',
      null,
      'storage.user.bytes',
      'bytes',
      1,
      'request-0008',
      600
    );
    raise exception 'quota-invalid-policy-shape-accepted';
  exception
    when sqlstate '22023' then null;
  end;
end;
$proof$;

-- Null limit is the canonical explicit unmetered representation; release remains
-- idempotent and never changes usage.
update public.ordax_entitlement_grants
set entitlement_value =
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":null}'::jsonb
where user_id = '11111111-1111-4111-8111-111111111111'
  and entitlement_key = 'storage.user.bytes';

do $proof$
declare
  v_unmetered record;
  v_release boolean;
begin
  select * into v_unmetered
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    5,
    'request-0009',
    600
  );
  if not v_unmetered.can_allocate
     or v_unmetered.quota_state <> 'unmetered'
     or v_unmetered.limit_units is not null then
    raise exception 'quota-unmetered-policy-invalid';
  end if;

  select private.ordax_release_service_quota_reservation_v1(v_unmetered.reservation_id)
    into v_release;
  if not v_release then
    raise exception 'quota-release-failed';
  end if;
  select private.ordax_release_service_quota_reservation_v1(v_unmetered.reservation_id)
    into v_release;
  if not v_release then
    raise exception 'quota-release-idempotency-broken';
  end if;
end;
$proof$;

-- Account and Space meters are isolated even when they use the same quota key.
do $proof$
declare
  v_space record;
  v_release boolean;
begin
  select * into v_space
  from private.ordax_reserve_service_quota_v1(
    null,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'storage.user.bytes',
    'bytes',
    25,
    'space-request-0001',
    600
  );
  if not v_space.can_allocate
     or v_space.used_units <> 0
     or v_space.reserved_units <> 25
     or v_space.limit_units <> 25 then
    raise exception 'quota-space-scope-isolation-broken';
  end if;

  select private.ordax_release_service_quota_reservation_v1(v_space.reservation_id)
    into v_release;
  if not v_release then
    raise exception 'quota-space-reservation-release-failed';
  end if;
end;
$proof$;

-- service_role may read operational status through the one public RPC, but cannot
-- mutate either private ledger table directly.
set role service_role;

do $proof$
declare
  v_status record;
begin
  select * into v_status
  from public.ordax_service_quota_usage_status_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes'
  );
  if v_status.used_units <> 100
     or v_status.reserved_units <> 0
     or v_status.active_reservations <> 0 then
    raise exception 'quota-operational-status-invalid';
  end if;

  begin
    execute $sql$
      insert into private.ordax_service_quota_usage(
        user_id, quota_key, unit, used_units
      ) values (
        '22222222-2222-4222-8222-222222222222',
        'storage.user.bytes',
        'bytes',
        1
      )
    $sql$;
    raise exception 'quota-service-role-direct-dml-accepted';
  exception
    when insufficient_privilege then null;
  end;
end;
$proof$;

reset role;
