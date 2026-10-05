import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261005033000_private_domain_executors_v1.sql"

ROLES = ("ordax_network_executor", "ordax_memory_executor")


class PrivateDomainExecutorsTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def role_create_body(self, role: str) -> str:
        match = re.search(rf"create role {role}(?P<body>[^;]+);", self.sql, re.DOTALL)
        self.assertIsNotNone(match, role)
        return match.group("body")

    def test_domain_roles_use_hosted_safe_least_privilege_creation(self):
        for role in ROLES:
            body = self.role_create_body(role)
            for token in (
                "nosuperuser",
                "nocreatedb",
                "nocreaterole",
                "noinherit",
                "nologin",
                "noreplication",
                "nobypassrls",
            ):
                self.assertIn(token, body, f"{role}: {token}")
            self.assertIn(
                f"{role} violates least-privilege role contract",
                self.sql,
            )
        self.assertNotIn("alter role ordax_network_executor", self.sql)
        self.assertNotIn("alter role ordax_memory_executor", self.sql)
        for attribute in (
            "rolsuper",
            "rolcreatedb",
            "rolcreaterole",
            "rolinherit",
            "rolcanlogin",
            "rolreplication",
            "rolbypassrls",
        ):
            self.assertIn(attribute, self.sql)

    def test_executor_membership_is_fail_closed(self):
        self.assertIn("unexpected executor member", self.sql)
        self.assertIn("executor belongs to another role", self.sql)
        self.assertIn("pg_auth_members", self.sql)
        self.assertIn("member_role.rolname <> 'postgres'", self.sql)

    def test_preflight_requires_real_pinned_boundaries(self):
        self.assertIn("network boundary missing", self.sql)
        self.assertIn("memory boundary missing", self.sql)
        self.assertIn("unsafe public wrapper search_path", self.sql)
        self.assertIn("unsafe private helper contract", self.sql)
        self.assertIn("not p.prosecdef", self.sql)
        self.assertIn("search_path=\"\"", self.sql)

    def test_private_helpers_are_removed_from_all_api_roles(self):
        self.assertIn(
            "from public, anon, authenticated, service_role, ordax_network_executor, ordax_memory_executor",
            self.sql,
        )
        self.assertIn(
            "api role still executes private domain helper",
            self.sql,
        )
        for role in ("authenticated", "service_role", "anon"):
            self.assertIn(f"has_function_privilege('{role}'", self.sql)

    def test_public_wrappers_are_repinned_domain_owned_definers(self):
        self.assertIn("alter function %i.%i(%s) security definer", self.sql)
        self.assertIn("alter function %i.%i(%s) set search_path = %l", self.sql)
        self.assertIn("owner to ordax_network_executor", self.sql)
        self.assertIn("owner to ordax_memory_executor", self.sql)
        self.assertIn("to authenticated, service_role", self.sql)
        self.assertIn("set search_path = '';", self.sql)

    def test_create_is_temporary_and_relation_authority_is_rejected(self):
        grant = self.sql.index(
            "grant create on schema public to ordax_network_executor, ordax_memory_executor;"
        )
        revoke = self.sql.index(
            "revoke create on schema public from ordax_network_executor, ordax_memory_executor;"
        )
        self.assertLess(grant, revoke)
        self.assertIn("direct table grant detected", self.sql)
        self.assertIn("direct sequence grant detected", self.sql)
        self.assertIn("executor owns relation", self.sql)
        self.assertIn("create privilege leaked", self.sql)
        self.assertNotRegex(
            self.sql,
            r"grant\s+(select|insert|update|delete|all)\s+on\s+(table\s+)?[^;]+\s+to\s+ordax_(network|memory)_executor",
        )
        self.assertNotRegex(
            self.sql,
            r"grant\s+(usage|select|update|all)\s+on\s+sequence\s+[^;]+\s+to\s+ordax_(network|memory)_executor",
        )

    def test_effective_private_execute_is_allowlisted(self):
        self.assertIn("network executor can execute unexpected private function", self.sql)
        self.assertIn("memory executor can execute unexpected private function", self.sql)
        self.assertIn("network helper grant missing", self.sql)
        self.assertIn("memory helper grant missing", self.sql)
        self.assertIn(
            "has_function_privilege('ordax_network_executor', p.oid, 'execute')",
            self.sql,
        )
        self.assertIn(
            "has_function_privilege('ordax_memory_executor', p.oid, 'execute')",
            self.sql,
        )

    def test_memory_executor_gets_exact_private_helper_boundary(self):
        helper = "private.ordax_apply_memory_mutation_internal_v1"
        self.assertIn(f"grant execute on function {helper}", self.sql)
        self.assertNotIn("grant all on function", self.sql)


if __name__ == "__main__":
    unittest.main()
