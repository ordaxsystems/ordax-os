\set ON_ERROR_STOP on

-- This proof runs after test_space_creation_authority_v1.sql in the same ephemeral
-- PostgreSQL database, so the canonical Account/Space tables and creation RPC already
-- exist. The foundation test intentionally omits entitlements; add the exact columns
-- required by the production guard here.
create table public.ordax_entitlement_grants (
  grant_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  space_id uuid references public.ordax_spaces(space_id) on delete cascade,
  entitlement_key text not null,
  entitlement_value jsonb not null,
  source text not null default 'product-default',
  valid_from timestamptz not null default timezone('utc', now()),
  valid_until timestamptz,
  check ((user_id is not null)::integer + (space_id is not null)::integer = 1)
);

\ir ../../infra/supabase/product/migrations/20261016043000_space_active_quota_guard_v1.sql

insert into auth.users(id) values
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555');
insert into public.ordax_accounts(user_id) values
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555');

-- No explicit grant means the canonical Free baseline: two active Spaces.
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

select * from public.ordax_create_space_v1(
  'Free Pizzaria', 'food', 'pizzeria',
  '33333333-aaaa-4333-8333-333333333331'
);
select * from public.ordax_create_space_v1(
  'Free Impressao', 'fabrication', '3d-printing',
  '33333333-aaaa-4333-8333-333333333332'
);

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_create_space_v1(
      'Free terceiro', 'food', 'pizzeria',
      '33333333-aaaa-4333-8333-333333333333'
    );
  exception when sqlstate '23514' then
    blocked := sqlerrm = 'spaces-active-quota-exceeded';
  end;
  if not blocked then
    raise exception 'Free account exceeded two active Spaces';
  end if;
end;
$$;
reset role;

-- The trigger must also stop a trusted/direct INSERT path, not only the public RPC.
do $$
declare
  blocked boolean := false;
begin
  begin
    insert into public.ordax_spaces(owner_user_id, name, kind, state, domain, subtype)
    values (
      '33333333-3333-4333-8333-333333333333',
      'Direct bypass attempt', 'professional', 'active', 'food', 'pizzeria'
    );
  exception when sqlstate '23514' then
    blocked := sqlerrm = 'spaces-active-quota-exceeded';
  end;
  if not blocked then
    raise exception 'database trigger allowed direct active-Space bypass';
  end if;
end;
$$;

-- Archived Spaces do not consume the active quota. Reactivation is guarded too.
update public.ordax_spaces
set state = 'archived'
where owner_user_id = '33333333-3333-4333-8333-333333333333'
  and name = 'Free Pizzaria';

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select * from public.ordax_create_space_v1(
  'Free reposicao', 'food', 'pizzeria',
  '33333333-aaaa-4333-8333-333333333334'
);
reset role;

do $$
declare
  blocked boolean := false;
  archived_id uuid;
begin
  select space_id into archived_id
  from public.ordax_spaces
  where owner_user_id = '33333333-3333-4333-8333-333333333333'
    and name = 'Free Pizzaria';
  begin
    update public.ordax_spaces set state = 'active' where space_id = archived_id;
  exception when sqlstate '23514' then
    blocked := sqlerrm = 'spaces-active-quota-exceeded';
  end;
  if not blocked then
    raise exception 'reactivation bypassed active-Space quota';
  end if;
end;
$$;

-- A single valid server-owned grant may raise the bound. The client cannot write grants.
insert into public.ordax_entitlement_grants(
  user_id, entitlement_key, entitlement_value, source
) values (
  '44444444-4444-4444-8444-444444444444',
  'spaces.active.max',
  '{"decision":"allowed","type":"quota","unit":"items","limit":3}'::jsonb,
  'admin'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select * from public.ordax_create_space_v1('Grant 1','food','pizzeria','44444444-aaaa-4444-8444-444444444441');
select * from public.ordax_create_space_v1('Grant 2','food','pizzeria','44444444-aaaa-4444-8444-444444444442');
select * from public.ordax_create_space_v1('Grant 3','fabrication','3d-printing','44444444-aaaa-4444-8444-444444444443');

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_create_space_v1(
      'Grant 4', 'food', 'pizzeria',
      '44444444-aaaa-4444-8444-444444444444'
    );
  exception when sqlstate '23514' then
    blocked := sqlerrm = 'spaces-active-quota-exceeded';
  end;
  if not blocked then
    raise exception 'explicit spaces.active.max grant was not enforced';
  end if;
end;
$$;
reset role;

-- Multiple simultaneously valid policies are not guessed or merged.
insert into public.ordax_entitlement_grants(
  user_id, entitlement_key, entitlement_value, source
) values
(
  '55555555-5555-4555-8555-555555555555',
  'spaces.active.max',
  '{"decision":"allowed","type":"quota","unit":"items","limit":2}'::jsonb,
  'admin'
),
(
  '55555555-5555-4555-8555-555555555555',
  'spaces.active.max',
  '{"decision":"allowed","type":"quota","unit":"items","limit":3}'::jsonb,
  'promotion'
);

set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', false);

do $$
declare
  blocked boolean := false;
begin
  begin
    perform * from public.ordax_create_space_v1(
      'Ambiguous', 'food', 'pizzeria',
      '55555555-aaaa-4555-8555-555555555551'
    );
  exception when sqlstate '55000' then
    blocked := sqlerrm = 'space-quota-policy-ambiguous';
  end;
  if not blocked then
    raise exception 'ambiguous Space quota policy did not fail closed';
  end if;
end;
$$;
reset role;
