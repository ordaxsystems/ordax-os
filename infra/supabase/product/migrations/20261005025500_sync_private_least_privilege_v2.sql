-- OrdaX Sync least-privilege boundary v2.
--
-- Root cause: the first Sync transport used SECURITY INVOKER RPCs and therefore
-- required authenticated to hold direct authority over private Sync tables.
-- That made RLS the only barrier between an application JWT and the transport
-- store. This migration removes that authority instead of adding another API or
-- compatibility path.
--
-- The public Sync RPC signatures stay stable. Their private-table access moves
-- to a dedicated executor that cannot login, inherit privileges, bypass RLS,
-- administer roles/databases, or replicate. RLS policies become executor-only,
-- so an accidental future table grant to authenticated still cannot reopen the
-- old direct path. User RPCs remain callable only by authenticated.

begin;

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'ordax_sync_executor') then
    create role ordax_sync_executor;
  end if;
end;
$role$;

-- Reassert attributes even when the role already exists. Never trust historic
-- role state when that role will own SECURITY DEFINER functions.
alter role ordax_sync_executor with
  nosuperuser
  nocreatedb
  nocreaterole
  noinherit
  nologin
  noreplication
  nobypassrls;

-- postgres owns the migration lifecycle. The executor itself remains NOLOGIN
-- and receives no ADMIN OPTION or membership in application/service roles.
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

-- Only the non-login executor may satisfy the transport RLS policies. Keeping
-- authenticated in these policy role lists would allow a later accidental table
-- grant to silently restore the old browser-to-table authority.
alter policy ordax_sync_objects_select_own
  on private.ordax_sync_objects to ordax_sync_executor;
alter policy ordax_sync_objects_insert_own
  on private.ordax_sync_objects to ordax_sync_executor;
alter policy ordax_sync_objects_update_own
  on private.ordax_sync_objects to ordax_sync_executor;
alter policy ordax_sync_mutations_select_own
  on private.ordax_sync_mutations to ordax_sync_executor;
alter policy ordax_sync_mutations_insert_own
  on private.ordax_sync_mutations to ordax_sync_executor;

-- PostgreSQL requires the prospective function owner to have CREATE on the
-- containing schema. Grant it only during this transaction and remove it before
-- commit. Runtime keeps no CREATE authority.
grant create on schema public to ordax_sync_executor;

alter function public.ordax_apply_sync_mutation_v1(
  text, text, text, integer, integer, bigint, boolean, jsonb
) security definer;
alter function public.ordax_apply_sync_mutation_v1(
  text, text, text, integer, integer, bigint, boolean, jsonb
) set search_path = '';
alter function public.ordax_apply_sync_mutation_v1(
  text, text, text, integer, integer, bigint, boolean, jsonb
) owner to ordax_sync_executor;

alter function public.ordax_apply_sync_mutation_v2(
  text, text, text, integer, integer, bigint, boolean, jsonb
) security definer;
alter function public.ordax_apply_sync_mutation_v2(
  text, text, text, integer, integer, bigint, boolean, jsonb
) set search_path = '';
alter function public.ordax_apply_sync_mutation_v2(
  text, text, text, integer, integer, bigint, boolean, jsonb
) owner to ordax_sync_executor;

alter function public.ordax_pull_sync_changes_v1(bigint, integer)
  security definer;
alter function public.ordax_pull_sync_changes_v1(bigint, integer)
  set search_path = '';
alter function public.ordax_pull_sync_changes_v1(bigint, integer)
  owner to ordax_sync_executor;

alter function public.ordax_list_sync_objects_v1(bigint, integer)
  security definer;
alter function public.ordax_list_sync_objects_v1(bigint, integer)
  set search_path = '';
alter function public.ordax_list_sync_objects_v1(bigint, integer)
  owner to ordax_sync_executor;

alter function public.ordax_sync_snapshot_v1(integer)
  security definer;
alter function public.ordax_sync_snapshot_v1(integer)
  set search_path = '';
alter function public.ordax_sync_snapshot_v1(integer)
  owner to ordax_sync_executor;

alter function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer)
  security definer;
alter function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer)
  set search_path = '';
alter function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer)
  owner to ordax_sync_executor;

revoke create on schema public from ordax_sync_executor;

-- Export spans several account domains, so do not give the Sync executor broad
-- cross-domain reads. The existing export body is read-only, pins search_path,
-- and owner-binds every exported domain through auth.uid(). Keep that separate
-- privileged boundary for now and reassert its search_path explicitly.
alter function public.ordax_account_export_v1() security definer;
alter function public.ordax_account_export_v1() set search_path = '';

-- Never rely on PostgreSQL's default PUBLIC EXECUTE or Supabase service-role
-- defaults for user RPCs. These APIs are account-user surfaces, not admin APIs.
revoke all on function public.ordax_apply_sync_mutation_v1(
  text, text, text, integer, integer, bigint, boolean, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.ordax_apply_sync_mutation_v2(
  text, text, text, integer, integer, bigint, boolean, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.ordax_pull_sync_changes_v1(bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ordax_list_sync_objects_v1(bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ordax_sync_snapshot_v1(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ordax_account_export_v1()
  from public, anon, authenticated, service_role;

grant execute on function public.ordax_apply_sync_mutation_v1(
  text, text, text, integer, integer, bigint, boolean, jsonb
) to authenticated;
grant execute on function public.ordax_apply_sync_mutation_v2(
  text, text, text, integer, integer, bigint, boolean, jsonb
) to authenticated;
grant execute on function public.ordax_pull_sync_changes_v1(bigint, integer)
  to authenticated;
grant execute on function public.ordax_list_sync_objects_v1(bigint, integer)
  to authenticated;
grant execute on function public.ordax_sync_snapshot_v1(integer)
  to authenticated;
grant execute on function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer)
  to authenticated;
grant execute on function public.ordax_account_export_v1()
  to authenticated;

-- No browser role or service credential receives direct transport-table or
-- transport-sequence authority. All supported access is through the bounded RPC
-- surfaces above or separately audited internal definer functions.
revoke all on table private.ordax_sync_objects
  from public, anon, authenticated, service_role;
revoke all on table private.ordax_sync_mutations
  from public, anon, authenticated, service_role;
revoke all on sequence private.ordax_sync_mutations_change_seq_seq
  from public, anon, authenticated, service_role;

commit;
