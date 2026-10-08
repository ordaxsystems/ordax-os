-- Live PostgreSQL proof for the OrdaX Account Sync/Export subject boundary.
-- Prerequisite: the canonical migration sync_request_subject_bridge_v1.
-- All policy activation, Auth users, sync objects, receipts and mutations are
-- intentionally rolled back. No production users, data or legal acceptance
-- documents are created by this fixture.
begin;

do $proof$
declare
  v_policy uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_email_a text;
  v_email_b text;
  v_intent_a uuid;
  v_intent_b uuid;
  v_export_a jsonb;
  v_export_b jsonb;
  v_snapshot_a jsonb;
  v_mutation record;
begin
  v_email_a := 'ordax-proof-a-' || replace(v_a::text, '-', '') || '@example.invalid';
  v_email_b := 'ordax-proof-b-' || replace(v_b::text, '-', '') || '@example.invalid';

  -- An isolated policy exists ONLY within this rollback transaction.
  v_policy := public.ordax_activate_account_legal_policy_v1(
    'transient-proof-' || v_a::text, current_date, repeat('a', 64),
    'https://example.invalid/privacy',
    'transient-proof-' || v_a::text, current_date, repeat('b', 64),
    'https://example.invalid/terms'
  );
  if v_policy is null then raise exception 'transient-legal-policy-failed'; end if;

  select intent_id into v_intent_a
    from public.ordax_begin_account_registration_legal_intent_v1(v_email_a, true);
  select intent_id into v_intent_b
    from public.ordax_begin_account_registration_legal_intent_v1(v_email_b, true);

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_user_meta_data
  ) values
    (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', v_email_a, '', now(), now(), now(),
     jsonb_build_object('ordax_registration_intent_id', v_intent_a::text)),
    (v_b, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', v_email_b, '', now(), now(), now(),
     jsonb_build_object('ordax_registration_intent_id', v_intent_b::text));

  if (select count(*) from private.ordax_account_legal_receipts
       where user_id in (v_a, v_b)) <> 2
  then raise exception 'legal-receipt-not-bound'; end if;

  if (select count(*) from public.ordax_accounts
       where user_id in (v_a, v_b)) <> 2
  then raise exception 'account-bootstrap-missing'; end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  select * into v_mutation from public.ordax_apply_sync_mutation_v2(
    'proof-idempotency-key-A-20261008',
    'appearance', 'only-A', 1, 1, 0, false, '{"theme":"dark"}'::jsonb
  );
  if not v_mutation.applied or v_mutation.conflict
     or v_mutation.server_revision <> 1
  then raise exception 'sync-write-not-applied'; end if;

  select public.ordax_account_export_v1() into v_export_a;
  if v_export_a->>'subject' <> v_a::text
     or v_export_a#>>'{sync_objects,0,stable_object_id}' <> 'only-A'
  then raise exception 'user-A-export-mismatch'; end if;

  select public.ordax_sync_snapshot_page_v2(null, null, null, 20)
    into v_snapshot_a;
  if v_snapshot_a#>>'{objects,0,stable_object_id}' <> 'only-A'
  then raise exception 'user-A-snapshot-mismatch'; end if;

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  select public.ordax_account_export_v1() into v_export_b;
  if v_export_b->>'subject' <> v_b::text
     or jsonb_array_length(v_export_b->'sync_objects') <> 0
  then raise exception 'cross-user-sync-export-leak'; end if;
end;
$proof$;

rollback;
