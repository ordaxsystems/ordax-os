import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261005031500_policy_predicate_boundary_v1.sql"

POLICIES = (
    "ordax_device_presence_select_authorized",
    "ordax_device_project_bindings_select_project",
    "ordax_entitlement_grants_select_subject",
    "ordax_memory_embeddings_select_authorized",
    "ordax_memory_items_insert_own",
    "ordax_memory_items_select_authorized",
    "ordax_memory_items_update_own",
    "ordax_product_devices_select_authorized",
    "ordax_project_connections_select_space",
    "ordax_projects_select_space",
    "ordax_remote_capability_grants_select_admin",
    "ordax_space_devices_select_space",
    "ordax_space_members_delete_admin",
    "ordax_space_members_insert_admin",
    "ordax_space_members_select_space",
    "ordax_space_members_update_admin",
    "ordax_space_profile_packs_select_member",
    "ordax_spaces_select_member",
    "ordax_spaces_update_admin",
)
PREDICATES = (
    "can_access_space",
    "can_admin_space",
    "can_access_project",
    "can_access_product_device",
)
DIRECT_SUBJECT_PREDICATES = (
    "can_access_space",
    "can_admin_space",
    "can_access_product_device",
)


class PolicyPredicateBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def predicate_body(self, name: str) -> str:
        pattern = rf"create function ordax_policy\.{name}\([^)]*\)(?P<body>.*?)\$function\$;"
        match = re.search(pattern, self.sql, re.DOTALL)
        self.assertIsNotNone(match, name)
        return match.group("body")

    def test_preflight_locks_exact_live_private_predicate_caller_set(self):
        self.assertIn("private predicate caller set drifted", self.sql)
        self.assertIn("ordax_policy schema already exists", self.sql)
        self.assertIn("array_agg", self.sql)
        for policy in POLICIES:
            self.assertIn(policy, self.sql, policy)
        self.assertEqual(len(POLICIES), 19)

    def test_policy_schema_is_forward_only_narrow_and_not_public(self):
        self.assertIn("create schema ordax_policy;", self.sql)
        self.assertNotIn("create schema if not exists ordax_policy", self.sql)
        self.assertIn(
            "revoke all on schema ordax_policy from public, anon, authenticated, service_role;",
            self.sql,
        )
        self.assertIn("grant usage on schema ordax_policy to authenticated;", self.sql)
        self.assertNotIn("grant create on schema ordax_policy", self.sql)

    def test_predicates_are_fresh_stable_definers_with_empty_search_path(self):
        self.assertNotIn("create or replace function ordax_policy", self.sql)
        for name in PREDICATES:
            body = self.predicate_body(name)
            self.assertIn("stable", body, name)
            self.assertIn("security definer", body, name)
            self.assertIn("set search_path = ''", body, name)
            self.assertNotRegex(body, r"target_user|p_user|user_id\s+uuid", name)
            self.assertNotIn("execute ", body, name)

    def test_subject_binding_is_direct_or_transitively_delegated(self):
        for name in DIRECT_SUBJECT_PREDICATES:
            body = self.predicate_body(name)
            self.assertIn("auth.uid()", body, name)

        project_body = self.predicate_body("can_access_project")
        self.assertIn("ordax_policy.can_access_space(p.space_id)", project_body)
        self.assertNotRegex(project_body, r"target_user|p_user|user_id\s+uuid")

    def test_predicate_execute_is_explicitly_authenticated_only(self):
        for name in PREDICATES:
            self.assertRegex(
                self.sql,
                rf"revoke\s+all\s+on\s+function\s+ordax_policy\.{name}\(uuid\)\s+"
                r"from\s+public,\s*anon,\s*authenticated,\s*service_role\s*;",
            )
            self.assertIn(
                f"grant execute on function ordax_policy.{name}(uuid) to authenticated;",
                self.sql,
            )
            self.assertNotRegex(
                self.sql,
                rf"grant\s+execute\s+on\s+function\s+ordax_policy\.{name}\(uuid\)\s+to[^;]*service_role",
            )

    def test_all_existing_private_rls_callers_are_rewired(self):
        for policy in POLICIES:
            self.assertIn(f"alter policy {policy}", self.sql, policy)
        rewiring = self.sql[
            self.sql.index("alter policy ordax_device_presence_select_authorized") :
            self.sql.index("-- rls no longer needs these implementation-schema entrypoints")
        ]
        self.assertNotIn("private.ordax_can_access_", rewiring)
        self.assertNotIn("private.ordax_can_admin_", rewiring)

    def test_old_private_predicates_are_removed_from_all_api_roles(self):
        for name in (
            "ordax_can_access_space",
            "ordax_can_admin_space",
            "ordax_can_access_project",
            "ordax_can_access_product_device",
        ):
            self.assertRegex(
                self.sql,
                rf"revoke\s+all\s+on\s+function\s+private\.{name}\(uuid\)\s+"
                r"from\s+public,\s*anon,\s*authenticated,\s*service_role\s*;",
            )

    def test_no_policy_predicate_mutation_surface_is_created(self):
        dml = re.compile(r"\b(insert|update|delete|truncate)\b")
        for name in PREDICATES:
            body = self.predicate_body(name)
            self.assertNotRegex(body, dml, name)

    def test_postflight_requires_zero_private_rls_refs_and_exact_surface(self):
        self.assertIn("private predicate reference remains in rls", self.sql)
        self.assertIn("schema acl widened", self.sql)
        self.assertIn("unexpected function count", self.sql)
        self.assertIn("unexpected function present", self.sql)
        self.assertIn("function acl mismatch", self.sql)
        self.assertIn("policy_function_count <> 4", self.sql)
        self.assertIn("aclexplode", self.sql)
        self.assertIn("a.grantee = 0", self.sql)
        self.assertIn("public_schema_privilege_count <> 0", self.sql)
        self.assertNotIn("has_schema_privilege('public'", self.sql)
        self.assertIn("has_schema_privilege('service_role', 'ordax_policy', 'usage')", self.sql)
        for name in PREDICATES:
            self.assertIn(
                f"has_function_privilege('authenticated', 'ordax_policy.{name}(uuid)', 'execute')",
                self.sql,
            )
            self.assertIn(
                f"has_function_privilege('service_role', 'ordax_policy.{name}(uuid)', 'execute')",
                self.sql,
            )


if __name__ == "__main__":
    unittest.main()
