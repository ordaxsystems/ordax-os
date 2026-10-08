begin;

do $role$
declare
  r record;
begin
  select
    rolsuper,
    rolcreatedb,
    rolcreaterole,
    rolinherit,
    rolcanlogin,
    rolreplication,
    rolbypassrls
  into r
  from pg_roles
  where rolname = 'ordax_account_export_executor';

  if not found then
    create role ordax_account_export_executor
      nosuperuser nocreatedb nocreaterole noinherit nologin noreplication nobypassrls;
  elsif r.rolsuper
     or r.rolcreatedb
     or r.rolcreaterole
     or r.rolinherit
     or r.rolcanlogin
     or r.rolreplication
     or r.rolbypassrls then
    raise exception 'ordax_account_export_executor violates least-privilege role contract';
  end if;
end;
$role$;

grant ordax_account_export_executor to postgres;

revoke all on schema public from ordax_account_export_executor;
revoke all on schema private from ordax_account_export_executor;
revoke all on schema auth from ordax_account_export_executor;
grant usage on schema public, private, auth to ordax_account_export_executor;
grant execute on function auth.uid() to ordax_account_export_executor;

revoke all on table
  public.ordax_accounts,
  public.ordax_spaces,
  public.ordax_space_members,
  public.ordax_space_profile_packs,
  public.ordax_entitlement_grants,
  public.ordax_projects,
  public.ordax_product_devices,
  public.ordax_project_connections,
  public.ordax_memory_items,
  private.ordax_sync_objects
from ordax_account_export_executor;

grant select on table
  public.ordax_accounts,
  public.ordax_spaces,
  public.ordax_space_members,
  public.ordax_space_profile_packs,
  public.ordax_entitlement_grants,
  public.ordax_projects,
  public.ordax_product_devices,
  public.ordax_project_connections,
  public.ordax_memory_items,
  private.ordax_sync_objects
to ordax_account_export_executor;

drop policy if exists ordax_accounts_export_own on public.ordax_accounts;
create policy ordax_accounts_export_own
  on public.ordax_accounts
  for select
  to ordax_account_export_executor
  using (user_id = (select auth.uid()));

drop policy if exists ordax_spaces_export_own on public.ordax_spaces;
create policy ordax_spaces_export_own
  on public.ordax_spaces
  for select
  to ordax_account_export_executor
  using (owner_user_id = (select auth.uid()));

drop policy if exists ordax_space_members_export_own on public.ordax_space_members;
create policy ordax_space_members_export_own
  on public.ordax_space_members
  for select
  to ordax_account_export_executor
  using (user_id = (select auth.uid()));

drop policy if exists ordax_space_profile_packs_export_own on public.ordax_space_profile_packs;
create policy ordax_space_profile_packs_export_own
  on public.ordax_space_profile_packs
  for select
  to ordax_account_export_executor
  using (
    exists (
      select 1
      from public.ordax_spaces s
      where s.space_id = ordax_space_profile_packs.space_id
        and s.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists ordax_entitlement_grants_export_own on public.ordax_entitlement_grants;
create policy ordax_entitlement_grants_export_own
  on public.ordax_entitlement_grants
  for select
  to ordax_account_export_executor
  using (user_id = (select auth.uid()));

drop policy if exists ordax_projects_export_own on public.ordax_projects;
create policy ordax_projects_export_own
  on public.ordax_projects
  for select
  to ordax_account_export_executor
  using (created_by_user_id = (select auth.uid()));

drop policy if exists ordax_product_devices_export_own on public.ordax_product_devices;
create policy ordax_product_devices_export_own
  on public.ordax_product_devices
  for select
  to ordax_account_export_executor
  using (owner_user_id = (select auth.uid()));

drop policy if exists ordax_project_connections_export_own on public.ordax_project_connections;
create policy ordax_project_connections_export_own
  on public.ordax_project_connections
  for select
  to ordax_account_export_executor
  using (owner_user_id = (select auth.uid()));

drop policy if exists ordax_memory_items_export_own on public.ordax_memory_items;
create policy ordax_memory_items_export_own
  on public.ordax_memory_items
  for select
  to ordax_account_export_executor
  using (owner_user_id = (select auth.uid()));

drop policy if exists ordax_sync_objects_export_own on private.ordax_sync_objects;
create policy ordax_sync_objects_export_own
  on private.ordax_sync_objects
  for select
  to ordax_account_export_executor
  using (owner_user_id = (select auth.uid()));

-- PostgreSQL requires the new function owner to be able to create in the
-- containing schema at ownership-transfer time. Keep that authority scoped to
-- this migration only; the executor must not retain CREATE afterwards.
grant create on schema public to ordax_account_export_executor;
alter function public.ordax_account_export_v1() owner to ordax_account_export_executor;
alter function public.ordax_account_export_v1() security definer;
alter function public.ordax_account_export_v1() set search_path = '';
revoke create on schema public from ordax_account_export_executor;

revoke all on function public.ordax_account_export_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_account_export_v1() to authenticated;

commit;
