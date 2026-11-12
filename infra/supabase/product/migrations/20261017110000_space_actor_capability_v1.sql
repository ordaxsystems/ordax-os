begin;

-- Subject-bound presentation projection for the current actor in one Space.
-- Authorization semantics remain owned by ordax_policy.can_access_space/can_admin_space.
create or replace function public.ordax_get_space_actor_capability_v1(p_space_id uuid)
returns table (
  space_id uuid,
  user_id uuid,
  role text,
  state text,
  can_manage_members boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_owner boolean := false;
  v_role text;
  v_state text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication-required';
  end if;
  if p_space_id is null then
    raise exception using errcode = '22023', message = 'space-id-required';
  end if;
  if not ordax_policy.can_access_space(p_space_id) then
    raise exception using errcode = '42501', message = 'space-not-found-or-forbidden';
  end if;

  select exists(
    select 1 from public.ordax_spaces s
    where s.space_id = p_space_id and s.owner_user_id = v_user_id
  ) into v_owner;

  if v_owner then
    v_role := 'owner';
    v_state := 'active';
  else
    select m.role, m.state into v_role, v_state
    from public.ordax_space_members m
    where m.space_id = p_space_id and m.user_id = v_user_id;
  end if;

  if v_role is null or v_state is null then
    raise exception using errcode = '42501', message = 'space-not-found-or-forbidden';
  end if;

  return query select p_space_id, v_user_id, v_role, v_state, ordax_policy.can_admin_space(p_space_id);
end;
$$;

revoke all on function public.ordax_get_space_actor_capability_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_get_space_actor_capability_v1(uuid)
  to authenticated;

commit;
