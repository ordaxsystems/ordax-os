begin;

-- Keep Account preferences in the existing authoritative subject row,
-- not in Auth user_metadata, a parallel account/profile table or browser state.
-- NULL means no remotely confirmed preference, never an inferred default.
alter table public.ordax_accounts
  add column preferred_locale text;

alter table public.ordax_accounts
  add constraint ordax_accounts_preferred_locale_valid
  check (preferred_locale is null or preferred_locale in ('pt-BR', 'en-US'));

-- One optional editable field. Preserve the already approved display_name
-- column-only grant and never allow clients to change user_id or dates.
revoke update(preferred_locale) on public.ordax_accounts from public, anon;
grant update(preferred_locale) on public.ordax_accounts to authenticated;

do $proof$
begin
  if not (select relrowsecurity from pg_class
    where oid = 'public.ordax_accounts'::regclass)
    or not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'ordax_accounts'
        and policyname = 'ordax_accounts_update_own'
        and cmd = 'UPDATE'
        and 'authenticated' = any(roles)
        and qual like '%auth.uid%'
        and with_check like '%auth.uid%'
    ) then
    raise exception 'Account must retain own-subject RLS for locale writes';
  end if;
  if not has_column_privilege('authenticated','public.ordax_accounts','preferred_locale','UPDATE')
    or not has_column_privilege('authenticated','public.ordax_accounts','display_name','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','user_id','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','created_at','UPDATE')
    or has_column_privilege('anon','public.ordax_accounts','preferred_locale','UPDATE') then
    raise exception 'Account locale column privilege isolation failed';
  end if;
end $proof$;

commit;
