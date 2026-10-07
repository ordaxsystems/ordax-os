-- Centralize the owner/member Space access rule behind one subject-aware owner.
--
-- Root cause: private.ordax_can_access_space(uuid) and
-- ordax_policy.can_access_space(uuid) independently implemented the same
-- owner-or-active-member rule. Server-side domain executors need to authorize a
-- known subject without impersonating auth.uid(), but copying that rule into
-- each domain would create additional authorization SSOTs.
--
-- This migration creates one private subject-aware helper and preserves both
-- existing auth-bound entrypoints as compatibility wrappers. The new helper is
-- not exposed to API roles.

begin;

do $preflight$
declare
  v_count integer;
  v_def text;
begin
  if to_regprocedure('private.ordax_subject_can_access_space_v1(uuid,uuid)') is not null then
    raise exception 'ordax-space-subject-access: helper already exists';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) in (
    ('private', 'ordax_can_access_space', 'target_space_id uuid'),
    ('ordax_policy', 'can_access_space', 'target_space_id uuid')
  )
    and pg_get_userbyid(p.proowner) = 'postgres'
    and p.prosecdef
    and 'search_path=""' = any(coalesce(p.proconfig, '{}'::text[]));
  if v_count <> 2 then
    raise exception 'ordax-space-subject-access: wrapper security contract drifted';
  end if;

  select pg_get_functiondef('private.ordax_can_access_space(uuid)'::regprocedure) into v_def;
  if position('public.ordax_spaces' in v_def) = 0
     or position('public.ordax_space_members' in v_def) = 0
     or position('m.state = ''active''' in v_def) = 0
     or position('auth.uid()' in v_def) = 0 then
    raise exception 'ordax-space-subject-access: private access semantics drifted';
  end if;

  select pg_get_functiondef('ordax_policy.can_access_space(uuid)'::regprocedure) into v_def;
  if position('public.ordax_spaces' in v_def) = 0
     or position('public.ordax_space_members' in v_def) = 0
     or position('m.state = ''active''' in v_def) = 0
     or position('auth.uid()' in v_def) = 0 then
    raise exception 'ordax-space-subject-access: policy access semantics drifted';
  end if;

  if has_function_privilege('anon', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'ordax_policy.can_access_space(uuid)', 'EXECUTE') then
    raise exception 'ordax-space-subject-access: policy wrapper ACL drifted';
  end if;

  if has_function_privilege('anon', 'private.ordax_can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ordax_can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.ordax_can_access_space(uuid)', 'EXECUTE') then
    raise exception 'ordax-space-subject-access: private wrapper ACL drifted';
  end if;
end;
$preflight$;

create function private.ordax_subject_can_access_space_v1(
  target_user_id uuid,
  target_space_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select target_user_id is not null
     and target_space_id is not null
     and (
       exists (
         select 1
         from public.ordax_spaces s
         where s.space_id = target_space_id
           and s.owner_user_id = target_user_id
       )
       or exists (
         select 1
         from public.ordax_space_members m
         where m.space_id = target_space_id
           and m.user_id = target_user_id
           and m.state = 'active'
       )
     );
$function$;

revoke all on function private.ordax_subject_can_access_space_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.ordax_can_access_space(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.ordax_subject_can_access_space_v1(
    (select auth.uid()),
    target_space_id
  );
$function$;

revoke all on function private.ordax_can_access_space(uuid)
  from public, anon, authenticated, service_role;

create or replace function ordax_policy.can_access_space(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.ordax_subject_can_access_space_v1(
    (select auth.uid()),
    target_space_id
  );
$function$;

revoke all on function ordax_policy.can_access_space(uuid)
  from public, anon, authenticated, service_role;
grant execute on function ordax_policy.can_access_space(uuid) to authenticated;

do $postflight$
declare
  v_def text;
begin
  if has_function_privilege('anon', 'private.ordax_subject_can_access_space_v1(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ordax_subject_can_access_space_v1(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.ordax_subject_can_access_space_v1(uuid,uuid)', 'EXECUTE') then
    raise exception 'ordax-space-subject-access: subject helper leaked to API role';
  end if;

  if not has_function_privilege('authenticated', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'ordax_policy.can_access_space(uuid)', 'EXECUTE') then
    raise exception 'ordax-space-subject-access: policy wrapper ACL mismatch';
  end if;

  if has_function_privilege('anon', 'private.ordax_can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ordax_can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.ordax_can_access_space(uuid)', 'EXECUTE') then
    raise exception 'ordax-space-subject-access: private wrapper ACL mismatch';
  end if;

  select pg_get_functiondef('private.ordax_can_access_space(uuid)'::regprocedure) into v_def;
  if position('private.ordax_subject_can_access_space_v1' in v_def) = 0
     or position('public.ordax_spaces' in v_def) <> 0
     or position('public.ordax_space_members' in v_def) <> 0 then
    raise exception 'ordax-space-subject-access: private wrapper did not converge';
  end if;

  select pg_get_functiondef('ordax_policy.can_access_space(uuid)'::regprocedure) into v_def;
  if position('private.ordax_subject_can_access_space_v1' in v_def) = 0
     or position('public.ordax_spaces' in v_def) <> 0
     or position('public.ordax_space_members' in v_def) <> 0 then
    raise exception 'ordax-space-subject-access: policy wrapper did not converge';
  end if;
end;
$postflight$;

commit;
