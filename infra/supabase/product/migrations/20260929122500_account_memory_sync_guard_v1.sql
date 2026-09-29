-- Source-prepared guard for issue #685. This migration is not evidence that
-- Memory sync is publicly promoted. It extends the existing canonical mutation
-- RPC only; it does not create a second sync transport or store.

create or replace function public.ordax_apply_sync_mutation_v1(
  p_idempotency_key text,
  p_data_class text,
  p_stable_object_id text,
  p_object_schema_version integer,
  p_resolver_version integer,
  p_base_server_revision bigint,
  p_tombstone boolean,
  p_payload jsonb
)
returns table(
  sync_object_id uuid,
  server_revision bigint,
  tombstone boolean,
  applied boolean,
  conflict boolean
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_existing private.ordax_sync_objects%rowtype;
  v_mutation private.ordax_sync_mutations%rowtype;
  v_revision bigint;
  v_key_count integer;
  v_memory jsonb;
  v_identity jsonb;
  v_memory_id text;
  v_expected_object_id text;
  v_content text;
  v_provenance text;
  v_space_id text;
  v_project_id text;
  v_source_timestamp timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication-required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 or char_length(p_idempotency_key) > 200 then
    raise exception 'invalid-idempotency-key' using errcode = '22023';
  end if;
  if p_data_class not in ('appearance','preferences','workspace-metadata','memory','app-state-metadata','user-selected-cloud-content') then
    raise exception 'invalid-data-class' using errcode = '22023';
  end if;
  if p_stable_object_id is null or char_length(p_stable_object_id) < 1 or char_length(p_stable_object_id) > 240 then
    raise exception 'invalid-stable-object-id' using errcode = '22023';
  end if;
  if p_object_schema_version is null or p_object_schema_version <= 0 or p_resolver_version is null or p_resolver_version <= 0 then
    raise exception 'invalid-schema-version' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload-must-be-object' using errcode = '22023';
  end if;

  -- Memory is a domain object, not arbitrary JSON. The database enforces a
  -- conservative server-side acceptance mirror so a direct authenticated RPC
  -- call cannot bypass the gateway and upload device-only or secret material.
  -- The semantic authority remains ordax.memory/1 + system/services/sync.
  if p_data_class = 'memory' then
    if p_object_schema_version <> 1 or p_resolver_version <> 1 then
      raise exception 'invalid-memory-sync-version' using errcode = '22023';
    end if;

    select count(*) into v_key_count from jsonb_object_keys(p_payload);
    if v_key_count <> 2 or p_payload->>'schema' <> 'ordax.memory-sync-payload/1' then
      raise exception 'invalid-memory-sync-payload' using errcode = '22023';
    end if;

    if p_tombstone then
      if not (p_payload ? 'memoryIdentity') or p_payload ? 'memory' or jsonb_typeof(p_payload->'memoryIdentity') <> 'object' then
        raise exception 'invalid-memory-sync-tombstone' using errcode = '22023';
      end if;
      v_identity := p_payload->'memoryIdentity';
      select count(*) into v_key_count from jsonb_object_keys(v_identity);
      if v_key_count <> 3
         or not (v_identity ? 'id')
         or not (v_identity ? 'ownerKind')
         or not (v_identity ? 'ownerId')
         or v_identity->>'ownerKind' <> 'account'
         or v_identity->>'ownerId' <> v_user_id::text then
        raise exception 'invalid-memory-sync-tombstone' using errcode = '22023';
      end if;
      v_memory_id := v_identity->>'id';
      if v_memory_id is null or v_memory_id <> btrim(v_memory_id) or char_length(v_memory_id) < 1 or char_length(v_memory_id) > 160 then
        raise exception 'invalid-memory-id' using errcode = '22023';
      end if;
    else
      if not (p_payload ? 'memory') or p_payload ? 'memoryIdentity' or jsonb_typeof(p_payload->'memory') <> 'object' then
        raise exception 'invalid-memory-sync-payload' using errcode = '22023';
      end if;
      v_memory := p_payload->'memory';
      select count(*) into v_key_count from jsonb_object_keys(v_memory);
      if v_key_count <> 12
         or not (v_memory ? 'schema')
         or not (v_memory ? 'id')
         or not (v_memory ? 'ownerKind')
         or not (v_memory ? 'ownerId')
         or not (v_memory ? 'scope')
         or not (v_memory ? 'kind')
         or not (v_memory ? 'sensitivity')
         or not (v_memory ? 'content')
         or not (v_memory ? 'provenance')
         or not (v_memory ? 'sourceTimestamp')
         or not (v_memory ? 'spaceId')
         or not (v_memory ? 'projectId') then
        raise exception 'invalid-memory-sync-payload' using errcode = '22023';
      end if;
      if v_memory->>'schema' <> 'ordax.memory/1'
         or v_memory->>'ownerKind' <> 'account'
         or v_memory->>'ownerId' <> v_user_id::text
         or v_memory->>'scope' not in ('account','space','project')
         or v_memory->>'kind' not in ('preference','fact','instruction','summary','artifact-reference')
         or v_memory->>'sensitivity' not in ('normal','private') then
        raise exception 'invalid-memory-sync-domain' using errcode = '22023';
      end if;

      v_memory_id := v_memory->>'id';
      v_content := v_memory->>'content';
      v_provenance := v_memory->>'provenance';
      v_space_id := v_memory->>'spaceId';
      v_project_id := v_memory->>'projectId';

      if v_memory_id is null or v_memory_id <> btrim(v_memory_id) or char_length(v_memory_id) < 1 or char_length(v_memory_id) > 160 then
        raise exception 'invalid-memory-id' using errcode = '22023';
      end if;
      if v_content is null or v_content <> btrim(v_content) or char_length(v_content) < 1 or char_length(v_content) > 32768 or octet_length(v_content) > 65536 then
        raise exception 'invalid-memory-content' using errcode = '22023';
      end if;
      if v_provenance is null or v_provenance <> btrim(v_provenance) or char_length(v_provenance) < 1 or char_length(v_provenance) > 1024 or octet_length(v_provenance) > 2048 then
        raise exception 'invalid-memory-provenance' using errcode = '22023';
      end if;
      if v_space_id is not null and (v_space_id <> btrim(v_space_id) or char_length(v_space_id) < 1 or char_length(v_space_id) > 160) then
        raise exception 'invalid-memory-space' using errcode = '22023';
      end if;
      if v_project_id is not null and (v_project_id <> btrim(v_project_id) or char_length(v_project_id) < 1 or char_length(v_project_id) > 240) then
        raise exception 'invalid-memory-project' using errcode = '22023';
      end if;
      if v_memory->>'scope' = 'space' and v_space_id is null then
        raise exception 'invalid-memory-space' using errcode = '22023';
      end if;
      if v_memory->>'scope' = 'project' and v_project_id is null then
        raise exception 'invalid-memory-project' using errcode = '22023';
      end if;
      if v_memory->>'sourceTimestamp' is null or char_length(v_memory->>'sourceTimestamp') > 64 then
        raise exception 'invalid-memory-source-timestamp' using errcode = '22023';
      end if;
      begin
        v_source_timestamp := (v_memory->>'sourceTimestamp')::timestamptz;
      exception when others then
        raise exception 'invalid-memory-source-timestamp' using errcode = '22023';
      end;
      if v_source_timestamp is null then
        raise exception 'invalid-memory-source-timestamp' using errcode = '22023';
      end if;

      -- Never-sync material is rejected server-side as defense in depth. These
      -- checks intentionally mirror/strengthen the client boundary; they do not
      -- turn provider storage into Memory semantic authority.
      if v_content ~* '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'
         or v_provenance ~* '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'
         or v_content ~ 'sk-[A-Za-z0-9_-]{16,}'
         or v_provenance ~ 'sk-[A-Za-z0-9_-]{16,}'
         or v_content ~ 'ghp_[A-Za-z0-9]{20,}'
         or v_provenance ~ 'ghp_[A-Za-z0-9]{20,}'
         or v_content ~ 'github_pat_[A-Za-z0-9_]{20,}'
         or v_provenance ~ 'github_pat_[A-Za-z0-9_]{20,}'
         or v_content ~ 'xox[baprs]-[A-Za-z0-9-]{16,}'
         or v_provenance ~ 'xox[baprs]-[A-Za-z0-9-]{16,}'
         or v_content ~ 'sb_secret_[A-Za-z0-9_-]{16,}'
         or v_provenance ~ 'sb_secret_[A-Za-z0-9_-]{16,}'
         or v_content ~* 'authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+'
         or v_provenance ~* 'authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+'
         or v_content ~* 'bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}'
         or v_provenance ~* 'bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}'
         or v_content ~* '(access|refresh)[_-]?token[[:space:]]*[:=]'
         or v_provenance ~* '(access|refresh)[_-]?token[[:space:]]*[:=]'
         or v_content ~* 'password[[:space:]]*[:=]'
         or v_provenance ~* 'password[[:space:]]*[:=]' then
        raise exception 'memory-never-sync-material' using errcode = '22023';
      end if;
    end if;

    v_expected_object_id := 'memory/' || rtrim(
      translate(
        replace(replace(encode(convert_to(v_memory_id, 'UTF8'), 'base64'), E'\n', ''), E'\r', ''),
        '+/',
        '-_'
      ),
      '='
    );
    if p_stable_object_id <> v_expected_object_id or char_length(v_expected_object_id) > 240 then
      raise exception 'invalid-memory-stable-object-id' using errcode = '22023';
    end if;
  end if;

  select * into v_mutation from private.ordax_sync_mutations
  where owner_user_id = v_user_id and idempotency_key = p_idempotency_key;

  if found then
    if v_mutation.data_class <> p_data_class
       or v_mutation.stable_object_id <> p_stable_object_id
       or v_mutation.base_server_revision is distinct from p_base_server_revision
       or v_mutation.object_schema_version <> p_object_schema_version
       or v_mutation.resolver_version <> p_resolver_version
       or v_mutation.tombstone <> p_tombstone
       or v_mutation.payload <> p_payload then
      raise exception 'idempotency-key-reused-for-different-mutation' using errcode = '22023';
    end if;
    select * into v_existing from private.ordax_sync_objects
    where owner_user_id = v_user_id and data_class = v_mutation.data_class and stable_object_id = v_mutation.stable_object_id;
    return query select v_existing.sync_object_id, v_mutation.resulting_server_revision, v_mutation.tombstone, false, false;
    return;
  end if;

  select * into v_existing from private.ordax_sync_objects
  where owner_user_id = v_user_id and data_class = p_data_class and stable_object_id = p_stable_object_id
  for update;

  if found then
    if p_base_server_revision is null or p_base_server_revision <> v_existing.server_revision then
      return query select v_existing.sync_object_id, v_existing.server_revision, v_existing.tombstone, false, true;
      return;
    end if;
    v_revision := v_existing.server_revision + 1;
    update private.ordax_sync_objects
      set object_schema_version = p_object_schema_version,
          resolver_version = p_resolver_version,
          server_revision = v_revision,
          tombstone = p_tombstone,
          payload = p_payload,
          updated_at = timezone('utc', now())
      where sync_object_id = v_existing.sync_object_id
      returning * into v_existing;
  else
    if coalesce(p_base_server_revision, 0) <> 0 then
      return query select null::uuid, 0::bigint, false, false, true;
      return;
    end if;
    v_revision := 1;
    insert into private.ordax_sync_objects(
      owner_user_id, data_class, stable_object_id, object_schema_version,
      resolver_version, server_revision, tombstone, payload
    ) values (
      v_user_id, p_data_class, p_stable_object_id, p_object_schema_version,
      p_resolver_version, v_revision, p_tombstone, p_payload
    )
    returning * into v_existing;
  end if;

  insert into private.ordax_sync_mutations(
    owner_user_id, idempotency_key, data_class, stable_object_id,
    base_server_revision, resulting_server_revision, mutation_kind,
    object_schema_version, resolver_version, tombstone, payload
  ) values (
    v_user_id, p_idempotency_key, p_data_class, p_stable_object_id,
    p_base_server_revision, v_revision, case when p_tombstone then 'delete' else 'upsert' end,
    p_object_schema_version, p_resolver_version, p_tombstone, p_payload
  );

  return query select v_existing.sync_object_id, v_revision, p_tombstone, true, false;
end;
$function$;

-- v2 remains the canonical cursor-returning mutation RPC and already delegates
-- to v1. Replacing v1 therefore adds Memory enforcement without a second RPC or
-- transport path. Keep direct RPC execution owner-scoped through auth.uid().

revoke all on function public.ordax_apply_sync_mutation_v1(text,text,text,integer,integer,bigint,boolean,jsonb) from public, anon;
grant execute on function public.ordax_apply_sync_mutation_v1(text,text,text,integer,integer,bigint,boolean,jsonb) to authenticated;
