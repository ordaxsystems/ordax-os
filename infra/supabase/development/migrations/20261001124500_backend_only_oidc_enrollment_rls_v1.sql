-- Defense-in-depth: backend-only GitHub OIDC enrollment receipts.
-- No client policy is created. The service-role-only SECURITY DEFINER enrollment
-- RPC remains the supported mutation path.

begin;

alter table public.ordax_development_oidc_enrollments
  enable row level security;

comment on table public.ordax_development_oidc_enrollments is
  'Engineering-only one-time GitHub Actions OIDC enrollment receipts. RLS is enabled with no client policy; enrollment remains available only through the reviewed backend RPC authority. No raw OIDC token or device token is stored.';

commit;
