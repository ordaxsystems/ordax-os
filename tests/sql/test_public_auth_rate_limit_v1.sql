\set ON_ERROR_STOP on

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;

\ir ../../infra/supabase/product/migrations/20261004202500_public_auth_rate_limit_v1.sql

do $proof$
declare
  v record;
  i integer;
  v_count integer;
  v_attempts integer;
begin
  if has_table_privilege('anon', 'private.ordax_public_auth_rate_limits', 'SELECT')
     or has_table_privilege('authenticated', 'private.ordax_public_auth_rate_limits', 'SELECT')
     or has_table_privilege('service_role', 'private.ordax_public_auth_rate_limits', 'SELECT') then
    raise exception 'rate-limit-table-direct-read-grant';
  end if;

  if has_table_privilege('service_role', 'private.ordax_public_auth_rate_limits', 'INSERT')
     or has_table_privilege('service_role', 'private.ordax_public_auth_rate_limits', 'UPDATE')
     or has_table_privilege('service_role', 'private.ordax_public_auth_rate_limits', 'DELETE') then
    raise exception 'rate-limit-table-direct-write-grant';
  end if;

  if has_function_privilege('anon', 'public.ordax_consume_public_auth_rate_limit_v1(text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ordax_consume_public_auth_rate_limit_v1(text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ordax_consume_public_auth_rate_limit_v1(text,text)', 'EXECUTE') then
    raise exception 'rate-limit-function-grants-invalid';
  end if;

  for i in 1..10 loop
    select * into v
    from public.ordax_consume_public_auth_rate_limit_v1('credentials', '203.0.113.10');
    if v.schema <> 'prototype-ordax.public-auth-rate-limit/1'
       or v.decision <> 'allowed'
       or v.limit_count <> 10
       or v.remaining <> 10 - i
       or v.retry_after_seconds is not null then
      raise exception 'credentials-allow-contract-invalid-at-%', i;
    end if;
  end loop;

  select * into v
  from public.ordax_consume_public_auth_rate_limit_v1('credentials', '203.0.113.10');
  if v.decision <> 'rate_limited'
     or v.limit_count <> 10
     or v.remaining <> 0
     or v.retry_after_seconds not between 1 and 60 then
    raise exception 'credentials-rate-limit-contract-invalid';
  end if;

  select * into v
  from public.ordax_consume_public_auth_rate_limit_v1('credentials', '203.0.113.11');
  if v.decision <> 'allowed' or v.remaining <> 9 then
    raise exception 'client-address-isolation-failed';
  end if;

  for i in 1..3 loop
    select * into v
    from public.ordax_consume_public_auth_rate_limit_v1('recovery-request', '198.51.100.20');
    if v.decision <> 'allowed' or v.limit_count <> 3 then
      raise exception 'recovery-request-allow-contract-invalid-at-%', i;
    end if;
  end loop;

  select * into v
  from public.ordax_consume_public_auth_rate_limit_v1('recovery-request', '198.51.100.20');
  if v.decision <> 'rate_limited' or v.retry_after_seconds not between 1 and 60 then
    raise exception 'recovery-request-rate-limit-contract-invalid';
  end if;

  for i in 1..10 loop
    select * into v
    from public.ordax_consume_public_auth_rate_limit_v1('recovery-completion', '192.0.2.30');
    if v.decision <> 'allowed' or v.limit_count <> 10 then
      raise exception 'recovery-completion-allow-contract-invalid-at-%', i;
    end if;
  end loop;

  select * into v
  from public.ordax_consume_public_auth_rate_limit_v1('recovery-completion', '192.0.2.30');
  if v.decision <> 'rate_limited' or v.retry_after_seconds not between 1 and 60 then
    raise exception 'recovery-completion-rate-limit-contract-invalid';
  end if;

  perform public.ordax_consume_public_auth_rate_limit_v1('credentials', '2001:db8::1');
  perform public.ordax_consume_public_auth_rate_limit_v1(
    'credentials',
    '2001:0db8:0000:0000:0000:0000:0000:0001'
  );
  select count(*), max(attempt_count)
  into v_count, v_attempts
  from private.ordax_public_auth_rate_limits
  where bucket = 'credentials'
    and client_sha256 = encode(
      extensions.digest(convert_to('2001:db8::1', 'UTF8'), 'sha256'),
      'hex'
    );
  if v_count <> 1 or v_attempts <> 2 then
    raise exception 'canonical-ipv6-keying-failed';
  end if;

  begin
    perform public.ordax_consume_public_auth_rate_limit_v1('unknown', '203.0.113.1');
    raise exception 'invalid-bucket-was-accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.ordax_consume_public_auth_rate_limit_v1('credentials', 'not-an-ip');
    raise exception 'invalid-address-was-accepted';
  exception
    when sqlstate '22023' then null;
  end;

  if exists (
    select 1
    from private.ordax_public_auth_rate_limits
    where client_sha256 !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'non-digest-client-key-persisted';
  end if;
end;
$proof$;

\echo PUBLIC_AUTH_RATE_LIMIT_V1_PROOF=PASS
