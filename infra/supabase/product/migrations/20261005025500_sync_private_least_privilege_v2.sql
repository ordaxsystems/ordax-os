-- OrdaX Sync least-privilege boundary v2.
--
-- Remove direct application-role authority over the private Sync transport.
-- Public RPC signatures remain stable; execution moves to a dedicated role that
-- cannot login, inherit privileges, or bypass RLS. Every RPC already pins an
-- empty search_path and binds rows to auth.uid().

begin;

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'ordax_sync_executor') then
    create role ordax_sync_executor nologin noinherit nobypassrls;
  end if;
end;
$role$;

grant ordax_sync_executor to postgres;
revoke all on schema private from ordax_sync_executor;
grant usage on schema private to ordax_sync_executor;
grant usage on schema auth to ordax_sync_executor;
grant execute on function auth.uid() to ordax_sync_executor;

grant select, insert, update on table private.ordax_sync_objects to ordax_sync_executor;
grant select, insert on table private.ordax_sync_mutations to ordax_sync_executor;
grant usage, select on sequence private.ordax_sync_mutations_change_seq_seq to ordax_sync_executor;

alter policy ordax_sync_objects_select_own on private.ordax_sync_objects to authenticated, ordax_sync_executor;
alter policy ordax_sync_objects_insert_own on private.ordax_sync_objects to authenticated, ordax_sync_executor;
alter policy ordax_sync_objects_update_own on private.ordax_sync_objects to authenticated, ordax_sync_executor;
alter policy ordax_sync_mutations_select_own on private.ordax_sync_mutations to authenticated, ordax_sync_executor;
alter policy ordax_sync_mutations_insert_own on private.ordax_sync_mutations to authenticated, ordax_sync_executor;

-- Ownership transfer requires CREATE only during this transaction window.
grant create on schema public to ordax_sync_executor;

alter function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb)
  security definer;
alter function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb)
  owner to ordax_sync_executor;
alter function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb)
  security definer;
alter function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb)
  owner to ordax_sync_executor;
alter function public.ordax_pull_sync_changes_v1(bigint, integer)
  security definer;
alter function public.ordax_pull_sync_changes_v1(bigint, integer)
  owner to ordax_sync_executor;
alter function public.ordax_list_sync_objects_v1(bigint, integer)
  security definer;
alter function public.ordax_list_sync_objects_v1(bigint, integer)
  owner to ordax_sync_executor;
alter function public.ordax_sync_snapshot_v1(integer)
  security definer;
alter function public.ordax_sync_snapshot_v1(integer)
  owner to ordax_sync_executor;
alter function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer)
  security definer;
alter function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer)
  owner to ordax_sync_executor;

revoke create on schema public from ordax_sync_executor;

-- Export spans multiple account domains. Keep its existing owner but make the
-- read-only, auth.uid()-bound, search_path-pinned aggregate a definer boundary.
alter function public.ordax_account_export_v1() security definer;

-- Reassert RPC ACLs explicitly; never rely on PostgreSQL's default PUBLIC EXECUTE.
revoke all on function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb) from public, anon;
revoke all on function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb) from public, anon;
revoke all on function public.ordax_pull_sync_changes_v1(bigint, integer) from public, anon;
revoke all on function public.ordax_list_sync_objects_v1(bigint, integer) from public, anon;
revoke all on function public.ordax_sync_snapshot_v1(integer) from public, anon;
revoke all on function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer) from public, anon;
revoke all on function public.ordax_account_export_v1() from public, anon;

grant execute on function public.ordax_apply_sync_mutation_v1(text, text, text, integer, integer, bigint, boolean, jsonb) to authenticated, service_role;
grant execute on function public.ordax_apply_sync_mutation_v2(text, text, text, integer, integer, bigint, boolean, jsonb) to authenticated, service_role;
grant execute on function public.ordax_pull_sync_changes_v1(bigint, integer) to authenticated, service_role;
grant execute on function public.ordax_list_sync_objects_v1(bigint, integer) to authenticated, service_role;
grant execute on function public.ordax_sync_snapshot_v1(integer) to authenticated, service_role;
grant execute on function public.ordax_sync_snapshot_page_v2(bigint, text, text, integer) to authenticated, service_role;
grant execute on function public.ordax_account_export_v1() to authenticated, service_role;

-- Browser/application roles no longer possess transport-table authority.
revoke all on table private.ordax_sync_objects from public, anon, authenticated;
revoke all on table private.ordax_sync_mutations from public, anon, authenticated;
revoke all on sequence private.ordax_sync_mutations_change_seq_seq from public, anon, authenticated;

commit;
