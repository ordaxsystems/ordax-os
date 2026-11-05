begin;

-- Forward-only remediation of issue #2007. The historical migration remains
-- immutable: existing PostgreSQL authority is owner_user_id, not a synthetic
-- membership with role='owner'. This migration refuses unrecognized live source.
do $preflight$
declare
  v_source_hash text;
  v_definer boolean;
  v_config text[];
  v_member_check text;
begin
  select md5(p.prosrc), p.prosecdef, p.proconfig
    into v_source_hash, v_definer, v_config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ordax_create_space_v1'
    and pg_get_function_identity_arguments(p.oid) =
      'p_name text, p_domain text, p_subtype text, p_idempotency_key uuid';

  if v_source_hash not in (
    '155bcf905e0580e07ec6d1c719efa3ab', -- observed deployed source
    '0ba59366342cbd51a0f36f6427e4332e'  -- canonical historical source
  ) or v_definer is distinct from true or v_config is null
    or cardinality(v_config) <> 1
    or v_config[1] not in ('search_path=""', 'search_path=') then
    raise exception 'space-owner-source-diverged' using errcode = '55000';
  end if;

  select pg_get_constraintdef(c.oid) into v_member_check
  from pg_constraint c
  where c.conrelid = 'public.ordax_space_members'::regclass
    and c.conname = 'ordax_space_members_role_check';
  if v_member_check is distinct from
      'CHECK ((role = ANY (ARRAY[''admin''::text, ''member''::text, ''viewer''::text])))' then
    raise exception 'space-owner-membership-policy-diverged' using errcode = '55000';
  end if;

  if not has_function_privilege('authenticated', 'public.ordax_create_space_v1(text,text,text,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.ordax_create_space_v1(text,text,text,uuid)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.ordax_spaces', 'INSERT') then
    raise exception 'space-owner-execution-grants-diverged' using errcode = '55000';
  end if;
end;
$preflight$;

