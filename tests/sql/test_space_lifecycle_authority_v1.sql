\set ON_ERROR_STOP on

\ir fixtures/space_lifecycle_authority_v1_fixture.sql
\ir ../../infra/supabase/product/migrations/20261017060000_space_lifecycle_authority_v1.sql

-- Direct table mutation must be gone while the bounded RPC remains callable.
do $$
begin
  if has_table_privilege('authenticated', 'public.ordax_spaces', 'UPDATE') then
    raise exception 'authenticated retained direct ordax_spaces UPDATE';
  end if;
  if has_table_privilege('authenticated', 'public.ordax_spaces', 'DELETE') then
    raise exception 'authenticated retained direct ordax_spaces DELETE';
  end if;
  if not has_table_privilege('authenticated', 'public.ordax_spaces', 'SELECT') then
    raise exception 'authenticated lost ordax_spaces SELECT';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.ordax_mutate_space_lifecycle_v1(uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute lifecycle RPC';
  end if;
  if has_function_privilege(
    'anon',
    'public.ordax_mutate_space_lifecycle_v1(uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute lifecycle RPC';
  end if;
  if has_table_privilege('authenticated', 'private.ordax_space_lifecycle_requests', 'SELECT') then
    raise exception 'private lifecycle idempotency store leaked to authenticated';
  end if;
end;
$$;

-- Owner can rename; normalized request is persisted and replay is idempotent.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  first_row record;
  replay_row record;
  blocked boolean := false;
begin
  select * into first_row
  from public.ordax_mutate_space_lifecycle_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'rename',
    '  Pizzaria Centro Premium  ',
    '10000000-0000-4000-8000-000000000001'
  );
  if first_row.name <> 'Pizzaria Centro Premium'
    or first_row.state <> 'active'
    or first_row.changed is distinct from true then
    raise exception 'owner rename result is invalid';
  end if;

  select * into replay_row
  from public.ordax_mutate_space_lifecycle_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'rename',
    'Pizzaria Centro Premium',
    '10000000-0000-4000-8000-000000000001'
  );
  if replay_row.name <> 'Pizzaria Centro Premium'
    or replay_row.state <> 'active'
    or replay_row.changed is distinct from false then
    raise exception 'lifecycle replay did not return the original result safely';
  end if;

  begin
    perform * from public.ordax_mutate_space_lifecycle_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'rename',
      'Payload drift',
      '10000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '22023' then
    blocked := sqlerrm = 'space-lifecycle-idempotency-conflict';
  end;
  if not blocked then
    raise exception 'idempotency payload drift was not rejected';
  end if;
end;
$$;

-- Direct UPDATE/DELETE are denied even to an authenticated owner.
do $$
declare
  update_blocked boolean := false;
  delete_blocked boolean := false;
begin
  begin
    update public.ordax_spaces
    set name = 'Bypass'
    where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when insufficient_privilege then
    update_blocked := true;
  end;
  begin
    delete from public.ordax_spaces
    where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when insufficient_privilege then
    delete_blocked := true;
  end;
  if not update_blocked or not delete_blocked then
    raise exception 'direct lifecycle/delete bypass remains available';
  end if;
end;
$$;

-- Active admin can archive and restore.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
declare
  archived record;
  restored record;
begin
  select * into archived
  from public.ordax_mutate_space_lifecycle_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'archive',
    null,
    '20000000-0000-4000-8000-000000000001'
  );
  if archived.state <> 'archived' or archived.changed is distinct from true then
    raise exception 'active admin could not archive Space';
  end if;

  select * into restored
  from public.ordax_mutate_space_lifecycle_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'restore',
    null,
    '20000000-0000-4000-8000-000000000002'
  );
  if restored.state <> 'active' or restored.changed is distinct from true then
    raise exception 'active admin could not restore Space';
  end if;
end;
$$;

-- Current authority is revalidated even for an old successful idempotency key.
reset role;
update public.ordax_space_members
set state = 'suspended'
where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and user_id = '22222222-2222-4222-8222-222222222222';
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_mutate_space_lifecycle_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'archive',
      null,
      '20000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'space-not-found-or-forbidden';
  end;
  if not blocked then
    raise exception 'revoked admin replayed a stale authorized lifecycle request';
  end if;
end;
$$;

-- Member and suspended admin fail closed with the same non-enumerating error.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_mutate_space_lifecycle_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'archive',
      null,
      '30000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'space-not-found-or-forbidden';
  end;
  if not blocked then
    raise exception 'member gained lifecycle authority';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_mutate_space_lifecycle_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'restore',
      null,
      '40000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'space-not-found-or-forbidden';
  end;
  if not blocked then
    raise exception 'suspended admin gained lifecycle authority';
  end if;
end;
$$;

-- Invalid action/name shapes fail before mutation.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  invalid_action boolean := false;
  invalid_payload boolean := false;
begin
  begin
    perform * from public.ordax_mutate_space_lifecycle_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'delete',
      null,
      '50000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '22023' then
    invalid_action := sqlerrm = 'space-lifecycle-action-invalid';
  end;
  begin
    perform * from public.ordax_mutate_space_lifecycle_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'archive',
      'unexpected-name',
      '50000000-0000-4000-8000-000000000002'
    );
  exception when sqlstate '22023' then
    invalid_payload := sqlerrm = 'space-lifecycle-name-not-allowed';
  end;
  if not invalid_action or not invalid_payload then
    raise exception 'invalid lifecycle payload was accepted';
  end if;
end;
$$;

reset role;

-- Only intended fields changed; identity/semantics remain intact.
do $$
declare
  s record;
begin
  select * into s
  from public.ordax_spaces
  where space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if s.owner_user_id <> '11111111-1111-4111-8111-111111111111'
    or s.kind <> 'professional'
    or s.domain <> 'food'
    or s.subtype <> 'pizzeria'
    or s.name <> 'Pizzaria Centro Premium'
    or s.state <> 'active' then
    raise exception 'lifecycle RPC modified fields outside its authority';
  end if;
end;
$$;
