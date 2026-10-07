-- Private committed-usage reduction for server-authoritative service quotas.
--
-- Reductions are intentionally independent from current entitlement policy so
-- deletion/cleanup can always release logical usage, including while over quota
-- or after an entitlement is removed. Domain executors must call this helper in
-- the same transaction as the corresponding resource deletion.

begin;

create or replace function private.ordax_reduce_service_quota_usage_v1(
  p_user_id uuid,
  p_space_id uuid,
  p_quota_key text,
  p_unit text,
  p_released_units bigint
)
returns table (
  reduced boolean,
  used_units bigint,
  reserved_units bigint
)
language plpgsql
security definer
set search_path = ''
as $reduce$
declare
  v_subject_kind text;
  v_subject_id uuid;
  v_usage_id uuid;
  v_used bigint;
  v_unit text;
  v_reserved bigint;
begin
  if ((p_user_id is not null)::integer + (p_space_id is not null)::integer) <> 1 then
    raise exception 'quota-subject-invalid' using errcode = '22023';
  end if;
  if p_quota_key is null
     or p_quota_key !~ '^[a-z][a-z0-9.-]{2,95}$' then
    raise exception 'quota-key-invalid' using errcode = '22023';
  end if;
  if p_unit not in ('bytes','items','operations','compute-units','days') then
    raise exception 'quota-unit-invalid' using errcode = '22023';
  end if;
  if p_released_units is null or p_released_units < 0 then
    raise exception 'quota-release-invalid' using errcode = '22023';
  end if;

  if p_user_id is not null then
    v_subject_kind := 'account';
    v_subject_id := p_user_id;
  else
    v_subject_kind := 'space';
    v_subject_id := p_space_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_subject_kind || ':' || v_subject_id::text || ':' || p_quota_key,
      0
    )
  );

  select u.usage_id, u.used_units, u.unit
    into v_usage_id, v_used, v_unit
  from private.ordax_service_quota_usage u
  where (
    (
      p_user_id is not null
      and u.user_id = p_user_id
      and u.space_id is null
    )
    or (
      p_space_id is not null
      and u.space_id = p_space_id
      and u.user_id is null
    )
  )
    and u.quota_key = p_quota_key
  for update;

  if v_usage_id is null then
    raise exception 'quota-usage-unavailable' using errcode = '55000';
  end if;
  if v_unit <> p_unit then
    raise exception 'quota-unit-drift' using errcode = '23514';
  end if;
  if v_used < p_released_units then
    raise exception 'quota-usage-underflow' using errcode = '23514';
  end if;

  update private.ordax_service_quota_usage u
  set used_units = u.used_units - p_released_units
  where u.usage_id = v_usage_id
  returning u.used_units into v_used;

  select coalesce(sum(r.requested_units), 0)::bigint
    into v_reserved
  from private.ordax_service_quota_reservations r
  where r.usage_id = v_usage_id
    and r.state = 'reserved'
    and r.expires_at > statement_timestamp();

  return query select true, v_used, v_reserved;
end;
$reduce$;

revoke all on function private.ordax_reduce_service_quota_usage_v1(
  uuid, uuid, text, text, bigint
) from public, anon, authenticated, service_role;

comment on function private.ordax_reduce_service_quota_usage_v1(
  uuid, uuid, text, text, bigint
) is
  'Private logical-usage reduction for reviewed domain deletion transactions. It does not consult entitlement policy and rejects accounting underflow.';

commit;
