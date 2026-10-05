-- Final API-role seal for the private implementation schema.
--
-- Preconditions established by the preceding boundary migrations:
--   * public RLS no longer calls private.* predicates;
--   * Sync, Network and Memory use dedicated non-login executor roles;
--   * anon/authenticated/service_role have no effective private function,
--     relation or sequence authority.
--
-- This migration removes the last residual API authority: authenticated USAGE
-- on schema private. PostgreSQL gives new functions EXECUTE to PUBLIC by
-- default, so a private-only DDL event guard revokes API-role EXECUTE whenever
-- a private function is created or replaced. This keeps the zero-EXECUTE
-- invariant inside the database without widening default ACLs globally.

begin;

do $preflight$
declare
  api_function_authority integer;
  api_relation_authority integer;
  api_sequence_authority integer;
  private_rls_refs integer;
  bad_executor_roles integer;
begin
  if to_regnamespace('private') is null then
    raise exception 'OrdaX private API seal: private schema missing';
  end if;

  if to_regnamespace('ordax_policy') is null then
    raise exception 'OrdaX private API seal: policy schema missing';
  end if;

  if to_regprocedure('private.ordax_enforce_private_function_acl()') is not null
     or exists (
       select 1 from pg_event_trigger
       where evtname = 'ordax_private_function_acl_seal'
     ) then
    raise exception 'OrdaX private API seal: private function ACL guard already exists';
  end if;

  select count(*) into private_rls_refs
  from pg_policies p
  where p.schemaname = 'public'
    and (
      coalesce(p.qual, '') ilike '%private.%'
      or coalesce(p.with_check, '') ilike '%private.%'
    );
  if private_rls_refs <> 0 then
    raise exception 'OrdaX private API seal: public RLS still references private schema';
  end if;

  if not has_schema_privilege('authenticated', 'private', 'USAGE')
     or has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('service_role', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'CREATE')
     or has_schema_privilege('anon', 'private', 'CREATE')
     or has_schema_privilege('service_role', 'private', 'CREATE') then
    raise exception 'OrdaX private API seal: unexpected pre-seal schema ACL';
  end if;

  select count(*) into api_function_authority
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prokind = 'f'
    and (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('service_role', p.oid, 'EXECUTE')
    );
  if api_function_authority <> 0 then
    raise exception 'OrdaX private API seal: API role still executes private function';
  end if;

  select count(*) into api_relation_authority
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    );
  if api_relation_authority <> 0 then
    raise exception 'OrdaX private API seal: API role still has private relation authority';
  end if;

  select count(*) into api_sequence_authority
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relkind = 'S'
    and (
      has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
      or has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE')
      or has_sequence_privilege('service_role', c.oid, 'USAGE,SELECT,UPDATE')
    );
  if api_sequence_authority <> 0 then
    raise exception 'OrdaX private API seal: API role still has private sequence authority';
  end if;

  if not has_schema_privilege('authenticated', 'ordax_policy', 'USAGE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_admin_space(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_project(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_product_device(uuid)', 'EXECUTE') then
    raise exception 'OrdaX private API seal: authenticated policy boundary missing';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'ordax_sync_executor')
     or not exists (select 1 from pg_roles where rolname = 'ordax_network_executor')
     or not exists (select 1 from pg_roles where rolname = 'ordax_memory_executor') then
    raise exception 'OrdaX private API seal: dedicated executor role missing';
  end if;

  select count(*) into bad_executor_roles
  from pg_roles r
  where r.rolname in ('ordax_sync_executor', 'ordax_network_executor', 'ordax_memory_executor')
    and (
      r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit
      or r.rolcanlogin or r.rolreplication or r.rolbypassrls
    );
  if bad_executor_roles <> 0 then
    raise exception 'OrdaX private API seal: executor role contract drifted';
  end if;

  if not has_schema_privilege('ordax_sync_executor', 'private', 'USAGE')
     or not has_schema_privilege('ordax_network_executor', 'private', 'USAGE')
     or not has_schema_privilege('ordax_memory_executor', 'private', 'USAGE') then
    raise exception 'OrdaX private API seal: executor private usage missing';
  end if;
end;
$preflight$;

-- PostgreSQL gives a newly-created function EXECUTE to PUBLIC. A schema-scoped
-- default-privilege REVOKE is not a catalog-verifiable invariant on this hosted
-- project, while a global default change would affect unrelated schemas. Keep
-- the correction local to private and fail closed if it cannot revoke the
-- generated function ACL.
create function private.ordax_enforce_private_function_acl()
returns event_trigger
language plpgsql
security definer
set search_path = 'pg_catalog'
as $function$
declare
  cmd record;
  function_identity text;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag = 'CREATE FUNCTION'
      and schema_name = 'private'
      and object_type = 'function'
  loop
    select format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    )
    into function_identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.oid = cmd.objid;

    if function_identity is null then
      raise exception 'OrdaX private API seal: created private function identity unavailable';
    end if;

    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      function_identity
    );
  end loop;
