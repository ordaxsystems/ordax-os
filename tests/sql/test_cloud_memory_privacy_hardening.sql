\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists private;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('ordax.test_uid', true), '')::uuid; $$;

create or replace function private.ordax_can_access_space(p_space_id uuid)
returns boolean
language sql
stable
as $$ select p_space_id is not null; $$;

create table public.ordax_entitlement_grants (
  user_id uuid,
  space_id uuid,
  entitlement_key text not null,
  entitlement_value jsonb not null,
  valid_from timestamptz not null,
  valid_until timestamptz
);

create table public.ordax_memory_items (
  memory_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  space_id uuid,
  project_ref text,
  scope text not null,
  kind text not null,
  sensitivity text not null,
  content text not null,
  provenance text not null,
  source_timestamp timestamptz not null,
  confidence numeric,
  state text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table private.ordax_sync_objects (
  sync_object_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  data_class text not null,
  stable_object_id text not null,
  object_schema_version integer not null,
  resolver_version integer not null,
  server_revision bigint not null,
  tombstone boolean not null,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ordax_sync_objects_data_class_check check (
    data_class = any (array[
      'appearance'::text,
      'preferences'::text,
      'workspace-metadata'::text,
      'app-state-metadata'::text,
      'user-selected-cloud-content'::text
    ])
  ),
  unique (owner_user_id, data_class, stable_object_id)
);

create table private.ordax_sync_mutations (
  owner_user_id uuid not null,
  idempotency_key text not null,
  data_class text not null,
  stable_object_id text not null,
  base_server_revision bigint,
  resulting_server_revision bigint not null,
  mutation_kind text not null,
  applied_at timestamptz not null default timezone('utc', now()),
  constraint ordax_sync_mutations_data_class_check check (
    data_class = any (array[
      'appearance'::text,
      'preferences'::text,
      'workspace-metadata'::text,
      'app-state-metadata'::text,
      'user-selected-cloud-content'::text
    ])
  ),
  unique (owner_user_id, idempotency_key)
);

\ir ../../infra/supabase/product/migrations/20260925013355_account_sync_incremental_cursor_v1.sql
\ir ../../infra/supabase/product/migrations/20260929184500_cloud_memory_atomic_mutation_v1.sql
\ir ../../infra/supabase/product/migrations/20260929190000_cloud_memory_atomic_mutation_privilege_boundary_v1.sql
\ir ../../infra/supabase/product/migrations/20260929192000_cloud_memory_atomic_mutation_qualification_v1.sql
\ir ../../infra/supabase/product/migrations/20260929193000_cloud_memory_privacy_hardening_v1.sql
\ir ../../infra/supabase/product/migrations/20260929212500_cloud_memory_sync_payload_contract_v1.sql

select set_config('ordax.test_uid', '11111111-1111-1111-1111-111111111111', false);
insert into public.ordax_entitlement_grants values (
  '11111111-1111-1111-1111-111111111111',
  null,
  'memory.cloud.enabled',
  '{"decision":"allowed"}'::jsonb,
  '2020-01-01T00:00:00Z',
  null
);

-- Memory stays out of the generic mutation RPC.
do $$
begin
  begin
    perform * from public.ordax_apply_sync_mutation_v1(
      'generic:memory:blocked', 'memory', 'memory-id', 1, 1, 0, false, '{}'::jsonb
    );
    raise exception 'expected generic Memory mutation rejection';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invalid-data-class' then raise; end if;
  end;
end;
$$;

create temporary table cloud_memory_proof(memory_id uuid primary key);
with applied as (
  select * from public.ordax_apply_memory_mutation_v1(
    'memory:privacy:create:0001', null, 'account', null, 'fact', 'private',
    'Preferencia autorizada para teste', 'user-confirmed:postgres-privacy-proof',
    '2026-09-29T18:00:00Z', null, 0, false, 1
  )
)
insert into cloud_memory_proof(memory_id)
select memory_id from applied
where applied is true and conflict is false and server_revision = 1;

do $$
declare
  v_memory_id uuid := (select proof.memory_id from cloud_memory_proof as proof);
  v_payload jsonb;
begin
  if v_memory_id is null then
    raise exception 'canonical Memory create did not return exactly one stable identity';
  end if;

  select sync_row.payload into v_payload
  from private.ordax_sync_objects as sync_row
  where sync_row.owner_user_id = '11111111-1111-1111-1111-111111111111'
    and sync_row.data_class = 'memory'
    and sync_row.stable_object_id = v_memory_id::text;

  if v_payload->>'schema' is distinct from 'ordax.memory-sync-payload/1'
     or v_payload->'memory'->>'schema' is distinct from 'ordax.memory/1'
     or v_payload->'memory'->>'id' is distinct from v_memory_id::text
     or v_payload->'memory'->>'ownerKind' is distinct from 'account'
     or v_payload->'memory'->>'ownerId' is distinct from '11111111-1111-1111-1111-111111111111'
     or v_payload->'memory'->>'scope' is distinct from 'account'
     or v_payload->'memory'->>'kind' is distinct from 'fact'
     or v_payload->'memory'->>'sensitivity' is distinct from 'private'
     or v_payload->'memory'->>'content' is distinct from 'Preferencia autorizada para teste'
     or v_payload->'memory'->>'provenance' is distinct from 'user-confirmed:postgres-privacy-proof'
     or v_payload->'memory'->'spaceId' <> 'null'::jsonb
     or v_payload->'memory'->'projectId' <> 'null'::jsonb then
    raise exception 'cloud Memory transport mirror does not match ordax.memory-sync-payload/1';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_payload) as key
    where key not in ('schema', 'memory')
  ) then
    raise exception 'cloud Memory transport mirror has non-canonical envelope fields';
  end if;
