\set ON_ERROR_STOP on

\ir fixtures/space_lifecycle_authority_v1_fixture.sql
\ir ../../infra/supabase/product/migrations/20261017070000_space_membership_mutation_boundary_v1.sql

insert into auth.users(id)
values ('55555555-5555-4555-8555-555555555555');
insert into public.ordax_space_members(space_id, user_id, role, state)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '55555555-5555-4555-8555-555555555555',
  'viewer',
  'active'
);

\ir ../../infra/supabase/product/migrations/20261017090000_space_membership_actions_v1.sql
\ir ../../infra/supabase/product/migrations/20261017102000_space_members_read_authority_v1.sql
\ir ../../infra/supabase/product/migrations/20261017143000_space_members_action_capabilities_v1.sql
\ir ../../infra/supabase/product/migrations/20261017190000_space_members_state_actions_v1.sql

-- The latest deployed membership mutation/read functions are proved together on real PostgreSQL.
-- This prevents a later migration from changing executable behavior while only source tests stay green.

-- Public authority surface is bounded to authenticated user sessions.
do $$
begin
  if not has_function_privilege(
    'authenticated',
    'public.ordax_mutate_space_membership_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute membership action RPC';
  end if;
  if has_function_privilege(
    'anon',
    'public.ordax_mutate_space_membership_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute membership action RPC';
  end if;
  if has_function_privilege(
    'service_role',
    'public.ordax_mutate_space_membership_v1(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role can execute user membership action RPC';
  end if;
  if has_table_privilege(
    'authenticated',
    'private.ordax_space_membership_action_receipts',
    'SELECT'
  ) then
    raise exception 'private membership action receipts leaked to authenticated';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.ordax_list_space_members_v1(uuid,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute latest members read RPC';
  end if;
  if has_function_privilege(
    'anon',
    'public.ordax_list_space_members_v1(uuid,uuid,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.ordax_list_space_members_v1(uuid,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'members read RPC leaked beyond authenticated';
  end if;
  if has_function_privilege(
    'authenticated',
    'private.ordax_space_member_action_capabilities_v1(uuid,boolean,boolean,uuid,boolean,text,text)',
    'EXECUTE'
  ) then
    raise exception 'private target-action helper leaked to authenticated';
  end if;
end;
$$;

-- Target-specific actions are projected by PostgreSQL, not inferred by clients.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

-- Multiple bounded pages must cover the same members, once each and in cursor order.
-- This guards the SQL side of the gateway's strict cursor progression check.
do $$
declare
  all_members uuid[];
  paged_members uuid[] := '{}'::uuid[];
  batch uuid[];
  checkpoint uuid := null;
begin
  select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
    into all_members
  from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 128
  );
  loop
    select coalesce(array_agg(user_id order by user_id), '{}'::uuid[])
      into batch
    from public.ordax_list_space_members_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', checkpoint, 2
    );
    exit when cardinality(batch) = 0;
    if checkpoint is not null and batch[1] <= checkpoint then
      raise exception 'members page did not advance beyond requested cursor';
    end if;
    paged_members := paged_members || batch;
    checkpoint := batch[cardinality(batch)];
    exit when cardinality(batch) < 2;
  end loop;
  if paged_members is distinct from all_members then
    raise exception 'members cursor pagination skipped or duplicated users';
  end if;
end;
$$;

do $$
declare
  owner_row record;
  admin_row record;
  member_row record;
begin
  select * into owner_row
  from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '11111111-1111-4111-8111-111111111111';

  if owner_row.can_change_role or owner_row.can_suspend or owner_row.can_reactivate or owner_row.can_remove
    or cardinality(owner_row.assignable_roles) <> 0 then
    raise exception 'owner target exposed administrative member actions';
  end if;

  select * into admin_row
  from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '22222222-2222-4222-8222-222222222222';

  if not admin_row.can_change_role or not admin_row.can_suspend or admin_row.can_reactivate or not admin_row.can_remove
    or admin_row.assignable_roles is distinct from array['admin','member','viewer']::text[] then
    raise exception 'owner did not receive exact admin-target capabilities';
  end if;

  select * into member_row
  from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '33333333-3333-4333-8333-333333333333';

  if member_row.assignable_roles is distinct from array['admin','member','viewer']::text[] then
    raise exception 'owner assignable roles drifted for member target';
  end if;
end;
$$;

-- Delegated admin receives least-privilege target capabilities from the same helper.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
declare
  self_row record;
  owner_row record;
  peer_admin_row record;
  member_row record;
  viewer_row record;
begin
  select * into self_row from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '22222222-2222-4222-8222-222222222222';
  select * into owner_row from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '11111111-1111-4111-8111-111111111111';
  select * into peer_admin_row from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '44444444-4444-4444-8444-444444444444';
  select * into member_row from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '33333333-3333-4333-8333-333333333333';
  select * into viewer_row from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '55555555-5555-4555-8555-555555555555';

  if self_row.can_change_role or self_row.can_suspend or self_row.can_reactivate or self_row.can_remove
    or owner_row.can_change_role or owner_row.can_suspend or owner_row.can_reactivate or owner_row.can_remove
    or peer_admin_row.can_change_role or peer_admin_row.can_suspend or peer_admin_row.can_reactivate or peer_admin_row.can_remove then
    raise exception 'delegated admin received authority over self/owner/peer-admin target';
  end if;

  if not member_row.can_change_role or not member_row.can_suspend or member_row.can_reactivate or not member_row.can_remove
    or member_row.assignable_roles is distinct from array['member','viewer']::text[]
    or viewer_row.assignable_roles is distinct from array['member','viewer']::text[] then
    raise exception 'delegated admin target capabilities are not least privilege';
  end if;
end;
$$;

-- A normal member may read the membership projection but receives no management actions.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

do $$
declare
  leaked integer;
begin
  select count(*) into leaked
  from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  )
  where can_change_role or can_suspend or can_reactivate or can_remove or cardinality(assignable_roles) > 0;
  if leaked <> 0 then
    raise exception 'non-admin received projected management capability';
  end if;
end;
$$;

-- Cross-Space reads remain fail-closed after the action-capability migration.
do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_list_space_members_v1(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, 64
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'space-not-found-or-forbidden';
  end;
  if not blocked then
    raise exception 'cross-Space members projection did not fail closed';
  end if;
end;
$$;

-- A suspended target exposes reactivation but no redundant suspend transition.
reset role;
update public.ordax_space_members set state = 'suspended'
where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '55555555-5555-4555-8555-555555555555';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
do $$
declare projected record;
begin
  select * into projected from public.ordax_list_space_members_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 64
  ) where user_id = '55555555-5555-4555-8555-555555555555';
  if projected.can_suspend or not projected.can_reactivate or not projected.can_remove
     or not projected.can_change_role then
    raise exception 'suspended target has invalid projected state actions';
  end if;
end;
$$;
reset role;
update public.ordax_space_members set state = 'active'
where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '55555555-5555-4555-8555-555555555555';
-- Owner can grant/revoke delegated admin without touching ownership.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  promoted record;
  demoted record;
  owner_blocked boolean := false;
begin
  select * into promoted
  from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'change-role',
    'admin',
    '71000000-0000-4000-8000-000000000001'
  );
  if promoted.role <> 'admin' or promoted.changed is distinct from true then
    raise exception 'owner could not promote member to admin';
  end if;

  select * into demoted
  from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'change-role',
    'member',
    '71000000-0000-4000-8000-000000000002'
  );
  if demoted.role <> 'member' or demoted.changed is distinct from true then
    raise exception 'owner could not demote delegated admin';
  end if;

  begin
    perform * from public.ordax_mutate_space_membership_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      'change-role',
      'member',
      '71000000-0000-4000-8000-000000000003'
    );
  exception when sqlstate '42501' then
    owner_blocked := sqlerrm = 'space-membership-action-forbidden';
  end;
  if not owner_blocked then
    raise exception 'owner membership was mutable outside ownership transfer';
  end if;
