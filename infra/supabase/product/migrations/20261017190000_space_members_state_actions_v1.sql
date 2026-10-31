begin;

-- Target authorization remains centralized in the private helper.
-- The read reports meaningful state transitions, while the unchanged mutation
-- RPC continues to accept idempotent noop requests with changed=false.
-- Pagination, ACL and the public return shape remain unchanged.
create or replace function public.ordax_list_space_members_v1(
  p_space_id uuid,
  p_after_user_id uuid default null,
  p_limit integer default 64
)
returns table (
  space_id uuid,
  user_id uuid,
  role text,
  state text,
  can_change_role boolean,
  can_suspend boolean,
  can_reactivate boolean,
  can_remove boolean,
  assignable_roles text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_can_admin boolean := false;
  v_actor_is_owner boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication-required';
  end if;
  if p_space_id is null then
    raise exception using errcode = '22023', message = 'space-id-required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 128 then
    raise exception using errcode = '22023', message = 'space-members-limit-invalid';
  end if;

  if not ordax_policy.can_access_space(p_space_id) then
    raise exception using errcode = '42501', message = 'space-not-found-or-forbidden';
  end if;

  v_actor_can_admin := ordax_policy.can_admin_space(p_space_id);
  select exists(
    select 1
    from public.ordax_spaces s
    where s.space_id = p_space_id
      and s.owner_user_id = v_actor
  ) into v_actor_is_owner;

  return query
  select
    m.space_id,
    m.user_id,
    m.role,
    m.state,
    a.can_change_role,
    a.can_suspend and m.state = 'active' as can_suspend,
    a.can_reactivate and m.state = 'suspended' as can_reactivate,
    a.can_remove,
    a.assignable_roles
  from public.ordax_space_members m
  join public.ordax_spaces s on s.space_id = m.space_id
  cross join lateral private.ordax_space_member_action_capabilities_v1(
    v_actor,
    v_actor_can_admin,
    v_actor_is_owner,
    m.user_id,
    m.user_id = s.owner_user_id or m.role = 'owner',
    m.role,
    m.state
  ) a
  where m.space_id = p_space_id
    and (p_after_user_id is null or m.user_id > p_after_user_id)
  order by m.user_id asc
  limit p_limit;
end;
$$;

revoke all on function public.ordax_list_space_members_v1(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_list_space_members_v1(uuid, uuid, integer)
  to authenticated;

commit;
