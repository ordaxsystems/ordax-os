-- Forward-only, fail-closed migration for the LIVE 2026-10-26 destination.
-- The 20261005031500 policy draft expects 19 callers and drops the later
-- auth.sessions eligibility guard. It MUST NOT be applied to today's backend.
-- This migration delegates to the existing private SSOT functions; it does not
-- duplicate business rules or weaken the confirmed-session predicate.
-- NOT deployed automatically: rollout requires actual auth/session E2E proof.

begin;

do $preflight$
declare
  expected_refs constant text[] := array[
    'ordax_accounts.ordax_accounts_select_own',
    'ordax_accounts.ordax_accounts_update_own',
    'ordax_device_presence.ordax_device_presence_select_authorized',
    'ordax_device_project_bindings.ordax_device_project_bindings_select_project',
    'ordax_entitlement_grants.ordax_entitlement_grants_select_subject',
    'ordax_memory_embeddings.ordax_memory_embeddings_select_authorized',
    'ordax_memory_items.ordax_memory_items_select_authorized',
    'ordax_product_devices.ordax_product_devices_select_authorized',
    'ordax_project_connections.ordax_project_connections_select_space',
    'ordax_projects.ordax_projects_select_space',
    'ordax_remote_capability_grants.ordax_remote_capability_grants_select_admin',
    'ordax_space_devices.ordax_space_devices_select_space',
    'ordax_space_members.ordax_space_members_select_space',
    'ordax_space_profile_packs.ordax_space_profile_packs_select_member',
    'ordax_spaces.ordax_spaces_select_member'
  ];
  actual_refs text[];
  record_policy record;
  fn record;
  expected_function_names constant text[] := array[
    'ordax_authenticated_subject_eligible_v1',
    'ordax_can_access_product_device',
    'ordax_can_access_project',
    'ordax_can_access_space',
    'ordax_can_admin_space'
  ];
begin
  if to_regnamespace('ordax_policy') is not null then
    raise exception 'OrdaX live policy boundary: dedicated schema already exists';
  end if;
  if has_schema_privilege('anon','private','USAGE') then
    raise exception 'OrdaX live policy boundary: anonymous access to private';
  end if;
  if not has_schema_privilege('authenticated','private','USAGE') then
    raise exception 'OrdaX live policy boundary: expected legacy boundary not observed';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by tablename, policyname),'{}'::text[])
    into actual_refs
    from pg_policies
   where (coalesce(qual,'') ilike '%private.%'
      or coalesce(with_check,'') ilike '%private.%');

  if actual_refs is distinct from expected_refs then
    raise exception 'OrdaX live policy boundary: exact private policy set drifted';
  end if;

  for record_policy in
    select tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname='public'
      and (coalesce(qual,'') ilike '%private.%' or coalesce(with_check,'') ilike '%private.%')
  loop
    if record_policy.roles is distinct from array['authenticated']::name[]
       or record_policy.cmd not in ('SELECT','UPDATE')
       or (record_policy.cmd='UPDATE' and record_policy.with_check is null)
       or record_policy.qual not like '%private.ordax_authenticated_subject_eligible_v1()%'
       or (record_policy.with_check is not null
           and record_policy.with_check not like '%private.ordax_authenticated_subject_eligible_v1()%') then
      raise exception 'OrdaX live policy boundary: eligibility/role contract drifted in %.%',
        record_policy.tablename, record_policy.policyname;
    end if;
  end loop;

  if (select count(*)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private'
        and p.proname = any(expected_function_names)
        and pg_get_userbyid(p.proowner)='postgres'
        and p.prosecdef
        and 'search_path=""'=any(coalesce(p.proconfig,'{}'::text[]))) <> 5 then
    raise exception 'OrdaX live policy boundary: private SSOT helper contract drifted';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='private' and p.proname='ordax_authenticated_subject_eligible_v1'
       and pg_get_functiondef(p.oid) like '%auth.sessions%'
       and pg_get_functiondef(p.oid) like '%auth.jwt()%'
       and pg_get_functiondef(p.oid) like '%u.confirmed_at is not null%'
       and pg_catalog.md5(pg_get_functiondef(p.oid)) = '0e64a11cc3d4802f7f94c1591cdadc26'
  ) then
    raise exception 'OrdaX live policy boundary: confirmed live session guard missing';
  end if;
