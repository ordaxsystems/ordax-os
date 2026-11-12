begin;

create table private.ordax_space_membership_action_receipts (
  actor_user_id uuid not null,
  idempotency_key uuid not null,
  space_id uuid not null,
  target_user_id uuid not null,
  action text not null check (action in ('change-role','suspend','reactivate','remove')),
  requested_role text check (requested_role is null or requested_role in ('admin','member','viewer')),
  result_role text not null check (result_role in ('admin','member','viewer')),
  result_state text not null check (result_state in ('active','suspended')),
  result_removed boolean not null,
  original_changed boolean not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (actor_user_id, idempotency_key),
  check (
    (action = 'change-role' and requested_role is not null)
    or (action <> 'change-role' and requested_role is null)
  )
);

revoke all on table private.ordax_space_membership_action_receipts
  from public, anon, authenticated, service_role;

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

  -- Every membership mutation serializes on the Space row first. Future ownership and
  -- invite-acceptance flows must use the same lock ordering before touching memberships.
  select s.*
    into v_space
  from public.ordax_spaces s
  where s.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'space-membership-not-found-or-forbidden';
  end if;

  -- Lock actor/target membership rows in deterministic order before authorization.
  -- This prevents a concurrent role revocation from racing an action that already
  -- observed stale admin authority.
  perform 1
  from public.ordax_space_members m
  where m.space_id = p_space_id
    and m.user_id in (v_actor, p_target_user_id)
  order by m.user_id
  for update;

  if not ordax_policy.can_admin_space(p_space_id) then
    raise exception using errcode = '42501', message = 'space-membership-not-found-or-forbidden';
  end if;

  v_actor_is_owner := v_space.owner_user_id = v_actor;

  -- Current authority is revalidated before replay. A suspended/removed admin cannot
  -- reuse an old idempotency key as a stale authorization token.
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

  -- Administrative membership actions never operate on self. Voluntary leave is a
  -- separate flow with different invariants.
  if p_target_user_id = v_actor then
    raise exception using errcode = '42501', message = 'space-membership-action-forbidden';
  end if;

  select m.*
    into v_target
  from public.ordax_space_members m
  where m.space_id = p_space_id
    and m.user_id = p_target_user_id;

  if not found then
    raise exception using errcode = '42501', message = 'space-membership-not-found-or-forbidden';
  end if;

  -- Owner membership is governed only by the explicit ownership-transfer ceremony.
  if p_target_user_id = v_space.owner_user_id or v_target.role = 'owner' then
    raise exception using errcode = '42501', message = 'space-membership-action-forbidden';
  end if;

  -- Only the Space owner may grant admin authority or administer an existing admin.
  -- Delegated admins can manage member/viewer memberships without gaining a path to
  -- peer-admin takeover or privilege escalation.
  if not v_actor_is_owner and (
    v_target.role = 'admin'
    or (v_action = 'change-role' and v_role = 'admin')
  ) then
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