end;
$$;

-- Never-sync patterns fail atomically and leave neither domain state nor sync
-- transport history behind.
do $$
declare
  v_secret text;
  v_index integer := 0;
begin
  foreach v_secret in array array[
    'Authorization: Bearer secret-token-value-123456',
    'password=not-a-cloud-memory-secret',
    'access_token=abcdef0123456789abcdef',
    '-----BEGIN PRIVATE KEY----- private-material'
  ] loop
    v_index := v_index + 1;
    begin
      perform * from public.ordax_apply_memory_mutation_v1(
        'memory:privacy:secret:' || v_index::text,
        null, 'account', null, 'fact', 'private', v_secret,
        'user-confirmed:postgres-privacy-proof', '2026-09-29T18:01:00Z',
        null, 0, false, 1
      );
      raise exception 'expected never-sync Memory rejection';
    exception when sqlstate '22023' then
      if sqlerrm <> 'memory-never-sync-material' then raise; end if;
    end;
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.ordax_memory_items
    where content ilike '%secret-token-value-123456%'
       or content ilike '%not-a-cloud-memory-secret%'
       or content ilike '%abcdef0123456789abcdef%'
       or content ilike '%private-material%'
  ) then raise exception 'rejected never-sync material reached Memory source of truth'; end if;

  if exists (
    select 1 from private.ordax_sync_mutations
    where payload::text ilike '%secret-token-value-123456%'
       or payload::text ilike '%not-a-cloud-memory-secret%'
       or payload::text ilike '%abcdef0123456789abcdef%'
       or payload::text ilike '%private-material%'
  ) then raise exception 'rejected never-sync material reached mutation history'; end if;
end;
$$;

-- Delete exercises the qualified update path and proves historical cursor rows
-- are preserved but converted into canonical identity-only tombstones.
do $$
declare
  v_memory_id uuid := (select proof.memory_id from cloud_memory_proof as proof);
  v_result record;
  v_before_count bigint;
