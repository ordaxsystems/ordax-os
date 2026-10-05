-- Isolate public Network/Memory RPC wrappers from direct application-role
-- access to private implementation helpers.
--
-- The executor roles are deliberately non-login and non-privileged. Public
-- wrappers run as the domain executor and may reach only their audited private
-- helpers. The migration fails closed on role drift, unsafe helper contracts,
-- unexpected role membership, direct relation grants, or effective EXECUTE
-- outside each executor's private-function allowlist.

begin;

do $roles$
declare
  r record;
begin
  select rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin,
         rolreplication, rolbypassrls
    into r
    from pg_roles
   where rolname = 'ordax_network_executor';

  if not found then
    create role ordax_network_executor
      nosuperuser nocreatedb nocreaterole noinherit nologin noreplication nobypassrls;
  elsif r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit
     or r.rolcanlogin or r.rolreplication or r.rolbypassrls then
    raise exception 'ordax_network_executor violates least-privilege role contract';
  end if;

  select rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin,
         rolreplication, rolbypassrls
    into r
    from pg_roles
   where rolname = 'ordax_memory_executor';

  if not found then
    create role ordax_memory_executor
      nosuperuser nocreatedb nocreaterole noinherit nologin noreplication nobypassrls;
  elsif r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit
     or r.rolcanlogin or r.rolreplication or r.rolbypassrls then
    raise exception 'ordax_memory_executor violates least-privilege role contract';
  end if;
end;
$roles$;

grant ordax_network_executor to postgres;
grant ordax_memory_executor to postgres;

revoke all on schema private from ordax_network_executor, ordax_memory_executor;
revoke all on schema public from ordax_network_executor, ordax_memory_executor;
grant usage on schema private to ordax_network_executor, ordax_memory_executor;
grant usage on schema public to ordax_network_executor, ordax_memory_executor;

-- Fail closed before changing function ownership. Every public wrapper must
-- already pin search_path, every target private helper must be a pinned
-- SECURITY DEFINER, and both domains must actually exist.
do $preflight$
declare
  bad_count integer;
  network_wrapper_count integer;
  network_helper_count integer;
begin
  select count(*) into network_wrapper_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname like 'ordax_network_%'
    and position('private.ordax_network_' in pg_get_functiondef(p.oid)) > 0;

  select count(*) into network_helper_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prokind = 'f'
    and p.proname like 'ordax_network_%';

  if network_wrapper_count = 0 or network_helper_count = 0 then
    raise exception 'OrdaX private-domain executor migration: Network boundary missing';
  end if;

  select count(*) into bad_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and (
      (p.proname like 'ordax_network_%'
       and position('private.ordax_network_' in pg_get_functiondef(p.oid)) > 0)
      or p.proname = 'ordax_apply_memory_mutation_v1'
    )
    and not ('search_path=""' = any(coalesce(p.proconfig, '{}'::text[])));
  if bad_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: unsafe public wrapper search_path';
  end if;

  select count(*) into bad_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prokind = 'f'
    and (p.proname like 'ordax_network_%'
         or p.proname = 'ordax_apply_memory_mutation_internal_v1')
    and (
      not p.prosecdef
      or not ('search_path=""' = any(coalesce(p.proconfig, '{}'::text[])))
    );
  if bad_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: unsafe private helper contract';
  end if;

  if not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'ordax_apply_memory_mutation_v1'
      and p.prokind = 'f'
  ) or not exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'ordax_apply_memory_mutation_internal_v1'
      and p.prokind = 'f'
  ) then
    raise exception 'OrdaX private-domain executor migration: Memory boundary missing';
  end if;

  -- Only postgres may hold either executor role. The executors themselves must
  -- not be members of any other role, even though they are NOINHERIT.
  select count(*) into bad_count
  from pg_auth_members am
  join pg_roles granted_role on granted_role.oid = am.roleid
  join pg_roles member_role on member_role.oid = am.member
  where granted_role.rolname in ('ordax_network_executor', 'ordax_memory_executor')
    and member_role.rolname <> 'postgres';
  if bad_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: unexpected executor member';
  end if;

  select count(*) into bad_count
  from pg_auth_members am
  join pg_roles parent_role on parent_role.oid = am.roleid
  join pg_roles member_role on member_role.oid = am.member
  where member_role.rolname in ('ordax_network_executor', 'ordax_memory_executor');
  if bad_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: executor belongs to another role';
  end if;
end;
$preflight$;

-- Network: remove API-role authority from every current private Network helper
-- before granting the dedicated executor. service_role is explicitly revoked;
-- privileged server code must use the public audited boundary too.
do $network_private_acl$
declare
  f record;
begin
  for f in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prokind = 'f'
      and p.proname like 'ordax_network_%'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated, service_role, ordax_network_executor, ordax_memory_executor',
      f.nspname, f.proname, f.args
    );
    execute format(
      'grant execute on function %I.%I(%s) to ordax_network_executor',
      f.nspname, f.proname, f.args
    );
  end loop;
end;
$network_private_acl$;

