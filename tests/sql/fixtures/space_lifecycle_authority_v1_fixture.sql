\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema private;
create schema ordax_policy;
revoke all on schema private from public, anon, authenticated, service_role;
revoke all on schema ordax_policy from public, anon, authenticated, service_role;
grant usage on schema auth to authenticated;
grant usage on schema ordax_policy to authenticated;

create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to authenticated;

create table public.ordax_spaces (
  space_id uuid primary key,
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

-- Exact authorization semantics owned by the production policy boundary.
create function ordax_policy.can_access_space(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and (
    exists (
      select 1
      from public.ordax_spaces s
      where s.space_id = target_space_id
        and s.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.ordax_space_members m
      where m.space_id = target_space_id
        and m.user_id = (select auth.uid())
        and m.state = 'active'
    )
  );
$function$;
revoke all on function ordax_policy.can_access_space(uuid)
  from public, anon, authenticated, service_role;
grant execute on function ordax_policy.can_access_space(uuid) to authenticated;

create function ordax_policy.can_admin_space(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and (
    exists (
      select 1
      from public.ordax_spaces s
      where s.space_id = target_space_id
        and s.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.ordax_space_members m
      where m.space_id = target_space_id
        and m.user_id = (select auth.uid())
        and m.state = 'active'
        and m.role in ('owner','admin')
    )
  );
$function$;
revoke all on function ordax_policy.can_admin_space(uuid)
  from public, anon, authenticated, service_role;
grant execute on function ordax_policy.can_admin_space(uuid) to authenticated;

grant select, update, delete on table public.ordax_spaces to authenticated;
grant select on table public.ordax_space_members to authenticated;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

insert into public.ordax_spaces(
  space_id, owner_user_id, name, kind, state, domain, subtype
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'Pizzaria Centro',
    'professional',
    'active',
    'food',
    'pizzeria'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'Impressao Norte',
    'professional',
    'active',
    'fabrication',
    '3d-printing'
  );

insert into public.ordax_space_members(space_id, user_id, role, state) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner', 'active'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'admin', 'active'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'member', 'active'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'admin', 'suspended'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner', 'active');
