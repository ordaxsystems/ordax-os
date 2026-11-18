\set ON_ERROR_STOP on
-- The PostgreSQL CI uses the same authenticated users / RLS fixture from
-- test_account_display_name_write_v1.sql + test_account_preferred_locale_v1.sql.
\ir ../../infra/supabase/product/migrations/20261118151000_account_optional_communications_v1.sql
do $proof$
begin
  if exists(select 1 from public.ordax_accounts
    where communications_product_digest is not null or communications_news is not null) then
    raise exception 'Optional communications default must be unconfigured, not opted-in';
  end if;
end $proof$;

set role authenticated;
select set_config('request.jwt.claim.sub','1a51a97f-6428-43d9-9f18-0d420c9e2265',false);
update public.ordax_accounts
  set communications_product_digest=true,communications_news=false
  where user_id='1a51a97f-6428-43d9-9f18-0d420c9e2265';
-- Foreign subject must stay unconfigured: RLS restricts both UPDATE and SELECT.
update public.ordax_accounts
  set communications_product_digest=true,communications_news=true
  where user_id='5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23';
reset role;

do $proof$
declare rejected boolean:=false;
begin
  if not exists(select 1 from public.ordax_accounts
    where user_id='1a51a97f-6428-43d9-9f18-0d420c9e2265'
      and communications_product_digest=true and communications_news=false)
    or exists(select 1 from public.ordax_accounts
      where user_id='5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23'
        and (communications_news is not null or communications_product_digest is not null)) then
    raise exception 'Own-subject optional communications writes not isolated';
  end if;
  begin
    update public.ordax_accounts set communications_news=null
    where user_id='1a51a97f-6428-43d9-9f18-0d420c9e2265';
  exception when check_violation then rejected:=true;
  end;
  if not rejected then raise exception 'Partial update silently accepted'; end if;
  if has_column_privilege('authenticated','public.ordax_accounts','user_id','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','updated_at','UPDATE')
    or has_column_privilege('anon','public.ordax_accounts','communications_news','UPDATE')
    or not has_column_privilege('authenticated','public.ordax_accounts','communications_news','UPDATE')
    or not has_column_privilege('authenticated','public.ordax_accounts','display_name','UPDATE')
  then
    raise exception 'Column privilege leaked after communications migration';
  end if;
end $proof$;

set role authenticated;
select set_config('request.jwt.claim.sub','5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23',false);
update public.ordax_accounts set communications_product_digest=false,communications_news=false
  where user_id='5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23';
reset role;

do $proof$
begin
  if not exists(select 1 from public.ordax_accounts
     where user_id='5dd9a4ca-62d6-4be3-8ed5-7d34ce389e23'
       and communications_product_digest=false and communications_news=false)
     or not exists(select 1 from public.ordax_accounts
       where user_id='1a51a97f-6428-43d9-9f18-0d420c9e2265'
         and communications_product_digest=true and communications_news=false) then
     raise exception 'Second owner write changed first user or failed';
  end if;
end $proof$;
