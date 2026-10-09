-- Bind every user-cloud upload reservation to exactly one quota reservation.
--
-- The upload reservation cannot infer quota identity from subject/size/key: it must
-- retain the exact server-authoritative quota reservation that authorized growth.
-- This keeps reserve/finalize/cancel idempotent and prevents duplicate accounting.

begin;

alter table private.ordax_user_upload_reservations
  add column quota_reservation_id uuid;

alter table private.ordax_user_upload_reservations
  add constraint ordax_user_upload_reservations_quota_reservation_id_key
  unique (quota_reservation_id);

alter table private.ordax_user_upload_reservations
  add constraint ordax_user_upload_reservations_quota_reservation_id_fkey
  foreign key (quota_reservation_id)
  references private.ordax_service_quota_reservations(reservation_id)
  on delete restrict;

alter table private.ordax_user_upload_reservations
  alter column quota_reservation_id set not null;

comment on column private.ordax_user_upload_reservations.quota_reservation_id is
  'Exact server-authoritative quota reservation backing this upload reservation. Unique and retained until storage reservation cleanup is complete.';

commit;
