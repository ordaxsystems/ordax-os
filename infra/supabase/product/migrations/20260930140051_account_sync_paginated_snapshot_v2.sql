-- Restored from the live, reviewed paginated snapshot function on the prior
-- provider (migration ledger: 20260930140051 account_sync_paginated_snapshot_v2).
-- The historical source was absent from the canonical Git repository.
-- Use SECURITY INVOKER at this stage, because the existing ordered migration
-- 20261005025500_sync_private_least_privilege_v2.sql is the sole authority to
-- promote the RPC to the restricted ordax_sync_executor owner.
-- This migration does not create a second sync owner or activate public sync.
begin;

CREATE OR REPLACE FUNCTION public.ordax_sync_snapshot_page_v2(p_cursor bigint DEFAULT NULL::bigint, p_after_data_class text DEFAULT NULL::text, p_after_stable_object_id text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_current_cursor bigint;
  v_cursor bigint;
  v_has_more boolean;
  v_next_data_class text;
  v_next_stable_object_id text;
  v_objects jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication-required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid-snapshot-page-limit' using errcode = '22023';
  end if;
  if (p_after_data_class is null) <> (p_after_stable_object_id is null) then
    raise exception 'invalid-snapshot-page-token' using errcode = '22023';
  end if;
  if p_after_data_class is not null and (
    char_length(p_after_data_class) < 1 or char_length(p_after_data_class) > 80
    or char_length(p_after_stable_object_id) < 1 or char_length(p_after_stable_object_id) > 240
  ) then
    raise exception 'invalid-snapshot-page-token' using errcode = '22023';
  end if;
  if p_cursor is not null and p_cursor < 0 then
    raise exception 'invalid-snapshot-cursor' using errcode = '22023';
  end if;

  select coalesce(max(m.change_seq), 0)::bigint
    into v_current_cursor
  from private.ordax_sync_mutations m
  where m.owner_user_id = v_user_id;

  if p_cursor is null then
    v_cursor := v_current_cursor;
  elsif p_cursor > v_current_cursor then
    raise exception 'snapshot-cursor-ahead-of-account-history' using errcode = '22023';
  else
    v_cursor := p_cursor;
  end if;

  if exists (
    select 1
    from private.ordax_sync_objects o
    where o.owner_user_id = v_user_id
      and not exists (
        select 1
        from private.ordax_sync_mutations m
        where m.owner_user_id = o.owner_user_id
          and m.data_class = o.data_class
          and m.stable_object_id = o.stable_object_id
      )
  ) then
    raise exception 'sync-object-history-missing' using errcode = '55000';
  end if;

  with eligible as materialized (
    select
      o.sync_object_id,
      o.data_class,
      o.stable_object_id,
      o.object_schema_version,
      o.resolver_version,
      o.server_revision,
      o.tombstone,
      o.payload,
      o.updated_at
    from private.ordax_sync_objects o
    join lateral (
      select m.change_seq
      from private.ordax_sync_mutations m
      where m.owner_user_id = o.owner_user_id
        and m.data_class = o.data_class
        and m.stable_object_id = o.stable_object_id
      order by m.change_seq desc
      limit 1
    ) latest on true
    where o.owner_user_id = v_user_id
      and latest.change_seq <= v_cursor
      and (
        p_after_data_class is null
        or (o.data_class, o.stable_object_id) > (p_after_data_class, p_after_stable_object_id)
      )
    order by o.data_class, o.stable_object_id
    limit p_limit + 1
  ),
  page as materialized (
    select *
    from eligible
    order by data_class, stable_object_id
    limit p_limit
  )
  select
    (select count(*) > p_limit from eligible),
    (select data_class from page order by data_class desc, stable_object_id desc limit 1),
    (select stable_object_id from page order by data_class desc, stable_object_id desc limit 1),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'sync_object_id', p.sync_object_id,
            'data_class', p.data_class,
            'stable_object_id', p.stable_object_id,
            'object_schema_version', p.object_schema_version,
            'resolver_version', p.resolver_version,
            'server_revision', p.server_revision,
            'tombstone', p.tombstone,
            'payload', p.payload,
            'updated_at', p.updated_at
          )
          order by p.data_class, p.stable_object_id
        )
        from page p
      ),
      '[]'::jsonb
    )
  into v_has_more, v_next_data_class, v_next_stable_object_id, v_objects;

  if not v_has_more then
    v_next_data_class := null;
    v_next_stable_object_id := null;
  end if;

  return jsonb_build_object(
    'cursor', v_cursor,
    'objects', v_objects,
    'has_more', v_has_more,
    'next_data_class', v_next_data_class,
    'next_stable_object_id', v_next_stable_object_id
  );
end;
$function$;

revoke all on function public.ordax_sync_snapshot_page_v2(bigint,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ordax_sync_snapshot_page_v2(bigint,text,text,integer)
  to authenticated;

commit;
