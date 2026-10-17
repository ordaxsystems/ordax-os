\set ON_ERROR_STOP on

-- Reuse the real Space-creation authority proof so this test also verifies that
-- server-side creation keeps creating the owner membership after client DML closes.
\ir test_space_creation_authority_v1.sql

-- Reproduce the historical membership policy names. The boundary migration must
-- preserve read while removing the client-write policies themselves.
alter table public.ordax_space_members enable row level security;
create policy ordax_space_members_select_space
  on public.ordax_space_members for select to authenticated
  using (true);
create policy ordax_space_members_insert_admin
  on public.ordax_space_members for insert to authenticated
  with check (true);
create policy ordax_space_members_update_admin
  on public.ordax_space_members for update to authenticated
  using (true) with check (true);
create policy ordax_space_members_delete_admin
  on public.ordax_space_members for delete to authenticated
  using (true);

\ir ../../infra/supabase/product/migrations/20261017070000_space_membership_mutation_boundary_v1.sql

do $$
begin
  if not has_table_privilege('authenticated', 'public.ordax_space_members', 'SELECT') then
    raise exception 'authenticated lost membership SELECT';
  end if;
  if has_table_privilege('authenticated', 'public.ordax_space_members', 'INSERT')
    or has_table_privilege('authenticated', 'public.ordax_space_members', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ordax_space_members', 'DELETE') then
    raise exception 'authenticated retained direct membership mutation privilege';
  end if;
  if has_table_privilege('anon', 'public.ordax_space_members', 'INSERT')
    or has_table_privilege('anon', 'public.ordax_space_members', 'UPDATE')
    or has_table_privilege('anon', 'public.ordax_space_members', 'DELETE') then
    raise exception 'anon gained membership mutation privilege';
  end if;
  if has_table_privilege('service_role', 'public.ordax_space_members', 'INSERT')
    or has_table_privilege('service_role', 'public.ordax_space_members', 'UPDATE')
    or has_table_privilege('service_role', 'public.ordax_space_members', 'DELETE') then
    raise exception 'service_role retained membership table mutation privilege';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ordax_space_members'
      and policyname = 'ordax_space_members_select_space'
  ) then
    raise exception 'membership read policy was removed';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ordax_space_members'
      and policyname in (
        'ordax_space_members_insert_admin',
        'ordax_space_members_update_admin',
        'ordax_space_members_delete_admin'
      )
  ) then
    raise exception 'membership client-write policy remained reachable';
  end if;
end;
$$;

-- Direct role/member mutation is denied even for the Space owner.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  target_space uuid;
  insert_blocked boolean := false;
  update_blocked boolean := false;
  delete_blocked boolean := false;
begin
  select space_id into target_space
  from public.ordax_spaces
  where owner_user_id = '11111111-1111-4111-8111-111111111111'
  order by created_at
  limit 1;

  begin
    insert into public.ordax_space_members(space_id, user_id, role, state)
    values (
      target_space,
      '22222222-2222-4222-8222-222222222222',
      'admin',
      'active'
    );
  exception when insufficient_privilege then
    insert_blocked := true;
  end;

  begin
    update public.ordax_space_members
    set role = 'admin'
    where space_id = target_space
      and user_id = '11111111-1111-4111-8111-111111111111';
  exception when insufficient_privilege then
    update_blocked := true;
  end;

  begin
    delete from public.ordax_space_members
    where space_id = target_space
      and user_id = '11111111-1111-4111-8111-111111111111';
  exception when insufficient_privilege then
    delete_blocked := true;
  end;

  if not insert_blocked or not update_blocked or not delete_blocked then
    raise exception 'direct membership mutation bypass remains available';
  end if;
end;
$$;

reset role;

-- The canonical Space creation RPC is a security-definer owner and must continue
-- creating its owner membership even though clients cannot write the table.
insert into auth.users(id)
values ('33333333-3333-4333-8333-333333333333');
insert into public.ordax_accounts(user_id)
values ('33333333-3333-4333-8333-333333333333');

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

do $$
declare
  created_row record;
begin
  select * into created_row
  from public.ordax_create_space_v1(
    'Space protegido',
    'fabrication',
    '3d-printing',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  );
  if created_row.created is distinct from true then
    raise exception 'server-authoritative create failed after membership boundary';
  end if;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.ordax_space_members m
    join public.ordax_spaces s on s.space_id = m.space_id
    where s.owner_user_id = '33333333-3333-4333-8333-333333333333'
      and m.user_id = '33333333-3333-4333-8333-333333333333'
      and m.role = 'owner'
      and m.state = 'active'
  ) then
    raise exception 'creation RPC no longer creates canonical owner membership';
  end if;
end;
$$;
