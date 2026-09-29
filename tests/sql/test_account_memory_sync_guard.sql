\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists private;
create role anon;
create role authenticated;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('ordax.test_uid', true), '')::uuid;
$$;

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
  owner_user_id uuid not null,
  idempotency_key text not null,
  data_class text not null,
  stable_object_id text not null,
  base_server_revision bigint,
  resulting_server_revision bigint not null,
  mutation_kind text not null,
  object_schema_version integer not null,
  resolver_version integer not null,
  tombstone boolean not null,
  payload jsonb not null,
  applied_at timestamptz not null default timezone('utc', now()),
  unique (owner_user_id, idempotency_key)
);

\ir ../../infra/supabase/product/migrations/20260929122500_account_memory_sync_guard_v1.sql

select set_config('ordax.test_uid', '11111111-1111-1111-1111-111111111111', false);

create temporary table valid_memory_payload(payload jsonb);
insert into valid_memory_payload values (
  jsonb_build_object(
    'schema', 'ordax.memory-sync-payload/1',
    'memory', jsonb_build_object(
      'schema', 'ordax.memory/1',
      'id', 'memory-1',
      'ownerKind', 'account',
      'ownerId', '11111111-1111-1111-1111-111111111111',
      'scope', 'account',
      'kind', 'fact',
      'sensitivity', 'private',
      'content', 'Preferencia autorizada',
      'provenance', 'user-confirmed:postgres-proof',
      'sourceTimestamp', '2026-09-29T12:30:00.000Z',
      'spaceId', null,
      'projectId', null
    )
  )
);

do $$
declare
  v_result record;
  v_payload jsonb := (select payload from valid_memory_payload);
begin
  select * into v_result from public.ordax_apply_sync_mutation_v1(
    'memory:test:0001', 'memory', 'memory-1', 1, 1, 0, false, v_payload
  );
  if v_result.server_revision <> 1 or v_result.applied is distinct from true or v_result.conflict is distinct from false then
    raise exception 'valid Memory mutation did not apply as revision 1';
  end if;

  select * into v_result from public.ordax_apply_sync_mutation_v1(
    'memory:test:0001', 'memory', 'memory-1', 1, 1, 0, false, v_payload
  );
  if v_result.server_revision <> 1 or v_result.applied is distinct from false or v_result.conflict is distinct from false then
    raise exception 'idempotent replay was not stable';
  end if;
end;
$$;

do $$
declare
  v_payload jsonb := (select payload from valid_memory_payload);
begin
  begin
    perform * from public.ordax_apply_sync_mutation_v1(
      'memory:test:encoded-id', 'memory', 'memory/bWVtb3J5LTE', 1, 1, 1, false, v_payload
    );
    raise exception 'expected transport-invented stable id rejection';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'invalid-memory-stable-object-id' then raise; end if;
  end;

  begin
    perform * from public.ordax_apply_sync_mutation_v1(
      'memory:test:0001', 'memory', 'memory-1', 1, 1, 0, false,
      jsonb_set(v_payload, '{memory,content}', to_jsonb('different content'::text))
    );
    raise exception 'expected idempotency mutation mismatch rejection';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'idempotency-key-reused-for-different-mutation' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_payload jsonb := (select payload from valid_memory_payload);
  v_project_payload jsonb;
begin
  begin
    perform * from public.ordax_apply_sync_mutation_v1(
      'memory:test:secret', 'memory', 'memory-1', 1, 1, 1, false,
      jsonb_set(v_payload, '{memory,content}', to_jsonb(concat('Authorization', ': ', 'Bear', 'er ', 'secret-', 'token-value-123456')))
    );
    raise exception 'expected never-sync secret rejection';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'memory-never-sync-material' then raise; end if;
  end;

  begin
    perform * from public.ordax_apply_sync_mutation_v1(
      'memory:test:owner', 'memory', 'memory-1', 1, 1, 1, false,
      jsonb_set(v_payload, '{memory,ownerId}', to_jsonb('22222222-2222-2222-2222-222222222222'::text))
    );
    raise exception 'expected cross-subject owner rejection';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'invalid-memory-sync-domain' then raise; end if;
  end;

  begin
    perform * from public.ordax_apply_sync_mutation_v1(
      'memory:test:null-owner', 'memory', 'memory-1', 1, 1, 1, false,
      jsonb_set(v_payload, '{memory,ownerId}', 'null'::jsonb)
    );
    raise exception 'expected null owner rejection';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'invalid-memory-sync-payload' then raise; end if;
  end;

  begin
    perform * from public.ordax_apply_sync_mutation_v1(
      'memory:test:restricted', 'memory', 'memory-1', 1, 1, 1, false,
      jsonb_set(v_payload, '{memory,sensitivity}', to_jsonb('restricted'::text))
    );
    raise exception 'expected restricted Memory rejection';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'invalid-memory-sync-domain' then raise; end if;
  end;

  v_project_payload := jsonb_set(
    jsonb_set(v_payload, '{memory,scope}', to_jsonb('project'::text)),
    '{memory,projectId}', to_jsonb('project-1'::text)
  );
  begin
    perform * from public.ordax_apply_sync_mutation_v1(
      'memory:test:project', 'memory', 'memory-1', 1, 1, 1, false, v_project_payload
    );
    raise exception 'expected project Memory rejection';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'invalid-memory-sync-domain' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_result record;
begin
  select * into v_result from public.ordax_apply_sync_mutation_v1(
    'memory:test:delete',
    'memory',
    'memory-1',
    1,
    1,
    1,
    true,
    jsonb_build_object(
      'schema', 'ordax.memory-sync-payload/1',
      'memoryIdentity', jsonb_build_object(
        'id', 'memory-1',
        'ownerKind', 'account',
        'ownerId', '11111111-1111-1111-1111-111111111111'
      )
    )
  );
  if v_result.server_revision <> 2 or v_result.tombstone is distinct from true or v_result.applied is distinct from true then
    raise exception 'valid Memory tombstone did not apply as revision 2';
  end if;

  if exists (
    select 1 from private.ordax_sync_objects
    where data_class = 'memory' and payload::text like '%Preferencia autorizada%'
  ) then
    raise exception 'deleted Memory content survived in authoritative object payload';
  end if;

  if exists (
    select 1 from private.ordax_sync_mutations
    where data_class = 'memory' and payload::text like '%Preferencia autorizada%'
  ) then
    raise exception 'deleted Memory content survived in mutation history';
  end if;

  if exists (
    select 1 from private.ordax_sync_mutations
    where data_class = 'memory'
      and stable_object_id = 'memory-1'
      and (tombstone is distinct from true or mutation_kind <> 'delete' or payload ? 'memory')
  ) then
    raise exception 'forgotten Memory history was not converted to identity-only tombstones';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from private.ordax_sync_mutations
    where data_class = 'memory'
      and (
        payload::text ilike '%secret-token-value-123456%'
        or payload::text ilike '%22222222-2222-2222-2222-222222222222%'
        or payload::text ilike '%restricted%'
        or payload::text ilike '%project-1%'
      )
  ) then
    raise exception 'rejected Memory payload reached mutation storage';
  end if;
end;
$$;

select 'ACCOUNT_MEMORY_SYNC_POSTGRES_GUARD=PASS' as result;
