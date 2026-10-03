begin;

create or replace function private.ordax_reject_unsafe_account_close_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $close_guard$
begin
  if exists (
    select 1
    from public.ordax_spaces s
    join public.ordax_space_members m on m.space_id = s.space_id
    where s.owner_user_id = new.subject_user_id
      and m.user_id <> new.subject_user_id
  ) then
    raise exception 'account-close-owned-shared-space-requires-transfer' using errcode = '55000';
  end if;
  return new;
end;
$close_guard$;

revoke all on function private.ordax_reject_unsafe_account_close_v1()
  from public, anon, authenticated, service_role;

create trigger ordax_account_close_reject_owned_shared_space
before insert on private.ordax_account_close_requests
for each row execute function private.ordax_reject_unsafe_account_close_v1();

create or replace function private.ordax_current_account_is_closing_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $closing$
  select coalesce(
    exists (
      select 1
      from private.ordax_account_close_requests r
      where r.subject_user_id = (select auth.uid())
        and r.state <> 'closed'
    ),
    false
  );
$closing$;

revoke all on function private.ordax_current_account_is_closing_v1()
  from public, anon, authenticated, service_role;
grant execute on function private.ordax_current_account_is_closing_v1()
  to authenticated;

-- Supabase access JWTs remain cryptographically valid until exp even after a
-- global sign-out. These RESTRICTIVE policies therefore close the data plane as
-- soon as the durable close journal exists; existing owner/member policies still
-- apply, but cannot override this fail-closed account lifecycle guard.
create policy ordax_accounts_deny_closing_subject
on public.ordax_accounts as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_spaces_deny_closing_subject
on public.ordax_spaces as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_space_members_deny_closing_subject
on public.ordax_space_members as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_entitlements_deny_closing_subject
on public.ordax_entitlement_grants as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_space_profile_packs_deny_closing_subject
on public.ordax_space_profile_packs as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_memory_items_deny_closing_subject
on public.ordax_memory_items as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_memory_embeddings_deny_closing_subject
on public.ordax_memory_embeddings as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_project_connections_deny_closing_subject
on public.ordax_project_connections as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_user_objects_deny_closing_subject
on public.ordax_user_objects as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_sync_objects_deny_closing_subject
on private.ordax_sync_objects as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

create policy ordax_sync_mutations_deny_closing_subject
on private.ordax_sync_mutations as restrictive for all to authenticated
using (not private.ordax_current_account_is_closing_v1())
with check (not private.ordax_current_account_is_closing_v1());

comment on function private.ordax_current_account_is_closing_v1() is
  'RLS guard for the gap in which revoked Supabase sessions may still carry unexpired access JWTs. Closing subjects lose OrdaX data-plane access immediately.';
comment on trigger ordax_account_close_reject_owned_shared_space on private.ordax_account_close_requests is
  'Fail-closed guard: account deletion cannot cascade an owned Space while another account still has membership; ownership transfer/removal must be explicit first.';

commit;
