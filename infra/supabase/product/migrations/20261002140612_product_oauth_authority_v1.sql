-- OrdaX Product OAuth persistent authority v1.
--
-- This migration creates server-only persistence for first-party/end-user OAuth.
-- It does not enable a public listener, does not register a live redirect URI and
-- does not reuse development/MCP credentials. Raw authorization codes and access
-- tokens never enter PostgreSQL: callers persist only lowercase SHA-256 digests.

begin;

create or replace function private.ordax_product_oauth_scopes_valid_v1(
  p_scopes text[]
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $oauth$
declare
  v_scope text;
  v_seen text[] := '{}'::text[];
begin
  if p_scopes is null or cardinality(p_scopes) < 1 or cardinality(p_scopes) > 16 then
    return false;
  end if;

  foreach v_scope in array p_scopes loop
    if v_scope is null
       or char_length(v_scope) not between 3 and 96
       or v_scope !~ '^[a-z][a-z0-9.-]{2,95}$'
       or v_scope not in (
         'network.space.read',
         'network.directory.read',
         'network.communities.read',
         'network.messages.read',
         'network.messages.write',
         'network.groups.join',
         'product.acheguese.publish'
       )
       or v_scope = any(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_scope);
  end loop;

  return true;
end;
$oauth$;

create or replace function private.ordax_product_oauth_redirects_valid_v1(
  p_redirect_uris text[]
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $oauth$
declare
  v_uri text;
  v_seen text[] := '{}'::text[];
begin
  if p_redirect_uris is null or cardinality(p_redirect_uris) > 16 then
    return false;
  end if;

  foreach v_uri in array p_redirect_uris loop
    if v_uri is null
       or char_length(v_uri) not between 12 and 512
       or v_uri !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^#[:space:]]*)?(\?[^#[:space:]]*)?$'
       or position('@' in v_uri) > 0
       or v_uri = any(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, v_uri);
  end loop;

  return true;
end;
$oauth$;

revoke all on function private.ordax_product_oauth_scopes_valid_v1(text[])
from public, anon, authenticated, service_role;
revoke all on function private.ordax_product_oauth_redirects_valid_v1(text[])
from public, anon, authenticated, service_role;

create table private.ordax_product_oauth_clients (
  client_id text primary key
    check (
      char_length(client_id) between 8 and 96
      and client_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'
    ),
  product_id text not null
    check (
      char_length(product_id) between 3 and 80
      and product_id ~ '^[a-z0-9][a-z0-9-]{2,79}$'
    ),
  audience text not null unique
    check (
      char_length(audience) between 8 and 128
      and audience ~ '^[a-z][a-z0-9:_-]{7,127}$'
    ),
  public_client boolean not null default true,
  redirect_uris text[] not null default '{}'::text[]
    check (private.ordax_product_oauth_redirects_valid_v1(redirect_uris)),
  allowed_scopes text[] not null
    check (private.ordax_product_oauth_scopes_valid_v1(allowed_scopes)),
  state text not null default 'disabled'
    check (state in ('disabled','active','revoked')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (state <> 'active' or cardinality(redirect_uris) > 0)
);

create table private.ordax_product_oauth_codes (
  code_hash text primary key
    check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null
    references private.ordax_product_oauth_clients(client_id) on delete cascade,
  space_id uuid not null references public.ordax_spaces(space_id) on delete cascade,
  scopes text[] not null
    check (private.ordax_product_oauth_scopes_valid_v1(scopes)),
  redirect_uri text not null
    check (private.ordax_product_oauth_redirects_valid_v1(array[redirect_uri])),
  code_challenge text not null
    check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  check (consumed_at is null or consumed_at >= created_at)
);

create table private.ordax_product_oauth_grants (
  grant_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null
    references private.ordax_product_oauth_clients(client_id) on delete cascade,
  space_id uuid not null references public.ordax_spaces(space_id) on delete cascade,
  scopes text[] not null
    check (private.ordax_product_oauth_scopes_valid_v1(scopes)),
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (revoked_at is null or revoked_at >= created_at)
);

create table private.ordax_product_oauth_access_tokens (
  token_hash text primary key
    check (token_hash ~ '^[0-9a-f]{64}$'),
  grant_id uuid not null
    references private.ordax_product_oauth_grants(grant_id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  check (revoked_at is null or revoked_at >= created_at)
);

create index ordax_product_oauth_codes_expiry_idx
  on private.ordax_product_oauth_codes(expires_at)
  where consumed_at is null;
create index ordax_product_oauth_grants_subject_idx
  on private.ordax_product_oauth_grants(user_id, client_id, space_id, created_at desc);
create index ordax_product_oauth_tokens_grant_idx
  on private.ordax_product_oauth_access_tokens(grant_id, expires_at desc);

create trigger touch_ordax_product_oauth_clients_updated_at
before update on private.ordax_product_oauth_clients
for each row execute function private.ordax_touch_updated_at();

alter table private.ordax_product_oauth_clients enable row level security;
alter table private.ordax_product_oauth_codes enable row level security;
alter table private.ordax_product_oauth_grants enable row level security;
alter table private.ordax_product_oauth_access_tokens enable row level security;

revoke all on table private.ordax_product_oauth_clients
from public, anon, authenticated, service_role;
revoke all on table private.ordax_product_oauth_codes
from public, anon, authenticated, service_role;
revoke all on table private.ordax_product_oauth_grants
from public, anon, authenticated, service_role;
revoke all on table private.ordax_product_oauth_access_tokens
from public, anon, authenticated, service_role;

create or replace function private.ordax_product_oauth_can_act_as_space_v1(
  p_user_id uuid,
  p_space_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_space_id is not null
    and exists (
      select 1
      from public.ordax_spaces s
      where s.space_id = p_space_id
        and s.state = 'active'
        and s.kind = 'professional'
        and (
          s.owner_user_id = p_user_id
          or exists (
            select 1
            from public.ordax_space_members m
            where m.space_id = s.space_id
              and m.user_id = p_user_id
              and m.state = 'active'
              and m.role in ('owner','admin')
          )
        )
    );
$$;

revoke all on function private.ordax_product_oauth_can_act_as_space_v1(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.ordax_product_oauth_get_client_v1(
  p_client_id text
)
returns table(
  client_id text,
  redirect_uris text[],
  allowed_scopes text[],
  public_client boolean,
  state text,
  audience text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.client_id,
    c.redirect_uris,
    c.allowed_scopes,
    c.public_client,
    c.state,
    c.audience
  from private.ordax_product_oauth_clients c
  where c.client_id = p_client_id;
$$;

create or replace function public.ordax_product_oauth_can_act_as_space_v1(
  p_user_id uuid,
  p_space_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.ordax_product_oauth_can_act_as_space_v1(p_user_id, p_space_id);
$$;

create or replace function public.ordax_product_oauth_issue_code_v1(
  p_code_hash text,
  p_user_id uuid,
  p_client_id text,
  p_space_id uuid,
  p_scopes text[],
  p_redirect_uri text,
  p_code_challenge text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $oauth$
declare
  v_client private.ordax_product_oauth_clients;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_code_challenge is null or p_code_challenge !~ '^[A-Za-z0-9_-]{43}$'
     or not private.ordax_product_oauth_scopes_valid_v1(p_scopes)
     or not private.ordax_product_oauth_redirects_valid_v1(array[p_redirect_uri])
     or p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'product-oauth-code-input-invalid' using errcode = '22023';
  end if;

  select c.* into v_client
  from private.ordax_product_oauth_clients c
  where c.client_id = p_client_id
  for share;

  if not found or v_client.state <> 'active' or not v_client.public_client then
    raise exception 'product-oauth-client-inactive' using errcode = '42501';
  end if;
  if not (p_redirect_uri = any(v_client.redirect_uris)) then
    raise exception 'product-oauth-redirect-denied' using errcode = '42501';
  end if;
  if not (p_scopes <@ v_client.allowed_scopes) then
    raise exception 'product-oauth-scope-denied' using errcode = '42501';
  end if;
  if not private.ordax_product_oauth_can_act_as_space_v1(p_user_id, p_space_id) then
    raise exception 'product-oauth-space-denied' using errcode = '42501';
  end if;

  insert into private.ordax_product_oauth_codes(
    code_hash,
    user_id,
    client_id,
    space_id,
    scopes,
    redirect_uri,
    code_challenge,
    expires_at
  ) values (
    p_code_hash,
    p_user_id,
    p_client_id,
    p_space_id,
    p_scopes,
    p_redirect_uri,
    p_code_challenge,
    p_expires_at
  );

  return true;
end;
$oauth$;

create or replace function public.ordax_product_oauth_consume_code_v1(
  p_code_hash text,
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text
)
returns table(
  outcome text,
  grant_id uuid,
  user_id uuid,
  client_id text,
  space_id uuid,
  scopes text[]
)
language plpgsql
security definer
set search_path = ''
as $oauth$
declare
  v_code private.ordax_product_oauth_codes;
  v_client private.ordax_product_oauth_clients;
  v_grant_id uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
     or p_code_challenge is null or p_code_challenge !~ '^[A-Za-z0-9_-]{43}$' then
    return query select 'denied', null::uuid, null::uuid, null::text, null::uuid, null::text[];
    return;
  end if;

  select c.* into v_code
  from private.ordax_product_oauth_codes c
  where c.code_hash = p_code_hash
    and c.consumed_at is null
    and c.expires_at > statement_timestamp()
  for update;

  if not found then
    return query select 'denied', null::uuid, null::uuid, null::text, null::uuid, null::text[];
    return;
  end if;

  -- Consume before validating redirect/client/PKCE. A mismatch must burn the
  -- code rather than leave a reusable credential.
  update private.ordax_product_oauth_codes c
  set consumed_at = statement_timestamp()
  where c.code_hash = v_code.code_hash;

  if v_code.client_id <> p_client_id
     or v_code.redirect_uri <> p_redirect_uri
     or v_code.code_challenge <> p_code_challenge then
    return query select 'denied', null::uuid, null::uuid, null::text, null::uuid, null::text[];
    return;
  end if;

  select c.* into v_client
  from private.ordax_product_oauth_clients c
  where c.client_id = v_code.client_id
  for share;

  if not found
     or v_client.state <> 'active'
     or not v_client.public_client
     or not (v_code.redirect_uri = any(v_client.redirect_uris))
     or not (v_code.scopes <@ v_client.allowed_scopes)
     or not private.ordax_product_oauth_can_act_as_space_v1(v_code.user_id, v_code.space_id) then
    return query select 'denied', null::uuid, null::uuid, null::text, null::uuid, null::text[];
    return;
  end if;

  insert into private.ordax_product_oauth_grants(
    user_id,
    client_id,
    space_id,
    scopes
  ) values (
    v_code.user_id,
    v_code.client_id,
    v_code.space_id,
    v_code.scopes
  )
  returning ordax_product_oauth_grants.grant_id into v_grant_id;

  return query select
    'applied',
    v_grant_id,
    v_code.user_id,
    v_code.client_id,
    v_code.space_id,
    v_code.scopes;
end;
$oauth$;

create or replace function public.ordax_product_oauth_issue_access_token_v1(
  p_token_hash text,
  p_grant_id uuid,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $oauth$
declare
  v_grant private.ordax_product_oauth_grants;
  v_client private.ordax_product_oauth_clients;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= statement_timestamp()
     or p_expires_at > statement_timestamp() + interval '1 hour' then
    raise exception 'product-oauth-token-input-invalid' using errcode = '22023';
  end if;

  select g.* into v_grant
  from private.ordax_product_oauth_grants g
  where g.grant_id = p_grant_id
    and g.revoked_at is null
  for share;

  if not found then
    raise exception 'product-oauth-grant-inactive' using errcode = '42501';
  end if;

  select c.* into v_client
  from private.ordax_product_oauth_clients c
  where c.client_id = v_grant.client_id
    and c.state = 'active'
    and c.public_client
  for share;

  if not found
     or not (v_grant.scopes <@ v_client.allowed_scopes)
     or not private.ordax_product_oauth_can_act_as_space_v1(
       v_grant.user_id,
       v_grant.space_id
     ) then
    raise exception 'product-oauth-grant-authority-stale' using errcode = '42501';
  end if;

  insert into private.ordax_product_oauth_access_tokens(
    token_hash,
    grant_id,
    expires_at
  ) values (
    p_token_hash,
    p_grant_id,
    p_expires_at
  );

  return true;
end;
$oauth$;

create or replace function public.ordax_product_oauth_resolve_access_token_v1(
  p_token_hash text
)
returns table(
  grant_id uuid,
  user_id uuid,
  client_id text,
  space_id uuid,
  scopes text[],
  revoked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.grant_id,
    g.user_id,
    g.client_id,
    g.space_id,
    g.scopes,
    false
  from private.ordax_product_oauth_access_tokens t
  join private.ordax_product_oauth_grants g on g.grant_id = t.grant_id
  join private.ordax_product_oauth_clients c on c.client_id = g.client_id
  where t.token_hash = p_token_hash
    and t.revoked_at is null
    and t.expires_at > statement_timestamp()
    and g.revoked_at is null
    and c.state = 'active'
    and c.public_client
    and g.scopes <@ c.allowed_scopes
    and private.ordax_product_oauth_can_act_as_space_v1(g.user_id, g.space_id);
$$;

create or replace function public.ordax_product_oauth_revoke_access_token_v1(
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $oauth$
declare
  v_count integer;
begin
  update private.ordax_product_oauth_access_tokens t
  set revoked_at = coalesce(t.revoked_at, statement_timestamp())
  where t.token_hash = p_token_hash
    and t.revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$oauth$;

create or replace function public.ordax_product_oauth_revoke_grant_v1(
  p_grant_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $oauth$
declare
  v_count integer;
begin
  update private.ordax_product_oauth_grants g
  set revoked_at = coalesce(g.revoked_at, statement_timestamp())
  where g.grant_id = p_grant_id
    and g.revoked_at is null;

  get diagnostics v_count = row_count;

  update private.ordax_product_oauth_access_tokens t
  set revoked_at = coalesce(t.revoked_at, statement_timestamp())
  where t.grant_id = p_grant_id
    and t.revoked_at is null;

  return v_count = 1;
end;
$oauth$;

revoke all on function public.ordax_product_oauth_get_client_v1(text)
from public, anon, authenticated;
revoke all on function public.ordax_product_oauth_can_act_as_space_v1(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.ordax_product_oauth_issue_code_v1(
  text, uuid, text, uuid, text[], text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.ordax_product_oauth_consume_code_v1(
  text, text, text, text
) from public, anon, authenticated;
revoke all on function public.ordax_product_oauth_issue_access_token_v1(
  text, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.ordax_product_oauth_resolve_access_token_v1(text)
from public, anon, authenticated;
revoke all on function public.ordax_product_oauth_revoke_access_token_v1(text)
from public, anon, authenticated;
revoke all on function public.ordax_product_oauth_revoke_grant_v1(uuid)
from public, anon, authenticated;

grant execute on function public.ordax_product_oauth_get_client_v1(text)
to service_role;
grant execute on function public.ordax_product_oauth_can_act_as_space_v1(uuid, uuid)
to service_role;
grant execute on function public.ordax_product_oauth_issue_code_v1(
  text, uuid, text, uuid, text[], text, text, timestamptz
) to service_role;
grant execute on function public.ordax_product_oauth_consume_code_v1(
  text, text, text, text
) to service_role;
grant execute on function public.ordax_product_oauth_issue_access_token_v1(
  text, uuid, timestamptz
) to service_role;
grant execute on function public.ordax_product_oauth_resolve_access_token_v1(text)
to service_role;
grant execute on function public.ordax_product_oauth_revoke_access_token_v1(text)
to service_role;
grant execute on function public.ordax_product_oauth_revoke_grant_v1(uuid)
to service_role;

-- Register the first-party product identity without inventing a production
-- redirect URI. Disabled + empty redirect list keeps issuance fail-closed.
insert into private.ordax_product_oauth_clients(
  client_id,
  product_id,
  audience,
  public_client,
  redirect_uris,
  allowed_scopes,
  state
) values (
  'acheguese-web-01',
  'acheguese',
  'ordax:first-party:acheguese',
  true,
  '{}'::text[],
  array[
    'network.space.read',
    'network.directory.read',
    'network.communities.read'
  ],
  'disabled'
)
on conflict (client_id) do nothing;

commit;
