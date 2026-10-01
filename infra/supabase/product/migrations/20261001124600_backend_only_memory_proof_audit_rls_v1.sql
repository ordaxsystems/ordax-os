-- Defense-in-depth: private cloud Memory proof audit events.
-- No client or service-role policy is created. Operator-only SECURITY DEFINER
-- functions remain the supported write path.

begin;

alter table private.ordax_cloud_memory_proof_entitlement_events
  enable row level security;

comment on table private.ordax_cloud_memory_proof_entitlement_events is
  'Operator-only cloud Memory proof entitlement audit. RLS is enabled with no client/service-role policy; writes remain reachable only through reviewed private operator functions.';

commit;
