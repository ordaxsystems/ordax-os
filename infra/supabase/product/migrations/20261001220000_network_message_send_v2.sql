-- OrdaX Network MVP: promote the proven message-send v2 mutation outcome boundary.
--
-- This migration preserves the v1 server-authoritative Space/session boundary and
-- adds an explicit v2 result contract for the Surface transport. It does not
-- grant direct table access and does not activate Network in any composition.

begin;

create or replace function private.ordax_network_send_message_internal_v2(
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

  -- Message bodies are persisted as plain text. Tabs/newlines/carriage returns
  -- are valid formatting; all other C0/DEL control characters are rejected
  -- before authority lookup, rate consumption or persistence.
  if translate(v_body, E'\t\n\r', '') ~ '[[:cntrl:]]' then
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

revoke all on function private.ordax_network_send_message_internal_v2(
  uuid, uuid, text, text
) from public, anon;
grant execute on function private.ordax_network_send_message_internal_v2(
  uuid, uuid, text, text
) to authenticated;

create or replace function public.ordax_network_send_message_v2(
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
  from private.ordax_network_send_message_internal_v2(
    p_space_id,
    p_conversation_id,
    p_client_idempotency_key,
    p_body
  );
$$;

revoke all on function public.ordax_network_send_message_v2(
  uuid, uuid, text, text
) from public, anon;
grant execute on function public.ordax_network_send_message_v2(
  uuid, uuid, text, text
) to authenticated;

commit;