end;
$$;

-- Delegated admin can operate member/viewer memberships but cannot grant/administer admin.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
declare
  changed_role record;
  suspended record;
  reactivated record;
  repeated record;
  promote_blocked boolean := false;
  peer_admin_blocked boolean := false;
  self_blocked boolean := false;
begin
  select * into changed_role
  from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'change-role',
    'viewer',
    '72000000-0000-4000-8000-000000000001'
  );
  if changed_role.role <> 'viewer' or changed_role.changed is distinct from true then
    raise exception 'admin could not change member/viewer role';
  end if;

  select * into suspended
  from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'suspend',
    null,
    '72000000-0000-4000-8000-000000000002'
  );
  if suspended.state <> 'suspended' or suspended.changed is distinct from true then
    raise exception 'admin could not suspend viewer';
  end if;

  select * into repeated from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'suspend', null, '72000000-0000-4000-8000-000000000007'
  );
  if repeated.state <> 'suspended' or repeated.changed is distinct from false then
    raise exception 'already-suspended noop lost compatibility';
  end if;

  select * into reactivated
  from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'reactivate',
    null,
    '72000000-0000-4000-8000-000000000003'
  );
  if reactivated.state <> 'active' or reactivated.changed is distinct from true then
    raise exception 'admin could not reactivate viewer';
  end if;

  select * into repeated from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'reactivate', null, '72000000-0000-4000-8000-000000000008'
  );
  if repeated.state <> 'active' or repeated.changed is distinct from false then
    raise exception 'already-active noop lost compatibility';
  end if;

  begin
    perform * from public.ordax_mutate_space_membership_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      'change-role',
      'admin',
      '72000000-0000-4000-8000-000000000004'
    );
  exception when sqlstate '42501' then
    promote_blocked := sqlerrm = 'space-membership-action-forbidden';
  end;

  begin
    perform * from public.ordax_mutate_space_membership_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '44444444-4444-4444-8444-444444444444',
      'reactivate',
      null,
      '72000000-0000-4000-8000-000000000005'
    );
  exception when sqlstate '42501' then
    peer_admin_blocked := sqlerrm = 'space-membership-action-forbidden';
  end;

  begin
    perform * from public.ordax_mutate_space_membership_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22222222-2222-4222-8222-222222222222',
      'remove',
      null,
      '72000000-0000-4000-8000-000000000006'
    );
  exception when sqlstate '42501' then
    self_blocked := sqlerrm = 'space-membership-action-forbidden';
  end;

  if not promote_blocked or not peer_admin_blocked or not self_blocked then
    raise exception 'delegated admin crossed its membership authority boundary';
  end if;
