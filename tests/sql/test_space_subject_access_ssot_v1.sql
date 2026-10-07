\set ON_ERROR_STOP on

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$roles$;

create schema auth;
create schema private;
create schema ordax_policy;

revoke all on schema private from public, anon, authenticated, service_role;
revoke all on schema ordax_policy from public, anon, authenticated, service_role;
grant usage on schema ordax_policy to authenticated;

create function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(current_setting('ordax.test_uid', true), '')::uuid;
$function$;

create table public.ordax_spaces (
  space_id uuid primary key,
  owner_user_id uuid not null
);

create table public.ordax_space_members (
  space_id uuid not null references public.ordax_spaces(space_id),
  user_id uuid not null,
  state text not null check (state in ('active', 'suspended')),
  primary key (space_id, user_id)
);

-- Reproduce the exact pre-migration duplicated owner/member semantics that the
-- forward migration is expected to consolidate.
create function private.ordax_can_access_space(target_space_id uuid)
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

revoke all on function private.ordax_can_access_space(uuid)
  from public, anon, authenticated, service_role;

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

revoke all on function ordax_policy.can_access_space(uuid)
  from public, anon, authenticated, service_role;
grant execute on function ordax_policy.can_access_space(uuid) to authenticated;

\ir ../../infra/supabase/product/migrations/20261007152010_space_subject_access_ssot_v1.sql

insert into public.ordax_spaces(space_id, owner_user_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');

insert into public.ordax_space_members(space_id, user_id, state) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'active'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'suspended');

-- Subject-aware SSOT: owner and active member are allowed; suspended member,
-- outsider and null subjects fail closed.
select 1 / (private.ordax_subject_can_access_space_v1(
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
)::integer);

select 1 / (private.ordax_subject_can_access_space_v1(
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
)::integer);

select 1 / ((not private.ordax_subject_can_access_space_v1(
  '33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
))::integer);

select 1 / ((not private.ordax_subject_can_access_space_v1(
  '44444444-4444-4444-8444-444444444444',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
))::integer);

select 1 / ((not private.ordax_subject_can_access_space_v1(
  null,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
))::integer);

select 1 / ((not private.ordax_subject_can_access_space_v1(
  '11111111-1111-4111-8111-111111111111',
  null
))::integer);

-- No API role may call the subject-aware helper or the private compatibility
-- wrapper directly. authenticated retains exactly the public policy wrapper.
do $acl$
begin
  if has_function_privilege('anon', 'private.ordax_subject_can_access_space_v1(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ordax_subject_can_access_space_v1(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.ordax_subject_can_access_space_v1(uuid,uuid)', 'EXECUTE') then
    raise exception 'subject-aware Space helper leaked to API role';
  end if;

  if has_function_privilege('anon', 'private.ordax_can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ordax_can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.ordax_can_access_space(uuid)', 'EXECUTE') then
    raise exception 'private auth-bound Space wrapper leaked to API role';
  end if;

  if has_function_privilege('anon', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'ordax_policy.can_access_space(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'ordax_policy.can_access_space(uuid)', 'EXECUTE') then
    raise exception 'public Space policy wrapper ACL drifted';
  end if;
end;
$acl$;

-- Prove the authenticated compatibility surface still binds to auth.uid().
select set_config('ordax.test_uid', '11111111-1111-4111-8111-111111111111', false);
set role authenticated;
select 1 / (ordax_policy.can_access_space('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::integer);
reset role;

select set_config('ordax.test_uid', '22222222-2222-4222-8222-222222222222', false);
set role authenticated;
select 1 / (ordax_policy.can_access_space('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')::integer);
reset role;

select set_config('ordax.test_uid', '33333333-3333-4333-8333-333333333333', false);
set role authenticated;
select 1 / ((not ordax_policy.can_access_space('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))::integer);
reset role;

select set_config('ordax.test_uid', '44444444-4444-4444-8444-444444444444', false);
set role authenticated;
select 1 / ((not ordax_policy.can_access_space('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))::integer);
reset role;

-- Both legacy/auth-bound wrappers must now be delegation only; the owner/member
-- table reads live solely in the subject-aware helper.
do $delegation$
declare
  v_def text;
begin
  select pg_get_functiondef('private.ordax_can_access_space(uuid)'::regprocedure) into v_def;
  if position('private.ordax_subject_can_access_space_v1' in v_def) = 0
     or position('public.ordax_spaces' in v_def) <> 0
     or position('public.ordax_space_members' in v_def) <> 0 then
    raise exception 'private Space wrapper duplicated authorization semantics';
  end if;

  select pg_get_functiondef('ordax_policy.can_access_space(uuid)'::regprocedure) into v_def;
  if position('private.ordax_subject_can_access_space_v1' in v_def) = 0
     or position('public.ordax_spaces' in v_def) <> 0
     or position('public.ordax_space_members' in v_def) <> 0 then
    raise exception 'policy Space wrapper duplicated authorization semantics';
  end if;
end;
$delegation$;

select 'space-subject-access-ssot-v1-ok' as result;
