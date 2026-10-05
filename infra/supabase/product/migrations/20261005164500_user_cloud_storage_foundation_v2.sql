-- User Cloud Storage source foundation after the private-schema API seal.
--
-- This migration is deliberately non-activating:
--   * authenticated may read only a sanitized logical metadata projection authorized by RLS;
--   * provider bindings and upload reservations remain private with zero API-role grants;
--   * service_role receives no direct private authority;
--   * account-owned and Space-owned objects have exactly one ownership subject;
--   * creator identity is audit metadata, not ownership of Space data;
--   * identity/Space deletion is RESTRICTed while owned cloud cleanup references remain;
--   * no upload/finalization RPC is created until the storage executor + atomic quota meter
--     are reconciled in a later activation migration.

begin;

do $preflight$
begin
  if to_regnamespace('private') is null
     or to_regnamespace('ordax_policy') is null
     or to_regprocedure('ordax_policy.can_access_space(uuid)') is null then
    raise exception 'User Cloud Storage v2: hardened private/policy boundary is missing';
  end if;

  if to_regclass('public.ordax_user_objects') is not null
     or to_regclass('private.ordax_user_object_bindings') is not null
     or to_regclass('private.ordax_user_upload_reservations') is not null then
    raise exception 'User Cloud Storage v2: storage relation already exists';
  end if;
end;
$preflight$;

create table public.ordax_user_objects (
  object_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete restrict,
  space_id uuid references public.ordax_spaces(space_id) on delete restrict,
  created_by_user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 255),
  media_type text not null check (char_length(media_type) between 1 and 160),
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  server_revision bigint not null default 1 check (server_revision > 0),
  state text not null default 'active' check (state in ('active','deleted')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((owner_user_id is not null) <> (space_id is not null))
);

create table private.ordax_user_object_bindings (
  object_id uuid primary key references public.ordax_user_objects(object_id) on delete cascade,
  provider text not null check (provider in ('supabase-storage','cloudflare-r2','other')),
  provider_bucket text not null check (char_length(provider_bucket) between 1 and 160),
  provider_object_key text not null check (
    char_length(provider_object_key) between 8 and 512
    and left(provider_object_key, 1) <> '/'
    and position(E'\\' in provider_object_key) = 0
    and provider_object_key !~ '(^|/)[.]{1,2}(/|$)'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_bucket, provider_object_key)
);

create table private.ordax_user_upload_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  object_id uuid not null unique,
  owner_user_id uuid references auth.users(id) on delete restrict,
  space_id uuid references public.ordax_spaces(space_id) on delete restrict,
  requested_by_user_id uuid not null references auth.users(id) on delete restrict,
  quota_key text not null default 'storage.user.bytes' check (quota_key = 'storage.user.bytes'),
  expected_size_bytes bigint not null check (expected_size_bytes >= 0),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('supabase-storage','cloudflare-r2','other')),
  provider_bucket text not null check (char_length(provider_bucket) between 1 and 160),
  provider_object_key text not null check (
    char_length(provider_object_key) between 8 and 512
    and left(provider_object_key, 1) <> '/'
    and position(E'\\' in provider_object_key) = 0
    and provider_object_key !~ '(^|/)[.]{1,2}(/|$)'
  ),
  state text not null default 'reserved' check (state in ('reserved','consumed','cancelled','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  consumed_at timestamptz,
  unique (provider, provider_bucket, provider_object_key),
  check ((owner_user_id is not null) <> (space_id is not null)),
  check (expires_at > created_at),
  check ((state = 'consumed') = (consumed_at is not null))
);

create index ordax_user_objects_owner_state_idx
  on public.ordax_user_objects(owner_user_id, state, created_at)
  where owner_user_id is not null;
create index ordax_user_objects_space_state_idx
  on public.ordax_user_objects(space_id, state, created_at)
  where space_id is not null;
create index ordax_user_upload_reservations_owner_state_idx
  on private.ordax_user_upload_reservations(owner_user_id, state, expires_at)
  where owner_user_id is not null;
create index ordax_user_upload_reservations_requester_state_idx
  on private.ordax_user_upload_reservations(requested_by_user_id, state, expires_at);

alter table public.ordax_user_objects enable row level security;

revoke all on table public.ordax_user_objects from public, anon, authenticated, service_role;
revoke all on table private.ordax_user_object_bindings from public, anon, authenticated, service_role;
revoke all on table private.ordax_user_upload_reservations from public, anon, authenticated, service_role;

grant select (
  object_id,
  space_id,
  display_name,
  media_type,
  size_bytes,
  sha256,
  server_revision,
  state,
  created_at,
  updated_at
) on table public.ordax_user_objects to authenticated;

create policy ordax_user_objects_select_authorized
on public.ordax_user_objects for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or (space_id is not null and ordax_policy.can_access_space(space_id))
);

comment on table public.ordax_user_objects is
  'Logical metadata for explicitly selected cloud objects. Account and Space ownership are mutually exclusive. Creator identity is audit-only and provider location/upload authority are not exposed in the client projection.';
comment on table private.ordax_user_object_bindings is
  'Server-only object-store binding. API roles have zero direct private authority.';
comment on table private.ordax_user_upload_reservations is
  'Server-only bounded upload reservation source. Requester identity is held until authorization expires/cancels; runtime mutation remains disabled until storage executor and atomic quota admission are proven.';

do $postflight$
declare
  private_api_authority integer;
  public_write_authority integer;
begin
  select count(*) into private_api_authority
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relname in ('ordax_user_object_bindings', 'ordax_user_upload_reservations')
    and (
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    );
  if private_api_authority <> 0 then
    raise exception 'User Cloud Storage v2: API role gained private relation authority';
  end if;

  select count(*) into public_write_authority
  from (values ('anon'), ('authenticated'), ('service_role')) as role_name(name)
  where has_table_privilege(
    role_name.name,
    'public.ordax_user_objects',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  );
  if public_write_authority <> 0 then
    raise exception 'User Cloud Storage v2: API role gained direct metadata write authority';
  end if;

  if not has_column_privilege('authenticated', 'public.ordax_user_objects', 'object_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.ordax_user_objects', 'owner_user_id', 'SELECT')
     or has_column_privilege('authenticated', 'public.ordax_user_objects', 'created_by_user_id', 'SELECT') then
    raise exception 'User Cloud Storage v2: sanitized metadata read projection drifted';
  end if;
end;
$postflight$;

commit;
