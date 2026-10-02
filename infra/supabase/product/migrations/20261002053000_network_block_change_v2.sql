-- OrdaX Network MVP: promote the proven block-change v2 mutation outcome boundary.
--
-- This migration preserves the server-authoritative Space boundary, stable
-- logical block resource ids, idempotent block/unblock retries and durable
-- rate-limit state. It does not grant direct table access or activate Network.

begin;

create or replace function private.ordax_network_block_resource_id_v2(
  p_space_id uuid,
  p_target_space_id uuid
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select 'block:' || p_space_id::text || ':' || p_target_space_id::text;
$$;

revoke all on function private.ordax_network_block_resource_id_v2(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_block_resource_id_v2(
  uuid, uuid
) to authenticated;

create or replace function private.ordax_network_set_block_internal_v2(
  p_space_id uuid,
  p_target_space_id uuid,
  p_blocked boolean
)
returns table(
  schema text,
  outcome text,
  operation text,
  code text,
  resource_id text,
  retry_after_seconds integer,
  idempotency_key text
)
language plpgsql
security definer
set search_path = ''
as $block_v2$
declare
  v_actor uuid;
  v_resource_id text;
  v_inserted boolean := false;
  v_existing_created_at timestamptz;
  v_retry_after integer;
begin
  if p_target_space_id is null
     or p_target_space_id = p_space_id
     or p_blocked is null then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'block-change',
      'block-target-invalid',
      null::text,
      null::integer,
      null::text;
    return;
  end if;

  begin
    v_actor := private.ordax_network_assert_space_actor_v1(
      p_space_id,
      true
    );
  exception
    when sqlstate '42501' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'block-change',
        'block-change-denied',
        null::text,
        null::integer,
        null::text;
      return;
  end;

  if not exists (
    select 1
    from public.ordax_spaces s
    where s.space_id = p_target_space_id
      and s.state = 'active'
      and s.kind = 'professional'
  ) then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'block-change',
      'block-target-not-found',
      null::text,
      null::integer,
      null::text;
    return;
  end if;

  v_resource_id := private.ordax_network_block_resource_id_v2(
    p_space_id,
    p_target_space_id
  );

  if p_blocked then
    -- Insert first so a concurrent winner resolves idempotently before quota.
    insert into public.ordax_network_blocks(
      blocker_space_id,
      blocked_space_id,
      created_by
    ) values (
      p_space_id,
      p_target_space_id,
      v_actor
    )
    on conflict (blocker_space_id, blocked_space_id) do nothing
    returning true into v_inserted;

    if not coalesce(v_inserted, false) then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'idempotent',
        'block-change',
        'block-already-applied',
        v_resource_id,
        null::integer,
        null::text;
      return;
    end if;

    if not private.ordax_network_consume_rate_v1(
      v_actor,
      p_space_id,
      'block-change',
      60,
      3600
    ) then
      delete from public.ordax_network_blocks
      where blocker_space_id = p_space_id
        and blocked_space_id = p_target_space_id;

      select greatest(
        1,
        least(
          3600,
          ceil(
            extract(
              epoch from (
                r.window_started_at
                + interval '3600 seconds'
                - statement_timestamp()
              )
            )
          )::integer
        )
      )
      into v_retry_after
      from private.ordax_network_rate_windows r
      where r.actor_user_id = v_actor
        and r.actor_space_id = p_space_id
        and r.operation = 'block-change';

      if v_retry_after is null then
        raise exception 'network-block-v2-rate-state-missing'
          using errcode = '55000';
      end if;

      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'rate_limited',
        'block-change',
        'block-rate-limited',
        null::text,
        v_retry_after,
        null::text;
      return;
    end if;

    insert into private.ordax_network_audit_events(
      actor_user_id,
      actor_space_id,
      event_type,
      resource_type,
      resource_id
    ) values (
      v_actor,
      p_space_id,
      'space-blocked',
      'space',
      p_target_space_id::text
    );

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'applied',
      'block-change',
      'block-applied',
      v_resource_id,
      null::integer,
      null::text;
    return;
  end if;

  -- Unblock locks the current relation before quota. A concurrent retry waits
  -- and then observes "not found", becoming idempotent without another quota.
  select b.created_at
  into v_existing_created_at
  from public.ordax_network_blocks b
  where b.blocker_space_id = p_space_id
    and b.blocked_space_id = p_target_space_id
  for update;

  if not found then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'idempotent',
      'block-change',
      'block-already-removed',
      v_resource_id,
      null::integer,
      null::text;
    return;
  end if;

  if not private.ordax_network_consume_rate_v1(
    v_actor,
    p_space_id,
    'block-change',
    60,
    3600
  ) then
    select greatest(
      1,
      least(
        3600,
        ceil(
          extract(
            epoch from (
              r.window_started_at
              + interval '3600 seconds'
              - statement_timestamp()
            )
          )
        )::integer
      )
    )
    into v_retry_after
    from private.ordax_network_rate_windows r
    where r.actor_user_id = v_actor
      and r.actor_space_id = p_space_id
      and r.operation = 'block-change';

    if v_retry_after is null then
      raise exception 'network-unblock-v2-rate-state-missing'
        using errcode = '55000';
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'rate_limited',
      'block-change',
      'unblock-rate-limited',
      null::text,
      v_retry_after,
      null::text;
    return;
  end if;

  delete from public.ordax_network_blocks
  where blocker_space_id = p_space_id
    and blocked_space_id = p_target_space_id;

  insert into private.ordax_network_audit_events(
    actor_user_id,
    actor_space_id,
    event_type,
    resource_type,
    resource_id
  ) values (
    v_actor,
    p_space_id,
    'space-unblocked',
    'space',
    p_target_space_id::text
  );

  return query select
    'prototype-ordax.network-mutation-outcome/2',
    'applied',
    'block-change',
    'unblock-applied',
    v_resource_id,
    null::integer,
    null::text;
end;
$block_v2$;

revoke all on function private.ordax_network_set_block_internal_v2(
  uuid, uuid, boolean
) from public, anon;
grant execute on function private.ordax_network_set_block_internal_v2(
  uuid, uuid, boolean
) to authenticated;

create or replace function public.ordax_network_set_block_v2(
  p_space_id uuid,
  p_target_space_id uuid,
  p_blocked boolean
)
returns table(
  schema text,
  outcome text,
  operation text,
  code text,
  resource_id text,
  retry_after_seconds integer,
  idempotency_key text
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.ordax_network_set_block_internal_v2(
    p_space_id,
    p_target_space_id,
    p_blocked
  );
$$;

revoke all on function public.ordax_network_set_block_v2(
  uuid, uuid, boolean
) from public, anon;
grant execute on function public.ordax_network_set_block_v2(
  uuid, uuid, boolean
) to authenticated;

commit;
