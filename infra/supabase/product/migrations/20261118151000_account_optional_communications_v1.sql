begin;

-- Optional communications are a preference only; this does NOT authorize
-- mail delivery, marketing processing, legal consent or transactional notices.
-- NULL/NULL means no explicit choices recorded (fail-closed).
alter table public.ordax_accounts
  add column communications_product_digest boolean,
  add column communications_news boolean;

alter table public.ordax_accounts
  add constraint ordax_accounts_communications_pair
  check (
    (communications_product_digest is null and communications_news is null)
    or
    (communications_product_digest is not null and communications_news is not null)
  );

-- Preserve established owner RLS and column-only edits. Never grant UPDATE
-- on user_id, created_at, updated_at or a future Account column.
revoke update(communications_product_digest, communications_news)
  on public.ordax_accounts from public, anon;
grant update(communications_product_digest, communications_news)
  on public.ordax_accounts to authenticated;

do $security$
begin
  if not (select relrowsecurity from pg_class
    where oid='public.ordax_accounts'::regclass)
    or not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='ordax_accounts'
        and policyname='ordax_accounts_update_own'
        and cmd='UPDATE'
        and 'authenticated'=any(roles)
        and qual like '%auth.uid%'
        and with_check like '%auth.uid%'
    ) then
      raise exception 'Account own-subject RLS required';
  end if;
  if not has_column_privilege('authenticated','public.ordax_accounts','communications_product_digest','UPDATE')
    or not has_column_privilege('authenticated','public.ordax_accounts','communications_news','UPDATE')
    or not has_column_privilege('authenticated','public.ordax_accounts','display_name','UPDATE')
    or not has_column_privilege('authenticated','public.ordax_accounts','preferred_locale','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','user_id','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','created_at','UPDATE')
    or has_column_privilege('anon','public.ordax_accounts','communications_news','UPDATE')
  then
    raise exception 'Account communication preference privileges invalid';
  end if;
end $security$;

commit;