end;
$preflight$;

-- Restore the versioned session helper inside the SAME transaction as
-- its policy rewrite. The original API grants remain until the policies are
-- rewired, and are then revoked in this very same transaction.
create or replace function private.ordax_authenticated_subject_eligible_v1()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_subject_user_id uuid;
  v_claims jsonb;
  v_session_text text;
  v_session_id uuid;
begin
  v_subject_user_id:=auth.uid();
  if v_subject_user_id is null then
    return false;
  end if;

  -- These claims are supplied by Supabase/PostgREST after JWT verification;
  -- a raw user_id or a caller-selected session_id is never accepted.
  v_claims:=auth.jwt();
  if v_claims is null
     or pg_catalog.jsonb_typeof(v_claims)<>'object'
     or pg_catalog.jsonb_typeof(v_claims->'session_id')<>'string' then
    return false;
  end if;

  v_session_text:=v_claims->>'session_id';
  if v_session_text is null
     or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_session_id:=v_session_text::uuid;

  return exists (
    select 1
      from auth.sessions s
      join auth.users u on u.id=s.user_id
      join public.ordax_accounts a on a.user_id=u.id
     where s.id=v_session_id
       and s.user_id=v_subject_user_id
       and u.deleted_at is null
       and u.is_anonymous is false
       and u.confirmed_at is not null
       and (u.banned_until is null
         or u.banned_until<=pg_catalog.clock_timestamp())
       and (s.not_after is null
         or s.not_after>pg_catalog.clock_timestamp())
  );
end;
$function$;

create schema ordax_policy;
revoke all on schema ordax_policy from public, anon, authenticated, service_role;
grant usage on schema ordax_policy to authenticated;

-- Volatile deliberately: session eligibility checks auth.sessions lifetime.
create function ordax_policy.authenticated_subject_eligible()
returns boolean language sql volatile security definer set search_path = ''
as $function$
  select private.ordax_authenticated_subject_eligible_v1();
$function$;

