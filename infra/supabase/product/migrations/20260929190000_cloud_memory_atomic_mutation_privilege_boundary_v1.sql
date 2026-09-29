-- Preserve the public invoker API while keeping direct Memory DML revoked.
-- The private definer repeats all authorization checks and is not exposed as a
-- public-schema RPC.

alter function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) rename to ordax_apply_memory_mutation_internal_v1;

alter function public.ordax_apply_memory_mutation_internal_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) set schema private;

alter function private.ordax_apply_memory_mutation_internal_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) security definer;

revoke all on function private.ordax_apply_memory_mutation_internal_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) from public, anon;
grant execute on function private.ordax_apply_memory_mutation_internal_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) to authenticated;

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
language sql
security invoker
set search_path = ''
as $function$
  select *
  from private.ordax_apply_memory_mutation_internal_v1(
    p_idempotency_key,
    p_memory_id,
    p_scope,
    p_space_id,
    p_kind,
    p_sensitivity,
    p_content,
    p_provenance,
    p_source_timestamp,
    p_confidence,
    p_base_server_revision,
    p_tombstone,
    p_resolver_version
  );
$function$;

revoke all on function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) from public, anon;
grant execute on function public.ordax_apply_memory_mutation_v1(
  text, uuid, text, uuid, text, text, text, text, timestamptz, numeric, bigint, boolean, integer
) to authenticated;
