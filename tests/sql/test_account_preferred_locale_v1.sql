\set ON_ERROR_STOP on
-- Runs after test_account_display_name_write_v1.sql in the existing PostgreSQL
-- service-quota CI job, preserving its real Auth/RLS fixture subjects.
\ir ../../infra/supabase/product/migrations/20261118074500_account_preferred_locale_v1.sql

set role authenticated;
select set_config('request.jwt.claim.sub', '1a51a97f-6428-43d9-9f18-0d420c9e2265', false);
update public.ordax_accounts
  set preferred_locale='en-US'
  where user_id='1a51a97f-6428-43d9-9f18-0d420c9e2265';
-- A foreign subject cannot be edited by the first user's bearer role.
update public.ordax_accounts
  set preferred_locale='en-US'
  where user_id='5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23';
reset role;

do $proof$
declare invalid_rejected boolean := false;
begin
  if (select preferred_locale from public.ordax_accounts
      where user_id='1a51a97f-6428-43d9-9f18-0d420c9e2265') <> 'en-US'
    or (select preferred_locale from public.ordax_accounts
      where user_id='5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23') is not null then
    raise exception 'Locale changed another account or failed to persist';
  end if;
  begin
    update public.ordax_accounts set preferred_locale='es-ES'
      where user_id='1a51a97f-6428-43d9-9f18-0d420c9e2265';
  exception when check_violation then invalid_rejected := true;
  end;
  if not invalid_rejected then raise exception 'Unsupported locale accepted'; end if;
  if not has_column_privilege('authenticated','public.ordax_accounts','preferred_locale','UPDATE')
    or not has_column_privilege('authenticated','public.ordax_accounts','display_name','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','user_id','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','created_at','UPDATE')
    or has_column_privilege('anon','public.ordax_accounts','preferred_locale','UPDATE') then
    raise exception 'Locale SQL grants broadened sensitive Account writes';
  end if;
end $proof$;

set role authenticated;
select set_config('request.jwt.claim.sub', '5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23', false);
update public.ordax_accounts set preferred_locale='pt-BR'
  where user_id='5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23';
reset role;
do $proof$
begin
  if (select preferred_locale from public.ordax_accounts
      where user_id='5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23') <> 'pt-BR'
    or (select preferred_locale from public.ordax_accounts
      where user_id='1a51a97f-6428-43d9-9f18-0d420c9e2265') <> 'en-US' then
    raise exception 'Second owner locale write was not isolated';
  end if;
end $proof$;
