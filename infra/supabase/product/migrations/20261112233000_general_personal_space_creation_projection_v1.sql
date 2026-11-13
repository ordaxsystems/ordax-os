begin;

-- Projection only. Space and Profile authority remain in the existing Account RPC.
-- Exact origin: system/services/spaces/type-catalog.mjs general.personal
-- with bundled Profile Pack pessoal-basico@1, no new grants.
insert into private.ordax_space_creation_type_projection(
  domain, subtype, space_kind, profile_slug, profile_version
) values ('general', 'personal', 'personal', 'pessoal-basico', 1)
on conflict (domain, subtype) do nothing;

-- Existing rows may not be silently remapped to a different Profile.
do $$
begin
  if not exists (
    select 1 from private.ordax_space_creation_type_projection
    where domain = 'general' and subtype = 'personal'
      and space_kind = 'personal' and profile_slug = 'pessoal-basico'
      and profile_version = 1
  ) then
    raise exception 'Space general.personal projection does not match canonical Profile';
  end if;
  if has_table_privilege('authenticated', 'private.ordax_space_creation_type_projection', 'SELECT') then
    raise exception 'Space projection must remain private';
  end if;
end;
$$;

commit;
