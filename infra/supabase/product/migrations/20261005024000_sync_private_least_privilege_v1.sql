-- OrdaX Sync least-privilege boundary v1.
--
-- Root cause: the original Sync implementation used SECURITY INVOKER public
-- RPCs and therefore granted authenticated direct SELECT/INSERT/UPDATE access
-- to the private transport tables. RLS constrained rows, but the application
-- role still possessed table authority that belongs to the Sync service.
--
-- The Sync RPCs are moved behind a dedicated NOLOGIN/NOINHERIT/NOBYPASSRLS
-- executor. The executor receives only the private Sync table/sequence rights
-- required by those RPCs and remains subject to the same auth.uid()-bound RLS
-- policies. Public RPC signatures and behavior do not change.
--
-- Account export is a separate, read-only aggregate boundary. It becomes
-- SECURITY DEFINER because it legitimately reads private Sync state alongside
-- other account-owned records; its implementation already pins search_path=''
-- and applies auth.uid() owner predicates to every exported domain.

begin;

do $role$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'ordax_sync_executor'
  ) then
    create role ordax_sync_executor
      nologin
      noinherit
      nobypassrls;
  end if;
end;
$role$;

-- Hosted Supabase migrations execute as postgres. Explicit membership lets the
-- migration owner transfer and later maintain executor-owned RPCs without
-- making the executor login-capable or granting it administrative attributes.
grant ordax_sync_executor to postgres with admin option;

revoke all on schema private from ordax_sync_executor;
grant usage on schema private to ordax_sync_executor;
grant usage on schema auth to ordax_sync_executor;
grant execute on function auth.uid() to ordax_sync_executor;

grant select, insert, update on table private.ordax_sync_objects
  to ordax_sync_executor;
grant select, insert on table private.ordax_sync_mutations
  to ordax_sync_executor;
grant usage, select on sequence private.ordax_sync_mutations_change_seq_seq
  to ordax_sync_executor;

-- Keep RLS authoritative even inside SECURITY DEFINER Sync functions.
alter policy ordax_sync_objects_select_own
  on private.ordax_sync_objects
  to authenticated, ordax_sync_executor;
alter policy ordax_sync_objects_insert_own
  on private.ordax_sync_objects
  to authenticated, ordax_sync_executor;
alter policy ordax_sync_objects_update_own
  on private.ordax_sync_objects
  to authenticated, ordax_sync_executor;
alter policy ordax_sync_mutations_select_own
  on private.ordax_sync_mutations
  to authenticated, ordax_sync_executor;
alter policy ordax_sync_mutations_insert_own
  on private.ordax_sync_mutations
  to authenticated, ordax_sync_executor;

alter function public.ordax_apply_sync_mutation_v1(
  text, text, text, integer, integer, bigint, boolean, jsonb
) security definer;
alter function public.ordax_apply_sync_mutation_v1(
  text, text, text, integer, integer, bigint, boolean, jsonb
) owner to ordax_sync_executor;

alter function public.ordax_apply_sync_mutation_v2(
  text, text, text, integer, integer, bigint, boolean, jsonb
) security definer;
alter function public.ordax_apply_sync_mutation_v2(
  text, text, text, integer, integer, bigint, boolean, jsonb
) owner to ordax_sync_executor;

alter function public.ordax_pull_sync_changes_v1(
  bigint, integer
) security definer;
alter function public.ordax_pull_sync_changes_v1(
  bigint, integer
) owner to ordax_sync_executor;

alter function public.ordax_list_sync_objects_v1(
  bigint, integer
) security definer;
alter function public.ordax_list_sync_objects_v1(
  bigint, integer
) owner to ordax_sync_executor;

alter function public.ordax_sync_snapshot_v1(
  integer
) security definer;
alter function public.ordax_sync_snapshot_v1(
  integer
) owner to ordax_sync_executor;

alter function public.ordax_sync_snapshot_page_v2(
  bigint, text, text, integer
) security definer;
alter function public.ordax_sync_snapshot_page_v2(
  bigint, text, text, integer
) owner to ordax_sync_executor;

-- Export is intentionally not owned by the Sync executor because it spans
-- several account domains. Its SQL is read-only, search_path-pinned and
-- explicitly owner-bound by auth.uid().
alter function public.ordax_account_export_v1()
  security definer;

-- Application roles no longer carry table authority over private Sync state.
revoke all on table private.ordax_sync_objects
  from public, anon, authenticated;
revoke all on table private.ordax_sync_mutations
  from public, anon, authenticated;
revoke all on sequence private.ordax_sync_mutations_change_seq_seq
  from public, anon, authenticated;

commit;
