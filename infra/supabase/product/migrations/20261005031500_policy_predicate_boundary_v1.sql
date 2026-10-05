-- Separate public RLS authorization predicates from private implementation helpers.
--
-- Root cause: authenticated currently needs USAGE on schema private and direct
-- EXECUTE on implementation helpers merely so public-table RLS policies can ask
-- authorization questions. That couples the application role to the internal
-- schema and prevents us from sealing private safely.
--
-- This migration creates a deliberately tiny policy schema with four read-only,
-- subject-bound predicates. It is forward-only and fails closed if the expected
-- live policy set drifted or if the policy schema/functions already exist.

begin;

-- The live contract was audited before authoring this migration. Refuse to
-- rewire a partial or expanded set silently: an extra policy that still calls a
-- private helper would keep the old implementation boundary reachable.
do $preflight$
declare
  expected_refs constant text[] := array[
    'ordax_device_presence.ordax_device_presence_select_authorized',
    'ordax_device_project_bindings.ordax_device_project_bindings_select_project',
    'ordax_entitlement_grants.ordax_entitlement_grants_select_subject',
    'ordax_memory_embeddings.ordax_memory_embeddings_select_authorized',
    'ordax_memory_items.ordax_memory_items_insert_own',
    'ordax_memory_items.ordax_memory_items_select_authorized',
    'ordax_memory_items.ordax_memory_items_update_own',
    'ordax_product_devices.ordax_product_devices_select_authorized',
    'ordax_project_connections.ordax_project_connections_select_space',
    'ordax_projects.ordax_projects_select_space',
    'ordax_remote_capability_grants.ordax_remote_capability_grants_select_admin',
    'ordax_space_devices.ordax_space_devices_select_space',
    'ordax_space_members.ordax_space_members_delete_admin',
    'ordax_space_members.ordax_space_members_insert_admin',
    'ordax_space_members.ordax_space_members_select_space',
    'ordax_space_members.ordax_space_members_update_admin',
    'ordax_space_profile_packs.ordax_space_profile_packs_select_member',
    'ordax_spaces.ordax_spaces_select_member',
    'ordax_spaces.ordax_spaces_update_admin'
  ];
  observed_refs text[];
begin
  select coalesce(
    array_agg(format('%s.%s', p.tablename, p.policyname) order by p.tablename, p.policyname),
    '{}'::text[]
  )
  into observed_refs
  from pg_policies p
  where p.schemaname = 'public'
    and (
      coalesce(p.qual, '') ilike '%private.ordax_can_%'
      or coalesce(p.with_check, '') ilike '%private.ordax_can_%'
    );

  if observed_refs is distinct from expected_refs then
    raise exception 'OrdaX policy boundary: private predicate caller set drifted';
  end if;

  if to_regnamespace('ordax_policy') is not null then
    raise exception 'OrdaX policy boundary: ordax_policy schema already exists';
  end if;
end;
$preflight$;

-- No IF NOT EXISTS here: an unexpected pre-existing object at this security
-- boundary is drift, not something to merge with silently.
create schema ordax_policy;
revoke all on schema ordax_policy from public, anon, authenticated, service_role;
grant usage on schema ordax_policy to authenticated;

