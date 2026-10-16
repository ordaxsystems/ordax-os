\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema private;
revoke all on schema private from public, anon, authenticated, service_role;

create table auth.users (
  id uuid primary key
);

grant usage on schema auth to authenticated;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to authenticated;

create table public.ordax_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.ordax_spaces (
  space_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'work' check (kind in ('personal','work','professional')),
  state text not null default 'active' check (state in ('active','archived')),
  profile_pack_slug text,
  metadata jsonb not null default '{}'::jsonb,
  domain text,
  subtype text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((domain is null) = (subtype is null))
);

create table public.ordax_space_members (
  space_id uuid not null references public.ordax_spaces(space_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  state text not null default 'active' check (state in ('active','suspended')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (space_id, user_id)
);

grant select, insert, update, delete on table public.ordax_spaces to authenticated;
grant select, insert, update, delete on table public.ordax_space_members to authenticated;

\ir ../../infra/supabase/product/migrations/20261016014500_space_creation_authority_v1.sql

-- Migration must remove direct client insertion while keeping the exact RPC callable.
do $$
begin
  if has_table_privilege('authenticated', 'public.ordax_spaces', 'INSERT') then
    raise exception 'authenticated retained direct ordax_spaces INSERT';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.ordax_create_space_v1(text,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute bounded create RPC';
  end if;
  if has_function_privilege('anon', 'public.ordax_create_space_v1(text,text,text,uuid)', 'EXECUTE') then
    raise exception 'anon can execute create RPC';
  end if;
  if has_table_privilege('authenticated', 'private.ordax_space_creation_type_projection', 'SELECT') then
    raise exception 'private creation projection leaked to authenticated';
  end if;
end;
$$;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.ordax_accounts(user_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  created_row record;
begin
  select * into created_row
  from public.ordax_create_space_v1(
    '  Minha Pizzaria  ',
    'food',
    'pizzeria',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if created_row.created is distinct from true then
    raise exception 'first mutation was not reported as created';
  end if;
  if created_row.name <> 'Minha Pizzaria'
    or created_row.kind <> 'professional'
    or created_row.state <> 'active'
    or created_row.domain <> 'food'
    or created_row.subtype <> 'pizzeria'
    or created_row.profile_slug <> 'pizzaria-br'
    or created_row.profile_version <> 1 then
    raise exception 'created Space projection is invalid';
  end if;
end;
$$;

do $$
declare
  replay_row record;
begin
  select * into replay_row
  from public.ordax_create_space_v1(
    'Minha Pizzaria',
    'food',
    'pizzeria',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  );
  if replay_row.created is distinct from false then
    raise exception 'idempotent replay created a second Space';
  end if;
end;
$$;

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_create_space_v1(
      'Outro nome',
      'food',
      'pizzeria',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
  exception when sqlstate '22023' then
    blocked := sqlerrm = 'space-create-idempotency-conflict';
  end;
  if not blocked then
    raise exception 'idempotency-key payload drift was not rejected';
  end if;
end;
$$;

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_create_space_v1(
      'Escola indevida',
      'education',
      'school',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );
  exception when sqlstate '22023' then
    blocked := sqlerrm = 'space-type-not-creatable';
  end;
  if not blocked then
    raise exception 'deferred Space type was accepted';
  end if;
end;
$$;

reset role;

do $$
begin
  if (select count(*) from public.ordax_spaces where owner_user_id = '11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'idempotency did not preserve one Space';
  end if;
  if not exists (
    select 1
    from public.ordax_space_members
    where user_id = '11111111-1111-4111-8111-111111111111'
      and role = 'owner'
      and state = 'active'
  ) then
    raise exception 'creator owner membership missing';
  end if;
end;
$$;

-- The 64-owned-Space bound is enforced server-side, under the same per-account lock.
insert into public.ordax_spaces(owner_user_id, name, kind, state, domain, subtype)
select
  '22222222-2222-4222-8222-222222222222',
  'Seed ' || n,
  'professional',
  'active',
  'food',
  'pizzeria'
from generate_series(1, 64) as n;

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_create_space_v1(
      'Space 65',
      'fabrication',
      '3d-printing',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    );
  exception when sqlstate '23514' then
    blocked := sqlerrm = 'owned-space-limit-reached';
  end;
  if not blocked then
    raise exception 'owned Space limit was not enforced';
  end if;
end;
$$;

reset role;