end;
$$;

-- Remove is idempotent even after the target row is gone; payload drift conflicts.
do $$
declare
  removed_row record;
  replay_row record;
  conflict_blocked boolean := false;
begin
  select * into removed_row
  from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '55555555-5555-4555-8555-555555555555',
    'remove',
    null,
    '73000000-0000-4000-8000-000000000001'
  );
  if removed_row.removed is distinct from true or removed_row.changed is distinct from true then
    raise exception 'admin could not remove viewer';
  end if;

  select * into replay_row
  from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '55555555-5555-4555-8555-555555555555',
    'remove',
    null,
    '73000000-0000-4000-8000-000000000001'
  );
  if replay_row.removed is distinct from true or replay_row.changed is distinct from false then
    raise exception 'remove replay was not idempotent';
  end if;

  begin
    perform * from public.ordax_mutate_space_membership_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '55555555-5555-4555-8555-555555555555',
      'suspend',
      null,
      '73000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '22023' then
    conflict_blocked := sqlerrm = 'space-membership-idempotency-conflict';
  end;
  if not conflict_blocked then
    raise exception 'membership idempotency payload drift was accepted';
  end if;
end;
$$;

-- Cross-Space and unknown targets fail closed without creating rows.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

do $$
declare
  cross_blocked boolean := false;
  missing_blocked boolean := false;
begin
  begin
    perform * from public.ordax_mutate_space_membership_v1(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '22222222-2222-4222-8222-222222222222',
      'suspend',
      null,
      '74000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '42501' then
    cross_blocked := sqlerrm = 'space-membership-not-found-or-forbidden';
  end;

  begin
    perform * from public.ordax_mutate_space_membership_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '99999999-9999-4999-8999-999999999999',
      'suspend',
      null,
      '74000000-0000-4000-8000-000000000002'
    );
  exception when sqlstate '42501' then
    missing_blocked := sqlerrm = 'space-membership-not-found-or-forbidden';
  end;

  if not cross_blocked or not missing_blocked then
    raise exception 'cross-Space or missing membership action did not fail closed';
  end if;
end;
$$;

-- Stale admin authority cannot replay a previously successful action.
reset role;
update public.ordax_space_members
set role = 'member', state = 'active'
where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '33333333-3333-4333-8333-333333333333';
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
declare
  first_row record;
begin
  select * into first_row
  from public.ordax_mutate_space_membership_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'suspend',
    null,
    '75000000-0000-4000-8000-000000000001'
  );
  if first_row.changed is distinct from true then
    raise exception 'admin setup action failed';
  end if;
end;
$$;

reset role;
update public.ordax_space_members
set state = 'suspended'
where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '22222222-2222-4222-8222-222222222222';
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
declare
  replay_blocked boolean := false;
begin
  begin
    perform * from public.ordax_mutate_space_membership_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '33333333-3333-4333-8333-333333333333',
      'suspend',
      null,
      '75000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '42501' then
    replay_blocked := sqlerrm = 'space-membership-not-found-or-forbidden';
  end;
  if not replay_blocked then
    raise exception 'stale admin authority replayed old membership action';
  end if;
end;
$$;

reset role;

-- Ownership identity remains unchanged throughout membership administration.
do $$
declare
  s record;
  owner_member record;
begin
  select * into s
  from public.ordax_spaces
  where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  select * into owner_member
  from public.ordax_space_members
  where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and user_id = '11111111-1111-4111-8111-111111111111';

  if s.owner_user_id <> '11111111-1111-4111-8111-111111111111'
    or owner_member.role <> 'owner'
    or owner_member.state <> 'active' then
    raise exception 'membership actions altered ownership invariants';
  end if;
end;
$$;
