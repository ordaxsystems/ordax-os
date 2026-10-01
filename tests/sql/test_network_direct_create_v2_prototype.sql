\set ON_ERROR_STOP on

-- The workflow executes test_network_multitenant_hardening.sql immediately
-- before this file. That proof leaves the canonical schema/migrations in place
-- but rolls back all fixture data, so direct-create v2 starts from a clean schema.
begin;

-- Prototype only: these functions exist inside the proof transaction and are
-- rolled back. No committed Supabase schema is changed by this file.
create or replace function private.ordax_network_create_direct_internal_v2_proof(
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

revoke all on function private.ordax_network_create_direct_internal_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_create_direct_internal_v2_proof(
  uuid, uuid
) to authenticated;

create or replace function public.ordax_network_create_direct_v2_proof(
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
  from private.ordax_network_create_direct_internal_v2_proof(
    p_space_id,
    p_target_space_id
  );
$$;

revoke all on function public.ordax_network_create_direct_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function public.ordax_network_create_direct_v2_proof(
  uuid, uuid
) to authenticated;

-- Proof-only scoped inspection. Direct table grants stay closed.
create or replace function private.ordax_network_direct_rate_count_v2_proof(
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
    raise exception 'network-direct-v2-proof-rate-actor-mismatch'
      using errcode = '42501';
  end if;

  select r.count into v_count
  from private.ordax_network_rate_windows r
  where r.actor_user_id = p_actor_user_id
    and r.actor_space_id = p_actor_space_id
    and r.operation = 'direct-create';

  return coalesce(v_count, 0);
end;
$proof_rate$;

revoke all on function private.ordax_network_direct_rate_count_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_direct_rate_count_v2_proof(
  uuid, uuid
) to authenticated;

create or replace function private.ordax_network_direct_exists_v2_proof(
  p_space_id uuid,
  p_target_space_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $proof_direct$
declare
  v_pair_key text;
begin
  perform private.ordax_network_assert_space_actor_v1(p_space_id, false);
  v_pair_key := private.ordax_network_direct_pair_key_v1(
    p_space_id,
    p_target_space_id
  );

  return exists (
    select 1
    from public.ordax_network_conversations c
    where c.kind = 'direct'
      and c.direct_pair_key = v_pair_key
  );
end;
$proof_direct$;

revoke all on function private.ordax_network_direct_exists_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_direct_exists_v2_proof(
  uuid, uuid
) to authenticated;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555');

insert into public.ordax_spaces(
  space_id,
  owner_user_id,
  name,
  kind,
  state
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'Escola Horizonte', 'professional', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'Papelaria Bairro', 'professional', 'active'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '33333333-3333-4333-8333-333333333333', 'Livraria Centro', 'professional', 'active'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '44444444-4444-4444-8444-444444444444', 'Grafica Cidade', 'professional', 'active');

insert into public.ordax_space_members(
  space_id,
  user_id,
  role,
  state
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '55555555-5555-4555-8555-555555555555',
  'viewer',
  'active'
);

set local role authenticated;

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select public.ordax_network_upsert_space_profile_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'Escola Horizonte',
  'Escola de bairro',
  'Salvador - BA',
  array['education','school'],
  'discoverable'
);

select set_config(
  'request.jwt.claim.sub',
  '22222222-2222-4222-8222-222222222222',
  true
);
select public.ordax_network_upsert_space_profile_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'Papelaria Bairro',
  null,
  'Salvador - BA',
  array['retail'],
  'discoverable'
);

select set_config(
  'request.jwt.claim.sub',
  '33333333-3333-4333-8333-333333333333',
  true
);
select public.ordax_network_upsert_space_profile_v1(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'Livraria Centro',
  null,
  'Salvador - BA',
  array['retail'],
  'discoverable'
);

select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-8444-444444444444',
  true
);
select public.ordax_network_upsert_space_profile_v1(
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  'Grafica Cidade',
  null,
  'Salvador - BA',
  array['services'],
  'discoverable'
);

select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

-- Applied + idempotent: retry must return the canonical conversation and must
-- not consume a second direct-create quota unit.
do $proof$
declare
  v_outcome record;
  v_first_id text;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_create_direct_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  );

  if v_outcome.schema <> 'prototype-ordax.network-mutation-outcome/2'
     or v_outcome.outcome <> 'applied'
     or v_outcome.operation <> 'direct-create'
     or v_outcome.code <> 'direct-applied'
     or v_outcome.resource_id is null
     or v_outcome.retry_after_seconds is not null
     or v_outcome.idempotency_key is not null then
    raise exception 'network-direct-v2-proof-applied-shape-invalid';
  end if;

  v_first_id := v_outcome.resource_id;

  select private.ordax_network_direct_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-direct-v2-proof-applied-rate-count-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_create_direct_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  );

  if v_outcome.outcome <> 'idempotent'
     or v_outcome.code <> 'direct-idempotent'
     or v_outcome.resource_id <> v_first_id
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-direct-v2-proof-idempotent-shape-invalid';
  end if;

  select private.ordax_network_direct_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-direct-v2-proof-idempotent-consumed-rate';
  end if;
