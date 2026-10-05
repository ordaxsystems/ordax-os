import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "infra" / "supabase" / "product" / "migrations"
SEAL = MIGRATIONS / "20261005034500_private_api_seal_v1.sql"
API_ROLES = ("public", "anon", "authenticated", "service_role")
EXECUTOR_ROLES = (
    "ordax_sync_executor",
    "ordax_network_executor",
    "ordax_memory_executor",
)


def strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", "", sql)


def split_statements(sql: str):
    return [statement.strip() for statement in strip_sql_comments(sql).split(";") if statement.strip()]


def targets_api_role(statement: str) -> bool:
    match = re.search(r"\bto\s+(.+)$", statement, re.IGNORECASE | re.DOTALL)
    if not match:
        return False
    target = match.group(1).lower()
    return any(re.search(rf"\b{re.escape(role)}\b", target) for role in API_ROLES)


class PrivateApiSealTests(unittest.TestCase):
    def setUp(self):
        self.sql = SEAL.read_text(encoding="utf-8").lower()

    def test_seal_requires_all_preceding_boundaries(self):
        self.assertIn("public rls still references private schema", self.sql)
        self.assertIn("unexpected pre-seal schema acl", self.sql)
        self.assertIn("api role still executes private function", self.sql)
        self.assertIn("api role still has private relation authority", self.sql)
        self.assertIn("api role still has private sequence authority", self.sql)
        self.assertIn("authenticated policy boundary missing", self.sql)
        self.assertIn("dedicated executor role missing", self.sql)
        self.assertIn("executor role contract drifted", self.sql)
        self.assertIn("executor private usage missing", self.sql)
        for role in EXECUTOR_ROLES:
            self.assertIn(role, self.sql)
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

    def test_current_private_surface_is_sealed_from_api_roles(self):
        self.assertIn(
            "revoke all on schema private from public, anon, authenticated, service_role;",
            self.sql,
        )
        self.assertIn(
            "revoke all privileges on all functions in schema private\n  from public, anon, authenticated, service_role;",
            self.sql,
        )
        self.assertIn(
            "revoke all privileges on all tables in schema private\n  from public, anon, authenticated, service_role;",
            self.sql,
        )
        self.assertIn(
            "revoke all privileges on all sequences in schema private\n  from public, anon, authenticated, service_role;",
            self.sql,
        )

    def test_private_default_privileges_fail_closed_for_future_objects(self):
        self.assertIn(
            "alter default privileges for role postgres in schema private\n  revoke execute on functions from public, anon, authenticated, service_role;",
            self.sql,
        )
        self.assertIn(
            "alter default privileges for role postgres in schema private\n  revoke all privileges on tables from public, anon, authenticated, service_role;",
            self.sql,
        )
        self.assertIn(
            "alter default privileges for role postgres in schema private\n  revoke all privileges on sequences from public, anon, authenticated, service_role;",
            self.sql,
        )
        self.assertIn("private function default acl override missing", self.sql)
        self.assertIn("api grant remains in private default acl", self.sql)

    def test_postflight_proves_zero_api_authority_without_breaking_policy_or_executors(self):
        for marker in (
            "schema remains reachable by api role",
            "private function authority reopened",
            "private relation authority reopened",
            "private sequence authority reopened",
            "public rls private reference reopened",
            "policy authorization boundary broken",
            "executor boundary broken",
        ):
            self.assertIn(marker, self.sql)

        for role in ("anon", "authenticated", "service_role"):
            self.assertIn(f"has_schema_privilege('{role}', 'private', 'usage')", self.sql)
        for predicate in (
            "can_access_space",
            "can_admin_space",
            "can_access_project",
            "can_access_product_device",
        ):
            self.assertIn(
                f"has_function_privilege('authenticated', 'ordax_policy.{predicate}(uuid)', 'execute')",
                self.sql,
            )

    def test_future_migrations_cannot_regrant_private_authority_to_api_roles(self):
        violations = []
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name <= SEAL.name:
                continue
            for statement in split_statements(path.read_text(encoding="utf-8")):
                normalized = " ".join(statement.lower().split())
                if not normalized.startswith("grant ") and " grant " not in normalized:
                    continue
                touches_private = (
                    "private." in normalized
                    or "schema private" in normalized
                    or "in schema private" in normalized
                )
                if touches_private and targets_api_role(statement):
                    violations.append((path.name, normalized[:240]))

        self.assertEqual([], violations, f"future migration reopens private API authority: {violations}")

    def test_future_migrations_cannot_make_api_roles_executor_members(self):
        violations = []
        membership = re.compile(
            r"^grant\s+(ordax_(?:sync|network|memory)_executor)\s+to\s+(.+)$",
            re.IGNORECASE | re.DOTALL,
        )
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name <= SEAL.name:
                continue
            for statement in split_statements(path.read_text(encoding="utf-8")):
                match = membership.match(statement.strip())
                if match and any(
                    re.search(rf"\b{role}\b", match.group(2), re.IGNORECASE)
                    for role in API_ROLES
                ):
                    violations.append((path.name, " ".join(statement.split())[:240]))

        self.assertEqual([], violations, f"future migration grants executor membership to API role: {violations}")

    def test_future_rls_migrations_cannot_call_private_schema(self):
        violations = []
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name <= SEAL.name:
                continue
            for statement in split_statements(path.read_text(encoding="utf-8")):
                normalized = " ".join(statement.lower().split())
                if "policy" in normalized and "private." in normalized:
                    violations.append((path.name, normalized[:240]))
        self.assertEqual([], violations, f"future RLS policy references private schema: {violations}")


if __name__ == "__main__":
    unittest.main()
