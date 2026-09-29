-- Operator-only temporary entitlement for the authenticated two-client cloud Memory proof.
-- This migration creates authority; it does NOT issue a grant.
-- The functions are intentionally unreachable by public/anon/authenticated/service_role.
-- Audit UUIDs are evidence only: no FK may let proof history block account/grant deletion.

begin;

create table private.ordax_cloud_memory_proof_entitlement_events (
  event_id uuid primary key default gen_random_uuid(),
  grant_id uuid not null,
  user_id uuid not null,
  action text not null check (action in ('issued', 'revoked')),
  valid_until timestamptz not null,
  reason text not null check (char_length(reason) between 8 and 240),
  source_commit text not null check (source_commit ~ '^[0-9a-f]{40}$'),
  created_at timestamptz not null default timezone('utc', now())
);

revoke all on table private.ordax_cloud_memory_proof_entitlement_events
from public, anon, authenticated, service_role;

create function private.ordax_issue_cloud_memory_proof_entitlement_v1(
  p_user_id uuid,
  p_ttl_seconds integer,
  p_reason text,
  p_source_commit text
)
returns table (
  grant_id uuid,
  valid_until timestamptz,
  audit_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_until timestamptz;
  v_grant_id uuid;
  v_audit_id uuid;
  v_reason text := btrim(p_reason);
begin
  if p_user_id is null then
    raise exception 'cloud-memory-proof-user-required' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 300 or p_ttl_seconds > 1800 then
    raise exception 'cloud-memory-proof-ttl-out-of-range' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 8 or char_length(v_reason) > 240 then
    raise exception 'cloud-memory-proof-reason-invalid' using errcode = '22023';
  end if;
  if p_source_commit is null or p_source_commit !~ '^[0-9a-f]{40}$' then
    raise exception 'cloud-memory-proof-source-commit-invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = p_user_id
  ) then
    raise exception 'cloud-memory-proof-user-not-found' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.ordax_entitlement_grants e
    where e.user_id = p_user_id
      and e.space_id is null
      and e.entitlement_key = 'memory.cloud.enabled'
      and e.entitlement_value ->> 'decision' = 'allowed'
      and e.valid_from <= v_now
      and (e.valid_until is null or e.valid_until > v_now)
  ) then
    raise exception 'cloud-memory-proof-entitlement-already-active' using errcode = '23505';
  end if;

  v_until := v_now + make_interval(secs => p_ttl_seconds);

  insert into public.ordax_entitlement_grants (
    user_id,
    space_id,
    entitlement_key,
    entitlement_value,
    source,
    valid_from,
    valid_until
  ) values (
    p_user_id,
    null,
    'memory.cloud.enabled',
    jsonb_build_object(
      'decision', 'allowed',
      'purpose', 'cloud-memory-two-client-proof',
      'temporary', true,
      'source_commit', p_source_commit
    ),
    'admin',
    v_now,
    v_until
  )
  returning ordax_entitlement_grants.grant_id into v_grant_id;

  insert into private.ordax_cloud_memory_proof_entitlement_events (
    grant_id,
    user_id,
    action,
    valid_until,
    reason,
    source_commit
  ) values (
    v_grant_id,
    p_user_id,
    'issued',
    v_until,
    v_reason,
    p_source_commit
  )
  returning event_id into v_audit_id;

  return query select v_grant_id, v_until, v_audit_id;
end;
$$;

create function private.ordax_revoke_cloud_memory_proof_entitlement_v1(
  p_grant_id uuid,
  p_reason text,
  p_source_commit text
)
returns table (
  grant_id uuid,
  audit_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_user_id uuid;
  v_valid_from timestamptz;
  v_valid_until timestamptz;
  v_audit_id uuid;
  v_reason text := btrim(p_reason);
begin
  if p_grant_id is null then
    raise exception 'cloud-memory-proof-grant-required' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 8 or char_length(v_reason) > 240 then
    raise exception 'cloud-memory-proof-reason-invalid' using errcode = '22023';
  end if;
  if p_source_commit is null or p_source_commit !~ '^[0-9a-f]{40}$' then
    raise exception 'cloud-memory-proof-source-commit-invalid' using errcode = '22023';
  end if;

  select e.user_id, e.valid_from, e.valid_until
  into v_user_id, v_valid_from, v_valid_until
  from public.ordax_entitlement_grants e
  where e.grant_id = p_grant_id
    and e.space_id is null
    and e.entitlement_key = 'memory.cloud.enabled'
    and e.source = 'admin'
    and e.entitlement_value ->> 'purpose' = 'cloud-memory-two-client-proof'
    and e.entitlement_value ->> 'temporary' = 'true'
  for update;

  if not found then
    raise exception 'cloud-memory-proof-grant-not-found' using errcode = '22023';
  end if;

  update public.ordax_entitlement_grants e
  set entitlement_value = jsonb_build_object(
        'decision', 'denied',
        'purpose', 'cloud-memory-two-client-proof',
        'temporary', true,
        'source_commit', p_source_commit,
        'revoked', true
      ),
      valid_until = greatest(v_valid_from + interval '1 microsecond', v_now)
  where e.grant_id = p_grant_id
  returning e.valid_until into v_valid_until;

  insert into private.ordax_cloud_memory_proof_entitlement_events (
    grant_id,
    user_id,
    action,
    valid_until,
    reason,
    source_commit
  ) values (
    p_grant_id,
    v_user_id,
    'revoked',
    v_valid_until,
    v_reason,
    p_source_commit
  )
  returning event_id into v_audit_id;

  return query select p_grant_id, v_audit_id;
end;
$$;

revoke all on function private.ordax_issue_cloud_memory_proof_entitlement_v1(uuid, integer, text, text)
from public, anon, authenticated, service_role;
revoke all on function private.ordax_revoke_cloud_memory_proof_entitlement_v1(uuid, text, text)
from public, anon, authenticated, service_role;

commit;
