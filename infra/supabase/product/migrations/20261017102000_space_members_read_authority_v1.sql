begin;

-- Canonical bounded read boundary for Space memberships.
-- Membership mutation authority remains exclusively in ordax_mutate_space_membership_v1.
create or replace function public.ordax_list_space_members_v1(
  p_space_id uuid,
  p_after_user_id uuid default null,
  p_limit integer default 64
)
returns table (
  space_id uuid,
  user_id uuid,
  role text,
  state text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication-required';
  end if;
  if p_space_id is null then
    raise exception using errcode = '22023', message = 'space-id-required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 128 then
    raise exception using errcode = '22023', message = 'space-members-limit-invalid';
  end if;

  -- One authorization owner: the canonical policy predicate. The RPC does not
  -- reproduce membership/owner rules and therefore cannot drift from RLS semantics.
  if not ordax_policy.can_access_space(p_space_id) then
    raise exception using errcode = '42501', message = 'space-not-found-or-forbidden';
  end if;

  return query
  select m.space_id, m.user_id, m.role, m.state
  from public.ordax_space_members m
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
