#!/usr/bin/env python3
"""Regression guards for backend-only RLS hardening."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DEV = (
    ROOT
    / "infra"
    / "supabase"
    / "development"
    / "migrations"
    / "20261001124500_backend_only_oidc_enrollment_rls_v1.sql"
)
PRODUCT = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261001124600_backend_only_memory_proof_audit_rls_v1.sql"
)
OIDC_ORIGIN = (
    ROOT
    / "infra"
    / "supabase"
    / "development"
    / "migrations"
    / "20260925194500_github_oidc_device_enrollment_v1.sql"
)
MEMORY_ORIGIN = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20260929195000_cloud_memory_proof_entitlement_operator_v1.sql"
)


class BackendOnlyRlsHardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dev = DEV.read_text(encoding="utf-8").lower()
        cls.product = PRODUCT.read_text(encoding="utf-8").lower()
        cls.oidc_origin = OIDC_ORIGIN.read_text(encoding="utf-8").lower()
        cls.memory_origin = MEMORY_ORIGIN.read_text(encoding="utf-8").lower()

    def test_oidc_receipts_enable_rls_without_client_policy(self):
        self.assertIn(
            "alter table public.ordax_development_oidc_enrollments",
            self.dev,
        )
        self.assertIn("enable row level security", self.dev)
        self.assertNotIn("create policy", self.dev)
        self.assertNotIn("disable row level security", self.dev)

    def test_memory_audit_enables_rls_without_client_or_service_role_policy(self):
        self.assertIn(
            "alter table private.ordax_cloud_memory_proof_entitlement_events",
            self.product,
        )
        self.assertIn("enable row level security", self.product)
        self.assertNotIn("create policy", self.product)
        self.assertNotIn("grant ", self.product)
        self.assertNotIn("disable row level security", self.product)

    def test_oidc_supported_path_remains_service_role_only_security_definer_rpc(self):
        self.assertIn(
            "create or replace function public.ordax_enroll_github_runner_device_v1",
            self.oidc_origin,
        )
        self.assertIn("security definer", self.oidc_origin)
        self.assertIn(
            "grant execute on function public.ordax_enroll_github_runner_device_v1",
            self.oidc_origin,
        )
        self.assertIn("to service_role", self.oidc_origin)
        self.assertIn(
            "from public, anon, authenticated",
            self.oidc_origin,
        )

    def test_memory_supported_path_remains_operator_only_security_definer(self):
        for function_name in (
            "private.ordax_issue_cloud_memory_proof_entitlement_v1",
            "private.ordax_revoke_cloud_memory_proof_entitlement_v1",
        ):
            section = self.memory_origin.split(
                f"create function {function_name}",
                1,
            )[1].split("$$;", 1)[0]
            self.assertIn("security definer", section)

        self.assertIn(
            "from public, anon, authenticated, service_role",
            self.memory_origin,
        )
        self.assertNotIn(
            "grant execute on function private.ordax_issue",
            self.memory_origin,
        )
        self.assertNotIn(
            "grant execute on function private.ordax_revoke",
            self.memory_origin,
        )

    def test_hardening_comments_explain_no_policy_by_design(self):
        self.assertIn("rls is enabled with no client policy", self.dev)
        self.assertIn(
            "rls is enabled with no client/service-role policy",
            self.product,
        )


if __name__ == "__main__":
    unittest.main()
