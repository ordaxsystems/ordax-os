-- OrdaX Network MVP: promote the proven direct-create v2 mutation outcome boundary.
--
-- This migration preserves the v1 server-authoritative Space/session boundary,
-- existing direct-pair uniqueness and the explicit v2 result contract. It does
-- not grant direct table access and does not activate Network in any composition.

begin;

create or replace function private.ordax_network_create_direct_internal_v2(
  p_space_id uuid,
  p_target_space_id uuid
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
as $direct_v2$
declare
  v_actor uuid;
  v_pair_key text;
  v_existing_id uuid;
  v_existing_state text;
  v_inserted_id uuid;
  v_retry_after integer;
begin
  if p_target_space_id is null or p_target_space_id = p_space_id then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'direct-create',
      'direct-target-invalid',
      null::text,
      null::integer,
      null::text;
    return;
  end if;

  begin
    v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);
  exception
    when sqlstate '42501' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'direct-create',
        'direct-create-denied',
        null::text,
        null::integer,
        null::text;
      return;
  end;

  if not exists (
    select 1
    from public.ordax_network_space_profiles p
    join public.ordax_spaces s on s.space_id = p.space_id
    where p.space_id = p_target_space_id
      and p.visibility = 'discoverable'
      and s.state = 'active'
      and s.kind = 'professional'
  ) then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'denied',
      'direct-create',
      'direct-target-unavailable',
      null::text,
      null::integer,
      null::text;
    return;
  end if;

  if exists (
    select 1
    from public.ordax_network_blocks b
    where (b.blocker_space_id = p_space_id and b.blocked_space_id = p_target_space_id)
       or (b.blocker_space_id = p_target_space_id and b.blocked_space_id = p_space_id)
  ) then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'denied',
      'direct-create',
      'direct-blocked',
      null::text,
      null::integer,
      null::text;
    return;
  end if;

  v_pair_key := private.ordax_network_direct_pair_key_v1(
    p_space_id,
    p_target_space_id
  );

  -- Existing active pair is an idempotent retry and consumes no new quota.
  select c.conversation_id, c.state
  into v_existing_id, v_existing_state
  from public.ordax_network_conversations c
  where c.direct_pair_key = v_pair_key
    and c.kind = 'direct';

  if found then
    if v_existing_state <> 'active' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'direct-create',
        'direct-conversation-unavailable',
        null::text,
        null::integer,
        null::text;
      return;
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'idempotent',
      'direct-create',
      'direct-idempotent',
      v_existing_id::text,
      null::integer,
      null::text;
    return;
  end if;

  -- Insert the candidate before consuming quota. A concurrent winner resolves
  -- to the canonical conversation without consuming another request.
  insert into public.ordax_network_conversations(kind, direct_pair_key)
  values ('direct', v_pair_key)
  on conflict (direct_pair_key) do nothing
  returning conversation_id into v_inserted_id;

  if v_inserted_id is null then
    select c.conversation_id, c.state
    into v_existing_id, v_existing_state
    from public.ordax_network_conversations c
    where c.direct_pair_key = v_pair_key
      and c.kind = 'direct';

    if v_existing_id is null then
      raise exception 'network-direct-v2-idempotency-resolution-failed'
        using errcode = '40001';
    end if;
    if v_existing_state <> 'active' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'direct-create',
        'direct-conversation-unavailable',
        null::text,
        null::integer,
        null::text;
      return;
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'idempotent',
      'direct-create',
      'direct-idempotent',
      v_existing_id::text,
      null::integer,
      null::text;
    return;
  end if;

  if not private.ordax_network_consume_rate_v1(
    v_actor,
    p_space_id,
    'direct-create',
    30,
    3600
  ) then
    delete from public.ordax_network_conversations c
    where c.conversation_id = v_inserted_id
      and c.direct_pair_key = v_pair_key;

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
      and r.operation = 'direct-create';

    if v_retry_after is null then
      raise exception 'network-direct-v2-rate-state-missing'
        using errcode = '55000';
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'rate_limited',
      'direct-create',
      'direct-rate-limited',
      null::text,
      v_retry_after,
      null::text;
    return;
  end if;

  insert into public.ordax_network_conversation_members(
    conversation_id,
    space_id,
    state
  ) values
    (v_inserted_id, p_space_id, 'active'),
    (v_inserted_id, p_target_space_id, 'active')
  on conflict (conversation_id, space_id) do update
    set state = 'active';

  insert into private.ordax_network_audit_events(
    actor_user_id,
    actor_space_id,
    event_type,
    resource_type,
    resource_id
  ) values (
    v_actor,
    p_space_id,
    'direct-created',
    'conversation',
    v_inserted_id::text
  );

  return query select
    'prototype-ordax.network-mutation-outcome/2',
    'applied',
    'direct-create',
    'direct-applied',
    v_inserted_id::text,
    null::integer,
    null::text;
end;
$direct_v2$;

revoke all on function private.ordax_network_create_direct_internal_v2(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_create_direct_internal_v2(
  uuid, uuid
) to authenticated;

create or replace function public.ordax_network_create_direct_v2(
  p_space_id uuid,
  p_target_space_id uuid
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
  from private.ordax_network_create_direct_internal_v2(
    p_space_id,
    p_target_space_id
  );
$$;

revoke all on function public.ordax_network_create_direct_v2(
  uuid, uuid
) from public, anon;
grant execute on function public.ordax_network_create_direct_v2(
  uuid, uuid
) to authenticated;

commit;
