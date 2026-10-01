-- OrdaX Network MVP security hardening.
--
-- This migration fixes lifecycle, authorization and concurrency invariants before
-- any public Network rollout. It deliberately follows the existing migrations
-- instead of pretending those earlier source states were already production-safe.

begin;

-- ---------------------------------------------------------------------------
-- 1. Account / Space lifecycle
-- ---------------------------------------------------------------------------
-- Account close uses Supabase auth.admin.deleteUser(), so collaborative Network
-- rows must never block auth-user / Space deletion through RESTRICT actor FKs.
-- Attribution is tombstoned with SET NULL; collaborative content may remain
-- according to its own retention lifecycle.

alter table public.ordax_network_memberships
  alter column joined_by drop not null;
alter table public.ordax_network_memberships
  drop constraint if exists ordax_network_memberships_joined_by_fkey;
alter table public.ordax_network_memberships
  add constraint ordax_network_memberships_joined_by_fkey
  foreign key (joined_by) references auth.users(id) on delete set null;

alter table private.ordax_network_membership_audit
  alter column actor_user_id drop not null,
  alter column space_id drop not null;
alter table private.ordax_network_membership_audit
  add constraint ordax_network_membership_audit_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete set null;
alter table private.ordax_network_membership_audit
  add constraint ordax_network_membership_audit_space_id_fkey
  foreign key (space_id) references public.ordax_spaces(space_id) on delete set null;

alter table public.ordax_network_groups
  alter column owner_space_id drop not null,
  alter column created_by drop not null;
alter table public.ordax_network_groups
  drop constraint if exists ordax_network_groups_owner_space_id_fkey;
alter table public.ordax_network_groups
  drop constraint if exists ordax_network_groups_created_by_fkey;
alter table public.ordax_network_groups
  add constraint ordax_network_groups_owner_space_id_fkey
  foreign key (owner_space_id) references public.ordax_spaces(space_id) on delete set null;
alter table public.ordax_network_groups
  add constraint ordax_network_groups_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.ordax_network_group_memberships
  alter column joined_by drop not null;
alter table public.ordax_network_group_memberships
  drop constraint if exists ordax_network_group_memberships_joined_by_fkey;
alter table public.ordax_network_group_memberships
  add constraint ordax_network_group_memberships_joined_by_fkey
  foreign key (joined_by) references auth.users(id) on delete set null;

alter table public.ordax_network_messages
  alter column sender_space_id drop not null,
  alter column sender_user_id drop not null;
alter table public.ordax_network_messages
  drop constraint if exists ordax_network_messages_sender_space_id_fkey;
alter table public.ordax_network_messages
  drop constraint if exists ordax_network_messages_sender_user_id_fkey;
alter table public.ordax_network_messages
  add constraint ordax_network_messages_sender_space_id_fkey
  foreign key (sender_space_id) references public.ordax_spaces(space_id) on delete set null;
alter table public.ordax_network_messages
  add constraint ordax_network_messages_sender_user_id_fkey
  foreign key (sender_user_id) references auth.users(id) on delete set null;

alter table public.ordax_network_blocks
  alter column created_by drop not null;
alter table public.ordax_network_blocks
  drop constraint if exists ordax_network_blocks_created_by_fkey;
alter table public.ordax_network_blocks
  add constraint ordax_network_blocks_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.ordax_network_reports
  alter column reporter_space_id drop not null,
  alter column created_by drop not null;
alter table public.ordax_network_reports
  drop constraint if exists ordax_network_reports_reporter_space_id_fkey;
alter table public.ordax_network_reports
  drop constraint if exists ordax_network_reports_created_by_fkey;
alter table public.ordax_network_reports
  add constraint ordax_network_reports_reporter_space_id_fkey
  foreign key (reporter_space_id) references public.ordax_spaces(space_id) on delete set null;
alter table public.ordax_network_reports
  add constraint ordax_network_reports_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table private.ordax_network_audit_events
  alter column actor_user_id drop not null,
  alter column actor_space_id drop not null;
alter table private.ordax_network_audit_events
  add constraint ordax_network_audit_events_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete set null;
