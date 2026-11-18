begin;

-- One existing Account source: ordax_accounts. Never create a second profile
-- table, RPC, identity provider or user-metadata authority.
-- RLS (eligible and auth.uid = user_id) already exists in product foundation.
alter table public.ordax_accounts
  add constraint ordax_accounts_display_name_format
  check (
    display_name is null
    or (
      char_length(display_name) between 1 and 120
      and display_name = btrim(display_name)
      and display_name !~ '[[:cntrl:]]'
    )
  );

-- A column-only grant permits renaming the own row, NOT editing user_id,
-- created_at, updated_at or any future Account columns.
revoke update on public.ordax_accounts from public, anon, authenticated;
grant update(display_name) on public.ordax_accounts to authenticated;

do $security$
begin
  if not (select relrowsecurity from pg_class
    where oid = 'public.ordax_accounts'::regclass)
    or not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'ordax_accounts'
        and policyname = 'ordax_accounts_update_own'
        and cmd = 'UPDATE'
        and 'authenticated' = any(roles)
    ) then
    raise exception 'ordax_accounts owner-scoped RLS is required';
  end if;
  if not has_column_privilege('authenticated','public.ordax_accounts','display_name','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','user_id','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','created_at','UPDATE')
    or has_column_privilege('anon','public.ordax_accounts','display_name','UPDATE') then
    raise exception 'Account display-name column privilege boundary failed';
  end if;
end $security$;

commit;