create function ordax_policy.can_access_space(target_space_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select private.ordax_can_access_space(target_space_id);
$function$;

create function ordax_policy.can_admin_space(target_space_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select private.ordax_can_admin_space(target_space_id);
$function$;

create function ordax_policy.can_access_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select private.ordax_can_access_project(target_project_id);
$function$;

create function ordax_policy.can_access_product_device(target_device_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $function$
  select private.ordax_can_access_product_device(target_device_id);
$function$;

revoke all on function ordax_policy.authenticated_subject_eligible() from public,anon,authenticated,service_role;
revoke all on function ordax_policy.can_access_space(uuid) from public,anon,authenticated,service_role;
revoke all on function ordax_policy.can_admin_space(uuid) from public,anon,authenticated,service_role;
revoke all on function ordax_policy.can_access_project(uuid) from public,anon,authenticated,service_role;
revoke all on function ordax_policy.can_access_product_device(uuid) from public,anon,authenticated,service_role;

grant execute on function ordax_policy.authenticated_subject_eligible() to authenticated;
grant execute on function ordax_policy.can_access_space(uuid) to authenticated;
grant execute on function ordax_policy.can_admin_space(uuid) to authenticated;
grant execute on function ordax_policy.can_access_project(uuid) to authenticated;
grant execute on function ordax_policy.can_access_product_device(uuid) to authenticated;

-- Preserve every existing USING and WITH CHECK predicate expression verbatim,
-- except the schema/name of the five delegated functions. This retains
-- confirmed session, active entitlement validity, ownership, and member rules.
do $rewrite$
declare
  p record;
  expression_using text;
  expression_check text;
  target_names constant text[] := array[
    'ordax_authenticated_subject_eligible_v1',
    'ordax_can_access_space',
    'ordax_can_admin_space',
    'ordax_can_access_project',
    'ordax_can_access_product_device'
  ];
  replacement_names constant text[] := array[
    'authenticated_subject_eligible',
    'can_access_space',
    'can_admin_space',
    'can_access_project',
    'can_access_product_device'
  ];
  i integer;
begin
  for p in
    select tablename,policyname,cmd,qual,with_check from pg_policies
    where schemaname='public'
      and (coalesce(qual,'') ilike '%private.%' or coalesce(with_check,'') ilike '%private.%')
    order by tablename,policyname
  loop
    expression_using := p.qual;
    expression_check := p.with_check;
    for i in 1..array_length(target_names,1) loop
      expression_using := replace(expression_using,
        'private.' || target_names[i] || '(', 'ordax_policy.' || replacement_names[i] || '(');
      if expression_check is not null then
        expression_check := replace(expression_check,
          'private.' || target_names[i] || '(', 'ordax_policy.' || replacement_names[i] || '(');
      end if;
    end loop;
    if expression_using ilike '%private.%' or coalesce(expression_check,'') ilike '%private.%' then
      raise exception 'OrdaX live policy boundary: unexpected private predicate in %.%',p.tablename,p.policyname;
    end if;
    if expression_using not like '%ordax_policy.authenticated_subject_eligible()%' or
       (expression_check is not null and expression_check not like '%ordax_policy.authenticated_subject_eligible()%') then
      raise exception 'OrdaX live policy boundary: missing confirmed session guard in %.%',p.tablename,p.policyname;
    end if;
    if p.cmd='SELECT' then
      execute format('alter policy %I on public.%I using (%s)',
        p.policyname,p.tablename,expression_using);
    elsif p.cmd='UPDATE' then
      execute format('alter policy %I on public.%I using (%s) with check (%s)',
        p.policyname,p.tablename,expression_using,expression_check);
    else
      raise exception 'OrdaX live policy boundary: non-whitelisted policy command';
    end if;
  end loop;
end;
$rewrite$;

-- The only five direct private entrypoints executable by authenticated
-- should now be accessed through the owned predicate wrappers above.
revoke all on function private.ordax_authenticated_subject_eligible_v1()
  from public,anon,authenticated,service_role;
revoke all on function private.ordax_can_access_space(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.ordax_can_admin_space(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.ordax_can_access_project(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.ordax_can_access_product_device(uuid)
  from public,anon,authenticated,service_role;
revoke usage on schema private from authenticated;

do $postflight$
declare
  p record;
  fn record;
begin
  if exists (select 1 from pg_policies where
       coalesce(qual,'') ilike '%private.%' or coalesce(with_check,'') ilike '%private.%') then
    raise exception 'OrdaX live policy boundary: direct private references remain';
  end if;
  if (select count(*) from pg_policies where schemaname='public'
      and coalesce(qual,'') like '%ordax_policy.authenticated_subject_eligible()%') <> 15 then
    raise exception 'OrdaX live policy boundary: eligible-subject guard not preserved in all policies';
  end if;
  if has_schema_privilege('authenticated','private','USAGE') then
    raise exception 'OrdaX live policy boundary: private schema remains client-accessible';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='private' and p.proname like 'ordax_%'
         and has_function_privilege('authenticated',p.oid,'EXECUTE')) <> 0 then
    raise exception 'OrdaX live policy boundary: private helper still directly executable';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='ordax_policy') <> 5 then
    raise exception 'OrdaX live policy boundary: unexpected predicate wrapper count';
  end if;
  if has_schema_privilege('anon','ordax_policy','USAGE')
     or has_schema_privilege('service_role','ordax_policy','USAGE') then
    raise exception 'OrdaX live policy boundary: API role can use policy schema';
  end if;
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='ordax_policy'
  loop
    if not has_function_privilege('authenticated',fn.oid,'EXECUTE')
       or has_function_privilege('anon',fn.oid,'EXECUTE')
       or has_function_privilege('service_role',fn.oid,'EXECUTE')
       or not (select p.prosecdef and 'search_path=""'=any(coalesce(p.proconfig,'{}'::text[]))
                 from pg_proc p where p.oid=fn.oid) then
      raise exception 'OrdaX live policy boundary: wrapper ACL/security path drifted';
    end if;
  end loop;
end;
$postflight$;

commit;
