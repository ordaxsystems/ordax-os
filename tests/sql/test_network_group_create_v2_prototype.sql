\set ON_ERROR_STOP on

-- The canonical multi-tenant proof runs immediately before this file. This
-- proof models the future group-create idempotency schema and RPC only inside
-- this transaction and rolls every schema/data change back.
begin;

alter table public.ordax_network_groups
  add column client_idempotency_key text;

alter table public.ordax_network_groups
  add constraint ordax_network_groups_client_idempotency_key_v2_proof_check
  check (
    client_idempotency_key is null
    or (
      char_length(client_idempotency_key) between 16 and 120
      and client_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    )
  );

create unique index ordax_network_groups_owner_idempotency_v2_proof_idx
  on public.ordax_network_groups(owner_space_id, client_idempotency_key)
  where owner_space_id is not null
    and client_idempotency_key is not null;

create or replace function private.ordax_network_create_group_internal_v2_proof(
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

revoke all on function private.ordax_network_create_group_internal_v2_proof(
  uuid, text, text, text, text, text
) from public, anon;
grant execute on function private.ordax_network_create_group_internal_v2_proof(
  uuid, text, text, text, text, text
) to authenticated;

create or replace function public.ordax_network_create_group_v2_proof(
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
  from private.ordax_network_create_group_internal_v2_proof(
    p_space_id,
    p_community_id,
    p_title,
    p_description,
    p_join_policy,
    p_client_idempotency_key
  );
$$;

revoke all on function public.ordax_network_create_group_v2_proof(
  uuid, text, text, text, text, text
) from public, anon;
grant execute on function public.ordax_network_create_group_v2_proof(
  uuid, text, text, text, text, text
) to authenticated;

create or replace function private.ordax_network_group_create_rate_count_v2_proof(
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
    raise exception 'network-group-create-v2-proof-rate-actor-mismatch'
      using errcode = '42501';
  end if;

  select rw.count into v_count
  from private.ordax_network_rate_windows rw
  where rw.actor_user_id = p_actor_user_id
    and rw.actor_space_id = p_actor_space_id
    and rw.operation = 'group-create';

  return coalesce(v_count, 0);
end;
$proof_rate$;

revoke all on function private.ordax_network_group_create_rate_count_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_group_create_rate_count_v2_proof(
  uuid, uuid
) to authenticated;

create or replace function private.ordax_network_group_create_snapshot_v2_proof(
  p_space_id uuid,
  p_client_idempotency_key text
)
returns table(
  group_id uuid,
  group_state text,
  title text,
  description text,
  join_policy text,
  owner_role text,
  owner_membership_state text,
  conversation_state text,
  conversation_member_state text
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
    g.group_id,
    g.state,
    g.title,
    g.description,
    g.join_policy,
    gm.role,
    gm.state,
    c.state,
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
  where g.owner_space_id = p_space_id
    and g.client_idempotency_key = p_client_idempotency_key;
end;
$proof_snapshot$;

revoke all on function private.ordax_network_group_create_snapshot_v2_proof(
  uuid, text
) from public, anon;
grant execute on function private.ordax_network_group_create_snapshot_v2_proof(
  uuid, text
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
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
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

-- First create applies exactly once and creates the complete owner/conversation
-- structure behind a canonical group id.
do $proof$
declare
  v_outcome record;
  v_snapshot record;
  v_first_id text;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Gestores de escolas',
    'Troca profissional',
    'members',
    'group-create-proof-key-0001'
  );

  if v_outcome.schema <> 'prototype-ordax.network-mutation-outcome/2'
     or v_outcome.outcome <> 'applied'
     or v_outcome.operation <> 'group-create'
     or v_outcome.code <> 'group-applied'
     or v_outcome.resource_id is null
     or v_outcome.retry_after_seconds is not null
     or v_outcome.idempotency_key <> 'group-create-proof-key-0001' then
    raise exception 'network-group-create-v2-proof-applied-shape-invalid';
  end if;

  v_first_id := v_outcome.resource_id;

  select * into v_snapshot
  from private.ordax_network_group_create_snapshot_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'group-create-proof-key-0001'
  );

  if v_snapshot.group_id::text <> v_first_id
     or v_snapshot.group_state <> 'active'
     or v_snapshot.title <> 'Gestores de escolas'
     or v_snapshot.description <> 'Troca profissional'
     or v_snapshot.join_policy <> 'members'
     or v_snapshot.owner_role <> 'owner'
     or v_snapshot.owner_membership_state <> 'active'
     or v_snapshot.conversation_state <> 'active'
     or v_snapshot.conversation_member_state <> 'active' then
    raise exception 'network-group-create-v2-proof-applied-state-invalid';
  end if;

  select private.ordax_network_group_create_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-create-v2-proof-applied-rate-count-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Gestores de escolas',
    'Troca profissional',
    'members',
    'group-create-proof-key-0001'
  );

  if v_outcome.outcome <> 'idempotent'
     or v_outcome.code <> 'group-idempotent'
     or v_outcome.resource_id <> v_first_id then
    raise exception 'network-group-create-v2-proof-idempotent-shape-invalid';
  end if;

  select private.ordax_network_group_create_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-create-v2-proof-idempotent-consumed-rate';
  end if;
end;
$proof$;

-- Same key with different canonical content is an invalid retry.
do $proof$
declare
  v_outcome record;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Outro nome',
    'Troca profissional',
    'members',
    'group-create-proof-key-0001'
  );

  if v_outcome.outcome <> 'invalid'
     or v_outcome.code <> 'group-idempotency-conflict'
     or v_outcome.resource_id is not null then
    raise exception 'network-group-create-v2-proof-conflict-shape-invalid';
  end if;

  select private.ordax_network_group_create_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-create-v2-proof-conflict-consumed-rate';
  end if;
end;
$proof$;

-- Invalid values and unsupported invite-only do not spend quota.
do $proof$
declare
  v_outcome record;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Grupo valido',
    null,
    'members',
    'short'
  );

  if v_outcome.outcome <> 'invalid'
     or v_outcome.code <> 'group-idempotency-key-invalid' then
    raise exception 'network-group-create-v2-proof-invalid-key-shape-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    '   ',
    null,
    'members',
    'group-create-proof-key-0098'
  );

  if v_outcome.outcome <> 'invalid'
     or v_outcome.code <> 'group-title-invalid' then
    raise exception 'network-group-create-v2-proof-invalid-title-shape-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Diretores convidados',
    null,
    'invite-only',
    'group-create-proof-key-0099'
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'group-invite-flow-not-ready'
     or v_outcome.resource_id is not null then
    raise exception 'network-group-create-v2-proof-invite-shape-invalid';
  end if;

  select private.ordax_network_group_create_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-create-v2-proof-invalid-consumed-rate';
  end if;
