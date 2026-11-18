-- Isolated PostgreSQL 16 proof. Runs in the existing service-quota CI sandbox;
-- never runs against the production Supabase project.
\set ON_ERROR_STOP on
create schema if not exists auth;
create schema if not exists private;
create role anon;
create role authenticated;
create role service_role;
create table auth.users(id uuid primary key);
create function auth.uid()
  returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
\i infra/supabase/product/migrations/20261118000000_account_commerce_subscription_read_v1.sql

do $test$
declare
  owner uuid := '8bce09bf-963b-4ccb-8f67-e1b02e44a873';
  stranger uuid := '33f58c01-65f2-4e2f-b3cd-179b76a5469b';
  value jsonb;
begin
  if has_table_privilege('authenticated','private.ordax_commerce_subscriptions','SELECT')
     or has_table_privilege('authenticated','private.ordax_commerce_subscriptions','INSERT')
     or has_table_privilege('anon','private.ordax_commerce_provider_receipts','SELECT') then
    raise exception 'commercial backend tables must not be browser readable or mutable';
  end if;
  if has_function_privilege('anon','public.ordax_read_account_subscription_row_v1()','EXECUTE') then
    raise exception 'anonymous role must not execute subscription read';
  end if;
  insert into auth.users(id) values(owner),(stranger);
  perform set_config('request.jwt.claim.sub',owner::text,true);
  if public.ordax_read_account_subscription_row_v1() is not null then
    raise exception 'missing subscription must not be inferred as Free';
  end if;
  insert into private.ordax_commerce_subscriptions(owner_user_id,plan_id,lifecycle,source,verified_at)
    values(owner,'free','active','operator-free',now());
  value := public.ordax_read_account_subscription_row_v1();
  if value->>'owner_user_id' <> owner::text or value->>'plan_id' <> 'free'
     or value->>'source' <> 'operator-free' then
    raise exception 'explicit Free projection broken';
  end if;
  perform set_config('request.jwt.claim.sub',stranger::text,true);
  if public.ordax_read_account_subscription_row_v1() is not null then
    raise exception 'cross-owner read exposed subscription';
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  if public.ordax_read_account_subscription_row_v1() is not null then
    raise exception 'anonymous request yielded an owner subscription';
  end if;
end;
$test$;

do $test$
declare
  owner uuid := '33f58c01-65f2-4e2f-b3cd-179b76a5469b';
  receipt_id text := 'evt_signed_20261118_001';
  value jsonb;
begin
  insert into private.ordax_commerce_provider_receipts(provider,event_id,payload_sha256,event_kind,verified_at)
    values ('provider-proof',receipt_id,repeat('a',64),'subscription.updated',now());
  insert into private.ordax_commerce_subscriptions(
    owner_user_id,plan_id,lifecycle,source,provider,provider_event_id,
    verified_at,current_period_start,current_period_end)
    values(owner,'personal','active','verified-provider','provider-proof',receipt_id,
      now(),now()-interval '1 day',now()+interval '1 month');
  perform set_config('request.jwt.claim.sub',owner::text,true);
  value := public.ordax_read_account_subscription_row_v1();
  if value->>'plan_id' <> 'personal' or value->>'source' <> 'verified-provider'
     or value ? 'provider_event_id' or value ? 'payload_sha256' then
    raise exception 'commercial projection leaked provider metadata or missed plan';
  end if;
end;
$test$;
