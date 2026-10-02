\set ON_ERROR_STOP on

-- Disposable PostgreSQL proof for the Product OAuth authority.
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
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');

insert into public.ordax_spaces(
  space_id, owner_user_id, name, kind, state
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '11111111-1111-4111-8111-111111111111',
    'Space A1',
    'professional',
    'active'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '11111111-1111-4111-8111-111111111111',
    'Space A2',
    'professional',
    'active'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '22222222-2222-4222-8222-222222222222',
    'Space B',
    'professional',
    'active'
  );

insert into public.ordax_space_members(
  space_id, user_id, role, state
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '33333333-3333-4333-8333-333333333333',
  'admin',
  'active'
);

-- Test client is disposable CI state. The canonical Achegue-se seed stays disabled.
insert into private.ordax_product_oauth_clients(
  client_id,
  product_id,
  audience,
  public_client,
  redirect_uris,
  allowed_scopes,
  state
) values (
  'proof-client-01',
  'proof-product',
  'ordax:first-party:proof',
  true,
  array['https://acheguese.test/auth/ordax/callback'],
  array[
    'network.space.read',
    'network.directory.read',
    'network.communities.read'
  ],
  'active'
);

do $proof$
declare
  v_count integer;
begin
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'private'
    and table_name like 'ordax_product_oauth_%'
    and grantee in ('anon','authenticated','service_role');
  if v_count <> 0 then
    raise exception 'product-oauth-private-table-grant-leak';
  end if;

  if exists (
    select 1
    from private.ordax_product_oauth_clients
    where client_id = 'acheguese-web-01'
      and (
        state <> 'disabled'
        or cardinality(redirect_uris) <> 0
        or allowed_scopes <> array[
          'network.space.read',
          'network.directory.read',
          'network.communities.read'
        ]
      )
  ) is false then
    raise exception 'product-oauth-acheguese-seed-not-fail-closed';
  end if;
end;
$proof$;

set role service_role;

do $proof$
begin
  if not public.ordax_product_oauth_can_act_as_space_v1(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) then
    raise exception 'product-oauth-owner-space-denied';
  end if;

  if not public.ordax_product_oauth_can_act_as_space_v1(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  ) then
    raise exception 'product-oauth-second-explicit-space-denied';
  end if;

  if public.ordax_product_oauth_can_act_as_space_v1(
    '11111111-1111-4111-8111-111111111111',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) then
    raise exception 'product-oauth-cross-account-space-authority';
  end if;

  if not public.ordax_product_oauth_can_act_as_space_v1(
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) then
    raise exception 'product-oauth-admin-space-denied';
  end if;
end;
$proof$;

-- Redirect and scope escalation are denied before code persistence.
do $proof$
begin
  begin
    perform public.ordax_product_oauth_issue_code_v1(
      repeat('1', 64),
      '11111111-1111-4111-8111-111111111111',
      'proof-client-01',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      array['network.space.read'],
      'https://acheguese.test/other',
      repeat('A', 43),
      statement_timestamp() + interval '4 minutes'
    );
    raise exception 'product-oauth-redirect-mismatch-accepted';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.ordax_product_oauth_issue_code_v1(
      repeat('2', 64),
      '11111111-1111-4111-8111-111111111111',
      'proof-client-01',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      array['network.messages.write'],
      'https://acheguese.test/auth/ordax/callback',
      repeat('A', 43),
      statement_timestamp() + interval '4 minutes'
    );
    raise exception 'product-oauth-scope-escalation-accepted';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.ordax_product_oauth_issue_code_v1(
      repeat('3', 64),
      '11111111-1111-4111-8111-111111111111',
      'proof-client-01',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      array['network.space.read'],
      'https://acheguese.test/auth/ordax/callback',
      repeat('A', 43),
      statement_timestamp() + interval '4 minutes'
    );
    raise exception 'product-oauth-cross-account-code-issued';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

-- A PKCE mismatch burns the code; replay with the correct verifier stays denied.
select public.ordax_product_oauth_issue_code_v1(
  repeat('4', 64),
  '11111111-1111-4111-8111-111111111111',
  'proof-client-01',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  array['network.space.read'],
  'https://acheguese.test/auth/ordax/callback',
  repeat('A', 43),
  statement_timestamp() + interval '4 minutes'
);

do $proof$
declare
  v_row record;
