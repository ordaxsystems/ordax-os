begin;

-- One internal presentation/authorization projection for target-specific Space member actions.
-- The helper is private and receives actor/target facts already read by the canonical public
-- boundaries, so list reads stay set-based and mutation locking/idempotency remain unchanged.
create or replace function private.ordax_space_member_action_capabilities_v1(
  p_actor_user_id uuid,
  p_actor_can_admin boolean,
  p_actor_is_owner boolean,
  p_target_user_id uuid,
  p_target_is_owner boolean,
  p_target_role text,
  p_target_state text
)
returns table (
  can_change_role boolean,
  can_suspend boolean,
  can_reactivate boolean,
  can_remove boolean,
  assignable_roles text[]
)
language sql
immutable
set search_path = ''
as $function$
  with decision as (
    select
      coalesce(p_actor_can_admin, false)
      and p_actor_user_id is not null
      and p_target_user_id is not null
      and p_actor_user_id <> p_target_user_id
      and not coalesce(p_target_is_owner, false)
      and p_target_role in ('admin', 'member', 'viewer')
      and p_target_state in ('active', 'suspended')
      and (coalesce(p_actor_is_owner, false) or p_target_role <> 'admin') as can_manage
  )
  select
    d.can_manage,
    d.can_manage,
    d.can_manage,
    d.can_manage,
    case
      when not d.can_manage then '{}'::text[]
      when coalesce(p_actor_is_owner, false) then array['admin', 'member', 'viewer']::text[]
      else array['member', 'viewer']::text[]
    end
  from decision d;
$function$;

revoke all on function private.ordax_space_member_action_capabilities_v1(uuid, boolean, boolean, uuid, boolean, text, text)
  from public, anon, authenticated, service_role;

-- v2 of the existing bounded members read: same route/RPC name and pagination semantics,
-- now with the server-projected actions for each target. No additional request per row.
drop function public.ordax_list_space_members_v1(uuid, uuid, integer);

