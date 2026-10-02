\set ON_ERROR_STOP on

-- Disposable database fixture for the integrated Product OAuth HTTP -> core ->
-- persistent-authority proof. The workflow creates a dedicated database before
-- executing this file, so none of this state can reach production.
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

create table public.ordax_space_members (
  space_id uuid not null references public.ordax_spaces(space_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  state text not null check (state in ('active','suspended')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (space_id, user_id)
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

\ir ../../infra/supabase/product/migrations/20261002140612_product_oauth_authority_v1.sql

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.ordax_spaces(
  space_id, owner_user_id, name, kind, state
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '11111111-1111-4111-8111-111111111111',
    'Owner Space A1',
    'professional',
    'active'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '11111111-1111-4111-8111-111111111111',
    'Owner Space A2',
    'professional',
    'active'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '22222222-2222-4222-8222-222222222222',
    'Other Account Space',
    'professional',
    'active'
  );

insert into private.ordax_product_oauth_clients(
  client_id,
  product_id,
  audience,
  public_client,
  redirect_uris,
  allowed_scopes,
  state
) values (
  'proof-http-e2e-01',
  'proof-http-e2e',
  'ordax:first-party:proof-http-e2e',
  true,
  array['https://acheguese.test/auth/ordax/callback'],
  array[
    'network.space.read',
    'network.directory.read',
    'network.communities.read'
  ],
  'active'
);

-- The canonical first-party seed from the migration must remain disabled.
do $proof$
begin
  if not exists (
    select 1
    from private.ordax_product_oauth_clients
    where client_id = 'acheguese-web-01'
      and state = 'disabled'
      and cardinality(redirect_uris) = 0
  ) then
    raise exception 'product-oauth-http-e2e-canonical-seed-not-disabled';
  end if;
end;
$proof$;