begin
  select * into v_row
  from public.ordax_product_oauth_consume_code_v1(
    repeat('4', 64),
    'proof-client-01',
    'https://acheguese.test/auth/ordax/callback',
    repeat('B', 43)
  );
  if v_row.outcome <> 'denied' then
    raise exception 'product-oauth-pkce-mismatch-not-denied';
  end if;

  select * into v_row
  from public.ordax_product_oauth_consume_code_v1(
    repeat('4', 64),
    'proof-client-01',
    'https://acheguese.test/auth/ordax/callback',
    repeat('A', 43)
  );
  if v_row.outcome <> 'denied' then
    raise exception 'product-oauth-burned-code-replayed';
  end if;
end;
$proof$;

-- Successful code is bound to one explicit Space even when the account owns two.
select public.ordax_product_oauth_issue_code_v1(
  repeat('5', 64),
  '11111111-1111-4111-8111-111111111111',
  'proof-client-01',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  array['network.space.read','network.directory.read'],
  'https://acheguese.test/auth/ordax/callback',
  repeat('C', 43),
  statement_timestamp() + interval '4 minutes'
);

select grant_id as owner_grant_id, space_id as owner_space_id
from public.ordax_product_oauth_consume_code_v1(
  repeat('5', 64),
  'proof-client-01',
  'https://acheguese.test/auth/ordax/callback',
  repeat('C', 43)
)
where outcome = 'applied'
\gset

select (
  :'owner_space_id'::uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid
) as owner_space_binding_ok
\\gset
\\if :owner_space_binding_ok
\\else
  \\echo 'product-oauth-explicit-space-binding-lost'
  \\quit 1
\\endif

select public.ordax_product_oauth_issue_access_token_v1(
  repeat('6', 64),
  :'owner_grant_id'::uuid,
  statement_timestamp() + interval '15 minutes'
);

do $proof$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.ordax_product_oauth_resolve_access_token_v1(repeat('6', 64))
  where user_id = '11111111-1111-4111-8111-111111111111'
    and space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
    and scopes = array['network.space.read','network.directory.read'];
  if v_count <> 1 then
    raise exception 'product-oauth-access-token-resolution-invalid';
  end if;

  if not public.ordax_product_oauth_revoke_access_token_v1(repeat('6', 64)) then
    raise exception 'product-oauth-token-revoke-failed';
  end if;

  select count(*) into v_count
  from public.ordax_product_oauth_resolve_access_token_v1(repeat('6', 64));
  if v_count <> 0 then
    raise exception 'product-oauth-revoked-token-resolved';
  end if;
end;
$proof$;

-- Current membership is revalidated on token use, not frozen into the grant.
select public.ordax_product_oauth_issue_code_v1(
  repeat('7', 64),
  '33333333-3333-4333-8333-333333333333',
  'proof-client-01',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  array['network.space.read'],
  'https://acheguese.test/auth/ordax/callback',
  repeat('D', 43),
  statement_timestamp() + interval '4 minutes'
);

select grant_id as admin_grant_id
from public.ordax_product_oauth_consume_code_v1(
  repeat('7', 64),
  'proof-client-01',
  'https://acheguese.test/auth/ordax/callback',
  repeat('D', 43)
)
where outcome = 'applied'
\gset

select public.ordax_product_oauth_issue_access_token_v1(
  repeat('8', 64),
  :'admin_grant_id'::uuid,
  statement_timestamp() + interval '15 minutes'
);

reset role;
update public.ordax_space_members
set state = 'suspended'
where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  and user_id = '33333333-3333-4333-8333-333333333333';

set role service_role;
do $proof$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.ordax_product_oauth_resolve_access_token_v1(repeat('8', 64));
  if v_count <> 0 then
    raise exception 'product-oauth-stale-membership-token-resolved';
  end if;
end;
$proof$;

reset role;

-- Raw credential material is structurally impossible in the persistence schema.
do $proof$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from information_schema.columns
  where table_schema = 'private'
    and table_name like 'ordax_product_oauth_%'
    and column_name in (
      'authorization_code',
      'code',
      'access_token',
      'refresh_token',
      'client_secret',
      'provider_token'
    );
  if v_bad <> 0 then
    raise exception 'product-oauth-raw-credential-column-present';
  end if;
end;
$proof$;

\echo PRODUCT_OAUTH_AUTHORITY_V1_SQL_PROOF=PASS
