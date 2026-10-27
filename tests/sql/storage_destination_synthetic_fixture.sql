-- Synthetic, disposable PostgreSQL fixture only. Never run against a Supabase project.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;
CREATE SCHEMA private;
-- Mirror the Supabase migration ledger's read-only catalog boundary.
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(
    version text PRIMARY KEY
);

CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.ordax_spaces(
    space_id uuid PRIMARY KEY,
    owner_user_id uuid NOT NULL REFERENCES auth.users(id)
);
CREATE TABLE public.ordax_entitlement_grants(
    grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    space_id uuid REFERENCES public.ordax_spaces(space_id),
    entitlement_key text NOT NULL,
    entitlement_value jsonb NOT NULL,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz
);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $uid$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$uid$;

CREATE FUNCTION private.ordax_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $touch$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$touch$;
CREATE FUNCTION private.ordax_authenticated_subject_eligible_v1() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $session$
  SELECT auth.uid() IS NOT NULL
$session$;
CREATE FUNCTION private.ordax_can_access_space(target_space_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $space$
  SELECT EXISTS(
    SELECT 1 FROM public.ordax_spaces s
    WHERE s.space_id=target_space_id AND s.owner_user_id=auth.uid()
  )
$space$;

GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Synthetic identities exercise cross-subject RLS without touching real users.
INSERT INTO auth.users(id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222');
INSERT INTO public.ordax_spaces(space_id,owner_user_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