create or replace function public.ordax_create_space_v1(
  p_name text,
  p_domain text,
  p_subtype text,
  p_idempotency_key uuid
)
returns table (
  space_id uuid,
  owner_user_id uuid,
  name text,
  kind text,
  state text,
  domain text,
  subtype text,
  profile_slug text,
  profile_version integer,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
  v_projection record;
  v_existing record;
  v_space_id uuid;
  v_owned_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication-required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'space-create-idempotency-key-required';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'invalid-space-name';
  end if;

  select p.space_kind, p.profile_slug, p.profile_version
    into v_projection
  from private.ordax_space_creation_type_projection p
  where p.domain = p_domain
    and p.subtype = p_subtype;
  if not found then
    raise exception using errcode = '22023', message = 'space-type-not-creatable';
  end if;

  -- Serialize mutations per account. This prevents a concurrent pair of requests from
  -- bypassing the bounded owned-Space limit.
  perform 1
  from public.ordax_accounts a
  where a.user_id = v_actor
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'ordax-account-required';
  end if;

  select r.space_id, r.requested_name, r.domain, r.subtype
    into v_existing
  from private.ordax_space_creation_requests r
  where r.user_id = v_actor
    and r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.requested_name <> v_name
      or v_existing.domain <> p_domain
      or v_existing.subtype <> p_subtype then
      raise exception using errcode = '22023', message = 'space-create-idempotency-conflict';
    end if;

    return query
    select s.space_id,
           s.owner_user_id,
           s.name,
           s.kind,
           s.state,
           s.domain,
           s.subtype,
           v_projection.profile_slug::text,
           v_projection.profile_version::integer,
           false
    from public.ordax_spaces s
    where s.space_id = v_existing.space_id
      and s.owner_user_id = v_actor;
    if not found then
      raise exception using errcode = 'P0001', message = 'space-create-idempotency-state-invalid';
    end if;
    return;
  end if;

  select count(*)::integer
    into v_owned_count
  from public.ordax_spaces s
  where s.owner_user_id = v_actor;
  if v_owned_count >= 64 then
    raise exception using errcode = '23514', message = 'owned-space-limit-reached';
  end if;

  insert into public.ordax_spaces(
    owner_user_id, name, kind, state, domain, subtype
  ) values (
    v_actor, v_name, v_projection.space_kind, 'active', p_domain, p_subtype
  )
  returning ordax_spaces.space_id into v_space_id;

  insert into private.ordax_space_creation_requests(
    user_id, idempotency_key, space_id, requested_name, domain, subtype
  ) values (
    v_actor, p_idempotency_key, v_space_id, v_name, p_domain, p_subtype
  );

  return query
  select s.space_id,
         s.owner_user_id,
         s.name,
         s.kind,
         s.state,
         s.domain,
         s.subtype,
         v_projection.profile_slug::text,
         v_projection.profile_version::integer,
         true
  from public.ordax_spaces s
  where s.space_id = v_space_id;
end;
$$;

-- CREATE OR REPLACE preserves function ownership and existing ACL. No grants
-- are widened and no owner membership row is generated.
do $postflight$
declare
  v_updated_hash text;
  v_source text;
begin
  select md5(p.prosrc), p.prosrc into v_updated_hash, v_source
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ordax_create_space_v1'
    and pg_get_function_identity_arguments(p.oid) =
      'p_name text, p_domain text, p_subtype text, p_idempotency_key uuid';
  if v_updated_hash is distinct from md5($newbody$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
  v_projection record;
  v_existing record;
  v_space_id uuid;
  v_owned_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication-required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'space-create-idempotency-key-required';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'invalid-space-name';
  end if;

  select p.space_kind, p.profile_slug, p.profile_version
    into v_projection
  from private.ordax_space_creation_type_projection p
  where p.domain = p_domain
    and p.subtype = p_subtype;
  if not found then
    raise exception using errcode = '22023', message = 'space-type-not-creatable';
  end if;

  -- Serialize mutations per account. This prevents a concurrent pair of requests from
  -- bypassing the bounded owned-Space limit.
  perform 1
  from public.ordax_accounts a
  where a.user_id = v_actor
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'ordax-account-required';
  end if;

  select r.space_id, r.requested_name, r.domain, r.subtype
    into v_existing
  from private.ordax_space_creation_requests r
  where r.user_id = v_actor
    and r.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.requested_name <> v_name
      or v_existing.domain <> p_domain
      or v_existing.subtype <> p_subtype then
      raise exception using errcode = '22023', message = 'space-create-idempotency-conflict';
    end if;

    return query
    select s.space_id,
           s.owner_user_id,
           s.name,
           s.kind,
           s.state,
           s.domain,
           s.subtype,
           v_projection.profile_slug::text,
           v_projection.profile_version::integer,
           false
    from public.ordax_spaces s
    where s.space_id = v_existing.space_id
      and s.owner_user_id = v_actor;
    if not found then
      raise exception using errcode = 'P0001', message = 'space-create-idempotency-state-invalid';
    end if;
    return;
  end if;

  select count(*)::integer
    into v_owned_count
  from public.ordax_spaces s
  where s.owner_user_id = v_actor;
  if v_owned_count >= 64 then
    raise exception using errcode = '23514', message = 'owned-space-limit-reached';
  end if;

  insert into public.ordax_spaces(
    owner_user_id, name, kind, state, domain, subtype
  ) values (
    v_actor, v_name, v_projection.space_kind, 'active', p_domain, p_subtype
  )
  returning ordax_spaces.space_id into v_space_id;

  insert into private.ordax_space_creation_requests(
    user_id, idempotency_key, space_id, requested_name, domain, subtype
  ) values (
    v_actor, p_idempotency_key, v_space_id, v_name, p_domain, p_subtype
  );

  return query
  select s.space_id,
         s.owner_user_id,
         s.name,
         s.kind,
         s.state,
         s.domain,
         s.subtype,
         v_projection.profile_slug::text,
         v_projection.profile_version::integer,
         true
  from public.ordax_spaces s
  where s.space_id = v_space_id;
end;
$newbody$)
    or position('insert into public.ordax_space_members' in lower(v_source)) > 0
    or not has_function_privilege('authenticated', 'public.ordax_create_space_v1(text,text,text,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.ordax_create_space_v1(text,text,text,uuid)', 'EXECUTE') then
    raise exception 'space-owner-postflight-failed' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
