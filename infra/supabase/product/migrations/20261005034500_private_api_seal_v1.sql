-- Final API-role seal for the private implementation schema.
--
-- Preconditions established by the preceding boundary migrations:
--   * public RLS no longer calls private.* predicates;
--   * Sync, Network and Memory use dedicated non-login executor roles;
--   * anon/authenticated/service_role have no effective private function,
--     relation or sequence authority.
--
-- This migration removes the last residual API authority: authenticated USAGE
-- on schema private. It also locks PostgreSQL default privileges for objects
-- subsequently created by postgres in private, so the platform default EXECUTE
-- grant on new functions cannot silently reopen the boundary.

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

-- Seal current objects and the schema namespace itself. Executor roles are not
-- included here; their narrow private authority remains intact.
revoke all on schema private from public, anon, authenticated, service_role;
revoke all privileges on all functions in schema private
  from public, anon, authenticated, service_role;
revoke all privileges on all tables in schema private
  from public, anon, authenticated, service_role;
revoke all privileges on all sequences in schema private
  from public, anon, authenticated, service_role;

-- PostgreSQL grants EXECUTE on newly-created functions to PUBLIC by default.
-- Override that default for private objects created by postgres. Tables and
-- sequences are included explicitly so API-role grants cannot become a hidden
-- default later without changing this migration contract.
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all privileges on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all privileges on sequences from public, anon, authenticated, service_role;

do $postflight$
declare
  api_function_authority integer;
  api_relation_authority integer;
  api_sequence_authority integer;
  public_schema_privileges integer;
  bad_default_acl integer;
  private_rls_refs integer;
begin
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

  select count(*) into bad_default_acl
  from pg_default_acl d
  join pg_roles owner_role on owner_role.oid = d.defaclrole
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  left join pg_roles grantee_role on grantee_role.oid = a.grantee
  where owner_role.rolname = 'postgres'
    and n.nspname = 'private'
    and d.defaclobjtype in ('f', 'r', 'S')
    and (
      a.grantee = 0
      or grantee_role.rolname in ('anon', 'authenticated', 'service_role')
    );
  if bad_default_acl <> 0 then
    raise exception 'OrdaX private API seal: API grant remains in private default ACL';
  end if;

  if not exists (
    select 1
    from pg_default_acl d
    join pg_roles owner_role on owner_role.oid = d.defaclrole
    join pg_namespace n on n.oid = d.defaclnamespace
    where owner_role.rolname = 'postgres'
      and n.nspname = 'private'
      and d.defaclobjtype = 'f'
  ) then
    raise exception 'OrdaX private API seal: private function default ACL override missing';
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
