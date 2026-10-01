\set ON_ERROR_STOP on

-- The canonical v1 multi-tenant proof runs first in the workflow and leaves
-- only the proven schema behind. This prototype is fully rolled back.
begin;

create or replace function private.ordax_network_block_resource_id_v2_proof(
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

revoke all on function private.ordax_network_block_resource_id_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_block_resource_id_v2_proof(
  uuid, uuid
) to authenticated;

create or replace function private.ordax_network_set_block_internal_v2_proof(
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

  v_resource_id := private.ordax_network_block_resource_id_v2_proof(
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

revoke all on function private.ordax_network_set_block_internal_v2_proof(
  uuid, uuid, boolean
) from public, anon;
grant execute on function private.ordax_network_set_block_internal_v2_proof(
  uuid, uuid, boolean
) to authenticated;

create or replace function public.ordax_network_set_block_v2_proof(
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
  from private.ordax_network_set_block_internal_v2_proof(
    p_space_id,
    p_target_space_id,
    p_blocked
  );
$$;

revoke all on function public.ordax_network_set_block_v2_proof(
  uuid, uuid, boolean
) from public, anon;
grant execute on function public.ordax_network_set_block_v2_proof(
  uuid, uuid, boolean
) to authenticated;

create or replace function private.ordax_network_block_rate_count_v2_proof(
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
    raise exception 'network-block-v2-proof-rate-actor-mismatch'
      using errcode = '42501';
  end if;

  select r.count into v_count
  from private.ordax_network_rate_windows r
  where r.actor_user_id = p_actor_user_id
    and r.actor_space_id = p_actor_space_id
    and r.operation = 'block-change';

  return coalesce(v_count, 0);
end;
$proof_rate$;

revoke all on function private.ordax_network_block_rate_count_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_block_rate_count_v2_proof(
  uuid, uuid
) to authenticated;

create or replace function private.ordax_network_block_exists_v2_proof(
  p_space_id uuid,
  p_target_space_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $proof_block$
begin
  perform private.ordax_network_assert_space_actor_v1(p_space_id, false);

  return exists (
    select 1
    from public.ordax_network_blocks b
    where b.blocker_space_id = p_space_id
      and b.blocked_space_id = p_target_space_id
  );
end;
$proof_block$;

revoke all on function private.ordax_network_block_exists_v2_proof(
  uuid, uuid
) from public, anon;
grant execute on function private.ordax_network_block_exists_v2_proof(
  uuid, uuid
) to authenticated;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

insert into public.ordax_spaces(
  space_id,
  owner_user_id,
  name,
  kind,
  state
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'Escola Horizonte', 'professional', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'Papelaria Bairro', 'professional', 'active'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '33333333-3333-4333-8333-333333333333', 'Livraria Centro', 'professional', 'active');

insert into public.ordax_space_members(
  space_id,
  user_id,
  role,
  state
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '44444444-4444-4444-8444-444444444444',
  'viewer',
  'active'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);

-- Block apply + idempotent retry.
do $proof$
declare
  v_outcome record;
  v_resource_id text;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_set_block_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    true
  );

  if v_outcome.schema <> 'prototype-ordax.network-mutation-outcome/2'
     or v_outcome.outcome <> 'applied'
     or v_outcome.operation <> 'block-change'
     or v_outcome.code <> 'block-applied'
     or v_outcome.resource_id is null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-block-v2-proof-applied-shape-invalid';
  end if;

  v_resource_id := v_outcome.resource_id;

  select private.ordax_network_block_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-block-v2-proof-applied-rate-count-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_set_block_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    true
  );

  if v_outcome.outcome <> 'idempotent'
     or v_outcome.code <> 'block-already-applied'
     or v_outcome.resource_id <> v_resource_id
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-block-v2-proof-idempotent-shape-invalid';
  end if;

  select private.ordax_network_block_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 1 then
    raise exception 'network-block-v2-proof-idempotent-consumed-rate';
  end if;
end;
$proof$;

-- Unblock apply + idempotent retry use the same logical resource id.
do $proof$
declare
  v_outcome record;
  v_resource_id text;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_set_block_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    false
  );

  if v_outcome.outcome <> 'applied'
     or v_outcome.code <> 'unblock-applied'
     or v_outcome.resource_id is null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-unblock-v2-proof-applied-shape-invalid';
  end if;

  v_resource_id := v_outcome.resource_id;

  select private.ordax_network_block_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 2 then
    raise exception 'network-unblock-v2-proof-applied-rate-count-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_set_block_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    false
  );

  if v_outcome.outcome <> 'idempotent'
     or v_outcome.code <> 'block-already-removed'
     or v_outcome.resource_id <> v_resource_id then
    raise exception 'network-unblock-v2-proof-idempotent-shape-invalid';
  end if;

  select private.ordax_network_block_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 2 then
    raise exception 'network-unblock-v2-proof-idempotent-consumed-rate';
  end if;
end;
$proof$;

-- Invalid self-target must not consume quota.
do $proof$
declare
  v_outcome record;
  v_before integer;
  v_after integer;
begin
  select private.ordax_network_block_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_before;

  select * into v_outcome
  from public.ordax_network_set_block_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    true
  );

  if v_outcome.outcome <> 'invalid'
     or v_outcome.code <> 'block-target-invalid'
     or v_outcome.resource_id is not null then
    raise exception 'network-block-v2-proof-invalid-shape-invalid';
  end if;

  select private.ordax_network_block_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_after;

  if v_after <> v_before then
    raise exception 'network-block-v2-proof-invalid-consumed-rate';
  end if;
end;
$proof$;

reset role;

-- Put actor at the limit. A new block is provisional and must disappear when
-- the limiter rejects the mutation while the counter itself remains durable.
insert into private.ordax_network_rate_windows(
  actor_user_id,
  actor_space_id,
  operation,
  window_started_at,
  count
) values (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'block-change',
  to_timestamp(
    floor(extract(epoch from statement_timestamp()) / 3600) * 3600
  ),
  60
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
  from public.ordax_network_set_block_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    true
  );

  if v_outcome.outcome <> 'rate_limited'
     or v_outcome.code <> 'block-rate-limited'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds not between 1 and 3600 then
    raise exception 'network-block-v2-proof-rate-limit-shape-invalid';
  end if;

  select private.ordax_network_block_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ) into v_count;

  if v_count <> 61 then
    raise exception 'network-block-v2-proof-rate-state-not-durable';
  end if;

  if private.ordax_network_block_exists_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  ) then
    raise exception 'network-block-v2-proof-rate-limited-block-persisted';
  end if;
end;
$proof$;

-- Viewer cannot mutate the professional Space even if the target is valid.
select set_config(
  'request.jwt.claim.sub',
  '44444444-4444-4444-8444-444444444444',
  true
);

do $proof$
declare
  v_outcome record;
begin
  select * into v_outcome
  from public.ordax_network_set_block_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    true
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'block-change-denied'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-block-v2-proof-viewer-denied-shape-invalid';
  end if;
end;
$proof$;

reset role;

rollback;

\echo NETWORK_BLOCK_CHANGE_V2_SQL_PROOF=PASS