-- Memory: exactly one private mutation helper is reachable by its executor.
revoke all on function private.ordax_apply_memory_mutation_internal_v1(
  text, uuid, text, uuid, text, text, text, text, timestamp with time zone,
  numeric, bigint, boolean, integer
) from public, anon, authenticated, service_role, ordax_network_executor, ordax_memory_executor;
grant execute on function private.ordax_apply_memory_mutation_internal_v1(
  text, uuid, text, uuid, text, text, text, text, timestamp with time zone,
  numeric, bigint, boolean, integer
) to ordax_memory_executor;

-- Ownership transfer requires CREATE on public only inside this transaction.
grant create on schema public to ordax_network_executor, ordax_memory_executor;

do $network_wrappers$
declare
  f record;
begin
  for f in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname like 'ordax_network_%'
      and position('private.ordax_network_' in pg_get_functiondef(p.oid)) > 0
  loop
    execute format('alter function %I.%I(%s) security definer', f.nspname, f.proname, f.args);
    execute format('alter function %I.%I(%s) set search_path = %L', f.nspname, f.proname, f.args, '');
    execute format('alter function %I.%I(%s) owner to ordax_network_executor', f.nspname, f.proname, f.args);
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated, service_role',
      f.nspname, f.proname, f.args
    );
    execute format(
      'grant execute on function %I.%I(%s) to authenticated, service_role',
      f.nspname, f.proname, f.args
    );
  end loop;
end;
$network_wrappers$;

alter function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamp with time zone,
  numeric, bigint, boolean, integer
) security definer;
alter function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamp with time zone,
  numeric, bigint, boolean, integer
) set search_path = '';
alter function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamp with time zone,
  numeric, bigint, boolean, integer
) owner to ordax_memory_executor;
revoke all on function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamp with time zone,
  numeric, bigint, boolean, integer
) from public, anon, authenticated, service_role;
grant execute on function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamp with time zone,
  numeric, bigint, boolean, integer
) to authenticated, service_role;

revoke create on schema public from ordax_network_executor, ordax_memory_executor;

-- Defense in depth. In addition to rejecting relation authority, validate
-- *effective* private-function EXECUTE. This catches an accidental PUBLIC
-- EXECUTE grant, because such a grant would otherwise bypass a per-role REVOKE.
do $postflight$
declare
  direct_count integer;
  sequence_count integer;
  owned_relation_count integer;
  unexpected_exec_count integer;
  missing_exec_count integer;
  api_exec_count integer;
begin
  select count(*) into direct_count
  from information_schema.role_table_grants
  where grantee in ('ordax_network_executor', 'ordax_memory_executor');
  if direct_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: direct table grant detected';
  end if;

  select count(*) into owned_relation_count
  from pg_class c
  join pg_roles r on r.oid = c.relowner
  where r.rolname in ('ordax_network_executor', 'ordax_memory_executor')
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f');
  if owned_relation_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: executor owns relation';
  end if;

  select count(*) into sequence_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'S'
    and n.nspname in ('public', 'private')
    and (
      has_sequence_privilege('ordax_network_executor', c.oid, 'USAGE')
      or has_sequence_privilege('ordax_network_executor', c.oid, 'SELECT')
      or has_sequence_privilege('ordax_network_executor', c.oid, 'UPDATE')
      or has_sequence_privilege('ordax_memory_executor', c.oid, 'USAGE')
      or has_sequence_privilege('ordax_memory_executor', c.oid, 'SELECT')
      or has_sequence_privilege('ordax_memory_executor', c.oid, 'UPDATE')
    );
  if sequence_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: direct sequence grant detected';
  end if;

  if has_schema_privilege('ordax_network_executor', 'public', 'CREATE')
     or has_schema_privilege('ordax_memory_executor', 'public', 'CREATE') then
    raise exception 'OrdaX private-domain executor migration: CREATE privilege leaked';
  end if;

  select count(*) into unexpected_exec_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prokind = 'f'
    and has_function_privilege('ordax_network_executor', p.oid, 'EXECUTE')
    and p.proname not like 'ordax_network_%';
  if unexpected_exec_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: Network executor can execute unexpected private function';
  end if;

  select count(*) into unexpected_exec_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prokind = 'f'
    and has_function_privilege('ordax_memory_executor', p.oid, 'EXECUTE')
    and p.proname <> 'ordax_apply_memory_mutation_internal_v1';
  if unexpected_exec_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: Memory executor can execute unexpected private function';
  end if;

  select count(*) into missing_exec_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prokind = 'f'
    and p.proname like 'ordax_network_%'
    and not has_function_privilege('ordax_network_executor', p.oid, 'EXECUTE');
  if missing_exec_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: Network helper grant missing';
  end if;

  if not has_function_privilege(
    'ordax_memory_executor',
    'private.ordax_apply_memory_mutation_internal_v1(text,uuid,text,uuid,text,text,text,text,timestamp with time zone,numeric,bigint,boolean,integer)',
    'EXECUTE'
  ) then
    raise exception 'OrdaX private-domain executor migration: Memory helper grant missing';
  end if;

  select count(*) into api_exec_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prokind = 'f'
    and (p.proname like 'ordax_network_%'
         or p.proname = 'ordax_apply_memory_mutation_internal_v1')
    and (
      has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('service_role', p.oid, 'EXECUTE')
      or has_function_privilege('anon', p.oid, 'EXECUTE')
    );
  if api_exec_count <> 0 then
    raise exception 'OrdaX private-domain executor migration: API role still executes private domain helper';
  end if;
end;
$postflight$;

commit;
