-- OrdaX Product OAuth: read-only Network resource server authority v1.
--
-- This bridge is intentionally server-only. Product OAuth access tokens are
-- opaque outside the product server; only SHA-256 digests reach PostgreSQL.
-- Every read revalidates token/grant/client state plus current Space authority.
-- Nothing here enables public linking or grants browser roles direct table/RPC
-- access.

begin;

create or replace function private.ordax_product_network_authorize_v1(
  p_token_hash text,
  p_required_scope text
)
returns table(
  user_id uuid,
  client_id text,
  space_id uuid,
  scopes text[]
)
language plpgsql
security definer
set search_path = ''
as $resource$
begin
  if p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_required_scope not in (
       'network.space.read',
       'network.directory.read',
       'network.communities.read'
     ) then
    raise exception 'product-network-authorization-input-invalid'
      using errcode = '22023';
  end if;

  return query
  select
    g.user_id,
    g.client_id,
    g.space_id,
    g.scopes
  from private.ordax_product_oauth_access_tokens t
  join private.ordax_product_oauth_grants g
    on g.grant_id = t.grant_id
  join private.ordax_product_oauth_clients c
    on c.client_id = g.client_id
  where t.token_hash = p_token_hash
    and t.revoked_at is null
    and t.expires_at > statement_timestamp()
    and g.revoked_at is null
    and c.state = 'active'
    and c.public_client
    and p_required_scope = any(g.scopes)
    and p_required_scope = any(c.allowed_scopes)
    and g.scopes <@ c.allowed_scopes
    and private.ordax_product_oauth_can_act_as_space_v1(
      g.user_id,
      g.space_id
    )
  limit 1;

  if not found then
    raise exception 'product-network-authorization-denied'
      using errcode = '42501';
  end if;
end;
$resource$;

revoke all on function private.ordax_product_network_authorize_v1(text, text)
from public, anon, authenticated, service_role;

create or replace function public.ordax_product_network_get_space_v1(
  p_token_hash text
)
returns table(
  space_id uuid,
  public_name text,
  description text,
  region_label text,
  categories text[],
  visibility text
)
language plpgsql
security definer
set search_path = ''
as $resource$
declare
  v_space_id uuid;
begin
  select a.space_id into v_space_id
  from private.ordax_product_network_authorize_v1(
    p_token_hash,
    'network.space.read'
  ) a;

  return query
  select
    p.space_id,
    p.public_name,
    p.description,
    p.region_label,
    p.categories,
    p.visibility
  from public.ordax_network_space_profiles p
  join public.ordax_spaces s on s.space_id = p.space_id
  where p.space_id = v_space_id
    and s.state = 'active';
end;
$resource$;

create or replace function public.ordax_product_network_list_directory_v1(
  p_token_hash text,
  p_search text default null,
  p_category text default null,
  p_after_name text default null,
  p_after_space_id uuid default null,
  p_limit integer default 20
)
returns table(
  space_id uuid,
  public_name text,
  description text,
  region_label text,
  categories text[]
)
language plpgsql
security definer
set search_path = ''
as $resource$
declare
  v_search text := nullif(btrim(p_search), '');
  v_category text := nullif(btrim(p_category), '');
begin
  perform 1
  from private.ordax_product_network_authorize_v1(
    p_token_hash,
    'network.directory.read'
  );

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'product-network-directory-limit-invalid'
      using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 80 then
    raise exception 'product-network-directory-search-too-long'
      using errcode = '22023';
  end if;
  if v_category is not null and (
    char_length(v_category) > 60
    or v_category !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ) then
    raise exception 'product-network-category-invalid'
      using errcode = '22023';
  end if;
  if (p_after_name is null) <> (p_after_space_id is null) then
    raise exception 'product-network-directory-cursor-incomplete'
      using errcode = '22023';
  end if;

  return query
  select
    p.space_id,
    p.public_name,
    p.description,
    p.region_label,
    p.categories
  from public.ordax_network_space_profiles p
  join public.ordax_spaces s on s.space_id = p.space_id
  where p.visibility = 'discoverable'
    and s.state = 'active'
    and (v_category is null or v_category = any(p.categories))
    and (
      v_search is null
      or lower(p.public_name) like
        lower(replace(replace(v_search, '%', '\\%'), '_', '\\_')) || '%' escape '\\'
    )
    and (
      p_after_name is null
      or (p.public_name, p.space_id) > (p_after_name, p_after_space_id)
    )
  order by p.public_name, p.space_id
  limit p_limit;
end;
$resource$;

create or replace function public.ordax_product_network_list_communities_v1(
  p_token_hash text,
  p_limit integer default 50
)
returns table(
  community_id text,
  title text,
  kind text,
  jurisdiction text,
  join_policy text
)
language plpgsql
security definer
set search_path = ''
as $resource$
begin
  perform 1
  from private.ordax_product_network_authorize_v1(
    p_token_hash,
    'network.communities.read'
  );

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'product-network-community-limit-invalid'
      using errcode = '22023';
  end if;

  return query
  select
    c.community_id,
    c.title,
    c.kind,
    c.jurisdiction,
    c.join_policy
  from public.ordax_network_communities c
  where c.state = 'active'
  order by c.title, c.community_id
  limit p_limit;
end;
$resource$;

revoke all on function public.ordax_product_network_get_space_v1(text)
from public, anon, authenticated;
revoke all on function public.ordax_product_network_list_directory_v1(
  text, text, text, text, uuid, integer
) from public, anon, authenticated;
revoke all on function public.ordax_product_network_list_communities_v1(
  text, integer
) from public, anon, authenticated;

grant execute on function public.ordax_product_network_get_space_v1(text)
to service_role;
grant execute on function public.ordax_product_network_list_directory_v1(
  text, text, text, text, uuid, integer
) to service_role;
grant execute on function public.ordax_product_network_list_communities_v1(
  text, integer
) to service_role;

commit;
