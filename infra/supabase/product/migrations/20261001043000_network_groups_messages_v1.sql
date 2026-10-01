-- OrdaX Network MVP slice 2: groups, conversations, messages, blocks and reports.
-- All protected mutations are server-authoritative. Browser clients have no direct table DML.

begin;

create table public.ordax_network_groups (
  group_id uuid primary key default gen_random_uuid(),
  community_id text not null
    references public.ordax_network_communities(community_id) on delete restrict,
  owner_space_id uuid not null
    references public.ordax_spaces(space_id) on delete restrict,
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 800),
  join_policy text not null default 'members'
    check (join_policy in ('members','invite-only')),
  state text not null default 'active'
    check (state in ('active','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.ordax_network_group_memberships (
  group_id uuid not null
    references public.ordax_network_groups(group_id) on delete cascade,
  space_id uuid not null
    references public.ordax_spaces(space_id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','admin','member')),
  state text not null default 'active'
    check (state in ('active','left','removed','banned')),
  joined_by uuid not null references auth.users(id) on delete restrict,
  joined_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (group_id, space_id)
);

create table public.ordax_network_conversations (
  conversation_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group')),
  direct_pair_key text unique,
  group_id uuid unique references public.ordax_network_groups(group_id) on delete cascade,
  state text not null default 'active' check (state in ('active','closed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (kind = 'direct' and direct_pair_key is not null and group_id is null)
    or
    (kind = 'group' and direct_pair_key is null and group_id is not null)
  )
);

create table public.ordax_network_conversation_members (
  conversation_id uuid not null
    references public.ordax_network_conversations(conversation_id) on delete cascade,
  space_id uuid not null
    references public.ordax_spaces(space_id) on delete cascade,
  state text not null default 'active'
    check (state in ('active','left','removed')),
  joined_at timestamptz not null default timezone('utc', now()),
  last_read_at timestamptz,
  primary key (conversation_id, space_id)
);

create table public.ordax_network_messages (
  message_id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.ordax_network_conversations(conversation_id) on delete cascade,
  sender_space_id uuid not null
    references public.ordax_spaces(space_id) on delete restrict,
  sender_user_id uuid not null
    references auth.users(id) on delete restrict,
  client_idempotency_key text not null
    check (
      char_length(client_idempotency_key) between 16 and 120
      and client_idempotency_key ~ '^[A-Za-z0-9._:-]+$'
    ),
  body text not null
    check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz,
  unique (sender_space_id, client_idempotency_key)
);

create table public.ordax_network_blocks (
  blocker_space_id uuid not null
    references public.ordax_spaces(space_id) on delete cascade,
  blocked_space_id uuid not null
    references public.ordax_spaces(space_id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (blocker_space_id, blocked_space_id),
  check (blocker_space_id <> blocked_space_id)
);

create table public.ordax_network_reports (
  report_id uuid primary key default gen_random_uuid(),
  reporter_space_id uuid not null
    references public.ordax_spaces(space_id) on delete cascade,
  target_type text not null check (target_type in ('space','group','message')),
  target_id text not null check (char_length(target_id) between 1 and 160),
  reason text not null check (char_length(reason) between 8 and 500),
  state text not null default 'open' check (state in ('open','reviewing','closed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);

create table private.ordax_network_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  actor_space_id uuid not null,
  event_type text not null check (
    event_type in (
      'group-created',
      'group-joined',
      'group-left',
      'direct-created',
      'message-sent',
      'space-blocked',
      'space-unblocked',
      'report-created'
    )
  ),
  resource_type text not null,
  resource_id text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index ordax_network_groups_community_state_idx
  on public.ordax_network_groups(community_id, state, title, group_id);
create index ordax_network_group_memberships_space_state_idx
  on public.ordax_network_group_memberships(space_id, state, group_id);
create index ordax_network_group_memberships_group_state_idx
  on public.ordax_network_group_memberships(group_id, state, space_id);
create index ordax_network_conversation_members_space_state_idx
  on public.ordax_network_conversation_members(space_id, state, conversation_id);
create index ordax_network_messages_conversation_cursor_idx
  on public.ordax_network_messages(conversation_id, created_at desc, message_id desc);
create index ordax_network_reports_reporter_created_idx
  on public.ordax_network_reports(reporter_space_id, created_at desc);
create index ordax_network_reports_target_state_idx
  on public.ordax_network_reports(target_type, target_id, state, created_at desc);
create index ordax_network_audit_actor_created_idx
  on private.ordax_network_audit_events(actor_space_id, created_at desc);

create trigger touch_ordax_network_groups_updated_at
before update on public.ordax_network_groups
for each row execute function private.ordax_touch_updated_at();

create trigger touch_ordax_network_group_memberships_updated_at
before update on public.ordax_network_group_memberships
for each row execute function private.ordax_touch_updated_at();

create trigger touch_ordax_network_conversations_updated_at
before update on public.ordax_network_conversations
for each row execute function private.ordax_touch_updated_at();

alter table public.ordax_network_groups enable row level security;
alter table public.ordax_network_group_memberships enable row level security;
alter table public.ordax_network_conversations enable row level security;
alter table public.ordax_network_conversation_members enable row level security;
alter table public.ordax_network_messages enable row level security;
alter table public.ordax_network_blocks enable row level security;
alter table public.ordax_network_reports enable row level security;
alter table private.ordax_network_audit_events enable row level security;

revoke all on table public.ordax_network_groups from public, anon, authenticated;
revoke all on table public.ordax_network_group_memberships from public, anon, authenticated;
revoke all on table public.ordax_network_conversations from public, anon, authenticated;
revoke all on table public.ordax_network_conversation_members from public, anon, authenticated;
revoke all on table public.ordax_network_messages from public, anon, authenticated;
revoke all on table public.ordax_network_blocks from public, anon, authenticated;
revoke all on table public.ordax_network_reports from public, anon, authenticated;
revoke all on table private.ordax_network_audit_events from public, anon, authenticated, service_role;

create or replace function private.ordax_network_assert_community_member_v1(
  p_space_id uuid,
  p_community_id text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.ordax_network_assert_space_actor_v1(p_space_id, false);
  if not exists (
    select 1
    from public.ordax_network_memberships m
    join public.ordax_network_communities c
      on c.community_id = m.community_id
    where m.community_id = p_community_id
      and m.space_id = p_space_id
      and m.state = 'active'
      and c.state = 'active'
  ) then
    raise exception 'network-community-membership-required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.ordax_network_assert_community_member_v1(uuid, text)
from public, anon;
grant execute on function private.ordax_network_assert_community_member_v1(uuid, text)
to authenticated;

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
as $$
declare
  v_actor uuid;
  v_group_id uuid;
  v_conversation_id uuid;
  v_title text := btrim(p_title);
  v_description text := nullif(btrim(p_description), '');
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);
  perform private.ordax_network_assert_community_member_v1(p_space_id, p_community_id);

  if v_title is null or char_length(v_title) not between 1 and 120 then
    raise exception 'network-group-title-invalid' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 800 then
    raise exception 'network-group-description-too-long' using errcode = '22023';
  end if;
  if p_join_policy not in ('members','invite-only') then
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

  insert into public.ordax_network_conversation_members(conversation_id, space_id)
  values (v_conversation_id, p_space_id);

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'group-created', 'group', v_group_id::text
  );

  return v_group_id;
end;
$$;

revoke all on function private.ordax_network_create_group_internal_v1(uuid, text, text, text, text)
from public, anon;
grant execute on function private.ordax_network_create_group_internal_v1(uuid, text, text, text, text)
to authenticated;

create or replace function public.ordax_network_create_group_v1(
  p_space_id uuid,
  p_community_id text,
  p_title text,
  p_description text default null,
  p_join_policy text default 'members'
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_create_group_internal_v1(
    p_space_id, p_community_id, p_title, p_description, p_join_policy
  );
$$;

revoke all on function public.ordax_network_create_group_v1(uuid, text, text, text, text)
from public, anon;
grant execute on function public.ordax_network_create_group_v1(uuid, text, text, text, text)
to authenticated;

create or replace function private.ordax_network_join_group_internal_v1(
  p_space_id uuid,
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_group public.ordax_network_groups;
  v_conversation_id uuid;
  v_existing public.ordax_network_group_memberships;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);

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
    where group_id = p_group_id and space_id = p_space_id;
  else
    insert into public.ordax_network_group_memberships(
      group_id, space_id, role, state, joined_by
    ) values (
      p_group_id, p_space_id, 'member', 'active', v_actor
    );
  end if;

  select c.conversation_id into v_conversation_id
  from public.ordax_network_conversations c
  where c.group_id = p_group_id and c.kind = 'group' and c.state = 'active';

  if v_conversation_id is null then
    raise exception 'network-group-conversation-missing' using errcode = '55000';
  end if;

  insert into public.ordax_network_conversation_members(conversation_id, space_id, state)
  values (v_conversation_id, p_space_id, 'active')
  on conflict (conversation_id, space_id) do update
    set state = 'active',
        joined_at = timezone('utc', now());

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'group-joined', 'group', p_group_id::text
  );
end;
$$;

revoke all on function private.ordax_network_join_group_internal_v1(uuid, uuid)
from public, anon;
grant execute on function private.ordax_network_join_group_internal_v1(uuid, uuid)
to authenticated;

create or replace function public.ordax_network_join_group_v1(
  p_space_id uuid,
  p_group_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_join_group_internal_v1(p_space_id, p_group_id);
$$;

revoke all on function public.ordax_network_join_group_v1(uuid, uuid)
from public, anon;
grant execute on function public.ordax_network_join_group_v1(uuid, uuid)
to authenticated;

create or replace function private.ordax_network_direct_pair_key_v1(
  p_a uuid,
  p_b uuid
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_a::text < p_b::text then p_a::text || ':' || p_b::text
    else p_b::text || ':' || p_a::text
  end;
$$;

revoke all on function private.ordax_network_direct_pair_key_v1(uuid, uuid)
from public, anon;
grant execute on function private.ordax_network_direct_pair_key_v1(uuid, uuid)
to authenticated;

create or replace function private.ordax_network_create_direct_internal_v1(
  p_space_id uuid,
  p_target_space_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_pair_key text;
  v_conversation_id uuid;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);
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

  v_pair_key := private.ordax_network_direct_pair_key_v1(p_space_id, p_target_space_id);

  insert into public.ordax_network_conversations(kind, direct_pair_key)
  values ('direct', v_pair_key)
  on conflict (direct_pair_key) do update
    set direct_pair_key = excluded.direct_pair_key
  returning conversation_id into v_conversation_id;

  insert into public.ordax_network_conversation_members(conversation_id, space_id, state)
  values
    (v_conversation_id, p_space_id, 'active'),
    (v_conversation_id, p_target_space_id, 'active')
  on conflict (conversation_id, space_id) do nothing;

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'direct-created', 'conversation', v_conversation_id::text
  );

  return v_conversation_id;
end;
$$;

revoke all on function private.ordax_network_create_direct_internal_v1(uuid, uuid)
from public, anon;
grant execute on function private.ordax_network_create_direct_internal_v1(uuid, uuid)
to authenticated;

create or replace function public.ordax_network_create_direct_v1(
  p_space_id uuid,
  p_target_space_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_create_direct_internal_v1(p_space_id, p_target_space_id);
$$;

revoke all on function public.ordax_network_create_direct_v1(uuid, uuid)
from public, anon;
grant execute on function public.ordax_network_create_direct_v1(uuid, uuid)
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
as $$
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
    select 1 from public.ordax_network_group_memberships gm
    where gm.group_id = v_group_id
      and gm.space_id = p_space_id
      and gm.state = 'active'
  ) then
    raise exception 'network-group-membership-required' using errcode = '42501';
  end if;

  if v_kind = 'direct' and exists (
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
  ) then
    raise exception 'network-direct-blocked' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

revoke all on function private.ordax_network_assert_conversation_sender_v1(uuid, uuid)
from public, anon;
grant execute on function private.ordax_network_assert_conversation_sender_v1(uuid, uuid)
to authenticated;

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
as $$
declare
  v_actor uuid;
  v_body text := btrim(p_body);
  v_row public.ordax_network_messages;
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

  select m.* into v_row
  from public.ordax_network_messages m
  where m.sender_space_id = p_space_id
    and m.client_idempotency_key = p_client_idempotency_key;

  if found then
    if v_row.conversation_id <> p_conversation_id or v_row.body <> v_body then
      raise exception 'network-message-idempotency-conflict' using errcode = '23505';
    end if;
    return v_row;
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
  returning * into v_row;

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'message-sent', 'message', v_row.message_id::text
  );

  return v_row;
end;
$$;

revoke all on function private.ordax_network_send_message_internal_v1(uuid, uuid, text, text)
from public, anon;
grant execute on function private.ordax_network_send_message_internal_v1(uuid, uuid, text, text)
to authenticated;

create or replace function public.ordax_network_send_message_v1(
  p_space_id uuid,
  p_conversation_id uuid,
  p_client_idempotency_key text,
  p_body text
)
returns public.ordax_network_messages
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_send_message_internal_v1(
    p_space_id, p_conversation_id, p_client_idempotency_key, p_body
  );
$$;

revoke all on function public.ordax_network_send_message_v1(uuid, uuid, text, text)
from public, anon;
grant execute on function public.ordax_network_send_message_v1(uuid, uuid, text, text)
to authenticated;

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
as $$
begin
  perform private.ordax_network_assert_conversation_sender_v1(
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
$$;

revoke all on function private.ordax_network_list_messages_internal_v1(
  uuid, uuid, timestamptz, uuid, integer
) from public, anon;
grant execute on function private.ordax_network_list_messages_internal_v1(
  uuid, uuid, timestamptz, uuid, integer
) to authenticated;

create or replace function public.ordax_network_list_messages_v1(
  p_space_id uuid,
  p_conversation_id uuid,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 50
)
returns table(
  message_id uuid,
  sender_space_id uuid,
  body text,
  created_at timestamptz,
  removed_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.ordax_network_list_messages_internal_v1(
    p_space_id,
    p_conversation_id,
    p_before_created_at,
    p_before_message_id,
    p_limit
  );
$$;

revoke all on function public.ordax_network_list_messages_v1(
  uuid, uuid, timestamptz, uuid, integer
) from public, anon;
grant execute on function public.ordax_network_list_messages_v1(
  uuid, uuid, timestamptz, uuid, integer
) to authenticated;

create or replace function private.ordax_network_set_block_internal_v1(
  p_space_id uuid,
  p_target_space_id uuid,
  p_blocked boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);
  if p_target_space_id is null or p_target_space_id = p_space_id then
    raise exception 'network-block-target-invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.ordax_spaces s
    where s.space_id = p_target_space_id and s.state = 'active'
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
$$;

revoke all on function private.ordax_network_set_block_internal_v1(uuid, uuid, boolean)
from public, anon;
grant execute on function private.ordax_network_set_block_internal_v1(uuid, uuid, boolean)
to authenticated;

create or replace function public.ordax_network_set_block_v1(
  p_space_id uuid,
  p_target_space_id uuid,
  p_blocked boolean
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_set_block_internal_v1(
    p_space_id, p_target_space_id, p_blocked
  );
$$;

revoke all on function public.ordax_network_set_block_v1(uuid, uuid, boolean)
from public, anon;
grant execute on function public.ordax_network_set_block_v1(uuid, uuid, boolean)
to authenticated;

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
as $$
declare
  v_actor uuid;
  v_report_id uuid;
  v_reason text := btrim(p_reason);
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, false);
  if p_target_type not in ('space','group','message') then
    raise exception 'network-report-target-type-invalid' using errcode = '22023';
  end if;
  if p_target_id is null or char_length(p_target_id) not between 1 and 160 then
    raise exception 'network-report-target-invalid' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) not between 8 and 500 then
    raise exception 'network-report-reason-invalid' using errcode = '22023';
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
$$;

revoke all on function private.ordax_network_create_report_internal_v1(uuid, text, text, text)
from public, anon;
grant execute on function private.ordax_network_create_report_internal_v1(uuid, text, text, text)
to authenticated;

create or replace function public.ordax_network_create_report_v1(
  p_space_id uuid,
  p_target_type text,
  p_target_id text,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_create_report_internal_v1(
    p_space_id, p_target_type, p_target_id, p_reason
  );
$$;

revoke all on function public.ordax_network_create_report_v1(uuid, text, text, text)
from public, anon;
grant execute on function public.ordax_network_create_report_v1(uuid, text, text, text)
to authenticated;

commit;
