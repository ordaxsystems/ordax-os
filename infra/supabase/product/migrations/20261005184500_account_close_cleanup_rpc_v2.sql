-- Bounded server-only account-close cleanup RPCs v2.
-- Depends on 20261005183000_account_close_cleanup_foundation_v2.sql.
-- No worker, provider delete, identity delete or public close activation occurs here.

begin;

create function private.ordax_list_account_close_work_internal_v2(p_limit integer default 10)
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
    )::integer,
    count(j.cleanup_id) filter (where j.state <> 'deleted')::integer,
    (r.identity_frozen_at is not null and r.sessions_revoked_at is not null)
  from private.ordax_account_close_requests r
  left join private.ordax_account_close_cleanup_jobs j on j.close_id = r.close_id
  where r.state in ('cleanup-pending','cleanup-running','cleanup-verified','failed')
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

create function private.ordax_claim_account_close_cleanup_internal_v2(
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
  if p_close_id is null then
    raise exception 'account-close-id-required' using errcode = '22023';
  end if;
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
     and r.state in ('cleanup-pending','cleanup-running','failed');

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

create function private.ordax_finish_account_close_cleanup_internal_v2(
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
  if not p_deleted and v_error !~ '^[a-z][a-z0-9.-]{2,95}$' then
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

create function private.ordax_verify_account_close_cleanup_internal_v2(
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
  v_auth_ready boolean;
begin
  select (r.identity_frozen_at is not null and r.sessions_revoked_at is not null)
    into v_auth_ready
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
           when v_remaining = 0 and v_auth_ready then 'cleanup-verified'
           when v_terminal > 0 then 'failed'
           else r.state
         end,
         cleanup_verified_at = case
           when v_remaining = 0 and v_auth_ready
             then coalesce(r.cleanup_verified_at, statement_timestamp())
           else r.cleanup_verified_at
         end,
         last_error_code = case
           when v_terminal > 0 then 'cleanup-retry-budget-exhausted'
           else r.last_error_code
         end
   where r.close_id = p_close_id;

  return query select (v_remaining = 0 and v_auth_ready), v_remaining, v_terminal;
end;
$verify$;

-- Private helper ACL: executor only.
revoke all on function private.ordax_list_account_close_work_internal_v2(integer)
  from public, anon, authenticated, service_role, ordax_account_close_executor;
revoke all on function private.ordax_claim_account_close_cleanup_internal_v2(uuid, integer, integer)
  from public, anon, authenticated, service_role, ordax_account_close_executor;
revoke all on function private.ordax_finish_account_close_cleanup_internal_v2(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role, ordax_account_close_executor;
revoke all on function private.ordax_verify_account_close_cleanup_internal_v2(uuid, uuid)
  from public, anon, authenticated, service_role, ordax_account_close_executor;
grant execute on function private.ordax_list_account_close_work_internal_v2(integer)
  to ordax_account_close_executor;
grant execute on function private.ordax_claim_account_close_cleanup_internal_v2(uuid, integer, integer)
  to ordax_account_close_executor;
grant execute on function private.ordax_finish_account_close_cleanup_internal_v2(uuid, uuid, boolean, text)
  to ordax_account_close_executor;
grant execute on function private.ordax_verify_account_close_cleanup_internal_v2(uuid, uuid)
  to ordax_account_close_executor;

-- Public server-only wrappers. No authenticated/anon access.
grant create on schema public to ordax_account_close_executor;
create function public.ordax_list_account_close_work_v2(p_limit integer default 10)
returns table (
  close_id uuid,
  subject_user_id uuid,
  due_cleanup_count integer,
  remaining_cleanup_count integer,
  auth_fence_ready boolean
)
language sql security definer set search_path = ''
as $wrapper$
  select * from private.ordax_list_account_close_work_internal_v2(p_limit);
$wrapper$;
create function public.ordax_claim_account_close_cleanup_v2(
  p_close_id uuid, p_limit integer default 50, p_lease_seconds integer default 120
)
returns table (
  cleanup_id uuid, provider text, provider_bucket text, provider_object_key text,
  lease_token uuid, lease_expires_at timestamptz
)
language sql security definer set search_path = ''
as $wrapper$
  select * from private.ordax_claim_account_close_cleanup_internal_v2(p_close_id, p_limit, p_lease_seconds);
$wrapper$;
create function public.ordax_finish_account_close_cleanup_v2(
  p_cleanup_id uuid, p_lease_token uuid, p_deleted boolean, p_error_code text default null
)
returns boolean
language sql security definer set search_path = ''
as $wrapper$
  select private.ordax_finish_account_close_cleanup_internal_v2(
    p_cleanup_id, p_lease_token, p_deleted, p_error_code
  );
$wrapper$;
create function public.ordax_verify_account_close_cleanup_v2(
  p_close_id uuid, p_subject_user_id uuid
)
returns table (
  ready_for_identity_delete boolean,
  remaining_cleanup_count integer,
  terminal_failure_count integer
)
language sql security definer set search_path = ''
as $wrapper$
  select * from private.ordax_verify_account_close_cleanup_internal_v2(p_close_id, p_subject_user_id);
$wrapper$;

alter function public.ordax_list_account_close_work_v2(integer) owner to ordax_account_close_executor;
alter function public.ordax_claim_account_close_cleanup_v2(uuid, integer, integer) owner to ordax_account_close_executor;
alter function public.ordax_finish_account_close_cleanup_v2(uuid, uuid, boolean, text) owner to ordax_account_close_executor;
alter function public.ordax_verify_account_close_cleanup_v2(uuid, uuid) owner to ordax_account_close_executor;
revoke create on schema public from ordax_account_close_executor;

revoke all on function public.ordax_list_account_close_work_v2(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ordax_claim_account_close_cleanup_v2(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ordax_finish_account_close_cleanup_v2(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.ordax_verify_account_close_cleanup_v2(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_list_account_close_work_v2(integer) to service_role;
grant execute on function public.ordax_claim_account_close_cleanup_v2(uuid, integer, integer) to service_role;
grant execute on function public.ordax_finish_account_close_cleanup_v2(uuid, uuid, boolean, text) to service_role;
grant execute on function public.ordax_verify_account_close_cleanup_v2(uuid, uuid) to service_role;

comment on function public.ordax_claim_account_close_cleanup_v2(uuid, integer, integer) is
  'Server-only bounded lease claim. Returning provider coordinates does not confer provider authority; the worker must hold its own provider credential and remains rollout-disabled.';
comment on function public.ordax_verify_account_close_cleanup_v2(uuid, uuid) is
  'Server-only verification. It reports readiness only after all cleanup jobs are deleted and the auth fence is recorded; it never deletes identity.';

commit;
