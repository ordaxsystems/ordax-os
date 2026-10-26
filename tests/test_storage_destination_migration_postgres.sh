#!/usr/bin/env bash
set -euo pipefail

# Runs ONLY against a disposable local PostgreSQL CI service.
: "${ORDAX_SYNTHETIC_PG_TEST_ONLY:?Must set ORDAX_SYNTHETIC_PG_TEST_ONLY=1}"
test "${ORDAX_SYNTHETIC_PG_TEST_ONLY}" = 1
test "${PGDATABASE:-}" = "ordax_storage_synthetic"
test "${PGHOST:-}" = "127.0.0.1"
PROJECT_REF="jhfphsjptrpmtnzkpwud"

psql -v ON_ERROR_STOP=1 -f tests/sql/storage_destination_synthetic_fixture.sql > /dev/null
python3 infra/supabase/product/render_storage_quota_destination_migration.py \
  --project-ref "${PROJECT_REF}" > /tmp/ordax-storage-preview.sql
# Preview executes all DDL, checks assertions and ROLLS BACK.
psql -v ON_ERROR_STOP=1 -f /tmp/ordax-storage-preview.sql > /dev/null
psql -Atqc "select case when to_regclass('public.ordax_user_objects') is null and to_regclass('private.ordax_service_quota_usage') is null then 'PASS' else 'FAIL' end" | grep -qx PASS

# Explicit commit artifact can only be generated with a matching confirmation.
if python3 infra/supabase/product/render_storage_quota_destination_migration.py \
  --project-ref "${PROJECT_REF}" --emit-commit-sql > /dev/null 2>&1; then
  echo "Commit artifact generated without explicit confirmation" >&2; exit 1
fi
python3 infra/supabase/product/render_storage_quota_destination_migration.py \
  --project-ref "${PROJECT_REF}" --emit-commit-sql \
  --confirm-destination "${PROJECT_REF}" > /tmp/ordax-storage-commit.sql
psql -v ON_ERROR_STOP=1 -f /tmp/ordax-storage-commit.sql > /dev/null

# All five relations exist with RLS enabled and no direct write authority.
psql -Atqc "
select case when count(*)=5 and bool_and(c.relrowsecurity) then 'PASS' else 'FAIL' end
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where (n.nspname,c.relname) in (
('public','ordax_user_objects'),
('private','ordax_user_object_provider_refs'),
('private','ordax_user_upload_reservations'),
('private','ordax_service_quota_usage'),
('private','ordax_service_quota_reservations')
)" | grep -qx PASS

# Seed one private user object as synthetic postgres owner.
psql -v ON_ERROR_STOP=1 -c "
insert into public.ordax_user_objects(
  object_id,owner_user_id,space_id,display_name,media_type,size_bytes,sha256
) values
('33333333-3333-4333-8333-333333333333',
 '11111111-1111-4111-8111-111111111111',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'ci-object','application/octet-stream',4,repeat('a',64)),
('44444444-4444-4444-8444-444444444444',
 '22222222-2222-4222-8222-222222222222',
 null,'ci-object-b','application/octet-stream',4,repeat('b',64));
" > /dev/null

# Simulate JWT claims in a synthetic database; NO claim here is a production JWT.
psql -v ON_ERROR_STOP=1 <<'SQL' > /dev/null
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
DO $isolation$
BEGIN
 IF (select count(*) from public.ordax_user_objects) <> 1 THEN
   RAISE EXCEPTION 'synthetic-subject-a-cross-account-read';
 END IF;
END;
$isolation$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
DO $isolation$
BEGIN
 IF (select count(*) from public.ordax_user_objects) <> 1 THEN
   RAISE EXCEPTION 'synthetic-subject-b-cross-account-read';
 END IF;
END;
$isolation$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
DO $untrusted$
BEGIN
 IF has_table_privilege('authenticated','public.ordax_user_objects','INSERT')
    OR has_table_privilege('authenticated','private.ordax_user_upload_reservations','SELECT')
 THEN RAISE EXCEPTION 'synthetic-direct-write-or-private-read'; END IF;
END;
$untrusted$;
ROLLBACK;
SQL

# Replaying on installed destination must FAIL before any schema mutation.
if psql -v ON_ERROR_STOP=1 -f /tmp/ordax-storage-commit.sql >/tmp/ordax-storage-replay.log 2>&1; then
  echo "Migration replay unexpectedly succeeded" >&2; exit 1
fi
grep -q "storage-destination-partial-or-previous-install" /tmp/ordax-storage-replay.log
psql -Atqc "select count(*) from public.ordax_user_objects" | grep -qx 2

echo "STORAGE_DESTINATION_SYNTHETIC_PG=PASS"