end;
$proof$;

-- Invalid self-target is explicit and consumes no quota.
do $proof$
declare
  v_outcome record;
  v_before integer;
  v_after integer;
begin
  select private.ordax_network_direct_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_before;

  select * into v_outcome
  from public.ordax_network_create_direct_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  );

  if v_outcome.outcome <> 'invalid'
     or v_outcome.code <> 'direct-target-invalid'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-direct-v2-proof-invalid-shape-invalid';
  end if;

  select private.ordax_network_direct_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_after;

  if v_after <> v_before then
    raise exception 'network-direct-v2-proof-invalid-consumed-rate';
  end if;
end;
$proof$;

reset role;

-- A bidirectional block must deny before consuming direct-create quota.
insert into public.ordax_network_blocks(
  blocker_space_id,
  blocked_space_id,
  created_by
) values (
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '33333333-3333-4333-8333-333333333333'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

do $proof$
declare
  v_outcome record;
  v_before integer;
  v_after integer;
begin
  select private.ordax_network_direct_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_before;

  select * into v_outcome
  from public.ordax_network_create_direct_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'direct-blocked'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-direct-v2-proof-blocked-shape-invalid';
  end if;

  select private.ordax_network_direct_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_after;

  if v_after <> v_before then
    raise exception 'network-direct-v2-proof-blocked-consumed-rate';
  end if;
end;
$proof$;

reset role;

-- Put the owner at the current direct-create limit. The next new pair must be
-- explicitly rate-limited and its provisional conversation must be removed.
insert into private.ordax_network_rate_windows(
  actor_user_id,
  actor_space_id,
  operation,
  window_started_at,
  count
) values (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'direct-create',
  to_timestamp(
    floor(extract(epoch from statement_timestamp()) / 3600) * 3600
  ),
  30
)
on conflict (actor_user_id, actor_space_id, operation)
do update set
  window_started_at = excluded.window_started_at,
  count = excluded.count;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

do $proof$
declare
  v_outcome record;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_create_direct_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  );

  if v_outcome.outcome <> 'rate_limited'
     or v_outcome.code <> 'direct-rate-limited'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds not between 1 and 3600 then
    raise exception 'network-direct-v2-proof-rate-limit-shape-invalid';
  end if;

  select private.ordax_network_direct_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 31 then
    raise exception 'network-direct-v2-proof-rate-state-not-durable';
  end if;

  if private.ordax_network_direct_exists_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  ) then
    raise exception 'network-direct-v2-proof-rate-limited-conversation-persisted';
  end if;
end;
$proof$;

-- Viewer authority is read-only and must not create a professional conversation.
select set_config(
  'request.jwt.claim.sub',
  '55555555-5555-4555-8555-555555555555',
  true
);

do $proof$
declare
  v_outcome record;
begin
  select * into v_outcome
  from public.ordax_network_create_direct_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'direct-create-denied'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-direct-v2-proof-viewer-denied-shape-invalid';
  end if;
end;
$proof$;

reset role;

rollback;

\echo NETWORK_DIRECT_CREATE_V2_SQL_PROOF=PASS