create function public.ordax_list_space_members_v1(
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
    a.can_suspend,
    a.can_reactivate,
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

-- Keep the existing mutation transport/result contract and concurrency model, but consume
-- the same target-action projection instead of maintaining a second copy of owner/admin rules.
create or replace function public.ordax_mutate_space_membership_v1(
  p_space_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_role text,
  p_idempotency_key uuid
)
returns table (
  space_id uuid,
  target_user_id uuid,
  role text,
  state text,
  removed boolean,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action text := btrim(coalesce(p_action, ''));
  v_role text;
  v_space public.ordax_spaces%rowtype;
  v_target public.ordax_space_members%rowtype;
  v_existing private.ordax_space_membership_action_receipts%rowtype;
  v_actor_is_owner boolean := false;
  v_actor_can_admin boolean := false;
  v_capability record;
  v_changed boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication-required';
  end if;
  if p_space_id is null or p_target_user_id is null then
    raise exception using errcode = '22023', message = 'space-membership-target-required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'space-membership-idempotency-key-required';
  end if;
  if v_action not in ('change-role', 'suspend', 'reactivate', 'remove') then
    raise exception using errcode = '22023', message = 'space-membership-action-invalid';
  end if;

  if v_action = 'change-role' then
    v_role := btrim(coalesce(p_role, ''));
    if v_role not in ('admin', 'member', 'viewer') then
      raise exception using errcode = '22023', message = 'space-membership-role-invalid';
    end if;
  elsif p_role is not null then
    raise exception using errcode = '22023', message = 'space-membership-role-not-allowed';
  end if;

  select s.*
    into v_space
  from public.ordax_spaces s
  where s.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'space-membership-not-found-or-forbidden';
  end if;

  perform 1
  from public.ordax_space_members m
  where m.space_id = p_space_id
    and m.user_id in (v_actor, p_target_user_id)
  order by m.user_id
  for update;

  v_actor_can_admin := ordax_policy.can_admin_space(p_space_id);
  if not v_actor_can_admin then
    raise exception using errcode = '42501', message = 'space-membership-not-found-or-forbidden';
  end if;
  v_actor_is_owner := v_space.owner_user_id = v_actor;

  -- Authorization is deliberately revalidated before replay, exactly as in v1.
  select r.*
    into v_existing
  from private.ordax_space_membership_action_receipts r
  where r.actor_user_id = v_actor
    and r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.space_id <> p_space_id
      or v_existing.target_user_id <> p_target_user_id
      or v_existing.action <> v_action
      or v_existing.requested_role is distinct from v_role then
      raise exception using errcode = '22023', message = 'space-membership-idempotency-conflict';
    end if;

    return query
    select v_existing.space_id,
           v_existing.target_user_id,
           v_existing.result_role,
           v_existing.result_state,
           v_existing.result_removed,
           false;
    return;
  end if;

  select m.*
    into v_target
  from public.ordax_space_members m
  where m.space_id = p_space_id
    and m.user_id = p_target_user_id;

  if not found then
    raise exception using errcode = '42501', message = 'space-membership-not-found-or-forbidden';
  end if;

  select a.*
    into v_capability
  from private.ordax_space_member_action_capabilities_v1(
    v_actor,
    v_actor_can_admin,
    v_actor_is_owner,
    p_target_user_id,
    p_target_user_id = v_space.owner_user_id or v_target.role = 'owner',
    v_target.role,
    v_target.state
  ) a;

  if v_action = 'change-role' then
    if not coalesce(v_capability.can_change_role, false)
      or not (v_role = any(coalesce(v_capability.assignable_roles, '{}'::text[]))) then
      raise exception using errcode = '42501', message = 'space-membership-action-forbidden';
    end if;
  elsif v_action = 'suspend' and not coalesce(v_capability.can_suspend, false) then
    raise exception using errcode = '42501', message = 'space-membership-action-forbidden';
  elsif v_action = 'reactivate' and not coalesce(v_capability.can_reactivate, false) then
    raise exception using errcode = '42501', message = 'space-membership-action-forbidden';
  elsif v_action = 'remove' and not coalesce(v_capability.can_remove, false) then
    raise exception using errcode = '42501', message = 'space-membership-action-forbidden';
  end if;

  if v_action = 'change-role' then
    v_changed := v_target.role is distinct from v_role;
    if v_changed then
      update public.ordax_space_members m
      set role = v_role
      where m.space_id = p_space_id
        and m.user_id = p_target_user_id;
      v_target.role := v_role;
    end if;
  elsif v_action = 'suspend' then
    v_changed := v_target.state <> 'suspended';
    if v_changed then
      update public.ordax_space_members m
      set state = 'suspended'
      where m.space_id = p_space_id
        and m.user_id = p_target_user_id;
      v_target.state := 'suspended';
    end if;
  elsif v_action = 'reactivate' then
    v_changed := v_target.state <> 'active';
    if v_changed then
      update public.ordax_space_members m
      set state = 'active'
      where m.space_id = p_space_id
        and m.user_id = p_target_user_id;
      v_target.state := 'active';
    end if;
  else
    delete from public.ordax_space_members m
    where m.space_id = p_space_id
      and m.user_id = p_target_user_id;
    v_changed := true;
  end if;

  insert into private.ordax_space_membership_action_receipts(
    actor_user_id,
    idempotency_key,
    space_id,
    target_user_id,
    action,
    requested_role,
    result_role,
    result_state,
    result_removed,
    original_changed
  ) values (
    v_actor,
    p_idempotency_key,
    p_space_id,
    p_target_user_id,
    v_action,
    v_role,
    v_target.role,
    v_target.state,
    v_action = 'remove',
    v_changed
  );

  return query
  select p_space_id,
         p_target_user_id,
         v_target.role,
         v_target.state,
         v_action = 'remove',
         v_changed;
end;
$$;

revoke all on function public.ordax_mutate_space_membership_v1(uuid, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_mutate_space_membership_v1(uuid, uuid, text, text, uuid)
  to authenticated;

commit;
