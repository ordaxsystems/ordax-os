-- Source-of-truth recovery for the already-active session-eligibility helper.
-- Reconstructed from the read-only pg_get_functiondef catalog observation on
-- 2026-10-26, not invented as a new authentication mechanism.
-- Exact preflight fingerprint prevents overwriting future provider changes.
-- This migration is NOT applied automatically. It must precede the live RLS
-- policy-boundary migration and needs isolated E2E verification.
begin;

do $preflight$
declare
  v_oid oid;
begin
  v_oid := to_regprocedure('private.ordax_authenticated_subject_eligible_v1()');
  if v_oid is null
     or pg_catalog.md5(pg_get_functiondef(v_oid)) <> '0e64a11cc3d4802f7f94c1591cdadc26'
     or not exists (
       select 1 from pg_proc p where p.oid=v_oid
         and p.provolatile='v'
         and p.prosecdef
         and pg_get_userbyid(p.proowner)='postgres'
         and 'search_path=""'=any(coalesce(p.proconfig,'{}'::text[]))
     ) then
    raise exception 'OrdaX eligibility SSOT: live function fingerprint or security contract drifted';
  end if;
end;
$preflight$;

-- Definition recovered from the live catalog. Uses only verified Supabase
-- JWT claims; never accepts a caller-supplied subject/session identifier.
create or replace function private.ordax_authenticated_subject_eligible_v1()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_subject_user_id uuid;
  v_claims jsonb;
  v_session_text text;
  v_session_id uuid;
begin
  v_subject_user_id:=auth.uid();
  if v_subject_user_id is null then
    return false;
  end if;

  -- These claims are supplied by Supabase/PostgREST after JWT verification;
  -- a raw user_id or a caller-selected session_id is never accepted.
  v_claims:=auth.jwt();
  if v_claims is null
     or pg_catalog.jsonb_typeof(v_claims)<>'object'
     or pg_catalog.jsonb_typeof(v_claims->'session_id')<>'string' then
    return false;
  end if;

  v_session_text:=v_claims->>'session_id';
  if v_session_text is null
     or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_session_id:=v_session_text::uuid;

  return exists (
    select 1
      from auth.sessions s
      join auth.users u on u.id=s.user_id
      join public.ordax_accounts a on a.user_id=u.id
     where s.id=v_session_id
       and s.user_id=v_subject_user_id
       and u.deleted_at is null
       and u.is_anonymous is false
       and u.confirmed_at is not null
       and (u.banned_until is null
         or u.banned_until<=pg_catalog.clock_timestamp())
       and (s.not_after is null
         or s.not_after>pg_catalog.clock_timestamp())
  );
end;
$function$;

-- Do not change GRANTs at this point: existing public RLS still calls the
-- private function until the companion policy migration is proven/applied.
do $postflight$
begin
  if not exists (
    select 1 from pg_proc p
    where p.oid='private.ordax_authenticated_subject_eligible_v1()'::regprocedure
      and p.provolatile='v'
      and p.prosecdef
      and pg_get_userbyid(p.proowner)='postgres'
      and 'search_path=""'=any(coalesce(p.proconfig,'{}'::text[]))
  ) then
    raise exception 'OrdaX eligibility SSOT: reconstructed helper contract invalid';
  end if;
end;
$postflight$;
commit;
