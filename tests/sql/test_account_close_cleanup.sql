\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists private;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

grant usage on schema auth, public, private to authenticated, service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table auth.users (
  id uuid primary key
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

create table public.ordax_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.ordax_spaces (
  space_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade
);

create table public.ordax_space_members (
  space_id uuid not null references public.ordax_spaces(space_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (space_id, user_id)
);

create table public.ordax_entitlement_grants (
  grant_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  space_id uuid references public.ordax_spaces(space_id) on delete cascade
);

create table public.ordax_space_profile_packs (
  space_id uuid primary key references public.ordax_spaces(space_id) on delete cascade
);

create table public.ordax_memory_items (
  memory_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade
);

create table public.ordax_memory_embeddings (
  memory_id uuid primary key references public.ordax_memory_items(memory_id) on delete cascade
);

create table public.ordax_project_connections (
  connection_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.ordax_spaces(space_id) on delete cascade
);

create table public.ordax_user_objects (
  object_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_bucket text not null,
  provider_object_key text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table private.ordax_user_upload_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_bucket text not null,
  provider_object_key text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create table private.ordax_sync_objects (
  sync_object_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default timezone('utc', now())
);

create table private.ordax_sync_mutations (
  mutation_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.ordax_accounts enable row level security;
alter table public.ordax_spaces enable row level security;
alter table public.ordax_space_members enable row level security;
alter table public.ordax_entitlement_grants enable row level security;
alter table public.ordax_space_profile_packs enable row level security;
alter table public.ordax_memory_items enable row level security;
alter table public.ordax_memory_embeddings enable row level security;
alter table public.ordax_project_connections enable row level security;
alter table public.ordax_user_objects enable row level security;
alter table private.ordax_sync_objects enable row level security;
alter table private.ordax_sync_mutations enable row level security;

grant select, insert, update, delete on public.ordax_user_objects to authenticated;
create policy fixture_user_objects_owner
on public.ordax_user_objects for all to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

\ir ../../infra/supabase/product/migrations/20261003123000_account_close_cleanup_journal_v1.sql
\ir ../../infra/supabase/product/migrations/20261003124500_account_close_auth_fence_and_worker_v1.sql
\ir ../../infra/supabase/product/migrations/20261003130000_account_close_shared_space_and_stale_jwt_guard_v1.sql

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.ordax_accounts(user_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.ordax_spaces(space_id, owner_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');
insert into public.ordax_space_members(space_id, user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222');

do $$
begin
  begin
    perform * from public.ordax_begin_account_close_v1('11111111-1111-4111-8111-111111111111');
    raise exception 'shared-space close unexpectedly allowed';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'account-close-owned-shared-space-requires-transfer' then raise; end if;
  end;
end
$$;

delete from public.ordax_space_members
where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '22222222-2222-4222-8222-222222222222';

insert into public.ordax_user_objects(
  owner_user_id, provider, provider_bucket, provider_object_key
) values (
  '11111111-1111-4111-8111-111111111111',
  'supabase-storage', 'ordax-user-data', 'acct-a/object-active-0001'
);

insert into private.ordax_user_upload_reservations(
  owner_user_id, provider, provider_bucket, provider_object_key, expires_at
) values (
  '11111111-1111-4111-8111-111111111111',
  'supabase-storage', 'ordax-user-data', 'acct-a/object-reserved-0002',
  statement_timestamp() + interval '1 hour'
);

create temp table close_result as
select * from public.ordax_begin_account_close_v1('11111111-1111-4111-8111-111111111111');

do $$
declare
  v_count integer;
begin
  select queued_cleanup_count into v_count from close_result;
  if v_count <> 2 then raise exception 'expected two durable cleanup jobs, got %', v_count; end if;
end
$$;

-- A stale access JWT may still be cryptographically valid after global sign-out.
-- The restrictive policy must nevertheless remove data-plane visibility at once.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.ordax_user_objects;
  if v_count <> 0 then raise exception 'closing subject retained stale-JWT visibility'; end if;
end
$$;
reset role;

-- Even privileged/internal paths cannot accidentally grow a closing subject's cloud state.
do $$
begin
  begin
    insert into public.ordax_user_objects(
      owner_user_id, provider, provider_bucket, provider_object_key
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'supabase-storage', 'ordax-user-data', 'acct-a/late-write-0003'
    );
    raise exception 'closing subject write unexpectedly allowed';
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'account-close-cloud-writes-frozen' then raise; end if;
  end;
end
$$;

create temp table claim_one as
select * from public.ordax_claim_account_close_cleanup_v1(
  (select close_id from close_result), 50, 120
);

do $$
declare v_count integer;
begin
  select count(*) into v_count from claim_one;
  if v_count <> 1 then raise exception 'unexpired upload reservation was claimed early'; end if;
end
$$;

select public.ordax_finish_account_close_cleanup_v1(
  cleanup_id, lease_token, true, null
) from claim_one;

do $$
declare
  v_ready boolean;
  v_remaining integer;
begin
  select ready_for_identity_delete, remaining_cleanup_count
    into v_ready, v_remaining
  from public.ordax_verify_account_close_cleanup_v1(
    (select close_id from close_result),
    '11111111-1111-4111-8111-111111111111'
  );
  if v_ready or v_remaining <> 1 then
    raise exception 'cleanup verified before reservation grace elapsed';
  end if;
end
$$;

-- Advance only the queue clock in this disposable proof; production waits naturally.
update private.ordax_account_close_cleanup_jobs
set not_before = statement_timestamp() - interval '1 second'
where close_id = (select close_id from close_result)
  and state <> 'deleted';

create temp table claim_two as
select * from public.ordax_claim_account_close_cleanup_v1(
  (select close_id from close_result), 50, 120
);
select public.ordax_finish_account_close_cleanup_v1(
  cleanup_id, lease_token, true, null
) from claim_two;

-- Blob cleanup alone is insufficient; no identity deletion authority before Auth fence.
do $$
declare
  v_ready boolean;
  v_remaining integer;
begin
  select ready_for_identity_delete, remaining_cleanup_count
    into v_ready, v_remaining
  from public.ordax_verify_account_close_cleanup_v1(
    (select close_id from close_result),
    '11111111-1111-4111-8111-111111111111'
  );
  if v_ready or v_remaining <> 0 then
    raise exception 'identity delete became ready without durable auth fence';
  end if;
end
$$;

select public.ordax_record_account_close_auth_fence_v1(
  (select close_id from close_result),
  '11111111-1111-4111-8111-111111111111',
  true,
  true
);

do $$
declare v_ready boolean;
begin
  select ready_for_identity_delete into v_ready
  from public.ordax_verify_account_close_cleanup_v1(
    (select close_id from close_result),
    '11111111-1111-4111-8111-111111111111'
  );
  if not v_ready then raise exception 'verified cleanup plus auth fence did not authorize identity deletion'; end if;
end
$$;

delete from auth.users where id = '11111111-1111-4111-8111-111111111111';

do $$
declare v_marked boolean;
begin
  select public.ordax_mark_account_closed_v1(
    (select close_id from close_result),
    '11111111-1111-4111-8111-111111111111'
  ) into v_marked;
  if not v_marked then raise exception 'durable close journal could not finalize after identity deletion'; end if;
end
$$;

do $$
declare
  v_state text;
  v_jobs integer;
begin
  select state into v_state
  from private.ordax_account_close_requests
  where close_id = (select close_id from close_result);
  select count(*) into v_jobs
  from private.ordax_account_close_cleanup_jobs
  where close_id = (select close_id from close_result);
  if v_state <> 'closed' or v_jobs <> 2 then
    raise exception 'journal or cleanup evidence disappeared with auth identity';
  end if;
end
$$;

select 'ACCOUNT_CLOSE_CLEANUP=PASS' as result;
