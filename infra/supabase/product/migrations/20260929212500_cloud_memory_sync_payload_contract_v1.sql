-- Align the server-authoritative cloud Memory transport mirror with the
-- canonical ordax.memory-sync-payload/1 contract consumed by the account
-- Memory runtime. This is forward-only: deployed migrations are not edited.
--
-- Memory remains the domain source of truth. The sync rows are transport
-- mirrors only and may not invent ownership or authority. The storage boundary
-- derives account ownership from owner_user_id and stable identity from the
-- server-owned stable_object_id instead of trusting payload fields.

create or replace function private.ordax_memory_canonicalize_sync_payload_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_source jsonb;
  v_memory_uuid uuid;
  v_scope text;
  v_space_id text;
  v_kind text;
  v_sensitivity text;
  v_content text;
  v_provenance text;
  v_source_timestamp text;
begin
  if new.data_class <> 'memory' then
    return new;
  end if;

  if new.object_schema_version <> 1 or new.resolver_version <> 1 then
    raise exception 'memory-sync-version-incompatible' using errcode = '22023';
  end if;

  begin
    v_memory_uuid := new.stable_object_id::uuid;
  exception when invalid_text_representation then
    raise exception 'memory-sync-stable-id-invalid' using errcode = '22023';
  end;

  if new.tombstone then
    new.payload := jsonb_build_object(
      'schema', 'ordax.memory-sync-payload/1',
      'memoryIdentity', jsonb_build_object(
        'id', v_memory_uuid::text,
        'ownerKind', 'account',
        'ownerId', new.owner_user_id::text
      )
    );
    return new;
  end if;

  if new.payload ? 'memory' then
    v_source := new.payload -> 'memory';
  else
    v_source := new.payload;
  end if;

  if v_source is null or jsonb_typeof(v_source) <> 'object' then
    raise exception 'memory-sync-payload-invalid' using errcode = '22023';
  end if;

  v_scope := v_source ->> 'scope';
  v_space_id := nullif(v_source ->> 'spaceId', '');
  v_kind := v_source ->> 'kind';
  v_sensitivity := v_source ->> 'sensitivity';
  v_content := v_source ->> 'content';
  v_provenance := v_source ->> 'provenance';
  v_source_timestamp := v_source ->> 'sourceTimestamp';

  if v_scope not in ('account', 'space') then
    raise exception 'memory-sync-scope-incompatible' using errcode = '22023';
  end if;
  if v_scope = 'account' and v_space_id is not null then
    raise exception 'memory-sync-account-space-invalid' using errcode = '22023';
  end if;
  if v_scope = 'space' and v_space_id is null then
    raise exception 'memory-sync-space-id-required' using errcode = '22023';
  end if;
  if v_kind not in ('preference', 'fact', 'instruction', 'summary', 'artifact-reference') then
    raise exception 'memory-sync-kind-incompatible' using errcode = '22023';
  end if;
  if v_sensitivity not in ('normal', 'private') then
    raise exception 'memory-sync-sensitivity-incompatible' using errcode = '22023';
  end if;
  if v_content is null or char_length(v_content) < 1 or char_length(v_content) > 32768 then
    raise exception 'memory-sync-content-invalid' using errcode = '22023';
  end if;
  if v_provenance is null or char_length(v_provenance) < 1 or char_length(v_provenance) > 1024 then
    raise exception 'memory-sync-provenance-invalid' using errcode = '22023';
  end if;
  if v_source_timestamp is null or char_length(v_source_timestamp) < 1 or char_length(v_source_timestamp) > 64 then
    raise exception 'memory-sync-source-timestamp-invalid' using errcode = '22023';
  end if;

  new.payload := jsonb_build_object(
    'schema', 'ordax.memory-sync-payload/1',
    'memory', jsonb_build_object(
      'schema', 'ordax.memory/1',
      'id', v_memory_uuid::text,
      'ownerKind', 'account',
      'ownerId', new.owner_user_id::text,
      'scope', v_scope,
      'kind', v_kind,
      'sensitivity', v_sensitivity,
      'content', v_content,
      'provenance', v_provenance,
      'sourceTimestamp', v_source_timestamp,
      'spaceId', case when v_space_id is null then 'null'::jsonb else to_jsonb(v_space_id) end,
      'projectId', 'null'::jsonb
    )
  );
  return new;
end;
$function$;

revoke all on function private.ordax_memory_canonicalize_sync_payload_v1()
  from public, anon, authenticated;

drop trigger if exists ordax_memory_canonical_sync_object_payload_v1
  on private.ordax_sync_objects;
create trigger ordax_memory_canonical_sync_object_payload_v1
before insert or update of
  owner_user_id,
  data_class,
  stable_object_id,
  object_schema_version,
  resolver_version,
  tombstone,
  payload
on private.ordax_sync_objects
for each row execute function private.ordax_memory_canonicalize_sync_payload_v1();

drop trigger if exists ordax_memory_canonical_sync_mutation_payload_v1
  on private.ordax_sync_mutations;
create trigger ordax_memory_canonical_sync_mutation_payload_v1
before insert or update of
  owner_user_id,
  data_class,
  stable_object_id,
  object_schema_version,
  resolver_version,
  tombstone,
  payload
on private.ordax_sync_mutations
for each row execute function private.ordax_memory_canonicalize_sync_payload_v1();

-- Upgrade any already-written Memory transport mirrors and replay history in
-- place. Tombstoned rows become identity-only canonical tombstones; active rows
-- are normalized from their legacy flat payloads.
update private.ordax_sync_objects
set payload = payload
where data_class = 'memory';

update private.ordax_sync_mutations
set payload = payload
where data_class = 'memory';

-- Keep the privacy scrub explicit in the canonical payload format. Historical
-- cursor rows remain present, but forgotten content is replaced by identity-only
-- tombstones which the account Memory runtime can consume directly.
create or replace function private.ordax_memory_scrub_forgotten_sync_history_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tombstone_payload jsonb;
begin
  if new.state <> 'deleted' or old.state is not distinct from new.state then
    return null;
  end if;

  v_tombstone_payload := jsonb_build_object(
    'schema', 'ordax.memory-sync-payload/1',
    'memoryIdentity', jsonb_build_object(
      'id', new.memory_id::text,
      'ownerKind', 'account',
      'ownerId', new.owner_user_id::text
    )
  );

  update private.ordax_sync_mutations
     set mutation_kind = 'delete',
         tombstone = true,
         payload = v_tombstone_payload
   where owner_user_id = new.owner_user_id
     and data_class = 'memory'
     and stable_object_id = new.memory_id::text;

  return null;
end;
$function$;

revoke all on function private.ordax_memory_scrub_forgotten_sync_history_v1()
  from public, anon, authenticated;