end;
$proof$;

-- Another account cannot create as Space A.
select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);

do $proof$
declare
  v_outcome record;
begin
  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Tentativa cruzada',
    null,
    'members',
    'group-create-proof-key-0100'
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'group-create-denied'
     or v_outcome.resource_id is not null then
    raise exception 'network-group-create-v2-proof-cross-account-denied-invalid';
  end if;
end;
$proof$;

-- A viewer can read Space A but does not acquire group-create authority.
select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  true
);

do $proof$
declare
  v_outcome record;
begin
  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Tentativa viewer',
    null,
    'members',
    'group-create-proof-key-0101'
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'group-create-denied'
     or v_outcome.resource_id is not null then
    raise exception 'network-group-create-v2-proof-viewer-denied-invalid';
  end if;
end;
$proof$;

-- Space B is authorized but is not a member of this community. The result is a
-- non-enumerating denial and no rate state is consumed.
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
  from public.ordax_network_create_group_v2_proof(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    'industry.education.school.br',
    'Sem comunidade',
    null,
    'members',
    'group-create-proof-key-0102'
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'group-community-membership-required'
     or v_outcome.resource_id is not null then
    raise exception 'network-group-create-v2-proof-community-denied-invalid';
  end if;

  select private.ordax_network_group_create_rate_count_v2_proof(
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_count;

  if v_count <> 0 then
    raise exception 'network-group-create-v2-proof-community-denied-consumed-rate';
  end if;
end;
$proof$;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

-- Cross-account/viewer denials did not mutate the owner's rate state.
do $proof$
declare
  v_count integer;
  v_snapshot record;
begin
  select private.ordax_network_group_create_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-group-create-v2-proof-denials-consumed-rate';
  end if;

  select * into v_snapshot
  from private.ordax_network_group_create_snapshot_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'group-create-proof-key-0100'
  );
  if v_snapshot.group_id is not null then
    raise exception 'network-group-create-v2-proof-cross-account-created-resource';
  end if;
end;
$proof$;

-- Fill the fixed window to its configured limit without creating resources.
do $proof$
declare
  i integer;
  v_allowed boolean;
begin
  for i in 2..10 loop
    select private.ordax_network_consume_rate_v1(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'group-create',
      10,
      3600
    ) into v_allowed;

    if not v_allowed then
      raise exception 'network-group-create-v2-proof-rate-prefill-rejected-early';
    end if;
  end loop;
end;
$proof$;

-- The next create is explicit rate_limited. Its provisional keyed group is
-- deleted, children were never created, and the durable counter remains 11.
do $proof$
declare
  v_outcome record;
  v_snapshot record;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_create_group_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Grupo acima do limite',
    null,
    'members',
    'group-create-proof-key-0002'
  );

  if v_outcome.outcome <> 'rate_limited'
     or v_outcome.code <> 'group-create-rate-limited'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is null
     or v_outcome.retry_after_seconds < 1
     or v_outcome.retry_after_seconds > 3600 then
    raise exception 'network-group-create-v2-proof-rate-limited-shape-invalid';
  end if;

  select private.ordax_network_group_create_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 11 then
    raise exception 'network-group-create-v2-proof-rate-state-not-durable';
  end if;

  select * into v_snapshot
  from private.ordax_network_group_create_snapshot_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'group-create-proof-key-0002'
  );

  if v_snapshot.group_id is not null
     or v_snapshot.owner_membership_state is not null
     or v_snapshot.conversation_state is not null
     or v_snapshot.conversation_member_state is not null then
    raise exception 'network-group-create-v2-proof-rate-limited-resource-persisted';
  end if;
end;
$proof$;

reset role;
rollback;

\echo NETWORK_GROUP_CREATE_V2_SQL_PROOF=PASS