create function ordax_policy.can_access_space(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and (
    exists (
      select 1
      from public.ordax_spaces s
      where s.space_id = target_space_id
        and s.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.ordax_space_members m
      where m.space_id = target_space_id
        and m.user_id = (select auth.uid())
        and m.state = 'active'
    )
  );
$function$;

create function ordax_policy.can_admin_space(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and (
    exists (
      select 1
      from public.ordax_spaces s
      where s.space_id = target_space_id
        and s.owner_user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.ordax_space_members m
      where m.space_id = target_space_id
        and m.user_id = (select auth.uid())
        and m.state = 'active'
        and m.role in ('owner','admin')
    )
  );
$function$;

create function ordax_policy.can_access_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.ordax_projects p
    where p.project_id = target_project_id
      and ordax_policy.can_access_space(p.space_id)
  );
$function$;

create function ordax_policy.can_access_product_device(target_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and (
    exists (
      select 1
      from public.ordax_product_devices d
      where d.device_id = target_device_id
        and d.owner_user_id = (select auth.uid())
        and d.state = 'active'
    )
    or exists (
      select 1
      from public.ordax_space_devices sd
      where sd.device_id = target_device_id
        and sd.state = 'active'
        and ordax_policy.can_access_space(sd.space_id)
    )
  );
$function$;

-- CREATE FUNCTION defaults must never decide the application boundary. Clear
-- every API role explicitly, then grant exactly the signed-in application role.
revoke all on function ordax_policy.can_access_space(uuid)
  from public, anon, authenticated, service_role;
revoke all on function ordax_policy.can_admin_space(uuid)
  from public, anon, authenticated, service_role;
revoke all on function ordax_policy.can_access_project(uuid)
  from public, anon, authenticated, service_role;
revoke all on function ordax_policy.can_access_product_device(uuid)
  from public, anon, authenticated, service_role;
grant execute on function ordax_policy.can_access_space(uuid) to authenticated;
grant execute on function ordax_policy.can_admin_space(uuid) to authenticated;
grant execute on function ordax_policy.can_access_project(uuid) to authenticated;
grant execute on function ordax_policy.can_access_product_device(uuid) to authenticated;

alter policy ordax_device_presence_select_authorized
  on public.ordax_device_presence
  using (ordax_policy.can_access_product_device(device_id));

alter policy ordax_device_project_bindings_select_project
  on public.ordax_device_project_bindings
  using (ordax_policy.can_access_project(project_id));

alter policy ordax_entitlement_grants_select_subject
  on public.ordax_entitlement_grants
  using (
    user_id = (select auth.uid())
    or (space_id is not null and ordax_policy.can_access_space(space_id))
  );

alter policy ordax_memory_embeddings_select_authorized
  on public.ordax_memory_embeddings
  using (
    exists (
      select 1
      from public.ordax_memory_items m
      where m.memory_id = ordax_memory_embeddings.memory_id
        and (
          m.owner_user_id = (select auth.uid())
          or (m.space_id is not null and ordax_policy.can_access_space(m.space_id))
        )
    )
  );

alter policy ordax_memory_items_insert_own
  on public.ordax_memory_items
  with check (
    owner_user_id = (select auth.uid())
    and (space_id is null or ordax_policy.can_access_space(space_id))
  );

alter policy ordax_memory_items_select_authorized
  on public.ordax_memory_items
  using (
    owner_user_id = (select auth.uid())
    or (space_id is not null and ordax_policy.can_access_space(space_id))
  );

alter policy ordax_memory_items_update_own
  on public.ordax_memory_items
  using (owner_user_id = (select auth.uid()))
  with check (
    owner_user_id = (select auth.uid())
    and (space_id is null or ordax_policy.can_access_space(space_id))
  );

alter policy ordax_product_devices_select_authorized
  on public.ordax_product_devices
  using (ordax_policy.can_access_product_device(device_id));

alter policy ordax_project_connections_select_space
  on public.ordax_project_connections
  using (ordax_policy.can_access_space(space_id));

alter policy ordax_projects_select_space
  on public.ordax_projects
  using (ordax_policy.can_access_space(space_id));

alter policy ordax_remote_capability_grants_select_admin
  on public.ordax_remote_capability_grants
  using (
    owner_user_id = (select auth.uid())
    or ordax_policy.can_admin_space(space_id)
  );

alter policy ordax_space_devices_select_space
  on public.ordax_space_devices
  using (ordax_policy.can_access_space(space_id));

alter policy ordax_space_members_delete_admin
  on public.ordax_space_members
  using (ordax_policy.can_admin_space(space_id));

alter policy ordax_space_members_insert_admin
  on public.ordax_space_members
  with check (ordax_policy.can_admin_space(space_id));

alter policy ordax_space_members_select_space
  on public.ordax_space_members
  using (ordax_policy.can_access_space(space_id));

alter policy ordax_space_members_update_admin
  on public.ordax_space_members
  using (ordax_policy.can_admin_space(space_id))
  with check (ordax_policy.can_admin_space(space_id));

alter policy ordax_space_profile_packs_select_member
  on public.ordax_space_profile_packs
  using (ordax_policy.can_access_space(space_id));

alter policy ordax_spaces_select_member
  on public.ordax_spaces
  using (ordax_policy.can_access_space(space_id));

alter policy ordax_spaces_update_admin
  on public.ordax_spaces
  using (ordax_policy.can_admin_space(space_id))
  with check (ordax_policy.can_admin_space(space_id));

-- RLS no longer needs these implementation-schema entrypoints. Remove direct
-- API-role execution, including service_role: privileged server work must use a
-- separately audited public/internal boundary instead of implementation helpers.
revoke all on function private.ordax_can_access_space(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ordax_can_admin_space(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ordax_can_access_project(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.ordax_can_access_product_device(uuid)
  from public, anon, authenticated, service_role;

-- Post-flight: the old implementation predicates must be completely absent from
-- public RLS, the policy schema must expose no CREATE capability, and only the
-- four intended functions may exist there with the exact API-role ACL shape.
do $postflight$
declare
  remaining_private_policy_refs integer;
  policy_function_count integer;
  unexpected_policy_functions integer;
  public_schema_privilege_count integer;
begin
  select count(*) into remaining_private_policy_refs
  from pg_policies p
  where p.schemaname = 'public'
    and (
      coalesce(p.qual, '') ilike '%private.ordax_can_%'
      or coalesce(p.with_check, '') ilike '%private.ordax_can_%'
    );
  if remaining_private_policy_refs <> 0 then
    raise exception 'OrdaX policy boundary: private predicate reference remains in RLS';
  end if;

  select count(*) into public_schema_privilege_count
  from pg_namespace n
  cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
  where n.nspname = 'ordax_policy'
    and a.grantee = 0
    and a.privilege_type in ('USAGE', 'CREATE');

  if public_schema_privilege_count <> 0
     or has_schema_privilege('anon', 'ordax_policy', 'USAGE')
     or has_schema_privilege('service_role', 'ordax_policy', 'USAGE')
     or has_schema_privilege('authenticated', 'ordax_policy', 'CREATE')
     or has_schema_privilege('anon', 'ordax_policy', 'CREATE')
     or has_schema_privilege('service_role', 'ordax_policy', 'CREATE') then
    raise exception 'OrdaX policy boundary: schema ACL widened';
  end if;

  if not has_schema_privilege('authenticated', 'ordax_policy', 'USAGE') then
    raise exception 'OrdaX policy boundary: authenticated schema usage missing';
  end if;

  select count(*) into policy_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'ordax_policy'
    and p.prokind = 'f';
  if policy_function_count <> 4 then
    raise exception 'OrdaX policy boundary: unexpected function count';
  end if;

  select count(*) into unexpected_policy_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'ordax_policy'
    and p.prokind = 'f'
    and p.proname not in (
      'can_access_space',
      'can_admin_space',
      'can_access_project',
      'can_access_product_device'
    );
  if unexpected_policy_functions <> 0 then
    raise exception 'OrdaX policy boundary: unexpected function present';
  end if;

  if not has_function_privilege('authenticated', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_admin_space(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_project(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_product_device(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'ordax_policy.can_admin_space(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'ordax_policy.can_admin_space(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'ordax_policy.can_access_project(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'ordax_policy.can_access_project(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'ordax_policy.can_access_product_device(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'ordax_policy.can_access_product_device(uuid)', 'EXECUTE') then
    raise exception 'OrdaX policy boundary: function ACL mismatch';
  end if;
end;
$postflight$;

commit;
