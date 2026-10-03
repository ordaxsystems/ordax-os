begin;

create table private.ordax_account_close_requests (
  close_id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null,
  state text not null default 'cleanup-pending'
    check (state in ('cleanup-pending','cleanup-running','cleanup-verified','failed','closed')),
  queued_cleanup_count integer not null default 0 check (queued_cleanup_count >= 0),
  requested_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  cleanup_verified_at timestamptz,
  identity_deleted_at timestamptz,
  last_error_code text check (
    last_error_code is null
    or last_error_code ~ '^[a-z][a-z0-9.-]{2,95}$'
  ),
  check (state <> 'cleanup-verified' or cleanup_verified_at is not null),
  check (state <> 'closed' or identity_deleted_at is not null)
);

create unique index ordax_account_close_one_active_subject_idx
  on private.ordax_account_close_requests(subject_user_id)
  where state <> 'closed';

create table private.ordax_account_close_cleanup_jobs (
  cleanup_id uuid primary key default gen_random_uuid(),
  close_id uuid not null
    references private.ordax_account_close_requests(close_id)
    on delete restrict,
  source_kind text not null
    check (source_kind in ('user-object','upload-reservation','object-and-reservation')),
  provider text not null check (provider in ('supabase-storage','cloudflare-r2','other')),
  provider_bucket text not null check (char_length(provider_bucket) between 1 and 160),
  provider_object_key text not null check (char_length(provider_object_key) between 8 and 512),
  state text not null default 'pending'
    check (state in ('pending','leased','deleted','failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  not_before timestamptz not null default timezone('utc', now()),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text check (
    last_error_code is null
    or last_error_code ~ '^[a-z][a-z0-9.-]{2,95}$'
  ),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
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

revoke all on table private.ordax_account_close_requests
  from public, anon, authenticated, service_role;
revoke all on table private.ordax_account_close_cleanup_jobs
  from public, anon, authenticated, service_role;

create trigger touch_ordax_account_close_requests_updated_at
before update on private.ordax_account_close_requests
for each row execute function private.ordax_touch_updated_at();

create trigger touch_ordax_account_close_cleanup_jobs_updated_at
before update on private.ordax_account_close_cleanup_jobs
for each row execute function private.ordax_touch_updated_at();

create or replace function private.ordax_account_close_blocks_cloud_writes_v1(
  p_subject_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $write_gate$
  select exists (
    select 1
    from private.ordax_account_close_requests r
    where r.subject_user_id = p_subject_user_id
      and r.state <> 'closed'
  );
$write_gate$;

revoke all on function private.ordax_account_close_blocks_cloud_writes_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.ordax_reject_cloud_write_during_account_close_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $write_gate$
declare
  v_subject uuid := coalesce(new.owner_user_id, old.owner_user_id);
begin
  if private.ordax_account_close_blocks_cloud_writes_v1(v_subject) then
    raise exception 'account-close-cloud-writes-frozen' using errcode = '55000';
  end if;
  return new;
end;
$write_gate$;

revoke all on function private.ordax_reject_cloud_write_during_account_close_v1()
  from public, anon, authenticated, service_role;

create trigger ordax_user_objects_close_write_freeze
before insert or update on public.ordax_user_objects
for each row execute function private.ordax_reject_cloud_write_during_account_close_v1();

create trigger ordax_user_upload_reservations_close_write_freeze
before insert or update on private.ordax_user_upload_reservations
for each row execute function private.ordax_reject_cloud_write_during_account_close_v1();

create trigger ordax_memory_items_close_write_freeze
before insert or update on public.ordax_memory_items
for each row execute function private.ordax_reject_cloud_write_during_account_close_v1();

create trigger ordax_sync_objects_close_write_freeze
before insert or update on private.ordax_sync_objects
for each row execute function private.ordax_reject_cloud_write_during_account_close_v1();

create trigger ordax_sync_mutations_close_write_freeze
before insert or update on private.ordax_sync_mutations
for each row execute function private.ordax_reject_cloud_write_during_account_close_v1();

create or replace function public.ordax_begin_account_close_v1(
  p_subject_user_id uuid
)
returns table (
  close_id uuid,
  state text,
  queued_cleanup_count integer
)
language plpgsql
security definer
set search_path = ''
as $close$
declare
  v_close private.ordax_account_close_requests%rowtype;
  v_count integer;
begin
  if p_subject_user_id is null then
    raise exception 'account-close-subject-required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_subject_user_id::text, 0)
  );

  select r.* into v_close
  from private.ordax_account_close_requests r
  where r.subject_user_id = p_subject_user_id
    and r.state <> 'closed'
  for update;

  if not found then
    if not exists (select 1 from auth.users u where u.id = p_subject_user_id) then
      raise exception 'account-close-subject-not-found' using errcode = '22023';
    end if;

    insert into private.ordax_account_close_requests(subject_user_id)
    values (p_subject_user_id)
    returning * into v_close;

    insert into private.ordax_account_close_cleanup_jobs(
      close_id, source_kind, provider, provider_bucket, provider_object_key, not_before
    )
    select
      v_close.close_id,
      'user-object',
      o.provider,
      o.provider_bucket,
      o.provider_object_key,
      statement_timestamp()
    from public.ordax_user_objects o
    where o.owner_user_id = p_subject_user_id
    on conflict (close_id, provider, provider_bucket, provider_object_key) do nothing;

    insert into private.ordax_account_close_cleanup_jobs(
      close_id, source_kind, provider, provider_bucket, provider_object_key, not_before
    )
    select
      v_close.close_id,
      'upload-reservation',
      r.provider,
      r.provider_bucket,
      r.provider_object_key,
      greatest(r.expires_at + interval '30 seconds', statement_timestamp())
    from private.ordax_user_upload_reservations r
    where r.owner_user_id = p_subject_user_id
    on conflict (close_id, provider, provider_bucket, provider_object_key) do update
      set source_kind = 'object-and-reservation',
          not_before = greatest(
            private.ordax_account_close_cleanup_jobs.not_before,
            excluded.not_before
          );

    select count(*)::integer into v_count
    from private.ordax_account_close_cleanup_jobs j
    where j.close_id = v_close.close_id;

    update private.ordax_account_close_requests r
    set queued_cleanup_count = v_count,
        state = case when v_count = 0 then 'cleanup-verified' else 'cleanup-pending' end,
        cleanup_verified_at = case when v_count = 0 then statement_timestamp() else null end
    where r.close_id = v_close.close_id
    returning * into v_close;
  end if;

  return query select v_close.close_id, v_close.state, v_close.queued_cleanup_count;
end;
$close$;

revoke all on function public.ordax_begin_account_close_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.ordax_begin_account_close_v1(uuid)
  to service_role;

create or replace function public.ordax_claim_account_close_cleanup_v1(
  p_close_id uuid,
  p_limit integer default 50,
  p_lease_seconds integer default 120
)
returns table (
  cleanup_id uuid,
  provider text,
  provider_bucket text,
  provider_object_key text,
  lease_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $claim$
declare
  v_token uuid := gen_random_uuid();
  v_expiry timestamptz;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'account-close-cleanup-limit-invalid' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 600 then
    raise exception 'account-close-cleanup-lease-invalid' using errcode = '22023';
  end if;
  v_expiry := statement_timestamp() + make_interval(secs => p_lease_seconds);

  update private.ordax_account_close_cleanup_jobs j
  set state = 'pending', lease_token = null, lease_expires_at = null
  where j.close_id = p_close_id
    and j.state = 'leased'
    and j.lease_expires_at <= statement_timestamp();

  update private.ordax_account_close_requests r
  set state = 'cleanup-running'
  where r.close_id = p_close_id
    and r.state in ('cleanup-pending','cleanup-running');

  return query
  with candidates as (
    select j.cleanup_id
    from private.ordax_account_close_cleanup_jobs j
    where j.close_id = p_close_id
      and j.state in ('pending','failed')
      and j.attempts < 10
      and j.not_before <= statement_timestamp()
    order by j.not_before, j.created_at, j.cleanup_id
    for update skip locked
    limit p_limit
  )
  update private.ordax_account_close_cleanup_jobs j
  set state = 'leased',
      attempts = j.attempts + 1,
      lease_token = v_token,
      lease_expires_at = v_expiry,
      last_error_code = null
  from candidates c
  where j.cleanup_id = c.cleanup_id
  returning j.cleanup_id, j.provider, j.provider_bucket, j.provider_object_key,
    j.lease_token, j.lease_expires_at;
end;
$claim$;

revoke all on function public.ordax_claim_account_close_cleanup_v1(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ordax_claim_account_close_cleanup_v1(uuid, integer, integer)
  to service_role;

create or replace function public.ordax_finish_account_close_cleanup_v1(
  p_cleanup_id uuid,
  p_lease_token uuid,
  p_deleted boolean,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $finish$
declare
  v_error text := lower(btrim(coalesce(p_error_code, 'provider-delete-failed')));
begin
  if p_cleanup_id is null or p_lease_token is null or p_deleted is null then
    raise exception 'account-close-cleanup-result-invalid' using errcode = '22023';
  end if;
  if p_deleted is false and v_error !~ '^[a-z][a-z0-9.-]{2,95}$' then
    raise exception 'account-close-cleanup-error-code-invalid' using errcode = '22023';
  end if;

  update private.ordax_account_close_cleanup_jobs j
  set state = case when p_deleted then 'deleted' else 'failed' end,
      deleted_at = case when p_deleted then statement_timestamp() else null end,
      last_error_code = case when p_deleted then null else v_error end,
      lease_token = null,
      lease_expires_at = null
  where j.cleanup_id = p_cleanup_id
    and j.state = 'leased'
    and j.lease_token = p_lease_token
    and j.lease_expires_at > statement_timestamp();

  return found;
end;
$finish$;

revoke all on function public.ordax_finish_account_close_cleanup_v1(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.ordax_finish_account_close_cleanup_v1(uuid, uuid, boolean, text)
  to service_role;

create or replace function public.ordax_verify_account_close_cleanup_v1(
  p_close_id uuid,
  p_subject_user_id uuid
)
returns table (
  ready_for_identity_delete boolean,
  remaining_cleanup_count integer,
  terminal_failure_count integer
)
language plpgsql
security definer
set search_path = ''
as $verify$
declare
  v_remaining integer;
  v_terminal integer;
begin
  if not exists (
    select 1
    from private.ordax_account_close_requests r
    where r.close_id = p_close_id
      and r.subject_user_id = p_subject_user_id
      and r.state <> 'closed'
  ) then
    raise exception 'account-close-request-not-found' using errcode = '22023';
  end if;

  select
    count(*) filter (where j.state <> 'deleted')::integer,
    count(*) filter (where j.state = 'failed' and j.attempts >= 10)::integer
  into v_remaining, v_terminal
  from private.ordax_account_close_cleanup_jobs j
  where j.close_id = p_close_id;

  update private.ordax_account_close_requests r
  set state = case
        when v_remaining = 0 then 'cleanup-verified'
        when v_terminal > 0 then 'failed'
        else r.state
      end,
      cleanup_verified_at = case when v_remaining = 0 then statement_timestamp() else r.cleanup_verified_at end,
      last_error_code = case when v_terminal > 0 then 'cleanup-retry-budget-exhausted' else r.last_error_code end
  where r.close_id = p_close_id;

  return query select (v_remaining = 0), v_remaining, v_terminal;
end;
$verify$;

revoke all on function public.ordax_verify_account_close_cleanup_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ordax_verify_account_close_cleanup_v1(uuid, uuid)
  to service_role;

create or replace function public.ordax_mark_account_closed_v1(
  p_close_id uuid,
  p_subject_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $closed$
begin
  if exists (select 1 from auth.users u where u.id = p_subject_user_id) then
    raise exception 'account-close-identity-still-present' using errcode = '55000';
  end if;
  if exists (
    select 1
    from private.ordax_account_close_cleanup_jobs j
    where j.close_id = p_close_id
      and j.state <> 'deleted'
  ) then
    raise exception 'account-close-cleanup-incomplete' using errcode = '55000';
  end if;

  update private.ordax_account_close_requests r
  set state = 'closed',
      identity_deleted_at = statement_timestamp(),
      last_error_code = null
  where r.close_id = p_close_id
    and r.subject_user_id = p_subject_user_id
    and r.state = 'cleanup-verified';

  return found;
end;
$closed$;

revoke all on function public.ordax_mark_account_closed_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ordax_mark_account_closed_v1(uuid, uuid)
  to service_role;

comment on table private.ordax_account_close_requests is
  'Durable account-close journal. It deliberately has no FK to auth.users so cleanup evidence survives identity deletion.';
comment on table private.ordax_account_close_cleanup_jobs is
  'Durable external-object deletion queue. Provider references are copied before auth deletion and remain server-only until verified deletion.';

commit;