alter table private.ordax_network_audit_events
  add constraint ordax_network_audit_events_actor_space_id_fkey
  foreign key (actor_space_id) references public.ordax_spaces(space_id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Bounded rate state that survives a denied operation
-- ---------------------------------------------------------------------------
-- The first source version raised from inside the same SQL transaction after
-- incrementing a counter. PostgreSQL would roll the increment back together with
-- the rejected mutation, making the limiter ineffective. Keep one fixed-window
-- row per actor/Space/operation and return a boolean instead.

alter table private.ordax_network_rate_windows
  drop constraint if exists ordax_network_rate_windows_pkey;

-- Rate state is ephemeral. At this pre-rollout stage there must be no durable
-- product data here; clearing it avoids carrying the obsolete multi-window key.
truncate table private.ordax_network_rate_windows;

alter table private.ordax_network_rate_windows
  add constraint ordax_network_rate_windows_pkey
  primary key (actor_user_id, actor_space_id, operation);

alter table private.ordax_network_rate_windows
  add constraint ordax_network_rate_windows_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete cascade;
alter table private.ordax_network_rate_windows
  add constraint ordax_network_rate_windows_actor_space_id_fkey
  foreign key (actor_space_id) references public.ordax_spaces(space_id) on delete cascade;

drop index if exists private.ordax_network_rate_windows_cleanup_idx;

drop function if exists private.ordax_network_consume_rate_v1(
  uuid, uuid, text, integer, integer
);

create function private.ordax_network_consume_rate_v1(
  p_actor_user_id uuid,
  p_actor_space_id uuid,
  p_operation text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $rate$
declare
  v_now timestamptz := statement_timestamp();
  v_window timestamptz;
  v_count integer;
  v_session_user uuid := (select auth.uid());
begin
  if v_session_user is null or v_session_user <> p_actor_user_id then
    raise exception 'network-rate-actor-mismatch' using errcode = '42501';
  end if;

  perform private.ordax_network_assert_space_actor_v1(p_actor_space_id, false);

  if p_operation is null
     or char_length(p_operation) not between 3 and 80
     or p_operation !~ '^[a-z][a-z0-9-]{2,79}$'
     or p_limit is null or p_limit < 1 or p_limit > 1000
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'network-rate-config-invalid' using errcode = '22023';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into private.ordax_network_rate_windows(
    actor_user_id,
    actor_space_id,
    operation,
    window_started_at,
    count
  ) values (
    p_actor_user_id,
    p_actor_space_id,
    p_operation,
    v_window,
    1
  )
  on conflict (actor_user_id, actor_space_id, operation)
  do update set
    window_started_at = excluded.window_started_at,
    count = case
      when private.ordax_network_rate_windows.window_started_at = excluded.window_started_at
        then private.ordax_network_rate_windows.count + 1
      else 1
    end
  returning count into v_count;

  return v_count <= p_limit;
end;
$rate$;

revoke all on function private.ordax_network_consume_rate_v1(
  uuid, uuid, text, integer, integer
) from public, anon;
grant execute on function private.ordax_network_consume_rate_v1(
  uuid, uuid, text, integer, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Read authority and send authority are intentionally distinct
-- ---------------------------------------------------------------------------

create or replace function private.ordax_network_assert_conversation_reader_v1(
  p_space_id uuid,
  p_conversation_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $reader$
declare
  v_actor uuid;
  v_kind text;
  v_group_id uuid;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, false);

  select c.kind, c.group_id
  into v_kind, v_group_id
  from public.ordax_network_conversations c
  join public.ordax_network_conversation_members cm
    on cm.conversation_id = c.conversation_id
  where c.conversation_id = p_conversation_id
    and c.state = 'active'
    and cm.space_id = p_space_id
    and cm.state = 'active';

  if not found then
    raise exception 'network-conversation-access-denied' using errcode = '42501';
  end if;

  if v_kind = 'group' and not exists (
    select 1
    from public.ordax_network_group_memberships gm
    where gm.group_id = v_group_id
      and gm.space_id = p_space_id
      and gm.state = 'active'
  ) then
    raise exception 'network-group-membership-required' using errcode = '42501';
  end if;

  return v_actor;
end;
$reader$;

revoke all on function private.ordax_network_assert_conversation_reader_v1(uuid, uuid)
from public, anon;
grant execute on function private.ordax_network_assert_conversation_reader_v1(uuid, uuid)
to authenticated;

create or replace function private.ordax_network_assert_conversation_sender_v1(
  p_space_id uuid,
  p_conversation_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $sender$
declare
  v_actor uuid;
  v_kind text;
begin
  v_actor := private.ordax_network_assert_conversation_reader_v1(
    p_space_id, p_conversation_id
  );

  -- A Space viewer is read-only. Sending as the professional Space requires
  -- owner/admin/member authority.
  if not exists (
    select 1
    from public.ordax_spaces s
    where s.space_id = p_space_id
      and s.owner_user_id = v_actor
  ) and not exists (
    select 1
    from public.ordax_space_members sm
    where sm.space_id = p_space_id
      and sm.user_id = v_actor
      and sm.state = 'active'
      and sm.role in ('owner','admin','member')
  ) then
    raise exception 'network-space-send-authority-required' using errcode = '42501';
  end if;

  select c.kind into v_kind
  from public.ordax_network_conversations c
  where c.conversation_id = p_conversation_id;

  if v_kind = 'direct' then
    -- A direct conversation needs a live counterparty before a new message can
    -- be emitted. Historical reads remain available to the surviving member.
    if not exists (
      select 1
      from public.ordax_network_conversation_members other
      join public.ordax_spaces other_space
        on other_space.space_id = other.space_id
      where other.conversation_id = p_conversation_id
        and other.space_id <> p_space_id
        and other.state = 'active'
        and other_space.state = 'active'
        and other_space.kind = 'professional'
    ) then
      raise exception 'network-direct-counterparty-unavailable' using errcode = '42501';
    end if;

    if exists (
      select 1
      from public.ordax_network_conversation_members other
      join public.ordax_network_blocks b
        on (
          (b.blocker_space_id = p_space_id and b.blocked_space_id = other.space_id)
          or
          (b.blocker_space_id = other.space_id and b.blocked_space_id = p_space_id)
        )
      where other.conversation_id = p_conversation_id
        and other.space_id <> p_space_id
        and other.state = 'active'
    ) then
      raise exception 'network-direct-blocked' using errcode = '42501';
    end if;
  end if;

  return v_actor;
end;
$sender$;

revoke all on function private.ordax_network_assert_conversation_sender_v1(uuid, uuid)
from public, anon;
grant execute on function private.ordax_network_assert_conversation_sender_v1(uuid, uuid)
to authenticated;

-- Reads and read receipts must not acquire send authority and a block must not
-- erase historical visibility.
create or replace function private.ordax_network_list_messages_internal_v1(
  p_space_id uuid,
  p_conversation_id uuid,
  p_before_created_at timestamptz,
  p_before_message_id uuid,
  p_limit integer
)
returns table(
  message_id uuid,
  sender_space_id uuid,
  body text,
  created_at timestamptz,
  removed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $messages$
begin
  perform private.ordax_network_assert_conversation_reader_v1(
    p_space_id, p_conversation_id
  );

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'network-message-limit-invalid' using errcode = '22023';
  end if;
  if (p_before_created_at is null) <> (p_before_message_id is null) then
    raise exception 'network-message-cursor-incomplete' using errcode = '22023';
  end if;

  return query
  select
    m.message_id,
    m.sender_space_id,
    case when m.removed_at is null then m.body else '' end,
    m.created_at,
    m.removed_at
  from public.ordax_network_messages m
  where m.conversation_id = p_conversation_id
    and (
      p_before_created_at is null
      or (m.created_at, m.message_id) < (p_before_created_at, p_before_message_id)
    )
  order by m.created_at desc, m.message_id desc
  limit p_limit;
end;
$messages$;

create or replace function private.ordax_network_mark_read_internal_v1(
  p_space_id uuid,
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $read$
begin
  perform private.ordax_network_assert_conversation_reader_v1(
    p_space_id, p_conversation_id
  );

  update public.ordax_network_conversation_members
  set last_read_at = timezone('utc', now())
  where conversation_id = p_conversation_id
    and space_id = p_space_id
    and state = 'active';

  if not found then
    raise exception 'network-conversation-access-denied' using errcode = '42501';
  end if;
end;
$read$;

-- ---------------------------------------------------------------------------
-- 4. Mutations consume persistent rate state without rolling it back on denial
-- ---------------------------------------------------------------------------

create or replace function private.ordax_network_create_group_internal_v1(
  p_space_id uuid,
  p_community_id text,
  p_title text,
  p_description text,
  p_join_policy text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $group$
declare
  v_actor uuid;
  v_group_id uuid;
  v_conversation_id uuid;
  v_title text := btrim(p_title);
  v_description text := nullif(btrim(p_description), '');
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);

  if not private.ordax_network_consume_rate_v1(
    v_actor, p_space_id, 'group-create', 10, 3600
  ) then
    return null;
  end if;

  perform private.ordax_network_assert_community_member_v1(
    p_space_id, p_community_id
  );

  if v_title is null or char_length(v_title) not between 1 and 120 then
    raise exception 'network-group-title-invalid' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 800 then
    raise exception 'network-group-description-too-long' using errcode = '22023';
  end if;

  -- Invite-only membership is intentionally not implied before a reviewed
  -- invite/accept contract exists.
  if p_join_policy = 'invite-only' then
    raise exception 'network-group-invite-flow-not-ready' using errcode = '0A000';
  end if;
  if p_join_policy <> 'members' then
    raise exception 'network-group-join-policy-invalid' using errcode = '22023';
  end if;

  insert into public.ordax_network_groups(
    community_id, owner_space_id, title, description, join_policy, created_by
  ) values (
    p_community_id, p_space_id, v_title, v_description, p_join_policy, v_actor
  )
  returning group_id into v_group_id;

  insert into public.ordax_network_group_memberships(
    group_id, space_id, role, state, joined_by
  ) values (
    v_group_id, p_space_id, 'owner', 'active', v_actor
  );

  insert into public.ordax_network_conversations(kind, group_id)
  values ('group', v_group_id)
  returning conversation_id into v_conversation_id;

  insert into public.ordax_network_conversation_members(
    conversation_id, space_id
  ) values (
    v_conversation_id, p_space_id
  );

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'group-created', 'group', v_group_id::text
  );

  return v_group_id;
end;
$group$;

create or replace function private.ordax_network_join_group_internal_v1(
  p_space_id uuid,
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $join$
declare
  v_actor uuid;
  v_group public.ordax_network_groups;
  v_conversation_id uuid;
  v_existing public.ordax_network_group_memberships;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);

  if not private.ordax_network_consume_rate_v1(
    v_actor, p_space_id, 'group-join', 40, 3600
  ) then
    return;
  end if;

  select g.* into v_group
  from public.ordax_network_groups g
  where g.group_id = p_group_id
    and g.state = 'active'
  for share;

  if not found then
    raise exception 'network-group-not-found' using errcode = '22023';
  end if;
  if v_group.join_policy <> 'members' then
    raise exception 'network-group-not-self-service' using errcode = '42501';
  end if;

  perform private.ordax_network_assert_community_member_v1(
    p_space_id, v_group.community_id
  );

  select gm.* into v_existing
  from public.ordax_network_group_memberships gm
  where gm.group_id = p_group_id
    and gm.space_id = p_space_id
  for update;

  if found then
    if v_existing.state = 'active' then
      return;
    end if;
    if v_existing.state <> 'left' or v_existing.role <> 'member' then
      raise exception 'network-group-membership-not-reactivatable' using errcode = '42501';
    end if;

    update public.ordax_network_group_memberships
    set state = 'active',
        joined_by = v_actor,
        joined_at = timezone('utc', now())
    where group_id = p_group_id
      and space_id = p_space_id;
  else
    insert into public.ordax_network_group_memberships(
      group_id, space_id, role, state, joined_by
    ) values (
      p_group_id, p_space_id, 'member', 'active', v_actor
    );
  end if;

  select c.conversation_id into v_conversation_id
  from public.ordax_network_conversations c
  where c.group_id = p_group_id
    and c.kind = 'group'
    and c.state = 'active';

  if v_conversation_id is null then
    raise exception 'network-group-conversation-missing' using errcode = '55000';
  end if;

  insert into public.ordax_network_conversation_members(
    conversation_id, space_id, state
  ) values (
    v_conversation_id, p_space_id, 'active'
  )
  on conflict (conversation_id, space_id) do update
    set state = 'active',
        joined_at = timezone('utc', now());

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'group-joined', 'group', p_group_id::text
  );
end;
$join$;

create or replace function private.ordax_network_create_direct_internal_v1(
  p_space_id uuid,
  p_target_space_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $direct$
declare
  v_actor uuid;
  v_pair_key text;
  v_conversation_id uuid;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);

  if not private.ordax_network_consume_rate_v1(
    v_actor, p_space_id, 'direct-create', 30, 3600
  ) then
    return null;
  end if;

  if p_target_space_id is null or p_target_space_id = p_space_id then
    raise exception 'network-direct-target-invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.ordax_network_space_profiles p
    join public.ordax_spaces s on s.space_id = p.space_id
    where p.space_id = p_target_space_id
      and p.visibility = 'discoverable'
      and s.state = 'active'
      and s.kind = 'professional'
  ) then
    raise exception 'network-direct-target-unavailable' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.ordax_network_blocks b
    where (b.blocker_space_id = p_space_id and b.blocked_space_id = p_target_space_id)
       or (b.blocker_space_id = p_target_space_id and b.blocked_space_id = p_space_id)
  ) then
    raise exception 'network-direct-blocked' using errcode = '42501';
  end if;

  v_pair_key := private.ordax_network_direct_pair_key_v1(
    p_space_id, p_target_space_id
  );

  insert into public.ordax_network_conversations(kind, direct_pair_key)
  values ('direct', v_pair_key)
  on conflict (direct_pair_key) do update
    set direct_pair_key = excluded.direct_pair_key
  returning conversation_id into v_conversation_id;

  insert into public.ordax_network_conversation_members(
    conversation_id, space_id, state
  ) values
    (v_conversation_id, p_space_id, 'active'),
    (v_conversation_id, p_target_space_id, 'active')
  on conflict (conversation_id, space_id) do update
    set state = 'active';

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'direct-created', 'conversation', v_conversation_id::text
  );

  return v_conversation_id;
end;
$direct$;

-- Message idempotency must be race-safe. ON CONFLICT DO NOTHING serializes
-- concurrent retries on the unique sender/key constraint. A retry returns the
-- canonical row without consuming another send rate or writing another audit.
create or replace function private.ordax_network_send_message_internal_v1(
  p_space_id uuid,
  p_conversation_id uuid,
  p_client_idempotency_key text,
  p_body text
)
returns public.ordax_network_messages
language plpgsql
security definer
set search_path = ''
as $send$
declare
  v_actor uuid;
  v_body text := btrim(p_body);
  v_row public.ordax_network_messages;
  v_inserted boolean := false;
begin
  v_actor := private.ordax_network_assert_conversation_sender_v1(
    p_space_id, p_conversation_id
  );

  if p_client_idempotency_key is null
     or char_length(p_client_idempotency_key) not between 16 and 120
     or p_client_idempotency_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'network-message-idempotency-key-invalid' using errcode = '22023';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 4000 then
    raise exception 'network-message-body-invalid' using errcode = '22023';
  end if;

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
      raise exception 'network-message-idempotency-resolution-failed' using errcode = '40001';
    end if;
    if v_row.conversation_id <> p_conversation_id or v_row.body <> v_body then
      raise exception 'network-message-idempotency-conflict' using errcode = '23505';
    end if;

    return v_row;
  end if;

  if not private.ordax_network_consume_rate_v1(
    v_actor, p_space_id, 'message-send', 120, 60
  ) then
    delete from public.ordax_network_messages
    where message_id = v_row.message_id;
    return null;
  end if;

  update public.ordax_network_conversations c
  set last_message_at = v_row.created_at,
      last_message_id = v_row.message_id
  where c.conversation_id = p_conversation_id;

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'message-sent', 'message', v_row.message_id::text
  );

  return v_row;