end;
$function$;

revoke all on function private.ordax_enforce_private_function_acl()
  from public, anon, authenticated, service_role;

create event trigger ordax_private_function_acl_seal
on ddl_command_end
when tag in ('CREATE FUNCTION')
execute function private.ordax_enforce_private_function_acl();

-- Seal current objects and the schema namespace itself. Executor roles are not
-- included here; their narrow private authority remains intact.
revoke all on schema private from public, anon, authenticated, service_role;
revoke all privileges on all functions in schema private
  from public, anon, authenticated, service_role;
revoke all privileges on all tables in schema private
  from public, anon, authenticated, service_role;
revoke all privileges on all sequences in schema private
  from public, anon, authenticated, service_role;

do $postflight$
declare
  api_function_authority integer;
  api_relation_authority integer;
  api_sequence_authority integer;
  public_schema_privileges integer;
  private_rls_refs integer;
  guard_function_oid oid;
begin
  select p.oid into guard_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'ordax_enforce_private_function_acl'
    and p.prokind = 'f'
    and pg_get_function_identity_arguments(p.oid) = '';

  if guard_function_oid is null then
    raise exception 'OrdaX private API seal: private function ACL guard function missing';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = guard_function_oid
      and p.prosecdef
      and 'search_path=pg_catalog' = any(coalesce(p.proconfig, '{}'::text[]))
  ) then
    raise exception 'OrdaX private API seal: private function ACL guard contract drifted';
  end if;

  if not exists (
    select 1
    from pg_event_trigger e
    where e.evtname = 'ordax_private_function_acl_seal'
      and e.evtevent = 'ddl_command_end'
      and e.evtenabled = 'O'
      and 'CREATE FUNCTION' = any(e.evttags)
      and e.evtfoid = guard_function_oid
  ) then
    raise exception 'OrdaX private API seal: private function ACL event guard missing';
  end if;

  select count(*) into public_schema_privileges
  from pg_namespace n
  cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
  where n.nspname = 'private'
    and a.grantee = 0
    and a.privilege_type in ('USAGE', 'CREATE');

  if public_schema_privileges <> 0
     or has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'USAGE')
     or has_schema_privilege('service_role', 'private', 'USAGE')
     or has_schema_privilege('anon', 'private', 'CREATE')
     or has_schema_privilege('authenticated', 'private', 'CREATE')
     or has_schema_privilege('service_role', 'private', 'CREATE') then
    raise exception 'OrdaX private API seal: schema remains reachable by API role';
  end if;

  select count(*) into api_function_authority
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.prokind = 'f'
    and (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or has_function_privilege('service_role', p.oid, 'EXECUTE')
    );
  if api_function_authority <> 0 then
    raise exception 'OrdaX private API seal: private function authority reopened';
  end if;

  select count(*) into api_relation_authority
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (
      has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    );
  if api_relation_authority <> 0 then
    raise exception 'OrdaX private API seal: private relation authority reopened';
  end if;

  select count(*) into api_sequence_authority
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private'
    and c.relkind = 'S'
    and (
      has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE')
      or has_sequence_privilege('authenticated', c.oid, 'USAGE,SELECT,UPDATE')
      or has_sequence_privilege('service_role', c.oid, 'USAGE,SELECT,UPDATE')
    );
  if api_sequence_authority <> 0 then
    raise exception 'OrdaX private API seal: private sequence authority reopened';
  end if;

  select count(*) into private_rls_refs
  from pg_policies p
  where p.schemaname = 'public'
    and (
      coalesce(p.qual, '') ilike '%private.%'
      or coalesce(p.with_check, '') ilike '%private.%'
    );
  if private_rls_refs <> 0 then
    raise exception 'OrdaX private API seal: public RLS private reference reopened';
  end if;

  if not has_schema_privilege('authenticated', 'ordax_policy', 'USAGE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_admin_space(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_project(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_product_device(uuid)', 'EXECUTE') then
    raise exception 'OrdaX private API seal: policy authorization boundary broken';
  end if;

  if not has_schema_privilege('ordax_sync_executor', 'private', 'USAGE')
     or not has_schema_privilege('ordax_network_executor', 'private', 'USAGE')
     or not has_schema_privilege('ordax_memory_executor', 'private', 'USAGE') then
    raise exception 'OrdaX private API seal: executor boundary broken';
  end if;
end;
$postflight$;

commit;
