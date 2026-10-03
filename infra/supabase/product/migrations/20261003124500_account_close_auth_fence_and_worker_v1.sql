begin;

alter table private.ordax_account_close_requests
  add column identity_frozen_at timestamptz,
  add column sessions_revoked_at timestamptz;

create or replace function public.ordax_record_account_close_auth_fence_v1(
  p_close_id uuid,
  p_subject_user_id uuid,
  p_identity_frozen boolean,
  p_sessions_revoked boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fence$
begin
  if p_identity_frozen is distinct from true
     or p_sessions_revoked is distinct from true then
    raise exception 'account-close-auth-fence-incomplete' using errcode = '22023';
  end if;

  update private.ordax_account_close_requests r
  set identity_frozen_at = coalesce(r.identity_frozen_at, statement_timestamp()),
      sessions_revoked_at = coalesce(r.sessions_revoked_at, statement_timestamp())
  where r.close_id = p_close_id
    and r.subject_user_id = p_subject_user_id
    and r.state <> 'closed';

  return found;
end;
$fence$;

revoke all on function public.ordax_record_account_close_auth_fence_v1(uuid, uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.ordax_record_account_close_auth_fence_v1(uuid, uuid, boolean, boolean)
  to service_role;

create or replace function public.ordax_list_account_close_work_v1(
  p_limit integer default 10
)
returns table (
  close_id uuid,
  subject_user_id uuid,
  due_cleanup_count integer,
  remaining_cleanup_count integer,
  auth_fence_ready boolean
)
language plpgsql
security definer
set search_path = ''
as $work$
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'account-close-work-limit-invalid' using errcode = '22023';
  end if;

  return query
  select
    r.close_id,
    r.subject_user_id,
    count(j.cleanup_id) filter (
      where (
        (j.state in ('pending','failed') and j.attempts < 10 and j.not_before <= statement_timestamp())
        or (j.state = 'leased' and j.lease_expires_at <= statement_timestamp())
      )
    )::integer as due_cleanup_count,
    count(j.cleanup_id) filter (where j.state <> 'deleted')::integer as remaining_cleanup_count,
    (r.identity_frozen_at is not null and r.sessions_revoked_at is not null) as auth_fence_ready
  from private.ordax_account_close_requests r
  left join private.ordax_account_close_cleanup_jobs j
    on j.close_id = r.close_id
  where r.state in ('cleanup-pending','cleanup-running','cleanup-verified')
  group by r.close_id, r.subject_user_id, r.requested_at,
    r.identity_frozen_at, r.sessions_revoked_at
  having
    count(j.cleanup_id) filter (
      where (
        (j.state in ('pending','failed') and j.attempts < 10 and j.not_before <= statement_timestamp())
        or (j.state = 'leased' and j.lease_expires_at <= statement_timestamp())
      )
    ) > 0
    or (
      count(j.cleanup_id) filter (where j.state <> 'deleted') = 0
      and r.identity_frozen_at is not null
      and r.sessions_revoked_at is not null
    )
  order by r.requested_at, r.close_id
  limit p_limit;
end;
$work$;

revoke all on function public.ordax_list_account_close_work_v1(integer)
  from public, anon, authenticated;
grant execute on function public.ordax_list_account_close_work_v1(integer)
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
  v_auth_fence_ready boolean;
begin
  select
    (r.identity_frozen_at is not null and r.sessions_revoked_at is not null)
  into v_auth_fence_ready
  from private.ordax_account_close_requests r
  where r.close_id = p_close_id
    and r.subject_user_id = p_subject_user_id
    and r.state <> 'closed'
  for update;

  if not found then
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
      cleanup_verified_at = case when v_remaining = 0 then coalesce(r.cleanup_verified_at, statement_timestamp()) else r.cleanup_verified_at end,
      last_error_code = case when v_terminal > 0 then 'cleanup-retry-budget-exhausted' else r.last_error_code end
  where r.close_id = p_close_id;

  return query select (v_remaining = 0 and v_auth_fence_ready), v_remaining, v_terminal;
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
    and r.state = 'cleanup-verified'
    and r.identity_frozen_at is not null
    and r.sessions_revoked_at is not null;

  return found;
end;
$closed$;

revoke all on function public.ordax_mark_account_closed_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ordax_mark_account_closed_v1(uuid, uuid)
  to service_role;

comment on function public.ordax_record_account_close_auth_fence_v1(uuid, uuid, boolean, boolean) is
  'Server-only proof that account sign-in was frozen and extant sessions were revoked before asynchronous cleanup may delete identity.';
comment on function public.ordax_list_account_close_work_v1(integer) is
  'Server-only bounded work discovery for the account cleanup worker. Returns no provider object keys; per-object references remain behind the leased cleanup RPC.';

commit;
