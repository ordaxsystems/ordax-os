#!/usr/bin/env bash
set -euo pipefail

subject_id='22222222-2222-4222-8222-222222222222'
quota_key='storage.user.bytes'

psql -X -v ON_ERROR_STOP=1 -q <<SQL
insert into public.ordax_entitlement_grants(
  user_id,
  entitlement_key,
  entitlement_value
) values (
  '${subject_id}',
  '${quota_key}',
  '{"decision":"allowed","type":"quota","unit":"bytes","limit":100}'::jsonb
);
SQL

reserve() {
  local idempotency_key="$1"
  psql -X -v ON_ERROR_STOP=1 -qAt <<SQL
select
  can_allocate::text || '|' || quota_state || '|' || reserved_units::text
from private.ordax_reserve_service_quota_v1(
  '${subject_id}',
  null,
  '${quota_key}',
  'bytes',
  60,
  '${idempotency_key}',
  600
);
SQL
}

result_a="$(mktemp)"
result_b="$(mktemp)"
trap 'rm -f "$result_a" "$result_b"' EXIT

reserve 'concurrent-request-a' >"$result_a" &
pid_a=$!
reserve 'concurrent-request-b' >"$result_b" &
pid_b=$!

wait "$pid_a"
wait "$pid_b"

mapfile -t results < <(cat "$result_a" "$result_b" | sort)
if [[ ${#results[@]} -ne 2 ]]; then
  printf 'expected two quota results, got %s\n' "${#results[@]}" >&2
  exit 1
fi
if [[ "${results[0]}" != 'false|quota-exceeded|60' ]]; then
  printf 'unexpected denied concurrent reservation: %s\n' "${results[0]}" >&2
  exit 1
fi
if [[ "${results[1]}" != 'true|within-quota|60' ]]; then
  printf 'unexpected accepted concurrent reservation: %s\n' "${results[1]}" >&2
  exit 1
fi

status="$(psql -X -v ON_ERROR_STOP=1 -qAt <<SQL
select used_units::text || '|' || reserved_units::text || '|' || active_reservations::text
from public.ordax_service_quota_usage_status_v1(
  '${subject_id}',
  null,
  '${quota_key}'
);
SQL
)"

if [[ "$status" != '0|60|1' ]]; then
  printf 'unexpected concurrent ledger status: %s\n' "$status" >&2
  exit 1
fi
