"""Read-only Storage destination gate: no remote mutations or release assertions."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "infra/supabase/product/verify_storage_destination_preflight.py"
spec = importlib.util.spec_from_file_location("storage_destination_live_catalog", PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class StorageDestinationReadOnlyPreflightTests(unittest.TestCase):
    def observation(self):
        return {
            **{field: True for field in module.REQUIRED_TRUE},
            **{field: False for field in module.REQUIRED_FALSE},
        }

    def test_validates_owner_and_byte_identical_versioned_sql(self):
        ref = module.owner_ref()
        self.assertEqual(ref, "jhfphsjptrpmtnzkpwud")
        self.assertEqual(module.VERSION, "20261026222222")
        digest = module.check_versioned_sql(ref)
        self.assertEqual(len(digest), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in digest))

    def test_sql_is_read_only_and_checks_all_expected_flags(self):
        sql = module.query().lower()
        self.assertTrue(sql.startswith("select json_build_object("))
        self.assertEqual(sql.count("to_regclass("), 7)
        self.assertEqual(sql.count("to_regprocedure("), 7)
        self.assertIn("supabase_migrations.schema_migrations", sql)
        self.assertIn(module.VERSION, sql)
        for value in module.REQUIRED_TRUE + module.REQUIRED_FALSE:
            self.assertIn("'" + value + "'", sql)
        self.assertNotIn("delete from", sql)
        self.assertNotIn("drop table", sql)
        self.assertNotIn("create table", sql)
        self.assertNotIn("grant ", sql)
        self.assertNotIn("update ", sql)

    def test_observation_is_strict_and_detects_partial_or_replay(self):
        valid = self.observation()
        self.assertEqual(module.validate_observation(valid), [])
        for field in module.REQUIRED_TRUE:
            bad = dict(valid, **{field: False})
            self.assertIn("prerequisite-" + field, module.validate_observation(bad))
        for field in module.REQUIRED_FALSE:
            bad = dict(valid, **{field: True})
            self.assertIn(
                "already-applied-or-conflicting-" + field,
                module.validate_observation(bad),
            )
        for extra in (dict(valid, unreviewed=True),
                      {k: v for k, v in valid.items() if k != module.REQUIRED_TRUE[0]}):
            self.assertEqual(module.validate_observation(extra),
                             ["observation-unexpected-or-missing-fields"])
        self.assertEqual(module.validate_observation(None), ["observation-not-object"])

    def test_live_url_is_pinned_to_project_and_credentials_never_become_argv(self):
        ref = module.owner_ref()
        uri = "postgresql://postgres:synthetic%21@db." + ref + ".supabase.co:5432/postgres"
        env = module.secure_pg_env(uri, ref)
        self.assertEqual(env["PGHOST"], "db." + ref + ".supabase.co")
        self.assertEqual(env["PGUSER"], "postgres")
        self.assertEqual(env["PGPASSWORD"], "synthetic!")
        self.assertEqual(env["PGSSLMODE"], "require")
        pooler = (
            "postgresql://postgres." + ref
            + ":synthetic@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"
        )
        self.assertEqual(module.secure_pg_env(pooler, ref)["PGPORT"], "6543")
        for wrong in (
            "postgresql://postgres:pw@db." + "a" * 20 + ".supabase.co/postgres",
            "postgresql://postgres:pw@evil.example/postgres",
            "postgresql://postgres:pw@db." + ref + ".supabase.co/other",
            "postgresql://postgres:pw@db." + ref + ".supabase.co/postgres?sslmode=disable",
            "postgresql://postgres:pw@db." + ref + ".supabase.co:9999/postgres",
            "postgresql://postgres:pw@" + "db." + ref + ".supabase.co.evil.example/postgres",
        ):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(ValueError, "wrong-project"):
                module.secure_pg_env(wrong, ref)

    def test_fixture_never_claims_authenticated_proof_or_remote_approval(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            path.write_text(json.dumps(self.observation()), encoding="utf-8")
            from io import StringIO
            from contextlib import redirect_stdout
            output = StringIO()
            with redirect_stdout(output):
                self.assertEqual(module.main(["--fixture-json", str(path)]), 0)
            value = json.loads(output.getvalue())
            self.assertEqual(value["scope"], "SYNTHETIC_FIXTURE_NOT_LIVE")
            self.assertTrue(value["catalog_preconditions_match"])
            self.assertFalse(value["public_activation_approved"])
            self.assertFalse(value["live_two_subject_e2e_proven"])
            self.assertFalse(value["production_ddl_performed"])
            self.assertNotIn("jhfphsjptrpmtnzkpwud", output.getvalue())

    def test_live_requires_secret_and_does_not_log_connection_detail(self):
        with patch.dict(os.environ, {"ORDAX_STORAGE_DESTINATION_DATABASE_URL": ""}):
            from io import StringIO
            from contextlib import redirect_stderr
            error = StringIO()
            with redirect_stderr(error):
                self.assertEqual(module.main(["--live"]), 2)
            self.assertIn("BLOCKED", error.getvalue())
            self.assertNotIn("postgresql://", error.getvalue())

    def test_query_failure_does_not_emit_raw_connection_or_sql_details(self):
        class Failure:
            returncode = 1
            stdout = ""
            stderr = "private credentials might be echoed here"

        uri = "postgresql://postgres:synthetic@db." + module.owner_ref() + ".supabase.co/postgres"
        with patch.dict(os.environ, {"ORDAX_STORAGE_DESTINATION_DATABASE_URL": uri}), \
             patch.object(module.subprocess, "run", return_value=Failure()) as run:
            with self.assertRaisesRegex(ValueError, "read-only-query-failed"):
                module.read_live(module.owner_ref())
            command = run.call_args.args[0]
            self.assertIn("-X", command)
            self.assertNotIn("synthetic", " ".join(command))
            self.assertNotIn("postgresql://", " ".join(command))
            self.assertEqual(run.call_args.kwargs["env"]["PGPASSWORD"], "synthetic")


if __name__ == "__main__":
    unittest.main()
