begin;

-- Lifecycle mutations are server-authoritative. Clients retain read access through
-- the canonical Space projection, but may not update/delete ordax_spaces directly.
revoke update, delete on table public.ordax_spaces from authenticated;

create table private.ordax_space_lifecycle_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  space_id uuid not null references public.ordax_spaces(space_id) on delete cascade,
  action text not null check (action in ('rename','archive','restore')),
  requested_name text,
  result_name text not null,
  result_state text not null check (result_state in ('active','archived')),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, idempotency_key),
  check (
    (action = 'rename' and requested_name is not null)
    or (action in ('archive','restore') and requested_name is null)
  )
);

revoke all on table private.ordax_space_lifecycle_requests
  from public, anon, authenticated, service_role;

create or replace function public.ordax_mutate_space_lifecycle_v1(
  p_space_id uuid,
  p_action text,
  p_name text,
  p_idempotency_key uuid
)
returns table (
  space_id uuid,
  name text,
  state text,
  changed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action text := btrim(coalesce(p_action, ''));
  v_name text;
  v_space public.ordax_spaces%rowtype;
  v_existing private.ordax_space_lifecycle_requests%rowtype;
  v_authorized boolean := false;
  v_changed boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication-required';
  end if;
  if p_space_id is null then
    raise exception using errcode = '22023', message = 'space-id-required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'space-lifecycle-idempotency-key-required';
  end if;
  if v_action not in ('rename', 'archive', 'restore') then
    raise exception using errcode = '22023', message = 'space-lifecycle-action-invalid';
  end if;

  if v_action = 'rename' then
    v_name := btrim(coalesce(p_name, ''));
    if char_length(v_name) < 1 or char_length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
      raise exception using errcode = '22023', message = 'invalid-space-name';
    end if;
  elsif p_name is not null then
    raise exception using errcode = '22023', message = 'space-lifecycle-name-not-allowed';
  end if;

  -- Lock and revalidate current authority before either a fresh mutation or an
  -- idempotent replay. Revoked/suspended admins must fail closed even when they hold
  -- a previously successful idempotency key.
  select s.*
    into v_space
  from public.ordax_spaces s
  where s.space_id = p_space_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'space-not-found-or-forbidden';
  end if;

  v_authorized := v_space.owner_user_id = v_actor
    or exists (
      select 1
      from public.ordax_space_members m
      where m.space_id = p_space_id
        and m.user_id = v_actor
        and m.state = 'active'
        and m.role in ('owner','admin')
    );

  if not v_authorized then
    raise exception using errcode = '42501', message = 'space-not-found-or-forbidden';
  end if;

  -- Idempotency is bound to the currently authorized subject and exact payload.
  select r.*
    into v_existing
  from private.ordax_space_lifecycle_requests r
  where r.user_id = v_actor
    and r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.space_id <> p_space_id
      or v_existing.action <> v_action
      or v_existing.requested_name is distinct from v_name then
      raise exception using errcode = '22023', message = 'space-lifecycle-idempotency-conflict';
    end if;

    return query
    select v_existing.space_id,
           v_existing.result_name,
           v_existing.result_state,
           false;
    return;
  end if;

  if v_action = 'rename' then
    v_changed := v_space.name is distinct from v_name;
    if v_changed then
      update public.ordax_spaces s
      set name = v_name
      where s.space_id = p_space_id;
      v_space.name := v_name;
    end if;
  elsif v_action = 'archive' then
    v_changed := v_space.state <> 'archived';
    if v_changed then
      update public.ordax_spaces s
      set state = 'archived'
      where s.space_id = p_space_id;
      v_space.state := 'archived';
    end if;
  else
    v_changed := v_space.state <> 'active';
    if v_changed then
      update public.ordax_spaces s
      set state = 'active'
      where s.space_id = p_space_id;
      v_space.state := 'active';
    end if;
  end if;

  insert into private.ordax_space_lifecycle_requests(
    user_id,
    idempotency_key,
    space_id,
    action,
    requested_name,
    result_name,
    result_state
  ) values (
    v_actor,
    p_idempotency_key,
    p_space_id,
    v_action,
    v_name,
    v_space.name,
    v_space.state
  );

  return query
  select p_space_id,
         v_space.name,
         v_space.state,
         v_changed;
end;
$$;

revoke all on function public.ordax_mutate_space_lifecycle_v1(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_mutate_space_lifecycle_v1(uuid, text, text, uuid)
  to authenticated;

commit;
