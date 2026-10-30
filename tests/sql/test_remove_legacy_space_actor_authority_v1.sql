\set ON_ERROR_STOP on

-- The canonical proof database already contains the current
-- ordax_create_space_v1(text,text,text,uuid). Recreate only the two historical
-- signatures so this proof can demonstrate that the cleanup is exact.
create or replace function private.ordax_trusted_actor_auth_eligible_v1(
  p_actor_user_id uuid
)
returns boolean
language sql
as $$ select p_actor_user_id is not null $$;

create or replace function public.ordax_create_space_v1(
  p_actor_user_id uuid,
  p_name text,
  p_kind text,
  p_metadata jsonb
)
returns jsonb
language sql
as $$ select jsonb_build_object('ok', true) $$;

\ir ../../infra/supabase/product/migrations/20261016050000_remove_legacy_space_actor_authority_v1.sql

do $$
begin
  if to_regprocedure('public.ordax_create_space_v1(uuid,text,text,jsonb)') is not null then
    raise exception 'legacy actor-supplied Space authority still exists';
  end if;
  if to_regprocedure('private.ordax_trusted_actor_auth_eligible_v1(uuid)') is not null then
    raise exception 'legacy trusted-actor helper still exists';
  end if;
  if to_regprocedure('public.ordax_create_space_v1(text,text,text,uuid)') is null then
    raise exception 'canonical session-derived Space authority was removed';
  end if;
end;
$$;
