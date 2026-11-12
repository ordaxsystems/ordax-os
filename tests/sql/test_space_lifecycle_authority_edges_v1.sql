\set ON_ERROR_STOP on

-- Reuse the canonical lifecycle authority proof, then add edge cases that depend on
-- its exact fixture. This avoids maintaining a second database setup/authority model.
\ir test_space_lifecycle_authority_v1.sql

-- service_role is deliberately not an execution identity for user lifecycle actions.
do $$
begin
  if has_function_privilege(
    'service_role',
    'public.ordax_mutate_space_lifecycle_v1(uuid,text,text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'service_role can execute user lifecycle RPC';
  end if;
end;
$$;

-- A subject with access to one Space cannot enumerate/mutate another Space through
-- the lifecycle RPC. The same non-enumerating error is returned as for insufficient role.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_mutate_space_lifecycle_v1(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'rename',
      'Cross Space Bypass',
      '60000000-0000-4000-8000-000000000001'
    );
  exception when sqlstate '42501' then
    blocked := sqlerrm = 'space-not-found-or-forbidden';
  end;
  if not blocked then
    raise exception 'cross-Space lifecycle mutation was not rejected';
  end if;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.ordax_spaces
    where space_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      and name = 'Cross Space Bypass'
  ) then
    raise exception 'cross-Space lifecycle attempt changed target data';
  end if;
end;
$$;
