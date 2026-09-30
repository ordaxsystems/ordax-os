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
  unique (owner_user_id, data_class, stable_object_id)
);

create table private.ordax_sync_mutations (
  mutation_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  idempotency_key text not null,
  data_class text not null,
  stable_object_id text not null,
  base_server_revision bigint,
  resulting_server_revision bigint not null,
  mutation_kind text not null,
  applied_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, idempotency_key)
);

\ir ../../infra/supabase/product/migrations/20260925013355_account_sync_incremental_cursor_v1.sql
\ir ../../infra/supabase/product/migrations/20260930140051_account_sync_paginated_snapshot_v2.sql

select set_config('ordax.test_uid', '11111111-1111-1111-1111-111111111111', false);

with generated as (
  select
    g,
    format('memory-%s', to_char(g, 'FM0000')) as stable_object_id,
    jsonb_build_object('version', 1, 'ordinal', g) as payload
  from generate_series(1, 205) as g
)
insert into private.ordax_sync_objects(
  owner_user_id,
  data_class,
  stable_object_id,
  object_schema_version,
  resolver_version,
  server_revision,
  tombstone,
  payload
)
select
  '11111111-1111-1111-1111-111111111111'::uuid,
  'memory',
  stable_object_id,
  1,
  1,
  1,
  false,
  payload
from generated
order by stable_object_id;

with generated as (
  select
    g,
    format('memory-%s', to_char(g, 'FM0000')) as stable_object_id,
    jsonb_build_object('version', 1, 'ordinal', g) as payload
  from generate_series(1, 205) as g
)
insert into private.ordax_sync_mutations(
  owner_user_id,
  idempotency_key,
  data_class,
  stable_object_id,
  base_server_revision,
  resulting_server_revision,
  mutation_kind,
  object_schema_version,
  resolver_version,
  tombstone,
  payload
)
select
  '11111111-1111-1111-1111-111111111111'::uuid,
  format('snapshot-proof-%s', to_char(g, 'FM0000')),
  'memory',
  stable_object_id,
  0,
  1,
  'upsert',
  1,
  1,
  false,
  payload
from generated
order by stable_object_id;

create temporary table snapshot_page_one(value jsonb not null);
insert into snapshot_page_one(value)
select public.ordax_sync_snapshot_page_v2(null, null, null, 200);

do $$
declare
  v_page jsonb := (select value from snapshot_page_one);
begin
  if (v_page->>'cursor')::bigint <> 205 then
    raise exception 'first snapshot page did not freeze the account cursor';
  end if;
  if jsonb_array_length(v_page->'objects') <> 200 then
    raise exception 'first snapshot page was not bounded to the requested page size';
  end if;
  if (v_page->>'has_more')::boolean is not true then
    raise exception 'first snapshot page did not advertise continuation';
  end if;
  if v_page->>'next_data_class' <> 'memory'
     or v_page->>'next_stable_object_id' <> 'memory-0200' then
    raise exception 'first snapshot page continuation token is not canonical';
  end if;
end;
$$;

-- With no concurrent change, the second page proves that objects beyond the old
-- 200-object ceiling are reachable under the exact same cutoff cursor.
do $$
declare
  v_first jsonb := (select value from snapshot_page_one);
  v_second jsonb;
begin
  v_second := public.ordax_sync_snapshot_page_v2(
    (v_first->>'cursor')::bigint,
    v_first->>'next_data_class',
    v_first->>'next_stable_object_id',
    200
  );
  if (v_second->>'cursor')::bigint <> (v_first->>'cursor')::bigint then
    raise exception 'snapshot cursor drifted across pages';
  end if;
  if jsonb_array_length(v_second->'objects') <> 5
     or (v_second->>'has_more')::boolean is not false then
    raise exception 'second snapshot page did not complete the 205-object restore';
  end if;
  if v_second->'objects'->0->>'stable_object_id' <> 'memory-0201'
     or v_second->'objects'->4->>'stable_object_id' <> 'memory-0205' then
    raise exception 'second snapshot page lost keyset ordering';
  end if;
end;
$$;

-- Simulate a write after page one. The changed object must disappear from the
-- old cutoff snapshot and reappear in incremental history after that cutoff.
update private.ordax_sync_objects
set server_revision = 2,
    payload = '{"version":2,"ordinal":205}'::jsonb,
    updated_at = timezone('utc', now())
where owner_user_id = '11111111-1111-1111-1111-111111111111'
  and data_class = 'memory'
  and stable_object_id = 'memory-0205';

insert into private.ordax_sync_mutations(
  owner_user_id,
  idempotency_key,
  data_class,
  stable_object_id,
  base_server_revision,
  resulting_server_revision,
  mutation_kind,
  object_schema_version,
  resolver_version,
  tombstone,
  payload
) values (
  '11111111-1111-1111-1111-111111111111',
  'snapshot-proof-race-0205',
  'memory',
  'memory-0205',
  1,
  2,
  'upsert',
  1,
  1,
  false,
  '{"version":2,"ordinal":205}'::jsonb
);

do $$
declare
  v_first jsonb := (select value from snapshot_page_one);
  v_second jsonb;
  v_incremental record;
begin
  v_second := public.ordax_sync_snapshot_page_v2(
    (v_first->>'cursor')::bigint,
    v_first->>'next_data_class',
    v_first->>'next_stable_object_id',
    200
  );
  if (v_second->>'cursor')::bigint <> 205
     or jsonb_array_length(v_second->'objects') <> 4
     or (v_second->>'has_more')::boolean is not false then
    raise exception 'post-cutoff mutation contaminated or truncated the fixed snapshot';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_second->'objects') item
    where item->>'stable_object_id' = 'memory-0205'
  ) then
    raise exception 'post-cutoff object leaked into fixed snapshot';
  end if;

  select * into v_incremental
  from public.ordax_pull_sync_changes_v1(205, 200)
  where stable_object_id = 'memory-0205';

  if v_incremental.change_cursor <> 206
     or v_incremental.server_revision <> 2
     or v_incremental.payload <> '{"version":2,"ordinal":205}'::jsonb then
    raise exception 'post-cutoff mutation was not recoverable through incremental sync';
  end if;
end;
$$;

-- The page token is an all-or-nothing keyset pair. Malformed continuation must
-- fail closed rather than restarting or silently skipping rows.
do $$
begin
  begin
    perform public.ordax_sync_snapshot_page_v2(205, 'memory', null, 200);
    raise exception 'expected malformed snapshot token rejection';
  exception when sqlstate '22023' then
    if sqlerrm <> 'invalid-snapshot-page-token' then raise; end if;
  end;
end;
$$;

select 'ACCOUNT_SYNC_PAGINATED_SNAPSHOT_V2=PASS' as proof;