end;
$send$;

create or replace function private.ordax_network_set_block_internal_v1(
  p_space_id uuid,
  p_target_space_id uuid,
  p_blocked boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $block$
declare
  v_actor uuid;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);

  if not private.ordax_network_consume_rate_v1(
    v_actor, p_space_id, 'block-change', 60, 3600
  ) then
    return;
  end if;

  if p_target_space_id is null or p_target_space_id = p_space_id then
    raise exception 'network-block-target-invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.ordax_spaces s
    where s.space_id = p_target_space_id
      and s.state = 'active'
      and s.kind = 'professional'
  ) then
    raise exception 'network-block-target-not-found' using errcode = '22023';
  end if;

  if p_blocked then
    insert into public.ordax_network_blocks(
      blocker_space_id, blocked_space_id, created_by
    ) values (
      p_space_id, p_target_space_id, v_actor
    )
    on conflict (blocker_space_id, blocked_space_id) do nothing;
  else
    delete from public.ordax_network_blocks
    where blocker_space_id = p_space_id
      and blocked_space_id = p_target_space_id;
  end if;

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor,
    p_space_id,
    case when p_blocked then 'space-blocked' else 'space-unblocked' end,
    'space',
    p_target_space_id::text
  );
end;
$block$;

-- Report targets are validated against what the acting Space is allowed to see.
create or replace function private.ordax_network_create_report_internal_v1(
  p_space_id uuid,
  p_target_type text,
  p_target_id text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $report$
declare
  v_actor uuid;
  v_report_id uuid;
  v_reason text := btrim(p_reason);
  v_message_conversation_id uuid;
begin
  if p_target_type not in ('space','group','message') then
    raise exception 'network-report-target-type-invalid' using errcode = '22023';
  end if;
  if p_target_id is null or char_length(p_target_id) not between 1 and 160 then
    raise exception 'network-report-target-invalid' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 8 and 500 then
    raise exception 'network-report-reason-invalid' using errcode = '22023';
  end if;

  if p_target_type = 'message' then
    select m.conversation_id into v_message_conversation_id
    from public.ordax_network_messages m
    where m.message_id::text = p_target_id;

    if v_message_conversation_id is null then
      raise exception 'network-report-target-not-found' using errcode = '22023';
    end if;

    v_actor := private.ordax_network_assert_conversation_reader_v1(
      p_space_id, v_message_conversation_id
    );
  else
    v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, false);
  end if;

  if not private.ordax_network_consume_rate_v1(
    v_actor, p_space_id, 'report-create', 20, 3600
  ) then
    return null;
  end if;

  if p_target_type = 'space' and not exists (
    select 1
    from public.ordax_network_space_profiles p
    join public.ordax_spaces s on s.space_id = p.space_id
    where p.space_id::text = p_target_id
      and p.visibility = 'discoverable'
      and s.state = 'active'
      and s.kind = 'professional'
  ) then
    raise exception 'network-report-target-not-found' using errcode = '22023';

  elsif p_target_type = 'group' and not exists (
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
    raise exception 'network-report-target-not-found' using errcode = '22023';
  end if;

  insert into public.ordax_network_reports(
    reporter_space_id, target_type, target_id, reason, created_by
  ) values (
    p_space_id, p_target_type, p_target_id, v_reason, v_actor
  )
  returning report_id into v_report_id;

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'report-created', 'report', v_report_id::text
  );

  return v_report_id;
