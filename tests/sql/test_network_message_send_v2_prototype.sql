\set ON_ERROR_STOP on

-- The workflow executes test_network_multitenant_hardening.sql immediately
-- before this file. That proof leaves the canonical schema/migrations in place
-- but rolls back all fixture data, so v2 starts from a clean proven schema.
begin;

-- Prototype only: this function is intentionally created inside the proof
-- transaction and rolled back. The committed schema is not changed by this file.
create or replace function private.ordax_network_send_message_internal_v2_proof(
  p_space_id uuid,
  p_conversation_id uuid,
  p_client_idempotency_key text,
  p_body text
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
as $send_v2$
declare
  v_actor uuid;
  v_body text := btrim(p_body);
  v_row public.ordax_network_messages;
  v_inserted boolean := false;
  v_retry_after integer := null;
begin
  if p_client_idempotency_key is null
     or char_length(p_client_idempotency_key) not between 16 and 120
     or p_client_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'message-send',
      'message-idempotency-key-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if v_body is null or char_length(v_body) not between 1 and 4000 then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'message-send',
      'message-body-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  -- Message bodies are stored as plain text. Tabs/newlines/carriage returns are
  -- valid formatting; other C0/DEL control characters are rejected before any
  -- authority lookup, rate consumption or persistence.
  if translate(v_body, E'\\t\\n\\r', '') ~ '[[:cntrl:]]' then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'message-send',
      'message-body-control-character',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  begin
    v_actor := private.ordax_network_assert_conversation_sender_v1(
      p_space_id,
      p_conversation_id
    );
  exception
    when sqlstate '42501' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'message-send',
        'message-send-denied',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
  end;

  insert into public.ordax_network_messages(
    conversation_id,
    sender_space_id,
    sender_user_id,
    client_idempotency_key,
    body
  ) values (
    p_conversation_id,
    p_space_id,
    v_actor,
    p_client_idempotency_key,
    v_body
  )
  on conflict (sender_space_id, client_idempotency_key) do nothing
  returning * into v_row;

  v_inserted := found;

  if not v_inserted then
    select m.* into v_row
    from public.ordax_network_messages m
    where m.sender_space_id = p_space_id
      and m.client_idempotency_key = p_client_idempotency_key;

    if not found then
      raise exception 'network-message-v2-idempotency-resolution-failed'
        using errcode = '40001';
    end if;

    if v_row.conversation_id <> p_conversation_id or v_row.body <> v_body then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'invalid',
        'message-send',
        'message-idempotency-conflict',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'idempotent',
      'message-send',
      'message-idempotent',
      v_row.message_id::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if not private.ordax_network_consume_rate_v1(
    v_actor,
    p_space_id,
    'message-send',
    120,
    60
  ) then
    delete from public.ordax_network_messages
    where message_id = v_row.message_id;

    select greatest(
      1,
      least(
        60,
        ceil(
          extract(
            epoch from (
              r.window_started_at
              + interval '60 seconds'
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
      and r.operation = 'message-send';

    if v_retry_after is null then
      raise exception 'network-message-v2-rate-state-missing'
        using errcode = '55000';
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'rate_limited',
      'message-send',
      'message-rate-limited',
      null::text,
      v_retry_after,
      p_client_idempotency_key;
    return;
  end if;

  update public.ordax_network_conversations c
  set last_message_at = v_row.created_at,
      last_message_id = v_row.message_id
  where c.conversation_id = p_conversation_id;

  insert into private.ordax_network_audit_events(
    actor_user_id,
    actor_space_id,
    event_type,
    resource_type,
    resource_id
  ) values (
    v_actor,
    p_space_id,
    'message-sent',
    'message',
    v_row.message_id::text
  );

  return query select
    'prototype-ordax.network-mutation-outcome/2',
    'applied',
    'message-send',
    'message-applied',
    v_row.message_id::text,
    null::integer,
    p_client_idempotency_key;
end;
$send_v2$;

revoke all on function private.ordax_network_send_message_internal_v2_proof(
  uuid, uuid, text, text
) from public, anon;
grant execute on function private.ordax_network_send_message_internal_v2_proof(
  uuid, uuid, text, text
) to authenticated;

create or replace function public.ordax_network_send_message_v2_proof(
  p_space_id uuid,
  p_conversation_id uuid,
  p_client_idempotency_key text,
  p_body text
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
  from private.ordax_network_send_message_internal_v2_proof(
    p_space_id,
    p_conversation_id,
    p_client_idempotency_key,
    p_body
  );
$$;

revoke all on function public.ordax_network_send_message_v2_proof(
  uuid, uuid, text, text
) from public, anon;
grant execute on function public.ordax_network_send_message_v2_proof(
  uuid, uuid, text, text
) to authenticated;

-- Proof-only introspection helpers: authenticated callers can inspect only their
-- own Space-scoped test state. Direct table grants remain closed.
create or replace function private.ordax_network_rate_count_v2_proof(
  p_actor_user_id uuid,
  p_actor_space_id uuid,
  p_operation text
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
    raise exception 'network-v2-proof-rate-actor-mismatch'
      using errcode = '42501';
  end if;

  select r.count into v_count
  from private.ordax_network_rate_windows r
  where r.actor_user_id = p_actor_user_id
    and r.actor_space_id = p_actor_space_id
    and r.operation = p_operation;

  return coalesce(v_count, 0);
end;
$proof_rate$;

revoke all on function private.ordax_network_rate_count_v2_proof(
  uuid, uuid, text
) from public, anon;
grant execute on function private.ordax_network_rate_count_v2_proof(
  uuid, uuid, text
) to authenticated;

create or replace function private.ordax_network_message_exists_v2_proof(
  p_space_id uuid,
  p_client_idempotency_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $proof_message$
begin
  perform private.ordax_network_assert_space_actor_v1(p_space_id, false);

  return exists (
    select 1
    from public.ordax_network_messages m
    where m.sender_space_id = p_space_id
      and m.client_idempotency_key = p_client_idempotency_key
  );
end;
$proof_message$;

revoke all on function private.ordax_network_message_exists_v2_proof(
  uuid, text
) from public, anon;
grant execute on function private.ordax_network_message_exists_v2_proof(
  uuid, text
) to authenticated;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');

insert into public.ordax_spaces(space_id, owner_user_id, name, kind, state) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'Escola Horizonte', 'professional', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'Papelaria Bairro', 'professional', 'active');

insert into public.ordax_space_members(space_id, user_id, role, state) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '33333333-3333-4333-8333-333333333333', 'viewer', 'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select public.ordax_network_upsert_space_profile_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'Escola Horizonte',
  'Escola de bairro',
  'Salvador - BA',
  array['education','school'],
  'discoverable'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select public.ordax_network_upsert_space_profile_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'Papelaria Bairro',
  null,
  'Salvador - BA',
  array['retail'],
  'discoverable'
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

create temporary table v2_proof_state (
  key text primary key,
  value text not null
);
grant select, insert, update on v2_proof_state to authenticated;

insert into v2_proof_state(key, value)
select
  'conversation',
  public.ordax_network_create_direct_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  )::text;

reset role;

-- Put this actor one request below the limit in the current fixed minute.
insert into private.ordax_network_rate_windows(
  actor_user_id,
  actor_space_id,
  operation,
  window_started_at,
  count
) values (
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'message-send',
  to_timestamp(
    floor(extract(epoch from statement_timestamp()) / 60) * 60
  ),
  119
)
on conflict (actor_user_id, actor_space_id, operation)
do update set
  window_started_at = excluded.window_started_at,
  count = excluded.count;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
declare
  v_outcome record;
  v_first_id text;
  v_count integer;
begin
  select * into v_outcome
  from public.ordax_network_send_message_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value::uuid from v2_proof_state where key = 'conversation'),
    'message-proof-key-0001',
    'Primeiro aviso'
  );

  if v_outcome.schema <> 'prototype-ordax.network-mutation-outcome/2'
     or v_outcome.outcome <> 'applied'
     or v_outcome.code <> 'message-applied'
     or v_outcome.resource_id is null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-message-v2-proof-applied-shape-invalid';
  end if;

  v_first_id := v_outcome.resource_id;

  select private.ordax_network_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'message-send'
  ) into v_count;

  if v_count <> 120 then
    raise exception 'network-message-v2-proof-applied-rate-count-invalid';
  end if;

  select * into v_outcome
  from public.ordax_network_send_message_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value::uuid from v2_proof_state where key = 'conversation'),
    'message-proof-key-0001',
    'Primeiro aviso'
  );

  if v_outcome.outcome <> 'idempotent'
     or v_outcome.code <> 'message-idempotent'
     or v_outcome.resource_id <> v_first_id
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-message-v2-proof-idempotent-shape-invalid';
  end if;

  select private.ordax_network_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'message-send'
  ) into v_count;

  if v_count <> 120 then
    raise exception 'network-message-v2-proof-idempotent-consumed-rate';
  end if;

  select * into v_outcome
  from public.ordax_network_send_message_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value::uuid from v2_proof_state where key = 'conversation'),
    'message-proof-key-0002',
    'Segundo aviso'
  );

  if v_outcome.outcome <> 'rate_limited'
     or v_outcome.code <> 'message-rate-limited'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds not between 1 and 60 then
    raise exception 'network-message-v2-proof-rate-limit-shape-invalid';
  end if;

  select private.ordax_network_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'message-send'
  ) into v_count;

  if v_count <> 121 then
    raise exception 'network-message-v2-proof-rate-state-not-durable';
  end if;

  if private.ordax_network_message_exists_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'message-proof-key-0002'
  ) then
    raise exception 'network-message-v2-proof-rate-limited-message-persisted';
  end if;
