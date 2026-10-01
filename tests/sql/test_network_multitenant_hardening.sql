\set ON_ERROR_STOP on

-- Minimal Supabase-compatible product authority used by OrdaX Network.
-- The database is disposable CI infrastructure; no production project is touched.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create schema private;
create extension if not exists pgcrypto;

grant usage on schema auth to authenticated;
grant usage on schema private to authenticated;

create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to public;

create table public.ordax_spaces (
  space_id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'work' check (kind in ('personal','work','professional')),
  state text not null default 'active' check (state in ('active','archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.ordax_space_members (
  space_id uuid not null references public.ordax_spaces(space_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  state text not null default 'active' check (state in ('active','suspended')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (space_id, user_id)
);

create or replace function private.ordax_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on table public.ordax_spaces from public, anon, authenticated;
revoke all on table public.ordax_space_members from public, anon, authenticated;
revoke all on function private.ordax_touch_updated_at() from public, anon, authenticated;

-- Apply the exact source migrations in canonical order.
\ir ../../infra/supabase/product/migrations/20261001040000_network_directory_communities_v1.sql
\ir ../../infra/supabase/product/migrations/20261001043000_network_groups_messages_v1.sql
\ir ../../infra/supabase/product/migrations/20261001044500_network_inbox_groups_v1.sql
\ir ../../infra/supabase/product/migrations/20261001050000_network_security_hardening_v1.sql
\ir ../../infra/supabase/product/migrations/20261001051500_network_group_owner_lifecycle_v1.sql

begin;

insert into auth.users(id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

insert into public.ordax_spaces(space_id, owner_user_id, name, kind, state) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'Escola Horizonte', 'professional', 'active'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111', 'Escola Horizonte Unidade 2', 'professional', 'active'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'Papelaria Bairro', 'professional', 'active'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '44444444-4444-4444-8444-444444444444', 'Escola Temporaria', 'professional', 'active');

insert into public.ordax_space_members(space_id, user_id, role, state) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '33333333-3333-4333-8333-333333333333', 'viewer', 'active');

insert into public.ordax_network_communities(
  community_id, title, kind, jurisdiction, state, join_policy
) values (
  'industry.education.school.br',
  'Escolas Brasil',
  'professional-industry',
  'BR',
  'active',
  'explicit-consent'
);

create temporary table proof_state (
  key text primary key,
  value uuid not null
);
grant select, insert, update on proof_state to authenticated;

-- Direct table access stays closed even for authenticated clients.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $proof$
begin
  begin
    perform 1 from public.ordax_network_messages limit 1;
    raise exception 'network-proof-direct-message-table-readable';
  exception
    when insufficient_privilege then null;
  end;
end;
$proof$;

-- Owners explicitly publish their professional Space projection.
select public.ordax_network_upsert_space_profile_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'Escola Horizonte',
  'Escola de bairro',
  'Salvador - BA',
  array['education','school'],
  'discoverable'
);

select public.ordax_network_upsert_space_profile_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'Escola Horizonte Unidade 2',
  null,
  'Salvador - BA',
  array['education','school'],
  'discoverable'
);

select public.ordax_network_join_community_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'industry.education.school.br'
);

select public.ordax_network_join_community_v1(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'industry.education.school.br'
);

-- A viewer can read as Space A but cannot mutate its public projection.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $proof$
begin
  begin
    perform public.ordax_network_upsert_space_profile_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'Hijacked name',
      null,
      null,
      array['school'],
      'discoverable'
    );
    raise exception 'network-proof-viewer-mutated-space-profile';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

-- User B cannot act as Space A.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $proof$
begin
  begin
    perform *
    from public.ordax_network_list_my_memberships_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      20
    );
    raise exception 'network-proof-cross-account-space-access';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

-- Prepare user B Network presence.
select public.ordax_network_upsert_space_profile_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'Papelaria Bairro',
  null,
  'Salvador - BA',
  array['retail'],
  'discoverable'
);
select public.ordax_network_join_community_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'industry.education.school.br'
);

-- User A creates a group and a deterministic direct conversation with B.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
insert into proof_state(key, value)
select
  'group-a',
  public.ordax_network_create_group_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'industry.education.school.br',
    'Gestores de escolas',
    'Troca profissional',
    'members'
  );

insert into proof_state(key, value)
select
  'direct-a-b',
  public.ordax_network_create_direct_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  );

do $proof$
declare
  v_existing uuid;
  v_retry uuid;
begin
  select value into v_existing from proof_state where key = 'direct-a-b';
  select public.ordax_network_create_direct_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
  ) into v_retry;

  if v_existing is null or v_retry <> v_existing then
    raise exception 'network-proof-direct-pair-not-deterministic';
  end if;
end;
$proof$;

-- Message retry returns the canonical row and does not duplicate history.
insert into proof_state(key, value)
select
  'message-a-1',
  (
    public.ordax_network_send_message_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      (select value from proof_state where key = 'direct-a-b'),
      'proof-message-key-0001',
      'Aviso de teste'
    )
  ).message_id;

do $proof$
declare
  v_first uuid;
  v_retry uuid;
  v_count integer;
begin
  select value into v_first from proof_state where key = 'message-a-1';

  select (
    public.ordax_network_send_message_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      (select value from proof_state where key = 'direct-a-b'),
      'proof-message-key-0001',
      'Aviso de teste'
    )
  ).message_id into v_retry;

  if v_retry <> v_first then
    raise exception 'network-proof-idempotent-retry-changed-message';
  end if;

  select count(*) into v_count
  from public.ordax_network_list_messages_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value from proof_state where key = 'direct-a-b'),
    null,
    null,
    50
  )
  where body = 'Aviso de teste';

  if v_count <> 1 then
    raise exception 'network-proof-idempotent-retry-duplicated-message';
  end if;
