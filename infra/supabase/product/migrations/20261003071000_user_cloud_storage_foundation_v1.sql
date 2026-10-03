begin;

create table public.ordax_user_objects (
  object_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.ordax_spaces(space_id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 255),
  media_type text not null check (char_length(media_type) between 1 and 160),
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('supabase-storage','cloudflare-r2','other')),
  provider_bucket text not null check (char_length(provider_bucket) between 1 and 160),
  provider_object_key text not null check (char_length(provider_object_key) between 8 and 512),
  server_revision bigint not null default 1 check (server_revision > 0),
  state text not null default 'active' check (state in ('active','deleted')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_bucket, provider_object_key)
);

create table private.ordax_user_upload_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  object_id uuid not null unique,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.ordax_spaces(space_id) on delete cascade,
  quota_key text not null default 'storage.user.bytes' check (quota_key = 'storage.user.bytes'),
  expected_size_bytes bigint not null check (expected_size_bytes >= 0),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null check (provider in ('supabase-storage','cloudflare-r2','other')),
  provider_bucket text not null check (char_length(provider_bucket) between 1 and 160),
  provider_object_key text not null check (char_length(provider_object_key) between 8 and 512),
  state text not null default 'reserved' check (state in ('reserved','consumed','cancelled','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  consumed_at timestamptz,
  unique (provider, provider_bucket, provider_object_key),
  check (expires_at > created_at),
  check ((state = 'consumed') = (consumed_at is not null))
);

create index ordax_user_objects_owner_state_idx
  on public.ordax_user_objects(owner_user_id, state, created_at);
create index ordax_user_objects_space_state_idx
  on public.ordax_user_objects(space_id, state, created_at)
  where space_id is not null;
create index ordax_user_upload_reservations_owner_state_idx
  on private.ordax_user_upload_reservations(owner_user_id, state, expires_at);

create trigger touch_ordax_user_objects_updated_at
before update on public.ordax_user_objects
for each row execute function private.ordax_touch_updated_at();

alter table public.ordax_user_objects enable row level security;

revoke all on table public.ordax_user_objects from public, anon, authenticated;
revoke all on table private.ordax_user_upload_reservations from public, anon, authenticated;

grant select on table public.ordax_user_objects to authenticated;

create policy ordax_user_objects_select_authorized
on public.ordax_user_objects for select to authenticated
using (
  owner_user_id = (select auth.uid())
  and (
    space_id is null
    or private.ordax_can_access_space(space_id)
  )
);

comment on table public.ordax_user_objects is
  'OrdaX canonical metadata for explicitly selected private cloud objects. Provider bytes are not authorization state.';
comment on table private.ordax_user_upload_reservations is
  'Server-only bounded upload reservations. Space/account authorization is checked by the server owner before reservation; clients receive only short-lived provider upload authorization after quota admission.';

commit;
