-- Account-close asynchronous cleanup source foundation v2.
--
-- This migration deliberately does not activate the public close route or worker.
-- It establishes a durable private journal, a least-privilege executor boundary,
-- and a subject-bound RLS predicate that closes stale-JWT data-plane access.

begin;

create table private.ordax_account_close_requests (
  close_id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references auth.users(id) on delete restrict,
  state text not null default 'cleanup-pending'
    check (state in ('cleanup-pending','cleanup-running','cleanup-verified','failed','closed')),
  identity_frozen_at timestamptz,
  sessions_revoked_at timestamptz,
  cleanup_verified_at timestamptz,
  identity_deleted_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z][a-z0-9.-]{2,95}$'
  ),
  requested_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (state <> 'cleanup-verified' or cleanup_verified_at is not null),
  check (state <> 'closed' or identity_deleted_at is not null)
);

create unique index ordax_account_close_one_active_subject_idx
  on private.ordax_account_close_requests(subject_user_id)
  where state <> 'closed';

create table private.ordax_account_close_cleanup_jobs (
  cleanup_id uuid primary key default gen_random_uuid(),
  close_id uuid not null references private.ordax_account_close_requests(close_id) on delete restrict,
  object_id uuid references public.ordax_user_objects(object_id) on delete restrict,
  source_kind text not null check (source_kind in ('user-object','upload-reservation','object-and-reservation')),
  provider text not null check (provider in ('supabase-storage','cloudflare-r2','other')),
  provider_bucket text not null check (char_length(provider_bucket) between 1 and 160),
  provider_object_key text not null check (
    char_length(provider_object_key) between 8 and 512
    and provider_object_key !~ '^[\\/]'
    and provider_object_key !~ '(^|[\\/])\\.\\.?(?:[\\/]|$)'
    and provider_object_key !~ '[\\/]{2}'
  ),
  state text not null default 'pending' check (state in ('pending','leased','deleted','failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  not_before timestamptz not null default timezone('utc', now()),
  lease_token uuid,
  lease_expires_at timestamptz,
  deleted_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z][a-z0-9.-]{2,95}$'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (close_id, provider, provider_bucket, provider_object_key),
  check (
    (state = 'leased' and lease_token is not null and lease_expires_at is not null)
    or (state <> 'leased' and lease_token is null and lease_expires_at is null)
  ),
  check ((state = 'deleted') = (deleted_at is not null))
);

create index ordax_account_close_cleanup_claim_idx
  on private.ordax_account_close_cleanup_jobs(close_id, state, not_before, created_at);

alter table private.ordax_account_close_requests enable row level security;
alter table private.ordax_account_close_cleanup_jobs enable row level security;
revoke all on table private.ordax_account_close_requests from public, anon, authenticated, service_role;
revoke all on table private.ordax_account_close_cleanup_jobs from public, anon, authenticated, service_role;

create trigger touch_ordax_account_close_requests_updated_at
before update on private.ordax_account_close_requests
for each row execute function private.ordax_touch_updated_at();
create trigger touch_ordax_account_close_cleanup_jobs_updated_at
before update on private.ordax_account_close_cleanup_jobs
for each row execute function private.ordax_touch_updated_at();

-- The RLS-facing predicate belongs to the deliberately narrow ordax_policy
-- schema, never to private. It is subject-bound and accepts no caller-supplied ID.
create function ordax_policy.account_is_closing()
returns boolean
language sql
stable
security definer
set search_path = ''
as $predicate$
  select coalesce(
    exists (
      select 1
      from private.ordax_account_close_requests r
      where r.subject_user_id = (select auth.uid())
        and r.state <> 'closed'
    ),
    false
  );
$predicate$;
revoke all on function ordax_policy.account_is_closing()
  from public, anon, authenticated, service_role;
grant execute on function ordax_policy.account_is_closing() to authenticated;

-- Existing unexpired access JWTs must not keep reading/writing the OrdaX data
-- plane once a durable close request exists. These policies are RESTRICTIVE so
-- ordinary owner/member policies cannot override the lifecycle fence.
create policy ordax_accounts_deny_closing_subject
on public.ordax_accounts as restrictive for all to authenticated
using (not ordax_policy.account_is_closing())
with check (not ordax_policy.account_is_closing());
create policy ordax_spaces_deny_closing_subject
on public.ordax_spaces as restrictive for all to authenticated
using (not ordax_policy.account_is_closing())
with check (not ordax_policy.account_is_closing());
create policy ordax_space_members_deny_closing_subject
on public.ordax_space_members as restrictive for all to authenticated
using (not ordax_policy.account_is_closing())
with check (not ordax_policy.account_is_closing());
create policy ordax_entitlements_deny_closing_subject
on public.ordax_entitlement_grants as restrictive for all to authenticated
using (not ordax_policy.account_is_closing())
with check (not ordax_policy.account_is_closing());
create policy ordax_memory_items_deny_closing_subject
on public.ordax_memory_items as restrictive for all to authenticated
using (not ordax_policy.account_is_closing())
with check (not ordax_policy.account_is_closing());
create policy ordax_memory_embeddings_deny_closing_subject
on public.ordax_memory_embeddings as restrictive for all to authenticated
using (not ordax_policy.account_is_closing())
with check (not ordax_policy.account_is_closing());
create policy ordax_project_connections_deny_closing_subject
on public.ordax_project_connections as restrictive for all to authenticated
using (not ordax_policy.account_is_closing())
with check (not ordax_policy.account_is_closing());
create policy ordax_user_objects_deny_closing_subject
on public.ordax_user_objects as restrictive for all to authenticated
using (not ordax_policy.account_is_closing())
with check (not ordax_policy.account_is_closing());

-- A closing account may not implicitly delete an owned shared Space. Ownership
-- transfer/removal must be resolved explicitly before the close journal begins.
create function private.ordax_account_close_guard_shared_space_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $guard$
begin
  if exists (
    select 1
    from public.ordax_spaces s
    join public.ordax_space_members m on m.space_id = s.space_id
    where s.owner_user_id = new.subject_user_id
      and m.user_id <> new.subject_user_id
      and m.state = 'active'
  ) then
    raise exception 'account-close-owned-shared-space-requires-transfer' using errcode = '55000';
  end if;
  return new;
end;
$guard$;
revoke all on function private.ordax_account_close_guard_shared_space_v2()
  from public, anon, authenticated, service_role;
create trigger ordax_account_close_reject_owned_shared_space
before insert on private.ordax_account_close_requests
for each row execute function private.ordax_account_close_guard_shared_space_v2();

-- Dedicated executor: no login, no bypass-RLS, no table authority. Server-facing
-- wrappers will be owned by this role and may call only the allowlisted private
-- helpers created below.
do $executor$
declare
  r record;
begin
  select rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin,
         rolreplication, rolbypassrls
    into r from pg_roles where rolname = 'ordax_account_close_executor';
  if not found then
    create role ordax_account_close_executor
      nosuperuser nocreatedb nocreaterole noinherit nologin noreplication nobypassrls;
  elsif r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit
     or r.rolcanlogin or r.rolreplication or r.rolbypassrls then
    raise exception 'ordax_account_close_executor violates least-privilege role contract';
  end if;
end;
$executor$;
grant ordax_account_close_executor to postgres;
revoke all on schema private, public from ordax_account_close_executor;
grant usage on schema private, public to ordax_account_close_executor;

create function private.ordax_begin_account_close_internal_v2(p_subject_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $begin_close$
declare
  v_close_id uuid;
begin
  if p_subject_user_id is null then
    raise exception 'account-close-subject-required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_subject_user_id::text, 0));
  select r.close_id into v_close_id
    from private.ordax_account_close_requests r
   where r.subject_user_id = p_subject_user_id and r.state <> 'closed'
   for update;
  if found then return v_close_id; end if;
  if not exists (select 1 from auth.users u where u.id = p_subject_user_id) then
    raise exception 'account-close-subject-not-found' using errcode = '22023';
  end if;
  insert into private.ordax_account_close_requests(subject_user_id)
    values (p_subject_user_id) returning close_id into v_close_id;

  insert into private.ordax_account_close_cleanup_jobs(
    close_id, object_id, source_kind, provider, provider_bucket, provider_object_key
  )
  select v_close_id, o.object_id, 'user-object', p.provider, p.provider_bucket, p.provider_object_key
    from public.ordax_user_objects o
    join private.ordax_user_object_provider_refs p on p.object_id = o.object_id
   where o.owner_user_id = p_subject_user_id
  on conflict (close_id, provider, provider_bucket, provider_object_key) do nothing;

  insert into private.ordax_account_close_cleanup_jobs(
    close_id, object_id, source_kind, provider, provider_bucket, provider_object_key, not_before
  )
  select v_close_id, r.object_id, 'upload-reservation', r.provider, r.provider_bucket,
         r.provider_object_key, greatest(r.expires_at + interval '30 seconds', statement_timestamp())
    from private.ordax_user_upload_reservations r
   where r.owner_user_id = p_subject_user_id
  on conflict (close_id, provider, provider_bucket, provider_object_key) do update
    set source_kind = 'object-and-reservation',
        not_before = greatest(private.ordax_account_close_cleanup_jobs.not_before, excluded.not_before);
  return v_close_id;
end;
$begin_close$;

create function private.ordax_record_account_close_auth_fence_internal_v2(
  p_close_id uuid, p_subject_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fence$
begin
  update private.ordax_account_close_requests r
     set identity_frozen_at = coalesce(r.identity_frozen_at, statement_timestamp()),
         sessions_revoked_at = coalesce(r.sessions_revoked_at, statement_timestamp())
   where r.close_id = p_close_id
     and r.subject_user_id = p_subject_user_id
     and r.state <> 'closed';
  return found;
end;
$fence$;

revoke all on function private.ordax_begin_account_close_internal_v2(uuid)
  from public, anon, authenticated, service_role, ordax_account_close_executor;
revoke all on function private.ordax_record_account_close_auth_fence_internal_v2(uuid, uuid)
  from public, anon, authenticated, service_role, ordax_account_close_executor;
grant execute on function private.ordax_begin_account_close_internal_v2(uuid)
  to ordax_account_close_executor;
grant execute on function private.ordax_record_account_close_auth_fence_internal_v2(uuid, uuid)
  to ordax_account_close_executor;

-- Server-only audited wrappers. service_role reaches only these wrappers; it has
-- no direct table/private-helper grant. The route remains disabled in source.
grant create on schema public to ordax_account_close_executor;
create function public.ordax_begin_account_close_v2(p_subject_user_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $wrapper$
  select private.ordax_begin_account_close_internal_v2(p_subject_user_id);
$wrapper$;
create function public.ordax_record_account_close_auth_fence_v2(
  p_close_id uuid, p_subject_user_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $wrapper$
  select private.ordax_record_account_close_auth_fence_internal_v2(p_close_id, p_subject_user_id);
$wrapper$;
alter function public.ordax_begin_account_close_v2(uuid) owner to ordax_account_close_executor;
alter function public.ordax_record_account_close_auth_fence_v2(uuid, uuid) owner to ordax_account_close_executor;
revoke create on schema public from ordax_account_close_executor;
revoke all on function public.ordax_begin_account_close_v2(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ordax_record_account_close_auth_fence_v2(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_begin_account_close_v2(uuid) to service_role;
grant execute on function public.ordax_record_account_close_auth_fence_v2(uuid, uuid) to service_role;

-- Defense in depth: the executor must own no relation and API roles must not
-- execute its private helpers.
do $postflight$
declare
  relation_count integer;
  api_private_exec_count integer;
begin
  select count(*) into relation_count
    from pg_class c join pg_roles r on r.oid = c.relowner
   where r.rolname = 'ordax_account_close_executor'
     and c.relkind in ('r','p','v','m','S','f');
  if relation_count <> 0 then
    raise exception 'account-close executor owns relation';
  end if;

  select count(*) into api_private_exec_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in (
       'ordax_begin_account_close_internal_v2',
       'ordax_record_account_close_auth_fence_internal_v2'
     )
     and (
       has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('service_role', p.oid, 'EXECUTE')
     );
  if api_private_exec_count <> 0 then
    raise exception 'API role can execute private account-close helper';
  end if;
end;
$postflight$;

comment on function ordax_policy.account_is_closing() is
  'Subject-bound RLS lifecycle fence. A closing subject loses client data-plane access even if an access JWT remains cryptographically valid.';
comment on table private.ordax_account_close_cleanup_jobs is
  'Provider cleanup journal. No API role receives direct relation authority.';

commit;
