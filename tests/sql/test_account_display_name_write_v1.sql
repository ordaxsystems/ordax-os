-- Disposable PostgreSQL validation using the existing service-quota CI database.
-- The table fixture is the schema already owned by product foundation.
\set ON_ERROR_STOP on
create function auth.uid() returns uuid
  language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.ordax_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ordax_accounts enable row level security;
create policy ordax_accounts_select_own on public.ordax_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy ordax_accounts_update_own on public.ordax_accounts
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select on public.ordax_accounts to authenticated;

\ir ../../infra/supabase/product/migrations/20261118061000_account_display_name_column_write_v1.sql

insert into auth.users(id) values
  ('8bce09bf-963b-4ccb-8f67-e1b02e44a873'),
  ('33f58c01-65f2-4e2f-b3cd-179b76a5469b');
insert into public.ordax_accounts(user_id) values
  ('8bce09bf-963b-4ccb-8f67-e1b02e44a873'),
  ('33f58c01-65f2-4e2f-b3cd-179b76a5469b');

-- An actual authenticated role can edit only its own display_name.
set role authenticated;
select set_config('request.jwt.claim.sub', '8bce09bf-963b-4ccb-8f67-e1b02e44a873', false);
update public.ordax_accounts
  set display_name='Nome válido'
  where user_id='8bce09bf-963b-4ccb-8f67-e1b02e44a873';
-- An unauthorized cross-subject update must silently affect zero rows by RLS.
update public.ordax_accounts
  set display_name='Ataque'
  where user_id='33f58c01-65f2-4e2f-b3cd-179b76a5469b';
reset role;

do $proof$
declare
  invalid_rejected boolean := false;
begin
  if (select display_name from public.ordax_accounts
    where user_id='8bce09bf-963b-4ccb-8f67-e1b02e44a873') <> 'Nome válido'
    or (select display_name from public.ordax_accounts
      where user_id='33f58c01-65f2-4e2f-b3cd-179b76a5469b') is not null then
    raise exception 'Owner-only profile update was not isolated';
  end if;
  begin
    update public.ordax_accounts set display_name=' Espaço '
      where user_id='8bce09bf-963b-4ccb-8f67-e1b02e44a873';
  exception when check_violation then
    invalid_rejected := true;
  end;
  if not invalid_rejected then raise exception 'Whitespace-only policy not enforced'; end if;
  if has_column_privilege('authenticated','public.ordax_accounts','user_id','UPDATE')
    or has_column_privilege('authenticated','public.ordax_accounts','created_at','UPDATE')
    or has_column_privilege('anon','public.ordax_accounts','display_name','UPDATE')
    or not has_column_privilege('authenticated','public.ordax_accounts','display_name','UPDATE') then
    raise exception 'Profile column grant leaked';
  end if;
end $proof$;
