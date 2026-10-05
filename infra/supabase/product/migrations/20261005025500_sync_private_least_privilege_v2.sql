begin;

do $role$
declare
  r record;
begin
  select rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolcanlogin, rolreplication, rolbypassrls
    into r
    from pg_roles
   where rolname = 'ordax_sync_executor';

  if not found then
    create role ordax_sync_executor
      nosuperuser nocreatedb nocreaterole noinherit nologin noreplication nobypassrls;
  elsif r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit
     or r.rolcanlogin or r.rolreplication or r.rolbypassrls then
    raise exception 'ordax_sync_executor violates least-privilege role contract';
  end if;
end;
$role$;

grant ordax_sync_executor to postgres;
revoke all on schema private from ordax_sync_executor;
revoke all on schema auth from ordax_sync_executor;
grant usage on schema private to ordax_sync_executor;
grant usage on schema auth to ordax_sync_executor;
grant execute on function auth.uid() to ordax_sync_executor;

revoke all on table private.ordax_sync_objects from ordax_sync_executor;
revoke all on table private.ordax_sync_mutations from ordax_sync_executor;
revoke all on sequence private.ordax_sync_mutations_change_seq_seq from ordax_sync_executor;
grant select, insert, update on table private.ordax_sync_objects to ordax_sync_executor;
grant select, insert on table private.ordax_sync_mutations to ordax_sync_executor;
grant usage, select on sequence private.ordax_sync_mutations_change_seq_seq to ordax_sync_executor;

alter policy ordax_sync_objects_select_own on private.ordax_sync_objects to ordax_sync_executor;
alter policy ordax_sync_objects_insert_own on private.ordax_sync_objects to ordax_sync_executor;
alter policy ordax_sync_objects_update_own on private.ordax_sync_objects to ordax_sync_executor;
alter policy ordax_sync_mutations_select_own on private.ordax_sync_mutations to ordax_sync_executor;
alter policy ordax_sync_mutations_insert_own on private.ordax_sync_mutations to ordax_sync_executor;

grant create on schema public to ordax_sync_executor;

alter function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb) security definer;
alter function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb) set search_path = '';
alter function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb) owner to ordax_sync_executor;
alter function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb) security definer;
alter function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb) set search_path = '';
alter function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb) owner to ordax_sync_executor;
alter function public.ordax_pull_sync_changes_v1(bigint, integer) security definer;
alter function public.ordax_pull_sync_changes_v1(bigint, integer) set search_path = '';
alter function public.ordax_pull_sync_changes_v1(bigint, integer) owner to ordax_sync_executor;
alter function public.ordax_list_sync_objects_v1(bigint, integer) security definer;
alter function public.ordax_list_sync_objects_v1(bigint, integer) set search_path = '';
alter function public.ordax_list_sync_objects_v1(bigint, integer) owner to ordax_sync_executor;
alter function public.ordax_sync_snapshot_v1(integer) security definer;
alter function public.ordax_sync_snapshot_v1(integer) set search_path = '';
alter function public.ordax_sync_snapshot_v1(integer) owner to ordax_sync_executor;
alter function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer) security definer;
alter function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer) set search_path = '';
alter function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer) owner to ordax_sync_executor;

revoke create on schema public from ordax_sync_executor;

alter function public.ordax_account_export_v1() security definer;
alter function public.ordax_account_export_v1() set search_path = '';

revoke all on function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ordax_pull_sync_changes_v1(bigint, integer) from public, anon, authenticated, service_role;
revoke all on function public.ordax_list_sync_objects_v1(bigint, integer) from public, anon, authenticated, service_role;
revoke all on function public.ordax_sync_snapshot_v1(integer) from public, anon, authenticated, service_role;
revoke all on function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.ordax_account_export_v1() from public, anon, authenticated, service_role;

grant execute on function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb) to authenticated;
grant execute on function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb) to authenticated;
grant execute on function public.ordax_pull_sync_changes_v1(bigint, integer) to authenticated;
grant execute on function public.ordax_list_sync_objects_v1(bigint, integer) to authenticated;
grant execute on function public.ordax_sync_snapshot_v1(integer) to authenticated;
grant execute on function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer) to authenticated;
grant execute on function public.ordax_account_export_v1() to authenticated;

revoke all on table private.ordax_sync_objects from public, anon, authenticated, service_role;
revoke all on table private.ordax_sync_mutations from public, anon, authenticated, service_role;
revoke all on sequence private.ordax_sync_mutations_change_seq_seq from public, anon, authenticated, service_role;

commit;
