from __future__ import annotations

import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261007152010_space_subject_access_ssot_v1.sql"
)
WORKFLOW = ROOT / ".github" / "workflows" / "account-memory-sync-foundation.yml"
POSTGRES_PROOF = ROOT / "tests" / "sql" / "test_space_subject_access_ssot_v1.sql"


class SpaceSubjectAccessSsotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()
        cls.workflow = WORKFLOW.read_text(encoding="utf-8").lower()
        cls.postgres_proof = POSTGRES_PROOF.read_text(encoding="utf-8").lower()

    def function_body(self, signature: str) -> str:
        tail = self.sql.split(signature, 1)[1]
        return tail.split("$function$;", 1)[0]

    def test_subject_helper_is_the_only_owner_member_rule(self) -> None:
        helper = self.function_body(
            "create function private.ordax_subject_can_access_space_v1("
        )
        self.assertIn("from public.ordax_spaces s", helper)
        self.assertIn("s.owner_user_id = target_user_id", helper)
        self.assertIn("from public.ordax_space_members m", helper)
        self.assertIn("m.user_id = target_user_id", helper)
        self.assertIn("m.state = 'active'", helper)
        self.assertNotRegex(helper, r"m\.role\s+in\s*\(")
        self.assertIn("target_user_id is not null", helper)
        self.assertIn("target_space_id is not null", helper)

    def test_helper_is_pinned_security_definer_and_private_to_api_roles(self) -> None:
        helper = self.function_body(
            "create function private.ordax_subject_can_access_space_v1("
        )
        self.assertIn("stable", helper)
        self.assertIn("security definer", helper)
        self.assertIn("set search_path = ''", helper)
        self.assertRegex(
            self.sql,
            re.compile(
                r"revoke\s+all\s+on\s+function\s+"
                r"private\.ordax_subject_can_access_space_v1\(uuid,\s*uuid\)\s+"
                r"from\s+public,\s*anon,\s*authenticated,\s*service_role"
            ),
        )
        self.assertNotRegex(
            self.sql,
            r"grant\s+execute\s+on\s+function\s+private\.ordax_subject_can_access_space_v1",
        )

    def test_existing_wrappers_delegate_without_reimplementing_authorization(self) -> None:
        private_wrapper = self.function_body(
            "create or replace function private.ordax_can_access_space(target_space_id uuid)"
        )
        policy_wrapper = self.function_body(
            "create or replace function ordax_policy.can_access_space(target_space_id uuid)"
        )
        for body in (private_wrapper, policy_wrapper):
            self.assertIn("private.ordax_subject_can_access_space_v1", body)
            self.assertIn("auth.uid()", body)
            self.assertNotIn("public.ordax_spaces", body)
            self.assertNotIn("public.ordax_space_members", body)

    def test_policy_wrapper_keeps_authenticated_only_execute(self) -> None:
        self.assertRegex(
            self.sql,
            re.compile(
                r"revoke\s+all\s+on\s+function\s+ordax_policy\.can_access_space\(uuid\)\s+"
                r"from\s+public,\s*anon,\s*authenticated,\s*service_role"
            ),
        )
        self.assertIn(
            "grant execute on function ordax_policy.can_access_space(uuid) to authenticated;",
            self.sql,
        )
        self.assertNotRegex(
            self.sql,
            r"grant\s+execute\s+on\s+function\s+ordax_policy\.can_access_space\(uuid\)\s+to\s+(anon|service_role)",
        )

    def test_migration_fails_closed_on_preexisting_or_drifted_boundary(self) -> None:
        self.assertIn("helper already exists", self.sql)
        self.assertIn("wrapper security contract drifted", self.sql)
        self.assertIn("private access semantics drifted", self.sql)
        self.assertIn("policy access semantics drifted", self.sql)
        self.assertIn("subject helper leaked to api role", self.sql)
        self.assertIn("private wrapper did not converge", self.sql)
        self.assertIn("policy wrapper did not converge", self.sql)

    def test_existing_postgres_gate_executes_behavioral_proof(self) -> None:
        self.assertIn("image: postgres:16", self.workflow)
        self.assertIn("tests/sql/test_space_subject_access_ssot_v1.sql", self.workflow)
        self.assertIn(
            "psql -v on_error_stop=1 -f tests/sql/test_space_subject_access_ssot_v1.sql",
            self.workflow,
        )
        self.assertIn(
            "\\ir ../../infra/supabase/product/migrations/20261007152010_space_subject_access_ssot_v1.sql",
            self.postgres_proof,
        )
        self.assertIn("'active'", self.postgres_proof)
        self.assertIn("'suspended'", self.postgres_proof)
        self.assertIn("set role authenticated;", self.postgres_proof)
        self.assertIn("space-subject-access-ssot-v1-ok", self.postgres_proof)


if __name__ == "__main__":
    unittest.main()
