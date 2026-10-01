-- OrdaX Network MVP slice 1: opt-in professional directory, communities and memberships.
-- Direct table access remains closed. Authenticated users interact only through bounded RPCs.
-- Space authority is revalidated server-side on every mutation/read requiring an acting Space.

begin;

create table public.ordax_network_space_profiles (
  space_id uuid primary key references public.ordax_spaces(space_id) on delete cascade,
  public_name text not null check (char_length(public_name) between 1 and 120),
  description text check (description is null or char_length(description) <= 600),
  region_label text check (region_label is null or char_length(region_label) between 1 and 120),
  categories text[] not null default '{}'::text[],
  visibility text not null default 'hidden'
    check (visibility in ('hidden','discoverable')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (cardinality(categories) <= 12)
);

comment on table public.ordax_network_space_profiles is
  'Opt-in public professional projection for an OrdaX Space. Account email and exact location never belong here.';

create table public.ordax_network_communities (
  community_id text primary key
    check (community_id ~ '^[a-z0-9]+([.-][a-z0-9]+)*$' and char_length(community_id) <= 120),
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (char_length(kind) between 1 and 80),
  jurisdiction text not null check (jurisdiction ~ '^[A-Z]{2}$'),
  state text not null default 'active'
    check (state in ('active','archived')),
  join_policy text not null default 'explicit-consent'
    check (join_policy in ('explicit-consent','approval-required','invite-only')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.ordax_network_communities is
  'Canonical Network communities. Profile Packs may recommend a community but never create membership.';

create table public.ordax_network_memberships (
  community_id text not null
    references public.ordax_network_communities(community_id) on delete restrict,
  space_id uuid not null
    references public.ordax_spaces(space_id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','admin','member')),
  state text not null default 'active'
    check (state in ('active','left','suspended','banned')),
  joined_by uuid not null references auth.users(id) on delete restrict,
  joined_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (community_id, space_id)
);

comment on table public.ordax_network_memberships is
  'Server-authoritative Space membership in a Network community. Browser clients have no direct DML authority.';

create table private.ordax_network_membership_audit (
  audit_id uuid primary key default gen_random_uuid(),
  community_id text not null,
  space_id uuid not null,
  actor_user_id uuid not null,
  action text not null check (action in ('joined','left')),
  created_at timestamptz not null default timezone('utc', now())
);

create index ordax_network_space_profiles_discovery_idx
  on public.ordax_network_space_profiles(visibility, public_name, space_id);
create index ordax_network_space_profiles_discovery_lower_name_idx
  on public.ordax_network_space_profiles(
    visibility,
    lower(public_name) text_pattern_ops,
    space_id
  );
create index ordax_network_space_profiles_categories_idx
  on public.ordax_network_space_profiles using gin(categories);
create index ordax_network_memberships_space_state_idx
  on public.ordax_network_memberships(space_id, state, community_id);
create index ordax_network_memberships_community_state_idx
  on public.ordax_network_memberships(community_id, state, space_id);
create index ordax_network_membership_audit_space_created_idx
  on private.ordax_network_membership_audit(space_id, created_at desc);

create trigger touch_ordax_network_space_profiles_updated_at
before update on public.ordax_network_space_profiles
for each row execute function private.ordax_touch_updated_at();

create trigger touch_ordax_network_communities_updated_at
before update on public.ordax_network_communities
for each row execute function private.ordax_touch_updated_at();

create trigger touch_ordax_network_memberships_updated_at
before update on public.ordax_network_memberships
for each row execute function private.ordax_touch_updated_at();

alter table public.ordax_network_space_profiles enable row level security;
alter table public.ordax_network_communities enable row level security;
alter table public.ordax_network_memberships enable row level security;
alter table private.ordax_network_membership_audit enable row level security;

revoke all on table public.ordax_network_space_profiles from public, anon, authenticated;
revoke all on table public.ordax_network_communities from public, anon, authenticated;
revoke all on table public.ordax_network_memberships from public, anon, authenticated;
revoke all on table private.ordax_network_membership_audit from public, anon, authenticated, service_role;

create or replace function private.ordax_network_assert_space_actor_v1(
  p_space_id uuid,
  p_require_admin boolean default false
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_authorized boolean := false;
begin
  if v_user_id is null then
    raise exception 'network-auth-required' using errcode = '42501';
  end if;
  if p_space_id is null then
    raise exception 'network-space-required' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.ordax_spaces s
    where s.space_id = p_space_id
      and s.state = 'active'
      and s.kind = 'professional'
      and (
        s.owner_user_id = v_user_id
        or exists (
          select 1
          from public.ordax_space_members m
          where m.space_id = s.space_id
            and m.user_id = v_user_id
            and m.state = 'active'
            and (
              not p_require_admin
              or m.role in ('owner','admin')
            )
        )
      )
      and (
        not p_require_admin
        or s.owner_user_id = v_user_id
        or exists (
          select 1
          from public.ordax_space_members m
          where m.space_id = s.space_id
            and m.user_id = v_user_id
            and m.state = 'active'
            and m.role in ('owner','admin')
        )
      )
  ) into v_authorized;

  if not v_authorized then
    raise exception 'network-space-access-denied' using errcode = '42501';
  end if;

  return v_user_id;
end;
$$;

revoke all on function private.ordax_network_assert_space_actor_v1(uuid, boolean)
from public, anon;
grant execute on function private.ordax_network_assert_space_actor_v1(uuid, boolean)
to authenticated;

create or replace function private.ordax_network_validate_categories_v1(
  p_categories text[]
)
returns text[]
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_categories text[] := coalesce(p_categories, '{}'::text[]);
  v_category text;
begin
  if cardinality(v_categories) > 12 then
    raise exception 'network-too-many-categories' using errcode = '22023';
  end if;

  foreach v_category in array v_categories loop
    if v_category is null
       or char_length(v_category) not between 1 and 60
       or v_category !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
      raise exception 'network-category-invalid' using errcode = '22023';
    end if;
  end loop;

  if cardinality(v_categories) <> cardinality(array(select distinct x from unnest(v_categories) x)) then
    raise exception 'network-category-duplicate' using errcode = '22023';
  end if;

  return v_categories;
end;
$$;

revoke all on function private.ordax_network_validate_categories_v1(text[])
from public, anon;
grant execute on function private.ordax_network_validate_categories_v1(text[])
to authenticated;

create or replace function private.ordax_network_upsert_space_profile_internal_v1(
  p_space_id uuid,
  p_public_name text,
  p_description text,
  p_region_label text,
  p_categories text[],
  p_visibility text
)
returns public.ordax_network_space_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_categories text[];
  v_row public.ordax_network_space_profiles;
  v_name text := btrim(p_public_name);
  v_description text := nullif(btrim(p_description), '');
  v_region text := nullif(btrim(p_region_label), '');
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);
  v_categories := private.ordax_network_validate_categories_v1(p_categories);

  if v_name is null or char_length(v_name) not between 1 and 120 then
    raise exception 'network-public-name-invalid' using errcode = '22023';
  end if;
  if v_description is not null and char_length(v_description) > 600 then
    raise exception 'network-description-too-long' using errcode = '22023';
  end if;
  if v_region is not null and char_length(v_region) > 120 then
    raise exception 'network-region-label-too-long' using errcode = '22023';
  end if;
  if p_visibility not in ('hidden','discoverable') then
    raise exception 'network-visibility-invalid' using errcode = '22023';
  end if;

  insert into public.ordax_network_space_profiles(
    space_id, public_name, description, region_label, categories, visibility
  ) values (
    p_space_id, v_name, v_description, v_region, v_categories, p_visibility
  )
  on conflict (space_id) do update
    set public_name = excluded.public_name,
        description = excluded.description,
        region_label = excluded.region_label,
        categories = excluded.categories,
        visibility = excluded.visibility
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function private.ordax_network_upsert_space_profile_internal_v1(
  uuid, text, text, text, text[], text
) from public, anon;
grant execute on function private.ordax_network_upsert_space_profile_internal_v1(
  uuid, text, text, text, text[], text
) to authenticated;

create or replace function public.ordax_network_upsert_space_profile_v1(
  p_space_id uuid,
  p_public_name text,
  p_description text default null,
  p_region_label text default null,
  p_categories text[] default '{}'::text[],
  p_visibility text default 'hidden'
)
returns public.ordax_network_space_profiles
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_upsert_space_profile_internal_v1(
    p_space_id,
    p_public_name,
    p_description,
    p_region_label,
    p_categories,
    p_visibility
  );
$$;

revoke all on function public.ordax_network_upsert_space_profile_v1(
  uuid, text, text, text, text[], text
) from public, anon;
grant execute on function public.ordax_network_upsert_space_profile_v1(
  uuid, text, text, text, text[], text
) to authenticated;

create or replace function private.ordax_network_list_directory_internal_v1(
  p_search text,
  p_category text,
  p_after_name text,
  p_after_space_id uuid,
  p_limit integer
)
returns table(
  space_id uuid,
  public_name text,
  description text,
  region_label text,
  categories text[]
)
language plpgsql
security definer
set search_path = ''
as $network$
declare
  v_user_id uuid := (select auth.uid());
  v_search text := nullif(btrim(p_search), '');
  v_category text := nullif(btrim(p_category), '');
begin
  if v_user_id is null then
    raise exception 'network-auth-required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'network-directory-limit-invalid' using errcode = '22023';
  end if;
  if v_search is not null and char_length(v_search) > 80 then
    raise exception 'network-directory-search-too-long' using errcode = '22023';
  end if;
  if v_category is not null and (
    char_length(v_category) > 60
    or v_category !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ) then
    raise exception 'network-category-invalid' using errcode = '22023';
  end if;
  if (p_after_name is null) <> (p_after_space_id is null) then
    raise exception 'network-directory-cursor-incomplete' using errcode = '22023';
  end if;

  return query
  select p.space_id, p.public_name, p.description, p.region_label, p.categories
  from public.ordax_network_space_profiles p
  join public.ordax_spaces s on s.space_id = p.space_id
  where p.visibility = 'discoverable'
    and s.state = 'active'
    and (v_category is null or v_category = any(p.categories))
    and (
      v_search is null
      or lower(p.public_name) like
        lower(replace(replace(v_search, '%', '\\%'), '_', '\\_')) || '%' escape '\\'
    )
    and (
      p_after_name is null
      or (p.public_name, p.space_id) > (p_after_name, p_after_space_id)
    )
  order by p.public_name, p.space_id
  limit p_limit;
end;
$network$;

revoke all on function private.ordax_network_list_directory_internal_v1(
  text, text, text, uuid, integer
) from public, anon;
grant execute on function private.ordax_network_list_directory_internal_v1(
  text, text, text, uuid, integer
) to authenticated;

create or replace function public.ordax_network_list_directory_v1(
  p_search text default null,
  p_category text default null,
  p_after_name text default null,
  p_after_space_id uuid default null,
  p_limit integer default 20
)
returns table(
  space_id uuid,
  public_name text,
  description text,
  region_label text,
  categories text[]
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.ordax_network_list_directory_internal_v1(
    p_search, p_category, p_after_name, p_after_space_id, p_limit
  );
$$;

revoke all on function public.ordax_network_list_directory_v1(
  text, text, text, uuid, integer
) from public, anon;
grant execute on function public.ordax_network_list_directory_v1(
  text, text, text, uuid, integer
) to authenticated;

create or replace function private.ordax_network_list_communities_internal_v1(
  p_limit integer
)
returns table(
  community_id text,
  title text,
  kind text,
  jurisdiction text,
  join_policy text
)
language plpgsql
security definer
set search_path = ''
as $network$
begin
  if (select auth.uid()) is null then
    raise exception 'network-auth-required' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'network-community-limit-invalid' using errcode = '22023';
  end if;

  return query
  select c.community_id, c.title, c.kind, c.jurisdiction, c.join_policy
  from public.ordax_network_communities c
  where c.state = 'active'
  order by c.title, c.community_id
  limit p_limit;
end;
$network$;

revoke all on function private.ordax_network_list_communities_internal_v1(integer)
from public, anon;
grant execute on function private.ordax_network_list_communities_internal_v1(integer)
to authenticated;

create or replace function public.ordax_network_list_communities_v1(
  p_limit integer default 50
)
returns table(
  community_id text,
  title text,
  kind text,
  jurisdiction text,
  join_policy text
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.ordax_network_list_communities_internal_v1(p_limit);
$$;

revoke all on function public.ordax_network_list_communities_v1(integer)
from public, anon;
grant execute on function public.ordax_network_list_communities_v1(integer)
to authenticated;

create or replace function private.ordax_network_join_community_internal_v1(
  p_space_id uuid,
  p_community_id text
)
returns public.ordax_network_memberships
language plpgsql
security definer
set search_path = ''
as $network$
declare
  v_actor uuid;
  v_policy text;
  v_row public.ordax_network_memberships;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);

  select c.join_policy into v_policy
  from public.ordax_network_communities c
  where c.community_id = p_community_id
    and c.state = 'active'
  for share;

  if not found then
    raise exception 'network-community-not-found' using errcode = '22023';
  end if;
  if v_policy <> 'explicit-consent' then
    raise exception 'network-community-join-not-self-service' using errcode = '42501';
  end if;

  select m.* into v_row
  from public.ordax_network_memberships m
  where m.community_id = p_community_id
    and m.space_id = p_space_id
  for update;

  if found then
    if v_row.state = 'active' then
      return v_row;
    end if;
    if v_row.state <> 'left' or v_row.role <> 'member' then
      raise exception 'network-membership-not-self-reactivatable' using errcode = '42501';
    end if;

    update public.ordax_network_memberships m
    set state = 'active',
        joined_by = v_actor,
        joined_at = timezone('utc', now())
    where m.community_id = p_community_id
      and m.space_id = p_space_id
    returning * into v_row;
  else
    insert into public.ordax_network_memberships(
      community_id, space_id, role, state, joined_by
    ) values (
      p_community_id, p_space_id, 'member', 'active', v_actor
    )
    returning * into v_row;
  end if;

  insert into private.ordax_network_membership_audit(
    community_id, space_id, actor_user_id, action
  ) values (
    p_community_id, p_space_id, v_actor, 'joined'
  );

  return v_row;
end;
$network$;

revoke all on function private.ordax_network_join_community_internal_v1(uuid, text)
from public, anon;
grant execute on function private.ordax_network_join_community_internal_v1(uuid, text)
to authenticated;

create or replace function public.ordax_network_join_community_v1(
  p_space_id uuid,
  p_community_id text
)
returns public.ordax_network_memberships
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_join_community_internal_v1(p_space_id, p_community_id);
$$;

revoke all on function public.ordax_network_join_community_v1(uuid, text)
from public, anon;
grant execute on function public.ordax_network_join_community_v1(uuid, text)
to authenticated;

create or replace function private.ordax_network_leave_community_internal_v1(
  p_space_id uuid,
  p_community_id text
)
returns public.ordax_network_memberships
language plpgsql
security definer
set search_path = ''
as $network$
declare
  v_actor uuid;
  v_row public.ordax_network_memberships;
begin
  v_actor := private.ordax_network_assert_space_actor_v1(p_space_id, true);

  select m.* into v_row
  from public.ordax_network_memberships m
  where m.community_id = p_community_id
    and m.space_id = p_space_id
  for update;

  if not found then
    raise exception 'network-membership-not-found' using errcode = '22023';
  end if;
  if v_row.state = 'left' then
    return v_row;
  end if;
  if v_row.state <> 'active' or v_row.role <> 'member' then
    raise exception 'network-membership-not-self-leavable' using errcode = '42501';
  end if;

  update public.ordax_network_memberships m
  set state = 'left'
  where m.community_id = p_community_id
    and m.space_id = p_space_id
  returning * into v_row;

  insert into private.ordax_network_membership_audit(
    community_id, space_id, actor_user_id, action
  ) values (
    p_community_id, p_space_id, v_actor, 'left'
  );

  return v_row;
end;
$network$;

revoke all on function private.ordax_network_leave_community_internal_v1(uuid, text)
from public, anon;
grant execute on function private.ordax_network_leave_community_internal_v1(uuid, text)
to authenticated;

create or replace function public.ordax_network_leave_community_v1(
  p_space_id uuid,
  p_community_id text
)
returns public.ordax_network_memberships
language sql
security invoker
set search_path = ''
as $$
  select private.ordax_network_leave_community_internal_v1(p_space_id, p_community_id);
$$;

revoke all on function public.ordax_network_leave_community_v1(uuid, text)
from public, anon;
grant execute on function public.ordax_network_leave_community_v1(uuid, text)
to authenticated;

create or replace function private.ordax_network_list_my_memberships_internal_v1(
  p_space_id uuid,
  p_limit integer
)
returns table(
  community_id text,
  community_title text,
  role text,
  state text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $network$
begin
  perform private.ordax_network_assert_space_actor_v1(p_space_id, false);
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'network-membership-limit-invalid' using errcode = '22023';
  end if;

  return query
  select m.community_id, c.title, m.role, m.state, m.joined_at
  from public.ordax_network_memberships m
  join public.ordax_network_communities c on c.community_id = m.community_id
  where m.space_id = p_space_id
    and m.state <> 'left'
  order by c.title, m.community_id
  limit p_limit;
end;
$network$;

revoke all on function private.ordax_network_list_my_memberships_internal_v1(uuid, integer)
from public, anon;
grant execute on function private.ordax_network_list_my_memberships_internal_v1(uuid, integer)
to authenticated;

create or replace function public.ordax_network_list_my_memberships_v1(
  p_space_id uuid,
  p_limit integer default 100
)
returns table(
  community_id text,
  community_title text,
  role text,
  state text,
  joined_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.ordax_network_list_my_memberships_internal_v1(p_space_id, p_limit);
$$;

revoke all on function public.ordax_network_list_my_memberships_v1(uuid, integer)
from public, anon;
grant execute on function public.ordax_network_list_my_memberships_v1(uuid, integer)
to authenticated;

insert into public.ordax_network_communities(
  community_id, title, kind, jurisdiction, state, join_policy
) values (
  'industry.food.pizzeria.br',
  'Pizzarias Brasil',
  'professional-industry',
  'BR',
  'active',
  'explicit-consent'
)
on conflict (community_id) do nothing;

commit;