begin
  select count(*) into v_before_count
  from private.ordax_sync_mutations as mutation_row
  where mutation_row.data_class = 'memory'
    and mutation_row.stable_object_id = v_memory_id::text;

  select * into v_result from public.ordax_apply_memory_mutation_v1(
    'memory:privacy:delete:0001', v_memory_id,
    null, null, null, null, null, null, null, null,
    1, true, 1
  );

  if v_result.server_revision <> 2
     or v_result.tombstone is distinct from true
     or v_result.applied is distinct from true
     or v_result.conflict is distinct from false then
    raise exception 'canonical Memory tombstone did not apply as revision 2';
  end if;

  if (select item.state from public.ordax_memory_items as item where item.memory_id = v_memory_id) <> 'deleted' then
    raise exception 'Memory source of truth was not marked deleted';
  end if;

  if exists (
    select 1 from private.ordax_sync_objects as sync_row
    where sync_row.data_class = 'memory'
      and sync_row.stable_object_id = v_memory_id::text
      and (
        sync_row.tombstone is distinct from true
        or sync_row.payload::text like '%Preferencia autorizada%'
        or sync_row.payload->>'schema' is distinct from 'ordax.memory-sync-payload/1'
        or sync_row.payload->'memoryIdentity'->>'id' is distinct from v_memory_id::text
        or sync_row.payload->'memoryIdentity'->>'ownerKind' is distinct from 'account'
        or sync_row.payload->'memoryIdentity'->>'ownerId' is distinct from '11111111-1111-1111-1111-111111111111'
        or sync_row.payload ? 'memory'
      )
  ) then raise exception 'forgotten Memory survived in authoritative transport mirror'; end if;

  if exists (
    select 1 from private.ordax_sync_mutations as mutation_row
    where mutation_row.data_class = 'memory'
      and mutation_row.stable_object_id = v_memory_id::text
      and (
        mutation_row.tombstone is distinct from true
        or mutation_row.mutation_kind <> 'delete'
        or mutation_row.payload::text like '%Preferencia autorizada%'
        or mutation_row.payload->>'schema' is distinct from 'ordax.memory-sync-payload/1'
        or mutation_row.payload->'memoryIdentity'->>'id' is distinct from v_memory_id::text
        or mutation_row.payload->'memoryIdentity'->>'ownerKind' is distinct from 'account'
        or mutation_row.payload->'memoryIdentity'->>'ownerId' is distinct from '11111111-1111-1111-1111-111111111111'
        or mutation_row.payload ? 'memory'
      )
  ) then raise exception 'forgotten Memory survived in incremental mutation history'; end if;

  if (select count(*) from private.ordax_sync_mutations as mutation_row
      where mutation_row.data_class = 'memory'
        and mutation_row.stable_object_id = v_memory_id::text) <> v_before_count + 1 then
    raise exception 'forget scrub must preserve history rows and append the tombstone mutation';
  end if;
end;
$$;

-- The actual incremental read path must expose only canonical content-free
-- tombstones for an old cursor after forget.
do $$
declare
  v_change record;
begin
  for v_change in select * from public.ordax_pull_sync_changes_v1(0, 200) loop
    if v_change.data_class = 'memory' then
      if v_change.tombstone is distinct from true
         or v_change.payload::text like '%Preferencia autorizada%'
         or v_change.payload->>'schema' is distinct from 'ordax.memory-sync-payload/1'
         or v_change.payload->'memoryIdentity'->>'ownerKind' is distinct from 'account'
         or v_change.payload->'memoryIdentity'->>'ownerId' is distinct from '11111111-1111-1111-1111-111111111111'
         or v_change.payload ? 'memory' then
        raise exception 'incremental cursor replay exposed non-canonical forgotten Memory';
      end if;
    end if;
  end loop;
end;
$$;

select 'CLOUD_MEMORY_PRIVACY_HARDENING=PASS' as result;
