\set ON_ERROR_STOP on

\ir setup_product_oauth_http_e2e.sql
\ir ../../infra/supabase/product/migrations/20261001040000_network_directory_communities_v1.sql
\ir ../../infra/supabase/product/migrations/20261002151358_product_network_read_resource_v1.sql

insert into public.ordax_network_space_profiles(
  space_id, public_name, description, region_label, categories, visibility
) values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'Alpha Studio',
    'Primeiro Space do mesmo Account',
    'BA',
    array['design'],
    'discoverable'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'Beta Pizzaria',
    'Space explicitamente autorizado',
    'BA',
    array['food','pizzeria'],
    'hidden'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'Other Company',
    'Outro Account',
    'SP',
    array['food'],
    'discoverable'
  );

-- The Network foundation migration already seeds the canonical Pizzarias Brasil
-- community. Add only an archived row for negative visibility proof.
insert into public.ordax_network_communities(
  community_id, title, kind, jurisdiction, state, join_policy
) values (
  'industry.archived.br',
  'Archived Community',
  'professional-industry',
  'BR',
  'archived',
  'invite-only'
);

-- The public resource RPCs are server-only. Browser roles never receive EXECUTE
-- and the private authorization helper remains uncallable even by service_role.
do $proof$
declare
  v_count integer;
begin
  select count(*) into v_count
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in (
      'ordax_product_network_get_space_v1',
      'ordax_product_network_list_directory_v1',
      'ordax_product_network_list_communities_v1'
    )
    and grantee in ('PUBLIC','anon','authenticated');
  if v_count <> 0 then
    raise exception 'product-network-browser-rpc-grant-leak';
  end if;

  select count(*) into v_count
  from information_schema.routine_privileges
  where routine_schema = 'private'
    and routine_name = 'ordax_product_network_authorize_v1'
    and grantee in ('PUBLIC','anon','authenticated','service_role');
  if v_count <> 0 then
    raise exception 'product-network-private-authorizer-callable';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'ordax_product_network_get_space_v1',
      'ordax_product_network_list_directory_v1',
      'ordax_product_network_list_communities_v1'
    )
    and p.prosecdef
    and p.proconfig = array['search_path='];
  if v_count <> 3 then
    raise exception 'product-network-public-rpc-hardening-invalid';
  end if;
end;
$proof$;

set role service_role;

-- Issue one token bound explicitly to the Account's second Space with exactly
-- the three initial read scopes.
select public.ordax_product_oauth_issue_code_v1(
  repeat('a', 64),
  '11111111-1111-4111-8111-111111111111',
  'proof-http-e2e-01',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  array[
    'network.space.read',
    'network.directory.read',
    'network.communities.read'
  ],
  'https://acheguese.test/auth/ordax/callback',
  repeat('A', 43),
  statement_timestamp() + interval '4 minutes'
);

select grant_id as read_grant_id
from public.ordax_product_oauth_consume_code_v1(
  repeat('a', 64),
  'proof-http-e2e-01',
  'https://acheguese.test/auth/ordax/callback',
  repeat('A', 43)
)
where outcome = 'applied'
\gset

select public.ordax_product_oauth_issue_access_token_v1(
  repeat('b', 64),
  :'read_grant_id'::uuid,
  statement_timestamp() + interval '15 minutes'
);

do $proof$
declare
  v_count integer;
begin
  -- network.space.read is bound to the explicitly selected Space, even though
  -- this profile is hidden from the public directory.
  select count(*) into v_count
  from public.ordax_product_network_get_space_v1(repeat('b', 64))
  where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
    and public_name = 'Beta Pizzaria'
    and visibility = 'hidden';
  if v_count <> 1 then
    raise exception 'product-network-bound-space-read-invalid';
  end if;

  -- Directory remains discoverable-only and does not leak the hidden selected
  -- Space or private account identity.
  select count(*) into v_count
  from public.ordax_product_network_list_directory_v1(
    repeat('b', 64), null, 'food', null, null, 20
  );
  if v_count <> 1 then
    raise exception 'product-network-directory-filter-invalid';
  end if;

  if exists (
    select 1
    from public.ordax_product_network_list_directory_v1(
      repeat('b', 64), null, null, null, null, 20
    )
    where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
  ) then
    raise exception 'product-network-hidden-space-leaked-to-directory';
  end if;

  select count(*) into v_count
  from public.ordax_product_network_list_communities_v1(repeat('b', 64), 50)
  where community_id = 'industry.food.pizzeria.br';
  if v_count <> 1 then
    raise exception 'product-network-community-read-invalid';
  end if;

  if exists (
    select 1
    from public.ordax_product_network_list_communities_v1(repeat('b', 64), 50)
    where community_id = 'industry.archived.br'
  ) then
    raise exception 'product-network-archived-community-leaked';
  end if;
end;
$proof$;

-- A token missing directory scope cannot use the directory RPC.
select public.ordax_product_oauth_issue_code_v1(
  repeat('c', 64),
  '11111111-1111-4111-8111-111111111111',
  'proof-http-e2e-01',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  array['network.space.read'],
  'https://acheguese.test/auth/ordax/callback',
  repeat('C', 43),
  statement_timestamp() + interval '4 minutes'
);

select grant_id as narrow_grant_id
from public.ordax_product_oauth_consume_code_v1(
  repeat('c', 64),
  'proof-http-e2e-01',
  'https://acheguese.test/auth/ordax/callback',
  repeat('C', 43)
)
where outcome = 'applied'
\gset

select public.ordax_product_oauth_issue_access_token_v1(
  repeat('d', 64),
  :'narrow_grant_id'::uuid,
  statement_timestamp() + interval '15 minutes'
);

do $proof$
begin
  begin
    perform *
    from public.ordax_product_network_list_directory_v1(
      repeat('d', 64), null, null, null, null, 20
    );
    raise exception 'product-network-missing-scope-accepted';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

-- Revocation is revalidated by the resource RPC itself.
select public.ordax_product_oauth_revoke_access_token_v1(repeat('b', 64));

do $proof$
begin
  begin
    perform *
    from public.ordax_product_network_get_space_v1(repeat('b', 64));
    raise exception 'product-network-revoked-token-accepted';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

-- Current Space authority is also revalidated at resource-use time.
reset role;
update public.ordax_spaces
set state = 'archived'
where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

set role service_role;
do $proof$
begin
  begin
    perform *
    from public.ordax_product_network_get_space_v1(repeat('d', 64));
    raise exception 'product-network-stale-space-token-accepted';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

reset role;
\echo PRODUCT_NETWORK_READ_RESOURCE_V1_SQL_PROOF=PASS
