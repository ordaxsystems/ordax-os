-- OrdaX Sync least-privilege boundary v1.
--
-- Root cause: the original Sync implementation used SECURITY INVOKER public
-- RPCs and therefore granted authenticated direct SELECT/INSERT/UPDATE access
-- to the private transport tables. RLS constrained rows, but the application
-- role still possessed table authority that should belong to the Sync service.
--
-- Keep the public RPC signatures and owner-bound logic unchanged. Promote the
-- existing RPCs to SECURITY DEFINER (all already pin search_path='') and remove
-- direct authenticated table privileges. RLS stays enabled as defense in depth.
-- The broader private-schema/function boundary is hardened separately because
-- Network currently has intentional invoker wrappers that depend on it.

begin;

alter function public.ordax_apply_sync_mutation_v1(
  text, text, text, integer, integer, bigint, boolean, jsonb
) security definer;

alter function public.ordax_apply_sync_mutation_v2(
  text, text, text, integer, integer, bigint, boolean, jsonb
) security definer;

alter function public.ordax_pull_sync_changes_v1(
  bigint, integer
) security definer;

alter function public.ordax_list_sync_objects_v1(
  bigint, integer
) security definer;

alter function public.ordax_sync_snapshot_v1(
  integer
) security definer;

alter function public.ordax_sync_snapshot_page_v2(
  bigint, text, text, integer
) security definer;

alter function public.ordax_account_export_v1()
  security definer;

-- Preserve the existing public RPC ACLs. The browser/application role no
-- longer needs direct authority over the private transport tables.
revoke all on table private.ordax_sync_objects
  from public, anon, authenticated;
revoke all on table private.ordax_sync_mutations
  from public, anon, authenticated;

commit;