end;
$report$;

-- Old public wrappers remain SECURITY INVOKER and continue to call these private
-- implementations. Restore explicit privilege posture after replacement.
revoke all on function private.ordax_network_create_group_internal_v1(
  uuid, text, text, text, text
) from public, anon;
revoke all on function private.ordax_network_join_group_internal_v1(
  uuid, uuid
) from public, anon;
revoke all on function private.ordax_network_create_direct_internal_v1(
  uuid, uuid
) from public, anon;
revoke all on function private.ordax_network_send_message_internal_v1(
  uuid, uuid, text, text
) from public, anon;
revoke all on function private.ordax_network_set_block_internal_v1(
  uuid, uuid, boolean
) from public, anon;
revoke all on function private.ordax_network_create_report_internal_v1(
  uuid, text, text, text
) from public, anon;
revoke all on function private.ordax_network_list_messages_internal_v1(
  uuid, uuid, timestamptz, uuid, integer
) from public, anon;
revoke all on function private.ordax_network_mark_read_internal_v1(
  uuid, uuid
) from public, anon;

grant execute on function private.ordax_network_create_group_internal_v1(
  uuid, text, text, text, text
) to authenticated;
grant execute on function private.ordax_network_join_group_internal_v1(
  uuid, uuid
) to authenticated;
grant execute on function private.ordax_network_create_direct_internal_v1(
  uuid, uuid
) to authenticated;
grant execute on function private.ordax_network_send_message_internal_v1(
  uuid, uuid, text, text
) to authenticated;
grant execute on function private.ordax_network_set_block_internal_v1(
  uuid, uuid, boolean
) to authenticated;
grant execute on function private.ordax_network_create_report_internal_v1(
  uuid, text, text, text
) to authenticated;
grant execute on function private.ordax_network_list_messages_internal_v1(
  uuid, uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function private.ordax_network_mark_read_internal_v1(
  uuid, uuid
) to authenticated;

commit;
