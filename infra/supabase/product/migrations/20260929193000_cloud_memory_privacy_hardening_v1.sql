-- Privacy hardening for the dedicated server-authoritative cloud Memory path.
-- This migration is additive: it does not rewrite the already deployed atomic
-- mutation migrations and it does not enable public Memory rollout.
--
-- Two invariants are enforced at the storage boundary:
-- 1. known never-sync secret material must abort the same database transaction
--    that would otherwise write Memory + its transport mirror;
-- 2. forget/delete must scrub historical mutation payloads because incremental
--    reconciliation reads private.ordax_sync_mutations by opaque change cursor.

create or replace function private.ordax_memory_reject_never_sync_material_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.content ~* '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'
     or new.provenance ~* '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----'
     or new.content ~ '(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}([^A-Za-z0-9_-]|$)'
     or new.provenance ~ '(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}([^A-Za-z0-9_-]|$)'
     or new.content ~ '(^|[^A-Za-z0-9])ghp_[A-Za-z0-9]{20,}([^A-Za-z0-9]|$)'
     or new.provenance ~ '(^|[^A-Za-z0-9])ghp_[A-Za-z0-9]{20,}([^A-Za-z0-9]|$)'
     or new.content ~ '(^|[^A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}([^A-Za-z0-9_]|$)'
     or new.provenance ~ '(^|[^A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}([^A-Za-z0-9_]|$)'
     or new.content ~ '(^|[^A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{16,}([^A-Za-z0-9-]|$)'
     or new.provenance ~ '(^|[^A-Za-z0-9-])xox[baprs]-[A-Za-z0-9-]{16,}([^A-Za-z0-9-]|$)'
     or new.content ~ '(^|[^A-Za-z0-9_-])sb_secret_[A-Za-z0-9_-]{16,}([^A-Za-z0-9_-]|$)'
     or new.provenance ~ '(^|[^A-Za-z0-9_-])sb_secret_[A-Za-z0-9_-]{16,}([^A-Za-z0-9_-]|$)'
     or new.content ~* 'authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[^[:space:]]+'
     or new.provenance ~* 'authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[^[:space:]]+'
     or new.content ~* '(^|[^A-Za-z0-9])bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}'
     or new.provenance ~* '(^|[^A-Za-z0-9])bearer[[:space:]]+[A-Za-z0-9._~+/=-]{8,}'
     or new.content ~* '(access|refresh)[_-]?token[[:space:]]*[:=][[:space:]]*["'']?[^[:space:]"'']{8,}'
     or new.provenance ~* '(access|refresh)[_-]?token[[:space:]]*[:=][[:space:]]*["'']?[^[:space:]"'']{8,}'
     or new.content ~* 'password[[:space:]]*[:=][[:space:]]*["'']?[^[:space:]"'']{8,}'
     or new.provenance ~* 'password[[:space:]]*[:=][[:space:]]*["'']?[^[:space:]"'']{8,}' then
    raise exception 'memory-never-sync-material' using errcode = '22023';
  end if;
  return new;
end;
$function$;

revoke all on function private.ordax_memory_reject_never_sync_material_v1()
  from public, anon, authenticated;

drop trigger if exists ordax_memory_reject_never_sync_material_v1
  on public.ordax_memory_items;
create trigger ordax_memory_reject_never_sync_material_v1
before insert or update of content, provenance on public.ordax_memory_items
for each row execute function private.ordax_memory_reject_never_sync_material_v1();

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
    'memoryId', new.memory_id,
    'scope', new.scope,
    'spaceId', new.space_id,
    'state', 'deleted'
  );

  -- Preserve mutation rows, revisions and change_seq so the opaque cursor stays
  -- monotonic, but remove forgotten private content from every replayable row.
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

drop trigger if exists ordax_memory_scrub_forgotten_sync_history_v1
  on public.ordax_memory_items;
create trigger ordax_memory_scrub_forgotten_sync_history_v1
after update of state on public.ordax_memory_items
for each row
when (new.state = 'deleted' and old.state is distinct from new.state)
execute function private.ordax_memory_scrub_forgotten_sync_history_v1();
