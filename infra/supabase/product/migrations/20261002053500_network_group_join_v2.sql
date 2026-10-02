-- OrdaX Network MVP: promote the proven group-join v2 mutation outcome boundary.
--
-- This migration preserves server-authoritative Space/community membership,
-- natural idempotency on the group membership key and bounded reactivation.
-- It does not grant direct table access or activate Network in any composition.

begin;

create or replace function private.ordax_network_join_group_internal_v2(
  p_space_id uuid,
  p_group_id uuid
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
as $group_join_v2$
declare
  v_actor uuid;
  v_group public.ordax_network_groups;
  v_membership public.ordax_network_group_memberships;
  v_conversation_id uuid;
  v_inserted boolean := false;
  v_reactivate boolean := false;
  v_retry_after integer;
  v_resource_id text;
begin
  if p_group_id is null then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'group-join',
      'group-id-invalid',
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
        'group-join',
        'group-join-denied',
        null::text,
        null::integer,
        null::text;
      return;
  end;

  select g.* into v_group
  from public.ordax_network_groups g
  where g.group_id = p_group_id
    and g.state = 'active'
  for share;

  if not found or v_group.join_policy <> 'members' then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'denied',
      'group-join',
      'group-join-unavailable',
      null::text,
      null::integer,
      null::text;
    return;
  end if;

  begin
    perform private.ordax_network_assert_community_member_v1(
      p_space_id,
      v_group.community_id
    );
  exception
    when sqlstate '42501' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'group-join',
        'group-community-membership-required',
        null::text,
        null::integer,
        null::text;
      return;
  end;

  select c.conversation_id into v_conversation_id
  from public.ordax_network_conversations c
  where c.kind = 'group'
    and c.group_id = p_group_id
    and c.state = 'active';

  if v_conversation_id is null then
    raise exception 'network-group-v2-conversation-missing'
      using errcode = '55000';
  end if;

  v_resource_id :=
    'group-membership:' || p_group_id::text || ':' || p_space_id::text;

  -- Existing membership is resolved and locked before any quota is consumed.
  -- This makes retries against an active row idempotent and serializes
  -- reactivation of a previously-left membership.
  select gm.* into v_membership
  from public.ordax_network_group_memberships gm
  where gm.group_id = p_group_id
    and gm.space_id = p_space_id
  for update;

  if found then
    if v_membership.state = 'active' then
      if not exists (
        select 1
        from public.ordax_network_conversation_members cm
        where cm.conversation_id = v_conversation_id
          and cm.space_id = p_space_id
          and cm.state = 'active'
      ) then
        raise exception 'network-group-v2-active-membership-conversation-inconsistent'
          using errcode = '55000';
      end if;

      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'idempotent',
        'group-join',
        'group-membership-idempotent',
        v_resource_id,
        null::integer,
        null::text;
      return;
    end if;

    if v_membership.state <> 'left'
       or v_membership.role <> 'member' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'group-join',
        'group-membership-not-reactivatable',
        null::text,
        null::integer,
        null::text;
      return;
    end if;

    v_reactivate := true;
  else
    -- Claim the composite membership key before consuming quota. Concurrent
    -- first joins serialize on the primary key; the loser resolves the
    -- canonical membership instead of spending a second quota unit.
    insert into public.ordax_network_group_memberships(
      group_id,
      space_id,
      role,
      state,
      joined_by
    ) values (
      p_group_id,
      p_space_id,
      'member',
      'active',
      v_actor
    )
    on conflict (group_id, space_id) do nothing
    returning * into v_membership;

    v_inserted := found;

    if not v_inserted then
      select gm.* into v_membership
      from public.ordax_network_group_memberships gm
      where gm.group_id = p_group_id
        and gm.space_id = p_space_id
      for update;

      if not found then
        raise exception 'network-group-v2-concurrent-membership-resolution-failed'
          using errcode = '40001';
      end if;

      if v_membership.state = 'active' then
        if not exists (
          select 1
          from public.ordax_network_conversation_members cm
          where cm.conversation_id = v_conversation_id
            and cm.space_id = p_space_id
            and cm.state = 'active'
        ) then
          raise exception 'network-group-v2-active-membership-conversation-inconsistent'
            using errcode = '55000';
        end if;

        return query select
          'prototype-ordax.network-mutation-outcome/2',
          'idempotent',
          'group-join',
          'group-membership-idempotent',
          v_resource_id,
          null::integer,
          null::text;
        return;
      end if;

      if v_membership.state <> 'left'
         or v_membership.role <> 'member' then
        return query select
          'prototype-ordax.network-mutation-outcome/2',
          'denied',
          'group-join',
          'group-membership-not-reactivatable',
          null::text,
          null::integer,
          null::text;
        return;
      end if;

      v_reactivate := true;
    end if;
  end if;

  if not private.ordax_network_consume_rate_v1(
    v_actor,
    p_space_id,
    'group-join',
    40,
    3600
  ) then
    if v_inserted then
      delete from public.ordax_network_group_memberships gm
      where gm.group_id = p_group_id
        and gm.space_id = p_space_id
        and gm.role = 'member'
        and gm.state = 'active';
    end if;

    select greatest(
      1,
      least(
        3600,
        ceil(
          extract(
            epoch from (
              rw.window_started_at
              + interval '3600 seconds'
              - statement_timestamp()
            )
          )
        )::integer
      )
    )
    into v_retry_after
    from private.ordax_network_rate_windows rw
    where rw.actor_user_id = v_actor
      and rw.actor_space_id = p_space_id
      and rw.operation = 'group-join';

    if v_retry_after is null then
      raise exception 'network-group-v2-rate-state-missing'
        using errcode = '55000';
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'rate_limited',
      'group-join',
      'group-join-rate-limited',
      null::text,
      v_retry_after,
      null::text;
    return;
  end if;

  if v_reactivate then
    update public.ordax_network_group_memberships gm
    set state = 'active',
        joined_by = v_actor,
        joined_at = timezone('utc', now())
    where gm.group_id = p_group_id
      and gm.space_id = p_space_id
      and gm.state = 'left'
      and gm.role = 'member';

    if not found then
      raise exception 'network-group-v2-reactivation-lost'
        using errcode = '40001';
    end if;
  end if;

  insert into public.ordax_network_conversation_members(
    conversation_id,
    space_id,
    state
  ) values (
    v_conversation_id,
    p_space_id,
    'active'
  )
  on conflict (conversation_id, space_id) do update
    set state = 'active',
        joined_at = timezone('utc', now());

  insert into private.ordax_network_audit_events(
    actor_user_id,
    actor_space_id,
    event_type,
    resource_type,
    resource_id
  ) values (
    v_actor,
    p_space_id,
    'group-joined',
    'group',
    p_group_id::text
  );

  return query select
    'prototype-ordax.network-mutation-outcome/2',
    'applied',
    'group-join',
    'group-membership-applied',
    v_resource_id,
    null::integer,
    null::text;
end;
$group_join_v2$;

revoke all on function private.ordax_network_join_group_internal_v2(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_join_group_internal_v2(
  uuid, uuid
) to authenticated;

create or replace function public.ordax_network_join_group_v2(
  p_space_id uuid,
  p_group_id uuid
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
  from private.ordax_network_join_group_internal_v2(
    p_space_id,
    p_group_id
  );
$$;

revoke all on function public.ordax_network_join_group_v2(
  uuid, uuid
) from public, anon;
grant execute on function public.ordax_network_join_group_v2(
  uuid, uuid
) to authenticated;

commit;