end;
$proof$;

-- Switching to another Space owned by the same Account cannot retarget the
-- existing A<->B conversation.
do $proof$
begin
  begin
    perform public.ordax_network_send_message_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      (select value from proof_state where key = 'direct-a-b'),
      'proof-space-switch-0001',
      'Nao deve enviar'
    );
    raise exception 'network-proof-space-switch-retargeted-conversation';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

-- B joins/leaves/rejoins A's group; owner A cannot leave without transfer.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select public.ordax_network_join_group_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  (select value from proof_state where key = 'group-a')
);
select public.ordax_network_leave_group_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  (select value from proof_state where key = 'group-a')
);
select public.ordax_network_join_group_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  (select value from proof_state where key = 'group-a')
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $proof$
begin
  begin
    perform public.ordax_network_leave_group_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      (select value from proof_state where key = 'group-a')
    );
    raise exception 'network-proof-group-owner-left-without-transfer';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

-- Space A viewer can read direct history but has no send authority.
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $proof$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.ordax_network_list_messages_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value from proof_state where key = 'direct-a-b'),
    null,
    null,
    50
  );
  if v_count < 1 then
    raise exception 'network-proof-viewer-cannot-read-authorized-history';
  end if;

  begin
    perform public.ordax_network_send_message_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      (select value from proof_state where key = 'direct-a-b'),
      'proof-viewer-send-0001',
      'Viewer nao deve enviar'
    );
    raise exception 'network-proof-viewer-gained-send-authority';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

-- B blocks A. New direct messages are denied, historical reads remain.
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select public.ordax_network_set_block_v1(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  true
);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $proof$
declare
  v_count integer;
begin
  begin
    perform public.ordax_network_send_message_v1(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      (select value from proof_state where key = 'direct-a-b'),
      'proof-blocked-send-0001',
      'Nao deve passar'
    );
    raise exception 'network-proof-block-did-not-stop-send';
  exception
    when sqlstate '42501' then null;
  end;

  select count(*) into v_count
  from public.ordax_network_list_messages_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    (select value from proof_state where key = 'direct-a-b'),
    null,
    null,
    50
  );
  if v_count < 1 then
    raise exception 'network-proof-block-erased-history';
  end if;
end;
$proof$;

-- Durable rate state survives the over-limit decision in the same transaction.
do $proof$
begin
  if not private.ordax_network_consume_rate_v1(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'proof-rate',
    2,
    3600
  ) then
    raise exception 'network-proof-rate-first-denied';
  end if;

  if not private.ordax_network_consume_rate_v1(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'proof-rate',
    2,
    3600
  ) then
    raise exception 'network-proof-rate-second-denied';
  end if;

  if private.ordax_network_consume_rate_v1(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'proof-rate',
    2,
    3600
  ) then
    raise exception 'network-proof-rate-third-allowed';
  end if;
end;
$proof$;

reset role;

do $proof$
declare
  v_count integer;
begin
  select count into v_count
  from private.ordax_network_rate_windows
  where actor_user_id = '11111111-1111-4111-8111-111111111111'
    and actor_space_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    and operation = 'proof-rate';

  if v_count <> 3 then
    raise exception 'network-proof-rate-state-rolled-back-or-lost';
  end if;
end;
$proof$;

-- A fourth independent owner proves account/Space deletion does not leave an
-- active orphan group or block account close.
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select public.ordax_network_join_community_v1(
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
  'industry.education.school.br'
);
insert into proof_state(key, value)
select
  'group-d',
  public.ordax_network_create_group_v1(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    'industry.education.school.br',
    'Grupo temporario',
    null,
    'members'
  );

-- D cannot report a message from a conversation its Space cannot read.
do $proof$
begin
  begin
    perform public.ordax_network_create_report_v1(
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
      'message',
      (select value::text from proof_state where key = 'message-a-1'),
      'Tentativa sem acesso'
    );
    raise exception 'network-proof-report-cross-conversation-allowed';
  exception
    when sqlstate '42501' then null;
  end;
end;
$proof$;

reset role;

delete from auth.users
where id = '44444444-4444-4444-8444-444444444444';

do $proof$
declare
  v_group_id uuid;
  v_group_state text;
  v_owner uuid;
  v_conversation_state text;
  v_audit_count integer;
begin
  select value into v_group_id from proof_state where key = 'group-d';

  select state, owner_space_id
  into v_group_state, v_owner
  from public.ordax_network_groups
  where group_id = v_group_id;

  if v_group_state <> 'archived' or v_owner is not null then
    raise exception 'network-proof-owner-loss-did-not-archive-group';
  end if;

  select state into v_conversation_state
  from public.ordax_network_conversations
  where group_id = v_group_id;

  if v_conversation_state <> 'closed' then
    raise exception 'network-proof-owner-loss-did-not-close-conversation';
  end if;

  select count(*) into v_audit_count
  from private.ordax_network_audit_events
  where event_type = 'group-owner-lost'
    and resource_id = v_group_id::text;

  if v_audit_count <> 1 then
    raise exception 'network-proof-owner-loss-audit-missing';
  end if;
end;
$proof$;

rollback;

\echo NETWORK_MULTITENANT_SQL_PROOF=PASS
