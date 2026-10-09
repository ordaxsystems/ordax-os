\set ON_ERROR_STOP on

-- Disposable PostgreSQL proof for User Cloud Storage reservation integrity.
-- Only the minimum upstream contracts needed by the real migrations are bootstrapped.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create schema private;
create schema ordax_policy;
create extension if not exists pgcrypto;

create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$ select null::uuid $$;

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

create or replace function ordax_policy.can_access_space(p_space_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$ select false $$;

revoke all on function private.ordax_touch_updated_at()
from public, anon, authenticated, service_role;

\ir ../../infra/supabase/product/migrations/20261007050000_service_quota_ledger_v1.sql
\ir ../../infra/supabase/product/migrations/20261005171000_user_cloud_storage_foundation_v2.sql
\ir ../../infra/supabase/product/migrations/20261007015500_user_cloud_storage_private_rls_hardening_v1.sql
\ir ../../infra/supabase/product/migrations/20261007083746_user_cloud_storage_quota_reservation_link_v1.sql

-- The new column is an internal accounting link, not new API authority.
do $proof$
declare
  v_role text;
  v_nullable text;
begin
  select c.is_nullable into v_nullable
  from information_schema.columns c
  where c.table_schema = 'private'
    and c.table_name = 'ordax_user_upload_reservations'
    and c.column_name = 'quota_reservation_id';

  if v_nullable <> 'NO' then
    raise exception 'storage-quota-link-not-null-missing';
  end if;

  foreach v_role in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_table_privilege(
      v_role,
      'private.ordax_user_upload_reservations',
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception 'storage-reservation-authority-leak:%', v_role;
    end if;
  end loop;
end;
$proof$;

insert into auth.users(id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.ordax_entitlement_grants(
  user_id,
  entitlement_key,
  entitlement_value
) values (
  '11111111-1111-4111-8111-111111111111',
  'storage.user.bytes',
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":100}'::jsonb
);

-- A storage reservation must persist the exact quota reservation returned by the
-- quota owner. The storage table never infers it from size, subject or quota key.
do $proof$
declare
  v_quota record;
  v_storage_reservation_id uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  v_object_id uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
begin
  select * into v_quota
  from private.ordax_reserve_service_quota_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    42,
    v_object_id::text,
    600
  );

  if not v_quota.can_allocate or v_quota.reservation_id is null then
    raise exception 'storage-quota-fixture-reservation-failed';
  end if;

  insert into private.ordax_user_upload_reservations(
    reservation_id,
    object_id,
    owner_user_id,
    space_id,
    quota_key,
    quota_reservation_id,
    expected_size_bytes,
    expected_sha256,
    provider,
    provider_bucket,
    provider_object_key,
    expires_at
  ) values (
    v_storage_reservation_id,
    v_object_id,
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    v_quota.reservation_id,
    42,
    repeat('a', 64),
    'supabase-storage',
    'ordax-user-data',
    'acct/opaque-object-0001',
    statement_timestamp() + interval '10 minutes'
  );

  if not exists (
    select 1
    from private.ordax_user_upload_reservations r
    where r.reservation_id = v_storage_reservation_id
      and r.quota_reservation_id = v_quota.reservation_id
  ) then
    raise exception 'storage-exact-quota-link-not-persisted';
  end if;

  -- One quota reservation may back only one storage reservation.
  begin
    insert into private.ordax_user_upload_reservations(
      reservation_id,
      object_id,
      owner_user_id,
      quota_key,
      quota_reservation_id,
      expected_size_bytes,
      expected_sha256,
      provider,
      provider_bucket,
      provider_object_key,
      expires_at
    ) values (
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      '11111111-1111-4111-8111-111111111111',
      'storage.user.bytes',
      v_quota.reservation_id,
      42,
      repeat('b', 64),
      'supabase-storage',
      'ordax-user-data',
      'acct/opaque-object-0002',
      statement_timestamp() + interval '10 minutes'
    );
    raise exception 'storage-quota-reservation-reuse-accepted';
  exception
    when unique_violation then null;
  end;

  -- A fabricated quota reservation cannot be stored.
  begin
    insert into private.ordax_user_upload_reservations(
      reservation_id,
      object_id,
      owner_user_id,
      quota_key,
      quota_reservation_id,
      expected_size_bytes,
      expected_sha256,
      provider,
      provider_bucket,
      provider_object_key,
      expires_at
    ) values (
      'ffffffff-ffff-4fff-8fff-fffffffffff1',
      '99999999-9999-4999-8999-999999999991',
      '11111111-1111-4111-8111-111111111111',
      'storage.user.bytes',
      '88888888-8888-4888-8888-888888888881',
      42,
      repeat('c', 64),
      'supabase-storage',
      'ordax-user-data',
      'acct/opaque-object-0003',
      statement_timestamp() + interval '10 minutes'
    );
    raise exception 'storage-fabricated-quota-reservation-accepted';
  exception
    when foreign_key_violation then null;
  end;

  -- Accounting evidence cannot disappear while a storage reservation references it.
  begin
    delete from private.ordax_service_quota_reservations q
    where q.reservation_id = v_quota.reservation_id;
    raise exception 'storage-linked-quota-reservation-deleted';
  exception
    when foreign_key_violation then null;
  end;
end;
$proof$;