end;
$proof$;

-- Invalid input is explicit and does not consume quota.
do $proof$
declare
  v_outcome record;
  v_before integer;
  v_after integer;
begin
  select private.ordax_network_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'message-send'
  ) into v_before;

  select * into v_outcome
  from public.ordax_network_send_message_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value::uuid from v2_proof_state where key = 'conversation'),
    'short',
    'Nao deve enviar'
  );

  if v_outcome.outcome <> 'invalid'
     or v_outcome.code <> 'message-idempotency-key-invalid'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-message-v2-proof-invalid-shape-invalid';
  end if;

  select private.ordax_network_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'message-send'
  ) into v_after;

  if v_after <> v_before then
    raise exception 'network-message-v2-proof-invalid-consumed-rate';
  end if;

  select * into v_outcome
  from public.ordax_network_send_message_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value::uuid from v2_proof_state where key = 'conversation'),
    'message-proof-key-ctrl01',
    'controle' || chr(1) || 'invalido'
  );

  if v_outcome.outcome <> 'invalid'
     or v_outcome.code <> 'message-body-control-character'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-message-v2-proof-control-character-shape-invalid';
  end if;

  if private.ordax_network_message_exists_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'message-proof-key-ctrl01'
  ) then
    raise exception 'network-message-v2-proof-control-character-persisted';
  end if;

  select private.ordax_network_rate_count_v2_proof(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'message-send'
  ) into v_after;

  if v_after <> v_before then
    raise exception 'network-message-v2-proof-control-character-consumed-rate';
  end if;
end;
$proof$;

-- Viewer read authority must not become sender authority; denial is explicit.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);

do $proof$
declare
  v_outcome record;
begin
  select * into v_outcome
  from public.ordax_network_send_message_v2_proof(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value::uuid from v2_proof_state where key = 'conversation'),
    'message-proof-key-0003',
    'Viewer nao envia'
  );

  if v_outcome.outcome <> 'denied'
     or v_outcome.code <> 'message-send-denied'
     or v_outcome.resource_id is not null
     or v_outcome.retry_after_seconds is not null then
    raise exception 'network-message-v2-proof-denied-shape-invalid';
  end if;
end;
$proof$;

reset role;

rollback;

\echo NETWORK_MESSAGE_SEND_V2_SQL_PROOF=PASS
