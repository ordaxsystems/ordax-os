begin;

-- Membership authority must never come from direct client table mutation. The
-- historical RLS write policies were useful during foundation work, but leaving
-- them reachable would let an authenticated admin bypass invite/role workflows.
revoke insert, update, delete on table public.ordax_space_members
  from public, anon, authenticated, service_role;

-- Keep the read policy. Remove dormant client-write policies so a future grant
-- cannot silently reopen the old mutation surface.
drop policy if exists ordax_space_members_insert_admin on public.ordax_space_members;
drop policy if exists ordax_space_members_update_admin on public.ordax_space_members;
drop policy if exists ordax_space_members_delete_admin on public.ordax_space_members;

commit;
