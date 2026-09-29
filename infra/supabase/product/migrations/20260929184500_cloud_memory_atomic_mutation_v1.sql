-- Server-authoritative atomic Memory + sync mutation.
-- Public rollout remains disabled. The RPC is inert unless an active
-- memory.cloud.enabled entitlement exists for the authenticated subject.

alter table private.ordax_sync_objects
  drop constraint ordax_sync_objects_data_class_check;
alter table private.ordax_sync_objects
  add constraint ordax_sync_objects_data_class_check
  check (data_class = any (array[
    'appearance'::text,
    'preferences'::text,
    'workspace-metadata'::text,
    'app-state-metadata'::text,
    'user-selected-cloud-content'::text,
    'memory'::text
  ]));

alter table private.ordax_sync_mutations
  drop constraint ordax_sync_mutations_data_class_check;
alter table private.ordax_sync_mutations
  add constraint ordax_sync_mutations_data_class_check
  check (data_class = any (array[
    'appearance'::text,
    'preferences'::text,
    'workspace-metadata'::text,
    'app-state-metadata'::text,
    'user-selected-cloud-content'::text,
    'memory'::text
  ]));

create or replace function public.ordax_apply_memory_mutation_v1(
  p_idempotency_key text,
  p_memory_id uuid,
  p_scope text,
  p_space_id uuid,
  p_kind text,
  p_sensitivity text,
  p_content text,
  p_provenance text,
  p_source_timestamp timestamptz,
  p_confidence numeric,
  p_base_server_revision bigint,
  p_tombstone boolean,
  p_resolver_version integer
)
returns table(
  memory_id uuid,
  server_revision bigint,
  tombstone boolean,
  applied boolean,
  conflict boolean,
  change_cursor bigint
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_existing_memory public.ordax_memory_items%rowtype;
  v_existing_sync private.ordax_sync_objects%rowtype;
  v_existing_mutation private.ordax_sync_mutations%rowtype;
  v_memory_id uuid;
  v_scope text;
  v_space_id uuid;
  v_revision bigint;
  v_cursor bigint;
  v_payload jsonb;
  v_has_entitlement boolean;
begin
  if v_user_id is null then
    raise exception 'authentication-required' using errcode = '42501';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) < 8
     or char_length(p_idempotency_key) > 200 then
    raise exception 'invalid-idempotency-key' using errcode = '22023';
  end if;
  if p_resolver_version is null or p_resolver_version <= 0 then
    raise exception 'invalid-resolver-version' using errcode = '22023';
  end if;
  if p_tombstone is null then
    raise exception 'tombstone-required' using errcode = '22023';
  end if;

  select * into v_existing_mutation
  from private.ordax_sync_mutations
  where owner_user_id = v_user_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_mutation.data_class <> 'memory' then
      raise exception 'idempotency-key-reused' using errcode = '23505';
    end if;
    begin
      v_memory_id := v_existing_mutation.stable_object_id::uuid;
    exception when invalid_text_representation then
      raise exception 'stored-memory-identity-invalid' using errcode = '22023';
    end;
    return query
    select
      v_memory_id,
      v_existing_mutation.resulting_server_revision,
      v_existing_mutation.tombstone,
      false,
      false,
      v_existing_mutation.change_seq;
    return;
  end if;

  if p_tombstone then
    if p_memory_id is null then
      raise exception 'memory-id-required-for-delete' using errcode = '22023';
    end if;

    select * into v_existing_memory
    from public.ordax_memory_items
    where memory_id = p_memory_id
      and owner_user_id = v_user_id
    for update;

    if not found then
      raise exception 'memory-not-found' using errcode = 'P0002';
    end if;
    if v_existing_memory.scope not in ('account','space') then
      raise exception 'memory-scope-not-cloud-eligible' using errcode = '22023';
    end if;
    if v_existing_memory.sensitivity = 'restricted' then
      raise exception 'restricted-memory-cloud-sync-disabled' using errcode = '42501';
    end if;

    v_memory_id := v_existing_memory.memory_id;
    v_scope := v_existing_memory.scope;
    v_space_id := v_existing_memory.space_id;
  else
    if p_scope not in ('account','space') then
      raise exception 'memory-scope-not-cloud-eligible' using errcode = '22023';
    end if;
    if p_scope = 'account' and p_space_id is not null then
      raise exception 'account-memory-space-must-be-null' using errcode = '22023';
    end if;
    if p_scope = 'space' and p_space_id is null then
      raise exception 'space-memory-space-required' using errcode = '22023';
    end if;
    if p_scope = 'space' and not private.ordax_can_access_space(p_space_id) then
      raise exception 'space-access-denied' using errcode = '42501';
    end if;
    if p_kind not in ('preference','fact','instruction','summary','artifact-reference') then
      raise exception 'invalid-memory-kind' using errcode = '22023';
    end if;
    if p_sensitivity not in ('normal','private') then
      raise exception 'restricted-memory-cloud-sync-disabled' using errcode = '42501';
    end if;
    if p_content is null or char_length(p_content) < 1 or char_length(p_content) > 32768 then
      raise exception 'invalid-memory-content' using errcode = '22023';
    end if;
    if p_provenance is null or char_length(p_provenance) < 1 or char_length(p_provenance) > 1024 then
      raise exception 'invalid-memory-provenance' using errcode = '22023';
    end if;
    if p_source_timestamp is null then
      raise exception 'memory-source-timestamp-required' using errcode = '22023';
    end if;
    if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
      raise exception 'invalid-memory-confidence' using errcode = '22023';
    end if;

    if p_memory_id is not null then
      select * into v_existing_memory
      from public.ordax_memory_items
      where memory_id = p_memory_id
        and owner_user_id = v_user_id
      for update;
      if not found then
        raise exception 'client-generated-memory-id-not-allowed' using errcode = '22023';
      end if;
      if v_existing_memory.scope not in ('account','space')
         or v_existing_memory.sensitivity = 'restricted' then
        raise exception 'existing-memory-not-cloud-eligible' using errcode = '42501';
      end if;
      v_memory_id := v_existing_memory.memory_id;
    else
      if coalesce(p_base_server_revision, 0) <> 0 then
        raise exception 'memory-id-required-for-update' using errcode = '22023';
      end if;
      v_memory_id := gen_random_uuid();
    end if;

    v_scope := p_scope;
    v_space_id := p_space_id;
  end if;

  select exists (
    select 1
    from public.ordax_entitlement_grants e
    where e.entitlement_key = 'memory.cloud.enabled'
      and e.valid_from <= timezone('utc', now())
      and (e.valid_until is null or e.valid_until > timezone('utc', now()))
      and e.entitlement_value ->> 'decision' = 'allowed'
      and (
        e.user_id = v_user_id
        or (
          v_scope = 'space'
          and e.space_id = v_space_id
          and private.ordax_can_access_space(v_space_id)
        )
      )
  ) into v_has_entitlement;

  if not v_has_entitlement then
    raise exception 'memory-cloud-entitlement-required' using errcode = '42501';
  end if;

  select * into v_existing_sync
  from private.ordax_sync_objects
  where owner_user_id = v_user_id
    and data_class = 'memory'
    and stable_object_id = v_memory_id::text
  for update;

  if found then
    if p_base_server_revision is null
       or p_base_server_revision <> v_existing_sync.server_revision then
      return query select
        v_memory_id,
        v_existing_sync.server_revision,
        v_existing_sync.tombstone,
        false,
        true,
        null::bigint;
      return;
    end if;
    v_revision := v_existing_sync.server_revision + 1;
  else
    if coalesce(p_base_server_revision, 0) <> 0 then
      return query select
        v_memory_id,
        0::bigint,
        false,
        false,
        true,
        null::bigint;
      return;
    end if;
    v_revision := 1;
  end if;

  if p_tombstone then
    v_payload := jsonb_build_object(
      'memoryId', v_memory_id,
      'scope', v_existing_memory.scope,
      'spaceId', v_existing_memory.space_id,
      'state', 'deleted'
    );
  else
    v_payload := jsonb_build_object(
      'memoryId', v_memory_id,
      'scope', p_scope,
      'spaceId', p_space_id,
      'kind', p_kind,
      'sensitivity', p_sensitivity,
      'content', p_content,
      'provenance', p_provenance,
      'sourceTimestamp', p_source_timestamp,
      'confidence', p_confidence,
      'state', 'active'
    );
  end if;

  if found then
    update private.ordax_sync_objects
    set object_schema_version = 1,
        resolver_version = p_resolver_version,
        server_revision = v_revision,
        tombstone = p_tombstone,
        payload = v_payload,
        updated_at = timezone('utc', now())
    where sync_object_id = v_existing_sync.sync_object_id;
  else
    insert into private.ordax_sync_objects(
      owner_user_id,
      data_class,
      stable_object_id,
      object_schema_version,
      resolver_version,
      server_revision,
      tombstone,
      payload
    ) values (
      v_user_id,
      'memory',
      v_memory_id::text,
      1,
      p_resolver_version,
      v_revision,
      p_tombstone,
      v_payload
    );
  end if;

  insert into private.ordax_sync_mutations(
    owner_user_id,
    idempotency_key,
    data_class,
    stable_object_id,
    base_server_revision,
    resulting_server_revision,
    mutation_kind,
    object_schema_version,
    resolver_version,
    tombstone,
    payload
  ) values (
    v_user_id,
    p_idempotency_key,
    'memory',
    v_memory_id::text,
    p_base_server_revision,
    v_revision,
    case when p_tombstone then 'delete' else 'upsert' end,
    1,
    p_resolver_version,
    p_tombstone,
    v_payload
  )
  returning change_seq into v_cursor;

  if p_tombstone then
    update public.ordax_memory_items
    set state = 'deleted',
        updated_at = timezone('utc', now())
    where memory_id = v_memory_id
      and owner_user_id = v_user_id;
  elsif p_memory_id is null then
    insert into public.ordax_memory_items(
      memory_id,
      owner_user_id,
      space_id,
      project_ref,
      scope,
      kind,
      sensitivity,
      content,
      provenance,
      source_timestamp,
      confidence,
      state
    ) values (
      v_memory_id,
      v_user_id,
      p_space_id,
      null,
      p_scope,
      p_kind,
      p_sensitivity,
      p_content,
      p_provenance,
      p_source_timestamp,
      p_confidence,
      'active'
    );
  else
    update public.ordax_memory_items
    set space_id = p_space_id,
        project_ref = null,
        scope = p_scope,
        kind = p_kind,
        sensitivity = p_sensitivity,
        content = p_content,
        provenance = p_provenance,
        source_timestamp = p_source_timestamp,
        confidence = p_confidence,
        state = 'active',
        updated_at = timezone('utc', now())
    where memory_id = v_memory_id
      and owner_user_id = v_user_id;
  end if;

  return query select
    v_memory_id,
    v_revision,
    p_tombstone,
    true,
    false,
    v_cursor;
end;
$function$;

revoke all on function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) from public, anon;
grant execute on function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) to authenticated;
