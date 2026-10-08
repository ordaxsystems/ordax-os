import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "infra" / "supabase" / "product" / "migrations"
SEAL = MIGRATIONS / "20261005034500_private_api_seal_v1.sql"
API_ROLES = ("public", "anon", "authenticated", "service_role")
SEALED_EXECUTOR_ROLES = (
    "ordax_sync_executor",
    "ordax_network_executor",
    "ordax_memory_executor",
)
KNOWN_EXECUTOR_ROLES = SEALED_EXECUTOR_ROLES + (
    "ordax_account_close_executor",
    "ordax_account_export_executor",
)
GUARD_FUNCTION = "ordax_enforce_private_function_acl"
GUARD_TRIGGER = "ordax_private_function_acl_seal"


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


def private_function_creations(sql: str):
    cleaned = strip_sql_comments(sql)
    return re.findall(
        r"\bcreate\s+(?:or\s+replace\s+)?function\s+private\.([a-z_][a-z0-9_]*)\s*\(",
        cleaned,
        flags=re.IGNORECASE,
    )


def has_explicit_api_revoke(sql: str, function_name: str) -> bool:
    pattern = re.compile(
        rf"\brevoke\s+(?:all(?:\s+privileges)?|execute)\s+on\s+function\s+"
        rf"private\.{re.escape(function_name)}\s*\([^;]*\)\s+from\s+(?P<roles>[^;]+);",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(strip_sql_comments(sql)):
        roles = match.group("roles").lower()
        if all(re.search(rf"\b{re.escape(role)}\b", roles) for role in API_ROLES):
            return True
    return False


def is_rls_policy_statement(statement: str) -> bool:
    normalized = " ".join(statement.lower().split())
    return re.match(r"^(?:create|alter)\s+policy\b", normalized) is not None


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
        self.assertIn("private function acl guard already exists", self.sql)
        for role in SEALED_EXECUTOR_ROLES:
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

    def test_private_function_ddl_guard_enforces_future_zero_execute(self):
        self.assertIn(
            "create function private.ordax_enforce_private_function_acl()",
            self.sql,
        )
        self.assertIn("returns event_trigger", self.sql)
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = 'pg_catalog'", self.sql)
        self.assertIn("pg_event_trigger_ddl_commands()", self.sql)
        self.assertIn("command_tag = 'create function'", self.sql)
        self.assertIn("schema_name = 'private'", self.sql)
        self.assertIn("object_type = 'function'", self.sql)
        self.assertIn(
            "revoke all on function %s from public, anon, authenticated, service_role",
            self.sql,
        )
        self.assertIn(
            "create event trigger ordax_private_function_acl_seal",
            self.sql,
        )
        self.assertIn("on ddl_command_end", self.sql)
        self.assertIn("when tag in ('create function')", self.sql)
        self.assertIn(
            "execute function private.ordax_enforce_private_function_acl();",
            self.sql,
        )
        self.assertIn("private function acl guard contract drifted", self.sql)
        self.assertIn("private function acl event guard missing", self.sql)
        self.assertIn(
            "create function private.ordax_private_function_acl_seal_probe()",
            self.sql,
        )
        self.assertIn("private function acl runtime probe failed", self.sql)
        self.assertIn(
            "drop function private.ordax_private_function_acl_seal_probe();",
            self.sql,
        )

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

    def test_future_private_functions_require_explicit_api_revoke(self):
        violations = []
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name <= SEAL.name:
                continue
            sql = path.read_text(encoding="utf-8")
            for function_name in private_function_creations(sql):
                if not has_explicit_api_revoke(sql, function_name):
                    violations.append((path.name, function_name))
        self.assertEqual(
            [],
            violations,
            f"future private function lacks explicit API-role EXECUTE revoke: {violations}",
        )

    def test_future_migrations_cannot_disable_private_function_guard(self):
        violations = []
        forbidden = (
            rf"\bdrop\s+event\s+trigger\s+(?:if\s+exists\s+)?{GUARD_TRIGGER}\b",
            rf"\balter\s+event\s+trigger\s+{GUARD_TRIGGER}\s+disable\b",
            rf"\bdrop\s+function\s+(?:if\s+exists\s+)?private\.{GUARD_FUNCTION}\b",
        )
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name <= SEAL.name:
                continue
            cleaned = strip_sql_comments(path.read_text(encoding="utf-8"))
            for pattern in forbidden:
                if re.search(pattern, cleaned, flags=re.IGNORECASE):
                    violations.append((path.name, pattern))
        self.assertEqual([], violations, f"future migration disables private function ACL guard: {violations}")

    def test_future_executor_roles_are_explicitly_catalogued(self):
        discovered = set()
        role_pattern = re.compile(r"\bordax_[a-z0-9_]+_executor\b", re.IGNORECASE)
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name <= SEAL.name:
                continue
            discovered.update(
                role.lower()
                for role in role_pattern.findall(strip_sql_comments(path.read_text(encoding="utf-8")))
            )

        unexpected = sorted(discovered.difference(KNOWN_EXECUTOR_ROLES))
        self.assertEqual(
            [],
            unexpected,
            f"future migration introduces uncatalogued executor role: {unexpected}",
        )

    def test_future_migrations_cannot_make_api_roles_executor_members(self):
        violations = []
        known_roles = "|".join(re.escape(role) for role in KNOWN_EXECUTOR_ROLES)
        membership = re.compile(
            rf"^grant\s+({known_roles})\s+to\s+(.+)$",
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

    def test_rls_policy_detector_does_not_confuse_policy_schema_functions(self):
        self.assertTrue(
            is_rls_policy_statement(
                "create policy example on public.items using (not ordax_policy.example())"
            )
        )
        self.assertTrue(
            is_rls_policy_statement(
                "alter policy example on public.items using (ordax_policy.example())"
            )
        )
        self.assertFalse(
            is_rls_policy_statement(
                "create function ordax_policy.example() returns boolean as $$ select exists (select 1 from private.items) $$"
            )
        )

    def test_future_rls_guard_checks_predicates_not_private_table_targets(self):
        table_policy = (
            "create policy own on private.ordax_sync_objects for select "
            "using (owner_user_id = auth.uid())"
        )
        indirect_call = (
            "create policy unsafe on private.ordax_sync_objects for select "
            "using (private.unsafe_check())"
        )
        pattern = re.compile(r"\b(?:using|with\s+check)\s*\(")
        self.assertNotIn("private.", table_policy[pattern.search(table_policy).start():])
        self.assertIn("private.", indirect_call[pattern.search(indirect_call).start():])

    def test_future_rls_migrations_cannot_call_private_schema(self):
        violations = []
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name <= SEAL.name:
                continue
            for statement in split_statements(path.read_text(encoding="utf-8")):
                normalized = " ".join(statement.lower().split())
                if not is_rls_policy_statement(statement):
                    continue
                # "ON private.table" declares the policy's own target;
                # only USING/WITH CHECK expressions can smuggle private
                # function calls into a policy's evaluation context.
                predicate = re.search(
                    r"\b(?:using|with\s+check)\s*\(", normalized
                )
                if predicate and "private." in normalized[predicate.start():]:
                    violations.append((path.name, normalized[:240]))
        self.assertEqual([], violations, f"future RLS policy references private schema: {violations}")


if __name__ == "__main__":
    unittest.main()
