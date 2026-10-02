-- OrdaX Network MVP: promote the proven report-create v2 mutation outcome boundary.
--
-- The idempotency column is deliberately nullable for legacy v1 rows. New v2
-- reports require a bounded client key unique within the reporter Space.
-- No direct table access is granted and Network activation remains unchanged.

begin;

alter table public.ordax_network_reports
  add column client_idempotency_key text;

alter table public.ordax_network_reports
  add constraint ordax_network_reports_client_idempotency_key_v2_check
  check (
    client_idempotency_key is null
    or (
      char_length(client_idempotency_key) between 16 and 120
      and client_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    )
  );

create unique index ordax_network_reports_space_idempotency_v2_idx
  on public.ordax_network_reports(reporter_space_id, client_idempotency_key)
  where client_idempotency_key is not null;

create or replace function private.ordax_network_create_report_internal_v2(
  p_space_id uuid,
  p_target_type text,
  p_target_id text,
  p_reason text,
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
as $report_v2$
declare
  v_actor uuid;
  v_reason text := btrim(p_reason);
  v_row public.ordax_network_reports;
  v_inserted boolean := false;
  v_retry_after integer;
  v_message_conversation_id uuid;
begin
  if p_target_type not in ('space','group','message') then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'report-create',
      'report-target-type-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if p_target_id is null or char_length(p_target_id) not between 1 and 160 then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'report-create',
      'report-target-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if v_reason is null or char_length(v_reason) not between 8 and 500 then
    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'invalid',
      'report-create',
      'report-reason-invalid',
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
      'report-create',
      'report-idempotency-key-invalid',
      null::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  begin
    v_actor := private.ordax_network_assert_space_actor_v1(
      p_space_id,
      false
    );
  exception
    when sqlstate '42501' then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'report-create',
        'report-create-denied',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
  end;

  -- Validate target visibility after source-Space authority is established.
  if p_target_type = 'space' then
    if not exists (
      select 1
      from public.ordax_network_space_profiles p
      join public.ordax_spaces s on s.space_id = p.space_id
      where p.space_id::text = p_target_id
        and p.visibility = 'discoverable'
        and s.state = 'active'
        and s.kind = 'professional'
    ) then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'report-create',
        'report-target-unavailable',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

  elsif p_target_type = 'group' then
    if not exists (
      select 1
      from public.ordax_network_groups g
      join public.ordax_network_memberships cm
        on cm.community_id = g.community_id
      left join public.ordax_network_group_memberships gm
        on gm.group_id = g.group_id
       and gm.space_id = p_space_id
      where g.group_id::text = p_target_id
        and g.state = 'active'
        and cm.space_id = p_space_id
        and cm.state = 'active'
        and (
          g.join_policy = 'members'
          or gm.state = 'active'
        )
    ) then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'report-create',
        'report-target-unavailable',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

  else
    select m.conversation_id
    into v_message_conversation_id
    from public.ordax_network_messages m
    where m.message_id::text = p_target_id;

    if v_message_conversation_id is null then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'denied',
        'report-create',
        'report-target-unavailable',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

    begin
      perform private.ordax_network_assert_conversation_reader_v1(
        p_space_id,
        v_message_conversation_id
      );
    exception
      when sqlstate '42501' then
        return query select
          'prototype-ordax.network-mutation-outcome/2',
          'denied',
          'report-create',
          'report-target-unavailable',
          null::text,
          null::integer,
          p_client_idempotency_key;
        return;
    end;
  end if;

  insert into public.ordax_network_reports(
    reporter_space_id,
    target_type,
    target_id,
    reason,
    created_by,
    client_idempotency_key
  ) values (
    p_space_id,
    p_target_type,
    p_target_id,
    v_reason,
    v_actor,
    p_client_idempotency_key
  )
  on conflict (reporter_space_id, client_idempotency_key)
    where client_idempotency_key is not null
  do nothing
  returning * into v_row;

  v_inserted := found;

  if not v_inserted then
    select r.* into v_row
    from public.ordax_network_reports r
    where r.reporter_space_id = p_space_id
      and r.client_idempotency_key = p_client_idempotency_key;

    if not found then
      raise exception 'network-report-v2-idempotency-resolution-failed'
        using errcode = '40001';
    end if;

    if v_row.target_type <> p_target_type
       or v_row.target_id <> p_target_id
       or v_row.reason <> v_reason then
      return query select
        'prototype-ordax.network-mutation-outcome/2',
        'invalid',
        'report-create',
        'report-idempotency-conflict',
        null::text,
        null::integer,
        p_client_idempotency_key;
      return;
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'idempotent',
      'report-create',
      'report-idempotent',
      v_row.report_id::text,
      null::integer,
      p_client_idempotency_key;
    return;
  end if;

  if not private.ordax_network_consume_rate_v1(
    v_actor,
    p_space_id,
    'report-create',
    20,
    3600
  ) then
    delete from public.ordax_network_reports
    where report_id = v_row.report_id;

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
      and rw.operation = 'report-create';

    if v_retry_after is null then
      raise exception 'network-report-v2-rate-state-missing'
        using errcode = '55000';
    end if;

    return query select
      'prototype-ordax.network-mutation-outcome/2',
      'rate_limited',
      'report-create',
      'report-rate-limited',
      null::text,
      v_retry_after,
      p_client_idempotency_key;
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
    'report-created',
    'report',
    v_row.report_id::text
  );

  return query select
    'prototype-ordax.network-mutation-outcome/2',
    'applied',
    'report-create',
    'report-applied',
    v_row.report_id::text,
    null::integer,
    p_client_idempotency_key;
end;
$report_v2$;

revoke all on function private.ordax_network_create_report_internal_v2(
  uuid, text, text, text, text
) from public, anon;
grant execute on function private.ordax_network_create_report_internal_v2(
  uuid, text, text, text, text
) to authenticated;

create or replace function public.ordax_network_create_report_v2(
  p_space_id uuid,
  p_target_type text,
  p_target_id text,
  p_reason text,
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
  from private.ordax_network_create_report_internal_v2(
    p_space_id,
    p_target_type,
    p_target_id,
    p_reason,
    p_client_idempotency_key
  );
$$;

revoke all on function public.ordax_network_create_report_v2(
  uuid, text, text, text, text
) from public, anon;
grant execute on function public.ordax_network_create_report_v2(
  uuid, text, text, text, text
) to authenticated;

commit;
