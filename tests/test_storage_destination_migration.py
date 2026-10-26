"""Fail-closed migration renderer: historical SQL remains the SSOT."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "infra/supabase/product/render_storage_quota_destination_migration.py"
spec = importlib.util.spec_from_file_location("destination_storage_migration", TARGET)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DestinationStorageQuotaMigrationTests(unittest.TestCase):
    PROJECT = "jhfphsjptrpmtnzkpwud"

    def test_versioned_migration_is_exactly_the_canonical_render_not_an_independent_sql_owner(self):
        migration = module.MIGRATIONS / "20261026222222_storage_quota_populated_destination_v1.sql"
        saved = migration.read_bytes()
        compiled = module.render(project_ref=self.PROJECT, commit=True).encode("utf-8")
        self.assertEqual(saved, compiled, "Versioned SQL drifted from five source migrations or canonical RLS adaptation")
        self.assertEqual(len(saved.split(b"-- SOURCE ")), 6)
        self.assertTrue(saved.endswith(b"COMMIT;\\n"))
        self.assertIn(b"storage-destination-partial-or-previous-install", saved)
        self.assertNotIn(b"ordax_policy.can_access_space", saved)
        self.assertNotIn(b"ROLLBACK;\\n", saved)

    def test_preview_is_transactional_and_rolls_back_by_default(self):
        output = module.render(project_ref=self.PROJECT)
        self.assertIn("BEGIN;\nSET LOCAL lock_timeout='5s';", output)
        self.assertTrue(output.endswith("ROLLBACK;\n"))
        self.assertEqual(output.count("BEGIN;"), 1)
        self.assertEqual(output.count("COMMIT;"), 0)
        self.assertIn("storage-destination-populated-user-guard-failed", output)
        self.assertIn("storage-destination-partial-or-previous-install", output)
        self.assertIn("storage-destination-rls-or-table-missing", output)
        self.assertIn("storage-destination-quota-reservation-link-missing", output)
        self.assertEqual(output.count("-- SOURCE "), 5)
        for name in module.SOURCES:
            self.assertEqual(output.count("-- SOURCE " + name), 1)
        self.assertNotIn("ordax_policy.can_access_space", output)
        self.assertIn("(select private.ordax_authenticated_subject_eligible_v1())", output)
        self.assertIn("private.ordax_can_access_space(space_id)", output)
        self.assertIn("references private.ordax_service_quota_reservations", output)
        self.assertNotIn("\\ir ", output)

    def test_commit_output_requires_an_explicit_verified_project_argument(self):
        self.assertEqual(
            module.main(["--project-ref", self.PROJECT, "--emit-commit-sql"]),
            1,
        )
        self.assertIn(
            "COMMIT;\n",
            module.render(project_ref=self.PROJECT, commit=True),
        )
        self.assertEqual(module.render(project_ref=self.PROJECT, commit=True).count("COMMIT;"), 1)

    def test_wrong_or_activated_provider_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "owner-or-activation"):
            module.render(project_ref="a" * 20)
        owner = json.loads(module.AUTH.read_text(encoding="utf-8"))
        owner["postgresql_destination"]["public_registration_enabled"] = True
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "public-auth-hardening.json"
            copy.write_text(json.dumps(owner), encoding="utf-8")
            with patch.object(module, "AUTH", copy):
                with self.assertRaisesRegex(ValueError, "owner-or-activation"):
                    module.render(project_ref=self.PROJECT)

    def test_no_replay_if_destination_is_already_recorded_installed(self):
        for contract_attr, section, field in (
            ("STORAGE", "deployment", "transactional_schema_deployed"),
            ("QUOTA", "server_ledger", "production_applied"),
        ):
            owner = json.loads(getattr(module, contract_attr).read_text(encoding="utf-8"))
            owner[section][field] = True
            with tempfile.TemporaryDirectory() as tmp:
                copy = Path(tmp) / (contract_attr + ".json")
                copy.write_text(json.dumps(owner), encoding="utf-8")
                with patch.object(module, contract_attr, copy):
                    with self.assertRaisesRegex(ValueError, "owner-or-activation"):
                        module.render(project_ref=self.PROJECT)

    def test_fail_closed_on_unreviewed_legacy_rls_source_change(self):
        sources = list(module.SOURCES)
        name = "20261005171000_user_cloud_storage_foundation_v2.sql"
        source = (module.MIGRATIONS / name).read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp)
            for item in sources:
                (dst / item).write_text(
                    source.replace(module.LEGACY_POLICY, "using (true);")
                    if item == name else
                    (module.MIGRATIONS / item).read_text(encoding="utf-8"),
                    encoding="utf-8",
                )
            with patch.object(module, "MIGRATIONS", dst):
                with self.assertRaisesRegex(ValueError, "rls-policy-source-drift"):
                    module.render(project_ref=self.PROJECT)

    def test_generated_bundle_is_bounded_to_existing_destination(self):
        output = module.render(project_ref=self.PROJECT, commit=True)
        self.assertIn("IF NOT EXISTS(SELECT 1 FROM auth.users)", output)
        self.assertIn("to_regprocedure('private.ordax_authenticated_subject_eligible_v1()')", output)
        self.assertIn("to_regprocedure('private.ordax_can_access_space(uuid)')", output)
        self.assertIn("to_regclass('public.ordax_entitlement_grants')", output)
        self.assertIn("to_regnamespace('ordax_policy') IS NOT NULL", output)
        self.assertIn("has_table_privilege('anon',target_table,'SELECT')", output)
        self.assertIn("has_table_privilege('service_role',target_table,'INSERT')", output)
        self.assertIn("storage-destination-private-quota-helper-exposed", output)


if __name__ == "__main__":
    unittest.main()
