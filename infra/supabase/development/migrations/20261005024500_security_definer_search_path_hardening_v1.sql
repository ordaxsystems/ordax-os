-- P0 hardening: remove attacker-influenced schemas from legacy privileged RPCs.
-- These RPCs are service-role-only, but SECURITY DEFINER must not depend on
-- public or implicit pg_temp name resolution. Keep every persistent relation
-- schema-qualified and qualify the one temporary relation explicitly.

alter function public.ordax_finalize_artifact_upload(uuid, uuid, uuid, uuid)
  set search_path = '';

alter function public.ordax_heartbeat_lease(uuid, uuid, uuid, integer)
  set search_path = '';

alter function public.ordax_report_command(
  uuid, uuid, uuid, text, integer, text, text, jsonb, jsonb, text, uuid
)
  set search_path = '';

create or replace function public.ordax_reconcile_orphan_commands(
  p_device_id uuid default null
)
returns table(requeued_count integer, failed_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  read_only_operations constant text[] := array[
    'ordax.status',
    'ordax.health',
    'ordax.logs.query',
    'ordax.service.status',
    'ordax.workspace.file.read',
    'ordax.workspace.search',
    'ordax.surface.status',
    'ordax.surface.screenshot'
  ];
begin
  drop table if exists pg_temp.ordax_orphans_current;

  create temp table pg_temp.ordax_orphans_current(
    device_id uuid,
    command_id uuid,
    lease_id uuid,
    operation text,
    started_at timestamptz,
    is_read_only boolean
  ) on commit drop;

  insert into pg_temp.ordax_orphans_current(
    device_id,
    command_id,
    lease_id,
    operation,
    started_at,
    is_read_only
  )
  select
    c.device_id,
    c.command_id,
    c.lease_id,
    c.operation,
    c.started_at,
    c.operation = any(read_only_operations)
  from public.ordax_dev_commands c
  where c.status = 'running'
    and (p_device_id is null or c.device_id = p_device_id)
    and not exists (
      select 1
      from public.ordax_dev_leases l
      where l.device_id = c.device_id
        and l.command_id = c.command_id
        and l.lease_id = c.lease_id
        and l.expires_at > now()
    )
  for update of c skip locked;

  delete from public.ordax_dev_leases l
  using pg_temp.ordax_orphans_current o
  where l.device_id = o.device_id
    and l.command_id = o.command_id;

  update public.ordax_dev_commands c
  set status = 'queued',
      claimed_at = null,
      started_at = null,
      completed_at = null,
      lease_id = null,
      error_code = null,
      result_summary = '{}'::jsonb
  from pg_temp.ordax_orphans_current o
  where c.device_id = o.device_id
    and c.command_id = o.command_id
    and o.is_read_only;
  get diagnostics requeued_count = row_count;

  insert into public.ordax_dev_results(
    device_id,
    command_id,
    status,
    exit_code,
    stdout,
    stderr,
    health,
    evidence,
    started_at,
    finished_at
  )
  select
    o.device_id,
    o.command_id,
    'failed',
    1,
    '',
    'lease_expired_after_start',
    '{}'::jsonb,
    jsonb_build_object('error_code', 'lease_expired_after_start'),
    o.started_at,
    now()
  from pg_temp.ordax_orphans_current o
  where not o.is_read_only;

  update public.ordax_dev_commands c
  set status = 'failed',
      completed_at = now(),
      lease_id = null,
      error_code = 'lease_expired_after_start',
      result_summary = jsonb_build_object('orphan_reconciled', true)
  from pg_temp.ordax_orphans_current o
  where c.device_id = o.device_id
    and c.command_id = o.command_id
    and not o.is_read_only;
  get diagnostics failed_count = row_count;

  insert into public.ordax_dev_events(device_id, command_id, event_type, payload)
  select
    o.device_id,
    o.command_id,
    case when o.is_read_only then 'orphan_requeued' else 'orphan_failed' end,
    jsonb_build_object(
      'previous_lease_id', o.lease_id,
      'error_code', case when o.is_read_only then null else 'lease_expired_after_start' end
    )
  from pg_temp.ordax_orphans_current o;

  return next;
end
$$;

-- CREATE OR REPLACE preserves an existing ACL. Reassert the intended boundary
-- so future restores cannot inherit default PUBLIC execute.
revoke all on function public.ordax_finalize_artifact_upload(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.ordax_heartbeat_lease(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.ordax_reconcile_orphan_commands(uuid)
  from public, anon, authenticated;
revoke all on function public.ordax_report_command(
  uuid, uuid, uuid, text, integer, text, text, jsonb, jsonb, text, uuid
)
  from public, anon, authenticated;

grant execute on function public.ordax_finalize_artifact_upload(uuid, uuid, uuid, uuid)
  to service_role;
grant execute on function public.ordax_heartbeat_lease(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.ordax_reconcile_orphan_commands(uuid)
  to service_role;
grant execute on function public.ordax_report_command(
  uuid, uuid, uuid, text, integer, text, text, jsonb, jsonb, text, uuid
)
  to service_role;
