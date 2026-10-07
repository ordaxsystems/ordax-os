-- Defense-in-depth hardening for private user cloud-storage state.
--
-- The original v2 foundation revoked every API/client role from these private
-- tables but did not enable RLS on the tables themselves. Keep the existing
-- server-only ownership model and add RLS as an independent boundary. No
-- client or service_role policies are introduced here.

begin;

alter table private.ordax_user_object_provider_refs enable row level security;
alter table private.ordax_user_upload_reservations enable row level security;

revoke all on table private.ordax_user_object_provider_refs
  from public, anon, authenticated, service_role;
revoke all on table private.ordax_user_upload_reservations
  from public, anon, authenticated, service_role;

comment on table private.ordax_user_object_provider_refs is
  'Server-only provider location for user cloud objects. RLS enabled with no client/service_role policy; reviewed backend owners remain the only mutation path.';
comment on table private.ordax_user_upload_reservations is
  'Server-only bounded upload reservations. RLS enabled with no client/service_role policy; reviewed backend owners remain the only mutation path.';

commit;
