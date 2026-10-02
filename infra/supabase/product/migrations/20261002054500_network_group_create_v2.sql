-- OrdaX Network MVP: promote the proven group-create v2 mutation outcome boundary.
--
-- The idempotency column remains nullable for legacy v1 groups. New v2 groups
-- require a bounded client key unique within the owner Space. Existing Network
-- authority, membership and transport boundaries remain unchanged.

begin;

alter table public.ordax_network_groups
  add column client_idempotency_key text;

alter table public.ordax_network_groups
  add constraint ordax_network_groups_client_idempotency_key_v2_check
  check (
    client_idempotency_key is null
    or (
      char_length(client_idempotency_key) between 16 and 120
      and client_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    )
  );

create unique index ordax_network_groups_owner_idempotency_v2_idx
  on public.ordax_network_groups(owner_space_id, client_idempotency_key)
  where owner_space_id is not null
    and client_idempotency_key is not null;

create or replace function private.ordax_network_create_group_internal_v2(
  p_space_id uuid,
  p_community_id text,
  p_title text,
  p_description text,
  p_join_policy text,
  p_client_idempotency_key text
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
as $group_create_v2$
declare
  v_actor uuid;
  v_title text := btrim(p_title);
  v_description text := nullif(btrim(p_description), '');
  v_row public.ordax_network_groups;
  v_inserted boolean := false;
  v_retry_after integer;
  v_conversation_id uuid;
begin
  if p_community_id is null
     or char_length(p_community_id) not between 1 and 120
     or p_community_id !~ '^[a-z0-9]+([.-][a-z0-9]+)*$' then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'group-create',
      'group-community-id-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if v_title is null or char_length(v_title) not between 1 and 120 then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'group-create',
      'group-title-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if v_description is not null and char_length(v_description) > 800 then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'group-create',
      'group-description-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if p_join_policy = 'invite-only' then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'denied',
      'group-create',
      'group-invite-flow-not-ready',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if p_join_policy <> 'members' then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'group-create',
      'group-join-policy-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if p_client_idempotency_key is null
     or char_length(p_client_idempotency_key) not between 16 and 120
     or p_client_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'group-create',
      'group-idempotency-key-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
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
        'group-create',
        'group-create-denied',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
  end;

  begin
    perform private.ordax_network_assert_community_member_v1(
      p_space_id,
      p_community_id
    );
  exception
    when sqlstate '42501' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'group-create',
        'group-community-membership-required',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
  end;

  -- Retry resolution happens before quota consumption. Legacy v1 rows have a
  -- NULL key, so only v2-created rows participate in this boundary.
  select g.* into v_row
  from public.ordax_network_groups g
  where g.owner_space_id = p_space_id
    and g.client_idempotency_key = p_client_idempotency_key;

  if found then
    if v_row.community_id <> p_community_id
       or v_row.title <> v_title
       or v_row.description is distinct from v_description
       or v_row.join_policy <> p_join_policy then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'invalid',
        'group-create',
        'group-idempotency-conflict',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

    if v_row.state <> 'active' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'group-create',
        'group-idempotency-resource-unavailable',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

    if not exists (
      select 1
      from public.ordax_network_group_memberships gm
      join public.ordax_network_conversations c
        on c.group_id = v_row.group_id
       and c.kind = 'group'
       and c.state = 'active'
      join public.ordax_network_conversation_members cm
        on cm.conversation_id = c.conversation_id
       and cm.space_id = p_space_id
       and cm.state = 'active'
      where gm.group_id = v_row.group_id
        and gm.space_id = p_space_id
        and gm.role = 'owner'
        and gm.state = 'active'
    ) then
      raise exception 'network-group-create-v2-existing-structure-inconsistent'
        using errcode = '55000';
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'idempotent',
      'group-create',
      'group-idempotent',
      v_row.group_id::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  -- Claim the owner-Space/key before spending quota. Concurrent requests with
  -- the same key serialize on the partial unique index; a losing request
  -- resolves to the canonical group rather than creating or charging twice.
  insert into public.ordax_network_groups(
    community_id,
    owner_space_id,
    title,
    description,
    join_policy,
    created_by,
    client_idempotency_key
  ) values (
    p_community_id,
    p_space_id,
    v_title,
    v_description,
    p_join_policy,
    v_actor,
    p_client_idempotency_key
  )
  on conflict (owner_space_id, client_idempotency_key)
    where owner_space_id is not null
      and client_idempotency_key is not null
  do nothing
  returning * into v_row;

  v_inserted := found;

  if not v_inserted then
    select g.* into v_row
    from public.ordax_network_groups g
    where g.owner_space_id = p_space_id
      and g.client_idempotency_key = p_client_idempotency_key;

    if not found then
      raise exception 'network-group-create-v2-idempotency-resolution-failed'
        using errcode = '40001';
    end if;

    if v_row.community_id <> p_community_id
       or v_row.title <> v_title
       or v_row.description is distinct from v_description
       or v_row.join_policy <> p_join_policy then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'invalid',
        'group-create',
        'group-idempotency-conflict',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

    if v_row.state <> 'active' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'group-create',
        'group-idempotency-resource-unavailable',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

    if not exists (
      select 1
      from public.ordax_network_group_memberships gm
      join public.ordax_network_conversations c
        on c.group_id = v_row.group_id
       and c.kind = 'group'
       and c.state = 'active'
      join public.ordax_network_conversation_members cm
        on cm.conversation_id = c.conversation_id
       and cm.space_id = p_space_id
       and cm.state = 'active'
      where gm.group_id = v_row.group_id
        and gm.space_id = p_space_id
        and gm.role = 'owner'
        and gm.state = 'active'
    ) then
      raise exception 'network-group-create-v2-concurrent-structure-inconsistent'
        using errcode = '55000';
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'idempotent',
      'group-create',
      'group-idempotent',
      v_row.group_id::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if not private.ordax_network_consume_rate_v1(
    v_actor,
    p_space_id,
    'group-create',
    10,
    3600
  ) then
    delete from public.ordax_network_groups g
    where g.group_id = v_row.group_id
      and g.owner_space_id = p_space_id
      and g.client_idempotency_key = p_client_idempotency_key;

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
      and rw.operation = 'group-create';

    if v_retry_after is null then
      raise exception 'network-group-create-v2-rate-state-missing'
        using errcode = '55000';
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'rate_limited',
      'group-create',
      'group-create-rate-limited',
      null::text,
      v_retry_after,
      p_client_idempotency_key;
    return;
  end if;

  insert into public.ordax_network_group_memberships(
    group_id,
    space_id,
    role,
    state,
    joined_by
  ) values (
    v_row.group_id,
    p_space_id,
    'owner',
    'active',
    v_actor
  );

  insert into public.ordax_network_conversations(
    kind,
    group_id
  ) values (
    'group',
    v_row.group_id
  )
  returning conversation_id into v_conversation_id;

  insert into public.ordax_network_conversation_members(
    conversation_id,
    space_id,
    state
  ) values (
    v_conversation_id,
    p_space_id,
    'active'
  );

  insert into private.ordax_network_audit_events(
    actor_user_id,
    actor_space_id,
    event_type,
    resource_type,
    resource_id
  ) values (
    v_actor,
    p_space_id,
    'group-created',
    'group',
    v_row.group_id::text
  );

  return query select
    'prototype-ordax.network-mutation-outcome/2',
    'applied',
    'group-create',
    'group-applied',
    v_row.group_id::text,
    null::integer,
    p_client_idempotency_key;
end;
$group_create_v2$;

revoke all on function private.ordax_network_create_group_internal_v2(
  uuid, text, text, text, text, text
) from public, anon;
grant execute on function private.ordax_network_create_group_internal_v2(
  uuid, text, text, text, text, text
) to authenticated;

create or replace function public.ordax_network_create_group_v2(
  p_space_id uuid,
  p_community_id text,
  p_title text,
  p_description text,
  p_join_policy text,
  p_client_idempotency_key text
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
  from private.ordax_network_create_group_internal_v2(
    p_space_id,
    p_community_id,
    p_title,
    p_description,
    p_join_policy,
    p_client_idempotency_key
  );
$$;

revoke all on function public.ordax_network_create_group_v2(
  uuid, text, text, text, text, text
) from public, anon;
grant execute on function public.ordax_network_create_group_v2(
  uuid, text, text, text, text, text
) to authenticated;

commit;
