\set ON_ERROR_STOP on

-- The workflow executes test_network_multitenant_hardening.sql immediately
-- before this file. That proof leaves the canonical schema/migrations in place
-- but rolls back all fixture data, so group-join v2 starts from a clean schema.
begin;

-- Prototype only: these functions exist inside the proof transaction and are
-- rolled back. No committed Supabase schema is changed by this file.
create or replace function private.ordax_network_join_group_internal_v2_proof(
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

revoke all on function private.ordax_network_join_group_internal_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_join_group_internal_v2_proof(
  uuid, uuid
) to authenticated;

create or replace function public.ordax_network_join_group_v2_proof(
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
  from private.ordax_network_join_group_internal_v2_proof(
    p_space_id,
    p_group_id
  );
$$;

revoke all on function public.ordax_network_join_group_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function public.ordax_network_join_group_v2_proof(
  uuid, uuid
) to authenticated;

-- Proof-only scoped inspection. Network tables remain unavailable directly.
create or replace function private.ordax_network_group_join_rate_count_v2_proof(
  p_actor_user_id uuid,
  p_actor_space_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $proof_rate$
declare
  v_actor uuid;
  v_count integer;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(
    p_actor_space_id,
    false
  );

  if v_actor <> p_actor_user_id then
    raise exception 'network-group-v2-proof-rate-actor-mismatch'
      using errcode = '42501';
  end if;

  select rw.count into v_count
  from private.ordax_network_rate_windows rw
  where rw.actor_user_id = p_actor_user_id
    and rw.actor_space_id = p_actor_space_id
    and rw.operation = 'group-join';

  return coalesce(v_count, 0);
end;
$proof_rate$;

revoke all on function private.ordax_network_group_join_rate_count_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_group_join_rate_count_v2_proof(
  uuid, uuid
) to authenticated;

create or replace function private.ordax_network_group_join_snapshot_v2_proof(
  p_space_id uuid,
  p_group_id uuid
)
returns table(
  membership_role text,
  membership_state text,
  conversation_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $proof_snapshot$
begin
  perform private.ordax_network_assert_space_actor_v1(
    p_space_id,
    false
  );

  return query
  select
    gm.role,
    gm.state,
    cm.state
  from public.ordax_network_groups g
  left join public.ordax_network_group_memberships gm
    on gm.group_id = g.group_id
   and gm.space_id = p_space_id
  left join public.ordax_network_conversations c
    on c.group_id = g.group_id
   and c.kind = 'group'
  left join public.ordax_network_conversation_members cm
    on cm.conversation_id = c.conversation_id
   and cm.space_id = p_space_id
  where g.group_id = p_group_id;
end;
$proof_snapshot$;

revoke all on function private.ordax_network_group_join_snapshot_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_group_join_snapshot_v2_proof(
  uuid, uuid
) to authenticated;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');

insert into public.ordax_spaces(
  space_id,
  owner_user_id,
  name,
  kind,
  state
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'Escola Horizonte', 'professional', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'Papelaria Bairro', 'professional', 'active');

insert into public.ordax_space_members(
  space_id,
  user_id,
  role,
  state
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  '33333333-3333-4333-8333-333333333333',
  'viewer',
  'active'
);

insert into public.ordax_network_communities(
  community_id,
  title,
  kind,
  jurisdiction,
  state,
  join_policy
) values (
  'industry.education.school.br',
  'Escolas Brasil',
  'professional-industry',
  'BR',
  'active',
  'explicit-consent'
);

create temporary table group_join_v2_proof_state (
  key text primary key,
  value uuid not null
);
grant select, insert, update on group_join_v2_proof_state to authenticated;

-- Runtime group creation intentionally rejects invite-only until the invite
-- flow exists. Seed one schema-valid, internally consistent invite-only group
-- as a proof fixture so group-join v2 can demonstrate that self-service join
-- remains denied without weakening the product RPC.
insert into public.ordax_network_groups(
  group_id,
  community_id,
  owner_space_id,
  title,
  description,
  join_policy,
  state,
  created_by
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  'industry.education.school.br',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'Diretores convidados',
  'Grupo fechado',
  'invite-only',
  'active',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.ordax_network_group_memberships(
  group_id,
  space_id,
  role,
  state,
  joined_by
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'owner',
  'active',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.ordax_network_conversations(
  conversation_id,
  kind,
  group_id,
  state
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
  'group',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
  'active'
);

insert into public.ordax_network_conversation_members(
  conversation_id,
  space_id,
  state
) values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'active'
);

insert into group_join_v2_proof_state(key, value)
values (
  'invite-group',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
);

set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

select public.ordax_network_join_community_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'industry.education.school.br'
);

insert into group_join_v2_proof_state(key, value)
select
  'members-group',
  public.ordax_network_create_group_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Gestores de escolas',
    'Troca profissional',
    'members'
  );

insert into group_join_v2_proof_state(key, value)
select
  'rate-group',
  public.ordax_network_create_group_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Grupo para prova de limite',
    null,
    'members'
  );

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

select public.ordax_network_join_community_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'industry.education.school.br'
);

-- First join applies exactly once and returns the deterministic logical
-- membership resource id.
do $proof$
declare
  v_group_id uuid;
  v_outcome record;
  v_snapshot record;
  v_expected_resource text;
  v_count integer;
begin
  select value into v_group_id
  from group_join_v2_proof_state
  where key = 'members-group';

  v_expected_resource :=
    'group-membership:' || v_group_id::text || ':bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

  select * into v_outcome
  from public.ordax_network_join_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_outcome.schema <> 'prototype-ordax.network-mutation-outcome/2'
     or v_outcome.outcome <> 'applied'
     or v_outcome.operation <> 'group-join'
     or v_outcome.code <> 'group-membership-applied'
     or v_outcome.resource_id <> v_expected_resource
     or v_outcome.retry_after_seconds is not null
     or v_outcome.idempotency_key is not null then
    raise exception 'network-group-v2-proof-applied-shape-invalid';
  end if;

  select * into v_snapshot
  from private.ordax_network_group_join_snapshot_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_snapshot.membership_role <> 'member'
     or v_snapshot.membership_state <> 'active'
     or v_snapshot.conversation_state <> 'active' then
    raise exception 'network-group-v2-proof-applied-state-invalid';
  end if;

  select private.ordax_network_group_join_rate_count_v2_proof(
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-v2-proof-applied-rate-count-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_join_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_outcome.outcome <> 'idempotent'
     or v_outcome.code <> 'group-membership-idempotent'
     or v_outcome.resource_id <> v_expected_resource then
    raise exception 'network-group-v2-proof-idempotent-shape-invalid';
  end if;

  select private.ordax_network_group_join_rate_count_v2_proof(
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-v2-proof-idempotent-consumed-rate';
  end if;
end;
$proof$;

-- Viewer authority is read-only and cannot exploit an already-existing
-- membership to bypass mutation authority.
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  true
);

do $proof$
declare
  v_group_id uuid;
  v_outcome record;
begin
  select value into v_group_id
  from group_join_v2_proof_state
  where key = 'members-group';

  select * into v_outcome
  from public.ordax_network_join_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'group-join-denied'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-group-v2-proof-viewer-denied-shape-invalid';
  end if;
end;
$proof$;

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

do $proof$
declare
  v_outcome record;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_join_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    null
  );

  if v_outcome.outcome <> 'invalid'
     or v_outcome.code <> 'group-id-invalid'
     or v_outcome.resource_id is not null then
    raise exception 'network-group-v2-proof-invalid-shape-invalid';
  end if;

  select private.ordax_network_group_join_rate_count_v2_proof(
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-v2-proof-invalid-consumed-rate';
  end if;
end;
$proof$;

-- Invite-only is a policy denial and must not spend quota or create membership.
do $proof$
declare
  v_group_id uuid;
  v_outcome record;
  v_snapshot record;
  v_count integer;
begin
  select value into v_group_id
  from group_join_v2_proof_state
  where key = 'invite-group';

  select * into v_outcome
  from public.ordax_network_join_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'group-join-unavailable'
     or v_outcome.resource_id is not null then
    raise exception 'network-group-v2-proof-invite-denied-shape-invalid';
  end if;

  select * into v_snapshot
  from private.ordax_network_group_join_snapshot_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_snapshot.membership_state is not null
     or v_snapshot.conversation_state is not null then
    raise exception 'network-group-v2-proof-invite-denied-created-membership';
  end if;

  select private.ordax_network_group_join_rate_count_v2_proof(
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-v2-proof-invite-denied-consumed-rate';
  end if;
end;
$proof$;

-- A left membership is reactivated under row lock and then becomes idempotent.
do $proof$
declare
  v_group_id uuid;
  v_outcome record;
  v_snapshot record;
  v_expected_resource text;
  v_count integer;
begin
  select value into v_group_id
  from group_join_v2_proof_state
  where key = 'members-group';

  perform public.ordax_network_leave_group_v1(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  select * into v_snapshot
  from private.ordax_network_group_join_snapshot_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_snapshot.membership_state <> 'left'
     or v_snapshot.conversation_state <> 'left' then
    raise exception 'network-group-v2-proof-left-state-invalid';
  end if;

  v_expected_resource :=
    'group-membership:' || v_group_id::text || ':bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

  select * into v_outcome
  from public.ordax_network_join_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_outcome.outcome <> 'applied'
     or v_outcome.code <> 'group-membership-applied'
     or v_outcome.resource_id <> v_expected_resource then
    raise exception 'network-group-v2-proof-reactivation-shape-invalid';
  end if;

  select * into v_snapshot
  from private.ordax_network_group_join_snapshot_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_snapshot.membership_state <> 'active'
     or v_snapshot.conversation_state <> 'active' then
    raise exception 'network-group-v2-proof-reactivation-state-invalid';
  end if;

  select private.ordax_network_group_join_rate_count_v2_proof(
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_count;

  if v_count <> 2 then
    raise exception 'network-group-v2-proof-reactivation-rate-count-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_join_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_outcome.outcome <> 'idempotent'
     or v_outcome.resource_id <> v_expected_resource then
    raise exception 'network-group-v2-proof-reactivation-retry-not-idempotent';
  end if;

  select private.ordax_network_group_join_rate_count_v2_proof(
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_count;

  if v_count <> 2 then
    raise exception 'network-group-v2-proof-reactivation-retry-consumed-rate';
  end if;
end;
$proof$;

-- Fill the same fixed window to its limit without changing membership state.
do $proof$
declare
  i integer;
  v_allowed boolean;
begin
  for i in 3..40 loop
    select private.ordax_network_consume_rate_v1(
      '22222222-2222-4222-8222-222222222222',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      'group-join',
      40,
      3600
    ) into v_allowed;

    if not v_allowed then
      raise exception 'network-group-v2-proof-rate-prefill-rejected-early';
    end if;
  end loop;
end;
$proof$;

-- Over-limit join reports rate_limited explicitly, preserves count=41 and removes
-- the provisional composite-key membership.
do $proof$
declare
  v_group_id uuid;
  v_outcome record;
  v_snapshot record;
  v_count integer;
begin
  select value into v_group_id
  from group_join_v2_proof_state
  where key = 'rate-group';

  select * into v_outcome
  from public.ordax_network_join_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_outcome.outcome <> 'rate_limited'
     or v_outcome.code <> 'group-join-rate-limited'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is null
     or v_outcome.retry_after_seconds < 1
     or v_outcome.retry_after_seconds > 3600 then
    raise exception 'network-group-v2-proof-rate-limited-shape-invalid';
  end if;

  select private.ordax_network_group_join_rate_count_v2_proof(
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_count;

  if v_count <> 41 then
    raise exception 'network-group-v2-proof-rate-state-not-durable';
  end if;

  select * into v_snapshot
  from private.ordax_network_group_join_snapshot_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    v_group_id
  );

  if v_snapshot.membership_state is not null
     or v_snapshot.conversation_state is not null then
    raise exception 'network-group-v2-proof-rate-limited-membership-persisted';
  end if;
end;
$proof$;

rollback;
