-- OrdaX Network MVP slice 3: bounded group discovery, leave flow and inbox reads.

begin;

create or replace function private.ordax_network_list_groups_internal_v1(
  p_space_id uuid,
  p_community_id text,
  p_after_title text,
  p_after_group_id uuid,
  p_limit integer
)
returns table(
  group_id uuid,
  title text,
  description text,
  join_policy text,
  my_role text,
  my_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $network$
begin
  perform private.ordax_network_assert_community_member_v1(p_space_id, p_community_id);

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'network-group-list-limit-invalid' using errcode = '22023';
  end if;
  if (p_after_title is null) <> (p_after_group_id is null) then
    raise exception 'network-group-list-cursor-incomplete' using errcode = '22023';
  end if;

  return query
  select
    g.group_id,
    g.title,
    g.description,
    g.join_policy,
    gm.role,
    gm.state
  from public.ordax_network_groups g
  left join public.ordax_network_group_memberships gm
    on gm.group_id = g.group_id
   and gm.space_id = p_space_id
  where g.community_id = p_community_id
    and g.state = 'active'
    and (
      g.join_policy = 'members'
      or (gm.state = 'active')
    )
    and (
      p_after_title is null
      or (g.title, g.group_id) > (p_after_title, p_after_group_id)
    )
  order by g.title, g.group_id
  limit p_limit;
end;
$network$;

revoke all on function private.ordax_network_list_groups_internal_v1(
  uuid, text, text, uuid, integer
) from public, anon;
grant execute on function private.ordax_network_list_groups_internal_v1(
  uuid, text, text, uuid, integer
) to authenticated;

create or replace function public.ordax_network_list_groups_v1(
  p_space_id uuid,
  p_community_id text,
  p_after_title text default null,
  p_after_group_id uuid default null,
  p_limit integer default 30
)
returns table(
  group_id uuid,
  title text,
  description text,
  join_policy text,
  my_role text,
  my_state text
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.ordax_network_list_groups_internal_v1(
    p_space_id, p_community_id, p_after_title, p_after_group_id, p_limit
  );
$$;

revoke all on function public.ordax_network_list_groups_v1(
  uuid, text, text, uuid, integer
) from public, anon;
grant execute on function public.ordax_network_list_groups_v1(
  uuid, text, text, uuid, integer
) to authenticated;

create or replace function private.ordax_network_leave_group_internal_v1(
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
  v_membership public.ordax_network_group_memberships;
  v_conversation_id uuid;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);

  select gm.* into v_membership
  from public.ordax_network_group_memberships gm
  where gm.group_id = p_group_id
    and gm.space_id = p_space_id
  for update;

  if not found then
    raise exception 'network-group-membership-not-found' using errcode = '22023';
  end if;
  if v_membership.state = 'left' then
    return;
  end if;
  if v_membership.state <> 'active' then
    raise exception 'network-group-membership-not-leavable' using errcode = '42501';
  end if;
  if v_membership.role = 'owner' then
    raise exception 'network-group-owner-transfer-required' using errcode = '42501';
  end if;

  update public.ordax_network_group_memberships
  set state = 'left'
  where group_id = p_group_id
    and space_id = p_space_id;

  select c.conversation_id into v_conversation_id
  from public.ordax_network_conversations c
  where c.kind = 'group'
    and c.group_id = p_group_id;

  if v_conversation_id is not null then
    update public.ordax_network_conversation_members
    set state = 'left'
    where conversation_id = v_conversation_id
      and space_id = p_space_id;
  end if;

  insert into private.ordax_network_audit_events(
    actor_user_id, actor_space_id, event_type, resource_type, resource_id
  ) values (
    v_actor, p_space_id, 'group-left', 'group', p_group_id::text
  );
end;
$$;

revoke all on function private.ordax_network_leave_group_internal_v1(uuid, uuid)
from public, anon;
grant execute on function private.ordax_network_leave_group_internal_v1(uuid, uuid)
to authenticated;

create or replace function public.ordax_network_leave_group_v1(
  p_space_id uuid,
  p_group_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_leave_group_internal_v1(p_space_id, p_group_id);
$$;

revoke all on function public.ordax_network_leave_group_v1(uuid, uuid)
from public, anon;
grant execute on function public.ordax_network_leave_group_v1(uuid, uuid)
to authenticated;

create or replace function private.ordax_network_list_conversations_internal_v1(
  p_space_id uuid,
  p_before_activity_at timestamptz,
  p_before_conversation_id uuid,
  p_limit integer
)
returns table(
  conversation_id uuid,
  kind text,
  group_id uuid,
  other_space_id uuid,
  activity_at timestamptz,
  last_message_id uuid,
  last_read_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $network$
begin
  perform private.ordax_network_assert_space_actor_v1(p_space_id, false);

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'network-inbox-limit-invalid' using errcode = '22023';
  end if;
  if (p_before_activity_at is null) <> (p_before_conversation_id is null) then
    raise exception 'network-inbox-cursor-incomplete' using errcode = '22023';
  end if;

  return query
  select
    c.conversation_id,
    c.kind,
    c.group_id,
    case
      when c.kind = 'direct' then (
        select other.space_id
        from public.ordax_network_conversation_members other
        where other.conversation_id = c.conversation_id
          and other.space_id <> p_space_id
        order by other.space_id
        limit 1
      )
      else null
    end as other_space_id,
    coalesce(c.last_message_at, c.created_at) as activity_at,
    c.last_message_id,
    mine.last_read_at
  from public.ordax_network_conversation_members mine
  join public.ordax_network_conversations c
    on c.conversation_id = mine.conversation_id
  where mine.space_id = p_space_id
    and mine.state = 'active'
    and c.state = 'active'
    and (
      p_before_activity_at is null
      or (
        coalesce(c.last_message_at, c.created_at),
        c.conversation_id
      ) < (
        p_before_activity_at,
        p_before_conversation_id
      )
    )
  order by coalesce(c.last_message_at, c.created_at) desc, c.conversation_id desc
  limit p_limit;
end;
$network$;

revoke all on function private.ordax_network_list_conversations_internal_v1(
  uuid, timestamptz, uuid, integer
) from public, anon;
grant execute on function private.ordax_network_list_conversations_internal_v1(
  uuid, timestamptz, uuid, integer
) to authenticated;

create or replace function public.ordax_network_list_conversations_v1(
  p_space_id uuid,
  p_before_activity_at timestamptz default null,
  p_before_conversation_id uuid default null,
  p_limit integer default 30
)
returns table(
  conversation_id uuid,
  kind text,
  group_id uuid,
  other_space_id uuid,
  activity_at timestamptz,
  last_message_id uuid,
  last_read_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.ordax_network_list_conversations_internal_v1(
    p_space_id, p_before_activity_at, p_before_conversation_id, p_limit
  );
$$;

revoke all on function public.ordax_network_list_conversations_v1(
  uuid, timestamptz, uuid, integer
) from public, anon;
grant execute on function public.ordax_network_list_conversations_v1(
  uuid, timestamptz, uuid, integer
) to authenticated;

create or replace function private.ordax_network_mark_read_internal_v1(
  p_space_id uuid,
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ordax_network_assert_conversation_sender_v1(
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
$$;

revoke all on function private.ordax_network_mark_read_internal_v1(uuid, uuid)
from public, anon;
grant execute on function private.ordax_network_mark_read_internal_v1(uuid, uuid)
to authenticated;

create or replace function public.ordax_network_mark_read_v1(
  p_space_id uuid,
  p_conversation_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_mark_read_internal_v1(
    p_space_id, p_conversation_id
  );
$$;

revoke all on function public.ordax_network_mark_read_v1(uuid, uuid)
from public, anon;
grant execute on function public.ordax_network_mark_read_v1(uuid, uuid)
to authenticated;

commit;
