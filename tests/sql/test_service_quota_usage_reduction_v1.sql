\set ON_ERROR_STOP on

-- This proof runs after test_service_quota_ledger_v1.sql, which leaves the
-- account fixture with 100 committed storage.user.bytes and no active reservations.
\ir ../../infra/supabase/product/migrations/20261007083105_service_quota_usage_reduction_v1.sql

-- The reduction helper is private implementation authority. API roles must never
-- invoke it directly; reviewed domain executors call it from their own transaction.
do $proof$
declare
  v_role text;
begin
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(
      v_role,
      'private.ordax_reduce_service_quota_usage_v1(uuid,uuid,text,text,bigint)',
      'EXECUTE'
    ) then
      raise exception 'quota-reduce-helper-authority-leak:%', v_role;
    end if;
  end loop;
end;
$proof$;

-- Delete the current entitlement entirely. Resource deletion must still be able
-- to return committed logical usage even after policy removal or downgrade.
delete from public.ordax_entitlement_grants
where user_id = '11111111-1111-4111-8111-111111111111'
  and entitlement_key = 'storage.user.bytes';

-- Keep an independent active reservation to prove reduction changes committed
-- usage only and does not consume or rewrite reserved capacity.
insert into private.ordax_service_quota_reservations(
  usage_id,
  idempotency_key,
  requested_units,
  expires_at
)
select
  u.usage_id,
  'reduction-proof-reserved',
  10,
  statement_timestamp() + interval '10 minutes'
from private.ordax_service_quota_usage u
where u.user_id = '11111111-1111-4111-8111-111111111111'
  and u.space_id is null
  and u.quota_key = 'storage.user.bytes';

do $proof$
declare
  v_result record;
begin
  select * into v_result
  from private.ordax_reduce_service_quota_usage_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    40
  );

  if not v_result.reduced
     or v_result.used_units <> 60
     or v_result.reserved_units <> 10 then
    raise exception 'quota-reduction-result-invalid';
  end if;

  -- Zero-byte resources are valid and must be a deterministic no-op.
  select * into v_result
  from private.ordax_reduce_service_quota_usage_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes',
    'bytes',
    0
  );

  if not v_result.reduced
     or v_result.used_units <> 60
     or v_result.reserved_units <> 10 then
    raise exception 'quota-zero-reduction-invalid';
  end if;

  begin
    perform * from private.ordax_reduce_service_quota_usage_v1(
      '11111111-1111-4111-8111-111111111111',
      null,
      'storage.user.bytes',
      'bytes',
      61
    );
    raise exception 'quota-usage-underflow-accepted';
  exception
    when sqlstate '23514' then null;
  end;

  begin
    perform * from private.ordax_reduce_service_quota_usage_v1(
      '11111111-1111-4111-8111-111111111111',
      null,
      'storage.user.bytes',
      'items',
      1
    );
    raise exception 'quota-reduction-unit-drift-accepted';
  exception
    when sqlstate '23514' then null;
  end;

  begin
    perform * from private.ordax_reduce_service_quota_usage_v1(
      '22222222-2222-4222-8222-222222222222',
      null,
      'storage.user.bytes',
      'bytes',
      1
    );
    raise exception 'quota-reduction-missing-usage-accepted';
  exception
    when sqlstate '55000' then null;
  end;

  begin
    perform * from private.ordax_reduce_service_quota_usage_v1(
      '11111111-1111-4111-8111-111111111111',
      null,
      'storage.user.bytes',
      'bytes',
      -1
    );
    raise exception 'quota-negative-reduction-accepted';
  exception
    when sqlstate '22023' then null;
  end;
end;
$proof$;

-- The fixture has no current entitlement, but committed usage was reduced and
-- reserved capacity remained separate.
do $proof$
declare
  v_grants bigint;
  v_status record;
begin
  select count(*) into v_grants
  from public.ordax_entitlement_grants
  where user_id = '11111111-1111-4111-8111-111111111111'
    and entitlement_key = 'storage.user.bytes';
  if v_grants <> 0 then
    raise exception 'quota-reduction-policy-independence-not-proven';
  end if;

  select * into v_status
  from public.ordax_service_quota_usage_status_v1(
    '11111111-1111-4111-8111-111111111111',
    null,
    'storage.user.bytes'
  );
  if v_status.used_units <> 60
     or v_status.reserved_units <> 10
     or v_status.active_reservations <> 1 then
    raise exception 'quota-reduction-final-status-invalid';
  end if;
end;
$proof$;
